import type { Request, Response } from "express";
import { db, setting, setSetting } from "./db.js";
import { clientIp, sanitizeRequestHeaders } from "./request-meta.js";
import { tokenHash } from "./security.js";
import { hongKongDateKey, splitDailyQuotaCharge } from "./quota.js";
import { upstreamV1Url } from "./model-sync.js";
import { consumeRateLimit, detectCodingTool } from "./request-policy.js";
import { API_BRAND, brandedError, brandUpstreamError } from "./api-brand.js";

type KeyRow = {
  id: number;
  user_id: number;
  quota_limit: number | null;
  quota_used: number;
  quota_total: number;
  user_used: number;
  disabled: number;
};

type UsageMeta = {
  model: string;
  endpoint: string;
  status: number;
  firstByteMs: number;
  durationMs: number;
  ip: string;
  headers: string;
};

let publicReserved = 0;
const userReserved = new Map<number, number>();
const keyReserved = new Map<number, number>();
const userRequestWindows = new Map<number, number[]>();

function getBearer(req: Request) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function tokenUsage(payload: unknown, requestBody: unknown) {
  if (payload && typeof payload === "object") {
    const usage = (payload as { usage?: Record<string, unknown> }).usage;
    const direct = Number(usage?.total_tokens ?? usage?.total_tokens_used ?? 0);
    if (direct > 0) return Math.ceil(direct);
    const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
    const output = Number(
      usage?.output_tokens ?? usage?.completion_tokens ?? 0,
    );
    if (input + output > 0) return Math.ceil(input + output);
  }
  return Math.max(
    1,
    Math.ceil(
      (JSON.stringify(payload).length + JSON.stringify(requestBody).length) / 4,
    ),
  );
}

function recordUsage(key: KeyRow, tokens: number, meta: UsageMeta, chargeScope: "normal" | "personal" = "normal") {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (tokens > 0) {
      const checkinDate = hongKongDateKey();
      const checkin = db.prepare("SELECT quota_granted,quota_used FROM daily_checkins WHERE user_id=? AND checkin_date=?")
        .get(key.user_id, checkinDate) as { quota_granted: number; quota_used: number } | undefined;
      const charges = splitDailyQuotaCharge(tokens, checkin ? checkin.quota_granted - checkin.quota_used : 0);
      if (charges.daily > 0) {
        db.prepare("UPDATE daily_checkins SET quota_used=quota_used+? WHERE user_id=? AND checkin_date=?")
          .run(charges.daily, key.user_id, checkinDate);
      }
      db.prepare("UPDATE users SET quota_used=quota_used+? WHERE id=?").run(
        charges.permanent,
        key.user_id,
      );
      if (chargeScope === "normal") {
        db.prepare(
          "UPDATE api_keys SET quota_used=quota_used+?,last_used_at=CURRENT_TIMESTAMP WHERE id=?",
        ).run(tokens, key.id);
        setSetting(
          "public_quota_used",
          String(Number(setting("public_quota_used")) + tokens),
        );
      } else {
        db.prepare("UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").run(key.id);
      }
    }
    db.prepare(
      `INSERT INTO usage_logs(user_id,api_key_id,model,endpoint,tokens,status,first_byte_ms,duration_ms,ip,request_headers)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      key.user_id,
      key.id,
      meta.model,
      meta.endpoint,
      tokens,
      meta.status,
      meta.firstByteMs,
      meta.durationMs,
      meta.ip,
      meta.headers,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function testResponse(endpoint: string, model: string, chargedTokens: number) {
  const message = `【${API_BRAND}】测试拦截已生效，本次请求未发送到上游，并扣除个人额度 1 条鱼干。`;
  if (endpoint.startsWith("/responses")) {
    return {
      id: `resp_test_${Date.now()}`,
      object: "response",
      status: "completed",
      model,
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: message }],
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: chargedTokens,
        total_tokens: chargedTokens,
      },
    };
  }
  return {
    id: `chatcmpl-test-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: message },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: chargedTokens,
      total_tokens: chargedTokens,
    },
  };
}

export async function openAiProxy(req: Request, res: Response) {
  const rawKey = getBearer(req);
  if (!rawKey)
    return res
      .status(401)
      .json(brandedError("缺少 API Key", "invalid_request_error"));
  const key = db
    .prepare(
      `SELECT k.id,k.user_id,k.quota_limit,k.quota_used,u.quota_total,u.quota_used user_used,u.disabled
    FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked=0`,
    )
    .get(tokenHash(rawKey)) as KeyRow | undefined;
  if (!key || key.disabled)
    return res
      .status(401)
      .json(brandedError("API Key 无效或已停用", "invalid_api_key"));

  const body = req.body as {
    max_tokens?: number;
    max_completion_tokens?: number;
    model?: string;
  };
  const endpoint = req.originalUrl.replace(/^\/v1/, "");
  const model = String(body?.model || "");
  const ip = clientIp(req.headers["x-forwarded-for"], req.ip);
  const headers = sanitizeRequestHeaders(req.headers);
  const blockedTool = setting("coding_tools_block_enabled") === "true"
    ? detectCodingTool(req.headers, setting("coding_tools_blocklist"))
    : "";
  const rpmLimit = Math.max(0, Number(setting("rpm_limit")) || 0);
  const timestamps = userRequestWindows.get(key.user_id) || [];
  userRequestWindows.set(key.user_id, timestamps);
  const rateLimit = consumeRateLimit(timestamps, rpmLimit);
  if (!rateLimit.allowed) {
    recordUsage(key, 0, {
      model,
      endpoint: `/v1${endpoint}`,
      status: 429,
      firstByteMs: 0,
      durationMs: 0,
      ip,
      headers,
    });
    res.setHeader("Retry-After", String(rateLimit.retryAfter));
    return res.status(429).json(brandedError(
      `请求过于频繁，每个用户每分钟最多 ${Math.floor(rpmLimit)} 次`,
      "rate_limit_exceeded",
    ));
  }

  const penalty = Math.max(1, Number(setting("quota_per_fish")) || 5000);
  const checkin = db.prepare("SELECT quota_granted,quota_used FROM daily_checkins WHERE user_id=? AND checkin_date=?")
    .get(key.user_id, hongKongDateKey()) as { quota_granted: number; quota_used: number } | undefined;
  const personalRemaining = Math.max(
    0,
    Math.max(0, key.quota_total - key.user_used) +
      (checkin ? Math.max(0, checkin.quota_granted - checkin.quota_used) : 0) -
      (userReserved.get(key.user_id) || 0),
  );
  if (blockedTool) {
    if (personalRemaining < penalty) {
      return res.status(429).json(brandedError("个人额度不足，无法扣除拦截罚款", "insufficient_quota"));
    }
    recordUsage(key, penalty, {
      model,
      endpoint: `/v1${endpoint}`,
      status: 403,
      firstByteMs: 0,
      durationMs: 0,
      ip,
      headers,
    }, "personal");
    return res.status(403).json(brandedError(
      `已拦截编程工具（${blockedTool}），并扣除个人额度 1 条鱼干`,
      "client_not_allowed",
    ));
  }

  if (req.method === "GET" && req.originalUrl.split("?")[0] === "/v1/models") {
    const models = db
      .prepare(
        "SELECT model_id FROM models WHERE enabled=1 ORDER BY sort_order,id",
      )
      .all() as { model_id: string }[];
    return res.json({
      object: "list",
      data: models.map((model) => ({
        id: model.model_id,
        object: "model",
        created: 0,
        owned_by: "xldc",
      })),
    });
  }

  if ((req.body as { stream?: boolean })?.stream)
    return res
      .status(400)
      .json(brandedError("当前分站暂不支持 stream=true，请使用非流式请求", "unsupported_parameter"));

  const inputEstimate = Math.ceil(JSON.stringify(body || {}).length / 4);
  const outputLimit = Math.max(
    1,
    Number(body?.max_completion_tokens || body?.max_tokens || 2048),
  );
  const reservation = inputEstimate + outputLimit;
  const interceptThreshold = Math.max(
    0,
    Number(setting("test_intercept_max_tokens")) || 0,
  );
  const shouldIntercept =
    setting("test_intercept_enabled") === "true" &&
    interceptThreshold > 0 &&
    outputLimit <= interceptThreshold;
  const interceptCharge = penalty;
  const publicRemaining = Math.max(
    0,
    Number(setting("public_quota_total")) -
      Number(setting("public_quota_used")) -
      publicReserved,
  );
  const userRemaining = personalRemaining;
  const keyRemaining =
    key.quota_limit == null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(
          0,
          key.quota_limit - key.quota_used - (keyReserved.get(key.id) || 0),
        );
  const insufficientQuota = shouldIntercept
    ? userRemaining < interceptCharge
    : Math.min(publicRemaining, userRemaining, keyRemaining) < reservation;
  if (insufficientQuota)
    return res
      .status(429)
      .json(brandedError(
        shouldIntercept ? "个人额度不足，无法扣除测试拦截罚款" : "剩余额度不足以完成这次请求，请调低 max_tokens",
        "insufficient_quota",
      ));

  if (shouldIntercept) {
    recordUsage(key, interceptCharge, {
      model,
      endpoint: `/v1${endpoint}`,
      status: 200,
      firstByteMs: 0,
      durationMs: 0,
      ip,
      headers,
    }, "personal");
    return res.json(testResponse(endpoint, model, interceptCharge));
  }

  const upstreamKey = setting("upstream_api_key");
  if (!upstreamKey)
    return res
      .status(503)
      .json(brandedError("管理员尚未配置 API 上游", "upstream_unavailable"));
  const upstreamUrl = upstreamV1Url(setting("upstream_url"), endpoint);
  publicReserved += reservation;
  userReserved.set(
    key.user_id,
    (userReserved.get(key.user_id) || 0) + reservation,
  );
  keyReserved.set(key.id, (keyReserved.get(key.id) || 0) + reservation);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${upstreamKey}`,
      },
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : JSON.stringify(req.body),
      signal: AbortSignal.timeout(120_000),
    });
    const firstByteMs = Date.now() - startedAt;
    const responseText = await upstream.text();
    const durationMs = Date.now() - startedAt;
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { error: { message: responseText || "上游返回了无效响应" } };
    }
    const tokens = upstream.ok ? tokenUsage(payload, req.body) : 0;
    recordUsage(key, tokens, {
      model,
      endpoint: `/v1${endpoint}`,
      status: upstream.status,
      firstByteMs,
      durationMs,
      ip,
      headers,
    });
    const responsePayload = upstream.ok ? payload : brandUpstreamError(payload, upstream.status);
    res
      .status(upstream.status)
      .type("application/json")
      .send(JSON.stringify(responsePayload));
  } catch (error) {
    console.error(error);
    const durationMs = Date.now() - startedAt;
    try {
      recordUsage(key, 0, {
        model,
        endpoint: `/v1${endpoint}`,
        status: 502,
        firstByteMs: 0,
        durationMs,
        ip,
        headers,
      });
    } catch (logError) {
      console.error(logError);
    }
    res
      .status(502)
      .json(brandedError("连接 API 上游失败", "upstream_error"));
  } finally {
    publicReserved = Math.max(0, publicReserved - reservation);
    userReserved.set(
      key.user_id,
      Math.max(0, (userReserved.get(key.user_id) || 0) - reservation),
    );
    keyReserved.set(
      key.id,
      Math.max(0, (keyReserved.get(key.id) || 0) - reservation),
    );
  }
}

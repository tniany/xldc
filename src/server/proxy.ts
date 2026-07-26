import type { Request, Response } from 'express';
import { db, setting, setSetting } from './db.js';
import { tokenHash } from './security.js';

type KeyRow = { id: number; user_id: number; quota_limit: number | null; quota_used: number; quota_total: number; user_used: number; disabled: number };

let publicReserved = 0;
const userReserved = new Map<number, number>();
const keyReserved = new Map<number, number>();

function getBearer(req: Request) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function tokenUsage(payload: unknown, requestBody: unknown) {
  if (payload && typeof payload === 'object') {
    const usage = (payload as { usage?: Record<string, unknown> }).usage;
    const direct = Number(usage?.total_tokens ?? usage?.total_tokens_used ?? 0);
    if (direct > 0) return Math.ceil(direct);
    const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
    const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
    if (input + output > 0) return Math.ceil(input + output);
  }
  return Math.max(1, Math.ceil((JSON.stringify(payload).length + JSON.stringify(requestBody).length) / 4));
}

export async function openAiProxy(req: Request, res: Response) {
  const rawKey = getBearer(req);
  if (!rawKey) return res.status(401).json({ error: { message: '缺少 API Key', type: 'invalid_request_error' } });
  const key = db.prepare(`SELECT k.id,k.user_id,k.quota_limit,k.quota_used,u.quota_total,u.quota_used user_used,u.disabled
    FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked=0`).get(tokenHash(rawKey)) as KeyRow | undefined;
  if (!key || key.disabled) return res.status(401).json({ error: { message: 'API Key 无效或已停用', type: 'invalid_api_key' } });

  if (req.method === 'GET' && req.originalUrl.split('?')[0] === '/v1/models') {
    const models = db.prepare('SELECT model_id FROM models WHERE enabled=1 ORDER BY sort_order,id').all() as { model_id: string }[];
    return res.json({ object: 'list', data: models.map((model) => ({ id: model.model_id, object: 'model', created: 0, owned_by: 'xldc' })) });
  }

  if ((req.body as { stream?: boolean })?.stream) return res.status(400).json({ error: { message: '当前分站暂不支持 stream=true，请使用非流式请求', type: 'unsupported_parameter' } });

  const body = req.body as { max_tokens?: number; max_completion_tokens?: number };
  const inputEstimate = Math.ceil(JSON.stringify(body || {}).length / 4);
  const outputLimit = Math.max(1, Number(body?.max_completion_tokens || body?.max_tokens || 2048));
  const reservation = inputEstimate + outputLimit;
  const publicRemaining = Math.max(0, Number(setting('public_quota_total')) - Number(setting('public_quota_used')) - publicReserved);
  const userRemaining = Math.max(0, key.quota_total - key.user_used - (userReserved.get(key.user_id) || 0));
  const keyRemaining = key.quota_limit == null ? Number.MAX_SAFE_INTEGER : Math.max(0, key.quota_limit - key.quota_used - (keyReserved.get(key.id) || 0));
  if (Math.min(publicRemaining, userRemaining, keyRemaining) < reservation) return res.status(429).json({ error: { message: '剩余额度不足以完成这次请求，请调低 max_tokens', type: 'insufficient_quota' } });

  const upstreamKey = setting('upstream_api_key');
  if (!upstreamKey) return res.status(503).json({ error: { message: '管理员尚未配置 API 上游', type: 'upstream_unavailable' } });
  const base = setting('upstream_url').replace(/\/$/, '');
  const endpoint = req.originalUrl.replace(/^\/v1/, '');
  publicReserved += reservation;
  userReserved.set(key.user_id, (userReserved.get(key.user_id) || 0) + reservation);
  keyReserved.set(key.id, (keyReserved.get(key.id) || 0) + reservation);
  try {
    const upstream = await fetch(`${base}/v1${endpoint}`, {
      method: req.method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${upstreamKey}` },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(120_000),
    });
    const responseText = await upstream.text();
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { payload = { error: { message: responseText || '上游返回了无效响应' } }; }
    const tokens = upstream.ok ? tokenUsage(payload, req.body) : 0;
    if (tokens > 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET quota_used=quota_used+? WHERE id=?').run(tokens, key.user_id);
        db.prepare("UPDATE api_keys SET quota_used=quota_used+?,last_used_at=CURRENT_TIMESTAMP WHERE id=?").run(tokens, key.id);
        setSetting('public_quota_used', String(Number(setting('public_quota_used')) + tokens));
        db.prepare('INSERT INTO usage_logs(user_id,api_key_id,model,endpoint,tokens,status) VALUES (?,?,?,?,?,?)')
          .run(key.user_id, key.id, String((req.body as { model?: string })?.model || ''), `/v1${endpoint}`, tokens, upstream.status);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    res.status(upstream.status).type('application/json').send(JSON.stringify(payload));
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: { message: '连接 API 上游失败', type: 'upstream_error' } });
  } finally {
    publicReserved = Math.max(0, publicReserved - reservation);
    userReserved.set(key.user_id, Math.max(0, (userReserved.get(key.user_id) || 0) - reservation));
    keyReserved.set(key.id, Math.max(0, (keyReserved.get(key.id) || 0) - reservation));
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { parseUpstreamModelIds, upstreamError, upstreamV1Url } from "../src/server/model-sync.js";
import {
  clientIp,
  sanitizeRequestHeaders,
} from "../src/server/request-meta.js";
import { checkinFishRange, hongKongDateKey, splitDailyQuotaCharge } from "../src/server/quota.js";
import { consumeRateLimit, detectCodingTool } from "../src/server/request-policy.js";
import { API_BRAND, brandedError, brandUpstreamError } from "../src/server/api-brand.js";

test("upstream model parser accepts OpenAI lists and removes invalid duplicates", () => {
  assert.deepEqual(
    parseUpstreamModelIds({
      object: "list",
      data: [
        { id: "gpt-4o" },
        { id: " gpt-4o " },
        { id: "claude-3-5" },
        { nope: true },
        null,
      ],
    }),
    ["gpt-4o", "claude-3-5"],
  );
  assert.deepEqual(parseUpstreamModelIds({ data: "invalid" }), []);
});

test("upstream URLs accept base addresses with or without v1", () => {
  assert.equal(upstreamV1Url("https://api.example.com", "models"), "https://api.example.com/v1/models");
  assert.equal(upstreamV1Url("https://api.example.com/v1/", "/chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.equal(upstreamError({ error: { message: "invalid key" } }), "invalid key");
});

test("request metadata redacts credentials and uses the first forwarded IP", () => {
  const headers = JSON.parse(
    sanitizeRequestHeaders({
      authorization: "Bearer secret-key",
      cookie: "session=secret",
      "x-api-key": "another-secret",
      "user-agent": "test-client",
    }),
  );
  assert.equal(headers.authorization, "[REDACTED]");
  assert.equal(headers.cookie, "[REDACTED]");
  assert.equal(headers["x-api-key"], "[REDACTED]");
  assert.equal(headers["user-agent"], "test-client");
  assert.equal(clientIp("203.0.113.8, 10.0.0.2", "127.0.0.1"), "203.0.113.8");
});

test("daily check-in quota uses Hong Kong dates and is consumed first", () => {
  assert.equal(hongKongDateKey(new Date("2026-07-25T16:30:00Z")), "2026-07-26");
  assert.deepEqual(splitDailyQuotaCharge(3000, 5000), { daily: 3000, permanent: 0 });
  assert.deepEqual(splitDailyQuotaCharge(7000, 5000), { daily: 5000, permanent: 2000 });
  assert.deepEqual(checkinFishRange("2", "5"), { min: 2, max: 5 });
  assert.deepEqual(checkinFishRange("8", "3"), { min: 8, max: 8 });
});

test("coding tools are detected and RPM uses a rolling minute", () => {
  assert.equal(detectCodingTool({ "user-agent": "codex_cli_rs/1.0" }, "codex,cursor"), "codex");
  assert.equal(detectCodingTool({ "user-agent": "Mozilla/5.0" }, "codex,cursor"), "");
  const timestamps: number[] = [];
  assert.equal(consumeRateLimit(timestamps, 2, 100_000).allowed, true);
  assert.equal(consumeRateLimit(timestamps, 2, 110_000).allowed, true);
  const limited = consumeRateLimit(timestamps, 2, 120_000);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfter, 40);
  assert.equal(consumeRateLimit(timestamps, 2, 160_001).allowed, true);
});

test("API errors carry the workshop identity", () => {
  const direct = brandedError("缺少 API Key", "invalid_request_error");
  assert.equal(direct.error.brand, API_BRAND);
  assert.match(direct.error.message, /小老鼠的奶酪工坊-dc分站/);
  const upstream = brandUpstreamError({ error: { message: "bad request", code: "bad" } }, 400);
  assert.equal(upstream.error.brand, API_BRAND);
  assert.equal(upstream.error.code, "bad");
});

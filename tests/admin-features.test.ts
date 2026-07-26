import assert from "node:assert/strict";
import test from "node:test";
import { mergeNewApiPricing, parseModelStatus, parseUpstreamModelIds, parseUpstreamModels, upstreamError, upstreamV1Url } from "../src/server/model-sync.js";
import {
  clientIp,
  sanitizeRequestHeaders,
} from "../src/server/request-meta.js";
import { checkinFishRange, hongKongDateKey, publicQuotaTotalForRemainingFish, splitDailyQuotaCharge } from "../src/server/quota.js";
import { consumeRateLimit, detectCodingTool } from "../src/server/request-policy.js";
import { API_BRAND, brandedError, brandUpstreamError } from "../src/server/api-brand.js";
import { estimatedTokenUsage, payloadTokenUsage, payloadUsageTokens, SseUsageTracker } from "../src/server/stream-usage.js";
import { matchesDiscordRequirement, parseDiscordRequirements } from "../src/server/discord-policy.js";
import { calculateBilling } from "../src/server/billing.js";

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

test("upstream model parser normalizes common pricing formats to per-million prices", () => {
  assert.deepEqual(parseUpstreamModels({ data: [
    { id: "openrouter-model", pricing: { prompt: "0.0000025", completion: "0.00001" } },
    { id: "relay-model", input_price_per_million: 3, output_price_per_million: "15" },
    { id: "unpriced-model" },
  ] }), [
    { id: "openrouter-model", inputPricePerMillion: 2.5, outputPricePerMillion: 10, requestPrice: null },
    { id: "relay-model", inputPricePerMillion: 3, outputPricePerMillion: 15, requestPrice: null },
    { id: "unpriced-model", inputPricePerMillion: null, outputPricePerMillion: null, requestPrice: null },
  ]);
});

test("New API pricing supports token ratios and per-request models", () => {
  const models = parseUpstreamModels({ data: [{ id: "chat" }, { id: "image" }, { id: "missing" }] });
  assert.deepEqual(mergeNewApiPricing(models, { data: [
    { model_name: "chat", quota_type: 0, model_ratio: 1.5, completion_ratio: 5 },
    { model_name: "image", quota_type: 1, model_price: 0.3 },
    { model_name: "not-enabled", quota_type: 0, model_ratio: 99, completion_ratio: 99 },
  ] }), [
    { id: "chat", inputPricePerMillion: 3, outputPricePerMillion: 15, requestPrice: null },
    { id: "image", inputPricePerMillion: null, outputPricePerMillion: null, requestPrice: 0.3 },
    { id: "missing", inputPricePerMillion: null, outputPricePerMillion: null, requestPrice: null },
  ]);
});

test("upstream URLs accept base addresses with or without v1", () => {
  assert.equal(upstreamV1Url("https://api.example.com", "models"), "https://api.example.com/v1/models");
  assert.equal(upstreamV1Url("https://api.example.com/v1/", "/chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.equal(upstreamError({ error: { message: "invalid key" } }), "invalid key");
});

test("model status accepts supported values and maps legacy disabled models offline", () => {
  assert.equal(parseModelStatus("normal"), "normal");
  assert.equal(parseModelStatus("abnormal"), "abnormal");
  assert.equal(parseModelStatus("offline"), "offline");
  assert.equal(parseModelStatus("unexpected", 0), "offline");
  assert.equal(parseModelStatus(undefined, 1), "normal");
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

test("editing remaining public fish preserves accumulated usage", () => {
  assert.equal(publicQuotaTotalForRemainingFish(12_345, 20, 5_000), 112_345);
  assert.equal(publicQuotaTotalForRemainingFish(12_345, -2, 5_000), 12_345);
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

test("streaming usage tracks split SSE chunks and final usage", () => {
  const tracker = new SseUsageTracker();
  tracker.push('data: {"choices":[{"del');
  tracker.push('ta":{"content":"hello"}}]}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
  tracker.finish();
  assert.equal(tracker.totalTokens({ messages: [] }), 5);
  assert.equal(payloadUsageTokens({ response: { usage: { input_tokens: 4, output_tokens: 6 } } }), 10);
  assert.deepEqual(payloadTokenUsage({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), {
    inputTokens: 3, outputTokens: 2, totalTokens: 5,
  });
  assert.deepEqual(estimatedTokenUsage({ model: "test" }, { inputTokens: 0, outputTokens: 0, totalTokens: 20 }), {
    inputTokens: 4, outputTokens: 16, totalTokens: 20,
  });
});

test("model pricing changes fish consumption and unpriced models keep legacy charging", () => {
  const usage = { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 };
  assert.deepEqual(calculateBilling(usage, {
    inputPricePerMillion: 2,
    outputPricePerMillion: 10,
    requestPrice: null,
  }, 5000), {
    quotaCharge: 60,
    fishCharged: 0.012,
    costUsd: 0.012,
    priced: true,
  });
  assert.equal(calculateBilling(usage, {
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    requestPrice: 0.3,
  }, 5000).fishCharged, 0.3);
  assert.equal(calculateBilling(usage, null, 5000).fishCharged, 0.4);
});

test("Discord registration accepts any configured guild and role condition", () => {
  const requirements = parseDiscordRequirements('123456:987654\n222222:333333\ninvalid');
  assert.deepEqual(requirements, [
    { guildId: '123456', roleId: '987654' },
    { guildId: '222222', roleId: '333333' },
  ]);
  assert.equal(matchesDiscordRequirement(requirements, new Map([['222222', ['333333']]])), true);
  assert.equal(matchesDiscordRequirement(requirements, new Map([['123456', ['111111']]])), false);
});

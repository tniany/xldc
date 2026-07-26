import assert from "node:assert/strict";
import test from "node:test";
import { parseUpstreamModelIds } from "../src/server/model-sync.js";
import {
  clientIp,
  sanitizeRequestHeaders,
} from "../src/server/request-meta.js";
import { hongKongDateKey, splitDailyQuotaCharge } from "../src/server/quota.js";

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
});

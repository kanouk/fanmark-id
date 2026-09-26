import assert from "node:assert/strict";
import test from "node:test";
import {
  AvailabilityRulesAdminApiError,
  getAvailabilityRulesAdminBackend,
  listAvailabilityRules,
  updateAvailabilityRule,
  type AvailabilityRuleAdmin,
} from "./availability-rules-admin-api.ts";

const id = "a5333333-3333-4333-8333-333333333333";
const updatedAt = "2026-09-25T12:00:00.000000Z";
const rule: AvailabilityRuleAdmin = {
  id,
  rule_type: "prefix_pattern",
  priority: 3,
  rule_config: { prefixes: { "🎄": 5.99, "🏢": 29.99, "💎": 19.99 } },
  is_available: false,
  price_usd: null,
  description: "Prefix-based pricing",
  updated_at: updatedAt,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("backend selector defaults to Supabase and rejects unrecognized values", () => {
  assert.equal(getAvailabilityRulesAdminBackend(undefined), "supabase");
  assert.equal(getAvailabilityRulesAdminBackend(" worker "), "worker");
  assert.throws(() => getAvailabilityRulesAdminBackend("unknown"), AvailabilityRulesAdminApiError);
});

test("lists bounded D1 admin DTOs using same-origin credentials and no-store", async () => {
  let called = 0;
  const result = await listAvailabilityRules(async (input, init) => {
    called += 1;
    assert.equal(input, "/api/admin/availability-rules");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    return response({ schemaVersion: 1, rules: [rule] });
  });
  assert.equal(called, 1);
  assert.deepEqual(result, [rule]);
});

test("patches the selected rule with compare-and-set and does not retry through Supabase", async () => {
  let calls = 0;
  const updated = { ...rule, rule_config: { prefixes: { ...rule.rule_config.prefixes, "🏢": 120.05 } }, updated_at: "2026-09-26T12:34:56.000000Z" };
  const result = await updateAvailabilityRule(id.toUpperCase(), {
    prefixPrice: { emoji: "🏢", priceUsd: "120.05" },
    expectedUpdatedAt: updatedAt,
  }, async (input, init) => {
    calls += 1;
    assert.equal(input, `/api/admin/availability-rules/${id}`);
    assert.equal(init?.method, "PATCH");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      prefixPrice: { emoji: "🏢", priceUsd: "120.05" },
      expectedUpdatedAt: updatedAt,
    });
    return response({ schemaVersion: 1, rule: updated });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, updated);
});

test("surfaces Worker failures without attempting a fallback request", async () => {
  let calls = 0;
  await assert.rejects(
    listAvailabilityRules(async () => {
      calls += 1;
      return response({ error: "availability_rules_admin_unavailable" }, 503);
    }),
    (error: unknown) => error instanceof AvailabilityRulesAdminApiError && error.kind === "http" && error.status === 503,
  );
  assert.equal(calls, 1);
});

test("rejects extra, malformed, or oversized rule projections", async () => {
  await assert.rejects(listAvailabilityRules(async () => response({ schemaVersion: 1, rules: [{ ...rule, created_by: "user" }] })),
    (error: unknown) => error instanceof AvailabilityRulesAdminApiError && error.kind === "invalid_response");
  await assert.rejects(listAvailabilityRules(async () => response({ schemaVersion: 2, rules: [rule] })),
    (error: unknown) => error instanceof AvailabilityRulesAdminApiError && error.kind === "invalid_response");
  await assert.rejects(listAvailabilityRules(async () => response({ schemaVersion: 1, rules: Array(65).fill(rule) })),
    (error: unknown) => error instanceof AvailabilityRulesAdminApiError && error.kind === "invalid_response");
});

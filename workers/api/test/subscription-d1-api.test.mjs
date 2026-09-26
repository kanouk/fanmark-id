import assert from "node:assert/strict";
import test from "node:test";
import { handleSubscriptionRequest } from "../src/subscription-d1-api.ts";

const origin = "https://app.example.test";
const userId = "synthetic-owner-1";
const row = {
  status: "active",
  product_id: "prod_synthetic",
  current_period_start: "2026-09-01T00:00:00.000Z",
  current_period_end: "2026-10-01T00:00:00.000Z",
  amount: 1200,
  currency: "jpy",
  interval: "month",
  interval_count: 1,
  cancel_at_period_end: 1,
  payment_failure_at: null,
  next_payment_attempt: null,
  payment_failure_type: null,
  stripe_customer_id: "must-not-be-selected",
  stripe_subscription_id: "must-not-be-selected",
};

function setup(rows = [row]) {
  let query = "";
  let bindings = [];
  let reads = 0;
  const database = {
    prepare(sql) {
      query = sql;
      return {
        bind(...values) {
          bindings = values;
          return {
            async all() {
              reads += 1;
              return { success: true, results: rows };
            },
          };
        },
      };
    },
  };
  const env = {
    SUBSCRIPTION_BACKEND: "d1",
    AUTH_BACKEND: "better-auth",
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    CORS_ALLOWED_ORIGINS: origin,
  };
  const resolveAuth = async () => ({ available: true, userId });
  const request = (path = "/api/me/subscription", init = {}, requestEnv = env, resolver = resolveAuth) =>
    handleSubscriptionRequest(new Request(`https://api.example.test${path}`, {
      ...init,
      headers: { Origin: origin, ...(init.headers ?? {}) },
    }), requestEnv, resolver);
  return { request, env, get query() { return query; }, get bindings() { return bindings; }, get reads() { return reads; } };
}

test("authenticated user receives only their read-only subscription projection", async () => {
  const state = setup();
  const response = await state.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    subscription: {
      status: row.status,
      product_id: row.product_id,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
      amount: row.amount,
      currency: row.currency,
      interval: row.interval,
      interval_count: row.interval_count,
      cancel_at_period_end: true,
      payment_failure_at: null,
      next_payment_attempt: null,
      payment_failure_type: null,
    },
  });
  assert.deepEqual(state.bindings, [userId]);
  assert.match(state.query, /WHERE\s+user_id\s*=\s*\?/u);
  assert.doesNotMatch(state.query, /stripe_customer_id|stripe_subscription_id/u);
  assert.equal(state.reads, 1);
});

test("empty D1 subscriptions are successful; unauthenticated sessions never query D1", async () => {
  const empty = setup([]);
  assert.deepEqual(await (await empty.request()).json(), { schemaVersion: 1, subscription: null });
  const anonymous = setup();
  const denied = await anonymous.request("/api/me/subscription", {}, anonymous.env, async () => ({ available: true, userId: null }));
  assert.equal(denied.status, 401);
  assert.equal(anonymous.reads, 0);
});

test("disabled backend, unsupported methods, query strings, and untrusted origins fail closed", async () => {
  const state = setup();
  const disabled = await state.request("/api/me/subscription", {}, { ...state.env, SUBSCRIPTION_BACKEND: "supabase" });
  assert.equal(disabled.status, 503);
  const method = await state.request("/api/me/subscription", { method: "POST" });
  assert.equal(method.status, 405);
  const query = await state.request("/api/me/subscription?userId=other");
  assert.equal(query.status, 400);
  const forbidden = await handleSubscriptionRequest(new Request("https://api.example.test/api/me/subscription", {
    headers: { Origin: "https://attacker.example" },
  }), state.env, async () => ({ available: true, userId }));
  assert.equal(forbidden?.status, 403);
  assert.equal(state.reads, 0);
});

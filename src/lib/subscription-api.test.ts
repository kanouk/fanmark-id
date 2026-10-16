import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubscriptionApiUrl,
  getSubscriptionBackend,
  loadOwnSubscription,
  SubscriptionApiError,
  type SubscriptionRecord,
} from "./subscription-api.ts";

const subscription: SubscriptionRecord = {
  status: "active",
  product_id: "prod_synthetic",
  current_period_start: "2026-09-01T00:00:00.000Z",
  current_period_end: "2026-10-01T00:00:00.000Z",
  amount: 1200,
  currency: "jpy",
  interval: "month",
  interval_count: 1,
  cancel_at_period_end: false,
  payment_failure_at: null,
  next_payment_attempt: null,
  payment_failure_type: null,
};

test("subscription backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getSubscriptionBackend(undefined), "supabase");
  assert.equal(getSubscriptionBackend("worker"), "worker");
  assert.throws(() => getSubscriptionBackend("other"), SubscriptionApiError);
  assert.equal(String(buildSubscriptionApiUrl("https://app.example.test")), "https://app.example.test/api/me/subscription");
});

test("Worker subscription read sends same-origin credentials and returns only the validated projection", async () => {
  const calls: Array<{ url: string; method: string | undefined; credentials: RequestCredentials | undefined; cache: RequestCache | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, credentials: init?.credentials, cache: init?.cache });
    return new Response(JSON.stringify({ schemaVersion: 1, subscription }), {
      headers: { "content-type": "application/json" },
    });
  };
  assert.deepEqual(await loadOwnSubscription({ baseUrl: "https://app.example.test", fetchImpl }), subscription);
  assert.deepEqual(calls, [{
    url: "https://app.example.test/api/me/subscription",
    method: "GET",
    credentials: "include",
    cache: "no-store",
  }]);
  await assert.rejects(loadOwnSubscription({
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://auth.example.test",
    fetchImpl,
  }), SubscriptionApiError);
});

test("an empty D1 result is a valid null subscription and HTTP errors do not fall back", async () => {
  assert.equal(await loadOwnSubscription({
    baseUrl: "https://app.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, subscription: null }), {
      headers: { "content-type": "application/json" },
    }),
  }), null);
  let attempts = 0;
  await assert.rejects(loadOwnSubscription({
    baseUrl: "https://app.example.test",
    fetchImpl: async () => { attempts += 1; return new Response("{}", { status: 503 }); },
  }), (error: unknown) => error instanceof SubscriptionApiError && error.kind === "http");
  assert.equal(attempts, 1);
});

test("the client rejects extra Stripe identifiers and malformed fields", async () => {
  await assert.rejects(loadOwnSubscription({
    baseUrl: "https://app.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      schemaVersion: 1,
      subscription: { ...subscription, stripe_customer_id: "private" },
    }), { headers: { "content-type": "application/json" } }),
  }), SubscriptionApiError);
  await assert.rejects(loadOwnSubscription({
    baseUrl: "https://app.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      schemaVersion: 1,
      subscription: { ...subscription, cancel_at_period_end: 1 },
    }), { headers: { "content-type": "application/json" } }),
  }), SubscriptionApiError);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStripePlanCheckoutUrl,
  clearStripePlanCheckoutRequestIds,
  createStripePlanCheckoutThroughWorker,
  getStripePlanCheckoutBackend,
  getStripePlanCheckoutRequestId,
  StripePlanCheckoutApiError,
} from "./stripe-plan-checkout-api.ts";

const requestId = "00000000-0000-4000-8000-000000000002";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("plan checkout backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getStripePlanCheckoutBackend(undefined), "supabase");
  assert.equal(getStripePlanCheckoutBackend(" worker "), "worker");
  assert.throws(() => getStripePlanCheckoutBackend("cloudflare"), StripePlanCheckoutApiError);
});

test("plan checkout URL replaces only the path on a validated API origin", () => {
  assert.equal(
    buildStripePlanCheckoutUrl("https://app.example/").href,
    "https://app.example/api/billing/plan-checkout",
  );
  assert.throws(() => buildStripePlanCheckoutUrl("https://user:pass@app.example"), StripePlanCheckoutApiError);
});

test("request IDs remain stable per plan and clear after the checkout returns", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const generated = getStripePlanCheckoutRequestId("creator", storage);
  assert.match(generated, /^[0-9a-f-]{36}$/u);
  assert.equal(getStripePlanCheckoutRequestId("creator", storage), generated);
  assert.notEqual(getStripePlanCheckoutRequestId("business", storage), generated);
  clearStripePlanCheckoutRequestIds(storage);
  assert.equal(values.size, 0);
});

test("Worker plan checkout sends same-origin credentials and a stable idempotency ID", async () => {
  let request: Request | URL | null = null;
  let init: RequestInit | undefined;
  const result = await createStripePlanCheckoutThroughWorker(
    { planType: "creator", requestId: requestId.toUpperCase() },
    {
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async (input, options) => {
        request = input;
        init = options;
        return jsonResponse({ url: "https://checkout.stripe.com/c/pay/synthetic" });
      },
    },
  );
  assert.deepEqual(result, { url: "https://checkout.stripe.com/c/pay/synthetic" });
  assert.equal(request instanceof URL ? request.href : request, "https://app.example/api/billing/plan-checkout");
  assert.equal(init?.method, "POST");
  assert.equal(init?.credentials, "include");
  assert.equal(init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(init?.body)), { plan_type: "creator", request_id: requestId });
});

test("Worker plan checkout rejects cross-origin endpoints and unsafe Stripe URLs", async () => {
  let calls = 0;
  await assert.rejects(
    () => createStripePlanCheckoutThroughWorker(
      { planType: "creator", requestId },
      {
        baseUrl: "https://api.other.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => { calls += 1; return jsonResponse({ url: "https://checkout.stripe.com/" }); },
      },
    ),
    (error: unknown) => error instanceof StripePlanCheckoutApiError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => createStripePlanCheckoutThroughWorker(
      { planType: "creator", requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ url: "https://attacker.example/pay" }),
      },
    ),
    (error: unknown) => error instanceof StripePlanCheckoutApiError && error.kind === "invalid_response",
  );
});

test("Worker plan checkout preserves bounded errors and rejects malformed responses", async () => {
  await assert.rejects(
    () => createStripePlanCheckoutThroughWorker(
      { planType: "creator", requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ error: "stripe_checkout_not_ready" }, 503),
      },
    ),
    (error: unknown) => error instanceof StripePlanCheckoutApiError &&
      error.kind === "http" && error.status === 503 && error.code === "stripe_checkout_not_ready",
  );
  await assert.rejects(
    () => createStripePlanCheckoutThroughWorker(
      { planType: "creator", requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ url: "https://checkout.stripe.com/", extra: true }),
      },
    ),
    (error: unknown) => error instanceof StripePlanCheckoutApiError && error.kind === "invalid_response",
  );
});

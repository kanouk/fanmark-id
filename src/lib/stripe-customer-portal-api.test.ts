import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStripeCustomerPortalUrl,
  createStripeCustomerPortalThroughWorker,
  getStripeCustomerPortalBackend,
  StripeCustomerPortalApiError,
} from "./stripe-customer-portal-api.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("customer portal backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getStripeCustomerPortalBackend(undefined), "supabase");
  assert.equal(getStripeCustomerPortalBackend(" worker "), "worker");
  assert.throws(() => getStripeCustomerPortalBackend("cloudflare"), StripeCustomerPortalApiError);
});

test("customer portal URL replaces only the path on a validated API origin", () => {
  assert.equal(
    buildStripeCustomerPortalUrl("https://app.example/").href,
    "https://app.example/api/billing/customer-portal",
  );
  assert.throws(() => buildStripeCustomerPortalUrl("https://user:pass@app.example"), StripeCustomerPortalApiError);
});

test("Worker portal request uses the Better Auth origin and same-origin credentials", async () => {
  let request: Request | URL | null = null;
  let init: RequestInit | undefined;
  const result = await createStripeCustomerPortalThroughWorker({
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async (input, options) => {
      request = input;
      init = options;
      return jsonResponse({ url: "https://billing.stripe.com/p/session/synthetic" });
    },
  });
  assert.deepEqual(result, { url: "https://billing.stripe.com/p/session/synthetic" });
  assert.equal(request instanceof URL ? request.href : request, "https://app.example/api/billing/customer-portal");
  assert.equal(init?.method, "POST");
  assert.equal(init?.credentials, "include");
  assert.equal(init?.cache, "no-store");
  assert.equal(init?.body, undefined);
});

test("Worker portal does not cross the auth origin or accept unsafe URLs", async () => {
  let calls = 0;
  await assert.rejects(
    () => createStripeCustomerPortalThroughWorker({
      baseUrl: "https://api.other.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async () => { calls += 1; return jsonResponse({ url: "https://billing.stripe.com/" }); },
    }),
    (error: unknown) => error instanceof StripeCustomerPortalApiError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => createStripeCustomerPortalThroughWorker({
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async () => jsonResponse({ url: "javascript:alert(1)" }),
    }),
    (error: unknown) => error instanceof StripeCustomerPortalApiError && error.kind === "invalid_response",
  );
});

test("Worker portal preserves bounded HTTP errors and rejects oversized or malformed responses", async () => {
  await assert.rejects(
    () => createStripeCustomerPortalThroughWorker({
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async () => jsonResponse({ error: "stripe_customer_not_linked" }, 404),
    }),
    (error: unknown) => error instanceof StripeCustomerPortalApiError &&
      error.kind === "http" && error.status === 404 && error.code === "stripe_customer_not_linked",
  );
  await assert.rejects(
    () => createStripeCustomerPortalThroughWorker({
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async () => jsonResponse({ url: "https://billing.stripe.com/", extra: true }),
    }),
    (error: unknown) => error instanceof StripeCustomerPortalApiError && error.kind === "invalid_response",
  );
  await assert.rejects(
    () => createStripeCustomerPortalThroughWorker({
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async () => new Response(`{"url":"${"x".repeat(9000)}"}`, {
        headers: { "content-type": "application/json" },
      }),
    }),
    (error: unknown) => error instanceof StripeCustomerPortalApiError && error.kind === "invalid_response",
  );
});

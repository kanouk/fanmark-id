import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStripeExtensionCheckoutUrl,
  createStripeExtensionCheckoutThroughWorker,
  getStripeExtensionCheckoutBackend,
  StripeExtensionCheckoutApiError,
} from "./stripe-extension-checkout-api.ts";

const licenseId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("checkout backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getStripeExtensionCheckoutBackend(undefined), "supabase");
  assert.equal(getStripeExtensionCheckoutBackend(" worker "), "worker");
  assert.throws(() => getStripeExtensionCheckoutBackend("cloudflare"), StripeExtensionCheckoutApiError);
});

test("checkout URL replaces only the path on a validated API origin", () => {
  assert.equal(
    buildStripeExtensionCheckoutUrl("https://app.example/").href,
    "https://app.example/api/billing/extension-checkout",
  );
  assert.throws(() => buildStripeExtensionCheckoutUrl("https://user:pass@app.example"), StripeExtensionCheckoutApiError);
});

test("Worker checkout sends same-origin credentials and validates the HTTPS Checkout URL", async () => {
  let request: Request | URL | null = null;
  let init: RequestInit | undefined;
  const result = await createStripeExtensionCheckoutThroughWorker(
    { licenseId: licenseId.toUpperCase(), months: 3, requestId },
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
  assert.equal(request instanceof URL ? request.href : request, "https://app.example/api/billing/extension-checkout");
  assert.equal(init?.method, "POST");
  assert.equal(init?.credentials, "include");
  assert.equal(init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    license_id: licenseId,
    months: 3,
    request_id: requestId,
  });
});

test("Worker checkout does not cross the Better Auth origin or accept unsafe URLs", async () => {
  let calls = 0;
  await assert.rejects(
    () => createStripeExtensionCheckoutThroughWorker(
      { licenseId, months: 3, requestId },
      {
        baseUrl: "https://api.other.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => { calls += 1; return jsonResponse({ url: "https://checkout.stripe.com/" }); },
      },
    ),
    (error: unknown) => error instanceof StripeExtensionCheckoutApiError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => createStripeExtensionCheckoutThroughWorker(
      { licenseId, months: 3, requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ url: "javascript:alert(1)" }),
      },
    ),
    (error: unknown) => error instanceof StripeExtensionCheckoutApiError && error.kind === "invalid_response",
  );
});

test("Worker checkout preserves structured HTTP errors and rejects malformed success bodies", async () => {
  await assert.rejects(
    () => createStripeExtensionCheckoutThroughWorker(
      { licenseId, months: 3, requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ error: "license_not_eligible" }, 403),
      },
    ),
    (error: unknown) => error instanceof StripeExtensionCheckoutApiError &&
      error.kind === "http" && error.status === 403 && error.code === "license_not_eligible",
  );
  await assert.rejects(
    () => createStripeExtensionCheckoutThroughWorker(
      { licenseId, months: 3, requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ url: "https://checkout.stripe.com/", extra: true }),
      },
    ),
    (error: unknown) => error instanceof StripeExtensionCheckoutApiError && error.kind === "invalid_response",
  );
});

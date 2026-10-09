import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyExtensionCouponThroughWorker,
  buildExtensionCouponApplyUrl,
  clearExtensionCouponRequestId,
  ExtensionCouponApiError,
  getExtensionCouponBackend,
  getOrCreateExtensionCouponRequestId,
  type ExtensionCouponRequestStorage,
} from "./extension-coupon-api.ts";

const licenseId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function successBody() {
  return {
    success: true,
    license: {
      id: licenseId,
      license_end: "2026-12-01T00:00:00.000Z",
      grace_expires_at: null,
      status: "active",
    },
    months: 2,
    tier_level: 2,
    cancelled_lottery_entries: 1,
  };
}

function memoryStorage(): ExtensionCouponRequestStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test("coupon backend defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getExtensionCouponBackend(undefined), "supabase");
  assert.equal(getExtensionCouponBackend(" worker "), "worker");
  assert.throws(() => getExtensionCouponBackend("cloudflare"), ExtensionCouponApiError);
});

test("Worker URL is same-origin path replacement", () => {
  assert.equal(buildExtensionCouponApplyUrl("https://app.example/").href,
    "https://app.example/api/me/licenses/extend-with-coupon");
  assert.throws(() => buildExtensionCouponApplyUrl("https://user:pass@app.example"), ExtensionCouponApiError);
});

test("coupon request ID stays stable across retries without storing the coupon code", async () => {
  const storage = memoryStorage();
  const first = await getOrCreateExtensionCouponRequestId(licenseId, " gift-2026 ", {
    storage,
    createId: () => requestId,
  });
  const replay = await getOrCreateExtensionCouponRequestId(licenseId, "GIFT-2026", {
    storage,
    createId: () => "00000000-0000-4000-8000-000000000003",
  });
  assert.equal(first, requestId);
  assert.equal(replay, requestId);
  assert.equal([...storage.values.keys()].some((key) => key.includes("GIFT-2026")), false);
  await clearExtensionCouponRequestId(licenseId, "gift-2026", storage);
  assert.equal(storage.values.size, 0);
});

test("Worker request sends only the owner command and validates the success DTO", async () => {
  let request: Request | URL | null = null;
  let init: RequestInit | undefined;
  const result = await applyExtensionCouponThroughWorker(
    { licenseId: licenseId.toUpperCase(), couponCode: " gift-2026 ", requestId },
    {
      baseUrl: "https://app.example",
      authBaseUrl: "https://app.example",
      fetchImpl: async (input, options) => {
        request = input;
        init = options;
        return jsonResponse(successBody());
      },
    },
  );
  assert.deepEqual(result, successBody());
  assert.equal(request instanceof URL ? request.href : request, "https://app.example/api/me/licenses/extend-with-coupon");
  assert.equal(init?.method, "POST");
  assert.equal(init?.credentials, "include");
  assert.equal(init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    license_id: licenseId,
    coupon_code: "GIFT-2026",
    request_id: requestId,
  });
});

test("Worker call never crosses the auth origin and preserves business error codes", async () => {
  let calls = 0;
  await assert.rejects(
    () => applyExtensionCouponThroughWorker(
      { licenseId, couponCode: "GIFT-2026", requestId },
      {
        baseUrl: "https://api.other.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => { calls += 1; return jsonResponse(successBody()); },
      },
    ),
    (error: unknown) => error instanceof ExtensionCouponApiError && error.kind === "configuration",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => applyExtensionCouponThroughWorker(
      { licenseId, couponCode: "GIFT-2026", requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({ error: "coupon_usage_exceeded" }, 400),
      },
    ),
    (error: unknown) => error instanceof ExtensionCouponApiError &&
      error.kind === "http" && error.status === 400 && error.code === "coupon_usage_exceeded",
  );
});

test("Worker success validation rejects malformed license targets", async () => {
  await assert.rejects(
    () => applyExtensionCouponThroughWorker(
      { licenseId, couponCode: "GIFT-2026", requestId },
      {
        baseUrl: "https://app.example",
        authBaseUrl: "https://app.example",
        fetchImpl: async () => jsonResponse({
          ...successBody(),
          license: { ...successBody().license, id: "00000000-0000-4000-8000-000000000099" },
        }),
      },
    ),
    (error: unknown) => error instanceof ExtensionCouponApiError && error.kind === "invalid_response",
  );
});

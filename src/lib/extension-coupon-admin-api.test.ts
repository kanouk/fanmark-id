import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createExtensionCouponThroughWorker,
  deleteExtensionCouponThroughWorker,
  ExtensionCouponAdminClientError,
  getExtensionCouponAdminBackend,
  listExtensionCouponUsagesThroughWorker,
  listExtensionCouponsThroughWorker,
  updateExtensionCouponThroughWorker,
} from "./extension-coupon-admin-api.ts";

const couponId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const fanmarkId = "00000000-0000-4000-8000-000000000003";
const licenseId = "00000000-0000-4000-8000-000000000004";
const updatedAt = "2026-09-26T12:00:00.000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function coupon() {
  return {
    id: couponId,
    code: "EXTABC234",
    months: 3,
    allowed_tier_levels: [1, 2],
    max_uses: 10,
    used_count: 1,
    expires_at: null,
    is_active: true,
    created_by: userId,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

test("coupon admin backend defaults to Supabase and rejects unknown values", () => {
  assert.equal(getExtensionCouponAdminBackend(undefined), "supabase");
  assert.equal(getExtensionCouponAdminBackend("worker"), "worker");
  assert.throws(() => getExtensionCouponAdminBackend("cloudflare"), ExtensionCouponAdminClientError);
});

test("lists and creates D1 coupon master rows through the authenticated same-origin API", async () => {
  let listRequest: Request | URL | null = null;
  const listed = await listExtensionCouponsThroughWorker({
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async (input, init) => {
      listRequest = input;
      assert.equal(init?.credentials, "include");
      assert.equal(init?.cache, "no-store");
      return response({ schemaVersion: 1, coupons: [coupon()] });
    },
  });
  assert.deepEqual(listed, [coupon()]);
  assert.equal(listRequest instanceof URL ? listRequest.pathname : "", "/api/admin/extension-coupons");

  let createBody: unknown;
  const created = await createExtensionCouponThroughWorker({
    code: null,
    months: 2,
    allowedTierLevels: null,
    maxUses: 5,
    expiresAt: null,
  }, {
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async (_input, init) => {
      createBody = JSON.parse(String(init?.body));
      return response({ schemaVersion: 1, coupon: coupon() }, 201);
    },
  });
  assert.equal(created.id, couponId);
  assert.deepEqual(createBody, {
    code: null,
    months: 2,
    allowed_tier_levels: null,
    max_uses: 5,
    expires_at: null,
  });
});

test("uses optimistic updates, safe deletion, and the admin usage DTO", async () => {
  let patch: unknown;
  const updated = await updateExtensionCouponThroughWorker(couponId, {
    isActive: false,
    expectedUpdatedAt: updatedAt,
  }, {
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async (_input, init) => {
      patch = JSON.parse(String(init?.body));
      return response({ schemaVersion: 1, coupon: { ...coupon(), is_active: false } });
    },
  });
  assert.equal(updated.is_active, false);
  assert.deepEqual(patch, { is_active: false, expected_updated_at: updatedAt });

  let deleteMethod: string | undefined;
  await deleteExtensionCouponThroughWorker(couponId, {
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async (_input, init) => {
      deleteMethod = init?.method;
      return response({ schemaVersion: 1, deleted: true });
    },
  });
  assert.equal(deleteMethod, "DELETE");

  const usages = await listExtensionCouponUsagesThroughWorker(couponId, {
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async () => response({ schemaVersion: 1, usages: [{
      id: "00000000-0000-4000-8000-000000000005",
      coupon_id: couponId,
      user_id: userId,
      fanmark_id: fanmarkId,
      license_id: licenseId,
      used_at: updatedAt,
      fanmark_emoji: "🧪",
      user_display_name: "Synthetic User",
    }] }),
  });
  assert.equal(usages[0].fanmark_emoji, "🧪");
});

test("does not cross the Better Auth origin and preserves server error codes", async () => {
  let calls = 0;
  await assert.rejects(() => listExtensionCouponsThroughWorker({
    baseUrl: "https://api.other.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async () => { calls += 1; return response({ schemaVersion: 1, coupons: [] }); },
  }), (error: unknown) => error instanceof ExtensionCouponAdminClientError && error.kind === "configuration");
  assert.equal(calls, 0);
  await assert.rejects(() => deleteExtensionCouponThroughWorker(couponId, {
    baseUrl: "https://app.example",
    authBaseUrl: "https://app.example",
    fetchImpl: async () => response({ error: "coupon_in_use" }, 409),
  }), (error: unknown) => error instanceof ExtensionCouponAdminClientError &&
    error.kind === "http" && error.status === 409 && error.code === "coupon_in_use");
});

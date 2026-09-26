import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminUserManagementApiError,
  createAdminUserManagementApi,
  getAdminUserManagementBackend,
} from "./admin-user-management-api.ts";

const userId = "41111111-1111-4111-8111-111111111111";
const licenseId = "51111111-1111-4111-8111-111111111111";
const fanmarkId = "61111111-1111-4111-8111-111111111111";
const time = "2026-09-26T12:00:00.000Z";

function listPayload() {
  return {
    data: [{
      userId, email: "alpha@example.test", emailConfirmedAt: null, emailVerified: true,
      createdAt: time, lastSignInAt: time, status: "active", bannedUntil: null,
      displayName: "Alpha", username: "alpha", planType: "free", preferredLanguage: "ja",
      profileUpdatedAt: time, licenseCounts: { active: 1, grace: 0, expired: 0 }, enterpriseSettings: null,
    }],
    pagination: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
    filters: { search: null, plans: null, status: null },
    meta: { totalMatchedBeforeStatus: 1 },
  };
}

test("keeps Supabase as the default and rejects unknown backend selectors", () => {
  assert.equal(getAdminUserManagementBackend(undefined), "supabase");
  assert.equal(getAdminUserManagementBackend("worker"), "worker");
  assert.throws(() => getAdminUserManagementBackend("fallback"), AdminUserManagementApiError);
});

test("posts list filters with credentialed no-store requests and validates the projection", async () => {
  let seenRequest: Request | undefined;
  const api = createAdminUserManagementApi({
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      seenRequest = new Request(input, init);
      return Response.json(listPayload(), { headers: { "cache-control": "no-store" } });
    },
  });
  const result = await api.list({ search: "alpha", plans: ["free"], page: 1, pageSize: 20 });
  assert.equal(result.data[0].emailVerified, true);
  assert.equal(seenRequest?.method, "POST");
  assert.equal(seenRequest?.credentials, "include");
  assert.equal(seenRequest?.cache, "no-store");
  assert.deepEqual(await seenRequest?.json(), { search: "alpha", plans: ["free"], page: 1, pageSize: 20 });
});

test("loads one user detail and rejects cross-origin auth or malformed worker payloads", async () => {
  const detail = {
    auth: { email: "alpha@example.test", emailConfirmedAt: null, emailVerified: true, createdAt: time, lastSignInAt: time, phone: null, status: "active", bannedUntil: null, factors: [] },
    profile: { userId, username: "alpha", displayName: null, avatarUrl: null, planType: "free", preferredLanguage: "ja", createdAt: time, updatedAt: time },
    enterpriseSettings: null,
    licenseSummary: { active: 1, grace: 0, expired: 0, total: 1 },
    recentFanmarks: [{ licenseId, status: "active", licenseEnd: time, graceExpiresAt: null, planExcluded: false, excludedAt: null, excludedFromPlan: null, fanmarkId, emoji: "🍋", fanmarkName: null, accessType: "profile" }],
    recentAuditLogs: [],
  };
  let seenUrl = "";
  const api = createAdminUserManagementApi({
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input) => {
      seenUrl = String(input);
      return Response.json(detail);
    },
  });
  const result = await api.detail(userId);
  assert.equal(result.profile.userId, userId);
  assert.equal(seenUrl, `https://app.example.test/api/admin/users/${userId}`);

  await assert.rejects(
    createAdminUserManagementApi({ baseUrl: "https://api.example.test", authBaseUrl: "https://app.example.test" }).list({ page: 1, pageSize: 20 }),
    (error: unknown) => error instanceof AdminUserManagementApiError && error.kind === "configuration",
  );
  await assert.rejects(
    createAdminUserManagementApi({
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async () => Response.json({ ...listPayload(), data: [{ ...listPayload().data[0], emailVerified: "yes" }] }),
    }).list({ page: 1, pageSize: 20 }),
    (error: unknown) => error instanceof AdminUserManagementApiError && error.kind === "invalid_response",
  );
});

test("updates plans through a credentialed same-origin Worker request and validates the result", async () => {
  let seenRequest: Request | undefined;
  const api = createAdminUserManagementApi({
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      seenRequest = new Request(input, init);
      return Response.json({
        success: true,
        previousPlanType: "free",
        newPlanType: "enterprise",
        enterpriseSettings: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic" },
        updatedAt: time,
      }, { headers: { "cache-control": "no-store" } });
    },
  });
  const result = await api.updatePlan({
    userId,
    newPlanType: "enterprise",
    enterpriseOverrides: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic" },
    reason: "synthetic verification",
  });
  assert.equal(result.newPlanType, "enterprise");
  assert.equal(seenRequest?.url, `https://app.example.test/api/admin/users/${userId}/plan`);
  assert.equal(seenRequest?.credentials, "include");
  assert.equal(seenRequest?.cache, "no-store");
  assert.deepEqual(await seenRequest?.json(), {
    userId,
    newPlanType: "enterprise",
    enterpriseOverrides: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic" },
    reason: "synthetic verification",
  });

  await assert.rejects(
    createAdminUserManagementApi({
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async () => Response.json({ success: true, previousPlanType: "free", newPlanType: "enterprise", enterpriseSettings: { customFanmarksLimit: -1, customPricing: null, notes: null }, updatedAt: time }),
    }).updatePlan({ userId, newPlanType: "enterprise" }),
    (error: unknown) => error instanceof AdminUserManagementApiError && error.kind === "invalid_response",
  );
});

test("updates account status through the credentialed Worker API and rejects invalid status DTOs", async () => {
  let seenRequest: Request | undefined;
  const api = createAdminUserManagementApi({
    baseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetchImpl: async (input, init) => {
      seenRequest = new Request(input, init);
      return Response.json({
        success: true,
        updated: true,
        userId,
        status: "suspended",
        bannedUntil: "2031-09-26T12:00:00.000Z",
        updatedAt: time,
      }, { headers: { "cache-control": "no-store" } });
    },
  });
  const result = await api.updateStatus({ userId, suspend: true, reason: "synthetic review" });
  assert.equal(result.status, "suspended");
  assert.equal(seenRequest?.url, `https://app.example.test/api/admin/users/${userId}/status`);
  assert.equal(seenRequest?.credentials, "include");
  assert.equal(seenRequest?.cache, "no-store");
  assert.deepEqual(await seenRequest?.json(), { userId, suspend: true, reason: "synthetic review" });

  await assert.rejects(
    createAdminUserManagementApi({
      baseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetchImpl: async () => Response.json({
        success: true, updated: true, userId, status: "active",
        bannedUntil: "2031-09-26T12:00:00.000Z", updatedAt: time,
      }),
    }).updateStatus({ userId, suspend: false }),
    (error: unknown) => error instanceof AdminUserManagementApiError && error.kind === "invalid_response",
  );
});

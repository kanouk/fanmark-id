import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-admin-user-management.sql?raw";
import {
  handleAdminUserManagementRequest,
  type AdminUserManagementAuthorizer,
} from "../src/admin-user-management-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB;
const auth = runtimeEnv.AUTH_DB;
const baseUrl = "https://api.example.test";
const origin = "https://app.example.test";
const now = new Date("2026-09-26T12:34:56.000Z");
const userA = "41111111-1111-4111-8111-111111111111";
const userB = "42222222-2222-4222-8222-222222222222";
const licenseA1 = "51111111-1111-4111-8111-111111111111";
const licenseA2 = "52222222-2222-4222-8222-222222222222";
const licenseA3 = "53333333-3333-4333-8333-333333333333";
const fanmarkA1 = "61111111-1111-4111-8111-111111111111";
const fanmarkA2 = "62222222-2222-4222-8222-222222222222";
const auditId = "71111111-1111-4111-8111-111111111111";
const time = "2026-09-25T12:00:00.000Z";
const allowAdmin: AdminUserManagementAuthorizer = async () => ({
  userId: "49999999-9999-4999-8999-999999999999",
  sessionId: "admin-session",
});
const denyAdmin: AdminUserManagementAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!business || !auth) throw new Error("Split D1 bindings are unavailable");
  await business.batch(splitSql(schemaSql.slice(0, schemaSql.indexOf('CREATE TABLE "user"'))).map((sql) => business.prepare(sql)));
  await auth.batch(splitSql(schemaSql.slice(schemaSql.indexOf('CREATE TABLE "user"'))).map((sql) => auth.prepare(sql)));
}

async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  authorize = allowAdmin,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", origin);
  const response = await handleAdminUserManagementRequest(
    new Request(`${baseUrl}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    { now: () => now },
  );
  if (!response) throw new Error("Admin user management route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!business || !auth) throw new Error("Split D1 bindings are unavailable");
  await business.batch([
    business.prepare("DELETE FROM notification_events"),
    business.prepare("DELETE FROM audit_logs"),
    business.prepare("DELETE FROM fanmark_password_configs"),
    business.prepare("DELETE FROM fanmark_messageboard_configs"),
    business.prepare("DELETE FROM fanmark_redirect_configs"),
    business.prepare("DELETE FROM fanmark_basic_configs"),
    business.prepare("DELETE FROM fanmark_licenses"),
    business.prepare("DELETE FROM fanmarks"),
    business.prepare("DELETE FROM enterprise_user_settings"),
    business.prepare("DELETE FROM user_settings"),
  ]);
  await auth.batch([auth.prepare('DELETE FROM "twoFactor"'), auth.prepare('DELETE FROM "session"'), auth.prepare('DELETE FROM "user"')]);
  await auth.prepare('DELETE FROM "adminUserStatusAudit"').run();

  await business.batch([
    business.prepare(`INSERT INTO user_settings
      (user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at)
      VALUES (?, 'user-one', 'First User', 'https://images.example.test/avatar.png', 'free', 'ja', ?, ?)`)
      .bind(userA, time, time),
    business.prepare(`INSERT INTO user_settings
      (user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at)
      VALUES (?, 'user-two', 'Second User', NULL, 'creator', 'en', ?, ?)`)
      .bind(userB, time, time),
    business.prepare(`INSERT INTO enterprise_user_settings
      (user_id, custom_fanmarks_limit, custom_pricing, notes, created_at, updated_at, created_by)
      VALUES (?, 99, 1200, 'synthetic note', ?, ?, ?)`)
      .bind(userA, time, time, "49999999-9999-4999-8999-999999999999"),
    business.prepare(`INSERT INTO fanmarks (id, user_input_fanmark, status, tier_level) VALUES (?, '🍋', 'active', 1), (?, '🌸', 'active', 2)`)
      .bind(fanmarkA1, fanmarkA2),
    business.prepare(`INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, status, license_end, grace_expires_at, plan_excluded, updated_at, display_fanmark)
      VALUES (?, ?, ?, 'active', ?, NULL, 0, ?, '🍋'), (?, ?, ?, 'grace', ?, ?, 1, ?, '🌸'), (?, ?, ?, 'expired', ?, NULL, 0, ?, '🍋')`)
      .bind(licenseA1, fanmarkA1, userA, "2026-10-01T00:00:00.000Z", time,
        licenseA2, fanmarkA2, userA, "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", time,
        licenseA3, fanmarkA1, userA, "2026-07-01T00:00:00.000Z", time),
    business.prepare("INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type) VALUES (?, 'Citrus', 'profile'), (?, 'Flower', 'redirect')")
      .bind(licenseA1, licenseA2),
    business.prepare("INSERT INTO fanmark_redirect_configs (license_id, target_url) VALUES (?, 'https://example.test/'), (?, 'https://example.test/flower')")
      .bind(licenseA1, licenseA2),
    business.prepare("INSERT INTO fanmark_messageboard_configs (license_id, content) VALUES (?, 'synthetic board'), (?, 'synthetic flower')")
      .bind(licenseA1, licenseA2),
    business.prepare("INSERT INTO fanmark_password_configs (license_id, password_hash) VALUES (?, 'hash-placeholder'), (?, 'hash-placeholder')")
      .bind(licenseA1, licenseA2),
    business.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, 'TEST_ACTION', 'user', ?, ?, ?)`)
      .bind(auditId, userA, userA, JSON.stringify({ safe: "visible", email: "secret@example.test", authToken: "hidden", nested: { phone: "hidden", count: 3 } }), time),
  ]);
  await auth.batch([
    auth.prepare(`INSERT INTO "user" (id, name, email, emailVerified, twoFactorEnabled, createdAt, updatedAt)
      VALUES (?, 'First User', 'alpha@example.test', 1, 1, ?, ?), (?, 'Second User', 'beta@example.test', 0, 0, ?, ?)`)
      .bind(userA, time, time, userB, time, time),
    auth.prepare(`INSERT INTO "session" (id, userId, createdAt) VALUES ('session-old', ?, '2026-09-20T00:00:00.000Z'), ('session-new', ?, '2026-09-26T00:00:00.000Z')`)
      .bind(userA, userA),
    auth.prepare(`INSERT INTO "twoFactor" (id, userId, verified) VALUES ('factor-one', ?, 1)`)
      .bind(userA),
  ]);
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("D1 administrator user directory", () => {
  it("filters and paginates joined Auth and business projections without inventing confirmation timestamps", async () => {
    const response = await request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ search: "alpha@example.test", plans: ["free"], page: 1, pageSize: 10 }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as {
      data: Array<Record<string, unknown>>;
      pagination: Record<string, number>;
      filters: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({
      userId: userA,
      email: "alpha@example.test",
      emailConfirmedAt: null,
      emailVerified: true,
      lastSignInAt: "2026-09-26T00:00:00.000Z",
      displayName: "First User",
      planType: "free",
      licenseCounts: { active: 1, grace: 1, expired: 1 },
      enterpriseSettings: { custom_fanmarks_limit: 99, custom_pricing: 1200, notes: "synthetic note" },
    });
    expect(payload.pagination).toMatchObject({ page: 1, pageSize: 10, totalCount: 1, totalPages: 1 });
    expect(payload.meta.totalMatchedBeforeStatus).toBe(0);
  });

  it("matches email substrings literally without LIKE-pattern limits", async () => {
    const wildcardLikeSearch = await request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ search: "alpha%", page: 1, pageSize: 10 }),
    });
    expect(wildcardLikeSearch.status).toBe(200);
    expect((await wildcardLikeSearch.json() as { data: unknown[] }).data).toHaveLength(0);

    const longSearch = await request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ search: "x".repeat(180), page: 1, pageSize: 10 }),
    });
    expect(longSearch.status).toBe(200);
    expect((await longSearch.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it("updates the plan, Enterprise settings, and audit record in one D1 batch", async () => {
    const enterprise = await request(`/api/admin/users/${userA}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: userA,
        newPlanType: "enterprise",
        enterpriseOverrides: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic plan test" },
        reason: "synthetic verification",
      }),
    });
    expect(enterprise.status).toBe(200);
    expect(await enterprise.json()).toMatchObject({
      success: true,
      previousPlanType: "free",
      newPlanType: "enterprise",
      enterpriseSettings: { customFanmarksLimit: 250, customPricing: 55000, notes: "synthetic plan test" },
      updatedAt: now.toISOString(),
    });
    const enterpriseProfile = await business!.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?")
      .bind(userA).first<{ plan_type: string }>();
    const enterpriseSettings = await business!.prepare(`SELECT custom_fanmarks_limit, custom_pricing, notes
      FROM enterprise_user_settings WHERE user_id = ?`).bind(userA).first<Record<string, unknown>>();
    expect(enterpriseProfile?.plan_type).toBe("enterprise");
    expect(enterpriseSettings).toEqual({ custom_fanmarks_limit: 250, custom_pricing: 55000, notes: "synthetic plan test" });

    const maxPlan = await request(`/api/admin/users/${userA}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, newPlanType: "max" }),
    });
    expect(maxPlan.status).toBe(200);
    expect(await maxPlan.json()).toMatchObject({ previousPlanType: "enterprise", newPlanType: "max", enterpriseSettings: null });
    const remainingSettings = await business!.prepare("SELECT user_id FROM enterprise_user_settings WHERE user_id = ?")
      .bind(userA).first();
    expect(remainingSettings).toBeNull();
    const audit = await business!.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'ADMIN_UPDATE_PLAN'
      AND user_id = ? AND resource_id = ?`).bind("49999999-9999-4999-8999-999999999999", userA)
      .first<{ count: number }>();
    expect(audit?.count).toBe(2);
  });

  it("suspends and restores an account atomically with session revocation and Auth audit", async () => {
    const route = `/api/admin/users/${userA}/status`;
    const suspended = await request(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, suspend: true, reason: "synthetic review" }),
    });
    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toMatchObject({
      success: true,
      updated: true,
      userId: userA,
      status: "suspended",
      bannedUntil: "2031-09-26T12:34:56.000Z",
    });
    expect(await auth!.prepare('SELECT "banned", "banReason", "banExpires" FROM "user" WHERE id = ?')
      .bind(userA).first()).toEqual({ banned: 1, banReason: "synthetic review", banExpires: "2031-09-26T12:34:56.000Z" });
    expect(await auth!.prepare('SELECT id FROM "session" WHERE "userId" = ?').bind(userA).all()).toMatchObject({ results: [] });
    expect(await auth!.prepare('SELECT "actorUserId", "targetUserId", "action", "reason" FROM "adminUserStatusAudit" WHERE "targetUserId" = ?')
      .bind(userA).first()).toEqual({ actorUserId: "49999999-9999-4999-8999-999999999999", targetUserId: userA, action: "ADMIN_SUSPEND_USER", reason: "synthetic review" });

    const suspendedList = await request("/api/admin/users", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "suspended", page: 1, pageSize: 10 }),
    });
    expect((await suspendedList.json() as { data: Array<{ userId: string }> }).data.map((row) => row.userId)).toEqual([userA]);

    const restored = await request(route, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, suspend: false, reason: "review complete" }),
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ success: true, updated: true, status: "active", bannedUntil: null });
    expect(await auth!.prepare('SELECT "banned", "banReason", "banExpires" FROM "user" WHERE id = ?')
      .bind(userA).first()).toEqual({ banned: 0, banReason: null, banExpires: null });
    expect(await auth!.prepare('SELECT COUNT(*) AS count FROM "adminUserStatusAudit" WHERE "targetUserId" = ?')
      .bind(userA).first()).toEqual({ count: 2 });

    const detail = await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userA }),
    });
    expect((await detail.json() as { recentAuditLogs: Array<{ action: string }> }).recentAuditLogs.map((row) => row.action))
      .toContain("ADMIN_SUSPEND_USER");
  });

  it("rolls back suspension and session revocation if the Auth audit insert fails", async () => {
    await auth!.prepare(`CREATE TRIGGER reject_admin_user_status_audit BEFORE INSERT ON "adminUserStatusAudit"
      BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`).run();
    try {
      const response = await request(`/api/admin/users/${userA}/status`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userA, suspend: true, reason: "synthetic failure" }),
      });
      expect(response.status).toBe(503);
      expect(await auth!.prepare('SELECT "banned" FROM "user" WHERE id = ?').bind(userA).first())
        .toEqual({ banned: 0 });
      expect(Number((await auth!.prepare('SELECT COUNT(*) AS count FROM "session" WHERE "userId" = ?')
        .bind(userA).first<{ count: number }>())?.count)).toBe(2);
      expect(await auth!.prepare('SELECT id FROM "adminUserStatusAudit" WHERE "targetUserId" = ?').bind(userA).first())
        .toBeNull();
    } finally {
      await auth!.prepare('DROP TRIGGER reject_admin_user_status_audit').run();
    }
  });

  it("rejects self-suspension and malformed status transitions", async () => {
    const self = await request(`/api/admin/users/49999999-9999-4999-8999-999999999999/status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "49999999-9999-4999-8999-999999999999", suspend: true }),
    });
    expect(self.status).toBe(400);
    const invalidDate = await request(`/api/admin/users/${userA}/status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, suspend: true, bannedUntil: "not-a-date" }),
    });
    expect(invalidDate.status).toBe(400);
    const futureRestore = await request(`/api/admin/users/${userA}/status`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, suspend: false, bannedUntil: "2030-01-01T00:00:00.000Z" }),
    });
    expect(futureRestore.status).toBe(400);
  });

  it("expires only the target user's license and atomically removes configs, audits, and queues notification", async () => {
    const route = `/api/admin/users/${userA}/licenses/${licenseA1}/expire`;
    const anonymous = await request(route, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, licenseId: licenseA1 }),
    }, {}, denyAdmin);
    expect(anonymous.status).toBe(403);

    const mismatched = await request(`/api/admin/users/${userB}/licenses/${licenseA1}/expire`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userB, licenseId: licenseA1 }),
    });
    expect(mismatched.status).toBe(404);

    const response = await request(route, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, licenseId: licenseA1, reason: "synthetic immediate expiry" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, licenseId: licenseA1, alreadyExpired: false, updatedAt: now.toISOString(),
    });
    expect(await business!.prepare(`SELECT status, license_end, grace_expires_at, excluded_at, updated_at
      FROM fanmark_licenses WHERE id = ?`).bind(licenseA1).first()).toEqual({
      status: "expired", license_end: now.toISOString(), grace_expires_at: now.toISOString(),
      excluded_at: now.toISOString(), updated_at: now.toISOString(),
    });
    for (const table of ["fanmark_basic_configs", "fanmark_redirect_configs", "fanmark_messageboard_configs", "fanmark_password_configs"]) {
      const remaining = await business!.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE license_id = ?`)
        .bind(licenseA1).first<{ count: number }>();
      expect(remaining?.count, `${table} remained after expiration`).toBe(0);
    }
    const lifecycleAudit = await business!.prepare(`SELECT user_id, action, resource_type, resource_id, metadata
      FROM audit_logs WHERE action = 'license_expired' AND resource_id = ?`).bind(licenseA1).first<Record<string, unknown>>();
    expect(lifecycleAudit).toMatchObject({ user_id: userA, action: "license_expired", resource_type: "fanmark_license", resource_id: licenseA1 });
    expect(JSON.parse(String(lifecycleAudit?.metadata))).toMatchObject({
      admin_user_id: "49999999-9999-4999-8999-999999999999", reason: "synthetic immediate expiry",
      expired_at: now.toISOString(), license_end: "2026-10-01T00:00:00.000Z",
    });
    const adminAudit = await business!.prepare(`SELECT user_id, action, resource_type, resource_id, metadata
      FROM audit_logs WHERE action = 'admin_expire_license' AND resource_id = ?`).bind(licenseA1).first<Record<string, unknown>>();
    expect(adminAudit).toMatchObject({ user_id: "49999999-9999-4999-8999-999999999999", resource_id: licenseA1 });
    const event = await business!.prepare(`SELECT event_type, source, payload_schema, trigger_at, payload
      FROM notification_events WHERE event_type = 'license_expired'`).first<Record<string, unknown>>();
    expect(event).toMatchObject({ event_type: "license_expired", source: "admin_ui", payload_schema: "license_expired.v1", trigger_at: now.toISOString() });
    expect(JSON.parse(String(event?.payload))).toEqual({
      user_id: userA, fanmark_id: fanmarkA1, fanmark_name: "🍋", expired_at: now.toISOString(),
      license_end: "2026-10-01T00:00:00.000Z",
    });

    const repeated = await request(route, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, licenseId: licenseA1, reason: "repeat" }),
    });
    expect(await repeated.json()).toEqual({ success: true, licenseId: licenseA1, alreadyExpired: true, updatedAt: now.toISOString() });
    expect(Number((await business!.prepare("SELECT COUNT(*) AS count FROM notification_events").first<{ count: number }>())?.count)).toBe(1);
    expect(Number((await business!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE resource_id = ? AND action IN ('license_expired', 'admin_expire_license')")
      .bind(licenseA1).first<{ count: number }>())?.count)).toBe(2);
  });

  it("rolls immediate license expiration back when a config deletion fails", async () => {
    await business!.prepare(`CREATE TRIGGER reject_password_config_expiry BEFORE DELETE ON fanmark_password_configs
      BEGIN SELECT RAISE(ABORT, 'synthetic config cleanup failure'); END`).run();
    try {
      const response = await request(`/api/admin/users/${userA}/licenses/${licenseA1}/expire`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userA, licenseId: licenseA1, reason: "synthetic rollback" }),
      });
      expect(response.status).toBe(503);
      expect(await business!.prepare("SELECT status, license_end FROM fanmark_licenses WHERE id = ?")
        .bind(licenseA1).first()).toEqual({ status: "active", license_end: "2026-10-01T00:00:00.000Z" });
      for (const table of ["fanmark_basic_configs", "fanmark_redirect_configs", "fanmark_messageboard_configs", "fanmark_password_configs"]) {
        const remaining = await business!.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE license_id = ?`)
          .bind(licenseA1).first<{ count: number }>();
        expect(remaining?.count, `${table} was partially deleted`).toBe(1);
      }
      expect(await business!.prepare("SELECT id FROM notification_events").first()).toBeNull();
      expect(await business!.prepare("SELECT id FROM audit_logs WHERE resource_id = ? AND action IN ('license_expired', 'admin_expire_license')")
        .bind(licenseA1).first()).toBeNull();
    } finally {
      await business!.prepare("DROP TRIGGER reject_password_config_expiry").run();
    }
  });

  it("rejects invalid plan changes and rolls back when the audit effect fails", async () => {
    const denied = await request(`/api/admin/users/${userA}/plan`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, newPlanType: "enterprise" }),
    }, {}, denyAdmin);
    expect(denied.status).toBe(403);

    const invalid = await request(`/api/admin/users/${userA}/plan`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: userA, newPlanType: "enterprise", enterpriseOverrides: { customPricing: -1 } }),
    });
    expect(invalid.status).toBe(400);

    await business!.prepare(`CREATE TRIGGER reject_admin_plan_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'ADMIN_UPDATE_PLAN' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`).run();
    try {
      const failed = await request(`/api/admin/users/${userA}/plan`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userA, newPlanType: "enterprise", enterpriseOverrides: { customFanmarksLimit: 250 } }),
      });
      expect(failed.status).toBe(503);
      const profile = await business!.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?")
        .bind(userA).first<{ plan_type: string }>();
      const enterprise = await business!.prepare("SELECT user_id FROM enterprise_user_settings WHERE user_id = ?")
        .bind(userA).first();
      const enterpriseSettings = await business!.prepare(`SELECT custom_fanmarks_limit, custom_pricing, notes
        FROM enterprise_user_settings WHERE user_id = ?`).bind(userA).first<Record<string, unknown>>();
      const audit = await business!.prepare("SELECT id FROM audit_logs WHERE action = 'ADMIN_UPDATE_PLAN'").first();
      expect(profile?.plan_type).toBe("free");
      expect(enterprise).not.toBeNull();
      expect(enterpriseSettings).toEqual({ custom_fanmarks_limit: 99, custom_pricing: 1200, notes: "synthetic note" });
      expect(audit).toBeNull();
    } finally {
      await business!.prepare("DROP TRIGGER reject_admin_plan_audit").run();
    }
  });

  it("returns recent license, MFA, and redacted audit projections behind the admin authorizer", async () => {
    const denied = await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userA }),
    }, {}, denyAdmin);
    expect(denied.status).toBe(403);

    const response = await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userA }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      auth: Record<string, unknown>;
      profile: Record<string, unknown>;
      licenseSummary: Record<string, unknown>;
      recentFanmarks: Array<Record<string, unknown>>;
      recentAuditLogs: Array<{ metadata: unknown }>;
    };
    expect(payload.auth).toMatchObject({
      email: "alpha@example.test", emailConfirmedAt: null, emailVerified: true,
      lastSignInAt: "2026-09-26T00:00:00.000Z", status: "active", phone: null,
      factors: [{ type: "totp", createdAt: null }],
    });
    expect(payload.profile).toMatchObject({ userId: userA, username: "user-one", planType: "free" });
    expect(payload.licenseSummary).toEqual({ active: 1, grace: 1, expired: 1, total: 3 });
    expect(payload.recentFanmarks).toHaveLength(3);
    expect(payload.recentFanmarks[0]).toMatchObject({ licenseId: licenseA1, fanmarkName: "Citrus", accessType: "profile" });
    expect(payload.recentAuditLogs[0].metadata).toEqual({ safe: "visible", nested: { count: 3 } });
    const audit = await business!.prepare("SELECT action, resource_id FROM audit_logs WHERE action = 'ADMIN_VIEW_USER_DETAIL'").first<Record<string, unknown>>();
    expect(audit).toMatchObject({ action: "ADMIN_VIEW_USER_DETAIL", resource_id: userA });
  });

  it("rejects invalid payloads, paths, origins, methods, and missing backend selection", async () => {
    expect((await request("/api/admin/users", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plans: ["root"] }),
    })).status).toBe(400);
    expect((await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userB }),
    })).status).toBe(400);
    expect((await request("/api/admin/users", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/api/admin/users", { method: "GET" })).status).toBe(405);
    expect((await request("/api/admin/users", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    }, { ADMIN_USER_MANAGEMENT_BACKEND: undefined })).status).toBe(503);
  });
});

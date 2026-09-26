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
    business.prepare("DELETE FROM audit_logs"),
    business.prepare("DELETE FROM fanmark_basic_configs"),
    business.prepare("DELETE FROM fanmark_licenses"),
    business.prepare("DELETE FROM fanmarks"),
    business.prepare("DELETE FROM enterprise_user_settings"),
    business.prepare("DELETE FROM user_settings"),
  ]);
  await auth.batch([auth.prepare('DELETE FROM "twoFactor"'), auth.prepare('DELETE FROM "session"'), auth.prepare('DELETE FROM "user"')]);

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
      (user_id, custom_fanmarks_limit, custom_pricing, notes, updated_at) VALUES (?, 99, 1200, 'synthetic note', ?)`)
      .bind(userA, time),
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

  it("returns recent license, MFA, and redacted audit projections behind the admin authorizer", async () => {
    const denied = await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userA }),
    }, {}, denyAdmin);
    expect(denied.status).toBe(403);

    const response = await request(`/api/admin/users/${userA}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: userA }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, any>;
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

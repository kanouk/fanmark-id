import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schemaSql from "./fixtures/d1-waitlist-admin.sql?raw";
import { handleWaitlistAdminRequest, type WaitlistAdminAuthorizer } from "../src/waitlist-admin-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const now = new Date("2026-09-27T12:34:56.000Z");
const adminId = "synthetic-admin";
const rowId = "46111111-1111-4111-8111-111111111111";
const email = "person@example.test";
const createdAt = "2026-09-25T12:00:00.000Z";
const allowAdmin: WaitlistAdminAuthorizer = async () => ({ userId: adminId, sessionId: "synthetic-session" });
const denyAdmin: WaitlistAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
  authorize = allowAdmin,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  const response = await handleWaitlistAdminRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    () => now,
  );
  if (!response) throw new Error("Waitlist admin route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM audit_logs"),
    database.prepare("DELETE FROM waitlist"),
    database.prepare("DELETE FROM user_settings"),
  ]);
  await database.prepare("INSERT INTO user_settings (user_id, plan_type) VALUES (?, 'admin')").bind(adminId).run();
  await database.prepare(`INSERT INTO waitlist (id, email, referral_source, status, created_at)
    VALUES (?, ?, 'synthetic', 'waiting', ?)`).bind(rowId, email, createdAt).run();
}

beforeAll(prepareSchema);
beforeEach(resetRows);
afterEach(() => vi.restoreAllMocks());

describe("D1 waitlist admin API", () => {
  it.each([
    ["/api/admin/waitlist", "UNAUTHORIZED_WAITLIST_ACCESS", null, "HIGH_RISK"],
    [`/api/admin/waitlist/${rowId}/email`, "UNAUTHORIZED_EMAIL_ACCESS", rowId, "CRITICAL_RISK"],
  ])("correlates %s denial diagnostics to a durable source-shaped audit without copying request secrets", async (path, action, resourceId, risk) => {
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    await database!.prepare("UPDATE user_settings SET plan_type = 'free'").run();
    const response = await request(path, { headers: {
      Authorization: "Bearer private-auth-marker", Cookie: "session=private-cookie-marker", "x-forwarded-for": "192.0.2.7",
    } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "super_admin_required" });
    const audit = await database!.prepare("SELECT id, user_id, resource_id, metadata, created_at FROM audit_logs WHERE action = ?")
      .bind(action).first<{ id: string; user_id: string; resource_id: string | null; metadata: string; created_at: string }>();
    expect(audit).toMatchObject({ user_id: adminId, resource_id: resourceId, created_at: "2026-09-27T12:34:56.000000Z" });
    expect(JSON.parse(audit!.metadata)).toMatchObject({ security_level: risk });
    if (resourceId) expect(JSON.parse(audit!.metadata)).toMatchObject({ attempted_resource: "email_address" });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    const alert = JSON.parse(diagnostic.mock.calls[0][0] as string);
    expect(alert).toEqual({ event: "security_alert", action, auditId: audit!.id, createdAt: audit!.created_at });
    for (const forbidden of [adminId, email, rowId, "private-auth-marker", "private-cookie-marker", "192.0.2.7"]) {
      expect(JSON.stringify(alert)).not.toContain(forbidden);
    }
  });

  it("fails closed without emitting a persisted-audit alert when the denied audit write is rejected", async () => {
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    await database!.prepare("UPDATE user_settings SET plan_type = 'free'").run();
    await database!.prepare(`CREATE TRIGGER reject_denied_waitlist_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action IN ('UNAUTHORIZED_WAITLIST_ACCESS', 'UNAUTHORIZED_EMAIL_ACCESS')
      BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`).run();
    try {
      expect((await request(`/api/admin/waitlist/${rowId}/email`)).status).toBe(503);
      expect(diagnostic).not.toHaveBeenCalled();
      expect(await database!.prepare("SELECT count(*) AS count FROM audit_logs").first()).toEqual({ count: 0 });
    } finally {
      await database!.prepare("DROP TRIGGER reject_denied_waitlist_audit").run();
    }
  });

  it("returns hashed addresses only and records the restricted list access", async () => {
    const response = await request("/api/admin/waitlist");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as Record<string, unknown>;
    expect(payload.schemaVersion).toBe(1);
    expect(JSON.stringify(payload)).not.toContain(email);
    expect(payload.entries).toEqual([{
      id: rowId,
      email_hash: "143b53b0840f6e1fcf8537a38513b59a9f326c72f577f17d1da67393eff1d413",
      referral_source: "synthetic",
      status: "waiting",
      created_at: createdAt,
    }]);
    expect(payload.securityLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "AUTHORIZED_WAITLIST_ACCESS", resource_type: "waitlist" }),
      expect.objectContaining({ action: "ADMIN_CHECK", resource_type: "system" }),
    ]));
    const audits = await database!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'AUTHORIZED_WAITLIST_ACCESS'").first<{ count: number }>();
    expect(Number(audits?.count)).toBe(1);
    const auditTimestamp = await database!.prepare(
      "SELECT created_at FROM audit_logs WHERE action = 'AUTHORIZED_WAITLIST_ACCESS'",
    ).first<{ created_at: string }>();
    expect(auditTimestamp?.created_at).toBe("2026-09-27T12:34:56.000000Z");
  });

  it("reveals an address only after the access audit is persisted", async () => {
    const response = await request(`/api/admin/waitlist/${rowId}/email`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      email,
      securityLogs: expect.arrayContaining([expect.objectContaining({ action: "EMAIL_ACCESS", resource_type: "waitlist" })]),
    });
    const audit = await database!.prepare("SELECT user_id, resource_id, metadata FROM audit_logs WHERE action = 'EMAIL_ACCESS' LIMIT 1")
      .first<{ user_id: string; resource_id: string; metadata: string }>();
    expect(audit).toMatchObject({ user_id: adminId, resource_id: rowId });
    expect(JSON.parse(audit!.metadata)).toMatchObject({ purpose: "email_retrieval", security_level: "ADMIN_VERIFIED" });
    expect(audit!.metadata).not.toContain(email);
  });

  it("fails closed if the address access audit cannot be persisted", async () => {
    await database!.prepare(`CREATE TRIGGER reject_waitlist_audit BEFORE INSERT ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`).run();
    try {
      const response = await request(`/api/admin/waitlist/${rowId}/email`);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(email);
    } finally {
      await database!.prepare("DROP TRIGGER IF EXISTS reject_waitlist_audit").run();
    }
  });

  it("requires an admin plan in addition to the current administrator MFA gate", async () => {
    await database!.prepare("UPDATE user_settings SET plan_type = 'free' WHERE user_id = ?").bind(adminId).run();
    const response = await request("/api/admin/waitlist");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "super_admin_required" });
    const logs = await database!.prepare("SELECT action FROM audit_logs ORDER BY action ASC").all<{ action: string }>();
    expect(logs.results?.map((row) => row.action)).toEqual(["ADMIN_CHECK", "UNAUTHORIZED_WAITLIST_ACCESS"]);

    await database!.prepare("DELETE FROM user_settings").run();
    const missingAdminPlan = await request(`/api/admin/waitlist/${rowId}/email`);
    expect(missingAdminPlan.status).toBe(403);
    const deniedEmailAudits = await database!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'UNAUTHORIZED_EMAIL_ACCESS'")
      .first<{ count: number }>();
    expect(Number(deniedEmailAudits?.count)).toBe(1);
  });

  it("rejects a non-MFA administrator before touching D1", async () => {
    const denied = await request("/api/admin/waitlist", {}, {}, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "mfa_required" });
    const audits = await database!.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>();
    expect(Number(audits?.count)).toBe(0);
  });

  it("rejects invalid origins, unsupported methods, invalid IDs, and missing selectors", async () => {
    expect((await request("/api/admin/waitlist", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/api/admin/waitlist", { method: "POST" })).status).toBe(405);
    expect((await request("/api/admin/waitlist/not-a-uuid/email")).status).toBe(404);
    const unavailable = await request("/api/admin/waitlist", {}, { WAITLIST_ADMIN_BACKEND: undefined });
    expect(unavailable.status).toBe(503);
  });
});

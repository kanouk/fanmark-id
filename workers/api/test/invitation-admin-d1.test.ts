import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-invitation-admin.sql?raw";
import { handleInvitationAdminRequest, type InvitationAdminAuthorizer } from "../src/invitation-admin-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const now = new Date("2026-09-26T12:34:56.000Z");
const codeId = "46111111-1111-4111-8111-111111111111";
const initialTime = "2026-09-25T12:00:00.000Z";
const allowAdmin: InvitationAdminAuthorizer = async () => ({ userId: "synthetic-admin", sessionId: "synthetic-session" });
const denyAdmin: InvitationAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function splitSql(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((statement) => statement.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(splitSql(schemaSql).map((statement) => database.prepare(statement)));
}

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}, authorize = allowAdmin): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  const response = await handleInvitationAdminRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
    authorize,
    () => now,
  );
  if (!response) throw new Error("Invitation admin route did not match");
  return response;
}

async function resetRows(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([database.prepare("DELETE FROM user_settings"), database.prepare("DELETE FROM invitation_codes")]);
  await database.prepare(`INSERT INTO invitation_codes
    (id, code, max_uses, used_count, expires_at, special_perks, created_by, is_active, created_at, updated_at)
    VALUES (?, 'WELCOME', 4, 1, NULL, '{"bonus":true}', 'source-user-id', 1, ?, ?)`)
    .bind(codeId, initialTime, initialTime).run();
}

beforeAll(prepareSchema);
beforeEach(resetRows);

describe("D1 invitation code admin API", () => {
  it("lists an explicit admin DTO and requires the administrator MFA gate", async () => {
    const denied = await request("/api/admin/invitation-codes", {}, {}, denyAdmin);
    expect(denied.status).toBe(403);

    const listed = await request("/api/admin/invitation-codes");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(await listed.json()).toEqual({
      schemaVersion: 1,
      codes: [{ id: codeId, code: "WELCOME", max_uses: 4, used_count: 1, expires_at: null, special_perks: { bonus: true },
        is_active: true, created_at: initialTime, updated_at: initialTime }],
    });
  });

  it("creates a code, uppercases explicit codes, and attributes the admin identity", async () => {
    const created = await request("/api/admin/invitation-codes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "friends-2026", max_uses: 2, expires_at: null, special_perks: { tier: "creator" } }),
    });
    expect(created.status).toBe(201);
    const payload = await created.json() as { code: Record<string, unknown> };
    expect(payload.code).toMatchObject({ code: "FRIENDS-2026", max_uses: 2, used_count: 0, special_perks: { tier: "creator" } });
  });

  it("patches behind an optimistic timestamp and rejects stale or forged fields", async () => {
    const patched = await request(`/api/admin/invitation-codes/${codeId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_uses: 5, is_active: false, expectedUpdatedAt: initialTime }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ schemaVersion: 1, code: { max_uses: 5, is_active: false } });

    const stale = await request(`/api/admin/invitation-codes/${codeId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_uses: 6, expectedUpdatedAt: initialTime }),
    });
    expect(stale.status).toBe(409);

    const forged = await request(`/api/admin/invitation-codes/${codeId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ used_count: 0, expectedUpdatedAt: initialTime }),
    });
    expect(forged.status).toBe(400);
  });

  it("does not delete a code referenced by a user, and deletes unused codes", async () => {
    await database!.prepare("INSERT INTO user_settings (user_id, invited_by_code) VALUES ('synthetic-user', 'WELCOME')").run();
    const referenced = await request(`/api/admin/invitation-codes/${codeId}`, { method: "DELETE" });
    expect(referenced.status).toBe(409);

    await database!.prepare("DELETE FROM user_settings").run();
    const deleted = await request(`/api/admin/invitation-codes/${codeId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await database!.prepare("SELECT id FROM invitation_codes WHERE id = ?").bind(codeId).first()).toBeNull();
  });

  it("rejects invalid origins, methods, and calls without an explicit D1 selector", async () => {
    expect((await request("/api/admin/invitation-codes", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
    expect((await request("/api/admin/invitation-codes", { method: "PUT" })).status).toBe(405);
    const unavailable = await request("/api/admin/invitation-codes", {}, { INVITATION_ADMIN_BACKEND: undefined });
    expect(unavailable.status).toBe(503);
  });
});

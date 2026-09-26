import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-maintenance-settings.sql?raw";
import {
  handleMaintenanceSettingsRequest,
  type MaintenanceAdminAuthorizer,
} from "../src/maintenance-settings-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiUrl = "https://api.example.test/api/system/maintenance";
const adminUrl = "https://api.example.test/api/admin/system-settings/maintenance";
const now = new Date("2026-09-25T12:34:56.000Z");

const allowAdmin: MaintenanceAdminAuthorizer = async () => ({ userId: "synthetic-admin", sessionId: "synthetic-session" });
const denyAdmin: MaintenanceAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function statements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((value) => value.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(statements(schemaSql).map((statement) => database.prepare(statement)));
}

function request(
  url: string,
  init: RequestInit = {},
  requestEnv: Env = runtimeEnv,
  authorizeAdmin: MaintenanceAdminAuthorizer = allowAdmin,
): Promise<Response> {
  return handleMaintenanceSettingsRequest(
    new Request(url, init),
    requestEnv,
    authorizeAdmin,
    () => now,
  );
}

async function clearSettings(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.prepare("DELETE FROM system_settings").run();
}

beforeAll(prepareSchema);
beforeEach(clearSettings);

describe("D1 maintenance settings API", () => {
  it("returns only the three explicit public maintenance settings", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.batch([
      database.prepare(`INSERT INTO system_settings
        (id, setting_key, setting_value, is_public, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).bind("10000000-0000-4000-8000-000000000001", "maintenance_mode", "true", now.toISOString(), now.toISOString()),
      database.prepare(`INSERT INTO system_settings
        (id, setting_key, setting_value, is_public, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).bind("10000000-0000-4000-8000-000000000002", "maintenance_message", "Synthetic maintenance", now.toISOString(), now.toISOString()),
      database.prepare(`INSERT INTO system_settings
        (id, setting_key, setting_value, is_public, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `).bind("10000000-0000-4000-8000-000000000003", "creator_stripe_price_id", "price_private", now.toISOString(), now.toISOString()),
    ]);

    const response = await request(apiUrl, { headers: { Origin: "https://app.example.test" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      settings: {
        maintenance_mode: true,
        maintenance_message: "Synthetic maintenance",
        maintenance_end_time: null,
      },
    });
  });

  it("defaults missing public keys without exposing private rows", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).bind("20000000-0000-4000-8000-000000000001", "maintenance_mode", "true", now.toISOString(), now.toISOString()).run();

    const response = await request(apiUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      settings: { maintenance_mode: false, maintenance_message: "", maintenance_end_time: null },
    });
  });

  it("requires the admin authorization hook and persists an allowlisted atomic patch", async () => {
    const body = {
      maintenance_mode: true,
      maintenance_message: "Staging canary",
      maintenance_end_time: "2026-09-26T00:00:00.000Z",
    };
    const denied = await request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, runtimeEnv, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "mfa_required" });
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    expect(await database.prepare("SELECT count(*) AS count FROM system_settings").first()).toEqual({ count: 0 });

    const accepted = await request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ schemaVersion: 1, settings: body });
    const privateRow = await database.prepare(
      "SELECT setting_value, is_public FROM system_settings WHERE setting_key = ?",
    ).bind("creator_stripe_price_id").first();
    expect(privateRow).toBeNull();
  });

  it("rejects private-key collisions and malformed or oversized updates without changing rows", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).bind("30000000-0000-4000-8000-000000000001", "maintenance_mode", "secret", now.toISOString(), now.toISOString()).run();

    const privateCollision = await request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maintenance_mode: true }),
    });
    expect(privateCollision.status).toBe(409);

    const unknown = await request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creator_stripe_price_id: "price_leak" }),
    });
    expect(unknown.status).toBe(400);

    const invalidDate = await request(adminUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maintenance_end_time: "tomorrow" }),
    });
    expect(invalidDate.status).toBe(400);

    const stored = await database.prepare("SELECT setting_value, is_public FROM system_settings WHERE setting_key = ?")
      .bind("maintenance_mode").first();
    expect(stored).toEqual({ setting_value: "secret", is_public: 0 });
  });

  it("fails closed on disabled backend, invalid origins, and wrong methods", async () => {
    const disabled = await request(apiUrl, {}, { ...runtimeEnv, MAINTENANCE_SETTINGS_BACKEND: undefined });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "maintenance_settings_unavailable" });

    const forbidden = await request(apiUrl, { headers: { Origin: "https://evil.example" } });
    expect(forbidden.status).toBe(403);

    const wrongMethod = await request(apiUrl, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
  });
});

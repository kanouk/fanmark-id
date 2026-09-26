import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-maintenance-settings.sql?raw";
import {
  handleLifecycleSettingsRequest,
  type LifecycleSettingsAdminAuthorizer,
} from "../src/lifecycle-settings-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const publicUrl = "https://api.example.test/api/system/lifecycle";
const adminUrl = "https://api.example.test/api/admin/system-settings/lifecycle";
const now = new Date("2026-09-25T12:34:56.000Z");

const allowAdmin: LifecycleSettingsAdminAuthorizer = async () => ({ userId: "synthetic-admin", sessionId: "synthetic-session" });
const denyAdmin: LifecycleSettingsAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function statements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((value) => value.trim()).filter(Boolean);
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(statements(schemaSql).map((statement) => database.prepare(statement)));
}

function request(url: string, init: RequestInit = {}, requestEnv: Env = runtimeEnv,
  authorizeAdmin: LifecycleSettingsAdminAuthorizer = allowAdmin): Promise<Response> {
  return handleLifecycleSettingsRequest(new Request(url, init), requestEnv, authorizeAdmin, () => now);
}

async function clearSettings(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.prepare("DELETE FROM system_settings").run();
}

beforeAll(prepareSchema);
beforeEach(clearSettings);

describe("D1 lifecycle settings API", () => {
  it("reads exactly the public grace-period setting and fails closed when it is missing", async () => {
    const missing = await request(publicUrl, {}, runtimeEnv, denyAdmin);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "lifecycle_settings_unavailable" });

    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).bind("10000000-0000-4000-8000-000000000001", "grace_period_days", "1", now.toISOString(), now.toISOString()).run();
    await database.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).bind("10000000-0000-4000-8000-000000000002", "creator_stripe_price_id", "price_private", now.toISOString(), now.toISOString()).run();

    const response = await request(publicUrl, { headers: { Origin: "https://app.example.test" } }, runtimeEnv, denyAdmin);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(await response.json()).toEqual({ schemaVersion: 1, settings: { grace_period_days: 1 } });
  });

  it("requires admin authorization before writing and reads back a valid allowlisted setting", async () => {
    const init = { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ grace_period_days: 30 }) };
    const denied = await request(adminUrl, init, runtimeEnv, denyAdmin);
    expect(denied.status).toBe(403);
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    expect(await database.prepare("SELECT count(*) AS count FROM system_settings").first()).toEqual({ count: 0 });

    const accepted = await request(adminUrl, init);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ schemaVersion: 1, settings: { grace_period_days: 30 } });
    expect(await database.prepare("SELECT setting_value, is_public FROM system_settings WHERE setting_key = ?")
      .bind("grace_period_days").first()).toEqual({ setting_value: "30", is_public: 1 });
  });

  it("rejects private collisions, unknown fields, invalid values, and oversized bodies", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare(`INSERT INTO system_settings
      (id, setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).bind("20000000-0000-4000-8000-000000000001", "grace_period_days", "secret", now.toISOString(), now.toISOString()).run();
    const headers = { "content-type": "application/json" };
    const collision = await request(adminUrl, { method: "PATCH", headers, body: JSON.stringify({ grace_period_days: 30 }) });
    expect(collision.status).toBe(409);

    for (const body of [
      JSON.stringify({ grace_period_days: 0 }),
      JSON.stringify({ grace_period_days: 366 }),
      JSON.stringify({ grace_period_days: "30" }),
      JSON.stringify({ grace_period_days: 30, stripe_mode: "live" }),
      "x".repeat(1025),
    ]) {
      const response = await request(adminUrl, { method: "PATCH", headers, body });
      expect(response.status).toBe(body.length > 1024 ? 413 : 400);
    }
    expect(await database.prepare("SELECT setting_value, is_public FROM system_settings WHERE setting_key = ?")
      .bind("grace_period_days").first()).toEqual({ setting_value: "secret", is_public: 0 });
  });

  it("fails closed on the wrong backend, origin, and method", async () => {
    const disabled = await request(publicUrl, {}, { ...runtimeEnv, LIFECYCLE_SETTINGS_BACKEND: undefined });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "lifecycle_settings_unavailable" });
    expect((await request(publicUrl, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await request(publicUrl, { method: "POST" })).status).toBe(405);
    expect((await request(adminUrl, { method: "GET" })).status).toBe(405);
  });
});

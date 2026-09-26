import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-maintenance-settings.sql?raw";
import {
  handleSystemSettingsRequest,
  SYSTEM_SETTING_PUBLIC_KEYS,
  type SystemSettingsAdminAuthorizer,
} from "../src/system-settings-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const publicUrl = "https://api.example.test/api/system/settings";
const adminUrl = "https://api.example.test/api/admin/system-settings";
const now = new Date("2026-09-27T03:04:05.000Z");
const privateKeys = new Set(["enterprise_fanmarks_limit", "enterprise_pricing"]);
const adminKeys = [...SYSTEM_SETTING_PUBLIC_KEYS, ...privateKeys];

const allowAdmin: SystemSettingsAdminAuthorizer = async () => ({ userId: "synthetic-admin", sessionId: "synthetic-session" });
const denyAdmin: SystemSettingsAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

function statements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((value) => value.trim()).filter(Boolean);
}

function settingValue(key: string): string {
  if (key === "invitation_mode" || key === "social_login_enabled") return "false";
  if (key === "stripe_mode") return "test";
  if (key.endsWith("_limit") || key.endsWith("_pricing") || key === "max_emoji_characters") return "5";
  return "price_synthetic";
}

async function prepareSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(statements(schemaSql).map((statement) => database.prepare(statement)));
}

async function insertSettings(keys: readonly string[] = adminKeys): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  const values = keys.map((key, index) => database.prepare(`
    INSERT INTO system_settings (id, setting_key, setting_value, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    key,
    settingValue(key),
    privateKeys.has(key) ? 0 : 1,
    now.toISOString(),
    now.toISOString(),
  ));
  await database.batch(values);
}

function request(
  url: string,
  init: RequestInit = {},
  requestEnv: Env = runtimeEnv,
  authorizeAdmin: SystemSettingsAdminAuthorizer = allowAdmin,
): Promise<Response> {
  return handleSystemSettingsRequest(new Request(url, init), requestEnv, authorizeAdmin, { now: () => now })
    .then((response) => response ?? new Response(null, { status: 404 }));
}

async function clearTables(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM audit_logs"),
    database.prepare("DELETE FROM system_settings"),
  ]);
}

beforeAll(prepareSchema);
beforeEach(clearTables);

describe("D1 system settings API", () => {
  it("serves the exact public projection and keeps enterprise settings private", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await insertSettings();
    const response = await request(publicUrl, { headers: { Origin: "https://app.example.test" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    const payload = await response.json() as { settings: Record<string, string> };
    expect(Object.keys(payload.settings).sort()).toEqual([...SYSTEM_SETTING_PUBLIC_KEYS].sort());
    expect(payload.settings).not.toHaveProperty("enterprise_fanmarks_limit");
    expect(payload.settings).not.toHaveProperty("enterprise_pricing");
  });

  it("requires MFA-protected admin authorization before returning private settings", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await insertSettings();
    const denied = await request(adminUrl, {}, runtimeEnv, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "mfa_required" });
    const accepted = await request(adminUrl);
    expect(accepted.status).toBe(200);
    const payload = await accepted.json() as { settings: Record<string, string> };
    expect(Object.keys(payload.settings).sort()).toEqual([...adminKeys].sort());
    expect(payload.settings.enterprise_pricing).toBe("5");
  });

  it("atomically updates allowlisted settings with an audit row containing no values", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await insertSettings();
    const headers = { "content-type": "application/json" };
    const payload = { key: "enterprise_pricing", value: "75000", expectedValue: "5" };
    const denied = await request(adminUrl, { method: "PATCH", headers, body: JSON.stringify(payload) }, runtimeEnv, denyAdmin);
    expect(denied.status).toBe(403);
    expect(await database.prepare("SELECT count(*) AS count FROM audit_logs").first()).toEqual({ count: 0 });

    const accepted = await request(adminUrl, { method: "PATCH", headers, body: JSON.stringify(payload) });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ schemaVersion: 1, updatedSetting: "enterprise_pricing" });
    expect(await database.prepare("SELECT setting_value, is_public FROM system_settings WHERE setting_key = ?")
      .bind("enterprise_pricing").first()).toEqual({ setting_value: "75000", is_public: 0 });
    const audit = await database.prepare(`
      SELECT user_id, action, resource_type, resource_id, metadata
      FROM audit_logs WHERE action = 'ADMIN_UPDATE_SYSTEM_SETTING'
    `).first();
    expect(audit).toEqual({
      user_id: "synthetic-admin",
      action: "ADMIN_UPDATE_SYSTEM_SETTING",
      resource_type: "system_setting",
      resource_id: "enterprise_pricing",
      metadata: JSON.stringify({ settingKey: "enterprise_pricing" }),
    });

    const unchanged = await request(adminUrl, { method: "PATCH", headers, body: JSON.stringify({ ...payload, expectedValue: "75000" }) });
    expect(unchanged.status).toBe(200);
    expect(await database.prepare("SELECT count(*) AS count FROM audit_logs").first()).toEqual({ count: 1 });
  });

  it("rejects stale, unknown, invalid, and private-visibility-mismatched settings", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await insertSettings();
    const headers = { "content-type": "application/json" };
    const body = (value: unknown) => request(adminUrl, { method: "PATCH", headers, body: JSON.stringify(value) });
    expect((await body({ key: "free_fanmarks_limit", value: "6", expectedValue: "wrong" })).status).toBe(409);
    expect((await body({ key: "social_login_enabled", value: "true", expectedValue: "false" })).status).toBe(400);
    expect((await body({ key: "free_fanmarks_limit", value: "0", expectedValue: "5" })).status).toBe(400);
    expect((await body({ key: "enterprise_pricing", value: "1.5", expectedValue: "5" })).status).toBe(400);

    await database.prepare("UPDATE system_settings SET is_public = 1 WHERE setting_key = ?")
      .bind("enterprise_pricing").run();
    const privateRead = await request(adminUrl);
    expect(privateRead.status).toBe(503);
    expect(await privateRead.json()).toEqual({ error: "system_settings_unavailable" });
    expect(await database.prepare("SELECT count(*) AS count FROM audit_logs").first()).toEqual({ count: 0 });
  });

  it("fails closed when the D1 selector, origin, or method is invalid", async () => {
    const disabled = await request(publicUrl, {}, { ...runtimeEnv, SYSTEM_SETTINGS_BACKEND: undefined });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "system_settings_unavailable" });
    expect((await request(publicUrl, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await request(publicUrl, { method: "POST" })).status).toBe(405);
    expect((await request(adminUrl, { method: "DELETE" })).status).toBe(405);
  });
});

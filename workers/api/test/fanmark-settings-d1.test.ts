import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import settingsSchemaSql from "./fixtures/d1-fanmark-settings.sql?raw";
import { handleRequest } from "../src";
import { handleFanmarkBulkReturnRequest, handleFanmarkReturnRequest } from "../src/fanmark-return-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const otherId = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const ownerFanmarkId = "4d5884a0-304d-4205-8f73-251a2ba2f2d0";
const otherFanmarkId = "015c3df7-b0ca-4862-a4c5-5f8e2576b285";
const expiredFanmarkId = "9cc9462d-c9c1-4750-ae20-8f3bd0bfc7e0";
const ownerLicenseId = "45111111-1111-4111-8111-111111111111";
const otherLicenseId = "45222222-2222-4222-8222-222222222222";
const expiredLicenseId = "45333333-3333-4333-8333-333333333333";
const ownerEmail = "fanmark-settings-owner@example.invalid";
const otherEmail = "fanmark-settings-other@example.invalid";
const loginPassword = "Synthetic-Fanmark-Settings-Only!2026";
const now = "2026-09-25T00:00:00.000000Z";

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const statement = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(statement) && !/\bend\s*$/iu.test(statement)) continue;
    if (statement) statements.push(statement);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(new Request(`${apiBase}${path}`, { ...init, headers }), { ...runtimeEnv, ...overrides });
}

async function signIn(email: string): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: loginPassword }),
  });
  if (response.status !== 200) throw new Error(`Synthetic sign-in failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Synthetic sign-in did not issue a session cookie");
  return cookie;
}

async function resetRows(): Promise<void> {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.prepare('DELETE FROM "session" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "account" WHERE "userId" IN (?, ?)').bind(ownerId, otherId).run();
  await authDatabase.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(ownerId, otherId).run();
  for (const table of ["notification_events", "audit_logs", "fanmark_favorites", "fanmark_transfer_codes", "fanmark_discoveries", "system_settings"]) {
    await businessDatabase.prepare(`DELETE FROM ${table}`).run();
  }
  for (const table of [
    "fanmark_password_runtime_evidence", "fanmark_redirect_configs", "fanmark_messageboard_configs", "fanmark_password_configs",
    "fanmark_profiles", "fanmark_basic_configs",
  ]) await businessDatabase.prepare(`DELETE FROM ${table}`).run();
  await businessDatabase.prepare("DELETE FROM fanmark_access_versions").run();
  await businessDatabase.prepare("DELETE FROM fanmark_licenses").run();
  await businessDatabase.prepare("DELETE FROM fanmarks").run();

  for (const [id, email, name] of [
    [ownerId, ownerEmail, "Fanmark Settings Owner"],
    [otherId, otherEmail, "Fanmark Settings Other"],
  ]) {
    await authDatabase.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await authDatabase.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, bcrypt.hashSync(loginPassword, 10), now, now).run();
  }

  for (const [id, emoji, shortId] of [
    [ownerFanmarkId, "🌹", "rose-owned"],
    [otherFanmarkId, "🌻", "sunflower-other"],
    [expiredFanmarkId, "🪻", "iris-expired"],
  ]) {
    await businessDatabase.prepare(
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, emoji_ids, status, tier_level, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)",
    ).bind(id, shortId, emoji, JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]), now, now).run();
  }
  for (const [id, fanmarkId, userId, end] of [
    [ownerLicenseId, ownerFanmarkId, ownerId, "2999-12-31T23:59:59.000000Z"],
    [otherLicenseId, otherFanmarkId, otherId, "2999-12-31T23:59:59.000000Z"],
    [expiredLicenseId, expiredFanmarkId, ownerId, "2000-01-01T00:00:00.000000Z"],
  ] as const) {
    await businessDatabase.prepare(
      "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, status, license_end, display_fanmark, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)",
    ).bind(id, fanmarkId, userId, end, "displayed-fanmark", now, now).run();
    await businessDatabase.prepare(
      "INSERT INTO fanmark_license_incarnations (license_id, incarnation) VALUES (?, 0)",
    ).bind(id).run();
    await businessDatabase.prepare(
      "INSERT INTO fanmark_access_versions (license_id, license_incarnation, access_generation, password_generation, updated_at) VALUES (?, 0, 0, 0, ?)",
    ).bind(id, now).run();
    await businessDatabase.prepare(
      "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type, created_at, updated_at) VALUES (?, ?, ?, 'profile', ?, ?)",
    ).bind(`${id}-basic`, id, `Name ${id.slice(0, 4)}`, now, now).run();
  }
  await businessDatabase.prepare(
    "INSERT INTO system_settings (setting_key, setting_value) VALUES ('grace_period_days', '1')",
  ).run();
  await businessDatabase.prepare("INSERT INTO fanmark_discoveries (id) VALUES ('discovery-owner')").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_favorites (id, user_id, discovery_id, fanmark_id, display_fanmark) VALUES ('favorite-other', ?, 'discovery-owner', ?, '🌹 saved')",
  ).bind(otherId, ownerFanmarkId).run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_redirect_configs (id, license_id, target_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind("45444444-4444-4444-8444-444444444444", ownerLicenseId, "https://old.example.test/", now, now).run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_messageboard_configs (id, license_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind("45555555-5555-4555-8555-555555555555", ownerLicenseId, "Saved text", now, now).run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_password_configs (id, license_id, access_password, is_enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  ).bind("45666666-6666-4666-8666-666666666666", ownerLicenseId, bcrypt.hashSync("1234", 10), now, now).run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).bind(
    "45777777-7777-4777-8777-777777777777", ownerLicenseId, "Saved display name", "Saved biography",
    JSON.stringify({ website: "https://example.test/profile" }), JSON.stringify({ theme_color: "#123456", button_style: "rounded" }), now, now,
  ).run();
}

function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fanmarkName: "Updated name",
    accessType: "profile",
    isPasswordProtected: true,
    isPublic: false,
    ...overrides,
  };
}

async function patchSettings(cookie: string, body: Record<string, unknown>, fanmarkId = ownerFanmarkId): Promise<Response> {
  return request(`/api/me/fanmarks/${fanmarkId}/settings`, {
    method: "PATCH",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function generations(licenseId = ownerLicenseId): Promise<{ access_generation: number; password_generation: number }> {
  const row = await businessDatabase?.prepare(
    "SELECT access_generation, password_generation FROM fanmark_access_versions WHERE license_id = ?",
  ).bind(licenseId).first<{ access_generation: number; password_generation: number }>();
  if (!row) throw new Error("Synthetic generation row missing");
  return row;
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(settingsSchemaSql).map((statement) => businessDatabase.prepare(statement)));
});

beforeEach(resetRows);

describe("owner fanmark-settings API", () => {
  it("returns only the latest settings for the authenticated owner and never returns password hashes", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/settings`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { schemaVersion: number; fanmark: Record<string, unknown> };
    expect(body.schemaVersion).toBe(1);
    expect(body.fanmark).toMatchObject({
      id: ownerFanmarkId,
      user_input_fanmark: "🌹",
      fanmark_name: `Name ${ownerLicenseId.slice(0, 4)}`,
      access_type: "profile",
      target_url: "https://old.example.test/",
      text_content: "Saved text",
      is_password_protected: true,
      is_public: true,
      has_active_license: true,
    });
    expect(JSON.stringify(body)).not.toContain("access_password");
    expect(JSON.stringify(body)).not.toContain("1234");
    expect(JSON.stringify(body)).not.toContain(ownerId);
    expect((await request(`/api/me/fanmarks/${otherFanmarkId}/settings`, { headers: { Cookie: cookie } })).status).toBe(404);
  });

  it("writes all selected settings atomically and preserves unrelated profile fields", async () => {
    const cookie = await signIn(ownerEmail);
    const before = await generations();
    const response = await patchSettings(cookie, settings({
      accessType: "redirect",
      targetUrl: "https://new.example.test/path",
      accessPassword: "9876",
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { fanmark: Record<string, unknown> };
    expect(body.fanmark).toMatchObject({
      fanmark_name: "Updated name",
      access_type: "redirect",
      target_url: "https://new.example.test/path",
      is_password_protected: true,
    });
    const profile = await businessDatabase?.prepare(
      "SELECT display_name, bio, social_links, theme_settings, is_public FROM fanmark_profiles WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    expect(profile).toEqual({
      display_name: "Saved display name",
      bio: "Saved biography",
      social_links: JSON.stringify({ website: "https://example.test/profile" }),
      theme_settings: JSON.stringify({ theme_color: "#123456", button_style: "rounded" }),
      is_public: 1,
    });
    const passwordRow = await businessDatabase?.prepare(
      "SELECT access_password, is_enabled FROM fanmark_password_configs WHERE license_id = ?",
    ).bind(ownerLicenseId).first<{ access_password: string; is_enabled: number }>();
    expect(passwordRow?.is_enabled).toBe(1);
    expect(passwordRow?.access_password).not.toBe("9876");
    expect(await bcrypt.compare("9876", passwordRow?.access_password ?? "")).toBe(true);
    const after = await generations();
    expect(after.access_generation).toBe(before.access_generation + 3);
    expect(after.password_generation).toBe(before.password_generation + 1);
    const evidence = await businessDatabase?.prepare(`
      SELECT e.license_incarnation, e.password_generation, e.enabled, e.codec_id,
        av.password_generation AS current_password_generation,
        li.incarnation AS current_incarnation
      FROM fanmark_password_runtime_evidence AS e
      JOIN fanmark_access_versions AS av ON av.license_id = e.license_id
      JOIN fanmark_license_incarnations AS li ON li.license_id = e.license_id
      WHERE e.license_id = ?
    `).bind(ownerLicenseId).first();
    expect(evidence).toEqual({
      license_incarnation: 0,
      password_generation: after.password_generation,
      enabled: 1,
      codec_id: "bcryptjs@3.0.3",
      current_password_generation: after.password_generation,
      current_incarnation: 0,
    });
  });

  it("preserves an existing enabled password when no replacement is supplied", async () => {
    const cookie = await signIn(ownerEmail);
    const original = await businessDatabase?.prepare(
      "SELECT access_password, is_enabled FROM fanmark_password_configs WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    const response = await patchSettings(cookie, settings({ fanmarkName: "Still protected" }));
    expect(response.status).toBe(200);
    const unchanged = await businessDatabase?.prepare(
      "SELECT access_password, is_enabled FROM fanmark_password_configs WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    expect(unchanged).toEqual(original);
  });

  it("stores only a bcrypt placeholder while disabling protection and requires a password when enabling it", async () => {
    const cookie = await signIn(ownerEmail);
    const disabled = await patchSettings(cookie, settings({ accessType: "inactive", isPasswordProtected: false }));
    expect(disabled.status).toBe(200);
    const disabledRow = await businessDatabase?.prepare(
      "SELECT access_password, is_enabled FROM fanmark_password_configs WHERE license_id = ?",
    ).bind(ownerLicenseId).first<{ access_password: string; is_enabled: number }>();
    expect(disabledRow?.is_enabled).toBe(0);
    expect(disabledRow?.access_password).not.toBe("0000");
    expect(await bcrypt.compare("0000", disabledRow?.access_password ?? "")).toBe(true);
    const evidence = await businessDatabase?.prepare(
      "SELECT license_incarnation, password_generation, enabled, codec_id FROM fanmark_password_runtime_evidence WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    expect(evidence).toMatchObject({ license_incarnation: 0, enabled: 0, codec_id: "bcryptjs@3.0.3" });

    const missing = await patchSettings(cookie, settings({
      fanmarkName: "Enable without a password",
      isPasswordProtected: true,
    }));
    expect(missing.status).toBe(400);
  });

  it("rolls back every setting when a later write fails", async () => {
    const cookie = await signIn(ownerEmail);
    const before = await generations();
    await businessDatabase?.prepare(`
      CREATE TRIGGER settings_fail_redirect BEFORE INSERT ON fanmark_redirect_configs
      WHEN NEW.target_url = 'https://fail.example.test/'
      BEGIN SELECT RAISE(ABORT, 'synthetic redirect failure'); END
    `).run();
    const response = await patchSettings(cookie, settings({
      accessType: "redirect",
      targetUrl: "https://fail.example.test/",
      accessPassword: "2468",
    }));
    expect(response.status).toBe(503);
    const basic = await businessDatabase?.prepare(
      "SELECT fanmark_name, access_type FROM fanmark_basic_configs WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    expect(basic).toEqual({ fanmark_name: `Name ${ownerLicenseId.slice(0, 4)}`, access_type: "profile" });
    expect(await generations()).toEqual(before);
    await businessDatabase?.prepare("DROP TRIGGER settings_fail_redirect").run();
  });

  it("denies nonowners, expired licenses, invalid fields, missing sessions, and disabled selectors", async () => {
    const cookie = await signIn(ownerEmail);
    expect((await patchSettings(cookie, settings(), otherFanmarkId)).status).toBe(404);
    expect((await patchSettings(cookie, settings(), expiredFanmarkId)).status).toBe(404);
    for (const body of [
      settings({ targetUrl: "javascript:alert(1)", accessType: "redirect" }),
      settings({ accessPassword: "12x4" }),
      settings({ accessPassword: "2468", isPasswordProtected: false }),
      settings({ extra: "field" }),
    ]) expect((await patchSettings(cookie, body)).status).toBe(400);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/settings`)).status).toBe(401);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/settings`, {}, { FANMARK_SETTINGS_BACKEND: undefined })).status).toBe(503);
    expect((await request(`/api/me/fanmarks/not-a-uuid/settings`, { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/settings`, { method: "DELETE" })).status).toBe(405);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/settings`, { headers: { Origin: "https://attacker.example.test" } })).status).toBe(403);
  });
});

describe("D1 fanmark return API", () => {
  const nowDate = new Date("2026-09-25T12:34:56.000Z");
  const returnEnv: Env = {
    ...runtimeEnv,
    AUTH_BACKEND: "better-auth",
    FANMARK_RETURN_BACKEND: "d1",
  };

  async function returnRequest(
    body: unknown,
    userId: string | null = ownerId,
    headers: HeadersInit = { Origin: appOrigin, "content-type": "application/json" },
    method = "POST",
  ): Promise<Response> {
    return handleFanmarkReturnRequest(
      new Request(`${apiBase}/api/me/fanmarks/return`, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
      returnEnv,
      async () => ({ available: true, userId }),
      () => new Date(nowDate),
    );
  }

  it("moves only the owner's active license to grace and writes audit and favorite events", async () => {
    const response = await returnRequest({ fanmark_id: ownerFanmarkId });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true });

    const license = await businessDatabase?.prepare(
      "SELECT status, license_end, grace_expires_at, is_returned, excluded_at FROM fanmark_licenses WHERE id = ?",
    ).bind(ownerLicenseId).first();
    expect(license).toEqual({
      status: "grace",
      license_end: nowDate.toISOString(),
      grace_expires_at: "2026-09-27T00:00:00.000Z",
      is_returned: 1,
      excluded_at: null,
    });

    const audit = await businessDatabase?.prepare(
      "SELECT user_id, action, resource_type, resource_id, metadata FROM audit_logs",
    ).first<{ user_id: string; action: string; metadata: string }>();
    expect(audit?.user_id).toBe(ownerId);
    expect(audit?.action).toBe("return_fanmark");
    expect(JSON.parse(audit?.metadata ?? "{}")).toMatchObject({
      user_input_fanmark: "displayed-fanmark",
      returned_at: nowDate.toISOString(),
      grace_expires_at: "2026-09-27T00:00:00.000Z",
    });

    const events = await businessDatabase?.prepare(
      "SELECT event_type, payload FROM notification_events ORDER BY event_type",
    ).all<{ event_type: string; payload: string }>();
    expect(events?.results?.map((event) => event.event_type)).toEqual([
      "fanmark_returned_owner",
      "favorite_fanmark_available",
    ]);
    const favoriteEvent = events?.results?.find((event) => event.event_type === "favorite_fanmark_available");
    expect(JSON.parse(favoriteEvent?.payload ?? "{}")).toMatchObject({
      user_id: otherId,
      fanmark_id: ownerFanmarkId,
      fanmark_name: "🌹 saved",
      fanmark_short_id: "rose-owned",
      grace_expires_at: "2026-09-27T00:00:00.000Z",
    });
    const otherLicense = await businessDatabase?.prepare(
      "SELECT status FROM fanmark_licenses WHERE id = ?",
    ).bind(otherLicenseId).first<{ status: string }>();
    expect(otherLicense?.status).toBe("active");
  });

  it.each(["active", "applied"]) ("blocks return while a %s transfer code exists", async (status) => {
    await businessDatabase?.prepare(
      "INSERT INTO fanmark_transfer_codes (id, license_id, status) VALUES (?, ?, ?)",
    ).bind(`transfer-${status}`, ownerLicenseId, status).run();
    const response = await returnRequest({ fanmark_id: ownerFanmarkId });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "transfer_in_progress" });
    const license = await businessDatabase?.prepare(
      "SELECT status, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(ownerLicenseId).first();
    expect(license).toEqual({ status: "active", is_returned: 0 });
    expect((await businessDatabase?.prepare("SELECT COUNT(*) AS count FROM audit_logs").first<{ count: number }>())?.count).toBe(0);
  });

  it("does not return expired or another user's license", async () => {
    const expired = await returnRequest({ fanmark_id: expiredFanmarkId });
    const otherOwner = await returnRequest({ fanmark_id: otherFanmarkId });
    expect(expired.status).toBe(404);
    expect(otherOwner.status).toBe(404);
    const license = await businessDatabase?.prepare(
      "SELECT status, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(expiredLicenseId).first();
    expect(license).toEqual({ status: "active", is_returned: 0 });
  });

  it("validates method, origin, authentication, and request body", async () => {
    expect((await returnRequest({}, ownerId, { Origin: appOrigin }, "GET")).status).toBe(405);
    expect((await returnRequest({}, ownerId, { Origin: "https://evil.example", "content-type": "application/json" })).status).toBe(403);
    expect((await returnRequest({ fanmark_id: ownerFanmarkId }, null)).status).toBe(401);
    const invalid = await returnRequest({ fanmark_id: "not-a-uuid", extra: true });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
  });

  it("dispatches the return path through the Better Auth session resolver", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/fanmarks/return", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: ownerFanmarkId }),
    }, { FANMARK_RETURN_BACKEND: "d1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const license = await businessDatabase?.prepare(
      "SELECT status, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(ownerLicenseId).first();
    expect(license).toEqual({ status: "grace", is_returned: 1 });
  });
});

describe("D1 bulk fanmark return API", () => {
  const bulkEnv: Env = {
    ...runtimeEnv,
    AUTH_BACKEND: "better-auth",
    FANMARK_RETURN_BACKEND: "d1",
  };

  async function bulkReturnRequest(
    body: unknown,
    userId: string | null = ownerId,
    headers: HeadersInit = { Origin: appOrigin, "content-type": "application/json" },
    method = "POST",
  ): Promise<Response> {
    return handleFanmarkBulkReturnRequest(
      new Request(`${apiBase}/api/me/fanmarks/bulk-return`, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
      bulkEnv,
      async () => ({ available: true, userId }),
      () => new Date("2026-09-25T12:34:56.000Z"),
    );
  }

  it("returns active owned licenses and reports expired items as partial failure", async () => {
    const response = await bulkReturnRequest({ license_ids: [ownerLicenseId, expiredLicenseId] });
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({
      success: false,
      results: [{
        licenseId: ownerLicenseId,
        fanmarkId: ownerFanmarkId,
        fanmark: "displayed-fanmark",
        fanmarkShortId: "rose-owned",
        graceExpiresAt: "2026-09-27T00:00:00.000Z",
      }],
      failed: [{ licenseId: expiredLicenseId, error: "license_not_active" }],
    });
    const owner = await businessDatabase?.prepare(
      "SELECT status, license_end, grace_expires_at, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(ownerLicenseId).first();
    expect(owner).toEqual({
      status: "grace",
      license_end: "2026-09-25T12:34:56.000Z",
      grace_expires_at: "2026-09-27T00:00:00.000Z",
      is_returned: 1,
    });
    const expired = await businessDatabase?.prepare(
      "SELECT status, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(expiredLicenseId).first();
    expect(expired).toEqual({ status: "active", is_returned: 0 });
  });

  it.each(["active", "applied"]) ("keeps a license unchanged while a %s transfer code blocks bulk return", async (status) => {
    await businessDatabase?.prepare(
      "INSERT INTO fanmark_transfer_codes (id, license_id, status) VALUES (?, ?, ?)",
    ).bind(`bulk-transfer-${status}`, ownerLicenseId, status).run();
    const response = await bulkReturnRequest({ license_ids: [ownerLicenseId] });
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({
      success: false,
      results: [],
      failed: [{ licenseId: ownerLicenseId, error: "transfer_in_progress" }],
    });
    const owner = await businessDatabase?.prepare(
      "SELECT status, is_returned FROM fanmark_licenses WHERE id = ?",
    ).bind(ownerLicenseId).first();
    expect(owner).toEqual({ status: "active", is_returned: 0 });
  });

  it("rejects unauthorized, malformed, duplicate, and oversized license selections", async () => {
    expect((await bulkReturnRequest({ license_ids: [ownerLicenseId] }, null)).status).toBe(401);
    expect((await bulkReturnRequest({ license_ids: [ownerLicenseId] }, ownerId,
      { Origin: "https://evil.example", "content-type": "application/json" })).status).toBe(403);
    expect((await bulkReturnRequest({ license_ids: [ownerLicenseId, ownerLicenseId] })).status).toBe(400);
    expect((await bulkReturnRequest({ license_ids: Array.from({ length: 51 }, () => ownerLicenseId) })).status).toBe(400);
    expect((await bulkReturnRequest({ license_ids: ["not-a-uuid"] })).status).toBe(400);
    expect((await bulkReturnRequest({}, ownerId, { Origin: appOrigin }, "GET")).status).toBe(405);
  });

  it("dispatches the bulk route through the Better Auth session resolver", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/fanmarks/bulk-return", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ license_ids: [ownerLicenseId] }),
    }, { FANMARK_RETURN_BACKEND: "d1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, results: [{ licenseId: ownerLicenseId }] });
  });
});

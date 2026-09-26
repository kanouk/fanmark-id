import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import profileSchemaSql from "./fixtures/d1-fanmark-profile.sql?raw";
import { handleRequest } from "../src";
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
const ownerEmail = "fanmark-profile-owner@example.invalid";
const otherEmail = "fanmark-profile-other@example.invalid";
const password = "Synthetic-Fanmark-Profile-Only!2026";
const now = "2026-09-25T00:00:00.000000Z";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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
  return handleRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

async function signIn(email: string): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
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
  await businessDatabase.prepare("DELETE FROM fanmark_profiles").run();
  await businessDatabase.prepare("DELETE FROM fanmark_access_versions").run();
  await businessDatabase.prepare("DELETE FROM fanmark_licenses").run();
  await businessDatabase.prepare("DELETE FROM fanmarks").run();

  for (const [id, email, name] of [
    [ownerId, ownerEmail, "Fanmark Profile Owner"],
    [otherId, otherEmail, "Fanmark Profile Other"],
  ]) {
    await authDatabase.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await authDatabase.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, bcrypt.hashSync(password, 10), now, now).run();
  }

  for (const [id, input, shortId] of [
    [ownerFanmarkId, "🌹", "rose-owned"],
    [otherFanmarkId, "🌻", "sunflower-other"],
    [expiredFanmarkId, "🪻", "iris-expired"],
  ]) {
    await businessDatabase.prepare(
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, emoji_ids, status, tier_level, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)",
    ).bind(id, shortId, input, JSON.stringify(["043a78d4-1e42-4502-9f57-b1d1f93482db"]), now, now).run();
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
      "INSERT INTO fanmark_access_versions (license_id, access_generation, updated_at) VALUES (?, 0, ?)",
    ).bind(id, now).run();
    await businessDatabase.prepare(
      "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type, created_at, updated_at) VALUES (?, ?, ?, 'profile', ?, ?)",
    ).bind(`${id}-basic`, id, `Name ${shortFor(id)}`, now, now).run();
  }
  await businessDatabase.prepare(
    "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).bind(
    "45444444-4444-4444-8444-444444444444",
    ownerLicenseId,
    "Saved display name",
    "Saved biography",
    JSON.stringify({ website: "https://example.test/profile" }),
    JSON.stringify({ theme_color: "#123456", button_style: "rounded" }),
    now,
    now,
  ).run();
}

function shortFor(id: string): string {
  return id === ownerLicenseId ? "rose" : id === otherLicenseId ? "sunflower" : "iris";
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(profileSchemaSql).map((statement) => businessDatabase.prepare(statement)));
});

beforeEach(resetRows);

describe("owner fanmark-profile API", () => {
  it("returns the authenticated owner's profile and profile context without exposing another owner", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
    expect(body.licenseId).toBe(ownerLicenseId);
    expect(body.fanmark).toMatchObject({ id: ownerFanmarkId, user_input_fanmark: "🌹", short_id: "rose-owned" });
    expect(body.profile).toMatchObject({
      id: "45444444-4444-4444-8444-444444444444",
      license_id: ownerLicenseId,
      display_name: "Saved display name",
      is_public: true,
    });
    expect(JSON.stringify(body)).not.toContain(otherId);
    expect(JSON.stringify(body)).not.toContain(otherEmail);
  });

  it("creates profiles using runtime timestamps, then updates the same row and its access generation", async () => {
    const cookie = await signIn(ownerEmail);
    const created = await request(`/api/me/fanmarks/${expiredFanmarkId}/profile`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ is_public: true }),
    });
    expect(created.status).toBe(404);

    const before = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, { headers: { Cookie: cookie } });
    const beforeBody = await before.json() as { profile: { id: string; updated_at: string } };
    const updated = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({
        display_name: "Updated profile",
        bio: "Changed through Cloudflare",
        social_links: { website: "https://example.test/new" },
        theme_settings: {
          cover_image_position: 42,
          theme_color: "#abc",
          cover_image_url: `${apiBase}/api/storage/public/cover-images/${ownerId}/cover.png`,
          profile_image_url: `${apiBase}/api/storage/public/avatars/${ownerId}/avatar.png`,
        },
        is_public: false,
      }),
    });
    expect(updated.status).toBe(200);
    const body = await updated.json() as { profile: Record<string, unknown> };
    expect(body.profile).toMatchObject({
      id: beforeBody.profile.id,
      display_name: "Updated profile",
      bio: "Changed through Cloudflare",
      social_links: { website: "https://example.test/new" },
      theme_settings: {
        cover_image_position: 42,
        theme_color: "#abc",
        cover_image_url: `${apiBase}/api/storage/public/cover-images/${ownerId}/cover.png`,
        profile_image_url: `${apiBase}/api/storage/public/avatars/${ownerId}/avatar.png`,
      },
      is_public: false,
    });
    expect(body.profile.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u);
    const unsafeUrl = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({
        theme_settings: {
          profile_image_url: `${apiBase}/api/storage/public/avatars/${ownerId}/avatar.png\u0000bad`,
        },
      }),
    });
    expect(unsafeUrl.status).toBe(400);
    const generation = await businessDatabase?.prepare(
      "SELECT access_generation FROM fanmark_access_versions WHERE license_id = ?",
    ).bind(ownerLicenseId).first<{ access_generation: number }>();
    expect(generation?.access_generation).toBe(1);
  });

  it("creates a missing profile with source-like defaults on publication toggle", async () => {
    await businessDatabase?.prepare("DELETE FROM fanmark_profiles WHERE license_id = ?").bind(ownerLicenseId).run();
    const cookie = await signIn(ownerEmail);
    const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ is_public: true }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { profile: Record<string, unknown> };
    expect(body.profile).toMatchObject({ license_id: ownerLicenseId, bio: "", social_links: {}, theme_settings: {}, is_public: true });
    expect(body.profile.id).toMatch(UUID_PATTERN);
  });

  it("denies another owner's and expired fanmarks and rejects unsafe fields without writes", async () => {
    const cookie = await signIn(ownerEmail);
    expect((await request(`/api/me/fanmarks/${otherFanmarkId}/profile`, { headers: { Cookie: cookie } })).status).toBe(404);
    for (const patch of [
      { license_id: otherLicenseId, is_public: true },
      { display_name: "" },
      { display_name: "x".repeat(51) },
      { social_links: { website: "javascript:alert(1)" } },
      { theme_settings: { cover_image_position: 101 } },
      { theme_settings: { cover_image_url: `${apiBase}/api/storage/public/cover-images/${otherId}/cover.png` } },
      { theme_settings: { cover_image_url: `${apiBase}/api/storage/public/avatars/${ownerId}/cover.png` } },
      { theme_settings: { profile_image_url: `${apiBase}/api/storage/public/avatars/${otherId}/avatar.png` } },
      { theme_settings: { profile_image_url: `${apiBase}/api/storage/object/avatars/${ownerId}/avatar.png` } },
      { is_public: "true" },
    ]) {
      const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
        method: "PATCH",
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      expect(response.status).toBe(400);
    }
    const profile = await businessDatabase?.prepare(
      "SELECT display_name, is_public FROM fanmark_profiles WHERE license_id = ?",
    ).bind(ownerLicenseId).first();
    expect(profile).toEqual({ display_name: "Saved display name", is_public: 1 });
  });

  it("enforces session, selector, origin, method, and path contracts", async () => {
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`)).status).toBe(401);
    expect((await request(`/api/me/fanmarks/not-a-uuid/profile`, { headers: { Cookie: await signIn(ownerEmail) } })).status).toBe(400);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/profile?userId=${otherId}`, { headers: { Cookie: await signIn(ownerEmail) } })).status).toBe(400);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, { method: "DELETE" })).status).toBe(405);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, { headers: { Origin: "https://attacker.example.test" } })).status).toBe(403);
    expect((await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {}, { FANMARK_PROFILE_BACKEND: undefined })).status).toBe(503);
    const options = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
      method: "OPTIONS",
      headers: { "access-control-request-method": "PATCH" },
    });
    expect(options.status).toBe(204);
  });
});

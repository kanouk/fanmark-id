import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import signupSchemaSql from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSchemaSql from "../migrations/0008_auth_user_suspension.sql?raw";
import { checkedInSqlStatements as splitSqlStatements } from "./schema-statements";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

declare module "vitest" {
  export interface ProvidedContext {
    businessProfileMigrations: Array<{ name: string; sql: string }>;
  }
}

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
  await businessDatabase.prepare("DELETE FROM fanmark_basic_configs").run();
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
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status, tier_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    ).bind(id, shortId, input, input, JSON.stringify([id]), JSON.stringify([id]), now, now).run();
  }
  for (const [id, fanmarkId, userId, end] of [
    [ownerLicenseId, ownerFanmarkId, ownerId, "2999-12-31T23:59:59.000000Z"],
    [otherLicenseId, otherFanmarkId, otherId, "2999-12-31T23:59:59.000000Z"],
    [expiredLicenseId, expiredFanmarkId, ownerId, "2000-01-01T00:00:00.000000Z"],
  ] as const) {
    await businessDatabase.prepare(
      "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, status, license_start, license_end, display_fanmark, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)",
    ).bind(id, fanmarkId, userId, id === expiredLicenseId ? "1999-01-01T00:00:00.000000Z" : now, end, "displayed-fanmark", now, now).run();
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

async function accessGeneration(licenseId: string): Promise<number> {
  const row = await businessDatabase!.prepare(
    "SELECT access_generation FROM fanmark_access_versions WHERE license_id = ?",
  ).bind(licenseId).first<{ access_generation: number }>();
  if (!row) throw new Error("Synthetic license has no access generation");
  return row.access_generation;
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  for (const sql of [authSchemaSql, signupSchemaSql, suspensionSchemaSql]) {
    await authDatabase.batch(splitSqlStatements(sql).map((statement) => authDatabase.prepare(statement)));
  }
  for (const migration of inject("businessProfileMigrations")) {
    await businessDatabase.batch(splitSqlStatements(migration.sql).map((statement) => businessDatabase.prepare(statement)));
  }
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
    const generationBefore = await accessGeneration(ownerLicenseId);
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
    expect(await accessGeneration(ownerLicenseId)).toBe(generationBefore + 1);
  });

  it("creates a missing profile with source-like defaults on publication toggle", async () => {
    await businessDatabase?.prepare("DELETE FROM fanmark_profiles WHERE license_id = ?").bind(ownerLicenseId).run();
    const cookie = await signIn(ownerEmail);
    const createdAt = new Date(Date.now() + 1_000);
    const updatedAt = new Date(createdAt.getTime() + 5 * 60 * 1_000 + 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(createdAt);
      const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
        method: "PATCH",
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify({ is_public: true }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { profile: Record<string, unknown> };
      expect(body.profile).toMatchObject({ license_id: ownerLicenseId, bio: "", social_links: {}, theme_settings: {}, is_public: true });
      expect(body.profile.id).toMatch(UUID_PATTERN);
      const created = await businessDatabase?.prepare(
        "SELECT created_at, updated_at FROM fanmark_profiles WHERE license_id = ?",
      ).bind(ownerLicenseId).first<{ created_at: string; updated_at: string }>();
      const expectedCreatedAt = createdAt.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
      const expectedUpdatedAt = updatedAt.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
      expect(created).toEqual({ created_at: expectedCreatedAt, updated_at: expectedCreatedAt });

      vi.setSystemTime(updatedAt);
      const update = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
        method: "PATCH",
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify({ bio: "Updated under the next operation clock" }),
      });
      expect(update.status).toBe(200);
      const updated = await businessDatabase?.prepare(
        "SELECT created_at, updated_at FROM fanmark_profiles WHERE license_id = ?",
      ).bind(ownerLicenseId).first<{ created_at: string; updated_at: string }>();
      expect(updated).toEqual({ created_at: expectedCreatedAt, updated_at: expectedUpdatedAt });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a perpetual license owner read, update and recreate a profile while denying other owners and inactive licenses", async () => {
    await businessDatabase!.prepare("UPDATE fanmark_licenses SET license_end = NULL WHERE id IN (?, ?)")
      .bind(ownerLicenseId, otherLicenseId).run();
    const cookie = await signIn(ownerEmail);
    const path = `/api/me/fanmarks/${ownerFanmarkId}/profile`;
    const read = await request(path, { headers: { Cookie: cookie } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ licenseId: ownerLicenseId, profile: { display_name: "Saved display name" } });
    const generationBefore = await accessGeneration(ownerLicenseId);
    const patch = () => request(path, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ display_name: " Perpetual owner ", bio: "Lifetime profile", is_public: true }),
    });
    const updated = await patch();
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ profile: { display_name: " Perpetual owner ", bio: "Lifetime profile", is_public: true } });
    expect(await accessGeneration(ownerLicenseId)).toBe(generationBefore + 1);

    expect((await request(`/api/me/fanmarks/${otherFanmarkId}/profile`, { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await request(`/api/me/fanmarks/${otherFanmarkId}/profile`, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Wrong owner" }),
    })).status).toBe(404);
    expect(await businessDatabase!.prepare("SELECT id FROM fanmark_profiles WHERE license_id = ?").bind(otherLicenseId).first()).toBeNull();

    await businessDatabase!.prepare("DELETE FROM fanmark_profiles WHERE license_id = ?").bind(ownerLicenseId).run();
    const created = await patch();
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ profile: { license_id: ownerLicenseId, bio: "Lifetime profile" } });
    for (const status of ["grace", "expired"]) {
      await businessDatabase!.prepare("UPDATE fanmark_licenses SET status = ? WHERE id = ?").bind(status, ownerLicenseId).run();
      expect((await request(path, { headers: { Cookie: cookie } })).status).toBe(404);
      expect((await patch()).status).toBe(404);
    }
    expect(await businessDatabase!.prepare("SELECT display_name, bio FROM fanmark_profiles WHERE license_id = ?")
      .bind(ownerLicenseId).first()).toEqual({ display_name: " Perpetual owner ", bio: "Lifetime profile" });
  });

  it("rejects ambiguous ownership when perpetual and finite active licenses belong to the same owner", async () => {
    const conflictingLicenseId = "45555555-5555-4555-8555-555555555555";
    await businessDatabase!.prepare(
      "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, status, license_start, license_end, display_fanmark, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?)",
    ).bind(conflictingLicenseId, ownerFanmarkId, ownerId, now, "conflicting-perpetual", now, now).run();
    const cookie = await signIn(ownerEmail);
    const path = `/api/me/fanmarks/${ownerFanmarkId}/profile`;
    expect((await request(path, { headers: { Cookie: cookie } })).status).toBe(503);
    const response = await request(path, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ bio: "Must not be saved" }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "fanmark_profile_unavailable" });
    expect(await businessDatabase!.prepare("SELECT license_id, bio FROM fanmark_profiles").all())
      .toMatchObject({ results: [{ license_id: ownerLicenseId, bio: "Saved biography" }] });
  });

  it("rechecks perpetual ownership in the write statement when the license enters grace after the read", async () => {
    await businessDatabase!.prepare("UPDATE fanmark_licenses SET license_end = NULL WHERE id = ?").bind(ownerLicenseId).run();
    const cookie = await signIn(ownerEmail);
    const generationBefore = await accessGeneration(ownerLicenseId);
    let intercepted = false;
    const racedDatabase = new Proxy(businessDatabase!, {
      get(target, property) {
        if (property === "prepare") return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("INSERT INTO fanmark_profiles")) return statement;
          return new Proxy(statement, {
            get(prepared, method) {
              if (method === "bind") return (...values: unknown[]) => {
                const bound = prepared.bind(...values);
                return new Proxy(bound, {
                  get(boundStatement, operation) {
                    if (operation === "run") return async () => {
                      intercepted = true;
                      await target.prepare("UPDATE fanmark_licenses SET status = 'grace' WHERE id = ?").bind(ownerLicenseId).run();
                      return boundStatement.run();
                    };
                    const value = Reflect.get(boundStatement, operation);
                    return typeof value === "function" ? value.bind(boundStatement) : value;
                  },
                });
              };
              const value = Reflect.get(prepared, method);
              return typeof value === "function" ? value.bind(prepared) : value;
            },
          });
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await request(`/api/me/fanmarks/${ownerFanmarkId}/profile`, {
      method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ bio: "Must not be saved" }),
    }, { FANMARK_DB: racedDatabase });
    expect(intercepted).toBe(true);
    expect(response.status).toBe(404);
    expect(await businessDatabase!.prepare("SELECT bio FROM fanmark_profiles WHERE license_id = ?")
      .bind(ownerLicenseId).first()).toEqual({ bio: "Saved biography" });
    expect(await accessGeneration(ownerLicenseId)).toBe(generationBefore);
  });

  it("revokes warmed owner sessions after suspension without changing profiles or access generations", async () => {
    const ownerCookie = await signIn(ownerEmail);
    const otherCookie = await signIn(otherEmail);
    const path = `/api/me/fanmarks/${ownerFanmarkId}/profile`;
    expect((await request(path, { headers: { Cookie: ownerCookie } })).status).toBe(200);
    const profilesBefore = (await businessDatabase!.prepare("SELECT * FROM fanmark_profiles ORDER BY id").all()).results;
    const versionsBefore = (await businessDatabase!.prepare("SELECT * FROM fanmark_access_versions ORDER BY license_id").all()).results;

    // Model the committed revocation state; admin MFA and audit atomicity are
    // covered by the dedicated user-management suite.
    await authDatabase!.batch([
      authDatabase!.prepare('UPDATE "user" SET banned = 1, banExpires = NULL WHERE id = ?').bind(ownerId),
      authDatabase!.prepare('DELETE FROM "session" WHERE userId = ?').bind(ownerId),
    ]);
    expect((await request(path, { headers: { Cookie: ownerCookie } })).status).toBe(401);
    expect((await request(path, {
      method: "PATCH", headers: { Cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Revoked owner", bio: "Must not be saved", is_public: false }),
    })).status).toBe(401);
    expect((await businessDatabase!.prepare("SELECT * FROM fanmark_profiles ORDER BY id").all()).results).toEqual(profilesBefore);
    expect((await businessDatabase!.prepare("SELECT * FROM fanmark_access_versions ORDER BY license_id").all()).results).toEqual(versionsBefore);

    const other = await request(`/api/me/fanmarks/${otherFanmarkId}/profile`, { headers: { Cookie: otherCookie } });
    expect(other.status).toBe(200);
    expect(await other.json()).toMatchObject({ licenseId: otherLicenseId, profile: null });
    const blocked = await request("/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password }),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: "BANNED_USER" });
    expect(await authDatabase!.prepare('SELECT count(*) AS count FROM "session" WHERE userId = ?').bind(ownerId).first())
      .toEqual({ count: 0 });
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

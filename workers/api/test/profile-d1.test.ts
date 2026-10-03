import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import signupCommandSql from "../migrations/0007_auth_signup_command.sql?raw";
import suspensionSql from "../migrations/0008_auth_user_suspension.sql?raw";
import oauthSignupSql from "../migrations/0009_auth_oauth_signup.sql?raw";
import { checkedInSqlStatements } from "./schema-statements";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

declare module "vitest" {
  export interface ProvidedContext { businessProfileMigrations: Array<{ name: string; sql: string }>; }
}

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const avatarBucket = runtimeEnv.AVATARS_BUCKET;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const otherId = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const ownerProfileId = "c4c3f3db-e13e-4598-8ae8-5ded9c72f31d";
const otherProfileId = "b1d7af09-9fd6-4ce3-b65c-6f91609f954b";
const invitationId = "a148676c-df55-46a7-b1a0-aee3f4359c5d";
const ownerEmail = "profile-owner@example.invalid";
const otherEmail = "profile-other@example.invalid";
const password = "Synthetic-Profile-Only!2026";
const now = "2026-09-25T00:00:00.000Z";
const pngBytes = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"),
  (character) => character.charCodeAt(0),
);

async function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

async function removeSyntheticAvatar(): Promise<void> {
  if (!avatarBucket) throw new Error("AVATARS_BUCKET binding unavailable");
  let cursor: string | undefined;
  do {
    const page = await avatarBucket.list({ cursor, prefix: `${ownerId}/` });
    await Promise.all(page.objects.map((object) => avatarBucket.delete(object.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function signIn(email: string, signInPassword = password): Promise<string> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: signInPassword }),
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
  await businessDatabase.prepare("DELETE FROM user_settings WHERE user_id IN (?, ?)").bind(ownerId, otherId).run();
  await businessDatabase.prepare("DELETE FROM invitation_codes WHERE id = ?").bind(invitationId).run();
  await businessDatabase.prepare(`INSERT INTO invitation_codes (id, code, created_at, updated_at)
    VALUES (?, 'owner-invite-code', ?, ?)`).bind(invitationId, now, now).run();
  for (const [id, email, name] of [
    [ownerId, ownerEmail, "Profile Owner"],
    [otherId, otherEmail, "Profile Other"],
  ]) {
    await authDatabase.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await authDatabase.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, bcrypt.hashSync(password, 10), now, now).run();
  }
  await businessDatabase.prepare(
    "INSERT INTO user_settings (id, user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at, invited_by_code, requires_password_setup, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 'creator', 'en', ?, ?, ?, 1, ?)",
  ).bind(ownerProfileId, ownerId, "profile-owner", "Old Owner Name", "https://old-avatar.example.test/profile.png", now, now, "owner-invite-code", "cus_synthetic_owner").run();
  await businessDatabase.prepare(
    "INSERT INTO user_settings (id, user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at, requires_password_setup) VALUES (?, ?, ?, ?, NULL, 'free', 'ja', ?, ?, 0)",
  ).bind(otherProfileId, otherId, "profile-other", "Other Private Name", now, now).run();
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase || !avatarBucket) throw new Error("Split D1/R2 bindings unavailable");
  for (const sql of [authSchemaSql, signupCommandSql, suspensionSql, oauthSignupSql]) {
    await authDatabase.batch(checkedInSqlStatements(sql).map((statement) => authDatabase.prepare(statement)));
  }
  const migrations = inject("businessProfileMigrations");
  expect(migrations).toHaveLength(25);
  for (const migration of migrations) {
    await businessDatabase.batch(checkedInSqlStatements(migration.sql).map((statement) => businessDatabase.prepare(statement)));
  }
});

beforeEach(async () => {
  await removeSyntheticAvatar();
  await resetRows();
});

afterEach(async () => {
  expect((await authDatabase!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect((await businessDatabase!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

describe("Better Auth own-profile API", () => {
  it("projects an imported avatar through actual R2 and preserves its stored URL on an unchanged form save", async () => {
    const source = "https://synthetic-source.example.invalid";
    const key = `${ownerId}/1700000000000.jpg`;
    const original = `${source}/storage/v1/object/public/avatars/${key}`;
    const mapping = { STORAGE_LEGACY_ORIGIN: source, STORAGE_PUBLIC_BASE_URL: apiBase };
    await businessDatabase!.prepare("UPDATE user_settings SET avatar_url=? WHERE user_id=?").bind(original, ownerId).run();
    await avatarBucket!.put(key, pngBytes, { httpMetadata: { contentType: "image/png" } });
    const cookie = await signIn(ownerEmail);
    const read = await request("/api/me/profile", { headers: { Cookie: cookie } }, mapping);
    expect(read.status).toBe(200);
    const result = await read.json() as { profile: { avatar_url: string } };
    expect(result.profile.avatar_url).toBe(`${apiBase}/api/storage/public/avatars/${key}`);
    const image = await request(result.profile.avatar_url.slice(apiBase.length));
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes);
    const patch = await request("/api/me/profile", { method: "PATCH", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Imported image owner", avatar_url: result.profile.avatar_url }) }, mapping);
    expect(patch.status).toBe(200);
    expect((await businessDatabase!.prepare("SELECT avatar_url FROM user_settings WHERE user_id=?").bind(ownerId).first())!.avatar_url).toBe(original);
    expect((await request("/api/me/profile", {}, mapping)).status).toBe(401);
  });

  it("returns only the authenticated user's public profile fields", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/profile", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    const body = await response.json() as { schemaVersion: number; profile: Record<string, unknown> };
    expect(body.schemaVersion).toBe(1);
    expect(body.profile).toMatchObject({
      id: ownerProfileId,
      user_id: ownerId,
      username: "profile-owner",
      display_name: "Old Owner Name",
      avatar_url: "https://old-avatar.example.test/profile.png",
      plan_type: "creator",
      preferred_language: "en",
      requires_password_setup: true,
    });
    expect(body.profile).not.toHaveProperty("stripe_customer_id");
    expect(body.profile).not.toHaveProperty("invited_by_code");
    expect(JSON.stringify(body)).not.toContain(otherEmail);
    expect(JSON.stringify(body)).not.toContain("Other Private Name");
  });

  it("checks username availability against D1 and excludes only the Better Auth owner", async () => {
    const cookie = await signIn(ownerEmail);
    const own = await request("/api/me/username-availability?username=profile-owner", { headers: { Cookie: cookie } });
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(own.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await own.json()).toEqual({ schemaVersion: 1, available: true });

    const other = await request("/api/me/username-availability?username=profile-other", { headers: { Cookie: cookie } });
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ schemaVersion: 1, available: false });

    const caseInsensitive = await request("/api/me/username-availability?username=PROFILE-OTHER", { headers: { Cookie: cookie } });
    expect(caseInsensitive.status).toBe(200);
    expect(await caseInsensitive.json()).toEqual({ schemaVersion: 1, available: false });

    const empty = await request("/api/me/username-availability?username=", { headers: { Cookie: cookie } });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ schemaVersion: 1, available: false });
  });

  it("requires an authenticated owner and rejects ambiguous or unsupported availability requests", async () => {
    const anonymous = await request("/api/me/username-availability?username=profile-other");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");

    const cookie = await signIn(ownerEmail);
    expect((await request("/api/me/username-availability?username=one&username=two", { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request(`/api/me/username-availability?username=one&userId=${otherId}`, { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request(`/api/me/username-availability?username=${"x".repeat(257)}`, { headers: { Cookie: cookie } })).status).toBe(400);
    expect((await request("/api/me/username-availability?username=candidate", { method: "POST", headers: { Cookie: cookie } })).status).toBe(405);
    expect((await request("/api/me/username-availability?username=candidate", { headers: { Origin: "https://attacker.example.test", Cookie: cookie } })).status).toBe(403);
    expect((await request("/api/me/username-availability?username=candidate", { headers: { Cookie: cookie } }, { PROFILE_BACKEND: undefined })).status).toBe(503);
  });

  it("updates only editable fields for the signed-in identity", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "  New Owner  ", preferred_language: "ja" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { profile: Record<string, unknown> };
    expect(body.profile).toMatchObject({ display_name: "  New Owner  ", preferred_language: "ja", plan_type: "creator" });
    const rows = await businessDatabase?.prepare(
      "SELECT user_id, display_name, preferred_language, plan_type, invited_by_code, requires_password_setup, stripe_customer_id FROM user_settings ORDER BY user_id",
    ).all();
    expect(rows?.results).toEqual([
      { user_id: otherId, display_name: "Other Private Name", preferred_language: "ja", plan_type: "free", invited_by_code: null, requires_password_setup: 0, stripe_customer_id: null },
      { user_id: ownerId, display_name: "  New Owner  ", preferred_language: "ja", plan_type: "creator", invited_by_code: "owner-invite-code", requires_password_setup: 1, stripe_customer_id: "cus_synthetic_owner" },
    ]);
    const timestamp = await businessDatabase?.prepare("SELECT updated_at FROM user_settings WHERE user_id = ?")
      .bind(ownerId).first<{ updated_at: string }>();
    expect(timestamp?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
  });

  it("accepts only same-owner R2 avatar URLs and null removal", async () => {
    const cookie = await signIn(ownerEmail);
    const goodAvatar = `${apiBase}/api/storage/public/avatars/${ownerId}/e62ce4d0-8055-4ecb-9e3a-759d70d659e0.png`;
    const updated = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: goodAvatar }),
    });
    expect(updated.status).toBe(200);
    const forbidden = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: `${apiBase}/api/storage/public/avatars/${otherId}/e62ce4d0-8055-4ecb-9e3a-759d70d659e0.png` }),
    });
    expect(forbidden.status).toBe(400);
    const removed = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: null }),
    });
    expect(removed.status).toBe(200);
    expect((await removed.json() as { profile: Record<string, unknown> }).profile.avatar_url).toBeNull();
  });

  it("connects an authenticated R2 avatar upload to the owner's profile and removes both", async () => {
    const cookie = await signIn(ownerEmail);
    const uploaded = await request("/api/storage/object/avatars", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "image/png" },
      body: pngBytes,
    });
    expect(uploaded.status).toBe(201);
    const stored = await uploaded.json() as { path: string; publicUrl: string };
    expect(stored.path).toMatch(new RegExp(`^${ownerId}/[0-9a-f-]+\\.png$`, "iu"));
    expect(new URL(stored.publicUrl).origin).toBe(apiBase);

    const publicRead = await request(new URL(stored.publicUrl).pathname, {}, { STORAGE_BACKEND: "r2" });
    expect(publicRead.status).toBe(200);
    expect(new Uint8Array(await publicRead.arrayBuffer())).toEqual(pngBytes);

    const saved = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: stored.publicUrl }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json() as { profile: Record<string, unknown> }).profile.avatar_url).toBe(stored.publicUrl);
    const readback = await request("/api/me/profile", { headers: { Cookie: cookie } });
    expect((await readback.json() as { profile: Record<string, unknown> }).profile.avatar_url).toBe(stored.publicUrl);

    const wrongOwnerUrl = `${apiBase}/api/storage/public/avatars/${otherId}/${stored.path.split("/")[1]}`;
    const denied = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: wrongOwnerUrl }),
    });
    expect(denied.status).toBe(400);
    const unchanged = await request("/api/me/profile", { headers: { Cookie: cookie } });
    expect((await unchanged.json() as { profile: Record<string, unknown> }).profile.avatar_url).toBe(stored.publicUrl);

    const deleted = await request(`/api/storage/object/avatars/${stored.path}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(204);
    const cleared = await request("/api/me/profile", {
      method: "PATCH",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: null }),
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json() as { profile: Record<string, unknown> }).profile.avatar_url).toBeNull();
    expect(await avatarBucket?.head(stored.path)).toBeNull();
    const missing = await request(new URL(stored.publicUrl).pathname, {}, { STORAGE_BACKEND: "r2" });
    expect(missing.status).toBe(404);
    const persisted = await businessDatabase?.prepare("SELECT avatar_url FROM user_settings WHERE user_id = ?").bind(ownerId).first<{ avatar_url: string | null }>();
    expect(persisted?.avatar_url).toBeNull();
  });

  it("rejects identity, billing, privilege fields and invalid payloads without writes", async () => {
    const cookie = await signIn(ownerEmail);
    for (const body of [
      { user_id: otherId, display_name: "attacker" },
      { plan_type: "admin" },
      { stripe_customer_id: "cus_other" },
      { requires_password_setup: false },
      { preferred_language: "fr" },
      {},
    ]) {
      const response = await request("/api/me/profile", {
        method: "PATCH",
        headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const owner = await businessDatabase?.prepare("SELECT display_name, plan_type FROM user_settings WHERE user_id = ?").bind(ownerId).first();
    const other = await businessDatabase?.prepare("SELECT display_name FROM user_settings WHERE user_id = ?").bind(otherId).first();
    expect(owner).toEqual({ display_name: "Old Owner Name", plan_type: "creator" });
    expect(other).toEqual({ display_name: "Other Private Name" });
  });

  it("sets an OAuth user's first password and safely retries after the Auth D1 write", async () => {
    const cookie = await signIn(ownerEmail);
    await authDatabase?.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(ownerId).run();

    const setup = async (newPassword: string, sessionCookie = cookie) => request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });

    const created = await setup("Synthetic-OAuth-Password!2026");
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(200);
    expect(await created.json()).toEqual({ schemaVersion: 1, status: true });
    const setupFlag = await businessDatabase?.prepare(
      "SELECT requires_password_setup, updated_at FROM user_settings WHERE user_id = ?",
    ).bind(ownerId).first<{ requires_password_setup: number; updated_at: string }>();
    expect(setupFlag?.requires_password_setup).toBe(0);
    expect(setupFlag?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);

    const credential = await authDatabase?.prepare(
      'SELECT password FROM "account" WHERE "userId" = ? AND "providerId" = ?',
    ).bind(ownerId, "credential").first<{ password: string }>();
    expect(credential?.password).toEqual(expect.any(String));
    expect(credential?.password).not.toContain("Synthetic-OAuth-Password!2026");

    expect((await signIn(ownerEmail, "Synthetic-OAuth-Password!2026")).length).toBeGreaterThan(0);

    // Model the cross-database partial commit: Auth D1 has the credential but
    // the profile gate still needs clearing. A retry must verify the exact
    // password before completing that D1 update.
    await businessDatabase?.prepare(
      "UPDATE user_settings SET requires_password_setup = 1 WHERE user_id = ?",
    ).bind(ownerId).run();
    expect((await setup("Wrong-Passcode!2026")).status).toBe(409);
    const retained = await businessDatabase?.prepare(
      "SELECT requires_password_setup FROM user_settings WHERE user_id = ?",
    ).bind(ownerId).first<{ requires_password_setup: number }>();
    expect(retained?.requires_password_setup).toBe(1);

    const retried = await setup("Synthetic-OAuth-Password!2026");
    expect(retried.status).toBe(200);
    const cleared = await businessDatabase?.prepare(
      "SELECT requires_password_setup FROM user_settings WHERE user_id = ?",
    ).bind(ownerId).first<{ requires_password_setup: number }>();
    expect(cleared?.requires_password_setup).toBe(0);
  });

  it("requires the owner session, profile gate, JSON contract and an allowed origin for first-password setup", async () => {
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Synthetic-OAuth-Password!2026" }),
    })).status).toBe(401);

    const cookie = await signIn(ownerEmail);
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "short" }),
    })).status).toBe(400);
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "lowercase-password!123" }),
    })).status).toBe(400);
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: ownerId, newPassword: "Synthetic-OAuth-Password!2026" }),
    })).status).toBe(400);
    expect((await request("/api/me/password-setup", {
      method: "GET",
      headers: { Cookie: cookie },
    })).status).toBe(405);
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://attacker.example.test", "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Synthetic-OAuth-Password!2026" }),
    })).status).toBe(403);
    expect((await request("/api/me/password-setup", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Synthetic-OAuth-Password!2026" }),
    }, { PROFILE_BACKEND: undefined })).status).toBe(503);
  });

  it("requires a session and enforces backend, CORS, methods, and a single profile row", async () => {
    expect((await request("/api/me/profile")).status).toBe(401);
    expect((await request("/api/me/profile", { method: "DELETE" })).status).toBe(405);
    expect((await request("/api/me/profile", {}, { PROFILE_BACKEND: undefined })).status).toBe(503);
    expect((await request("/api/me/profile", { headers: { Origin: "https://attacker.example.test" } })).status).toBe(403);
    expect((await request(`/api/me/profile?userId=${otherId}`, { headers: { Cookie: await signIn(ownerEmail) } })).status).toBe(400);
    await businessDatabase?.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(ownerId).run();
    expect((await request("/api/me/profile", { headers: { Cookie: await signIn(ownerEmail) } })).status).toBe(404);
    const options = await request("/api/me/profile", { method: "OPTIONS", headers: { "access-control-request-method": "PATCH" } });
    expect(options.status).toBe(204);
  });
});

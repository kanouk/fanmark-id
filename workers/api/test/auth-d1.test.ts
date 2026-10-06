import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import emojiMasterSchemaSql from "../migrations/0000_emoji_master.sql?raw";
import emojiReleaseSchemaSql from "../migrations/0001_emoji_master_release_staging.sql?raw";
import emojiActivationSchemaSql from "../migrations/0002_emoji_master_release_activation.sql?raw";
import schemaSql from "../migrations/0003_better_auth_core.sql?raw";
import suspensionSchemaSql from "../migrations/0008_auth_user_suspension.sql?raw";
import referenceMasterSchemaSql from "../migrations/0004_reference_master_releases.sql?raw";
import emojiChangeAuditSchemaSql from "../migrations/0008_emoji_master_change_audits.sql?raw";
import emojiAdminGuardsSchemaSql from "../migrations/0005_emoji_master_admin_guards.sql?raw";
import { handleRequest } from "../src";
import { createBetterAuthClient } from "../../../src/lib/better-auth-client";
import { createEmojiMasterAdminD1Repository } from "../src/emoji-master-admin-d1-repository";
import type { Env } from "../src/repository";
import { checkedInSqlStatements } from "./schema-statements";

declare module "vitest" {
  export interface ProvidedContext {
    businessAuthMigrations: Array<{ name: string; sql: string }>;
  }
}

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.AUTH_DB;
const masterDatabase = runtimeEnv.MASTER_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const verifiedUserId = "5c5f9001-449c-4b7f-a01d-284302a71ea1";
const unverifiedUserId = "ad06c38f-c004-4e87-a442-17e35c59187b";
const syntheticAdminFactorId = "80000000-0000-4000-8000-000000000001";
const verifiedEmail = "auth-worker@example.invalid";
const unverifiedEmail = "unverified-worker@example.invalid";
const password = "Synthetic-Auth-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);
const socialPolicyEnv: Partial<Env> = {
  AUTH_SOCIAL_BACKEND: "better-auth",
  GOOGLE_OAUTH_CLIENT_ID: "synthetic-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-google-client-secret",
  GITHUB_OAUTH_CLIENT_ID: "synthetic-github-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "synthetic-github-client-secret",
  DISCORD_OAUTH_CLIENT_ID: "synthetic-discord-client-id",
  DISCORD_OAUTH_CLIENT_SECRET: "synthetic-discord-client-secret",
  APPLE_OAUTH_CLIENT_ID: "synthetic-apple-client-id",
  APPLE_OAUTH_CLIENT_SECRET: "synthetic-apple-client-secret",
};

async function authPolicyCounts() {
  return database!.prepare(`SELECT
    (SELECT count(*) FROM "user") AS users,
    (SELECT count(*) FROM "account") AS accounts,
    (SELECT count(*) FROM "session") AS sessions,
    (SELECT count(*) FROM "verification") AS verifications`).first();
}

function decodeBase32(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value.toUpperCase().replace(/=+$/u, "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid synthetic TOTP secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

async function createTotpCode(secret: string, now = Date.now()): Promise<string> {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(now / 30_000)));
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return String(value).padStart(6, "0");
}

function splitMigrationStatements(sql: string): string[] {
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
    const candidate = sql.slice(start, index).trim();
    const isTrigger = /^create\s+trigger\b/iu.test(candidate);
    if (isTrigger && !/\bend\s*$/iu.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function authRequest(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}/api/auth${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

async function adminSessionRequest(
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}/api/admin/session`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

async function emojiMasterAdminRequest(
  path = "",
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}/api/admin/emoji-master${path}`, { ...init, headers }),
    { ...runtimeEnv, ...overrides },
  );
}

async function referenceMasterAdminRequest(
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}/api/admin/reference-masters/pricing`, { ...init, headers }),
    { ...runtimeEnv, REFERENCE_MASTER_ADMIN_BACKEND: "d1", ...overrides },
  );
}

async function notificationMasterAdminRequest(
  path = "/rules",
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}/api/admin/notification-masters${path}`, { ...init, headers }),
    { ...runtimeEnv, NOTIFICATION_MASTER_BACKEND: "d1", ...overrides },
  );
}

function jsonBody(body: unknown, method = "POST", cookie?: string): RequestInit {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  return { method, headers, body: JSON.stringify(body) };
}

async function seedPublishedEmoji(): Promise<{ id: string; releaseVersion: string }> {
  if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
  const id = crypto.randomUUID();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(crypto.randomUUID())));
  const releaseVersion = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  await masterDatabase.batch([
    masterDatabase.prepare(
      "INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, "👋", "wave", JSON.stringify(["wave", "hello"]), "People & Body", "hand-fingers-open", JSON.stringify(["1F44B"]), 1, now, now),
    masterDatabase.prepare(
      "INSERT INTO fanmark_emoji_master_release_imports (release_version, manifest_json, row_count, status, created_at) VALUES (?, ?, 1, 'loading', ?)",
    ).bind(releaseVersion, JSON.stringify({ version: releaseVersion }), now),
    masterDatabase.prepare(
      "INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(releaseVersion, id, "👋", "wave", JSON.stringify(["wave", "hello"]), "People & Body", "hand-fingers-open", JSON.stringify(["1F44B"]), 1),
    masterDatabase.prepare(
      "UPDATE fanmark_emoji_master_release_imports SET status = 'ready', verified_at = ? WHERE release_version = ? AND status = 'loading'",
    ).bind(now, releaseVersion),
  ]);
  const active = await masterDatabase.prepare(
    "SELECT release_version, generation FROM fanmark_emoji_master_active_release WHERE singleton_id = 1",
  ).first<{ release_version?: unknown; generation?: unknown }>();
  const activationId = crypto.randomUUID();
  if (active) {
    await masterDatabase.prepare(
      "UPDATE fanmark_emoji_master_active_release SET release_version = ?, previous_release_version = ?, activation_id = ?, action = 'promotion', generation = ?, updated_at = ? WHERE singleton_id = 1 AND release_version = ? AND generation = ?",
    ).bind(releaseVersion, active.release_version, activationId, Number(active.generation) + 1, now, active.release_version, active.generation).run();
  } else {
    await masterDatabase.prepare(
      "INSERT INTO fanmark_emoji_master_active_release (singleton_id, release_version, previous_release_version, activation_id, action, generation, updated_at) VALUES (1, ?, NULL, ?, 'promotion', 1, ?)",
    ).bind(releaseVersion, activationId, now).run();
  }
  return { id, releaseVersion };
}

async function signInAndGetSession(): Promise<{ cookie: string; sessionId: string }> {
  const signIn = await authRequest("/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: verifiedEmail, password }),
  });
  if (signIn.status !== 200) throw new Error("synthetic sign-in failed");
  const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("synthetic session cookie missing");
  const sessionResponse = await authRequest("/get-session", { headers: { cookie } });
  if (sessionResponse.status !== 200) throw new Error("synthetic session read failed");
  const sessionBody = await sessionResponse.json() as { session?: { id?: unknown } };
  if (typeof sessionBody.session?.id !== "string") throw new Error("synthetic session ID missing");
  return { cookie, sessionId: sessionBody.session.id };
}

function setCookiePair(response: Response, nameFragment: string): string | null {
  return (response.headers.get("set-cookie") ?? "")
    .split(/,(?=[^;,]+=)/u)
    .map((entry) => entry.trim().split(";", 1)[0])
    .find((entry) => entry.includes(nameFragment)) ?? null;
}

async function grantSyntheticAdminRoleAndMfa(sessionId: string): Promise<void> {
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  const now = new Date().toISOString();
  await database.batch([
    database.prepare('INSERT OR REPLACE INTO "adminRole" ("userId", "role") VALUES (?, ?)')
      .bind(verifiedUserId, "admin"),
    database.prepare('UPDATE "user" SET "twoFactorEnabled" = 1 WHERE "id" = ?')
      .bind(verifiedUserId),
    database.prepare(
      'INSERT INTO "twoFactor" ("id", "secret", "backupCodes", "userId", "verified") VALUES (?, ?, ?, ?, 1)',
    ).bind(syntheticAdminFactorId, "synthetic-only-totp-secret", "[]", verifiedUserId),
  ]);
  const generation = await database
    .prepare('SELECT "generation" FROM "mfaGeneration" WHERE "id" = 1')
    .first<{ generation?: unknown }>();
  if (typeof generation?.generation !== "number") throw new Error("synthetic MFA generation missing");
  await database.prepare(
    'INSERT INTO "mfaAssurance" ("id", "userId", "sessionId", "factorId", "generation", "verifiedAt", "expiresAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    crypto.randomUUID(),
    verifiedUserId,
    sessionId,
    syntheticAdminFactorId,
    generation.generation,
    now,
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
}

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  if (!businessDatabase) throw new Error("FANMARK_DB binding is unavailable");
  await businessDatabase.batch([
    businessDatabase.prepare("DELETE FROM system_settings WHERE setting_key IN ('social_login_enabled', 'invitation_mode')"),
    businessDatabase.prepare(`INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
      VALUES ('social_login_enabled', 'true', ?, ?), ('invitation_mode', 'false', ?, ?)`)
      .bind(...Array(4).fill("2026-10-03T00:00:00.000000Z")),
  ]);
  await database.prepare('DELETE FROM "adminUserStatusAudit" WHERE "targetUserId" IN (?, ?)')
    .bind(verifiedUserId, unverifiedUserId).run();
  await database.batch([
    database.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(verifiedUserId, unverifiedUserId),
  ]);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(verifiedUserId, "Synthetic Auth Worker User", verifiedEmail, now, now),
    database.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${verifiedUserId}-account`, verifiedUserId, "credential", verifiedUserId, passwordHash, now, now),
    database.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(unverifiedUserId, "Synthetic Unverified User", unverifiedEmail, now, now),
    database.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${unverifiedUserId}-account`, unverifiedUserId, "credential", unverifiedUserId, passwordHash, now, now),
  ]);
}

async function sessionCount(userId: string): Promise<number> {
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  const row = await database
    .prepare('SELECT count(*) AS "count" FROM "session" WHERE "userId" = ?')
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function createSyntheticIdToken(
  issuer: string,
  audience: string,
  subject: string,
  email: string,
  emailVerified = true,
): Promise<string> {
  const keyPair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: Uint8Array.of(1, 0, 1),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const claims = {
    iss: issuer,
    aud: audience,
    sub: subject,
    email,
    email_verified: emailVerified,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const header = base64Url(new TextEncoder().encode(JSON.stringify({
    alg: "RS256",
    kid: "synthetic-oauth-key",
    typ: "JWT",
  })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  ));
  return `${signingInput}.${base64Url(signature)}`;
}

beforeAll(async () => {
  if (!businessDatabase) throw new Error("FANMARK_DB binding is unavailable");
  const businessMigrations = inject("businessAuthMigrations");
  expect(businessMigrations).toHaveLength(26);
  for (const migration of businessMigrations) {
    await businessDatabase.batch(
      checkedInSqlStatements(migration.sql).map(statement => businessDatabase.prepare(statement)),
    );
  }
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  await database.batch(
    splitMigrationStatements(schemaSql).map((statement) => database.prepare(statement)),
  );
  await database.batch(
    splitMigrationStatements(suspensionSchemaSql.replace(/^--.*(?:\r?\n|$)/gmu, ""))
      .map((statement) => database.prepare(statement)),
  );
  if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
  const masterMigrations = [
    emojiMasterSchemaSql,
    emojiReleaseSchemaSql,
    emojiActivationSchemaSql,
    schemaSql,
    referenceMasterSchemaSql,
    emojiAdminGuardsSchemaSql,
    emojiChangeAuditSchemaSql,
  ];
  for (const migration of masterMigrations) {
    const statements = splitMigrationStatements(migration.replace(/^--.*(?:\r?\n|$)/gmu, ""))
      .filter((statement) => statement.replace(/^\s*--.*$/gmu, "").trim().length > 0);
    if (statements.length > 0) {
      await masterDatabase.batch(statements.map((statement) => masterDatabase.prepare(statement)));
    }
  }
});

beforeEach(resetFixture);

describe("Better Auth through the application Worker", () => {
  it("revokes the real D1 session when the frontend client signs out", async () => {
    const { cookie } = await signInAndGetSession();
    expect(await sessionCount(verifiedUserId)).toBe(1);
    let signOutResponse: Response | undefined;
    const client = createBetterAuthClient({
      baseUrl: apiBase,
      fetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Origin", appOrigin);
        headers.set("Cookie", cookie);
        // Network delivery can expose an empty POST body as a stream. A null
        // in-process body bypasses Better Call's media-type validation.
        signOutResponse = await handleRequest(new Request(String(input), {
          ...init, headers, body: init?.body ?? new Uint8Array(0),
        }), runtimeEnv);
        return signOutResponse;
      },
    });

    await client.signOut();

    expect(signOutResponse?.status).toBe(200);
    expect(signOutResponse?.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await sessionCount(verifiedUserId)).toBe(0);
    const staleSession = await authRequest("/get-session", { headers: { cookie } });
    expect(staleSession.status).toBe(200);
    expect(await staleSession.json()).toBeNull();
  });

  it("serves the public auth health check without constructing an auth session", async () => {
    const response = await authRequest("/ok");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(appOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await response.json()).toEqual({ ok: true });
    expect(await sessionCount(verifiedUserId)).toBe(0);
  });

  it("logs in a synthetic verified account and reads the resulting session", async () => {
    const response = await authRequest("/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedEmail, password }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(appOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    const body = await response.json() as { user: { id: string; email: string } };
    expect(body.user).toMatchObject({ id: verifiedUserId, email: verifiedEmail });
    expect(await sessionCount(verifiedUserId)).toBe(1);

    const setCookie = response.headers.get("set-cookie");
    const cookie = setCookie?.split(";")[0];
    expect(cookie).toMatch(/(?:__Secure-)?better-auth\.session_token=/iu);
    const sessionResponse = await authRequest("/get-session", {
      headers: { cookie: cookie ?? "" },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionBody = await sessionResponse.json() as { user: { id: string } };
    expect(sessionBody.user.id).toBe(verifiedUserId);
  });

  it("rejects a wrong password and unverified email without issuing a session", async () => {
    const wrongPassword = await authRequest("/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedEmail, password: `${password}-wrong` }),
    });
    expect(wrongPassword.status).toBe(401);

    const unverified = await authRequest("/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: unverifiedEmail, password }),
    });
    expect(unverified.status).toBe(403);
    expect(await sessionCount(verifiedUserId)).toBe(0);
    expect(await sessionCount(unverifiedUserId)).toBe(0);
  });

  it("rejects new sign-ins while suspended and does not create a session", async () => {
    await database!.prepare('UPDATE "user" SET "banned" = 1, "banReason" = ?, "banExpires" = ? WHERE "id" = ?')
      .bind("synthetic suspension", new Date(Date.now() + 60_000).toISOString(), verifiedUserId).run();
    const response = await authRequest("/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedEmail, password }),
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { code?: string }).code).toBe("BANNED_USER");
    expect(await sessionCount(verifiedUserId)).toBe(0);
  });

  it("clears an expired suspension before allowing sign-in", async () => {
    await database!.prepare('UPDATE "user" SET "banned" = 1, "banReason" = ?, "banExpires" = ? WHERE "id" = ?')
      .bind("expired synthetic suspension", "2020-01-01T00:00:00.000Z", verifiedUserId).run();
    const response = await authRequest("/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedEmail, password }),
    });
    expect(response.status).toBe(200);
    expect(await sessionCount(verifiedUserId)).toBe(1);
    expect(await database!.prepare('SELECT "banned", "banReason", "banExpires" FROM "user" WHERE "id" = ?')
      .bind(verifiedUserId).first()).toEqual({ banned: 0, banReason: null, banExpires: null });
  });

  it("uses the Auth D1 session trigger to close the sign-in/suspension race", async () => {
    await database!.prepare('UPDATE "user" SET "banned" = 1, "banExpires" = ? WHERE "id" = ?')
      .bind(new Date(Date.now() + 60_000).toISOString(), verifiedUserId).run();
    await expect(database!.prepare(`INSERT INTO "session" ("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("race-session", "race-token", verifiedUserId, new Date(Date.now() + 60_000).toISOString(),
        new Date().toISOString(), new Date().toISOString()).run()).rejects.toThrow(/BANNED_USER/u);
    expect(await sessionCount(verifiedUserId)).toBe(0);
  });

  it("keeps invitation, email-delivery, and OAuth entry points closed", async () => {
    const closedPaths = [
      "/sign-up/email",
      "/sign-up/username",
      "/sign-in/social",
      "/link-social",
      "/unlink-account",
      "/change-email",
      "/delete-user",
      "/forget-password",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/verify-email",
      "/callback/google",
      "/reset-password/synthetic-token",
    ];
    for (const path of closedPaths) {
      const response = await authRequest(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "blocked@example.invalid", password }),
      });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toEqual({ error: "auth_flow_unavailable" });
    }
    expect(await sessionCount(verifiedUserId)).toBe(0);
    const count = await database
      ?.prepare('SELECT count(*) AS "count" FROM "user" WHERE "email" = ?')
      .bind("blocked@example.invalid")
      .first<{ count: number }>();
    expect(Number(count?.count ?? 0)).toBe(0);
  });

  it("exposes email capabilities and reset routes only when Resend is configured", async () => {
    const unconfigured = await authRequest("/capabilities", { method: "GET" });
    expect(await unconfigured.json()).toEqual({
      emailVerification: false,
      passwordReset: false,
      signUp: false,
      invitationRequired: false,
      socialProviders: [],
    });

    const emailEnv = {
      AUTH_EMAIL_BACKEND: "resend",
      RESEND_API_KEY: "synthetic-resend-api-key-012345",
      RESEND_FROM_EMAIL: "Fanmark <auth@example.test>",
    };
    const configured = await authRequest("/capabilities", { method: "GET" }, emailEnv);
    expect(await configured.json()).toEqual({
      emailVerification: true,
      passwordReset: true,
      signUp: false,
      invitationRequired: false,
      socialProviders: [],
    });

    const email = `missing-${crypto.randomUUID()}@example.invalid`;
    const resetRequest = await authRequest("/request-password-reset", jsonBody({
      email,
      redirectTo: `${appOrigin}/reset-password`,
    }), emailEnv);
    expect(resetRequest.status).toBe(200);
    expect(JSON.stringify(await resetRequest.json())).not.toContain(email);

    const resetLink = await authRequest(
      "/reset-password/synthetic-reset-token-1234567890?callbackURL=https%3A%2F%2Fapp.example.test%2Freset-password",
      { method: "GET" },
      emailEnv,
    );
    expect(resetLink.status).not.toBe(403);

    const signup = await authRequest("/sign-up/email", jsonBody({
      email: `signup-${crypto.randomUUID()}@example.invalid`,
      password,
      name: "Synthetic user",
    }), emailEnv);
    expect(signup.status).toBe(403);
    expect(await signup.json()).toEqual({ error: "auth_flow_unavailable" });
  });

  it("sends Better Auth password reset through the configured Resend callback without returning its token", async () => {
    const emailEnv = {
      AUTH_EMAIL_BACKEND: "resend",
      RESEND_API_KEY: "synthetic-resend-api-key-012345",
      RESEND_FROM_EMAIL: "Fanmark <auth@example.test>",
    };
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ id: "synthetic-resend-message" });
    });
    try {
      const response = await authRequest("/request-password-reset", jsonBody({
        email: verifiedEmail,
        redirectTo: `${apiBase}/reset-password`,
      }), emailEnv);
      expect(response.status).toBe(200);
      const responseBody = await response.text();
      expect(responseBody).not.toContain(verifiedEmail);
      expect(responseBody).not.toMatch(/token=[A-Za-z0-9._~-]+/u);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        from: "Fanmark <auth@example.test>",
        to: [verifiedEmail],
        subject: "fanmark.id パスワードの再設定",
      });
      expect(String(sent[0]?.text)).toMatch(/https:\/\/api\.example\.test\/api\/auth\/reset-password\/[A-Za-z0-9._~-]{16,512}/u);
      expect(String(sent[0]?.text)).toContain(encodeURIComponent(`${apiBase}/reset-password`));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["/send-verification-email", "signup", unverifiedEmail],
    ["/request-password-reset", "recovery", verifiedEmail],
  ])("uses selected D1 copy through the actual %s callback and invalidates cached template configuration", async (route, emailType, email) => {
    const emailEnv: Partial<Env> = {
      AUTH_EMAIL_BACKEND: "resend",
      AUTH_EMAIL_TEMPLATE_BACKEND: "",
      RESEND_API_KEY: "synthetic-resend-api-key-012345",
      RESEND_FROM_EMAIL: "Fanmark <auth@example.test>",
    };
    const body = route === "/send-verification-email"
      ? { email, callbackURL: `${apiBase}/` }
      : { email, redirectTo: `${apiBase}/reset-password` };
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ id: "synthetic-resend-message" });
    });
    try {
      expect((await authRequest(route, jsonBody(body), emailEnv)).status).toBe(200);
      expect(sent).toHaveLength(1);
      const now = new Date().toISOString();
      await businessDatabase!.prepare(`INSERT INTO email_templates
        (email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES (?, 'ja', ?, 'D1 <確認>&本文', 'D1アクション', 1, ?, ?)
        ON CONFLICT(email_type, language) DO UPDATE SET subject=excluded.subject,
          body_text=excluded.body_text, button_text=excluded.button_text, is_active=1`)
        .bind(emailType, `D1 ${emailType}`, now, now).run();
      const d1Env = { ...emailEnv, AUTH_EMAIL_TEMPLATE_BACKEND: "d1", D1_TOPOLOGY: "split" };
      expect((await authRequest(route, jsonBody(body), d1Env)).status).toBe(200);
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ to: [email], subject: `D1 ${emailType}` });
      expect(String(sent[1]?.html)).toContain("D1 &lt;確認&gt;&amp;本文");
      expect(String(sent[1]?.text)).toContain("D1アクション");
      await businessDatabase!.prepare("UPDATE email_templates SET is_active=0 WHERE email_type=? AND language='ja'")
        .bind(emailType).run();
      await authRequest(route, jsonBody(body), d1Env);
      expect(sent).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["social_login_enabled", "false"],
    ["invitation_mode", "true"],
  ])("enforces the OAuth policy when %s=%s without email readiness", async (key, value) => {
    await businessDatabase!.prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = ?")
      .bind(value, key).run();
    const counts = await authPolicyCounts();
    const unexpectedFetch = vi.fn(async () => { throw new Error("OAuth policy must stop provider traffic"); });
    vi.stubGlobal("fetch", unexpectedFetch);
    try {
      const capabilities = await authRequest("/capabilities", { method: "GET" }, socialPolicyEnv);
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toMatchObject({ emailVerification: false, socialProviders: [] });
      for (const provider of ["google", "github", "discord", "apple"]) {
        const start = await authRequest("/sign-in/social", jsonBody({
          provider, callbackURL: `${appOrigin}/auth`,
        }), socialPolicyEnv);
        expect(start.status, `${provider} start`).toBe(403);
        expect(start.headers.get("set-cookie")).toBeNull();
        expect(await start.json()).toEqual({ error: "auth_flow_unavailable" });
        const callback = await authRequest(`/callback/${provider}?code=synthetic-code&state=synthetic-state`, {}, socialPolicyEnv);
        expect(callback.status, `${provider} callback`).toBe(403);
        expect(callback.headers.get("set-cookie")).toBeNull();
      }
      expect(unexpectedFetch).not.toHaveBeenCalled();
      expect(await authPolicyCounts()).toEqual(counts);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["google", "github", "discord", "apple"])("rereads the OAuth policy before the %s callback and after re-enabling", async provider => {
    const start = await authRequest("/sign-in/social", jsonBody({
      provider, callbackURL: `${appOrigin}/auth`, errorCallbackURL: `${appOrigin}/auth`,
    }), socialPolicyEnv);
    expect(start.status).toBe(200);
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const cookie = (start.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=)/u)
      .map(value => value.trim().split(";", 1)[0]).filter(Boolean).join("; ");
    expect(state).toBeTruthy();
    expect(cookie).not.toBe("");
    const counts = await authPolicyCounts();
    await businessDatabase!.prepare("UPDATE system_settings SET setting_value = 'true' WHERE setting_key = 'invitation_mode'").run();
    const unexpectedFetch = vi.fn(async () => { throw new Error("Revoked callback must stop provider traffic"); });
    vi.stubGlobal("fetch", unexpectedFetch);
    try {
      const callback = await authRequest(`/callback/${provider}?${new URLSearchParams({ code: "synthetic-code", state })}`,
        { headers: { cookie } }, socialPolicyEnv);
      expect(callback.status).toBe(403);
      expect(callback.headers.get("set-cookie")).toBeNull();
      expect(unexpectedFetch).not.toHaveBeenCalled();
      expect(await authPolicyCounts()).toEqual(counts);
      const disabled = await authRequest("/capabilities", {}, socialPolicyEnv);
      expect(await disabled.json()).toMatchObject({ socialProviders: [] });
      await businessDatabase!.prepare("UPDATE system_settings SET setting_value = 'false' WHERE setting_key = 'invitation_mode'").run();
      const enabled = await authRequest("/capabilities", {}, socialPolicyEnv);
      expect(await enabled.json()).toMatchObject({ socialProviders: ["apple", "discord", "github", "google"] });
      const retry = await authRequest("/sign-in/social", jsonBody({ provider, callbackURL: `${appOrigin}/auth` }), socialPolicyEnv);
      expect(retry.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['"true"', '"false"'],
    ["on", "off"],
    ["1", "0"],
  ])("accepts supported policy encodings %s/%s", async (enabled, invitation) => {
    await businessDatabase!.batch([
      businessDatabase!.prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'social_login_enabled'").bind(enabled),
      businessDatabase!.prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'invitation_mode'").bind(invitation),
    ]);
    const capabilities = await authRequest("/capabilities", {}, socialPolicyEnv);
    expect(await capabilities.json()).toMatchObject({ socialProviders: ["apple", "discord", "github", "google"] });
    const start = await authRequest("/sign-in/social", jsonBody({ provider: "google", callbackURL: `${appOrigin}/auth` }), socialPolicyEnv);
    expect(start.status).toBe(200);
  });

  it.each(["missing", "malformed", "binding", "read-error"])("closes OAuth when its policy is %s", async condition => {
    let overrides = socialPolicyEnv;
    if (condition === "missing") {
      await businessDatabase!.prepare("DELETE FROM system_settings WHERE setting_key = 'invitation_mode'").run();
    } else if (condition === "malformed") {
      await businessDatabase!.prepare("UPDATE system_settings SET setting_value = 'perhaps' WHERE setting_key = 'social_login_enabled'").run();
    } else if (condition === "binding") {
      overrides = { ...socialPolicyEnv, FANMARK_DB: undefined };
    } else {
      overrides = { ...socialPolicyEnv, FANMARK_DB: new Proxy(businessDatabase!, {
        get(target, property) {
          if (property === "prepare") return () => { throw new Error("Synthetic policy read failure"); };
          return Reflect.get(target, property);
        },
      }) };
    }
    const counts = await authPolicyCounts();
    const capabilities = await authRequest("/capabilities", {}, overrides);
    expect(await capabilities.json()).toMatchObject({ socialProviders: [] });
    const start = await authRequest("/sign-in/social", jsonBody({ provider: "google", callbackURL: `${appOrigin}/auth` }), overrides);
    expect(start.status).toBe(403);
    const callback = await authRequest("/callback/google?code=synthetic-code&state=synthetic-state", {}, overrides);
    expect(callback.status).toBe(403);
    expect(await authPolicyCounts()).toEqual(counts);
  });

  it("starts only explicitly configured OAuth providers and never enables social signup", async () => {
    const providerEnv = {
      AUTH_SOCIAL_BACKEND: "better-auth",
      GOOGLE_OAUTH_CLIENT_ID: "synthetic-google-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-google-client-secret",
      GITHUB_OAUTH_CLIENT_ID: "synthetic-github-client-id",
      GITHUB_OAUTH_CLIENT_SECRET: "synthetic-github-client-secret",
      DISCORD_OAUTH_CLIENT_ID: "synthetic-discord-client-id",
      DISCORD_OAUTH_CLIENT_SECRET: "synthetic-discord-client-secret",
      APPLE_OAUTH_CLIENT_ID: "synthetic-apple-client-id",
      APPLE_OAUTH_CLIENT_SECRET: "synthetic-apple-client-secret",
    };
    const capabilities = await authRequest("/capabilities", { method: "GET" }, providerEnv);
    expect(await capabilities.json()).toEqual({
      emailVerification: false,
      passwordReset: false,
      signUp: false,
      invitationRequired: false,
      socialProviders: ["apple", "discord", "github", "google"],
    });

    const authorizationEndpoints = {
      apple: "https://appleid.apple.com/auth/authorize",
      discord: "https://discord.com/api/oauth2/authorize",
      github: "https://github.com/login/oauth/authorize",
      google: "https://accounts.google.com/o/oauth2/v2/auth",
    } as const;
    for (const [provider, endpoint] of Object.entries(authorizationEndpoints)) {
      const start = await authRequest("/sign-in/social", jsonBody({
        provider,
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      expect(start.status, `${provider} authorization start`).toBe(200);
      const response = await start.json() as { url?: unknown; redirect?: unknown };
      expect(response.redirect, `${provider} redirect flag`).toBe(true);
      expect(typeof response.url, `${provider} authorization URL`).toBe("string");
      const authorizationURL = new URL(response.url as string);
      expect(`${authorizationURL.origin}${authorizationURL.pathname}`, `${provider} endpoint`)
        .toBe(endpoint);
      expect(authorizationURL.searchParams.get("client_id"), `${provider} client ID`)
        .toBe(providerEnv[`${provider.toUpperCase()}_OAUTH_CLIENT_ID` as keyof typeof providerEnv]);
      expect(authorizationURL.searchParams.get("redirect_uri"), `${provider} callback URI`)
        .toBe(`${apiBase}/api/auth/callback/${provider}`);
      expect(authorizationURL.searchParams.get("state"), `${provider} OAuth state`)
        .toBeTruthy();
      expect(JSON.stringify(response)).not.toContain(
        providerEnv[`${provider.toUpperCase()}_OAUTH_CLIENT_SECRET` as keyof typeof providerEnv],
      );

      const callbackCookies = (start.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      expect(callbackCookies, `${provider} OAuth state cookies`).not.toBe("");
      const deniedCallback = await authRequest(
        `/callback/${provider}?${new URLSearchParams({
          error: "access_denied",
          state: authorizationURL.searchParams.get("state") ?? "",
        })}`,
        { headers: { cookie: callbackCookies } },
        providerEnv,
      );
      expect(deniedCallback.status, `${provider} denied callback`).toBe(302);
      const callbackLocation = deniedCallback.headers.get("location");
      expect(callbackLocation, `${provider} callback destination`).toBeTruthy();
      const callbackDestination = new URL(callbackLocation as string);
      expect(`${callbackDestination.origin}${callbackDestination.pathname}`)
        .toBe(`${appOrigin}/auth`);
      expect(callbackDestination.searchParams.get("error")).toBe("access_denied");

      const mismatchStart = await authRequest("/sign-in/social", jsonBody({
        provider,
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      const mismatchBody = await mismatchStart.json() as { url: string };
      const mismatchAuthorizationURL = new URL(mismatchBody.url);
      const mismatchCookies = (mismatchStart.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      const mismatchedState = `${mismatchAuthorizationURL.searchParams.get("state") ?? ""}tampered`;
      const mismatchCallback = await authRequest(
        `/callback/${provider}?${new URLSearchParams({ error: "access_denied", state: mismatchedState })}`,
        { headers: { cookie: mismatchCookies } },
        providerEnv,
      );
      expect(mismatchCallback.status, `${provider} mismatched state callback`).toBe(302);
      const mismatchDestination = new URL(mismatchCallback.headers.get("location") ?? "");
      expect(mismatchDestination.searchParams.get("error"), `${provider} mismatched state error`)
        .toBe("state_mismatch");
    }

    const unconfiguredProvider = await authRequest("/sign-in/social", jsonBody({
      provider: "linkedin",
      callbackURL: `${appOrigin}/auth`,
    }), providerEnv);
    expect(unconfiguredProvider.status).toBe(403);
    expect(await unconfiguredProvider.json()).toEqual({ error: "auth_flow_unavailable" });
    expect(await sessionCount(verifiedUserId)).toBe(0);
    const accountCount = await database?.prepare('SELECT COUNT(*) AS "count" FROM "account" WHERE "userId" = ?')
      .bind(verifiedUserId)
      .first<{ count: number }>();
    expect(accountCount?.count).toBe(1);
  });

  it.each([
    {
      provider: "github",
      clientId: "synthetic-github-client-id",
      clientSecret: "synthetic-github-client-secret",
      tokenUrl: "https://github.com/login/oauth/access_token",
      profileUrl: "https://api.github.com/user",
      subject: "9012345",
      scope: "read:user,user:email",
    },
    {
      provider: "discord",
      clientId: "synthetic-discord-client-id",
      clientSecret: "synthetic-discord-client-secret",
      tokenUrl: "https://discord.com/api/oauth2/token",
      profileUrl: "https://discord.com/api/users/@me",
      subject: "120000000000000002",
      scope: "identify,email",
    },
  ] as const)("completes a synthetic $provider code exchange and links its verified email to the existing UUID", async ({
    provider,
    clientId,
    clientSecret,
    tokenUrl,
    profileUrl,
    subject,
    scope,
  }) => {
    const providerEnv = {
      AUTH_SOCIAL_BACKEND: "better-auth",
      [`${provider.toUpperCase()}_OAUTH_CLIENT_ID`]: clientId,
      [`${provider.toUpperCase()}_OAUTH_CLIENT_SECRET`]: clientSecret,
    };
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const parsedUrl = new URL(url);
      const normalizedUrl = `${parsedUrl.origin}${decodeURIComponent(parsedUrl.pathname)}`;
      requests.push({ url: normalizedUrl, method });
      if (url === tokenUrl) {
        return Response.json({
          access_token: `synthetic-${provider}-access-token`,
          token_type: "bearer",
          scope,
          expires_in: 3600,
        });
      }
      if (normalizedUrl === profileUrl && provider === "github") {
        return Response.json({
          id: Number(subject),
          login: "synthetic-oauth-user",
          name: "Synthetic OAuth User",
          email: null,
          avatar_url: "https://avatars.example.invalid/synthetic.png",
        });
      }
      if (normalizedUrl === "https://api.github.com/user/emails") {
        return Response.json([{
          email: verifiedEmail,
          primary: true,
          verified: true,
          visibility: "private",
        }]);
      }
      if (normalizedUrl === profileUrl && provider === "discord") {
        return Response.json({
          id: subject,
          username: "synthetic-oauth-user",
          global_name: "Synthetic OAuth User",
          email: verifiedEmail,
          verified: true,
          avatar: null,
          discriminator: "0",
        });
      }
      throw new Error(`unexpected OAuth network request: ${method} ${normalizedUrl}`);
    });

    try {
      const start = await authRequest("/sign-in/social", jsonBody({
        provider,
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      expect(start.status).toBe(200);
      const startBody = await start.json() as { url: string };
      const authorizationURL = new URL(startBody.url);
      expect(authorizationURL.searchParams.get("client_id")).toBe(clientId);
      expect(authorizationURL.searchParams.get("scope")).toContain("email");
      const callbackCookies = (start.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      const callback = await authRequest(`/callback/${provider}?${new URLSearchParams({
        code: `synthetic-${provider}-authorization-code`,
        state: authorizationURL.searchParams.get("state") ?? "",
      })}`, { headers: { cookie: callbackCookies } }, providerEnv);

      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(`${appOrigin}/auth`);
      expect(callback.headers.get("location")).not.toContain(`synthetic-${provider}-access-token`);
      expect(requests).toEqual([
        { url: tokenUrl, method: "POST" },
        { url: profileUrl, method: "GET" },
        ...(provider === "github" ? [{ url: "https://api.github.com/user/emails", method: "GET" }] : []),
      ]);

      const sessionCookie = setCookiePair(callback, "better-auth.session_token=");
      expect(sessionCookie).toBeTruthy();
      const session = await authRequest("/get-session", {
        headers: { cookie: sessionCookie ?? "" },
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        user: { id: verifiedUserId, email: verifiedEmail },
      });
      expect(await sessionCount(verifiedUserId)).toBe(1);
      expect(await database!.prepare(
        'SELECT "accountId", "providerId", "userId" FROM "account" WHERE "providerId" = ?',
      ).bind(provider).first()).toEqual({
        accountId: subject,
        providerId: provider,
        userId: verifiedUserId,
      });
      const userCount = await database!.prepare('SELECT count(*) AS "count" FROM "user"')
        .first<{ count: number }>();
      expect(userCount?.count).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    {
      provider: "google",
      clientId: "synthetic-google-client-id",
      clientSecret: "synthetic-google-client-secret",
      issuer: "https://accounts.google.com",
      subject: "synthetic-google-subject",
      tokenUrl: "https://oauth2.googleapis.com/token",
      callbackMethod: "GET",
    },
    {
      provider: "apple",
      clientId: "synthetic-apple-client-id",
      clientSecret: "synthetic-apple-client-secret",
      issuer: "https://appleid.apple.com",
      subject: "synthetic-apple-subject",
      tokenUrl: "https://appleid.apple.com/auth/token",
      callbackMethod: "POST",
    },
  ] as const)("completes a synthetic $provider code exchange and links its identity to the existing UUID", async ({
    provider,
    clientId,
    clientSecret,
    issuer,
    subject,
    tokenUrl,
    callbackMethod,
  }) => {
    const idToken = await createSyntheticIdToken(issuer, clientId, subject, verifiedEmail);
    const providerEnv = {
      AUTH_SOCIAL_BACKEND: "better-auth",
      [`${provider.toUpperCase()}_OAUTH_CLIENT_ID`]: clientId,
      [`${provider.toUpperCase()}_OAUTH_CLIENT_SECRET`]: clientSecret,
    };
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const parsedUrl = new URL(url);
      requests.push({ url: `${parsedUrl.origin}${parsedUrl.pathname}`, method });
      if (url === tokenUrl) {
        return Response.json({
          access_token: `synthetic-${provider}-access-token`,
          token_type: "bearer",
          scope: provider === "google" ? "openid email profile" : "email name",
          expires_in: 3600,
          id_token: idToken,
        });
      }
      throw new Error(`unexpected OAuth network request: ${method} ${parsedUrl.origin}${parsedUrl.pathname}`);
    });

    try {
      const start = await authRequest("/sign-in/social", jsonBody({
        provider,
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      expect(start.status).toBe(200);
      const startBody = await start.json() as { url: string };
      const authorizationURL = new URL(startBody.url);
      expect(authorizationURL.searchParams.get("client_id")).toBe(clientId);
      const callbackCookies = (start.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      const callbackParams = new URLSearchParams({
        code: `synthetic-${provider}-authorization-code`,
        state: authorizationURL.searchParams.get("state") ?? "",
      });
      const firstCallback = await authRequest(`/callback/${provider}${callbackMethod === "GET" ? `?${callbackParams}` : ""}`, {
        method: callbackMethod,
        headers: callbackMethod === "POST"
          ? { cookie: callbackCookies, "content-type": "application/x-www-form-urlencoded" }
          : { cookie: callbackCookies },
        ...(callbackMethod === "POST" ? { body: callbackParams.toString() } : {}),
      }, providerEnv);
      const callbackLocation = firstCallback.headers.get("location");
      const callback = callbackMethod === "POST" && callbackLocation
        ? await authRequest(`${new URL(callbackLocation).pathname.replace(/^\/api\/auth/u, "")}${new URL(callbackLocation).search}`, {
            headers: { cookie: callbackCookies },
          }, providerEnv)
        : firstCallback;

      expect(firstCallback.status).toBe(302);
      if (callbackMethod === "POST") {
        expect(callbackLocation).toContain("/api/auth/callback/apple?");
      }
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(`${appOrigin}/auth`);
      expect(requests).toEqual([{ url: tokenUrl, method: "POST" }]);
      const sessionCookie = setCookiePair(callback, "better-auth.session_token=");
      expect(sessionCookie).toBeTruthy();
      const session = await authRequest("/get-session", {
        headers: { cookie: sessionCookie ?? "" },
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        user: { id: verifiedUserId, email: verifiedEmail },
      });
      expect(await sessionCount(verifiedUserId)).toBeGreaterThan(0);
      expect(await database!.prepare(
        'SELECT "accountId", "providerId", "userId" FROM "account" WHERE "providerId" = ?',
      ).bind(provider).first()).toEqual({
        accountId: subject,
        providerId: provider,
        userId: verifiedUserId,
      });
      const userCount = await database!.prepare('SELECT count(*) AS "count" FROM "user"')
        .first<{ count: number }>();
      expect(userCount?.count).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a verified but unlinked social identity without creating a user or session", async () => {
    const clientId = "synthetic-google-client-id";
    const providerEnv = {
      AUTH_SOCIAL_BACKEND: "better-auth",
      GOOGLE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-google-client-secret",
    };
    const unlinkedEmail = "unlinked-social-user@example.invalid";
    const idToken = await createSyntheticIdToken(
      "https://accounts.google.com", clientId, "unlinked-google-subject", unlinkedEmail,
    );
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      return Response.json({
        access_token: "synthetic-unlinked-google-access-token",
        token_type: "bearer",
        scope: "openid email profile",
        expires_in: 3600,
        id_token: idToken,
      });
    });

    try {
      const start = await authRequest("/sign-in/social", jsonBody({
        provider: "google",
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      const startBody = await start.json() as { url: string };
      const state = new URL(startBody.url).searchParams.get("state") ?? "";
      const callbackCookies = (start.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      const callback = await authRequest(`/callback/google?${new URLSearchParams({
        code: "synthetic-unlinked-google-authorization-code",
        state,
      })}`, { headers: { cookie: callbackCookies } }, providerEnv);

      expect(callback.status).toBe(302);
      const errorLocation = new URL(callback.headers.get("location") ?? "");
      expect(`${errorLocation.origin}${errorLocation.pathname}`).toBe(`${appOrigin}/auth`);
      expect(errorLocation.searchParams.get("error")).toBe("signup_disabled");
      expect(await database!.prepare('SELECT count(*) AS "count" FROM "user"')
        .first<{ count: number }>()).toEqual({ count: 2 });
      expect(await database!.prepare('SELECT count(*) AS "count" FROM "account"')
        .first<{ count: number }>()).toEqual({ count: 2 });
      expect(await sessionCount(verifiedUserId)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not link an existing UUID when the provider does not verify the matching email", async () => {
    const clientId = "synthetic-google-client-id";
    const providerEnv = {
      AUTH_SOCIAL_BACKEND: "better-auth",
      GOOGLE_OAUTH_CLIENT_ID: clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-google-client-secret",
    };
    const idToken = await createSyntheticIdToken(
      "https://accounts.google.com", clientId, "unverified-google-subject", verifiedEmail, false,
    );
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(init?.method).toBe("POST");
      return Response.json({
        access_token: "synthetic-unverified-google-access-token",
        token_type: "bearer",
        scope: "openid email profile",
        expires_in: 3600,
        id_token: idToken,
      });
    });

    try {
      const start = await authRequest("/sign-in/social", jsonBody({
        provider: "google",
        callbackURL: `${appOrigin}/auth`,
        errorCallbackURL: `${appOrigin}/auth`,
      }), providerEnv);
      const startBody = await start.json() as { url: string };
      const state = new URL(startBody.url).searchParams.get("state") ?? "";
      const callbackCookies = (start.headers.get("set-cookie") ?? "")
        .split(/,(?=[^;,]+=)/u)
        .map((cookie) => cookie.trim().split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
      const callback = await authRequest(`/callback/google?${new URLSearchParams({
        code: "synthetic-unverified-google-authorization-code",
        state,
      })}`, { headers: { cookie: callbackCookies } }, providerEnv);

      expect(callback.status).toBe(302);
      const errorLocation = new URL(callback.headers.get("location") ?? "");
      expect(errorLocation.searchParams.get("error")).toBe("account_not_linked");
      expect(await database!.prepare('SELECT count(*) AS "count" FROM "user"')
        .first<{ count: number }>()).toEqual({ count: 2 });
      expect(await database!.prepare('SELECT count(*) AS "count" FROM "account"')
        .first<{ count: number }>()).toEqual({ count: 2 });
      expect(await sessionCount(verifiedUserId)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("handles concurrent sign-ins through the same Worker route", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => authRequest("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: verifiedEmail, password }),
      })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(await sessionCount(verifiedUserId)).toBe(4);
  });

  it("fails closed for an unconfigured backend and an untrusted browser origin", async () => {
    const disabled = await authRequest("/get-session", {}, { AUTH_BACKEND: "supabase" });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "auth_unavailable" });

    const untrusted = await authRequest(
      "/get-session",
      { headers: { Origin: "https://attacker.example.test" } },
    );
    expect(untrusted.status).toBe(403);
    expect(await untrusted.json()).toEqual({ error: "forbidden_origin" });

    const preflight = await authRequest(
      "/sign-in/email",
      {
        method: "OPTIONS",
        headers: { "access-control-request-method": "POST" },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("admin session authorization through the application Worker", () => {
  it("fails closed for a disabled backend, anonymous session, untrusted origin, and unsupported method", async () => {
    const disabled = await adminSessionRequest({}, { AUTH_BACKEND: "supabase" });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ error: "auth_unavailable" });

    const anonymous = await adminSessionRequest();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const untrusted = await adminSessionRequest({
      headers: { Origin: "https://attacker.example.test" },
    });
    expect(untrusted.status).toBe(403);
    expect(await untrusted.json()).toEqual({ error: "forbidden_origin" });

    const preflight = await adminSessionRequest({ method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const unsupported = await adminSessionRequest({ method: "POST" });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it("requires admin role, current verified MFA, and assurance for the exact session and factor", async () => {
    const first = await signInAndGetSession();
    const second = await signInAndGetSession();

    const nonAdmin = await adminSessionRequest({ headers: { cookie: first.cookie } });
    expect(nonAdmin.status).toBe(403);
    expect(await nonAdmin.json()).toEqual({ error: "admin_required" });

    await database?.prepare('INSERT INTO "adminRole" ("userId", "role") VALUES (?, ?)')
      .bind(verifiedUserId, "admin")
      .run();
    const enrollmentRequired = await adminSessionRequest({ headers: { cookie: first.cookie } });
    expect(enrollmentRequired.status).toBe(403);
    expect(await enrollmentRequired.json()).toEqual({ error: "mfa_enrollment_required" });

    await grantSyntheticAdminRoleAndMfa(first.sessionId);
    const missingAssurance = await adminSessionRequest({ headers: { cookie: second.cookie } });
    expect(missingAssurance.status).toBe(403);
    expect(await missingAssurance.json()).toEqual({ error: "mfa_required" });

    const authorized = await adminSessionRequest({ headers: { cookie: first.cookie } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    expect(authorized.headers.get("access-control-allow-origin")).toBe(appOrigin);
    expect(authorized.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await authorized.json()).toEqual({ authorized: true });

    await database?.prepare(
      'UPDATE "mfaAssurance" SET "expiresAt" = ? WHERE "userId" = ? AND "sessionId" = ?',
    ).bind("2000-01-01T00:00:00.000Z", verifiedUserId, first.sessionId).run();
    const expired = await adminSessionRequest({ headers: { cookie: first.cookie } });
    expect(expired.status).toBe(403);
    expect(await expired.json()).toEqual({ error: "mfa_required" });
  });

  it("rejects ambiguous multiple verified MFA factors", async () => {
    const { cookie, sessionId } = await signInAndGetSession();
    await grantSyntheticAdminRoleAndMfa(sessionId);
    await database?.prepare(
      'INSERT INTO "twoFactor" ("id", "secret", "backupCodes", "userId", "verified") VALUES (?, ?, ?, ?, 1)',
    ).bind("80000000-0000-4000-8000-000000000002", "synthetic-second-factor", "[]", verifiedUserId).run();

    const response = await adminSessionRequest({ headers: { cookie } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "mfa_enrollment_required" });
  });

  it("completes Better Auth TOTP enrollment through the Worker before granting admin access", async () => {
    const { cookie } = await signInAndGetSession();
    await database?.prepare('INSERT INTO "adminRole" ("userId", "role") VALUES (?, ?)')
      .bind(verifiedUserId, "admin")
      .run();

    const beforeEnrollment = await adminSessionRequest({ headers: { cookie } });
    expect(beforeEnrollment.status).toBe(403);
    expect(await beforeEnrollment.json()).toEqual({ error: "mfa_enrollment_required" });

    const enrollment = await authRequest("/two-factor/enable", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ method: "totp", password }),
    });
    expect(enrollment.status).toBe(200);
    const enrollmentBody = await enrollment.json() as {
      method?: unknown;
      totpURI?: unknown;
      backupCodes?: unknown;
    };
    expect(enrollmentBody.method).toBe("totp");
    expect(Array.isArray(enrollmentBody.backupCodes)).toBe(true);
    const totpURI = new URL(String(enrollmentBody.totpURI));
    const secret = totpURI.searchParams.get("secret");
    expect(secret).toBeTruthy();

    const verification = await authRequest("/two-factor/verify-totp", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: await createTotpCode(secret as string) }),
    });
    expect(verification.status).toBe(200);
    const verificationBody = await verification.json() as {
      token?: unknown;
      user?: { id?: unknown };
    };
    expect(typeof verificationBody.token).toBe("string");
    expect(verificationBody.user?.id).toBe(verifiedUserId);

    const currentSessionCookie = setCookiePair(verification, "session_token=") ?? cookie;
    const currentSessionResponse = await authRequest("/get-session", {
      headers: { cookie: currentSessionCookie },
    });
    expect(currentSessionResponse.status).toBe(200);
    const currentSession = await currentSessionResponse.json() as {
      session?: { id?: unknown };
      user?: { id?: unknown };
    };
    expect(typeof currentSession.session?.id).toBe("string");
    expect(currentSession.user?.id).toBe(verifiedUserId);

    const authorized = await adminSessionRequest({ headers: { cookie: currentSessionCookie } });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ authorized: true });
    const assuranceCount = await database
      ?.prepare('SELECT count(*) AS "count" FROM "mfaAssurance" WHERE "userId" = ? AND "sessionId" = ?')
      .bind(verifiedUserId, currentSession.session?.id)
      .first<{ count: number }>();
    expect(Number(assuranceCount?.count)).toBe(1);
  });

  it("authorizes emoji-master draft CRUD with same-session MFA and leaves the active release unchanged", async () => {
    const anonymous = await emojiMasterAdminRequest();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
    const anonymousWrite = await emojiMasterAdminRequest("", jsonBody({
      emoji: "🎵",
      shortName: "musical_note",
      keywords: [],
      category: null,
      subcategory: null,
      codepoints: ["1F3B5"],
      sortOrder: null,
    }));
    expect(anonymousWrite.status).toBe(401);

    const first = await signInAndGetSession();
    const second = await signInAndGetSession();
    await database?.prepare('INSERT INTO "adminRole" ("userId", "role") VALUES (?, ?)')
      .bind(verifiedUserId, "admin")
      .run();
    const withoutMfa = await emojiMasterAdminRequest("", { headers: { cookie: first.cookie } });
    expect(withoutMfa.status).toBe(403);
    expect(await withoutMfa.json()).toEqual({ error: "mfa_enrollment_required" });

    await grantSyntheticAdminRoleAndMfa(first.sessionId);
    const wrongSession = await emojiMasterAdminRequest("", { headers: { cookie: second.cookie } });
    expect(wrongSession.status).toBe(403);
    expect(await wrongSession.json()).toEqual({ error: "mfa_required" });

    const preflight = await emojiMasterAdminRequest("", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    const forbiddenOrigin = await emojiMasterAdminRequest("", {
      headers: { Origin: "https://attacker.example.test", cookie: first.cookie },
    });
    expect(forbiddenOrigin.status).toBe(403);

    const { cookie } = first;
    const noBackend = await emojiMasterAdminRequest("", { headers: { cookie } }, {
      EMOJI_MASTER_ADMIN_BACKEND: undefined,
    });
    expect(noBackend.status).toBe(503);

    const { id, releaseVersion } = await seedPublishedEmoji();
    const list = await emojiMasterAdminRequest("?page=1&pageSize=25&search=wave", { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(list.headers.get("access-control-allow-credentials")).toBe("true");
    const page = await list.json() as {
      activeReleaseVersion: string;
      items: Array<Record<string, unknown>>;
    };
    expect(page.activeReleaseVersion).toBe(releaseVersion);
    const published = page.items.find((item) => item.id === id);
    expect(published).toMatchObject({ id, emoji: "👋", shortName: "wave", releaseProtected: true });

    const created = await emojiMasterAdminRequest("", jsonBody({
      emoji: "🎵",
      shortName: "musical_note",
      keywords: ["music", "note"],
      category: "Objects",
      subcategory: "music",
      codepoints: ["1F3B5"],
      sortOrder: 2,
    }, "POST", cookie));
    expect(created.status).toBe(201);
    const createdItem = await created.json() as { id: string; emoji: string; releaseProtected: boolean };
    expect(createdItem).toMatchObject({ emoji: "🎵", releaseProtected: false });

    const publishedRecord = published as {
      id: string;
      updatedAt: string;
      emoji: string;
      shortName: string;
      keywords: string[];
      category: string;
      subcategory: string;
      codepoints: string[];
      sortOrder: number;
    };
    const metadataUpdate = await emojiMasterAdminRequest(`/${id}`, jsonBody({
      updatedAt: publishedRecord.updatedAt,
      emoji: publishedRecord.emoji,
      shortName: "wave edited in draft",
      keywords: ["wave", "draft"],
      category: publishedRecord.category,
      subcategory: publishedRecord.subcategory,
      codepoints: publishedRecord.codepoints,
      sortOrder: publishedRecord.sortOrder,
    }, "PUT", cookie));
    expect(metadataUpdate.status).toBe(200);
    const updated = await metadataUpdate.json() as { id: string; updatedAt: string; releaseProtected: boolean };
    expect(updated.id).toBe(id);
    expect(updated.releaseProtected).toBe(true);
    expect(updated.updatedAt).not.toBe(publishedRecord.updatedAt);

    const staleEdit = await emojiMasterAdminRequest(`/${id}`, jsonBody({
      updatedAt: publishedRecord.updatedAt,
      emoji: publishedRecord.emoji,
      shortName: "stale draft edit",
      keywords: ["stale"],
      category: publishedRecord.category,
      subcategory: publishedRecord.subcategory,
      codepoints: publishedRecord.codepoints,
      sortOrder: publishedRecord.sortOrder,
    }, "PUT", cookie));
    expect(staleEdit.status).toBe(409);
    expect(await staleEdit.json()).toEqual({ error: "emoji_edit_conflict" });

    const identityEdit = await emojiMasterAdminRequest(`/${id}`, jsonBody({
      updatedAt: updated.updatedAt,
      emoji: "🖐️",
      shortName: "changed published identity",
      keywords: ["hand"],
      category: publishedRecord.category,
      subcategory: publishedRecord.subcategory,
      codepoints: ["1F590", "FE0F"],
      sortOrder: publishedRecord.sortOrder,
    }, "PUT", cookie));
    expect(identityEdit.status).toBe(409);
    expect(await identityEdit.json()).toEqual({ error: "emoji_identity_release_protected" });

    const imported = await emojiMasterAdminRequest("/import", jsonBody({ records: [{
      emoji: "👋",
      shortName: "wave imported draft",
      keywords: ["wave", "imported"],
      category: "People & Body",
      subcategory: "hand-fingers-open",
      codepoints: ["1F44B"],
      sortOrder: 1,
    }] }, "POST", cookie));
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ importedCount: 1 });
    const reread = await emojiMasterAdminRequest(`/${id}`, { headers: { cookie } });
    expect(reread.status).toBe(200);
    expect(await reread.json()).toMatchObject({
      id,
      emoji: "👋",
      shortName: "wave imported draft",
      releaseProtected: true,
    });

    const deletion = await emojiMasterAdminRequest(`/${id}`, { method: "DELETE", headers: { cookie } });
    expect(deletion.status).toBe(409);
    expect(await deletion.json()).toEqual({ error: "emoji_deletion_requires_release_review" });

    const publicCatalog = await handleRequest(
      new Request(`${apiBase}/api/emoji/catalog?limit=25`, { headers: { Origin: appOrigin } }),
      { ...runtimeEnv, EMOJI_CATALOG_BACKEND: "d1" },
    );
    expect(publicCatalog.status).toBe(200);
    const active = await publicCatalog.json() as {
      version: string;
      total: number;
      items: Array<{ id: string; emoji: string; shortName: string }>;
    };
    expect(active.version).toBe(releaseVersion);
    expect(active.total).toBe(1);
    expect(active.items).toHaveLength(1);
    expect(active.items[0]).toMatchObject({ id, emoji: "👋", shortName: "wave" });
    expect(active.items.some((item) => item.emoji === "🎵")).toBe(false);
  });

  it("protects reference pricing admin reads and writes with the same-session MFA gate", async () => {
    const anonymous = await referenceMasterAdminRequest();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const anonymousWrite = await referenceMasterAdminRequest({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(anonymousWrite.status).toBe(401);

    const first = await signInAndGetSession();
    const second = await signInAndGetSession();
    const nonAdmin = await referenceMasterAdminRequest({ headers: { cookie: first.cookie } });
    expect(nonAdmin.status).toBe(403);
    expect(await nonAdmin.json()).toEqual({ error: "admin_required" });

    await database?.prepare('INSERT INTO "adminRole" ("userId", "role") VALUES (?, ?)')
      .bind(verifiedUserId, "admin")
      .run();
    const enrollmentRequired = await referenceMasterAdminRequest({ headers: { cookie: first.cookie } });
    expect(enrollmentRequired.status).toBe(403);
    expect(await enrollmentRequired.json()).toEqual({ error: "mfa_enrollment_required" });

    await grantSyntheticAdminRoleAndMfa(first.sessionId);
    const wrongSession = await referenceMasterAdminRequest({ headers: { cookie: second.cookie } });
    expect(wrongSession.status).toBe(403);
    expect(await wrongSession.json()).toEqual({ error: "mfa_required" });

    const forbiddenOrigin = await referenceMasterAdminRequest({
      headers: { cookie: first.cookie, Origin: "https://attacker.example.test" },
    });
    expect(forbiddenOrigin.status).toBe(403);
    expect(await forbiddenOrigin.json()).toEqual({ error: "forbidden_origin" });

    // The synthetic Master D1 intentionally has no active pricing release in
    // this Auth-only fixture. A 503 here proves the request passed role/MFA
    // authorization and then failed closed at the data boundary.
    const authorizedButUnseeded = await referenceMasterAdminRequest({ headers: { cookie: first.cookie } });
    expect(authorizedButUnseeded.status).toBe(503);
    expect(await authorizedButUnseeded.json()).toEqual({ error: "reference_master_admin_unavailable" });
  });

  it("protects notification-master administration with the same-session MFA gate", async () => {
    const anonymous = await notificationMasterAdminRequest();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const first = await signInAndGetSession();
    const second = await signInAndGetSession();
    const nonAdmin = await notificationMasterAdminRequest("/rules", { headers: { cookie: first.cookie } });
    expect(nonAdmin.status).toBe(403);
    expect(await nonAdmin.json()).toEqual({ error: "admin_required" });

    await grantSyntheticAdminRoleAndMfa(first.sessionId);
    const wrongSession = await notificationMasterAdminRequest("/rules", { headers: { cookie: second.cookie } });
    expect(wrongSession.status).toBe(403);
    expect(await wrongSession.json()).toEqual({ error: "mfa_required" });

    // Keep the missing Business binding proof explicit now that this suite
    // also applies canonical Business migrations for the OAuth policy.
    const authorized = await notificationMasterAdminRequest("/rules", { headers: { cookie: first.cookie } }, { FANMARK_DB: undefined });
    expect(authorized.status).toBe(503);
    expect(await authorized.json()).toEqual({ error: "notification_master_unavailable" });
  });

  it("keeps unknown admin paths closed", async () => {
    const response = await handleRequest(
      new Request(`${apiBase}/api/admin/tiers`),
      runtimeEnv,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("emoji master D1 timestamp contract", () => {
  it("binds deterministic UTC microsecond timestamps for create, update, and import", async () => {
    if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
    let now = new Date("2026-10-02T12:00:00.123Z");
    const repository = createEmojiMasterAdminD1Repository({
      ...runtimeEnv,
      D1_TOPOLOGY: "split",
      EMOJI_MASTER_ADMIN_BACKEND: "d1",
    }, () => new Date(now), verifiedUserId);
    const input = {
      emoji: "🧪",
      shortName: "test_tube",
      keywords: ["test", "tube"],
      category: "Objects",
      subcategory: "science",
      codepoints: ["1F9EA"],
      sortOrder: 90,
    };
    try {
      const created = await repository.create(input);
      const createAt = "2026-10-02T12:00:00.123000Z";
      expect(created.updatedAt).toBe(createAt);
      const createdRow = await masterDatabase.prepare("SELECT created_at, updated_at FROM emoji_master WHERE id = ?")
        .bind(created.id).first<{ created_at: string; updated_at: string }>();
      expect(createdRow).toEqual({ created_at: createAt, updated_at: createAt });

      now = new Date("2026-10-02T12:00:01.456Z");
      const updated = await repository.update(created.id, created.updatedAt, { ...input, shortName: "test_tube_updated" });
      const updateAt = "2026-10-02T12:00:01.456000Z";
      expect(updated.updatedAt).toBe(updateAt);
      const updatedRow = await masterDatabase.prepare("SELECT created_at, updated_at FROM emoji_master WHERE id = ?")
        .bind(created.id).first<{ created_at: string; updated_at: string }>();
      expect(updatedRow).toEqual({ created_at: createAt, updated_at: updateAt });

      now = new Date("2026-10-02T12:00:02.789Z");
      await repository.import([{ ...input, emoji: "🧬", shortName: "dna", codepoints: ["1F9EC"] }]);
      const importAt = "2026-10-02T12:00:02.789000Z";
      const imported = await masterDatabase.prepare("SELECT created_at, updated_at FROM emoji_master WHERE emoji = ?")
        .bind("🧬").first<{ created_at: string; updated_at: string }>();
      expect(imported).toEqual({ created_at: importAt, updated_at: importAt });

      now = new Date("2026-10-02T12:00:03.012Z");
      await repository.import([{ ...input, emoji: "🧬", shortName: "dna_updated", codepoints: ["1F9EC"] }]);
      const importedAgain = await masterDatabase.prepare("SELECT created_at, updated_at FROM emoji_master WHERE emoji = ?")
        .bind("🧬").first<{ created_at: string; updated_at: string }>();
      expect(importedAgain).toEqual({ created_at: importAt, updated_at: "2026-10-02T12:00:03.012000Z" });
    } finally {
      await masterDatabase.prepare("DELETE FROM emoji_master WHERE emoji IN (?, ?)").bind("🧪", "🧬").run();
    }
  });
});

describe("emoji master change audit parity", () => {
  const operationAt = "2026-10-03T01:02:03.456000Z";
  const input = {
    emoji: "🪁",
    shortName: "audit_kite",
    keywords: ["audit", "kite"],
    category: "Objects",
    subcategory: "toy",
    codepoints: ["1FA81"],
    sortOrder: 81,
  };

  function repository(actor: string | undefined = verifiedUserId) {
    return createEmojiMasterAdminD1Repository({
      ...runtimeEnv,
      D1_TOPOLOGY: "split",
      EMOJI_MASTER_ADMIN_BACKEND: "d1",
    }, () => new Date(operationAt), actor);
  }

  function master() {
    if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
    return masterDatabase;
  }

  beforeEach(async () => {
    // This fixture shares Master D1 across tests; clear only these private
    // synthetic identities, leaving the published release fixture intact.
    await master().prepare("DELETE FROM emoji_master WHERE emoji IN (?, ?, ?, ?)")
      .bind("🪁", "🪀", "🪂", "🪃").run();
    await master().prepare(`DELETE FROM fanmark_emoji_master_change_audits
      WHERE json_extract(metadata, '$.emoji') IN (?, ?, ?, ?)`)
      .bind("🪁", "🪀", "🪂", "🪃").run();
  });

  async function audits(id: string) {
    return (await master().prepare(`SELECT id, user_id, action, resource_type, resource_id,
      request_id, metadata, created_at FROM fanmark_emoji_master_change_audits
      WHERE resource_id = ? ORDER BY rowid`).bind(id).all<{
        id: string; user_id: string | null; action: string; resource_type: string;
        resource_id: string; request_id: string | null; metadata: string; created_at: string;
      }>()).results;
  }

  async function expectEmptyContext() {
    expect(await master().prepare("SELECT count(*) AS count FROM fanmark_emoji_master_mutation_context")
      .first()).toEqual({ count: 0 });
  }

  it("records the server-authorized actor and source metadata; reads and rejected writes add no audits", async () => {
    const { cookie, sessionId } = await signInAndGetSession();
    await grantSyntheticAdminRoleAndMfa(sessionId);
    const forgedActor = await emojiMasterAdminRequest("", jsonBody({ ...input, userId: unverifiedUserId }, "POST", cookie));
    expect(forgedActor.status).toBe(400);
    const response = await emojiMasterAdminRequest("", jsonBody(input, "POST", cookie));
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; updatedAt: string };
    const first = await audits(created.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      user_id: verifiedUserId, action: "EMOJI_MASTER_INSERT", resource_type: "emoji_master",
      resource_id: created.id, metadata: JSON.stringify({ emoji: input.emoji, short_name: input.shortName }),
      created_at: created.updatedAt,
    });
    expect(first[0].id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
    expect(first[0].request_id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);

    const updated = await repository().update(created.id, created.updatedAt, { ...input, shortName: "kite_edited" });
    const changed = await audits(created.id);
    expect(changed).toHaveLength(2);
    expect(changed[1]).toMatchObject({
      user_id: verifiedUserId, action: "EMOJI_MASTER_UPDATE", resource_id: created.id,
      metadata: JSON.stringify({ emoji: input.emoji, short_name: "kite_edited" }), created_at: operationAt,
    });
    expect(changed[1].request_id).not.toBe(first[0].request_id);
    await repository().getById(created.id);
    await repository().list(new URL(`${apiBase}/api/admin/emoji-master?search=kite`));
    await expect(repository().update(created.id, created.updatedAt, input)).rejects.toMatchObject({ code: "emoji_edit_conflict", status: 409 });
    await expect(repository().create(input)).rejects.toMatchObject({ code: "emoji_conflict", status: 409 });
    await expect(repository().delete(created.id)).rejects.toMatchObject({ code: "emoji_deletion_requires_release_review", status: 409 });
    expect(await audits(created.id)).toEqual(changed);
    expect(await repository().getById(created.id)).toEqual(updated);
    await expectEmptyContext();
  });

  it.each(["suppressed", "corrupted"])("rolls back the draft and request context when a required audit is %s", async (fault) => {
    const created = await repository().create(input);
    const baseline = await audits(created.id);
    const triggerName = `synthetic_emoji_audit_${fault}`;
    const definition = fault === "suppressed"
      ? `CREATE TRIGGER ${triggerName} BEFORE INSERT ON fanmark_emoji_master_change_audits
         WHEN NEW.action = 'EMOJI_MASTER_UPDATE' AND NEW.resource_id = '${created.id}'
         BEGIN SELECT RAISE(IGNORE); END;`
      : `CREATE TRIGGER ${triggerName} AFTER INSERT ON fanmark_emoji_master_change_audits
         WHEN NEW.action = 'EMOJI_MASTER_UPDATE' AND NEW.resource_id = '${created.id}'
         BEGIN UPDATE fanmark_emoji_master_change_audits SET metadata = '{}' WHERE id = NEW.id; END;`;
    await master().prepare(definition).run();
    try {
      await expect(repository().update(created.id, created.updatedAt, { ...input, shortName: "should_rollback" }))
        .rejects.toMatchObject({ code: "emoji_master_write_failed", status: 503 });
      expect(await repository().getById(created.id)).toEqual(created);
      expect(await audits(created.id)).toEqual(baseline);
      await expectEmptyContext();
    } finally {
      await master().prepare(`DROP TRIGGER ${triggerName}`).run();
    }
    await repository().update(created.id, created.updatedAt, { ...input, shortName: "retry_committed" });
    expect(await audits(created.id)).toHaveLength(2);
    await expectEmptyContext();
  });

  it("rolls back a mixed insert/upsert import when any row lacks its audit, then retries with one shared request", async () => {
    const created = await repository().create(input);
    const baseline = await audits(created.id);
    const insertedInput = { ...input, emoji: "🪀", shortName: "audit_yoyo", codepoints: ["1FA80"] };
    await master().prepare(`CREATE TRIGGER synthetic_import_audit_failure BEFORE INSERT ON fanmark_emoji_master_change_audits
      WHEN json_extract(NEW.metadata, '$.emoji') = '🪀'
      BEGIN SELECT RAISE(IGNORE); END;`).run();
    try {
      await expect(repository().import([{ ...input, shortName: "rolled_back_upsert" }, insertedInput]))
        .rejects.toMatchObject({ code: "emoji_master_write_failed", status: 503 });
      expect(await repository().getById(created.id)).toEqual(created);
      expect(await audits(created.id)).toEqual(baseline);
      expect(await master().prepare("SELECT id FROM emoji_master WHERE emoji = ?").bind(insertedInput.emoji).first()).toBeNull();
      await expectEmptyContext();
    } finally {
      await master().prepare("DROP TRIGGER synthetic_import_audit_failure").run();
    }
    expect(await repository().import([{ ...input, shortName: "committed_upsert" }, insertedInput])).toEqual({ importedCount: 2 });
    const changed = await audits(created.id);
    const added = await master().prepare("SELECT id, created_at, updated_at FROM emoji_master WHERE emoji = ?")
      .bind(insertedInput.emoji).first<{ id: string; created_at: string; updated_at: string }>();
    expect(changed).toHaveLength(2);
    expect(changed[1].action).toBe("EMOJI_MASTER_UPDATE");
    expect(added).toMatchObject({ created_at: operationAt, updated_at: operationAt });
    const inserted = await audits(added!.id);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: verifiedUserId, action: "EMOJI_MASTER_INSERT", request_id: changed[1].request_id });
    expect(await master().prepare("SELECT created_at FROM emoji_master WHERE id = ?").bind(created.id).first())
      .toEqual({ created_at: operationAt });
    await expectEmptyContext();
  });

  it("imports 100 records atomically with one per-row audit and preserves UUIDs on repeated upsert", async () => {
    const records = Array.from({ length: 100 }, (_, index) => ({
      ...input, emoji: String.fromCodePoint(0x1F300 + index), shortName: `audit_bulk_${index}`,
      codepoints: [(0x1F300 + index).toString(16).toUpperCase()], sortOrder: index,
    }));
    expect(await repository().import(records)).toEqual({ importedCount: 100 });
    const before = (await master().prepare(`SELECT id, emoji, short_name, created_at, updated_at FROM emoji_master
      WHERE short_name LIKE 'audit_bulk_%' ORDER BY emoji`).all<{ id: string; emoji: string; short_name: string; created_at: string; updated_at: string }>()).results;
    expect(before).toHaveLength(100);
    expect(new Set(before.map(row => row.id)).size).toBe(100);
    const initialAudits = (await master().prepare(`SELECT resource_id, action, user_id, request_id, metadata, created_at
      FROM fanmark_emoji_master_change_audits WHERE json_extract(metadata, '$.short_name') LIKE 'audit_bulk_%'`)
      .all<{ resource_id: string; action: string; user_id: string; request_id: string; metadata: string; created_at: string }>()).results;
    expect(initialAudits).toHaveLength(100);
    expect(new Set(initialAudits.map(row => row.request_id)).size).toBe(1);
    for (const row of before) {
      expect(initialAudits.find(audit => audit.resource_id === row.id)).toMatchObject({
        action: "EMOJI_MASTER_INSERT", user_id: verifiedUserId, created_at: operationAt,
        metadata: JSON.stringify({ emoji: row.emoji, short_name: row.short_name }),
      });
    }
    expect(await repository().import(records)).toEqual({ importedCount: 100 });
    const after = (await master().prepare(`SELECT id, emoji, short_name, created_at, updated_at FROM emoji_master
      WHERE short_name LIKE 'audit_bulk_%' ORDER BY emoji`).all()).results;
    expect(after).toEqual(before.map(row => ({ ...row, updated_at: "2026-10-03T01:02:03.457000Z" })));
    const all = await master().prepare(`SELECT action, count(*) AS count, count(DISTINCT request_id) AS requests
      FROM fanmark_emoji_master_change_audits WHERE json_extract(metadata, '$.short_name') LIKE 'audit_bulk_%' GROUP BY action`).all();
    expect(all.results).toEqual([
      { action: "EMOJI_MASTER_INSERT", count: 100, requests: 1 },
      { action: "EMOJI_MASTER_UPDATE", count: 100, requests: 1 },
    ]);
    await expectEmptyContext();
  });

  it("keeps simultaneous actors isolated and rejects writes without an authenticated actor", async () => {
    const other = { ...input, emoji: "🪂", shortName: "audit_parachute", codepoints: ["1FA82"] };
    await expect(repository("invalid-actor").create(input)).rejects.toMatchObject({ code: "emoji_admin_actor_unavailable", status: 503 });
    const noActor = createEmojiMasterAdminD1Repository({ ...runtimeEnv, EMOJI_MASTER_ADMIN_BACKEND: "d1" });
    await expect(noActor.create(input)).rejects.toMatchObject({ code: "emoji_admin_actor_unavailable", status: 503 });
    const [first, second] = await Promise.all([repository().create(input), repository(unverifiedUserId).create(other)]);
    expect((await audits(first.id))[0]).toMatchObject({ user_id: verifiedUserId, action: "EMOJI_MASTER_INSERT" });
    expect((await audits(second.id))[0]).toMatchObject({ user_id: unverifiedUserId, action: "EMOJI_MASTER_INSERT" });
    expect((await audits(first.id))[0].request_id).not.toBe((await audits(second.id))[0].request_id);
    await expectEmptyContext();
  });

  it("audits trusted direct insert/update/delete with a NULL actor and preserves deletion history", async () => {
    const id = crypto.randomUUID();
    await master().prepare(`INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory,
      codepoints, sort_order, created_at, updated_at) VALUES (?, ?, ?, '[]', NULL, NULL, ?, NULL, ?, ?)`)
      .bind(id, "🪃", "audit_boomerang", '["1FA83"]', operationAt, operationAt).run();
    await master().prepare("UPDATE emoji_master SET short_name = 'audit_boomerang_updated' WHERE id = ?").bind(id).run();
    await master().prepare("DELETE FROM emoji_master WHERE id = ?").bind(id).run();
    const rows = await audits(id);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.action)).toEqual(["EMOJI_MASTER_INSERT", "EMOJI_MASTER_UPDATE", "EMOJI_MASTER_DELETE"]);
    for (const row of rows) {
      expect(row).toMatchObject({ user_id: null, request_id: null, resource_type: "emoji_master", resource_id: id });
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    }
    expect(JSON.parse(rows[2].metadata)).toEqual({ emoji: "🪃", short_name: "audit_boomerang_updated" });
    expect(await master().prepare("SELECT id FROM emoji_master WHERE id = ?").bind(id).first()).toBeNull();
    await expectEmptyContext();
  });
});

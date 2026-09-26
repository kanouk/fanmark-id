import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import emojiMasterSchemaSql from "../migrations/0000_emoji_master.sql?raw";
import emojiReleaseSchemaSql from "../migrations/0001_emoji_master_release_staging.sql?raw";
import emojiActivationSchemaSql from "../migrations/0002_emoji_master_release_activation.sql?raw";
import schemaSql from "../migrations/0003_better_auth_core.sql?raw";
import referenceMasterSchemaSql from "../migrations/0004_reference_master_releases.sql?raw";
import emojiAdminGuardsSchemaSql from "../migrations/0005_emoji_master_admin_guards.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.AUTH_DB;
const masterDatabase = runtimeEnv.MASTER_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const verifiedUserId = "5c5f9001-449c-4b7f-a01d-284302a71ea1";
const unverifiedUserId = "ad06c38f-c004-4e87-a442-17e35c59187b";
const syntheticAdminFactorId = "80000000-0000-4000-8000-000000000001";
const verifiedEmail = "auth-worker@example.invalid";
const unverifiedEmail = "unverified-worker@example.invalid";
const password = "Synthetic-Auth-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);

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

beforeAll(async () => {
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  await database.batch(
    splitMigrationStatements(schemaSql).map((statement) => database.prepare(statement)),
  );
  if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
  const masterMigrations = [
    emojiMasterSchemaSql,
    emojiReleaseSchemaSql,
    emojiActivationSchemaSql,
    schemaSql,
    referenceMasterSchemaSql,
    emojiAdminGuardsSchemaSql,
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

    // This auth-only fixture deliberately has no business D1; 503 proves the
    // request passed the same role/session/factor MFA gate as other admin APIs.
    const authorized = await notificationMasterAdminRequest("/rules", { headers: { cookie: first.cookie } });
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

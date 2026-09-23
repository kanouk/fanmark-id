import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "../migrations/0003_better_auth_core.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const verifiedUserId = "5c5f9001-449c-4b7f-a01d-284302a71ea1";
const unverifiedUserId = "ad06c38f-c004-4e87-a442-17e35c59187b";
const verifiedEmail = "auth-worker@example.invalid";
const unverifiedEmail = "unverified-worker@example.invalid";
const password = "Synthetic-Auth-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);

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

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
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
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  const row = await database
    .prepare('SELECT count(*) AS "count" FROM "session" WHERE "userId" = ?')
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

beforeAll(async () => {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(
    splitMigrationStatements(schemaSql).map((statement) => database.prepare(statement)),
  );
});

beforeEach(resetFixture);

describe("Better Auth through the application Worker", () => {
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

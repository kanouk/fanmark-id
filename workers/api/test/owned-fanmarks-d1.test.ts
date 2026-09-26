import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import businessSchemaSql from "./fixtures/verified-access-source-shaped.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "5c5f9001-449c-4b7f-a01d-284302a71ea1";
const otherId = "ad06c38f-c004-4e87-a442-17e35c59187b";
const ownerEmail = "owned-fanmarks-owner@example.invalid";
const otherEmail = "owned-fanmarks-other@example.invalid";
const password = "Synthetic-Owned-Fanmarks-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);
const now = "2026-09-24T00:00:00.000Z";
const emojiId = "3db6bb72-0bda-437a-a943-10ca9329b51b";

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
    const candidate = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(candidate) && !/\bend\s*$/iu.test(candidate)) continue;
    if (candidate) statements.push(candidate);
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

async function resetAuthUsers(): Promise<void> {
  if (!authDatabase) throw new Error("AUTH_DB binding unavailable");
  await authDatabase.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(ownerId, otherId).run();
  for (const [id, email, name] of [
    [ownerId, ownerEmail, "Synthetic Owner"],
    [otherId, otherEmail, "Synthetic Other"],
  ]) {
    await authDatabase.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await authDatabase.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, passwordHash, now, now).run();
  }
}

async function resetBusinessRows(): Promise<void> {
  if (!businessDatabase) throw new Error("FANMARK_DB binding unavailable");
  await businessDatabase.prepare("DELETE FROM fanmark_licenses WHERE id LIKE 'synthetic-owned-%'").run();
  await businessDatabase.prepare("DELETE FROM fanmarks WHERE id LIKE 'synthetic-owned-%'").run();
  const rows = [
    { id: "synthetic-owned-one", userId: ownerId, status: "active", fanmark: "🌿", name: "Synthetic Leaf" },
    { id: "synthetic-owned-two", userId: ownerId, status: "expired", fanmark: "🧪", name: null },
    { id: "synthetic-owned-other", userId: otherId, status: "active", fanmark: "🔒", name: "Other User Secret" },
  ];
  for (const [index, row] of rows.entries()) {
    await businessDatabase.prepare(
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status, tier_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)",
    ).bind(row.id, `short-${index}-id`, row.fanmark, row.fanmark, JSON.stringify([emojiId]), JSON.stringify([emojiId]), now, now).run();
    await businessDatabase.prepare(
      "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, grace_expires_at, status, is_returned, excluded_at, plan_excluded, created_at, display_fanmark) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL, 0, ?, ?)",
    ).bind(`synthetic-owned-license-${index}`, row.id, row.userId, now, null, row.status, now, row.fanmark).run();
    if (row.name) {
      await businessDatabase.prepare(
        "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, 'inactive')",
      ).bind(`synthetic-owned-config-${index}`, `synthetic-owned-license-${index}`, row.name).run();
    }
  }
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(businessSchemaSql).map((statement) => businessDatabase.prepare(statement)));
});

beforeEach(async () => {
  await resetAuthUsers();
  await resetBusinessRows();
});

describe("Better Auth owner-scoped fanmark dashboard API", () => {
  it("returns only the signed-in owner's active and expired licenses", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request("/api/me/fanmarks", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");

    const body = await response.json() as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(body.schemaVersion).toBe(1);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item) => item.id)).toEqual(["synthetic-owned-one", "synthetic-owned-two"]);
    expect(body.items[0].fanmark_name).toBe("Synthetic Leaf");
    expect(body.items[1].fanmark_name).toBe("🧪");
    expect(body.items.some((item) => JSON.stringify(item).includes("Other User Secret"))).toBe(false);
    expect(JSON.stringify(body)).not.toContain(ownerEmail);
    expect(JSON.stringify(body)).not.toContain(otherEmail);
    expect(JSON.stringify(body)).not.toContain("user_id");
  });

  it("uses the Better Auth session owner even if a caller supplies another user id", async () => {
    const cookie = await signIn(ownerEmail);
    const response = await request(`/api/me/fanmarks?userId=${otherId}`, { headers: { Cookie: cookie } });
    const body = await response.json() as { items: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.id)).toEqual(["synthetic-owned-one", "synthetic-owned-two"]);

    const otherCookie = await signIn(otherEmail);
    const otherResponse = await request("/api/me/fanmarks", { headers: { Cookie: otherCookie } });
    const otherBody = await otherResponse.json() as { items: Array<{ id: string }> };
    expect(otherBody.items.map((item) => item.id)).toEqual(["synthetic-owned-other"]);
  });

  it("fails closed on ambiguous configs and malformed source projections", async () => {
    const cookie = await signIn(ownerEmail);
    await businessDatabase?.prepare(
      "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, 'profile')",
    ).bind("synthetic-owned-duplicate-config", "synthetic-owned-license-0", "Ambiguous config").run();
    expect((await request("/api/me/fanmarks", { headers: { Cookie: cookie } })).status).toBe(503);

    await businessDatabase?.prepare(
      "DELETE FROM fanmark_basic_configs WHERE id = ?",
    ).bind("synthetic-owned-duplicate-config").run();
    await businessDatabase?.prepare("UPDATE fanmarks SET emoji_ids = ? WHERE id = ?")
      .bind("not-json", "synthetic-owned-one").run();
    expect((await request("/api/me/fanmarks", { headers: { Cookie: cookie } })).status).toBe(503);
  });

  it("requires a session and enforces CORS, method, and explicit backend selection", async () => {
    expect((await request("/api/me/fanmarks")).status).toBe(401);
    expect((await request("/api/me/fanmarks", { method: "POST" })).status).toBe(405);
    expect((await request("/api/me/fanmarks", {}, { OWNED_FANMARKS_BACKEND: undefined })).status).toBe(503);

    const forbidden = await request("/api/me/fanmarks", {
      headers: { Origin: "https://attacker.example.test" },
    });
    expect(forbidden.status).toBe(403);

    const preflight = await request("/api/me/fanmarks", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "GET" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

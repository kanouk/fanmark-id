import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import emojiReleaseSchemaSql from "../migrations/0001_emoji_master_release_staging.sql?raw";
import emojiReleaseActivationSql from "../migrations/0002_emoji_master_release_activation.sql?raw";
import businessSchemaSql from "./fixtures/d1-favorites.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const authDatabase = runtimeEnv.AUTH_DB;
const businessDatabase = runtimeEnv.FANMARK_DB;
const masterDatabase = runtimeEnv.MASTER_DB;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const ownerId = "43f99b7a-4b4c-4e93-8d01-d7f65e2d2291";
const otherId = "3a59ef8f-c70f-4eb5-9df4-513ee9369f42";
const ownerEmail = "favorites-owner@example.invalid";
const otherEmail = "favorites-other@example.invalid";
const password = "Synthetic-Favorites-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);
const now = "2026-09-25T00:00:00.000Z";
const releaseVersion = "a".repeat(64);
const baseEmojiId = "5bb06a1c-a5d2-4e3f-a31d-58fce75887b3";
const tonedEmojiId = "d821bc9f-781a-48d5-84e8-b21c54f36627";
const fanmarkId = "d66106d0-5b1d-4b51-9ba4-7f93e7075d3a";
const discoveryId = "bc542077-4405-48cd-9ac7-bab2e7dc10d7";

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (!singleQuoted && !doubleQuoted && character === "-" && next === "-") {
      const lineEnd = sql.indexOf("\n", index + 2);
      if (lineEnd < 0) break;
      index = lineEnd;
      continue;
    }
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
    if (candidate && candidate.split(/\r?\n/u).some((line) => line.trim() && !line.trim().startsWith("--"))) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement && finalStatement.split(/\r?\n/u).some((line) => line.trim() && !line.trim().startsWith("--"))) statements.push(finalStatement);
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
    [ownerId, ownerEmail, "Synthetic Favorite Owner"],
    [otherId, otherEmail, "Synthetic Other Owner"],
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
  for (const table of [
    "fanmark_events", "fanmark_favorites", "fanmark_discoveries", "fanmark_password_configs",
    "fanmark_messageboard_configs", "fanmark_redirect_configs", "fanmark_basic_configs",
    "fanmark_licenses", "user_settings", "fanmarks",
  ]) await businessDatabase.prepare(`DELETE FROM ${table}`).run();
  await businessDatabase.prepare("INSERT INTO fanmarks (id, short_id) VALUES (?, ?)").bind(fanmarkId, "leaf-42").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind("16771e22-69db-42bd-a8c4-8d0d46aa3957", fanmarkId, otherId, now, "2026-09-24T00:00:00.000Z", "active").run();
  await businessDatabase.prepare(
    "INSERT INTO user_settings (id, user_id, username, display_name) VALUES (?, ?, ?, ?)",
  ).bind("7876f608-6fda-4616-b6b3-5fb1f013ee66", otherId, "synthetic-owner", "Synthetic Owner").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)",
  ).bind("b4c9d1a2-5c12-452f-96ce-2614f1343aad", "16771e22-69db-42bd-a8c4-8d0d46aa3957", "Synthetic Leaf", "redirect").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_redirect_configs (id, license_id, target_url) VALUES (?, ?, ?)",
  ).bind("77e35468-fc22-4f78-a1be-585456a83dbf", "16771e22-69db-42bd-a8c4-8d0d46aa3957", "https://example.invalid/leaf").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_messageboard_configs (id, license_id, content) VALUES (?, ?, ?)",
  ).bind("8dc4f3d4-5c70-44ca-8142-5182772946fa", "16771e22-69db-42bd-a8c4-8d0d46aa3957", "synthetic public text").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_password_configs (id, license_id, is_enabled) VALUES (?, ?, 1)",
  ).bind("dd139865-4fd5-4a25-8e84-21d661aa3377", "16771e22-69db-42bd-a8c4-8d0d46aa3957").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_discoveries (id, emoji_ids, normalized_emoji_ids, fanmark_id, availability_status, first_seen_at, last_seen_at, search_count, favorite_count) VALUES (?, ?, ?, ?, 'claimed_external', ?, ?, 4, 0)",
  ).bind(discoveryId, JSON.stringify([baseEmojiId]), JSON.stringify([baseEmojiId]), fanmarkId, now, now).run();
}

async function insertOtherOwnerFavorite(): Promise<void> {
  await businessDatabase?.prepare(
    "INSERT INTO fanmark_favorites (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind("48716cda-b655-4be4-8522-7476657bd119", otherId, discoveryId, fanmarkId, JSON.stringify([baseEmojiId]), now, "👋").run();
  await businessDatabase?.prepare("UPDATE fanmark_discoveries SET favorite_count = 2 WHERE id = ?").bind(discoveryId).run();
}

beforeAll(async () => {
  if (!authDatabase || !businessDatabase || !masterDatabase) throw new Error("Split D1 bindings unavailable");
  await authDatabase.batch(splitSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  await businessDatabase.batch(splitSqlStatements(businessSchemaSql).map((statement) => businessDatabase.prepare(statement)));
  await masterDatabase.batch([
    ...splitSqlStatements(emojiReleaseSchemaSql).map((statement) => masterDatabase.prepare(statement)),
    ...splitSqlStatements(emojiReleaseActivationSql).map((statement) => masterDatabase.prepare(statement)),
  ]);
  await masterDatabase.prepare(
    "INSERT INTO fanmark_emoji_master_release_imports (release_version, manifest_json, row_count, status, verified_at) VALUES (?, '{}', 2, 'loading', NULL)",
  ).bind(releaseVersion).run();
  for (const [ordinal, id, emoji, codepointsJson] of [
    [1, baseEmojiId, "👋", '["1F44B"]'],
    [2, tonedEmojiId, "👋🏽", '["1F44B","1F3FD"]'],
  ] as const) {
    await masterDatabase.prepare(
      "INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order) VALUES (?, ?, ?, ?, ?, '[]', 'People & Body', 'hand-fingers-open', ?, ?)",
    ).bind(releaseVersion, ordinal, id, emoji, `synthetic-${ordinal}`, codepointsJson, ordinal).run();
  }
  await masterDatabase.prepare(
    "UPDATE fanmark_emoji_master_release_imports SET status = 'ready', verified_at = ? WHERE release_version = ?",
  ).bind(now, releaseVersion).run();
  await masterDatabase.prepare(
    "INSERT INTO fanmark_emoji_master_active_release (singleton_id, release_version, previous_release_version, activation_id, action, generation, updated_at) VALUES (1, ?, NULL, ?, 'promotion', 1, ?)",
  ).bind(releaseVersion, "synthetic-favorites-release-activation", now).run();
});

beforeEach(async () => {
  await resetAuthUsers();
  await resetBusinessRows();
});

describe("Better Auth favorites D1 API", () => {
  it("normalizes skin tones through the active emoji release and makes add idempotent", async () => {
    const cookie = await signIn(ownerEmail);
    const body = JSON.stringify({ input_emoji_ids: [tonedEmojiId], input_display_fanmark: "👋🏽" });
    const concurrentAdds = await Promise.all([
      request("/api/me/favorites", { method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body }),
      request("/api/me/favorites", { method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body }),
    ]);
    expect(concurrentAdds.map((response) => response.status)).toEqual([200, 200]);
    const addResults = await Promise.all(concurrentAdds.map((response) => response.json() as Promise<{ added: boolean }>));
    expect(addResults.map((result) => result.added).sort()).toEqual([false, true]);

    const discovery = await businessDatabase?.prepare(
      "SELECT emoji_ids AS emojiIds, normalized_emoji_ids AS normalizedIds, favorite_count AS favoriteCount FROM fanmark_discoveries WHERE id = ?",
    ).bind(discoveryId).first<{ emojiIds: string; normalizedIds: string; favoriteCount: number }>();
    expect(discovery?.emojiIds).toBe(JSON.stringify([tonedEmojiId]));
    expect(discovery?.normalizedIds).toBe(JSON.stringify([baseEmojiId]));
    expect(discovery?.favoriteCount).toBe(1);
    const events = await businessDatabase?.prepare("SELECT event_type AS type FROM fanmark_events ORDER BY id").all<{ type: string }>();
    expect(events?.results?.map((row) => row.type)).toEqual(["favorite_add"]);
  });

  it("returns only the session owner's favorites with the existing favorite DTO", async () => {
    const cookie = await signIn(ownerEmail);
    const add = await request("/api/me/favorites", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
    });
    expect(add.status).toBe(200);
    await insertOtherOwnerFavorite();

    const response = await request("/api/me/favorites", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      favorite_id: expect.any(String),
      discovery_id: discoveryId,
      display_fanmark: "👋",
      normalized_emoji_ids: [baseEmojiId],
      emoji_ids: [baseEmojiId],
      favorite_count: 2,
      short_id: "leaf-42",
      fanmark_name: "Synthetic Leaf",
      access_type: "redirect",
      target_url: "https://example.invalid/leaf",
      text_content: "synthetic public text",
      current_owner_username: "synthetic-owner",
      current_owner_display_name: "Synthetic Owner",
      current_license_status: "active",
      is_password_protected: true,
    });
    expect(JSON.stringify(payload)).not.toContain(otherEmail);
  });

  it("removes only the caller's favorite and preserves counts and event history", async () => {
    const cookie = await signIn(ownerEmail);
    const add = await request("/api/me/favorites", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
    });
    expect(add.status).toBe(200);
    await insertOtherOwnerFavorite();

    const remove = async () => request("/api/me/favorites", {
      method: "DELETE",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId] }),
    });
    const removed = await remove();
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true });
    const duplicate = await remove();
    expect(await duplicate.json()).toEqual({ removed: false });

    const discovery = await businessDatabase?.prepare("SELECT favorite_count AS favoriteCount FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first<{ favoriteCount: number }>();
    expect(discovery?.favoriteCount).toBe(1);
    const events = await businessDatabase?.prepare("SELECT event_type AS type FROM fanmark_events ORDER BY id").all<{ type: string }>();
    expect(events?.results?.map((row) => row.type)).toEqual(["favorite_add", "favorite_remove"]);
    const remaining = await businessDatabase?.prepare("SELECT count(*) AS count FROM fanmark_favorites").first<{ count: number }>();
    expect(remaining?.count).toBe(1);
  });

  it("requires auth, explicit backend selection, a trusted origin for writes, and valid emoji ids", async () => {
    expect((await request("/api/me/favorites")).status).toBe(401);
    expect((await request("/api/me/favorites", {}, { FAVORITES_BACKEND: undefined })).status).toBe(503);
    const cookie = await signIn(ownerEmail);
    const invalid = await request("/api/me/favorites", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: ["not-a-uuid"], input_display_fanmark: "x" }),
    });
    expect(invalid.status).toBe(400);
    const untrusted = await request("/api/me/favorites", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://attacker.example.test", "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId] }),
    });
    expect(untrusted.status).toBe(403);
    const noOrigin = await request("/api/me/favorites", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "", "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
    });
    expect(noOrigin.status).toBe(403);
  });
});

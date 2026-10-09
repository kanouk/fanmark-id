import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import authSchemaSql from "../migrations/0003_better_auth_core.sql?raw";
import emojiReleaseSchemaSql from "../migrations/0001_emoji_master_release_staging.sql?raw";
import emojiReleaseActivationSql from "../migrations/0002_emoji_master_release_activation.sql?raw";
import { checkedInSqlStatements } from "./schema-statements";
declare module "vitest" {
  export interface ProvidedContext { businessFavoritesMigrations: Array<{ name: string; sql: string }>; }
}
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
const licenseId = "16771e22-69db-42bd-a8c4-8d0d46aa3957";
const discoveryId = "bc542077-4405-48cd-9ac7-bab2e7dc10d7";
const searchSyntheticIp = "192.0.2.77";
let searchLimiterMode: "allowed" | "blocked" = "allowed";
const searchLimiterKeys: string[] = [];
const searchLimiter = {
  async limit({ key }: { key: string }) {
    searchLimiterKeys.push(key);
    return { success: searchLimiterMode === "allowed" };
  },
};

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
  await businessDatabase.prepare("INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, tier_level, created_at, updated_at, emoji_ids, normalized_emoji_ids) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)").bind(fanmarkId, "leaf-42", "👋", "👋", now, now, JSON.stringify([baseEmojiId]), JSON.stringify([baseEmojiId])).run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind(licenseId, fanmarkId, otherId, now, "2026-09-24T00:00:00.000Z", "active").run();
  await businessDatabase.prepare(
    "INSERT INTO user_settings (id, user_id, username, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind("7876f608-6fda-4616-b6b3-5fb1f013ee66", otherId, "synthetic-owner", "Synthetic Owner").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind("b4c9d1a2-5c12-452f-96ce-2614f1343aad", licenseId, "Synthetic Leaf", "redirect").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_redirect_configs (id, license_id, target_url, created_at, updated_at) VALUES (?, ?, ?, '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind("77e35468-fc22-4f78-a1be-585456a83dbf", licenseId, "https://example.invalid/leaf").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_messageboard_configs (id, license_id, content, created_at, updated_at) VALUES (?, ?, ?, '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind("8dc4f3d4-5c70-44ca-8142-5182772946fa", licenseId, "synthetic public text").run();
  await businessDatabase.prepare(
    "INSERT INTO fanmark_password_configs (id, license_id, is_enabled, access_password, created_at, updated_at) VALUES (?, ?, 1, 'synthetic-password-not-used', '2026-09-25T00:00:00.000000Z', '2026-09-25T00:00:00.000000Z')",
  ).bind("dd139865-4fd5-4a25-8e84-21d661aa3377", licenseId).run();
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
  await authDatabase.batch(checkedInSqlStatements(authSchemaSql).map((statement) => authDatabase.prepare(statement)));
  const migrations = inject("businessFavoritesMigrations");
  expect(migrations.length).toBeGreaterThanOrEqual(25);
  for (const migration of migrations) {
    const parts = checkedInSqlStatements(migration.sql);
    for (let offset = 0; offset < parts.length; offset += 50) {
      await businessDatabase.batch(parts.slice(offset, offset + 50).map(sql => businessDatabase.prepare(sql)));
    }
  }
  await masterDatabase.batch([
    ...checkedInSqlStatements(emojiReleaseSchemaSql).map((statement) => masterDatabase.prepare(statement)),
    ...checkedInSqlStatements(emojiReleaseActivationSql).map((statement) => masterDatabase.prepare(statement)),
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
  searchLimiterMode = "allowed";
  searchLimiterKeys.length = 0;
  await resetAuthUsers();
  await resetBusinessRows();
});

afterEach(async () => {
  expect((await businessDatabase!.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

describe("Better Auth favorites D1 API", () => {
  it("preserves exact int64 counters through search and favorite mutations", async () => {
    await businessDatabase!.prepare("UPDATE fanmark_discoveries SET search_count = CAST(? AS INTEGER), favorite_count = CAST(? AS INTEGER) WHERE id = ?")
      .bind("9007199254740993", "9007199254740995", discoveryId).run();
    const counters = () => businessDatabase!.prepare("SELECT CAST(search_count AS TEXT) AS searches, CAST(favorite_count AS TEXT) AS favorites FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first();
    const search = await request("/api/fanmarks/search/record", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(search.status).toBe(200);
    expect(await counters()).toEqual({ searches: "9007199254740994", favorites: "9007199254740995" });
    const cookie = await signIn(ownerEmail);
    const favorite = (method: "POST" | "DELETE") => request("/api/me/favorites", {
      method, headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId], ...(method === "POST" ? { input_display_fanmark: "👋🏽" } : {}) }),
    });
    expect((await favorite("POST")).status).toBe(200);
    expect(await counters()).toEqual({ searches: "9007199254740994", favorites: "9007199254740996" });
    expect(await (await favorite("POST")).json()).toEqual({ added: false });
    expect(await counters()).toEqual({ searches: "9007199254740994", favorites: "9007199254740996" });
    expect((await favorite("DELETE")).status).toBe(200);
    expect(await counters()).toEqual({ searches: "9007199254740994", favorites: "9007199254740995" });
  });

  it("rolls back counter overflow without recording a successful search", async () => {
    await businessDatabase!.prepare("UPDATE fanmark_discoveries SET search_count = CAST(? AS INTEGER) WHERE id = ?")
      .bind("9223372036854775807", discoveryId).run();
    const before = await businessDatabase!.prepare("SELECT emoji_ids, last_seen_at, CAST(search_count AS TEXT) AS count FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first();
    const response = await request("/api/fanmarks/search/record", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(response.status).toBe(503);
    expect(await businessDatabase!.prepare("SELECT emoji_ids, last_seen_at, CAST(search_count AS TEXT) AS count FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first()).toEqual(before);
    expect(await businessDatabase!.prepare("SELECT count(*) AS count FROM fanmark_events").first()).toEqual({ count: 0 });
  });

  it.each(["favorite-event", "favorite-count", "search-event", "remove-event"])("rolls back %s suppression and permits retry", async (fault) => {
    const cookie = await signIn(ownerEmail);
    const mutate = () => request("/api/me/favorites", {
      method: fault === "remove-event" ? "DELETE" : "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId], ...(fault === "remove-event" ? {} : { input_display_fanmark: "👋🏽" }) }),
    });
    const search = () => request("/api/fanmarks/search/record", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    if (fault === "remove-event") {
      expect((await request("/api/me/favorites", {
        method: "POST", headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
      })).status).toBe(200);
    }
    const snapshot = async () => Promise.all(["fanmark_discoveries", "fanmark_favorites", "fanmark_events", "sqlite_sequence"].map(async table => ({
      table, rows: (await businessDatabase!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results,
    })));
    const before = await snapshot();
    const trigger = fault === "favorite-count"
      ? `CREATE TRIGGER synthetic_discovery_fault BEFORE UPDATE OF favorite_count ON fanmark_discoveries WHEN NEW.id = '${discoveryId}' BEGIN SELECT RAISE(IGNORE); END`
      : `CREATE TRIGGER synthetic_discovery_fault BEFORE INSERT ON fanmark_events WHEN NEW.event_type = '${fault === "search-event" ? "search" : fault === "remove-event" ? "favorite_remove" : "favorite_add"}' BEGIN SELECT RAISE(IGNORE); END`;
    await businessDatabase!.prepare(trigger).run();
    try {
      const response = await (fault === "search-event" ? search() : mutate());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await snapshot()).toEqual(before);
    } finally {
      await businessDatabase!.prepare("DROP TRIGGER synthetic_discovery_fault").run();
    }
    const retry = await (fault === "search-event" ? search() : mutate());
    expect(retry.status).toBe(200);
  });

  it("records anonymous aggregate searches atomically without storing a user id", async () => {
    const response = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [tonedEmojiId] }),
    }, {
      FANMARK_SEARCH_BACKEND: "d1",
      FANMARK_SEARCH_LIMITER: searchLimiter,
      CORS_ALLOWED_ORIGINS: appOrigin,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ schemaVersion: 1, recorded: true });

    const discovery = await businessDatabase?.prepare(
      "SELECT emoji_ids AS emojiIds, normalized_emoji_ids AS normalizedIds, search_count AS searchCount, last_seen_at AS lastSeenAt FROM fanmark_discoveries WHERE id = ?",
    ).bind(discoveryId).first<{ emojiIds: string; normalizedIds: string; searchCount: number; lastSeenAt: string }>();
    expect(discovery).toEqual({
      emojiIds: JSON.stringify([tonedEmojiId]),
      normalizedIds: JSON.stringify([baseEmojiId]),
      searchCount: 5,
      lastSeenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u),
    });
    const events = await businessDatabase?.prepare(
      "SELECT event_type AS type, user_id AS userId, discovery_id AS discoveryId, normalized_emoji_ids AS normalizedIds, created_at AS createdAt FROM fanmark_events ORDER BY id",
    ).all<{ type: string; userId: string | null; discoveryId: string; normalizedIds: string; createdAt: string }>();
    expect(events?.results).toEqual([{
      type: "search", userId: null, discoveryId,
      normalizedIds: JSON.stringify([baseEmojiId]),
      createdAt: discovery?.lastSeenAt,
    }]);
    expect(events?.results?.[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(searchLimiterKeys).toHaveLength(1);
    expect(searchLimiterKeys[0]).toMatch(/^fanmark-search:v1:[0-9a-f]{64}$/u);
    expect(searchLimiterKeys[0]).not.toContain(searchSyntheticIp);
  });

  it("binds one canonical timestamp on new search and favorite discovery writes", async () => {
    const searchIds = [baseEmojiId, baseEmojiId];
    const searchKey = JSON.stringify(searchIds);
    const search = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: searchIds }),
    }, {
      FANMARK_SEARCH_BACKEND: "d1",
      FANMARK_SEARCH_LIMITER: searchLimiter,
      CORS_ALLOWED_ORIGINS: appOrigin,
    });
    expect(search.status).toBe(200);
    const searchedDiscovery = await businessDatabase?.prepare(
      "SELECT first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM fanmark_discoveries WHERE normalized_emoji_ids = ?",
    ).bind(searchKey).first<{ firstSeenAt: string; lastSeenAt: string }>();
    const searchEvent = await businessDatabase?.prepare(
      "SELECT created_at AS createdAt FROM fanmark_events WHERE event_type = 'search' AND normalized_emoji_ids = ?",
    ).bind(searchKey).first<{ createdAt: string }>();
    expect(searchedDiscovery?.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(searchedDiscovery?.lastSeenAt).toBe(searchedDiscovery?.firstSeenAt);
    expect(searchEvent?.createdAt).toBe(searchedDiscovery?.firstSeenAt);

    const cookie = await signIn(ownerEmail);
    const favoriteIds = [baseEmojiId, baseEmojiId, baseEmojiId];
    const favoriteKey = JSON.stringify(favoriteIds);
    const favorite = await request("/api/me/favorites", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: favoriteIds, input_display_fanmark: "👋👋👋" }),
    });
    expect(favorite.status).toBe(200);
    const favoritedDiscovery = await businessDatabase?.prepare(
      "SELECT first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM fanmark_discoveries WHERE normalized_emoji_ids = ?",
    ).bind(favoriteKey).first<{ firstSeenAt: string; lastSeenAt: string }>();
    const favoriteRow = await businessDatabase?.prepare(
      "SELECT created_at AS createdAt FROM fanmark_favorites WHERE user_id = ? AND normalized_emoji_ids = ?",
    ).bind(ownerId, favoriteKey).first<{ createdAt: string }>();
    const favoriteEvent = await businessDatabase?.prepare(
      "SELECT created_at AS createdAt FROM fanmark_events WHERE event_type = 'favorite_add' AND normalized_emoji_ids = ?",
    ).bind(favoriteKey).first<{ createdAt: string }>();
    expect(favoritedDiscovery?.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    expect(favoritedDiscovery?.lastSeenAt).toBe(favoritedDiscovery?.firstSeenAt);
    expect(favoriteRow?.createdAt).toBe(favoritedDiscovery?.firstSeenAt);
    expect(favoriteEvent?.createdAt).toBe(favoritedDiscovery?.firstSeenAt);
  });

  it("fails closed on rate limiting and malformed search writes", async () => {
    searchLimiterMode = "blocked";
    const blocked = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(blocked.status).toBe(429);
    expect(await businessDatabase?.prepare("SELECT search_count FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first<{ search_count: number }>()).toMatchObject({ search_count: 4 });

    searchLimiterMode = "allowed";
    const invalid = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: ["not-a-uuid"] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(invalid.status).toBe(400);

    const missingLimiter = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": searchSyntheticIp },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: undefined, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(missingLimiter.status).toBe(503);

    const untrustedOrigin = await request("/api/fanmarks/search/record", {
      method: "POST",
      headers: { Origin: "https://attacker.example.test", "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId] }),
    }, { FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin });
    expect(untrustedOrigin.status).toBe(403);

    const wrongMethod = await request("/api/fanmarks/search/record", { method: "GET" }, {
      FANMARK_SEARCH_BACKEND: "d1", FANMARK_SEARCH_LIMITER: searchLimiter, CORS_ALLOWED_ORIGINS: appOrigin,
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");

    expect(await businessDatabase?.prepare("SELECT COUNT(*) AS count FROM fanmark_events").first<{ count: number }>())
      .toMatchObject({ count: 0 });
  });

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
      "SELECT emoji_ids AS emojiIds, normalized_emoji_ids AS normalizedIds, favorite_count AS favoriteCount, last_seen_at AS lastSeenAt FROM fanmark_discoveries WHERE id = ?",
    ).bind(discoveryId).first<{ emojiIds: string; normalizedIds: string; favoriteCount: number; lastSeenAt: string }>();
    expect(discovery?.emojiIds).toBe(JSON.stringify([tonedEmojiId]));
    expect(discovery?.normalizedIds).toBe(JSON.stringify([baseEmojiId]));
    expect(discovery?.favoriteCount).toBe(1);
    expect(discovery?.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    const favorite = await businessDatabase?.prepare(
      "SELECT created_at AS createdAt FROM fanmark_favorites WHERE user_id = ? AND normalized_emoji_ids = ?",
    ).bind(ownerId, JSON.stringify([baseEmojiId])).first<{ createdAt: string }>();
    expect(favorite?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
    const events = await businessDatabase?.prepare("SELECT event_type AS type, created_at AS createdAt FROM fanmark_events ORDER BY id")
      .all<{ type: string; createdAt: string }>();
    expect(events?.results?.map((row) => row.type)).toEqual(["favorite_add"]);
    expect(events?.results?.[0]?.createdAt).toBe(favorite?.createdAt);
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
    await businessDatabase?.prepare(
      "UPDATE fanmark_discoveries SET search_count = ?, favorite_count = ? WHERE id = ?",
    ).bind("9007199254740993", "9223372036854775807", discoveryId).run();

    const response = await request("/api/me/favorites", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json() as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(payload.schemaVersion).toBe(2);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      favorite_id: expect.any(String),
      discovery_id: discoveryId,
      display_fanmark: "👋",
      normalized_emoji_ids: [baseEmojiId],
      emoji_ids: [baseEmojiId],
      search_count: "9007199254740993",
      favorite_count: "9223372036854775807",
      short_id: "leaf-42",
      fanmark_name: null,
      access_type: "redirect",
      target_url: null,
      text_content: null,
      current_owner_username: "synthetic-owner",
      current_owner_display_name: "Synthetic Owner",
      current_license_status: "active",
      is_password_protected: true,
    });
    expect(JSON.stringify(payload)).not.toContain(otherEmail);
  });

  it.each(["redirect", "text"])("withholds protected %s content from favorites regardless of the signed-in account or proof-looking cookie", async (accessType) => {
    await businessDatabase?.prepare("UPDATE fanmark_licenses SET license_end = NULL WHERE id = ?").bind(licenseId).run();
    await businessDatabase?.prepare("UPDATE fanmark_basic_configs SET access_type = ? WHERE license_id = ?")
      .bind(accessType, licenseId).run();
    const storedBefore = await businessDatabase?.batch([
      businessDatabase.prepare("SELECT fanmark_name, access_type FROM fanmark_basic_configs WHERE license_id = ?").bind(licenseId),
      businessDatabase.prepare("SELECT target_url FROM fanmark_redirect_configs WHERE license_id = ?").bind(licenseId),
      businessDatabase.prepare("SELECT content FROM fanmark_messageboard_configs WHERE license_id = ?").bind(licenseId),
    ]);
    for (const email of [ownerEmail, otherEmail]) {
      const cookie = await signIn(email);
      const add = await request("/api/me/favorites", {
        method: "POST", headers: { Cookie: cookie, "content-type": "application/json" },
        body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
      });
      expect(add.status).toBe(200);
      const response = await request("/api/me/favorites", {
        headers: { Cookie: `${cookie}; __Host-fanmark_access=synthetic-unverified-proof` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = await response.json() as { items: Array<Record<string, unknown>> };
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        display_fanmark: "👋", short_id: "leaf-42", access_type: accessType,
        is_password_protected: true, fanmark_name: null, target_url: null, text_content: null,
      });
      expect(JSON.stringify(payload)).not.toContain("https://example.invalid/leaf");
      expect(JSON.stringify(payload)).not.toContain("synthetic public text");
      expect(JSON.stringify(payload)).not.toContain("Synthetic Leaf");
    }
    const storedAfter = await businessDatabase?.batch([
      businessDatabase.prepare("SELECT fanmark_name, access_type FROM fanmark_basic_configs WHERE license_id = ?").bind(licenseId),
      businessDatabase.prepare("SELECT target_url FROM fanmark_redirect_configs WHERE license_id = ?").bind(licenseId),
      businessDatabase.prepare("SELECT content FROM fanmark_messageboard_configs WHERE license_id = ?").bind(licenseId),
    ]);
    expect(storedAfter?.map(result => result.results)).toEqual(storedBefore?.map(result => result.results));
  });

  it.each(["disabled", "absent"])("preserves ordinary favorite content when password configuration is %s", async (configuration) => {
    if (configuration === "disabled") {
      await businessDatabase?.prepare("UPDATE fanmark_password_configs SET is_enabled = 0 WHERE license_id = ?").bind(licenseId).run();
    } else {
      await businessDatabase?.prepare("DELETE FROM fanmark_password_configs WHERE license_id = ?").bind(licenseId).run();
    }
    const cookie = await signIn(ownerEmail);
    expect((await request("/api/me/favorites", {
      method: "POST", headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ input_emoji_ids: [baseEmojiId], input_display_fanmark: "👋" }),
    })).status).toBe(200);
    const response = await request("/api/me/favorites", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{
      is_password_protected: false, fanmark_name: "Synthetic Leaf",
      target_url: "https://example.invalid/leaf", text_content: "synthetic public text",
    }] });
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
    const events = await businessDatabase?.prepare("SELECT event_type AS type, created_at AS createdAt FROM fanmark_events ORDER BY id")
      .all<{ type: string; createdAt: string }>();
    expect(events?.results?.map((row) => row.type)).toEqual(["favorite_add", "favorite_remove"]);
    expect(events?.results?.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(row.createdAt))).toBe(true);
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

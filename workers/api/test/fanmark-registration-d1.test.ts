import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import businessSchema from "./fixtures/d1-fanmark-registration.sql?raw";
import masterSchema from "./fixtures/d1-fanmark-registration-master.sql?raw";
import discoveryLinkSql from "../migrations-business/0022_fanmark_discovery_link.sql?raw";
import { handleFanmarkRegistrationRequest } from "../src/fanmark-registration-d1-api";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const business = runtimeEnv.FANMARK_DB;
const master = runtimeEnv.MASTER_DB;
const OWNER = "e62ce4d0-8055-4ecb-9e3a-759d70d659e0";
const OTHER = "2a1b9c5f-3c8a-4890-9e04-3768885b6dd8";
const NOW = "2026-09-25T10:15:23.123000Z";
const PREVIOUS_CREATED_AT = "2026-09-20T08:00:00.000000Z";
const PREVIOUS_UPDATED_AT = "2026-09-21T08:00:00.000000Z";
const CLOCK = () => new Date("2026-09-25T10:15:23.123Z");
const ORIGIN = "https://app.example.test";
const IDS = {
  rose: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  thumb: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  thumbTone: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const RELEASE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function splitStatements(sql: string): string[] {
  return sql.split(/;\s*(?:\r?\n|$)/u).map((part) => part.trim()).filter(Boolean);
}

const requestEnv: Env = {
  ...runtimeEnv,
  D1_TOPOLOGY: "split",
  AUTH_BACKEND: "better-auth",
  FANMARK_REGISTRATION_BACKEND: "d1",
  CORS_ALLOWED_ORIGINS: ORIGIN,
};

async function run(db: D1Database, sql: string, ...values: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...values).run();
}

async function batch(db: D1Database, statements: string[]): Promise<void> {
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

async function reset(): Promise<void> {
  if (!business || !master) throw new Error("Registration D1 bindings unavailable");
  await batch(business, [
    "DELETE FROM fanmark_favorites", "DELETE FROM fanmark_discoveries",
    "DELETE FROM fanmark_profiles", "DELETE FROM fanmark_redirect_configs", "DELETE FROM fanmark_messageboard_configs",
    "DELETE FROM fanmark_basic_configs", "DELETE FROM audit_logs", "DELETE FROM fanmark_lottery_entries",
    "DELETE FROM fanmark_licenses", "DELETE FROM fanmarks", "DELETE FROM system_settings",
  ]);
  await batch(master, [
    "DELETE FROM fanmark_emoji_master_active_release", "DELETE FROM fanmark_emoji_master_release_staging",
    "DELETE FROM fanmark_emoji_master_release_imports", "DELETE FROM fanmark_tiers",
  ]);
  await batch(master, [
    `INSERT INTO fanmark_emoji_master_release_imports (release_version, row_count, status) VALUES ('${RELEASE}', 3, 'ready')`,
    `INSERT INTO fanmark_emoji_master_active_release (singleton_id, release_version) VALUES (1, '${RELEASE}')`,
    `INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, codepoints_json) VALUES ('${RELEASE}', 1, '${IDS.rose}', '🌹', '["1F339"]')`,
    `INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, codepoints_json) VALUES ('${RELEASE}', 2, '${IDS.thumb}', '👍', '["1F44D"]')`,
    `INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, codepoints_json) VALUES ('${RELEASE}', 3, '${IDS.thumbTone}', '👍🏻', '["1F44D","1F3FB"]')`,
    "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (1, 'Tier 1', 30, 1)",
    "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (2, 'Tier 2', 30, 1)",
    "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (3, 'Tier 3', 30, 1)",
    "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, is_active) VALUES (4, 'Tier 4', 30, 1)",
  ]);
}

async function post(body: unknown, userId: string | null = OWNER): Promise<Response> {
  const request = new Request("https://api.example.test/api/fanmarks/register", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return handleFanmarkRegistrationRequest(request, requestEnv,
    async () => ({ available: true, userId }), CLOCK);
}

function registration(body: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_input_fanmark: "🌹",
    emoji_ids: [IDS.rose],
    normalized_emoji_ids: [IDS.rose],
    accessType: "profile",
    displayName: "Rose profile",
    ...body,
  };
}

async function count(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

beforeAll(async () => {
  if (!business || !master) throw new Error("Registration D1 bindings unavailable");
  await batch(business, splitStatements(businessSchema));
  await batch(master, splitStatements(masterSchema));
  await business.prepare(discoveryLinkSql.replace(/^--.*$/gmu, "").trim()).run();
});

beforeEach(reset);

describe("D1 fanmark registration", () => {
  async function seedDiscovery(normalized: Array<string | null>, withFavorites = true) {
    if (!business) throw new Error("FANMARK_DB binding unavailable");
    const id = crypto.randomUUID();
    await run(business, `INSERT INTO fanmark_discoveries
      (id, emoji_ids, normalized_emoji_ids, fanmark_id, availability_status, first_seen_at, last_seen_at, search_count, favorite_count)
      VALUES (?, ?, ?, NULL, 'unclaimed', ?, ?, 9, ?)`, id, JSON.stringify([IDS.rose, IDS.thumb]),
      JSON.stringify(normalized, null, 2), PREVIOUS_CREATED_AT, PREVIOUS_UPDATED_AT, withFavorites ? 2 : 0);
    if (withFavorites) {
      for (const [owner, display] of [[OWNER, "🌹👍🏻"], [OTHER, "🌹👍"]]) {
        await run(business, `INSERT INTO fanmark_favorites
          (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark)
          VALUES (?, ?, ?, NULL, ?, ?, ?)`, crypto.randomUUID(), owner, id, JSON.stringify([IDS.rose, IDS.thumb]), PREVIOUS_CREATED_AT, display);
      }
    }
    return id;
  }

  it.each([
    [IDS.rose, IDS.thumb],
    [null, IDS.rose.toUpperCase(), null, IDS.thumb, null],
  ])("links an existing ordered discovery and all owners' favorites on registration (%j)", async (...normalized) => {
    const id = await seedDiscovery(normalized);
    const reversed = await seedDiscovery([IDS.thumb, IDS.rose], false);
    const response = await post(registration({ user_input_fanmark: "🌹👍", emoji_ids: [IDS.rose, IDS.thumb], normalized_emoji_ids: [IDS.rose, IDS.thumb] }));
    expect(response.status).toBe(201);
    const fanmark = await business!.prepare("SELECT id FROM fanmarks").first<{ id: string }>();
    expect(await business!.prepare(`SELECT fanmark_id, availability_status, first_seen_at, last_seen_at, search_count, favorite_count
      FROM fanmark_discoveries WHERE id = ?`).bind(id).first()).toEqual({
      fanmark_id: fanmark!.id, availability_status: "owned_by_user", first_seen_at: PREVIOUS_CREATED_AT,
      last_seen_at: PREVIOUS_UPDATED_AT, search_count: 9, favorite_count: 2,
    });
    const favorites = await business!.prepare(`SELECT user_id, fanmark_id, created_at, display_fanmark
      FROM fanmark_favorites WHERE discovery_id = ? ORDER BY user_id`).bind(id).all();
    expect(favorites.results).toEqual([
      { user_id: OTHER, fanmark_id: fanmark!.id, created_at: PREVIOUS_CREATED_AT, display_fanmark: "🌹👍" },
      { user_id: OWNER, fanmark_id: fanmark!.id, created_at: PREVIOUS_CREATED_AT, display_fanmark: "🌹👍🏻" },
    ]);
    expect(await business!.prepare("SELECT fanmark_id, availability_status FROM fanmark_discoveries WHERE id = ?")
      .bind(reversed).first()).toEqual({ fanmark_id: null, availability_status: "unclaimed" });
  });

  it.each([
    ["fanmark_favorites", "ABORT, 'synthetic favorite failure'"],
    ["fanmark_favorites", "IGNORE"],
    ["fanmark_discoveries", "IGNORE"],
  ])("rolls back the entire registration when %s linkage is rejected or suppressed (%s)", async (table, failure) => {
    const discoveryId = await seedDiscovery([IDS.rose, IDS.thumb]);
    const beforeDiscovery = await business!.prepare("SELECT * FROM fanmark_discoveries WHERE id = ?").bind(discoveryId).first();
    const beforeFavorites = (await business!.prepare("SELECT * FROM fanmark_favorites WHERE discovery_id = ? ORDER BY id").bind(discoveryId).all()).results;
    await business!.prepare(`CREATE TRIGGER synthetic_discovery_failure BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(${failure}); END`).run();
    const body = registration({ user_input_fanmark: "🌹👍", emoji_ids: [IDS.rose, IDS.thumb], normalized_emoji_ids: [IDS.rose, IDS.thumb], createProfile: true });
    try {
      expect((await post(body)).status).toBe(503);
      for (const affectedTable of ["fanmarks", "fanmark_licenses", "fanmark_basic_configs", "fanmark_profiles", "audit_logs"]) {
        expect(await count(business!, affectedTable)).toBe(0);
      }
      expect(await business!.prepare("SELECT * FROM fanmark_discoveries WHERE id = ?").bind(discoveryId).first()).toEqual(beforeDiscovery);
      expect((await business!.prepare("SELECT * FROM fanmark_favorites WHERE discovery_id = ? ORDER BY id").bind(discoveryId).all()).results).toEqual(beforeFavorites);
    } finally {
      await business!.prepare("DROP TRIGGER synthetic_discovery_failure").run();
    }
    expect((await post(body)).status).toBe(201);
    expect(await count(business!, "fanmarks")).toBe(1);
    expect(await count(business!, "audit_logs")).toBe(1);
  });

  it("rejects ambiguous discoveries with the same typed ordered identity without partial writes", async () => {
    await seedDiscovery([IDS.rose, IDS.thumb]);
    await seedDiscovery([null, IDS.rose.toUpperCase(), IDS.thumb, null], false);
    expect((await post(registration({ user_input_fanmark: "🌹👍", emoji_ids: [IDS.rose, IDS.thumb], normalized_emoji_ids: [IDS.rose, IDS.thumb] }))).status).toBe(503);
    expect(await count(business!, "fanmarks")).toBe(0);
    expect(await count(business!, "fanmark_licenses")).toBe(0);
    expect(await count(business!, "audit_logs")).toBe(0);
    expect((await business!.prepare("SELECT fanmark_id, availability_status FROM fanmark_discoveries").all()).results)
      .toEqual([{ fanmark_id: null, availability_status: "unclaimed" }, { fanmark_id: null, availability_status: "unclaimed" }]);
    expect((await business!.prepare("SELECT fanmark_id FROM fanmark_favorites").all()).results)
      .toEqual([{ fanmark_id: null }, { fanmark_id: null }]);
  });

  it("links favorites for a trusted native INSERT without a registration API callback", async () => {
    const discoveryId = await seedDiscovery([IDS.rose, IDS.thumb]);
    const fanmarkId = crypto.randomUUID();
    await run(business!, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (?, '🌹👍', '🌹👍', 'native01', 'active', ?, ?, ?, ?, 4)`,
    fanmarkId, NOW, NOW, JSON.stringify([IDS.rose, IDS.thumb]), JSON.stringify([IDS.rose, IDS.thumb]));
    expect(await business!.prepare("SELECT fanmark_id, availability_status FROM fanmark_discoveries WHERE id = ?")
      .bind(discoveryId).first()).toEqual({ fanmark_id: fanmarkId, availability_status: "owned_by_user" });
    expect((await business!.prepare("SELECT fanmark_id FROM fanmark_favorites WHERE discovery_id = ?")
      .bind(discoveryId).all()).results).toEqual([{ fanmark_id: fanmarkId }, { fanmark_id: fanmarkId }]);
    expect(await count(business!, "fanmark_licenses")).toBe(0);
  });

  it("creates the fanmark, initial license, configuration, profile, and audit atomically", async () => {
    const response = await post(registration({ createProfile: true }));
    expect(response.status).toBe(201);
    const payload = await response.json() as { success: boolean; fanmark: Record<string, unknown> };
    expect(payload.success).toBe(true);
    expect(payload.fanmark).toMatchObject({
      user_input_fanmark: "🌹", emoji_ids: [IDS.rose], normalized_emoji_ids: [IDS.rose],
      tier_level: 4, tier_display_name: "Tier 4", initial_license_days: 30,
    });
    expect(payload.fanmark.short_id).toMatch(/^[a-z0-9]{8}$/u);
    const fanmarkTimestamps = await business!.prepare(
      "SELECT created_at, updated_at FROM fanmarks",
    ).first();
    expect(fanmarkTimestamps).toEqual({ created_at: NOW, updated_at: NOW });
    const license = await business!.prepare("SELECT user_id, license_start, license_end, display_fanmark, is_initial_license, created_at, updated_at FROM fanmark_licenses").first<Record<string, unknown>>();
    expect(license).toEqual({
      user_id: OWNER, license_start: NOW, license_end: "2026-10-26T00:00:00.000000Z",
      display_fanmark: "🌹", is_initial_license: 1, created_at: NOW, updated_at: NOW,
    });
    expect(await count(business!, "fanmark_basic_configs")).toBe(1);
    expect(await count(business!, "fanmark_profiles")).toBe(1);
    expect(await count(business!, "audit_logs")).toBe(1);
    const profileTimestamps = await business!.prepare(
      "SELECT created_at, updated_at FROM fanmark_profiles",
    ).first();
    expect(profileTimestamps).toEqual({ created_at: NOW, updated_at: NOW });
  });

  it("binds explicit operation timestamps for redirect and messageboard registrations", async () => {
    for (const testCase of [
      { accessType: "redirect", targetUrl: "https://registered.example.test/", table: "fanmark_redirect_configs" },
      { accessType: "text", textContent: "Registered message", table: "fanmark_messageboard_configs" },
    ] as const) {
      await reset();
      const response = await post(registration(testCase));
      expect(response.status).toBe(201);
      const basic = await business!.prepare(
        "SELECT created_at, updated_at FROM fanmark_basic_configs",
      ).first();
      const config = await business!.prepare(
        `SELECT created_at, updated_at FROM ${testCase.table}`,
      ).first();
      expect(basic).toEqual({ created_at: NOW, updated_at: NOW });
      expect(config).toEqual({ created_at: NOW, updated_at: NOW });
    }
  });

  it("maps a tone-qualified emoji to its canonical identity while retaining the original ID", async () => {
    const response = await post(registration({
      user_input_fanmark: "👍🏻", emoji_ids: [IDS.thumbTone], normalized_emoji_ids: [IDS.thumb],
    }));
    expect(response.status).toBe(201);
    const row = await business!.prepare("SELECT user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids FROM fanmarks").first<Record<string, unknown>>();
    expect(row).toEqual({
      user_input_fanmark: "👍🏻", normalized_emoji: "👍", emoji_ids: JSON.stringify([IDS.thumbTone]),
      normalized_emoji_ids: JSON.stringify([IDS.thumb]),
    });
    expect((await post(registration({ user_input_fanmark: "👍", emoji_ids: [IDS.thumb], normalized_emoji_ids: [IDS.thumb] }))).status).toBe(409);
  });

  it("uses the existing unlicensed fanmark and rejects a stale normalized-ID assertion", async () => {
    await run(business!, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (?, '🌹', '🌹', 'rose-old1', 'active', ?, ?, '[]', '[]', 1)`,
    "10000000-0000-4000-8000-000000000001", PREVIOUS_CREATED_AT, PREVIOUS_UPDATED_AT);
    const response = await post(registration({ normalized_emoji_ids: [IDS.thumb] }));
    expect(response.status).toBe(400);
    expect(await count(business!, "fanmarks")).toBe(1);
    const success = await post(registration());
    expect(success.status).toBe(201);
    expect(await count(business!, "fanmarks")).toBe(1);
    expect(await count(business!, "fanmark_licenses")).toBe(1);
    const reusedFanmarkTimestamps = await business!.prepare(
      "SELECT created_at, updated_at FROM fanmarks WHERE id = ?",
    ).bind("10000000-0000-4000-8000-000000000001").first();
    expect(reusedFanmarkTimestamps).toEqual({
      created_at: PREVIOUS_CREATED_AT,
      updated_at: NOW,
    });
  });

  it("preserves the source grace-window and pending-lottery acquisition guards", async () => {
    const fanmarkId = "10000000-0000-4000-8000-000000000002";
    const licenseId = "20000000-0000-4000-8000-000000000002";
    await run(business!, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (?, '🌹', '🌹', 'rose-old2', 'active', ?, ?, ?, ?, 4)`,
    fanmarkId, NOW, NOW, JSON.stringify([IDS.rose]), JSON.stringify([IDS.rose]));
    await run(business!, `INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, status, is_initial_license, created_at, updated_at, grace_expires_at)
      VALUES (?, ?, ?, ?, 'grace', 1, ?, ?, ?)`, licenseId, fanmarkId, OWNER, NOW, NOW, NOW, "2026-09-26T00:00:00.000000Z");
    const grace = await post(registration());
    expect(grace.status).toBe(409);
    expect(await grace.json()).toMatchObject({
      error_code: "grace_period", available_at: "2026-09-26T00:00:00.000000Z", type: "grace_period",
    });
    await run(business!, "UPDATE fanmark_licenses SET grace_expires_at = ? WHERE id = ?", "2026-09-24T00:00:00.000000Z", licenseId);
    await run(business!, "INSERT INTO fanmark_lottery_entries (id, license_id, entry_status) VALUES (?, ?, 'pending')",
      "30000000-0000-4000-8000-000000000002", licenseId);
    const pending = await post(registration());
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ error_code: "lottery_pending", type: "lottery_pending" });
    expect(await count(business!, "fanmark_licenses")).toBe(1);
  });

  it("allows reuse after an expired grace period only when no lottery entry is pending", async () => {
    const fanmarkId = "10000000-0000-4000-8000-000000000003";
    await run(business!, `INSERT INTO fanmarks
      (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (?, '🌹', '🌹', 'rose-old3', 'active', ?, ?, ?, ?, 4)`,
    fanmarkId, NOW, NOW, JSON.stringify([IDS.rose]), JSON.stringify([IDS.rose]));
    await run(business!, `INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, status, is_initial_license, created_at, updated_at, grace_expires_at)
      VALUES (?, ?, ?, ?, 'grace', 1, ?, ?, ?)`,
    "20000000-0000-4000-8000-000000000003", fanmarkId, OTHER, NOW, NOW, NOW, "2026-09-24T00:00:00.000000Z");
    const response = await post(registration());
    expect(response.status).toBe(201);
    expect(await count(business!, "fanmarks")).toBe(1);
    expect(await count(business!, "fanmark_licenses")).toBe(2);
  });

  it("rolls back every row when a dependent write fails", async () => {
    await business!.prepare(`CREATE TRIGGER fail_registration_profile BEFORE INSERT ON fanmark_profiles
      BEGIN SELECT RAISE(ABORT, 'synthetic profile failure'); END`).run();
    try {
      expect((await post(registration({ createProfile: true }))).status).toBe(503);
      for (const table of ["fanmarks", "fanmark_licenses", "fanmark_basic_configs", "fanmark_profiles", "audit_logs"]) {
        expect(await count(business!, table)).toBe(0);
      }
    } finally {
      await business!.prepare("DROP TRIGGER IF EXISTS fail_registration_profile").run();
    }
  });

  it("serializes competing registrations so only one owner can acquire the identity", async () => {
    const [first, second] = await Promise.all([post(registration(), OWNER), post(registration(), OTHER)]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await count(business!, "fanmarks")).toBe(1);
    expect(await count(business!, "fanmark_licenses")).toBe(1);
  });

  it("applies the explicitly public max-emoji setting from business D1", async () => {
    await run(business!, "INSERT INTO system_settings (setting_key, setting_value, is_public) VALUES (?, ?, 1)",
      "max_emoji_characters", "1");
    const response = await post(registration({
      user_input_fanmark: "🌹👍",
      emoji_ids: [IDS.rose, IDS.thumb],
      normalized_emoji_ids: [IDS.rose, IDS.thumb],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Emoji combination must contain 1-1 emojis",
      error_code: "invalid_emoji_count",
    });
    expect(await count(business!, "fanmarks")).toBe(0);
    expect(await count(business!, "system_settings")).toBe(1);
  });

  it("returns a count error for a valid emoji-ID list beyond the product maximum", async () => {
    const ids = Array(6).fill(IDS.rose);
    const response = await post(registration({
      user_input_fanmark: "🌹🌹🌹🌹🌹🌹",
      emoji_ids: ids,
      normalized_emoji_ids: ids,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Emoji combination must contain 1-5 emojis",
      error_code: "invalid_emoji_count",
    });
    expect(await count(business!, "fanmarks")).toBe(0);
  });

  it("requires an authenticated session and an allowed origin", async () => {
    expect((await post(registration(), null)).status).toBe(401);
    const badOrigin = new Request("https://api.example.test/api/fanmarks/register", {
      method: "POST", headers: { "content-type": "application/json", Origin: "https://bad.example.test" },
      body: JSON.stringify(registration()),
    });
    expect((await handleFanmarkRegistrationRequest(badOrigin, requestEnv,
      async () => ({ available: true, userId: OWNER }), CLOCK)).status).toBe(403);
  });
});

import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import businessSchemaSql from "./fixtures/d1-availability-business-contract.sql?raw";
import emojiMasterReleaseStagingSql from "../migrations/0001_emoji_master_release_staging.sql?raw";
import emojiMasterReleaseActivationSql from "../migrations/0002_emoji_master_release_activation.sql?raw";
import referenceMasterSchemaSql from "../migrations/0004_reference_master_releases.sql?raw";
import extensionPriceMasterSchemaSql from "../migrations/0006_reference_master_extension_prices.sql?raw";
// @ts-expect-error Runtime-tested migration helper has no declaration surface.
import { activateReferenceMasterRelease, stageReferenceMasterRelease } from "../../../scripts/migration/reference-master-release.mjs";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const businessDatabase = runtimeEnv.FANMARK_DB;
const masterDatabase = runtimeEnv.MASTER_DB;
const API_URL = "https://api.example.test/api/fanmarks/availability";
const RELEASE_VERSION = "d".repeat(64);
const EMOJI_RELEASE_VERSION = "e".repeat(64);
const NOW = new Date("2026-09-24T12:00:00.000Z");

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const D = "00000000-0000-4000-8000-000000000004";
const E = "00000000-0000-4000-8000-000000000005";
const RETIRED = "00000000-0000-4000-8000-000000000099";

const emojiReleaseRecords = [
  { id: A, emoji: "😀", shortName: "grinning", codepoints: '["1F600"]' },
  { id: B, emoji: "🎵", shortName: "musical note", codepoints: '["1F3B5"]' },
  { id: C, emoji: "🌿", shortName: "herb", codepoints: '["1F33F"]' },
  { id: D, emoji: "🏢", shortName: "office building", codepoints: '["1F3E2"]' },
  { id: E, emoji: "💎", shortName: "gem stone", codepoints: '["1F48E"]' },
];

const referenceSnapshot = [
  {
    table_name: "fanmark_tiers",
    row_count: 4,
    source_sha256: "1".repeat(64),
    records: [
      { id: "10000000-0000-4000-8000-000000000001", created_at: "2026-09-24T00:00:00.000000Z", description: "Tier one", display_name: "One", emoji_count_max: 5, emoji_count_min: 4, initial_license_days: null, is_active: false, monthly_price_usd: "1.25", tier_level: 1, updated_at: "2026-09-24T00:00:00.000000Z" },
      { id: "10000000-0000-4000-8000-000000000002", created_at: "2026-09-24T00:00:00.000000Z", description: "Tier two", display_name: "Two", emoji_count_max: 3, emoji_count_min: 3, initial_license_days: 30, is_active: true, monthly_price_usd: "2.50", tier_level: 2, updated_at: "2026-09-24T00:00:00.000000Z" },
      { id: "10000000-0000-4000-8000-000000000003", created_at: "2026-09-24T00:00:00.000000Z", description: "Tier three", display_name: "Three", emoji_count_max: 5, emoji_count_min: 2, initial_license_days: 14, is_active: true, monthly_price_usd: "3.75", tier_level: 3, updated_at: "2026-09-24T00:00:00.000000Z" },
      { id: "10000000-0000-4000-8000-000000000004", created_at: "2026-09-24T00:00:00.000000Z", description: "Tier four", display_name: "Four", emoji_count_max: 1, emoji_count_min: 1, initial_license_days: 7, is_active: true, monthly_price_usd: "5.00", tier_level: 4, updated_at: "2026-09-24T00:00:00.000000Z" },
    ],
  },
  {
    table_name: "languages",
    row_count: 1,
    source_sha256: "2".repeat(64),
    records: [{ code: "ja", created_at: "2026-09-24T00:00:00.000000Z", id: "20000000-0000-4000-8000-000000000001", is_active: true, label: "Japanese", native_label: "日本語", sort_order: 1, updated_at: "2026-09-24T00:00:00.000000Z" }],
  },
  {
    table_name: "reserved_emoji_patterns",
    row_count: 1,
    source_sha256: "3".repeat(64),
    records: [{ created_at: "2026-09-24T00:00:00.000000Z", description: null, id: "30000000-0000-4000-8000-000000000001", is_active: true, pattern: "🧪", price_yen: 1200, updated_at: "2026-09-24T00:00:00.000000Z" }],
  },
  {
    table_name: "fanmark_tier_extension_prices",
    row_count: 1,
    source_sha256: "4".repeat(64),
    records: [{ created_at: "2026-09-24T00:00:00.000000Z", id: "40000000-0000-4000-8000-000000000001", is_active: true, months: 1, price_yen: 500, stripe_price_id: "price_syntheticAvailability", stripe_price_id_live: null, tier_level: 2, updated_at: "2026-09-24T00:00:00.000000Z" }],
  },
];

function splitSqlStatements(sql: string): string[] {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gm, "");
  const statements: string[] = [];
  let current = "";
  let parentheses = 0;
  let trigger = false;
  for (const line of source.split(/\r?\n/u)) {
    current += `${line}\n`;
    if (!trigger && /^\s*CREATE\s+TRIGGER\b/iu.test(current)) trigger = true;
    if (!trigger) {
      for (const character of line) {
        if (character === "(") parentheses += 1;
        if (character === ")") parentheses -= 1;
      }
      if (line.trimEnd().endsWith(";") && parentheses === 0) {
        statements.push(current.trim());
        current = "";
      }
    } else if (/^\s*END;\s*$/u.test(line)) {
      statements.push(current.trim());
      current = "";
      trigger = false;
      parentheses = 0;
    }
  }
  if (current.trim()) throw new Error("incomplete_sql_migration_statement");
  return statements;
}

async function applyStatements(database: D1Database, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    const result = await database.prepare(statement).run();
    if (result.success !== true) throw new Error("fixture_schema_apply_failed");
  }
}

async function request(emojiIds: string[]): Promise<Response> {
  return handleRequest(
    new Request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds }),
    }),
    {
      ...runtimeEnv,
      D1_TOPOLOGY: "split",
      FANMARK_DB: businessDatabase,
      MASTER_DB: masterDatabase,
      AVAILABILITY_BACKEND: "d1",
    },
    fetch,
    () => NOW,
  );
}

async function resultOf(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as { result: Record<string, unknown> };
  return body.result;
}

beforeAll(async () => {
  if (!businessDatabase || !masterDatabase) throw new Error("split D1 bindings are unavailable");
  await applyStatements(businessDatabase, businessSchemaSql);
  await masterDatabase.prepare(`
    CREATE TABLE emoji_master (
      id TEXT PRIMARY KEY NOT NULL,
      emoji TEXT NOT NULL UNIQUE,
      short_name TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      codepoints TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await applyStatements(masterDatabase, emojiMasterReleaseStagingSql);
  await applyStatements(masterDatabase, emojiMasterReleaseActivationSql);
  await applyStatements(masterDatabase, referenceMasterSchemaSql);
  await applyStatements(masterDatabase, extensionPriceMasterSchemaSql);
  const emojiReleaseWrites = [
    masterDatabase.prepare(`
      INSERT INTO fanmark_emoji_master_release_imports
        (release_version, manifest_json, row_count, status)
      VALUES (?, '{}', ?, 'loading')
    `).bind(EMOJI_RELEASE_VERSION, emojiReleaseRecords.length),
    ...emojiReleaseRecords.map((record, index) => masterDatabase.prepare(`
      INSERT INTO fanmark_emoji_master_release_staging
        (release_version, ordinal, id, emoji, short_name, keywords_json,
         category, subcategory, codepoints_json, sort_order)
      VALUES (?, ?, ?, ?, ?, '[]', NULL, NULL, ?, ?)
    `).bind(EMOJI_RELEASE_VERSION, index + 1, record.id, record.emoji,
      record.shortName, record.codepoints, index + 1)),
    masterDatabase.prepare(`
      UPDATE fanmark_emoji_master_release_imports
      SET status = 'ready', verified_at = ?
      WHERE release_version = ?
    `).bind(NOW.toISOString(), EMOJI_RELEASE_VERSION),
    masterDatabase.prepare(`
      INSERT INTO fanmark_emoji_master_active_release
        (singleton_id, release_version, previous_release_version,
         activation_id, action, generation)
      VALUES (1, ?, NULL, ?, 'promotion', 1)
    `).bind(EMOJI_RELEASE_VERSION, "50000000-0000-4000-8000-000000000001"),
  ];
  const emojiReleaseResult = await masterDatabase.batch(emojiReleaseWrites);
  if (emojiReleaseResult.some((result) => result.success !== true)) {
    throw new Error("emoji_release_fixture_apply_failed");
  }
  await stageReferenceMasterRelease({
    database: masterDatabase,
    snapshot: referenceSnapshot,
    snapshotSha256: RELEASE_VERSION,
  });
  await activateReferenceMasterRelease({
    database: masterDatabase,
    releaseVersion: RELEASE_VERSION,
    expectedActiveVersion: null,
  });
});

beforeEach(async () => {
  if (!businessDatabase || !masterDatabase) throw new Error("split D1 bindings are unavailable");
  await businessDatabase.batch([
    businessDatabase.prepare("DELETE FROM fanmark_licenses"),
    businessDatabase.prepare("DELETE FROM fanmarks"),
  ]);
  await masterDatabase.prepare("DELETE FROM emoji_master").run();
  await masterDatabase.batch([
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(A, "😎", "smiling face with sunglasses", '["1F60E"]'),
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(B, "🎵", "music", '["1F3B5"]'),
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(C, "🌿", "herb", '["1F33F"]'),
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(D, "🏢", "office", '["1F3E2"]'),
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(E, "💎", "gem", '["1F48E"]'),
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, short_name, codepoints) VALUES (?, ?, ?, ?)").bind(RETIRED, "🧪", "test tube", '["1F9EA"]'),
  ]);
});

describe("D1 availability against the versioned reference-master schema", () => {
  it("resolves tier metadata through the active immutable release view", async () => {
    const view = await masterDatabase!.prepare("SELECT type FROM sqlite_master WHERE name = 'fanmark_tiers'").first<{ type: string }>();
    expect(view?.type).toBe("view");
    const tier = await masterDatabase!.prepare("SELECT monthly_price_usd, typeof(monthly_price_usd) AS storage_type FROM fanmark_tiers WHERE tier_level = 4").first<{ monthly_price_usd: number; storage_type: string }>();
    expect(tier).toEqual({ monthly_price_usd: 500, storage_type: "integer" });

    const response = await request([A]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await resultOf(response)).toEqual({
      available: true,
      tier_level: 4,
      tier_display_name: "Four",
      price: 5,
      license_days: 7,
    });
  });

  it("uses the active emoji release rather than stale canonical rows", async () => {
    await businessDatabase!.prepare(
      "INSERT INTO fanmarks (id, normalized_emoji) VALUES (?, ?)",
    ).bind("60000000-0000-4000-8000-000000000001", "😎").run();

    const current = await request([A]);
    expect(current.status).toBe(200);
    expect(await resultOf(current)).toEqual({
      available: true,
      tier_level: 4,
      tier_display_name: "Four",
      price: 5,
      license_days: 7,
    });

    const retired = await request([RETIRED]);
    expect(retired.status).toBe(200);
    expect(await resultOf(retired)).toEqual({ available: false, reason: "invalid_emoji_ids" });
  });

  it("uses a different tier row from the same activated release", async () => {
    const response = await request([A, B, C]);
    expect(response.status).toBe(200);
    expect(await resultOf(response)).toEqual({
      available: true,
      tier_level: 2,
      tier_display_name: "Two",
      price: 2.5,
      license_days: 30,
    });
  });

  it("keeps inactive-tier behavior when the active release marks that tier inactive", async () => {
    const response = await request([A, B, C, D]);
    expect(response.status).toBe(200);
    expect(await resultOf(response)).toEqual({ available: false, reason: "invalid_length" });
  });
});

import { env, exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-availability-contract.sql?raw";
import worker, { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const API_URL = "https://api.example.test/api/fanmarks/availability";
const FIXED_NOW = new Date("2026-09-21T12:00:00.500Z");

const A = "abcdef01-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const TONE = "00000000-0000-4000-8000-000000000004";
const ZWJ = "00000000-0000-4000-8000-000000000005";
const VS = "00000000-0000-4000-8000-000000000006";
const MISSING = "00000000-0000-4000-8000-000000000099";

const FANMARK_A = "10000000-0000-4000-8000-000000000001";
const FANMARK_TONE = "10000000-0000-4000-8000-000000000002";
const FANMARK_ZWJ = "10000000-0000-4000-8000-000000000003";
const FANMARK_VS = "10000000-0000-4000-8000-000000000004";

const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};

function statementsFrom(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function d1Environment(overrides: Partial<Env> = {}): Env {
  return {
    ...runtimeEnv,
    FANMARK_DB: database,
    AVAILABILITY_BACKEND: "d1",
    ...overrides,
  };
}

function request(
  emojiIds: string[],
  requestEnv = d1Environment(),
  clock = FIXED_NOW,
): Promise<Response> {
  return handleRequest(
    new Request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds }),
    }),
    requestEnv,
    fetch,
    () => clock,
  );
}

async function bodyOf(response: Response): Promise<{ schemaVersion: number; result: Record<string, unknown> }> {
  return (await response.json()) as {
    schemaVersion: number;
    result: Record<string, unknown>;
  };
}

async function executeFixtureSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(statementsFrom(schemaSql).map((statement) => database.prepare(statement)));
}

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM fanmark_licenses"),
    database.prepare("DELETE FROM fanmarks"),
    database.prepare("DELETE FROM fanmark_tiers"),
    database.prepare("DELETE FROM emoji_master"),
  ]);
  await database.batch([
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(A, "😀"),
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(B, "🎵"),
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(C, "🌿"),
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(TONE, "👍🏽"),
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(ZWJ, "👩‍💻"),
    database.prepare("INSERT INTO emoji_master (id, emoji) VALUES (?, ?)").bind(VS, "✈️"),
    database
      .prepare(
        "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, monthly_price_usd, is_active) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(1, "Five", null, 125, 1),
    database
      .prepare(
        "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, monthly_price_usd, is_active) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(2, "Three", 30, 250, 1),
    database
      .prepare(
        "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, monthly_price_usd, is_active) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(3, "Repeated or two", 14, 375, 1),
    database
      .prepare(
        "INSERT INTO fanmark_tiers (tier_level, display_name, initial_license_days, monthly_price_usd, is_active) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(4, "One", 7, 500, 1),
  ]);
}

async function insertFanmark(id: string, normalizedEmoji: string): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database
    .prepare("INSERT INTO fanmarks (id, normalized_emoji) VALUES (?, ?)")
    .bind(id, normalizedEmoji)
    .run();
}

async function insertLicense(
  id: string,
  fanmarkId: string,
  status: string,
  licenseEnd: string | null,
  graceExpiresAt: string | null,
): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database
    .prepare(
      "INSERT INTO fanmark_licenses (id, fanmark_id, status, license_end, grace_expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, fanmarkId, status, licenseEnd, graceExpiresAt)
    .run();
}

beforeAll(async () => {
  await executeFixtureSchema();
});

beforeEach(async () => {
  await resetFixture();
});

describe("D1 availability repository", () => {
  it("serves a real local D1 no-fanmark result through the configured Worker entrypoint", async () => {
    const response = await configuredWorker.default.fetch(
      new Request(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: [A] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      schemaVersion: 1,
      result: {
        available: true,
        tier_level: 4,
        tier_display_name: "One",
        price: 5,
        license_days: 7,
      },
    });
  });

  it("classifies one through five IDs, preserving repetition and UUID case semantics", async () => {
    const cases: Array<[string[], number]> = [
      [[A.toUpperCase()], 4],
      [[A, A], 3],
      [[A, B], 3],
      [[A, B, C], 2],
      [[A, B, C, TONE], 1],
      [[A, B, C, TONE, ZWJ], 1],
    ];
    for (const [ids, tierLevel] of cases) {
      const response = await request(ids);
      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.result).toMatchObject({ available: true, tier_level: tierLevel });
    }
  });

  it("returns the documented invalid ID result for a missing master row", async () => {
    const response = await request([MISSING]);
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      schemaVersion: 1,
      result: { available: false, reason: "invalid_emoji_ids" },
    });
  });

  it("removes only skin tones and preserves ZWJ and variation-selector identity", async () => {
    await insertFanmark(FANMARK_TONE, "👍");
    await insertFanmark(FANMARK_ZWJ, "👩‍💻");
    await insertFanmark(FANMARK_VS, "✈️");

    const tone = await bodyOf(await request([TONE]));
    expect(tone.result).toMatchObject({ available: true, fanmark_id: FANMARK_TONE });

    const zwj = await bodyOf(await request([ZWJ]));
    expect(zwj.result).toMatchObject({ available: true, fanmark_id: FANMARK_ZWJ });

    const variation = await bodyOf(await request([VS]));
    expect(variation.result).toMatchObject({ available: true, fanmark_id: FANMARK_VS });
  });

  it("returns invalid_length when the selected tier is inactive", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare("UPDATE fanmark_tiers SET is_active = 0 WHERE tier_level = 4").run();

    const response = await request([A]);
    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      schemaVersion: 1,
      result: { available: false, reason: "invalid_length" },
    });
  });

  it("applies strict time boundaries, grace fallback, earliest blocking, and exact timestamp text", async () => {
    await insertFanmark(FANMARK_A, "😀");
    await insertLicense(
      "20000000-0000-4000-8000-000000000001",
      FANMARK_A,
      "grace",
      "2026-09-21T13:00:00.123456Z",
      null,
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000002",
      FANMARK_A,
      "grace",
      "2026-09-21T15:00:00.000000Z",
      "2026-09-21T14:00:00.000000Z",
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000003",
      FANMARK_A,
      "expired",
      "2026-09-21T16:00:00.000000Z",
      null,
    );

    const grace = await bodyOf(await request([A]));
    expect(grace.result).toEqual({
      available: false,
      fanmark_id: FANMARK_A,
      reason: "grace_period",
      available_at: "2026-09-21T13:00:00.123456Z",
      blocking_status: "grace",
    });

    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare("DELETE FROM fanmark_licenses").run();
    await insertLicense(
      "20000000-0000-4000-8000-000000000008",
      FANMARK_A,
      "active",
      null,
      null,
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000009",
      FANMARK_A,
      "grace",
      "2026-09-21T16:00:00.000000Z",
      "2026-09-21T14:00:00.000000Z",
    );
    const finiteBeforeNull = await bodyOf(await request([A]));
    expect(finiteBeforeNull.result).toEqual({
      available: false,
      fanmark_id: FANMARK_A,
      reason: "grace_period",
      available_at: "2026-09-21T14:00:00.000000Z",
      blocking_status: "grace",
    });

    await database.prepare("DELETE FROM fanmark_licenses").run();
    await insertLicense(
      "20000000-0000-4000-8000-000000000004",
      FANMARK_A,
      "active",
      "2026-09-21T13:00:00.123457Z",
      null,
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000005",
      FANMARK_A,
      "grace",
      "2026-09-21T15:00:00.000000Z",
      "2026-09-21T14:00:00.000000Z",
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000010",
      FANMARK_A,
      "active",
      null,
      null,
    );
    const active = await bodyOf(await request([A]));
    expect(active.result).toEqual({
      available: false,
      fanmark_id: FANMARK_A,
      reason: "taken",
      available_at: null,
      blocking_status: "active",
    });

    await database.prepare("DELETE FROM fanmark_licenses").run();
    await insertLicense(
      "20000000-0000-4000-8000-000000000006",
      FANMARK_A,
      "active",
      "2026-09-21T12:00:00.500000Z",
      null,
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000007",
      FANMARK_A,
      "grace",
      "2026-09-21T11:00:00.000000Z",
      null,
    );
    await insertLicense(
      "20000000-0000-4000-8000-000000000011",
      FANMARK_A,
      "grace",
      "2026-09-21T13:00:00.000000Z",
      "2026-09-21T12:00:00.500000Z",
    );
    const exactBoundary = await bodyOf(await request([A]));
    expect(exactBoundary.result).toEqual({
      available: true,
      fanmark_id: FANMARK_A,
      reason: null,
      available_at: null,
      blocking_status: null,
    });
  });

  it("sanitizes a local D1 SQL failure", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await insertFanmark(FANMARK_A, "😀");
    await database.prepare("DROP TABLE fanmark_licenses").run();

    const response = await request([A]);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });

    await executeFixtureSchema();
    await resetFixture();
  });
});

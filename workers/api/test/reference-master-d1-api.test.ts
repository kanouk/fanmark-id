import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import migrationSql from "../migrations/0004_reference_master_releases.sql?raw";
import extensionPriceMigrationSql from "../migrations/0006_reference_master_extension_prices.sql?raw";
// @ts-expect-error migration tooling is runtime-tested JavaScript without a declaration surface.
import { activateReferenceMasterRelease, stageReferenceMasterRelease } from "../../../scripts/migration/reference-master-release.mjs";
import { handleRequest } from "../src";
import { createReferenceMasterAdminD1Repository, ReferenceMasterAdminError } from "../src/reference-master-admin-d1-repository";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.MASTER_DB;
const API_BASE = "https://api.example.test";
const ALLOWED_ORIGIN = "https://app.example.test";
const releaseVersion = "a".repeat(64);

const sourceSnapshot = [
  {
    table_name: "fanmark_tiers",
    row_count: 1,
    source_sha256: "1".repeat(64),
    records: [{
      id: "00000000-0000-4000-8000-000000000001",
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: "Synthetic public tier",
      display_name: "Synthetic",
      emoji_count_max: 5,
      emoji_count_min: 1,
      initial_license_days: 30,
      is_active: true,
      monthly_price_usd: "300.00",
      tier_level: 4,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "languages",
    row_count: 2,
    source_sha256: "2".repeat(64),
    records: [
      {
        code: "ja",
        created_at: "2026-09-23T01:02:03.123456+00:00",
        id: "00000000-0000-4000-8000-000000000002",
        is_active: true,
        label: "Japanese",
        native_label: "日本語",
        sort_order: 1,
        updated_at: "2026-09-23T01:02:03.123456+00:00",
      },
      {
        code: "en",
        created_at: "2026-09-23T01:02:03.123456+00:00",
        id: "00000000-0000-4000-8000-000000000003",
        is_active: true,
        label: "English",
        native_label: "English",
        sort_order: 2,
        updated_at: "2026-09-23T01:02:03.123456+00:00",
      },
    ],
  },
  {
    table_name: "reserved_emoji_patterns",
    row_count: 1,
    source_sha256: "3".repeat(64),
    records: [{
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: null,
      id: "00000000-0000-4000-8000-000000000004",
      is_active: false,
      pattern: "🧪",
      price_yen: 1200,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "fanmark_tier_extension_prices",
    row_count: 2,
    source_sha256: "4".repeat(64),
    records: [
      {
        created_at: "2026-09-23T01:02:03.123456+00:00",
        id: "00000000-0000-4000-8000-000000000004",
        is_active: true,
        months: 1,
        price_yen: 500,
        stripe_price_id: "price_syntheticTest1",
        stripe_price_id_live: "price_syntheticLive1",
        tier_level: 2,
        updated_at: "2026-09-23T01:02:03.123456+00:00",
      },
      {
        created_at: "2026-09-23T01:02:03.123456+00:00",
        id: "00000000-0000-4000-8000-000000000005",
        is_active: false,
        months: 3,
        price_yen: 1200,
        stripe_price_id: null,
        stripe_price_id_live: null,
        tier_level: 2,
        updated_at: "2026-09-23T01:02:03.123456+00:00",
      },
    ],
  },
];

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
  if (!headers.has("Origin")) headers.set("Origin", ALLOWED_ORIGIN);
  return handleRequest(
    new Request(`${API_BASE}${path}`, { ...init, headers }),
    { ...runtimeEnv, D1_TOPOLOGY: "split", REFERENCE_MASTER_BACKEND: "d1", ...overrides },
  );
}

async function signedPrivatePriceRequest(mode: "test" | "live" | "none"): Promise<Request> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const query = `mode=${mode}&months=1&tier_level=2`;
  const message = `GET\n/api/internal/reference-masters/extension-price?${query}\n${timestamp}`;
  const secret = "synthetic-reference-master-service-secret-0001";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`${API_BASE}/api/internal/reference-masters/extension-price?${query}`, {
    method: "GET",
    headers: {
      "x-fanmark-service-timestamp": timestamp,
      "x-fanmark-service-signature": `v1=${hex}`,
    },
  });
}

beforeAll(async () => {
  if (!database) throw new Error("MASTER_DB binding is unavailable");
  await database.batch(splitMigrationStatements(migrationSql).map((statement) => database.prepare(statement)));
  await database.batch(splitMigrationStatements(extensionPriceMigrationSql).map((statement) => database.prepare(statement)));
  await stageReferenceMasterRelease({ database, snapshot: sourceSnapshot, snapshotSha256: releaseVersion });
  await activateReferenceMasterRelease({ database, releaseVersion, expectedActiveVersion: null });
});

describe("versioned reference-master Worker API", () => {
  it("returns only the active language projection with stable order and release identity", async () => {
    const response = await request("/api/reference-masters/languages");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    const body = await response.json() as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
    expect(body.releaseVersion).toBe(releaseVersion);
    expect(body.master).toBe("languages");
    expect(body.items).toEqual([
      { code: "ja", label: "Japanese", nativeLabel: "日本語", isActive: true, sortOrder: 1 },
      { code: "en", label: "English", nativeLabel: "English", isActive: true, sortOrder: 2 },
    ]);
  });

  it("serves exact tier cents and reserved-pattern projections without source metadata", async () => {
    const tiers = await request("/api/reference-masters/fanmark_tiers");
    expect(tiers.status).toBe(200);
    expect((await tiers.json() as Record<string, unknown>).items).toEqual([{
      id: "00000000-0000-4000-8000-000000000001",
      description: "Synthetic public tier",
      displayName: "Synthetic",
      emojiCountMax: 5,
      emojiCountMin: 1,
      initialLicenseDays: 30,
      isActive: true,
      monthlyPriceCents: 30000,
      tierLevel: 4,
    }]);

    const patterns = await request("/api/reference-masters/reserved_emoji_patterns");
    expect(patterns.status).toBe(200);
    expect((await patterns.json() as Record<string, unknown>).items).toEqual([{
      description: null,
      id: "00000000-0000-4000-8000-000000000004",
      isActive: false,
      pattern: "🧪",
      priceYen: 1200,
    }]);

    const extensionPrices = await request("/api/reference-masters/fanmark_tier_extension_prices");
    expect(extensionPrices.status).toBe(200);
    const extensionBody = await extensionPrices.json() as Record<string, unknown>;
    expect(extensionBody.items).toEqual([
      { tierLevel: 2, months: 1, priceYen: 500, isActive: true },
      { tierLevel: 2, months: 3, priceYen: 1200, isActive: false },
    ]);
    expect(JSON.stringify(extensionBody)).not.toContain("stripe_");
  });

  it("enforces public read method, exact CORS origin, and explicit backend configuration", async () => {
    expect((await request("/api/reference-masters/languages", { method: "POST" })).status).toBe(405);
    expect((await request("/api/reference-masters/unknown")).status).toBe(404);
    expect((await request("/api/reference-masters/languages?unexpected=1")).status).toBe(404);
    expect((await request("/api/reference-masters/languages", { method: "OPTIONS" })).status).toBe(204);
    expect((await request("/api/reference-masters/languages", {}, {
      CORS_ALLOWED_ORIGINS: "https://other.example.test",
    })).status).toBe(403);
    expect((await request("/api/reference-masters/languages", {}, {
      REFERENCE_MASTER_BACKEND: undefined,
    })).status).toBe(503);
    expect((await request("/api/reference-masters/languages", {}, {
      REFERENCE_MASTER_BACKEND: "supabase",
    })).status).toBe(500);
  });

  it("serves signed private Stripe pricing from the same active D1 release", async () => {
    const serviceEnv = {
      ...runtimeEnv,
      D1_TOPOLOGY: "split",
      REFERENCE_MASTER_BACKEND: "d1",
      REFERENCE_MASTER_SERVICE_SECRET: "synthetic-reference-master-service-secret-0001",
    } as Env;
    const testPrice = await handleRequest(await signedPrivatePriceRequest("test"), serviceEnv);
    expect(testPrice.status).toBe(200);
    expect(testPrice.headers.get("access-control-allow-origin")).toBeNull();
    const testBody = await testPrice.json() as Record<string, unknown>;
    expect(testBody).toMatchObject({
      schemaVersion: 1,
      releaseVersion,
      tierLevel: 2,
      months: 1,
      priceYen: 500,
      isActive: true,
      stripePriceId: "price_syntheticTest1",
    });

    const livePrice = await handleRequest(await signedPrivatePriceRequest("live"), serviceEnv);
    expect((await livePrice.json() as Record<string, unknown>).stripePriceId).toBe("price_syntheticLive1");

    const priceOnly = await handleRequest(await signedPrivatePriceRequest("none"), serviceEnv);
    expect((await priceOnly.json() as Record<string, unknown>).stripePriceId).toBeNull();
  });

  it("updates private pricing through immutable releases and rejects stale or invalid edits", async () => {
    const repository = createReferenceMasterAdminD1Repository({
      ...runtimeEnv,
      D1_TOPOLOGY: "split",
      REFERENCE_MASTER_ADMIN_BACKEND: "d1",
    });
    const initial = await repository.getPricing();
    expect(initial.releaseVersion).toBe(releaseVersion);
    expect(initial.tiers[0]).toMatchObject({ initial_license_days: 30, tier_level: 4 });
    expect(initial.extensionPrices[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000004",
      stripe_price_id: "price_syntheticTest1",
      stripe_price_id_live: "price_syntheticLive1",
    });

    const afterTierEdit = await repository.updatePricing(initial.releaseVersion, {
      type: "tier",
      id: "00000000-0000-4000-8000-000000000001",
      changes: { initialLicenseDays: 45 },
    });
    expect(afterTierEdit.releaseVersion).not.toBe(initial.releaseVersion);
    expect(afterTierEdit.generation).toBe(initial.generation + 1);
    expect(afterTierEdit.tiers[0].initial_license_days).toBe(45);
    expect((await request("/api/reference-masters/fanmark_tiers").then((response) => response.json()) as { items: Array<Record<string, unknown>> }).items[0])
      .toMatchObject({ initialLicenseDays: 45 });

    await expect(repository.updatePricing(initial.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { priceYen: 700 },
    })).rejects.toMatchObject({ status: 409, message: "reference_master_edit_conflict" });

    await expect(repository.updatePricing(afterTierEdit.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { stripePriceId: "sk_live_not_a_price_id" },
    })).rejects.toMatchObject({ status: 400, message: "invalid_stripe_price_id" });

    const afterStripeEdit = await repository.updatePricing(afterTierEdit.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { stripePriceId: "price_syntheticUpdated1" },
    });
    expect(afterStripeEdit.generation).toBe(afterTierEdit.generation + 1);
    expect(afterStripeEdit.tiers[0].initial_license_days).toBe(45);
    expect(afterStripeEdit.extensionPrices[0].stripe_price_id).toBe("price_syntheticUpdated1");

    const afterPriceEdit = await repository.updatePricing(afterStripeEdit.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { priceYen: 777 },
    });
    const afterActiveEdit = await repository.updatePricing(afterPriceEdit.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { isActive: false },
    });
    const afterLiveIdEdit = await repository.updatePricing(afterActiveEdit.releaseVersion, {
      type: "extension_price",
      id: "00000000-0000-4000-8000-000000000004",
      changes: { stripePriceIdLive: null },
    });
    expect(afterLiveIdEdit.generation).toBe(afterActiveEdit.generation + 1);
    expect(afterLiveIdEdit.extensionPrices[0]).toMatchObject({
      price_yen: 777,
      is_active: false,
      stripe_price_id: "price_syntheticUpdated1",
      stripe_price_id_live: null,
    });
    const publicPrices = await request("/api/reference-masters/fanmark_tier_extension_prices");
    const publicPayload = await publicPrices.text();
    expect(publicPrices.status).toBe(200);
    expect(publicPayload).not.toContain("stripe_");
    expect(publicPayload).not.toContain("price_syntheticUpdated1");

    const audit = await database?.prepare(
      "SELECT generation, from_version, to_version FROM fanmark_reference_master_release_activations ORDER BY generation",
    ).all();
    expect(audit?.results).toHaveLength(afterLiveIdEdit.generation);
    await expect(database?.prepare(
      "UPDATE fanmark_extension_price_release_rows SET price_yen = 1 WHERE release_version = ?",
    ).bind(afterLiveIdEdit.releaseVersion).run()).rejects.toThrow(/reference_release_rows_immutable/u);
  });

  it("does not let the reference pricing admin repository choose a backend implicitly", async () => {
    expect(() => createReferenceMasterAdminD1Repository({ ...runtimeEnv, REFERENCE_MASTER_ADMIN_BACKEND: undefined }))
      .toThrow(ReferenceMasterAdminError);
  });
});

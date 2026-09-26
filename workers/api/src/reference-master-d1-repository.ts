import { selectD1Database, type Env } from "./repository";

const RELEASE_VERSION_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const MAX_REFERENCE_MASTER_ROWS = 64;

export type ReferenceMasterName = "fanmark_tiers" | "languages" | "reserved_emoji_patterns" | "fanmark_tier_extension_prices";

export interface ReferenceMasterResponse {
  schemaVersion: 1;
  releaseVersion: string;
  master: ReferenceMasterName;
  items: Array<Record<string, string | number | boolean | null>>;
}

export class ReferenceMasterConfigurationError extends Error {
  constructor() {
    super("reference master API is not configured");
    this.name = "ReferenceMasterConfigurationError";
  }
}

export class ReferenceMasterUnavailableError extends Error {
  constructor() {
    super("reference master release is unavailable");
    this.name = "ReferenceMasterUnavailableError";
  }
}

export class ReferenceMasterUpstreamError extends Error {
  constructor() {
    super("reference master read failed");
    this.name = "ReferenceMasterUpstreamError";
  }
}

const MASTER_QUERIES: Record<ReferenceMasterName, string> = {
  fanmark_tiers: `
    SELECT a.release_version, t.row_count AS expected_count,
           r.id, r.description, r.display_name, r.emoji_count_max,
           r.emoji_count_min, r.initial_license_days, r.is_active,
           r.monthly_price_cents, r.tier_level
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS release
      ON release.release_version = a.release_version AND release.status = 'ready'
    JOIN fanmark_reference_master_release_tables AS t
      ON t.release_version = a.release_version AND t.table_name = 'fanmark_tiers'
    JOIN fanmark_tier_release_rows AS r
      ON r.release_version = a.release_version
    WHERE a.singleton_id = 1
    ORDER BY r.tier_level, r.id
    LIMIT ${MAX_REFERENCE_MASTER_ROWS + 1}`,
  languages: `
    SELECT a.release_version, t.row_count AS expected_count,
           r.code, r.label, r.native_label, r.is_active, r.sort_order
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS release
      ON release.release_version = a.release_version AND release.status = 'ready'
    JOIN fanmark_reference_master_release_tables AS t
      ON t.release_version = a.release_version AND t.table_name = 'languages'
    JOIN fanmark_language_release_rows AS r
      ON r.release_version = a.release_version
    WHERE a.singleton_id = 1
    ORDER BY r.sort_order, r.code COLLATE BINARY
    LIMIT ${MAX_REFERENCE_MASTER_ROWS + 1}`,
  reserved_emoji_patterns: `
    SELECT a.release_version, t.row_count AS expected_count,
           r.description, r.id, r.is_active, r.pattern, r.price_yen
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS release
      ON release.release_version = a.release_version AND release.status = 'ready'
    JOIN fanmark_reference_master_release_tables AS t
      ON t.release_version = a.release_version AND t.table_name = 'reserved_emoji_patterns'
    JOIN fanmark_reserved_emoji_pattern_release_rows AS r
      ON r.release_version = a.release_version
    WHERE a.singleton_id = 1
    ORDER BY r.pattern COLLATE BINARY, r.id
    LIMIT ${MAX_REFERENCE_MASTER_ROWS + 1}`,
  fanmark_tier_extension_prices: `
    SELECT a.release_version, manifest.row_count AS expected_count,
           r.is_active, r.months, r.price_yen, r.tier_level
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS release
      ON release.release_version = a.release_version AND release.status = 'ready'
    JOIN fanmark_reference_master_extension_price_manifests AS manifest
      ON manifest.release_version = a.release_version
    JOIN fanmark_extension_price_release_rows AS r
      ON r.release_version = a.release_version
    WHERE a.singleton_id = 1
      AND manifest.row_count = (
        SELECT count(*) FROM fanmark_extension_price_release_rows
        WHERE release_version = a.release_version
      )
    ORDER BY r.tier_level, r.months
    LIMIT ${MAX_REFERENCE_MASTER_ROWS + 1}`,
};

export function isReferenceMasterPath(url: URL): boolean {
  return url.pathname === "/api/reference-masters" || url.pathname.startsWith("/api/reference-masters/");
}

export function parseReferenceMasterRoute(url: URL): ReferenceMasterName | null {
  if (url.search || url.hash) return null;
  const match = /^\/api\/reference-masters\/([^/]+)$/u.exec(url.pathname);
  if (!match) return null;
  const name = match[1];
  return name === "fanmark_tiers" || name === "languages" || name === "reserved_emoji_patterns" ||
    name === "fanmark_tier_extension_prices"
    ? name
    : null;
}

function getDatabase(env: Env): D1Database {
  const backend = env.REFERENCE_MASTER_BACKEND?.trim();
  if (backend !== "d1") {
    if (!backend) throw new ReferenceMasterUnavailableError();
    throw new ReferenceMasterConfigurationError();
  }
  const database = selectD1Database(env, "master");
  if (!database) throw new ReferenceMasterConfigurationError();
  return database;
}

function assertRows(result: D1Result<Record<string, unknown>>): Record<string, unknown>[] {
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw new ReferenceMasterUpstreamError();
  }
  return result.results;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ReferenceMasterUpstreamError();
  }
  return value;
}

function text(value: unknown, maxLength: number): string;
function text(value: unknown, maxLength: number, nullable: true): string | null;
function text(value: unknown, maxLength: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new ReferenceMasterUpstreamError();
  }
  return value;
}

function active(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new ReferenceMasterUpstreamError();
  return value === 1;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new ReferenceMasterUpstreamError();
  return value.toLowerCase();
}

function mapTier(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const days = row.initial_license_days;
  return {
    id: uuid(row.id),
    description: text(row.description, 1024, true),
    displayName: text(row.display_name, 128),
    emojiCountMax: integer(row.emoji_count_max, 1, 5),
    emojiCountMin: integer(row.emoji_count_min, 1, 5),
    initialLicenseDays: days === null ? null : integer(days, 0, 36500),
    isActive: active(row.is_active),
    monthlyPriceCents: integer(row.monthly_price_cents, -9_999_999_999, 9_999_999_999),
    tierLevel: integer(row.tier_level, 1, 4),
  };
}

function mapLanguage(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const code = text(row.code, 16);
  if (!/^[A-Za-z0-9-]{2,16}$/u.test(code)) throw new ReferenceMasterUpstreamError();
  return {
    code,
    label: text(row.label, 128),
    nativeLabel: text(row.native_label, 128),
    isActive: active(row.is_active),
    sortOrder: integer(row.sort_order),
  };
}

function mapReservedPattern(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return {
    description: text(row.description, 1024, true),
    id: uuid(row.id),
    isActive: active(row.is_active),
    pattern: text(row.pattern, 256),
    priceYen: integer(row.price_yen, 0, 2_147_483_647),
  };
}

function mapExtensionPrice(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return {
    tierLevel: integer(row.tier_level, 1, 4),
    months: integer(row.months, 1, 120),
    priceYen: integer(row.price_yen, 0, 2_147_483_647),
    isActive: active(row.is_active),
  };
}

const MAP_ROWS: Record<ReferenceMasterName, (row: Record<string, unknown>) => Record<string, string | number | boolean | null>> = {
  fanmark_tiers: mapTier,
  languages: mapLanguage,
  reserved_emoji_patterns: mapReservedPattern,
  fanmark_tier_extension_prices: mapExtensionPrice,
};

export function createReferenceMasterD1Repository(env: Env) {
  const database = getDatabase(env);
  return {
    async readMaster(master: ReferenceMasterName): Promise<ReferenceMasterResponse> {
      const sql = MASTER_QUERIES[master];
      if (!sql) throw new ReferenceMasterConfigurationError();
      let rows: Record<string, unknown>[];
      try {
        const result = await database.prepare(sql).all<Record<string, unknown>>();
        rows = assertRows(result);
      } catch (error) {
        if (error instanceof ReferenceMasterUpstreamError) throw error;
        throw new ReferenceMasterUpstreamError();
      }
      if (rows.length === 0) throw new ReferenceMasterUnavailableError();

      const releaseVersion = rows[0].release_version;
      const expectedCount = rows[0].expected_count;
      if (
        typeof releaseVersion !== "string" || !RELEASE_VERSION_RE.test(releaseVersion) ||
        typeof expectedCount !== "number" || !Number.isSafeInteger(expectedCount) ||
        expectedCount < 1 || expectedCount > MAX_REFERENCE_MASTER_ROWS ||
        rows.length !== expectedCount ||
        rows.some((row) => row.release_version !== releaseVersion || row.expected_count !== expectedCount)
      ) {
        throw new ReferenceMasterUpstreamError();
      }

      const items = rows.map(MAP_ROWS[master]);
      if (master === "languages" && new Set(items.map((item) => item.code)).size !== items.length) {
        throw new ReferenceMasterUpstreamError();
      }
      if (master === "fanmark_tiers" && new Set(items.map((item) => item.tierLevel)).size !== items.length) {
        throw new ReferenceMasterUpstreamError();
      }
      if (master === "fanmark_tier_extension_prices" &&
          new Set(items.map((item) => `${item.tierLevel}:${item.months}`)).size !== items.length) {
        throw new ReferenceMasterUpstreamError();
      }
      return { schemaVersion: 1, releaseVersion, master, items };
    },
  };
}

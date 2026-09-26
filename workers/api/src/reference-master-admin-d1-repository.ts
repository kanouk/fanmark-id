import { selectD1Database, type Env } from "./repository";

const HASH_RE = /^[0-9a-f]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const MAX_REFERENCE_ROWS = 64;
const BASE_TABLES = ["fanmark_tiers", "languages", "reserved_emoji_patterns"] as const;
const EXTENSION_PRICES = "fanmark_tier_extension_prices" as const;
const STAGING = {
  fanmark_tiers: ["fanmark_tier_release_rows", ["id", "created_at", "description", "display_name", "emoji_count_max", "emoji_count_min", "initial_license_days", "is_active", "monthly_price_cents", "tier_level", "updated_at"]],
  languages: ["fanmark_language_release_rows", ["code", "created_at", "id", "is_active", "label", "native_label", "sort_order", "updated_at"]],
  reserved_emoji_patterns: ["fanmark_reserved_emoji_pattern_release_rows", ["created_at", "description", "id", "is_active", "pattern", "price_yen", "updated_at"]],
  fanmark_tier_extension_prices: ["fanmark_extension_price_release_rows", ["id", "created_at", "is_active", "months", "price_yen", "stripe_price_id", "stripe_price_id_live", "tier_level", "updated_at"]],
} as const;

type SourceTable = typeof BASE_TABLES[number] | typeof EXTENSION_PRICES;
type TierPatch = { type: "tier"; id: string; changes: { initialLicenseDays: number | null } };
type PricePatch = {
  type: "extension_price";
  id: string;
  changes: Partial<{
    priceYen: number;
    isActive: boolean;
    stripePriceId: string | null;
    stripePriceIdLive: string | null;
  }>;
};
export type ReferenceMasterAdminPatch = TierPatch | PricePatch;

type SnapshotEntry = { table_name: SourceTable; row_count: number; source_sha256: string; records: Record<string, unknown>[] };

export class ReferenceMasterAdminError extends Error {
  readonly status: number;
  constructor(code: string, status = 503) {
    super(code);
    this.name = "ReferenceMasterAdminError";
    this.status = status;
  }
}

export class ReferenceMasterAdminConfigurationError extends ReferenceMasterAdminError {
  constructor() {
    super("reference_master_admin_unavailable", 503);
    this.name = "ReferenceMasterAdminConfigurationError";
  }
}

function fail(code: string, status = 503): never {
  throw new ReferenceMasterAdminError(code, status);
}

function getDatabase(env: Env): D1Database {
  if (env.REFERENCE_MASTER_ADMIN_BACKEND?.trim() !== "d1") throw new ReferenceMasterAdminConfigurationError();
  const database = selectD1Database(env, "master");
  if (!database) throw new ReferenceMasterAdminConfigurationError();
  return database;
}

function assertRows<T extends Record<string, unknown>>(result: D1Result<T>): T[] {
  if (!result || result.success !== true || !Array.isArray(result.results)) fail("reference_master_admin_unavailable");
  return result.results;
}

async function query<T extends Record<string, unknown>>(database: D1Database, sql: string, ...values: unknown[]): Promise<T[]> {
  try {
    const statement = database.prepare(sql);
    return assertRows(await (values.length ? statement.bind(...values).all<T>() : statement.all<T>()));
  } catch {
    fail("reference_master_admin_unavailable");
  }
}

async function first<T extends Record<string, unknown>>(database: D1Database, sql: string, ...values: unknown[]): Promise<T | null> {
  try {
    const statement = database.prepare(sql);
    return await (values.length ? statement.bind(...values).first<T>() : statement.first<T>());
  } catch {
    fail("reference_master_admin_unavailable");
  }
}

function recordCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_REFERENCE_ROWS) {
    fail("reference_master_admin_unavailable");
  }
  return value;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail("invalid_reference_master_edit", 400);
  }
  return value;
}

function requiredText(value: unknown, max = 2048): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail("reference_master_admin_unavailable");
  return value;
}

function nullableText(value: unknown, max = 2048): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) fail("reference_master_admin_unavailable");
  return value;
}

function storedBoolean(value: unknown): boolean {
  if (value !== 0 && value !== 1) fail("reference_master_admin_unavailable");
  return value === 1;
}

function centsToUsdText(value: unknown): string {
  const cents = integer(value, -9_999_999_999, 9_999_999_999);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function usdTextToCents(value: unknown): number {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)\.\d{2}$/u.test(value)) {
    fail("reference_master_admin_unavailable");
  }
  const negative = value.startsWith("-");
  const [whole, fractional] = (negative ? value.slice(1) : value).split(".");
  const cents = BigInt(whole) * 100n + BigInt(fractional);
  const signed = negative ? -cents : cents;
  if (signed < -9_999_999_999n || signed > 9_999_999_999n) fail("reference_master_admin_unavailable");
  return Number(signed);
}

function stagedRows(entry: SnapshotEntry): Record<string, unknown>[] {
  const [, columns] = STAGING[entry.table_name];
  return entry.records.map((record) => {
    const value: Record<string, unknown> = { ...record };
    if (entry.table_name === "fanmark_tiers") {
      value.monthly_price_cents = usdTextToCents(value.monthly_price_usd);
      delete value.monthly_price_usd;
      value.is_active = value.is_active ? 1 : 0;
    } else if (["languages", "reserved_emoji_patterns", EXTENSION_PRICES].includes(entry.table_name)) {
      value.is_active = value.is_active ? 1 : 0;
    }
    return Object.fromEntries(columns.map((column) => [column, value[column]]));
  });
}

function assertPatch(patch: ReferenceMasterAdminPatch): void {
  if (!patch || typeof patch !== "object" || !UUID_RE.test(patch.id)) {
    fail("invalid_reference_master_edit", 400);
  }
  if (patch.type === "tier") {
    if (!patch.changes || Object.keys(patch.changes).length !== 1 || !Object.hasOwn(patch.changes, "initialLicenseDays")) {
      fail("invalid_reference_master_edit", 400);
    }
    const days = patch.changes.initialLicenseDays;
    if (days !== null) integer(days, 0, 36_500);
    return;
  }
  if (patch.type === "extension_price") {
    const changes = patch.changes;
    const keys = changes && Object.keys(changes);
    const allowed = new Set(["priceYen", "isActive", "stripePriceId", "stripePriceIdLive"]);
    if (!keys || keys.length === 0 || keys.some((key) => !allowed.has(key))) {
      fail("invalid_reference_master_edit", 400);
    }
    if (Object.hasOwn(changes, "priceYen")) integer(changes.priceYen, 0, 2_147_483_647);
    if (Object.hasOwn(changes, "isActive") && typeof changes.isActive !== "boolean") {
      fail("invalid_reference_master_edit", 400);
    }
    for (const key of ["stripePriceId", "stripePriceIdLive"] as const) {
      if (Object.hasOwn(changes, key)) {
        const value = changes[key];
        if (value !== null && (typeof value !== "string" || !/^price_[A-Za-z0-9]{1,128}$/u.test(value))) {
          fail("invalid_stripe_price_id", 400);
        }
      }
    }
    return;
  }
  fail("invalid_reference_master_edit", 400);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function snapshotFromActive(database: D1Database): Promise<{
  releaseVersion: string;
  generation: number;
  snapshot: SnapshotEntry[];
  tiers: Record<string, unknown>[];
  extensionPrices: Record<string, unknown>[];
}> {
  const active = await first<{ release_version: unknown; generation: unknown }>(database,
    "SELECT a.release_version, a.generation FROM fanmark_reference_master_active_release a JOIN fanmark_reference_master_releases r ON r.release_version = a.release_version AND r.status = 'ready' WHERE a.singleton_id = 1");
  if (!active || typeof active.release_version !== "string" || !HASH_RE.test(active.release_version) ||
      typeof active.generation !== "number" || !Number.isSafeInteger(active.generation) || active.generation < 1) {
    fail("reference_master_admin_unavailable");
  }
  const version = active.release_version;
  const [tierRows, languageRows, patternRows, priceRows, tableManifests, priceManifest] = await Promise.all([
    query(database, "SELECT id, created_at, description, display_name, emoji_count_max, emoji_count_min, initial_license_days, is_active, monthly_price_cents, tier_level, updated_at FROM fanmark_tier_release_rows WHERE release_version = ? ORDER BY tier_level, id", version),
    query(database, "SELECT code, created_at, id, is_active, label, native_label, sort_order, updated_at FROM fanmark_language_release_rows WHERE release_version = ? ORDER BY sort_order, code COLLATE BINARY", version),
    query(database, "SELECT created_at, description, id, is_active, pattern, price_yen, updated_at FROM fanmark_reserved_emoji_pattern_release_rows WHERE release_version = ? ORDER BY pattern COLLATE BINARY, id", version),
    query(database, "SELECT id, created_at, is_active, months, price_yen, stripe_price_id, stripe_price_id_live, tier_level, updated_at FROM fanmark_extension_price_release_rows WHERE release_version = ? ORDER BY tier_level, months", version),
    query(database, "SELECT table_name, row_count FROM fanmark_reference_master_release_tables WHERE release_version = ? ORDER BY table_name", version),
    first(database, "SELECT row_count FROM fanmark_reference_master_extension_price_manifests WHERE release_version = ?", version),
  ]);
  if (tableManifests.length !== 3 || !priceManifest || tableManifests.some((manifest) =>
    !["fanmark_tiers", "languages", "reserved_emoji_patterns"].includes(String(manifest.table_name)))) {
    fail("reference_master_admin_unavailable");
  }
  const expected = new Map(tableManifests.map((entry) => [String(entry.table_name), recordCount(entry.row_count)]));
  if (tierRows.length !== expected.get("fanmark_tiers") || languageRows.length !== expected.get("languages") ||
      patternRows.length !== expected.get("reserved_emoji_patterns") || priceRows.length !== recordCount(priceManifest.row_count)) {
    fail("reference_master_admin_unavailable");
  }

  const tiers = tierRows.map((row) => ({
    id: requiredText(row.id), tier_level: integer(row.tier_level, 1, 4),
    display_name: requiredText(row.display_name, 128), description: nullableText(row.description, 1024),
    initial_license_days: row.initial_license_days === null ? null : integer(row.initial_license_days, 0, 36_500),
    is_active: storedBoolean(row.is_active),
  }));
  const extensionPrices = priceRows.map((row) => ({
    id: requiredText(row.id), tier_level: integer(row.tier_level, 1, 4), months: integer(row.months, 1, 120),
    price_yen: integer(row.price_yen, 0, 2_147_483_647), is_active: storedBoolean(row.is_active),
    stripe_price_id: nullableText(row.stripe_price_id, 134),
    stripe_price_id_live: nullableText(row.stripe_price_id_live, 134),
  }));

  const recordsByTable: Record<SourceTable, Record<string, unknown>[]> = {
    fanmark_tiers: tierRows.map((row) => ({
      id: requiredText(row.id), created_at: requiredText(row.created_at), description: nullableText(row.description, 1024),
      display_name: requiredText(row.display_name, 128), emoji_count_max: integer(row.emoji_count_max, 1, 5),
      emoji_count_min: integer(row.emoji_count_min, 1, 5),
      initial_license_days: row.initial_license_days === null ? null : integer(row.initial_license_days, 0, 36_500),
      is_active: storedBoolean(row.is_active), monthly_price_usd: centsToUsdText(row.monthly_price_cents),
      tier_level: integer(row.tier_level, 1, 4), updated_at: requiredText(row.updated_at),
    })),
    languages: languageRows.map((row) => ({
      code: requiredText(row.code, 16), created_at: requiredText(row.created_at), id: requiredText(row.id),
      is_active: storedBoolean(row.is_active), label: requiredText(row.label, 128), native_label: requiredText(row.native_label, 128),
      sort_order: integer(row.sort_order), updated_at: requiredText(row.updated_at),
    })),
    reserved_emoji_patterns: patternRows.map((row) => ({
      created_at: requiredText(row.created_at), description: nullableText(row.description, 1024), id: requiredText(row.id),
      is_active: storedBoolean(row.is_active), pattern: requiredText(row.pattern, 256),
      price_yen: integer(row.price_yen, 0, 2_147_483_647), updated_at: requiredText(row.updated_at),
    })),
    fanmark_tier_extension_prices: priceRows.map((row) => ({
      created_at: requiredText(row.created_at), id: requiredText(row.id), is_active: storedBoolean(row.is_active),
      months: integer(row.months, 1, 120), price_yen: integer(row.price_yen, 0, 2_147_483_647),
      stripe_price_id: nullableText(row.stripe_price_id, 134), stripe_price_id_live: nullableText(row.stripe_price_id_live, 134),
      tier_level: integer(row.tier_level, 1, 4), updated_at: requiredText(row.updated_at),
    })),
  };
  const snapshot: SnapshotEntry[] = [];
  for (const tableName of [...BASE_TABLES, EXTENSION_PRICES]) {
    const records = recordsByTable[tableName];
    snapshot.push({ table_name: tableName, row_count: records.length, source_sha256: await sha256(JSON.stringify(records)), records });
  }
  return { releaseVersion: version, generation: active.generation, snapshot, tiers, extensionPrices };
}

function equalRows(left: Record<string, unknown>[], right: Record<string, unknown>[]): boolean {
  if (left.length !== right.length) return false;
  const normalize = (rows: Record<string, unknown>[]) => rows.map((row) => JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
  )).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.every((row, index) => row === b[index]);
}

async function stageSnapshot(database: D1Database, snapshot: SnapshotEntry[]): Promise<string> {
  const sourceSnapshotSha256 = await sha256(JSON.stringify(snapshot));
  const releaseVersion = sourceSnapshotSha256;
  const baseManifests = snapshot.filter((entry) => entry.table_name !== EXTENSION_PRICES)
    .map(({ table_name, row_count, source_sha256 }) => ({ table_name, row_count, source_sha256 }))
    .sort((a, b) => a.table_name.localeCompare(b.table_name));
  const extensionEntry = snapshot.find((entry) => entry.table_name === EXTENSION_PRICES)!;
  const extensionManifest = {
    table_name: EXTENSION_PRICES,
    row_count: extensionEntry.row_count,
    source_sha256: extensionEntry.source_sha256,
  };
  const manifestJson = JSON.stringify({
    source_snapshot_sha256: sourceSnapshotSha256,
    tables: baseManifests,
    extension_price_manifest: extensionManifest,
  });

  const prior = await first<{ source_snapshot_sha256: unknown; manifest_json: unknown; status: unknown }>(database,
    "SELECT source_snapshot_sha256, manifest_json, status FROM fanmark_reference_master_releases WHERE release_version = ?", releaseVersion);
  if (prior) {
    if (prior.source_snapshot_sha256 !== sourceSnapshotSha256 || prior.manifest_json !== manifestJson || prior.status !== "ready") {
      fail("reference_master_admin_release_conflict");
    }
    for (const entry of snapshot) {
      const [stagingTable, columns] = STAGING[entry.table_name];
      const actual = await query(database,
        `SELECT ${columns.join(", ")} FROM ${stagingTable} WHERE release_version = ?`, releaseVersion);
      if (!equalRows(actual, stagedRows(entry))) fail("reference_master_admin_release_conflict");
    }
    return releaseVersion;
  }

  const statements: D1PreparedStatement[] = [database.prepare(
    "INSERT INTO fanmark_reference_master_releases (release_version, source_snapshot_sha256, manifest_json, status) VALUES (?, ?, ?, 'loading')",
  ).bind(releaseVersion, sourceSnapshotSha256, manifestJson)];
  for (const entry of baseManifests) {
    statements.push(database.prepare(
      "INSERT INTO fanmark_reference_master_release_tables (release_version, table_name, row_count, source_sha256) VALUES (?, ?, ?, ?)",
    ).bind(releaseVersion, entry.table_name, entry.row_count, entry.source_sha256));
  }
  statements.push(database.prepare(
    "INSERT INTO fanmark_reference_master_extension_price_manifests (release_version, row_count, source_sha256) VALUES (?, ?, ?)",
  ).bind(releaseVersion, extensionManifest.row_count, extensionManifest.source_sha256));

  for (const entry of snapshot) {
    const [table, columns] = STAGING[entry.table_name];
    const sql = `INSERT INTO ${table} (release_version, ${columns.join(", ")}) VALUES (${columns.map(() => "?").concat("?").join(", ")})`;
    for (const record of entry.records) {
      let values: unknown[];
      if (entry.table_name === "fanmark_tiers") {
        const cents = usdTextToCents(record.monthly_price_usd);
        values = [record.id, record.created_at, record.description, record.display_name, record.emoji_count_max,
          record.emoji_count_min, record.initial_license_days, record.is_active ? 1 : 0, cents, record.tier_level, record.updated_at];
      } else if (entry.table_name === "languages") {
        values = [record.code, record.created_at, record.id, record.is_active ? 1 : 0, record.label, record.native_label, record.sort_order, record.updated_at];
      } else if (entry.table_name === "reserved_emoji_patterns") {
        values = [record.created_at, record.description, record.id, record.is_active ? 1 : 0, record.pattern, record.price_yen, record.updated_at];
      } else {
        values = [record.id, record.created_at, record.is_active ? 1 : 0, record.months, record.price_yen,
          record.stripe_price_id, record.stripe_price_id_live, record.tier_level, record.updated_at];
      }
      statements.push(database.prepare(sql).bind(releaseVersion, ...values));
    }
  }
  try {
    const results = await database.batch(statements);
    if (results.some((result) => result?.success !== true)) fail("reference_master_admin_stage_failed");
  } catch {
    fail("reference_master_admin_stage_failed");
  }

  for (const entry of snapshot) {
    const [table, columns] = STAGING[entry.table_name];
    const sql = `SELECT ${columns.join(", ")} FROM ${table} WHERE release_version = ?`;
    const actual = await query(database, sql, releaseVersion);
    if (!equalRows(actual, stagedRows(entry))) fail("reference_master_admin_stage_verification_failed");
  }

  const ready = await database.prepare(
    "UPDATE fanmark_reference_master_releases SET status = 'ready', verified_at = CURRENT_TIMESTAMP WHERE release_version = ? AND status = 'loading'",
  ).bind(releaseVersion).run();
  if (ready?.success !== true || ready.meta?.changes !== 1) fail("reference_master_admin_stage_failed");
  return releaseVersion;
}

export function createReferenceMasterAdminD1Repository(env: Env) {
  const database = getDatabase(env);
  return {
    async getPricing() {
      const state = await snapshotFromActive(database);
      return {
        schemaVersion: 1,
        releaseVersion: state.releaseVersion,
        generation: state.generation,
        tiers: state.tiers,
        extensionPrices: state.extensionPrices,
      };
    },

    async updatePricing(expectedReleaseVersion: string, patch: ReferenceMasterAdminPatch) {
      if (!HASH_RE.test(expectedReleaseVersion)) fail("invalid_reference_master_edit", 400);
      assertPatch(patch);
      const current = await snapshotFromActive(database);
      if (current.releaseVersion !== expectedReleaseVersion) fail("reference_master_edit_conflict", 409);

      let changed = false;
      const updatedAt = new Date().toISOString();
      if (patch.type === "tier") {
        const entry = current.snapshot.find((candidate) => candidate.table_name === "fanmark_tiers")!;
        const record = entry.records.find((candidate) => candidate.id === patch.id);
        if (!record) fail("reference_master_row_not_found", 404);
        changed = record.initial_license_days !== patch.changes.initialLicenseDays;
        if (changed) {
          record.initial_license_days = patch.changes.initialLicenseDays;
          record.updated_at = updatedAt;
        }
      } else {
        const entry = current.snapshot.find((candidate) => candidate.table_name === EXTENSION_PRICES)!;
        const record = entry.records.find((candidate) => candidate.id === patch.id);
        if (!record) fail("reference_master_row_not_found", 404);
        const columns: Record<string, string> = {
          priceYen: "price_yen", isActive: "is_active", stripePriceId: "stripe_price_id", stripePriceIdLive: "stripe_price_id_live",
        };
        for (const [key, value] of Object.entries(patch.changes)) {
          const column = columns[key];
          if (record[column] !== value) {
            record[column] = value;
            changed = true;
          }
        }
        if (changed) record.updated_at = updatedAt;
      }

      if (changed) {
        const releaseVersion = await stageSnapshot(database, current.snapshot);
        const activationId = crypto.randomUUID();
        let activated;
        try {
          activated = await database.prepare(
            "UPDATE fanmark_reference_master_active_release SET release_version = ?, previous_release_version = ?, activation_id = ?, action = 'promotion', generation = generation + 1, updated_at = CURRENT_TIMESTAMP WHERE singleton_id = 1 AND release_version = ? AND generation = ?",
          ).bind(releaseVersion, current.releaseVersion, activationId, current.releaseVersion, current.generation).run();
        } catch {
          fail("reference_master_edit_conflict", 409);
        }
        if (activated?.success !== true) fail("reference_master_edit_conflict", 409);
        const afterActivation = await first<{ release_version: unknown; generation: unknown }>(database,
          "SELECT release_version, generation FROM fanmark_reference_master_active_release WHERE singleton_id = 1");
        if (afterActivation?.release_version !== releaseVersion || afterActivation.generation !== current.generation + 1) {
          fail("reference_master_edit_conflict", 409);
        }
      }
      return this.getPricing();
    },
  };
}

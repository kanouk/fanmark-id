import { createHash, randomUUID } from "node:crypto";

const TABLES = Object.freeze({
  fanmark_tiers: {
    staging: "fanmark_tier_release_rows",
    columns: [
      "id", "created_at", "description", "display_name", "emoji_count_max",
      "emoji_count_min", "initial_license_days", "is_active", "monthly_price_cents",
      "tier_level", "updated_at",
    ],
    fields: [
      "created_at", "description", "display_name", "emoji_count_max", "emoji_count_min",
      "id", "initial_license_days", "is_active", "monthly_price_usd", "tier_level", "updated_at",
    ],
  },
  languages: {
    staging: "fanmark_language_release_rows",
    columns: ["code", "created_at", "id", "is_active", "label", "native_label", "sort_order", "updated_at"],
    fields: ["code", "created_at", "id", "is_active", "label", "native_label", "sort_order", "updated_at"],
  },
  reserved_emoji_patterns: {
    staging: "fanmark_reserved_emoji_pattern_release_rows",
    columns: ["created_at", "description", "id", "is_active", "pattern", "price_yen", "updated_at"],
    fields: ["created_at", "description", "id", "is_active", "pattern", "price_yen", "updated_at"],
  },
  fanmark_tier_extension_prices: {
    staging: "fanmark_extension_price_release_rows",
    columns: [
      "id", "created_at", "is_active", "months", "price_yen", "stripe_price_id",
      "stripe_price_id_live", "tier_level", "updated_at",
    ],
    fields: [
      "created_at", "id", "is_active", "months", "price_yen", "stripe_price_id",
      "stripe_price_id_live", "tier_level", "updated_at",
    ],
  },
});

const EXTENSION_PRICE_TABLE = "fanmark_tier_extension_prices";
const BASE_REFERENCE_TABLES = Object.freeze(
  Object.keys(TABLES).filter((tableName) => tableName !== EXTENSION_PRICE_TABLE),
);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertRows(result, code = "reference_master_d1_read_failed") {
  if (!result || result.success !== true || !Array.isArray(result.results)) fail(code);
  return result.results;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(code);
}

function assertString(value, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string") fail("reference_master_value_invalid");
}

function assertInteger(value) {
  if (!Number.isSafeInteger(value)) fail("reference_master_integer_invalid");
}

function assertBoolean(value) {
  if (typeof value !== "boolean") fail("reference_master_boolean_invalid");
}

export function moneyUsdTextToCents(value) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)) {
    fail("reference_master_money_format_invalid");
  }
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  const signed = negative ? -cents : cents;
  if (signed < -9_999_999_999n || signed > 9_999_999_999n) fail("reference_master_money_range_invalid");
  return Number(signed);
}

function mapSourceRecord(tableName, record) {
  const definition = TABLES[tableName];
  if (!definition) fail("reference_master_table_not_allowed");
  exactKeys(record, definition.fields, "reference_master_fields_invalid");
  for (const field of ["created_at", "updated_at"]) assertString(record[field]);

  if (tableName === "fanmark_tiers") {
    assertString(record.id);
    assertString(record.description, true);
    assertString(record.display_name);
    assertInteger(record.emoji_count_max);
    assertInteger(record.emoji_count_min);
    if (record.initial_license_days !== null) assertInteger(record.initial_license_days);
    assertBoolean(record.is_active);
    const monthlyPriceCents = moneyUsdTextToCents(record.monthly_price_usd);
    assertInteger(record.tier_level);
    return [
      record.id, record.created_at, record.description, record.display_name,
      record.emoji_count_max, record.emoji_count_min, record.initial_license_days,
      record.is_active ? 1 : 0, monthlyPriceCents, record.tier_level, record.updated_at,
    ];
  }

  if (tableName === "languages") {
    for (const field of ["code", "id", "label", "native_label"]) assertString(record[field]);
    assertBoolean(record.is_active);
    assertInteger(record.sort_order);
    return [record.code, record.created_at, record.id, record.is_active ? 1 : 0,
      record.label, record.native_label, record.sort_order, record.updated_at];
  }

  if (tableName === EXTENSION_PRICE_TABLE) {
    assertString(record.id);
    assertBoolean(record.is_active);
    assertInteger(record.months);
    assertInteger(record.price_yen);
    assertString(record.stripe_price_id, true);
    assertString(record.stripe_price_id_live, true);
    assertInteger(record.tier_level);
    if (record.months < 1 || record.months > 120 || record.price_yen < 0 ||
        record.price_yen > 2_147_483_647 || record.tier_level < 1 || record.tier_level > 4 ||
        [record.stripe_price_id, record.stripe_price_id_live].some((value) =>
          value !== null && !/^price_[A-Za-z0-9]{1,128}$/u.test(value))) {
      fail("reference_master_extension_price_invalid");
    }
    return [record.id, record.created_at, record.is_active ? 1 : 0, record.months,
      record.price_yen, record.stripe_price_id, record.stripe_price_id_live,
      record.tier_level, record.updated_at];
  }

  assertString(record.description, true);
  assertString(record.id);
  assertBoolean(record.is_active);
  assertString(record.pattern);
  assertInteger(record.price_yen);
  return [record.created_at, record.description, record.id, record.is_active ? 1 : 0,
    record.pattern, record.price_yen, record.updated_at];
}

function normalizeSnapshot(snapshot, snapshotSha256) {
  if (!/^[0-9a-f]{64}$/.test(snapshotSha256)) fail("reference_master_snapshot_hash_invalid");
  if (!Array.isArray(snapshot) || snapshot.length !== Object.keys(TABLES).length) {
    fail("reference_master_snapshot_invalid");
  }
  const byName = new Map();
  for (const entry of snapshot) {
    exactKeys(entry, ["table_name", "row_count", "source_sha256", "records"], "reference_master_snapshot_entry_invalid");
    const definition = TABLES[entry.table_name];
    if (!definition || byName.has(entry.table_name)) fail("reference_master_table_not_allowed");
    if (!Number.isSafeInteger(entry.row_count) || entry.row_count < 0 || !Array.isArray(entry.records) ||
        entry.records.length !== entry.row_count || !/^[0-9a-f]{64}$/.test(entry.source_sha256)) {
      fail("reference_master_snapshot_entry_invalid");
    }
    const records = entry.records.map((record) => mapSourceRecord(entry.table_name, record));
    byName.set(entry.table_name, { ...entry, definition, records });
  }
  if (Object.keys(TABLES).some((tableName) => !byName.has(tableName))) fail("reference_master_table_set_invalid");
  const tables = [...byName.entries()]
    .filter(([tableName]) => tableName !== EXTENSION_PRICE_TABLE)
    .sort(([left], [right]) => left.localeCompare(right)).map(([tableName, entry]) => ({
    table_name: tableName,
    row_count: entry.row_count,
    source_sha256: entry.source_sha256,
  }));
  const extensionPriceEntry = byName.get(EXTENSION_PRICE_TABLE);
  if (!extensionPriceEntry) fail("reference_master_extension_price_manifest_missing");
  const extensionPriceManifest = {
    table_name: EXTENSION_PRICE_TABLE,
    row_count: extensionPriceEntry.row_count,
    source_sha256: extensionPriceEntry.source_sha256,
  };
  return { releaseVersion: snapshotSha256, tables, extensionPriceManifest, entries: byName };
}

function releaseManifestJson(snapshotSha256, release) {
  return JSON.stringify({
    source_snapshot_sha256: snapshotSha256,
    tables: release.tables,
    extension_price_manifest: release.extensionPriceManifest,
  });
}

async function readRows(database, sql, bindings = []) {
  let statement = database.prepare(sql);
  if (bindings.length) statement = statement.bind(...bindings);
  return assertRows(await statement.all());
}

export function referenceMasterRowsEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  const normalize = (rows) => rows.map((row) => JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
  ));
  const expectedSorted = normalize(expected).sort();
  const actualSorted = normalize(actual).sort();
  return expectedSorted.every((row, index) => row === actualSorted[index]);
}

function sameRows(actual, expected) {
  return referenceMasterRowsEqual(actual, expected);
}

async function captureActiveState(database) {
  const activeRows = await readRows(database,
    "SELECT singleton_id, release_version, previous_release_version, activation_id, action, generation FROM fanmark_reference_master_active_release ORDER BY singleton_id");
  const auditRows = await readRows(database,
    "SELECT activation_id, generation, action, from_version, to_version FROM fanmark_reference_master_release_activations ORDER BY generation");
  return { activeRows, auditRows };
}

export async function stageReferenceMasterRelease({ database, snapshot, snapshotSha256, maxRowsPerBatch = 25, hooks = {} }) {
  if (!Number.isInteger(maxRowsPerBatch) || maxRowsPerBatch < 1 || maxRowsPerBatch > 100) {
    fail("reference_master_batch_size_invalid");
  }
  const release = normalizeSnapshot(snapshot, snapshotSha256);
  const manifestJson = releaseManifestJson(snapshotSha256, release);
  const activeBefore = await captureActiveState(database);
  const existing = await readRows(database,
    "SELECT release_version, source_snapshot_sha256, manifest_json, status FROM fanmark_reference_master_releases WHERE release_version = ?",
    [release.releaseVersion]);

  if (existing.length > 0) {
    const row = existing[0];
    if (row.source_snapshot_sha256 !== snapshotSha256 || row.manifest_json !== manifestJson) {
      fail("reference_master_release_conflict");
    }
    if (row.status === "ready") {
      const reusable = await verifyStagedReferenceMasterRelease({ database, snapshot, snapshotSha256 });
      if (!reusable) fail("reference_master_ready_release_mismatch");
      const activeAfter = await captureActiveState(database);
      if (JSON.stringify(activeBefore) !== JSON.stringify(activeAfter)) fail("reference_master_stage_changed_active_state");
      return { releaseVersion: release.releaseVersion, status: "ready", reused: true, tables: release.tables };
    }
    if (row.status !== "loading") fail("reference_master_release_not_resumable");
    for (const { staging } of Object.values(TABLES)) {
      const deleted = await database.prepare(`DELETE FROM ${staging} WHERE release_version = ?`).bind(release.releaseVersion).run();
      if (deleted?.success !== true) fail("reference_master_retry_cleanup_failed");
    }
    const cleared = await database.prepare(
      "DELETE FROM fanmark_reference_master_release_tables WHERE release_version = ?",
    ).bind(release.releaseVersion).run();
    if (cleared?.success !== true) fail("reference_master_retry_cleanup_failed");
    const clearedExtensionManifest = await database.prepare(
      "DELETE FROM fanmark_reference_master_extension_price_manifests WHERE release_version = ?",
    ).bind(release.releaseVersion).run();
    if (clearedExtensionManifest?.success !== true) fail("reference_master_retry_cleanup_failed");
  } else {
    const created = await database.prepare(
      "INSERT INTO fanmark_reference_master_releases (release_version, source_snapshot_sha256, manifest_json, status) VALUES (?, ?, ?, 'loading')",
    ).bind(release.releaseVersion, snapshotSha256, manifestJson).run();
    if (created?.success !== true) fail("reference_master_release_create_failed");
  }

  const statements = [];
  for (const entry of release.tables) {
    statements.push(database.prepare(
      "INSERT INTO fanmark_reference_master_release_tables (release_version, table_name, row_count, source_sha256) VALUES (?, ?, ?, ?)",
    ).bind(release.releaseVersion, entry.table_name, entry.row_count, entry.source_sha256));
  }
  statements.push(database.prepare(
    "INSERT INTO fanmark_reference_master_extension_price_manifests (release_version, row_count, source_sha256) VALUES (?, ?, ?)",
  ).bind(release.releaseVersion, release.extensionPriceManifest.row_count, release.extensionPriceManifest.source_sha256));
  let batchNumber = 0;
  for (const [tableName, entry] of release.entries) {
    const columnNames = ["release_version", ...entry.definition.columns];
    const placeholders = columnNames.map(() => "?").join(", ");
    const sql = `INSERT INTO ${entry.definition.staging} (${columnNames.join(", ")}) VALUES (${placeholders})`;
    for (let offset = 0; offset < entry.records.length; offset += maxRowsPerBatch) {
      const chunk = entry.records.slice(offset, offset + maxRowsPerBatch);
      for (const record of chunk) {
        statements.push(database.prepare(sql).bind(release.releaseVersion, ...record));
      }
      if (statements.length >= maxRowsPerBatch) {
        const results = await database.batch(statements.splice(0));
        if (results.some((result) => result?.success !== true)) fail("reference_master_stage_write_failed");
        batchNumber += 1;
        await hooks.afterBatch?.({ batchNumber, tableName });
      }
    }
  }
  if (statements.length) {
    const results = await database.batch(statements);
    if (results.some((result) => result?.success !== true)) fail("reference_master_stage_write_failed");
    batchNumber += 1;
    await hooks.afterBatch?.({ batchNumber, tableName: null });
  }

  const verified = await verifyStagedReferenceMasterRelease({ database, snapshot, snapshotSha256 });
  if (!verified) fail("reference_master_stage_readback_mismatch");
  const markedReady = await database.prepare(
    "UPDATE fanmark_reference_master_releases SET status = 'ready', verified_at = CURRENT_TIMESTAMP WHERE release_version = ? AND status = 'loading'",
  ).bind(release.releaseVersion).run();
  if (markedReady?.success !== true || markedReady.meta?.changes !== 1) fail("reference_master_release_ready_failed");

  const ready = await readRows(database,
    "SELECT status FROM fanmark_reference_master_releases WHERE release_version = ?",
    [release.releaseVersion]);
  if (ready.length !== 1 || ready[0].status !== "ready") fail("reference_master_release_ready_readback_failed");
  const activeAfter = await captureActiveState(database);
  if (JSON.stringify(activeBefore) !== JSON.stringify(activeAfter)) fail("reference_master_stage_changed_active_state");
  return { releaseVersion: release.releaseVersion, status: "ready", reused: false, tables: release.tables };
}

export async function verifyStagedReferenceMasterRelease({ database, snapshot, snapshotSha256 }) {
  const release = normalizeSnapshot(snapshot, snapshotSha256);
  const metadata = await readRows(database,
    "SELECT release_version, source_snapshot_sha256, manifest_json FROM fanmark_reference_master_releases WHERE release_version = ?",
    [release.releaseVersion]);
  const manifestJson = releaseManifestJson(snapshotSha256, release);
  if (metadata.length !== 1 || metadata[0].source_snapshot_sha256 !== snapshotSha256 ||
      metadata[0].manifest_json !== manifestJson) return false;

  for (const [tableName, entry] of release.entries) {
    const selectColumns = entry.definition.columns.join(", ");
    const actual = await readRows(database,
      `SELECT ${selectColumns} FROM ${entry.definition.staging} WHERE release_version = ? ORDER BY ${entry.definition.columns[0]}`,
      [release.releaseVersion]);
    const expected = entry.records.map((values) => Object.fromEntries(
      entry.definition.columns.map((column, index) => [column, values[index]]),
    ));
    if (!sameRows(actual, expected)) return false;
    if (tableName === EXTENSION_PRICE_TABLE) {
      const summary = await readRows(database,
        "SELECT row_count, source_sha256 FROM fanmark_reference_master_extension_price_manifests WHERE release_version = ?",
        [release.releaseVersion]);
      if (summary.length !== 1 || summary[0].row_count !== expected.length ||
          summary[0].source_sha256 !== release.extensionPriceManifest.source_sha256) return false;
    } else {
      const summary = await readRows(database,
        "SELECT table_name, row_count, source_sha256 FROM fanmark_reference_master_release_tables WHERE release_version = ? AND table_name = ?",
        [release.releaseVersion, tableName]);
      if (summary.length !== 1 || summary[0].row_count !== expected.length ||
          summary[0].source_sha256 !== [...release.tables].find((table) => table.table_name === tableName).source_sha256) return false;
    }
  }
  return true;
}

export async function activateReferenceMasterRelease({ database, releaseVersion, expectedActiveVersion = null, activationId = randomUUID() }) {
  if (!/^[0-9a-f]{64}$/.test(releaseVersion) || typeof activationId !== "string" || activationId.length < 1) {
    fail("reference_master_activation_input_invalid");
  }
  const activeRows = await readRows(database,
    "SELECT singleton_id, release_version, previous_release_version, activation_id, action, generation FROM fanmark_reference_master_active_release ORDER BY singleton_id");
  if (activeRows.length > 1 || (expectedActiveVersion === null && activeRows.length !== 0) ||
      (expectedActiveVersion !== null && (activeRows.length !== 1 || activeRows[0].release_version !== expectedActiveVersion))) {
    fail("reference_master_active_state_conflict");
  }
  if (activeRows.length === 1 && activeRows[0].release_version === releaseVersion) {
    const audit = await readRows(database,
      "SELECT activation_id, generation, action, from_version, to_version FROM fanmark_reference_master_release_activations WHERE activation_id = ?",
      [activeRows[0].activation_id]);
    if (audit.length !== 1 || audit[0].to_version !== releaseVersion) fail("reference_master_active_audit_mismatch");
    return { releaseVersion, generation: activeRows[0].generation, action: activeRows[0].action, reused: true };
  }

  const releaseRows = await readRows(database,
    "SELECT status FROM fanmark_reference_master_releases WHERE release_version = ?",
    [releaseVersion]);
  if (releaseRows.length !== 1 || releaseRows[0].status !== "ready") fail("reference_master_release_not_ready");
  const generation = activeRows.length ? activeRows[0].generation + 1 : 1;
  const result = activeRows.length
    ? await database.prepare(
      "UPDATE fanmark_reference_master_active_release SET release_version = ?, previous_release_version = ?, activation_id = ?, action = 'promotion', generation = ?, updated_at = CURRENT_TIMESTAMP WHERE singleton_id = 1",
    ).bind(releaseVersion, activeRows[0].release_version, activationId, generation).run()
    : await database.prepare(
      "INSERT INTO fanmark_reference_master_active_release (singleton_id, release_version, previous_release_version, activation_id, action, generation) VALUES (1, ?, NULL, ?, 'promotion', 1)",
    ).bind(releaseVersion, activationId).run();
  if (result?.success !== true) fail("reference_master_activation_write_failed");

  const after = await captureActiveState(database);
  if (after.activeRows.length !== 1 || after.activeRows[0].release_version !== releaseVersion ||
      after.activeRows[0].activation_id !== activationId || after.activeRows[0].generation !== generation ||
      after.auditRows.length !== (activeRows.length ? 2 : 1) ||
      after.auditRows.at(-1)?.to_version !== releaseVersion) fail("reference_master_activation_readback_mismatch");
  return { releaseVersion, generation, action: "promotion", reused: false };
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "string") {
    if (value.includes("\0")) fail("reference_master_sql_nul_value");
    return "'" + value.replaceAll("'", "''") + "'";
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  fail("reference_master_sql_value_invalid");
}

export function renderReferenceMasterReleaseSql({ snapshot, snapshotSha256, activationId = randomUUID() }) {
  if (typeof activationId !== "string" || activationId.length < 1) fail("reference_master_activation_input_invalid");
  const release = normalizeSnapshot(snapshot, snapshotSha256);
  const manifestJson = releaseManifestJson(snapshotSha256, release);
  const statements = [
    "INSERT INTO fanmark_reference_master_releases (release_version, source_snapshot_sha256, manifest_json, status) VALUES (" +
      [release.releaseVersion, snapshotSha256, manifestJson, "loading"].map(sqlLiteral).join(", ") + ");",
  ];
  for (const entry of release.tables) {
    statements.push("INSERT INTO fanmark_reference_master_release_tables (release_version, table_name, row_count, source_sha256) VALUES (" +
      [release.releaseVersion, entry.table_name, entry.row_count, entry.source_sha256].map(sqlLiteral).join(", ") + ");");
  }
  statements.push("INSERT INTO fanmark_reference_master_extension_price_manifests (release_version, row_count, source_sha256) VALUES (" +
    [release.releaseVersion, release.extensionPriceManifest.row_count, release.extensionPriceManifest.source_sha256].map(sqlLiteral).join(", ") + ");");
  for (const [tableName, entry] of release.entries) {
    const columnNames = ["release_version", ...entry.definition.columns];
    for (const values of entry.records) {
      statements.push(`INSERT INTO ${entry.definition.staging} (${columnNames.join(", ")}) VALUES (` +
        [release.releaseVersion, ...values].map(sqlLiteral).join(", ") + ");");
    }
  }
  statements.push(
    "UPDATE fanmark_reference_master_releases SET status = 'ready', verified_at = CURRENT_TIMESTAMP WHERE release_version = " +
      sqlLiteral(release.releaseVersion) + " AND status = 'loading';",
  );
  statements.push(
    "INSERT INTO fanmark_reference_master_active_release (singleton_id, release_version, previous_release_version, activation_id, action, generation) VALUES (1, " +
      sqlLiteral(release.releaseVersion) + ", NULL, " + sqlLiteral(activationId) + ", " + sqlLiteral("promotion") + ", 1);",
  );
  statements.push(
    "SELECT a.release_version, a.generation, " +
      "(SELECT count(*) FROM fanmark_tiers) AS fanmark_tiers_rows, " +
      "(SELECT count(*) FROM languages) AS languages_rows, " +
      "(SELECT count(*) FROM reserved_emoji_patterns) AS reserved_emoji_patterns_rows, " +
      "(SELECT count(*) FROM fanmark_tier_extension_prices) AS fanmark_tier_extension_prices_rows " +
      "FROM fanmark_reference_master_active_release AS a WHERE a.singleton_id = 1;",
  );
  return { releaseVersion: release.releaseVersion, activationId, statements, sql: statements.join("\n") + "\n" };
}

export const REFERENCE_MASTER_TABLES = Object.freeze(Object.keys(TABLES));

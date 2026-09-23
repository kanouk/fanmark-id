import { promises as fs } from "node:fs";
import path from "node:path";
import { verifyRelease } from "../build-emoji-release.ts";

export const EMOJI_MASTER_RELEASE_TABLES = Object.freeze({
  imports: "fanmark_emoji_master_release_imports",
  staging: "fanmark_emoji_master_release_staging",
});

const TARGET_COLUMNS = [
  "id",
  "emoji",
  "short_name",
  "keywords",
  "category",
  "subcategory",
  "codepoints",
  "sort_order",
  "created_at",
  "updated_at",
];

const IMPORT_COLUMNS = [
  "release_version",
  "manifest_json",
  "row_count",
  "status",
  "created_at",
  "verified_at",
];

const STAGING_COLUMNS = [
  "release_version",
  "ordinal",
  "id",
  "emoji",
  "short_name",
  "keywords_json",
  "category",
  "subcategory",
  "codepoints_json",
  "sort_order",
];

const INSERT_STAGING_SQL = [
  "INSERT INTO fanmark_emoji_master_release_staging",
  "(release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order)",
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
].join(" ");

const MAX_ROWS_PER_BATCH = 100;
const VERSION_RE = /^[0-9a-f]{64}$/;

export class EmojiMasterReleaseStageError extends Error {
  constructor(code) {
    super(code);
    this.name = "EmojiMasterReleaseStageError";
    this.code = code;
  }
}

function fail(code) {
  return new EmojiMasterReleaseStageError(code);
}

function rowsOf(result) {
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw fail("d1_read_failed");
  }
  return result.results;
}

function resultChanged(result, expected) {
  return result && result.success === true && result.meta?.changes === expected;
}

function canonicalManifestJson(manifest) {
  return JSON.stringify(Object.fromEntries(
    Object.keys(manifest).sort().map((key) => [key, manifest[key]]),
  ));
}

async function readRows(database, sql, bindings = []) {
  const statement = database.prepare(sql);
  const query = bindings.length ? statement.bind(...bindings) : statement;
  return rowsOf(await query.all());
}

async function assertColumns(database, table, expected) {
  const safeTable = table.replaceAll('"', '""');
  let rows;
  try {
    rows = await readRows(database, 'PRAGMA table_info("' + safeTable + '")');
  } catch {
    throw fail("d1_schema_unavailable");
  }
  if (rows.length !== expected.length || rows.some((row, index) => row.name !== expected[index])) {
    throw fail("d1_schema_mismatch");
  }
  return rows;
}

async function assertEmojiMasterSchema(database) {
  const columns = await assertColumns(database, "emoji_master", TARGET_COLUMNS);
  const idColumn = columns.find((column) => column.name === "id");
  const emojiColumn = columns.find((column) => column.name === "emoji");
  if (!idColumn || idColumn.pk !== 1 || idColumn.notnull !== 1 || !emojiColumn || emojiColumn.notnull !== 1) {
    throw fail("d1_schema_mismatch");
  }

  const indexes = await readRows(database, 'PRAGMA index_list("emoji_master")');
  let hasUniqueEmoji = false;
  for (const index of indexes) {
    if (index.unique !== 1 || typeof index.name !== "string") continue;
    const safeIndex = index.name.replaceAll('"', '""');
    const columnsForIndex = await readRows(database, 'PRAGMA index_info("' + safeIndex + '")');
    if (columnsForIndex.length === 1 && columnsForIndex[0].name === "emoji") hasUniqueEmoji = true;
  }
  if (!hasUniqueEmoji) throw fail("d1_schema_mismatch");
}

async function assertStagingSchema(database) {
  await assertColumns(database, EMOJI_MASTER_RELEASE_TABLES.imports, IMPORT_COLUMNS);
  const columns = await assertColumns(database, EMOJI_MASTER_RELEASE_TABLES.staging, STAGING_COLUMNS);
  const releaseColumn = columns.find((column) => column.name === "release_version");
  const idColumn = columns.find((column) => column.name === "id");
  if (!releaseColumn || releaseColumn.pk !== 1 || !idColumn || idColumn.pk !== 2) {
    throw fail("d1_schema_mismatch");
  }

  const foreignKeys = await readRows(
    database,
    'PRAGMA foreign_key_list("' + EMOJI_MASTER_RELEASE_TABLES.staging + '")',
  );
  if (!foreignKeys.some((key) =>
    key.table === EMOJI_MASTER_RELEASE_TABLES.imports &&
    key.from === "release_version" &&
    key.to === "release_version" &&
    String(key.on_delete).toUpperCase() === "CASCADE"
  )) {
    throw fail("d1_schema_mismatch");
  }
}

function parseJsonArray(value, code) {
  if (typeof value !== "string") throw fail(code);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw fail(code);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw fail(code);
  return parsed;
}

async function assertTargetIdentityContinuity(database, records) {
  const sourceRows = await readRows(database, "SELECT id, emoji, codepoints FROM emoji_master ORDER BY id");
  const byId = new Map(records.map((record) => [record.id, record]));
  const existingEmoji = new Map();
  for (const row of sourceRows) {
    if (typeof row.id !== "string" || typeof row.emoji !== "string") throw fail("target_catalog_invalid");
    const current = byId.get(row.id);
    const codepoints = parseJsonArray(row.codepoints, "target_catalog_invalid");
    if (!current || current.emoji !== row.emoji || JSON.stringify(current.codepoints) !== JSON.stringify(codepoints)) {
      throw fail("target_identity_conflict");
    }
    existingEmoji.set(row.emoji, row.id);
  }
  for (const record of records) {
    const existingId = existingEmoji.get(record.emoji);
    if (existingId !== undefined && existingId !== record.id) throw fail("target_identity_conflict");
  }
}

function expectedStagingRow(record, version, ordinal) {
  return {
    release_version: version,
    ordinal,
    id: record.id,
    emoji: record.emoji,
    short_name: record.short_name,
    keywords_json: JSON.stringify(record.keywords),
    category: record.category,
    subcategory: record.subcategory,
    codepoints_json: JSON.stringify(record.codepoints),
    sort_order: record.sort_order,
  };
}

async function assertStageReadback(database, version, records) {
  const rows = await readRows(
    database,
    "SELECT release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order " +
      "FROM fanmark_emoji_master_release_staging WHERE release_version = ? ORDER BY ordinal",
    [version],
  );
  if (rows.length !== records.length) throw fail("staging_readback_mismatch");
  for (let index = 0; index < records.length; index += 1) {
    const expected = expectedStagingRow(records[index], version, index + 1);
    const actual = rows[index];
    if (!actual ||
        actual.release_version !== expected.release_version ||
        actual.ordinal !== expected.ordinal ||
        actual.id !== expected.id ||
        actual.emoji !== expected.emoji ||
        actual.short_name !== expected.short_name ||
        actual.keywords_json !== expected.keywords_json ||
        actual.category !== expected.category ||
        actual.subcategory !== expected.subcategory ||
        actual.codepoints_json !== expected.codepoints_json ||
        actual.sort_order !== expected.sort_order) {
      throw fail("staging_readback_mismatch");
    }
  }
}

async function readImport(database, version) {
  const rows = await readRows(
    database,
    "SELECT release_version, manifest_json, row_count, status FROM fanmark_emoji_master_release_imports WHERE release_version = ?",
    [version],
  );
  if (rows.length > 1) throw fail("d1_state_invalid");
  return rows[0] ?? null;
}

async function prepareImport(database, version, manifestJson, rowCount) {
  const current = await readImport(database, version);
  if (!current) {
    const result = await database.prepare(
      "INSERT INTO fanmark_emoji_master_release_imports (release_version, manifest_json, row_count, status) VALUES (?, ?, ?, 'loading')",
    ).bind(version, manifestJson, rowCount).run();
    if (!result || result.success !== true) throw fail("d1_write_failed");
    return false;
  }
  if (current.manifest_json !== manifestJson || current.row_count !== rowCount) {
    throw fail("release_version_collision");
  }
  if (current.status === "ready") return true;
  if (current.status === "failed") throw fail("staging_version_quarantined");
  if (current.status !== "loading") throw fail("d1_state_invalid");

  const results = await database.batch([
    database.prepare(
      "DELETE FROM fanmark_emoji_master_release_staging WHERE release_version = ?",
    ).bind(version),
    database.prepare(
      "UPDATE fanmark_emoji_master_release_imports SET status = 'loading', verified_at = NULL WHERE release_version = ? AND status = 'loading' AND manifest_json = ?",
    ).bind(version, manifestJson),
  ]);
  if (!Array.isArray(results) || results.length !== 2 || results.some((result) => result.success !== true)) {
    throw fail("d1_write_failed");
  }
  return false;
}

export async function stageEmojiMasterRelease({
  database,
  releaseDirectory,
  maxRowsPerBatch = 50,
  hooks = {},
}) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw fail("d1_binding_required");
  }
  if (typeof releaseDirectory !== "string" || releaseDirectory.length === 0) throw fail("release_directory_required");
  if (!Number.isSafeInteger(maxRowsPerBatch) || maxRowsPerBatch < 1 || maxRowsPerBatch > MAX_ROWS_PER_BATCH) {
    throw fail("invalid_batch_size");
  }
  if (!hooks || typeof hooks !== "object" ||
      (hooks.afterBatch !== undefined && typeof hooks.afterBatch !== "function")) {
    throw fail("invalid_test_hook");
  }

  const verified = await verifyRelease(releaseDirectory).catch(() => {
    throw fail("release_verification_failed");
  });
  const manifest = JSON.parse(await fs.readFile(path.join(releaseDirectory, "manifest.json"), "utf8"));
  if (!VERSION_RE.test(verified.version) || manifest.version !== verified.version ||
      manifest.entryCount !== verified.records.length || verified.records.length === 0) {
    throw fail("release_manifest_invalid");
  }
  const manifestJson = canonicalManifestJson(manifest);
  const records = verified.records;

  await assertEmojiMasterSchema(database);
  await assertStagingSchema(database);
  await assertTargetIdentityContinuity(database, records);

  const alreadyReady = await prepareImport(database, verified.version, manifestJson, records.length);
  if (alreadyReady) {
    try {
      await assertStageReadback(database, verified.version, records);
    } catch (error) {
      if (error?.code === "staging_readback_mismatch") {
        const quarantined = await database.prepare(
          "UPDATE fanmark_emoji_master_release_imports SET status = 'failed' WHERE release_version = ? AND status = 'ready' AND manifest_json = ?",
        ).bind(verified.version, manifestJson).run();
        if (!resultChanged(quarantined, 1)) throw fail("staging_quarantine_failed");
      }
      throw error;
    }
    return { version: verified.version, recordCount: records.length, status: "ready", reused: true };
  }

  let batchNumber = 0;
  for (let offset = 0; offset < records.length; offset += maxRowsPerBatch) {
    const batch = records.slice(offset, offset + maxRowsPerBatch);
    const statements = batch.map((record, localIndex) => {
      const ordinal = offset + localIndex + 1;
      return database.prepare(INSERT_STAGING_SQL).bind(
        verified.version,
        ordinal,
        record.id,
        record.emoji,
        record.short_name,
        JSON.stringify(record.keywords),
        record.category,
        record.subcategory,
        JSON.stringify(record.codepoints),
        record.sort_order,
      );
    });
    const results = await database.batch(statements);
    if (!Array.isArray(results) || results.length !== statements.length ||
        results.some((result) => result.success !== true)) {
      throw fail("d1_write_failed");
    }
    batchNumber += 1;
    if (hooks.afterBatch) await hooks.afterBatch({ batchNumber, rowsStaged: offset + batch.length });
  }

  await assertStageReadback(database, verified.version, records);
  const now = new Date().toISOString();
  const finalized = await database.prepare(
    "UPDATE fanmark_emoji_master_release_imports SET status = 'ready', verified_at = ? WHERE release_version = ? AND manifest_json = ? AND row_count = ? AND status = 'loading'",
  ).bind(now, verified.version, manifestJson, records.length).run();
  if (!resultChanged(finalized, 1)) throw fail("d1_finalize_failed");

  const current = await readImport(database, verified.version);
  if (!current || current.status !== "ready" || current.manifest_json !== manifestJson ||
      current.row_count !== records.length) {
    throw fail("d1_finalize_readback_mismatch");
  }
  await assertStageReadback(database, verified.version, records);
  return { version: verified.version, recordCount: records.length, status: "ready", reused: false };
}

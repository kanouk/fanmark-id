#!/usr/bin/env node

/**
 * Import a verified PostgreSQL snapshot into an explicitly supplied local D1
 * binding. This module has no Wrangler, credential, or remote-runner path.
 *
 * The destination schema must already have been created by a reviewed schema
 * rehearsal. The importer creates only its private progress ledger tables.
 */

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { convertSchema } from "./schema-convert.mjs";
import {
  SNAPSHOT_FORMAT_VERSION,
  ROW_ENVELOPE_VERSION,
  SNAPSHOT_STATUS_FILE,
  SNAPSHOT_MANIFEST_FILE,
  SNAPSHOT_CATALOG_FILE,
  SNAPSHOT_SCHEMA_REPORT_FILE,
  TABLE_DIRECTORY,
  SUPPORTED_SEQUENCE_TARGET,
  canonicalJson,
  catalogFingerprint,
  compareUtf8,
  getPrimaryKeyInfo,
  getTableNames,
  validateSequenceStates,
  primaryKeyFromEnvelope,
  rowRecordForEnvelope,
  schemaReportFingerprint,
  sha256Hex,
  quoteIdentifier,
} from "./snapshot-format.mjs";
import { compileRowConverter } from "./row-conversion.mjs";
import { SnapshotVerificationError, verifySnapshot } from "./snapshot-verify.mjs";
import { inspectCredentialTransformSchema } from "./credential-transform-schema.mjs";
import { openSnapshotBundle } from "./snapshot-encryption.mjs";
import {
  CREDENTIAL_NONCREDENTIAL_COLUMNS,
  CREDENTIAL_SOURCE_RELATION,
} from "./credential-descriptor.mjs";
import { compileCredentialImportProjection } from "./credential-import-projection.mjs";
import { buildCredentialTargetInsert } from "./credential-import-row.mjs";
import {
  prepareCredentialImportArtifact,
  reserveCredentialImportArtifact,
} from "./credential-import-transform.mjs";

export const D1_IMPORT_SCHEMA_VERSION = 2;
export const D1_IMPORT_CODEC_VERSION = 2;
export const DEFAULT_MAX_ROWS_PER_BATCH = 50;
export const DEFAULT_MAX_BATCH_BYTES = 512 * 1024;
export const DEFAULT_MAX_BINDINGS_PER_BATCH = 500;
// Source envelope lines include JSON/provenance overhead and therefore have a
// separate bound from the encoded SQLite row bound below.
export const DEFAULT_MAX_ROW_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_TARGET_ROW_BYTES = 1_900_000;
export const DEFAULT_SCAN_BATCH_ROWS = 100;
export const MAX_ROWS_PER_BATCH = 1000;
export const MAX_BATCH_BYTES = 1_900_000;
export const MAX_BINDINGS_PER_BATCH = 1000;
export const MAX_BINDINGS_PER_STATEMENT = 100;
export const MAX_SQL_STATEMENT_BYTES = 100_000;
export const MAX_TARGET_ROW_BYTES = 1_900_000;
export const MAX_SCAN_BATCH_ROWS = 1000;

export const LEDGER_TABLES = Object.freeze({
  runs: "__fanmark_d1_import_runs",
  checkpoints: "__fanmark_d1_import_checkpoints",
  guards: "__fanmark_d1_import_guards",
});

// Miniflare's local D1 adapter exposes this provider-owned metadata table.
// Keep the allowlist exact so an application `_cf_*` object is never silently
// accepted as infrastructure.
const D1_PROVIDER_OBJECTS = new Set(["table:_cf_METADATA"]);

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const ZERO_DIGEST = "0".repeat(64);

export class D1ImportError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "D1ImportError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Generate a fresh incarnation token for a newly created isolated D1 target.
 * Callers must persist this token with the target/run metadata and reuse it
 * only when the same target database is being resumed.
 */
export function createTargetIncarnation(prefix = "d1-target") {
  if (typeof prefix !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(prefix)) throw fail("invalid_target_incarnation_prefix");
  return `${prefix}-${randomBytes(18).toString("hex")}`;
}

function fail(code, cause) {
  return new D1ImportError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertIdentifier(value, code = "unsafe_identifier") {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) throw fail(code);
  return value;
}

function assertDigest(value, code) {
  if (typeof value !== "string" || !HEX64_RE.test(value)) throw fail(code);
  return value;
}

function assertPositiveInteger(value, code, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail(code);
  return value;
}

function assertNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail(code);
  return value;
}

function normalizeSql(value) {
  // SQLite's sqlite_master text can differ in insignificant whitespace from
  // the submitted DDL. Collapse whitespace outside quoted literals only;
  // CHECK predicates and partial-index literals are data-bearing text.
  const source = String(value).replace(/;\s*$/, "");
  let output = "";
  let pendingSpace = false;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === "'") {
      output += character;
      if (character === "'" && source[index + 1] === "'") {
        output += source[index + 1];
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (character === "'") {
      if (pendingSpace && output.length > 0) output += " ";
      pendingSpace = false;
      output += character;
      quote = "'";
      continue;
    }
    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output.length > 0) output += " ";
    pendingSpace = false;
    output += character;
  }
  return output.trim();
}

function parseSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (quoted && sql[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (quoted) throw fail("generated_schema_sql_unterminated_literal");
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function generatedSchemaObjects(sql) {
  const objects = new Map();
  for (const statement of parseSqlStatements(sql)) {
    const table = statement.match(/CREATE\s+TABLE\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/i);
    const index = statement.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/i);
    if (table) {
      const name = table[1].startsWith('"') ? table[1].slice(1, -1).replaceAll('""', '"') : table[1];
      // Generated SQL carries explanatory comments before each statement;
      // sqlite_master stores only the CREATE statement itself.
      objects.set(`table:${name}`, normalizeSql(statement.slice(table.index)));
    } else if (index) {
      const name = index[2].startsWith('"') ? index[2].slice(1, -1).replaceAll('""', '"') : index[2];
      objects.set(`index:${name}`, normalizeSql(statement.slice(index.index)));
    }
  }
  return objects;
}

function sourceConstraintColumns(definition, prefix) {
  const match = String(definition).trim().match(new RegExp(`^${prefix}\\s*\\(([^)]*)\\)`, "i"));
  if (!match) return null;
  const values = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return null;
  return values.map((value) => {
    const unquoted = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('""', '"')
      : value;
    return IDENTIFIER_RE.test(unquoted) ? unquoted : null;
  });
}

function sourceForeignKey(definition) {
  const match = String(definition).trim().match(
    /^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(.*)$/is,
  );
  if (!match) return null;
  const columns = sourceConstraintColumns(`FOREIGN KEY (${match[1]})`, "FOREIGN KEY");
  const referenceColumns = match[3].split(",").map((value) => value.trim()).filter(Boolean);
  const normalizedReferenceColumns = referenceColumns.map((value) => {
    const unquoted = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('""', '"')
      : value;
    return IDENTIFIER_RE.test(unquoted) ? unquoted : null;
  });
  if (!columns || columns.some((value) => value === null) || normalizedReferenceColumns.some((value) => value === null)) return null;
  const parts = match[2].split(".");
  return {
    columns,
    referenceSchema: parts.length === 2 ? parts[0] : "public",
    referenceTable: parts.at(-1),
    referenceColumns: normalizedReferenceColumns,
    actions: match[4].trim(),
  };
}

function validateForeignKeyActions(actions) {
  const remainder = String(actions)
    .replace(/ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/gi, "")
    .trim();
  return remainder === "";
}

function expectedTargetType(codec) {
  if (!isPlainObject(codec) || typeof codec.targetType !== "string") throw fail("schema_codec_invalid");
  return codec.targetType.toUpperCase();
}

function assertCredentialTransformBoundary(catalog) {
  // Until the descriptor/codec is part of the import plan, a generic text
  // binding would copy an untransformed credential into D1. Keep this guard
  // independent of allowUnresolvedGates: that option is only for reviewed
  // external identity gates and must never authorize raw credential writes.
  const hasPasswordConfig = Array.isArray(catalog?.columns)
    && catalog.columns.some((column) => (
      column?.table_name === "fanmark_password_configs"
      && column?.column_name === "access_password"
    ));
  if (hasPasswordConfig) throw fail("credential_transform_required");
}

function buildImportPlan(catalog, convertedSchema, { allowUnresolvedGates, credentialDescriptor }) {
  const tableNames = getTableNames(catalog);
  const tableSet = new Set(tableNames);
  const columnsByTable = new Map();
  for (const table of tableNames) {
    columnsByTable.set(table, catalog.columns.filter((column) => column.table_name === table).sort((left, right) => left.ordinal - right.ordinal));
    if (table.startsWith("__fanmark_d1_import_")) throw fail("reserved_table_collision");
  }
  const codecMap = new Map(
    convertedSchema.report.target.columnCodecs.map((entry) => [`${entry.table}\0${entry.column}`, entry]),
  );
  const dependencies = new Map(tableNames.map((table) => [table, new Set()]));
  const externalGates = [];
  for (const constraint of catalog.constraints) {
    if (constraint.kind !== "f") continue;
    const parsed = sourceForeignKey(constraint.definition);
    // A malformed definition cannot be treated as an unresolved external
    // identity edge: doing so would let an internal FK bypass ordering and
    // target-schema validation merely by enabling the local gate option.
    if (!parsed) throw fail("unsupported_internal_foreign_key");
    if (parsed.referenceSchema === "auth") {
      externalGates.push({ code: "external_foreign_key", table: constraint.table_name, name: constraint.name });
      if (!allowUnresolvedGates) throw fail("external_identity_gate");
      continue;
    }
    if (parsed.referenceSchema !== "public" || !tableSet.has(parsed.referenceTable)) throw fail("unsupported_external_foreign_key");
    if (!validateForeignKeyActions(parsed.actions) || constraint.validated !== true || constraint.deferrable || constraint.initially_deferred) {
      throw fail("unsupported_internal_foreign_key");
    }
    const sourceColumns = new Set((columnsByTable.get(constraint.table_name) ?? []).map((column) => column.column_name));
    const targetColumns = new Set((columnsByTable.get(parsed.referenceTable) ?? []).map((column) => column.column_name));
    if (
      parsed.columns.length !== parsed.referenceColumns.length ||
      parsed.columns.some((column) => !sourceColumns.has(column)) ||
      parsed.referenceColumns.some((column) => !targetColumns.has(column))
    ) {
      throw fail("unsupported_internal_foreign_key");
    }
    dependencies.get(constraint.table_name)?.add(parsed.referenceTable);
  }

  const importOrder = [];
  const remaining = new Map([...dependencies].map(([table, parents]) => [table, new Set(parents)]));
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, parents]) => parents.size === 0)
      .map(([table]) => table)
      .sort(compareUtf8);
    if (ready.length === 0) throw fail("internal_foreign_key_cycle");
    for (const table of ready) {
      importOrder.push(table);
      remaining.delete(table);
      for (const parents of remaining.values()) parents.delete(table);
    }
  }

  const tables = new Map();
  for (const table of tableNames) {
    const columns = columnsByTable.get(table) ?? [];
    const primaryKey = getPrimaryKeyInfo(catalog, table);
    const codecColumns = columns.map((column) => {
      const codec = codecMap.get(`${table}\0${column.column_name}`);
      if (!codec) throw fail("schema_codec_missing");
      return {
        name: column.column_name,
        sourceType: column.postgres_type,
        targetType: expectedTargetType(codec),
        notNull: column.not_null === true,
      };
    });
    const primaryNames = primaryKey.columns.map(({ name }) => name);
    if (codecColumns.length > MAX_BINDINGS_PER_STATEMENT) throw fail("target_column_limit_exceeded");
    const isCredentialTable = table === CREDENTIAL_SOURCE_RELATION && credentialDescriptor !== undefined;
    const tablePlan = {
      table,
      columns: codecColumns,
      primaryKey,
      primaryNames,
      converter: isCredentialTable ? null : compileRowConverter(catalog, table, credentialDescriptor === undefined ? {} : { credentialDescriptor }),
      credentialProjection: isCredentialTable ? compileCredentialImportProjection({ catalog, descriptor: credentialDescriptor }) : null,
      sourceEntry: null,
    };
    // A D1 query has a 100 KB SQL-text limit. Check the generated INSERT
    // before any target-side ledger/schema operation begins.
    if (!isCredentialTable) buildInsertStatement(tablePlan);
    tables.set(table, tablePlan);
  }
  return { tableNames, tables, importOrder, externalGates };
}

function validateOptions({ maxRowsPerBatch, maxBatchBytes, maxBindingsPerBatch, scanBatchRows, maxRowBytes, maxTargetRowBytes }) {
  assertPositiveInteger(maxRowsPerBatch, "invalid_max_rows_per_batch", MAX_ROWS_PER_BATCH);
  assertPositiveInteger(maxBatchBytes, "invalid_max_batch_bytes", MAX_BATCH_BYTES);
  assertPositiveInteger(maxBindingsPerBatch, "invalid_max_bindings_per_batch", MAX_BINDINGS_PER_BATCH);
  assertPositiveInteger(scanBatchRows, "invalid_scan_batch_rows", MAX_SCAN_BATCH_ROWS);
  assertPositiveInteger(maxRowBytes, "invalid_max_row_bytes", DEFAULT_MAX_ROW_BYTES);
  assertPositiveInteger(maxTargetRowBytes, "invalid_max_target_row_bytes", MAX_TARGET_ROW_BYTES);
}

function validateDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") throw fail("invalid_d1_binding");
}

function validateIdentity(value, code) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw fail(code);
  return value;
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw fail("invalid_clock");
  return date.toISOString();
}

function safeErrorCode(error) {
  const code = error instanceof D1ImportError ? error.code : error?.code;
  return typeof code === "string" && /^[a-z0-9_]+$/.test(code) ? code : "d1_import_failed";
}

function reportPathFor(manifestPath, reportPath) {
  if (typeof reportPath !== "string" || reportPath.trim() === "") throw fail("missing_report_path");
  const absolute = path.resolve(reportPath);
  const snapshotDir = path.dirname(path.resolve(manifestPath));
  if (path.dirname(absolute) === snapshotDir || path.basename(absolute) === SNAPSHOT_MANIFEST_FILE || path.basename(absolute) === SNAPSHOT_STATUS_FILE) {
    throw fail("report_must_be_outside_snapshot");
  }
  return absolute;
}

async function ensurePrivateReportParent(reportPath) {
  const directory = path.dirname(reportPath);
  const stat = await fs.lstat(directory).catch((error) => {
    throw fail("report_parent_unavailable", error);
  });
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) throw fail("report_parent_not_private");
}

async function writeReport(reportPath, report) {
  await ensurePrivateReportParent(reportPath);
  const temporary = `${reportPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  let handle = null;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, reportPath);
    await fs.chmod(reportPath, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function persistReport(reportPath, report, hooks) {
  await hooks?.beforeReportWrite?.({ reportPath, report });
  await writeReport(reportPath, report);
}

async function readReport(reportPath) {
  const stat = await fs.lstat(reportPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw fail("report_unreadable", error);
  });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_REPORT_BYTES) throw fail("report_unreadable");
  try {
    const value = JSON.parse(await fs.readFile(reportPath, "utf8"));
    if (!isPlainObject(value)) throw fail("report_unreadable");
    return value;
  } catch (error) {
    if (error instanceof D1ImportError) throw error;
    throw fail("report_unreadable", error);
  }
}

async function readJson(filePath, code) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw fail(code, error);
  }
}

async function loadVerifiedSnapshot(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  let verification;
  try {
    verification = await verifySnapshot(absoluteManifestPath);
  } catch (error) {
    const code = error instanceof SnapshotVerificationError ? error.code : "snapshot_not_verified";
    throw fail(`snapshot_${code}`, error);
  }
  const outputDir = path.dirname(absoluteManifestPath);
  const manifestBytes = await fs.readFile(absoluteManifestPath).catch((error) => {
    throw fail("manifest_unreadable", error);
  });
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const catalog = await readJson(path.join(outputDir, SNAPSHOT_CATALOG_FILE), "catalog_unreadable");
  const schemaReport = await readJson(path.join(outputDir, SNAPSHOT_SCHEMA_REPORT_FILE), "schema_report_unreadable");
  const convertedSchema = (() => {
    try {
      const credentialDescriptor = manifest.credentialDescriptor ?? undefined;
      return convertSchema(catalog, credentialDescriptor === undefined ? {} : { credentialDescriptor });
    } catch (error) {
      throw fail("schema_conversion_invalid", error);
    }
  })();
  const catalogHash = catalogFingerprint(catalog);
  const schemaReportHash = schemaReportFingerprint(schemaReport);
  if (catalogHash !== manifest.catalogFingerprint || schemaReportHash !== manifest.schemaReportFingerprint) throw fail("snapshot_identity_mismatch");
  if (schemaReportFingerprint(convertedSchema.report) !== manifest.schemaReportFingerprint) throw fail("schema_report_identity_mismatch");
  if (manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION || manifest.rowEnvelopeVersion !== ROW_ENVELOPE_VERSION) throw fail("snapshot_version_unsupported");
  const schemaDigest = sha256Hex(convertedSchema.sql);
  const tablesByName = new Map(manifest.tables.map((entry) => [entry.table, entry]));
  return {
    outputDir,
    manifestPath: absoluteManifestPath,
    manifest,
    catalog,
    schemaReport,
    convertedSchema,
    verification,
    manifestDigest: createHash("sha256").update(manifestBytes).digest("hex"),
    catalogFingerprint: catalogHash,
    schemaReportFingerprint: schemaReportHash,
    schemaDigest,
    tablesByName,
  };
}

function resultRows(result, code = "d1_result_invalid") {
  if (!isPlainObject(result) || result.success !== true || !Array.isArray(result.results)) throw fail(code);
  return result.results;
}

async function allRows(database, sql, bindings = []) {
  let result;
  try {
    result = await database.prepare(sql).bind(...bindings).all();
  } catch (error) {
    throw fail("d1_read_failed", error);
  }
  return resultRows(result);
}

async function oneRow(database, sql, bindings = [], code = "d1_read_failed") {
  const rows = await allRows(database, sql, bindings);
  if (rows.length !== 1) throw fail(code);
  return rows[0];
}

async function runStatement(database, sql, bindings = []) {
  try {
    const result = await database.prepare(sql).bind(...bindings).run();
    if (!isPlainObject(result) || result.success !== true) throw fail("d1_write_failed");
    return result;
  } catch (error) {
    if (error instanceof D1ImportError) throw error;
    throw fail("d1_write_failed", error);
  }
}

async function runBatch(database, statements) {
  let results;
  try {
    results = await database.batch(statements);
  } catch (error) {
    throw fail("d1_batch_failed", error);
  }
  if (!Array.isArray(results) || results.some((result) => !isPlainObject(result) || result.success !== true)) throw fail("d1_batch_failed");
  return results;
}

function ledgerSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(LEDGER_TABLES.runs)} (
      run_id TEXT PRIMARY KEY NOT NULL,
      destination_id TEXT NOT NULL,
      target_incarnation TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      credential_descriptor_digest TEXT CHECK (credential_descriptor_digest IS NULL OR (length(credential_descriptor_digest) = 64 AND credential_descriptor_digest NOT GLOB '*[^0-9a-f]*')),
      catalog_fingerprint TEXT NOT NULL,
      schema_report_fingerprint TEXT NOT NULL,
      schema_digest TEXT NOT NULL,
      codec_version INTEGER NOT NULL,
      table_count INTEGER NOT NULL,
      completed_tables INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'failed', 'public_rows_reconciled')),
      deployable INTEGER NOT NULL CHECK (deployable IN (0, 1)),
      full_migration_reconciled INTEGER NOT NULL CHECK (full_migration_reconciled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error_code TEXT,
      UNIQUE (destination_id, target_incarnation)
    )`,
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(LEDGER_TABLES.checkpoints)} (
      run_id TEXT NOT NULL REFERENCES ${quoteIdentifier(LEDGER_TABLES.runs)} (run_id),
      table_name TEXT NOT NULL,
      destination_id TEXT NOT NULL,
      target_incarnation TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      credential_descriptor_digest TEXT CHECK (credential_descriptor_digest IS NULL OR (length(credential_descriptor_digest) = 64 AND credential_descriptor_digest NOT GLOB '*[^0-9a-f]*')),
      generation INTEGER NOT NULL CHECK (generation >= 0),
      next_ordinal INTEGER NOT NULL CHECK (next_ordinal >= 0),
      last_pk_json TEXT,
      prefix_digest TEXT NOT NULL,
      rows_imported INTEGER NOT NULL CHECK (rows_imported >= 0),
      bytes_imported INTEGER NOT NULL CHECK (bytes_imported >= 0),
      last_chunk_start INTEGER NOT NULL CHECK (last_chunk_start >= 0),
      last_chunk_end INTEGER NOT NULL CHECK (last_chunk_end >= 0),
      last_chunk_digest TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'complete')),
      PRIMARY KEY (run_id, table_name),
      UNIQUE (run_id, destination_id, target_incarnation, table_name)
    )`,
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(LEDGER_TABLES.guards)} (
      token TEXT PRIMARY KEY NOT NULL,
      must_be_one INTEGER NOT NULL CHECK (must_be_one = 1)
    )`,
  ];
}

async function ensureLedgerSchema(database) {
  const schemaStatements = ledgerSchemaStatements();
  await runBatch(database, schemaStatements.map((sql) => database.prepare(sql)));
  const expected = {
    [LEDGER_TABLES.runs]: ["run_id", "destination_id", "target_incarnation", "manifest_digest", "credential_descriptor_digest", "catalog_fingerprint", "schema_report_fingerprint", "schema_digest", "codec_version", "table_count", "completed_tables", "status", "deployable", "full_migration_reconciled", "created_at", "updated_at", "last_error_code"],
    [LEDGER_TABLES.checkpoints]: ["run_id", "table_name", "destination_id", "target_incarnation", "manifest_digest", "credential_descriptor_digest", "generation", "next_ordinal", "last_pk_json", "prefix_digest", "rows_imported", "bytes_imported", "last_chunk_start", "last_chunk_end", "last_chunk_digest", "status"],
    [LEDGER_TABLES.guards]: ["token", "must_be_one"],
  };
  for (const [table, names] of Object.entries(expected)) {
    const rows = await allRows(database, `PRAGMA table_info(${quoteIdentifier(table)})`);
    const actual = rows.map((row) => row.name);
    if (JSON.stringify(actual) !== JSON.stringify(names)) throw fail("ledger_schema_mismatch");
  }
  const expectedObjects = new Map();
  for (const sql of schemaStatements) {
    const match = sql.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/i);
    if (!match) throw fail("ledger_schema_definition_invalid");
    const name = match[1].startsWith('"') ? match[1].slice(1, -1).replaceAll('""', '"') : match[1];
    expectedObjects.set(`table:${name}`, normalizeSql(sql.replace(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i, "CREATE TABLE")));
  }
  const actualRows = await allRows(database, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND type IN ('table', 'index', 'view', 'trigger')");
  const actualObjects = new Map();
  for (const row of actualRows) {
    if (typeof row.name !== "string" || typeof row.type !== "string" || typeof row.sql !== "string") throw fail("ledger_schema_metadata_invalid");
    if (Object.values(LEDGER_TABLES).includes(row.name) || Object.values(LEDGER_TABLES).includes(row.tbl_name)) actualObjects.set(`${row.type}:${row.name}`, normalizeSql(row.sql));
  }
  const expectedKeys = [...expectedObjects.keys()].sort(compareUtf8);
  const actualKeys = [...actualObjects.keys()].sort(compareUtf8);
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) throw fail("ledger_schema_definition_mismatch");
  for (const key of expectedKeys) if (actualObjects.get(key) !== expectedObjects.get(key)) throw fail("ledger_schema_definition_mismatch");
}

async function getRun(database, destinationId, targetIncarnation) {
  const rows = await allRows(
    database,
    `SELECT run_id, destination_id, target_incarnation, manifest_digest, credential_descriptor_digest, catalog_fingerprint, schema_report_fingerprint, schema_digest, codec_version, table_count, completed_tables, status, deployable, full_migration_reconciled, created_at, updated_at, last_error_code
       FROM ${quoteIdentifier(LEDGER_TABLES.runs)}
      WHERE destination_id = ? AND target_incarnation = ?
      LIMIT 2`,
    [destinationId, targetIncarnation],
  );
  if (rows.length > 1) throw fail("ledger_run_ambiguous");
  return rows[0] ?? null;
}

async function ensureRun(database, snapshot, { destinationId, targetIncarnation, mode, now }) {
  const existing = await getRun(database, destinationId, targetIncarnation);
  if (existing) {
    if (
      existing.run_id !== snapshot.manifest.runId ||
      existing.manifest_digest !== snapshot.manifestDigest ||
      existing.credential_descriptor_digest !== snapshot.manifest.credentialDescriptorDigest ||
      existing.catalog_fingerprint !== snapshot.catalogFingerprint ||
      existing.schema_report_fingerprint !== snapshot.schemaReportFingerprint ||
      existing.schema_digest !== snapshot.schemaDigest ||
      existing.codec_version !== D1_IMPORT_CODEC_VERSION ||
      existing.table_count !== snapshot.manifest.tableCount ||
      existing.destination_id !== destinationId ||
      existing.target_incarnation !== targetIncarnation
    ) throw fail("destination_run_identity_mismatch");
    return existing;
  }
  const sameDestination = await allRows(
    database,
    `SELECT run_id, target_incarnation FROM ${quoteIdentifier(LEDGER_TABLES.runs)} WHERE destination_id = ? LIMIT 2`,
    [destinationId],
  );
  if (sameDestination.length > 0) throw fail("destination_already_bound");
  const timestamp = nowIso(now);
  try {
    await runStatement(
      database,
      `INSERT INTO ${quoteIdentifier(LEDGER_TABLES.runs)} (run_id, destination_id, target_incarnation, manifest_digest, credential_descriptor_digest, catalog_fingerprint, schema_report_fingerprint, schema_digest, codec_version, table_count, completed_tables, status, deployable, full_migration_reconciled, created_at, updated_at, last_error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'in_progress', ?, 0, ?, ?, NULL)`,
      [
        snapshot.manifest.runId,
        destinationId,
        targetIncarnation,
        snapshot.manifestDigest,
        snapshot.manifest.credentialDescriptorDigest,
        snapshot.catalogFingerprint,
        snapshot.schemaReportFingerprint,
        snapshot.schemaDigest,
        D1_IMPORT_CODEC_VERSION,
        snapshot.manifest.tableCount,
        // This slice is local rehearsal only. A source schema with no
        // converter gates is still not a production/deployability claim.
        0,
        timestamp,
        timestamp,
      ],
    );
  } catch (error) {
    if (error instanceof D1ImportError) {
      const raced = await getRun(database, destinationId, targetIncarnation).catch(() => null);
      if (raced) return ensureRun(database, snapshot, { destinationId, targetIncarnation, mode, now });
    }
    throw error;
  }
  return getRun(database, destinationId, targetIncarnation);
}

async function getCheckpoint(database, runId, tableName) {
  const rows = await allRows(
    database,
    `SELECT run_id, table_name, destination_id, target_incarnation, manifest_digest, credential_descriptor_digest, generation, next_ordinal, last_pk_json, prefix_digest, rows_imported, bytes_imported, last_chunk_start, last_chunk_end, last_chunk_digest, status
       FROM ${quoteIdentifier(LEDGER_TABLES.checkpoints)}
      WHERE run_id = ? AND table_name = ?
      LIMIT 2`,
    [runId, tableName],
  );
  if (rows.length > 1) throw fail("checkpoint_ambiguous");
  return rows[0] ?? null;
}

async function ensureCheckpoint(database, snapshot, tableName, { destinationId, targetIncarnation }) {
  const existing = await getCheckpoint(database, snapshot.manifest.runId, tableName);
  if (existing) {
    if (
      existing.destination_id !== destinationId ||
      existing.target_incarnation !== targetIncarnation ||
      existing.manifest_digest !== snapshot.manifestDigest ||
      existing.credential_descriptor_digest !== snapshot.manifest.credentialDescriptorDigest
    ) throw fail("checkpoint_identity_mismatch");
    return existing;
  }
  try {
    await runStatement(
      database,
      `INSERT INTO ${quoteIdentifier(LEDGER_TABLES.checkpoints)} (run_id, table_name, destination_id, target_incarnation, manifest_digest, credential_descriptor_digest, generation, next_ordinal, last_pk_json, prefix_digest, rows_imported, bytes_imported, last_chunk_start, last_chunk_end, last_chunk_digest, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, 0, 0, 0, 0, ?, 'in_progress')`,
      [snapshot.manifest.runId, tableName, destinationId, targetIncarnation, snapshot.manifestDigest, snapshot.manifest.credentialDescriptorDigest, ZERO_DIGEST, ZERO_DIGEST],
    );
  } catch (error) {
    if (!(error instanceof D1ImportError)) throw error;
  }
  const checkpoint = await getCheckpoint(database, snapshot.manifest.runId, tableName);
  if (!checkpoint) throw fail("checkpoint_unavailable");
  if (
    checkpoint.destination_id !== destinationId ||
    checkpoint.target_incarnation !== targetIncarnation ||
    checkpoint.manifest_digest !== snapshot.manifestDigest ||
    checkpoint.credential_descriptor_digest !== snapshot.manifest.credentialDescriptorDigest
  ) throw fail("checkpoint_identity_mismatch");
  return checkpoint;
}

function validateCheckpoint(checkpoint, expectedRowCount) {
  if (!checkpoint || !Number.isSafeInteger(checkpoint.generation) || checkpoint.generation < 0 || !Number.isSafeInteger(checkpoint.next_ordinal) || checkpoint.next_ordinal < 0 || checkpoint.next_ordinal > expectedRowCount || !Number.isSafeInteger(checkpoint.rows_imported) || checkpoint.rows_imported !== checkpoint.next_ordinal || !Number.isSafeInteger(checkpoint.bytes_imported) || checkpoint.bytes_imported < 0 || !HEX64_RE.test(checkpoint.prefix_digest) || !HEX64_RE.test(checkpoint.last_chunk_digest) || !["in_progress", "complete"].includes(checkpoint.status)) throw fail("checkpoint_invalid");
  if (checkpoint.status === "complete" && checkpoint.next_ordinal !== expectedRowCount) throw fail("checkpoint_invalid");
  if (checkpoint.next_ordinal === 0 && checkpoint.last_pk_json !== null) throw fail("checkpoint_invalid");
  if (checkpoint.next_ordinal > 0 && typeof checkpoint.last_pk_json !== "string") throw fail("checkpoint_invalid");
}

function convertedRowHash(table, ordinal, record, converted) {
  const identity = {
    table,
    ordinal,
    primaryKey: record.primaryKey,
    columns: converted.columns,
    bindings: converted.bindings,
  };
  if (converted.credentialProjection) {
    identity.sourceCredentialDigest = converted.credentialProjection.sourceEnvelopeDigest;
    identity.credentialDescriptorDigest = converted.credentialProjection.credentialDescriptorDigest;
  }
  return sha256Hex(identity);
}

function nextPrefixDigest(previous, rowHash) {
  return sha256Hex(`${previous}\0${rowHash}`);
}

function validateSourceRecord(record, line, tablePlan, ordinal) {
  if (!isPlainObject(record)) throw fail("source_row_record_invalid");
  const expectedKeys = ["recordVersion", "ordinal", "primaryKey", "rowHash", "envelope"].sort();
  const actualKeys = Object.keys(record).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) || record.recordVersion !== 1 || record.ordinal !== ordinal || !Array.isArray(record.primaryKey) || !HEX64_RE.test(record.rowHash)) throw fail("source_row_record_invalid");
  let converted;
  try {
    let credentialProjection = null;
    if (tablePlan.credentialProjection) {
      credentialProjection = tablePlan.credentialProjection(line);
      converted = {
        table: credentialProjection.table,
        schemaVersion: ROW_ENVELOPE_VERSION,
        columns: credentialProjection.columns,
        bindings: credentialProjection.bindings,
        credentialProjection,
      };
    } else {
      converted = tablePlan.converter(record.envelope);
    }
    const expectedRecord = rowRecordForEnvelope(record.envelope, tablePlan.primaryKey, ordinal);
    if (record.rowHash !== expectedRecord.rowHash || JSON.stringify(record.primaryKey) !== JSON.stringify(expectedRecord.primaryKey)) throw fail("source_row_record_identity_mismatch");
    if (canonicalJson(record) !== line) throw fail("source_row_record_not_canonical");
  } catch (error) {
    if (error instanceof D1ImportError) throw error;
    throw fail("source_row_conversion_invalid", error);
  }
  if (converted.table !== tablePlan.table || converted.schemaVersion !== ROW_ENVELOPE_VERSION) throw fail("source_row_conversion_identity_mismatch");
  return { record, converted, rowHash: convertedRowHash(tablePlan.table, ordinal, record, converted) };
}

async function readTableRecords({ filePath, entry, tablePlan, maxRowBytes, onRecord }) {
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let byteCount = 0;
  let ordinal = 0;
  const processLine = async (line) => {
    if (line.length === 0 || Buffer.byteLength(line, "utf8") > Math.min(maxRowBytes, MAX_LINE_BYTES)) throw fail("source_row_record_too_large");
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw fail("source_row_record_invalid", error);
    }
    const prepared = validateSourceRecord(record, line, tablePlan, ordinal);
    await onRecord({ ...prepared, lineBytes: Buffer.byteLength(`${line}\n`, "utf8"), ordinal });
    ordinal += 1;
  };
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      byteCount += chunk.byteLength;
      pending += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        await processLine(line);
      }
      if (Buffer.byteLength(pending, "utf8") > Math.min(maxRowBytes, MAX_LINE_BYTES)) throw fail("source_row_record_too_large");
    }
    pending += decoder.decode();
  } catch (error) {
    stream.destroy();
    if (error instanceof D1ImportError) throw error;
    throw fail("source_stream_read_failed", error);
  }
  if (pending.length !== 0) throw fail("source_missing_terminal_newline");
  const streamHash = hash.digest("hex");
  if (streamHash !== entry.streamHash || String(byteCount) !== entry.byteCount || String(ordinal) !== entry.rowCount) throw fail("source_stream_identity_mismatch");
  return { rowCount: ordinal, byteCount, streamHash };
}

function bindingValueType(value) {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
  if (typeof value === "string") return "text";
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return "blob";
  return typeof value;
}

function assertBindingEquals(actual, expected) {
  if (actual === null || expected === null) {
    if (actual !== expected) throw fail("target_value_mismatch");
    return;
  }
  if (bindingValueType(actual) !== bindingValueType(expected) || !Object.is(actual, expected)) throw fail("target_value_mismatch");
}

function expectedSqliteStorageType(targetType) {
  if (targetType === "INTEGER") return "integer";
  if (targetType === "TEXT") return "text";
  if (targetType === "BLOB") return "blob";
  throw fail("schema_codec_invalid");
}

function assertTargetStorageType(row, column, index) {
  const typeAlias = `__d1_storage_type_${index}`;
  const actualType = row[typeAlias];
  const expectedType = row[column.name] === null ? "null" : expectedSqliteStorageType(column.targetType);
  if (actualType !== expectedType) throw fail("target_storage_type_mismatch");
}

function encodedValueBytes(value) {
  if (value === null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (typeof value === "number") return Buffer.byteLength(String(value), "utf8");
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value.byteLength;
  throw fail("target_value_type_invalid");
}

function targetRowEncodedBytes(tablePlan, row) {
  return tablePlan.columns.reduce((total, column) => total + encodedValueBytes(row[column.name]), 0);
}

function assertTargetRowBytes(tablePlan, row, maximum) {
  if (targetRowEncodedBytes(tablePlan, row) > maximum) throw fail("target_row_size_exceeded");
}

function columnBindingMap(tablePlan, converted) {
  return new Map(tablePlan.columns.map((column, index) => [column.name, converted.bindings[index]]));
}

async function readTargetRow(database, tablePlan, converted) {
  const columns = tablePlan.columns
    .map((column, index) => `${quoteIdentifier(column.name)}, typeof(${quoteIdentifier(column.name)}) AS ${quoteIdentifier(`__d1_storage_type_${index}`)}`)
    .join(", ");
  const predicates = tablePlan.primaryNames.map((name) => `${quoteIdentifier(name)} = ?`).join(" AND ");
  const bindings = tablePlan.primaryNames.map((name) => columnBindingMap(tablePlan, converted).get(name));
  const row = await oneRow(
    database,
    `SELECT ${columns} FROM ${quoteIdentifier(tablePlan.table)} WHERE ${predicates} LIMIT 2`,
    bindings,
    "target_row_missing_or_duplicate",
  );
  const expected = columnBindingMap(tablePlan, converted);
  for (const [index, column] of tablePlan.columns.entries()) {
    if (!Object.hasOwn(row, column.name)) throw fail("target_column_missing");
    assertTargetStorageType(row, column, index);
    assertBindingEquals(row[column.name], expected.get(column.name));
  }
  return row;
}

function buildInsertStatement(tablePlan) {
  const columns = tablePlan.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const placeholders = tablePlan.columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(tablePlan.table)} (${columns}) VALUES (${placeholders})`;
  if (Buffer.byteLength(sql, "utf8") > MAX_SQL_STATEMENT_BYTES) throw fail("insert_sql_too_large");
  return sql;
}

function guardStatement({ runId, tableName, generation, nextOrdinal, token }) {
  return {
    sql: `INSERT INTO ${quoteIdentifier(LEDGER_TABLES.guards)} (token, must_be_one)
          SELECT ?, CASE WHEN EXISTS (
            SELECT 1 FROM ${quoteIdentifier(LEDGER_TABLES.checkpoints)}
             WHERE run_id = ? AND table_name = ? AND generation = ? AND next_ordinal = ? AND status = 'in_progress'
          ) THEN 1 ELSE 0 END`,
    bindings: [token, runId, tableName, generation, nextOrdinal],
  };
}

function checkpointUpdateStatement({ runId, tableName, generation, expectedNextOrdinal, nextOrdinal, nextGeneration, nextStatus, lastPkJson, prefixDigest, rowsImported, bytesImported, chunkStart, chunkEnd, chunkDigest }) {
  return {
    sql: `UPDATE ${quoteIdentifier(LEDGER_TABLES.checkpoints)}
             SET generation = ?, next_ordinal = ?, last_pk_json = ?, prefix_digest = ?, rows_imported = ?, bytes_imported = ?, last_chunk_start = ?, last_chunk_end = ?, last_chunk_digest = ?, status = ?
           WHERE run_id = ? AND table_name = ? AND generation = ? AND next_ordinal = ? AND status = 'in_progress'`,
    bindings: [nextGeneration, nextOrdinal, lastPkJson, prefixDigest, rowsImported, bytesImported, chunkStart, chunkEnd, chunkDigest, nextStatus, runId, tableName, generation, expectedNextOrdinal],
  };
}

async function commitChunk(database, snapshot, tablePlan, checkpoint, rows, { destinationId, targetIncarnation, hooks }) {
  const token = randomBytes(12).toString("hex");
  const chunkStart = checkpoint.next_ordinal;
  const chunkEnd = chunkStart + rows.length;
  const rowHashes = rows.map((row) => row.rowHash);
  const chunkDigest = sha256Hex({ table: tablePlan.table, startOrdinal: chunkStart, endOrdinal: chunkEnd, rowHashes });
  let prefixDigest = checkpoint.prefix_digest;
  for (const row of rows) prefixDigest = nextPrefixDigest(prefixDigest, row.rowHash);
  const last = rows.at(-1);
  const statements = [];
  const guard = guardStatement({ runId: snapshot.manifest.runId, tableName: tablePlan.table, generation: checkpoint.generation, nextOrdinal: checkpoint.next_ordinal, token });
  statements.push(database.prepare(guard.sql).bind(...guard.bindings));
  const insertSql = buildInsertStatement(tablePlan);
  for (const row of rows) statements.push(database.prepare(insertSql).bind(...row.converted.bindings));
  const checkpointUpdate = checkpointUpdateStatement({
    runId: snapshot.manifest.runId,
    tableName: tablePlan.table,
    generation: checkpoint.generation,
    expectedNextOrdinal: checkpoint.next_ordinal,
    nextOrdinal: chunkEnd,
    nextGeneration: checkpoint.generation + 1,
    nextStatus: "in_progress",
    lastPkJson: JSON.stringify(last.record.primaryKey),
    prefixDigest,
    rowsImported: chunkEnd,
    bytesImported: checkpoint.bytes_imported + rows.reduce((total, row) => total + row.lineBytes, 0),
    chunkStart,
    chunkEnd,
    chunkDigest,
  });
  statements.push(database.prepare(checkpointUpdate.sql).bind(...checkpointUpdate.bindings));
  statements.push(database.prepare(`DELETE FROM ${quoteIdentifier(LEDGER_TABLES.guards)} WHERE token = ?`).bind(token));
  await hooks?.beforeChunkCommit?.({ table: tablePlan.table, generation: checkpoint.generation, nextOrdinal: checkpoint.next_ordinal, rowCount: rows.length });
  await runBatch(database, statements);
  return {
    generation: checkpoint.generation + 1,
    next_ordinal: chunkEnd,
    last_pk_json: JSON.stringify(last.record.primaryKey),
    prefix_digest: prefixDigest,
    rows_imported: chunkEnd,
    bytes_imported: checkpoint.bytes_imported + rows.reduce((total, row) => total + row.lineBytes, 0),
    last_chunk_start: chunkStart,
    last_chunk_end: chunkEnd,
    last_chunk_digest: chunkDigest,
    status: "in_progress",
    destination_id: destinationId,
    target_incarnation: targetIncarnation,
    manifest_digest: snapshot.manifestDigest,
    run_id: snapshot.manifest.runId,
    table_name: tablePlan.table,
  };
}

async function completeTable(database, snapshot, tablePlan, checkpoint, { hooks }) {
  const token = randomBytes(12).toString("hex");
  const guard = guardStatement({ runId: snapshot.manifest.runId, tableName: tablePlan.table, generation: checkpoint.generation, nextOrdinal: checkpoint.next_ordinal, token });
  const update = checkpointUpdateStatement({
    runId: snapshot.manifest.runId,
    tableName: tablePlan.table,
    generation: checkpoint.generation,
    expectedNextOrdinal: checkpoint.next_ordinal,
    nextOrdinal: checkpoint.next_ordinal,
    nextGeneration: checkpoint.generation + 1,
    nextStatus: "complete",
    lastPkJson: checkpoint.last_pk_json,
    prefixDigest: checkpoint.prefix_digest,
    rowsImported: checkpoint.rows_imported,
    bytesImported: checkpoint.bytes_imported,
    chunkStart: checkpoint.last_chunk_start,
    chunkEnd: checkpoint.last_chunk_end,
    chunkDigest: checkpoint.last_chunk_digest,
  });
  await hooks?.beforeTableComplete?.({ table: tablePlan.table, generation: checkpoint.generation, nextOrdinal: checkpoint.next_ordinal });
  await runBatch(database, [
    database.prepare(guard.sql).bind(...guard.bindings),
    database.prepare(update.sql).bind(...update.bindings),
    database.prepare(`DELETE FROM ${quoteIdentifier(LEDGER_TABLES.guards)} WHERE token = ?`).bind(token),
  ]);
  return { ...checkpoint, generation: checkpoint.generation + 1, status: "complete" };
}

function expectedScanExpression(column) {
  return `CAST(${quoteIdentifier(column.name)} AS TEXT) COLLATE BINARY`;
}

function keysetPredicate(tablePlan, cursor) {
  if (!cursor) return { sql: "", bindings: [] };
  const expressions = tablePlan.primaryNames.map((name) => expectedScanExpression(tablePlan.columns.find((column) => column.name === name)));
  const terms = [];
  const bindings = [];
  for (let index = 0; index < expressions.length; index += 1) {
    const equal = expressions.slice(0, index).map((expression) => `${expression} = ?`).join(" AND ");
    if (equal) {
      terms.push(`(${equal} AND ${expressions[index]} > ?)`);
      bindings.push(...cursor.slice(0, index), cursor[index]);
    } else {
      terms.push(`(${expressions[index]} > ?)`);
      bindings.push(cursor[index]);
    }
  }
  return { sql: `WHERE ${terms.join(" OR ")}`, bindings };
}

async function* scanTargetRows(database, tablePlan, batchRows) {
  let cursor = null;
  while (true) {
    const predicate = keysetPredicate(tablePlan, cursor);
    const columns = tablePlan.columns
      .map((column, index) => `${quoteIdentifier(column.name)}, typeof(${quoteIdentifier(column.name)}) AS ${quoteIdentifier(`__d1_storage_type_${index}`)}`)
      .join(", ");
    const order = tablePlan.primaryNames.map((name) => expectedScanExpression(tablePlan.columns.find((column) => column.name === name))).join(", ");
    const rows = await allRows(
      database,
      `SELECT ${columns} FROM ${quoteIdentifier(tablePlan.table)} ${predicate.sql} ORDER BY ${order} LIMIT ${batchRows}`,
      predicate.bindings,
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      const nextCursor = tablePlan.primaryNames.map((name) => String(row[name]));
      cursor = nextCursor;
      yield row;
    }
    if (rows.length < batchRows) return;
  }
}

async function reconcileCredentialTable(database, snapshot, tablePlan, entry, options) {
  const sourceIterator = readSourceIterator({
    filePath: path.join(snapshot.outputDir, entry.file),
    entry,
    tablePlan,
    maxRowBytes: options.maxRowBytes,
  })[Symbol.asyncIterator]();
  try {
    let sourceNext = await sourceIterator.next();
    let targetCount = 0;
    const targetHash = createHash("sha256");
    for await (const targetRow of scanTargetRows(database, tablePlan, options.scanBatchRows)) {
      if (sourceNext.done) throw fail("target_extra_rows");
      const sourceRow = sourceNext.value;
      const targetPk = tablePlan.primaryNames.map((name) => String(targetRow[name]));
      if (JSON.stringify(targetPk) !== JSON.stringify(sourceRow.record.primaryKey)) throw fail("target_primary_key_mismatch");
      const validated = await readAndValidateCredentialRow(
        database,
        snapshot,
        tablePlan,
        sourceRow.converted.credentialProjection,
        options,
      );
      for (const column of tablePlan.columns) {
        if (!Object.hasOwn(targetRow, column.name) || targetRow[column.name] !== validated.target[column.name]) {
          throw fail("credential_target_scan_readback_mismatch");
        }
      }
      assertTargetRowBytes(tablePlan, targetRow, options.maxTargetRowBytes);
      targetHash.update(canonicalJson({
        table: tablePlan.table,
        ordinal: sourceRow.ordinal,
        values: tablePlan.columns.map((column) => targetRow[column.name]),
      }));
      targetHash.update("\n");
      targetCount += 1;
      sourceNext = await sourceIterator.next();
    }
    if (!sourceNext.done) throw fail("target_missing_rows");
    const sourceStats = sourceNext.value;
    if (
      sourceStats.rowCount !== targetCount ||
      sourceStats.rowCount !== Number(entry.rowCount) ||
      String(sourceStats.byteCount) !== entry.byteCount ||
      sourceStats.streamHash !== entry.streamHash
    ) throw fail("reconciliation_count_or_digest_mismatch");
    return {
      rowCount: targetCount,
      byteCount: sourceStats.byteCount,
      targetHash: targetHash.digest("hex"),
      sourceStreamHash: sourceStats.streamHash,
    };
  } finally {
    if (typeof sourceIterator.return === "function") await Promise.resolve(sourceIterator.return()).catch(() => {});
  }
}

async function reconcileTable(database, snapshot, tablePlan, entry, { maxRowBytes, scanBatchRows, maxTargetRowBytes, destinationId, targetIncarnation, expectedTargetProfile, now }) {
  if (tablePlan.credentialProjection) {
    return reconcileCredentialTable(database, snapshot, tablePlan, entry, {
      maxRowBytes,
      scanBatchRows,
      maxTargetRowBytes,
      destinationId,
      targetIncarnation,
      expectedTargetProfile,
      now,
    });
  }
  const sourceIterator = readSourceIterator({ filePath: path.join(snapshot.outputDir, entry.file), entry, tablePlan, maxRowBytes })[Symbol.asyncIterator]();
  try {
    let sourceNext = await sourceIterator.next();
    let targetCount = 0;
    const targetHash = createHash("sha256");
    for await (const targetRow of scanTargetRows(database, tablePlan, scanBatchRows)) {
      if (sourceNext.done) throw fail("target_extra_rows");
      const sourceRow = sourceNext.value;
      const expected = columnBindingMap(tablePlan, sourceRow.converted);
      for (const [index, column] of tablePlan.columns.entries()) {
        if (!Object.hasOwn(targetRow, column.name)) throw fail("target_column_missing");
        assertTargetStorageType(targetRow, column, index);
        assertBindingEquals(targetRow[column.name], expected.get(column.name));
      }
      assertTargetRowBytes(tablePlan, targetRow, maxTargetRowBytes);
      const targetPk = tablePlan.primaryNames.map((name) => String(targetRow[name]));
      if (JSON.stringify(targetPk) !== JSON.stringify(sourceRow.record.primaryKey)) throw fail("target_primary_key_mismatch");
      targetHash.update(canonicalJson({ table: tablePlan.table, ordinal: sourceRow.ordinal, values: tablePlan.columns.map((column) => targetRow[column.name]) }));
      targetHash.update("\n");
      targetCount += 1;
      sourceNext = await sourceIterator.next();
    }
    if (!sourceNext.done) throw fail("target_missing_rows");
    const sourceStats = sourceNext.value;
    if (sourceStats.rowCount !== targetCount || sourceStats.rowCount !== Number(entry.rowCount) || String(sourceStats.byteCount) !== entry.byteCount || sourceStats.streamHash !== entry.streamHash) throw fail("reconciliation_count_or_digest_mismatch");
    return { rowCount: targetCount, byteCount: sourceStats.byteCount, targetHash: targetHash.digest("hex"), sourceStreamHash: sourceStats.streamHash };
  } finally {
    if (typeof sourceIterator.return === "function") await Promise.resolve(sourceIterator.return()).catch(() => {});
  }
}

function canonicalInt64(value, code) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) throw fail(code);
  let parsed;
  try {
    parsed = BigInt(value);
  } catch (error) {
    throw fail(code, error);
  }
  if (parsed.toString() !== value || parsed < -9_223_372_036_854_775_808n || parsed > 9_223_372_036_854_775_807n) throw fail(code);
  return parsed;
}

async function applySequenceStates(database, snapshot) {
  let states;
  try {
    states = validateSequenceStates(snapshot.catalog, snapshot.manifest.sequenceStates);
  } catch (error) {
    throw fail("sequence_state_manifest_invalid", error);
  }
  const applied = [];
  for (const state of states) {
    if (state.schema !== SUPPORTED_SEQUENCE_TARGET.schema || state.name !== SUPPORTED_SEQUENCE_TARGET.name) throw fail("sequence_target_unsupported");
    const lastValue = canonicalInt64(state.lastValue, "sequence_state_value_invalid");
    const sourceWatermark = state.isCalled ? lastValue : BigInt(state.startValue) - BigInt(state.incrementBy);
    const table = await oneRow(
      database,
      `SELECT CAST(COALESCE(MAX(${quoteIdentifier(state.ownerColumn)}), 0) AS TEXT) AS "maxId" FROM ${quoteIdentifier(state.ownerTable)}`,
      [],
      "sequence_target_readback_invalid",
    );
    const tableMax = canonicalInt64(table.maxId, "sequence_target_readback_invalid");
    const previousRows = await allRows(
      database,
      `SELECT CAST("seq" AS TEXT) AS "seq" FROM "sqlite_sequence" WHERE "name" = ?`,
      [state.ownerTable],
    );
    if (previousRows.length > 1) throw fail("sequence_target_duplicate_state");
    const previous = previousRows.length === 0 ? 0n : canonicalInt64(previousRows[0].seq, "sequence_target_readback_invalid");
    const targetWatermark = [sourceWatermark, tableMax, previous].reduce((maximum, value) => value > maximum ? value : maximum, 0n);
    if (targetWatermark > BigInt(SUPPORTED_SEQUENCE_TARGET.maxValue)) throw fail("sequence_target_exhausted");
    await runBatch(database, [
      database.prepare(`DELETE FROM "sqlite_sequence" WHERE "name" = ?`).bind(state.ownerTable),
      database.prepare(`INSERT INTO "sqlite_sequence" ("name", "seq") VALUES (?, CAST(? AS INTEGER))`).bind(state.ownerTable, targetWatermark.toString()),
    ]);
    const readbackRows = await allRows(
      database,
      `SELECT CAST("seq" AS TEXT) AS "seq" FROM "sqlite_sequence" WHERE "name" = ?`,
      [state.ownerTable],
    );
    if (readbackRows.length !== 1 || readbackRows[0].seq !== targetWatermark.toString()) throw fail("sequence_target_readback_mismatch");
    applied.push({
      schema: state.schema,
      name: state.name,
      lastValue: state.lastValue,
      isCalled: state.isCalled,
      sourceWatermark: sourceWatermark.toString(),
      importedTableMax: tableMax.toString(),
      priorTargetWatermark: previous.toString(),
      targetWatermark: targetWatermark.toString(),
      readbackWatermark: readbackRows[0].seq,
    });
  }
  return applied;
}

async function* readSourceIterator({ filePath, entry, tablePlan, maxRowBytes }) {
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let byteCount = 0;
  let ordinal = 0;
  const queue = [];
  const processLine = (line) => {
    if (line.length === 0 || Buffer.byteLength(line, "utf8") > Math.min(maxRowBytes, MAX_LINE_BYTES)) throw fail("source_row_record_too_large");
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw fail("source_row_record_invalid", error);
    }
    const prepared = validateSourceRecord(record, line, tablePlan, ordinal);
    queue.push({ ...prepared, lineBytes: Buffer.byteLength(`${line}\n`, "utf8"), ordinal });
    ordinal += 1;
  };
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      byteCount += chunk.byteLength;
      pending += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        processLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        yield queue.shift();
      }
      if (Buffer.byteLength(pending, "utf8") > Math.min(maxRowBytes, MAX_LINE_BYTES)) throw fail("source_row_record_too_large");
    }
    pending += decoder.decode();
  } catch (error) {
    stream.destroy();
    if (error instanceof D1ImportError) throw error;
    throw fail("source_stream_read_failed", error);
  } finally {
    stream.destroy();
  }
  if (pending.length !== 0) throw fail("source_missing_terminal_newline");
  const stats = { rowCount: ordinal, byteCount, streamHash: hash.digest("hex") };
  if (stats.streamHash !== entry.streamHash || String(stats.byteCount) !== entry.byteCount || String(stats.rowCount) !== entry.rowCount) throw fail("source_stream_identity_mismatch");
  return stats;
}

async function existingCredentialLedgerObjects(database) {
  const expected = ledgerSchemaStatements().map((sql) => {
    const match = sql.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)/iu);
    if (!match) throw fail("ledger_schema_definition_invalid");
    const name = match[1].startsWith('"') ? match[1].slice(1, -1).replaceAll('""', '"') : match[1];
    return { type: "table", name, sql: normalizeSql(sql.replace(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/iu, "CREATE TABLE")) };
  });
  const rows = await allRows(
    database,
    'SELECT type, name, sql FROM sqlite_master WHERE type = \'table\' AND name IN (?, ?, ?)',
    Object.values(LEDGER_TABLES),
  );
  if (rows.length === 0) return [];
  if (rows.length !== expected.length) throw fail("ledger_schema_definition_mismatch");
  const actual = new Map(rows.map((row) => [row.name, row]));
  for (const object of expected) {
    const row = actual.get(object.name);
    if (!row || row.type !== "table" || normalizeSql(row.sql) !== object.sql) throw fail("ledger_schema_definition_mismatch");
  }
  return expected;
}

async function assertTargetSchema(database, snapshot, plan, { credentialProfile = null } = {}) {
  if (credentialProfile !== null) {
    const profileKeys = Reflect.ownKeys(credentialProfile);
    const expectedProfileKeys = ["credentialPlan", "descriptor", "generationPlan", "lifecyclePlan"];
    if (
      profileKeys.length !== expectedProfileKeys.length ||
      profileKeys.some((key) => typeof key !== "string" || !expectedProfileKeys.includes(key)) ||
      profileKeys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(credentialProfile, key);
        return !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value");
      })
    ) throw fail("target_profile_shape_invalid");
    let inspected;
    try {
      inspected = await inspectCredentialTransformSchema(database, credentialProfile.credentialPlan, {
        catalog: snapshot.catalog,
        convertedSchema: snapshot.convertedSchema,
        lifecyclePlan: credentialProfile.lifecyclePlan,
        generationPlan: credentialProfile.generationPlan,
        descriptor: credentialProfile.descriptor,
        additionalObjects: await existingCredentialLedgerObjects(database),
      });
    } catch {
      throw fail("target_profile_schema_mismatch");
    }
    if (!inspected.complete) throw fail("target_profile_schema_incomplete");
  } else {
    const expectedObjects = generatedSchemaObjects(snapshot.convertedSchema.sql);
    // Include every user object kind. A stray trigger or view can change write
    // semantics while leaving table_info and the table/index set unchanged.
    // SQLite's implicit autoindexes have no portable source name; their parent
    // table's exact CREATE SQL still carries the declared PK/UNIQUE semantics.
    const actualRows = await allRows(database, "SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND type IN ('table', 'index', 'view', 'trigger')");
    const actualObjects = new Map();
    for (const row of actualRows) {
      if (typeof row.name !== "string" || typeof row.type !== "string" || typeof row.sql !== "string") throw fail("target_schema_metadata_invalid");
      // The ledger is importer-owned, and the exact provider metadata object is
      // the only local D1 object outside the generated application scope.
      if (Object.values(LEDGER_TABLES).includes(row.name) || D1_PROVIDER_OBJECTS.has(`${row.type}:${row.name}`)) continue;
      actualObjects.set(`${row.type}:${row.name}`, normalizeSql(row.sql));
    }
    const expectedKeys = [...expectedObjects.keys()].sort(compareUtf8);
    const actualKeys = [...actualObjects.keys()].sort(compareUtf8);
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) throw fail("target_schema_scope_mismatch", { expectedKeys, actualKeys });
    for (const key of expectedKeys) {
      if (actualObjects.get(key) !== expectedObjects.get(key)) throw fail("target_schema_definition_mismatch");
    }
  }
  for (const table of plan.tableNames) {
    const rows = await allRows(database, `PRAGMA table_info(${quoteIdentifier(table)})`);
    const expectedColumns = plan.tables.get(table).columns;
    if (credentialProfile === null ? rows.length !== expectedColumns.length : rows.length < expectedColumns.length) throw fail("target_columns_mismatch");
    for (let index = 0; index < expectedColumns.length; index += 1) {
      const actual = rows[index];
      const expected = expectedColumns[index];
      const primaryIndex = plan.tables.get(table).primaryNames.indexOf(expected.name);
      if (actual.name !== expected.name || String(actual.type).toUpperCase() !== expected.targetType || Number(actual.notnull) !== (expected.notNull ? 1 : 0) || Number(actual.pk) !== (primaryIndex < 0 ? 0 : primaryIndex + 1)) throw fail("target_columns_mismatch");
    }
  }
  const fkState = await oneRow(database, "PRAGMA foreign_keys", [], "target_foreign_key_mode_unavailable");
  if (Number(fkState.foreign_keys) !== 1) throw fail("target_foreign_keys_disabled");
}

async function assertForeignKeys(database) {
  const rows = await allRows(database, "PRAGMA foreign_key_check");
  if (rows.length !== 0) throw fail("target_foreign_key_violation");
}

function credentialDestinationDigest(projection, artifact, values = projection.bindings) {
  return sha256Hex({
    relation: CREDENTIAL_SOURCE_RELATION,
    primaryKey: projection.primaryKey,
    columns: CREDENTIAL_NONCREDENTIAL_COLUMNS,
    bindings: values,
    credentialTransformDigest: artifact.destination_transform_digest,
  });
}

async function readCredentialLicenseState(database, licenseId) {
  return oneRow(
    database,
    'SELECT l."status", l."is_returned", l."lifecycle_generation", i."incarnation" AS "license_incarnation", v."license_incarnation" AS "version_license_incarnation", v."password_generation", v."access_generation" FROM "fanmark_licenses" AS l JOIN "fanmark_license_incarnations" AS i ON i."license_id" = l."id" JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id" WHERE l."id" = ? LIMIT 2',
    [licenseId],
    "credential_license_readback_missing_or_duplicate",
  );
}

function assertCredentialPostTransformState(state, artifact) {
  const licenseIncarnation = Number(artifact.license_incarnation);
  if (
    state.status !== "active" ||
    Number(state.is_returned) !== 0 ||
    Number(state.license_incarnation) !== licenseIncarnation ||
    Number(state.version_license_incarnation) !== licenseIncarnation ||
    Number(state.password_generation) !== Number(artifact.expected_password_generation) + 1 ||
    Number(state.access_generation) !== Number(artifact.expected_access_generation) + 1 ||
    Number(state.lifecycle_generation) !== Number(artifact.expected_lifecycle_generation)
  ) throw fail("credential_generation_readback_mismatch");
}

async function reconcileCredentialArtifact(database, artifact, { now }) {
  if (artifact.state === "reconciled") return artifact;
  if (artifact.state !== "applied") throw fail("credential_artifact_state_invalid");
  const timestamp = nowIso(now);
  const token = randomBytes(12).toString("hex");
  await runBatch(database, [
    database.prepare(
      'UPDATE "credential_transform_artifacts" SET "state" = \'reconciled\', "reconciled_at" = ? WHERE "artifact_id" = ? AND "state" = \'applied\' AND "fencing_token" = ? AND EXISTS (SELECT 1 FROM "credential_transform_coverage" WHERE "artifact_id" = "credential_transform_artifacts"."artifact_id" AND "coverage_state" IN (\'transformed\', \'disabled\'))',
    ).bind(timestamp, artifact.artifact_id, Number(artifact.fencing_token)),
    database.prepare(
      'INSERT INTO "' + LEDGER_TABLES.guards + '" (token, must_be_one) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM "credential_transform_artifacts" WHERE "artifact_id" = ? AND "state" = \'reconciled\' AND "fencing_token" = ?) THEN 1 ELSE 0 END',
    ).bind(token, artifact.artifact_id, Number(artifact.fencing_token)),
    database.prepare('DELETE FROM "' + LEDGER_TABLES.guards + '" WHERE token = ?').bind(token),
  ]);
  return oneRow(database, 'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2', [artifact.artifact_id], "credential_artifact_read_failed");
}

async function readAndValidateCredentialRow(database, snapshot, tablePlan, projection, options, { allowReconcile = true } = {}) {
  const [sourceId, licenseId, enabled, createdAt, updatedAt] = projection.bindings;
  const artifacts = await allRows(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "target_identity" = ? AND "target_incarnation" = ? AND "source_relation" = ? AND "source_row_identity_digest" = ? LIMIT 2',
    [options.destinationId, options.targetIncarnation, CREDENTIAL_SOURCE_RELATION, projection.sourceRowIdentityDigest],
  );
  if (artifacts.length !== 1) throw fail("credential_artifact_readback_missing_or_duplicate");
  let artifact = artifacts[0];
  if (
    artifact.target_profile_fingerprint !== options.expectedTargetProfile.credentialPlan.targetProfileFingerprint ||
    artifact.source_manifest_digest !== snapshot.manifestDigest ||
    artifact.descriptor_digest !== projection.credentialDescriptorDigest ||
    artifact.source_primary_key_json !== JSON.stringify(projection.primaryKey) ||
    artifact.source_row_identity_digest !== projection.sourceRowIdentityDigest ||
    artifact.source_envelope_digest !== projection.sourceEnvelopeDigest ||
    artifact.source_revision !== `${projection.ordinal}:${projection.rowHash}` ||
    artifact.destination_license_id !== licenseId ||
    Number(artifact.enabled) !== enabled ||
    artifact.target_identity !== options.destinationId ||
    artifact.target_incarnation !== options.targetIncarnation ||
    artifact.destination_relation !== CREDENTIAL_SOURCE_RELATION ||
    artifact.destination_column !== "access_password" ||
    !["applied", "reconciled"].includes(artifact.state)
  ) throw fail("credential_artifact_readback_mismatch");
  const targetColumns = tablePlan.columns
    .map((column, index) => `${quoteIdentifier(column.name)}, typeof(${quoteIdentifier(column.name)}) AS ${quoteIdentifier(`__d1_storage_type_${index}`)}`)
    .join(", ");
  const targetRows = await allRows(database, `SELECT ${targetColumns} FROM "fanmark_password_configs" WHERE "id" = ? LIMIT 2`, [sourceId]);
  if (targetRows.length !== 1) throw fail("credential_target_readback_missing_or_duplicate");
  const target = targetRows[0];
  for (const [index, column] of tablePlan.columns.entries()) {
    if (!Object.hasOwn(target, column.name)) throw fail("target_column_missing");
    assertTargetStorageType(target, column, index);
  }
  for (const [name, expected] of [
    ["id", sourceId],
    ["license_id", licenseId],
    ["is_enabled", enabled],
    ["created_at", createdAt],
    ["updated_at", updatedAt],
  ]) assertBindingEquals(target[name], expected);
  if (target.access_password !== artifact.destination_hash || typeof target.access_password !== "string" || !/^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/u.test(target.access_password)) {
    throw fail("credential_target_transform_readback_mismatch");
  }
  const coverages = await allRows(
    database,
    'SELECT * FROM "credential_transform_coverage" WHERE "run_id" = ? AND "table_name" = ? AND "source_row_identity_digest" = ? LIMIT 2',
    [snapshot.manifest.runId, CREDENTIAL_SOURCE_RELATION, projection.sourceRowIdentityDigest],
  );
  if (coverages.length !== 1) throw fail("credential_coverage_readback_missing_or_duplicate");
  const coverage = coverages[0];
  const destinationValues = CREDENTIAL_NONCREDENTIAL_COLUMNS.map((name) => target[name]);
  const destinationDigest = credentialDestinationDigest(projection, artifact, destinationValues);
  if (
    coverage.target_profile_fingerprint !== artifact.target_profile_fingerprint ||
    coverage.source_manifest_digest !== snapshot.manifestDigest ||
    coverage.descriptor_digest !== projection.credentialDescriptorDigest ||
    coverage.target_identity !== options.destinationId ||
    coverage.target_incarnation !== options.targetIncarnation ||
    coverage.source_primary_key_json !== JSON.stringify(projection.primaryKey) ||
    coverage.source_envelope_digest !== projection.sourceEnvelopeDigest ||
    coverage.destination_relation !== CREDENTIAL_SOURCE_RELATION ||
    coverage.destination_column !== "access_password" ||
    coverage.destination_primary_key_json !== JSON.stringify(projection.primaryKey) ||
    coverage.destination_license_id !== licenseId ||
    Number(coverage.license_incarnation) !== Number(artifact.license_incarnation) ||
    Number(coverage.enabled) !== enabled ||
    Number(coverage.expected_password_generation) !== Number(artifact.expected_password_generation) + 1 ||
    Number(coverage.expected_access_generation) !== Number(artifact.expected_access_generation) + 1 ||
    Number(coverage.expected_lifecycle_generation) !== Number(artifact.expected_lifecycle_generation) ||
    coverage.artifact_id !== artifact.artifact_id ||
    Number(coverage.fencing_token) !== Number(artifact.fencing_token) ||
    coverage.coverage_state !== (enabled === 1 ? "transformed" : "disabled") ||
    coverage.destination_transform_digest !== artifact.destination_transform_digest ||
    coverage.destination_digest !== destinationDigest ||
    coverage.reason_code !== null
  ) throw fail("credential_coverage_readback_mismatch");
  assertCredentialPostTransformState(await readCredentialLicenseState(database, licenseId), artifact);
  assertTargetRowBytes(tablePlan, target, options.maxTargetRowBytes);
  if (allowReconcile && artifact.state === "applied") {
    artifact = await reconcileCredentialArtifact(database, artifact, options);
    if (artifact.state !== "reconciled") throw fail("credential_artifact_reconcile_failed");
  }
  return { target, artifact, coverage, destinationDigest };
}

async function commitCredentialRow(database, snapshot, tablePlan, checkpoint, row, options) {
  const projection = row.converted.credentialProjection;
  const reservation = await reserveCredentialImportArtifact({
    database,
    projection,
    catalog: snapshot.catalog,
    destinationId: options.destinationId,
    targetIncarnation: options.targetIncarnation,
    sourceManifestDigest: snapshot.manifestDigest,
    targetProfileFingerprint: options.expectedTargetProfile.credentialPlan.targetProfileFingerprint,
    now: options.now,
  });
  if (reservation.state !== "reserved") throw fail("credential_artifact_checkpoint_mismatch");
  const prepared = await prepareCredentialImportArtifact({ database, reservation, now: options.now });
  if (prepared.state !== "prepared") throw fail("credential_artifact_checkpoint_mismatch");
  const insert = buildCredentialTargetInsert({
    projection,
    preparedArtifact: prepared,
    descriptorDigest: snapshot.manifest.credentialDescriptorDigest,
  });
  const artifact = await oneRow(
    database,
    'SELECT * FROM "credential_transform_artifacts" WHERE "artifact_id" = ? LIMIT 2',
    [prepared.artifactId],
    "credential_artifact_read_failed",
  );
  if (artifact.state !== "prepared" || artifact.destination_transform_digest !== prepared.destinationTransformDigest) {
    throw fail("credential_artifact_prepare_readback_mismatch");
  }
  const targetValues = Object.fromEntries(insert.columns.map((name, index) => [name, insert.bindings[index]]));
  if (targetRowEncodedBytes(tablePlan, targetValues) > options.maxTargetRowBytes) throw fail("target_row_size_exceeded");
  if (row.lineBytes > options.maxRowBytes) throw fail("source_row_size_exceeded");
  const nextOrdinal = checkpoint.next_ordinal + 1;
  const prefixDigest = nextPrefixDigest(checkpoint.prefix_digest, row.rowHash);
  const chunkDigest = sha256Hex({
    table: tablePlan.table,
    startOrdinal: checkpoint.next_ordinal,
    endOrdinal: nextOrdinal,
    rowHashes: [row.rowHash],
  });
  const destinationDigest = credentialDestinationDigest(projection, artifact);
  const coverageState = projection.bindings[2] === 1 ? "transformed" : "disabled";
  const timestamp = nowIso(options.now);
  const checkpointUpdate = checkpointUpdateStatement({
    runId: snapshot.manifest.runId,
    tableName: tablePlan.table,
    generation: checkpoint.generation,
    expectedNextOrdinal: checkpoint.next_ordinal,
    nextOrdinal,
    nextGeneration: checkpoint.generation + 1,
    nextStatus: "in_progress",
    lastPkJson: JSON.stringify(row.record.primaryKey),
    prefixDigest,
    rowsImported: nextOrdinal,
    bytesImported: checkpoint.bytes_imported + row.lineBytes,
    chunkStart: checkpoint.next_ordinal,
    chunkEnd: nextOrdinal,
    chunkDigest,
  });
  const checkpointToken = randomBytes(12).toString("hex");
  const artifactToken = randomBytes(12).toString("hex");
  const checkpointVerifyToken = randomBytes(12).toString("hex");
  const checkpointGuard = guardStatement({
    runId: snapshot.manifest.runId,
    tableName: tablePlan.table,
    generation: checkpoint.generation,
    nextOrdinal: checkpoint.next_ordinal,
    token: checkpointToken,
  });
  const artifactTransition = [
    'UPDATE "credential_transform_artifacts"',
    'SET "state" = \'applied\', "applied_at" = ?, "lease_id" = NULL, "lease_expires_at" = NULL',
    'WHERE "artifact_id" = ? AND "state" = \'prepared\' AND "fencing_token" = ? AND "lease_id" = ? AND "lease_expires_at" > ?',
    'AND "artifact_key" = ? AND "source_binding_digest" = ?',
    'AND "target_profile_fingerprint" = ? AND "source_manifest_digest" = ? AND "descriptor_digest" = ?',
    'AND "source_relation" = ? AND "source_primary_key_json" = ? AND "source_row_identity_digest" = ? AND "source_envelope_digest" = ? AND "source_revision" = ?',
    'AND "target_identity" = ? AND "target_incarnation" = ? AND "destination_relation" = ? AND "destination_column" = ?',
    'AND "destination_license_id" = ? AND "enabled" = ? AND "destination_transform_digest" = ?',
    'AND "expected_password_generation" = ? AND "expected_access_generation" = ? AND "expected_lifecycle_generation" = ?',
    'AND EXISTS (SELECT 1 FROM "fanmark_licenses" AS l JOIN "fanmark_license_incarnations" AS i ON i."license_id" = l."id" JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id" WHERE l."id" = ? AND l."status" = \'active\' AND l."is_returned" = 0 AND i."incarnation" = ? AND v."license_incarnation" = i."incarnation" AND v."password_generation" = ? AND v."access_generation" = ? AND l."lifecycle_generation" = ?)',
  ].join(" ");
  const artifactTransitionBindings = [
    timestamp,
    artifact.artifact_id,
    reservation.fencingToken,
    reservation.leaseId,
    Date.parse(timestamp),
    artifact.artifact_key,
    artifact.source_binding_digest,
    artifact.target_profile_fingerprint,
    snapshot.manifestDigest,
    snapshot.manifest.credentialDescriptorDigest,
    CREDENTIAL_SOURCE_RELATION,
    JSON.stringify(projection.primaryKey),
    projection.sourceRowIdentityDigest,
    projection.sourceEnvelopeDigest,
    `${projection.ordinal}:${projection.rowHash}`,
    options.destinationId,
    options.targetIncarnation,
    CREDENTIAL_SOURCE_RELATION,
    "access_password",
    projection.bindings[1],
    projection.bindings[2],
    prepared.destinationTransformDigest,
    Number(artifact.expected_password_generation),
    Number(artifact.expected_access_generation),
    Number(artifact.expected_lifecycle_generation),
    projection.bindings[1],
    Number(artifact.license_incarnation),
    Number(artifact.expected_password_generation),
    Number(artifact.expected_access_generation),
    Number(artifact.expected_lifecycle_generation),
  ];
  const coverageInsert = [
    'INSERT INTO "credential_transform_coverage" (',
    '"run_id", "target_profile_fingerprint", "source_manifest_digest", "descriptor_digest", "target_identity", "target_incarnation",',
    '"table_name", "source_primary_key_json", "source_row_identity_digest", "source_envelope_digest",',
    '"destination_relation", "destination_column", "destination_primary_key_json", "destination_license_id", "license_incarnation",',
    '"enabled", "expected_password_generation", "expected_access_generation", "expected_lifecycle_generation", "artifact_id", "fencing_token",',
    '"coverage_state", "destination_transform_digest", "destination_digest", "reason_code", "created_at", "updated_at"',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
  ].join(" ");
  const coverageBindings = [
    snapshot.manifest.runId,
    artifact.target_profile_fingerprint,
    snapshot.manifestDigest,
    snapshot.manifest.credentialDescriptorDigest,
    options.destinationId,
    options.targetIncarnation,
    tablePlan.table,
    JSON.stringify(projection.primaryKey),
    projection.sourceRowIdentityDigest,
    projection.sourceEnvelopeDigest,
    CREDENTIAL_SOURCE_RELATION,
    "access_password",
    JSON.stringify(projection.primaryKey),
    projection.bindings[1],
    Number(artifact.license_incarnation),
    projection.bindings[2],
    Number(artifact.expected_password_generation) + 1,
    Number(artifact.expected_access_generation) + 1,
    Number(artifact.expected_lifecycle_generation),
    artifact.artifact_id,
    reservation.fencingToken,
    coverageState,
    prepared.destinationTransformDigest,
    destinationDigest,
    timestamp,
    timestamp,
  ];
  const statements = [
    database.prepare(checkpointGuard.sql).bind(...checkpointGuard.bindings),
    database.prepare(artifactTransition).bind(...artifactTransitionBindings),
    database.prepare(
      'INSERT INTO "' + LEDGER_TABLES.guards + '" (token, must_be_one) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM "credential_transform_artifacts" WHERE "artifact_id" = ? AND "state" = \'applied\' AND "fencing_token" = ?) THEN 1 ELSE 0 END',
    ).bind(artifactToken, artifact.artifact_id, reservation.fencingToken),
    database.prepare(insert.sql).bind(...insert.bindings),
    database.prepare(coverageInsert).bind(...coverageBindings),
    database.prepare(checkpointUpdate.sql).bind(...checkpointUpdate.bindings),
    database.prepare(
      'INSERT INTO "' + LEDGER_TABLES.guards + '" (token, must_be_one) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM "' + LEDGER_TABLES.checkpoints + '" WHERE run_id = ? AND table_name = ? AND generation = ? AND next_ordinal = ? AND status = \'in_progress\') THEN 1 ELSE 0 END',
    ).bind(checkpointVerifyToken, snapshot.manifest.runId, tablePlan.table, checkpoint.generation + 1, nextOrdinal),
    database.prepare('DELETE FROM "' + LEDGER_TABLES.guards + '" WHERE token IN (?, ?, ?)').bind(checkpointToken, artifactToken, checkpointVerifyToken),
  ];
  await options.hooks?.beforeCredentialBatchCommit?.({ table: tablePlan.table, ordinal: row.ordinal });
  await runBatch(database, statements);
  try {
    await options.hooks?.afterCredentialBatchCommit?.({ table: tablePlan.table, ordinal: row.ordinal });
  } catch (error) {
    throw fail("credential_batch_ack_unknown", error);
  }
  const checkpointAfter = await getCheckpoint(database, snapshot.manifest.runId, tablePlan.table);
  if (
    checkpointAfter.next_ordinal !== nextOrdinal ||
    checkpointAfter.generation !== checkpoint.generation + 1 ||
    checkpointAfter.prefix_digest !== prefixDigest
  ) throw fail("credential_checkpoint_readback_mismatch");
  const validated = await readAndValidateCredentialRow(database, snapshot, tablePlan, projection, options);
  return { checkpoint: checkpointAfter, target: validated.target, artifact: validated.artifact };
}

async function processCredentialTable(database, snapshot, tablePlan, entry, options, reportTable) {
  const checkpoint = await getCheckpoint(database, snapshot.manifest.runId, tablePlan.table);
  validateCheckpoint(checkpoint, Number(entry.rowCount));
  let runningPrefix = ZERO_DIGEST;
  const onRecord = async (row) => {
    const prefixBefore = runningPrefix;
    runningPrefix = nextPrefixDigest(runningPrefix, row.rowHash);
    if (row.ordinal < checkpoint.next_ordinal) {
      await readAndValidateCredentialRow(
        database,
        snapshot,
        tablePlan,
        row.converted.credentialProjection,
        options,
      );
      if (checkpoint.next_ordinal <= row.ordinal) throw fail("credential_checkpoint_readback_mismatch");
      return;
    }
    if (row.ordinal !== checkpoint.next_ordinal || prefixBefore !== checkpoint.prefix_digest) {
      throw fail("source_ordinal_checkpoint_mismatch");
    }
    const committed = await commitCredentialRow(database, snapshot, tablePlan, checkpoint, row, options);
    Object.assign(checkpoint, committed.checkpoint);
    reportTable.status = "in_progress";
    reportTable.rowsImported = checkpoint.rows_imported;
    reportTable.bytesImported = checkpoint.bytes_imported;
  };
  const stats = await readTableRecords({
    filePath: path.join(snapshot.outputDir, entry.file),
    entry,
    tablePlan,
    maxRowBytes: options.maxRowBytes,
    onRecord,
  });
  const latest = await getCheckpoint(database, snapshot.manifest.runId, tablePlan.table);
  validateCheckpoint(latest, stats.rowCount);
  if (latest.next_ordinal !== stats.rowCount || latest.prefix_digest !== runningPrefix) throw fail("checkpoint_source_mismatch");
  const completed = latest.status === "complete" ? latest : await completeTable(database, snapshot, tablePlan, latest, options);
  reportTable.status = "complete";
  reportTable.rowsImported = completed.rows_imported;
  reportTable.bytesImported = completed.bytes_imported;
  return { stats, checkpoint: completed };
}

async function processTable(database, snapshot, tablePlan, entry, options, reportTable) {
  if (tablePlan.credentialProjection) return processCredentialTable(database, snapshot, tablePlan, entry, options, reportTable);
  const checkpoint = await getCheckpoint(database, snapshot.manifest.runId, tablePlan.table);
  validateCheckpoint(checkpoint, Number(entry.rowCount));
  let runningPrefix = ZERO_DIGEST;
  let pendingRows = [];
  let pendingBytes = 0;
  let pendingBindings = 0;
  const flush = async () => {
    if (pendingRows.length === 0) return;
    const committed = await commitChunk(database, snapshot, tablePlan, {
      ...checkpoint,
      prefix_digest: runningPrefixBeforeChunk,
    }, pendingRows, options);
    Object.assign(checkpoint, committed);
    reportTable.status = "in_progress";
    reportTable.rowsImported = checkpoint.rows_imported;
    reportTable.bytesImported = checkpoint.bytes_imported;
    pendingRows = [];
    pendingBytes = 0;
    pendingBindings = 0;
  };
  let runningPrefixBeforeChunk = ZERO_DIGEST;
  const onRecord = async (row) => {
    const rowHash = row.rowHash;
    if (row.ordinal < checkpoint.next_ordinal) {
      runningPrefix = nextPrefixDigest(runningPrefix, rowHash);
      const existingRow = await readTargetRow(database, tablePlan, row.converted);
      assertTargetRowBytes(tablePlan, existingRow, options.maxTargetRowBytes);
      return;
    }
    if (row.ordinal !== checkpoint.next_ordinal + pendingRows.length) throw fail("source_ordinal_checkpoint_mismatch");
    if (row.ordinal === checkpoint.next_ordinal) {
      runningPrefixBeforeChunk = runningPrefix;
      if (runningPrefix !== checkpoint.prefix_digest) throw fail("checkpoint_prefix_mismatch");
    }
    const bindingCount = row.converted.bindings.length;
    const rowBytes = row.lineBytes;
    const targetValues = Object.fromEntries(tablePlan.columns.map((column, index) => [column.name, row.converted.bindings[index]]));
    const targetBytes = targetRowEncodedBytes(tablePlan, targetValues);
    if (rowBytes > options.maxRowBytes) throw fail("source_row_size_exceeded");
    if (targetBytes > options.maxTargetRowBytes) throw fail("target_row_size_exceeded");
    if (bindingCount > MAX_BINDINGS_PER_STATEMENT || bindingCount > options.maxBindingsPerBatch) throw fail("row_binding_limit_exceeded");
    if (rowBytes > options.maxBatchBytes) throw fail("row_batch_limit_exceeded");
    if (pendingRows.length > 0 && (pendingRows.length >= options.maxRowsPerBatch || pendingBytes + rowBytes > options.maxBatchBytes || pendingBindings + bindingCount > options.maxBindingsPerBatch)) {
      await flush();
      runningPrefixBeforeChunk = runningPrefix;
    }
    pendingRows.push(row);
    pendingBytes += rowBytes;
    pendingBindings += bindingCount;
    runningPrefix = nextPrefixDigest(runningPrefix, rowHash);
    if (pendingRows.length >= options.maxRowsPerBatch || pendingBytes >= options.maxBatchBytes || pendingBindings >= options.maxBindingsPerBatch) await flush();
  };
  const stats = await readTableRecords({ filePath: path.join(snapshot.outputDir, entry.file), entry, tablePlan, maxRowBytes: options.maxRowBytes, onRecord });
  await flush();
  if (runningPrefix !== checkpoint.prefix_digest && checkpoint.next_ordinal === stats.rowCount && checkpoint.status === "complete") {
    // A completed table's prefix was independently checked while streaming.
  }
  const latest = await getCheckpoint(database, snapshot.manifest.runId, tablePlan.table);
  validateCheckpoint(latest, stats.rowCount);
  if (latest.next_ordinal !== stats.rowCount || latest.prefix_digest !== runningPrefix) throw fail("checkpoint_source_mismatch");
  const completed = latest.status === "complete" ? latest : await completeTable(database, snapshot, tablePlan, latest, options);
  reportTable.status = "complete";
  reportTable.rowsImported = completed.rows_imported;
  reportTable.bytesImported = completed.bytes_imported;
  return { stats, checkpoint: completed };
}

function initialReport(snapshot, plan, options) {
  return {
    schemaVersion: D1_IMPORT_SCHEMA_VERSION,
    status: "in_progress",
    mode: options.mode,
    fullMigrationReconciled: false,
    deployable: false,
    publicRowsReconciled: false,
    runId: snapshot.manifest.runId,
    destinationId: options.destinationId,
    targetIncarnation: options.targetIncarnation,
    manifestDigest: snapshot.manifestDigest,
    credentialDescriptorDigest: snapshot.manifest.credentialDescriptorDigest,
    catalogFingerprint: snapshot.catalogFingerprint,
    schemaReportFingerprint: snapshot.schemaReportFingerprint,
    schemaDigest: snapshot.schemaDigest,
    codecVersion: D1_IMPORT_CODEC_VERSION,
    tableCount: plan.tableNames.length,
    completedTables: 0,
    importOrder: plan.importOrder,
    unresolvedGateCodes: [...new Set(snapshot.convertedSchema.report.gates.map((gate) => gate.code))].sort(compareUtf8),
    sequenceStates: [],
    tables: plan.importOrder.map((table) => ({ table, status: "pending", rowsImported: 0, bytesImported: 0 })),
    startedAt: nowIso(options.now),
    updatedAt: nowIso(options.now),
    errorCode: null,
  };
}

function assertReportIdentity(report, snapshot, options, plan) {
  if (!report || !isPlainObject(report) || report.schemaVersion !== D1_IMPORT_SCHEMA_VERSION || report.runId !== snapshot.manifest.runId || report.destinationId !== options.destinationId || report.targetIncarnation !== options.targetIncarnation || report.manifestDigest !== snapshot.manifestDigest || report.credentialDescriptorDigest !== snapshot.manifest.credentialDescriptorDigest || report.catalogFingerprint !== snapshot.catalogFingerprint || report.schemaReportFingerprint !== snapshot.schemaReportFingerprint || report.schemaDigest !== snapshot.schemaDigest || report.codecVersion !== D1_IMPORT_CODEC_VERSION || report.tableCount !== plan.tableNames.length || JSON.stringify(report.importOrder) !== JSON.stringify(plan.importOrder)) throw fail("report_identity_mismatch");
}

async function updateRunError(database, snapshot, code, now) {
  // A losing concurrent runner must not overwrite a winner's terminal
  // public_rows_reconciled state after the winner commits.
  await runStatement(database, `UPDATE ${quoteIdentifier(LEDGER_TABLES.runs)} SET status = 'failed', updated_at = ?, last_error_code = ? WHERE run_id = ? AND status = 'in_progress'`, [nowIso(now), code, snapshot.manifest.runId]).catch(() => {});
}

export async function importD1Snapshot({
  manifestPath,
  database,
  destinationId,
  targetIncarnation,
  reportPath,
  mode = "local",
  allowUnresolvedGates = false,
  expectedTargetProfile = null,
  maxRowsPerBatch = DEFAULT_MAX_ROWS_PER_BATCH,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  maxBindingsPerBatch = DEFAULT_MAX_BINDINGS_PER_BATCH,
  scanBatchRows = DEFAULT_SCAN_BATCH_ROWS,
  maxRowBytes = DEFAULT_MAX_ROW_BYTES,
  maxTargetRowBytes = DEFAULT_MAX_TARGET_ROW_BYTES,
  now = () => new Date(),
  hooks = {},
} = {}) {
  validateDatabase(database);
  if (mode !== "local") throw fail("unsupported_import_mode");
  if (allowUnresolvedGates !== true && allowUnresolvedGates !== false) throw fail("invalid_gate_option");
  validateIdentity(destinationId, "invalid_destination_id");
  validateIdentity(targetIncarnation, "invalid_target_incarnation");
  if (typeof now !== "function") throw fail("invalid_clock");
  validateOptions({ maxRowsPerBatch, maxBatchBytes, maxBindingsPerBatch, scanBatchRows, maxRowBytes, maxTargetRowBytes });
  const snapshot = await loadVerifiedSnapshot(manifestPath);
  let plan = null;
  if (expectedTargetProfile !== null) {
    plan = buildImportPlan(snapshot.catalog, snapshot.convertedSchema, { allowUnresolvedGates, credentialDescriptor: snapshot.manifest.credentialDescriptor ?? undefined });
    // This is a read-only preflight. It confirms the exact lifecycle,
    // generation, and credential target profile before the generic importer
    // refuses to move any row from a credential-bearing catalog.
    await assertTargetSchema(database, snapshot, plan, { credentialProfile: expectedTargetProfile });
  }
  if (expectedTargetProfile === null) assertCredentialTransformBoundary(snapshot.catalog);
  const absoluteReportPath = reportPathFor(snapshot.manifestPath, reportPath);
  await ensurePrivateReportParent(absoluteReportPath);
  plan ??= buildImportPlan(snapshot.catalog, snapshot.convertedSchema, { allowUnresolvedGates, credentialDescriptor: snapshot.manifest.credentialDescriptor ?? undefined });
  if (snapshot.convertedSchema.report.unresolvedGateCount > 0 && !allowUnresolvedGates) throw fail("schema_gates_unresolved");
  const existingReport = await readReport(absoluteReportPath);
  if (existingReport) assertReportIdentity(existingReport, snapshot, { mode, destinationId, targetIncarnation }, plan);
  await ensureLedgerSchema(database);
  let report = existingReport;
  try {
    // A prior report without its private ledger is not a resumable target. A
    // newly recreated empty D1 must receive a fresh incarnation token rather
    // than being mistaken for the old database.
    if (existingReport && !(await getRun(database, destinationId, targetIncarnation))) throw fail("target_incarnation_unbound");
    await ensureRun(database, snapshot, { destinationId, targetIncarnation, mode, now });
    report ??= initialReport(snapshot, plan, { mode, destinationId, targetIncarnation, now });
    assertReportIdentity(report, snapshot, { mode, destinationId, targetIncarnation }, plan);
    report.status = "in_progress";
    report.publicRowsReconciled = false;
    report.reconciledTables = [];
    report.sequenceStates = [];
    report.completedTables = report.tables.filter((candidate) => candidate.status === "complete").length;
    report.errorCode = null;
    report.updatedAt = nowIso(now);
    await persistReport(absoluteReportPath, report, hooks);
    // Schema identity is checked before the first public row write. Ledger
    // tables are the only objects this importer creates itself.
    if (expectedTargetProfile === null) await assertTargetSchema(database, snapshot, plan);
    for (const table of plan.importOrder) {
      const tablePlan = plan.tables.get(table);
      const entry = snapshot.tablesByName.get(table);
      if (!entry) throw fail("snapshot_table_missing");
      await ensureCheckpoint(database, snapshot, table, { destinationId, targetIncarnation });
      const reportTable = report.tables.find((candidate) => candidate.table === table);
      if (!reportTable) throw fail("report_table_missing");
      reportTable.status = "in_progress";
      await processTable(database, snapshot, tablePlan, entry, { destinationId, targetIncarnation, expectedTargetProfile, hooks, maxRowsPerBatch, maxBatchBytes, maxBindingsPerBatch, scanBatchRows, maxRowBytes, maxTargetRowBytes, now }, reportTable);
      report.completedTables = report.tables.filter((candidate) => candidate.status === "complete").length;
      report.updatedAt = nowIso(now);
      await persistReport(absoluteReportPath, report, hooks);
    }
    report.sequenceStates = await applySequenceStates(database, snapshot);
    report.updatedAt = nowIso(now);
    await persistReport(absoluteReportPath, report, hooks);
    const reconciledTables = [];
    for (const table of plan.importOrder) {
      const result = await reconcileTable(database, snapshot, plan.tables.get(table), snapshot.tablesByName.get(table), { maxRowBytes, scanBatchRows, maxTargetRowBytes, destinationId, targetIncarnation, expectedTargetProfile, now });
      reconciledTables.push({ table, rowCount: result.rowCount, byteCount: result.byteCount, targetHash: result.targetHash, sourceStreamHash: result.sourceStreamHash });
    }
    await assertForeignKeys(database);
    const timestamp = nowIso(now);
    await runStatement(database, `UPDATE ${quoteIdentifier(LEDGER_TABLES.runs)} SET status = 'public_rows_reconciled', completed_tables = ?, updated_at = ?, last_error_code = NULL WHERE run_id = ? AND destination_id = ? AND target_incarnation = ?`, [plan.importOrder.length, timestamp, snapshot.manifest.runId, destinationId, targetIncarnation]);
    report.status = "public_rows_reconciled";
    report.publicRowsReconciled = true;
    report.fullMigrationReconciled = false;
    report.deployable = false;
    report.completedTables = plan.importOrder.length;
    report.reconciledTables = reconciledTables;
    report.updatedAt = timestamp;
    await persistReport(absoluteReportPath, report, hooks);
    return {
      status: report.status,
      publicRowsReconciled: true,
      fullMigrationReconciled: false,
      deployable: false,
      objectCount: plan.importOrder.length,
      sequenceStateCount: report.sequenceStates.length,
      reportPath: absoluteReportPath,
      manifestDigest: snapshot.manifestDigest,
      destinationId,
      targetIncarnation,
    };
  } catch (error) {
    const code = safeErrorCode(error);
    await updateRunError(database, snapshot, code, now);
    if (report) {
      report.status = "failed";
      report.publicRowsReconciled = false;
      report.fullMigrationReconciled = false;
      report.deployable = false;
      report.errorCode = code;
      report.updatedAt = nowIso(now);
      await persistReport(absoluteReportPath, report, hooks).catch(() => {});
    }
    if (error instanceof D1ImportError) throw error;
    throw fail(code, error);
  }
}

export async function importEncryptedD1Snapshot({ bundleDir, encryptionKey, ...options } = {}) {
  if (typeof bundleDir !== "string" || !encryptionKey) throw fail("encrypted_snapshot_input_missing");
  const scratchParent = await fs.realpath(os.tmpdir());
  const scratchRoot = await fs.mkdtemp(path.join(scratchParent, "fanmark-snapshot-restore-"));
  await fs.chmod(scratchRoot, 0o700);
  const snapshotDir = path.join(scratchRoot, "snapshot");
  try {
    const opened = await openSnapshotBundle({ bundleDir, outputDir: snapshotDir, encryptionKey });
    return await importD1Snapshot({ ...options, manifestPath: opened.manifestPath });
  } finally {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  }
}

export const USAGE = `Usage: d1-import.mjs --help

This module requires an explicitly injected local D1 binding and a private
report path. It has no standalone remote, Wrangler, credential, or deploy mode.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  throw fail("no_standalone_transport");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof D1ImportError ? error.code : "d1_import_failed";
    console.error(`D1 import unavailable (${code}); no remote operation was attempted.`);
    process.exitCode = 1;
  });
}

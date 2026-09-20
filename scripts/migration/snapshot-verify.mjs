#!/usr/bin/env node

/**
 * Offline verifier for the database snapshot format.  It reads only private
 * snapshot artifacts and never connects to PostgreSQL or Cloudflare.
 */

import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { compileRowConverter } from "./row-conversion.mjs";
import { convertSchema } from "./schema-convert.mjs";
import {
  SNAPSHOT_FORMAT_VERSION,
  ROW_ENVELOPE_VERSION,
  ROW_RECORD_VERSION,
  SNAPSHOT_STATUS_FILE,
  SNAPSHOT_MANIFEST_FILE,
  SNAPSHOT_CATALOG_FILE,
  SNAPSHOT_SCHEMA_REPORT_FILE,
  TABLE_DIRECTORY,
  SnapshotFormatError,
  assertExactObjectKeys,
  assertPrivateRelativePath,
  canonicalJson,
  catalogFingerprint,
  compareUtf8,
  compareUtf8Tuple,
  getPrimaryKeyInfo,
  getTableNames,
  rowRecordForEnvelope,
  schemaReportFingerprint,
  sha256Hex,
  tableFileName,
} from "./snapshot-format.mjs";

const MAX_METADATA_BYTES = 8 * 1024 * 1024;

export class SnapshotVerificationError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SnapshotVerificationError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SnapshotVerificationError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, code) {
  try {
    assertExactObjectKeys(value, keys, code);
  } catch (error) {
    throw fail(code, error);
  }
}

async function lstatNoSymlink(filePath, code = "symlink_rejected") {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    throw fail("missing_artifact", error);
  }
  if (stat.isSymbolicLink()) throw fail(code);
  return stat;
}

function requireMode(stat, expected, code) {
  if ((stat.mode & 0o777) !== expected) throw fail(code);
}

async function readPrivateJson(filePath, expectedMode = 0o600) {
  const stat = await lstatNoSymlink(filePath);
  if (!stat.isFile()) throw fail("artifact_not_file");
  requireMode(stat, expectedMode, "artifact_mode_invalid");
  if (stat.size > MAX_METADATA_BYTES) throw fail("metadata_too_large");
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw fail("invalid_artifact_json", error);
  }
}

function assertManifestShape(manifest, expectedState) {
  if (!isPlainObject(manifest)) throw fail("invalid_manifest");
  const keys = [
    "formatVersion", "state", "runId", "catalogFingerprint", "schemaConversionVersion",
    "rowEnvelopeVersion", "schemaReportFingerprint", "schemaDeployable",
    "unresolvedGateCount", "sourceRole", "isolation", "readOnly", "tableCount", "tables", "reconciliation",
  ];
  exactKeys(manifest, keys, "manifest_keys_invalid");
  if (manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION) throw fail("manifest_format_invalid");
  if (manifest.state !== expectedState) throw fail("manifest_state_invalid", { actual: manifest.state, expected: expectedState });
  if (typeof manifest.runId !== "string" || manifest.runId.length < 8) throw fail("manifest_run_id_invalid");
  if (!/^[0-9a-f]{64}$/.test(manifest.catalogFingerprint) || !/^[0-9a-f]{64}$/.test(manifest.schemaReportFingerprint)) throw fail("manifest_fingerprint_invalid");
  if (manifest.schemaConversionVersion !== 1 || manifest.rowEnvelopeVersion !== ROW_ENVELOPE_VERSION || typeof manifest.schemaDeployable !== "boolean" || !Number.isSafeInteger(manifest.unresolvedGateCount) || manifest.unresolvedGateCount < 0 || manifest.sourceRole !== "postgres" || manifest.isolation !== "repeatable read" || manifest.readOnly !== true || !Number.isSafeInteger(manifest.tableCount) || manifest.tableCount < 0 || !Array.isArray(manifest.tables)) throw fail("manifest_metadata_invalid");
  if (manifest.tableCount !== manifest.tables.length) throw fail("manifest_table_count_mismatch");
  if (!isPlainObject(manifest.reconciliation)) throw fail("manifest_reconciliation_invalid");
  exactKeys(manifest.reconciliation, ["primaryKeys", "uniqueConstraints", "foreignKeys", "gates"], "manifest_reconciliation_keys_invalid");
  if (manifest.reconciliation.primaryKeys !== "verified" || manifest.reconciliation.uniqueConstraints !== "not_checked" || manifest.reconciliation.foreignKeys !== "not_checked" || !Array.isArray(manifest.reconciliation.gates) || manifest.reconciliation.gates.length === 0) throw fail("manifest_reconciliation_claim_invalid");
}

function assertStatusShape(status, expectedState) {
  if (!isPlainObject(status)) throw fail("invalid_status");
  exactKeys(status, ["formatVersion", "status", "runId", "catalogFingerprint", "sourceRole", "isolation", "readOnly", "tableCount", "completedTables", "errorCode"], "status_keys_invalid");
  if (status.formatVersion !== SNAPSHOT_FORMAT_VERSION || status.status !== expectedState || typeof status.runId !== "string" || typeof status.catalogFingerprint !== "string" || status.sourceRole !== "postgres" || status.isolation !== "repeatable read" || status.readOnly !== true || !Number.isSafeInteger(status.tableCount) || !Number.isSafeInteger(status.completedTables) || status.completedTables < 0 || status.tableCount < 0 || (status.errorCode !== null && typeof status.errorCode !== "string")) throw fail("status_metadata_invalid");
  if (status.errorCode !== null) throw fail("status_error_present");
}

function validateTableManifest(entry, catalog, tableNames) {
  exactKeys(entry, ["table", "file", "columns", "primaryKey", "rowCount", "byteCount", "streamHash", "claimHash"], "table_manifest_keys_invalid");
  if (typeof entry.table !== "string" || !tableNames.includes(entry.table) || typeof entry.file !== "string" || typeof entry.rowCount !== "string" || !/^\d+$/.test(entry.rowCount) || typeof entry.byteCount !== "string" || !/^\d+$/.test(entry.byteCount) || !/^[0-9a-f]{64}$/.test(entry.streamHash) || !/^[0-9a-f]{64}$/.test(entry.claimHash) || !Array.isArray(entry.columns) || !Array.isArray(entry.primaryKey)) throw fail("table_manifest_metadata_invalid");
  if (entry.file !== `${TABLE_DIRECTORY}/${tableFileName(entry.table)}`) throw fail("table_file_name_mismatch");
  const primaryKey = getPrimaryKeyInfo(catalog, entry.table);
  const expectedColumns = catalog.columns.filter((column) => column.table_name === entry.table).sort((left, right) => left.ordinal - right.ordinal).map((column) => column.column_name);
  if (JSON.stringify(entry.columns) !== JSON.stringify(expectedColumns) || JSON.stringify(entry.primaryKey) !== JSON.stringify(primaryKey.columns.map(({ name }) => name))) throw fail("table_manifest_columns_mismatch");
  return primaryKey;
}

async function listDirectoryNames(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.map((entry) => entry.name).sort();
}

async function verifyRows({ outputDir, entry, converter, primaryKey }) {
  const relative = assertPrivateRelativePath(entry.file);
  const filePath = path.join(outputDir, relative);
  const stat = await lstatNoSymlink(filePath);
  if (!stat.isFile()) throw fail("table_file_not_regular");
  requireMode(stat, 0o600, "table_file_mode_invalid");
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const maxLineBytes = 16 * 1024 * 1024;
  let pending = "";
  let byteCount = 0;
  let previous = null;
  let ordinal = 0;
  const processLine = (line) => {
    if (line.length === 0) throw fail("empty_row_record");
    if (Buffer.byteLength(line, "utf8") > maxLineBytes) throw fail("row_record_too_large");
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw fail("invalid_row_record_json", error);
    }
    exactKeys(record, ["recordVersion", "ordinal", "primaryKey", "rowHash", "envelope"], "row_record_keys_invalid");
    if (record.recordVersion !== ROW_RECORD_VERSION || record.ordinal !== ordinal || !Array.isArray(record.primaryKey) || !/^[0-9a-f]{64}$/.test(record.rowHash)) throw fail("row_record_metadata_invalid");
    let converted;
    try {
      converted = converter(record.envelope);
    } catch (error) {
      throw fail("row_envelope_invalid", error);
    }
    if (converted.schemaVersion !== ROW_ENVELOPE_VERSION || converted.table !== entry.table) throw fail("row_envelope_identity_invalid");
    let expectedRecord;
    try {
      expectedRecord = rowRecordForEnvelope(record.envelope, primaryKey, ordinal);
    } catch (error) {
      throw fail(error?.code ?? "row_record_key_invalid", error);
    }
    if (record.rowHash !== expectedRecord.rowHash || JSON.stringify(record.primaryKey) !== JSON.stringify(expectedRecord.primaryKey)) throw fail("row_record_hash_or_key_mismatch");
    if (canonicalJson(record) !== line) throw fail("row_record_not_canonical");
    const tuple = record.primaryKey;
    if (previous !== null && compareUtf8Tuple(previous, tuple) >= 0) throw fail("primary_key_order_invalid");
    previous = tuple;
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
        processLine(line);
      }
      if (Buffer.byteLength(pending, "utf8") > maxLineBytes) throw fail("row_record_too_large");
    }
    pending += decoder.decode();
  } catch (error) {
    stream.destroy();
    if (error instanceof SnapshotVerificationError) throw error;
    throw fail("table_stream_read_failed", error);
  }
  if (pending.length !== 0) throw fail("table_missing_terminal_newline");
  const streamHash = hash.digest("hex");
  if (streamHash !== entry.streamHash || String(byteCount) !== entry.byteCount) throw fail("table_digest_mismatch");
  if (String(ordinal) !== entry.rowCount) throw fail("table_row_count_mismatch");
  return { rowCount: ordinal, byteCount, streamHash };
}

async function verifyArtifacts({ manifestPath, requireComplete }) {
  const absoluteManifest = path.resolve(manifestPath);
  const outputDir = path.dirname(absoluteManifest);
  const expectedState = requireComplete ? "complete" : "prepared";
  const expectedManifestName = requireComplete ? SNAPSHOT_MANIFEST_FILE : "snapshot.manifest.prepared.json";
  if (path.basename(absoluteManifest) !== expectedManifestName) throw fail("manifest_path_invalid");
  const rootStat = await lstatNoSymlink(outputDir);
  if (!rootStat.isDirectory()) throw fail("output_not_directory");
  requireMode(rootStat, 0o700, "output_directory_mode_invalid");
  const tablesPath = path.join(outputDir, TABLE_DIRECTORY);
  const tablesStat = await lstatNoSymlink(tablesPath);
  if (!tablesStat.isDirectory()) throw fail("table_directory_invalid");
  requireMode(tablesStat, 0o700, "table_directory_mode_invalid");
  const manifest = await readPrivateJson(absoluteManifest);
  assertManifestShape(manifest, expectedState);
  const status = await readPrivateJson(path.join(outputDir, SNAPSHOT_STATUS_FILE));
  assertStatusShape(status, expectedState);
  if (status.runId !== manifest.runId || status.catalogFingerprint !== manifest.catalogFingerprint || status.tableCount !== manifest.tableCount || status.completedTables !== manifest.tableCount) throw fail("status_manifest_mismatch");
  const catalog = await readPrivateJson(path.join(outputDir, SNAPSHOT_CATALOG_FILE));
  const schemaReport = await readPrivateJson(path.join(outputDir, SNAPSHOT_SCHEMA_REPORT_FILE));
  if (catalogFingerprint(catalog) !== manifest.catalogFingerprint || schemaReportFingerprint(schemaReport) !== manifest.schemaReportFingerprint) throw fail("catalog_or_report_digest_mismatch");
  const convertedSchema = convertSchema(catalog);
  if (schemaReportFingerprint(convertedSchema.report) !== manifest.schemaReportFingerprint || convertedSchema.report.deployable !== manifest.schemaDeployable || convertedSchema.report.unresolvedGateCount !== manifest.unresolvedGateCount) throw fail("schema_report_claim_mismatch");
  const tableNames = getTableNames(catalog);
  if (tableNames.length !== manifest.tableCount || new Set(manifest.tables.map((entry) => entry.table)).size !== tableNames.length || [...new Set(manifest.tables.map((entry) => entry.table))].some((table) => !tableNames.includes(table))) throw fail("manifest_table_set_mismatch");
  const manifestOrder = manifest.tables.map((entry) => entry.table);
  const expectedOrder = [...manifestOrder].sort(compareUtf8);
  if (JSON.stringify(manifestOrder) !== JSON.stringify(expectedOrder)) throw fail("manifest_table_order_invalid");
  const tableEntries = [...manifest.tables].sort((left, right) => compareUtf8(left.table, right.table));
  const seenFiles = new Set();
  for (const entry of tableEntries) {
    const primaryKey = validateTableManifest(entry, catalog, tableNames);
    const converter = compileRowConverter(catalog, entry.table);
    const result = await verifyRows({ outputDir, entry, converter, primaryKey });
    if (result.streamHash !== entry.streamHash || String(result.byteCount) !== entry.byteCount) throw fail("table_digest_mismatch");
    const claim = { table: entry.table, file: entry.file, columns: entry.columns, primaryKey: entry.primaryKey, rowCount: entry.rowCount, byteCount: entry.byteCount, streamHash: entry.streamHash };
    if (sha256Hex(claim) !== entry.claimHash) throw fail("table_claim_hash_mismatch");
    seenFiles.add(entry.file);
  }
  const tableFiles = await listDirectoryNames(tablesPath);
  if (tableFiles.some((name) => name.endsWith(".part") || name.startsWith(".") || !seenFiles.has(`tables/${name}`))) throw fail("unexpected_table_file");
  const rootNames = await listDirectoryNames(outputDir);
  const allowedRoot = new Set([SNAPSHOT_STATUS_FILE, SNAPSHOT_CATALOG_FILE, SNAPSHOT_SCHEMA_REPORT_FILE, TABLE_DIRECTORY, expectedManifestName]);
  if (rootNames.some((name) => !allowedRoot.has(name))) throw fail("unexpected_snapshot_file");
  return {
    valid: true,
    state: expectedState,
    runId: manifest.runId,
    catalogFingerprint: manifest.catalogFingerprint,
    tableCount: manifest.tableCount,
    schemaDeployable: manifest.schemaDeployable,
    unresolvedGateCount: manifest.unresolvedGateCount,
  };
}

export async function verifyPreparedArtifacts(manifestPath) {
  return verifyArtifacts({ manifestPath, requireComplete: false });
}

export async function verifySnapshot(manifestPath) {
  return verifyArtifacts({ manifestPath, requireComplete: true });
}

export const USAGE = `Usage: snapshot-verify.mjs --manifest PATH

Verifies a complete private database snapshot. Prepared or failed artifacts are
always rejected by this public verifier.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  let manifestPath = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manifest") manifestPath = args[++index];
    else if (arg.startsWith("--manifest=")) manifestPath = arg.slice("--manifest=".length);
    else throw fail("invalid_arguments");
  }
  if (!manifestPath) throw fail("missing_manifest");
  const result = await verifySnapshot(manifestPath);
  console.log(`Snapshot verified (${result.tableCount} tables; deployable=${result.schemaDeployable}).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof SnapshotVerificationError || error instanceof SnapshotFormatError ? error.code : "snapshot_verification_failed";
    console.error(`Snapshot verification failed (${code}).`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

/**
 * Export every public PostgreSQL table from one repeatable-read snapshot.
 *
 * The default CLI uses one persistent psql process and standard libpq
 * environment variables. Tests can inject a session implementing the small
 * begin/readCatalog/streamTable/countTable/commit/rollback/close interface;
 * the artifact and verification paths remain identical.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { compileRowConverter } from "./row-conversion.mjs";
import { convertSchema } from "./schema-convert.mjs";
import { verifyPreparedArtifacts, verifySnapshot } from "./snapshot-verify.mjs";
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
  addPrimaryKeyOrder,
  canonicalJson,
  catalogFingerprint,
  compareUtf8Tuple,
  frameSqlForCursor,
  getPrimaryKeyInfo,
  getTableNames,
  quoteIdentifier,
  quoteLiteral,
  randomToken,
  rowRecordForEnvelope,
  schemaReportFingerprint,
  sha256Hex,
  tableFileName,
} from "./snapshot-format.mjs";

export class SnapshotExportError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SnapshotExportError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SnapshotExportError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCount(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw fail("invalid_source_count");
}

function stripFinalSemicolon(sql) {
  const trimmed = String(sql).trimEnd();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
}

export function extractCatalogSelect(sql) {
  // schema-readiness.sql is a checked-in constant. Strip only its leading
  // comments and transaction wrappers; arbitrary SQL is never accepted from
  // the source process or a user argument.
  const withoutLeadingComments = String(sql).replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/g, "");
  const withoutBegin = withoutLeadingComments.replace(/^BEGIN\s+READ\s+ONLY\s*;\s*/i, "");
  return stripFinalSemicolon(withoutBegin.replace(/\s*COMMIT\s*;\s*$/i, ""));
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.write(buffer, offset, buffer.byteLength - offset);
    if (!result || !Number.isInteger(result.bytesWritten) || result.bytesWritten <= 0) throw fail("short_file_write");
    offset += result.bytesWritten;
  }
}

async function writeAtomic(filePath, value) {
  const absolute = path.resolve(filePath);
  const temporary = `${absolute}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await writeAll(handle, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (error instanceof SnapshotExportError) throw error;
    throw fail("local_write_failed", error);
  }
}

async function assertFreshOutputDirectory(outputDir) {
  const absolute = path.resolve(outputDir);
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw fail("output_symlink_rejected");
    if (!stat.isDirectory()) throw fail("output_not_directory");
    const names = await fs.readdir(absolute);
    if (names.length !== 0) throw fail("output_directory_not_empty");
    await fs.chmod(absolute, 0o700);
  } catch (error) {
    if (error instanceof SnapshotExportError) throw error;
    if (error?.code !== "ENOENT") throw fail("output_directory_unavailable", error);
    await fs.mkdir(absolute, { recursive: false, mode: 0o700 });
  }
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail("output_directory_invalid");
  if ((stat.mode & 0o777) !== 0o700) await fs.chmod(absolute, 0o700);
  const tables = path.join(absolute, TABLE_DIRECTORY);
  await fs.mkdir(tables, { mode: 0o700 });
  await fs.chmod(tables, 0o700);
  return absolute;
}

function buildPlans(catalog) {
  const tables = getTableNames(catalog);
  const plans = new Map();
  for (const table of tables) {
    let plan;
    let primaryKey;
    try {
      plan = compileRowConverter(catalog, table);
      primaryKey = getPrimaryKeyInfo(catalog, table);
      // Build the complete query during preflight so unsupported PK/source
      // shapes fail before any table artifact is created.
      addPrimaryKeyOrder(plan.plan, primaryKey);
    } catch (error) {
      throw fail(error?.code ?? "unsupported_table", error);
    }
    plans.set(table, { table, converter: plan, plan: plan.plan, primaryKey });
  }
  return { tables, plans };
}

function framePayload(frame, kind, token, table = null) {
  if (!isPlainObject(frame) || frame.kind !== kind || frame.token !== token) throw fail("source_protocol_frame_invalid");
  if (table !== null && frame.table !== table) throw fail("source_protocol_table_mismatch");
  const expected = kind === "control"
    ? (table === null ? ["kind", "phase", "token", "payload"] : ["kind", "phase", "table", "token", "payload"])
    : (table === null ? ["kind", "token", "payload"] : ["kind", "table", "token", "payload"]);
  const actual = Object.keys(frame).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw fail("source_protocol_frame_invalid");
  return frame.payload;
}

export function parseSourceFrame(line, maxBytes = 16 * 1024 * 1024) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > maxBytes || line.length === 0) throw fail("source_protocol_line_invalid");
  try {
    const frame = JSON.parse(line);
    if (!isPlainObject(frame)) throw new Error("not object");
    return frame;
  } catch (error) {
    throw fail("source_protocol_frame_invalid", error);
  }
}

class PsqlSession {
  #child;
  #stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
  #stdoutPending = "";
  #lines = [];
  #queuedBytes = 0;
  #stdoutPaused = false;
  #waiters = [];
  #stderr = "";
  #closed = false;
  #closing = false;
  #protocolError = null;
  #maxLineBytes;
  #maxQueuedBytes;
  #commandTimeoutMs;

  constructor({ psqlPath = "psql", role = "postgres", commandTimeoutMs = 60_000, maxLineBytes = 16 * 1024 * 1024 } = {}) {
    if (role !== "postgres") throw fail("source_role_must_be_postgres");
    this.#maxLineBytes = maxLineBytes;
    this.#maxQueuedBytes = Math.max(4 * maxLineBytes, 64 * 1024 * 1024);
    this.#commandTimeoutMs = commandTimeoutMs;
    const env = { ...process.env, PGCLIENTENCODING: "UTF8" };
    // psql has no --role option (pg_dump does); role selection is performed by
    // SET LOCAL ROLE after the read-only transaction starts. -w prevents an
    // unattended run from opening an interactive password prompt.
    this.#child = spawn(psqlPath, ["-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.on("error", (error) => {
      this.#protocolError = fail("source_process_error", error);
      this.#rejectWaiters(this.#protocolError);
    });
    this.#child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr += chunk.toString("utf8");
      if (Buffer.byteLength(this.#stderr, "utf8") > 16 * 1024) this.#stderr = this.#stderr.slice(0, 16 * 1024);
      this.#protocolError = fail("source_stderr_output");
      this.#rejectWaiters(this.#protocolError);
    });
    this.#child.on("close", (code, signal) => {
      this.#closed = true;
      try {
        const decoderTail = this.#stdoutDecoder.decode();
        if (decoderTail) this.#stdoutPending += decoderTail;
      } catch (error) {
        this.#protocolError = this.#protocolError ?? fail("source_protocol_decode_failed", error);
      }
      if (this.#stdoutPending.length > 0) this.#protocolError = this.#protocolError ?? fail("source_eof_partial_frame");
      if (code !== 0 || signal) this.#protocolError = this.#protocolError ?? fail("source_process_exit");
      this.#rejectWaiters(this.#protocolError ?? fail("source_eof"));
    });
  }

  #rejectWaiters(error) {
    while (this.#waiters.length) this.#waiters.shift().reject(error);
  }

  #onStdout(chunk) {
    if (this.#closing) return;
    try {
      this.#stdoutPending += this.#stdoutDecoder.decode(chunk, { stream: true });
      let index;
      while ((index = this.#stdoutPending.indexOf("\n")) >= 0) {
        const line = this.#stdoutPending.slice(0, index).replace(/\r$/, "");
        this.#stdoutPending = this.#stdoutPending.slice(index + 1);
        const lineBytes = Buffer.byteLength(line, "utf8") + 1;
        if (Buffer.byteLength(line, "utf8") > this.#maxLineBytes) throw fail("source_protocol_line_too_large");
        const waiter = this.#waiters.shift();
        if (waiter) waiter.resolve(line);
        else {
          this.#lines.push(line);
          this.#queuedBytes += lineBytes;
          if (this.#queuedBytes >= this.#maxQueuedBytes && !this.#stdoutPaused) {
            this.#child.stdout.pause();
            this.#stdoutPaused = true;
          }
        }
      }
      if (Buffer.byteLength(this.#stdoutPending, "utf8") > this.#maxLineBytes) throw fail("source_protocol_line_too_large");
    } catch (error) {
      this.#protocolError = error instanceof SnapshotExportError ? error : fail("source_protocol_decode_failed", error);
      this.#rejectWaiters(this.#protocolError);
    }
  }

  async #write(sql) {
    if (this.#closed || this.#closing || this.#protocolError) throw this.#protocolError ?? fail("source_session_closed");
    await new Promise((resolve, reject) => {
      let settled = false;
      let writable = true;
      const timer = setTimeout(() => finish(fail("source_stdin_timeout")), this.#commandTimeoutMs);
      const onDrain = () => finish();
      const onError = (error) => finish(fail("source_stdin_error", error));
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#child.stdin.removeListener("error", onError);
        this.#child.stdin.removeListener("drain", onDrain);
        if (error) reject(error);
        else resolve();
      };
      this.#child.stdin.once("error", onError);
      writable = this.#child.stdin.write(`${sql}\n`, "utf8", () => {
        if (writable) finish();
      });
      if (!writable) this.#child.stdin.once("drain", onDrain);
    });
  }

  async #nextLine() {
    if (this.#protocolError) throw this.#protocolError;
    if (this.#lines.length) {
      const line = this.#lines.shift();
      this.#queuedBytes = Math.max(0, this.#queuedBytes - Buffer.byteLength(line, "utf8") - 1);
      if (this.#stdoutPaused && this.#queuedBytes < this.#maxQueuedBytes / 2) {
        this.#child.stdout.resume();
        this.#stdoutPaused = false;
      }
      return line;
    }
    if (this.#closed) throw fail("source_eof");
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (line) => {
          clearTimeout(waiter.timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          reject(error);
        },
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(fail("source_command_timeout"));
        }, this.#commandTimeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  async #exec(sql, expectedKind, token, table = null) {
    await this.#write(sql);
    const frame = parseSourceFrame(await this.#nextLine(), this.#maxLineBytes);
    return framePayload(frame, expectedKind, token, table);
  }

  async begin({ timeoutMs = 60_000, role = "postgres" } = {}) {
    if (role !== "postgres") throw fail("source_role_must_be_postgres");
    const token = randomToken("begin");
    const timeout = `${Math.max(1_000, Math.trunc(timeoutMs))}ms`;
    const payload = await this.#exec([
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;",
      `SET LOCAL ROLE ${quoteIdentifier(role)};`,
      `SET LOCAL statement_timeout = ${quoteLiteral(timeout)};`,
      `SET LOCAL lock_timeout = ${quoteLiteral(timeout)};`,
      "SELECT jsonb_build_object(",
      "  'kind', 'control', 'phase', 'begin',",
      `  'token', ${quoteLiteral(token)},`,
      "  'payload', jsonb_build_object(",
      "    'currentUser', current_user, 'sessionUser', session_user,",
      "    'isolation', current_setting('transaction_isolation'),",
      "    'readOnly', current_setting('transaction_read_only'),",
      "    'encoding', current_setting('client_encoding')",
      "  )",
      ")::text;",
    ].join("\n"), "control", token);
    if (!isPlainObject(payload) || payload.currentUser !== "postgres" || payload.isolation !== "repeatable read" || payload.readOnly !== "on" || String(payload.encoding).toUpperCase() !== "UTF8") throw fail("source_transaction_boundary_invalid");
    return { currentUser: payload.currentUser, sessionUser: payload.sessionUser, isolation: payload.isolation, readOnly: true, encoding: payload.encoding };
  }

  async readCatalog(schemaReadinessSql) {
    const scopeToken = randomToken("scope");
    const scope = await this.#exec(`SELECT jsonb_build_object(
      'kind', 'scope',
      'token', ${quoteLiteral(scopeToken)},
      'payload', jsonb_build_object(
        'inheritanceCount', (
          SELECT count(*)::text
          FROM pg_inherits i
          JOIN pg_class child ON child.oid = i.inhrelid
          JOIN pg_namespace childNamespace ON childNamespace.oid = child.relnamespace
          JOIN pg_class parent ON parent.oid = i.inhparent
          JOIN pg_namespace parentNamespace ON parentNamespace.oid = parent.relnamespace
          WHERE childNamespace.nspname = 'public' OR parentNamespace.nspname = 'public'
        ),
        'partitionCount', (
          SELECT count(*)::text
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND (relation.relispartition OR relation.relkind = 'p')
        )
      )
    )::text;`, "scope", scopeToken);
    if (!isPlainObject(scope) || scope.inheritanceCount !== "0" || scope.partitionCount !== "0") {
      throw fail("source_partition_or_inheritance_scope_unsupported");
    }
    const token = randomToken("catalog");
    const inner = extractCatalogSelect(schemaReadinessSql);
    const payload = await this.#exec(`SELECT jsonb_build_object('kind','catalog','token',${quoteLiteral(token)},'payload',(${inner}))::text;`, "catalog", token);
    if (!isPlainObject(payload) || !Array.isArray(payload.columns) || !Array.isArray(payload.constraints) || !Array.isArray(payload.indexes) || !Array.isArray(payload.enums)) throw fail("source_catalog_invalid");
    return payload;
  }

  async *streamTable({ table, plan, primaryKey, fetchSize = 100, runToken }) {
    const cursor = `snapshot_${randomBytes(10).toString("hex")}`;
    const token = runToken ?? randomToken("table");
    const cursorSql = frameSqlForCursor(plan, primaryKey, token, cursor);
    await this.#exec(`${cursorSql}\nSELECT jsonb_build_object('kind','control','phase','declare','token',${quoteLiteral(token)},'table',${quoteLiteral(table)},'payload',true)::text;`, "control", token, table);
    try {
      // stdout is paused at a bounded queue watermark while rows are yielded,
      // so the requested FETCH size can be honored without unbounded JS memory.
      const batchSize = Math.max(1, Math.min(10_000, Math.trunc(fetchSize)));
      while (true) {
        const batchToken = randomToken("fetch");
        await this.#write(`FETCH FORWARD ${batchSize} ${quoteIdentifier(cursor)};\nSELECT jsonb_build_object('kind','control','phase','fetch-end','token',${quoteLiteral(batchToken)},'table',${quoteLiteral(table)},'payload',true)::text;`);
        let rowCount = 0;
        while (true) {
          const frame = parseSourceFrame(await this.#nextLine(), this.#maxLineBytes);
          if (frame.kind === "row") {
            const keys = Object.keys(frame).sort();
            if (JSON.stringify(keys) !== JSON.stringify(["kind", "payload", "table", "token"]) || frame.token !== token || frame.table !== table || typeof frame.payload !== "string") throw fail("source_row_frame_invalid");
            let envelope;
            try {
              envelope = JSON.parse(frame.payload);
            } catch (error) {
              throw fail("source_row_envelope_json_invalid", error);
            }
            rowCount += 1;
            yield envelope;
            continue;
          }
          if (frame.kind === "control" && frame.phase === "fetch-end" && frame.token === batchToken && frame.table === table) {
            const keys = Object.keys(frame).sort();
            if (JSON.stringify(keys) !== JSON.stringify(["kind", "payload", "phase", "table", "token"])) throw fail("source_protocol_frame_invalid");
            break;
          }
          throw fail("source_protocol_frame_invalid");
        }
        if (rowCount < batchSize) break;
      }
    } finally {
      const closeToken = randomToken("close");
      try {
        await this.#exec(`CLOSE ${quoteIdentifier(cursor)}; SELECT jsonb_build_object('kind','control','phase','close','token',${quoteLiteral(closeToken)},'table',${quoteLiteral(table)},'payload',true)::text;`, "control", closeToken, table);
      } catch (error) {
        if (!this.#protocolError) throw error;
      }
    }
  }

  async countTable(table) {
    const token = randomToken("count");
    const payload = await this.#exec(`SELECT jsonb_build_object('kind','count','token',${quoteLiteral(token)},'table',${quoteLiteral(table)},'payload',(SELECT count(*)::text FROM ${quoteIdentifier("public")}.${quoteIdentifier(table)}))::text;`, "count", token, table);
    if (typeof payload !== "string" || !/^\d+$/.test(payload)) throw fail("source_count_invalid");
    return payload;
  }

  async commit() {
    const token = randomToken("commit");
    await this.#exec(`COMMIT; SELECT jsonb_build_object('kind','control','phase','commit','token',${quoteLiteral(token)},'payload',true)::text;`, "control", token);
  }

  async rollback() {
    if (this.#closed) return;
    try {
      await this.#write("ROLLBACK;");
    } catch {
      // Best effort. The caller receives the original bounded error code.
    }
  }

  async close() {
    if (this.#closed) return;
    if (this.#closing) throw fail("source_shutdown_unconfirmed");
    this.#closing = true;
    // No further protocol data is useful once shutdown begins. Discard queued
    // frames and release command waiters while the child close event remains
    // the only authoritative terminal state.
    this.#lines.length = 0;
    this.#queuedBytes = 0;
    this.#rejectWaiters(fail("source_shutdown_unconfirmed"));
    // A paused stdout pipe can otherwise keep psql alive after stdin closes.
    this.#child.stdout.resume();
    this.#stdoutPaused = false;
    try {
      this.#child.stdin.end();
    } catch {
      // The close/kill path below is still bounded.
    }
    const deadline = Date.now() + 2_000;
    while (!this.#closed && Date.now() < deadline) await sleep(25);
    if (!this.#closed) this.#child.kill("SIGTERM");
    const killDeadline = Date.now() + 1_000;
    while (!this.#closed && Date.now() < killDeadline) await sleep(25);
    if (!this.#closed) {
      this.#child.kill("SIGKILL");
      const finalDeadline = Date.now() + 1_000;
      while (!this.#closed && Date.now() < finalDeadline) await sleep(25);
    }
    if (!this.#closed) {
      this.#child.stdout.destroy();
      this.#child.stderr.destroy();
      this.#child.stdin.destroy();
      throw fail("source_shutdown_unconfirmed");
    }
  }
}

export function createPsqlSession(options = {}) {
  return new PsqlSession(options);
}

async function writeTableFile({ outputDir, table, entry, converter, primaryKey, session, plans, runToken, maxRowBytes }) {
  const fileName = tableFileName(table);
  const relative = `${TABLE_DIRECTORY}/${fileName}`;
  const finalPath = path.join(outputDir, relative);
  const partPath = `${finalPath}.part`;
  const handle = await fs.open(partPath, "wx", 0o600);
  const hash = createHash("sha256");
  let byteCount = 0;
  let rowCount = 0n;
  let previous = null;
  try {
    for await (const item of session.streamTable({ table, plan: plans.get(table).plan, primaryKey, runToken, fetchSize: entry.fetchSize ?? 100 })) {
      const envelope = isPlainObject(item) && Object.hasOwn(item, "envelope") ? item.envelope : item;
      let converted;
      try {
        converted = converter(envelope);
      } catch (error) {
        throw fail("row_conversion_failed", error);
      }
      const record = rowRecordForEnvelope(envelope, primaryKey, Number(rowCount));
      if (previous !== null && compareUtf8Tuple(previous, record.primaryKey) >= 0) throw fail("source_primary_key_order_invalid");
      previous = record.primaryKey;
      const line = Buffer.from(`${canonicalJson(record)}\n`, "utf8");
      if (line.byteLength > maxRowBytes) throw fail("row_record_too_large");
      await writeAll(handle, line);
      hash.update(line);
      byteCount += line.byteLength;
      rowCount += 1n;
      if (rowCount > BigInt(Number.MAX_SAFE_INTEGER)) throw fail("row_count_unsafe");
      // Keep the conversion result live so an implementation cannot silently
      // validate a different envelope than the one written to disk.
      if (!converted || converted.table !== table) throw fail("row_conversion_identity_invalid");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const streamHash = hash.digest("hex");
  const count = normalizeCount(await session.countTable(table));
  if (count !== rowCount) {
    await fs.rm(partPath, { force: true });
    throw fail("source_row_count_mismatch");
  }
  await fs.chmod(partPath, 0o600);
  await fs.rename(partPath, finalPath);
  const claims = {
    table,
    file: relative,
    columns: converter.plan.columns.map(({ name }) => name),
    primaryKey: primaryKey.columns.map(({ name }) => name),
    rowCount: rowCount.toString(),
    byteCount: String(byteCount),
    streamHash,
  };
  return { ...claims, claimHash: sha256Hex(claims) };
}

async function cleanFailedArtifacts(outputDir) {
  await fs.rm(path.join(outputDir, SNAPSHOT_MANIFEST_FILE), { force: true }).catch(() => {});
  await fs.rm(path.join(outputDir, "snapshot.manifest.prepared.json"), { force: true }).catch(() => {});
  const tablesPath = path.join(outputDir, TABLE_DIRECTORY);
  const names = await fs.readdir(tablesPath).catch(() => []);
  for (const name of names) await fs.rm(path.join(tablesPath, name), { force: true }).catch(() => {});
}

function validateBeginMetadata(metadata) {
  if (!isPlainObject(metadata) || metadata.currentUser !== "postgres" || metadata.isolation !== "repeatable read" || metadata.readOnly !== true) throw fail("source_transaction_boundary_invalid");
}

export async function exportSnapshot({
  catalog,
  outputDir,
  session = null,
  sessionFactory = null,
  role = "postgres",
  schemaReadinessSql = null,
  timeoutMs = 60_000,
  fetchSize = 100,
  maxRowBytes = 16 * 1024 * 1024,
  psqlPath = "psql",
} = {}) {
  if (role !== "postgres") throw fail("source_role_must_be_postgres");
  if (!isPlainObject(catalog) || typeof outputDir !== "string") throw fail("missing_export_input");
  const output = await assertFreshOutputDirectory(outputDir);
  const runId = randomToken("run");
  let catalogHash = "0".repeat(64);
  try {
    catalogHash = catalogFingerprint(catalog);
  } catch {
    // Failed-catalog runs still get a bounded private status record; the
    // caller must create a fresh directory after correcting the input.
  }
  const roughTableCount = Array.isArray(catalog.columns) ? new Set(catalog.columns.map((column) => column?.table_name).filter((name) => typeof name === "string")).size : 0;
  const statusBase = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    runId,
    catalogFingerprint: catalogHash,
    sourceRole: role,
    isolation: "repeatable read",
    readOnly: true,
    tableCount: roughTableCount,
  };
  let schema;
  let tables;
  let plans;
  let reportHash;
  try {
    schema = convertSchema(catalog);
    ({ tables, plans } = buildPlans(catalog));
    reportHash = schemaReportFingerprint(schema.report);
    statusBase.tableCount = tables.length;
  } catch (error) {
    const code = typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code) ? error.code : "invalid_catalog";
    await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "failed", completedTables: 0, errorCode: code }).catch(() => {});
    await cleanFailedArtifacts(output);
    if (error instanceof SnapshotExportError) throw error;
    if (typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)) throw fail(error.code, error);
    throw fail(code, error);
  }
  await writeAtomic(path.join(output, SNAPSHOT_CATALOG_FILE), catalog);
  await writeAtomic(path.join(output, SNAPSHOT_SCHEMA_REPORT_FILE), schema.report);
  let completedTables = 0;
  await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "in_progress", completedTables, errorCode: null });
  let source = session;
  let committed = false;
  try {
    if (!source) {
      source = sessionFactory
        ? await sessionFactory({ catalog, plans, runId, role, timeoutMs, fetchSize })
        : createPsqlSession({ psqlPath, role, commandTimeoutMs: timeoutMs, maxLineBytes: maxRowBytes });
    }
    const metadata = await source.begin({ timeoutMs, role });
    validateBeginMetadata(metadata);
    const catalogSql = schemaReadinessSql ?? await fs.readFile(new URL("./schema-readiness.sql", import.meta.url), "utf8");
    const liveCatalog = source.readCatalog ? await source.readCatalog(catalogSql) : null;
    if (!liveCatalog || catalogFingerprint(liveCatalog) !== catalogHash) throw fail("source_catalog_fingerprint_mismatch");
    const entries = [];
    for (const table of tables) {
      const plan = plans.get(table);
      const entry = await writeTableFile({
        outputDir: output,
        table,
        entry: { fetchSize },
        converter: plan.converter,
        primaryKey: plan.primaryKey,
        session: source,
        plans,
        runToken: `${runId}-${table}`,
        maxRowBytes,
      });
      entries.push(entry);
      completedTables += 1;
      await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "in_progress", completedTables, errorCode: null });
    }
    const manifest = {
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      state: "prepared",
      runId,
      catalogFingerprint: catalogHash,
      schemaConversionVersion: schema.report.schemaVersion,
      rowEnvelopeVersion: ROW_ENVELOPE_VERSION,
      schemaReportFingerprint: reportHash,
      schemaDeployable: schema.report.deployable,
      unresolvedGateCount: schema.report.unresolvedGateCount,
      sourceRole: role,
      isolation: "repeatable read",
      readOnly: true,
      tableCount: tables.length,
      reconciliation: {
        primaryKeys: "verified",
        uniqueConstraints: "not_checked",
        foreignKeys: "not_checked",
        gates: ["unique_and_foreign_key_reconciliation_pending", "external_identity_scope_requires_separate_auth_binding"],
      },
      tables: entries.sort((left, right) => compareUtf8Tuple([left.table], [right.table])),
    };
    await writeAtomic(path.join(output, "snapshot.manifest.prepared.json"), manifest);
    await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "prepared", completedTables: tables.length, errorCode: null });
    await verifyPreparedArtifacts(path.join(output, "snapshot.manifest.prepared.json"));
    await source.commit();
    committed = true;
    await writeAtomic(path.join(output, SNAPSHOT_MANIFEST_FILE), { ...manifest, state: "complete" });
    await fs.rm(path.join(output, "snapshot.manifest.prepared.json"), { force: true });
    await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "complete", completedTables: tables.length, errorCode: null });
    await verifySnapshot(path.join(output, SNAPSHOT_MANIFEST_FILE));
    await source.close();
    return { outputDir: output, manifestPath: path.join(output, SNAPSHOT_MANIFEST_FILE), runId, tableCount: tables.length, schemaDeployable: schema.report.deployable, unresolvedGateCount: schema.report.unresolvedGateCount };
  } catch (error) {
    if (!committed && source) await Promise.resolve(source.rollback?.()).catch(() => {});
    await Promise.resolve(source?.close?.()).catch(() => {});
    await cleanFailedArtifacts(output);
    const code = typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)
      ? error.code
      : "snapshot_export_failed";
    await writeAtomic(path.join(output, SNAPSHOT_STATUS_FILE), { ...statusBase, status: "failed", completedTables, errorCode: code }).catch(() => {});
    if (error instanceof SnapshotExportError) throw error;
    if (typeof error?.code === "string" && /^[a-z0-9_]+$/.test(error.code)) throw fail(error.code, error);
    throw fail(code, error);
  }
}

export const USAGE = `Usage: snapshot-export.mjs --catalog PATH --output-dir PATH --role postgres [--fetch-size N] [--timeout-ms N]

Reads a private schema-readiness catalog and exports all public tables through
one read-only repeatable-read PostgreSQL session. Credentials come only from
the standard libpq environment; no source rows or secrets are printed.
`;

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    const name = equals >= 0 ? arg.slice(0, equals) : arg;
    const value = equals >= 0 ? arg.slice(equals + 1) : args[++index];
    if (name === "--catalog") values.catalog = value;
    else if (name === "--output-dir") values.outputDir = value;
    else if (name === "--role") values.role = value;
    else if (name === "--fetch-size") values.fetchSize = Number(value);
    else if (name === "--timeout-ms") values.timeoutMs = Number(value);
    else if (name === "--psql") values.psqlPath = value;
    else throw fail("invalid_arguments");
  }
  return values;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const values = parseArgs(args);
  if (!values.catalog || !values.outputDir || values.role !== "postgres") throw fail("missing_or_invalid_argument");
  if (values.fetchSize !== undefined && (!Number.isSafeInteger(values.fetchSize) || values.fetchSize < 1 || values.fetchSize > 10_000)) throw fail("invalid_fetch_size");
  if (values.timeoutMs !== undefined && (!Number.isSafeInteger(values.timeoutMs) || values.timeoutMs < 1_000 || values.timeoutMs > 300_000)) throw fail("invalid_timeout");
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(path.resolve(values.catalog), "utf8"));
  } catch (error) {
    throw fail("invalid_catalog_file", error);
  }
  // The CLI reads the exact SQL text shipped with this repository. Keeping it
  // out of argv also prevents shell quoting and credential leakage surprises.
  const schemaReadinessSql = await fs.readFile(new URL("./schema-readiness.sql", import.meta.url), "utf8");
  const result = await exportSnapshot({ ...values, catalog, schemaReadinessSql });
  console.log(`Snapshot exported to ${result.outputDir}.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof SnapshotExportError || error instanceof SnapshotFormatError ? error.code : "snapshot_export_failed";
    console.error(`Snapshot export failed (${code}).`);
    process.exitCode = 1;
  });
}

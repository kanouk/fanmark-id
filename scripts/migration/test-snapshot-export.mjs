#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createPsqlSession, exportSnapshot, extractCatalogSelect, parseSourceFrame } from "./snapshot-export.mjs";
import { verifySnapshot } from "./snapshot-verify.mjs";
import { canonicalJson, sha256Hex } from "./snapshot-format.mjs";

const ROOT = path.join(os.tmpdir(), "fanmark-snapshot-tests-");

function column(table_name, column_name, ordinal, postgres_type, options = {}) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: options.type_schema ?? "pg_catalog",
    type_name: options.type_name ?? postgres_type,
    type_kind: options.type_kind ?? "b",
    not_null: options.not_null ?? false,
    default_expression: null,
    identity: "",
    generated: "",
    collation: null,
  };
}

function catalog() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("alpha", "id", 1, "uuid", { not_null: true }),
      column("alpha", "value", 2, "text"),
      column("numeric_keys", "id", 1, "bigint", { not_null: true }),
      column("numeric_keys", "label", 2, "text"),
      column("composite_keys", "first_id", 1, "uuid", { not_null: true }),
      column("composite_keys", "second_id", 2, "bigint", { not_null: true }),
      column("composite_keys", "label", 3, "text"),
    ],
    constraints: [
      { table_name: "alpha", name: "alpha_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
      { table_name: "numeric_keys", name: "numeric_keys_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
      { table_name: "composite_keys", name: "composite_keys_pkey", kind: "p", definition: "PRIMARY KEY (first_id, second_id)", validated: true, deferrable: false, initially_deferred: false },
    ],
    indexes: [],
    enums: [],
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
}

const UUID1 = "00000000-0000-4000-8000-000000000001";
const UUID2 = "00000000-0000-4000-8000-000000000002";

const envelopes = {
  alpha: [
    { schemaVersion: 1, table: "alpha", columns: ["id", "value"], values: { id: UUID1, value: "one" }, arrayMetadata: {} },
    { schemaVersion: 1, table: "alpha", columns: ["id", "value"], values: { id: UUID2, value: "two" }, arrayMetadata: {} },
  ],
  // PostgreSQL's ordered text representation puts 10 before 9. The verifier
  // must accept that source order and reject a numeric/locale-derived order.
  numeric_keys: [
    { schemaVersion: 1, table: "numeric_keys", columns: ["id", "label"], values: { id: "10", label: "ten" }, arrayMetadata: {} },
    { schemaVersion: 1, table: "numeric_keys", columns: ["id", "label"], values: { id: "9", label: "nine" }, arrayMetadata: {} },
  ],
  composite_keys: [
    { schemaVersion: 1, table: "composite_keys", columns: ["first_id", "second_id", "label"], values: { first_id: UUID1, second_id: "1", label: "a" }, arrayMetadata: {} },
    { schemaVersion: 1, table: "composite_keys", columns: ["first_id", "second_id", "label"], values: { first_id: UUID1, second_id: "2", label: "b" }, arrayMetadata: {} },
  ],
};

function fakeSession({ rows = envelopes, countOverride = null, liveCatalog = catalog(), commitError = null } = {}) {
  return {
    async begin() {
      return { currentUser: "postgres", isolation: "repeatable read", readOnly: true };
    },
    async readCatalog() {
      return liveCatalog;
    },
    async *streamTable({ table }) {
      for (const envelope of rows[table] ?? []) yield envelope;
    },
    async countTable(table) {
      return countOverride?.[table] ?? String((rows[table] ?? []).length);
    },
    async commit() {
      if (commitError) throw new Error(commitError);
    },
    async rollback() {},
    async close() {},
  };
}

async function tempOutput() {
  const directory = await mkdtemp(ROOT);
  await rm(directory, { recursive: true, force: true });
  return directory;
}

test("exports every catalog table and verifies bounded canonical streams", async () => {
  const outputDir = await tempOutput();
  let result;
  try { result = await exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession() }); } catch (error) { throw error; }
  assert.equal(result.tableCount, 3);
  const verified = await verifySnapshot(result.manifestPath);
  assert.equal(verified.valid, true);
  assert.equal(verified.tableCount, 3);
  assert.equal(verified.schemaDeployable, false);
  const rootStat = await stat(outputDir);
  const tableStat = await stat(path.join(outputDir, "tables"));
  assert.equal(rootStat.mode & 0o777, 0o700);
  assert.equal(tableStat.mode & 0o777, 0o700);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.state, "complete");
  assert.equal(manifest.reconciliation.foreignKeys, "not_checked");
  assert.deepEqual(manifest.tables.map((entry) => entry.table), ["alpha", "composite_keys", "numeric_keys"]);
  const tableNames = await readdir(path.join(outputDir, "tables"));
  assert.equal(tableNames.length, 3);
  for (const name of tableNames) assert.equal((await stat(path.join(outputDir, "tables", name))).mode & 0o777, 0o600);
  await rm(outputDir, { recursive: true, force: true });
});

test("rejects source count drift and leaves an unusable failed run", async () => {
  const outputDir = await tempOutput();
  await assert.rejects(
    exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession({ countOverride: { alpha: "3" } }) }),
    (error) => error.code === "source_row_count_mismatch",
  );
  const status = JSON.parse(await readFile(path.join(outputDir, "snapshot.status.json"), "utf8"));
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "source_row_count_mismatch");
  await assert.rejects(verifySnapshot(path.join(outputDir, "snapshot.manifest.json")), (error) => error.code === "missing_artifact");
  assert.deepEqual(await readdir(path.join(outputDir, "tables")), []);
  await rm(outputDir, { recursive: true, force: true });
});

test("rejects live catalog drift before writing rows", async () => {
  const outputDir = await tempOutput();
  const changed = catalog();
  changed.columns[1].column_name = "changed_value";
  await assert.rejects(
    exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession({ liveCatalog: changed }) }),
    (error) => error.code === "source_catalog_fingerprint_mismatch",
  );
  const status = JSON.parse(await readFile(path.join(outputDir, "snapshot.status.json"), "utf8"));
  assert.equal(status.status, "failed");
  assert.deepEqual(await readdir(path.join(outputDir, "tables")), []);
  await rm(outputDir, { recursive: true, force: true });
});

test("fails closed for a primary-key representation outside the reviewed UUID/bigint boundary", async () => {
  const outputDir = await tempOutput();
  const unsupported = catalog();
  unsupported.columns[0].postgres_type = "text";
  unsupported.columns[0].type_name = "text";
  await assert.rejects(
    exportSnapshot({ catalog: unsupported, outputDir, session: fakeSession({ liveCatalog: unsupported }) }),
    (error) => error.code === "unsupported_primary_key_type",
  );
  const status = JSON.parse(await readFile(path.join(outputDir, "snapshot.status.json"), "utf8"));
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "unsupported_primary_key_type");
  await rm(outputDir, { recursive: true, force: true });
});

test("rejects noncanonical PK text even when its line hash is recomputed", async () => {
  const outputDir = await tempOutput();
  const badRows = structuredClone(envelopes);
  badRows.alpha = [{ ...badRows.alpha[0], values: { ...badRows.alpha[0].values, id: "A0000000-0000-4000-8000-000000000001" } }];
  await assert.rejects(
    exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession({ rows: badRows }) }),
    (error) => error.code === "noncanonical_primary_key",
  );
  await rm(outputDir, { recursive: true, force: true });
});

test("rejects malformed source protocol frames and keeps credential-free framing", () => {
  const valid = canonicalJson({ kind: "control", token: "t", payload: true });
  assert.deepEqual(parseSourceFrame(valid), { kind: "control", token: "t", payload: true });
  assert.throws(() => parseSourceFrame("not-json"), (error) => error.code === "source_protocol_frame_invalid");
  assert.throws(() => parseSourceFrame(JSON.stringify({ kind: "control", token: "t", payload: "x" }), 4), (error) => error.code === "source_protocol_line_invalid");
});

test("extracts the checked-in catalog SELECT after leading comments and wrappers", async () => {
  const sourceSql = await readFile(new URL("./schema-readiness.sql", import.meta.url), "utf8").catch(async () => readFile(path.resolve("scripts/migration/schema-readiness.sql"), "utf8"));
  const inner = extractCatalogSelect(sourceSql);
  assert.match(inner, /^SELECT\s+jsonb_build_object/i);
  assert.doesNotMatch(inner, /BEGIN\s+READ\s+ONLY|COMMIT\s*;\s*$/i);
});

test("bounds a failed psql child without opening an interactive credential prompt", async () => {
  const session = createPsqlSession({ psqlPath: "/usr/bin/false", commandTimeoutMs: 100 });
  await assert.rejects(session.begin({ timeoutMs: 100 }), (error) => ["source_process_exit", "source_stderr_output", "source_eof"].includes(error.code));
  await session.close();
});

test("rejects invalid UTF-8 from the psql protocol", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fanmark-fake-psql-"));
  const fakePsql = path.join(directory, "fake-psql.sh");
  await writeFile(fakePsql, "#!/bin/sh\nwhile IFS= read -r line; do printf '\\377\\n'; exit 0; done\n", { mode: 0o700 });
  await chmod(fakePsql, 0o700);
  const session = createPsqlSession({ psqlPath: fakePsql, commandTimeoutMs: 200 });
  await assert.rejects(session.begin({ timeoutMs: 200 }), (error) => ["source_protocol_decode_failed", "source_process_exit", "source_command_timeout"].includes(error.code));
  await session.close();
  await rm(directory, { recursive: true, force: true });
});

test("verifier rejects tampering, partial streams, and extra files", async () => {
  const outputDir = await tempOutput();
  const result = await exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession() });
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  const entry = manifest.tables[0];
  const tablePath = path.join(outputDir, entry.file);
  const original = await readFile(tablePath);
  await writeFile(tablePath, Buffer.concat([original, Buffer.from("\n")]), { mode: 0o600 });
  await assert.rejects(verifySnapshot(result.manifestPath), (error) => error.code === "empty_row_record");
  await writeFile(tablePath, original, { mode: 0o600 });
  await writeFile(tablePath, original.subarray(0, -1), { mode: 0o600 });
  await assert.rejects(verifySnapshot(result.manifestPath), (error) => error.code === "table_missing_terminal_newline");
  await writeFile(tablePath, original, { mode: 0o600 });
  await writeFile(path.join(outputDir, "tables", "unexpected.part"), "x", { mode: 0o600 });
  await assert.rejects(verifySnapshot(result.manifestPath), (error) => error.code === "unexpected_table_file");
  await rm(outputDir, { recursive: true, force: true });
});

test("verifier rejects a noncanonical PK after an attacker recomputes row and stream hashes", async () => {
  const outputDir = await tempOutput();
  const result = await exportSnapshot({ catalog: catalog(), outputDir, session: fakeSession() });
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  const entry = manifest.tables.find((candidate) => candidate.table === "alpha");
  const tablePath = path.join(outputDir, entry.file);
  const records = (await readFile(tablePath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
  records[0].envelope.values.id = "A0000000-0000-4000-8000-000000000001";
  records[0].primaryKey = [records[0].envelope.values.id];
  records[0].rowHash = sha256Hex(records[0].envelope);
  const content = Buffer.from(`${records.map((record) => canonicalJson(record)).join("\n")}\n`, "utf8");
  await writeFile(tablePath, content, { mode: 0o600 });
  entry.streamHash = sha256Hex(content);
  entry.byteCount = String(content.byteLength);
  const claims = { table: entry.table, file: entry.file, columns: entry.columns, primaryKey: entry.primaryKey, rowCount: entry.rowCount, byteCount: entry.byteCount, streamHash: entry.streamHash };
  entry.claimHash = sha256Hex(claims);
  await writeFile(result.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(verifySnapshot(result.manifestPath), (error) => error.code === "noncanonical_primary_key");
  await rm(outputDir, { recursive: true, force: true });
});

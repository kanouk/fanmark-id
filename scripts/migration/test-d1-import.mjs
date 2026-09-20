#!/usr/bin/env node

/**
 * Synthetic D1 importer tests. The default migration test command can run this
 * file without a remote binding; the Miniflare case exercises an actual local
 * D1 implementation and never reads application data.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { convertSchema } from "./schema-convert.mjs";
import { createTargetIncarnation, importD1Snapshot } from "./d1-import.mjs";
import { exportSnapshot } from "./snapshot-export.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nodeModulesMiniflare = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");

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

function fixtureCatalog() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("parent", "id", 1, "uuid", { not_null: true }),
      column("parent", "label", 2, "text", { not_null: true }),
      column("parent", "amount", 3, "numeric"),
      column("parent", "payload", 4, "jsonb"),
      column("parent", "tags", 5, "text[]"),
      column("child", "id", 1, "uuid", { not_null: true }),
      column("child", "parent_id", 2, "uuid", { not_null: true }),
      column("child", "event_at", 3, "timestamp with time zone", { not_null: true }),
      column("child", "note", 4, "date"),
      column("child", "enabled", 5, "boolean", { not_null: true }),
      column("child", "scores", 6, "smallint[]"),
    ],
    constraints: [
      { table_name: "parent", name: "parent_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
      { table_name: "child", name: "child_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
      { table_name: "child", name: "child_parent_fkey", kind: "f", definition: "FOREIGN KEY (parent_id) REFERENCES public.parent (id) ON DELETE RESTRICT ON UPDATE RESTRICT", validated: true, deferrable: false, initially_deferred: false },
    ],
    indexes: [],
    enums: [],
    // These scopes intentionally produce unresolved gates. The local test
    // records them through allowUnresolvedGates and still keeps deployable
    // false; it never turns an external Auth relation into a placeholder.
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
}

const parentId = "00000000-0000-4000-8000-000000000001";
const childId = "00000000-0000-4000-8000-000000000002";
const passwordConfigId = "00000000-0000-4000-8000-000000000010";

function fixtureRows() {
  return {
    parent: [
      {
        schemaVersion: 1,
        table: "parent",
        columns: ["id", "label", "amount", "payload", "tags"],
        values: { id: parentId, label: "parent row", amount: "12.34", payload: '{"n":1,"text":"null"}', tags: '["alpha","alpha"]' },
        arrayMetadata: { tags: { isNull: false, ndims: 1, lowerBound: 1 } },
      },
    ],
    child: [
      {
        schemaVersion: 1,
        table: "child",
        columns: ["id", "parent_id", "event_at", "note", "enabled", "scores"],
        values: { id: childId, parent_id: parentId, event_at: "2026-09-21T12:34:56.123456Z", note: "2026-09-21", enabled: "t", scores: "[1,-2,1]" },
        arrayMetadata: { scores: { isNull: false, ndims: 1, lowerBound: 1 } },
      },
    ],
  };
}

function twoParentRows() {
  const rows = fixtureRows();
  rows.parent.push({
    ...structuredClone(rows.parent[0]),
    values: {
      ...rows.parent[0].values,
      id: "00000000-0000-4000-8000-000000000003",
      label: "second parent",
      amount: "99.00",
      payload: '{"n":2}',
      tags: '["beta"]',
    },
  });
  return rows;
}

function authFixture() {
  const catalog = fixtureCatalog();
  catalog.columns.push(column("parent", "auth_user_id", 6, "uuid"));
  catalog.constraints.push({
    table_name: "parent",
    name: "parent_auth_user_fkey",
    kind: "f",
    definition: "FOREIGN KEY (auth_user_id) REFERENCES auth.users (id)",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  });
  const rows = fixtureRows();
  rows.parent[0].columns.push("auth_user_id");
  rows.parent[0].values.auth_user_id = "00000000-0000-4000-8000-000000000099";
  return { catalog, rows };
}

function credentialFixture() {
  const catalog = fixtureCatalog();
  catalog.columns.push(
    column("fanmark_password_configs", "id", 1, "uuid", { not_null: true }),
    column("fanmark_password_configs", "license_id", 2, "uuid", { not_null: true }),
    column("fanmark_password_configs", "access_password", 3, "text", { not_null: true }),
    column("fanmark_password_configs", "is_enabled", 4, "boolean", { not_null: true }),
    column("fanmark_password_configs", "created_at", 5, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone", { not_null: true }),
  );
  catalog.constraints.push({
    table_name: "fanmark_password_configs",
    name: "fanmark_password_configs_pkey",
    kind: "p",
    definition: "PRIMARY KEY (id)",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  });
  const rows = fixtureRows();
  rows.fanmark_password_configs = [{
    schemaVersion: 1,
    table: "fanmark_password_configs",
    columns: ["id", "license_id", "access_password", "is_enabled", "created_at", "updated_at"],
    values: {
      id: passwordConfigId,
      license_id: parentId,
      access_password: "0123",
      is_enabled: "t",
      created_at: "2026-09-21T12:34:56.123456Z",
      updated_at: "2026-09-21T12:34:56.123456Z",
    },
    arrayMetadata: {},
  }];
  return { catalog, rows };
}

function largePayloadFixture(length) {
  const catalog = fixtureCatalog();
  const rows = fixtureRows();
  rows.parent[0].values.payload = JSON.stringify("x".repeat(length));
  return { catalog, rows };
}

function wideFixture(columnCount, nameLength = 8) {
  const columns = [column("wide", "id", 1, "uuid", { not_null: true })];
  const values = { id: parentId };
  const names = ["id"];
  for (let index = 0; index < columnCount - 1; index += 1) {
    const name = `c${"x".repeat(Math.max(0, nameLength - String(index).length - 1))}${index}`;
    names.push(name);
    columns.push(column("wide", name, index + 2, "text"));
    values[name] = `value-${index}`;
  }
  return {
    catalog: {
      observed_at: "2026-09-21T00:00:00Z",
      columns,
      constraints: [{ table_name: "wide", name: "wide_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false }],
      indexes: [],
      enums: [],
      triggers: [],
      rls_policies: [],
      views: [],
      functions: [],
    },
    rows: {
      wide: [{ schemaVersion: 1, table: "wide", columns: names, values, arrayMetadata: {} }],
    },
  };
}

function fakeSession(catalog, rows) {
  return {
    async begin() {
      return { currentUser: "postgres", isolation: "repeatable read", readOnly: true };
    },
    async readCatalog() {
      return catalog;
    },
    async *streamTable({ table }) {
      for (const envelope of rows[table] ?? []) yield envelope;
    },
    async countTable(table) {
      return String((rows[table] ?? []).length);
    },
    async commit() {},
    async rollback() {},
    async close() {},
  };
}

async function makeSnapshot({ catalog = fixtureCatalog(), rows = fixtureRows() } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-d1-snapshot-"));
  const result = await exportSnapshot({ catalog, outputDir: directory, session: fakeSession(catalog, rows) });
  return { directory, manifestPath: result.manifestPath, runId: result.runId, catalog, rows };
}

function splitSqlStatements(sql) {
  // The generated preamble contains a prose comment with the token
  // "BEGIN/COMMIT;"; remove line comments before splitting for D1 execution.
  sql = sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, "");
  const statements = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] === "'") {
      if (quoted && sql[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && sql[index] === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function createLocalD1(schemaSql) {
  let Miniflare;
  try {
    ({ Miniflare } = await import(pathToFileURL(nodeModulesMiniflare).href));
  } catch (error) {
    throw new Error("local_miniflare_unavailable", { cause: error });
  }
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "d1-import-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "d1-import-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("DB");
  const statements = splitSqlStatements(schemaSql).map((sql) => database.prepare(sql));
  const results = await database.batch(statements);
  assert.equal(results.every((result) => result.success === true), true);
  return { miniflare, database };
}

async function openFixture(options = {}) {
  const snapshot = await makeSnapshot(options);
  const reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-d1-report-"));
  await fs.chmod(reportDirectory, 0o700);
  const reportPath = path.join(reportDirectory, "d1-import.report.json");
  const schema = convertSchema(snapshot.catalog);
  const local = await createLocalD1(options.schemaSql ?? schema.sql);
  return {
    ...snapshot,
    ...local,
    reportDirectory,
    reportPath,
    async close() {
      await local.miniflare.dispose();
      await fs.rm(snapshot.directory, { recursive: true, force: true });
      await fs.rm(reportDirectory, { recursive: true, force: true });
    },
  };
}

function importOptions(fixture, overrides = {}) {
  return {
    manifestPath: fixture.manifestPath,
    database: fixture.database,
    destinationId: "local-synthetic-d1",
    targetIncarnation: "incarnation-parent-child-1",
    reportPath: fixture.reportPath,
    mode: "local",
    allowUnresolvedGates: true,
    maxRowsPerBatch: 1,
    maxBatchBytes: 16 * 1024,
    maxBindingsPerBatch: 32,
    scanBatchRows: 1,
    ...overrides,
  };
}

export async function runLocalD1Integration() {
  const snapshot = await makeSnapshot();
  const reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-d1-report-"));
  await fs.chmod(reportDirectory, 0o700);
  const reportPath = path.join(reportDirectory, "d1-import.report.json");
  const schema = convertSchema(snapshot.catalog);
  let miniflare = null;
  let database = null;
  try {
    ({ miniflare, database } = await createLocalD1(schema.sql));
    const result = await importD1Snapshot({
      manifestPath: snapshot.manifestPath,
      database,
      destinationId: "local-synthetic-d1",
      targetIncarnation: "incarnation-parent-child-1",
      reportPath,
      mode: "local",
      allowUnresolvedGates: true,
      maxRowsPerBatch: 1,
      maxBatchBytes: 16 * 1024,
      maxBindingsPerBatch: 32,
      scanBatchRows: 1,
    });
    assert.equal(result.status, "public_rows_reconciled");
    assert.equal(result.publicRowsReconciled, true);
    assert.equal(result.fullMigrationReconciled, false);
    assert.equal(result.deployable, false);

    const parent = await database.prepare('SELECT "id", "label", "amount", "payload", "tags" FROM "parent"').all();
    assert.deepEqual(parent.results, [{ id: parentId, label: "parent row", amount: "12.34", payload: '{"n":1,"text":"null"}', tags: '["alpha","alpha"]' }]);
    const child = await database.prepare('SELECT "id", "parent_id", "event_at", "note", "enabled", "scores" FROM "child"').all();
    assert.deepEqual(child.results, [{ id: childId, parent_id: parentId, event_at: "2026-09-21T12:34:56.123456Z", note: "2026-09-21", enabled: 1, scores: "[1,-2,1]" }]);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.equal(report.status, "public_rows_reconciled");
    assert.equal(report.publicRowsReconciled, true);
    assert.equal(report.fullMigrationReconciled, false);
    assert.equal(report.deployable, false);
    assert.equal((await fs.stat(reportPath)).mode & 0o777, 0o600);
    return result;
  } finally {
    if (miniflare) await miniflare.dispose();
    await fs.rm(snapshot.directory, { recursive: true, force: true });
    await fs.rm(reportDirectory, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) test("fails closed before report, ledger, or target writes when the catalog contains an untransformed credential", async () => {
  const fixture = await openFixture(credentialFixture());
  try {
    const beforeRows = await fixture.database.prepare(
      'SELECT COUNT(*) AS "count" FROM "fanmark_password_configs"',
    ).all();
    assert.deepEqual(beforeRows.results, [{ count: 0 }]);
    const beforeLedger = await fixture.database.prepare(
      'SELECT "name" FROM "sqlite_master" WHERE "type" = \'table\' AND "name" LIKE \'__fanmark_d1_import_%\' ORDER BY "name"',
    ).all();
    assert.deepEqual(beforeLedger.results, []);

    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { allowUnresolvedGates: true })),
      (error) => error.code === "credential_transform_required",
    );

    const afterRows = await fixture.database.prepare(
      'SELECT COUNT(*) AS "count" FROM "fanmark_password_configs"',
    ).all();
    assert.deepEqual(afterRows.results, [{ count: 0 }]);
    const afterLedger = await fixture.database.prepare(
      'SELECT "name" FROM "sqlite_master" WHERE "type" = \'table\' AND "name" LIKE \'__fanmark_d1_import_%\' ORDER BY "name"',
    ).all();
    assert.deepEqual(afterLedger.results, []);
    await assert.rejects(fs.stat(fixture.reportPath), (error) => error.code === "ENOENT");
  } finally {
    await fixture.close();
  }
});

if (isMain) test("rejects a late duplicate inside one batch without committing its earlier row", async () => {
  const fixture = await openFixture({ rows: twoParentRows() });
  try {
    await fixture.database.prepare(
      'INSERT INTO "parent" ("id", "label", "amount", "payload", "tags") VALUES (?, ?, ?, ?, ?)',
    ).bind("00000000-0000-4000-8000-000000000003", "existing", "99.00", '{"n":2}', '["beta"]').run();
    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { maxRowsPerBatch: 2 })),
      (error) => error.code === "d1_batch_failed",
    );
    const rows = await fixture.database.prepare('SELECT "id" FROM "parent" ORDER BY "id"').all();
    assert.deepEqual(rows.results, [{ id: "00000000-0000-4000-8000-000000000003" }]);
    const checkpoint = await fixture.database.prepare(
      'SELECT "next_ordinal", "rows_imported", "status" FROM "__fanmark_d1_import_checkpoints" WHERE "run_id" = ? AND "table_name" = ?',
    ).bind(fixture.runId, "parent").all();
    assert.deepEqual(checkpoint.results, [{ next_ordinal: 0, rows_imported: 0, status: "in_progress" }]);
  } finally {
    await fixture.close();
  }
});

if (isMain) test("retries an acknowledged D1 batch after an uncertain client result without duplicating rows", async () => {
  const fixture = await openFixture();
  let loseAcknowledgement = true;
  const database = {
    prepare: fixture.database.prepare.bind(fixture.database),
    async batch(statements) {
      const result = await fixture.database.batch(statements);
      if (loseAcknowledgement && statements.length === 4) {
        loseAcknowledgement = false;
        throw new Error("synthetic lost acknowledgement");
      }
      return result;
    },
  };
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { database })),
      (error) => error.code === "d1_batch_failed",
    );
    const result = await importD1Snapshot(importOptions(fixture));
    assert.equal(result.status, "public_rows_reconciled");
    const parent = await fixture.database.prepare('SELECT COUNT(*) AS "count" FROM "parent"').all();
    const child = await fixture.database.prepare('SELECT COUNT(*) AS "count" FROM "child"').all();
    assert.deepEqual(parent.results, [{ count: 1 }]);
    assert.deepEqual(child.results, [{ count: 1 }]);
  } finally {
    await fixture.close();
  }
});

if (isMain) test("recovers when the first report write fails and clears stale completion fields on rerun", async () => {
  const fixture = await openFixture();
  let failFirstReportWrite = true;
  const reportWriteHooks = {
    async beforeReportWrite() {
      if (failFirstReportWrite) {
        failFirstReportWrite = false;
        throw new Error("synthetic report write failure");
      }
    },
  };
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { hooks: reportWriteHooks })),
      (error) => error.code === "d1_import_failed",
    );
    const failedReport = JSON.parse(await fs.readFile(fixture.reportPath, "utf8"));
    assert.equal(failedReport.status, "failed");
    const result = await importD1Snapshot(importOptions(fixture));
    assert.equal(result.status, "public_rows_reconciled");
    let observedReset = null;
    const observeRerun = {
      async beforeReportWrite({ report }) {
        if (observedReset === null) observedReset = { publicRowsReconciled: report.publicRowsReconciled, reconciledTables: report.reconciledTables };
      },
    };
    await importD1Snapshot(importOptions(fixture, { hooks: observeRerun }));
    assert.deepEqual(observedReset, { publicRowsReconciled: false, reconciledTables: [] });
  } finally {
    await fixture.close();
  }
});

if (isMain) test("rejects source envelope, encoded target row, binding, and INSERT SQL limits", async () => {
  const sourceFixture = await openFixture(largePayloadFixture(120_000));
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(sourceFixture, { maxRowBytes: 100_000, maxBatchBytes: 300_000, maxTargetRowBytes: 300_000 })),
      (error) => error.code === "source_row_record_too_large",
    );
  } finally {
    await sourceFixture.close();
  }

  const targetFixture = await openFixture(largePayloadFixture(120_000));
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(targetFixture, { maxBatchBytes: 300_000, maxTargetRowBytes: 100_000 })),
      (error) => error.code === "target_row_size_exceeded",
    );
  } finally {
    await targetFixture.close();
  }

  for (const [columnCount, nameLength, expectedCode] of [[101, 8, "target_column_limit_exceeded"], [100, 1100, "insert_sql_too_large"]]) {
    const wide = wideFixture(columnCount, nameLength);
    const snapshot = await makeSnapshot(wide);
    const reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-d1-limit-report-"));
    await fs.chmod(reportDirectory, 0o700);
    try {
      const unavailableDatabase = { prepare() { throw new Error("database must not be reached"); }, batch() { throw new Error("database must not be reached"); } };
      await assert.rejects(
        importD1Snapshot({
          manifestPath: snapshot.manifestPath,
          database: unavailableDatabase,
          destinationId: "local-limit-test",
          targetIncarnation: "limit-test-incarnation",
          reportPath: path.join(reportDirectory, "limit.report.json"),
          mode: "local",
          allowUnresolvedGates: true,
        }),
        (error) => error.code === expectedCode,
      );
    } finally {
      await fs.rm(snapshot.directory, { recursive: true, force: true });
      await fs.rm(reportDirectory, { recursive: true, force: true });
    }
  }
});

if (isMain) test("requires a new target incarnation when a previously reported target was recreated", async () => {
  const fixture = await openFixture();
  let replacement = null;
  try {
    await importD1Snapshot(importOptions(fixture));
    const oldSchema = convertSchema(fixture.catalog).sql;
    await fixture.miniflare.dispose();
    replacement = await createLocalD1(oldSchema);
    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { database: replacement.database })),
      (error) => error.code === "target_incarnation_unbound",
    );
    const freshToken = createTargetIncarnation();
    assert.match(freshToken, /^d1-target-[0-9a-f]{36}$/);
    assert.notEqual(freshToken, "incarnation-parent-child-1");
  } finally {
    if (replacement) await replacement.miniflare.dispose();
    await fs.rm(fixture.directory, { recursive: true, force: true });
    await fs.rm(fixture.reportDirectory, { recursive: true, force: true });
  }
});

if (isMain) test("concurrent runners converge through the checkpoint guard without duplicate public rows", async () => {
  const fixture = await openFixture();
  const secondReportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-d1-report-race-"));
  await fs.chmod(secondReportDirectory, 0o700);
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const releaseTimer = setTimeout(() => release(), 2_000);
  const hooks = {
    async beforeChunkCommit() {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
    },
  };
  try {
    const first = importD1Snapshot(importOptions(fixture, { hooks }));
    const second = importD1Snapshot(importOptions(fixture, { hooks, reportPath: path.join(secondReportDirectory, "race.report.json") }));
    const settled = await Promise.allSettled([first, second]);
    assert.equal(settled.some((entry) => entry.status === "fulfilled"), true);
    const rows = await fixture.database.prepare('SELECT COUNT(*) AS "count" FROM "parent"').all();
    assert.deepEqual(rows.results, [{ count: 1 }]);
    const checkpoint = await fixture.database.prepare(
      'SELECT "next_ordinal", "status" FROM "__fanmark_d1_import_checkpoints" WHERE "run_id" = ? AND "table_name" = ?',
    ).bind(fixture.runId, "parent").all();
    assert.deepEqual(checkpoint.results, [{ next_ordinal: 1, status: "complete" }]);
    const run = await fixture.database.prepare(
      'SELECT "status" FROM "__fanmark_d1_import_runs" WHERE "run_id" = ?',
    ).bind(fixture.runId).all();
    assert.deepEqual(run.results, [{ status: "public_rows_reconciled" }]);
  } finally {
    clearTimeout(releaseTimer);
    release();
    await fs.rm(secondReportDirectory, { recursive: true, force: true });
    await fixture.close();
  }
});

if (isMain) test("rejects target data and schema changes before claiming reconciliation", async () => {
  const fixture = await openFixture();
  try {
    await importD1Snapshot(importOptions(fixture));
    await fixture.database.prepare('UPDATE "parent" SET "label" = ? WHERE "id" = ?').bind("tampered", parentId).run();
    await assert.rejects(
      importD1Snapshot(importOptions(fixture)),
      (error) => error.code === "target_value_mismatch",
    );
  } finally {
    await fixture.close();
  }

  const triggerFixture = await openFixture();
  try {
    await triggerFixture.database.prepare(
      'CREATE TRIGGER "rogue_trigger" AFTER INSERT ON "parent" BEGIN SELECT 1; END',
    ).run();
    await assert.rejects(
      importD1Snapshot(importOptions(triggerFixture)),
      (error) => error.code === "target_schema_scope_mismatch",
    );
    const rows = await triggerFixture.database.prepare('SELECT COUNT(*) AS "count" FROM "parent"').all();
    assert.deepEqual(rows.results, [{ count: 0 }]);
  } finally {
    await triggerFixture.close();
  }
});

if (isMain) test("rejects a changed manifest against the existing target incarnation binding", async () => {
  const fixture = await openFixture();
  try {
    await importD1Snapshot(importOptions(fixture));
    const manifest = JSON.parse(await fs.readFile(fixture.manifestPath, "utf8"));
    manifest.reconciliation.gates = [...manifest.reconciliation.gates, "synthetic-manifest-change"];
    await fs.writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(
      importD1Snapshot(importOptions(fixture)),
      (error) => error.code === "report_identity_mismatch",
    );
  } finally {
    await fixture.close();
  }
});

if (isMain) test("rejects a ledger guard table whose CHECK invariant was removed", async () => {
  const fixture = await openFixture();
  try {
    await importD1Snapshot(importOptions(fixture));
    await fixture.database.prepare('DROP TABLE "__fanmark_d1_import_guards"').run();
    await fixture.database.prepare('CREATE TABLE "__fanmark_d1_import_guards" ("token" TEXT PRIMARY KEY NOT NULL, "must_be_one" INTEGER NOT NULL)').run();
    await assert.rejects(
      importD1Snapshot(importOptions(fixture)),
      (error) => error.code === "ledger_schema_definition_mismatch",
    );
  } finally {
    await fixture.close();
  }
});

if (isMain) test("keeps CHECK literal whitespace significant in target schema comparison", async () => {
  const catalog = fixtureCatalog();
  catalog.constraints.push({
    table_name: "parent",
    name: "parent_label_check",
    kind: "c",
    definition: "CHECK (label = 'a  b')",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  });
  const generated = convertSchema(catalog).sql;
  assert.match(generated, /'a  b'/);
  const fixture = await openFixture({ catalog, schemaSql: generated.replace("'a  b'", "'a b'") });
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(fixture)),
      (error) => error.code === "target_schema_definition_mismatch",
    );
  } finally {
    await fixture.close();
  }
});

if (isMain) test("allows only explicitly reviewed Auth identity gates in local mode", async () => {
  const input = authFixture();
  const fixture = await openFixture(input);
  try {
    await assert.rejects(
      importD1Snapshot(importOptions(fixture, { allowUnresolvedGates: false })),
      (error) => error.code === "external_identity_gate",
    );
    const result = await importD1Snapshot(importOptions(fixture, { allowUnresolvedGates: true }));
    assert.equal(result.status, "public_rows_reconciled");
    const parent = await fixture.database.prepare('SELECT "auth_user_id" FROM "parent"').all();
    assert.deepEqual(parent.results, [{ auth_user_id: "00000000-0000-4000-8000-000000000099" }]);
  } finally {
    await fixture.close();
  }
});

if (isMain) {
  test("imports synthetic parent/child rows through local Miniflare D1 and independently reads them back", async () => {
    await runLocalD1Integration();
  });
}

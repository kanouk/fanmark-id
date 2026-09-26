import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { exportSnapshot } from "../../../scripts/migration/snapshot-export.mjs";
import { verifySnapshot } from "../../../scripts/migration/snapshot-verify.mjs";
import { addPrimaryKeyOrder, getPrimaryKeyInfo } from "../../../scripts/migration/snapshot-format.mjs";
import { buildRowPlan } from "../../../scripts/migration/row-conversion.mjs";

function column(table_name, column_name, ordinal, postgres_type, not_null = false) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: "pg_catalog",
    type_name: postgres_type,
    type_kind: "b",
    not_null,
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
      column("snapshot_alpha", "id", 1, "uuid", true),
      column("snapshot_alpha", "label", 2, "text"),
      column("snapshot_numeric", "id", 1, "bigint", true),
      column("snapshot_numeric", "label", 2, "text"),
    ],
    constraints: [
      { table_name: "snapshot_alpha", name: "snapshot_alpha_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
      { table_name: "snapshot_numeric", name: "snapshot_numeric_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false },
    ],
    indexes: [],
    enums: [],
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
}

const setupSql = `
  CREATE TABLE public.snapshot_alpha (id uuid NOT NULL, label text, PRIMARY KEY (id));
  CREATE TABLE public.snapshot_numeric (id bigint NOT NULL, label text, PRIMARY KEY (id));
  INSERT INTO public.snapshot_alpha VALUES
    ('a0000000-0000-4000-8000-000000000001', 'one'),
    ('b0000000-0000-4000-8000-000000000002', 'two');
  INSERT INTO public.snapshot_numeric VALUES (9, 'nine'), (10, 'ten');
`;

test("PGlite executes ordered envelope SQL and the full local artifact path", { timeout: 30_000 }, async () => {
  const db = new PGlite();
  let outputDir;
  try {
    await db.exec(setupSql);
    const sourceCatalog = catalog();
    const plans = new Map();
    for (const table of ["snapshot_alpha", "snapshot_numeric"]) {
      const plan = buildRowPlan(sourceCatalog, table);
      plans.set(table, { plan, primaryKey: getPrimaryKeyInfo(sourceCatalog, table) });
      const ordered = addPrimaryKeyOrder(plan, plans.get(table).primaryKey, "pglite-proof").sql;
      const result = await db.query(ordered);
      assert.equal(result.rows.length, 2);
      const frames = result.rows.map(({ __snapshot_frame: frame }) => JSON.parse(frame));
      assert.ok(frames.every((frame) => frame.kind === "row" && frame.token === "pglite-proof" && typeof frame.payload === "string"));
      if (table === "snapshot_numeric") {
        assert.deepEqual(frames.map((frame) => JSON.parse(frame.payload).values.id), ["10", "9"]);
      }
    }

    outputDir = await mkdtemp(path.join(os.tmpdir(), "fanmark-pglite-snapshot-"));
    await rm(outputDir, { recursive: true, force: true });
    const session = {
      async begin() {
        await db.exec("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return { currentUser: "postgres", isolation: "repeatable read", readOnly: true };
      },
      async readCatalog() {
        return sourceCatalog;
      },
      async *streamTable({ table, plan, primaryKey }) {
        const ordered = addPrimaryKeyOrder(plan, primaryKey, "export-proof").sql;
        const result = await db.query(ordered);
        for (const { __snapshot_frame: frame } of result.rows) yield JSON.parse(JSON.parse(frame).payload);
      },
      async countTable(table) {
        const result = await db.query(`SELECT count(*)::text AS count FROM public."${table}"`);
        return result.rows[0].count;
      },
      async commit() {
        await db.exec("COMMIT");
      },
      async rollback() {
        await db.exec("ROLLBACK").catch(() => {});
      },
      async close() {},
    };
    const exported = await exportSnapshot({ catalog: sourceCatalog, outputDir, session });
    const verified = await verifySnapshot(exported.manifestPath);
    assert.equal(verified.valid, true);
    assert.equal(verified.tableCount, 2);
  } finally {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    await db.close();
  }
});

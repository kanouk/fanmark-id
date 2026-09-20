#!/usr/bin/env node

/**
 * Explicit local Miniflare proof for the target-only lifecycle schema
 * extension. The catalog and rows are synthetic; no remote D1 or source rows
 * are read.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertSchema } from "../../../scripts/migration/schema-convert.mjs";
import {
  applyLifecycleTargetSchema,
  generateLifecycleTargetSchema,
  inspectLifecycleTargetSchema,
} from "../../../scripts/migration/lifecycle-target-schema.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");

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
    default_expression: options.default_expression ?? null,
    identity: "",
    generated: "",
    collation: null,
  };
}

function primary(table_name) {
  return {
    table_name,
    name: `${table_name}_pkey`,
    kind: "p",
    definition: "PRIMARY KEY (id)",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function foreign(table_name, name, columnName, targetTable) {
  return {
    table_name,
    name,
    kind: "f",
    definition: `FOREIGN KEY (${columnName}) REFERENCES public.${targetTable} (id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function fixtureCatalog() {
  const columns = [
    column("fanmarks", "id", 1, "uuid", { not_null: true }),
    column("fanmarks", "short_id", 2, "text", { not_null: true }),
    column("fanmarks", "source_extra", 3, "text"),
    column("fanmark_licenses", "id", 1, "uuid", { not_null: true }),
    column("fanmark_licenses", "fanmark_id", 2, "uuid", { not_null: true }),
    column("fanmark_licenses", "user_id", 3, "uuid"),
    column("fanmark_licenses", "status", 4, "text", { not_null: true }),
    column("fanmark_licenses", "license_end", 5, "timestamp with time zone"),
    column("fanmark_licenses", "grace_expires_at", 6, "timestamp with time zone"),
    column("fanmark_licenses", "is_returned", 7, "boolean", { not_null: true, default_expression: "false" }),
    column("fanmark_licenses", "source_extra", 8, "text"),
    column("audit_logs", "id", 1, "uuid", { not_null: true }),
    column("audit_logs", "user_id", 2, "uuid"),
    column("audit_logs", "action", 3, "text", { not_null: true }),
    column("audit_logs", "resource_type", 4, "text", { not_null: true }),
    column("audit_logs", "resource_id", 5, "text"),
    column("audit_logs", "request_id", 6, "text"),
    column("audit_logs", "metadata", 7, "jsonb"),
    column("audit_logs", "created_at", 8, "timestamp with time zone", { not_null: true }),
    column("notification_events", "id", 1, "uuid", { not_null: true }),
    column("notification_events", "event_type", 2, "text", { not_null: true }),
    column("notification_events", "event_version", 3, "integer", { not_null: true }),
    column("notification_events", "source", 4, "text", { not_null: true }),
    column("notification_events", "payload", 5, "jsonb", { not_null: true }),
    column("notification_events", "payload_schema", 6, "text"),
    column("notification_events", "trigger_at", 7, "timestamp with time zone", { not_null: true }),
    column("notification_events", "dedupe_key", 8, "text"),
    column("notification_events", "status", 9, "text", { not_null: true }),
    column("notification_events", "retry_count", 10, "integer", { not_null: true }),
    column("notification_events", "created_at", 11, "timestamp with time zone", { not_null: true }),
    column("notification_events", "updated_at", 12, "timestamp with time zone", { not_null: true }),
  ];
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns,
    constraints: [
      primary("fanmarks"),
      primary("fanmark_licenses"),
      primary("audit_logs"),
      primary("notification_events"),
      foreign("fanmark_licenses", "fanmark_licenses_fanmark_id_fkey", "fanmark_id", "fanmarks"),
      {
        table_name: "fanmarks",
        name: "fanmarks_short_id_key",
        kind: "u",
        definition: "UNIQUE (short_id)",
        validated: true,
        deferrable: false,
        initially_deferred: false,
      },
      {
        table_name: "fanmarks",
        name: "fanmarks_source_extra_check",
        kind: "c",
        definition: "CHECK (source_extra IS NULL OR source_extra <> 'A  b')",
        validated: true,
        deferrable: false,
        initially_deferred: false,
      },
      {
        table_name: "notification_events",
        name: "notification_events_dedupe_key",
        kind: "u",
        definition: "UNIQUE (event_type, dedupe_key)",
        validated: true,
        deferrable: false,
        initially_deferred: false,
      },
    ],
    indexes: [],
    enums: [],
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
}

function splitSqlStatements(sql) {
  const withoutLineComments = sql.replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < withoutLineComments.length; index += 1) {
    const character = withoutLineComments[index];
    const next = withoutLineComments[index + 1];
    if (quote === "'") {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") quote = null;
    } else if (quote === '"') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ";") {
      const statement = withoutLineComments.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = withoutLineComments.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function createLocalD1() {
  let Miniflare;
  try {
    ({ Miniflare } = await import(pathToFileURL(miniflarePath).href));
  } catch (error) {
    throw new Error("local_miniflare_unavailable", { cause: error });
  }
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-lifecycle-target-schema-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-lifecycle-target-schema-test" } },
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": {
              type: "esm",
              contents: "export default { fetch() { return new Response('ok'); } };",
            },
          },
        },
      },
    }],
  });
  return { miniflare, database: await miniflare.getD1Database("DB") };
}

async function applySql(database, sql) {
  const results = await database.batch(splitSqlStatements(sql).map((statement) => database.prepare(statement)));
  assert.equal(results.every((result) => result.success === true), true);
}

async function applySource(database, converted) {
  await applySql(database, converted.sql);
  await database.prepare(
    'INSERT INTO "fanmarks" ("id", "short_id", "source_extra") VALUES (?, ?, ?)',
  ).bind("00000000-0000-4000-8000-000000000001", "ABCD1234", "retained").run();
  await database.prepare(
    'INSERT INTO "fanmark_licenses" ("id", "fanmark_id", "user_id", "status", "license_end", "grace_expires_at", "is_returned", "source_extra") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000001",
    null,
    "active",
    "2026-09-22T00:00:00.000000Z",
    null,
    0,
    "retained-license-column",
  ).run();
}

async function fresh(catalog = fixtureCatalog()) {
  const converted = convertSchema(catalog);
  const local = await createLocalD1();
  return { ...local, catalog, converted, plan: generateLifecycleTargetSchema({ catalog, convertedSchema: converted }) };
}

test("applies the source-shaped extension, preserves source columns, and re-runs as a no-op", async () => {
  const fixture = await fresh();
  try {
    await applySource(fixture.database, fixture.converted);
    assert.equal(fixture.plan.sql.includes("IF NOT EXISTS"), false);
    assert.match(fixture.plan.sourceFingerprint, /^[0-9a-f]{64}$/);
    assert.match(fixture.plan.extensionDigest, /^[0-9a-f]{64}$/);
    assert.equal(fixture.plan.objectInventory.tables.length, 5);
    assert.equal(fixture.plan.objectInventory.indexes.length, 4);

    const applied = await applyLifecycleTargetSchema({
      database: fixture.database,
      plan: fixture.plan,
      catalog: fixture.catalog,
      convertedSchema: fixture.converted,
    });
    assert.equal(applied.status, "applied");
    const repeated = await applyLifecycleTargetSchema({
      database: fixture.database,
      plan: fixture.plan,
      catalog: fixture.catalog,
      convertedSchema: fixture.converted,
    });
    assert.equal(repeated.status, "already_applied");
    assert.equal(repeated.extensionDigest, applied.extensionDigest);

    const columns = await fixture.database.prepare('PRAGMA table_info("fanmark_licenses")').all();
    const names = new Set(columns.results.map((row) => row.name));
    for (const name of ["status", "license_end", "is_returned", "source_extra", "lifecycle_generation", "lifecycle_claim_id"]) {
      assert.equal(names.has(name), true, `missing ${name}`);
    }
    const retained = await fixture.database.prepare(
      'SELECT "status", "is_returned", "source_extra", "lifecycle_generation" FROM "fanmark_licenses"',
    ).all();
    assert.deepEqual(retained.results, [{
      status: "active",
      is_returned: 0,
      source_extra: "retained-license-column",
      lifecycle_generation: 0,
    }]);
    const inspected = await inspectLifecycleTargetSchema(fixture.database, fixture.plan);
    assert.equal(inspected.complete, true);
    await fixture.database.prepare('CREATE VIEW "post_apply_unreviewed_view" AS SELECT "id" FROM "fanmarks"').run();
    await assert.rejects(
      inspectLifecycleTargetSchema(fixture.database, fixture.plan),
      (error) => error.code === "target_schema_unexpected",
    );

    await assert.rejects(
      fixture.database.prepare(
        'INSERT INTO "license_expiry_effect_guards" ("operation_id", "allowed") VALUES (?, ?)',
      ).bind("bad-guard", 0).run(),
    );
    await assert.rejects(
      fixture.database.prepare(
        'INSERT INTO "license_expiry_runs" ("run_id", "target_incarnation", "schema_extension_digest", "captured_now", "grace_period_days", "status") VALUES (?, ?, ?, ?, ?, ?)',
      ).bind("bad-days", "target", fixture.plan.extensionDigest, "2026-09-21T00:00:00.000000Z", 1.5, "running").run(),
    );
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rejects changed, partial, and unexpected schemas before extension writes", async () => {
  const changedPlanFixture = await fresh();
  try {
    await applySource(changedPlanFixture.database, changedPlanFixture.converted);
    const changedPlan = {
      ...changedPlanFixture.plan,
      statements: changedPlanFixture.plan.statements.map((statement, index) => (
        index === 0 ? statement.replace("DEFAULT 0", "DEFAULT 1") : statement
      )),
    };
    await assert.rejects(
      applyLifecycleTargetSchema({
        database: changedPlanFixture.database,
        plan: changedPlan,
        catalog: changedPlanFixture.catalog,
        convertedSchema: changedPlanFixture.converted,
      }),
      (error) => error.code === "lifecycle_schema_plan_digest_mismatch",
    );
  } finally {
    await changedPlanFixture.miniflare.dispose();
  }

  const changedLiteral = await fresh();
  try {
    const mutatedSourceSql = changedLiteral.converted.sql.replace("'A  b'", "'a b'");
    assert.notEqual(mutatedSourceSql, changedLiteral.converted.sql);
    await applySql(changedLiteral.database, mutatedSourceSql);
    await assert.rejects(
      applyLifecycleTargetSchema({
        database: changedLiteral.database,
        plan: changedLiteral.plan,
        catalog: changedLiteral.catalog,
        convertedSchema: changedLiteral.converted,
      }),
      (error) => error.code === "target_source_schema_mismatch",
    );
  } finally {
    await changedLiteral.miniflare.dispose();
  }

  const changedObject = await fresh();
  try {
    await applySql(changedObject.database, changedObject.converted.sql);
    await changedObject.database.prepare(
      'CREATE TABLE "fanmark_license_incarnations" ("license_id" TEXT PRIMARY KEY NOT NULL, "incarnation" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("incarnation") = \'integer\'))',
    ).run();
    await assert.rejects(
      applyLifecycleTargetSchema({
        database: changedObject.database,
        plan: changedObject.plan,
        catalog: changedObject.catalog,
        convertedSchema: changedObject.converted,
      }),
      (error) => error.code === "lifecycle_schema_existing_object_mismatch",
    );
  } finally {
    await changedObject.miniflare.dispose();
  }

  const partial = await fresh();
  try {
    await applySql(partial.database, partial.converted.sql);
    await partial.database.prepare(partial.plan.objectInventory.tables[0].sql).run();
    await assert.rejects(
      applyLifecycleTargetSchema({
        database: partial.database,
        plan: partial.plan,
        catalog: partial.catalog,
        convertedSchema: partial.converted,
      }),
      (error) => error.code === "lifecycle_schema_partial",
    );
  } finally {
    await partial.miniflare.dispose();
  }

  for (const objectSql of [
    'CREATE INDEX "unreviewed_index" ON "fanmarks" ("short_id")',
    'CREATE VIEW "unreviewed_view" AS SELECT "id" FROM "fanmarks"',
    'CREATE TRIGGER "unreviewed_trigger" AFTER INSERT ON "fanmarks" BEGIN SELECT 1; END',
  ]) {
    const unexpected = await fresh();
    try {
      await applySql(unexpected.database, unexpected.converted.sql);
      await unexpected.database.prepare(objectSql).run();
      await assert.rejects(
        applyLifecycleTargetSchema({
          database: unexpected.database,
          plan: unexpected.plan,
          catalog: unexpected.catalog,
          convertedSchema: unexpected.converted,
        }),
        (error) => error.code === "target_source_schema_unexpected",
      );
    } finally {
      await unexpected.miniflare.dispose();
    }
  }
});

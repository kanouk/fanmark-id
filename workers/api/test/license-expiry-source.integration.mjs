#!/usr/bin/env node

/** Synthetic local-D1 integration proof against catalog-shaped source tables. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertSchema } from "../../../scripts/migration/schema-convert.mjs";
import {
  applyLifecycleTargetSchema,
  generateLifecycleTargetSchema,
} from "../../../scripts/migration/lifecycle-target-schema.mjs";
import {
  applyLifecycleGenerationSchema,
  generateLifecycleGenerationSchema,
} from "../../../scripts/migration/lifecycle-generation-schema.mjs";
import { createSourceLicenseExpiryRepository } from "../src/license-expiry-source.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const CAPTURED_NOW = "2026-09-22T12:00:00.000000Z";
const EXPIRY = "2026-09-20T00:00:00.000000Z";
const IDS = {
  fanmark: "00000000-0000-4000-8000-000000000101",
  license: "00000000-0000-4000-8000-000000000201",
  password: "00000000-0000-4000-8000-000000000301",
  boundaryFanmark: "00000000-0000-4000-8000-000000000102",
  boundaryLicense: "00000000-0000-4000-8000-000000000202",
};

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

function fixtureCatalog() {
  const columns = [
    column("fanmarks", "id", 1, "uuid", { not_null: true }),
    column("fanmarks", "short_id", 2, "text", { not_null: true }),
    column("fanmarks", "status", 3, "text", { not_null: true }),
    column("fanmarks", "normalized_emoji", 4, "text", { not_null: true }),
    column("fanmark_licenses", "id", 1, "uuid", { not_null: true }),
    column("fanmark_licenses", "fanmark_id", 2, "uuid", { not_null: true }),
    column("fanmark_licenses", "user_id", 3, "uuid"),
    column("fanmark_licenses", "status", 4, "text", { not_null: true }),
    column("fanmark_licenses", "license_end", 5, "timestamp with time zone"),
    column("fanmark_licenses", "grace_expires_at", 6, "timestamp with time zone"),
    column("fanmark_licenses", "is_returned", 7, "boolean", { not_null: true, default_expression: "false" }),
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
    column("notification_events", "event_version", 3, "integer", { not_null: true, default_expression: "1" }),
    column("notification_events", "source", 4, "text", { not_null: true }),
    column("notification_events", "payload", 5, "jsonb", { not_null: true, default_expression: "'{}'::jsonb" }),
    column("notification_events", "payload_schema", 6, "text"),
    column("notification_events", "trigger_at", 7, "timestamp with time zone", { not_null: true }),
    column("notification_events", "dedupe_key", 8, "text"),
    column("notification_events", "status", 9, "text", { not_null: true, default_expression: "'pending'" }),
    column("notification_events", "retry_count", 10, "integer", { not_null: true, default_expression: "0" }),
    column("notification_events", "created_at", 11, "timestamp with time zone", { not_null: true }),
    column("notification_events", "updated_at", 12, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "id", 1, "uuid", { not_null: true }),
    column("fanmark_password_configs", "license_id", 2, "uuid", { not_null: true }),
    column("fanmark_password_configs", "access_password", 3, "text", { not_null: true }),
    column("fanmark_password_configs", "is_enabled", 4, "boolean", { not_null: true, default_expression: "true" }),
    column("fanmark_password_configs", "created_at", 5, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone", { not_null: true }),
  ];
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns,
    constraints: [
      primary("fanmarks"), primary("fanmark_licenses"), primary("audit_logs"),
      primary("notification_events"), primary("fanmark_password_configs"),
      {
        table_name: "notification_events", name: "unique_event_dedupe", kind: "u",
        definition: "UNIQUE (event_type, dedupe_key)", validated: true,
        deferrable: false, initially_deferred: false,
      },
      {
        table_name: "fanmarks", name: "fanmarks_short_id_key", kind: "u",
        definition: "UNIQUE (short_id)", validated: true, deferrable: false, initially_deferred: false,
      },
      {
        table_name: "fanmark_password_configs", name: "fanmark_password_configs_license_id_key", kind: "u",
        definition: "UNIQUE (license_id)", validated: true, deferrable: false, initially_deferred: false,
      },
      {
        table_name: "fanmark_licenses", name: "fanmark_licenses_fanmark_id_fkey", kind: "f",
        definition: "FOREIGN KEY (fanmark_id) REFERENCES public.fanmarks (id) ON DELETE RESTRICT ON UPDATE RESTRICT",
        validated: true, deferrable: false, initially_deferred: false,
      },
      {
        table_name: "fanmark_password_configs", name: "fanmark_password_configs_license_id_fkey", kind: "f",
        definition: "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE",
        validated: true, deferrable: false, initially_deferred: false,
      },
    ],
    indexes: [], enums: [], triggers: [], rls_policies: [], views: [], functions: [],
  };
}

function splitSqlStatements(sql) {
  const withoutLineComments = String(sql).replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
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
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-license-expiry-source-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-license-expiry-source-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
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

async function setup() {
  const catalog = fixtureCatalog();
  const convertedSchema = convertSchema(catalog);
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan });
  const local = await createLocalD1();
  try {
    await applySql(local.database, convertedSchema.sql);
    await applyLifecycleTargetSchema({ database: local.database, plan: lifecyclePlan, catalog, convertedSchema });
    await applyLifecycleGenerationSchema({
      database: local.database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan,
    });
    return { ...local, catalog, convertedSchema, lifecyclePlan, generationPlan };
  } catch (error) {
    await local.miniflare.dispose();
    throw error;
  }
}

async function addExpiredLicense(database, {
  fanmarkId = IDS.fanmark,
  licenseId = IDS.license,
  userId = null,
  licenseEnd = EXPIRY,
} = {}) {
  await database.prepare(
    'INSERT INTO "fanmarks" ("id", "short_id", "status", "normalized_emoji") VALUES (?, ?, ?, ?)',
  ).bind(fanmarkId, `S${licenseId.slice(-7)}`, "active", "🌿").run();
  await database.prepare(`
    INSERT INTO "fanmark_licenses"
      ("id", "fanmark_id", "user_id", "status", "license_end", "grace_expires_at", "is_returned")
    VALUES (?, ?, ?, 'active', ?, NULL, 0)
  `).bind(licenseId, fanmarkId, userId, licenseEnd).run();
  if (licenseId === IDS.license) {
    await database.prepare(`
      INSERT INTO "fanmark_password_configs"
        ("id", "license_id", "access_password", "is_enabled", "created_at", "updated_at")
      VALUES (?, ?, ?, 1, ?, ?)
    `).bind(IDS.password, licenseId, "bcrypt$synthetic-password-hash", CAPTURED_NOW, CAPTURED_NOW).run();
  }
}

function repository(fixture, { runId = randomUUID(), capturedNow = CAPTURED_NOW, database = fixture.database } = {}) {
  return createSourceLicenseExpiryRepository({
    database,
    runId,
    targetIncarnation: "synthetic-target-incarnation-1",
    schemaExtensionDigest: fixture.generationPlan.extensionDigest,
    capturedNow,
    gracePeriodDays: 3,
    uuidFactory: randomUUID,
  });
}

async function row(database, sql, ...bindings) {
  return database.prepare(sql).bind(...bindings).first();
}

test("applies nullable-owner expiry with independent lifecycle/access generations and source-shaped effects", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    const before = await row(fixture.database,
      'SELECT "license_incarnation", "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      IDS.license,
    );
    assert.deepEqual(before, { license_incarnation: 0, password_generation: 1, access_generation: 1 });

    const runId = "00000000-0000-4000-8000-000000000901";
    const repo = repository(fixture, { runId });
    const summary = await repo.runActiveToGrace();
    assert.equal(summary.status, "completed");
    assert.equal(summary.candidateCount, 1);
    assert.equal(summary.processed, 1);
    assert.equal(summary.conflicts, 0);
    assert.equal(summary.results[0].status, "processed");
    assert.equal(summary.results[0].licenseLifecycleGeneration, 1);
    assert.equal(summary.results[0].accessGeneration, 2);

    const license = await row(fixture.database,
      'SELECT "status", "user_id", "license_end", "grace_expires_at", "is_returned", "lifecycle_generation", "lifecycle_claim_id" FROM "fanmark_licenses" WHERE "id" = ?',
      IDS.license,
    );
    assert.deepEqual(license, {
      status: "grace",
      user_id: null,
      license_end: EXPIRY,
      grace_expires_at: "2026-09-23T00:00:00.000000Z",
      is_returned: 0,
      lifecycle_generation: 1,
      lifecycle_claim_id: null,
    });
    const after = await row(fixture.database,
      'SELECT "license_incarnation", "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      IDS.license,
    );
    assert.deepEqual(after, { license_incarnation: 0, password_generation: 1, access_generation: 2 });
    const password = await row(fixture.database,
      'SELECT "access_password", "is_enabled" FROM "fanmark_password_configs" WHERE "license_id" = ?',
      IDS.license,
    );
    assert.deepEqual(password, { access_password: "bcrypt$synthetic-password-hash", is_enabled: 1 });

    const audit = await row(fixture.database,
      'SELECT "id", "user_id", "action", "resource_type", "resource_id", "request_id", "metadata", "created_at" FROM "audit_logs"',
    );
    assert.match(audit.id, /^[0-9a-f-]{36}$/iu);
    assert.equal(audit.user_id, null);
    assert.equal(audit.action, "license_grace_started");
    assert.equal(audit.resource_type, "fanmark_license");
    assert.equal(audit.resource_id, IDS.license);
    assert.equal(audit.request_id, summary.results[0].operationId);
    assert.equal(audit.created_at, CAPTURED_NOW);
    assert.deepEqual(JSON.parse(audit.metadata), {
      schema_version: 1,
      run_id: runId,
      operation_id: summary.results[0].operationId,
      license_id: IDS.license,
      fanmark_id: IDS.fanmark,
      fanmark_short_id: `S${IDS.license.slice(-7)}`,
      license_incarnation: 0,
      license_lifecycle_generation: 1,
      access_generation: 2,
      grace_started_at: CAPTURED_NOW,
      captured_now: CAPTURED_NOW,
      license_end: EXPIRY,
      grace_expires_at: "2026-09-23T00:00:00.000000Z",
    });
    const event = await row(fixture.database,
      'SELECT "id", "event_type", "event_version", "source", "payload", "payload_schema", "trigger_at", "dedupe_key", "status", "retry_count", "created_at", "updated_at" FROM "notification_events"',
    );
    assert.match(event.id, /^[0-9a-f-]{36}$/iu);
    assert.equal(event.event_type, "license_grace_started");
    assert.equal(event.event_version, 1);
    assert.equal(event.source, "cron_job");
    assert.equal(event.payload_schema, "license_grace_started.v1");
    assert.equal(event.trigger_at, CAPTURED_NOW);
    assert.match(event.dedupe_key, /incarnation:0:lifecycle:1/u);
    assert.equal(event.status, "pending");
    assert.equal(event.retry_count, 0);
    assert.deepEqual(JSON.parse(event.payload), {
      run_id: runId,
      operation_id: summary.results[0].operationId,
      license_id: IDS.license,
      user_id: null,
      fanmark_id: IDS.fanmark,
      fanmark_name: "🌿",
      fanmark_short_id: `S${IDS.license.slice(-7)}`,
      link: `/f/S${IDS.license.slice(-7)}`,
      license_incarnation: 0,
      license_lifecycle_generation: 1,
      access_generation: 2,
      captured_now: CAPTURED_NOW,
      license_end: EXPIRY,
      grace_expires_at: "2026-09-23T00:00:00.000000Z",
    });
    const repeated = await repo.runActiveToGrace();
    assert.equal(repeated.status, "completed");
    assert.equal(await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"').then((value) => value.count), 1);
    assert.equal(await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"').then((value) => value.count), 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("recovers a lost batch acknowledgement by exact readback without duplicating effects", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    let batchCount = 0;
    const uncertainDatabase = {
      prepare: (...args) => fixture.database.prepare(...args),
      batch: async (...args) => {
        batchCount += 1;
        const result = await fixture.database.batch(...args);
        if (batchCount === 2) throw new Error("synthetic acknowledgement lost after commit");
        return result;
      },
    };
    const repo = repository(fixture, {
      runId: "00000000-0000-4000-8000-000000000902",
      database: uncertainDatabase,
    });
    const summary = await repo.runActiveToGrace();
    assert.equal(summary.status, "completed");
    assert.equal(summary.processed, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "license_expiry_effect_guards"')).count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rolls back the license and every effect when an audit insert is suppressed, then resumes", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    const runId = "00000000-0000-4000-8000-000000000903";
    const repo = repository(fixture, { runId });
    await fixture.database.prepare(`
      CREATE TRIGGER "test_suppress_lifecycle_audit"
      BEFORE INSERT ON "audit_logs"
      WHEN NEW."action" = 'license_grace_started'
      BEGIN SELECT RAISE(IGNORE); END
    `).run();
    await assert.rejects(repo.runActiveToGrace(), (error) => error.code === "active_to_grace_batch_failed");
    assert.equal((await row(fixture.database,
      'SELECT "status", "lifecycle_generation", "lifecycle_claim_id" FROM "fanmark_licenses" WHERE "id" = ?', IDS.license,
    )).status, "active");
    assert.equal((await row(fixture.database,
      'SELECT "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?', IDS.license,
    )).access_generation, 1);
    assert.equal((await row(fixture.database,
      'SELECT "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?', IDS.license,
    )).access_generation, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 0);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 0);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "license_expiry_effect_guards"')).count, 0);
    assert.equal((await row(fixture.database,
      'SELECT "outcome" FROM "license_expiry_run_items" WHERE "run_id" = ?', runId,
    )).outcome, "pending");

    await fixture.database.prepare('DROP TRIGGER "test_suppress_lifecycle_audit"').run();
    const resumed = await repo.runActiveToGrace();
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.processed, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 1);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("mandatory notification, run-item, access-version, and cleanup effects fail closed", async (t) => {
  const effects = ["notification", "run_item", "access_version", "guard_cleanup"];
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index];
    await t.test(effect, async () => {
      const fixture = await setup();
      const runId = `00000000-0000-4000-8000-00000000091${index}`;
      try {
        await addExpiredLicense(fixture.database);
        const trigger = `test_suppress_${effect}`;
        if (effect === "notification") {
          await fixture.database.prepare(`
            CREATE TRIGGER "${trigger}"
            BEFORE INSERT ON "notification_events"
            WHEN NEW."event_type" = 'license_grace_started'
            BEGIN SELECT RAISE(IGNORE); END
          `).run();
        } else if (effect === "run_item") {
          await fixture.database.prepare(`
            CREATE TRIGGER "${trigger}"
            BEFORE UPDATE OF "outcome" ON "license_expiry_run_items"
            WHEN NEW."outcome" = 'processed'
            BEGIN SELECT RAISE(IGNORE); END
          `).run();
        } else if (effect === "guard_cleanup") {
          await fixture.database.prepare(`
            CREATE TRIGGER "${trigger}"
            BEFORE DELETE ON "license_expiry_effect_guards"
            BEGIN SELECT RAISE(IGNORE); END
          `).run();
        } else {
          await fixture.database.prepare(`
            CREATE TRIGGER "${trigger}"
            BEFORE UPDATE OF "access_generation" ON "fanmark_access_versions"
            WHEN NEW."access_generation" = OLD."access_generation" + 1
            BEGIN SELECT RAISE(IGNORE); END
          `).run();
        }

        const repo = repository(fixture, { runId });
        await assert.rejects(repo.runActiveToGrace(), (error) => error.code === "active_to_grace_batch_failed");
        assert.equal((await row(fixture.database,
          'SELECT "status", "lifecycle_generation", "lifecycle_claim_id" FROM "fanmark_licenses" WHERE "id" = ?', IDS.license,
        )).status, "active");
        assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 0);
        assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 0);
        assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "license_expiry_effect_guards"')).count, 0);
        assert.equal((await row(fixture.database,
          'SELECT "outcome" FROM "license_expiry_run_items" WHERE "run_id" = ?', runId,
        )).outcome, "pending");
        assert.equal((await row(fixture.database,
          'SELECT "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?', IDS.license,
        )).access_generation, 1);

        await fixture.database.prepare(`DROP TRIGGER "${trigger}"`).run();
        const resumed = await repo.runActiveToGrace();
        assert.equal(resumed.status, "completed");
        assert.equal(resumed.processed, 1);
        assert.deepEqual(await row(fixture.database,
          'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?', IDS.license,
        ), { password_generation: 1, access_generation: 2 });
        assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 1);
        assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 1);
      } finally {
        await fixture.miniflare.dispose();
      }
    });
  }
});

test("records a stale active-fanmark condition as a durable conflict", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    let batches = 0;
    const racedDatabase = {
      prepare: (...args) => fixture.database.prepare(...args),
      batch: async (...args) => {
        batches += 1;
        if (batches === 2) {
          await fixture.database.prepare('UPDATE "fanmarks" SET "status" = ? WHERE "id" = ?')
            .bind("inactive", IDS.fanmark).run();
        }
        return fixture.database.batch(...args);
      },
    };
    const runId = "00000000-0000-4000-8000-000000000905";
    const summary = await repository(fixture, { runId, database: racedDatabase }).runActiveToGrace();
    assert.equal(summary.status, "completed");
    assert.equal(summary.candidateCount, 1);
    assert.equal(summary.processed, 0);
    assert.equal(summary.conflicts, 1);
    assert.equal((await row(fixture.database,
      'SELECT "status", "lifecycle_generation", "lifecycle_claim_id" FROM "fanmark_licenses" WHERE "id" = ?', IDS.license,
    )).status, "active");
    assert.equal((await row(fixture.database,
      'SELECT "outcome" FROM "license_expiry_run_items" WHERE "run_id" = ?', runId,
    )).outcome, "conflict");
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "audit_logs"')).count, 0);
    assert.equal((await row(fixture.database, 'SELECT COUNT(*) AS count FROM "notification_events"')).count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("does not select a license at the exact expiry boundary", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database, {
      fanmarkId: IDS.boundaryFanmark,
      licenseId: IDS.boundaryLicense,
      licenseEnd: CAPTURED_NOW,
    });
    const summary = await repository(fixture, {
      runId: "00000000-0000-4000-8000-000000000904",
    }).runActiveToGrace();
    assert.equal(summary.status, "completed");
    assert.equal(summary.candidateCount, 0);
    assert.equal((await row(fixture.database,
      'SELECT "status", "lifecycle_generation" FROM "fanmark_licenses" WHERE "id" = ?', IDS.boundaryLicense,
    )).status, "active");
  } finally {
    await fixture.miniflare.dispose();
  }
});

#!/usr/bin/env node

/**
 * Synthetic local D1 proof for lifecycle/incarnation and password-generation
 * authorities. No source rows, credentials, remote database, or deployment
 * are used; password values are destination-shaped test hashes only.
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
} from "../../../scripts/migration/lifecycle-target-schema.mjs";
import {
  applyLifecycleGenerationSchema,
  generateLifecycleGenerationSchema,
  inspectLifecycleGenerationSchema,
} from "../../../scripts/migration/lifecycle-generation-schema.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const PASSWORD_TABLE = "fanmark_password_configs";
const IDS = {
  fanmark1: "00000000-0000-4000-8000-000000000101",
  fanmark2: "00000000-0000-4000-8000-000000000102",
  fanmark3: "00000000-0000-4000-8000-000000000103",
  license1: "00000000-0000-4000-8000-000000000201",
  license2: "00000000-0000-4000-8000-000000000202",
  license3: "00000000-0000-4000-8000-000000000203",
  password1: "00000000-0000-4000-8000-000000000301",
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

function unique(table_name, name, columns) {
  return {
    table_name,
    name,
    kind: "u",
    definition: `UNIQUE (${columns})`,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function foreign(table_name, name, definition) {
  return {
    table_name,
    name,
    kind: "f",
    definition,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function fixtureCatalog() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("fanmarks", "id", 1, "uuid", { not_null: true }),
      column("fanmarks", "short_id", 2, "text", { not_null: true }),
      column("fanmarks", "normalized_emoji", 3, "text", { not_null: true }),
      column("fanmarks", "status", 4, "text", { not_null: true }),
      column("fanmarks", "source_extra", 5, "text"),
      column("fanmarks", "user_input_fanmark", 6, "text"),
      column("fanmarks", "emoji_ids", 7, "uuid[]"),
      column("fanmarks", "normalized_emoji_ids", 8, "uuid[]"),
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
      column("fanmark_lottery_entries", "id", 1, "uuid", { not_null: true }),
      column("fanmark_lottery_entries", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_lottery_entries", "entry_status", 3, "text", { not_null: true }),
      column(PASSWORD_TABLE, "id", 1, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "license_id", 2, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "access_password", 3, "text", { not_null: true }),
      column(PASSWORD_TABLE, "is_enabled", 4, "boolean", { not_null: true, default_expression: "true" }),
      column(PASSWORD_TABLE, "created_at", 5, "timestamp with time zone", { not_null: true }),
      column(PASSWORD_TABLE, "updated_at", 6, "timestamp with time zone", { not_null: true }),
      column("fanmark_basic_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_basic_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_basic_configs", "fanmark_name", 3, "text"),
      column("fanmark_basic_configs", "access_type", 4, "text"),
      column("fanmark_redirect_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_redirect_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_redirect_configs", "target_url", 3, "text"),
      column("fanmark_messageboard_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_messageboard_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_messageboard_configs", "content", 3, "text"),
      column("fanmark_profiles", "id", 1, "uuid", { not_null: true }),
      column("fanmark_profiles", "license_id", 2, "uuid"),
      column("fanmark_profiles", "display_name", 3, "text"),
      column("fanmark_profiles", "bio", 4, "text"),
      column("fanmark_profiles", "social_links", 5, "jsonb"),
      column("fanmark_profiles", "theme_settings", 6, "jsonb"),
      column("fanmark_profiles", "is_public", 7, "boolean"),
    ],
    constraints: [
      primary("fanmarks"),
      primary("fanmark_licenses"),
      primary("audit_logs"),
      primary("notification_events"),
      primary("fanmark_lottery_entries"),
      primary(PASSWORD_TABLE),
      primary("fanmark_basic_configs"),
      primary("fanmark_redirect_configs"),
      primary("fanmark_messageboard_configs"),
      primary("fanmark_profiles"),
      unique("fanmarks", "fanmarks_short_id_key", "short_id"),
      unique(PASSWORD_TABLE, "fanmark_password_configs_license_id_key", "license_id"),
      unique("fanmark_basic_configs", "fanmark_basic_configs_license_id_key", "license_id"),
      unique("fanmark_redirect_configs", "fanmark_redirect_configs_license_id_key", "license_id"),
      unique("fanmark_messageboard_configs", "fanmark_messageboard_configs_license_id_key", "license_id"),
      unique("fanmark_profiles", "fanmark_profiles_license_id_key", "license_id"),
      foreign("fanmark_licenses", "fanmark_licenses_fanmark_id_fkey", "FOREIGN KEY (fanmark_id) REFERENCES public.fanmarks (id) ON DELETE RESTRICT ON UPDATE RESTRICT"),
      foreign(PASSWORD_TABLE, "fanmark_password_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      foreign("fanmark_basic_configs", "fanmark_basic_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      foreign("fanmark_redirect_configs", "fanmark_redirect_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      foreign("fanmark_messageboard_configs", "fanmark_messageboard_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      foreign("fanmark_profiles", "fanmark_profiles_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
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
  const statements = [];
  let start = 0;
  let quote = null;
  let lineComment = false;
  for (let index = 0; index < String(sql).length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (!quote && character === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
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
        name: "fanmark-lifecycle-generation-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-lifecycle-generation-test" } },
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

async function setup() {
  const catalog = fixtureCatalog();
  const convertedSchema = convertSchema(catalog);
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan });
  const local = await createLocalD1();
  try {
    await applySql(local.database, convertedSchema.sql);
    await applyLifecycleTargetSchema({ database: local.database, plan: lifecyclePlan, catalog, convertedSchema });
    await applyLifecycleGenerationSchema({ database: local.database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan });
    return { ...local, catalog, convertedSchema, lifecyclePlan, generationPlan };
  } catch (error) {
    await local.miniflare.dispose();
    throw error;
  }
}

async function insertFanmark(database, id, shortId) {
  await database.prepare('INSERT INTO "fanmarks" ("id", "short_id", "normalized_emoji", "status", "source_extra", "user_input_fanmark", "emoji_ids", "normalized_emoji_ids") VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, shortId, "🌿", "active", "synthetic", "🌿", "[]", "[]")
    .run();
}

async function insertLicense(database, id, fanmarkId) {
  await database.prepare('INSERT INTO "fanmark_licenses" ("id", "fanmark_id", "status", "license_end", "is_returned") VALUES (?, ?, ?, ?, ?)')
    .bind(id, fanmarkId, "active", "2026-09-22T00:00:00.000000Z", 0)
    .run();
}

async function insertPassword(database, id, licenseId) {
  await database.prepare('INSERT INTO "fanmark_password_configs" ("id", "license_id", "access_password", "is_enabled", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, licenseId, "bcrypt$synthetic-destination-hash", 1, "2026-09-21T00:00:00.000000Z", "2026-09-21T00:00:00.000000Z")
    .run();
}

async function accessRow(database, licenseId) {
  const result = await database.prepare(
    'SELECT "license_incarnation", "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
  ).bind(licenseId).all();
  return result.results[0] ?? null;
}

test("applies generation triggers exactly once and rejects a changed trigger", async () => {
  const fixture = await setup();
  try {
    assert.equal(fixture.generationPlan.sql.includes("IF NOT EXISTS"), false);
    assert.equal(/(?:^|\n)\s*SELECT\s+CASE\b[^\n]*\bRAISE\s*\(/u.test(fixture.generationPlan.sql), false);
    assert.match(fixture.generationPlan.sql, /SELECT RAISE\(ABORT,[^\n]+\) WHERE /u);
    const repeated = await applyLifecycleGenerationSchema({
      database: fixture.database,
      plan: fixture.generationPlan,
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
    });
    assert.equal(repeated.status, "already_applied");
    assert.equal((await inspectLifecycleGenerationSchema(fixture.database, fixture.generationPlan, fixture.lifecyclePlan)).complete, true);
    await assert.rejects(
      inspectLifecycleGenerationSchema(fixture.database, fixture.generationPlan, {
        ...fixture.lifecyclePlan, sourceFingerprint: "0".repeat(64),
      }),
      (error) => error.code === "lifecycle_schema_plan_source_mismatch",
    );
    await assert.rejects(
      inspectLifecycleGenerationSchema(fixture.database, {
        ...fixture.generationPlan, sourceObjectInventory: [],
      }, fixture.lifecyclePlan),
      (error) => error.code === "lifecycle_generation_plan_mismatch",
    );

    await fixture.database.prepare('DROP TRIGGER "fanmark_licenses_lifecycle_pk_guard"').run();
    await fixture.database.prepare(
      'CREATE TRIGGER "fanmark_licenses_lifecycle_pk_guard" BEFORE UPDATE OF "id" ON "fanmark_licenses" BEGIN SELECT RAISE(ABORT, \'changed_trigger\'); END',
    ).run();
    await assert.rejects(
      applyLifecycleGenerationSchema({
        database: fixture.database,
        plan: fixture.generationPlan,
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: fixture.lifecyclePlan,
      }),
      (error) => error.code === "lifecycle_generation_schema_existing_object_mismatch",
    );
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("allows only recognized Cloudflare D1 bookkeeping tables in schema readback", async () => {
  const fixture = await setup();
  try {
    const withInventoryObjects = (extraObjects) => ({
      prepare(sql) {
        const statement = fixture.database.prepare(sql);
        return {
          async all() {
            const result = await statement.all();
            if (!sql.includes("FROM sqlite_master")) return result;
            const existingNames = new Set(result.results.map((object) => object.name));
            return {
              ...result,
              results: [...result.results, ...extraObjects.filter((object) => !existingNames.has(object.name))],
            };
          },
        };
      },
    });
    const providerObjects = ["_cf_KV", "_cf_METADATA", "d1_migrations"].map((name) => ({
      type: "table",
      name,
      tbl_name: name,
      sql: `CREATE TABLE "${name}" ("id" TEXT PRIMARY KEY)`,
    }));
    const downstreamObject = {
      type: "table",
      name: "future_extension_table",
      tbl_name: "future_extension_table",
      sql: 'CREATE TABLE "future_extension_table" ("id" TEXT PRIMARY KEY)',
    };
    assert.equal((await inspectLifecycleGenerationSchema(
      withInventoryObjects([...providerObjects, downstreamObject]),
      fixture.generationPlan,
      fixture.lifecyclePlan,
      [downstreamObject],
    )).complete, true);

    await assert.rejects(
      inspectLifecycleGenerationSchema(
        withInventoryObjects([...providerObjects, downstreamObject, {
          type: "table",
          name: "unexpected_application_object",
          tbl_name: "unexpected_application_object",
          sql: 'CREATE TABLE "unexpected_application_object" ("id" TEXT PRIMARY KEY)',
        }]),
        fixture.generationPlan,
        fixture.lifecyclePlan,
        [downstreamObject],
      ),
      (error) => error.code === "lifecycle_generation_schema_unexpected",
    );
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("preserves incarnations, invalidates password/access generations, and rolls back unsafe mutations", async () => {
  const fixture = await setup();
  const { database } = fixture;
  try {
    await insertFanmark(database, IDS.fanmark1, "GEN001");
    await insertFanmark(database, IDS.fanmark2, "GEN002");
    await insertFanmark(database, IDS.fanmark3, "GEN003");
    await database.prepare('INSERT INTO "fanmark_license_incarnations" ("license_id", "incarnation") VALUES (?, ?)')
      .bind(IDS.license2, 7)
      .run();
    await insertLicense(database, IDS.license1, IDS.fanmark1);
    await insertLicense(database, IDS.license2, IDS.fanmark2);
    await insertLicense(database, IDS.license3, IDS.fanmark3);

    assert.deepEqual(await accessRow(database, IDS.license1), { license_incarnation: 0, password_generation: 0, access_generation: 0 });
    assert.deepEqual(await accessRow(database, IDS.license2), { license_incarnation: 7, password_generation: 0, access_generation: 0 });

    await insertPassword(database, IDS.password1, IDS.license1);
    assert.deepEqual(await accessRow(database, IDS.license1), { license_incarnation: 0, password_generation: 1, access_generation: 1 });
    await database.prepare('UPDATE "fanmark_password_configs" SET "access_password" = "access_password" WHERE "license_id" = ?')
      .bind(IDS.license1)
      .run();
    assert.deepEqual(await accessRow(database, IDS.license1), { license_incarnation: 0, password_generation: 2, access_generation: 2 });

    await database.prepare('UPDATE "fanmark_access_versions" SET "password_generation" = 4, "access_generation" = 9 WHERE "license_id" = ?')
      .bind(IDS.license2)
      .run();
    await database.prepare('UPDATE "fanmark_password_configs" SET "license_id" = ? WHERE "license_id" = ?')
      .bind(IDS.license3, IDS.license1)
      .run();
    assert.deepEqual(await accessRow(database, IDS.license1), { license_incarnation: 0, password_generation: 3, access_generation: 3 });
    assert.deepEqual(await accessRow(database, IDS.license3), { license_incarnation: 0, password_generation: 1, access_generation: 1 });
    await database.prepare('DELETE FROM "fanmark_password_configs" WHERE "license_id" = ?').bind(IDS.license3).run();
    assert.deepEqual(await accessRow(database, IDS.license3), { license_incarnation: 0, password_generation: 2, access_generation: 2 });

    await database.prepare('INSERT INTO "fanmark_basic_configs" ("id", "license_id", "fanmark_name", "access_type") VALUES (?, ?, ?, ?)')
      .bind("00000000-0000-4000-8000-000000000401", IDS.license1, "🌿", "redirect")
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 4);
    await database.prepare('UPDATE "fanmark_basic_configs" SET "fanmark_name" = "fanmark_name" WHERE "license_id" = ?')
      .bind(IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 4);
    await database.prepare('UPDATE "fanmark_basic_configs" SET "access_type" = ? WHERE "license_id" = ?')
      .bind("text", IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 5);
    await database.prepare('UPDATE "fanmark_basic_configs" SET "license_id" = ? WHERE "license_id" = ?')
      .bind(IDS.license3, IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 6);
    assert.equal((await accessRow(database, IDS.license3)).access_generation, 3);
    await database.prepare('DELETE FROM "fanmark_basic_configs" WHERE "license_id" = ?').bind(IDS.license3).run();
    assert.equal((await accessRow(database, IDS.license3)).access_generation, 4);

    await database.prepare('INSERT INTO "fanmark_redirect_configs" ("id", "license_id", "target_url") VALUES (?, ?, ?)')
      .bind("00000000-0000-4000-8000-000000000402", IDS.license1, "https://example.test/one")
      .run();
    await database.prepare('UPDATE "fanmark_redirect_configs" SET "target_url" = ? WHERE "license_id" = ?')
      .bind("https://example.test/two", IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 8);
    await database.prepare('DELETE FROM "fanmark_redirect_configs" WHERE "license_id" = ?').bind(IDS.license1).run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 9);

    await database.prepare('INSERT INTO "fanmark_messageboard_configs" ("id", "license_id", "content") VALUES (?, ?, ?)')
      .bind("00000000-0000-4000-8000-000000000403", IDS.license1, "synthetic text")
      .run();
    await database.prepare('UPDATE "fanmark_messageboard_configs" SET "content" = ? WHERE "license_id" = ?')
      .bind("updated synthetic text", IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 11);

    await database.prepare('INSERT INTO "fanmark_profiles" ("id", "license_id", "display_name", "bio", "social_links", "theme_settings", "is_public") VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind("00000000-0000-4000-8000-000000000404", IDS.license1, "Synthetic", "Bio", "{}", "{}", 1)
      .run();
    await database.prepare('UPDATE "fanmark_profiles" SET "is_public" = 0 WHERE "license_id" = ?')
      .bind(IDS.license1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 13);

    await database.prepare('UPDATE "fanmarks" SET "normalized_emoji_ids" = ? WHERE "id" = ?')
      .bind('["00000000-0000-4000-8000-000000000501"]', IDS.fanmark1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 14);
    await database.prepare('UPDATE "fanmarks" SET "normalized_emoji_ids" = "normalized_emoji_ids" WHERE "id" = ?')
      .bind(IDS.fanmark1)
      .run();
    assert.equal((await accessRow(database, IDS.license1)).access_generation, 14);

    await database.prepare('DELETE FROM "fanmark_access_versions" WHERE "license_id" = ?').bind(IDS.license3).run();
    await assert.rejects(insertPassword(database, "00000000-0000-4000-8000-000000000302", IDS.license3));
    const missingVersionPassword = await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_password_configs" WHERE "license_id" = ?').bind(IDS.license3).all();
    assert.equal(missingVersionPassword.results[0].count, 0);
    await database.prepare(
      'INSERT INTO "fanmark_access_versions" ("license_id", "license_incarnation", "password_generation", "access_generation", "updated_at") VALUES (?, ?, ?, ?, ?)',
    ).bind(IDS.license3, 0, 2, 2, "2026-09-21T00:00:00.000000Z").run();
    await insertPassword(database, "00000000-0000-4000-8000-000000000305", IDS.license3);
    await database.prepare('DELETE FROM "fanmark_access_versions" WHERE "license_id" = ?').bind(IDS.license3).run();
    await assert.rejects(database.prepare('DELETE FROM "fanmark_password_configs" WHERE "license_id" = ?').bind(IDS.license3).run());
    assert.equal((await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_password_configs" WHERE "license_id" = ?').bind(IDS.license3).all()).results[0].count, 1);

    await database.prepare('UPDATE "fanmark_access_versions" SET "password_generation" = ?, "access_generation" = ? WHERE "license_id" = ?')
      .bind(MAX_SAFE, MAX_SAFE, IDS.license2)
      .run();
    await assert.rejects(insertPassword(database, "00000000-0000-4000-8000-000000000303", IDS.license2));
    await assert.rejects(
      database.prepare('INSERT INTO "fanmark_basic_configs" ("id", "license_id", "fanmark_name", "access_type") VALUES (?, ?, ?, ?)')
        .bind("00000000-0000-4000-8000-000000000405", IDS.license2, "Overflow", "text")
        .run(),
    );
    assert.deepEqual(await accessRow(database, IDS.license2), { license_incarnation: 7, password_generation: MAX_SAFE, access_generation: MAX_SAFE });

    await assert.rejects(
      database.prepare('UPDATE "fanmark_licenses" SET "id" = ? WHERE "id" = ?').bind("00000000-0000-4000-8000-000000000299", IDS.license2).run(),
    );
    const unchangedLicense = await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_licenses" WHERE "id" = ?').bind(IDS.license2).all();
    assert.equal(unchangedLicense.results[0].count, 1);

    await database.prepare('UPDATE "fanmark_license_incarnations" SET "incarnation" = ? WHERE "license_id" = ?')
      .bind(MAX_SAFE, IDS.license2)
      .run();
    await assert.rejects(database.prepare('DELETE FROM "fanmark_licenses" WHERE "id" = ?').bind(IDS.license2).run());
    assert.equal((await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_licenses" WHERE "id" = ?').bind(IDS.license2).all()).results[0].count, 1);
    assert.deepEqual(await accessRow(database, IDS.license2), { license_incarnation: 7, password_generation: MAX_SAFE, access_generation: MAX_SAFE });

    await insertPassword(database, "00000000-0000-4000-8000-000000000304", IDS.license1);
    await database.prepare('DELETE FROM "fanmark_licenses" WHERE "id" = ?').bind(IDS.license1).run();
    assert.equal((await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_licenses" WHERE "id" = ?').bind(IDS.license1).all()).results[0].count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_password_configs" WHERE "license_id" = ?').bind(IDS.license1).all()).results[0].count, 0);
    assert.equal(await accessRow(database, IDS.license1), null);
    assert.equal((await database.prepare('SELECT "incarnation" FROM "fanmark_license_incarnations" WHERE "license_id" = ?').bind(IDS.license1).all()).results[0].incarnation, 1);

    await insertLicense(database, IDS.license1, IDS.fanmark1);
    assert.deepEqual(await accessRow(database, IDS.license1), { license_incarnation: 1, password_generation: 0, access_generation: 0 });
  } finally {
    await fixture.miniflare.dispose();
  }
});

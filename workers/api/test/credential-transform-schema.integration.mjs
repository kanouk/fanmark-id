#!/usr/bin/env node

/**
 * Synthetic local D1 proof for the credential-transform target extension.
 * It applies the source-shaped schema and both lifecycle extensions first.
 * No source rows, credentials, remote database, or deployment are used.
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
} from "../../../scripts/migration/lifecycle-generation-schema.mjs";
import {
  applyCredentialTransformSchema,
  generateCredentialTransformSchema,
  inspectCredentialTransformSchema,
} from "../../../scripts/migration/credential-transform-schema.mjs";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
} from "../../../scripts/migration/credential-descriptor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const PASSWORD_TABLE = "fanmark_password_configs";

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
    name: table_name + "_pkey",
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
    definition: "UNIQUE (" + columns + ")",
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
    observed_at: "2026-09-23T00:00:00Z",
    columns: [
      column("fanmarks", "id", 1, "uuid", { not_null: true }),
      column("fanmarks", "short_id", 2, "text", { not_null: true }),
      column("fanmarks", "normalized_emoji", 3, "text", { not_null: true }),
      column("fanmarks", "status", 4, "text", { not_null: true }),
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
      column(PASSWORD_TABLE, "id", 1, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "license_id", 2, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "access_password", 3, "text", { not_null: true }),
      column(PASSWORD_TABLE, "is_enabled", 4, "boolean", { not_null: true, default_expression: "true" }),
      column(PASSWORD_TABLE, "created_at", 5, "timestamp with time zone", { not_null: true }),
      column(PASSWORD_TABLE, "updated_at", 6, "timestamp with time zone", { not_null: true }),
    ],
    constraints: [
      primary("fanmarks"),
      primary("fanmark_licenses"),
      primary("audit_logs"),
      primary("notification_events"),
      primary(PASSWORD_TABLE),
      unique("fanmarks", "fanmarks_short_id_key", "short_id"),
      unique(PASSWORD_TABLE, "fanmark_password_configs_license_id_key", "license_id"),
      foreign("fanmark_licenses", "fanmark_licenses_fanmark_id_fkey", "FOREIGN KEY (fanmark_id) REFERENCES public.fanmarks (id) ON DELETE RESTRICT ON UPDATE RESTRICT"),
      foreign(PASSWORD_TABLE, "fanmark_password_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      unique("notification_events", "notification_events_dedupe_key", "event_type, dedupe_key"),
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
  const source = String(sql).replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
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
    if (character === "'" || character === '"') quote = character;
    else if (character === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function descriptor() {
  return {
    version: 1,
    sourceRelation: PASSWORD_TABLE,
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: PASSWORD_TABLE,
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}

async function createLocalD1() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-credential-transform-schema-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-credential-transform-schema-test" } },
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

async function prepareFixture({ credentialExtension = false } = {}) {
  const catalog = fixtureCatalog();
  const convertedSchema = convertSchema(catalog);
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan });
  const credentialPlan = generateCredentialTransformSchema({
    catalog,
    convertedSchema,
    lifecyclePlan,
    generationPlan,
    descriptor: descriptor(),
  });
  const local = await createLocalD1();
  try {
    await applySql(local.database, convertedSchema.sql);
    await applyLifecycleTargetSchema({ database: local.database, plan: lifecyclePlan, catalog, convertedSchema });
    await applyLifecycleGenerationSchema({ database: local.database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan });
    if (credentialExtension) {
      await applyCredentialTransformSchema({
        database: local.database,
        plan: credentialPlan,
        catalog,
        convertedSchema,
        lifecyclePlan,
        generationPlan,
        descriptor: descriptor(),
      });
    }
    return { ...local, catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan };
  } catch (error) {
    await local.miniflare.dispose();
    throw error;
  }
}

test("credential transform profile is deterministic and binds lifecycle generations", async () => {
  const fixture = await prepareFixture();
  try {
    const second = generateCredentialTransformSchema({
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    });
    assert.equal(fixture.credentialPlan.extensionDigest, second.extensionDigest);
    assert.equal(fixture.credentialPlan.targetProfileFingerprint, second.targetProfileFingerprint);
    assert.equal(fixture.credentialPlan.sourceFingerprint, fixture.lifecyclePlan.sourceFingerprint);
    assert.equal(fixture.credentialPlan.lifecycleExtensionDigest, fixture.lifecyclePlan.extensionDigest);
    assert.equal(fixture.credentialPlan.generationExtensionDigest, fixture.generationPlan.extensionDigest);
    assert.match(fixture.credentialPlan.sql, /credential_transform_artifacts/u);
    assert.match(fixture.credentialPlan.sql, /credential_transform_coverage/u);
    assert.doesNotMatch(fixture.credentialPlan.sql, /password_hash|raw_password/u);
    assert.equal(fixture.credentialPlan.objectInventory.tables.length, 2);
    assert.equal(fixture.credentialPlan.objectInventory.indexes.length, 4);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("credential transform schema applies once, reads back exactly, and re-applies as a no-op", async () => {
  const fixture = await prepareFixture();
  try {
    const args = {
      database: fixture.database,
      plan: fixture.credentialPlan,
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    };
    assert.equal((await applyCredentialTransformSchema(args)).status, "applied");
    const inspected = await inspectCredentialTransformSchema(fixture.database, fixture.credentialPlan, {
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    });
    assert.equal(inspected.complete, true);
    assert.deepEqual(inspected.missing, []);
    assert.deepEqual(inspected.mismatched, []);
    assert.equal(inspected.extensionDigest, fixture.credentialPlan.extensionDigest);
    assert.equal((await applyCredentialTransformSchema(args)).status, "already_applied");
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("partial target extensions fail before applying the remaining credential DDL", async () => {
  const fixture = await prepareFixture();
  try {
    await fixture.database.prepare(fixture.credentialPlan.statements[0]).run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: fixture.database,
        plan: fixture.credentialPlan,
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: fixture.lifecyclePlan,
        generationPlan: fixture.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_schema_partial",
    );
    const rows = await fixture.database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'credential_transform_coverage'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("unexpected target objects and changed extension SQL fail closed", async () => {
  const unexpected = await prepareFixture();
  try {
    await unexpected.database.prepare("CREATE TABLE unexpected_target_object (id TEXT)").run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: unexpected.database,
        plan: unexpected.credentialPlan,
        catalog: unexpected.catalog,
        convertedSchema: unexpected.convertedSchema,
        lifecyclePlan: unexpected.lifecyclePlan,
        generationPlan: unexpected.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_base_schema_unexpected",
    );
    const rows = await unexpected.database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'credential_transform_artifacts'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await unexpected.miniflare.dispose();
  }

  const changed = await prepareFixture({ credentialExtension: true });
  try {
    await changed.database.prepare("DROP INDEX credential_transform_artifacts_lease").run();
    await changed.database.prepare(
      "CREATE INDEX credential_transform_artifacts_lease ON credential_transform_artifacts (target_profile_fingerprint)",
    ).run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: changed.database,
        plan: changed.credentialPlan,
        catalog: changed.catalog,
        convertedSchema: changed.convertedSchema,
        lifecyclePlan: changed.lifecyclePlan,
        generationPlan: changed.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_schema_existing_object_mismatch",
    );
  } finally {
    await changed.miniflare.dispose();
  }
});

test("tampered descriptors and lifecycle plans are rejected before target DDL", async () => {
  const fixture = await prepareFixture();
  try {
    assert.throws(
      () => generateCredentialTransformSchema({
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: fixture.lifecyclePlan,
        generationPlan: fixture.generationPlan,
        descriptor: { ...descriptor(), codecCost: 12 },
      }),
      (error) => error?.code === "credential_transform_descriptor_invalid",
    );
    const alteredLifecycle = structuredClone(fixture.lifecyclePlan);
    alteredLifecycle.extensionDigest = "0".repeat(64);
    assert.throws(
      () => generateCredentialTransformSchema({
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: alteredLifecycle,
        generationPlan: fixture.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_profile_invalid",
    );
    const rows = await fixture.database.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'credential_transform_%'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

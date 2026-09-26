#!/usr/bin/env node

/** Synthetic local-D1 integration proof against catalog-shaped source tables. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
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
  applyVerifiedAccessSchema,
  generateVerifiedAccessSchema,
  inspectVerifiedAccessSchema,
} from "../../../scripts/migration/verified-access-schema.mjs";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
} from "../../../scripts/migration/credential-descriptor.mjs";
import { importD1Snapshot } from "../../../scripts/migration/d1-import.mjs";
import { exportSnapshot } from "../../../scripts/migration/snapshot-export.mjs";
import { createSourceLicenseExpiryRepository } from "../src/license-expiry-source.mjs";
import { createSourceGraceFinalizationRepository } from "../src/license-grace-finalization-source.mjs";
import { runScheduledLicenseExpiry } from "../src/license-expiry-scheduled.mjs";
import { handleVerifiedAccessRequest, setVerificationTestHooks } from "../src/verified-access.mjs";
import bcrypt from "bcryptjs";

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
    column("fanmarks", "user_input_fanmark", 5, "text"),
    column("fanmarks", "emoji_ids", 6, "uuid[]"),
    column("fanmarks", "normalized_emoji_ids", 7, "uuid[]"),
    column("fanmarks", "tier_level", 8, "integer", { not_null: true }),
    column("fanmark_tiers", "id", 1, "uuid", { not_null: true }),
    column("fanmark_tiers", "tier_level", 2, "integer", { not_null: true }),
    column("fanmark_tiers", "initial_license_days", 3, "integer"),
    column("fanmark_licenses", "id", 1, "uuid", { not_null: true }),
    column("fanmark_licenses", "fanmark_id", 2, "uuid", { not_null: true }),
    column("fanmark_licenses", "user_id", 3, "uuid"),
    column("fanmark_licenses", "status", 4, "text", { not_null: true }),
    column("fanmark_licenses", "license_end", 5, "timestamp with time zone"),
    column("fanmark_licenses", "grace_expires_at", 6, "timestamp with time zone"),
    column("fanmark_licenses", "is_returned", 7, "boolean", { not_null: true, default_expression: "false" }),
    column("fanmark_licenses", "license_start", 8, "timestamp with time zone", { not_null: true }),
    column("fanmark_licenses", "excluded_at", 9, "timestamp with time zone"),
    column("fanmark_licenses", "is_initial_license", 10, "boolean", { not_null: true, default_expression: "false" }),
    column("fanmark_licenses", "created_at", 11, "timestamp with time zone", { not_null: true }),
    column("fanmark_licenses", "updated_at", 12, "timestamp with time zone", { not_null: true }),
    column("fanmark_licenses", "display_fanmark", 13, "text"),
    column("fanmark_licenses", "is_transferred", 14, "boolean", { not_null: true, default_expression: "false" }),
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
    column("fanmark_lottery_entries", "id", 1, "uuid", { not_null: true }),
    column("fanmark_lottery_entries", "fanmark_id", 2, "uuid", { not_null: true }),
    column("fanmark_lottery_entries", "user_id", 3, "uuid", { not_null: true }),
    column("fanmark_lottery_entries", "license_id", 4, "uuid", { not_null: true }),
    column("fanmark_lottery_entries", "lottery_probability", 5, "numeric", { not_null: true }),
    column("fanmark_lottery_entries", "entry_status", 6, "text", { not_null: true, default_expression: "'pending'" }),
    column("fanmark_lottery_entries", "applied_at", 7, "timestamp with time zone", { not_null: true }),
    column("fanmark_lottery_entries", "lottery_executed_at", 8, "timestamp with time zone"),
    column("fanmark_lottery_entries", "won_at", 9, "timestamp with time zone"),
    column("fanmark_lottery_entries", "cancelled_at", 10, "timestamp with time zone"),
    column("fanmark_lottery_entries", "cancellation_reason", 11, "text"),
    column("fanmark_lottery_entries", "created_at", 12, "timestamp with time zone", { not_null: true }),
    column("fanmark_lottery_entries", "updated_at", 13, "timestamp with time zone", { not_null: true }),
    column("fanmark_lottery_history", "id", 1, "uuid", { not_null: true }),
    column("fanmark_lottery_history", "fanmark_id", 2, "uuid", { not_null: true }),
    column("fanmark_lottery_history", "license_id", 3, "uuid", { not_null: true }),
    column("fanmark_lottery_history", "total_entries", 4, "integer", { not_null: true }),
    column("fanmark_lottery_history", "winner_user_id", 5, "uuid"),
    column("fanmark_lottery_history", "winner_entry_id", 6, "uuid"),
    column("fanmark_lottery_history", "probability_distribution", 7, "jsonb", { not_null: true, default_expression: "'[]'::jsonb" }),
    column("fanmark_lottery_history", "random_seed", 8, "text"),
    column("fanmark_lottery_history", "executed_at", 9, "timestamp with time zone", { not_null: true }),
    column("fanmark_lottery_history", "execution_method", 10, "text", { not_null: true, default_expression: "'automatic'" }),
    column("fanmark_lottery_history", "created_at", 11, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "id", 1, "uuid", { not_null: true }),
    column("fanmark_password_configs", "license_id", 2, "uuid", { not_null: true }),
    column("fanmark_password_configs", "access_password", 3, "text", { not_null: true }),
    column("fanmark_password_configs", "is_enabled", 4, "boolean", { not_null: true, default_expression: "true" }),
    column("fanmark_password_configs", "created_at", 5, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone", { not_null: true }),
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
    column("system_settings", "id", 1, "uuid", { not_null: true }),
    column("system_settings", "setting_key", 2, "text", { not_null: true }),
    column("system_settings", "setting_value", 3, "text", { not_null: true }),
    column("system_settings", "description", 4, "text"),
    column("system_settings", "is_public", 5, "boolean", { not_null: true, default_expression: "false" }),
    column("system_settings", "created_at", 6, "timestamp with time zone", { not_null: true }),
    column("system_settings", "updated_at", 7, "timestamp with time zone", { not_null: true }),
    column("user_settings", "id", 1, "uuid", { not_null: true }),
    column("user_settings", "user_id", 2, "uuid", { not_null: true }),
    column("user_settings", "username", 3, "text", { not_null: true }),
    column("user_settings", "plan_type", 4, "text", { not_null: true }),
  ];
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns,
    constraints: [
      primary("fanmarks"), primary("fanmark_tiers"), primary("fanmark_licenses"),
      primary("fanmark_lottery_history"), primary("audit_logs"),
      primary("notification_events"), primary("fanmark_lottery_entries"), primary("fanmark_password_configs"),
      primary("fanmark_basic_configs"), primary("fanmark_redirect_configs"),
      primary("fanmark_messageboard_configs"), primary("fanmark_profiles"),
      primary("system_settings"),
      primary("user_settings"),
      {
        table_name: "user_settings", name: "user_settings_user_id_key", kind: "u",
        definition: "UNIQUE (user_id)", validated: true, deferrable: false, initially_deferred: false,
      },
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

async function loadCatalog() {
  const privateCatalogPath = process.env.FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG;
  if (!privateCatalogPath) return fixtureCatalog();

  const absolutePath = path.resolve(privateCatalogPath);
  const relativePath = path.relative(repoRoot, absolutePath);
  assert.ok(
    relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath),
    "private readiness catalog must be outside the repository",
  );
  const stat = await fs.stat(absolutePath);
  assert.equal(stat.isFile(), true, "private readiness catalog must be a file");
  assert.equal(stat.mode & 0o077, 0, "private readiness catalog must not be accessible to group or other users");

  const catalog = JSON.parse(await fs.readFile(absolutePath, "utf8"));
  assert.equal(new Set(catalog.columns.map((item) => item.table_name)).size, 40, "expected the current 40-table source catalog");
  return catalog;
}

function syntheticRequiredValue(column, catalog) {
  const postgresType = column.postgres_type;
  if (postgresType.endsWith("[]")) return "[]";
  if (postgresType === "uuid") return randomUUID();
  if (postgresType === "boolean") return false;
  if (postgresType === "jsonb") return "{}";
  if (postgresType === "timestamp with time zone") return CAPTURED_NOW;
  if (postgresType === "date") return "2026-09-22";
  if (postgresType === "numeric" || postgresType.startsWith("numeric(")) return "0";
  if (["smallint", "integer", "bigint"].includes(postgresType)) return 1;

  const enumType = catalog.enums.find((item) => item.name === column.type_name);
  if (enumType?.labels?.length) return enumType.labels[0];
  return `synthetic-${column.table_name}-${column.column_name}`;
}

async function insertCatalogRow(database, catalog, tableName, suppliedValues) {
  const columns = catalog.columns.filter((item) => item.table_name === tableName)
    .sort((left, right) => left.ordinal - right.ordinal);
  assert.ok(columns.length > 0, `catalog has no columns for ${tableName}`);
  const supplied = new Map(Object.entries(suppliedValues));
  for (const name of supplied.keys()) assert.ok(columns.some((column) => column.column_name === name), `unknown ${tableName}.${name}`);

  for (const column of columns) {
    if (column.not_null && !supplied.has(column.column_name)) {
      supplied.set(column.column_name, syntheticRequiredValue(column, catalog));
    }
  }

  const insertedColumns = columns.filter((column) => supplied.has(column.column_name));
  const identifiers = insertedColumns.map((column) => `"${column.column_name.replaceAll('"', '""')}"`);
  const placeholders = insertedColumns.map(() => "?");
  const values = insertedColumns.map((column) => supplied.get(column.column_name));
  await database.prepare(`INSERT INTO "${tableName.replaceAll('"', '""')}" (${identifiers.join(", ")}) VALUES (${placeholders.join(", ")})`)
    .bind(...values)
    .run();
}

function knownCatalogValues(catalog, tableName, values) {
  const names = new Set(catalog.columns.filter((column) => column.table_name === tableName).map((column) => column.column_name));
  return Object.fromEntries(Object.entries(values).filter(([name]) => names.has(name)));
}

function credentialDescriptor() {
  return {
    version: 1,
    sourceRelation: "fanmark_password_configs",
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: "fanmark_password_configs",
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}

async function emptySnapshot(catalog, outputDir) {
  return exportSnapshot({
    catalog,
    outputDir,
    credentialDescriptor: credentialDescriptor(),
    session: {
      async begin() { return { currentUser: "postgres", isolation: "repeatable read", readOnly: true }; },
      async readCatalog() { return catalog; },
      async *streamTable() {},
      async countTable() { return "0"; },
      async commit() {},
      async rollback() {},
      async close() {},
    },
  });
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
  const catalog = await loadCatalog();
  const descriptor = credentialDescriptor();
  const convertedSchema = convertSchema(catalog, { credentialDescriptor: descriptor });
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema, credentialDescriptor: descriptor });
  const generationPlan = generateLifecycleGenerationSchema({
    catalog, convertedSchema, lifecyclePlan, credentialDescriptor: descriptor,
  });
  const credentialPlan = generateCredentialTransformSchema({
    catalog,
    convertedSchema,
    lifecyclePlan,
    generationPlan,
    descriptor,
  });
  const local = await createLocalD1();
  try {
    await applySql(local.database, convertedSchema.sql);
    await applyLifecycleTargetSchema({
      database: local.database, plan: lifecyclePlan, catalog, convertedSchema, credentialDescriptor: descriptor,
    });
    await applyLifecycleGenerationSchema({
      database: local.database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan,
      credentialDescriptor: descriptor,
    });
    await applyCredentialTransformSchema({
      database: local.database,
      plan: credentialPlan,
      catalog,
      convertedSchema,
      lifecyclePlan,
      generationPlan,
      descriptor,
    });
    const inspectedCredentialProfile = await inspectCredentialTransformSchema(local.database, credentialPlan, {
      catalog,
      convertedSchema,
      lifecyclePlan,
      generationPlan,
      descriptor,
    });
    assert.equal(inspectedCredentialProfile.complete, true);
    return { ...local, catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan };
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
  emoji = "🌿",
} = {}) {
  const catalog = await loadCatalog();
  const normalizedEmojiId = randomUUID();
  const fanmark = {
    id: fanmarkId,
    user_input_fanmark: emoji,
    normalized_emoji: emoji,
    short_id: `S${licenseId.slice(-7)}`,
    status: "active",
    emoji_ids: JSON.stringify([normalizedEmojiId]),
    normalized_emoji_ids: JSON.stringify([normalizedEmojiId]),
    tier_level: 1,
  };
  const license = {
    id: licenseId,
    fanmark_id: fanmarkId,
    user_id: userId,
    license_start: CAPTURED_NOW,
    license_end: licenseEnd,
    status: "active",
    is_initial_license: 0,
    grace_expires_at: null,
    is_returned: 0,
    is_transferred: 0,
    display_fanmark: emoji,
    created_at: CAPTURED_NOW,
    updated_at: CAPTURED_NOW,
  };
  await insertCatalogRow(database, catalog, "fanmarks", knownCatalogValues(catalog, "fanmarks", fanmark));
  await insertCatalogRow(database, catalog, "fanmark_licenses", knownCatalogValues(catalog, "fanmark_licenses", license));
  if (licenseId === IDS.license) {
    await database.prepare(`
      INSERT INTO "fanmark_password_configs"
        ("id", "license_id", "access_password", "is_enabled", "created_at", "updated_at")
      VALUES (?, ?, ?, 1, ?, ?)
    `).bind(IDS.password, licenseId, "bcrypt$synthetic-password-hash", CAPTURED_NOW, CAPTURED_NOW).run();
  }
}

function finalizationRepository(fixture, {
  runId = randomUUID(),
  capturedNow = CAPTURED_NOW,
  database = fixture.database,
  maxPages,
} = {}) {
  return createSourceGraceFinalizationRepository({
    database,
    runId,
    targetIncarnation: "synthetic-target-incarnation-1",
    schemaExtensionDigest: fixture.credentialPlan.extensionDigest,
    capturedNow,
    maxPages,
    uuidFactory: randomUUID,
  });
}

async function createLotteryFinalizationItem(fixture, runId) {
  const operationId = randomUUID();
  const auditId = randomUUID();
  const notificationEventId = randomUUID();
  await fixture.database.prepare(`
    INSERT INTO license_grace_finalization_runs
      (run_id, target_incarnation, schema_extension_digest, captured_now, status)
    VALUES (?, 'synthetic-target-incarnation-1', ?, ?, 'running')
  `).bind(runId, fixture.credentialPlan.extensionDigest, CAPTURED_NOW).run();
  const source = await fixture.database.prepare(`
    SELECT l.id AS license_id, l.fanmark_id, f.short_id AS fanmark_short_id,
           f.normalized_emoji AS fanmark_name, l.user_id, l.license_end,
           l.grace_expires_at, l.is_returned, registry.incarnation AS license_incarnation,
           l.lifecycle_generation AS license_lifecycle_generation, access.access_generation
    FROM fanmark_licenses AS l
    JOIN fanmarks AS f ON f.id = l.fanmark_id
    JOIN fanmark_license_incarnations AS registry ON registry.license_id = l.id
    JOIN fanmark_access_versions AS access
      ON access.license_id = l.id AND access.license_incarnation = registry.incarnation
    WHERE l.id = ?
  `).bind(IDS.license).first();
  assert.ok(source);
  await fixture.database.prepare(`
    INSERT INTO license_grace_finalization_items
      (run_id, license_id, fanmark_id, fanmark_short_id, fanmark_name, user_id,
       license_end, grace_expires_at, is_returned, license_incarnation,
       license_lifecycle_generation, access_generation, operation_id, audit_id,
       notification_event_id, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    runId, source.license_id, source.fanmark_id, source.fanmark_short_id, source.fanmark_name,
    source.user_id, source.license_end, source.grace_expires_at, source.is_returned,
    source.license_incarnation, source.license_lifecycle_generation, source.access_generation,
    operationId, auditId, notificationEventId,
  ).run();
  return { operationId, auditId, notificationEventId };
}

async function markGraceExpired(database, licenseId = IDS.license, {
  graceExpiresAt = "2026-09-22T11:59:59.000000Z",
  isReturned = 0,
} = {}) {
  await database.prepare(`UPDATE fanmark_licenses SET status = 'grace', grace_expires_at = ?,
    is_returned = ?, lifecycle_generation = lifecycle_generation + 1 WHERE id = ?`)
    .bind(graceExpiresAt, isReturned, licenseId).run();
  await database.prepare(`UPDATE fanmark_access_versions SET access_generation = access_generation + 1,
    updated_at = ? WHERE license_id = ?`).bind(CAPTURED_NOW, licenseId).run();
}

function repository(fixture, {
  runId = randomUUID(),
  capturedNow = CAPTURED_NOW,
  database = fixture.database,
  maxPages,
} = {}) {
  return createSourceLicenseExpiryRepository({
    database,
    runId,
    targetIncarnation: "synthetic-target-incarnation-1",
    schemaExtensionDigest: fixture.credentialPlan.extensionDigest,
    capturedNow,
    gracePeriodDays: 3,
    maxPages,
    uuidFactory: randomUUID,
  });
}

async function row(database, sql, ...bindings) {
  return database.prepare(sql).bind(...bindings).first();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function seedProtectedTarget(fixture, hash) {
  const fanmarkId = randomUUID();
  const licenseId = randomUUID();
  const passwordId = randomUUID();
  const shortId = `S${licenseId.slice(0, 7)}`;
  const current = "2026-09-24T00:00:00.000000Z";
  await insertCatalogRow(fixture.database, fixture.catalog, "fanmarks", knownCatalogValues(fixture.catalog, "fanmarks", {
    id: fanmarkId,
    short_id: shortId,
    user_input_fanmark: "🌿",
    normalized_emoji: "🌿",
    emoji_ids: "[]",
    normalized_emoji_ids: "[]",
    status: "active",
    tier_level: 1,
  }));
  await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_licenses", knownCatalogValues(fixture.catalog, "fanmark_licenses", {
    id: licenseId,
    fanmark_id: fanmarkId,
    user_id: null,
    license_start: current,
    license_end: "2040-01-01T00:00:00.000000Z",
    status: "active",
    grace_expires_at: null,
    is_returned: 0,
  }));
  await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_basic_configs", {
    id: randomUUID(), license_id: licenseId, fanmark_name: "Synthetic protected target", access_type: "text",
  });
  await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_messageboard_configs", {
    id: randomUUID(), license_id: licenseId, content: "Synthetic protected message",
  });
  await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_password_configs", {
    id: passwordId,
    license_id: licenseId,
    access_password: hash,
    is_enabled: 1,
    created_at: current,
    updated_at: current,
  });
  const generations = await row(fixture.database,
    'SELECT "license_incarnation", "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
    licenseId,
  );
  const lifecycle = await row(fixture.database,
    'SELECT "lifecycle_generation" FROM "fanmark_licenses" WHERE "id" = ?',
    licenseId,
  );
  const artifactId = randomUUID();
  const sourceManifestDigest = sha256(`manifest:${licenseId}`);
  const sourcePrimaryKey = JSON.stringify({ id: passwordId });
  const sourceRowDigest = sha256(`row:${passwordId}`);
  const sourceEnvelopeDigest = sha256(`envelope:${passwordId}`);
  const transformDigest = sha256(`transform:${licenseId}:${hash}`);
  const targetIdentity = "synthetic-local-target";
  const targetIncarnation = "synthetic-local-incarnation-1";
  await fixture.database.prepare(`
    INSERT INTO "credential_transform_artifacts" (
      "artifact_id", "artifact_key", "source_binding_digest", "target_profile_fingerprint",
      "source_manifest_digest", "descriptor_digest", "source_relation", "source_primary_key_json",
      "source_row_identity_digest", "source_envelope_digest", "source_revision",
      "destination_relation", "destination_column", "destination_license_id", "target_identity",
      "target_incarnation", "license_incarnation", "enabled", "codec_id", "codec_parameters_version",
      "codec_cost", "transform_contract_version", "policy_version", "expected_password_generation",
      "expected_access_generation", "expected_lifecycle_generation", "destination_hash",
      "destination_transform_digest", "state", "fencing_token", "created_at", "prepared_at",
      "applied_at", "reconciled_at"
    ) VALUES (?, ?, ?, ?, ?, ?, 'fanmark_password_configs', ?, ?, ?, 'synthetic-revision-1',
      'fanmark_password_configs', 'access_password', ?, ?, ?, ?, 1, 'bcryptjs@3.0.3', 1, 10, 1, 1,
      ?, ?, ?, ?, ?, 'reconciled', 1, ?, ?, ?, ?)
  `).bind(
    artifactId,
    `synthetic:${licenseId}`,
    sha256(`binding:${licenseId}`),
    fixture.credentialPlan.targetProfileFingerprint,
    sourceManifestDigest,
    fixture.credentialPlan.descriptorDigest,
    sourcePrimaryKey,
    sourceRowDigest,
    sourceEnvelopeDigest,
    licenseId,
    targetIdentity,
    targetIncarnation,
    generations.license_incarnation,
    generations.password_generation,
    generations.access_generation,
    lifecycle.lifecycle_generation,
    hash,
    transformDigest,
    current,
    current,
    current,
    current,
  ).run();
  await fixture.database.prepare(`
    INSERT INTO "credential_transform_coverage" (
      "run_id", "target_profile_fingerprint", "source_manifest_digest", "descriptor_digest",
      "target_identity", "target_incarnation", "table_name", "source_primary_key_json",
      "source_row_identity_digest", "source_envelope_digest", "destination_relation",
      "destination_column", "destination_primary_key_json", "destination_license_id",
      "license_incarnation", "enabled", "expected_password_generation", "expected_access_generation",
      "expected_lifecycle_generation", "artifact_id", "fencing_token", "coverage_state",
      "destination_transform_digest", "destination_digest", "created_at", "updated_at"
    ) VALUES ('synthetic-run-1', ?, ?, ?, ?, ?, 'fanmark_password_configs', ?, ?, ?,
      'fanmark_password_configs', 'access_password', ?, ?, ?, 1, ?, ?, ?, ?, 1, 'transformed', ?, ?, ?, ?)
  `).bind(
    fixture.credentialPlan.targetProfileFingerprint,
    sourceManifestDigest,
    fixture.credentialPlan.descriptorDigest,
    targetIdentity,
    targetIncarnation,
    sourcePrimaryKey,
    sourceRowDigest,
    sourceEnvelopeDigest,
    sourcePrimaryKey,
    licenseId,
    generations.license_incarnation,
    generations.password_generation,
    generations.access_generation,
    lifecycle.lifecycle_generation,
    artifactId,
    transformDigest,
    sha256(`destination:${licenseId}:${hash}`),
    current,
    current,
  ).run();
  return { fanmarkId, licenseId, shortId };
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
    const run = await row(fixture.database,
      'SELECT "schema_extension_digest" FROM "license_expiry_runs" WHERE "run_id" = ?',
      runId,
    );
    assert.equal(run.schema_extension_digest, fixture.credentialPlan.extensionDigest);

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

test("finalizes an overdue grace license without lottery entries as one guarded source-profile transition", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_basic_configs", {
      id: randomUUID(), license_id: IDS.license, fanmark_name: "Synthetic", access_type: "text",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_redirect_configs", {
      id: randomUUID(), license_id: IDS.license, target_url: "https://example.invalid/",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_messageboard_configs", {
      id: randomUUID(), license_id: IDS.license, content: "synthetic message",
    });
    await markGraceExpired(fixture.database);
    const beforeAccess = await row(fixture.database,
      'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      IDS.license,
    );

    const runId = "00000000-0000-4000-8000-000000000911";
    const repository = finalizationRepository(fixture, { runId });
    const summary = await repository.runExpiredGraceFinalization();
    assert.equal(summary.status, "completed");
    assert.equal(summary.candidateCount, 1);
    assert.equal(summary.processed, 1);
    assert.equal(summary.conflicts, 0);
    assert.equal(summary.results[0].outcome, "processed");

    const license = await row(fixture.database, `SELECT status, excluded_at, lifecycle_generation,
      lifecycle_claim_id, grace_expires_at FROM fanmark_licenses WHERE id = ?`, IDS.license);
    assert.deepEqual(license, {
      status: "expired",
      excluded_at: CAPTURED_NOW,
      lifecycle_generation: 2,
      lifecycle_claim_id: null,
      grace_expires_at: "2026-09-22T11:59:59.000000Z",
    });
    const afterAccess = await row(fixture.database,
      'SELECT "password_generation", "access_generation", "updated_at" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      IDS.license,
    );
    assert.deepEqual(afterAccess, {
      password_generation: beforeAccess.password_generation,
      access_generation: beforeAccess.access_generation + 1,
      updated_at: CAPTURED_NOW,
    });
    const configCount = await row(fixture.database, `SELECT
      (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ?) AS count`,
    IDS.license, IDS.license, IDS.license, IDS.license);
    assert.equal(configCount.count, 0);

    const audit = await row(fixture.database,
      `SELECT id, user_id, action, resource_type, resource_id, request_id, metadata, created_at
       FROM audit_logs WHERE action = 'license_expired'`);
    assert.equal(audit.user_id, null);
    assert.equal(audit.action, "license_expired");
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
      license_lifecycle_generation: 2,
      access_generation: afterAccess.access_generation,
      expired_at: CAPTURED_NOW,
      grace_expires_at: "2026-09-22T11:59:59.000000Z",
      license_end: EXPIRY,
      config_deletion_errors: 0,
    });

    const event = await row(fixture.database,
      `SELECT id, event_type, event_version, source, payload, payload_schema, trigger_at,
        dedupe_key, status, retry_count, created_at, updated_at FROM notification_events
       WHERE event_type = 'license_expired'`);
    assert.equal(event.event_type, "license_expired");
    assert.equal(event.event_version, 1);
    assert.equal(event.source, "cron_job");
    assert.equal(event.payload_schema, "license_expired.v1");
    assert.equal(event.trigger_at, CAPTURED_NOW);
    assert.equal(event.dedupe_key, `expired_${IDS.license}_${Date.parse(EXPIRY)}`);
    assert.equal(event.status, "pending");
    assert.deepEqual(JSON.parse(event.payload), {
      user_id: null,
      fanmark_id: IDS.fanmark,
      fanmark_name: "🌿",
      expired_at: CAPTURED_NOW,
      license_end: EXPIRY,
    });

    const journal = await row(fixture.database,
      `SELECT outcome, completed_at FROM license_grace_finalization_items WHERE run_id = ? AND license_id = ?`,
      runId, IDS.license);
    assert.deepEqual(journal, { outcome: "processed", completed_at: CAPTURED_NOW });
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM license_expiry_effect_guards")).count, 0);
    const retry = await repository.runExpiredGraceFinalization();
    assert.equal(retry.status, "completed");
    assert.equal((await row(fixture.database,
      `SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'license_expired'`)).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("scheduled expiry leaves a just-transitioned overdue grace license for the next tick", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "system_settings", {
      id: randomUUID(),
      setting_key: "grace_period_days",
      setting_value: "1",
      is_public: false,
    });
    const env = {
      LICENSE_EXPIRY_BACKEND: "d1",
      D1_TOPOLOGY: "split",
      LICENSE_EXPIRY_TARGET_INCARNATION: "synthetic-target-incarnation-1",
      LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST: fixture.credentialPlan.extensionDigest,
      LICENSE_EXPIRY_MAX_PAGES: "4",
    };

    const firstTick = await runScheduledLicenseExpiry({
      scheduledTime: Date.parse("2026-09-24T00:00:00.000Z"),
      env,
      database: fixture.database,
    });
    assert.equal(firstTick.status, "completed");
    assert.equal(firstTick.processed, 1);
    assert.equal(firstTick.graceFinalization.status, "completed");
    assert.equal(firstTick.graceFinalization.candidateCount, 0);
    const afterFirstTick = await row(fixture.database,
      "SELECT status, grace_expires_at FROM fanmark_licenses WHERE id = ?", IDS.license);
    assert.equal(afterFirstTick.status, "grace");
    assert.ok(afterFirstTick.grace_expires_at <= firstTick.capturedNow,
      "the source grace deadline is already overdue for this delayed scheduled tick");

    const secondTick = await runScheduledLicenseExpiry({
      scheduledTime: Date.parse("2026-09-25T00:00:00.000Z"),
      env,
      database: fixture.database,
    });
    assert.equal(secondTick.processed, 0);
    assert.equal(secondTick.graceFinalization.status, "completed");
    assert.equal(secondTick.graceFinalization.processed, 1);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "expired");
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'license_expired'" )).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("atomically finalizes a pending lottery with winner license, history, audit, and outbox events", async () => {
  const fixture = await setup();
  try {
    const ownerId = "00000000-0000-4000-8000-000000000a10";
    const winnerId = "00000000-0000-4000-8000-000000000a11";
    const entryId = "00000000-0000-4000-8000-000000000a12";
    await addExpiredLicense(fixture.database, { userId: ownerId });
    await markGraceExpired(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: entryId,
      fanmark_id: IDS.fanmark,
      user_id: winnerId,
      license_id: IDS.license,
      lottery_probability: "1.0",
      entry_status: "pending",
      applied_at: CAPTURED_NOW,
      created_at: CAPTURED_NOW,
      updated_at: CAPTURED_NOW,
    });
    const runId = "00000000-0000-4000-8000-000000000912";
    const repository = finalizationRepository(fixture, {
      runId,
    });
    const summary = await repository.runExpiredGraceFinalization();
    assert.equal(summary.status, "completed");
    assert.equal(summary.candidateCount, 1);
    assert.equal(summary.processed, 1);
    assert.equal(summary.conflicts, 0);
    assert.equal(summary.results[0].outcome, "processed");

    const oldLicense = await row(fixture.database,
      "SELECT status, lifecycle_claim_id FROM fanmark_licenses WHERE id = ?", IDS.license);
    assert.deepEqual(oldLicense, { status: "expired", lifecycle_claim_id: null });
    const entry = await row(fixture.database,
      "SELECT entry_status, won_at, lottery_executed_at FROM fanmark_lottery_entries WHERE id = ?", entryId);
    assert.deepEqual(entry, { entry_status: "won", won_at: CAPTURED_NOW, lottery_executed_at: CAPTURED_NOW });

    const history = await row(fixture.database,
      `SELECT fanmark_id, license_id, total_entries, winner_user_id, winner_entry_id,
        probability_distribution, random_seed, executed_at, execution_method
       FROM fanmark_lottery_history`);
    assert.equal(history.fanmark_id, IDS.fanmark);
    assert.equal(history.license_id, IDS.license);
    assert.equal(history.total_entries, 1);
    assert.equal(history.winner_user_id, winnerId);
    assert.equal(history.winner_entry_id, entryId);
    assert.deepEqual(JSON.parse(history.probability_distribution), [
      { user_id: winnerId, lottery_probability: "1.0" },
    ]);
    assert.match(history.random_seed, /^[0-9a-f]{64}$/u);
    assert.equal(history.executed_at, CAPTURED_NOW);
    assert.equal(history.execution_method, "automatic");

    const winnerLicense = await row(fixture.database,
      `SELECT id, fanmark_id, user_id, license_start, license_end, status,
        is_initial_license FROM fanmark_licenses WHERE user_id = ? AND status = 'active'`, winnerId);
    assert.equal(winnerLicense.fanmark_id, IDS.fanmark);
    assert.equal(winnerLicense.user_id, winnerId);
    assert.equal(winnerLicense.license_start, CAPTURED_NOW);
    assert.equal(winnerLicense.license_end, "2026-10-23T00:00:00.000000Z");
    assert.equal(winnerLicense.status, "active");
    assert.equal(winnerLicense.is_initial_license, 0);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_license_incarnations WHERE license_id = ?", winnerLicense.id)).count, 1);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_access_versions WHERE license_id = ?", winnerLicense.id)).count, 1);

    const events = await fixture.database.prepare(`SELECT event_type, payload FROM notification_events
      ORDER BY event_type`).all();
    assert.deepEqual(events.results.map((event) => event.event_type), ["license_expired", "lottery_won"]);
    const winnerEvent = events.results.find((event) => event.event_type === "lottery_won");
    assert.deepEqual(JSON.parse(winnerEvent.payload), {
      user_id: winnerId,
      fanmark_id: IDS.fanmark,
      fanmark_name: "🌿",
      license_id: winnerLicense.id,
      license_end: "2026-10-23T00:00:00.000000Z",
      license_end_formatted: "2026/10/23 00:00",
      total_applicants: 1,
      is_current_owner_win: false,
    });
    assert.equal((await row(fixture.database,
      "SELECT outcome FROM license_grace_finalization_items WHERE run_id = ? AND license_id = ?",
      runId, IDS.license)).outcome, "processed");
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rejects a stale winner-capacity snapshot without expiring the license or changing the entry", async () => {
  const fixture = await setup();
  try {
    const winnerId = "00000000-0000-4000-8000-000000000a21";
    await addExpiredLicense(fixture.database);
    await markGraceExpired(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "user_settings", {
      id: randomUUID(), user_id: winnerId, username: "synthetic-capacity-user", plan_type: "free",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "system_settings", {
      id: randomUUID(), setting_key: "free_fanmark_limit", setting_value: "1",
      description: "synthetic lottery capacity", is_public: 0,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: "00000000-0000-4000-8000-000000000a22",
      fanmark_id: IDS.fanmark, user_id: winnerId, license_id: IDS.license,
      lottery_probability: "1", entry_status: "pending", applied_at: CAPTURED_NOW,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    const runId = "00000000-0000-4000-8000-000000000a23";
    const { operationId } = await createLotteryFinalizationItem(fixture, runId);
    const repository = finalizationRepository(fixture, { runId });
    const prepared = await repository.prepareLotteryPlan(IDS.license);
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.outcomes[0].capacity.activeCount, 0);

    await addExpiredLicense(fixture.database, {
      fanmarkId: "00000000-0000-4000-8000-000000000a24",
      licenseId: "00000000-0000-4000-8000-000000000a25",
      userId: winnerId,
      licenseEnd: "2026-09-30T00:00:00.000000Z",
      emoji: "🌱",
    });

    const summary = await repository.runExpiredGraceFinalization();
    assert.equal(summary.status, "completed");
    assert.equal(summary.processed, 0);
    assert.equal(summary.conflicts, 1);
    assert.equal((await row(fixture.database,
      "SELECT status, lifecycle_claim_id FROM fanmark_licenses WHERE id = ?", IDS.license))
      .status, "grace");
    assert.equal((await row(fixture.database,
      "SELECT lifecycle_claim_id FROM fanmark_licenses WHERE id = ?", IDS.license)).lifecycle_claim_id, null);
    assert.equal((await row(fixture.database,
      "SELECT entry_status FROM fanmark_lottery_entries WHERE license_id = ?", IDS.license)).entry_status, "pending");
    assert.equal((await row(fixture.database,
      "SELECT outcome FROM license_grace_finalization_items WHERE run_id = ? AND license_id = ?",
      runId, IDS.license)).outcome, "conflict");
    assert.equal((await row(fixture.database,
      "SELECT lifecycle_claim_id FROM fanmark_licenses WHERE id = ?", IDS.license)).lifecycle_claim_id, null);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_lottery_history WHERE license_id = ?", IDS.license)).count, 0);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM notification_events WHERE event_type IN ('license_expired', 'lottery_won')")).count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("finalizes multiple weighted entries with one winner, one loser, and exact history weights", async () => {
  const fixture = await setup();
  try {
    const applicants = [
      { id: "00000000-0000-4000-8000-000000000a26", user: "00000000-0000-4000-8000-000000000a27", weight: "1.00000000000000000001" },
      { id: "00000000-0000-4000-8000-000000000a28", user: "00000000-0000-4000-8000-000000000a29", weight: "2.50000000000000000002" },
    ];
    await addExpiredLicense(fixture.database);
    await markGraceExpired(fixture.database);
    for (const applicant of applicants) {
      await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
        id: applicant.id, fanmark_id: IDS.fanmark, user_id: applicant.user,
        license_id: IDS.license, lottery_probability: applicant.weight,
        entry_status: "pending", applied_at: CAPTURED_NOW,
        created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
      });
    }

    const summary = await finalizationRepository(fixture, {
      runId: "00000000-0000-4000-8000-000000000a2a",
    }).runExpiredGraceFinalization();
    assert.equal(summary.processed, 1);
    const history = await row(fixture.database,
      "SELECT total_entries, winner_user_id, winner_entry_id, probability_distribution FROM fanmark_lottery_history");
    assert.equal(history.total_entries, 2);
    assert.ok(applicants.some((applicant) => applicant.user === history.winner_user_id));
    assert.ok(applicants.some((applicant) => applicant.id === history.winner_entry_id));
    assert.deepEqual(JSON.parse(history.probability_distribution), applicants.map((applicant) => ({
      user_id: applicant.user,
      lottery_probability: applicant.weight,
    })));
    const entryRows = await fixture.database.prepare(`SELECT id, user_id, entry_status
      FROM fanmark_lottery_entries WHERE license_id = ? ORDER BY id`).bind(IDS.license).all();
    assert.equal(entryRows.results.filter((entry) => entry.entry_status === "won").length, 1);
    assert.equal(entryRows.results.filter((entry) => entry.entry_status === "lost").length, 1);
    assert.equal(entryRows.results.find((entry) => entry.entry_status === "won").id, history.winner_entry_id);
    const events = await fixture.database.prepare(`SELECT event_type, payload FROM notification_events
      WHERE event_type IN ('lottery_won', 'lottery_lost') ORDER BY event_type`).all();
    assert.deepEqual(events.results.map((event) => event.event_type), ["lottery_lost", "lottery_won"]);
    const winnerEvent = JSON.parse(events.results.find((event) => event.event_type === "lottery_won").payload);
    const loserEvent = JSON.parse(events.results.find((event) => event.event_type === "lottery_lost").payload);
    assert.equal(winnerEvent.user_id, history.winner_user_id);
    assert.equal(winnerEvent.total_applicants, 2);
    assert.equal(winnerEvent.is_current_owner_win, false);
    assert.ok(applicants.some((applicant) => applicant.user === loserEvent.user_id));
    assert.notEqual(loserEvent.user_id, winnerEvent.user_id);
    assert.equal(loserEvent.total_applicants, 2);
    assert.equal(loserEvent.is_current_owner_win, false);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("records a capped sole applicant as a rejected draw and returns the fanmark to the pool", async () => {
  const fixture = await setup();
  try {
    const cappedUser = "00000000-0000-4000-8000-000000000a31";
    await addExpiredLicense(fixture.database);
    await markGraceExpired(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "user_settings", {
      id: randomUUID(), user_id: cappedUser, username: "synthetic-capped-user", plan_type: "free",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "system_settings", {
      id: randomUUID(), setting_key: "free_fanmark_limit", setting_value: "1",
      description: "synthetic lottery capacity", is_public: 0,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    await addExpiredLicense(fixture.database, {
      fanmarkId: "00000000-0000-4000-8000-000000000a32",
      licenseId: "00000000-0000-4000-8000-000000000a33",
      userId: cappedUser,
      licenseEnd: "2026-09-30T00:00:00.000000Z",
      emoji: "🌱",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: "00000000-0000-4000-8000-000000000a34",
      fanmark_id: IDS.fanmark, user_id: cappedUser, license_id: IDS.license,
      lottery_probability: "3.25", entry_status: "pending", applied_at: CAPTURED_NOW,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });

    const summary = await finalizationRepository(fixture, {
      runId: "00000000-0000-4000-8000-000000000a35",
    }).runExpiredGraceFinalization();
    assert.equal(summary.processed, 1);
    assert.equal(summary.conflicts, 0);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "expired");
    assert.equal((await row(fixture.database,
      "SELECT entry_status FROM fanmark_lottery_entries WHERE license_id = ?", IDS.license)).entry_status, "lost");
    const history = await row(fixture.database,
      "SELECT total_entries, winner_user_id, winner_entry_id, probability_distribution FROM fanmark_lottery_history");
    assert.equal(history.total_entries, 1);
    assert.equal(history.winner_user_id, null);
    assert.equal(history.winner_entry_id, null);
    assert.deepEqual(JSON.parse(history.probability_distribution), [
      { user_id: cappedUser, lottery_probability: "3.25", rejected_reason: "limit_exceeded" },
    ]);
    const limitEvent = await row(fixture.database,
      "SELECT payload FROM notification_events WHERE event_type = 'lottery_limit_exceeded'");
    assert.deepEqual(JSON.parse(limitEvent.payload), {
      user_id: cappedUser,
      fanmark_id: IDS.fanmark,
      fanmark_name: "🌿",
      current_count: 1,
      limit: 1,
    });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rolls back lottery effects when a required winner event is suppressed and replays the saved plan", async () => {
  const fixture = await setup();
  try {
    const winnerId = "00000000-0000-4000-8000-000000000a41";
    await addExpiredLicense(fixture.database);
    await markGraceExpired(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: "00000000-0000-4000-8000-000000000a42",
      fanmark_id: IDS.fanmark, user_id: winnerId, license_id: IDS.license,
      lottery_probability: "1", entry_status: "pending", applied_at: CAPTURED_NOW,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    await fixture.database.prepare(`CREATE TRIGGER test_suppress_lottery_winner_event
      BEFORE INSERT ON notification_events WHEN NEW.event_type = 'lottery_won'
      BEGIN SELECT RAISE(IGNORE); END`).run();
    const runId = "00000000-0000-4000-8000-000000000a43";
    const repository = finalizationRepository(fixture, { runId });

    await assert.rejects(repository.runExpiredGraceFinalization(), /grace_lottery_finalization_batch_failed/u);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "grace");
    assert.equal((await row(fixture.database,
      "SELECT entry_status FROM fanmark_lottery_entries WHERE license_id = ?", IDS.license)).entry_status, "pending");
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_lottery_history WHERE license_id = ?", IDS.license)).count, 0);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'license_expired'")).count, 0);
    const savedPlan = await row(fixture.database,
      "SELECT lottery_seed, lottery_plan_json, outcome FROM license_grace_finalization_items WHERE run_id = ? AND license_id = ?",
      runId, IDS.license);
    assert.match(savedPlan.lottery_seed, /^[0-9a-f]{64}$/u);
    assert.equal(savedPlan.outcome, "pending");

    await fixture.database.prepare("DROP TRIGGER test_suppress_lottery_winner_event").run();
    const resumed = await repository.runExpiredGraceFinalization();
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.processed, 1);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "expired");
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_lottery_history WHERE license_id = ?", IDS.license)).count, 1);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'lottery_won'")).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("claims a pending lottery and resumes the persisted exact-weight decision without redrawing", async () => {
  const fixture = await setup();
  try {
    const atLimitUser = "00000000-0000-4000-8000-000000000a01";
    const eligibleUser = "00000000-0000-4000-8000-000000000b01";
    await addExpiredLicense(fixture.database);
    await markGraceExpired(fixture.database);

    await insertCatalogRow(fixture.database, fixture.catalog, "user_settings", {
      id: randomUUID(), user_id: atLimitUser, username: "synthetic-limit-user", plan_type: "free",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "user_settings", {
      id: randomUUID(), user_id: eligibleUser, username: "synthetic-eligible-user", plan_type: "free",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "system_settings", {
      id: randomUUID(), setting_key: "free_fanmark_limit", setting_value: "1",
      description: "synthetic lottery capacity", is_public: 0,
      created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    await addExpiredLicense(fixture.database, {
      fanmarkId: "00000000-0000-4000-8000-000000000a03",
      licenseId: "00000000-0000-4000-8000-000000000a02",
      userId: atLimitUser,
      licenseEnd: "2026-09-30T00:00:00.000000Z",
      emoji: "🌱",
    });
    await addExpiredLicense(fixture.database, {
      fanmarkId: "00000000-0000-4000-8000-000000000b03",
      licenseId: "00000000-0000-4000-8000-000000000b02",
      userId: eligibleUser,
      licenseEnd: EXPIRY,
      emoji: "🪴",
    });
    await addExpiredLicense(fixture.database, {
      fanmarkId: "00000000-0000-4000-8000-000000000b05",
      licenseId: "00000000-0000-4000-8000-000000000b04",
      userId: eligibleUser,
      licenseEnd: null,
      emoji: "🍀",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: "00000000-0000-4000-8000-000000000c01", fanmark_id: IDS.fanmark,
      user_id: atLimitUser, license_id: IDS.license,
      lottery_probability: "1.2500000000000000000001", entry_status: "pending",
      applied_at: CAPTURED_NOW, created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_lottery_entries", {
      id: "00000000-0000-4000-8000-000000000c02", fanmark_id: IDS.fanmark,
      user_id: eligibleUser, license_id: IDS.license,
      lottery_probability: "2.5000000000000000000002", entry_status: "pending",
      applied_at: CAPTURED_NOW, created_at: CAPTURED_NOW, updated_at: CAPTURED_NOW,
    });

    const runId = "00000000-0000-4000-8000-000000000915";
    const { operationId } = await createLotteryFinalizationItem(fixture, runId);
    const firstRepository = finalizationRepository(fixture, { runId });
    const concurrentRepository = finalizationRepository(fixture, { runId });
    const [first, concurrent] = await Promise.all([
      firstRepository.prepareLotteryPlan(IDS.license),
      concurrentRepository.prepareLotteryPlan(IDS.license),
    ]);

    assert.equal(first.status, "prepared");
    assert.deepEqual(first.plan, concurrent.plan);
    assert.match(first.seed, /^[0-9a-f]{64}$/u);
    assert.equal(first.winnerEntryId, "00000000-0000-4000-8000-000000000c02");
    const atLimitOutcome = first.outcomes.find((entry) => entry.userId === atLimitUser);
    const eligibleOutcome = first.outcomes.find((entry) => entry.userId === eligibleUser);
    assert.deepEqual(atLimitOutcome.capacity, { planType: "free", activeCount: 1, limit: 1 });
    assert.deepEqual(eligibleOutcome.capacity, { planType: "free", activeCount: 0, limit: 1 });
    assert.ok(["lost", "limit_exceeded"].includes(atLimitOutcome.status));
    assert.equal(eligibleOutcome.status, "won");

    const beforeReplay = await row(fixture.database, `
      SELECT lottery_seed, lottery_inputs_json, lottery_plan_json
      FROM license_grace_finalization_items WHERE run_id = ? AND license_id = ?
    `, runId, IDS.license);
    assert.equal(beforeReplay.lottery_seed, first.seed);
    assert.equal(JSON.parse(beforeReplay.lottery_inputs_json).entries.length, 2);
    assert.equal(JSON.parse(beforeReplay.lottery_plan_json).selection.winnerEntryId, first.winnerEntryId);
    assert.equal((await row(fixture.database,
      "SELECT lifecycle_claim_id FROM fanmark_licenses WHERE id = ?", IDS.license)).lifecycle_claim_id, operationId);

    await fixture.database.prepare(`
      UPDATE fanmark_lottery_entries SET lottery_probability = '99'
      WHERE id = '00000000-0000-4000-8000-000000000c01'
    `).run();
    await fixture.database.prepare(`
      UPDATE fanmark_licenses SET status = 'expired'
      WHERE id = '00000000-0000-4000-8000-000000000a02'
    `).run();
    const resumedRepository = finalizationRepository(fixture, { runId });
    const resumed = await resumedRepository.prepareLotteryPlan(IDS.license);
    assert.deepEqual(resumed.plan, first.plan);
    assert.equal(resumed.seed, first.seed);
    assert.equal(resumed.winnerEntryId, first.winnerEntryId);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "grace");
    const entriesAfterReplay = await fixture.database.prepare(`
      SELECT id, entry_status FROM fanmark_lottery_entries
      WHERE license_id = ? ORDER BY id
    `).bind(IDS.license).all();
    assert.deepEqual(entriesAfterReplay.results, [
      { id: "00000000-0000-4000-8000-000000000c01", entry_status: "pending" },
      { id: "00000000-0000-4000-8000-000000000c02", entry_status: "pending" },
    ]);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rolls back grace expiration and config cleanup if the required event insert is suppressed", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_basic_configs", {
      id: randomUUID(), license_id: IDS.license, fanmark_name: "Synthetic", access_type: "text",
    });
    await markGraceExpired(fixture.database);
    await fixture.database.prepare(`CREATE TRIGGER test_suppress_license_expired
      BEFORE INSERT ON notification_events WHEN NEW.event_type = 'license_expired'
      BEGIN SELECT RAISE(IGNORE); END`).run();
    const repository = finalizationRepository(fixture, {
      runId: "00000000-0000-4000-8000-000000000913",
    });
    await assert.rejects(repository.runExpiredGraceFinalization(), /grace_finalization_batch_failed/u);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "grace");
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM fanmark_basic_configs WHERE license_id = ?", IDS.license)).count, 1);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'license_expired'")).count, 0);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM license_expiry_effect_guards")).count, 0);

    await fixture.database.prepare("DROP TRIGGER test_suppress_license_expired").run();
    const resumed = await repository.runExpiredGraceFinalization();
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.processed, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("rolls back expiry when one configuration projection cannot be deleted, then resumes cleanly", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_basic_configs", {
      id: randomUUID(), license_id: IDS.license, fanmark_name: "Synthetic", access_type: "text",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_redirect_configs", {
      id: randomUUID(), license_id: IDS.license, target_url: "https://example.invalid/",
    });
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_messageboard_configs", {
      id: randomUUID(), license_id: IDS.license, content: "synthetic message",
    });
    await markGraceExpired(fixture.database);
    await fixture.database.prepare(`CREATE TRIGGER test_suppress_expired_redirect_delete
      BEFORE DELETE ON fanmark_redirect_configs
      BEGIN SELECT RAISE(IGNORE); END`).run();

    const repo = finalizationRepository(fixture, {
      runId: "00000000-0000-4000-8000-000000000914",
    });
    await assert.rejects(repo.runExpiredGraceFinalization(), /grace_finalization_batch_failed/u);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "grace");
    const configCount = await row(fixture.database, `SELECT
      (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ?) AS count`,
    IDS.license, IDS.license, IDS.license, IDS.license);
    assert.equal(configCount.count, 4);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'license_expired'")).count, 0);
    assert.equal((await row(fixture.database,
      "SELECT COUNT(*) AS count FROM notification_events WHERE event_type = 'license_expired'")).count, 0);

    await fixture.database.prepare("DROP TRIGGER test_suppress_expired_redirect_delete").run();
    const resumed = await repo.runExpiredGraceFinalization();
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.processed, 1);
    assert.equal((await row(fixture.database,
      "SELECT status FROM fanmark_licenses WHERE id = ?", IDS.license)).status, "expired");
    assert.equal((await row(fixture.database, `SELECT
      (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id = ?) +
      (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id = ?) AS count`,
    IDS.license, IDS.license, IDS.license, IDS.license)).count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("bounds scheduled invocations by pages and resumes one durable run to completion", async () => {
  const fixture = await setup();
  try {
    for (let ordinal = 1; ordinal <= 65; ordinal += 1) {
      const suffix = String(ordinal).padStart(12, "0");
      await addExpiredLicense(fixture.database, {
        fanmarkId: `00000000-0000-4000-8001-${suffix}`,
        licenseId: `00000000-0000-4000-8000-${suffix}`,
        emoji: `🌿${ordinal}`,
      });
    }

    const runId = "00000000-0000-4000-8000-000000000902";
    const repo = repository(fixture, { runId, maxPages: 1 });
    const firstInvocation = await repo.runActiveToGrace();
    assert.equal(firstInvocation.status, "running");
    assert.equal(firstInvocation.candidateCount, 64);
    assert.equal(firstInvocation.processed, 64);
    assert.equal(firstInvocation.results.length, 32);

    const secondInvocation = await repo.runActiveToGrace();
    assert.equal(secondInvocation.status, "running");
    assert.equal(secondInvocation.candidateCount, 65);
    assert.equal(secondInvocation.processed, 65);

    const finalInvocation = await repo.runActiveToGrace();
    assert.equal(finalInvocation.status, "completed");
    assert.equal(finalInvocation.candidateCount, 65);
    assert.equal(finalInvocation.processed, 65);
    const activeCount = await row(fixture.database,
      `SELECT COUNT(*) AS count FROM "fanmark_licenses" WHERE "id" BETWEEN ? AND ? AND "status" = 'active'`,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000065",
    );
    assert.equal(activeCount.count, 0);
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

test("records a stale eligibility condition as a durable conflict", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database);
    let batches = 0;
    const racedDatabase = {
      prepare: (...args) => fixture.database.prepare(...args),
      batch: async (...args) => {
        batches += 1;
        if (batches === 2) {
          if (new Set(fixture.catalog.columns.map((column) => column.table_name)).size === 40) {
            await fixture.database.prepare('UPDATE "fanmark_licenses" SET "license_end" = ? WHERE "id" = ?')
              .bind("2026-09-19T00:00:00.000000Z", IDS.license).run();
          } else {
            await fixture.database.prepare('UPDATE "fanmarks" SET "status" = ? WHERE "id" = ?')
              .bind("inactive", IDS.fanmark).run();
          }
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

test("invalidates protected-access generations for source-backed content and selector changes", async () => {
  const fixture = await setup();
  try {
    await addExpiredLicense(fixture.database, { licenseEnd: "2026-10-20T00:00:00.000000Z" });
    const accessGeneration = async () => (await row(
      fixture.database,
      'SELECT "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      IDS.license,
    ))?.access_generation;

    assert.equal(await accessGeneration(), 1);
    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_basic_configs", {
      id: randomUUID(),
      license_id: IDS.license,
      fanmark_name: "synthetic access name",
      access_type: "redirect",
    });
    assert.equal(await accessGeneration(), 2);
    await fixture.database.prepare('UPDATE "fanmark_basic_configs" SET "fanmark_name" = ? WHERE "license_id" = ?')
      .bind("updated synthetic name", IDS.license)
      .run();
    assert.equal(await accessGeneration(), 3);
    await fixture.database.prepare('UPDATE "fanmark_basic_configs" SET "fanmark_name" = "fanmark_name" WHERE "license_id" = ?')
      .bind(IDS.license)
      .run();
    assert.equal(await accessGeneration(), 3);
    await fixture.database.prepare('UPDATE "fanmark_basic_configs" SET "access_type" = ? WHERE "license_id" = ?')
      .bind("text", IDS.license)
      .run();
    assert.equal(await accessGeneration(), 4);

    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_redirect_configs", {
      id: randomUUID(), license_id: IDS.license, target_url: "https://example.test/first",
    });
    assert.equal(await accessGeneration(), 5);
    await fixture.database.prepare('UPDATE "fanmark_redirect_configs" SET "target_url" = ? WHERE "license_id" = ?')
      .bind("https://example.test/second", IDS.license)
      .run();
    assert.equal(await accessGeneration(), 6);
    await fixture.database.prepare('DELETE FROM "fanmark_redirect_configs" WHERE "license_id" = ?')
      .bind(IDS.license)
      .run();
    assert.equal(await accessGeneration(), 7);

    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_messageboard_configs", {
      id: randomUUID(), license_id: IDS.license, content: "synthetic text",
    });
    assert.equal(await accessGeneration(), 8);
    await fixture.database.prepare('UPDATE "fanmark_messageboard_configs" SET "content" = ? WHERE "license_id" = ?')
      .bind("updated synthetic text", IDS.license)
      .run();
    assert.equal(await accessGeneration(), 9);

    await insertCatalogRow(fixture.database, fixture.catalog, "fanmark_profiles", {
      id: randomUUID(), license_id: IDS.license, display_name: "Synthetic", bio: "Bio",
      social_links: "{}", theme_settings: "{}", is_public: true,
    });
    assert.equal(await accessGeneration(), 10);
    await fixture.database.prepare('UPDATE "fanmark_profiles" SET "is_public" = 0 WHERE "license_id" = ?')
      .bind(IDS.license)
      .run();
    assert.equal(await accessGeneration(), 11);
    await fixture.database.prepare('DELETE FROM "fanmark_profiles" WHERE "license_id" = ?')
      .bind(IDS.license)
      .run();
    assert.equal(await accessGeneration(), 12);

    await fixture.database.prepare('UPDATE "fanmarks" SET "normalized_emoji_ids" = ? WHERE "id" = ?')
      .bind(JSON.stringify([randomUUID()]), IDS.fanmark)
      .run();
    assert.equal(await accessGeneration(), 13);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("validates the integrated target profile read-only before refusing generic credential import", async () => {
  const fixture = await setup();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-expiry-import-profile-"));
  await fs.chmod(scratch, 0o700);
  const snapshotDir = path.join(scratch, "snapshot");
  const reportPath = path.join(scratch, "report", "import.json");
  try {
    const snapshot = await emptySnapshot(fixture.catalog, snapshotDir);
    const importOptions = {
      manifestPath: snapshot.manifestPath,
      database: fixture.database,
      destinationId: "local-source-shaped-profile",
      targetIncarnation: "source-profile-incarnation-1",
      reportPath,
      mode: "local",
      allowUnresolvedGates: true,
      expectedTargetProfile: {
        lifecyclePlan: fixture.lifecyclePlan,
        generationPlan: fixture.generationPlan,
        credentialPlan: fixture.credentialPlan,
        descriptor: credentialDescriptor(),
      },
    };
    await fixture.database.prepare('CREATE VIEW "unexpected_profile_view" AS SELECT 1').run();
    await assert.rejects(
      importD1Snapshot(importOptions),
      (error) => error.code === "target_profile_schema_mismatch",
    );
    await fixture.database.prepare('DROP VIEW "unexpected_profile_view"').run();
    await assert.rejects(
      importD1Snapshot(importOptions),
      (error) => error.code === "credential_transform_required",
    );

    const ledger = await row(fixture.database,
      'SELECT COUNT(*) AS count FROM "sqlite_master" WHERE "type" = \'table\' AND "name" LIKE \'__fanmark_d1_import_%\'',
    );
    assert.equal(ledger.count, 0);
    await assert.rejects(fs.stat(reportPath), (error) => error.code === "ENOENT");
    await assert.rejects(fs.stat(path.dirname(reportPath)), (error) => error.code === "ENOENT");
    assert.equal(await row(fixture.database,
      'SELECT COUNT(*) AS count FROM "fanmark_password_configs"',
    ).then((result) => result.count), 0);
  } finally {
    await fixture.miniflare.dispose();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test("binds the protected-access extension to the full source profile and verifies exact D1 readback", async () => {
  const fixture = await setup();
  try {
    const plan = generateVerifiedAccessSchema({
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      credentialPlan: fixture.credentialPlan,
    });
    const inputs = {
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      credentialPlan: fixture.credentialPlan,
    };
    const applied = await applyVerifiedAccessSchema({ database: fixture.database, plan, ...inputs });
    assert.equal(applied.status, "applied");
    assert.equal(applied.extensionDigest, plan.extensionDigest);
    const inspected = await inspectVerifiedAccessSchema(fixture.database, plan, inputs);
    assert.equal(inspected.complete, true);
    assert.deepEqual(inspected.missing, []);
    assert.deepEqual(await applyVerifiedAccessSchema({ database: fixture.database, plan, ...inputs }), {
      status: "already_applied",
      extensionDigest: plan.extensionDigest,
    });

    // Simulate a complete v1 installation: v2 differs only by its
    // version-bound, hash-free runtime credential evidence table.
    await fixture.database.prepare('DROP TABLE "fanmark_password_runtime_evidence"').run();
    assert.deepEqual(await applyVerifiedAccessSchema({ database: fixture.database, plan, ...inputs }), {
      status: "upgraded",
      extensionDigest: plan.extensionDigest,
    });
    const upgraded = await inspectVerifiedAccessSchema(fixture.database, plan, inputs);
    assert.equal(upgraded.complete, true);
    assert.deepEqual(upgraded.missing, []);

    const policy = await row(fixture.database,
      'SELECT "window_ms", "max_attempts", "reservation_ms" FROM "fanmark_access_rate_policy" WHERE "id" = 1',
    );
    assert.deepEqual(policy, { window_ms: 300000, max_attempts: 5, reservation_ms: 30000 });
    const auditColumns = await fixture.database.prepare('PRAGMA table_info("fanmark_access_attempt_audit")').all();
    const auditColumnNames = auditColumns.results.map((column) => column.name);
    assert.equal(auditColumnNames.includes("license_incarnation"), true);
    assert.equal(auditColumnNames.some((name) => /password_hash|raw_password|password_value|raw_ip|user_agent|token/iu.test(String(name))), false);

    await fixture.database.prepare('CREATE VIEW "unexpected_verified_access_view" AS SELECT 1').run();
    await assert.rejects(
      inspectVerifiedAccessSchema(fixture.database, plan, inputs),
      (error) => error.code === "verified_access_schema_unexpected",
    );
    await fixture.database.prepare('DROP VIEW "unexpected_verified_access_view"').run();
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("active-to-grace invalidates verified access against the full source-shaped D1 profile", async () => {
  const fixture = await setup();
  let target;
  try {
    const verifiedAccessPlan = generateVerifiedAccessSchema({
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      credentialPlan: fixture.credentialPlan,
    });
    await applyVerifiedAccessSchema({
      database: fixture.database,
      plan: verifiedAccessPlan,
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      credentialPlan: fixture.credentialPlan,
    });
    const hash = await bcrypt.hash("2468", 10);
    target = await seedProtectedTarget(fixture, hash);
    const origin = "https://access.example.test";
    const secret = "synthetic-verified-access-secret-32-characters";
    const env = {
      ACCESS_DB: fixture.database,
      VERIFIED_ACCESS_BACKEND: "d1",
      VERIFIED_ACCESS_SECRET: secret,
      VERIFIED_ACCESS_ORIGINS: origin,
    };
    setVerificationTestHooks({ requestAddress: () => "198.51.100.61" });
    const verified = await handleVerifiedAccessRequest(new Request(
      `https://access.example.test/api/fanmarks/access/short/${target.shortId}/verify-password`,
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.61" },
        body: JSON.stringify({ password: "2468" }),
      },
    ), env);
    assert.equal(verified.status, 204);
    const cookie = verified.headers.get("set-cookie").split(";", 1)[0];
    const protectedResponse = await handleVerifiedAccessRequest(new Request(
      `https://access.example.test/api/fanmarks/access/short/${target.shortId}/protected`,
      {
        headers: { Origin: origin, Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
      },
    ), env);
    assert.equal(protectedResponse.status, 200);
    assert.deepEqual(await protectedResponse.json(), {
      fanmarkId: target.fanmarkId,
      licenseId: target.licenseId,
      accessType: "text",
      textContent: "Synthetic protected message",
    });
    const proof = await row(fixture.database,
      'SELECT "selector_kind", "password_generation", "access_generation", "license_incarnation" FROM "fanmark_access_proofs" WHERE "license_id" = ?',
      target.licenseId,
    );
    assert.deepEqual(proof, { selector_kind: "short", password_generation: 1, access_generation: 3, license_incarnation: 0 });

    const expired = await repository(fixture, {
      capturedNow: "2041-01-01T00:00:00.000000Z",
    }).runActiveToGrace();
    assert.equal(expired.status, "completed");
    assert.equal(expired.processed, 1);
    assert.equal(expired.conflicts, 0);
    const postExpiryLicense = await row(fixture.database,
      'SELECT "status", "lifecycle_generation" FROM "fanmark_licenses" WHERE "id" = ?',
      target.licenseId,
    );
    assert.deepEqual(postExpiryLicense, { status: "grace", lifecycle_generation: 1 });
    const postExpiryVersions = await row(fixture.database,
      'SELECT "license_incarnation", "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
      target.licenseId,
    );
    assert.deepEqual(postExpiryVersions, { license_incarnation: 0, password_generation: 1, access_generation: 4 });
    const unchangedPassword = await row(fixture.database,
      'SELECT "access_password", "is_enabled" FROM "fanmark_password_configs" WHERE "license_id" = ?',
      target.licenseId,
    );
    assert.deepEqual(unchangedPassword, { access_password: hash, is_enabled: 1 });

    const oldProofRead = await handleVerifiedAccessRequest(new Request(
      `https://access.example.test/api/fanmarks/access/short/${target.shortId}/protected`,
      {
        headers: { Origin: origin, Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
      },
    ), env);
    assert.equal(oldProofRead.status, 401);
    const reverify = await handleVerifiedAccessRequest(new Request(
      `https://access.example.test/api/fanmarks/access/short/${target.shortId}/verify-password`,
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.61" },
        body: JSON.stringify({ password: "2468" }),
      },
    ), env);
    assert.equal(reverify.status, 401);
  } finally {
    setVerificationTestHooks({});
    await fixture.miniflare.dispose();
  }
});

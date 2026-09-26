#!/usr/bin/env node

/**
 * Apply the plan-bound business-D1 support extensions to the isolated staging
 * database. Trigger DDL is executed one statement per Wrangler request because
 * the migration-file path failed to apply the generated trigger group. Each
 * migration is recorded only after its exact schema readback passes.
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { inspectCredentialTransformSchema } from "./credential-transform-schema.mjs";
import { compileCredentialDescriptor } from "./credential-descriptor.mjs";
import { generateCredentialTransformSchema } from "./credential-transform-schema.mjs";
import { inspectLifecycleGenerationSchema, generateLifecycleGenerationSchema } from "./lifecycle-generation-schema.mjs";
import { generateLifecycleTargetSchema } from "./lifecycle-target-schema.mjs";
import { convertSchema } from "./schema-convert.mjs";
import { inspectVerifiedAccessSchema, generateVerifiedAccessSchema } from "./verified-access-schema.mjs";
import { buildBusinessSchemaExtensionMigrations } from "./business-schema-extensions.mjs";
import { createWranglerD1Database } from "./wrangler-d1-database.mjs";
import {
  businessTablesWithoutStagingBaselines,
  notificationMasterBaselineState,
  NOTIFICATION_MASTER_COUNTS_SQL,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const DATABASE_NAME = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const BINDING = "FANMARK_DB";
const CONFIG_PATH = path.resolve("workers/api/wrangler.app-staging.jsonc");
const WRANGLER_VERSION = "4.139.0";

const MIGRATION_NAMES = Object.freeze([
  "0000_business_schema_v4_staging.sql",
  "0001_lifecycle_target_staging.sql",
  "0002_lifecycle_generation_staging.sql",
  "0003_credential_transform_staging.sql",
  "0004_verified_access_staging.sql",
  "0005_lottery_plan_journal_staging.sql",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args, "--config", CONFIG_PATH], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) fail("wrangler_command_failed");
  return result;
}

function runWranglerJson(args) {
  let value;
  try {
    value = JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error?.code) throw error;
    fail("wrangler_json_invalid");
  }
  return value;
}

function runD1(sql) {
  const result = runWranglerJson([
    "d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sql,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) {
    fail("business_staging_d1_command_failed");
  }
  return result;
}

function assertPrivateFile(filePath, stat) {
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) fail("private_input_permissions");
  const resolved = path.resolve(filePath);
  if (resolved === process.cwd() || resolved.startsWith(`${process.cwd()}${path.sep}`)) {
    fail("private_inputs_must_be_outside_repository");
  }
}

async function readPrivateJson(envName) {
  const filePath = process.env[envName];
  if (typeof filePath !== "string" || filePath.length === 0) fail(`${envName.toLowerCase()}_required`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) fail("private_input_missing");
  assertPrivateFile(filePath, stat);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    fail("private_input_invalid");
  }
}

function objectKey(object) {
  return `${object.type}:${object.name}`;
}

function normalizedSql(value) {
  return String(value ?? "").replace(/;+\s*$/u, "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function allPlanObjects(plan) {
  return Object.values(plan.objectInventory ?? {}).flatMap((objects) => objects);
}

function makePlans(catalog, descriptor) {
  compileCredentialDescriptor({ catalog, descriptor });
  const convertedSchema = convertSchema(catalog, { credentialDescriptor: descriptor });
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema, credentialDescriptor: descriptor });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan, credentialDescriptor: descriptor });
  const credentialPlan = generateCredentialTransformSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor });
  const verifiedAccessPlan = generateVerifiedAccessSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan });
  return { convertedSchema, lifecyclePlan, generationPlan, credentialPlan, verifiedAccessPlan };
}

async function assertStagingTarget(catalog) {
  let config;
  try {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch {
    fail("staging_config_invalid");
  }
  if (config.account_id !== ACCOUNT_ID) fail("staging_config_account_mismatch");
  const binding = config.d1_databases?.find((entry) => entry.binding === BINDING);
  if (!binding || binding.database_name !== DATABASE_NAME || binding.database_id !== DATABASE_ID ||
      binding.remote !== true || binding.migrations_dir !== "migrations-business") {
    fail("staging_config_database_mismatch");
  }

  const identity = runWranglerJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) {
    fail("cloudflare_account_mismatch");
  }
  const databases = runWranglerJson(["d1", "list", "--json"]);
  if (!Array.isArray(databases) || !databases.some((entry) =>
    (entry.uuid ?? entry.database_id ?? entry.id) === DATABASE_ID &&
    (entry.name ?? entry.database_name) === DATABASE_NAME)) {
    fail("cloudflare_database_mismatch");
  }

  const sourceTables = [...new Set(catalog.columns.map((column) => column.table_name))].sort();
  if (sourceTables.length !== 40) fail("source_table_inventory_changed");
  const masterCounts = runD1(NOTIFICATION_MASTER_COUNTS_SQL)[0]?.results?.[0];
  const settingCounts = runD1(STAGING_NON_USER_CONFIG_BASELINE_SQL)[0]?.results?.[0];
  if (notificationMasterBaselineState(masterCounts) === "invalid") fail("notification_master_baseline_invalid");
  if (stagingNonUserConfigBaselineState(settingCounts) === "invalid") fail("system_setting_baseline_invalid");
  const sourceDataTables = businessTablesWithoutStagingBaselines(sourceTables);
  const totalRowsSql = `SELECT ${sourceDataTables.map((name) => `(SELECT COUNT(*) FROM "${name.replaceAll('"', '""')}")`).join(" + ")} AS total_rows`;
  const totalRows = Number(runD1(totalRowsSql)[0]?.results?.[0]?.total_rows);
  if (totalRows !== 0) fail("business_staging_not_empty");

  const rows = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"')[0]?.results;
  if (!Array.isArray(rows)) fail("business_migration_ledger_unreadable");
  const actualNames = rows.map((row) => row.name);
  const expectedPrefix = MIGRATION_NAMES.slice(0, actualNames.length);
  if (actualNames.length > MIGRATION_NAMES.length ||
      actualNames.some((name, index) => name !== expectedPrefix[index])) {
    fail("business_migration_ledger_unexpected");
  }
  return { sourceTables: sourceTables.length, totalRows, migrationNames: actualNames };
}

async function ensureMigrationRecorded(name, database) {
  const rows = await database.prepare('SELECT "name" FROM "d1_migrations" ORDER BY "id"').all();
  const names = rows.results.map((row) => row.name);
  const index = MIGRATION_NAMES.indexOf(name);
  if (index < 2) fail("business_migration_name_invalid");
  if (names.includes(name)) {
    if (names[index] !== name) fail("business_migration_ledger_order_mismatch");
    return "already_recorded";
  }
  if (names.length !== index) fail("business_migration_ledger_order_mismatch");
  runD1(`INSERT INTO "d1_migrations" ("name") VALUES ('${name}')`);
  const after = await database.prepare('SELECT "name" FROM "d1_migrations" ORDER BY "id"').all();
  if (after.results.at(-1)?.name !== name) fail("business_migration_ledger_readback_failed");
  return "recorded";
}

async function readSchemaObjects(database) {
  const result = await database.prepare(
    'SELECT "type", "name", "sql" FROM "sqlite_schema" WHERE "name" NOT LIKE \'sqlite_%\' ORDER BY "type", "name"',
  ).all();
  if (!Array.isArray(result.results)) fail("business_schema_readback_failed");
  return new Map(result.results.map((row) => [`${row.type}:${row.name}`, row]));
}

async function inspectLotteryPlanJournal(database) {
  const tableSql = await database.prepare(`SELECT sql FROM sqlite_schema
    WHERE type = 'table' AND name = 'license_grace_finalization_items'`).first("sql");
  const indexSql = await database.prepare(`SELECT sql FROM sqlite_schema
    WHERE type = 'index' AND name = 'license_grace_finalization_items_cursor'`).first("sql");
  let columns;
  let foreignKeys;
  try {
    columns = await database.prepare("PRAGMA table_info('license_grace_finalization_items')").all();
    foreignKeys = await database.prepare("PRAGMA foreign_key_check").all();
  } catch {
    return { complete: false };
  }
  const expectedColumns = [
    "run_id", "license_id", "fanmark_id", "fanmark_short_id", "fanmark_name", "user_id",
    "license_end", "grace_expires_at", "is_returned", "license_incarnation",
    "license_lifecycle_generation", "access_generation", "operation_id", "audit_id",
    "notification_event_id", "lottery_seed", "lottery_inputs_json", "lottery_plan_json",
    "outcome", "completed_at",
  ];
  let migration;
  try {
    migration = await fs.readFile(path.resolve(
      "workers/api/migrations-business/0005_lottery_plan_journal_staging.sql",
    ), "utf8");
  } catch {
    fail("lottery_journal_migration_missing");
  }
  const expectedTable = migration.match(/CREATE TABLE "license_grace_finalization_items"\s*\([\s\S]*?\n\);/u)?.[0];
  const expectedIndex = migration.match(/CREATE INDEX "license_grace_finalization_items_cursor"\s*\n[^;]+;/u)?.[0];
  const actualColumnNames = Array.isArray(columns?.results) ? columns.results.map((row) => row.name) : [];
  return {
    complete: Boolean(tableSql && indexSql && expectedTable && expectedIndex &&
      normalizedSql(tableSql) === normalizedSql(expectedTable) &&
      normalizedSql(indexSql) === normalizedSql(expectedIndex) &&
      JSON.stringify(actualColumnNames) === JSON.stringify(expectedColumns) &&
      Array.isArray(foreignKeys?.results) && foreignKeys.results.length === 0),
    tableSql,
    indexSql,
    columns: actualColumnNames,
  };
}

async function applyLotteryPlanJournalFile() {
  const migrationName = MIGRATION_NAMES[5];
  const migrationPath = path.resolve("workers/api/migrations-business", migrationName);
  const migration = await fs.readFile(migrationPath, "utf8").catch(() => null);
  if (migration === null) fail("lottery_journal_migration_missing");
  const importSql = `${migration}\nINSERT INTO "d1_migrations" ("name") VALUES ('${migrationName}');\n`;
  const importPath = path.join(os.tmpdir(), `fanmark-business-journal-${process.pid}-${randomUUID()}.sql`);
  await fs.writeFile(importPath, importSql, { mode: 0o600 });
  try {
    runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--file", importPath]);
  } finally {
    await fs.rm(importPath, { force: true });
  }
}

async function applyPlannedObjects(objects, liveObjects) {
  for (const expected of objects) {
    const key = objectKey(expected);
    const actual = liveObjects.get(key);
    if (actual) {
      if (normalizedSql(actual.sql) !== normalizedSql(expected.sql)) fail("business_extension_object_mismatch");
      continue;
    }
    const results = runD1(expected.sql);
    if (!Array.isArray(results) || results.some((entry) => entry?.success !== true)) {
      fail("business_extension_object_apply_failed");
    }
    liveObjects.set(key, { ...expected, type: expected.type });
  }
  return liveObjects;
}

function requireNoUnexpectedTriggers(liveObjects, expectedPlans) {
  const expected = new Map(expectedPlans.flatMap((plan) => plan.objectInventory.triggers)
    .map((object) => [objectKey(object), object]));
  for (const [key, actual] of liveObjects) {
    if (actual.type !== "trigger") continue;
    const planned = expected.get(key);
    if (!planned || normalizedSql(actual.sql) !== normalizedSql(planned.sql)) {
      fail("business_extension_trigger_unexpected");
    }
  }
}

async function apply({ catalog, descriptor, plans, mode }) {
  const target = await assertStagingTarget(catalog);
  const database = createWranglerD1Database({
    wranglerPath: "npx",
    configPath: CONFIG_PATH,
    binding: BINDING,
    execute: runD1,
  });
  const generated = buildBusinessSchemaExtensionMigrations({ catalog, descriptor });
  for (const migration of generated.migrations) {
    const filePath = path.resolve("workers/api/migrations-business", migration.file);
    const saved = await fs.readFile(filePath, "utf8").catch(() => null);
    if (saved !== migration.content) fail("business_extension_migration_drift");
  }

  const expectedLedger = MIGRATION_NAMES;
  let ledger = target.migrationNames;
  let liveObjects = await readSchemaObjects(database);
  requireNoUnexpectedTriggers(liveObjects, [plans.generationPlan, plans.verifiedAccessPlan]);
  const plannedTriggerObjects = [...plans.generationPlan.objectInventory.triggers, ...plans.verifiedAccessPlan.objectInventory.triggers];
  const plannedTriggerByKey = new Map(plannedTriggerObjects.map((object) => [objectKey(object), object]));
  for (const [key, actual] of liveObjects) {
    if (actual.type !== "trigger") continue;
    const planned = plannedTriggerByKey.get(key);
    if (!planned || normalizedSql(actual.sql) !== normalizedSql(planned.sql)) fail("business_extension_trigger_unexpected");
  }

  const credentialInputs = { catalog, convertedSchema: plans.convertedSchema, lifecyclePlan: plans.lifecyclePlan, generationPlan: plans.generationPlan, descriptor };
  const accessInputs = { catalog, convertedSchema: plans.convertedSchema, lifecyclePlan: plans.lifecyclePlan, generationPlan: plans.generationPlan, credentialPlan: plans.credentialPlan };
  const results = [];

  if (mode === "--verify") {
    if (JSON.stringify(ledger) !== JSON.stringify(expectedLedger)) fail("business_migration_ledger_incomplete");
    const generation = await inspectLifecycleGenerationSchema(database, plans.generationPlan, plans.lifecyclePlan, [
      ...allPlanObjects(plans.credentialPlan),
      ...allPlanObjects(plans.verifiedAccessPlan),
    ]);
    if (!generation.complete) fail("lifecycle_generation_readback_failed");
    const credential = await inspectCredentialTransformSchema(database, plans.credentialPlan, {
      ...credentialInputs,
      additionalObjects: allPlanObjects(plans.verifiedAccessPlan),
    });
    if (!credential.complete) fail("credential_transform_readback_failed");
    const access = await inspectVerifiedAccessSchema(database, plans.verifiedAccessPlan, accessInputs);
    if (!access.complete) fail("verified_access_readback_failed");
    const lotteryJournal = await inspectLotteryPlanJournal(database);
    if (!lotteryJournal.complete) fail("lottery_journal_readback_failed");
    results.push(...ledger.slice(2).map((migration) => ({ migration, status: "verified" })));
  } else {
    while (ledger.length < expectedLedger.length) {
      if (ledger.length === 2) {
        const state = await inspectLifecycleGenerationSchema(database, plans.generationPlan, plans.lifecyclePlan);
        if (state.mismatched.length > 0) fail("lifecycle_generation_existing_object_mismatch");
        const triggerNames = [...liveObjects.values()].filter((object) => object.type === "trigger").map((object) => object.name);
        const expectedNames = new Set(plans.generationPlan.objectInventory.triggers.map((object) => object.name));
        if (triggerNames.some((name) => !expectedNames.has(name)) || triggerNames.length !== state.present) {
          fail("lifecycle_generation_readback_mismatch");
        }
        liveObjects = await applyPlannedObjects(plans.generationPlan.objectInventory.triggers, liveObjects);
        const after = await inspectLifecycleGenerationSchema(database, plans.generationPlan, plans.lifecyclePlan);
        if (!after.complete) fail("lifecycle_generation_readback_failed");
        const status = await ensureMigrationRecorded(MIGRATION_NAMES[2], database);
        ledger = [...ledger, MIGRATION_NAMES[2]];
        results.push({ migration: MIGRATION_NAMES[2], status, statements: plans.generationPlan.statements.length });
        continue;
      }

      if (ledger.length === 3) {
        const before = await inspectCredentialTransformSchema(database, plans.credentialPlan, credentialInputs);
        liveObjects = await applyPlannedObjects(allPlanObjects(plans.credentialPlan), liveObjects);
        const after = await inspectCredentialTransformSchema(database, plans.credentialPlan, credentialInputs);
        if (!after.complete) fail("credential_transform_readback_failed");
        const status = await ensureMigrationRecorded(MIGRATION_NAMES[3], database);
        ledger = [...ledger, MIGRATION_NAMES[3]];
        results.push({ migration: MIGRATION_NAMES[3], status, previouslyMissing: before.missing.length });
        continue;
      }

      if (ledger.length === 4) {
        const before = await inspectVerifiedAccessSchema(database, plans.verifiedAccessPlan, accessInputs);
        liveObjects = await applyPlannedObjects(allPlanObjects(plans.verifiedAccessPlan), liveObjects);
        const seed = plans.verifiedAccessPlan.seedStatements[0].replace(/;\s*$/u, "");
        const policy = await database.prepare('SELECT "window_ms", "max_attempts", "reservation_ms" FROM "fanmark_access_rate_policy" WHERE "id" = 1').first().catch(() => null);
        if (!policy) runD1(seed);
        const after = await inspectVerifiedAccessSchema(database, plans.verifiedAccessPlan, accessInputs);
        if (!after.complete) fail("verified_access_readback_failed");
        const status = await ensureMigrationRecorded(MIGRATION_NAMES[4], database);
        ledger = [...ledger, MIGRATION_NAMES[4]];
        results.push({ migration: MIGRATION_NAMES[4], status, previouslyMissing: before.missing.length });
        continue;
      }

      if (ledger.length === 5) {
        let journal = await inspectLotteryPlanJournal(database);
        if (!journal.complete) {
          const liveItems = liveObjects.get("table:license_grace_finalization_items");
          const plannedItems = allPlanObjects(plans.lifecyclePlan)
            .find((object) => object.type === "table" && object.name === "license_grace_finalization_items");
          if (!liveItems || !plannedItems ||
              normalizedSql(liveItems.sql) !== normalizedSql(plannedItems.sql)) {
            fail("lottery_journal_pre_schema_mismatch");
          }
          await applyLotteryPlanJournalFile();
          journal = await inspectLotteryPlanJournal(database);
          if (!journal.complete) fail("lottery_journal_readback_failed");
        }
        const status = await ensureMigrationRecorded(MIGRATION_NAMES[5], database);
        ledger = [...ledger, MIGRATION_NAMES[5]];
        results.push({ migration: MIGRATION_NAMES[5], status, statements: 6 });
        continue;
      }
      fail("business_migration_ledger_order_mismatch");
    }
    if (JSON.stringify(ledger) !== JSON.stringify(expectedLedger)) fail("business_migration_ledger_final_mismatch");
  }

  return {
    target,
    sourceFingerprint: plans.lifecyclePlan.sourceFingerprint,
    extensionDigests: {
      lifecycle: plans.lifecyclePlan.extensionDigest,
      generation: plans.generationPlan.extensionDigest,
      credential: plans.credentialPlan.extensionDigest,
      verifiedAccess: plans.verifiedAccessPlan.extensionDigest,
    },
    extensionCounts: {
      lifecycleTables: plans.lifecyclePlan.objectInventory.tables.length,
      generationTriggers: plans.generationPlan.objectInventory.triggers.length,
      credentialObjects: allPlanObjects(plans.credentialPlan).length,
      verifiedAccessObjects: allPlanObjects(plans.verifiedAccessPlan).length,
      lotteryJournalColumns: 3,
      verifiedAccessSeedRows: 1,
    },
    deployable: plans.convertedSchema.report.deployable,
    unresolvedGateCount: plans.convertedSchema.report.unresolvedGateCount,
    migrations: results,
  };
}

async function main(args) {
  const mode = args[0];
  if (args.length !== 1 || !["--verify", "--apply-staging"].includes(mode)) {
    fail("usage: apply-business-staging-extensions.mjs --verify|--apply-staging");
  }
  if (process.versions.node !== "22.6.0") fail("node_version_mismatch");
  const catalog = await readPrivateJson("FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG");
  const descriptor = await readPrivateJson("FANMARK_PRIVATE_CREDENTIAL_DESCRIPTOR");
  const plans = makePlans(catalog, descriptor);
  process.stdout.write(`${JSON.stringify(await apply({ catalog, descriptor, plans, mode }), null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error?.code ?? "business_staging_extension_failed";
    const detail = typeof error?.cause === "string" && /^[A-Za-z0-9:_-]+$/u.test(error.cause)
      ? `:${error.cause}`
      : "";
    process.stderr.write(`${code}${detail}\n`);
    process.exitCode = 1;
  });
}

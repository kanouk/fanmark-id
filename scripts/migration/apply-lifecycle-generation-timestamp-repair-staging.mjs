#!/usr/bin/env node

/**
 * Apply the guarded, schema-only lifecycle timestamp repair to business
 * staging. The command rejects any target, migration-ledger, or trigger state
 * other than the reviewed staging shape and verifies every trigger afterward.
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { convertSchema } from "./schema-convert.mjs";
import { generateLifecycleTargetSchema } from "./lifecycle-target-schema.mjs";
import { generateLifecycleGenerationSchema } from "./lifecycle-generation-schema.mjs";
import { buildLifecycleGenerationTimestampRepairMigration } from "./lifecycle-generation-timestamp-repair.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG_PATH = path.join(ROOT, "workers/api/wrangler.app-staging.jsonc");
const DATABASE_NAME = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const WRANGLER_VERSION = "4.139.0";
const MIGRATION_FILE = "0017_lifecycle_generation_timestamp_precision.sql";
const PROFILE_MIGRATIONS = [
  "0000_business_schema_v4_staging.sql",
  "0001_lifecycle_target_staging.sql",
  "0002_lifecycle_generation_staging.sql",
  "0003_credential_transform_staging.sql",
  "0004_verified_access_staging.sql",
  "0005_lottery_plan_journal_staging.sql",
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args, extraEnv = {}) {
  const result = spawnSync("npx", [
    "--yes", "wrangler@" + WRANGLER_VERSION, ...args, "--config", CONFIG_PATH,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...extraEnv },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000,
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
  const response = runWranglerJson([
    "d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sql,
  ]);
  if (!Array.isArray(response) || response.some((entry) => entry?.success !== true)) {
    fail("staging_d1_read_failed");
  }
  return response[0]?.results ?? [];
}

async function assertStagingTarget() {
  let config;
  try {
    config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch {
    fail("staging_config_invalid");
  }
  if (config.account_id !== ACCOUNT_ID) fail("staging_config_account_mismatch");
  const binding = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  if (!binding || binding.database_name !== DATABASE_NAME ||
      binding.database_id !== DATABASE_ID || binding.remote !== true ||
      binding.migrations_dir !== "migrations-business") {
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
}

async function readPrivateCatalog() {
  const filePath = process.env.FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG;
  if (typeof filePath !== "string" || filePath.length === 0) {
    fail("fanmark_private_schema_readiness_catalog_required");
  }
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) fail("private_schema_catalog_missing");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    fail("private_schema_catalog_permissions");
  }
  const resolved = await fs.realpath(filePath);
  if (resolved === ROOT || resolved.startsWith(ROOT + path.sep)) {
    fail("private_schema_catalog_must_be_outside_repository");
  }
  try {
    return JSON.parse(await fs.readFile(resolved, "utf8"));
  } catch {
    fail("private_schema_catalog_invalid");
  }
}

function normalizedSql(value) {
  return String(value ?? "").replace(/;+\s*$/u, "").replace(/\s+/gu, " ").trim();
}

function expectedTriggerRows(plan, legacy) {
  return plan.objectInventory.triggers.map((trigger) => ({
    name: trigger.name,
    sql: legacy ? trigger.sql.replaceAll("%f000Z", "%fZ") : trigger.sql,
  }));
}

function assertTriggerRows(actualRows, expectedRows, code) {
  if (!Array.isArray(actualRows) || actualRows.length !== expectedRows.length) fail(code);
  const actual = new Map(actualRows.map((row) => [String(row.name), String(row.sql ?? "")]));
  if (actual.size !== expectedRows.length) fail(code);
  for (const expected of expectedRows) {
    if (normalizedSql(actual.get(expected.name)) !== normalizedSql(expected.sql)) fail(code);
  }
}

function readPendingMigrations() {
  const result = runWrangler(["d1", "migrations", "list", DATABASE_NAME, "--remote"]);
  return [...result.stdout.matchAll(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/gu)].map((match) => match[0]);
}

async function apply() {
  await assertStagingTarget();
  const catalog = await readPrivateCatalog();
  const convertedSchema = convertSchema(catalog);
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan });
  const generated = buildLifecycleGenerationTimestampRepairMigration(catalog);
  const migrationPath = path.join(ROOT, "workers/api/migrations-business", MIGRATION_FILE);
  const savedMigration = await fs.readFile(migrationPath, "utf8").catch(() => null);
  if (savedMigration !== generated.content) fail("staging_timestamp_migration_drift");

  const migrationLedger = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"')
    .map((row) => String(row.name));
  const alreadyApplied = migrationLedger.length === PROFILE_MIGRATIONS.length + 12 &&
    migrationLedger.at(-1) === MIGRATION_FILE;
  const expectedBeforeLength = PROFILE_MIGRATIONS.length + 11;
  if ((!alreadyApplied && migrationLedger.length !== expectedBeforeLength) ||
      (!alreadyApplied && migrationLedger.at(-1) !== "0016_broadcast_email_delivery.sql")) {
    fail("staging_migration_ledger_unexpected");
  }
  for (const migration of PROFILE_MIGRATIONS) {
    if (!migrationLedger.includes(migration)) fail("staging_profile_migration_missing");
  }
  const pending = readPendingMigrations();
  if (alreadyApplied) {
    if (pending.length !== 0) fail("staging_pending_migrations_unexpected");
    const actual = runD1(
      'SELECT "name", "sql" FROM "sqlite_schema" WHERE "type" = \'trigger\' AND "name" GLOB \'fanmark*\' ORDER BY "name"',
    );
    assertTriggerRows(actual, expectedTriggerRows(generationPlan, false), "staging_lifecycle_generation_readback_failed");
    process.stdout.write(JSON.stringify({
      database: DATABASE_NAME,
      migration: MIGRATION_FILE,
      status: "already_applied",
      exactTriggerReadback: actual.length,
      pendingMigrations: 0,
    }, null, 2) + "\n");
    return;
  }
  if (pending.length !== 1 || pending[0] !== MIGRATION_FILE) {
    fail("staging_pending_migrations_unexpected");
  }

  const actualBefore = runD1(
    'SELECT "name", "sql" FROM "sqlite_schema" WHERE "type" = \'trigger\' AND "name" GLOB \'fanmark*\' ORDER BY "name"',
  );
  let beforeState;
  try {
    assertTriggerRows(actualBefore, expectedTriggerRows(generationPlan, true), "legacy");
    beforeState = "legacy_millisecond";
  } catch {
    try {
      assertTriggerRows(actualBefore, expectedTriggerRows(generationPlan, false), "canonical");
      beforeState = "already_canonical";
    } catch {
      fail("staging_lifecycle_generation_triggers_unexpected");
    }
  }

  runWrangler([
    "d1", "migrations", "apply", DATABASE_NAME, "--remote",
  ], { CI: "1" });

  const actualAfter = runD1(
    'SELECT "name", "sql" FROM "sqlite_schema" WHERE "type" = \'trigger\' AND "name" GLOB \'fanmark*\' ORDER BY "name"',
  );
  assertTriggerRows(actualAfter, expectedTriggerRows(generationPlan, false), "staging_lifecycle_generation_readback_failed");
  const finalLedger = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"')
    .map((row) => String(row.name));
  if (finalLedger.length !== migrationLedger.length + 1 ||
      finalLedger.at(-1) !== MIGRATION_FILE) {
    fail("staging_migration_ledger_readback_failed");
  }
  const finalPending = readPendingMigrations();
  if (finalPending.length !== 0) fail("staging_migration_still_pending");

  process.stdout.write(JSON.stringify({
    database: DATABASE_NAME,
    migration: MIGRATION_FILE,
    beforeState,
    replacedTriggers: generated.triggerCount,
    exactTriggerReadback: actualAfter.length,
    ledgerRecorded: finalLedger.at(-1) === MIGRATION_FILE,
    pendingMigrations: finalPending.length,
  }, null, 2) + "\n");
}

apply().catch((error) => {
  process.stderr.write((error?.code ?? "lifecycle_generation_timestamp_repair_apply_failed") + "\n");
  process.exitCode = 1;
});

#!/usr/bin/env node

/**
 * Apply or verify the additive, non-activating D1 invoice-projection schema
 * on the isolated fanmark-business-staging database.
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const DATABASE_NAME = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const CONFIG_PATH = path.resolve("workers/api/wrangler.app-staging.jsonc");
const MIGRATION_DIRECTORY = path.resolve("workers/api/migrations-business");
const MIGRATION_NAME = "0008_stripe_invoice_projection_staging.sql";
const WRANGLER_SCRIPT = path.resolve("workers/api/node_modules/wrangler/bin/wrangler.js");
const BASE_MIGRATIONS = Object.freeze([
  "0000_business_schema_v4_staging.sql",
  "0001_lifecycle_target_staging.sql",
  "0002_lifecycle_generation_staging.sql",
  "0003_credential_transform_staging.sql",
  "0004_verified_access_staging.sql",
  "0005_lottery_plan_journal_staging.sql",
  "0006_stripe_webhook_ingress_staging.sql",
  "0007_stripe_extension_application_staging.sql",
]);
const EXPECTED_MIGRATIONS = [...BASE_MIGRATIONS, MIGRATION_NAME];
const LATER_APPROVED_MIGRATIONS = [
  ...EXPECTED_MIGRATIONS,
  "0009_stripe_subscription_identity.sql",
  "0010_stripe_subscription_reconciliation_staging.sql",
  "0011_stripe_subscription_free_return.sql",
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_SCRIPT, ...args, "--config", CONFIG_PATH], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) fail("wrangler_command_failed");
  return result;
}

function runWranglerJson(args) {
  try {
    return JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error?.code) throw error;
    fail("wrangler_json_invalid");
  }
}

function runD1(sql) {
  const result = runWranglerJson([
    "d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sql,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) {
    fail("staging_d1_command_failed");
  }
  return result.flatMap((entry) => Array.isArray(entry.results) ? entry.results : []);
}

function expectedObjects(migration) {
  return [...migration.matchAll(/^CREATE (TABLE|INDEX) "?([A-Za-z_][A-Za-z0-9_]*)"?/gmu)]
    .map((match) => ({ type: match[1].toLowerCase(), name: match[2] }));
}

function normalizeSql(value) {
  return String(value ?? "")
    .replaceAll('"', "")
    .replace(/;+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function ensureOnlyAdditiveDdl(migration) {
  const statements = migration.replace(/^--.*(?:\r?\n|$)/gmu, "").split(";").map((item) => item.trim()).filter(Boolean);
  if (statements.length !== 4 || statements.some((statement) => !/^CREATE (?:TABLE|INDEX)\b/iu.test(statement))) {
    fail("stripe_invoice_migration_not_additive");
  }
  const objects = expectedObjects(migration);
  if (objects.length !== 4 || new Set(objects.map((object) => `${object.type}:${object.name}`)).size !== 4) {
    fail("stripe_invoice_migration_inventory_invalid");
  }
  return objects;
}

async function verifyTarget(migration, objects) {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8").catch(() => "null"));
  if (config?.account_id !== ACCOUNT_ID) fail("staging_config_account_mismatch");
  const binding = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  if (!binding || binding.database_name !== DATABASE_NAME || binding.database_id !== DATABASE_ID ||
      binding.remote !== true || binding.migrations_dir !== "migrations-business") {
    fail("staging_config_database_mismatch");
  }
  const vars = config.vars ?? {};
  if (["STRIPE_WEBHOOK_BACKEND", "STRIPE_DISPATCH_BACKEND", "STRIPE_EXTENSION_CHECKOUT_BACKEND"]
    .some((key) => Object.prototype.hasOwnProperty.call(vars, key))) {
    fail("stripe_staging_selector_must_remain_unset");
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

  const ledger = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"').map((row) => row.name);
  if (JSON.stringify(ledger) !== JSON.stringify(EXPECTED_MIGRATIONS) &&
      JSON.stringify(ledger) !== JSON.stringify(LATER_APPROVED_MIGRATIONS)) {
    fail("business_migration_ledger_mismatch");
  }
  const names = objects.map((object) => `'${object.name}'`).join(", ");
  const actual = runD1(`SELECT "type", "name", "sql" FROM "sqlite_schema" WHERE "name" IN (${names}) ORDER BY "type", "name"`);
  if (actual.length !== objects.length) fail("stripe_invoice_schema_object_count_mismatch");
  const expectedByName = new Map(objects.map((object) => [object.name, object]));
  for (const row of actual) {
    const expected = expectedByName.get(row.name);
    if (!expected || row.type !== expected.type) fail("stripe_invoice_schema_object_mismatch");
    const statement = migration.match(new RegExp(`^CREATE ${expected.type.toUpperCase()} "?${expected.name}"?[\\s\\S]*?;`, "mu"))?.[0];
    if (!statement || normalizeSql(statement) !== normalizeSql(row.sql)) fail("stripe_invoice_schema_sql_mismatch");
  }
  const counts = runD1(`
    SELECT
      (SELECT COUNT(*) FROM "stripe_sync_fences") AS fences,
      (SELECT COUNT(*) FROM "stripe_application_ledger") AS applications,
      (SELECT COUNT(*) FROM "stripe_webhook_receipts") AS receipts,
      (SELECT COUNT(*) FROM "stripe_webhook_dispatches") AS dispatches
  `)[0];
  if (!counts || Object.values(counts).some((value) => Number(value) !== 0)) {
    fail("stripe_staging_rows_not_empty");
  }
  const foreignKeys = runD1("PRAGMA foreign_key_check");
  if (foreignKeys.length > 0) fail("stripe_invoice_foreign_key_check_failed");
  return { migrationLedger: ledger.length, objects: objects.map((object) => object.name), counts };
}

async function applyMigrationFile(migration) {
  const migrationSql = `${migration.trim()}\nINSERT INTO "d1_migrations" ("name") VALUES ('${MIGRATION_NAME}');\n`;
  const importPath = path.join(os.tmpdir(), `fanmark-stripe-invoice-${process.pid}-${randomUUID()}.sql`);
  await fs.writeFile(importPath, migrationSql, { mode: 0o600 });
  try {
    runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--file", importPath]);
  } finally {
    await fs.rm(importPath, { force: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--apply" && mode !== "--verify") {
    fail("usage: apply-stripe-invoice-staging.mjs --apply|--verify");
  }
  const migration = await fs.readFile(path.join(MIGRATION_DIRECTORY, MIGRATION_NAME), "utf8");
  const objects = ensureOnlyAdditiveDdl(migration);
  if (mode === "--apply") {
    await verifyTargetBeforeApply();
    const ledger = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"').map((row) => row.name);
    if (JSON.stringify(ledger) === JSON.stringify(EXPECTED_MIGRATIONS) ||
        JSON.stringify(ledger) === JSON.stringify(LATER_APPROVED_MIGRATIONS)) {
      // Applying twice is a read-only verification.
    } else if (JSON.stringify(ledger) === JSON.stringify(BASE_MIGRATIONS)) {
      await applyMigrationFile(migration);
    } else {
      fail("business_migration_ledger_mismatch");
    }
  }
  const result = await verifyTarget(migration, objects);
  process.stdout.write(`${JSON.stringify({ status: "verified", migration: MIGRATION_NAME, ...result })}\n`);
}

async function verifyTargetBeforeApply() {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8").catch(() => "null"));
  if (config?.account_id !== ACCOUNT_ID) fail("staging_config_account_mismatch");
  const binding = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  if (!binding || binding.database_name !== DATABASE_NAME || binding.database_id !== DATABASE_ID ||
      binding.remote !== true || binding.migrations_dir !== "migrations-business") {
    fail("staging_config_database_mismatch");
  }
  const vars = config.vars ?? {};
  if (["STRIPE_WEBHOOK_BACKEND", "STRIPE_DISPATCH_BACKEND", "STRIPE_EXTENSION_CHECKOUT_BACKEND"]
    .some((key) => Object.prototype.hasOwnProperty.call(vars, key))) {
    fail("stripe_staging_selector_must_remain_unset");
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
  const priorLedger = runD1('SELECT "name" FROM "d1_migrations" ORDER BY "id"').map((row) => row.name);
  if (JSON.stringify(priorLedger) !== JSON.stringify(BASE_MIGRATIONS)) fail("business_migration_ledger_mismatch");
  const baseline = runD1(`SELECT
      (SELECT COUNT(*) FROM "fanmarks") AS fanmarks,
      (SELECT COUNT(*) FROM "fanmark_licenses") AS licenses,
      (SELECT COUNT(*) FROM "user_settings") AS user_settings,
      (SELECT COUNT(*) FROM "user_subscriptions") AS subscriptions,
      (SELECT COUNT(*) FROM "stripe_webhook_receipts") AS receipts,
      (SELECT COUNT(*) FROM "stripe_webhook_dispatches") AS dispatches`)[0];
  if (!baseline || Object.values(baseline).some((value) => Number(value) !== 0)) {
    fail("staging_user_or_billing_rows_not_empty");
  }
}

main().catch((error) => {
  const code = typeof error?.code === "string" ? error.code : "stripe_invoice_staging_failed";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { verifyRelease } from "../build-emoji-release.ts";
import { stageEmojiMasterRelease } from "./emoji-master-release-stage.mjs";
import { assertAuthSchemaEmpty, assertEmojiReleaseStateUnchanged, captureEmojiReleaseState } from "./emoji-master-release-remote-guards.mjs";
import { createWranglerD1Database } from "./wrangler-d1-database.mjs";

const EXPECTED_BINDING = "FANMARK_DB";
const EXPECTED_MIGRATIONS = [
  "0000_emoji_master.sql",
  "0001_emoji_master_release_staging.sql",
  "0002_emoji_master_release_activation.sql",
  "0003_better_auth_core.sql",
  "0004_reference_master_releases.sql",
  "0005_emoji_master_admin_guards.sql",
  "0006_reference_master_extension_prices.sql",
];

function fail(code) {
  throw new Error(code);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail("arguments_invalid");
    }
    values.set(key.slice(2), argv[++index]);
  }
  const required = ["account-id", "email", "database-name", "database-id", "release-directory", "config", "wrangler"];
  for (const key of required) if (!values.has(key)) fail("arguments_missing");
  if (values.size !== required.length) fail("arguments_invalid");
  return Object.fromEntries([...values].map(([key, value]) => [key.replaceAll("-", "_"), value]));
}

function runJsonCommand(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) fail("wrangler_identity_check_failed");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("wrangler_json_invalid");
  }
}

function readArray(value, label) {
  if (typeof value !== "string") fail(label);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(label);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) fail(label);
  return parsed;
}

function canonicalRecordMatches(actual, expected) {
  if (!actual || actual.id !== expected.id || actual.emoji !== expected.emoji ||
      actual.short_name !== expected.short_name || actual.category !== (expected.category ?? null) ||
      actual.subcategory !== (expected.subcategory ?? null) || actual.sort_order !== (expected.sort_order ?? null)) {
    return false;
  }
  try {
    return JSON.stringify(readArray(actual.keywords, "canonical_keywords_invalid")) === JSON.stringify(expected.keywords) &&
      JSON.stringify(readArray(actual.codepoints, "canonical_codepoints_invalid")) === JSON.stringify(expected.codepoints);
  } catch {
    return false;
  }
}

async function assertAccountAndDatabase(options) {
  const common = ["--config", options.config];
  const whoami = runJsonCommand(options.wrangler, ["whoami", "--json", ...common]);
  if (!whoami.loggedIn || whoami.email !== options.email ||
      !Array.isArray(whoami.accounts) || !whoami.accounts.some((account) => account.id === options.account_id)) {
    fail("cloudflare_account_mismatch");
  }

  const databases = runJsonCommand(options.wrangler, ["d1", "list", "--json", ...common]);
  if (!Array.isArray(databases)) fail("cloudflare_database_list_invalid");
  const target = databases.find((entry) =>
    (entry.uuid ?? entry.database_id ?? entry.id) === options.database_id &&
    (entry.name ?? entry.database_name) === options.database_name,
  );
  if (!target) fail("cloudflare_database_mismatch");
}

function assertConfig(options, config) {
  if (config.account_id !== options.account_id || !Array.isArray(config.d1_databases)) {
    fail("wrangler_config_account_mismatch");
  }
  const binding = config.d1_databases.find((entry) => entry.binding === EXPECTED_BINDING);
  if (!binding || binding.database_id !== options.database_id ||
      binding.database_name !== options.database_name || binding.migrations_dir !== "migrations" ||
      binding.migrations_pattern !== "migrations/000[0-6]_*.sql") {
    fail("wrangler_config_database_mismatch");
  }
}

async function readCanonicalRows(database) {
  const result = await database.prepare(
    "SELECT id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order FROM emoji_master ORDER BY id",
  ).all();
  return result.results;
}

async function main() {
  if (process.versions.node !== "22.6.0") fail("node_version_mismatch");
  const options = parseArguments(process.argv.slice(2));
  const config = JSON.parse(await fs.readFile(options.config, "utf8"));
  assertConfig(options, config);
  await assertAccountAndDatabase(options);

  const release = await verifyRelease(options.release_directory).catch(() => fail("release_verification_failed"));
  const manifest = JSON.parse(await fs.readFile(path.join(options.release_directory, "manifest.json"), "utf8"));
  if (!release.version || manifest.version !== release.version || release.records.length !== manifest.entryCount) {
    fail("release_manifest_invalid");
  }

  const database = createWranglerD1Database({
    wranglerPath: options.wrangler,
    configPath: options.config,
    binding: EXPECTED_BINDING,
  });
  const migrationRows = await database.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
  const appliedMigrations = new Set(migrationRows.results.map((row) => row.name));
  if (EXPECTED_MIGRATIONS.some((name) => !appliedMigrations.has(name))) fail("d1_migrations_incomplete");

  const authSchemaTablesPresent = await assertAuthSchemaEmpty(database);
  const releaseStateBefore = await captureEmojiReleaseState(database);

  const recordsById = new Map(release.records.map((record) => [record.id, record]));
  const existing = await readCanonicalRows(database);
  for (const row of existing) {
    const expected = recordsById.get(row.id);
    if (!expected || !canonicalRecordMatches(row, expected)) fail("canonical_catalog_conflict");
  }

  const existingIds = new Set(existing.map((row) => row.id));
  const missing = release.records.filter((record) => !existingIds.has(record.id));
  const insertSql = "INSERT INTO emoji_master " +
    "(id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING";
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const results = await database.batch(batch.map((record) => database.prepare(insertSql).bind(
      record.id,
      record.emoji,
      record.short_name,
      JSON.stringify(record.keywords),
      record.category,
      record.subcategory,
      JSON.stringify(record.codepoints),
      record.sort_order,
    )));
    if (results.some((result) => result.success !== true)) fail("canonical_catalog_write_failed");
  }

  const canonicalRows = await readCanonicalRows(database);
  if (canonicalRows.length !== release.records.length ||
      canonicalRows.some((row) => !canonicalRecordMatches(row, recordsById.get(row.id)))) {
    fail("canonical_catalog_readback_mismatch");
  }

  const staged = await stageEmojiMasterRelease({
    database,
    releaseDirectory: options.release_directory,
    maxRowsPerBatch: 50,
  });
  await assertAuthSchemaEmpty(database);
  const releaseStateAfter = await assertEmojiReleaseStateUnchanged(database, releaseStateBefore);

  process.stdout.write(JSON.stringify({
    account_id: options.account_id,
    database_name: options.database_name,
    database_id: options.database_id,
    migrations: EXPECTED_MIGRATIONS,
    canonical_master_rows: canonicalRows.length,
    release_version: staged.version,
    release_rows: staged.recordCount,
    release_status: staged.status,
    reused_ready_release: staged.reused,
    active_release_rows: releaseStateAfter.activeRows.length,
    active_release_versions: releaseStateAfter.activeRows.map((row) => row.release_version),
    activation_history_rows: releaseStateAfter.activationRows.length,
    auth_schema_tables_present: authSchemaTablesPresent,
    auth_user_data_rows: 0,
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`Emoji master remote staging failed (${error?.message ?? "unknown_error"}).\n`);
  process.exitCode = 1;
});

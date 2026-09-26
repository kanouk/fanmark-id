#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { verifyRelease } from "../build-emoji-release.ts";
import {
  activateEmojiMasterRelease,
  readEmojiMasterActiveRelease,
} from "./emoji-master-release-activate.mjs";
import { assertAuthSchemaEmpty, captureEmojiReleaseState } from "./emoji-master-release-remote-guards.mjs";
import {
  assertExpectedActiveCurrent,
  assertRemoteActivationReadback,
  parseRemoteActivationArguments,
  validateExpectedActive,
} from "./emoji-master-release-remote-activation.mjs";
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
const VERSION_RE = /^[0-9a-f]{64}$/;

function fail(code) {
  throw new Error(code);
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

async function main() {
  if (process.versions.node !== "22.6.0") fail("node_version_mismatch");
  const options = parseRemoteActivationArguments(process.argv.slice(2));
  const expectedCurrentVersion = validateExpectedActive(options.expected_active);
  const config = JSON.parse(await fs.readFile(options.config, "utf8"));
  assertConfig(options, config);
  await assertAccountAndDatabase(options);

  const release = await verifyRelease(options.release_directory).catch(() => fail("release_verification_failed"));
  const manifest = JSON.parse(await fs.readFile(path.join(options.release_directory, "manifest.json"), "utf8"));
  if (!VERSION_RE.test(release.version) || manifest.version !== release.version ||
      release.records.length !== manifest.entryCount) {
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
  const before = await captureEmojiReleaseState(database);
  const activeBefore = await readEmojiMasterActiveRelease(database);
  assertExpectedActiveCurrent(expectedCurrentVersion, activeBefore?.version ?? null);

  const activation = await activateEmojiMasterRelease({
    database,
    releaseDirectory: options.release_directory,
    action: options.action,
    expectedCurrentVersion,
  });
  if (activation.version !== release.version) fail("activation_release_version_mismatch");

  const activeAfter = await readEmojiMasterActiveRelease(database);
  const after = await captureEmojiReleaseState(database);
  await assertAuthSchemaEmpty(database);
  assertRemoteActivationReadback({
    before,
    after,
    current: activeAfter,
    activation,
    version: release.version,
    action: options.action,
  });

  process.stdout.write(JSON.stringify({
    account_id: options.account_id,
    database_name: options.database_name,
    database_id: options.database_id,
    version: activation.version,
    action: options.action,
    generation: activation.generation,
    changed: activation.changed,
    active_release_rows: after.activeRows.length,
    activation_history_rows: after.activationRows.length,
    auth_schema_tables_present: authSchemaTablesPresent,
    auth_user_data_rows: 0,
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`Emoji master remote activation failed (${error?.message ?? "unknown_error"}).\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  activateReferenceMasterRelease,
  referenceMasterRowsEqual,
  sha256Hex,
  stageReferenceMasterRelease,
} from "./reference-master-release.mjs";
import {
  assertAuthSchemaEmpty,
  assertEmojiReleaseStateUnchanged,
  captureEmojiReleaseState,
} from "./emoji-master-release-remote-guards.mjs";
import { createWranglerD1Database } from "./wrangler-d1-database.mjs";

const EXPECTED_MIGRATIONS = [
  "0000_emoji_master.sql",
  "0001_emoji_master_release_staging.sql",
  "0002_emoji_master_release_activation.sql",
  "0003_better_auth_core.sql",
  "0004_reference_master_releases.sql",
  "0005_emoji_master_admin_guards.sql",
  "0006_reference_master_extension_prices.sql",
];
const EXPECTED_PATTERN = "migrations/000[0-6]_*.sql";
const REQUIRED_TABLES = ["fanmark_tiers", "languages", "reserved_emoji_patterns", "fanmark_tier_extension_prices"];

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
    const name = key.slice(2);
    if (values.has(name)) fail("arguments_duplicate");
    values.set(name, argv[++index]);
  }
  const required = ["account-id", "email", "database-name", "database-id", "snapshot", "config", "wrangler"];
  for (const key of required) if (!values.has(key)) fail("arguments_missing");
  const allowed = new Set([...required, "activate"]);
  if ([...values.keys()].some((key) => !allowed.has(key))) fail("arguments_invalid");
  const activate = values.get("activate") ?? "false";
  if (activate !== "true" && activate !== "false") fail("activation_option_invalid");
  return {
    ...Object.fromEntries([...values].map(([key, value]) => [key.replaceAll("-", "_"), value])),
    activate: activate === "true",
  };
}

function runJsonCommand(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) fail("cloudflare_identity_check_failed");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("cloudflare_json_invalid");
  }
}

async function assertAccountAndDatabase(options) {
  const common = ["--config", options.config];
  const whoami = runJsonCommand(options.wrangler, ["whoami", "--json", ...common]);
  if (!whoami.loggedIn || whoami.email !== options.email || !Array.isArray(whoami.accounts) ||
      !whoami.accounts.some((account) => account.id === options.account_id)) fail("cloudflare_account_mismatch");
  const databases = runJsonCommand(options.wrangler, ["d1", "list", "--json", ...common]);
  if (!Array.isArray(databases)) fail("cloudflare_database_list_invalid");
  const target = databases.find((entry) =>
    (entry.uuid ?? entry.database_id ?? entry.id) === options.database_id &&
    (entry.name ?? entry.database_name) === options.database_name,
  );
  if (!target) fail("cloudflare_database_mismatch");
}

function assertConfig(options, config) {
  if (config.account_id !== options.account_id || !Array.isArray(config.d1_databases)) fail("wrangler_config_account_mismatch");
  const binding = config.d1_databases.find((entry) => entry.binding === "FANMARK_DB");
  if (!binding || binding.database_id !== options.database_id || binding.database_name !== options.database_name ||
      binding.migrations_dir !== "migrations" || binding.migrations_pattern !== EXPECTED_PATTERN) {
    fail("wrangler_config_database_mismatch");
  }
}

async function readRows(database, sql, bindings = []) {
  let statement = database.prepare(sql);
  if (bindings.length) statement = statement.bind(...bindings);
  const result = await statement.all();
  if (!result || result.success !== true || !Array.isArray(result.results)) fail("reference_master_d1_read_failed");
  return result.results;
}

async function assertSchemaReady(database) {
  const rows = await readRows(database, "SELECT name FROM d1_migrations ORDER BY id");
  const applied = new Set(rows.map((row) => row.name));
  if (EXPECTED_MIGRATIONS.some((name) => !applied.has(name))) fail("d1_migrations_incomplete");
  const tableRows = await readRows(database,
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name IN (?, ?, ?, ?) ORDER BY name", REQUIRED_TABLES);
  if (tableRows.length !== REQUIRED_TABLES.length) fail("reference_master_schema_incomplete");
  const extensionRows = await readRows(database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
    ["fanmark_reference_master_extension_price_manifests", "fanmark_extension_price_release_rows"]);
  if (extensionRows.length !== 2) fail("reference_master_extension_price_schema_incomplete");
}

async function readPrivateSnapshot(snapshotPath, repoRoot) {
  const resolved = path.resolve(snapshotPath);
  if (!resolved.startsWith("/private/") || resolved.startsWith(repoRoot + path.sep)) fail("snapshot_path_not_private");
  const info = await fs.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("snapshot_permissions_invalid");
  const bytes = await fs.readFile(resolved);
  let snapshot;
  try {
    snapshot = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("snapshot_json_invalid");
  }
  return { snapshot, snapshotSha256: sha256Hex(bytes) };
}

async function verifyActiveViews(database, snapshot) {
  const expectations = {
    fanmark_tiers: {
      sql: "SELECT id, created_at, description, display_name, emoji_count_max, emoji_count_min, initial_license_days, is_active, monthly_price_usd, tier_level, updated_at FROM fanmark_tiers ORDER BY tier_level",
      map(record) {
        const match = /^(-?)(0|[1-9]\d*)\.(\d{2})$/.exec(record.monthly_price_usd);
        if (!match) fail("snapshot_money_format_invalid");
        const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
        return {
          id: record.id,
          created_at: record.created_at,
          description: record.description,
          display_name: record.display_name,
          emoji_count_max: record.emoji_count_max,
          emoji_count_min: record.emoji_count_min,
          initial_license_days: record.initial_license_days,
          is_active: record.is_active ? 1 : 0,
          monthly_price_usd: Number(match[1] === "-" ? -cents : cents),
          tier_level: record.tier_level,
          updated_at: record.updated_at,
        };
      },
    },
    languages: {
      sql: "SELECT code, created_at, id, is_active, label, native_label, sort_order, updated_at FROM languages ORDER BY code",
      map(record) { return { ...record, is_active: record.is_active ? 1 : 0 }; },
    },
    reserved_emoji_patterns: {
      sql: "SELECT created_at, description, id, is_active, pattern, price_yen, updated_at FROM reserved_emoji_patterns ORDER BY id",
      map(record) { return { ...record, is_active: record.is_active ? 1 : 0 }; },
    },
  };
  for (const [tableName, expected] of Object.entries(expectations)) {
    const entry = snapshot.find((item) => item.table_name === tableName);
    if (!entry) fail("snapshot_table_missing");
    const actual = await readRows(database, expected.sql);
    const mapped = entry.records.map(expected.map);
    if (!referenceMasterRowsEqual(actual, mapped)) fail("reference_master_active_view_mismatch");
  }

  const extensionPriceEntry = snapshot.find((item) => item.table_name === "fanmark_tier_extension_prices");
  if (!extensionPriceEntry) fail("snapshot_table_missing");
  const activeRows = await readRows(database,
    "SELECT release_version FROM fanmark_reference_master_active_release WHERE singleton_id = 1");
  if (activeRows.length !== 1) fail("reference_master_active_release_missing");
  const sourceShapedRows = await readRows(database,
    "SELECT id, created_at, is_active, months, price_yen, stripe_price_id, stripe_price_id_live, tier_level, updated_at FROM fanmark_extension_price_release_rows WHERE release_version = ? ORDER BY tier_level, months",
    [activeRows[0].release_version]);
  const sourceShapedExpected = extensionPriceEntry.records.map((record) => ({
    ...record,
    is_active: record.is_active ? 1 : 0,
  }));
  if (!referenceMasterRowsEqual(sourceShapedRows, sourceShapedExpected)) {
    fail("reference_master_active_view_mismatch");
  }
  const publicRows = await readRows(database,
    "SELECT id, tier_level, months, price_yen, is_active FROM fanmark_tier_extension_prices ORDER BY tier_level, months");
  const publicExpected = extensionPriceEntry.records.map((record) => ({
    id: record.id,
    tier_level: record.tier_level,
    months: record.months,
    price_yen: record.price_yen,
    is_active: record.is_active ? 1 : 0,
  }));
  if (!referenceMasterRowsEqual(publicRows, publicExpected)) {
    fail("reference_master_extension_price_projection_mismatch");
  }
}

async function main() {
  if (process.versions.node !== "22.6.0") fail("node_version_mismatch");
  const options = parseArguments(process.argv.slice(2));
  const config = JSON.parse(await fs.readFile(options.config, "utf8"));
  assertConfig(options, config);
  await assertAccountAndDatabase(options);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { snapshot, snapshotSha256 } = await readPrivateSnapshot(options.snapshot, repoRoot);
  const database = createWranglerD1Database({
    wranglerPath: options.wrangler,
    configPath: options.config,
    binding: "FANMARK_DB",
  });

  await assertSchemaReady(database);
  const authSchemaTables = await assertAuthSchemaEmpty(database);
  const emojiStateBefore = await captureEmojiReleaseState(database);
  const staged = await stageReferenceMasterRelease({ database, snapshot, snapshotSha256 });
  if (options.activate) {
    const activeBefore = await readRows(database,
      "SELECT release_version FROM fanmark_reference_master_active_release WHERE singleton_id = 1");
    const expectedActiveVersion = activeBefore.length ? activeBefore[0].release_version : null;
    await activateReferenceMasterRelease({ database, releaseVersion: staged.releaseVersion, expectedActiveVersion });
    await verifyActiveViews(database, snapshot);
  }
  await assertAuthSchemaEmpty(database);
  const emojiStateAfter = await assertEmojiReleaseStateUnchanged(database, emojiStateBefore);
  const activeRows = await readRows(database,
    "SELECT release_version, generation FROM fanmark_reference_master_active_release ORDER BY singleton_id");
  const releaseRows = await readRows(database,
    "SELECT status FROM fanmark_reference_master_releases WHERE release_version = ?", [staged.releaseVersion]);
  if (releaseRows.length !== 1 || releaseRows[0].status !== "ready") fail("reference_master_final_state_invalid");

  process.stdout.write(JSON.stringify({
    account_id: options.account_id,
    database_name: options.database_name,
    database_id: options.database_id,
    migrations: EXPECTED_MIGRATIONS,
    source_snapshot_sha256: snapshotSha256,
    release_version: staged.releaseVersion,
    tables: staged.tables,
    release_status: "ready",
    reused_ready_release: staged.reused,
    activated: options.activate,
    active_release: activeRows[0] ?? null,
    auth_schema_tables_present: authSchemaTables,
    auth_user_data_rows: 0,
    emoji_active_release_unchanged: JSON.stringify(emojiStateAfter) === JSON.stringify(emojiStateBefore),
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`Reference master remote import failed (${error?.message ?? "unknown_error"}).\n`);
  process.exitCode = 1;
});

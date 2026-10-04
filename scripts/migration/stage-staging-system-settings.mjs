#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  buildSystemSettingsInsertSql,
  parseSystemSettingsSourceText,
  systemSettingsCanonicalDigest,
  SYSTEM_SETTINGS_STAGE_KEYS,
} from "./system-settings-stage.mjs";
import {
  LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

const ROOT = process.cwd();
const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const DATABASE = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const WRANGLER_VERSION = "4.139.0";

function fail(code) {
  throw new Error(code);
}

function runWrangler(args) {
  const activeNode = realpathSync(process.execPath);
  const childPath = (process.env.PATH ?? "").split(path.delimiter).filter((directory) => {
    const candidate = path.join(directory, "node");
    if (!existsSync(candidate)) return true;
    try {
      return realpathSync(candidate) !== activeNode;
    } catch {
      return true;
    }
  }).join(path.delimiter);
  const childEnv = { ...process.env, PATH: childPath, CI: process.env.CI ?? "1" };
  for (const key of Object.keys(childEnv)) {
    if (/^npm_config_/iu.test(key) || key === "npm_execpath" || /^npm_lifecycle_/iu.test(key)) delete childEnv[key];
  }
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args], {
    cwd: ROOT,
    env: childEnv,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("system_settings_stage_wrangler_failed");
  return result;
}

function runJson(args) {
  try {
    return JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("system_settings_stage_")) throw error;
    fail("system_settings_stage_wrangler_json_invalid");
  }
}

function resultRows(value) {
  if (!Array.isArray(value) || value.some((result) => result?.success !== true || !Array.isArray(result.results))) {
    fail("system_settings_stage_d1_result_invalid");
  }
  return value.map((result) => result.results);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertWorkerTarget() {
  const config = JSON.parse(readFileSync(path.join(ROOT, APP_CONFIG), "utf8"));
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.vars?.D1_TOPOLOGY !== "split" || config.vars?.SYSTEM_SETTINGS_BACKEND !== "d1") {
    fail("system_settings_stage_worker_target_mismatch");
  }
  const binding = config.d1_databases?.find((item) => item.binding === "FANMARK_DB");
  if (binding?.database_name !== DATABASE || binding.database_id !== DATABASE_ID || binding.remote !== true) {
    fail("system_settings_stage_database_config_mismatch");
  }
  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) {
    fail("system_settings_stage_account_mismatch");
  }
  const databases = runJson(["d1", "list", "--json"]);
  if (!Array.isArray(databases) || !databases.some((database) => database.name === DATABASE && database.uuid === DATABASE_ID)) {
    fail("system_settings_stage_database_not_found");
  }
}

function executeD1(sql, options = {}) {
  const args = ["d1", "execute", DATABASE, "--remote", "--json", "--config", APP_CONFIG];
  if (options.file) args.push("--file", options.file);
  else args.push("--command", sql);
  if (options.yes) args.push("--yes");
  if (options.file) return runWrangler(args);
  return runJson(args);
}

function readBaseline() {
  const rows = resultRows(executeD1(STAGING_NON_USER_CONFIG_BASELINE_SQL))[0];
  if (!Array.isArray(rows) || rows.length !== 1) fail("system_settings_stage_baseline_invalid");
  return rows[0];
}

function assertPreStageBaseline(row) {
  if (Number(row.system_settings) !== 2 || row.system_settings_key_manifest !== LEGACY_STAGING_SYSTEM_SETTINGS_MANIFEST ||
      Number(row.grace_period_days) !== 1 || Number(row.max_emoji_characters) !== 1 ||
      Number(row.availability_rules) !== 4 || Number(row.expected_availability_rules) !== 4 ||
      stagingNonUserConfigBaselineState(row) !== "seeded") {
    fail("system_settings_stage_requires_exact_original_baseline");
  }
}

function assertSourceFile(sourcePath) {
  const resolved = path.resolve(sourcePath);
  const relative = path.relative(ROOT, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    fail("system_settings_source_must_be_outside_repository");
  }
  const stats = statSync(resolved);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0) fail("system_settings_source_permissions_invalid");
  return resolved;
}

function readBackSettings() {
  const keys = SYSTEM_SETTINGS_STAGE_KEYS.map(sqlLiteral).join(", ");
  const sql = `SELECT id, setting_key, setting_value, description, is_public, created_at, updated_at
    FROM system_settings WHERE setting_key IN (${keys}) ORDER BY setting_key`;
  const rows = resultRows(executeD1(sql))[0];
  if (!Array.isArray(rows) || rows.length !== SYSTEM_SETTINGS_STAGE_KEYS.length) {
    fail("system_settings_stage_readback_count_mismatch");
  }
  return rows;
}

function main() {
  const sourceArgument = process.argv[2];
  if (!sourceArgument) fail("usage: node stage-staging-system-settings.mjs <private-source-json>");
  const sourcePath = assertSourceFile(sourceArgument);
  const sourceText = readFileSync(sourcePath, "utf8");
  const { rows: sourceRows, digest: sourceDigest } = parseSystemSettingsSourceText(sourceText);

  assertWorkerTarget();
  const initialBaseline = readBaseline();
  if (Number(initialBaseline.system_settings) === 20) {
    if (stagingNonUserConfigBaselineState(initialBaseline) !== "seeded") {
      fail("system_settings_stage_existing_baseline_invalid");
    }
    const readback = readBackSettings();
    const readbackDigest = systemSettingsCanonicalDigest(readback);
    if (readbackDigest !== sourceDigest) fail("system_settings_stage_existing_content_mismatch");
    process.stdout.write(`${JSON.stringify({
      status: "already_staged_and_verified",
      database: DATABASE,
      rows: readback.length,
      sourceContentSha256: sourceDigest,
      readbackContentSha256: readbackDigest,
      userDataIncluded: false,
    })}\n`);
    return;
  }
  assertPreStageBaseline(initialBaseline);

  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "fanmark-settings-stage-"));
  chmodSync(tempDirectory, 0o700);
  const sqlPath = path.join(tempDirectory, "settings.sql");
  try {
    writeFileSync(sqlPath, buildSystemSettingsInsertSql(sourceRows), { mode: 0o600, flag: "wx" });
    chmodSync(sqlPath, 0o600);
    resultRows(executeD1(undefined, { file: sqlPath, yes: true }));

    const readback = readBackSettings();
    const readbackDigest = systemSettingsCanonicalDigest(readback);
    if (readbackDigest !== sourceDigest) fail("system_settings_stage_content_mismatch");
    const baseline = readBaseline();
    if (stagingNonUserConfigBaselineState(baseline) !== "seeded" || Number(baseline.system_settings) !== 20) {
      fail("system_settings_stage_postflight_baseline_invalid");
    }
    process.stdout.write(`${JSON.stringify({
      status: "staged_and_verified",
      database: DATABASE,
      rows: readback.length,
      sourceContentSha256: sourceDigest,
      readbackContentSha256: readbackDigest,
      userDataIncluded: false,
    })}\n`);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main();

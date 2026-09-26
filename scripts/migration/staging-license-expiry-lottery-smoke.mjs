#!/usr/bin/env node

/** Exercise scheduled grace-expiry lottery finalization on isolated staging D1. */

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingBusinessBaselineRowCount,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";
import { isStagingExpiryCronBaseline } from "./staging-expiry-cron-config.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const BUSINESS = "fanmark-business-staging";
const BUSINESS_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const WORKER_DIR = "workers/api";
const WRANGLER = "4.139.0";
const BUSINESS_SCHEMA = "workers/api/migrations-business/0000_business_schema_v4_staging.sql";
const PROFILE_MIGRATIONS = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0001_lifecycle_target_staging.sql",
  "workers/api/migrations-business/0002_lifecycle_generation_staging.sql",
  "workers/api/migrations-business/0003_credential_transform_staging.sql",
  "workers/api/migrations-business/0004_verified_access_staging.sql",
  "workers/api/migrations-business/0005_lottery_plan_journal_staging.sql",
];
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const AUTH = "fanmark-auth-staging";
const AUTH_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];
const LIFECYCLE_RUN_TABLES = [
  "license_expiry_runs", "license_expiry_run_items", "license_grace_finalization_runs",
  "license_grace_finalization_items", "license_expiry_effect_guards",
];
const RETAINED_STATE_TABLES = ["fanmark_license_incarnations", "fanmark_access_versions"];
const GRACE_PERIOD_SETTING_KEY = "grace_period_days";
const DEPLOYED_CRON_CANARY = process.env.FANMARK_STAGING_CRON_CANARY === "1";

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(code) {
  throw new Error(code);
}

function safeWranglerDiagnostics(output) {
  const lines = String(output).split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .map((line) => line
      .replace(/\u001b\[[0-9;]*m/gu, "")
      .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
      .replace(/(password|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/giu, "$1$2[redacted]")
      .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, "[redacted]")
      .slice(0, 500));
  return lines;
}

function sql(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function wrangler(args, cwd = process.cwd()) {
  const result = spawnSync("npx", ["--yes", "wrangler@" + WRANGLER, ...args], {
    cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function json(args, cwd) {
  try {
    return JSON.parse(wrangler(args, cwd).stdout.trim());
  } catch (error) {
    if (error instanceof Error && error.message === "wrangler_failed") throw error;
    fail("wrangler_json_invalid");
  }
}

function d1(command) {
  const result = json([
    "d1", "execute", BUSINESS, "--remote", "--json", "--command", command,
    "--config", APP_CONFIG,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  if (!Array.isArray(result[0]?.results)) fail("staging_d1_readback_failed");
  return result[0].results;
}

function readGracePeriodSetting() {
  const rows = d1("SELECT id, setting_key, setting_value, description, is_public, created_at, updated_at FROM system_settings WHERE setting_key=" + sql(GRACE_PERIOD_SETTING_KEY));
  if (rows.length !== 1 || rows[0].setting_key !== GRACE_PERIOD_SETTING_KEY ||
      !/^[1-9]\d{0,2}$/u.test(String(rows[0].setting_value)) || Number(rows[0].setting_value) > 365 ||
      Number(rows[0].is_public) !== 1) fail("staging_grace_period_setting_mismatch");
  return rows[0];
}

function verifyTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      !isStagingExpiryCronBaseline(config) ||
      config.d1_databases?.some((entry) => entry.remote !== true)) fail("staging_target_mismatch");
  const businessBinding = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  if (businessBinding?.database_name !== BUSINESS || businessBinding.database_id !== BUSINESS_ID) {
    fail("staging_database_binding_mismatch");
  }
  const authConfig = JSON.parse(readFileSync(AUTH_CONFIG, "utf8"));
  const authBinding = authConfig.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  if (authBinding?.database_name !== AUTH || authBinding.database_id !== AUTH_ID) fail("staging_auth_binding_mismatch");
  const identity = json(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");

  const source = readFileSync(BUSINESS_SCHEMA, "utf8");
  const tables = [...source.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (tables.length !== 40) fail("business_table_inventory_mismatch");
  const masters = d1(NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_mismatch");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_mismatch");
  const businessSum = tables.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const nonSettingsTables = businessTablesWithoutStagingBaselines(tables);
  const nonSettingsSum = nonSettingsTables.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const gracePeriodSetting = readGracePeriodSetting();
  const baselineBusinessRows = stagingBusinessBaselineRowCount(settings, masters);
  if (Number(d1("SELECT " + businessSum + " AS row_count")[0]?.row_count) !== baselineBusinessRows ||
      Number(d1("SELECT " + nonSettingsSum + " AS row_count")[0]?.row_count) !== 0) {
    fail("business_staging_has_unexpected_rows");
  }
  const runSum = LIFECYCLE_RUN_TABLES.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  if (Number(d1("SELECT " + runSum + " AS row_count")[0]?.row_count) !== 0) {
    fail("staging_lifecycle_journal_not_empty");
  }
  const lifecycleBaseline = Object.fromEntries(RETAINED_STATE_TABLES.map((table) => [
    table,
    d1("SELECT * FROM \"" + table + "\" ORDER BY 1").map((row) => row),
  ]));
  const authSum = AUTH_TABLES.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const authRows = json([
    "d1", "execute", AUTH, "--remote", "--json", "--command", "SELECT " + authSum + " AS row_count",
    "--config", AUTH_CONFIG,
  ]);
  if (!Array.isArray(authRows) || authRows.some((entry) => entry?.success !== true) ||
      Number(authRows[0]?.results?.[0]?.row_count) !== 0) fail("auth_staging_has_rows");
  return { tables, lifecycleBaseline, gracePeriodSetting };
}

function utc(value) {
  return new Date(value).toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
}

function readbackSql({ fanmarkId, ownerId, winnerId, oldLicenseId, targetIncarnation, requestId }) {
  return `SELECT
    (SELECT status FROM fanmark_licenses WHERE id=${sql(oldLicenseId)}) AS old_status,
    (SELECT lifecycle_generation FROM fanmark_licenses WHERE id=${sql(oldLicenseId)}) AS old_generation,
    (SELECT entry_status FROM fanmark_lottery_entries WHERE id=${sql(requestId)}) AS entry_status,
    (SELECT winner_user_id FROM fanmark_lottery_history WHERE license_id=${sql(oldLicenseId)}) AS winner_user_id,
    (SELECT total_entries FROM fanmark_lottery_history WHERE license_id=${sql(oldLicenseId)}) AS total_entries,
    (SELECT random_seed FROM fanmark_lottery_history WHERE license_id=${sql(oldLicenseId)}) AS random_seed,
    (SELECT id FROM fanmark_licenses WHERE fanmark_id=${sql(fanmarkId)} AND user_id=${sql(winnerId)} AND status='active') AS winner_license_id,
    (SELECT status FROM license_expiry_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS expiry_run_status,
    (SELECT candidate_count FROM license_expiry_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS expiry_candidates,
    (SELECT status FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS finalization_status,
    (SELECT candidate_count FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS finalization_candidates,
    (SELECT processed_count FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS processed_count,
    (SELECT conflict_count FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)}) AS conflict_count,
    (SELECT outcome FROM license_grace_finalization_items WHERE run_id=(SELECT run_id FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)})) AS item_outcome,
    (SELECT lottery_seed FROM license_grace_finalization_items WHERE run_id=(SELECT run_id FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)})) AS persisted_seed,
    (SELECT lottery_inputs_json IS NOT NULL AND lottery_plan_json IS NOT NULL FROM license_grace_finalization_items WHERE run_id=(SELECT run_id FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)})) AS persisted_plan,
    (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id=${sql(oldLicenseId)})+
    (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id=${sql(oldLicenseId)})+
    (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id=${sql(oldLicenseId)})+
    (SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id=${sql(oldLicenseId)}) AS old_access_config_count,
    (SELECT COUNT(*) FROM fanmark_profiles WHERE license_id=${sql(oldLicenseId)}) AS retained_profile_count,
    (SELECT COUNT(*) FROM notification_events WHERE json_extract(payload,'$.fanmark_id')=${sql(fanmarkId)}) AS event_count,
    (SELECT json_group_array(event_type) FROM (SELECT event_type FROM notification_events
      WHERE json_extract(payload,'$.fanmark_id')=${sql(fanmarkId)} ORDER BY event_type)) AS event_types_json,
    (SELECT COUNT(*) FROM audit_logs WHERE user_id IN (${sql(ownerId)},${sql(winnerId)}) OR resource_id=${sql(oldLicenseId)}) AS audit_count`;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startDev(port, targetIncarnation, schemaDigest) {
  const args = [
    "--yes", "wrangler@" + WRANGLER, "dev", "--config", "wrangler.app-staging.jsonc",
    "--test-scheduled", "--port", String(port), "--log-level", "info",
    "--var", "LICENSE_EXPIRY_BACKEND:d1",
    "--var", "LICENSE_EXPIRY_CRON:* * * * *",
    "--var", "LICENSE_EXPIRY_TARGET_INCARNATION:" + targetIncarnation,
    "--var", "LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST:" + schemaDigest,
    "--var", "LICENSE_EXPIRY_MAX_PAGES:4",
    "--show-interactive-dev-session=false",
  ];
  const child = spawn("npx", args, { cwd: WORKER_DIR, env: { ...process.env, NO_COLOR: "1" },
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const append = (chunk) => { output = (output + chunk.toString()).slice(-16_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const baseUrl = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 90_000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) fail("wrangler_dev_exited");
      if (output.includes("Ready on http://")) {
        try {
          const probe = await fetch(baseUrl + "/api/fanmarks/recent?limit=1", {
            signal: AbortSignal.timeout(5_000),
          });
          if (probe.status === 200) {
            const payload = await probe.json();
            if (payload?.schemaVersion === 1 && Array.isArray(payload.items)) return { child, baseUrl, output: () => output };
          }
        } catch { /* Retry while the local runtime finishes wiring its remote D1 binding. */ }
      }
      await delay(500);
    }
    fail("wrangler_dev_not_ready_or_remote_d1_probe_failed");
  } catch (error) {
    await stopDev(child);
    throw error;
  }
}

async function stopDev(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch { /* The process may have exited between the check and signal. */ }
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5_000)]);
}

async function waitForDeployedCron(targetIncarnation, timeoutMs = 17 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const rows = d1(`SELECT
      (SELECT status FROM license_expiry_runs WHERE target_incarnation=${sql(targetIncarnation)} LIMIT 1) AS expiry_status,
      (SELECT status FROM license_grace_finalization_runs WHERE target_incarnation=${sql(targetIncarnation)} LIMIT 1) AS finalization_status`);
    lastState = rows[0] ?? null;
    if (lastState?.expiry_status === "failed" || lastState?.finalization_status === "failed") {
      fail("staging_cron_job_failed_" + JSON.stringify(lastState));
    }
    if (lastState?.expiry_status === "completed" && lastState?.finalization_status === "completed") {
      return lastState;
    }
    await delay(5_000);
  }
  fail("staging_cron_timeout_" + JSON.stringify(lastState));
}

function cleanup({ fanmarkId, ownerId, winnerId, oldLicenseId, gracePeriodSetting, targetIncarnation, lifecycleBaseline }) {
  const licenseRows = d1("SELECT id FROM fanmark_licenses WHERE fanmark_id=" + sql(fanmarkId));
  const licenseIds = [...new Set([oldLicenseId, ...licenseRows.map((row) => row.id)])].filter(Boolean);
  const licenses = licenseIds.length ? licenseIds.map(sql).join(",") : sql(oldLicenseId);
  d1([
    "DELETE FROM license_expiry_effect_guards WHERE operation_id IN (SELECT operation_id FROM license_expiry_run_items WHERE run_id IN (SELECT run_id FROM license_expiry_runs WHERE target_incarnation=" + sql(targetIncarnation) + ")) OR operation_id IN (SELECT operation_id FROM license_grace_finalization_items WHERE run_id IN (SELECT run_id FROM license_grace_finalization_runs WHERE target_incarnation=" + sql(targetIncarnation) + "));",
    "DELETE FROM license_expiry_run_items WHERE run_id IN (SELECT run_id FROM license_expiry_runs WHERE target_incarnation=" + sql(targetIncarnation) + ");",
    "DELETE FROM license_grace_finalization_items WHERE run_id IN (SELECT run_id FROM license_grace_finalization_runs WHERE target_incarnation=" + sql(targetIncarnation) + ");",
    "DELETE FROM license_expiry_runs WHERE target_incarnation=" + sql(targetIncarnation) + ";",
    "DELETE FROM license_grace_finalization_runs WHERE target_incarnation=" + sql(targetIncarnation) + ";",
    "DELETE FROM notification_events WHERE json_extract(payload,'$.fanmark_id')=" + sql(fanmarkId) + " OR json_extract(payload,'$.user_id') IN (" + sql(ownerId) + "," + sql(winnerId) + ");",
    "DELETE FROM audit_logs WHERE user_id IN (" + sql(ownerId) + "," + sql(winnerId) + ") OR resource_id=" + sql(oldLicenseId) + ";",
    "DELETE FROM fanmark_lottery_history WHERE license_id=" + sql(oldLicenseId) + ";",
    "DELETE FROM fanmark_lottery_entries WHERE license_id=" + sql(oldLicenseId) + ";",
    "DELETE FROM fanmark_basic_configs WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmark_redirect_configs WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmark_messageboard_configs WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmark_password_configs WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmark_profiles WHERE license_id IN (" + licenses + ");",
    "DELETE FROM user_settings WHERE user_id IN (" + sql(ownerId) + "," + sql(winnerId) + ");",
    "DELETE FROM fanmark_licenses WHERE fanmark_id=" + sql(fanmarkId) + ";",
    "DELETE FROM fanmark_access_versions WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmark_license_incarnations WHERE license_id IN (" + licenses + ");",
    "DELETE FROM fanmarks WHERE id=" + sql(fanmarkId) + ";",
  ].join("\n"));
  const currentSetting = readGracePeriodSetting();
  if (fingerprint(currentSetting) !== fingerprint(gracePeriodSetting)) {
    if (currentSetting.id !== gracePeriodSetting.id || currentSetting.setting_value !== "14" ||
        Number(currentSetting.is_public) !== Number(gracePeriodSetting.is_public)) {
      fail("grace_period_setting_changed_during_canary");
    }
    d1("UPDATE system_settings SET setting_value=" + sql(gracePeriodSetting.setting_value) +
      ", updated_at=" + sql(gracePeriodSetting.updated_at) + " WHERE id=" + sql(gracePeriodSetting.id) +
      " AND setting_key=" + sql(GRACE_PERIOD_SETTING_KEY) + " AND setting_value='14' AND is_public=1");
  }
  if (fingerprint(readGracePeriodSetting()) !== fingerprint(gracePeriodSetting)) {
    fail("grace_period_setting_restore_failed");
  }
  const businessSource = readFileSync(BUSINESS_SCHEMA, "utf8");
  const tables = [...businessSource.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  const businessSum = tables.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const businessRows = Number(d1("SELECT " + businessSum + " AS row_count")[0]?.row_count);
  const masters = d1(NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_changed");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_changed");
  const runSum = LIFECYCLE_RUN_TABLES.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const lifecycleRows = Number(d1("SELECT " + runSum + " AS row_count")[0]?.row_count);
  const retainedAfter = Object.fromEntries(RETAINED_STATE_TABLES.map((table) => [
    table,
    d1("SELECT * FROM \"" + table + "\" ORDER BY 1").map((row) => row),
  ]));
  const danglingIds = d1("SELECT COUNT(*) AS row_count FROM fanmark_license_incarnations WHERE license_id IN (" + licenses + ")")[0];
  const nonSettingsSum = businessTablesWithoutStagingBaselines(tables)
    .map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const remainingSettings = readGracePeriodSetting();
  const baselineBusinessRows = stagingBusinessBaselineRowCount(settings, masters);
  if (businessRows !== baselineBusinessRows ||
      Number(d1("SELECT " + nonSettingsSum + " AS row_count")[0]?.row_count) !== 0 ||
      lifecycleRows !== 0 || Number(danglingIds.row_count) !== 0 ||
      fingerprint(remainingSettings) !== fingerprint(gracePeriodSetting) ||
      fingerprint(retainedAfter) !== fingerprint(lifecycleBaseline)) {
    fail("synthetic_lottery_cleanup_failed");
  }
  return { syntheticBusinessRows: businessRows - baselineBusinessRows, lifecycleRows, retainedStateUnchanged: true };
}

async function main() {
  const { lifecycleBaseline, gracePeriodSetting } = verifyTarget();
  const now = Date.now();
  const suffix = randomBytes(6).toString("hex");
  const targetIncarnation = "lottery-canary-" + randomUUID();
  const schemaDigest = createHash("sha256").update(PROFILE_MIGRATIONS.map((path) => {
    const bytes = readFileSync(path);
    return path + ":" + createHash("sha256").update(bytes).digest("hex");
  }).join("\n")).digest("hex");
  const fanmarkId = randomUUID();
  const oldLicenseId = randomUUID();
  const entryId = randomUUID();
  const ownerId = randomUUID();
  const winnerId = randomUUID();
  const settingsOwnerId = randomUUID();
  const settingsWinnerId = randomUUID();
  const usernameOwner = "canaryowner" + suffix;
  const usernameWinner = "canarywinner" + suffix;
  const shortId = "canary" + suffix;
  const nowIso = utc(now);
  const licenseStart = utc(now - 60 * 86_400_000);
  const licenseEnd = utc(now - 30 * 86_400_000);
  const graceExpiresAt = utc(now - 86_400_000);
  const ids = { fanmarkId, oldLicenseId, entryId, ownerId, winnerId, gracePeriodSetting,
    targetIncarnation, lifecycleBaseline };
  let seedAttempted = false;
  let cronDeploymentAttempted = false;
  let cronDisabledAgain = false;
  let cronRestoreFailed = false;
  let cleanupError;
  let runError;
  let dev;
  let completed = false;
  try {
    if (!DEPLOYED_CRON_CANARY) {
      const port = await freePort();
      dev = await startDev(port, targetIncarnation, schemaDigest);
    }
    seedAttempted = true;
    d1("UPDATE system_settings SET setting_value='14', updated_at=" + sql(nowIso) +
      " WHERE id=" + sql(gracePeriodSetting.id) + " AND setting_key=" + sql(GRACE_PERIOD_SETTING_KEY) +
      " AND setting_value=" + sql(gracePeriodSetting.setting_value) + " AND is_public=1");
    if (readGracePeriodSetting().setting_value !== "14") fail("staging_grace_period_setting_update_failed");
    d1([
      "INSERT INTO fanmarks (id,user_input_fanmark,normalized_emoji,short_id,status,created_at,updated_at,emoji_ids,normalized_emoji_ids,tier_level) VALUES (" +
        [fanmarkId, "🧪", "🧪", shortId, "active", nowIso, nowIso, "[]", "[]", 4].map(sql).join(",") + ");",
      "INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,created_at,updated_at) VALUES (" +
        [settingsOwnerId, ownerId, usernameOwner, "Synthetic lottery owner", "free", "ja", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,created_at,updated_at) VALUES (" +
        [settingsWinnerId, winnerId, usernameWinner, "Synthetic lottery winner", "free", "ja", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_licenses (id,fanmark_id,user_id,license_start,license_end,status,is_initial_license,created_at,updated_at,grace_expires_at,is_returned,display_fanmark) VALUES (" +
        [oldLicenseId, fanmarkId, ownerId, licenseStart, licenseEnd, "grace", 1, nowIso, nowIso, graceExpiresAt, 0, "🧪"].map(sql).join(",") + ");",
      "INSERT INTO fanmark_basic_configs (license_id,fanmark_name,access_type,created_at,updated_at) VALUES (" +
        [oldLicenseId, "Synthetic lottery", "profile", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_redirect_configs (license_id,target_url,created_at,updated_at) VALUES (" +
        [oldLicenseId, "https://example.invalid", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_messageboard_configs (license_id,content,created_at,updated_at) VALUES (" +
        [oldLicenseId, "synthetic lottery fixture", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_password_configs (license_id,access_password,is_enabled,created_at,updated_at) VALUES (" +
        [oldLicenseId, "synthetic-only-hash", 1, nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_profiles (license_id,display_name,bio,social_links,theme_settings,is_public,created_at,updated_at) VALUES (" +
        [oldLicenseId, "Synthetic lottery profile", "", "{}", "{}", 1, nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_lottery_entries (id,fanmark_id,user_id,license_id,lottery_probability,entry_status,applied_at,created_at,updated_at) VALUES (" +
        [entryId, fanmarkId, winnerId, oldLicenseId, "1.0", "pending", nowIso, nowIso, nowIso].map(sql).join(",") + ");",
    ].join("\n"));

    if (DEPLOYED_CRON_CANARY) {
      cronDeploymentAttempted = true;
      wrangler([
        "deploy", "--config", "wrangler.app-staging.jsonc", "--triggers", "* * * * *",
        "--var", "LICENSE_EXPIRY_BACKEND:d1",
        "--var", "LICENSE_EXPIRY_CRON:* * * * *",
        "--var", "LICENSE_EXPIRY_TARGET_INCARNATION:" + targetIncarnation,
        "--var", "LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST:" + schemaDigest,
        "--var", "LICENSE_EXPIRY_MAX_PAGES:4",
      ], WORKER_DIR);
      await waitForDeployedCron(targetIncarnation);
      // Remove the temporary every-minute trigger as soon as the durable job
      // state is complete, before doing the longer detailed readback.
      wrangler(["deploy", "--config", "wrangler.app-staging.jsonc"], WORKER_DIR);
      cronDisabledAgain = true;
    }
    else {
      let scheduled;
      try {
        scheduled = await fetch(dev.baseUrl + "/__scheduled?cron=*+*+*+*+*", {
          method: "GET", signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        const code = error && typeof error === "object" && "cause" in error && error.cause &&
          typeof error.cause === "object" && "code" in error.cause
          ? String(error.cause.code).replace(/[^A-Za-z0-9_-]/gu, "_")
          : "unknown";
        let observedAfterUnknownAck = null;
        try {
          const row = d1(readbackSql({ fanmarkId, ownerId, winnerId, oldLicenseId, targetIncarnation, requestId: entryId }))[0];
          observedAfterUnknownAck = {
            oldStatus: row.old_status,
            entryStatus: row.entry_status,
            winnerMatches: row.winner_user_id === winnerId,
            expiryRunStatus: row.expiry_run_status,
            finalizationStatus: row.finalization_status,
            processed: Number(row.processed_count),
            itemOutcome: row.item_outcome,
            persistedPlan: Number(row.persisted_plan),
            winnerLicensePresent: typeof row.winner_license_id === "string",
            oldAccessConfigCount: Number(row.old_access_config_count),
            retainedProfileCount: Number(row.retained_profile_count),
            eventCount: Number(row.event_count),
            auditCreated: Number(row.audit_count) >= 1,
          };
        } catch { /* Resolve the unknown ACK from durable state when possible. */ }
        const durablyCompleted = observedAfterUnknownAck?.oldStatus === "expired" &&
          observedAfterUnknownAck.entryStatus === "won" && observedAfterUnknownAck.winnerMatches &&
          observedAfterUnknownAck.expiryRunStatus === "completed" &&
          observedAfterUnknownAck.finalizationStatus === "completed" &&
          observedAfterUnknownAck.processed === 1 && observedAfterUnknownAck.itemOutcome === "processed" &&
          observedAfterUnknownAck.persistedPlan === 1 && observedAfterUnknownAck.winnerLicensePresent &&
          observedAfterUnknownAck.oldAccessConfigCount === 0 && observedAfterUnknownAck.retainedProfileCount === 1 &&
          observedAfterUnknownAck.eventCount === 2 && observedAfterUnknownAck.auditCreated;
        if (durablyCompleted) {
          // Wrangler's local proxy can lose the HTTP acknowledgement after the
          // remote D1-backed event commits. Accept only the exact terminal state;
          // the ordinary full readback below still checks every expected field.
          scheduled = new Response("scheduled outcome recovered from D1", { status: 200 });
        } else {
          const details = process.env.FANMARK_SMOKE_DIAGNOSTICS === "1"
            ? "_" + JSON.stringify({ observedAfterUnknownAck, wrangler: safeWranglerDiagnostics(dev?.output?.() ?? "") })
            : "_" + JSON.stringify({ observedAfterUnknownAck });
          fail("scheduled_event_transport_failed_" + code + details);
        }
      }
      const responseText = await scheduled.text();
      if (scheduled.status !== 200) fail("scheduled_event_failed_" + scheduled.status + "_" + responseText.slice(0, 120));
    }

    const row = d1(readbackSql({ fanmarkId, ownerId, winnerId, oldLicenseId,
      targetIncarnation, requestId: entryId }))[0];
    const observed = {
      oldStatus: row.old_status,
      oldGeneration: Number(row.old_generation),
      entryStatus: row.entry_status,
      winnerMatches: row.winner_user_id === winnerId,
      totalEntries: Number(row.total_entries),
      randomSeedPresent: /^[0-9a-f]{64}$/u.test(row.random_seed ?? ""),
      winnerLicensePresent: typeof row.winner_license_id === "string",
      expiryRunStatus: row.expiry_run_status,
      expiryCandidates: Number(row.expiry_candidates),
      finalizationStatus: row.finalization_status,
      finalizationCandidates: Number(row.finalization_candidates),
      processed: Number(row.processed_count),
      conflicts: Number(row.conflict_count),
      itemOutcome: row.item_outcome,
      persistedSeed: /^[0-9a-f]{64}$/u.test(row.persisted_seed ?? ""),
      persistedPlan: Number(row.persisted_plan),
      oldAccessConfigCount: Number(row.old_access_config_count),
      retainedProfileCount: Number(row.retained_profile_count),
      eventCount: Number(row.event_count),
      eventTypes: JSON.parse(row.event_types_json ?? "[]"),
      auditCreated: Number(row.audit_count) >= 1,
    };
    const expected = {
      oldStatus: "expired", oldGeneration: 1, entryStatus: "won", winnerMatches: true,
      totalEntries: 1, randomSeedPresent: true, winnerLicensePresent: true,
      expiryRunStatus: "completed", expiryCandidates: 0,
      finalizationStatus: "completed", finalizationCandidates: 1, processed: 1,
      conflicts: 0, itemOutcome: "processed", persistedSeed: true, persistedPlan: 1,
      oldAccessConfigCount: 0, retainedProfileCount: 1, eventCount: 2,
      eventTypes: ["license_expired", "lottery_won"], auditCreated: true,
    };
    assert.deepEqual(observed, expected, "lottery_state_mismatch " + JSON.stringify(observed));
    const winner = d1("SELECT status,is_initial_license,is_returned,is_transferred,license_end FROM fanmark_licenses WHERE id=" + sql(row.winner_license_id))[0];
    assert.equal(winner.status, "active");
    assert.equal(Number(winner.is_initial_license), 0);
    assert.equal(Number(winner.is_returned), 0);
    assert.equal(Number(winner.is_transferred), 0);
    assert.ok(Date.parse(winner.license_end) > Date.now());
    completed = true;
  } catch (error) {
    runError = error;
  } finally {
    if (dev?.child) await stopDev(dev.child);
    if (cronDeploymentAttempted && !cronDisabledAgain) {
      try {
        wrangler(["deploy", "--config", "wrangler.app-staging.jsonc"], WORKER_DIR);
        cronDisabledAgain = true;
      } catch { cronRestoreFailed = true; }
    }
    if (seedAttempted) {
      try { cleanup(ids); } catch (error) { cleanupError = error; }
    }
  }
  if (cronRestoreFailed) fail("staging_cron_disable_failed");
  if (cleanupError) throw cleanupError;
  if (DEPLOYED_CRON_CANARY) {
    if (!cronDisabledAgain) fail("staging_cron_not_disabled_after_canary");
    const restored = verifyTarget();
    assert.equal(fingerprint(restored.gracePeriodSetting), fingerprint(gracePeriodSetting),
      "grace_period_setting_not_restored");
    assert.equal(fingerprint(restored.lifecycleBaseline), fingerprint(lifecycleBaseline),
      "lifecycle_retained_state_not_restored");
  }
  if (runError) throw runError;
  console.log(JSON.stringify({
    staging: BUSINESS,
    scheduledPath: DEPLOYED_CRON_CANARY ? "deployed workers.dev Cron" : "remote D1 binding via local wrangler dev",
    cronAndBackendRestoredToDisabled: DEPLOYED_CRON_CANARY ? cronDisabledAgain : undefined,
    graceExpiryLottery: "winner_finalized", syntheticBusinessRowsAfterCleanup: 0,
    gracePeriodSettingPreserved: true,
    lifecycleJournalRowsAfterCleanup: 0, authUserRowsChanged: 0,
    realUserDataMigration: "not performed", productionOrDomainDns: "unchanged",
    completed,
  }));
}

main().catch((error) => {
  console.error(error?.message ?? "staging lottery smoke failed");
  process.exitCode = 1;
});

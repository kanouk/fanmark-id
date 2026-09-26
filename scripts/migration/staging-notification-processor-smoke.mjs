#!/usr/bin/env node

/** Run every seeded in-app notification rule through the scheduled Worker against staging D1. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const BUSINESS = "fanmark-business-staging";
const BUSINESS_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH = "fanmark-auth-staging";
const AUTH_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const APP_CONFIG = "wrangler.app-staging.jsonc";
const AUTH_CONFIG = "wrangler.auth-staging.jsonc";
const WORKER_DIR = "workers/api";
const APP_CONFIG_PATH = `${WORKER_DIR}/${APP_CONFIG}`;
const WRANGLER = "4.140.0";
const SOURCE_SCHEMA = "workers/api/migrations-business/0000_business_schema_v4_staging.sql";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];
const LIFECYCLE_TABLES = [
  "license_expiry_runs", "license_expiry_run_items", "license_grace_finalization_runs",
  "license_grace_finalization_items", "license_expiry_effect_guards",
];
const ACCESS_STATE_TABLES = [
  "fanmark_access_attempt_audit", "fanmark_access_attempt_reservations",
  "fanmark_access_rate_limits", "fanmark_access_rate_policy",
  "fanmark_license_incarnations", "fanmark_access_versions",
];

function fail(code) {
  throw new Error(code);
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wrangler(args, cwd = process.cwd(), timeout = 120_000) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER}`, ...args], {
    cwd, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr ?? result.error?.message ?? "")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-4)
      .join(" ")
      .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
      .replace(/(access[_ -]?token|refresh[_ -]?token|secret)([=: ]+)\S+/giu, "$1$2[redacted]")
      .slice(-800);
    const error = new Error("notification_staging_wrangler_failed");
    error.detail = detail || `exit_${result.status ?? result.error?.code ?? "unknown"}`;
    error.command = args.slice(0, 3).join(" ");
    throw error;
  }
  return result;
}

function json(args, cwd) {
  try {
    return JSON.parse(wrangler(args, cwd).stdout.trim());
  } catch (error) {
    if (error instanceof Error && error.message === "notification_staging_wrangler_failed") throw error;
    fail("notification_staging_wrangler_json_invalid");
  }
}

function d1(database, config, command) {
  const results = json(["d1", "execute", database, "--remote", "--json", "--command", command, "--config", config], WORKER_DIR);
  if (!Array.isArray(results) || results.some((result) => result?.success !== true || !Array.isArray(result.results))) {
    fail("notification_staging_d1_query_failed");
  }
  return results.flatMap((result) => result.results);
}

function d1Write(database, config, command) {
  const results = json([
    "d1", "execute", database, "--remote", "--json", "--command", command, "--yes", "--config", config,
  ], WORKER_DIR);
  if (!Array.isArray(results) || results.some((result) => result?.success !== true)) {
    fail("notification_staging_d1_write_failed");
  }
  return results;
}

function sumQuery(tables) {
  if (tables.length === 0) return "0";
  return tables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
}

function readBaseline(businessTables) {
  const masters = d1(BUSINESS, APP_CONFIG, NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(BUSINESS, APP_CONFIG, STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  if (notificationMasterBaselineState(masters) !== "seeded" ||
      stagingNonUserConfigBaselineState(settings) !== "seeded") fail("notification_staging_master_baseline_invalid");
  const rowTotal = Number(d1(BUSINESS, APP_CONFIG,
    `SELECT ${sumQuery(businessTables)} AS row_count`)[0]?.row_count);
  if (rowTotal !== 51) fail("notification_staging_business_baseline_invalid");
  const nonBaselineTables = businessTablesWithoutStagingBaselines(businessTables);
  const nonBaselineTotal = Number(d1(BUSINESS, APP_CONFIG,
    `SELECT ${sumQuery(nonBaselineTables)} AS row_count`)[0]?.row_count);
  if (nonBaselineTotal !== 0) fail("notification_staging_business_rows_present");
  const lifecycle = Number(d1(BUSINESS, APP_CONFIG,
    `SELECT ${sumQuery(LIFECYCLE_TABLES)} AS row_count`)[0]?.row_count);
  if (lifecycle !== 0) fail("notification_staging_lifecycle_rows_present");
  const accessState = d1(BUSINESS, APP_CONFIG, ACCESS_STATE_TABLES.map((table, index) =>
    `(SELECT COUNT(*) FROM "${table}") AS "c${index}"`).join(", ")
    .replace(/^/, "SELECT "))[0];
  const authTotal = Number(d1(AUTH, AUTH_CONFIG,
    `SELECT ${sumQuery(AUTH_TABLES)} AS row_count`)[0]?.row_count);
  if (authTotal !== 0) fail("notification_staging_auth_rows_present");
  return { rowTotal, accessState };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") fail("notification_staging_port_unavailable");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startWorker(port) {
  const child = spawn("npx", [
    "--yes", `wrangler@${WRANGLER}`, "dev", "--config", APP_CONFIG, "--test-scheduled",
    "--port", String(port), "--log-level", "info", "--var", "NOTIFICATION_PROCESSOR_BACKEND:d1",
    "--show-interactive-dev-session=false",
  ], { cwd: WORKER_DIR, env: { ...process.env, NO_COLOR: "1" }, detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const append = (chunk) => { output = (output + chunk.toString()).slice(-16_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) fail("notification_staging_worker_exited");
      if (output.includes("Ready on http://")) {
        try {
          const response = await fetch(`${baseUrl}/api/fanmarks/recent?limit=1`, { signal: AbortSignal.timeout(5_000) });
          const payload = await response.json();
          if (response.status === 200 && payload?.schemaVersion === 1 && Array.isArray(payload.items)) {
            return { child, baseUrl, output: () => output };
          }
        } catch { /* Wait for the local runtime and remote D1 binding. */ }
      }
      await delay(500);
    }
    fail("notification_staging_worker_not_ready");
  } catch (error) {
    await stopWorker(child);
    throw error;
  }
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch { /* The process may have exited between the state check and signal. */ }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000),
  ]);
  if (child.exitCode === null) {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch { /* The process may already be gone. */ }
  }
}

function verifyTarget({ deployedCron }) {
  const config = JSON.parse(readFileSync(APP_CONFIG_PATH, "utf8"));
  const crons = config.triggers?.crons ?? [];
  const processor = config.vars?.NOTIFICATION_PROCESSOR_BACKEND;
  const schedulerConfigInvalid = deployedCron
    ? crons.length !== 1 || crons[0] !== "* * * * *" || processor !== "d1"
    : crons.length !== 0 || processor !== undefined;
  if (config.name !== "fanmark-app-staging" || config.account_id !== ACCOUNT_ID || config.workers_dev !== true ||
      config.routes?.length || schedulerConfigInvalid || config.vars?.LICENSE_EXPIRY_BACKEND ||
      config.vars?.STRIPE_DISPATCH_BACKEND || config.vars?.STRIPE_WEBHOOK_BACKEND) {
    fail("notification_staging_worker_config_mismatch");
  }
  const businessBinding = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const authBinding = config.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  if (businessBinding?.database_name !== BUSINESS || businessBinding.database_id !== BUSINESS_ID || businessBinding.remote !== true ||
      authBinding?.database_name !== AUTH || authBinding.database_id !== AUTH_ID || authBinding.remote !== true) {
    fail("notification_staging_d1_binding_mismatch");
  }
  const identity = json(["whoami", "--json"], WORKER_DIR);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL || !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) {
    fail("notification_staging_cloudflare_account_mismatch");
  }
  const source = readFileSync(SOURCE_SCHEMA, "utf8");
  const tables = [...source.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (tables.length !== 40) fail("notification_staging_source_table_inventory_mismatch");
  return tables;
}

function readSecurityState() {
  return d1(BUSINESS, APP_CONFIG, `SELECT
    (SELECT COUNT(*) FROM fanmark_access_attempt_audit) AS audit_rows,
    (SELECT COUNT(*) FROM fanmark_access_attempt_reservations) AS reservations,
    (SELECT COUNT(*) FROM fanmark_access_rate_limits) AS rate_limits,
    (SELECT COUNT(*) FROM fanmark_access_rate_policy) AS rate_policy,
    (SELECT COUNT(*) FROM fanmark_license_incarnations) AS incarnations,
    (SELECT COUNT(*) FROM fanmark_access_versions) AS access_versions`)[0];
}

function readCanaryRows(eventIds, userId) {
  const eventList = eventIds.map(sql).join(",");
  return d1(BUSINESS, APP_CONFIG, `SELECT e.id AS event_id,e.event_type,e.status AS event_status,
    e.retry_count,e.processed_at,n.id AS notification_id,n.user_id,n.channel,n.status,
    n.delivered_at,json_extract(n.payload, '$.title') AS title,
    json_extract(n.payload, '$.body') AS body,
    json_extract(n.payload, '$.metadata.user_id') AS payload_user,
    json_extract(n.payload, '$.metadata.fanmark_id') AS payload_fanmark
    FROM notification_events e LEFT JOIN notifications n
      ON n.event_id=e.id AND n.user_id=${sql(userId)}
    WHERE e.id IN (${eventList}) ORDER BY e.event_type,n.id`);
}

function cleanup(eventIds, settingsId, userId, username) {
  const eventList = eventIds.map(sql).join(",");
  d1Write(BUSINESS, APP_CONFIG, [
    `DELETE FROM notifications WHERE event_id IN (${eventList}) AND user_id=${sql(userId)}`,
    `DELETE FROM notification_events WHERE id IN (${eventList})`,
    `DELETE FROM user_settings WHERE id=${sql(settingsId)} AND user_id=${sql(userId)} AND username=${sql(username)}`,
  ].join("; "));
}

const NOTIFICATION_CASES = Object.freeze([
  { eventType: "license_grace_started", title: "ライセンス失効処理中", marker: "🌹", extra: { license_end: "2026-10-10T00:00:00.000Z", grace_expires_at: "2026-10-10T00:00:00.000Z" } },
  { eventType: "transfer_approved", title: "移管申請が承認されました", marker: "🌹", extra: { license_end: "2026-10-10T00:00:00.000Z" } },
  { eventType: "transfer_rejected", title: "移管申請が拒否されました", marker: "🌹", extra: {} },
  { eventType: "favorite_fanmark_available", title: "お気に入りファンマが返却されました", marker: "🌹", extra: { grace_expires_at: "2026-10-10T00:00:00.000Z" } },
  { eventType: "fanmark_returned_owner", title: "ファンマーク返却完了", marker: "🌹", extra: { grace_expires_at: "2026-10-10T00:00:00.000Z" } },
  { eventType: "lottery_cancelled_by_extension", title: "抽選キャンセル", marker: "🌹", extra: { fanmark_emoji: "🌹" } },
  { eventType: "lottery_lost", title: "抽選結果: 落選しました", marker: "🌹", extra: { total_applicants: 3 } },
  { eventType: "lottery_won", title: "抽選結果: 当選しました", marker: "🌹", extra: { license_end: "2026-10-10T00:00:00.000Z" } },
  { eventType: "license_expired", title: "ライセンス失効", marker: "🌹", extra: { expired_at: "2026-10-10T00:00:00.000Z", license_end: "2026-10-10T00:00:00.000Z" } },
  { eventType: "transfer_requested", title: "移管申請を受け付けました", marker: "🌹", extra: { requester_name: "合成申請者" } },
]);

async function main() {
  const args = process.argv.slice(2);
  const deployedCron = args.length === 1 && args[0] === "--deployed-cron";
  if (args.length > 0 && !deployedCron) fail("notification_staging_arguments_invalid");
  const businessTables = verifyTarget({ deployedCron });
  const baseline = readBaseline(businessTables);
  const securityState = readSecurityState();
  const applicationRows = d1(BUSINESS, APP_CONFIG, `SELECT
    (SELECT COUNT(*) FROM notification_events) AS events,
    (SELECT COUNT(*) FROM notifications) AS notifications,
    (SELECT COUNT(*) FROM notification_preferences) AS preferences,
    (SELECT COUNT(*) FROM user_settings) AS user_settings`)[0];
  if (Object.values(applicationRows).some((value) => Number(value) !== 0)) fail("notification_staging_application_rows_present");
  const rules = d1(BUSINESS, APP_CONFIG, `SELECT event_type,template_id,template_version FROM notification_rules
    WHERE enabled=1 AND channel='in_app' ORDER BY event_type`);
  assert.deepEqual(rules.map((row) => row.event_type), NOTIFICATION_CASES.map((testCase) => testCase.eventType).sort());
  for (const rule of rules) {
    const templateCount = Number(d1(BUSINESS, APP_CONFIG, `SELECT COUNT(*) AS count FROM notification_templates
      WHERE template_id=${sql(rule.template_id)} AND version=${Number(rule.template_version)}
        AND channel='in_app' AND language='ja' AND is_active=1`)[0]?.count);
    if (templateCount !== 1) fail("notification_staging_template_missing_or_ambiguous");
  }
  const unsupportedRules = Number(d1(BUSINESS, APP_CONFIG,
    "SELECT COUNT(*) AS count FROM notification_rules WHERE enabled=1 AND channel <> 'in_app'")[0]?.count);
  if (unsupportedRules !== 0) fail("notification_staging_unsupported_channel_rules_present");

  const settingsId = randomUUID();
  const userId = randomUUID();
  const username = `migration-notification-${userId.replaceAll("-", "")}`;
  const fanmarkName = "🌹合成通知canary";
  const cases = NOTIFICATION_CASES.map((testCase) => ({
    ...testCase,
    eventId: randomUUID(),
    fanmarkId: randomUUID(),
    payload: {
      user_id: userId,
      fanmark_id: randomUUID(),
      fanmark_name: fanmarkName,
      language: "ja",
      ...testCase.extra,
    },
  }));
  for (const testCase of cases) testCase.payload.fanmark_id = testCase.fanmarkId;
  const eventIds = cases.map((testCase) => testCase.eventId);
  let worker = null;
  let runError = null;
  let canary = null;

  try {
    const now = new Date().toISOString();
    const statements = [`INSERT INTO user_settings (id,user_id,username,plan_type,preferred_language,created_at,updated_at)
      VALUES (${sql(settingsId)},${sql(userId)},${sql(username)},'free','ja',${sql(now)},${sql(now)})`];
    for (const testCase of cases) statements.push(`INSERT INTO notification_events
      (id,event_type,event_version,source,payload,trigger_at,status,retry_count,created_at,updated_at)
      VALUES (${sql(testCase.eventId)},${sql(testCase.eventType)},1,'system',${sql(JSON.stringify(testCase.payload))},${sql(now)},'pending',0,${sql(now)},${sql(now)})`);
    d1Write(BUSINESS, APP_CONFIG, statements.join("; "));
    if (!deployedCron) {
      const port = await freePort();
      worker = await startWorker(port);
      const scheduled = await fetch(`${worker.baseUrl}/__scheduled?cron=*+*+*+*+*`, { signal: AbortSignal.timeout(30_000) });
      if (!scheduled.ok) fail("notification_staging_scheduled_request_failed");
    }

    // The deployed Cron is already active; this run only waits for its next tick.
    const deadline = Date.now() + (deployedCron ? 120_000 : 30_000);
    while (Date.now() < deadline) {
      canary = readCanaryRows(eventIds, userId);
      if (canary.some((row) => row.event_status === "failed")) fail("notification_staging_processor_failed_event");
      if (canary.length === cases.length && canary.every((row) =>
          row.event_status === "processed" && row.notification_id !== null)) break;
      await delay(deployedCron ? 5_000 : 1_000);
    }
    assert.equal(canary?.length, cases.length);
    assert.equal(canary.filter((row) => row.notification_id !== null).length, cases.length);
    for (const testCase of cases) {
      const rows = canary.filter((row) => row.event_id === testCase.eventId);
      assert.equal(rows.length, 1);
      const [row] = rows;
      assert.equal(row.event_type, testCase.eventType);
      assert.equal(row.event_status, "processed");
      assert.equal(Number(row.retry_count), 0);
      assert.equal(row.user_id, userId);
      assert.equal(row.channel, "in_app");
      assert.equal(row.status, "delivered");
      assert.ok(row.delivered_at);
      assert.equal(row.payload_user, userId);
      assert.equal(row.payload_fanmark, testCase.fanmarkId);
      assert.equal(row.title, testCase.title);
      assert.ok(String(row.body).includes(testCase.marker));
      assert.match(String(row.body), /[\u3040-\u30ff\u4e00-\u9fff]/u);
    }
  } catch (error) {
    runError = error;
  } finally {
    if (worker?.child) await stopWorker(worker.child);
    try {
      // IDs are unique to this run, so deletion is safe even if an insert
      // statement failed after earlier statements were accepted.
      cleanup(eventIds, settingsId, userId, username);
    } catch {
      if (!runError) runError = new Error("notification_staging_cleanup_failed");
    }
  }

  try {
    const finalBaseline = readBaseline(businessTables);
    assert.deepEqual(finalBaseline, baseline);
    assert.deepEqual(readSecurityState(), securityState);
    const after = d1(BUSINESS, APP_CONFIG, `SELECT
      (SELECT COUNT(*) FROM notification_events) AS events,
      (SELECT COUNT(*) FROM notifications) AS notifications,
      (SELECT COUNT(*) FROM notification_preferences) AS preferences,
      (SELECT COUNT(*) FROM user_settings) AS user_settings`)[0];
    assert.deepEqual(Object.values(after).map(Number), [0, 0, 0, 0]);
  } catch {
    if (!runError) runError = new Error("notification_staging_cleanup_readback_failed");
  }
  if (runError) throw runError;
  console.log(JSON.stringify({
    status: "passed",
    execution: deployedCron ? "deployed workers.dev Cron with remote business D1" : "local scheduled Worker with remote business D1",
    ruleCount: cases.length,
    notification: "one delivered Japanese in-app item per migrated event rule",
    syntheticRowsAfterCleanup: 0,
    masterAndPublicSettingsBaselinePreserved: true,
    accessSecurityStatePreserved: true,
    ...(deployedCron ? { deployedCronRemainedEnabled: true } : { noWorkerDeploymentOrCronChange: true }),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "failed",
    code: error instanceof Error ? error.message : "unexpected_error",
    ...(error && typeof error === "object" && "command" in error ? { command: error.command } : {}),
    ...(error && typeof error === "object" && "detail" in error ? { detail: error.detail } : {}),
  }));
  process.exitCode = 1;
});

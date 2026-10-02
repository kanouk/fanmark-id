#!/usr/bin/env node

/** Exercise the D1 notification archive against staging using unique synthetic rows. */

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
  readStagingExtensionCouponMasterBaseline,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingBusinessBaselineRowCount,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";
import {
  readStagingEmailTemplateMasterBaseline,
  stagingEmailTemplateMasterRowCount,
} from "./staging-email-template-master-baseline.mjs";
import { isStagingNotificationArchiveTarget } from "./staging-notification-archive-target.mjs";

const BUSINESS = "fanmark-business-staging";
const AUTH = "fanmark-auth-staging";
const APP_CONFIG = "wrangler.app-staging.jsonc";
const AUTH_CONFIG = "wrangler.auth-staging.jsonc";
const WORKER_DIR = "workers/api";
const APP_CONFIG_PATH = `${WORKER_DIR}/${APP_CONFIG}`;
const WRANGLER = "4.140.0";
const SOURCE_SCHEMA = `${WORKER_DIR}/migrations-business/0000_business_schema_v4_staging.sql`;
const ARCHIVE_CRON = "0 0 * * *";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];

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
    const error = new Error("notification_archive_staging_wrangler_failed");
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
    if (error instanceof Error && error.message === "notification_archive_staging_wrangler_failed") throw error;
    fail("notification_archive_staging_wrangler_json_invalid");
  }
}

function d1(database, config, command) {
  const results = json(["d1", "execute", database, "--remote", "--json", "--command", command, "--config", config], WORKER_DIR);
  if (!Array.isArray(results) || results.some((result) => result?.success !== true || !Array.isArray(result.results))) {
    fail("notification_archive_staging_d1_query_failed");
  }
  return results.flatMap((result) => result.results);
}

function d1Write(database, config, command) {
  const results = json([
    "d1", "execute", database, "--remote", "--json", "--command", command, "--yes", "--config", config,
  ], WORKER_DIR);
  if (!Array.isArray(results) || results.some((result) => result?.success !== true)) {
    fail("notification_archive_staging_d1_write_failed");
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
  const emailTemplateBaseline = readStagingEmailTemplateMasterBaseline((command) => d1(BUSINESS, APP_CONFIG, command));
  const extensionCouponBaseline = readStagingExtensionCouponMasterBaseline((command) => d1(BUSINESS, APP_CONFIG, command));
  if (notificationMasterBaselineState(masters) !== "seeded" ||
      stagingNonUserConfigBaselineState(settings) !== "seeded" || emailTemplateBaseline === "invalid" ||
      extensionCouponBaseline === "invalid") {
    fail("notification_archive_staging_master_baseline_invalid");
  }
  const rowTotal = Number(d1(BUSINESS, APP_CONFIG,
    `SELECT ${sumQuery(businessTables)} AS row_count`)[0]?.row_count);
  const expectedRowTotal = stagingBusinessBaselineRowCount(settings, masters) +
    stagingEmailTemplateMasterRowCount(emailTemplateBaseline) + (extensionCouponBaseline === "seeded" ? 4 : 0);
  if (rowTotal !== expectedRowTotal) fail("notification_archive_staging_business_baseline_invalid");
  const nonBaselineTables = businessTablesWithoutStagingBaselines(businessTables, {
    verifiedEmailTemplateMasters: true,
    verifiedExtensionCouponMaster: extensionCouponBaseline === "seeded",
  });
  const nonBaselineTotal = Number(d1(BUSINESS, APP_CONFIG,
    `SELECT ${sumQuery(nonBaselineTables)} AS row_count`)[0]?.row_count);
  if (nonBaselineTotal !== 0) fail("notification_archive_staging_business_rows_present");
  const authTotal = Number(d1(AUTH, AUTH_CONFIG,
    `SELECT ${sumQuery(AUTH_TABLES)} AS row_count`)[0]?.row_count);
  if (authTotal !== 0) fail("notification_archive_staging_auth_rows_present");
  return { rowTotal, masters, settings, emailTemplateBaseline, extensionCouponBaseline };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") fail("notification_archive_staging_port_unavailable");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startWorker(port) {
  const child = spawn("npx", [
    "--yes", `wrangler@${WRANGLER}`, "dev", "--config", APP_CONFIG, "--test-scheduled",
    "--port", String(port), "--log-level", "info", "--var", "NOTIFICATION_ARCHIVE_BACKEND:d1",
    "--var", "NOTIFICATION_WAKE_BACKEND:disabled",
    "--show-interactive-dev-session=false",
  ], {
    cwd: WORKER_DIR,
    env: { ...process.env, NO_COLOR: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => { output = (output + chunk.toString()).slice(-16_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) fail("notification_archive_staging_worker_exited");
      if (output.includes("Ready on http://")) {
        try {
          const response = await fetch(`${baseUrl}/api/fanmarks/recent?limit=1`, { signal: AbortSignal.timeout(5_000) });
          const payload = await response.json();
          if (response.status === 200 && payload?.schemaVersion === 1 && Array.isArray(payload.items)) {
            return { child, baseUrl };
          }
        } catch { /* Wait for the local runtime and remote D1 bindings. */ }
      }
      await delay(500);
    }
    fail("notification_archive_staging_worker_not_ready");
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

function verifyTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG_PATH, "utf8"));
  const identity = json(["whoami", "--json"], WORKER_DIR);
  if (!isStagingNotificationArchiveTarget(config, identity)) {
    fail("notification_archive_staging_cloudflare_account_mismatch");
  }
  const source = readFileSync(SOURCE_SCHEMA, "utf8");
  const tables = [...source.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (tables.length !== 40) fail("notification_archive_staging_source_table_inventory_mismatch");
  const index = d1(BUSINESS, APP_CONFIG,
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notifications_archive_due'`);
  if (index.length !== 1) fail("notification_archive_staging_index_missing");
  return tables;
}

function insertCanaries(cases, now) {
  const statements = cases.map((testCase) => `INSERT INTO notifications
    (id,user_id,channel,template_id,template_version,payload,status,priority,triggered_at,delivered_at,
     retry_count,created_at,updated_at)
    VALUES (${sql(testCase.id)},${sql(testCase.userId)},'in_app','migration-archive-canary',1,
      ${sql(JSON.stringify({ marker: testCase.marker }))},${sql(testCase.status)},5,${sql(now)},
      ${testCase.status === "delivered" ? sql(now) : "NULL"},0,${sql(testCase.createdAt)},${sql(now)})`);
  d1Write(BUSINESS, APP_CONFIG, statements.join("; "));
}

function readCanaries(ids) {
  const list = ids.map(sql).join(",");
  return {
    notifications: d1(BUSINESS, APP_CONFIG,
      `SELECT id,status,created_at,payload FROM notifications WHERE id IN (${list}) ORDER BY id`),
    history: d1(BUSINESS, APP_CONFIG,
      `SELECT id,original_data,archived_at FROM notifications_history WHERE id IN (${list}) ORDER BY id`),
  };
}

function cleanup(ids) {
  const list = ids.map(sql).join(",");
  d1Write(BUSINESS, APP_CONFIG, [
    `DELETE FROM notifications WHERE id IN (${list})`,
    `DELETE FROM notifications_history WHERE id IN (${list})`,
  ].join("; "));
}

async function main() {
  if (process.argv.length !== 2) fail("notification_archive_staging_arguments_invalid");
  const businessTables = verifyTarget();
  const baseline = readBaseline(businessTables);
  const stale = Number(d1(BUSINESS, APP_CONFIG, `SELECT COUNT(*) AS count FROM notifications
    WHERE status IN ('delivered','failed') AND created_at < datetime('now','-90 days')`)[0]?.count);
  const current = Number(d1(BUSINESS, APP_CONFIG, "SELECT COUNT(*) AS count FROM notifications")[0]?.count);
  const history = Number(d1(BUSINESS, APP_CONFIG, "SELECT COUNT(*) AS count FROM notifications_history")[0]?.count);
  if (stale !== 0 || current !== 0 || history !== 0) fail("notification_archive_staging_notification_rows_present");

  const userId = randomUUID();
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const recent = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const cases = [
    { id: randomUUID(), userId, status: "delivered", createdAt: old, marker: "archive-delivered" },
    { id: randomUUID(), userId, status: "failed", createdAt: old, marker: "archive-failed" },
    { id: randomUUID(), userId, status: "pending", createdAt: old, marker: "archive-pending" },
    { id: randomUUID(), userId, status: "cancelled", createdAt: old, marker: "archive-cancelled" },
    { id: randomUUID(), userId, status: "delivered", createdAt: recent, marker: "archive-recent" },
    { id: randomUUID(), userId, status: "sent", createdAt: old, marker: "archive-sent" },
  ];
  const ids = cases.map((testCase) => testCase.id);
  const expectedArchived = new Set(cases.filter((testCase) => ["delivered", "failed"].includes(testCase.status) &&
    testCase.createdAt === old).map((testCase) => testCase.id));
  let worker = null;
  let runError = null;
  let state = null;
  try {
    worker = await startWorker(await freePort());
    insertCanaries(cases, now);
    const response = await fetch(`${worker.baseUrl}/__scheduled?cron=0+0+*+*+*`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) fail("notification_archive_staging_scheduled_request_failed");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      state = readCanaries(ids);
      const archived = new Set(state.history.map((row) => row.id));
      const pendingIds = new Set(state.notifications.map((row) => row.id));
      if ([...expectedArchived].every((id) => archived.has(id)) &&
          ids.filter((id) => !expectedArchived.has(id)).every((id) => pendingIds.has(id))) break;
      await delay(1_000);
    }
    assert.deepEqual(new Set(state?.history.map((row) => row.id)), expectedArchived);
    assert.deepEqual(new Set(state?.notifications.map((row) => row.id)), new Set(ids.filter((id) => !expectedArchived.has(id))));
    for (const row of state.history) {
      const source = cases.find((testCase) => testCase.id === row.id);
      assert.ok(source);
      const archived = JSON.parse(row.original_data);
      assert.equal(archived.id, source.id);
      assert.equal(archived.user_id, userId);
      assert.equal(archived.status, source.status);
      assert.equal(archived.created_at, source.createdAt);
      assert.equal(archived.payload.marker, source.marker);
      assert.match(row.archived_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);
      assert.ok(Math.abs(Date.parse(row.archived_at) - Date.now()) < 60_000);
    }
  } catch (error) {
    runError = error;
  } finally {
    if (worker?.child) await stopWorker(worker.child);
    try {
      cleanup(ids);
    } catch {
      if (!runError) runError = new Error("notification_archive_staging_cleanup_failed");
    }
  }

  try {
    assert.deepEqual(readBaseline(businessTables), baseline);
    const after = readCanaries(ids);
    assert.equal(after.notifications.length, 0);
    assert.equal(after.history.length, 0);
  } catch {
    if (!runError) runError = new Error("notification_archive_staging_cleanup_readback_failed");
  }
  if (runError) throw runError;
  console.log(JSON.stringify({
    status: "passed",
    execution: "local scheduled Worker with remote business D1",
    cron: ARCHIVE_CRON,
    archivedRows: expectedArchived.size,
    retainedIneligibleRows: ids.length - expectedArchived.size,
    syntheticRowsAfterCleanup: 0,
    masterAndPublicSettingsBaselinePreserved: true,
    authRowsCopied: 0,
    noWorkerDeploymentOrCronChange: true,
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

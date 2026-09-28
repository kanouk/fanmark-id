#!/usr/bin/env node

/** Exercise both public access analytics writes and owner reads with one synthetic staging identity. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  readStagingExtensionCouponMasterBaseline,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";
import { readStagingEmailTemplateMasterBaseline } from "./staging-email-template-master-baseline.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const MASTER_DATABASE = "fanmark-emoji-master-staging";
const MASTER_DATABASE_ID = "160376b0-bde6-4d5f-8969-96deb5ae1183";
const WORKER_DIR = "workers/api";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const WRANGLER_VERSION = "4.135.0";
const VERIFY_RENDERED_UI = process.argv.includes("--verify-rendered-ui");
const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = require("bcryptjs");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function runJson(args) {
  try {
    return JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error?.code) throw error;
    fail("wrangler_json_invalid");
  }
}

function d1Rows(result) {
  const rows = result[0]?.results;
  if (!Array.isArray(rows)) fail("staging_d1_readback_failed");
  return rows;
}

function runD1(config, database, sql) {
  const result = runJson(["d1", "execute", database, "--remote", "--json", "--command", sql, "--config", config]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  return result;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  const limiter = config.ratelimits?.find((entry) => entry.name === "FANMARK_ACCESS_ANALYTICS_LIMITER");
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.custom_domains?.length || limiter?.namespace_id !== "41092703" ||
      limiter.simple?.limit !== 120 || limiter.simple.period !== 60 ||
      config.vars?.FANMARK_ANALYTICS_BACKEND !== "d1" || config.vars?.FANMARK_ACCESS_ANALYTICS_BACKEND !== "d1") {
    fail("staging_worker_target_mismatch");
  }
  const expected = [
    ["FANMARK_DB", BUSINESS_DATABASE, BUSINESS_DATABASE_ID],
    ["AUTH_DB", AUTH_DATABASE, AUTH_DATABASE_ID],
    ["MASTER_DB", MASTER_DATABASE, MASTER_DATABASE_ID],
  ];
  for (const [binding, name, id] of expected) {
    const actual = config.d1_databases?.find((entry) => entry.binding === binding);
    if (actual?.database_name !== name || actual.database_id !== id) fail("staging_d1_config_mismatch");
  }
  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const databases = runJson(["d1", "list", "--json"]);
  for (const [, name, id] of expected) {
    if (!databases.some((database) =>
      (database.uuid ?? database.database_id ?? database.id) === id &&
      (database.name ?? database.database_name) === name)) fail("cloudflare_database_mismatch");
  }

  const migration = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const tables = [...migration.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (tables.length !== 40) fail("business_table_inventory_mismatch");
  const masters = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, NOTIFICATION_MASTER_COUNTS_SQL))[0];
  const settings = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, STAGING_NON_USER_CONFIG_BASELINE_SQL))[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_mismatch");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_mismatch");
  const emailTemplateBaseline = readStagingEmailTemplateMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql)));
  if (emailTemplateBaseline === "invalid") fail("email_template_master_baseline_mismatch");
  const extensionCouponBaseline = readStagingExtensionCouponMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql)));
  if (extensionCouponBaseline === "invalid") fail("extension_coupon_master_baseline_mismatch");
  const businessTables = businessTablesWithoutStagingBaselines(tables, {
    verifiedEmailTemplateMasters: true,
    verifiedExtensionCouponMaster: extensionCouponBaseline === "seeded",
  });
  const rowTotalSql = businessTables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
  if (Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `SELECT ${rowTotalSql} AS total_rows`))[0]?.total_rows) !== 0) {
    fail("business_staging_has_rows");
  }
  return { businessTables, extensionCouponBaseline, emailTemplateBaseline };
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { Origin: APP_ORIGIN, ...(init.headers ?? {}) },
  });
}

async function readJson(response, expectedStatus, code) {
  if (response.status !== expectedStatus) fail(`${code}_${response.status}`);
  return response.json();
}

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const cookie = cookies.map((value) => value.split(";", 1)[0]).find((value) => /session_token=/u.test(value));
  if (!cookie) fail("response_cookie_missing");
  return cookie;
}

function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  let rejectOpen;
  let openTimeout;
  const opened = new Promise((resolve, reject) => {
    rejectOpen = reject;
    openTimeout = setTimeout(() => reject(new Error("browser_cdp_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(openTimeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(openTimeout);
      reject(new Error("browser_cdp_connect_failed"));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!Number.isInteger(message.id)) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timeout);
    if (message.error) operation.reject(new Error("browser_cdp_command_failed"));
    else operation.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    rejectOpen?.(new Error("browser_cdp_closed"));
    for (const operation of pending.values()) {
      clearTimeout(operation.timeout);
      operation.reject(new Error("browser_cdp_closed"));
    }
    pending.clear();
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error("browser_cdp_timeout"));
        }, 15_000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

function cookieParts(cookie) {
  const separator = cookie.indexOf("=");
  if (separator < 1) fail("session_cookie_invalid");
  return { name: cookie.slice(0, separator), value: cookie.slice(separator + 1) };
}

async function verifyRenderedAnalytics(cookie) {
  const chromeCandidates = [
    process.env.FANMARK_STAGING_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chromePath) fail("headless_chrome_unavailable");

  const profileDirectory = mkdtempSync(join(tmpdir(), "fanmark-analytics-ui-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--metrics-recording-only", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profileDirectory}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });
  let cdp;
  let chromeFailed = false;
  let chromeExit;
  const exited = new Promise((resolve) => { chromeExit = resolve; });
  chrome.once("exit", chromeExit);
  chrome.once("error", () => {
    chromeFailed = true;
    chromeExit();
  });
  const chromeRunning = () => !chromeFailed && chrome.exitCode === null && chrome.signalCode === null;

  try {
    const activePortPath = join(profileDirectory, "DevToolsActivePort");
    const startupDeadline = Date.now() + 15_000;
    let port;
    while (Date.now() < startupDeadline) {
      if (!chromeRunning()) fail("headless_chrome_exited");
      if (existsSync(activePortPath)) {
        const [value] = readFileSync(activePortPath, "utf8").split(/\r?\n/u);
        if (/^\d+$/u.test(value ?? "")) {
          port = value;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!port) fail("browser_devtools_start_timeout");

    const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
    if (!targetsResponse.ok) fail("browser_target_list_failed");
    const targets = await targetsResponse.json();
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!page) fail("browser_page_target_missing");

    cdp = cdpConnection(page.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    const cookieResult = await cdp.send("Network.setCookie", {
      ...cookieParts(cookie), url: APP_ORIGIN, path: "/", secure: true, httpOnly: true, sameSite: "Lax",
    });
    if (cookieResult.success !== true) fail("browser_session_cookie_rejected");
    await cdp.send("Page.navigate", { url: `${APP_ORIGIN}/analytics` });

    const translations = JSON.parse(readFileSync("src/translations/ja.json", "utf8")).analytics;
    const expression = `(() => {
      const labels = ${JSON.stringify({
        pageTitle: translations.pageTitle,
        totalAccess: translations.totalAccess,
        uniqueVisitors: translations.uniqueVisitors,
      })};
      const metric = (label) => {
        const element = Array.from(document.querySelectorAll('p')).find((item) => item.textContent?.trim() === label);
        return element?.nextElementSibling?.textContent?.trim() ?? null;
      };
      return {
        path: location.pathname,
        title: Array.from(document.querySelectorAll('h1')).some((item) => item.textContent?.trim() === labels.pageTitle),
        totalAccess: metric(labels.totalAccess),
        uniqueVisitors: metric(labels.uniqueVisitors),
        workerReads: performance.getEntriesByType('resource').map((item) => item.name)
          .filter((name) => name.startsWith(location.origin + '/api/me/analytics')),
      };
    })()`;
    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      if (!chromeRunning()) fail("headless_chrome_exited");
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
      const state = result.result?.value ?? {};
      if (state.path === "/analytics" && state.title && state.totalAccess === "1" &&
          state.uniqueVisitors === "1" && Array.isArray(state.workerReads) && state.workerReads.length >= 2) {
        return { path: state.path, totalAccess: state.totalAccess, uniqueVisitors: state.uniqueVisitors,
          workerReadCount: state.workerReads.length };
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    fail("rendered_analytics_timeout");
  } finally {
    cdp?.close();
    if (chromeRunning()) {
      chrome.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    if (chromeRunning()) {
      chrome.kill("SIGKILL");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}

async function cleanup({ userId, email, fanmarkId, licenseId }) {
  const license = licenseId ? sqlLiteral(licenseId) : "'__no_license__'";
  const fanmark = fanmarkId ? sqlLiteral(fanmarkId) : "'__no_fanmark__'";
  runD1(APP_CONFIG, BUSINESS_DATABASE, `
    DELETE FROM fanmark_access_daily_stats WHERE fanmark_id = ${fanmark};
    DELETE FROM fanmark_access_logs WHERE fanmark_id = ${fanmark};
    DELETE FROM fanmark_profiles WHERE license_id = ${license};
    DELETE FROM fanmark_basic_configs WHERE license_id = ${license};
    DELETE FROM fanmark_redirect_configs WHERE license_id = ${license};
    DELETE FROM fanmark_messageboard_configs WHERE license_id = ${license};
    DELETE FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'register_fanmark';
    DELETE FROM fanmark_discoveries WHERE fanmark_id = ${fanmark};
    DELETE FROM user_settings WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM fanmark_licenses WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM fanmarks WHERE id = ${fanmark};
  `);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM account WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM "user" WHERE id = ${sqlLiteral(userId)} AND email = ${sqlLiteral(email)};
  `);
  const exact = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ${sqlLiteral(userId)}) AS settings,
      (SELECT COUNT(*) FROM fanmark_licenses WHERE user_id = ${sqlLiteral(userId)}) AS licenses,
      (SELECT COUNT(*) FROM fanmarks WHERE id = ${fanmark}) AS fanmarks,
      (SELECT COUNT(*) FROM fanmark_access_logs WHERE fanmark_id = ${fanmark}) AS logs,
      (SELECT COUNT(*) FROM fanmark_access_daily_stats WHERE fanmark_id = ${fanmark}) AS stats
  `))[0];
  const auth = d1Rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM "user" WHERE id = ${sqlLiteral(userId)} AND email = ${sqlLiteral(email)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sqlLiteral(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sqlLiteral(userId)}) AS sessions
  `))[0];
  if ([...Object.values(exact), ...Object.values(auth)].some((value) => Number(value) !== 0)) {
    fail("synthetic_analytics_cleanup_failed");
  }
  return { business: exact, auth };
}

async function main() {
  const { businessTables, extensionCouponBaseline, emailTemplateBaseline } = assertTarget();
  const rose = d1Rows(runD1(APP_CONFIG, MASTER_DATABASE, `
    SELECT record.id, record.emoji
    FROM fanmark_emoji_master_active_release AS active
    JOIN fanmark_emoji_master_release_staging AS record ON record.release_version = active.release_version
    WHERE active.singleton_id = 1 AND record.emoji = '🌹' LIMIT 1
  `))[0];
  if (!rose || typeof rose.id !== "string") fail("staging_master_data_missing");

  const userId = randomUUID();
  const nonce = randomBytes(9).toString("hex");
  const email = `codex-analytics-${nonce}@example.invalid`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const timestamp = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const passwordHash = await bcrypt.hash(password, 10);
  let fanmarkId;
  let licenseId;
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Codex analytics smoke', ${sqlLiteral(email)}, 1, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
    `);
    const signedIn = await request("/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    await readJson(signedIn, 200, "better_auth_sign_in_failed");
    const cookie = sessionCookie(signedIn);
    const registration = await readJson(await request("/api/fanmarks/register", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        user_input_fanmark: rose.emoji,
        emoji_ids: [rose.id],
        normalized_emoji_ids: [rose.id],
        accessType: "profile",
        displayName: "Codex analytics smoke",
        createProfile: true,
      }),
    }), 201, "synthetic_fanmark_registration_failed");
    fanmarkId = registration.fanmark.id;
    if (typeof fanmarkId !== "string") fail("synthetic_fanmark_id_missing");
    const row = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT l.id AS license_id, f.short_id
      FROM fanmark_licenses AS l JOIN fanmarks AS f ON f.id = l.fanmark_id
      WHERE l.user_id = ${sqlLiteral(userId)} AND f.id = ${sqlLiteral(fanmarkId)} LIMIT 1
    `))[0];
    if (!row || typeof row.license_id !== "string" || typeof row.short_id !== "string") fail("synthetic_license_readback_missing");
    licenseId = row.license_id;
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_settings (user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES (${sqlLiteral(userId)}, ${sqlLiteral(`analytics-${nonce}`)}, 'business', 'ja', ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
    `);

    const today = new Date().toISOString().slice(0, 10);
    const body = {
      fanmark_id: fanmarkId,
      short_id: row.short_id,
      referrer: "https://www.google.co.jp/search?q=synthetic",
      user_agent: `Mozilla/5.0 Synthetic-Analytics-${nonce} (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/605.1.15`,
      utm_source: "synthetic",
      utm_medium: "canary",
      utm_campaign: nonce,
      access_type: "profile",
    };
    const recorded = await readJson(await request("/api/fanmarks/access", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), 200, "analytics_write_failed");
    assert.deepEqual(recorded, { success: true, recorded: true });
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => request("/api/fanmarks/access", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })));
    const duplicatePayloads = await Promise.all(duplicates.map((response) => readJson(response, 200, "analytics_duplicate_failed")));
    assert.ok(duplicatePayloads.every((payload) => payload.success === true && payload.recorded === false));

    const fanmarks = await readJson(await request("/api/me/analytics/fanmarks", { headers: { cookie } }), 200, "analytics_fanmarks_read_failed");
    assert.equal(fanmarks.schemaVersion, 1);
    assert.equal(fanmarks.result.length, 1);
    assert.equal(fanmarks.result[0].id, fanmarkId);
    const analytics = await readJson(await request(`/api/me/analytics?start_date=${today}&end_date=${today}`, { headers: { cookie } }), 200, "analytics_read_failed");
    assert.equal(analytics.result.summary.accessCount, 1);
    assert.equal(analytics.result.summary.uniqueVisitors, 1);
    assert.equal(analytics.result.summary.referrerSearch, 1);
    assert.equal(analytics.result.summary.deviceMobile, 1);
    assert.deepEqual(analytics.result.dailyStats, [{ statDate: today, accessCount: 1, uniqueVisitors: 1 }]);
    assert.deepEqual(analytics.result.fanmarkTotals, [{ fanmarkId, accessCount: 1 }]);
    assert.equal(JSON.stringify(analytics.result).includes(userId), false);
    assert.equal(JSON.stringify(analytics.result).includes(email), false);
    const summary = await readJson(await request("/api/me/analytics/summary?days=30", { headers: { cookie } }), 200, "analytics_summary_failed");
    assert.deepEqual(summary.result, { totalAccess: 1 });
    const renderedUi = VERIFY_RENDERED_UI ? await verifyRenderedAnalytics(cookie) : null;
    const anonymous = await request(`/api/me/analytics?start_date=${today}&end_date=${today}`);
    assert.equal(anonymous.status, 401);

    const readback = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT
        (SELECT COUNT(*) FROM fanmark_access_logs WHERE fanmark_id = ${sqlLiteral(fanmarkId)}) AS logs,
        (SELECT COUNT(*) FROM fanmark_access_daily_stats WHERE fanmark_id = ${sqlLiteral(fanmarkId)} AND stat_date = ${sqlLiteral(today)}) AS stats,
        (SELECT access_count FROM fanmark_access_daily_stats WHERE fanmark_id = ${sqlLiteral(fanmarkId)} AND stat_date = ${sqlLiteral(today)}) AS access_count
    `))[0];
    assert.deepEqual(Object.fromEntries(Object.entries(readback).map(([key, value]) => [key, Number(value)])), {
      logs: 1, stats: 1, access_count: 1,
    });

    const cleanupProof = await cleanup({ userId, email, fanmarkId, licenseId });
    const totalRowsSql = businessTables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
    const totalRows = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `SELECT ${totalRowsSql} AS total_rows`))[0]?.total_rows);
    if (totalRows !== 0) fail("business_staging_cleanup_not_empty");
    const masters = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, NOTIFICATION_MASTER_COUNTS_SQL))[0];
    const settings = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, STAGING_NON_USER_CONFIG_BASELINE_SQL))[0];
    if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_changed");
    if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_changed");
    const extensionCouponBaselineAfter = readStagingExtensionCouponMasterBaseline((sql) =>
      d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql)));
    if (extensionCouponBaselineAfter !== extensionCouponBaseline) fail("extension_coupon_master_baseline_changed");
    if (readStagingEmailTemplateMasterBaseline((sql) =>
      d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql))) !== emailTemplateBaseline) {
      fail("email_template_master_baseline_changed");
    }
    cleanupNeeded = false;
    process.stdout.write(`${JSON.stringify({
      worker: "fanmark-app-staging",
      syntheticOwner: true,
      api: "/api/fanmarks/access",
      authenticatedReaders: ["/api/me/analytics/fanmarks", "/api/me/analytics", "/api/me/analytics/summary"],
      analytics: { firstWriteRecorded: true, concurrentDuplicatesSuppressed: duplicatePayloads.length,
        dailyAccessCount: analytics.result.summary.accessCount, uniqueVisitors: analytics.result.summary.uniqueVisitors },
      renderedUi,
      unauthorizedReadStatus: anonymous.status,
      cleanup: cleanupProof,
      businessRowsAfterCleanup: totalRows,
    }, null, 2)}\n`);
  } finally {
    if (cleanupNeeded) await cleanup({ userId, email, fanmarkId, licenseId });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.code ?? "fanmark_analytics_smoke_failed"}\n`);
  process.exitCode = 1;
});

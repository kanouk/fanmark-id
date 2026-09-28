#!/usr/bin/env node

/**
 * Run a short-lived synthetic owner-settings/protected-access canary against
 * the isolated workers.dev staging app, then delete every row it creates.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const WORKER = "fanmark-app-staging";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const WRANGLER_VERSION = "4.139.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const VERIFY_RENDERED_BROWSER = process.argv.includes("--verify-rendered-browser");
const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = require("bcryptjs");

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(config, database, sql) {
  const result = runJson([
    "d1", "execute", database, "--remote", "--json", "--command", sql, "--config", config,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) {
    fail("staging_d1_command_failed");
  }
  return result;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length ||
      config.vars?.D1_TOPOLOGY !== "split" || config.vars?.AUTH_BACKEND !== "better-auth" ||
      config.vars?.PUBLIC_ACCESS_BACKEND !== "d1" || config.vars?.VERIFIED_ACCESS_BACKEND !== "d1") {
    fail("staging_worker_target_mismatch");
  }
  const business = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const auth = config.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  if (business?.database_id !== BUSINESS_DATABASE_ID || business.database_name !== BUSINESS_DATABASE ||
      auth?.database_id !== AUTH_DATABASE_ID || auth.database_name !== AUTH_DATABASE) {
    fail("staging_d1_config_mismatch");
  }

  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) {
    fail("cloudflare_account_mismatch");
  }
  const databases = runJson(["d1", "list", "--json"]);
  for (const [id, name] of [[BUSINESS_DATABASE_ID, BUSINESS_DATABASE], [AUTH_DATABASE_ID, AUTH_DATABASE]]) {
    if (!databases.some((database) =>
      (database.uuid ?? database.database_id ?? database.id) === id &&
      (database.name ?? database.database_name) === name)) fail("cloudflare_database_mismatch");
  }

  const businessMigration = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const sourceTables = [...businessMigration.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)]
    .map((match) => match[1]);
  if (sourceTables.length !== 40) fail("business_table_inventory_mismatch");
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
  const businessDataTables = businessTablesWithoutStagingBaselines(sourceTables, {
    verifiedEmailTemplateMasters: true,
    verifiedExtensionCouponMaster: extensionCouponBaseline === "seeded",
  });
  const rowTotalSql = `SELECT ${businessDataTables.map((name) => `(SELECT COUNT(*) FROM "${name}")`).join(" + ")} AS total_rows`;
  const totalRows = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, rowTotalSql))[0]?.total_rows);
  if (totalRows !== 0) fail("business_staging_has_rows");
  return { extensionCouponBaseline, emailTemplateBaseline };
}

function d1Rows(result) {
  const rows = result[0]?.results;
  if (!Array.isArray(rows)) fail("staging_d1_readback_failed");
  return rows;
}

function assertResponse(response, status, code) {
  if (response.status !== status) fail(`${code}_${response.status}`);
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: APP_ORIGIN,
      ...(init.headers ?? {}),
    },
  });
}

async function readJson(response, status, code) {
  assertResponse(response, status, code);
  return response.json();
}

function responseCookie(response, matcher) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pair = cookies.map((cookie) => cookie.split(";", 1)[0])
    .find((cookie) => matcher.test(cookie));
  if (!pair) fail("response_cookie_missing");
  return pair;
}

function cdpConnection(webSocketUrl, onEvent) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  let rejectOpen;
  const opened = new Promise((resolve, reject) => {
    rejectOpen = reject;
    const timeout = setTimeout(() => reject(new Error("browser_cdp_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
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
    if (typeof message.method === "string") {
      onEvent?.(message);
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

async function verifyRenderedProtectedAccess(shortId, expectedContent) {
  const chromeCandidates = [
    process.env.FANMARK_STAGING_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chromePath) fail("headless_chrome_unavailable");

  const profileDirectory = mkdtempSync(join(tmpdir(), "fanmark-protected-access-ui-"));
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
  const responses = [];

  try {
    const activePortPath = join(profileDirectory, "DevToolsActivePort");
    const startupDeadline = Date.now() + 15_000;
    let port;
    while (Date.now() < startupDeadline) {
      if (!chromeRunning()) fail("headless_chrome_exited");
      try {
        const [value] = readFileSync(activePortPath, "utf8").split(/\r?\n/u);
        if (/^\d+$/u.test(value ?? "")) {
          port = value;
          break;
        }
      } catch {
        // Chrome creates the DevTools endpoint after its temporary profile starts.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!port) fail("browser_devtools_start_timeout");

    const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
    if (!targetsResponse.ok) fail("browser_target_list_failed");
    const targets = await targetsResponse.json();
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!page) fail("browser_page_target_missing");

    cdp = cdpConnection(page.webSocketDebuggerUrl, (message) => {
      if (message.method !== "Network.responseReceived") return;
      const response = message.params?.response;
      if (!response?.url) return;
      const url = new URL(response.url);
      if (url.pathname.includes("/verify-password") || url.pathname.endsWith("/protected")) {
        responses.push({
          path: url.pathname,
          status: response.status,
          cacheControl: response.headers?.["cache-control"] ?? response.headers?.["Cache-Control"] ?? "",
        });
      }
    });
    await cdp.opened;
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await cdp.send("Page.navigate", { url: `${APP_ORIGIN}/a/${encodeURIComponent(shortId)}` });

    const readState = async () => {
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const otp = [...document.querySelectorAll('input')].find((input) => input.maxLength === 4);
          return {
            path: location.pathname,
            body: document.body?.innerText ?? '',
            otpValue: otp?.value ?? null,
            otpReady: Boolean(otp),
          };
        })()`,
        returnByValue: true,
      });
      if (result.exceptionDetails) fail("browser_state_read_failed");
      return result.result?.value ?? {};
    };
    const waitForState = async (predicate, failureCode, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      let state = {};
      while (Date.now() < deadline) {
        state = await readState();
        if (predicate(state)) return state;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      fail(failureCode);
    };
    const fillOtp = async (value) => {
      const focused = await cdp.send("Runtime.evaluate", {
        expression: `(() => { const input = [...document.querySelectorAll('input')].find((entry) => entry.maxLength === 4); input?.focus(); return Boolean(input); })()`,
        returnByValue: true,
      });
      if (focused.result?.value !== true) fail("browser_otp_input_missing");
      await cdp.send("Input.insertText", { text: value });
    };

    const locked = await waitForState((state) => state.path === `/a/${shortId}` && state.otpReady,
      "rendered_password_gate_timeout");
    if (locked.body.includes(expectedContent)) fail("protected_content_leaked_before_verification");

    await fillOtp("0000");
    await waitForState((state) => responses.some((entry) => entry.path.endsWith("/verify-password") && entry.status === 401) &&
      state.otpReady && state.otpValue === "" && !state.body.includes(expectedContent),
    "rendered_wrong_password_not_rejected");

    await fillOtp("2468");
    const unlocked = await waitForState((state) => state.body.includes(expectedContent) && !state.otpReady &&
      responses.some((entry) => entry.path.endsWith("/verify-password") && entry.status === 204) &&
      responses.some((entry) => entry.path.endsWith("/protected") && entry.status === 200),
    "rendered_protected_content_timeout");
    const protectedRead = responses.findLast((entry) => entry.path.endsWith("/protected") && entry.status === 200);
    if (!protectedRead?.cacheControl.toLowerCase().includes("no-store")) fail("protected_read_cache_policy_missing");

    const cookies = await cdp.send("Network.getCookies", { urls: [APP_ORIGIN] });
    const proofCookie = cookies.cookies?.find((cookie) => cookie.name === "__Host-fanmark_access");
    if (!proofCookie?.httpOnly || !proofCookie.secure || proofCookie.sameSite !== "Lax") {
      fail("protected_proof_cookie_policy_mismatch");
    }

    return {
      viewport: "390x844",
      wrongPasswordStatus: 401,
      successfulVerificationStatus: 204,
      protectedReadStatus: 200,
      protectedReadNoStore: true,
      proofCookieHttpOnlySecureSameSiteLax: true,
      lockedContentWithheld: true,
      protectedContentRendered: unlocked.body.includes(expectedContent),
    };
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

async function cleanup({ userId, fanmarkId, licenseId, shortId, extensionCouponBaseline, emailTemplateBaseline }) {
  const reservations = d1Rows(runD1(
    APP_CONFIG,
    BUSINESS_DATABASE,
    `SELECT requester_bucket_hash, resource_bucket_hash FROM fanmark_access_attempt_reservations WHERE license_id = ${sqlLiteral(licenseId)}`,
  ));
  const hashes = [...new Set(reservations.flatMap((row) => [row.requester_bucket_hash, row.resource_bucket_hash]))];
  if (hashes.length) {
    runD1(APP_CONFIG, BUSINESS_DATABASE,
      `DELETE FROM fanmark_access_rate_limits WHERE bucket_hash IN (${hashes.map(sqlLiteral).join(",")})`);
  }
  runD1(APP_CONFIG, BUSINESS_DATABASE, `
    DELETE FROM fanmark_access_proofs WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_access_attempt_audit WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_access_attempt_reservations WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_password_runtime_evidence WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_password_configs WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_profiles WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_redirect_configs WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_messageboard_configs WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_basic_configs WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_licenses WHERE id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmark_license_incarnations WHERE license_id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmarks WHERE id = ${sqlLiteral(fanmarkId)} AND short_id = ${sqlLiteral(shortId)};
  `);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `DELETE FROM "user" WHERE id = ${sqlLiteral(userId)};`);

  const businessCounts = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM fanmarks WHERE id = ${sqlLiteral(fanmarkId)}) AS fanmarks,
      (SELECT COUNT(*) FROM fanmark_licenses WHERE id = ${sqlLiteral(licenseId)}) AS licenses,
      (SELECT COUNT(*) FROM fanmark_license_incarnations WHERE license_id = ${sqlLiteral(licenseId)}) AS incarnations,
      (SELECT COUNT(*) FROM fanmark_password_runtime_evidence WHERE license_id = ${sqlLiteral(licenseId)}) AS runtime_evidence,
      (SELECT COUNT(*) FROM fanmark_access_proofs WHERE license_id = ${sqlLiteral(licenseId)}) AS proofs,
      (SELECT COUNT(*) FROM fanmark_access_attempt_reservations WHERE license_id = ${sqlLiteral(licenseId)}) AS reservations,
      (SELECT COUNT(*) FROM fanmark_access_attempt_audit WHERE license_id = ${sqlLiteral(licenseId)}) AS access_audit
  `));
  const authCounts = d1Rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM "user" WHERE id = ${sqlLiteral(userId)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sqlLiteral(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sqlLiteral(userId)}) AS sessions
  `));
  if (Object.values(businessCounts[0] ?? {}).some((count) => Number(count) !== 0) ||
      Object.values(authCounts[0] ?? {}).some((count) => Number(count) !== 0)) {
    fail("synthetic_canary_cleanup_failed");
  }
  if (readStagingExtensionCouponMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql))) !== extensionCouponBaseline) {
    fail("extension_coupon_master_baseline_changed");
  }
  if (readStagingEmailTemplateMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql))) !== emailTemplateBaseline) {
    fail("email_template_master_baseline_changed");
  }
  return { business: businessCounts[0], auth: authCounts[0] };
}

async function main() {
  const { extensionCouponBaseline, emailTemplateBaseline } = assertTarget();
  const userId = randomUUID();
  const fanmarkId = randomUUID();
  const licenseId = randomUUID();
  const now = new Date();
  const nowIso = now.toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const expiresIso = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    .toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const nonce = randomBytes(9).toString("hex");
  const email = `codex-staging-${nonce}@example.invalid`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const shortId = `c${randomBytes(12).toString("hex")}`;
  const syntheticFanmark = `synthetic-${nonce}`;
  const timestamp = sqlLiteral(nowIso);
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Codex staging smoke', ${sqlLiteral(email)}, 1, ${timestamp}, ${timestamp});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${timestamp}, ${timestamp});
    `);
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (${sqlLiteral(fanmarkId)}, ${sqlLiteral(syntheticFanmark)}, ${sqlLiteral(syntheticFanmark)}, ${sqlLiteral(shortId)}, 'active', ${timestamp}, ${timestamp}, '[]', '[]', 1);
      INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
      VALUES (${sqlLiteral(licenseId)}, ${sqlLiteral(fanmarkId)}, ${sqlLiteral(userId)}, ${timestamp}, ${sqlLiteral(expiresIso)}, 'active', 1, ${timestamp}, ${timestamp}, ${sqlLiteral(syntheticFanmark)});
    `);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await readJson(signIn, 200, "better_auth_sign_in_failed");
    const cookie = responseCookie(signIn, /session_token=/u);

    const settingsPath = `/api/me/fanmarks/${fanmarkId}/settings`;
    const unauthorized = await request(settingsPath);
    assertResponse(unauthorized, 401, "owner_settings_unauthenticated_gate_failed");

    const settingsBefore = await readJson(await request(settingsPath, {
      headers: { cookie },
    }), 200, "owner_settings_get_failed");
    assert.equal(settingsBefore.fanmark.id, fanmarkId);
    assert.equal(settingsBefore.fanmark.has_active_license, true);
    assert.equal(Object.hasOwn(settingsBefore.fanmark, "access_password"), false);

    const saved = await readJson(await request(settingsPath, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fanmarkName: "Codex staging smoke",
        accessType: "text",
        textContent: "Synthetic Cloudflare staging protected content.",
        isPasswordProtected: true,
        accessPassword: "2468",
        isPublic: false,
      }),
    }), 200, "owner_settings_patch_failed");
    assert.equal(saved.fanmark.is_password_protected, true);
    assert.equal(saved.fanmark.text_content, "Synthetic Cloudflare staging protected content.");
    assert.equal(Object.hasOwn(saved.fanmark, "access_password"), false);

    const verifyUrl = `/api/fanmarks/access/short/${encodeURIComponent(shortId)}/verify-password`;
    const publicProjection = await readJson(await request(
      `/api/fanmarks/access/short/${encodeURIComponent(shortId)}`,
    ), 200, "protected_public_projection_failed");
    assert.equal(publicProjection.accessState, "locked");
    assert.equal(publicProjection.textContent, null);
    assert.equal(publicProjection.targetUrl, null);
    let protectedAccess;
    if (VERIFY_RENDERED_BROWSER) {
      protectedAccess = await verifyRenderedProtectedAccess(shortId, "Synthetic Cloudflare staging protected content.");
    } else {
      const denied = await request(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "0000" }),
      });
      assertResponse(denied, 401, "protected_password_denial_failed");
      const verified = await request(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "2468" }),
      });
      assertResponse(verified, 204, "protected_password_verification_failed");
      const proofCookie = responseCookie(verified, /^__Host-fanmark_access=/u);
      const protectedResponse = await readJson(await request(
        `/api/fanmarks/access/short/${encodeURIComponent(shortId)}/protected`,
        { headers: { cookie: proofCookie } },
      ), 200, "protected_content_read_failed");
      assert.equal(protectedResponse.textContent, "Synthetic Cloudflare staging protected content.");
      protectedAccess = { wrongPasswordStatus: denied.status, verifyStatus: verified.status, protectedReadStatus: 200 };
    }

    const stored = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT pc.is_enabled, av.password_generation, av.access_generation,
             re.enabled AS evidence_enabled, re.password_generation AS evidence_generation,
             length(pc.access_password) AS hash_length
      FROM fanmark_password_configs AS pc
      JOIN fanmark_access_versions AS av ON av.license_id = pc.license_id
      JOIN fanmark_password_runtime_evidence AS re ON re.license_id = pc.license_id
      WHERE pc.license_id = ${sqlLiteral(licenseId)}
    `));
    assert.equal(stored.length, 1);
    assert.equal(Number(stored[0].is_enabled), 1);
    assert.equal(Number(stored[0].evidence_enabled), 1);
    assert.equal(Number(stored[0].password_generation), Number(stored[0].evidence_generation));
    assert.equal(Number(stored[0].hash_length) > 20, true);

    return {
      worker: WORKER,
      ownerSettings: { unauthenticatedStatus: unauthorized.status, getStatus: 200, patchStatus: 200 },
      protectedAccess: { ...protectedAccess, lockedPublicProjectionRedactsContent: true },
      passwordEvidence: "bcrypt hash stored; runtime evidence generation matched; no secret returned",
    };
  } finally {
    if (cleanupNeeded) {
      const cleanupState = await cleanup({ userId, fanmarkId, licenseId, shortId, extensionCouponBaseline, emailTemplateBaseline });
      process.stdout.write(`${JSON.stringify({ cleanup: cleanupState })}\n`);
    }
  }
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error?.code ?? "staging_owner_settings_smoke_failed"}\n`);
  process.exitCode = 1;
});

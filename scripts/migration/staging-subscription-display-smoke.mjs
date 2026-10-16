#!/usr/bin/env node

/** Verify authenticated subscription display against isolated Cloudflare staging using synthetic rows only. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const WORKER = "fanmark-app-staging";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const WRANGLER_VERSION = "4.139.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const VERIFY_RENDERED_POLL = process.argv.includes("--verify-rendered-poll");
const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = require("bcryptjs");
const EXPECTED_FIELDS = [
  "amount", "cancel_at_period_end", "currency", "current_period_end", "current_period_start",
  "interval", "interval_count", "next_payment_attempt", "payment_failure_at", "payment_failure_type",
  "product_id", "status",
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sql(value) {
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

function rows(result) {
  const values = result[0]?.results;
  if (!Array.isArray(values)) fail("staging_d1_readback_failed");
  return values;
}

function runD1(config, database, statement) {
  const result = runJson(["d1", "execute", database, "--remote", "--json", "--command", statement, "--config", config]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  return result;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length || config.custom_domains?.length ||
      config.vars?.D1_TOPOLOGY !== "split" || config.vars?.AUTH_BACKEND !== "better-auth" ||
      config.vars?.SUBSCRIPTION_BACKEND !== "d1") fail("staging_worker_target_mismatch");
  const expected = [
    ["FANMARK_DB", BUSINESS_DATABASE, BUSINESS_DATABASE_ID],
    ["AUTH_DB", AUTH_DATABASE, AUTH_DATABASE_ID],
  ];
  for (const [binding, name, id] of expected) {
    const actual = config.d1_databases?.find((entry) => entry.binding === binding);
    if (actual?.database_name !== name || actual.database_id !== id) fail("staging_d1_config_mismatch");
  }
  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const databases = runJson(["d1", "list", "--json"]);
  for (const [id, name] of [[BUSINESS_DATABASE_ID, BUSINESS_DATABASE], [AUTH_DATABASE_ID, AUTH_DATABASE]]) {
    if (!databases.some((database) =>
      (database.uuid ?? database.database_id ?? database.id) === id &&
      (database.name ?? database.database_name) === name)) fail("cloudflare_database_mismatch");
  }
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { Origin: APP_ORIGIN, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

async function readJson(response, status, code) {
  if (response.status !== status) fail(`${code}_${response.status}`);
  try {
    return await response.json();
  } catch {
    fail(`${code}_invalid_json`);
  }
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const cookie = values.map((value) => value.split(";", 1)[0]).find((value) => /session_token=/u.test(value));
  if (!cookie) fail("session_cookie_missing");
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

async function verifyRenderedSubscriptionPoll(cookie, updateSubscription) {
  const chromeCandidates = [
    process.env.FANMARK_STAGING_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chromePath) fail("headless_chrome_unavailable");

  const profileDirectory = mkdtempSync(join(tmpdir(), "fanmark-subscription-ui-"));
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
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const session = cookieParts(cookie);
    const cookieResult = await cdp.send("Network.setCookie", {
      ...session,
      url: APP_ORIGIN,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    });
    if (cookieResult.success !== true) fail("browser_session_cookie_rejected");
    await cdp.send("Page.navigate", { url: `${APP_ORIGIN}/profile` });

    const expectedLabels = ["en", "ja", "ko", "id"].map((language) => {
      const translations = JSON.parse(readFileSync(`src/translations/${language}.json`, "utf8"));
      return {
        title: translations.userSettings.subscriptionTitle,
        navPlan: translations.userSettings.navPlan,
        active: translations.userSettings.subscriptionActive,
        inactive: translations.userSettings.subscription.inactive,
        noActive: translations.userSettings.subscription.noActive,
      };
    });
    const stateExpression = `(() => {
      const labels = ${JSON.stringify(expectedLabels)};
      const title = Array.from(document.querySelectorAll('h3')).find((element) =>
        labels.some((entry) => element.textContent?.trim() === entry.title));
      if (!title) {
        const planButton = Array.from(document.querySelectorAll('button')).find((element) =>
          labels.some((entry) => entry.navPlan && element.innerText?.includes(entry.navPlan)));
        planButton?.click();
      }
      const activeTitle = Array.from(document.querySelectorAll('h3')).find((element) =>
        labels.some((entry) => element.textContent?.trim() === entry.title));
      const card = activeTitle?.closest('.card');
      return { path: location.pathname, cardText: card?.innerText ?? '', bodyText: document.body?.innerText ?? '' };
    })()`;
    const readCard = async () => {
      const result = await cdp.send("Runtime.evaluate", { expression: stateExpression, returnByValue: true });
      return result.result?.value ?? {};
    };
    const waitForState = async (predicate, timeoutMs, failureCode) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const state = await readCard();
        if (state.path === "/profile" && predicate(state.cardText, expectedLabels)) return state;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      fail(failureCode);
    };

    await waitForState((text, labels) => labels.some((entry) => entry.active && text.includes(entry.active)), 25_000,
      "rendered_subscription_active_timeout");
    const updateStartedAt = Date.now();
    await updateSubscription();
    await waitForState((text, labels) => labels.some((entry) =>
      entry.inactive && entry.noActive && text.includes(entry.inactive) && text.includes(entry.noActive)), 45_000,
    "rendered_subscription_poll_timeout");
    return Date.now() - updateStartedAt;
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

function assertProjection(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...EXPECTED_FIELDS].sort());
  assert.deepEqual(value, expected);
  assert.equal(Object.hasOwn(value, "stripe_customer_id"), false);
  assert.equal(Object.hasOwn(value, "stripe_subscription_id"), false);
  assert.equal(Object.hasOwn(value, "price_id"), false);
}

async function cleanup({ userId, userEmail, subscriptionIds }) {
  runD1(APP_CONFIG, BUSINESS_DATABASE, `
    DELETE FROM user_subscriptions
    WHERE id IN (${subscriptionIds.map(sql).join(", ")}) AND user_id IN (${sql(userId)}, ${sql(`decoy-${userId}`)});
    DELETE FROM user_settings WHERE user_id = ${sql(userId)};
  `);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sql(userId)};
    DELETE FROM verification WHERE identifier = ${sql(userEmail)};
    DELETE FROM account WHERE userId = ${sql(userId)};
    DELETE FROM twoFactor WHERE userId = ${sql(userId)};
    DELETE FROM mfaAssurance WHERE userId = ${sql(userId)};
    DELETE FROM adminRole WHERE userId = ${sql(userId)};
    DELETE FROM user WHERE id = ${sql(userId)} AND email = ${sql(userEmail)};
  `);
  const businessCounts = rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM user_subscriptions
       WHERE id IN (${subscriptionIds.map(sql).join(", ")})
          OR user_id IN (${sql(userId)}, ${sql(`decoy-${userId}`)})) AS subscriptions,
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ${sql(userId)}) AS profiles;
  `));
  const authCounts = rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM user WHERE id = ${sql(userId)} OR email = ${sql(userEmail)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sql(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sql(userId)}) AS sessions,
      (SELECT COUNT(*) FROM verification WHERE identifier = ${sql(userEmail)}) AS verifications,
      (SELECT COUNT(*) FROM twoFactor WHERE userId = ${sql(userId)}) AS factors,
      (SELECT COUNT(*) FROM adminRole WHERE userId = ${sql(userId)}) AS admin_roles,
      (SELECT COUNT(*) FROM mfaAssurance WHERE userId = ${sql(userId)}) AS assurances;
  `));
  if (Object.values(businessCounts[0] ?? {}).some((count) => Number(count) !== 0) ||
      Object.values(authCounts[0] ?? {}).some((count) => Number(count) !== 0)) {
    fail("synthetic_cleanup_incomplete");
  }
}

async function main() {
  assertTarget();
  const userId = randomUUID();
  const userEmail = `codex-subscription-${randomBytes(12).toString("hex")}@example.invalid`;
  const userPassword = `Synthetic-${randomBytes(24).toString("base64url")}a9!`;
  const mainSubscriptionId = randomUUID();
  const decoySubscriptionId = randomUUID();
  const profileId = randomUUID();
  const username = `codex-subscription-${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const initialPeriodEnd = "2030-09-28T00:00:00.000000Z";
  const updatedPeriodEnd = "2030-10-28T00:00:00.000000Z";
  const cleanupIdentity = `${userId}`;
  let cleanupNeeded = false;
  let renderedPollMs = null;
  let primaryFailure = null;

  try {
    const collision = rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
      SELECT COUNT(*) AS count FROM user WHERE id = ${sql(userId)} OR email = ${sql(userEmail)};
    `));
    if (Number(collision[0]?.count) !== 0) fail("synthetic_auth_identity_collision");
    const subscriptionCollision = rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT COUNT(*) AS count FROM user_subscriptions WHERE id IN (${sql(mainSubscriptionId)}, ${sql(decoySubscriptionId)});
    `));
    if (Number(subscriptionCollision[0]?.count) !== 0) fail("synthetic_subscription_identity_collision");
    const profileCollision = rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT COUNT(*) AS count FROM user_settings WHERE id = ${sql(profileId)} OR user_id = ${sql(userId)} OR username = ${sql(username)};
    `));
    if (Number(profileCollision[0]?.count) !== 0) fail("synthetic_profile_identity_collision");

    cleanupNeeded = true;
    const passwordHash = await bcrypt.hash(userPassword, 10);
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sql(userId)}, 'Synthetic subscription display', ${sql(userEmail)}, 1, ${sql(now)}, ${sql(now)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sql(randomUUID())}, ${sql(userId)}, 'credential', ${sql(userId)}, ${sql(passwordHash)}, ${sql(now)}, ${sql(now)});
    `);
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_settings
        (id, user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at, requires_password_setup)
      VALUES (${sql(profileId)}, ${sql(userId)}, ${sql(username)}, 'Synthetic subscription display', NULL, 'free', 'ja', ${sql(now)}, ${sql(now)}, 0);
    `);

    const anonymous = await request("/api/me/subscription");
    await readJson(anonymous, 401, "subscription_auth_gate_failed");

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: userPassword }),
    });
    await readJson(signIn, 200, "better_auth_sign_in_failed");
    const cookie = sessionCookie(signIn);

    const emptyResponse = await request("/api/me/subscription", { headers: { cookie } });
    const emptyBody = await readJson(emptyResponse, 200, "subscription_empty_read_failed");
    assert.deepEqual(emptyBody, { schemaVersion: 1, subscription: null });
    assert.equal(emptyResponse.headers.get("cache-control"), "no-store");

    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_subscriptions
        (id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
         current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at,
         price_id, amount, currency, interval, interval_count)
      VALUES
        (${sql(mainSubscriptionId)}, ${sql(userId)}, 'cus_synthetic_hidden', 'sub_synthetic_hidden',
         'prod_synthetic_subscription', 'active', '2030-08-28T00:00:00.000000Z', ${sql(initialPeriodEnd)},
         1, ${sql(now)}, ${sql(now)}, 'price_synthetic_hidden', 1234, 'jpy', 'month', 1),
        (${sql(decoySubscriptionId)}, ${sql(`decoy-${userId}`)}, 'cus_decoy_hidden', 'sub_decoy_hidden',
         'prod_decoy_subscription', 'canceled', '2030-08-28T00:00:00.000000Z', '2030-09-01T00:00:00.000000Z',
         0, ${sql(now)}, ${sql(now)}, 'price_decoy_hidden', 9999, 'jpy', 'month', 1);
    `);

    const first = await request("/api/me/subscription", { headers: { cookie } });
    const firstBody = await readJson(first, 200, "subscription_authenticated_read_failed");
    assert.equal(first.headers.get("cache-control"), "no-store");
    assertProjection(firstBody.subscription, {
      status: "active",
      product_id: "prod_synthetic_subscription",
      current_period_start: "2030-08-28T00:00:00.000000Z",
      current_period_end: initialPeriodEnd,
      amount: 1234,
      currency: "jpy",
      interval: "month",
      interval_count: 1,
      cancel_at_period_end: true,
      payment_failure_at: null,
      next_payment_attempt: null,
      payment_failure_type: null,
    });

    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      UPDATE user_subscriptions
      SET current_period_end = ${sql(updatedPeriodEnd)}, amount = 2345, updated_at = ${sql(new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z"))}
      WHERE id = ${sql(mainSubscriptionId)} AND user_id = ${sql(userId)};
    `);
    const refreshed = await request("/api/me/subscription", { headers: { cookie } });
    const refreshedBody = await readJson(refreshed, 200, "subscription_refetch_failed");
    assertProjection(refreshedBody.subscription, {
      status: "active",
      product_id: "prod_synthetic_subscription",
      current_period_start: "2030-08-28T00:00:00.000000Z",
      current_period_end: updatedPeriodEnd,
      amount: 2345,
      currency: "jpy",
      interval: "month",
      interval_count: 1,
      cancel_at_period_end: true,
      payment_failure_at: null,
      next_payment_attempt: null,
      payment_failure_type: null,
    });

    if (VERIFY_RENDERED_POLL) {
      renderedPollMs = await verifyRenderedSubscriptionPoll(cookie, async () => {
        runD1(APP_CONFIG, BUSINESS_DATABASE, `
          UPDATE user_subscriptions
          SET status = 'canceled', updated_at = ${sql(new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z"))}
          WHERE id = ${sql(mainSubscriptionId)} AND user_id = ${sql(userId)};
        `);
      });
      const canceledResponse = await request("/api/me/subscription", { headers: { cookie } });
      const canceledBody = await readJson(canceledResponse, 200, "subscription_canceled_read_failed");
      assert.equal(canceledBody.subscription.status, "canceled");
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    if (cleanupNeeded) {
      try {
        await cleanup({
          userId,
          userEmail,
          subscriptionIds: [mainSubscriptionId, decoySubscriptionId],
        });
      } catch (error) {
        const code = error?.code ?? "synthetic_cleanup_failed";
        if (primaryFailure) {
          primaryFailure.cleanupFailure = code;
        } else {
          const cleanupError = new Error(code);
          cleanupError.cleanupIdentity = cleanupIdentity;
          throw cleanupError;
        }
      }
    }
  }

  process.stdout.write(
    "PASS staging subscription display: anonymous 401; synthetic Better Auth sign-in; empty baseline; owner-only D1 projection; no Stripe IDs; fresh read after D1 update; cleanup readback zero.\n" +
    (VERIFY_RENDERED_POLL
      ? `PASS rendered profile subscription status changed to inactive after the 30-second foreground poll (${renderedPollMs} ms).\n`
      : "") +
    "No Stripe API, real user data, production resource, or domain/DNS setting was used.\n",
  );
}

main().catch((error) => {
  const code = error instanceof Error && /^[a-z0-9_.-]{1,100}$/iu.test(error.code ?? error.message)
    ? (error.code ?? error.message)
    : "staging_subscription_display_smoke_failed";
  const details = error?.cleanupFailure ? ` cleanup=${error.cleanupFailure}` : "";
  const cleanupIdentity = error?.cleanupIdentity ? ` cleanupIdentity=${error.cleanupIdentity}` : "";
  process.stderr.write(`FAIL ${code}${details}${cleanupIdentity}\n`);
  process.exitCode = 1;
});

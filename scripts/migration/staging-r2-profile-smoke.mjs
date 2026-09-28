#!/usr/bin/env node

/** Verify the Better Auth profile and both R2 image buckets on isolated workers.dev staging. */

import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
const bcrypt = require("bcryptjs");

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const WORKER = "fanmark-app-staging";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const AVATAR_BUCKET = "fanmark-avatars-staging";
const COVER_BUCKET = "fanmark-cover-images-staging";
const WRANGLER_VERSION = "4.140.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";

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

function d1Rows(result) {
  const rows = result[0]?.results;
  if (!Array.isArray(rows)) fail("staging_d1_readback_failed");
  return rows;
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
      config.vars?.PROFILE_BACKEND !== "d1" || config.vars?.STORAGE_BACKEND !== "r2") {
    fail("staging_worker_target_mismatch");
  }
  const business = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const auth = config.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  const avatar = config.r2_buckets?.find((entry) => entry.binding === "AVATARS_BUCKET");
  const cover = config.r2_buckets?.find((entry) => entry.binding === "COVER_IMAGES_BUCKET");
  if (business?.database_id !== BUSINESS_DATABASE_ID || business.database_name !== BUSINESS_DATABASE ||
      auth?.database_id !== AUTH_DATABASE_ID || auth.database_name !== AUTH_DATABASE ||
      avatar?.bucket_name !== AVATAR_BUCKET || cover?.bucket_name !== COVER_BUCKET) fail("staging_binding_mismatch");

  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const databases = runJson(["d1", "list", "--json"]);
  for (const [id, name] of [[BUSINESS_DATABASE_ID, BUSINESS_DATABASE], [AUTH_DATABASE_ID, AUTH_DATABASE]]) {
    if (!databases.some((databaseEntry) =>
      (databaseEntry.uuid ?? databaseEntry.database_id ?? databaseEntry.id) === id &&
      (databaseEntry.name ?? databaseEntry.database_name) === name)) fail("cloudflare_database_mismatch");
  }
  const buckets = runWrangler(["r2", "bucket", "list"]).stdout;
  if (!buckets.includes(AVATAR_BUCKET) || !buckets.includes(COVER_BUCKET)) fail("cloudflare_image_bucket_missing");

  const migration = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const sourceTables = [...migration.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)]
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
  if (Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, rowTotalSql))[0]?.total_rows) !== 0) {
    fail("business_staging_has_source_rows");
  }
  return { extensionCouponBaseline, emailTemplateBaseline };
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { Origin: APP_ORIGIN, ...(init.headers ?? {}) },
  });
}

function responseCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pair = cookies.map((cookie) => cookie.split(";", 1)[0])
    .find((cookie) => /session_token=/u.test(cookie));
  if (!pair) fail("response_cookie_missing");
  return pair;
}

function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  let openTimeout;
  const opened = new Promise((resolve, reject) => {
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

async function verifyRenderedProfileAvatar(cookie, pngBytes, onUploaded) {
  const chromeCandidates = [
    process.env.FANMARK_STAGING_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chromePath) fail("headless_chrome_unavailable");

  const profileDirectory = mkdtempSync(join(tmpdir(), "fanmark-r2-profile-ui-"));
  const imagePath = join(profileDirectory, "synthetic-avatar.png");
  writeFileSync(imagePath, pngBytes, { mode: 0o600, flag: "wx" });
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
  const captureCurrentAvatar = async () => {
    const response = await request("/api/me/profile", { headers: { cookie } });
    if (response.status !== 200) return;
    const profile = (await response.json())?.profile;
    if (typeof profile?.avatar_url === "string") await onUploaded(profile.avatar_url);
  };

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
    await cdp.send("DOM.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    const cookieResult = await cdp.send("Network.setCookie", {
      ...cookieParts(cookie), url: APP_ORIGIN, path: "/", secure: true, httpOnly: true, sameSite: "Lax",
    });
    if (cookieResult.success !== true) fail("browser_session_cookie_rejected");
    await cdp.send("Page.navigate", { url: `${APP_ORIGIN}/profile` });

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) fail("profile_browser_evaluation_failed");
      return result.result?.value;
    };
    const pageDeadline = Date.now() + 30_000;
    let pageState;
    while (Date.now() < pageDeadline) {
      if (!chromeRunning()) fail("headless_chrome_exited");
      pageState = await evaluate(`({ path: location.pathname, profileInput: Boolean(document.querySelector('#display_name')), fileInput: Boolean(document.querySelector('input[type="file"][accept="image/*"]')) })`);
      if (pageState?.path === "/profile" && pageState.profileInput && pageState.fileInput) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (pageState?.path !== "/profile" || !pageState.profileInput || !pageState.fileInput) fail("profile_screen_not_ready");

    const documentRoot = await cdp.send("DOM.getDocument", { depth: -1 });
    const fileInput = await cdp.send("DOM.querySelector", {
      nodeId: documentRoot.root.nodeId,
      selector: 'input[type="file"][accept="image/*"]',
    });
    if (!fileInput.nodeId) fail("profile_avatar_input_missing");
    await cdp.send("DOM.setFileInputFiles", { files: [imagePath], nodeId: fileInput.nodeId });

    let avatarState;
    const uploadDeadline = Date.now() + 45_000;
    while (Date.now() < uploadDeadline) {
      if (!chromeRunning()) fail("headless_chrome_exited");
      avatarState = await evaluate(`(() => {
        const image = document.querySelector('img[alt="Avatar"]');
        return {
          path: location.pathname,
          src: image?.src ?? null,
          complete: image?.complete ?? false,
          naturalWidth: image?.naturalWidth ?? 0,
          naturalHeight: image?.naturalHeight ?? 0,
          resources: performance.getEntriesByType('resource').map((item) => item.name)
            .filter((name) => name.includes('/api/storage/object/avatars') ||
              name.includes('/api/storage/public/avatars/') || name.includes('/api/me/profile')),
        };
      })()`);
      if (avatarState?.src) await onUploaded(avatarState.src);
      if (avatarState?.path === "/profile" && avatarState.src && avatarState.complete &&
          avatarState.naturalWidth === 1 && avatarState.naturalHeight === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!avatarState?.src || !avatarState.complete ||
        avatarState.naturalWidth !== 1 || avatarState.naturalHeight !== 1) {
      fail(`profile_avatar_not_rendered_src_${avatarState?.src ? 1 : 0}_complete_${avatarState?.complete ? 1 : 0}_dimensions_${avatarState?.naturalWidth ?? 0}x${avatarState?.naturalHeight ?? 0}`);
    }
    const resources = avatarState.resources ?? [];
    const workerUploadRequestObserved = resources.some((name) => name.includes("/api/storage/object/avatars"));
    const workerPublicReadObserved = resources.some((name) => name.includes("/api/storage/public/avatars/"));
    const workerProfileRequestObserved = resources.some((name) => name.includes("/api/me/profile"));
    if (!workerUploadRequestObserved || !workerPublicReadObserved || !workerProfileRequestObserved) {
      fail(`profile_avatar_worker_requests_incomplete_${workerUploadRequestObserved ? 1 : 0}${workerPublicReadObserved ? 1 : 0}${workerProfileRequestObserved ? 1 : 0}`);
    }

    const removeLabel = JSON.parse(readFileSync("src/translations/ja.json", "utf8")).userSettings.removeAvatar;
    const removed = await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((item) => item.textContent?.trim() === ${JSON.stringify(removeLabel)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (removed !== true) fail("profile_avatar_remove_button_missing");

    const removalDeadline = Date.now() + 30_000;
    let removedState;
    while (Date.now() < removalDeadline) {
      removedState = await evaluate(`({ imagePresent: Boolean(document.querySelector('img[alt="Avatar"]')) })`);
      if (!removedState?.imagePresent) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (removedState?.imagePresent) fail("profile_avatar_ui_delete_failed");
    const profileReadback = await request("/api/me/profile", { headers: { cookie } });
    assertStatus(profileReadback, 200, "profile_avatar_ui_readback_failed");
    if ((await profileReadback.json())?.profile?.avatar_url !== null) fail("profile_avatar_ui_not_cleared");
    const publicReadback = await request(new URL(avatarState.src).pathname);
    assertStatus(publicReadback, 404, "profile_avatar_ui_r2_cleanup_failed");

    return {
      path: "/profile",
      viewport: "390x844",
      avatarRendered: true,
      naturalWidth: avatarState.naturalWidth,
      naturalHeight: avatarState.naturalHeight,
      workerUploadRequestObserved,
      workerPublicReadObserved,
      workerProfileRequestObserved,
      removedThroughProfileUI: true,
      objectReturned404: true,
    };
  } catch (error) {
    try {
      await captureCurrentAvatar();
    } catch {
      // Preserve the original browser failure; outer cleanup still removes the captured object when available.
    }
    throw error;
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

function assertStatus(response, status, code) {
  if (response.status !== status) fail(`${code}_${response.status}`);
}

async function cleanup({ userId, email, cookie, objectPath, publicUrl, uiAvatarObjectPath, uiAvatarPublicUrl, coverObjectPath, coverPublicUrl, extensionCouponBaseline, emailTemplateBaseline }) {
  const cleanupErrors = [];
  const objects = [
    ["avatars", objectPath, "avatars_owner_delete_failed"],
    ["avatars", uiAvatarObjectPath, "ui_avatars_owner_delete_failed"],
    ["cover-images", coverObjectPath, "cover_images_owner_delete_failed"],
  ];
  for (const [bucket, key, errorCode] of objects) {
    if (!key || !cookie) continue;
    try {
      const deleted = await request(`/api/storage/object/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "DELETE",
        headers: { cookie },
      });
      if (deleted.status !== 204 && deleted.status !== 404) cleanupErrors.push(errorCode);
    } catch {
      cleanupErrors.push(errorCode);
    }
  }
  for (const [bucketName, key, errorCode] of [
    [AVATAR_BUCKET, objectPath, "avatars_owner_delete_failed"],
    [AVATAR_BUCKET, uiAvatarObjectPath, "ui_avatars_owner_delete_failed"],
    [COVER_BUCKET, coverObjectPath, "cover_images_owner_delete_failed"],
  ]) {
    if (!key || !cleanupErrors.includes(errorCode)) continue;
    try {
      runWrangler(["r2", "object", "delete", `${bucketName}/${key}`, "--remote", "--config", APP_CONFIG, "--force"]);
      cleanupErrors.splice(cleanupErrors.indexOf(errorCode), 1);
    } catch {
      // The exact synthetic key is retained in the final failure code only.
    }
  }

  runD1(APP_CONFIG, BUSINESS_DATABASE, `DELETE FROM user_settings WHERE user_id = ${sqlLiteral(userId)};`);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM account WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM "user" WHERE id = ${sqlLiteral(userId)} AND email = ${sqlLiteral(email)};
  `);

  const business = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ${sqlLiteral(userId)}) AS profiles
  `))[0];
  const auth = d1Rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM "user" WHERE id = ${sqlLiteral(userId)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sqlLiteral(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sqlLiteral(userId)}) AS sessions
  `))[0];
  if ([...Object.values(business), ...Object.values(auth)].some((count) => Number(count) !== 0)) {
    cleanupErrors.push("d1_canary_cleanup_failed");
  }
  if (readStagingExtensionCouponMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql))) !== extensionCouponBaseline) {
    cleanupErrors.push("extension_coupon_master_baseline_changed");
  }
  if (readStagingEmailTemplateMasterBaseline((sql) =>
    d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, sql))) !== emailTemplateBaseline) {
    cleanupErrors.push("email_template_master_baseline_changed");
  }
  for (const [bucket, url] of [
    ["avatars", publicUrl],
    ["avatars", uiAvatarPublicUrl],
    ["cover-images", coverPublicUrl],
  ]) {
    if (!url) continue;
    try {
      const missing = await request(new URL(url).pathname);
      if (missing.status !== 404) cleanupErrors.push(`${bucket.replaceAll("-", "_")}_r2_cleanup_failed`);
    } catch {
      cleanupErrors.push(`${bucket.replaceAll("-", "_")}_r2_readback_failed`);
    }
  }
  if (cleanupErrors.length) fail(cleanupErrors.join("+"));
  return {
    business,
    auth,
    r2Objects: {
      avatars: publicUrl ? "404 after cleanup" : "no object created",
      uiAvatar: uiAvatarPublicUrl ? "404 after cleanup" : "no object created",
      coverImages: coverPublicUrl ? "404 after cleanup" : "no object created",
    },
  };
}

async function main() {
  const { extensionCouponBaseline, emailTemplateBaseline } = assertTarget();
  const userId = randomUUID();
  const profileId = randomUUID();
  const nonce = randomBytes(10).toString("hex");
  const email = `codex-r2-profile-${nonce}@example.invalid`;
  const username = `codexr2${nonce}`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const pngBytes = Uint8Array.from(
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"),
  );
  let cookie;
  let objectPath;
  let publicUrl;
  let uiAvatarObjectPath;
  let uiAvatarPublicUrl;
  let coverObjectPath;
  let coverPublicUrl;
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Synthetic R2 profile smoke', ${sqlLiteral(email)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(now)}, ${sqlLiteral(now)});
    `);
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_settings (id, user_id, username, display_name, avatar_url, plan_type, preferred_language, created_at, updated_at, requires_password_setup)
      VALUES (${sqlLiteral(profileId)}, ${sqlLiteral(userId)}, ${sqlLiteral(username)}, 'Synthetic R2 profile', NULL, 'free', 'ja', ${sqlLiteral(now)}, ${sqlLiteral(now)}, 0);
    `);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assertStatus(signIn, 200, "better_auth_sign_in_failed");
    cookie = responseCookie(signIn);

    const anonymousProfile = await request("/api/me/profile");
    assertStatus(anonymousProfile, 401, "profile_auth_guard_failed");
    const anonymousUsernameCheck = await request(`/api/me/username-availability?username=${encodeURIComponent(username)}`);
    assertStatus(anonymousUsernameCheck, 401, "username_availability_auth_guard_failed");
    const before = await request("/api/me/profile", { headers: { cookie } });
    assertStatus(before, 200, "profile_get_failed");
    const initial = await before.json();
    assert.equal(initial.profile.user_id, userId);
    assert.equal(initial.profile.avatar_url, null);

    const ownUsernameCheck = await request(`/api/me/username-availability?username=${encodeURIComponent(username)}`, { headers: { cookie } });
    assertStatus(ownUsernameCheck, 200, "username_availability_own_check_failed");
    assert.deepEqual(await ownUsernameCheck.json(), { schemaVersion: 1, available: true });
    const newUsernameCheck = await request(`/api/me/username-availability?username=${encodeURIComponent(`candidate${nonce}`)}`, { headers: { cookie } });
    assertStatus(newUsernameCheck, 200, "username_availability_candidate_check_failed");
    assert.deepEqual(await newUsernameCheck.json(), { schemaVersion: 1, available: true });
    const suppliedOwnerCheck = await request(`/api/me/username-availability?username=${encodeURIComponent(username)}&userId=${encodeURIComponent(userId)}`, { headers: { cookie } });
    assertStatus(suppliedOwnerCheck, 400, "username_availability_supplied_owner_rejected");

    const unauthenticatedUpload = await request("/api/storage/object/avatars", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(unauthenticatedUpload, 401, "storage_auth_guard_failed");

    const renderedAvatar = await verifyRenderedProfileAvatar(cookie, pngBytes, async (value) => {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        fail("profile_avatar_ui_url_invalid");
      }
      const prefix = "/api/storage/public/avatars/";
      if (parsed.origin !== APP_ORIGIN || !parsed.pathname.startsWith(prefix)) fail("profile_avatar_ui_url_invalid");
      const key = decodeURIComponent(parsed.pathname.slice(prefix.length));
      if (!key.startsWith(`${userId}/`) || key.includes("..")) fail("profile_avatar_ui_owner_path_invalid");
      if (uiAvatarObjectPath && (uiAvatarObjectPath !== key || uiAvatarPublicUrl !== parsed.href)) {
        fail("profile_avatar_ui_url_changed");
      }
      uiAvatarObjectPath = key;
      uiAvatarPublicUrl = parsed.href;
    });

    const uploaded = await request("/api/storage/object/avatars", {
      method: "POST",
      headers: { cookie, "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(uploaded, 201, "r2_upload_failed");
    const uploadResult = await uploaded.json();
    objectPath = uploadResult.path;
    publicUrl = uploadResult.publicUrl;
    assert.match(objectPath, new RegExp(`^${userId}/[0-9a-f-]+\\.png$`, "iu"));
    assert.equal(new URL(publicUrl).origin, APP_ORIGIN);

    const publicRead = await request(new URL(publicUrl).pathname);
    assertStatus(publicRead, 200, "r2_public_read_failed");
    assert.equal(publicRead.headers.get("x-content-type-options"), "nosniff");
    const readBytes = new Uint8Array(await publicRead.arrayBuffer());
    assert.deepEqual(readBytes, pngBytes);
    const contentSHA256 = createHash("sha256").update(readBytes).digest("hex");

    const coverUploaded = await request("/api/storage/object/cover-images", {
      method: "POST",
      headers: { cookie, "content-type": "image/png" },
      body: pngBytes,
    });
    assertStatus(coverUploaded, 201, "r2_cover_upload_failed");
    const coverResult = await coverUploaded.json();
    coverObjectPath = coverResult.path;
    coverPublicUrl = coverResult.publicUrl;
    assert.match(coverObjectPath, new RegExp(`^${userId}/[0-9a-f-]+\\.png$`, "iu"));
    assert.equal(new URL(coverPublicUrl).origin, APP_ORIGIN);
    const coverPublicRead = await request(new URL(coverPublicUrl).pathname);
    assertStatus(coverPublicRead, 200, "r2_cover_public_read_failed");
    const coverReadBytes = new Uint8Array(await coverPublicRead.arrayBuffer());
    assert.deepEqual(coverReadBytes, pngBytes);
    const coverSHA256 = createHash("sha256").update(coverReadBytes).digest("hex");

    const saved = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: publicUrl }),
    });
    assertStatus(saved, 200, "profile_avatar_save_failed");
    assert.equal((await saved.json()).profile.avatar_url, publicUrl);
    const profileReadback = await request("/api/me/profile", { headers: { cookie } });
    assertStatus(profileReadback, 200, "profile_avatar_readback_failed");
    assert.equal((await profileReadback.json()).profile.avatar_url, publicUrl);

    const otherOwnerUrl = `${APP_ORIGIN}/api/storage/public/avatars/${randomUUID()}/${objectPath.split("/")[1]}`;
    const deniedProfilePatch = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: otherOwnerUrl }),
    });
    assertStatus(deniedProfilePatch, 400, "profile_other_owner_guard_failed");
    const ownerDelete = await request(`/api/storage/object/avatars/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(ownerDelete, 204, "profile_owner_delete_failed");
    objectPath = undefined;
    const coverOwnerDelete = await request(`/api/storage/object/cover-images/${coverObjectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assertStatus(coverOwnerDelete, 204, "cover_owner_delete_failed");
    coverObjectPath = undefined;

    const cleared = await request("/api/me/profile", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ avatar_url: null }),
    });
    assertStatus(cleared, 200, "profile_avatar_clear_failed");
    assert.equal((await cleared.json()).profile.avatar_url, null);
    const stored = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT avatar_url FROM user_settings WHERE user_id = ${sqlLiteral(userId)}
    `));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].avatar_url, null);

    const cleaned = await cleanup({ userId, email, cookie, objectPath, publicUrl, uiAvatarObjectPath, uiAvatarPublicUrl, coverObjectPath, coverPublicUrl, extensionCouponBaseline, emailTemplateBaseline });
    cleanupNeeded = false;
    return {
      worker: WORKER,
      profile: {
        anonymousStatus: 401,
        authenticatedRead: 200,
        usernameAvailability: { anonymousStatus: 401, own: true, availableCandidate: true, suppliedOwnerStatus: 400 },
        avatarSave: 200,
        crossOwnerUrlStatus: 400,
        cleared: true,
        renderedAvatar,
      },
      storage: {
        anonymousUploadStatus: 401,
        avatars: { ownerUpload: 201, publicRead: 200, ownerDelete: ownerDelete.status, sha256: contentSHA256 },
        coverImages: { ownerUpload: 201, publicRead: 200, ownerDelete: coverOwnerDelete.status, sha256: coverSHA256 },
      },
      cleanup: cleaned,
    };
  } finally {
    if (cleanupNeeded) {
      const cleaned = await cleanup({ userId, email, cookie, objectPath, publicUrl, uiAvatarObjectPath, uiAvatarPublicUrl, coverObjectPath, coverPublicUrl, extensionCouponBaseline, emailTemplateBaseline });
      process.stdout.write(`${JSON.stringify({ cleanup: cleaned })}\n`);
    }
  }
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error?.code ?? "staging_r2_profile_smoke_failed"}\n`);
  process.exitCode = 1;
});

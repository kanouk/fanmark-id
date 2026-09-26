#!/usr/bin/env node

/**
 * Run a short-lived synthetic owner-settings/protected-access canary against
 * the isolated workers.dev staging app, then delete every row it creates.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

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
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length) {
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
  const businessDataTables = businessTablesWithoutStagingBaselines(sourceTables);
  const rowTotalSql = `SELECT ${businessDataTables.map((name) => `(SELECT COUNT(*) FROM "${name}")`).join(" + ")} AS total_rows`;
  const totalRows = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, rowTotalSql))[0]?.total_rows);
  if (totalRows !== 0) fail("business_staging_has_rows");
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

async function cleanup({ userId, fanmarkId, licenseId, shortId }) {
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
  return { business: businessCounts[0], auth: authCounts[0] };
}

async function main() {
  assertTarget();
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
      protectedAccess: { wrongPasswordStatus: denied.status, verifyStatus: verified.status, protectedReadStatus: 200 },
      passwordEvidence: "bcrypt hash stored; runtime evidence generation matched; no secret returned",
    };
  } finally {
    if (cleanupNeeded) {
      const cleanupState = await cleanup({ userId, fanmarkId, licenseId, shortId });
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

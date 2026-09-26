#!/usr/bin/env node

/** Exercise a synthetic single-fanmark return against Cloudflare staging and remove every row. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
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
const WORKER = "fanmark-app-staging";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const WRANGLER_VERSION = "4.140.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";

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
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length ||
      config.vars?.FANMARK_RETURN_BACKEND !== "d1") fail("staging_worker_target_mismatch");
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
  const count = businessTablesWithoutStagingBaselines(tables)
    .map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
  if (Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `SELECT ${count} AS total_rows`))[0]?.total_rows) !== 0) {
    fail("business_staging_has_rows");
  }
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

function responseCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pair = cookies.map((cookie) => cookie.split(";", 1)[0]).find((cookie) => /session_token=/u.test(cookie));
  if (!pair) fail("response_cookie_missing");
  return pair;
}

function expectedGraceExpiry(endedAt, days) {
  const base = new Date(new Date(endedAt).getTime() + days * 24 * 60 * 60 * 1000);
  if (base.getUTCHours() || base.getUTCMinutes() || base.getUTCSeconds() || base.getUTCMilliseconds()) {
    base.setUTCHours(0, 0, 0, 0);
    base.setUTCDate(base.getUTCDate() + 1);
  }
  return base.toISOString();
}

async function cleanup({ userId, fanmarkId, licenseId, transferId, favoriteId, discoveryId, favoriteUserId, shortId }) {
  runD1(APP_CONFIG, BUSINESS_DATABASE, `
    DELETE FROM notifications
      WHERE event_id IN (
        SELECT id FROM notification_events
        WHERE dedupe_key IN (
          ${sqlLiteral(`fanmark_returned_owner_${fanmarkId}_${userId}`)},
          ${sqlLiteral(`favorite_available_${fanmarkId}_${favoriteUserId}`)}
        )
      );
    DELETE FROM notification_events
      WHERE dedupe_key IN (
        ${sqlLiteral(`fanmark_returned_owner_${fanmarkId}_${userId}`)},
        ${sqlLiteral(`favorite_available_${fanmarkId}_${favoriteUserId}`)}
      );
    DELETE FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND resource_id = ${sqlLiteral(fanmarkId)} AND action = 'return_fanmark';
    DELETE FROM fanmark_favorites WHERE id = ${sqlLiteral(favoriteId)} AND discovery_id = ${sqlLiteral(discoveryId)};
    DELETE FROM fanmark_discoveries WHERE id = ${sqlLiteral(discoveryId)};
    DELETE FROM fanmark_transfer_codes WHERE id = ${sqlLiteral(transferId)};
    DELETE FROM fanmark_licenses WHERE id = ${sqlLiteral(licenseId)};
    DELETE FROM fanmarks WHERE id = ${sqlLiteral(fanmarkId)} AND short_id = ${sqlLiteral(shortId)};
  `);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM account WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM "user" WHERE id = ${sqlLiteral(userId)};
  `);
  const business = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM fanmarks WHERE id = ${sqlLiteral(fanmarkId)}) AS fanmarks,
      (SELECT COUNT(*) FROM fanmark_licenses WHERE id = ${sqlLiteral(licenseId)}) AS licenses,
      (SELECT COUNT(*) FROM fanmark_transfer_codes WHERE id = ${sqlLiteral(transferId)}) AS transfers,
      (SELECT COUNT(*) FROM fanmark_favorites WHERE id = ${sqlLiteral(favoriteId)}) AS favorites,
      (SELECT COUNT(*) FROM fanmark_discoveries WHERE id = ${sqlLiteral(discoveryId)}) AS discoveries,
      (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND resource_id = ${sqlLiteral(fanmarkId)}) AS audits,
      (SELECT COUNT(*) FROM notification_events WHERE dedupe_key IN (${sqlLiteral(`fanmark_returned_owner_${fanmarkId}_${userId}`)}, ${sqlLiteral(`favorite_available_${fanmarkId}_${favoriteUserId}`)})) AS events,
      (SELECT COUNT(*) FROM notifications WHERE user_id IN (${sqlLiteral(userId)}, ${sqlLiteral(favoriteUserId)})) AS notifications
  `))[0];
  const auth = d1Rows(runD1(AUTH_CONFIG, AUTH_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM "user" WHERE id = ${sqlLiteral(userId)}) AS users,
      (SELECT COUNT(*) FROM account WHERE userId = ${sqlLiteral(userId)}) AS accounts,
      (SELECT COUNT(*) FROM session WHERE userId = ${sqlLiteral(userId)}) AS sessions
  `))[0];
  if ([...Object.values(business), ...Object.values(auth)].some((count) => Number(count) !== 0)) {
    fail("synthetic_canary_cleanup_failed");
  }
  return { business, auth };
}

async function waitForDeliveredNotifications({ fanmarkId, userId, favoriteUserId, syntheticFanmark, shortId }) {
  const dedupes = [
    `fanmark_returned_owner_${fanmarkId}_${userId}`,
    `favorite_available_${fanmarkId}_${favoriteUserId}`,
  ];
  const deadline = Date.now() + 90_000;
  let last = [];
  while (Date.now() < deadline) {
    last = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT e.event_type, e.status AS event_status, n.user_id, n.channel,
        n.status AS notification_status, n.delivered_at, n.payload
      FROM notification_events e
      LEFT JOIN notifications n ON n.event_id = e.id
      WHERE e.dedupe_key IN (${dedupes.map(sqlLiteral).join(", ")})
      ORDER BY e.event_type, n.user_id
    `));
    const ownerRows = last.filter((row) => row.event_type === "fanmark_returned_owner" && row.user_id === userId);
    const favoriteRows = last.filter((row) => row.event_type === "favorite_fanmark_available" && row.user_id === favoriteUserId);
    if (last.some((row) => row.event_status === "failed")) fail("notification_processor_failed_event");
    if (ownerRows.length === 1 && favoriteRows.length === 1) {
      for (const [notification, expectedName] of [[ownerRows[0], syntheticFanmark], [favoriteRows[0], "synthetic favorite display"]]) {
        assert.equal(notification.event_status, "processed");
        assert.equal(notification.channel, "in_app");
        assert.equal(notification.notification_status, "delivered");
        assert.ok(notification.delivered_at);
        const payload = JSON.parse(notification.payload);
        assert.equal(payload.metadata?.fanmark_name, expectedName);
        assert.equal(payload.link, `/f/${shortId}`);
        assert.ok(typeof payload.body === "string" && payload.body.length > 0);
      }
      return {
        processedEvents: last.length,
        deliveredNotifications: 2,
        localizedBodyPresent: true,
      };
    }
    await delay(5_000);
  }
  fail("notification_processing_timeout");
}

async function main() {
  assertTarget();
  const userId = randomUUID();
  const fanmarkId = randomUUID();
  const licenseId = randomUUID();
  const transferId = randomUUID();
  const favoriteId = randomUUID();
  const discoveryId = randomUUID();
  const favoriteUserId = randomUUID();
  const shortId = `c${randomBytes(12).toString("hex")}`;
  const nonce = randomBytes(9).toString("hex");
  const email = `codex-return-${nonce}@example.invalid`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const syntheticFanmark = `synthetic-${nonce}`;
  const now = new Date();
  const nowIso = now.toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const futureIso = "2999-12-31T23:59:59.000000Z";
  const graceSetting = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE,
    "SELECT setting_value FROM system_settings WHERE setting_key = 'grace_period_days'"))[0]?.setting_value;
  const parsedGraceDays = typeof graceSetting === "string" ? Number.parseInt(graceSetting, 10) : Number.NaN;
  const graceDays = Number.isFinite(parsedGraceDays) && parsedGraceDays > 0 ? parsedGraceDays : 1;
  const timestamp = sqlLiteral(nowIso);
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
  const bcrypt = require("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 10);
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Codex return smoke', ${sqlLiteral(email)}, 1, ${timestamp}, ${timestamp});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${timestamp}, ${timestamp});
    `);
    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
      VALUES (${sqlLiteral(fanmarkId)}, ${sqlLiteral(syntheticFanmark)}, ${sqlLiteral(syntheticFanmark)}, ${sqlLiteral(shortId)}, 'active', ${timestamp}, ${timestamp}, '[]', '[]', 1);
      INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
      VALUES (${sqlLiteral(licenseId)}, ${sqlLiteral(fanmarkId)}, ${sqlLiteral(userId)}, ${timestamp}, ${sqlLiteral(futureIso)}, 'active', 1, ${timestamp}, ${timestamp}, ${sqlLiteral(syntheticFanmark)});
      INSERT INTO fanmark_transfer_codes (id, license_id, fanmark_id, issuer_user_id, transfer_code, status, expires_at, disclaimer_agreed_at, created_at, updated_at)
      VALUES (${sqlLiteral(transferId)}, ${sqlLiteral(licenseId)}, ${sqlLiteral(fanmarkId)}, ${sqlLiteral(userId)}, ${sqlLiteral(`SMOKE-${nonce}`)}, 'active', ${sqlLiteral(futureIso)}, ${timestamp}, ${timestamp}, ${timestamp});
      INSERT INTO fanmark_discoveries (id, emoji_ids, normalized_emoji_ids, fanmark_id, availability_status, first_seen_at, last_seen_at)
      VALUES (${sqlLiteral(discoveryId)}, '[]', '[]', ${sqlLiteral(fanmarkId)}, 'owned_by_user', ${timestamp}, ${timestamp});
      INSERT INTO fanmark_favorites (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark)
      VALUES (${sqlLiteral(favoriteId)}, ${sqlLiteral(favoriteUserId)}, ${sqlLiteral(discoveryId)}, ${sqlLiteral(fanmarkId)}, '[]', ${timestamp}, 'synthetic favorite display');
    `);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await readJson(signIn, 200, "better_auth_sign_in_failed");
    const cookie = responseCookie(signIn);
    const path = "/api/me/fanmarks/return";
    const blocked = await readJson(await request(path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId }),
    }), 400, "active_transfer_guard_failed");
    assert.equal(blocked.error, "transfer_in_progress");
    runD1(APP_CONFIG, BUSINESS_DATABASE, `DELETE FROM fanmark_transfer_codes WHERE id = ${sqlLiteral(transferId)};`);

    const returned = await readJson(await request(path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId }),
    }), 200, "fanmark_return_failed");
    assert.deepEqual(returned, { success: true });

    const license = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT status, is_returned, excluded_at, license_end, grace_expires_at
      FROM fanmark_licenses WHERE id = ${sqlLiteral(licenseId)} AND user_id = ${sqlLiteral(userId)}
    `))[0];
    assert.equal(license.status, "grace");
    assert.equal(Number(license.is_returned), 1);
    assert.equal(license.excluded_at, null);
    assert.ok(Math.abs(Date.parse(license.license_end) - Date.now()) < 60_000);
    assert.equal(license.grace_expires_at, expectedGraceExpiry(license.license_end, graceDays));

    const effects = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT
        (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'return_fanmark' AND resource_id = ${sqlLiteral(fanmarkId)}) AS audits,
        (SELECT COUNT(*) FROM notification_events WHERE event_type = 'fanmark_returned_owner' AND dedupe_key = ${sqlLiteral(`fanmark_returned_owner_${fanmarkId}_${userId}`)}) AS owner_events,
        (SELECT COUNT(*) FROM notification_events WHERE event_type = 'favorite_fanmark_available' AND dedupe_key = ${sqlLiteral(`favorite_available_${fanmarkId}_${favoriteUserId}`)}) AS favorite_events
    `))[0];
    assert.equal(Number(effects.audits), 1);
    assert.equal(Number(effects.owner_events), 1);
    assert.equal(Number(effects.favorite_events), 1);
    const favoriteEvent = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT payload FROM notification_events
      WHERE event_type = 'favorite_fanmark_available'
        AND dedupe_key = ${sqlLiteral(`favorite_available_${fanmarkId}_${favoriteUserId}`)}
    `))[0];
    const favoritePayload = JSON.parse(favoriteEvent.payload);
    assert.equal(favoritePayload.user_id, favoriteUserId);
    assert.equal(favoritePayload.fanmark_id, fanmarkId);
    assert.equal(favoritePayload.fanmark_name, "synthetic favorite display");
    assert.equal(favoritePayload.link, `/f/${shortId}`);

    const notificationDelivery = await waitForDeliveredNotifications({
      fanmarkId, userId, favoriteUserId, syntheticFanmark, shortId,
    });

    return {
      worker: WORKER,
      transferGuard: { activeCodeStatus: 400, error: blocked.error },
      return: { status: 200, licenseStatus: license.status, returned: Number(license.is_returned) === 1 },
      effects: {
        auditRows: Number(effects.audits),
        ownerNotificationEvents: Number(effects.owner_events),
        favoriteNotificationEvents: Number(effects.favorite_events),
      },
      notificationDelivery,
    };
  } finally {
    if (cleanupNeeded) {
      const cleanupState = await cleanup({ userId, fanmarkId, licenseId, transferId, favoriteId, discoveryId, favoriteUserId, shortId });
      process.stdout.write(`${JSON.stringify({ cleanup: cleanupState })}\n`);
    }
  }
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error?.code ?? "staging_fanmark_return_smoke_failed"}\n`);
  process.exitCode = 1;
});

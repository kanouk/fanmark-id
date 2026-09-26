#!/usr/bin/env node

/** Rehearse one synthetic registration and lottery lifecycle against isolated Cloudflare staging databases. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { authEmailTemplateBaselineState } from "./staging-auth-email-template-baseline.mjs";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH_DATABASE = "fanmark-auth-staging";
const AUTH_DATABASE_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const COVER_BUCKET = "fanmark-cover-images-staging";
const MASTER_DATABASE = "fanmark-emoji-master-staging";
const MASTER_DATABASE_ID = "160376b0-bde6-4d5f-8969-96deb5ae1183";
const WRANGLER_VERSION = "4.139.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const AUTH_EMAIL_TEMPLATE_TYPES_SQL = "'signup', 'recovery', 'magiclink', 'email_change'";
const AUTH_EMAIL_TEMPLATE_CONTENT_SQL = `SELECT id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at FROM email_templates WHERE email_type IN (${AUTH_EMAIL_TEMPLATE_TYPES_SQL}) ORDER BY email_type, language`;
const AUTH_EMAIL_TEMPLATE_COUNT_SQL = "SELECT COUNT(*) AS row_count FROM email_templates";

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
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.vars?.FANMARK_REGISTRATION_BACKEND !== "d1" || config.vars?.FANMARK_LOTTERY_BACKEND !== "d1") {
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
  const coverBucket = config.r2_buckets?.find((entry) => entry.binding === "COVER_IMAGES_BUCKET");
  if (coverBucket?.bucket_name !== COVER_BUCKET || config.vars?.STORAGE_BACKEND !== "r2") {
    fail("staging_cover_storage_binding_mismatch");
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
  const authEmailTemplateRows = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, AUTH_EMAIL_TEMPLATE_CONTENT_SQL));
  const authEmailTemplateCount = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, AUTH_EMAIL_TEMPLATE_COUNT_SQL))[0]?.row_count);
  const authEmailTemplateBaseline = authEmailTemplateBaselineState(authEmailTemplateRows, authEmailTemplateCount);
  if (authEmailTemplateBaseline === "invalid") fail("auth_email_template_baseline_mismatch");
  const businessDataTables = businessTablesWithoutStagingBaselines(tables, {
    authEmailTemplates: authEmailTemplateBaseline === "seeded",
  });
  const totalRows = businessDataTables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
  if (Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `SELECT ${totalRows} AS total_rows`))[0]?.total_rows) !== 0) {
    fail("business_staging_has_rows");
  }
  return { businessDataTables, authEmailTemplateBaseline };
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

async function cleanup({ userId, fanmarkId, licenseId, entryId, email, cookie, coverObjectPath, coverPublicUrl }) {
  if (coverObjectPath) {
    let deleted = false;
    if (cookie) {
      try {
        const response = await request(`/api/storage/object/cover-images/${coverObjectPath.split("/").map(encodeURIComponent).join("/")}`, {
          method: "DELETE",
          headers: { cookie },
        });
        deleted = response.status === 204 || response.status === 404;
      } catch { /* Fall back to exact-key cleanup in the isolated staging bucket. */ }
    }
    if (!deleted) {
      runWrangler(["r2", "object", "delete", `${COVER_BUCKET}/${coverObjectPath}`, "--remote", "--config", APP_CONFIG, "--force"]);
    }
  }
  if (coverPublicUrl) {
    const missing = await request(new URL(coverPublicUrl).pathname);
    if (missing.status !== 404) fail("synthetic_cover_object_cleanup_failed");
  }
  const owned = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT id, fanmark_id FROM fanmark_licenses WHERE user_id = ${sqlLiteral(userId)}
  `));
  const licenseIds = [...new Set([
    ...(licenseId ? [licenseId] : []),
    ...owned.map((row) => row.id).filter((id) => typeof id === "string"),
  ])];
  const fanmarkIds = [...new Set([
    ...(fanmarkId ? [fanmarkId] : []),
    ...owned.map((row) => row.fanmark_id).filter((id) => typeof id === "string"),
  ])];
  const childDeletes = licenseIds.map((id) => {
    const literal = sqlLiteral(id);
    return `DELETE FROM fanmark_profiles WHERE license_id = ${literal};
      DELETE FROM fanmark_basic_configs WHERE license_id = ${literal};
      DELETE FROM fanmark_redirect_configs WHERE license_id = ${literal};
      DELETE FROM fanmark_messageboard_configs WHERE license_id = ${literal};`;
  }).join("\n");
  const fanmarkDeletes = fanmarkIds.map((id) => `DELETE FROM fanmarks WHERE id = ${sqlLiteral(id)};`).join("\n");
  runD1(APP_CONFIG, BUSINESS_DATABASE, `
    DELETE FROM notification_events WHERE ${entryId ? `json_extract(payload, '$.entry_id') = ${sqlLiteral(entryId)}` : "0"};
    DELETE FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND resource_id = ${entryId ? sqlLiteral(entryId) : "'__no_entry__'"} AND resource_type = 'fanmark_lottery_entry';
    DELETE FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'register_fanmark';
    ${childDeletes}
    DELETE FROM user_settings WHERE user_id = ${sqlLiteral(userId)};
    DELETE FROM fanmark_licenses WHERE user_id = ${sqlLiteral(userId)};
    ${fanmarkDeletes}
  `);
  runD1(AUTH_CONFIG, AUTH_DATABASE, `
    DELETE FROM session WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM account WHERE userId = ${sqlLiteral(userId)};
    DELETE FROM "user" WHERE id = ${sqlLiteral(userId)} AND email = ${sqlLiteral(email)};
  `);
  const business = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
    SELECT
      (SELECT COUNT(*) FROM fanmark_licenses WHERE user_id = ${sqlLiteral(userId)}) AS licenses,
      (SELECT COUNT(*) FROM fanmarks WHERE id = ${fanmarkId ? sqlLiteral(fanmarkId) : "'__no_fanmark__'"}) AS fanmarks,
      (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND action = 'register_fanmark') AS audits,
      (SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id IN (${licenseIds.length ? licenseIds.map(sqlLiteral).join(",") : "'__no_license__'"})) AS basic_configs,
      (SELECT COUNT(*) FROM fanmark_profiles WHERE license_id IN (${licenseIds.length ? licenseIds.map(sqlLiteral).join(",") : "'__no_license__'"})) AS profiles,
      (SELECT COUNT(*) FROM fanmark_lottery_entries WHERE ${entryId ? `id = ${sqlLiteral(entryId)}` : "0"}) AS lottery_entries,
      (SELECT COUNT(*) FROM notification_events WHERE ${entryId ? `json_extract(payload, '$.entry_id') = ${sqlLiteral(entryId)}` : "0"}) AS lottery_events,
      (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${sqlLiteral(userId)} AND resource_id = ${entryId ? sqlLiteral(entryId) : "'__no_entry__'"} AND resource_type = 'fanmark_lottery_entry') AS lottery_audits,
      (SELECT COUNT(*) FROM user_settings WHERE user_id = ${sqlLiteral(userId)}) AS user_settings,
      (SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id IN (${licenseIds.length ? licenseIds.map(sqlLiteral).join(",") : "'__no_license__'"})) AS redirect_configs,
      (SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id IN (${licenseIds.length ? licenseIds.map(sqlLiteral).join(",") : "'__no_license__'"})) AS messageboard_configs
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
  return { business, auth, coverR2Object: coverPublicUrl ? "404 after cleanup" : "no object created" };
}

async function main() {
  const { businessDataTables: businessTables, authEmailTemplateBaseline } = assertTarget();
  const emoji = d1Rows(runD1(APP_CONFIG, MASTER_DATABASE, `
    SELECT record.id, record.emoji, record.codepoints_json AS codepoints,
      release.row_count AS expected_count,
      (SELECT COUNT(*) FROM fanmark_emoji_master_release_staging AS all_records
        WHERE all_records.release_version = active.release_version) AS actual_count
    FROM fanmark_emoji_master_active_release AS active
    JOIN fanmark_emoji_master_release_imports AS release
      ON release.release_version = active.release_version AND release.status = 'ready'
    JOIN fanmark_emoji_master_release_staging AS record
      ON record.release_version = active.release_version
    WHERE active.singleton_id = 1 AND record.emoji = '🌹' LIMIT 1
  `))[0];
  const overLimitEmojis = d1Rows(runD1(APP_CONFIG, MASTER_DATABASE, `
    SELECT record.id, record.emoji
    FROM fanmark_emoji_master_active_release AS active
    JOIN fanmark_emoji_master_release_staging AS record
      ON record.release_version = active.release_version
    WHERE active.singleton_id = 1
      AND record.emoji IN ('🌟','🌹','🍎','🐱','🔥','😀')
    ORDER BY record.emoji
  `));
  const tier = d1Rows(runD1(APP_CONFIG, MASTER_DATABASE,
    "SELECT tier_level, display_name, initial_license_days FROM fanmark_tiers WHERE tier_level = 4 AND is_active = 1 LIMIT 1"))[0];
  if (!emoji || !tier || typeof emoji.id !== "string" || emoji.emoji !== "🌹" ||
      Number(emoji.expected_count) !== Number(emoji.actual_count) || overLimitEmojis.length !== 6 ||
      overLimitEmojis.some((row) => typeof row.id !== "string" || typeof row.emoji !== "string")) {
    fail("staging_master_data_missing");
  }

  const userId = randomUUID();
  const nonce = randomBytes(9).toString("hex");
  const email = `codex-registration-${nonce}@example.invalid`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const timestamp = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
  const bcrypt = require("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 10);
  let fanmarkId;
  let licenseId;
  let entryId;
  let cookie;
  let coverObjectPath;
  let coverPublicUrl;
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sqlLiteral(userId)}, 'Codex registration smoke', ${sqlLiteral(email)}, 1, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(userId)}, 'credential', ${sqlLiteral(userId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
    `);
    const signedIn = await request("/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    await readJson(signedIn, 200, "better_auth_sign_in_failed");
    cookie = responseCookie(signedIn);
    const registrationBody = {
      user_input_fanmark: emoji.emoji,
      emoji_ids: [emoji.id],
      normalized_emoji_ids: [emoji.id],
      accessType: "profile",
      displayName: "Codex registration smoke",
      createProfile: true,
    };
    const oversizedRegistration = await readJson(await request("/api/fanmarks/register", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        ...registrationBody,
        user_input_fanmark: overLimitEmojis.map((row) => row.emoji).join(""),
        emoji_ids: overLimitEmojis.map((row) => row.id),
        normalized_emoji_ids: overLimitEmojis.map((row) => row.id),
      }),
    }), 400, "registration_max_emoji_limit_not_enforced");
    assert.equal(oversizedRegistration.error_code, "invalid_emoji_count");
    assert.equal(oversizedRegistration.error, "Emoji combination must contain 1-5 emojis");

    const created = await readJson(await request("/api/fanmarks/register", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(registrationBody),
    }), 201, "fanmark_registration_failed");
    assert.equal(created.success, true);
    assert.equal(created.fanmark.user_input_fanmark, emoji.emoji);
    assert.equal(created.fanmark.tier_level, Number(tier.tier_level));
    fanmarkId = created.fanmark.id;
    const stored = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT f.status, f.normalized_emoji, f.short_id, l.id AS license_id,
        l.user_id, l.status AS license_status, l.is_initial_license, b.access_type,
        p.display_name, a.action
      FROM fanmarks f
      JOIN fanmark_licenses l ON l.fanmark_id = f.id
      JOIN fanmark_basic_configs b ON b.license_id = l.id
      JOIN fanmark_profiles p ON p.license_id = l.id
      JOIN audit_logs a ON a.resource_id = f.id AND a.user_id = l.user_id
      WHERE f.id = ${sqlLiteral(fanmarkId)} AND l.user_id = ${sqlLiteral(userId)}
    `))[0];
    if (!stored) fail("registration_readback_missing");
    licenseId = stored.license_id;
    assert.equal(stored.status, "active");
    assert.equal(stored.normalized_emoji, emoji.emoji);
    assert.equal(stored.user_id, userId);
    assert.equal(stored.license_status, "active");
    assert.equal(Number(stored.is_initial_license), 1);
    assert.equal(stored.access_type, "profile");
    assert.equal(stored.display_name, "Codex registration smoke");
    assert.equal(stored.action, "register_fanmark");

    const coverBytes = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ));
    const coverUpload = await request("/api/storage/object/cover-images", {
      method: "POST",
      headers: { cookie, "content-type": "image/png" },
      body: coverBytes,
    });
    const cover = await readJson(coverUpload, 201, "cover_r2_upload_failed");
    coverObjectPath = cover.path;
    coverPublicUrl = cover.publicUrl;
    assert.match(coverObjectPath, new RegExp(`^${userId}/[0-9a-f-]+\\.png$`, "iu"));
    assert.equal(new URL(coverPublicUrl).origin, APP_ORIGIN);
    const publicCover = await request(new URL(coverPublicUrl).pathname);
    assert.equal(publicCover.status, 200);
    assert.deepEqual(new Uint8Array(await publicCover.arrayBuffer()), coverBytes);

    const profilePath = `/api/me/fanmarks/${fanmarkId}/profile`;
    const savedCover = await readJson(await request(profilePath, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ theme_settings: {
        cover_image_url: coverPublicUrl,
        cover_image_dimensions: { width: 1, height: 1 },
        cover_image_position: 50,
      } }),
    }), 200, "cover_profile_save_failed");
    assert.equal(savedCover.profile.theme_settings.cover_image_url, coverPublicUrl);
    const crossOwnerCover = await request(profilePath, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ theme_settings: {
        cover_image_url: `${APP_ORIGIN}/api/storage/public/cover-images/${randomUUID()}/${coverObjectPath.split("/").at(-1)}`,
      } }),
    });
    assert.equal(crossOwnerCover.status, 400);
    const wrongBucketCover = await request(profilePath, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ theme_settings: {
        cover_image_url: `${APP_ORIGIN}/api/storage/public/avatars/${userId}/wrong-bucket.png`,
      } }),
    });
    assert.equal(wrongBucketCover.status, 400);
    const coverDelete = await request(`/api/storage/object/cover-images/${coverObjectPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(coverDelete.status, 204);
    coverObjectPath = undefined;
    const clearedCover = await readJson(await request(profilePath, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ theme_settings: {
        cover_image_url: "",
        cover_image_dimensions: { width: 1, height: 1 },
        cover_image_position: 50,
      } }),
    }), 200, "cover_profile_clear_failed");
    assert.equal(clearedCover.profile.theme_settings.cover_image_url, "");

    runD1(APP_CONFIG, BUSINESS_DATABASE, `
      INSERT INTO user_settings (user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES (${sqlLiteral(userId)}, ${sqlLiteral(`smoke-${nonce}`)}, 'free', 'ja', ${sqlLiteral(timestamp)}, ${sqlLiteral(timestamp)});
      UPDATE fanmark_licenses SET status = 'grace', grace_expires_at = ${sqlLiteral(new Date(Date.now() + 86400000).toISOString())}, updated_at = ${sqlLiteral(timestamp)}
      WHERE id = ${sqlLiteral(licenseId)} AND user_id = ${sqlLiteral(userId)} AND status = 'active';
    `);
    const appliedLottery = await readJson(await request("/api/fanmarks/lottery/apply", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId }),
    }), 200, "lottery_application_failed");
    assert.equal(appliedLottery.success, true);
    assert.equal(appliedLottery.fanmark_id, fanmarkId);
    assert.equal(typeof appliedLottery.entry_id, "string");
    entryId = appliedLottery.entry_id;
    const lotteryReadback = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, `
      SELECT entry_status, fanmark_id, user_id, license_id, lottery_probability
      FROM fanmark_lottery_entries WHERE id = ${sqlLiteral(entryId)}
    `))[0];
    if (!lotteryReadback) fail("lottery_entry_readback_missing");
    assert.equal(lotteryReadback.entry_status, "pending");
    assert.equal(lotteryReadback.user_id, userId);

    const whoisPath = "/api/fanmarks/details";
    const whoisBody = JSON.stringify({ shortId: stored.short_id });
    const anonymousWhois = await readJson(await request(whoisPath, {
      method: "POST", headers: { "content-type": "application/json" }, body: whoisBody,
    }), 200, "anonymous_fanmark_details_failed");
    assert.equal(anonymousWhois.schemaVersion, 1);
    assert.equal(anonymousWhois.result.history_available, false);
    assert.deepEqual(anonymousWhois.result.license_history, []);
    assert.equal(anonymousWhois.result.current_owner_username, null);
    assert.equal(anonymousWhois.result.has_user_lottery_entry, false);
    assert.equal(anonymousWhois.result.lottery_entry_count, 0);

    const authenticatedWhois = await readJson(await request(whoisPath, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: whoisBody,
    }), 200, "authenticated_fanmark_details_failed");
    assert.equal(authenticatedWhois.result.history_available, true);
    assert.equal(authenticatedWhois.result.is_current_owner, true);
    assert.equal(authenticatedWhois.result.current_owner_username, `smoke-${nonce}`);
    assert.equal(authenticatedWhois.result.has_user_lottery_entry, true);
    assert.equal(authenticatedWhois.result.has_pending_lottery, true);
    assert.equal(authenticatedWhois.result.lottery_entry_count, 1);
    assert.equal(authenticatedWhois.result.license_history.length, 1);
    const detailsJson = JSON.stringify(authenticatedWhois.result);
    assert.equal(detailsJson.includes(userId), false);
    assert.equal(detailsJson.includes(email), false);
    assert.equal(Object.hasOwn(authenticatedWhois.result, "current_owner_id"), false);

    const duplicateLottery = await readJson(await request("/api/fanmarks/lottery/apply", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId }),
    }), 400, "duplicate_lottery_not_blocked");
    assert.match(duplicateLottery.error, /already applied/u);
    const cancelledLottery = await readJson(await request("/api/fanmarks/lottery/cancel", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ entry_id: entryId }),
    }), 200, "lottery_cancellation_failed");
    assert.equal(cancelledLottery.entry_status, "cancelled");
    const unauthenticatedLottery = await request("/api/fanmarks/lottery/apply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fanmark_id: fanmarkId }),
    });
    assert.equal(unauthenticatedLottery.status, 401);

    const duplicate = await readJson(await request("/api/fanmarks/register", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(registrationBody),
    }), 409, "duplicate_registration_not_blocked");
    assert.equal(duplicate.error_code, "grace_period");
    const unauthenticated = await readJson(await request("/api/fanmarks/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registrationBody),
    }), 401, "unauthenticated_registration_not_blocked");
    assert.equal(unauthenticated.error_code, "authentication_required");

    const cleanupProof = await cleanup({ userId, fanmarkId, licenseId, entryId, email, cookie, coverObjectPath, coverPublicUrl });
    const totalRowsQuery = businessTables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
    const totalRows = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE,
      `SELECT ${totalRowsQuery} AS total_rows`))[0]?.total_rows);
    if (totalRows !== 0) fail("business_staging_cleanup_not_empty");
    const mastersAfter = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, NOTIFICATION_MASTER_COUNTS_SQL))[0];
    const settingsAfter = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, STAGING_NON_USER_CONFIG_BASELINE_SQL))[0];
    if (notificationMasterBaselineState(mastersAfter) === "invalid") fail("notification_master_baseline_changed");
    if (stagingNonUserConfigBaselineState(settingsAfter) === "invalid") fail("system_setting_baseline_changed");
    const authEmailTemplateRowsAfter = d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, AUTH_EMAIL_TEMPLATE_CONTENT_SQL));
    const authEmailTemplateCountAfter = Number(d1Rows(runD1(APP_CONFIG, BUSINESS_DATABASE, AUTH_EMAIL_TEMPLATE_COUNT_SQL))[0]?.row_count);
    if (authEmailTemplateBaselineState(authEmailTemplateRowsAfter, authEmailTemplateCountAfter) !== authEmailTemplateBaseline) {
      fail("auth_email_template_baseline_changed");
    }
    cleanupNeeded = false;
    process.stdout.write(`${JSON.stringify({
      worker: "fanmark-app-staging",
      endpoint: "/api/fanmarks/register",
      syntheticOwner: true,
      syntheticEmoji: emoji.emoji,
      authEmailTemplateBaseline,
      tier: Number(tier.tier_level),
      maxEmojiCount: { oversizedStatus: 400, errorCode: oversizedRegistration.error_code, max: 5 },
      duplicateStatus: 409,
      unauthenticatedStatus: 401,
      lottery: { applyStatus: 200, duplicateStatus: 400, cancelStatus: 200, unauthenticatedStatus: 401 },
      fanmarkDetails: {
        anonymousStatus: 200,
        anonymousHistoryAvailable: anonymousWhois.result.history_available,
        authenticatedStatus: 200,
        authenticatedHistoryRows: authenticatedWhois.result.license_history.length,
        ownerState: authenticatedWhois.result.is_current_owner,
        lotteryState: authenticatedWhois.result.has_pending_lottery,
        noUserIdsOrEmailsReturned: true,
      },
      coverProfile: { uploadStatus: 201, publicReadStatus: 200, sameOwnerSaveStatus: 200,
        crossOwnerStatus: crossOwnerCover.status, wrongBucketStatus: wrongBucketCover.status, ownerDeleteStatus: coverDelete.status },
      cleanup: cleanupProof,
      businessRowsAfterCleanup: totalRows,
    }, null, 2)}\n`);
  } finally {
    if (cleanupNeeded) await cleanup({ userId, fanmarkId, licenseId, entryId, email, cookie, coverObjectPath, coverPublicUrl });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.code ?? "fanmark_registration_smoke_failed"}: ${error?.message ?? ""}\n`);
  process.exitCode = 1;
});

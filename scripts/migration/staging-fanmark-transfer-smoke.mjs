#!/usr/bin/env node

/** Rehearse the transfer lifecycle with synthetic identities and business rows on workers.dev staging. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
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
const ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS = "fanmark-business-staging";
const BUSINESS_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH = "fanmark-auth-staging";
const AUTH_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const MASTER = "fanmark-emoji-master-staging";
const MASTER_ID = "160376b0-bde6-4d5f-8969-96deb5ae1183";
const WRANGLER = "4.140.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];

function sql(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function fail(code) {
  throw new Error(code);
}

function wrangler(args) {
  const result = spawnSync("npx", ["--yes", "wrangler@" + WRANGLER, ...args], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function json(args) {
  try {
    return JSON.parse(wrangler(args).stdout.trim());
  } catch {
    fail("wrangler_json_invalid");
  }
}

function d1(config, database, command) {
  const result = json(["d1", "execute", database, "--remote", "--json", "--command", command, "--config", config]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  if (!Array.isArray(result[0]?.results)) fail("staging_d1_readback_failed");
  return result[0].results;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.vars?.FANMARK_TRANSFER_BACKEND !== "d1" || config.vars?.AUTH_BACKEND !== "better-auth") {
    fail("staging_target_mismatch");
  }
  const bindings = [
    ["FANMARK_DB", BUSINESS, BUSINESS_ID], ["AUTH_DB", AUTH, AUTH_ID], ["MASTER_DB", MASTER, MASTER_ID],
  ];
  for (const [binding, name, id] of bindings) {
    const found = config.d1_databases?.find((entry) => entry.binding === binding);
    if (found?.database_name !== name || found.database_id !== id) fail("staging_database_binding_mismatch");
  }
  const identity = json(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const deployment = json(["deployments", "list", "--name", config.name, "--json", "--config", APP_CONFIG]);
  if (!deployment[0]?.versions?.some((version) => version.percentage === 100)) fail("staging_worker_not_active");

  const source = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const businessTables = [...source.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (businessTables.length !== 40) fail("business_table_inventory_mismatch");
  const masters = d1(APP_CONFIG, BUSINESS, NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(APP_CONFIG, BUSINESS, STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_mismatch");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_mismatch");
  const businessDataTables = businessTablesWithoutStagingBaselines(businessTables);
  const businessSum = businessDataTables.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  if (Number(d1(APP_CONFIG, BUSINESS, "SELECT " + businessSum + " AS row_count")[0]?.row_count) !== 0) {
    fail("business_staging_has_rows");
  }
  const authSum = AUTH_TABLES.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  if (Number(d1(AUTH_CONFIG, AUTH, "SELECT " + authSum + " AS row_count")[0]?.row_count) !== 0) {
    fail("auth_staging_has_rows");
  }
  const generationRows = d1(AUTH_CONFIG, AUTH, "SELECT id, generation FROM mfaGeneration");
  if (generationRows.length !== 1 || Number(generationRows[0].id) !== 1 ||
      !Number.isInteger(Number(generationRows[0].generation)) || Number(generationRows[0].generation) < 0) {
    fail("auth_mfa_generation_baseline_invalid");
  }
  const emoji = d1(APP_CONFIG, MASTER, "SELECT record.id, active.release_version FROM fanmark_emoji_master_active_release AS active " +
    "JOIN fanmark_emoji_master_release_staging AS record ON record.release_version = active.release_version " +
    "WHERE active.singleton_id = 1 AND record.emoji = '🌹' LIMIT 1")[0];
  const tier = d1(APP_CONFIG, MASTER,
    "SELECT tier_level, initial_license_days FROM fanmark_tiers WHERE tier_level = 4 AND is_active = 1 LIMIT 1")[0];
  if (!emoji || typeof emoji.id !== "string" || !tier || Number(tier.initial_license_days) !== 7) {
    fail("staging_master_data_mismatch");
  }
  return {
    emojiId: emoji.id,
    tierLevel: Number(tier.tier_level),
    mfaGenerationBaseline: Number(generationRows[0].generation),
  };
}

async function checked(response, status, code) {
  if (response.status !== status) {
    let detail = "";
    try {
      const body = await response.clone().json();
      if (typeof body?.error === "string" && /^[a-z0-9_]{1,80}$/u.test(body.error)) detail = "_" + body.error;
    } catch { /* Keep the HTTP status as the primary failure signal. */ }
    fail(code + "_" + response.status + detail);
  }
  return response.json();
}

function cookieFrom(response) {
  const all = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const pair = all.map((value) => value.split(";", 1)[0]).find((value) => /session_token=/u.test(value));
  if (!pair) fail("auth_cookie_missing");
  return pair;
}

function request(path, init = {}) {
  return fetch(ORIGIN + path, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } });
}

async function signIn(email, password) {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  await checked(response, 200, "auth_sign_in_failed");
  return cookieFrom(response);
}

function authInsert(userId, email, hash, now) {
  return "INSERT INTO \"user\" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (" +
    [userId, "Codex transfer canary", email, 1, now, now].map(sql).join(",") + ");" +
    "INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (" +
    [randomUUID(), userId, "credential", userId, hash, now, now].map(sql).join(",") + ");";
}

function cleanup({ ownerId, recipientId, ownerEmail, recipientEmail, fanmarkId, requestIds, mfaGenerationBaseline }) {
  const eventKeys = (requestIds ?? []).flatMap((id) => [
    "transfer_requested_" + id, "transfer_approved_" + id, "transfer_rejected_" + id,
  ]);
  const eventWhere = eventKeys.length > 0
    ? "dedupe_key IN (" + eventKeys.map(sql).join(",") + ")"
    : "json_extract(payload, '$.user_id') IN (" + sql(ownerId) + "," + sql(recipientId) + ")" +
      " OR json_extract(payload, '$.requester_user_id') IN (" + sql(ownerId) + "," + sql(recipientId) + ")";
  d1(APP_CONFIG, BUSINESS, [
    "DELETE FROM notifications WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ") OR event_id IN (" +
      "SELECT id FROM notification_events WHERE " + eventWhere + ");",
    "DELETE FROM notification_events WHERE " + eventWhere + ";",
    "DELETE FROM audit_logs WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM fanmark_transfer_requests WHERE fanmark_id = " + sql(fanmarkId) + ";",
    "DELETE FROM fanmark_transfer_codes WHERE fanmark_id = " + sql(fanmarkId) + ";",
    "DELETE FROM fanmark_lottery_entries WHERE fanmark_id = " + sql(fanmarkId) + ";",
    "DELETE FROM fanmark_basic_configs WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ");",
    "DELETE FROM fanmark_redirect_configs WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ");",
    "DELETE FROM fanmark_messageboard_configs WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ");",
    "DELETE FROM fanmark_password_configs WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ");",
    "DELETE FROM fanmark_profiles WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ");",
    "DELETE FROM fanmark_licenses WHERE fanmark_id = " + sql(fanmarkId) + ";",
    "DELETE FROM fanmarks WHERE id = " + sql(fanmarkId) + ";",
    "DELETE FROM user_settings WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
  ].join("\n"));
  d1(AUTH_CONFIG, AUTH, [
    "DELETE FROM session WHERE userId IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM account WHERE userId IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM adminRole WHERE userId IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM twoFactor WHERE userId IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM mfaAssurance WHERE userId IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
    "DELETE FROM verification WHERE identifier IN (" + sql(ownerEmail) + "," + sql(recipientEmail) + ");",
    "DELETE FROM \"user\" WHERE id IN (" + sql(ownerId) + "," + sql(recipientId) + ");",
  ].join("\n"));
  const remainingBusiness = d1(APP_CONFIG, BUSINESS,
    "SELECT (SELECT COUNT(*) FROM fanmarks WHERE id=" + sql(fanmarkId) + ") + " +
    "(SELECT COUNT(*) FROM fanmark_licenses WHERE fanmark_id=" + sql(fanmarkId) + ") + " +
    "(SELECT COUNT(*) FROM fanmark_transfer_codes WHERE fanmark_id=" + sql(fanmarkId) + ") + " +
    "(SELECT COUNT(*) FROM fanmark_transfer_requests WHERE fanmark_id=" + sql(fanmarkId) + ") + " +
    "(SELECT COUNT(*) FROM user_settings WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ")) + " +
    "(SELECT COUNT(*) FROM notifications WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ")) + " +
    "(SELECT COUNT(*) FROM notification_events WHERE " + eventWhere + ") + " +
    "(SELECT COUNT(*) FROM audit_logs WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ")) AS row_count")[0];
  const authSum = AUTH_TABLES.map((table) => "(SELECT COUNT(*) FROM \"" + table + "\")").join(" + ");
  const remainingAuth = d1(AUTH_CONFIG, AUTH, "SELECT " + authSum + " AS row_count")[0];
  const generationAfter = d1(AUTH_CONFIG, AUTH, "SELECT generation FROM mfaGeneration WHERE id = 1")[0];
  if (Number(remainingBusiness.row_count) !== 0 || Number(remainingAuth.row_count) !== 0 ||
      Number(generationAfter?.generation) !== mfaGenerationBaseline) fail("synthetic_canary_cleanup_failed");
}

async function waitForDeliveredTransferNotifications({ rejectedRequestId, approvedRequestId, ownerId, recipientId, fanmarkName, shortId }) {
  const notifications = [
    { key: "transfer_rejected_" + rejectedRequestId, eventType: "transfer_rejected", userId: recipientId },
    { key: "transfer_requested_" + approvedRequestId, eventType: "transfer_requested", userId: ownerId },
    { key: "transfer_approved_" + approvedRequestId, eventType: "transfer_approved", userId: recipientId },
  ];
  const eventKeysSql = notifications.map(({ key }) => sql(key)).join(",");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const rows = d1(APP_CONFIG, BUSINESS,
      "SELECT e.event_type,e.status AS event_status,e.error_reason,e.dedupe_key," +
      "n.id AS notification_id,n.user_id,n.channel,n.status,n.delivered_at,n.payload AS notification_payload " +
      "FROM notification_events e LEFT JOIN notifications n ON n.event_id=e.id " +
      "WHERE e.dedupe_key IN (" + eventKeysSql + ") " +
      "ORDER BY e.dedupe_key,n.id");
    const failed = rows.find((row) => row.event_status === "failed");
    if (failed) fail("transfer_notification_event_failed_" + failed.event_type);
    const byKey = new Map();
    for (const row of rows) {
      if (!byKey.has(row.dedupe_key)) byKey.set(row.dedupe_key, []);
      byKey.get(row.dedupe_key).push(row);
    }
    if (notifications.every(({ key }) => {
      const rowsForEvent = byKey.get(key) ?? [];
      return rowsForEvent.length === 1 && rowsForEvent[0].event_status === "processed" && rowsForEvent[0].notification_id;
    })) {
      for (const expected of notifications) {
        const row = byKey.get(expected.key)[0];
        assert.equal(row.event_type, expected.eventType);
        const userId = expected.userId;
        assert.equal(row.user_id, userId);
        assert.equal(row.channel, "in_app");
        assert.equal(row.status, "delivered");
        assert.equal(typeof row.delivered_at, "string");
        const payload = JSON.parse(row.notification_payload);
        assert.match(payload.body, /[\u3040-\u30ff\u4e00-\u9fff]/u);
        assert.ok(payload.body.includes(fanmarkName));
        assert.equal(payload.metadata.fanmark_id, payload.fanmark_id);
      }
      const requestedPayload = JSON.parse(byKey.get("transfer_requested_" + approvedRequestId)[0].notification_payload);
      assert.equal(requestedPayload.metadata.requester_user_id, recipientId);
      assert.equal(requestedPayload.metadata.requester_name, "Synthetic recipient");
      const approvedPayload = JSON.parse(byKey.get("transfer_approved_" + approvedRequestId)[0].notification_payload);
      assert.equal(approvedPayload.metadata.fanmark_short_id, shortId);
      const rejectedPayload = JSON.parse(byKey.get("transfer_rejected_" + rejectedRequestId)[0].notification_payload);
      assert.equal(rejectedPayload.metadata.fanmark_short_id, shortId);
      return { processedEvents: 3, deliveredNotifications: 3, localizedBodies: true };
    }
    if (notifications.some(({ key }) => (byKey.get(key) ?? []).length > 1)) fail("transfer_notification_duplicate");
    await delay(5_000);
  }
  fail("transfer_notification_delivery_timeout");
}

async function main() {
  const { emojiId, tierLevel, mfaGenerationBaseline } = assertTarget();
  const root = await request("/");
  if (root.status !== 200 || root.headers.get("x-robots-tag")?.includes("noindex") !== true) fail("staging_app_unavailable");
  const html = await root.text();
  const assetPath = html.match(/src="([^"]+\.js)"/u)?.[1];
  if (!assetPath) fail("staging_asset_missing");
  const asset = await request(assetPath);
  if (asset.status !== 200) fail("staging_asset_unavailable");
  const bundle = await asset.text();
  if (!bundle.includes("/api/me/transfers/approve") || !bundle.includes("worker")) fail("transfer_selector_missing");
  if ((await request("/api/me/transfers")).status !== 401) fail("anonymous_transfer_list_not_denied");

  const ownerId = randomUUID();
  const recipientId = randomUUID();
  const suffix = randomBytes(10).toString("hex");
  const ownerEmail = "codex-transfer-owner-" + suffix + "@example.invalid";
  const recipientEmail = "codex-transfer-recipient-" + suffix + "@example.invalid";
  const ownerPassword = "Staging-" + randomBytes(24).toString("base64url") + "a9!";
  const recipientPassword = "Staging-" + randomBytes(24).toString("base64url") + "b8!";
  const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
  const bcrypt = require("bcryptjs");
  const ownerHash = await bcrypt.hash(ownerPassword, 10);
  const recipientHash = await bcrypt.hash(recipientPassword, 10);
  const now = new Date();
  const nowIso = now.toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const ownerName = "owner" + suffix;
  const recipientName = "recipient" + suffix;
  const fanmarkId = randomUUID();
  const licenseId = randomUUID();
  const lotteryId = randomUUID();
  const shortId = "stg" + randomBytes(5).toString("hex");
  const licenseEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const requestIds = [];
  let notificationDelivery = null;
  try {
    d1(AUTH_CONFIG, AUTH, authInsert(ownerId, ownerEmail, ownerHash, nowIso) + authInsert(recipientId, recipientEmail, recipientHash, nowIso));
    const ownerCookie = await signIn(ownerEmail, ownerPassword);
    const recipientCookie = await signIn(recipientEmail, recipientPassword);
    d1(APP_CONFIG, BUSINESS, [
      "INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,created_at,updated_at) VALUES (" +
        [randomUUID(), ownerId, ownerName, "Synthetic owner", "free", "ja", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO user_settings (id,user_id,username,display_name,plan_type,preferred_language,created_at,updated_at) VALUES (" +
        [randomUUID(), recipientId, recipientName, "Synthetic recipient", "free", "ja", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmarks (id,user_input_fanmark,normalized_emoji,short_id,status,created_at,updated_at,emoji_ids,normalized_emoji_ids,tier_level) VALUES (" +
        [fanmarkId, "🌹", "🌹", shortId, "active", nowIso, nowIso, JSON.stringify([emojiId]), JSON.stringify([emojiId]), tierLevel].map(sql).join(",") + ");",
      "INSERT INTO fanmark_licenses (id,fanmark_id,user_id,license_start,license_end,status,is_initial_license,created_at,updated_at,display_fanmark) VALUES (" +
        [licenseId, fanmarkId, ownerId, nowIso, licenseEnd, "active", 1, nowIso, nowIso, "🌹"].map(sql).join(",") + ");",
      "INSERT INTO fanmark_basic_configs (license_id,fanmark_name,access_type,created_at,updated_at) VALUES (" +
        [licenseId, "Before transfer", "profile", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_redirect_configs (license_id,target_url,created_at,updated_at) VALUES (" +
        [licenseId, "https://example.invalid", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_messageboard_configs (license_id,content,created_at,updated_at) VALUES (" +
        [licenseId, "synthetic", nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_password_configs (license_id,access_password,is_enabled,created_at,updated_at) VALUES (" +
        [licenseId, "synthetic-only", 1, nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_profiles (license_id,display_name,bio,social_links,theme_settings,is_public,created_at,updated_at) VALUES (" +
        [licenseId, "Synthetic", "", "{}", "{}", 1, nowIso, nowIso].map(sql).join(",") + ");",
      "INSERT INTO fanmark_lottery_entries (id,fanmark_id,user_id,license_id,lottery_probability,entry_status,applied_at,created_at,updated_at) VALUES (" +
        [lotteryId, fanmarkId, ownerId, licenseId, "1.0", "pending", nowIso, nowIso, nowIso].map(sql).join(",") + ");",
    ].join("\n"));

    const issued = await checked(await request("/api/me/transfers/issue", {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ license_id: licenseId, disclaimer_agreed: true }),
    }), 200, "transfer_issue_failed");
    if (issued.success !== true || typeof issued.transfer_code_id !== "string" ||
        !/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/u.test(issued.transfer_code)) fail("issue_response_invalid");
    const ownerList = await checked(await request("/api/me/transfers", { headers: { cookie: ownerCookie } }), 200, "owner_list_failed");
    if (!ownerList.issuedCodes?.some((entry) => entry.id === issued.transfer_code_id)) fail("issued_code_not_listed");
    const rejectedApply = await checked(await request("/api/me/transfers/apply", {
      method: "POST", headers: { cookie: recipientCookie, "content-type": "application/json" },
      body: JSON.stringify({ transfer_code: issued.transfer_code, disclaimer_agreed: true }),
    }), 200, "transfer_apply_failed");
    if (typeof rejectedApply.request_id !== "string") fail("request_id_missing");
    requestIds.push(rejectedApply.request_id);
    const rejectedPending = await checked(await request("/api/me/transfers", { headers: { cookie: ownerCookie } }), 200, "pending_list_failed");
    if (!rejectedPending.pendingRequests?.some((entry) => entry.id === rejectedApply.request_id)) fail("pending_request_not_listed");
    const rejected = await checked(await request("/api/me/transfers/reject", {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ request_id: rejectedApply.request_id, reason: "synthetic canary rejection" }),
    }), 200, "transfer_rejection_failed");
    if (rejected.success !== true) fail("rejection_response_invalid");
    const rejectionState = d1(APP_CONFIG, BUSINESS,
      "SELECT r.status AS request_status,c.status AS code_status FROM fanmark_transfer_requests r " +
      "JOIN fanmark_transfer_codes c ON c.id=r.transfer_code_id WHERE r.id=" + sql(rejectedApply.request_id))[0];
    assert.deepEqual([rejectionState?.request_status, rejectionState?.code_status], ["rejected", "active"]);
    const applied = await checked(await request("/api/me/transfers/apply", {
      method: "POST", headers: { cookie: recipientCookie, "content-type": "application/json" },
      body: JSON.stringify({ transfer_code: issued.transfer_code, disclaimer_agreed: true }),
    }), 200, "transfer_reapply_failed");
    if (typeof applied.request_id !== "string" || applied.request_id === rejectedApply.request_id) fail("reapply_request_id_invalid");
    requestIds.push(applied.request_id);
    const pending = await checked(await request("/api/me/transfers", { headers: { cookie: ownerCookie } }), 200, "pending_list_failed");
    if (!pending.pendingRequests?.some((entry) => entry.id === applied.request_id)) fail("pending_request_not_listed");
    const approvalResponse = await request("/api/me/transfers/approve", {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ request_id: applied.request_id, transferredFanmarkName: "Synthetic transfer" }),
    });
    if (approvalResponse.status !== 200) {
      const state = d1(APP_CONFIG, BUSINESS,
        "SELECT r.status AS request_status,c.status AS code_status,l.status AS old_license_status," +
        "(SELECT COUNT(*) FROM fanmark_licenses WHERE fanmark_id=" + sql(fanmarkId) + ") AS license_count " +
        "FROM fanmark_transfer_requests r JOIN fanmark_transfer_codes c ON c.id=r.transfer_code_id " +
        "JOIN fanmark_licenses l ON l.id=r.license_id WHERE r.id=" + sql(applied.request_id))[0];
      fail("transfer_approval_failed_" + approvalResponse.status + "_" +
        [state?.request_status, state?.code_status, state?.old_license_status, state?.license_count].join("_"));
    }
    const approved = await approvalResponse.json();
    if (approved.success !== true || typeof approved.new_license_id !== "string") fail("approval_response_invalid");

    const state = d1(APP_CONFIG, BUSINESS,
      "SELECT c.status AS code_status,r.status AS request_status,l.status AS old_status,l.is_returned," +
      "n.user_id AS new_owner,n.status AS new_status,n.is_transferred,n.transfer_locked_until,n.license_end," +
      "(SELECT COUNT(*) FROM fanmark_basic_configs WHERE license_id=l.id) AS old_basic," +
      "(SELECT COUNT(*) FROM fanmark_redirect_configs WHERE license_id=l.id) AS old_redirect," +
      "(SELECT COUNT(*) FROM fanmark_messageboard_configs WHERE license_id=l.id) AS old_message," +
      "(SELECT COUNT(*) FROM fanmark_password_configs WHERE license_id=l.id) AS old_password," +
      "(SELECT COUNT(*) FROM fanmark_profiles WHERE license_id=l.id) AS old_profile," +
      "(SELECT access_type FROM fanmark_basic_configs WHERE license_id=n.id) AS new_access," +
      "(SELECT entry_status FROM fanmark_lottery_entries WHERE id=" + sql(lotteryId) + ") AS lottery_status," +
      "(SELECT cancellation_reason FROM fanmark_lottery_entries WHERE id=" + sql(lotteryId) + ") AS lottery_reason " +
      "FROM fanmark_transfer_codes c JOIN fanmark_transfer_requests r ON r.transfer_code_id=c.id " +
      "JOIN fanmark_licenses l ON l.id=r.license_id JOIN fanmark_licenses n ON n.id=" + sql(approved.new_license_id) +
      "WHERE c.id=" + sql(issued.transfer_code_id) + " AND r.id=" + sql(applied.request_id))[0];
    assert.deepEqual({
      code_status: state.code_status, request_status: state.request_status, old_status: state.old_status,
      is_returned: Number(state.is_returned), new_owner: state.new_owner, new_status: state.new_status,
      is_transferred: Number(state.is_transferred), old_basic: Number(state.old_basic),
      old_redirect: Number(state.old_redirect), old_message: Number(state.old_message),
      old_password: Number(state.old_password), old_profile: Number(state.old_profile),
      new_access: state.new_access, lottery_status: state.lottery_status, lottery_reason: state.lottery_reason,
    }, {
      code_status: "completed", request_status: "approved", old_status: "expired", is_returned: 1,
      new_owner: recipientId, new_status: "active", is_transferred: 1,
      old_basic: 0, old_redirect: 0, old_message: 0, old_password: 0, old_profile: 0,
      new_access: "inactive", lottery_status: "cancelled", lottery_reason: "system",
    });
    const serverNow = Date.now();
    assert.ok(Date.parse(state.transfer_locked_until) > serverNow + 29 * 86_400_000);
    assert.ok(Date.parse(state.transfer_locked_until) < serverNow + 31 * 86_400_000);
    assert.ok(Date.parse(state.license_end) > serverNow + 7 * 86_400_000);
    assert.ok(Date.parse(state.license_end) <= serverNow + 8 * 86_400_000);
    assert.match(state.license_end, /T00:00:00\.000Z$/u);
    const audits = d1(APP_CONFIG, BUSINESS,
      "SELECT COUNT(*) AS count FROM audit_logs WHERE user_id IN (" + sql(ownerId) + "," + sql(recipientId) + ")")[0];
    const events = d1(APP_CONFIG, BUSINESS,
      "SELECT COUNT(*) AS count FROM notification_events WHERE dedupe_key IN (" +
      sql("transfer_rejected_" + rejectedApply.request_id) + "," +
      sql("transfer_requested_" + applied.request_id) + "," +
      sql("transfer_approved_" + applied.request_id) + ")")[0];
    assert.equal(Number(audits.count), 5);
    assert.equal(Number(events.count), 3);
    notificationDelivery = await waitForDeliveredTransferNotifications({
      rejectedRequestId: rejectedApply.request_id, approvedRequestId: applied.request_id,
      ownerId, recipientId, fanmarkName: "🌹", shortId,
    });
    const recipientList = await checked(await request("/api/me/transfers", { headers: { cookie: recipientCookie } }), 200, "recipient_list_failed");
    assert.deepEqual(recipientList, { issuedCodes: [], pendingRequests: [], myRequests: [] });
  } finally {
    cleanup({ ownerId, recipientId, ownerEmail, recipientEmail, fanmarkId, requestIds, mfaGenerationBaseline });
  }
  console.log(JSON.stringify({
    staging: ORIGIN, transferLifecycle: "issue_apply_reject_reapply_approve", tierLevel,
    notificationDelivery,
    businessSyntheticRowsAfterCleanup: 0, authUserRowsAfterCleanup: 0,
    userDataMigration: "not performed", domainDns: "unchanged",
  }));
}

main().catch((error) => {
  console.error(error?.message ?? "transfer smoke failed");
  process.exitCode = 1;
});

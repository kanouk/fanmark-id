#!/usr/bin/env node

/** Exercise partial and complete synthetic bulk returns on workers.dev staging, then remove every row. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
const ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS = "fanmark-business-staging";
const BUSINESS_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const AUTH = "fanmark-auth-staging";
const AUTH_ID = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const WRANGLER = "4.139.0";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const AUTH_CONFIG = "workers/api/wrangler.auth-staging.jsonc";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];

function fail(code) { throw Object.assign(new Error(code), { code }); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function wrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER}`, ...args], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function json(args) {
  try { return JSON.parse(wrangler(args).stdout.trim()); }
  catch (error) { if (error?.code) throw error; fail("wrangler_json_invalid"); }
}

function d1(config, database, command) {
  const result = json(["d1", "execute", database, "--remote", "--json", "--command", command, "--config", config]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true) || !Array.isArray(result[0]?.results)) {
    fail("staging_d1_command_failed");
  }
  return result[0].results;
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  if (config.name !== WORKER || config.workers_dev !== true || config.routes?.length ||
      config.vars?.FANMARK_RETURN_BACKEND !== "d1" || config.vars?.AUTH_BACKEND !== "better-auth") {
    fail("staging_target_mismatch");
  }
  for (const [binding, name, id] of [["FANMARK_DB", BUSINESS, BUSINESS_ID], ["AUTH_DB", AUTH, AUTH_ID]]) {
    const entry = config.d1_databases?.find((item) => item.binding === binding);
    if (entry?.database_name !== name || entry.database_id !== id) fail("staging_database_binding_mismatch");
  }
  const identity = json(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const deployments = json(["deployments", "list", "--name", WORKER, "--json", "--config", APP_CONFIG]);
  if (!deployments[0]?.versions?.some((version) => version.percentage === 100)) fail("staging_worker_not_active");

  const migration = readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8");
  const businessTables = [...migration.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map((match) => match[1]);
  if (businessTables.length !== 40) fail("business_table_inventory_mismatch");
  const masters = d1(APP_CONFIG, BUSINESS, NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(APP_CONFIG, BUSINESS, STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  if (notificationMasterBaselineState(masters) === "invalid") fail("notification_master_baseline_mismatch");
  if (stagingNonUserConfigBaselineState(settings) === "invalid") fail("system_setting_baseline_mismatch");
  const businessDataTables = businessTablesWithoutStagingBaselines(businessTables);
  const businessTotal = businessDataTables.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
  if (Number(d1(APP_CONFIG, BUSINESS, `SELECT ${businessTotal} AS total_rows`)[0]?.total_rows) !== 0) {
    fail("business_staging_has_rows");
  }
  const authTotal = AUTH_TABLES.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ");
  if (Number(d1(AUTH_CONFIG, AUTH, `SELECT ${authTotal} AS total_rows`)[0]?.total_rows) !== 0) fail("auth_staging_has_rows");
}

async function request(path, init = {}) {
  return fetch(`${ORIGIN}${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } });
}

function cookieFrom(response) {
  const headers = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const cookie = headers.map((value) => value.split(";", 1)[0]).find((value) => /session_token=/u.test(value));
  if (!cookie) fail("response_cookie_missing");
  return cookie;
}

async function expectJson(response, status, code) {
  if (response.status !== status) fail(`${code}_${response.status}`);
  return response.json();
}

async function main() {
  assertTarget();
  const incarnationBaseline = d1(APP_CONFIG, BUSINESS,
    "SELECT license_id, incarnation FROM fanmark_license_incarnations ORDER BY license_id");
  const accessVersionBaseline = d1(APP_CONFIG, BUSINESS,
    "SELECT license_id, license_incarnation, access_generation, password_generation, updated_at FROM fanmark_access_versions ORDER BY license_id");
  const mfaGenerationBaseline = d1(AUTH_CONFIG, AUTH, "SELECT id, generation FROM mfaGeneration");
  if (mfaGenerationBaseline.length !== 1 || Number(mfaGenerationBaseline[0].id) !== 1 ||
      !Number.isInteger(Number(mfaGenerationBaseline[0].generation))) fail("auth_mfa_generation_baseline_invalid");
  const userId = randomUUID();
  const fanmarkIds = [randomUUID(), randomUUID()];
  const licenseIds = [randomUUID(), randomUUID()];
  const createdLicenseIds = [];
  const transferIds = [randomUUID(), randomUUID()];
  const shortIds = fanmarkIds.map(() => `c${randomBytes(12).toString("hex")}`);
  const nonce = randomBytes(9).toString("hex");
  const email = `codex-bulk-return-${nonce}@example.invalid`;
  const password = `Staging-${randomBytes(24).toString("base64url")}a9!`;
  const end = "2999-12-31T23:59:59.000000Z";
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
  const timestamp = sql(now);
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../../workers/api/package.json", import.meta.url));
  const passwordHash = await require("bcryptjs").hash(password, 10);
  let cleanupNeeded = false;

  try {
    cleanupNeeded = true;
    d1(AUTH_CONFIG, AUTH, `
      INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sql(userId)}, 'Codex bulk return smoke', ${sql(email)}, 1, ${timestamp}, ${timestamp});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sql(randomUUID())}, ${sql(userId)}, 'credential', ${sql(userId)}, ${sql(passwordHash)}, ${timestamp}, ${timestamp});
    `);
    for (let index = 0; index < fanmarkIds.length; index += 1) {
      d1(APP_CONFIG, BUSINESS, `
        INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level)
        VALUES (${sql(fanmarkIds[index])}, ${sql(`synthetic-${nonce}-${index}`)}, ${sql(`synthetic-${nonce}-${index}`)}, ${sql(shortIds[index])}, 'active', ${timestamp}, ${timestamp}, ${sql(JSON.stringify([`synthetic-${nonce}-${index}`]))}, ${sql(JSON.stringify([`synthetic-${nonce}-${index}`]))}, 1);
        INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at, display_fanmark)
        VALUES (${sql(licenseIds[index])}, ${sql(fanmarkIds[index])}, ${sql(userId)}, ${timestamp}, ${sql(end)}, 'active', 1, ${timestamp}, ${timestamp}, ${sql(`synthetic-${nonce}-${index}`)});
      `);
      createdLicenseIds.push(licenseIds[index]);
    }
    d1(APP_CONFIG, BUSINESS, `
      INSERT INTO fanmark_transfer_codes (id, license_id, fanmark_id, issuer_user_id, transfer_code, status, expires_at, disclaimer_agreed_at, created_at, updated_at)
      VALUES (${sql(transferIds[1])}, ${sql(licenseIds[1])}, ${sql(fanmarkIds[1])}, ${sql(userId)}, ${sql(`BULK-${nonce}`)}, 'active', ${sql(end)}, ${timestamp}, ${timestamp}, ${timestamp});
    `);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    if (signIn.status !== 200) fail(`better_auth_sign_in_failed_${signIn.status}`);
    const cookie = cookieFrom(signIn);
    const path = "/api/me/fanmarks/bulk-return";
    const partial = await expectJson(await request(path, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ license_ids: licenseIds }),
    }), 207, "partial_bulk_return_failed");
    assert.equal(partial.success, false);
    assert.equal(partial.results.length, 1);
    assert.equal(partial.results[0].licenseId, licenseIds[0]);
    assert.deepEqual(partial.failed, [{ licenseId: licenseIds[1], error: "transfer_in_progress" }]);

    const first = d1(APP_CONFIG, BUSINESS,
      `SELECT status, is_returned FROM fanmark_licenses WHERE id = ${sql(licenseIds[0])}`)[0];
    const second = d1(APP_CONFIG, BUSINESS,
      `SELECT status, is_returned FROM fanmark_licenses WHERE id = ${sql(licenseIds[1])}`)[0];
    assert.equal(first.status, "grace");
    assert.equal(Number(first.is_returned), 1);
    assert.equal(second.status, "active");
    assert.equal(Number(second.is_returned), 0);

    d1(APP_CONFIG, BUSINESS, `DELETE FROM fanmark_transfer_codes WHERE id = ${sql(transferIds[1])}`);
    const completed = await expectJson(await request(path, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ license_ids: [licenseIds[1]] }),
    }), 200, "complete_bulk_return_failed");
    assert.equal(completed.success, true);
    assert.equal(completed.results.length, 1);
    assert.equal(completed.results[0].licenseId, licenseIds[1]);
    for (let index = 0; index < licenseIds.length; index += 1) {
      const effects = d1(APP_CONFIG, BUSINESS, `
        SELECT
          (SELECT COUNT(*) FROM audit_logs WHERE user_id = ${sql(userId)} AND resource_id = ${sql(fanmarkIds[index])} AND action = 'return_fanmark') AS audits,
          (SELECT COUNT(*) FROM notification_events WHERE dedupe_key = ${sql(`fanmark_returned_owner_${fanmarkIds[index]}_${userId}`)}) AS events
      `)[0];
      assert.equal(Number(effects.audits), 1);
      assert.equal(Number(effects.events), 1);
    }
    return { worker: WORKER, partialStatus: 207, blockedLicense: licenseIds[1], completeStatus: 200, returnedLicenses: licenseIds.length };
  } finally {
    if (cleanupNeeded) {
      for (let index = 0; index < fanmarkIds.length; index += 1) {
        d1(APP_CONFIG, BUSINESS, `
          DELETE FROM notification_events WHERE dedupe_key = ${sql(`fanmark_returned_owner_${fanmarkIds[index]}_${userId}`)};
          DELETE FROM audit_logs WHERE user_id = ${sql(userId)} AND resource_id = ${sql(fanmarkIds[index])} AND action = 'return_fanmark';
          DELETE FROM fanmark_transfer_codes WHERE id = ${sql(transferIds[index])};
          DELETE FROM fanmark_licenses WHERE id = ${sql(licenseIds[index])};
          DELETE FROM fanmarks WHERE id = ${sql(fanmarkIds[index])} AND short_id = ${sql(shortIds[index])};
        `);
      }
      d1(AUTH_CONFIG, AUTH, `
        DELETE FROM session WHERE userId = ${sql(userId)};
        DELETE FROM account WHERE userId = ${sql(userId)};
        DELETE FROM "user" WHERE id = ${sql(userId)};
      `);
      const businessTables = [...readFileSync("workers/api/migrations-business/0000_business_schema_v4_staging.sql", "utf8").matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)]
        .map((match) => match[1]);
      const businessCount = d1(APP_CONFIG, BUSINESS,
        "SELECT " + businessTablesWithoutStagingBaselines(businessTables)
          .map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ") + " AS total_rows")[0]?.total_rows;
      const authCount = d1(AUTH_CONFIG, AUTH,
        `SELECT ${AUTH_TABLES.map((table) => `(SELECT COUNT(*) FROM "${table}")`).join(" + ")} AS total_rows`)[0]?.total_rows;
      if (Number(businessCount) !== 0 || Number(authCount) !== 0) fail("synthetic_canary_cleanup_failed");
      if (notificationMasterBaselineState(d1(APP_CONFIG, BUSINESS, NOTIFICATION_MASTER_COUNTS_SQL)[0]) === "invalid" ||
          stagingNonUserConfigBaselineState(d1(APP_CONFIG, BUSINESS, STAGING_NON_USER_CONFIG_BASELINE_SQL)[0]) === "invalid") {
        fail("staging_baseline_changed");
      }
      const incarnationsAfter = d1(APP_CONFIG, BUSINESS,
        "SELECT license_id, incarnation FROM fanmark_license_incarnations ORDER BY license_id");
      const canaryIds = new Set(licenseIds);
      const additions = incarnationsAfter.filter((row) => canaryIds.has(row.license_id));
      if (additions.length !== createdLicenseIds.length || additions.some((row) => Number(row.incarnation) !== 1)) {
        fail("synthetic_lifecycle_tombstone_mismatch");
      }
      const expectedIncarnations = [...incarnationBaseline, ...additions].sort((a, b) => a.license_id.localeCompare(b.license_id));
      if (JSON.stringify(incarnationsAfter) !== JSON.stringify(expectedIncarnations)) fail("lifecycle_registry_changed_outside_canary");
      const accessVersionsAfter = d1(APP_CONFIG, BUSINESS,
        "SELECT license_id, license_incarnation, access_generation, password_generation, updated_at FROM fanmark_access_versions ORDER BY license_id");
      if (JSON.stringify(accessVersionsAfter) !== JSON.stringify(accessVersionBaseline)) fail("synthetic_access_version_cleanup_failed");
      const mfaGenerationAfter = d1(AUTH_CONFIG, AUTH, "SELECT id, generation FROM mfaGeneration");
      if (JSON.stringify(mfaGenerationAfter) !== JSON.stringify(mfaGenerationBaseline)) fail("auth_mfa_generation_changed");
      process.stdout.write(`${JSON.stringify({ cleanup: {
        businessRows: Number(businessCount),
        authRows: Number(authCount),
        retainedSyntheticLicenseTombstones: additions.length,
        accessVersionRowsRestored: accessVersionsAfter.length,
        mfaGenerationUnchanged: true,
      } })}\n`);
    }
  }
}

main().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
  process.stderr.write(`${error?.code ?? "staging_fanmark_bulk_return_smoke_failed"}\n`);
  process.exitCode = 1;
});

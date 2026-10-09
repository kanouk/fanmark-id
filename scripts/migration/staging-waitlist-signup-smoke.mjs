#!/usr/bin/env node

/** Submit one synthetic .invalid address through the staging Worker and remove its exact D1 row. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const email = `codex-waitlist-${randomBytes(8).toString("hex")}@example.invalid`;
const referralSource = `codex-staging-smoke:${randomUUID()}`;
const WRANGLER_CLI = fileURLToPath(new URL("../../workers/api/node_modules/wrangler/bin/wrangler.js", import.meta.url));
let canaryId;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_CLI, ...args], {
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(sql) {
  const result = runJson([
    "d1", "execute", BUSINESS_DATABASE, "--remote", "--json", "--command", sql, "--config", APP_CONFIG,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  return result;
}

function rowsForCanary() {
  return d1Rows(runD1(`SELECT id, email, referral_source, status, created_at FROM waitlist WHERE email = ${sqlLiteral(email)}`));
}

function assertTarget() {
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  const business = config.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const limiter = config.ratelimits?.find((entry) => entry.name === "WAITLIST_SIGNUP_LIMITER");
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.vars?.D1_TOPOLOGY !== "split" || config.vars?.WAITLIST_SIGNUP_BACKEND !== "d1" ||
      !config.vars?.CORS_ALLOWED_ORIGINS?.split(",").includes(APP_ORIGIN) ||
      business?.database_id !== BUSINESS_DATABASE_ID || business.database_name !== BUSINESS_DATABASE ||
      limiter?.simple?.limit !== 120 || limiter.simple.period !== 60) {
    fail("staging_target_mismatch");
  }

  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const databases = runJson(["d1", "list", "--json"]);
  if (!databases.some((database) =>
    (database.uuid ?? database.database_id ?? database.id) === BUSINESS_DATABASE_ID &&
    (database.name ?? database.database_name) === BUSINESS_DATABASE)) fail("cloudflare_database_mismatch");
}

async function request(init) {
  return fetch(`${APP_ORIGIN}/api/waitlist`, {
    ...init,
    headers: {
      Origin: APP_ORIGIN,
      ...(init.headers ?? {}),
    },
  });
}

function assertGenericAccepted(payload) {
  assert.deepEqual(payload, { schemaVersion: 1, accepted: true });
  assert.equal(JSON.stringify(payload).includes(email), false);
}

async function cleanup() {
  const rows = rowsForCanary();
  if (rows.length > 1) fail("synthetic_waitlist_duplicate_rows");
  if (rows.length === 1) {
    const row = rows[0];
    if (row.id !== canaryId || row.email !== email || row.referral_source !== referralSource) {
      fail("synthetic_waitlist_cleanup_identity_mismatch");
    }
    const result = runD1(`DELETE FROM waitlist WHERE id = ${sqlLiteral(canaryId)} AND email = ${sqlLiteral(email)} AND referral_source = ${sqlLiteral(referralSource)} AND status = ${sqlLiteral(row.status)}`);
    if (Number(result[0]?.meta?.changes) !== 1) fail("synthetic_waitlist_cleanup_failed");
  }
  if (rowsForCanary().length !== 0) fail("synthetic_waitlist_cleanup_readback_failed");
}

async function main() {
  assertTarget();
  if (rowsForCanary().length !== 0) fail("synthetic_waitlist_email_already_exists");

  const preflight = await request({ method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), APP_ORIGIN);

  const rejected = await fetch(`${APP_ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { Origin: "https://invalid-origin.example", "content-type": "application/json" },
    body: JSON.stringify({ email, referral_source: referralSource }),
  });
  assert.equal(rejected.status, 403);

  const input = JSON.stringify({ email, referral_source: referralSource });
  const first = await request({ method: "POST", headers: { "content-type": "application/json" }, body: input });
  assert.equal(first.status, 202);
  assertGenericAccepted(await first.json());

  const rows = rowsForCanary();
  if (rows.length === 1 && typeof rows[0].id === "string") canaryId = rows[0].id;
  if (rows.length !== 1 || rows[0].email !== email || rows[0].referral_source !== referralSource ||
      rows[0].status !== "waiting" || !Number.isFinite(Date.parse(rows[0].created_at))) {
    fail("synthetic_waitlist_insert_readback_mismatch");
  }
  canaryId = rows[0].id;

  const duplicate = await request({ method: "POST", headers: { "content-type": "application/json" }, body: input });
  assert.equal(duplicate.status, 202);
  assertGenericAccepted(await duplicate.json());
  if (rowsForCanary().length !== 1) fail("synthetic_waitlist_duplicate_wrote_extra_row");
}

let primaryError;
try {
  await main();
} catch (error) {
  primaryError = error;
}

try {
  await cleanup();
} catch (error) {
  if (primaryError) {
    process.stderr.write("synthetic_waitlist_cleanup_failed_after_test_error\n");
  } else {
    primaryError = error;
  }
}

if (primaryError) {
  process.stderr.write(`${primaryError.code ?? "waitlist_signup_smoke_failed"}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("waitlist_signup_staging_smoke=passed synthetic_rows_after_cleanup=0\n");
}

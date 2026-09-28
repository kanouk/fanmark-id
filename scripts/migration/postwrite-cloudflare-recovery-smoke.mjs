#!/usr/bin/env node

/** Rehearse post-write Cloudflare recovery with a disposable D1 and Worker. */

import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerRoot = path.join(repoRoot, "workers/api");
const require = createRequire(path.join(workerRoot, "package.json"));
const bcrypt = require("bcryptjs");
const appConfigRelative = "wrangler.app-staging.jsonc";
const appConfigPath = path.join(workerRoot, appConfigRelative);
const wranglerCli = path.join(workerRoot, "node_modules/wrangler/bin/wrangler.js");
const accountId = "bfc2890741f0b3fb236e2d755b6c9adc";
const businessName = "fanmark-business-staging";
const businessId = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const migrationDirectory = path.join(workerRoot, "migrations-business");
const authName = "fanmark-auth-staging";
const authId = "2116bc43-32ab-4e3e-b762-9378df88b95f";
const authMigrationDirectory = path.join(workerRoot, "migrations");
const webhookApiVersion = "2025-08-27.basil";
const startedAt = new Date().toISOString();
const suffix = randomBytes(8).toString("hex");
const databaseName = `fanmark-recovery-${Date.now()}-${suffix}`;
const authDatabaseName = `fanmark-auth-recovery-${Date.now()}-${suffix}`;
const workerName = `fanmark-recovery-${Date.now()}-${suffix}`;
const configName = `.wrangler-recovery-${suffix}.jsonc`;
const configPath = path.join(workerRoot, configName);
const tempReportPath = path.join(os.tmpdir(), `fanmark-postwrite-recovery-${suffix}.json`);
const syntheticSecret = `whsec_${randomBytes(32).toString("base64url")}`;
const syntheticAuthSecret = randomBytes(32).toString("base64url");
const syntheticAuthUserId = randomUUID();
const syntheticAuthAccountId = randomUUID();
const syntheticAuthEmail = `auth-recovery-${randomUUID()}@example.invalid`;
const syntheticAuthPassword = `Recovery-${randomBytes(24).toString("base64url")}あ!9`;
const emailBeforeBookmark = `recovery-before-${randomUUID()}@example.invalid`;
const emailAfterBookmark = `recovery-after-${randomUUID()}@example.invalid`;
const emailDuringFreeze = `recovery-freeze-${randomUUID()}@example.invalid`;
const referralBeforeBookmark = `postwrite-recovery:${randomUUID()}`;
const referralAfterBookmark = `postwrite-recovery:${randomUUID()}`;
const referralDuringFreeze = `postwrite-recovery:${randomUUID()}`;
const firstEventId = `evt_recovery_${randomUUID().replaceAll("-", "")}`;
const firstObjectId = `cus_recovery_${randomUUID().replaceAll("-", "")}`;

let activeConfigRelative = appConfigRelative;
let creationMayHaveSucceeded = false;
let authCreationMayHaveSucceeded = false;
let databaseId = null;
let authDatabaseId = null;
let workerMayExist = false;
let tempConfigWritten = false;
let primaryError = null;
let report = {
  schemaVersion: 2,
  startedAt,
  accountId,
  phase: "preflight",
  failureCode: null,
  failureKind: null,
  database: { name: databaseName, id: null, expectedMigrationCount: null },
  authDatabase: { name: authDatabaseName, id: null, expectedMigrationCount: null },
  worker: { name: workerName, origin: null, deployedVersion: null, frozenVersion: null },
  recovery: { bookmark: null, authBookmark: null, acknowledgedDigest: null, reconciliationMs: null },
  cleanup: { workerDeleted: false, databaseDeleted: false, authDatabaseDeleted: false, configDeleted: false },
  lastFailedOperation: null,
  status: "running",
};

function fail(code) {
  throw new Error(code);
}

function requireExplicitStagingWrite() {
  const flags = new Set(process.argv.slice(2));
  const expected = [
    "--run-live-staging-write",
    `--account-id=${accountId}`,
    "--confirm-synthetic-only",
    "--confirm-delete-created-resources",
  ];
  if (flags.size !== expected.length || expected.some((flag) => !flags.has(flag))) {
    fail("refusing_remote_staging_write");
  }
}

function runWrangler(args, { input, configRelative = activeConfigRelative, timeout = 180_000 } = {}) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args, "--config", configRelative], {
    cwd: workerRoot,
    encoding: "utf8",
    input,
    env: { ...process.env, CI: "1" },
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    let operation = args[0] ?? "unknown";
    if (operation === "d1") {
      operation = `d1_${args[1] ?? "unknown"}`;
      if (args[1] === "migrations" || args[1] === "time-travel") operation += `_${args[2] ?? "unknown"}`;
    }
    operation = operation.replaceAll("-", "_");
    report.lastFailedOperation = operation;
    report.lastFailedDiagnostic = sanitizedWranglerDiagnostic(result);
    fail(`wrangler_${operation}_failed`);
  }
  return result.stdout ?? "";
}

function sanitizedWranglerDiagnostic(result) {
  let output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replaceAll(syntheticSecret, "[redacted]")
    .replaceAll(syntheticAuthSecret, "[redacted]")
    .replaceAll(syntheticAuthPassword, "[redacted]")
    .replaceAll(syntheticAuthEmail, "[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, "$1[redacted]")
    .replace(/\b(?:sk|rk|whsec)_[A-Za-z0-9_-]{12,}\b/gu, "[redacted]")
    .replace(/\$2[aby]\$\d{2}\$[^\s'"]{20,}/gu, "[redacted]");
  const relevantLines = output.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /error|failed|invalid|not found|status code|\[code:\s*\d+\]/iu.test(line));
  output = relevantLines.slice(-3).join(" ").replace(/\s+/gu, " ").trim();
  return output.slice(0, 500) || null;
}

function parseJson(output, code) {
  try {
    return JSON.parse(output.replace(/\u001b\[[0-9;]*m/gu, "").trim());
  } catch {
    fail(code);
  }
}

function parseJsonArray(output, code) {
  const value = parseJson(output, code);
  if (!Array.isArray(value)) fail(code);
  return value;
}

function databaseRows() {
  return parseJsonArray(runWrangler(["d1", "list", "--json"], { configRelative: appConfigRelative }), "d1_list_invalid");
}

function databaseNameOf(database) {
  return database.name ?? database.database_name;
}

function databaseIdOf(database) {
  return database.uuid ?? database.database_id ?? database.id;
}

function assertPrivateStagingTarget() {
  const appConfig = parseJson(readFileSync(appConfigPath, "utf8"), "staging_config_invalid");
  const business = appConfig.d1_databases?.find((entry) => entry.binding === "FANMARK_DB");
  const auth = appConfig.d1_databases?.find((entry) => entry.binding === "AUTH_DB");
  if (appConfig.name !== "fanmark-app-staging" || appConfig.account_id !== accountId ||
      appConfig.workers_dev !== true || (appConfig.routes?.length ?? 0) !== 0 ||
      business?.database_name !== businessName || business?.database_id !== businessId ||
      business?.migrations_dir !== "migrations-business" || business?.remote !== true ||
      auth?.database_name !== authName || auth?.database_id !== authId ||
      auth?.migrations_dir !== "migrations" ||
      auth?.migrations_pattern !== "migrations/{0003_better_auth_core.sql,0007_auth_signup_command.sql,0008_auth_user_suspension.sql}" ||
      auth?.remote !== true) {
    fail("staging_target_mismatch");
  }

  const identity = parseJson(runWrangler(["whoami", "--json"], { configRelative: appConfigRelative }), "cloudflare_identity_invalid");
  if (identity.loggedIn !== true || identity.accounts?.some((account) => account.id === accountId) !== true) {
    fail("cloudflare_account_mismatch");
  }

  const databases = databaseRows();
  if (!databases.some((database) => databaseNameOf(database) === businessName && databaseIdOf(database) === businessId)) {
    fail("business_staging_database_missing");
  }
  if (!databases.some((database) => databaseNameOf(database) === authName && databaseIdOf(database) === authId)) {
    fail("auth_staging_database_missing");
  }
  if (databases.some((database) => {
    const name = String(databaseNameOf(database) ?? "");
    return name.startsWith("fanmark-recovery-") || name.startsWith("fanmark-auth-recovery-");
  })) {
    fail("unreviewed_recovery_database_exists");
  }
}

function createTemporaryConfig() {
  const appConfig = parseJson(readFileSync(appConfigPath, "utf8"), "staging_config_invalid");
  const stagingHostname = new URL(appConfig.vars?.BETTER_AUTH_URL).hostname;
  const workerSuffix = stagingHostname.split(".").slice(1).join(".");
  if (!workerSuffix.endsWith("workers.dev")) fail("workers_dev_suffix_invalid");
  const origin = `https://${workerName}.${workerSuffix}`;
  const currentRateLimitIds = new Set((appConfig.ratelimits ?? []).map((entry) => entry.namespace_id));
  let namespaceId = 1_000_000_000 + Number.parseInt(randomBytes(4).toString("hex"), 16) % 1_000_000_000;
  while (currentRateLimitIds.has(String(namespaceId))) namespaceId += 1;

  const temporaryConfig = {
    $schema: appConfig.$schema,
    name: workerName,
    main: appConfig.main,
    compatibility_date: appConfig.compatibility_date,
    ...(appConfig.compatibility_flags ? { compatibility_flags: appConfig.compatibility_flags } : {}),
    account_id: accountId,
    workers_dev: true,
    d1_databases: [{
      binding: "FANMARK_DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "migrations-business",
      remote: true,
    }, {
      binding: "AUTH_DB",
      database_name: authDatabaseName,
      database_id: authDatabaseId,
      migrations_dir: "migrations",
      migrations_pattern: "migrations/{0003_better_auth_core.sql,0007_auth_signup_command.sql,0008_auth_user_suspension.sql}",
      remote: true,
    }],
    ratelimits: [{
      name: "WAITLIST_SIGNUP_LIMITER",
      namespace_id: String(namespaceId),
      simple: { limit: 120, period: 60 },
    }],
    vars: {
      D1_TOPOLOGY: "split",
      WAITLIST_SIGNUP_BACKEND: "d1",
      STRIPE_WEBHOOK_BACKEND: "d1",
      STRIPE_WEBHOOK_SECRET: syntheticSecret,
      AUTH_BACKEND: "better-auth",
      BETTER_AUTH_URL: origin,
      CUTOVER_WRITE_FREEZE: "false",
      CORS_ALLOWED_ORIGINS: origin,
      STAGING_NO_INDEX: "true",
    },
  };
  if (temporaryConfig.routes || temporaryConfig.assets || temporaryConfig.r2_buckets || temporaryConfig.triggers) {
    fail("temporary_worker_scope_invalid");
  }

  return { config: temporaryConfig, origin };
}

async function writeTemporaryConfig(config) {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  tempConfigWritten = true;
  activeConfigRelative = configName;
}

function getTemporaryDatabase() {
  return getTemporaryDatabaseByName(databaseName, "temporary_database_name_ambiguous");
}

function getTemporaryAuthDatabase() {
  return getTemporaryDatabaseByName(authDatabaseName, "temporary_auth_database_name_ambiguous");
}

function getTemporaryDatabaseByName(name, ambiguityCode) {
  const matches = databaseRows().filter((database) => databaseNameOf(database) === name);
  if (matches.length > 1) fail(ambiguityCode);
  return matches[0] ?? null;
}

function createDatabase() {
  creationMayHaveSucceeded = true;
  runWrangler(["d1", "create", databaseName, "--location=apac"], { configRelative: appConfigRelative });
  const database = getTemporaryDatabase();
  if (!database || typeof databaseIdOf(database) !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(databaseIdOf(database))) fail("temporary_database_create_readback_failed");
  databaseId = databaseIdOf(database);
  report.database.id = databaseId;
}

function createAuthDatabase() {
  authCreationMayHaveSucceeded = true;
  runWrangler(["d1", "create", authDatabaseName, "--location=apac"], { configRelative: appConfigRelative });
  const database = getTemporaryAuthDatabase();
  if (!database || typeof databaseIdOf(database) !== "string" ||
      !/^[0-9a-f-]{36}$/iu.test(databaseIdOf(database))) fail("temporary_auth_database_create_readback_failed");
  authDatabaseId = databaseIdOf(database);
  report.authDatabase.id = authDatabaseId;
}

function runD1On(targetDatabaseName, sql, { timeout = 120_000 } = {}) {
  const output = runWrangler([
    "d1", "execute", targetDatabaseName, "--remote", "--json", "--command", sql,
  ], { timeout });
  const result = parseJsonArray(output, "temporary_database_query_invalid");
  if (result.length !== 1 || result[0]?.success !== true || !Array.isArray(result[0]?.results)) {
    fail("temporary_database_query_failed");
  }
  if (result[0]?.meta?.changed_db !== false || Number(result[0]?.meta?.rows_written) !== 0) {
    fail("read_only_reconciliation_query_changed_database");
  }
  return result[0].results;
}

function runD1(sql, options) {
  return runD1On(databaseName, sql, options);
}

function writeD1(targetDatabaseName, sql, code) {
  const output = runWrangler([
    "d1", "execute", targetDatabaseName, "--remote", "--json", "--command", sql,
  ]);
  const result = parseJsonArray(output, code);
  if (result.length !== 1 || result[0]?.success !== true ||
      result[0]?.meta?.changed_db !== true || Number(result[0]?.meta?.rows_written) < 1) {
    fail(code);
  }
  return result[0].meta;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tableRowsForEmail(email) {
  return runD1(`SELECT id, email, referral_source, status, created_at FROM waitlist WHERE email = ${sqlLiteral(email)} ORDER BY id`);
}

function stripeLedgerRows(eventIds) {
  const values = eventIds.map(sqlLiteral).join(", ");
  return runD1(`
    SELECT r.stripe_event_id, r.id AS receipt_id, r.status AS receipt_status,
      r.delivery_count, r.normalized_payload_sha256, r.raw_payload_sha256,
      d.id AS dispatch_id, d.status AS dispatch_status, d.attempt_count
    FROM stripe_webhook_receipts AS r
    LEFT JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.livemode = 0 AND r.stripe_event_id IN (${values})
    ORDER BY r.stripe_event_id
  `);
}

function signEvent(eventId, objectId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: webhookApiVersion,
    created: timestamp,
    livemode: false,
    type: "customer.updated",
    data: { object: { id: objectId, object: "customer" } },
  });
  const signature = createHmac("sha256", syntheticSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return { rawBody, signature: `t=${timestamp},v1=${signature}` };
}

async function postEvent(origin, signed) {
  const response = await fetch(`${origin}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signed.signature },
    body: signed.rawBody,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (response.status !== 200) fail(`stripe_receipt_http_${response.status}`);
  if (body?.received !== true) fail("stripe_receipt_acknowledgement_invalid");
}

async function seedSyntheticAuthAccount() {
  // Keep the disposable recovery fixture under the Workers Free CPU ceiling.
  // Password-format compatibility is covered by the separate staging canary.
  const generatedHash = await bcrypt.hash(syntheticAuthPassword, 4);
  if (!generatedHash.startsWith("$2b$04$")) fail("synthetic_auth_bcrypt_format_invalid");
  const passwordHash = generatedHash.replace(/^\$2b\$/u, () => "$2a$");
  if (!(await bcrypt.compare(syntheticAuthPassword, passwordHash))) fail("synthetic_auth_bcrypt_fixture_invalid");
  const now = new Date().toISOString();
  writeD1(authDatabaseName, `
    INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (${sqlLiteral(syntheticAuthUserId)}, 'Synthetic recovery user', ${sqlLiteral(syntheticAuthEmail)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)});
  `, "synthetic_auth_seed_failed");
  writeD1(authDatabaseName, `
    INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
    VALUES (${sqlLiteral(syntheticAuthAccountId)}, ${sqlLiteral(syntheticAuthUserId)}, 'credential', ${sqlLiteral(syntheticAuthUserId)}, ${sqlLiteral(passwordHash)}, ${sqlLiteral(now)}, ${sqlLiteral(now)});
  `, "synthetic_auth_seed_failed");
  return passwordHash;
}

async function signInSyntheticUser(origin) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: syntheticAuthEmail, password: syntheticAuthPassword }),
    signal: AbortSignal.timeout(15_000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200 || body?.user?.id !== syntheticAuthUserId) {
    fail(`synthetic_auth_sign_in_http_${response.status}`);
  }
  const cookie = (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
  if (!/(?:__Secure-)?better-auth\.session_token=/iu.test(cookie)) fail("synthetic_auth_session_cookie_missing");
  const session = await readSyntheticSession(origin, cookie);
  if (session?.user?.id !== syntheticAuthUserId || typeof session?.session?.id !== "string") {
    fail("synthetic_auth_session_identity_mismatch");
  }
  return { cookie, sessionId: session.session.id };
}

async function readSyntheticSession(origin, cookie) {
  const response = await fetch(`${origin}/api/auth/get-session`, {
    headers: { origin, cookie },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) fail(`synthetic_auth_session_http_${response.status}`);
  return response.json();
}

function syntheticAuthState(passwordHash) {
  const users = runD1On(authDatabaseName, `
    SELECT id, name, email, emailVerified, createdAt, updatedAt
    FROM "user" WHERE id = ${sqlLiteral(syntheticAuthUserId)} ORDER BY id
  `);
  const accounts = runD1On(authDatabaseName, `
    SELECT id, accountId, providerId, userId, password, createdAt, updatedAt
    FROM account WHERE id = ${sqlLiteral(syntheticAuthAccountId)} ORDER BY id
  `);
  const sessions = runD1On(authDatabaseName, `
    SELECT id, userId, expiresAt, createdAt, updatedAt
    FROM session WHERE userId = ${sqlLiteral(syntheticAuthUserId)} ORDER BY id
  `);
  if (users.length !== 1 || users[0]?.id !== syntheticAuthUserId ||
      users[0]?.email !== syntheticAuthEmail || Number(users[0]?.emailVerified) !== 1 ||
      accounts.length !== 1 || accounts[0]?.id !== syntheticAuthAccountId ||
      accounts[0]?.accountId !== syntheticAuthUserId || accounts[0]?.providerId !== "credential" ||
      accounts[0]?.userId !== syntheticAuthUserId || accounts[0]?.password !== passwordHash ||
      sessions.some((row) => row?.userId !== syntheticAuthUserId)) {
    fail("synthetic_auth_state_mismatch");
  }
  return {
    user: users[0],
    account: {
      id: accounts[0].id,
      accountId: accounts[0].accountId,
      providerId: accounts[0].providerId,
      userId: accounts[0].userId,
      credentialMatches: true,
      createdAt: accounts[0].createdAt,
      updatedAt: accounts[0].updatedAt,
    },
    sessions,
  };
}

async function waitForRoute(origin, expected) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/waitlist`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin },
        body: "recovery-readiness-probe",
        signal: AbortSignal.timeout(5_000),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // Readiness is based on the route's status and stable error code.
      }
      if (expected === "active" && response.status === 415) return;
      if (expected === "frozen" && response.status === 503 && body?.error === "cutover_write_freeze") return;
      const staleStatus = expected === "active" ? 404 : 415;
      if (response.status !== staleStatus) fail(`worker_readiness_unexpected_${response.status}`);
    } catch (error) {
      if (error instanceof Error && /^worker_readiness_unexpected_/u.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail(`worker_${expected}_deployment_not_ready`);
}

async function postWaitlist(origin, email, referralSource) {
  const response = await fetch(`${origin}/api/waitlist`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, referral_source: referralSource }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (response.status !== 202) fail(`waitlist_write_http_${response.status}`);
  if (body?.schemaVersion !== 1 || body?.accepted !== true || Object.keys(body).length !== 2) {
    fail("waitlist_write_acknowledgement_invalid");
  }
}

async function postWaitlistDuringFreeze(origin) {
  const response = await fetch(`${origin}/api/waitlist`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: emailDuringFreeze, referral_source: referralDuringFreeze }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "cutover_write_freeze");
}

function assertOneWaitingRow(rows, email, referralSource) {
  const row = rows[0];
  if (rows.length !== 1 || row?.email !== email || row?.referral_source !== referralSource ||
      row?.status !== "waiting" || !Number.isFinite(Date.parse(row?.created_at))) {
    fail("waitlist_write_readback_mismatch");
  }
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function applyBusinessMigrations() {
  const expectedMigrations = readdir(migrationDirectory);
  return expectedMigrations.then(async (names) => {
    const expected = names.filter((name) => name.endsWith(".sql")).sort();
    if (expected.length === 0) fail("business_migrations_missing");
    report.database.expectedMigrationCount = expected.length;
    runWrangler(["d1", "migrations", "apply", databaseName, "--remote"], { input: "y\n", timeout: 300_000 });
    const applied = runD1("SELECT name FROM d1_migrations ORDER BY name").map((row) => row.name);
    assert.deepEqual(applied, expected, "temporary D1 migration ledger differs from checked-in business migrations");
  });
}

async function applyAuthMigrations(config) {
  const expected = [
    "0003_better_auth_core.sql",
    "0007_auth_signup_command.sql",
    "0008_auth_user_suspension.sql",
  ];
  for (const name of expected) {
    if (!readFileSync(path.join(authMigrationDirectory, name), "utf8")) fail("auth_migration_missing");
  }
  report.authDatabase.expectedMigrationCount = expected.length;
  const authBinding = config.d1_databases.find((entry) => entry.binding === "AUTH_DB");
  if (!authBinding) fail("temporary_auth_binding_missing");
  for (let index = 0; index < expected.length; index += 1) {
    const selected = expected.slice(0, index + 1);
    authBinding.migrations_pattern = `migrations/{${[...selected, "0000_recovery_sentinel_missing.sql"].join(",")}}`;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    report.phase = `apply_auth_migration_${expected[index].replace(/[^a-z0-9]+/giu, "_").replace(/_+$/u, "")}`;
    runWrangler(["d1", "migrations", "apply", authDatabaseName, "--remote"], {
      input: "y\n",
      timeout: 300_000,
    });
    const applied = runD1On(authDatabaseName, "SELECT name FROM d1_migrations ORDER BY name").map((row) => row.name);
    report.authDatabase.appliedMigrationNames = applied;
    if (JSON.stringify(applied) !== JSON.stringify(selected)) fail("auth_migration_ledger_mismatch");
  }
  authBinding.migrations_pattern = `migrations/{${expected.join(",")}}`;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function createBookmark(targetDatabaseName, reportKey) {
  const result = parseJson(
    runWrangler(["d1", "time-travel", "info", targetDatabaseName, "--json"]),
    "time_travel_info_invalid",
  );
  if (typeof result.bookmark !== "string" || result.bookmark.length === 0) fail("time_travel_bookmark_missing");
  report.recovery[reportKey] = result.bookmark;
  return result.bookmark;
}

function deployTemporaryWorker(config) {
  workerMayExist = true;
  const result = runWrangler(["deploy", "--message", "synthetic post-write recovery rehearsal"], { timeout: 240_000 });
  report.worker.deployedVersion = result.match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1] ?? null;
  return result;
}

function setTemporaryAuthSecret() {
  runWrangler(["secret", "put", "BETTER_AUTH_SECRET"], {
    input: `${syntheticAuthSecret}\n`,
    timeout: 120_000,
  });
}

function changeFreeze(config, frozen) {
  config.vars.CUTOVER_WRITE_FREEZE = frozen ? "true" : "false";
  return writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function restoreToBookmark(targetDatabaseName, bookmark) {
  const started = performance.now();
  runWrangler([
    "d1", "time-travel", "restore", targetDatabaseName,
    `--bookmark=${bookmark}`, "--json",
  ], { input: "y\n", timeout: 180_000 });
  return started;
}

async function runDrill() {
  requireExplicitStagingWrite();
  assertPrivateStagingTarget();
  report.phase = "create_disposable_d1s";
  createDatabase();
  createAuthDatabase();

  report.phase = "create_temporary_worker_config";
  const { config, origin } = createTemporaryConfig();
  report.worker.origin = origin;
  await writeTemporaryConfig(config);
  report.phase = "apply_and_verify_business_auth_migrations";
  await applyBusinessMigrations();
  await applyAuthMigrations(config);
  report.phase = "deploy_temporary_worker";
  deployTemporaryWorker(config);
  report.phase = "configure_synthetic_better_auth_secret";
  setTemporaryAuthSecret();
  deployTemporaryWorker(config);
  report.phase = "wait_for_active_worker_route";
  await waitForRoute(origin, "active");

  report.phase = "seed_and_sign_in_synthetic_auth_user";
  const passwordHash = await seedSyntheticAuthAccount();
  const firstAuthSession = await signInSyntheticUser(origin);
  const firstAuthState = syntheticAuthState(passwordHash);
  assert.equal(firstAuthState.sessions.length, 1);

  report.phase = "acknowledge_synthetic_waitlist_receipt_and_auth_state";
  await postWaitlist(origin, emailBeforeBookmark, referralBeforeBookmark);
  assertOneWaitingRow(tableRowsForEmail(emailBeforeBookmark), emailBeforeBookmark, referralBeforeBookmark);
  const signedFirstEvent = signEvent(firstEventId, firstObjectId);
  await postEvent(origin, signedFirstEvent);
  await postEvent(origin, signedFirstEvent);
  const firstLedger = stripeLedgerRows([firstEventId]);
  assert.equal(firstLedger.length, 1);
  assert.equal(firstLedger[0].receipt_status, "received");
  assert.equal(Number(firstLedger[0].delivery_count), 2);
  assert.equal(firstLedger[0].dispatch_status, "pending");
  assert.ok(/^[0-9a-f]{64}$/u.test(firstLedger[0].normalized_payload_sha256));
  assert.ok(/^[0-9a-f]{64}$/u.test(firstLedger[0].raw_payload_sha256));

  const acknowledgedState = {
    waitlist: tableRowsForEmail(emailBeforeBookmark),
    stripeLedger: stripeLedgerRows([firstEventId]),
    auth: syntheticAuthState(passwordHash),
  };
  assertOneWaitingRow(acknowledgedState.waitlist, emailBeforeBookmark, referralBeforeBookmark);
  assert.equal(acknowledgedState.auth.sessions.length, 1);
  report.recovery.acknowledgedDigest = hash(acknowledgedState);
  report.phase = "capture_business_and_auth_recovery_bookmarks";
  const bookmark = createBookmark(databaseName, "bookmark");
  const authBookmark = createBookmark(authDatabaseName, "authBookmark");

  report.phase = "acknowledge_post_bookmark_business_and_auth_writes";
  await postWaitlist(origin, emailAfterBookmark, referralAfterBookmark);
  assertOneWaitingRow(tableRowsForEmail(emailAfterBookmark), emailAfterBookmark, referralAfterBookmark);
  const secondAuthSession = await signInSyntheticUser(origin);
  assert.notEqual(secondAuthSession.sessionId, firstAuthSession.sessionId);
  assert.equal(syntheticAuthState(passwordHash).sessions.length, 2);
  const laterLedger = stripeLedgerRows([firstEventId]);
  assert.deepEqual(laterLedger, firstLedger, "no Stripe receipt may be accepted after the recovery bookmark");

  report.phase = "freeze_temporary_worker";
  await changeFreeze(config, true);
  const frozenDeploy = runWrangler(["deploy", "--message", "freeze synthetic Worker for forward recovery"], { timeout: 240_000 });
  report.worker.frozenVersion = frozenDeploy.match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1] ?? null;
  await waitForRoute(origin, "frozen");
  await postWaitlistDuringFreeze(origin);
  assert.equal(tableRowsForEmail(emailDuringFreeze).length, 0, "frozen mutation must not reach D1");

  report.phase = "restore_and_reconcile_bookmark";
  const restoreStarted = restoreToBookmark(databaseName, bookmark);
  restoreToBookmark(authDatabaseName, authBookmark);
  const restoredState = {
    waitlist: tableRowsForEmail(emailBeforeBookmark),
    stripeLedger: stripeLedgerRows([firstEventId]),
    auth: syntheticAuthState(passwordHash),
  };
  report.recovery.reconciliationMs = Math.round(performance.now() - restoreStarted);
  assert.deepEqual(restoredState, acknowledgedState, "acknowledged business and Stripe rows changed after restore");
  const survivingAuthSession = await readSyntheticSession(origin, firstAuthSession.cookie);
  if (survivingAuthSession?.user?.id !== syntheticAuthUserId ||
      survivingAuthSession?.session?.id !== firstAuthSession.sessionId) {
    fail("acknowledged_auth_session_failed_after_restore");
  }
  assert.equal(tableRowsForEmail(emailAfterBookmark).length, 0, "post-bookmark synthetic row survived restore");
  assert.equal(tableRowsForEmail(emailDuringFreeze).length, 0, "frozen synthetic marker reached D1");
  assert.equal(stripeLedgerRows([firstEventId]).length, 1);
  const orphanDispatches = runD1(`
    SELECT COUNT(*) AS count FROM stripe_webhook_dispatches AS d
    LEFT JOIN stripe_webhook_receipts AS r
      ON r.id = d.receipt_id AND r.livemode = d.livemode AND r.stripe_event_id = d.stripe_event_id
    WHERE d.stripe_event_id = ${sqlLiteral(firstEventId)} AND r.id IS NULL
  `);
  assert.equal(Number(orphanDispatches[0]?.count), 0);
  report.recovery.reconciledDigest = hash(restoredState);
  report.phase = "complete";
  report.status = "passed";
}

function runCleanup(args, options = {}) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args, "--config", options.configRelative ?? activeConfigRelative], {
    cwd: workerRoot,
    encoding: "utf8",
    input: options.input ?? "y\n",
    env: { ...process.env, CI: "1" },
    timeout: options.timeout ?? 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("temporary_resource_cleanup_failed");
}

function temporaryWorkerExists() {
  const result = spawnSync(process.execPath, [
    wranglerCli, "deployments", "list", "--name", workerName, "--json", "--config", configName,
  ], {
    cwd: workerRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (!result.error && result.status === 0) {
    const deployments = parseJsonArray(result.stdout ?? "", "temporary_worker_readback_invalid");
    return deployments.length > 0 ? true : null;
  }
  if (/This Worker does not exist on your account\. \[code: 10007\]/u.test(result.stderr ?? "")) return false;
  return null;
}

async function cleanup() {
  let cleanupFailed = false;
  if (workerMayExist && tempConfigWritten) {
    try {
      const exists = temporaryWorkerExists();
      if (exists === null) fail("temporary_worker_cleanup_presence_unknown");
      if (exists) runCleanup(["delete", workerName], { configRelative: configName });
      if (temporaryWorkerExists() !== false) fail("temporary_worker_cleanup_readback_failed");
      report.cleanup.workerDeleted = true;
      workerMayExist = false;
    } catch {
      cleanupFailed = true;
    }
  }

  if (creationMayHaveSucceeded && !workerMayExist) {
    try {
      const database = getTemporaryDatabase();
      if (database) {
        const id = databaseIdOf(database);
        if (databaseId && id !== databaseId) fail("temporary_database_cleanup_identity_mismatch");
        databaseId = id;
        runCleanup(["d1", "delete", databaseName, "--skip-confirmation"], { configRelative: appConfigRelative });
      }
      if (databaseRows().some((database) => databaseNameOf(database) === databaseName)) {
        fail("temporary_database_cleanup_readback_failed");
      }
      report.cleanup.databaseDeleted = true;
    } catch {
      cleanupFailed = true;
    }
  }

  if (authCreationMayHaveSucceeded && !workerMayExist) {
    try {
      const database = getTemporaryAuthDatabase();
      if (database) {
        const id = databaseIdOf(database);
        if (authDatabaseId && id !== authDatabaseId) fail("temporary_auth_database_cleanup_identity_mismatch");
        authDatabaseId = id;
        runCleanup(["d1", "delete", authDatabaseName, "--skip-confirmation"], { configRelative: appConfigRelative });
      }
      if (databaseRows().some((database) => databaseNameOf(database) === authDatabaseName)) {
        fail("temporary_auth_database_cleanup_readback_failed");
      }
      report.cleanup.authDatabaseDeleted = true;
      authCreationMayHaveSucceeded = false;
    } catch {
      cleanupFailed = true;
    }
  }

  if (tempConfigWritten) {
    try {
      await rm(configPath, { force: true });
      report.cleanup.configDeleted = true;
      tempConfigWritten = false;
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    report.status = "cleanup_failed";
    if (primaryError) process.stderr.write("postwrite_recovery_cleanup_failed_after_test_error\n");
  }
}

async function writeReport() {
  await mkdir(path.dirname(tempReportPath), { recursive: true, mode: 0o700 });
  report.finishedAt = new Date().toISOString();
  await writeFile(tempReportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

try {
  await runDrill();
} catch (error) {
  primaryError = error;
  report.status = "failed";
  const errorName = error && typeof error === "object" ? error.name : null;
  report.failureKind = typeof errorName === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(errorName)
    ? errorName
    : "UnknownError";
  const errorMessage = error instanceof Error ? error.message : "";
  report.failureCode = /^[a-z0-9_.-]{1,100}$/iu.test(errorMessage) ? errorMessage : null;
} finally {
  await cleanup();
  if (report.status === "cleanup_failed") primaryError ??= new Error("temporary_resource_cleanup_failed");
  try {
    await writeReport();
  } catch {
    primaryError ??= new Error("private_recovery_report_write_failed");
  }
}

if (primaryError) {
  const code = primaryError instanceof Error && /^[a-z0-9_.-]{1,100}$/iu.test(primaryError.message)
    ? primaryError.message
    : "postwrite_recovery_smoke_failed";
  process.stderr.write(
    `FAIL ${code} at ${report.phase}${report.lastFailedDiagnostic ? `: ${report.lastFailedDiagnostic}` : ""}\n`,
  );
  process.stderr.write(`Private report: ${tempReportPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `PASS synthetic post-write Cloudflare recovery: business/Auth D1 migrations ` +
    `${report.database.expectedMigrationCount}/${report.authDatabase.expectedMigrationCount}, ` +
    `reconciled bookmark ${report.recovery.reconciliationMs} ms.\n` +
    `Temporary Worker/business/Auth D1 cleanup: ${report.cleanup.workerDeleted}/` +
    `${report.cleanup.databaseDeleted}/${report.cleanup.authDatabaseDeleted}; ` +
    `private report: ${tempReportPath}\n`,
  );
}

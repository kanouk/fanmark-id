#!/usr/bin/env node

/** Verify authenticated subscription display against isolated Cloudflare staging using synthetic rows only. */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
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
    SELECT COUNT(*) AS count FROM user_subscriptions
    WHERE id IN (${subscriptionIds.map(sql).join(", ")})
       OR user_id IN (${sql(userId)}, ${sql(`decoy-${userId}`)});
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
  if (Number(businessCounts[0]?.count) !== 0 || Object.values(authCounts[0] ?? {}).some((count) => Number(count) !== 0)) {
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
  const now = new Date().toISOString();
  const initialPeriodEnd = "2030-09-28T00:00:00.000000Z";
  const updatedPeriodEnd = "2030-10-28T00:00:00.000000Z";
  const cleanupIdentity = `${userId}`;
  let cleanupNeeded = false;
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

    cleanupNeeded = true;
    const passwordHash = await bcrypt.hash(userPassword, 10);
    runD1(AUTH_CONFIG, AUTH_DATABASE, `
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${sql(userId)}, 'Synthetic subscription display', ${sql(userEmail)}, 1, ${sql(now)}, ${sql(now)});
      INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES (${sql(randomUUID())}, ${sql(userId)}, 'credential', ${sql(userId)}, ${sql(passwordHash)}, ${sql(now)}, ${sql(now)});
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
      SET current_period_end = ${sql(updatedPeriodEnd)}, amount = 2345, updated_at = ${sql(new Date().toISOString())}
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

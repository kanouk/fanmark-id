#!/usr/bin/env node

/** Verify frozen staging Stripe receipt intake with one synthetic signed event. */

import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerDirectory = path.join(repoRoot, "workers/api");
const configRelativePath = "wrangler.app-staging.jsonc";
const configPath = path.join(workerDirectory, configRelativePath);
const wrangler = path.join(workerDirectory, "node_modules/.bin/wrangler");
const accountId = "bfc2890741f0b3fb236e2d755b6c9adc";
const businessName = "fanmark-business-staging";
const businessId = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const workerName = "fanmark-app-staging";
const origin = "https://fanmark-app-staging.fanmark-id.workers.dev";
const webhookSecretName = "STRIPE_WEBHOOK_SECRET";

function fail(code) {
  throw new Error(code);
}

function requireExplicitStagingWrite() {
  const flags = new Set(process.argv.slice(2));
  const expected = [
    "--run-live-staging-write",
    `--database=${businessName}`,
    `--account-id=${accountId}`,
    "--confirm-no-stripe-api",
  ];
  if (flags.size !== expected.length || expected.some((flag) => !flags.has(flag))) {
    fail(`refusing_remote_staging_write; pass ${expected.join(" ")}`);
  }
}

function runWrangler(args, { input, sensitive = false, timeout = 180_000 } = {}) {
  const result = spawnSync(wrangler, [...args, "--config", configRelativePath], {
    cwd: workerDirectory,
    encoding: "utf8",
    input,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(sensitive ? "staging_secret_operation_failed" : "staging_wrangler_operation_failed");
  }
  return result.stdout ?? "";
}

function parseJsonArray(output) {
  const normalized = output.replace(/\u001b\[[0-9;]*m/gu, "").trim();
  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start < 0 || end < start) fail("staging_wrangler_json_invalid");
  try {
    return JSON.parse(normalized.slice(start, end + 1));
  } catch {
    fail("staging_wrangler_json_invalid");
  }
}

function parseJsonObject(output) {
  try {
    return JSON.parse(output.trim());
  } catch {
    fail("staging_wrangler_json_invalid");
  }
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function query(sql) {
  const response = parseJsonArray(runWrangler([
    "d1", "execute", businessName, "--remote", "--json", "--command", sql,
  ]));
  if (!Array.isArray(response) || response.length !== 1 || response[0]?.success !== true ||
      !Array.isArray(response[0]?.results)) {
    fail("staging_business_d1_query_failed");
  }
  return response[0].results;
}

function inspectTarget() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const businessBinding = config.d1_databases?.find((database) => database.binding === "FANMARK_DB");
  if (config.name !== workerName || config.account_id !== accountId || config.workers_dev !== true ||
      (config.routes?.length ?? 0) !== 0 || businessBinding?.database_name !== businessName ||
      businessBinding?.database_id !== businessId || businessBinding?.remote !== true ||
      config.vars?.CUTOVER_WRITE_FREEZE !== "false" || config.vars?.STRIPE_WEBHOOK_BACKEND ||
      config.vars?.STRIPE_DISPATCH_BACKEND || config.vars?.STRIPE_EXTENSION_CHECKOUT_BACKEND) {
    fail("staging_worker_config_mismatch");
  }

  const identity = parseJsonObject(runWrangler(["whoami", "--json"]));
  if (identity.loggedIn !== true || identity.accounts?.some((account) => account.id === accountId) !== true) {
    fail("staging_account_identity_mismatch");
  }

  const secrets = parseJsonArray(runWrangler(["secret", "list"]));
  if (secrets.some((secret) => secret?.name === webhookSecretName ||
      /^STRIPE_(?:SECRET|API|WEBHOOK)_/iu.test(secret?.name ?? ""))) {
    fail("staging_stripe_secret_already_present");
  }

  const counts = query(`SELECT
    (SELECT COUNT(*) FROM stripe_webhook_receipts) AS receipts,
    (SELECT COUNT(*) FROM stripe_webhook_dispatches) AS dispatches`)[0];
  if (Number(counts?.receipts) !== 0 || Number(counts?.dispatches) !== 0) {
    fail("staging_stripe_ledger_not_empty");
  }
}

function deployTemporaryFreeze() {
  return runWrangler([
    "deploy",
    "--var", "CUTOVER_WRITE_FREEZE:true",
    "--var", "STRIPE_WEBHOOK_BACKEND:d1",
    "--message", "synthetic Stripe receipt continuity rehearsal",
  ]);
}

function restoreOrdinaryStaging() {
  return runWrangler([
    "deploy",
    "--message", "restore staging after Stripe receipt continuity rehearsal",
  ]);
}

function signedEvent(eventId, objectId, secret) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-08-27.basil",
    created: nowSeconds,
    livemode: false,
    type: "customer.updated",
    data: { object: { id: objectId, object: "customer" } },
  });
  const signature = createHmac("sha256", secret)
    .update(`${nowSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return {
    rawBody,
    signature: `t=${nowSeconds},v1=${signature}`,
  };
}

async function postSyntheticReceipt(rawBody, signature) {
  const response = await fetch(`${origin}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: rawBody,
  });
  const body = await response.json();
  assert.equal(response.status, 200, "synthetic Stripe receipt was not durably accepted");
  assert.equal(body.received, true);
  return body;
}

async function cleanupEvent(eventId) {
  if (!eventId) return;
  const literal = quoteSql(eventId);
  query(`DELETE FROM stripe_webhook_dispatches WHERE stripe_event_id = ${literal}`);
  query(`DELETE FROM stripe_webhook_receipts WHERE stripe_event_id = ${literal}`);
  const remaining = query(`SELECT
    (SELECT COUNT(*) FROM stripe_webhook_receipts WHERE stripe_event_id = ${literal}) AS receipts,
    (SELECT COUNT(*) FROM stripe_webhook_dispatches WHERE stripe_event_id = ${literal}) AS dispatches`)[0];
  assert.equal(Number(remaining?.receipts), 0, "synthetic Stripe receipt cleanup failed");
  assert.equal(Number(remaining?.dispatches), 0, "synthetic Stripe dispatch cleanup failed");
}

function deleteWebhookSecret() {
  const secrets = parseJsonArray(runWrangler(["secret", "list"]));
  if (!secrets.some((secret) => secret?.name === webhookSecretName)) return;
  const result = spawnSync(wrangler, [
    "secret", "delete", webhookSecretName, "--config", configRelativePath,
  ], {
    cwd: workerDirectory,
    encoding: "utf8",
    input: "y\n",
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("staging_secret_cleanup_failed");
}

async function verifyRestoredState() {
  const [home, health, webhook, protectedRoute] = await Promise.all([
    fetch(origin),
    fetch(`${origin}/api/auth/ok`),
    fetch(`${origin}/api/stripe/webhook`),
    fetch(`${origin}/api/admin/broadcast-emails`, { method: "POST", body: "{}" }),
  ]);
  assert.equal(home.status, 200, "staging SPA did not recover");
  assert.equal(health.status, 200, "staging Auth health did not recover");
  assert.equal(webhook.status, 404, "Stripe webhook selector remained enabled");
  assert.equal(protectedRoute.status, 401, "write freeze remained enabled after restore");
  const secrets = parseJsonArray(runWrangler(["secret", "list"]));
  assert.equal(secrets.some((secret) => secret?.name === webhookSecretName), false,
    "temporary Stripe webhook secret remained configured");
  const counts = query(`SELECT
    (SELECT COUNT(*) FROM stripe_webhook_receipts) AS receipts,
    (SELECT COUNT(*) FROM stripe_webhook_dispatches) AS dispatches`)[0];
  assert.equal(Number(counts?.receipts), 0, "Stripe receipt ledger did not return to baseline");
  assert.equal(Number(counts?.dispatches), 0, "Stripe dispatch ledger did not return to baseline");
}

async function main() {
  requireExplicitStagingWrite();
  inspectTarget();

  const eventId = `evt_synthetic_cutover_${randomUUID().replaceAll("-", "")}`;
  const objectId = `cus_synthetic_cutover_${randomUUID().replaceAll("-", "")}`;
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const startedAt = Date.now();
  let secretMayExist = false;
  let temporaryDeployAttempted = false;
  let failure = null;
  let acceptedOutcome = null;
  let duplicateOutcome = null;
  let temporaryVersion = null;
  let restoredVersion = null;

  try {
    secretMayExist = true;
    runWrangler(["secret", "put", webhookSecretName], { input: `${secret}\n`, sensitive: true });

    temporaryDeployAttempted = true;
    const deployment = deployTemporaryFreeze();
    temporaryVersion = deployment.match(/Current Version ID:\s*([0-9a-f-]{36})/iu)?.[1] ?? null;

    const [frozenWrite, signInPreflight] = await Promise.all([
      fetch(`${origin}/api/admin/broadcast-emails`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      fetch(`${origin}/api/auth/sign-in/email`, { method: "OPTIONS" }),
    ]);
    assert.equal(frozenWrite.status, 503, "write freeze did not reject application mutation");
    assert.equal((await frozenWrite.json()).error, "cutover_write_freeze");
    assert.equal(signInPreflight.status, 204, "login preflight was blocked during cutover freeze");

    const { rawBody, signature } = signedEvent(eventId, objectId, secret);
    const accepted = await postSyntheticReceipt(rawBody, signature);
    acceptedOutcome = accepted.outcome;
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.receipt_status, "received");
    assert.equal(accepted.dispatch_status, "pending");

    const duplicate = await postSyntheticReceipt(rawBody, signature);
    duplicateOutcome = duplicate.outcome;
    assert.equal(duplicate.outcome, "duplicate_nonterminal");
    assert.equal(duplicate.receipt_status, "received");
    assert.equal(duplicate.dispatch_status, "pending");

    const rows = query(`SELECT receipt.event_type, receipt.status AS receipt_status,
      receipt.delivery_count, dispatch.status AS dispatch_status
      FROM stripe_webhook_receipts AS receipt
      JOIN stripe_webhook_dispatches AS dispatch ON dispatch.receipt_id = receipt.id
      WHERE receipt.stripe_event_id = ${quoteSql(eventId)} LIMIT 2`);
    assert.equal(rows.length, 1, "synthetic event did not create exactly one receipt/dispatch pair");
    assert.equal(rows[0].event_type, "customer.updated");
    assert.equal(rows[0].receipt_status, "received");
    assert.equal(Number(rows[0].delivery_count), 2);
    assert.equal(rows[0].dispatch_status, "pending");
  } catch (error) {
    failure = error instanceof Error ? error : new Error("staging_stripe_rehearsal_failed");
  } finally {
    const cleanupErrors = [];
    try {
      cleanupEvent(eventId);
    } catch {
      cleanupErrors.push("receipt_rows");
    }
    if (secretMayExist) {
      try {
        deleteWebhookSecret();
      } catch {
        cleanupErrors.push("webhook_secret");
      }
    }
    if (temporaryDeployAttempted) {
      try {
        const restored = restoreOrdinaryStaging();
        restoredVersion = restored.match(/Current Version ID:\s*([0-9a-f-]{36})/iu)?.[1] ?? null;
      } catch {
        cleanupErrors.push("ordinary_worker_deployment");
      }
    }
    if (temporaryDeployAttempted && cleanupErrors.length === 0) {
      try {
        await verifyRestoredState();
      } catch {
        cleanupErrors.push("restored_state_readback");
      }
    }
    if (cleanupErrors.length > 0) {
      const cleanupFailure = new Error(`staging_cleanup_incomplete:${cleanupErrors.join(",")}`);
      if (failure) cleanupFailure.cause = failure;
      failure = cleanupFailure;
    }
  }

  if (failure) throw failure;
  console.log(JSON.stringify({
    status: "passed",
    eventId,
    acceptedOutcome,
    duplicateOutcome,
    temporaryVersion,
    restoredVersion,
    elapsedMs: Date.now() - startedAt,
    finalReceiptCount: 0,
    finalDispatchCount: 0,
    stripeApiCalls: 0,
  }));
}

main().catch((error) => {
  const code = error instanceof Error ? error.message : "staging_stripe_rehearsal_failed";
  console.error(code);
  process.exitCode = 1;
});

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
const localResumeSmoke = path.join(repoRoot, "scripts/migration/prewrite-supabase-resume-smoke.mjs");

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
    "--verify-loopback-supabase-resume",
  ];
  if (flags.size !== expected.length || expected.some((flag) => !flags.has(flag))) {
    fail(`refusing_remote_staging_write; pass ${expected.join(" ")}`);
  }
}

function assertLoopbackSupabasePrerequisites() {
  const supabase = spawnSync("supabase", ["--version"], { encoding: "utf8", windowsHide: true });
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  const resumeSource = readFileSync(localResumeSmoke, "utf8");
  if (supabase.error || supabase.status !== 0 || docker.error || docker.status !== 0 || !resumeSource.trim()) {
    fail("loopback_supabase_resume_prerequisite_failed");
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

function assertWaitlistMarkerAbsent(email, code) {
  const rows = query(`SELECT COUNT(*) AS count FROM waitlist WHERE email = ${quoteSql(email)}`);
  if (Number(rows[0]?.count) !== 0) fail(code);
}

function cleanupWaitlistMarker(email) {
  const literal = quoteSql(email);
  const existing = query(`SELECT COUNT(*) AS count FROM waitlist WHERE email = ${literal}`);
  if (Number(existing[0]?.count) > 1) fail("synthetic_waitlist_cleanup_ambiguous");
  if (Number(existing[0]?.count) === 1) query(`DELETE FROM waitlist WHERE email = ${literal}`);
  assertWaitlistMarkerAbsent(email, "synthetic_waitlist_cleanup_failed");
}

function runLoopbackSupabaseResume(rejectedAt) {
  const result = spawnSync(process.execPath, [localResumeSmoke], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, FANMARK_CUTOVER_REJECTED_AT: String(rejectedAt) },
    timeout: 420_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("loopback_supabase_resume_failed");
  const elapsed = result.stdout.match(/First owner-scoped user_settings update after the frozen Cloudflare rejection: (\d+) ms\./u)?.[1];
  if (!elapsed || !Number.isSafeInteger(Number(elapsed))) fail("loopback_supabase_resume_timing_missing");
  return Number(elapsed);
}

function inspectTarget() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const businessBinding = config.d1_databases?.find((database) => database.binding === "FANMARK_DB");
  if (config.name !== workerName || config.account_id !== accountId || config.workers_dev !== true ||
      (config.routes?.length ?? 0) !== 0 || businessBinding?.database_name !== businessName ||
      businessBinding?.database_id !== businessId || businessBinding?.remote !== true ||
      config.vars?.CUTOVER_WRITE_FREEZE !== "false" || config.vars?.WAITLIST_SIGNUP_BACKEND !== "d1" ||
      config.vars?.STRIPE_WEBHOOK_BACKEND ||
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

async function waitForFrozenWorker() {
  // An invalid body is rejected before the waitlist limiter or D1 insert when
  // the old version is still serving; under the freeze it gets the freeze code.
  // This probes rollout readiness without accepting a synthetic business write.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${origin}/api/waitlist`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "cutover-freeze-readiness-probe",
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Unexpected or stale responses are handled by status/code below.
    }
    if (response.status === 503 && body?.error === "cutover_write_freeze") return;
    if (response.status !== 415) fail(`freeze_readiness_probe_unexpected_${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  fail("freeze_deployment_not_ready_after_30s");
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

async function verifyRestoredState(waitlistEmail) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
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
      assertWaitlistMarkerAbsent(waitlistEmail, "synthetic_waitlist_marker_remained_after_restore");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error("staging_restore_readback_failed", { cause: lastError });
}

async function main() {
  requireExplicitStagingWrite();
  inspectTarget();
  assertLoopbackSupabasePrerequisites();

  const eventId = `evt_synthetic_cutover_${randomUUID().replaceAll("-", "")}`;
  const objectId = `cus_synthetic_cutover_${randomUUID().replaceAll("-", "")}`;
  const waitlistEmail = `synthetic-cutover-${randomUUID().replaceAll("-", "")}@example.invalid`;
  assertWaitlistMarkerAbsent(waitlistEmail, "synthetic_waitlist_marker_collision");
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const startedAt = Date.now();
  let secretMayExist = false;
  let temporaryDeployAttempted = false;
  let failure = null;
  let acceptedOutcome = null;
  let duplicateOutcome = null;
  let temporaryVersion = null;
  let restoredVersion = null;
  let firstOwnerSettingsUpdateAfterFreezeMs = null;
  let phase = "temporary_secret";

  try {
    secretMayExist = true;
    runWrangler(["secret", "put", webhookSecretName], { input: `${secret}\n`, sensitive: true });

    phase = "deploy_freeze";
    temporaryDeployAttempted = true;
    const deployment = deployTemporaryFreeze();
    temporaryVersion = deployment.match(/Current Version ID:\s*([0-9a-f-]{36})/iu)?.[1] ?? null;
    if (!temporaryVersion) fail("freeze_deployment_version_missing");
    await waitForFrozenWorker();

    phase = "reject_frozen_write";
    let frozenWriteRejectedAt = null;
    const [frozenWrite, signInPreflight] = await Promise.all([
      fetch(`${origin}/api/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: waitlistEmail, referral_source: "synthetic cutover rehearsal" }),
      }).then((response) => {
        frozenWriteRejectedAt = Date.now();
        return response;
      }),
      fetch(`${origin}/api/auth/sign-in/email`, { method: "OPTIONS" }),
    ]);
    if (frozenWrite.status !== 503) fail(`frozen_write_status_${frozenWrite.status}`);
    const frozenWriteBody = await frozenWrite.json();
    if (frozenWriteBody?.error !== "cutover_write_freeze") fail("frozen_write_response_mismatch");
    assertWaitlistMarkerAbsent(waitlistEmail, "frozen_waitlist_write_reached_d1");
    assert.equal(signInPreflight.status, 204, "login preflight was blocked during cutover freeze");

    phase = "resume_loopback_supabase";
    // Prove the source-shaped fallback remains writable while the isolated
    // Cloudflare staging Worker is frozen. This child starts only loopback
    // Supabase services and cleans its synthetic identity before returning.
    firstOwnerSettingsUpdateAfterFreezeMs = runLoopbackSupabaseResume(frozenWriteRejectedAt);
    assertWaitlistMarkerAbsent(waitlistEmail, "cloudflare_waitlist_changed_during_supabase_resume");

    phase = "stripe_receipt_continuity";
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
    const code = error instanceof Error && /^[a-z0-9_.-]{1,100}$/iu.test(error.message)
      ? error.message
      : "assertion_or_runtime_error";
    failure = new Error(`${phase}_${code}`, { cause: error });
  } finally {
    const cleanupErrors = [];
    try {
      cleanupWaitlistMarker(waitlistEmail);
    } catch {
      cleanupErrors.push("waitlist_marker");
    }
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
        await verifyRestoredState(waitlistEmail);
      } catch (error) {
        const code = error instanceof Error && /^[a-z0-9_.-]{1,100}$/iu.test(error.message)
          ? error.message
          : "assertion_or_runtime_error";
        cleanupErrors.push(`restored_state_readback_${code}`);
      }
    }
    if (cleanupErrors.length > 0) {
      const cleanupFailure = new Error(
        `staging_cleanup_incomplete_${cleanupErrors.join("_")}${failure ? `_after_${failure.message}` : ""}`,
      );
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
    firstOwnerSettingsUpdateAfterFreezeMs,
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

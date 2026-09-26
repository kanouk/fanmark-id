#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const ingressModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-ingress.ts");
const apiModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-api.ts");
const dispatchModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-dispatch.ts");
const migrationPath = path.join(repoRoot, "workers/api/migrations-business/0006_stripe_webhook_ingress_staging.sql");
const { acceptStripeWebhookReceiptIntoD1 } = await import(pathToFileURL(ingressModulePath).href);
const { handleStripeWebhookD1Request, isStripeWebhookPath } = await import(pathToFileURL(apiModulePath).href);
const {
  claimStripeWebhookDispatchesFromD1,
  renewStripeWebhookDispatchLeaseInD1,
  retryStripeWebhookDispatchInD1,
} = await import(pathToFileURL(dispatchModulePath).href);
const now = "2026-09-26T04:05:06.000Z";
const stripeSecret = "whsec_synthetic_worker_only";
const stripe = new Stripe("sk_test_local_signature_only", { apiVersion: "2025-08-27.basil" });

function splitSqlStatements(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gm, "");
  const statements = [];
  let current = "";
  let parentheses = 0;
  for (const line of source.split(/\r?\n/)) {
    current += `${line}\n`;
    for (const character of line) {
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
    }
    if (line.trimEnd().endsWith(";") && parentheses === 0) {
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) throw new Error("incomplete_sql_migration_statement");
  return statements;
}

async function createDatabase() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-stripe-webhook-d1-ingress-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-stripe-webhook-d1-ingress-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("DB");
  try {
    const sql = await fs.readFile(migrationPath, "utf8");
    for (const statement of splitSqlStatements(sql)) {
      const result = await database.prepare(statement).run();
      assert.equal(result.success, true, statement.slice(0, 120));
    }
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
  return { miniflare, database };
}

function event(overrides = {}) {
  return {
    stripeEventId: "evt_synthetic_d1_001",
    livemode: false,
    eventType: "customer.subscription.updated",
    objectType: "subscription",
    objectId: "sub_synthetic_d1_001",
    apiVersion: "2026-01-01",
    normalizedSchemaVersion: 1,
    normalizedPayload: { id: "evt_synthetic_d1_001", type: "customer.subscription.updated" },
    normalizedPayloadSha256: "a".repeat(64),
    rawPayloadSha256: "b".repeat(64),
    ...overrides,
  };
}

function signedStripeRequest(payload, { signatureOverride, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const signature = signatureOverride ?? stripe.webhooks.generateTestHeaderString({
    payload,
    secret: stripeSecret,
    timestamp,
  });
  return new Request("https://fanmark-staging.invalid/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: new TextEncoder().encode(payload),
  });
}

function rawStripeEvent(id = "evt_synthetic_worker_ingress") {
  return {
    id,
    object: "event",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_synthetic_worker_ingress",
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        amount_total: 1200,
        currency: "jpy",
        customer: "cus_synthetic_worker_ingress",
        payment_intent: "pi_synthetic_worker_ingress",
        client_reference_id: "user_synthetic_worker_ingress",
        metadata: {
          type: "license_extension",
          user_id: "user_synthetic_worker_ingress",
          license_id: "license_synthetic_worker_ingress",
          months: "3",
        },
      },
    },
  };
}

function ids(...values) {
  let position = 0;
  return () => `00000000-0000-4000-8000-${String(values[position++]).padStart(12, "0")}`;
}

async function row(database, sql, values = []) {
  return database.prepare(sql).bind(...values).first();
}

async function tableCount(database, table) {
  return row(database, `SELECT count(*) AS count FROM ${table}`).then((result) => result.count);
}

function accept(database, input = event(), idValues = [1, 2]) {
  return acceptStripeWebhookReceiptIntoD1({ database, event: input, now, createId: ids(...idValues) });
}

test("verified event acceptance is idempotent and records each matching delivery once", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const first = await accept(database);
    const duplicate = await accept(database, event(), [3, 4]);
    assert.equal(first.outcome, "accepted");
    assert.equal(duplicate.outcome, "duplicate_nonterminal");
    assert.equal(duplicate.receiptId, first.receiptId);
    assert.equal(duplicate.dispatchId, first.dispatchId);
    assert.equal(duplicate.deliveryCount, 2);
    assert.equal(duplicate.receiptStatus, "received");
    assert.equal(duplicate.dispatchStatus, "pending");
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 1);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("overlapping deliveries converge to one pair and test/live IDs stay separate", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const concurrent = await Promise.all([
      accept(database, event(), [10, 11]),
      accept(database, event(), [12, 13]),
    ]);
    assert.equal(concurrent.filter((result) => result.outcome === "accepted").length, 1);
    assert.equal(concurrent.filter((result) => result.outcome === "duplicate_nonterminal").length, 1);
    assert.equal(new Set(concurrent.map((result) => result.receiptId)).size, 1);
    assert.equal(new Set(concurrent.map((result) => result.dispatchId)).size, 1);

    const live = await accept(database, event({ livemode: true }), [14, 15]);
    assert.equal(live.outcome, "accepted");
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 2);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 2);
  } finally {
    await miniflare.dispose();
  }
});

test("immutable event conflicts are rejected without incrementing delivery count", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const first = await accept(database);
    await assert.rejects(
      () => accept(database, event({ eventType: "invoice.payment_succeeded" }), [3, 4]),
      /event_conflicts_with_immutable_receipt/u,
    );
    await assert.rejects(
      () => accept(database, event({ normalizedPayloadSha256: "c".repeat(64) }), [5, 6]),
      /event_conflicts_with_immutable_receipt/u,
    );
    const stored = await row(database, "SELECT event_type, normalized_payload_sha256, delivery_count FROM stripe_webhook_receipts WHERE id = ?", [first.receiptId]);
    assert.deepEqual(stored, {
      event_type: "customer.subscription.updated",
      normalized_payload_sha256: "a".repeat(64),
      delivery_count: 1,
    });
  } finally {
    await miniflare.dispose();
  }
});

test("invalid verified-event envelopes fail before a D1 write", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await assert.rejects(() => accept(database, event({ rawPayloadSha256: "bad" })), /invalid_payload_hash/u);
    await assert.rejects(() => accept(database, event({ livemode: 1 })), /invalid_livemode/u);
    await assert.rejects(() => accept(database, event({ normalizedPayload: [] })), /invalid_normalized_payload/u);
    await assert.rejects(() => accept(database, event({ normalizedPayload: { data: "x".repeat(64 * 1024) } })), /normalized_payload_too_large/u);
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 0);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("a missing dispatch is repaired, preserving terminal receipt state", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const first = await accept(database);
    await database.prepare("UPDATE stripe_webhook_receipts SET status = 'applied', terminal_at = ? WHERE id = ?")
      .bind(now, first.receiptId).run();
    await database.prepare("DELETE FROM stripe_webhook_dispatches WHERE id = ?").bind(first.dispatchId).run();

    const duplicate = await accept(database, event(), [3, 4]);
    assert.equal(duplicate.outcome, "duplicate_terminal");
    assert.equal(duplicate.receiptStatus, "applied");
    assert.equal(duplicate.dispatchStatus, "completed");
    assert.equal(duplicate.deliveryCount, 2);
    const repaired = await row(database, "SELECT status, completed_at FROM stripe_webhook_dispatches WHERE receipt_id = ?", [first.receiptId]);
    assert.deepEqual(repaired, { status: "completed", completed_at: now });
  } finally {
    await miniflare.dispose();
  }
});

test("inconsistent terminal state fails closed without changing the receipt", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const first = await accept(database);
    await database.prepare("UPDATE stripe_webhook_dispatches SET status = 'completed', completed_at = ? WHERE id = ?")
      .bind(now, first.dispatchId).run();
    await assert.rejects(() => accept(database, event(), [3, 4]), /nonterminal_receipt_dispatch_reconciliation_required/u);
    const state = await row(database, `
      SELECT r.status AS receipt_status, r.delivery_count, d.status AS dispatch_status
      FROM stripe_webhook_receipts AS r
      JOIN stripe_webhook_dispatches AS d ON d.receipt_id = r.id
      WHERE r.id = ?
    `, [first.receiptId]);
    assert.deepEqual(state, { receipt_status: "received", delivery_count: 1, dispatch_status: "completed" });
  } finally {
    await miniflare.dispose();
  }
});

test("dispatch insert failure rolls back a newly inserted receipt", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const first = await accept(database);
    await assert.rejects(() => accept(database, event({ stripeEventId: "evt_synthetic_d1_002" }), [3, 2]));
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 1);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 1);
    assert.equal(await row(database, "SELECT id FROM stripe_webhook_receipts WHERE stripe_event_id = ?", ["evt_synthetic_d1_002"]), null);
    assert.equal((await row(database, "SELECT id FROM stripe_webhook_dispatches WHERE id = ?", [first.dispatchId])).id, first.dispatchId);
  } finally {
    await miniflare.dispose();
  }
});

test("Worker webhook route verifies the signed raw body before durable D1 acknowledgement", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    assert.equal(isStripeWebhookPath("/api/stripe/webhook"), true);
    assert.equal(isStripeWebhookPath("/api/stripe/webhook/"), false);
    const rawBody = JSON.stringify(rawStripeEvent());
    const request = signedStripeRequest(rawBody);
    const env = {
      D1_TOPOLOGY: "split",
      FANMARK_DB: database,
      STRIPE_WEBHOOK_BACKEND: "d1",
      STRIPE_WEBHOOK_SECRET: stripeSecret,
    };

    const first = await handleStripeWebhookD1Request(request, env);
    assert.ok(first);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      received: true,
      outcome: "accepted",
      receipt_status: "received",
      dispatch_status: "pending",
    });
    const duplicate = await handleStripeWebhookD1Request(signedStripeRequest(rawBody), env);
    assert.ok(duplicate);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).outcome, "duplicate_nonterminal");
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 1);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("Worker webhook route rejects invalid or stale signatures and stays disabled by default", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const rawBody = JSON.stringify(rawStripeEvent("evt_synthetic_bad_signature"));
    const env = {
      D1_TOPOLOGY: "split",
      FANMARK_DB: database,
      STRIPE_WEBHOOK_BACKEND: "d1",
      STRIPE_WEBHOOK_SECRET: stripeSecret,
    };
    const invalid = await handleStripeWebhookD1Request(signedStripeRequest(rawBody, { signatureOverride: "t=1,v1=bad" }), env);
    assert.ok(invalid);
    assert.equal(invalid.status, 400);
    const stale = await handleStripeWebhookD1Request(signedStripeRequest(rawBody, { timestamp: Math.floor(Date.now() / 1000) - 3601 }), env);
    assert.ok(stale);
    assert.equal(stale.status, 400);
    assert.equal(await handleStripeWebhookD1Request(signedStripeRequest(rawBody), { FANMARK_DB: database }), null);
    assert.equal(await tableCount(database, "stripe_webhook_receipts"), 0);
    assert.equal(await tableCount(database, "stripe_webhook_dispatches"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("configured Worker ingress fails retryably when its secret or business D1 binding is missing", async () => {
  const missingSecret = await handleStripeWebhookD1Request(new Request("https://fanmark-staging.invalid/api/stripe/webhook", { method: "POST" }), {
    STRIPE_WEBHOOK_BACKEND: "d1",
    FANMARK_DB: {},
  });
  assert.ok(missingSecret);
  assert.equal(missingSecret.status, 503);
  const missingBinding = await handleStripeWebhookD1Request(new Request("https://fanmark-staging.invalid/api/stripe/webhook", { method: "POST" }), {
    STRIPE_WEBHOOK_BACKEND: "d1",
    STRIPE_WEBHOOK_SECRET: stripeSecret,
  });
  assert.ok(missingBinding);
  assert.equal(missingBinding.status, 503);
});

test("D1 claims only due nonterminal dispatches in the requested live/test mode", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const due = await accept(database, event({ stripeEventId: "evt_claim_due" }), [30, 31]);
    await accept(database, event({ stripeEventId: "evt_claim_future" }), [32, 33]);
    const terminal = await accept(database, event({ stripeEventId: "evt_claim_terminal" }), [34, 35]);
    await accept(database, event({ stripeEventId: "evt_claim_test_mode", livemode: true }), [36, 37]);
    await database.prepare("UPDATE stripe_webhook_dispatches SET available_at = ? WHERE stripe_event_id = ?")
      .bind("2026-09-26T05:05:06.000Z", "evt_claim_future").run();
    await database.prepare("UPDATE stripe_webhook_receipts SET status = 'applied', terminal_at = ? WHERE id = ?")
      .bind(now, terminal.receiptId).run();
    await database.prepare("UPDATE stripe_webhook_dispatches SET status = 'completed', completed_at = ? WHERE id = ?")
      .bind(now, terminal.dispatchId).run();

    const [claim] = await claimStripeWebhookDispatchesFromD1({
      database,
      livemode: false,
      batchSize: 10,
      leaseSeconds: 60,
      now,
      createLeaseToken: ids(40),
    });
    assert.equal(claim.receiptId, due.receiptId);
    assert.equal(claim.dispatchId, due.dispatchId);
    assert.equal(claim.attemptCount, 1);
    assert.equal(claim.claimGeneration, 1);
    assert.equal(claim.leaseToken, ids(40)());
    assert.equal(claim.leaseUntil, "2026-09-26T04:06:06.000Z");
    assert.deepEqual(claim.normalizedPayload, event({ stripeEventId: "evt_claim_due" }).normalizedPayload);
    assert.equal(await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now }).then((rows) => rows.length), 0);
    const [testModeClaim] = await claimStripeWebhookDispatchesFromD1({ database, livemode: true, now, createLeaseToken: ids(42) });
    assert.equal(testModeClaim.stripeEventId, "evt_claim_test_mode");
  } finally {
    await miniflare.dispose();
  }
});

test("concurrent D1 claims converge and expired leases receive a new fence", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const accepted = await accept(database, event({ stripeEventId: "evt_claim_concurrent" }), [50, 51]);
    const overlapping = await Promise.all([
      claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(52) }),
      claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(53) }),
    ]);
    assert.equal(overlapping.flat().length, 1);
    const first = overlapping.flat()[0];
    assert.equal(first.dispatchId, accepted.dispatchId);

    await database.prepare("UPDATE stripe_webhook_dispatches SET lease_until = ? WHERE id = ?")
      .bind("2026-09-26T04:05:05.000Z", first.dispatchId).run();
    const [reclaimed] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(54) });
    assert.equal(reclaimed.claimGeneration, 2);
    assert.equal(reclaimed.attemptCount, 2);
    assert.notEqual(reclaimed.leaseToken, first.leaseToken);
    assert.equal(await renewStripeWebhookDispatchLeaseInD1({ database, identity: first, now }), null);
    assert.equal(await retryStripeWebhookDispatchInD1({ database, identity: first, now }), null);
    const state = await row(database, "SELECT status, attempt_count, claim_generation, lease_token FROM stripe_webhook_dispatches WHERE id = ?", [first.dispatchId]);
    assert.deepEqual(state, {
      status: "processing",
      attempt_count: 2,
      claim_generation: 2,
      lease_token: reclaimed.leaseToken,
    });
  } finally {
    await miniflare.dispose();
  }
});

test("D1 lease renewal requires the current live lease and never shortens it", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await accept(database, event({ stripeEventId: "evt_lease_renewal" }), [60, 61]);
    const [claim] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, leaseSeconds: 60, createLeaseToken: ids(62) });
    const unchanged = await renewStripeWebhookDispatchLeaseInD1({ database, identity: claim, leaseSeconds: 1, now });
    assert.ok(unchanged);
    assert.equal(unchanged.leaseUntil, claim.leaseUntil);
    const extended = await renewStripeWebhookDispatchLeaseInD1({ database, identity: claim, leaseSeconds: 120, now });
    assert.ok(extended);
    assert.equal(extended.leaseUntil, "2026-09-26T04:07:06.000Z");

    await database.prepare("UPDATE stripe_webhook_dispatches SET lease_until = ? WHERE id = ?")
      .bind(now, claim.dispatchId).run();
    assert.equal(await renewStripeWebhookDispatchLeaseInD1({ database, identity: claim, leaseSeconds: 60, now }), null);
  } finally {
    await miniflare.dispose();
  }
});

test("D1 retry clears the lease, updates receipt and dispatch atomically, and respects delay", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const accepted = await accept(database, event({ stripeEventId: "evt_lease_retry" }), [70, 71]);
    const [claim] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(72) });
    const retried = await retryStripeWebhookDispatchInD1({
      database,
      identity: claim,
      retryAfterSeconds: 600,
      errorCode: "temporary_failure",
      errorMessage: "Synthetic upstream outage",
      now,
    });
    assert.ok(retried);
    assert.equal(retried.receiptStatus, "retryable");
    assert.equal(retried.dispatchStatus, "retryable");
    assert.equal(retried.availableAt, "2026-09-26T04:15:06.000Z");
    assert.equal(retried.leaseToken, null);
    assert.equal(retried.leaseUntil, null);
    assert.equal(await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now }).then((rows) => rows.length), 0);
    const state = await row(database, `
      SELECT r.status AS receipt_status, r.last_error_code AS receipt_error,
        d.status AS dispatch_status, d.last_error_code, d.last_error_message,
        d.attempt_count, d.claim_generation, d.lease_until, d.lease_token
      FROM stripe_webhook_receipts AS r
      JOIN stripe_webhook_dispatches AS d ON d.receipt_id = r.id
      WHERE r.id = ?
    `, [accepted.receiptId]);
    assert.deepEqual(state, {
      receipt_status: "retryable",
      receipt_error: "temporary_failure",
      dispatch_status: "retryable",
      last_error_code: "temporary_failure",
      last_error_message: "Synthetic upstream outage",
      attempt_count: 1,
      claim_generation: 1,
      lease_until: null,
      lease_token: null,
    });
    await database.prepare("UPDATE stripe_webhook_dispatches SET available_at = ? WHERE id = ?")
      .bind(now, accepted.dispatchId).run();
    const [reclaimed] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(73) });
    assert.equal(reclaimed.claimGeneration, 2);
    assert.equal(reclaimed.attemptCount, 2);
  } finally {
    await miniflare.dispose();
  }
});

test("D1 claim and retry batches roll back if receipt state updates fail", async () => {
  const claimDb = await createDatabase();
  try {
    const { database } = claimDb;
    const accepted = await accept(database, event({ stripeEventId: "evt_claim_rollback" }), [80, 81]);
    await database.prepare(`
      CREATE TRIGGER fail_receipt_processing
      BEFORE UPDATE ON stripe_webhook_receipts
      WHEN NEW.status = 'processing'
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt processing failure'); END
    `).run();
    await assert.rejects(() => claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(82) }));
    assert.deepEqual(await row(database, `
      SELECT r.status AS receipt_status, d.status AS dispatch_status,
        d.claim_generation, d.lease_token
      FROM stripe_webhook_receipts AS r JOIN stripe_webhook_dispatches AS d ON d.receipt_id = r.id
      WHERE r.id = ?
    `, [accepted.receiptId]), {
      receipt_status: "received", dispatch_status: "pending", claim_generation: 0, lease_token: null,
    });
  } finally {
    await claimDb.miniflare.dispose();
  }

  const retryDb = await createDatabase();
  try {
    const { database } = retryDb;
    await accept(database, event({ stripeEventId: "evt_retry_rollback" }), [83, 84]);
    const [claim] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(85) });
    await database.prepare(`
      CREATE TRIGGER fail_receipt_retryable
      BEFORE UPDATE ON stripe_webhook_receipts
      WHEN NEW.status = 'retryable'
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt retry failure'); END
    `).run();
    await assert.rejects(() => retryStripeWebhookDispatchInD1({ database, identity: claim, now }));
    assert.deepEqual(await row(database, `
      SELECT r.status AS receipt_status, d.status AS dispatch_status,
        d.claim_generation, d.lease_token
      FROM stripe_webhook_receipts AS r JOIN stripe_webhook_dispatches AS d ON d.receipt_id = r.id
      WHERE r.id = ?
    `, [claim.receiptId]), {
      receipt_status: "processing", dispatch_status: "processing",
      claim_generation: 1, lease_token: claim.leaseToken,
    });
  } finally {
    await retryDb.miniflare.dispose();
  }
});

test("D1 lease controls reject invalid bounds before state changes", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const accepted = await accept(database, event({ stripeEventId: "evt_lease_bounds" }), [90, 91]);
    await assert.rejects(() => claimStripeWebhookDispatchesFromD1({ database, livemode: false, batchSize: 0, now }), /invalid_batch_size/u);
    await assert.rejects(() => claimStripeWebhookDispatchesFromD1({ database, livemode: false, leaseSeconds: 3601, now }), /invalid_lease_duration/u);
    const [claim] = await claimStripeWebhookDispatchesFromD1({ database, livemode: false, now, createLeaseToken: ids(92) });
    await assert.rejects(() => renewStripeWebhookDispatchLeaseInD1({ database, identity: claim, leaseSeconds: 0, now }), /invalid_lease_duration/u);
    await assert.rejects(() => retryStripeWebhookDispatchInD1({ database, identity: claim, retryAfterSeconds: 86401, now }), /invalid_retry_delay/u);
    await assert.rejects(() => retryStripeWebhookDispatchInD1({ database, identity: claim, errorCode: "x".repeat(129), now }), /invalid_error_code/u);
    const state = await row(database, `
      SELECT r.status AS receipt_status, d.status AS dispatch_status,
        d.claim_generation, d.lease_token
      FROM stripe_webhook_receipts AS r JOIN stripe_webhook_dispatches AS d ON d.receipt_id = r.id
      WHERE r.id = ?
    `, [accepted.receiptId]);
    assert.equal(state.receipt_status, "processing");
    assert.equal(state.dispatch_status, "processing");
    assert.equal(state.claim_generation, 1);
    assert.equal(state.lease_token, claim.leaseToken);
  } finally {
    await miniflare.dispose();
  }
});

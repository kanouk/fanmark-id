#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrations = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0006_stripe_webhook_ingress_staging.sql",
  "workers/api/migrations-business/0007_stripe_extension_application_staging.sql",
  "workers/api/migrations-business/0008_stripe_invoice_projection_staging.sql",
  "workers/api/migrations-business/0009_stripe_subscription_identity.sql",
  "workers/api/migrations-business/0010_stripe_subscription_reconciliation_staging.sql",
];
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const ingressPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-ingress.ts");
const dispatchPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-dispatch.ts");
const invoicePath = path.join(repoRoot, "workers/api/src/stripe-invoice-projection-d1.ts");
const scheduledPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-scheduled.ts");
const { acceptStripeWebhookReceiptIntoD1 } = await import(pathToFileURL(ingressPath).href);
const { claimStripeWebhookDispatchesFromD1 } = await import(pathToFileURL(dispatchPath).href);
const { applyStripeInvoiceReceiptInD1, createD1InvoiceProjectionRuntime } = await import(pathToFileURL(invoicePath).href);
const { dispatchStripeWebhookBatchInD1, runScheduledStripeWebhookDispatches, stripeSecretKeyForMode } = await import(pathToFileURL(scheduledPath).href);

const NOW = "2026-09-26T04:05:06.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000101";
const SETTING_ID = "00000000-0000-4000-8000-000000000102";
const SUBSCRIPTION_ROW_ID = "00000000-0000-4000-8000-000000000103";
const CUSTOMER_ID = "cus_synthetic_projection_001";
const SUBSCRIPTION_ID = "sub_synthetic_projection_001";
const SOURCE_INVOICE_ID = "in_synthetic_projection_source";
const LATEST_INVOICE_ID = "in_synthetic_projection_latest";

function splitSqlStatements(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements = [];
  let current = "";
  let parentheses = 0;
  for (const line of source.split(/\r?\n/u)) {
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
        name: "fanmark-stripe-invoice-projection-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-stripe-invoice-projection-d1-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("DB");
  try {
    for (const migration of migrations) {
      const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        const result = await database.prepare(statement).run();
        assert.equal(result.success, true, `${migration}: ${statement.slice(0, 140)}`);
      }
    }
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
  return { miniflare, database };
}

let uuidCounter = 200;
function nextUuid() {
  return `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, "0")}`;
}

function checkedDatabase(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return new Proxy(statement, {
        get(target, property) {
          if (property === "bind") {
            return (...values) => {
              assert.equal(values.length, (sql.match(/\?/gu) ?? []).length, `SQL bind mismatch: ${sql.slice(0, 160)}`);
              return target.bind(...values);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    batch(statements) {
      return database.batch(statements);
    },
  };
}

function invoiceEvent({
  eventId = "evt_synthetic_invoice_001",
  type = "invoice.payment_failed",
  invoiceId = SOURCE_INVOICE_ID,
  customerId = CUSTOMER_ID,
  subscriptionId = SUBSCRIPTION_ID,
} = {}) {
  return {
    stripeEventId: eventId,
    livemode: false,
    eventType: type,
    objectType: "invoice",
    objectId: invoiceId,
    apiVersion: "2025-08-27.basil",
    normalizedSchemaVersion: 1,
    normalizedPayload: {
      schema_version: 1,
      branch: "invoice",
      event: { id: eventId, type, created: 1790395506, api_version: "2025-08-27.basil", livemode: false },
      object: { type: "invoice", id: invoiceId },
      reference: { object_type: "invoice", object_id: invoiceId },
      invoice: { id: invoiceId, customer_id: customerId, subscription_id: subscriptionId },
    },
    normalizedPayloadSha256: "a".repeat(64),
    rawPayloadSha256: "b".repeat(64),
  };
}

async function seedMapping(database, { customerId = CUSTOMER_ID, subscriptionId = SUBSCRIPTION_ID } = {}) {
  await database.prepare(`
    INSERT INTO user_settings (id, user_id, username, plan_type, created_at, updated_at, stripe_customer_id)
    VALUES (?, ?, 'synthetic-billing-user', 'creator', ?, ?, ?)
  `).bind(SETTING_ID, USER_ID, NOW, NOW, customerId).run();
  await database.prepare(`
    INSERT INTO user_subscriptions (
      id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
      created_at, updated_at, payment_failure_at, next_payment_attempt, payment_failure_type
    ) VALUES (?, ?, ?, ?, 'prod_synthetic', 'active', ?, ?, ?, ?, 'invoice.payment_failed')
  `).bind(
    SUBSCRIPTION_ROW_ID, USER_ID, customerId, subscriptionId, NOW, NOW,
    "2026-09-25T01:00:00.000Z", "2026-09-27T01:00:00.000Z",
  ).run();
}

async function receiveAndClaim(database, event) {
  const received = await acceptStripeWebhookReceiptIntoD1({
    database,
    event,
    now: NOW,
    createId: nextUuid,
  });
  const [claim] = await claimStripeWebhookDispatchesFromD1({
    database,
    livemode: false,
    now: NOW,
    leaseSeconds: 300,
    createLeaseToken: nextUuid,
  });
  assert.ok(claim);
  assert.equal(claim.receiptId, received.receiptId);
  return claim;
}

function paymentIntentInvoice({
  invoiceId,
  status = "open",
  intentStatus = "requires_payment_method",
  attempt = 2,
} = {}) {
  return {
    object: "invoice",
    id: invoiceId,
    livemode: false,
    customer: CUSTOMER_ID,
    parent: { type: "subscription_details", subscription_details: { subscription: SUBSCRIPTION_ID } },
    status,
    attempt_count: attempt,
    next_payment_attempt: status === "open" ? 1790400000 : null,
    payments: {
      object: "list",
      has_more: false,
      data: status === "open" ? [{
        object: "invoice_payment",
        invoice: invoiceId,
        livemode: false,
        status: "open",
        payment: {
          type: "payment_intent",
          payment_intent: {
            object: "payment_intent",
            id: `pi_${invoiceId}`,
            customer: CUSTOMER_ID,
            livemode: false,
            status: intentStatus,
          },
        },
      }] : [],
    },
  };
}

function provider({ sourceInvoice, currentInvoice = sourceInvoice, latestInvoiceId = sourceInvoice.id, overrides = {} }) {
  const invoices = new Map([[sourceInvoice.id, sourceInvoice], [currentInvoice.id, currentInvoice]]);
  for (const [id, invoice] of Object.entries(overrides)) invoices.set(id, invoice);
  return {
    async retrieveInvoice(invoiceId) {
      const invoice = invoices.get(invoiceId);
      if (!invoice) throw new Error("synthetic_invoice_not_found");
      return invoice;
    },
    async retrieveSubscription(subscriptionId) {
      return {
        object: "subscription",
        id: subscriptionId,
        customer: CUSTOMER_ID,
        livemode: false,
        latest_invoice: latestInvoiceId,
      };
    },
  };
}

async function getRow(database, sql, params = []) {
  return database.prepare(sql).bind(...params).first();
}

test("current paid latest invoice clears failure state for a stale failed event without changing entitlement", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    const claim = await receiveAndClaim(database, invoiceEvent());
    const old = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID, status: "open" });
    const paid = paymentIntentInvoice({ invoiceId: LATEST_INVOICE_ID, status: "paid" });
    const result = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database),
      claim,
      now: NOW,
      getNow: () => NOW,
      provider: provider({ sourceInvoice: old, currentInvoice: paid, latestInvoiceId: LATEST_INVOICE_ID }),
      createId: nextUuid,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.outcome, "paid");
    assert.equal(result.currentInvoiceId, LATEST_INVOICE_ID);
    assert.deepEqual(await getRow(database, `SELECT payment_failure_at, next_payment_attempt, payment_failure_type FROM user_subscriptions WHERE id = ?`, [SUBSCRIPTION_ROW_ID]), {
      payment_failure_at: null,
      next_payment_attempt: null,
      payment_failure_type: null,
    });
    assert.equal(await database.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?").bind(USER_ID).first("plan_type"), "creator");
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM fanmark_licenses").first("count"), 0);
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM stripe_application_ledger WHERE status = 'applied'").first("count"), 1);
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_receipts WHERE id = ?").bind(claim.receiptId).first("status"), "applied");
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_dispatches WHERE id = ?").bind(claim.dispatchId).first("status"), "completed");
  } finally {
    await miniflare.dispose();
  }
});

test("stale success cannot clear a newer current payment failure", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    const claim = await receiveAndClaim(database, invoiceEvent({ type: "invoice.payment_succeeded" }));
    const paidSource = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID, status: "paid" });
    const currentFailure = paymentIntentInvoice({
      invoiceId: LATEST_INVOICE_ID,
      intentStatus: "requires_action",
      attempt: 3,
    });
    const result = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ sourceInvoice: paidSource, currentInvoice: currentFailure, latestInvoiceId: LATEST_INVOICE_ID }),
      createId: nextUuid,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.outcome, "requires_action");
    assert.equal(result.currentInvoiceId, LATEST_INVOICE_ID);
    assert.deepEqual(await getRow(database, `SELECT payment_failure_at, next_payment_attempt, payment_failure_type FROM user_subscriptions WHERE id = ?`, [SUBSCRIPTION_ROW_ID]), {
      payment_failure_at: NOW,
      next_payment_attempt: new Date(1790400000 * 1000).toISOString(),
      payment_failure_type: "invoice.payment_action_required",
    });
  } finally {
    await miniflare.dispose();
  }
});

test("failed and action-required current attempts store bounded payment state only", async () => {
  for (const [eventType, intentStatus, expectedFailureType] of [
    ["invoice.payment_failed", "requires_payment_method", "invoice.payment_failed"],
    ["invoice.payment_action_required", "requires_action", "invoice.payment_action_required"],
  ]) {
    const { miniflare, database } = await createDatabase();
    try {
      await seedMapping(database);
      const claim = await receiveAndClaim(database, invoiceEvent({ eventId: `evt_${eventType}`, type: eventType }));
      const latest = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID, intentStatus });
      const result = await applyStripeInvoiceReceiptInD1({
        database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
        provider: provider({ sourceInvoice: latest }), createId: nextUuid,
      });
      assert.equal(result.status, "applied");
      assert.equal(result.outcome, intentStatus === "requires_action" ? "requires_action" : "payment_failed");
      assert.deepEqual(await getRow(database, `SELECT payment_failure_at, next_payment_attempt, payment_failure_type FROM user_subscriptions WHERE id = ?`, [SUBSCRIPTION_ROW_ID]), {
        payment_failure_at: NOW,
        next_payment_attempt: new Date(1790400000 * 1000).toISOString(),
        payment_failure_type: expectedFailureType,
      });
    } finally {
      await miniflare.dispose();
    }
  }
});

test("missing Stripe customer-to-user or subscription mapping retries without email matching or writes", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const claim = await receiveAndClaim(database, invoiceEvent());
    const invoice = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID });
    const result = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ sourceInvoice: invoice }), createId: nextUuid,
    });
    assert.equal(result.status, "retryable");
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM stripe_application_ledger").first("count"), 0);
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM user_subscriptions").first("count"), 0);
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_receipts WHERE id = ?").bind(claim.receiptId).first("status"), "retryable");
  } finally {
    await miniflare.dispose();
  }
});

test("concurrent customer fences serialize work and expired owners cannot release a newer generation", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const claim = await receiveAndClaim(database, invoiceEvent());
    let token = 0;
    const runtime = createD1InvoiceProjectionRuntime({
      database,
      now: NOW,
      getNow: () => NOW,
      createFenceToken: () => `fence-${++token}`,
    });
    const fences = await Promise.all([
      runtime.acquireFence({ dispatch: {
        receipt_id: claim.receiptId, dispatch_id: claim.dispatchId, stripe_event_id: claim.stripeEventId,
        livemode: claim.livemode, event_type: claim.eventType, object_type: claim.objectType,
        object_id: claim.objectId, api_version: claim.apiVersion,
        normalized_schema_version: claim.normalizedSchemaVersion, normalized_payload: claim.normalizedPayload,
        normalized_payload_sha256: claim.normalizedPayloadSha256, raw_payload_sha256: claim.rawPayloadSha256,
        attempt_count: claim.attemptCount, claim_generation: claim.claimGeneration,
        lease_token: claim.leaseToken, lease_until: claim.leaseUntil,
      }, stripeCustomerId: CUSTOMER_ID }),
      runtime.acquireFence({ dispatch: {
        receipt_id: claim.receiptId, dispatch_id: claim.dispatchId, stripe_event_id: claim.stripeEventId,
        livemode: claim.livemode, event_type: claim.eventType, object_type: claim.objectType,
        object_id: claim.objectId, api_version: claim.apiVersion,
        normalized_schema_version: claim.normalizedSchemaVersion, normalized_payload: claim.normalizedPayload,
        normalized_payload_sha256: claim.normalizedPayloadSha256, raw_payload_sha256: claim.rawPayloadSha256,
        attempt_count: claim.attemptCount, claim_generation: claim.claimGeneration,
        lease_token: claim.leaseToken, lease_until: claim.leaseUntil,
      }, stripeCustomerId: CUSTOMER_ID }),
    ]);
    assert.equal(fences.filter(Boolean).length, 1);
    const first = fences.find(Boolean);
    assert.ok(first);
    await database.prepare("UPDATE stripe_sync_fences SET lease_until = '2026-09-26T04:04:00.000Z' WHERE stripe_customer_id = ?").bind(CUSTOMER_ID).run();
    const laterNow = "2026-09-26T04:06:00.000Z";
    const later = createD1InvoiceProjectionRuntime({
      database,
      now: laterNow,
      getNow: () => laterNow,
      createFenceToken: () => "fence-new-generation",
    });
    const dispatch = {
      receipt_id: claim.receiptId, dispatch_id: claim.dispatchId, stripe_event_id: claim.stripeEventId,
      livemode: claim.livemode, event_type: claim.eventType, object_type: claim.objectType,
      object_id: claim.objectId, api_version: claim.apiVersion,
      normalized_schema_version: claim.normalizedSchemaVersion, normalized_payload: claim.normalizedPayload,
      normalized_payload_sha256: claim.normalizedPayloadSha256, raw_payload_sha256: claim.rawPayloadSha256,
      attempt_count: claim.attemptCount, claim_generation: claim.claimGeneration,
      lease_token: claim.leaseToken, lease_until: claim.leaseUntil,
    };
    const newer = await later.acquireFence({ dispatch, stripeCustomerId: CUSTOMER_ID });
    assert.equal(newer?.fence_generation, (first?.fence_generation ?? 0) + 1);
    assert.equal(await runtime.releaseFence({ dispatch, stripeCustomerId: CUSTOMER_ID, fence: first }), false);
    const row = await getRow(database, "SELECT owner_token, generation FROM stripe_sync_fences WHERE stripe_customer_id = ?", [CUSTOMER_ID]);
    assert.equal(row.owner_token, "fence-new-generation");
    assert.equal(row.generation, newer.fence_generation);
  } finally {
    await miniflare.dispose();
  }
});

test("injected subscription write failure rolls back ledger and terminal receipt then retries", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    const claim = await receiveAndClaim(database, invoiceEvent());
    await database.prepare(`
      CREATE TRIGGER synthetic_abort_subscription_update
      BEFORE UPDATE ON user_subscriptions
      BEGIN SELECT RAISE(ABORT, 'synthetic_projection_rollback'); END
    `).run();
    const invoice = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID });
    const result = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ sourceInvoice: invoice }), createId: nextUuid,
    });
    assert.equal(result.status, "retryable");
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM stripe_application_ledger").first("count"), 0);
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_receipts WHERE id = ?").bind(claim.receiptId).first("status"), "retryable");
    assert.deepEqual(await getRow(database, `SELECT payment_failure_at, next_payment_attempt, payment_failure_type FROM user_subscriptions WHERE id = ?`, [SUBSCRIPTION_ROW_ID]), {
      payment_failure_at: "2026-09-25T01:00:00.000Z",
      next_payment_attempt: "2026-09-27T01:00:00.000Z",
      payment_failure_type: "invoice.payment_failed",
    });
    await database.prepare("DROP TRIGGER synthetic_abort_subscription_update").run();
    const retryNow = "2026-09-26T04:06:07.000Z";
    const [retryClaim] = await claimStripeWebhookDispatchesFromD1({
      database, livemode: false, now: retryNow, createLeaseToken: nextUuid,
    });
    assert.ok(retryClaim);
    const retried = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database), claim: retryClaim, now: retryNow,
      getNow: () => retryNow,
      provider: provider({ sourceInvoice: invoice }), createId: nextUuid,
    });
    assert.equal(retried.status, "applied");
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM stripe_application_ledger WHERE status = 'applied'").first("count"), 1);
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_receipts WHERE id = ?").bind(claim.receiptId).first("status"), "applied");
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled dispatcher applies invoice events through an injectable provider", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    const event = invoiceEvent({ type: "invoice.payment_succeeded" });
    await acceptStripeWebhookReceiptIntoD1({ database, event, now: NOW, createId: nextUuid });
    const invoice = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID, status: "paid" });
    const summary = await dispatchStripeWebhookBatchInD1({
      database: checkedDatabase(database), livemode: false, now: NOW,
      invoiceProvider: provider({ sourceInvoice: invoice }),
      getNow: () => NOW,
    });
    assert.deepEqual(summary, {
      claimed: 1, applied: 1, ignored: 0, deadLettered: 0, retryable: 0, leaseLost: 0,
    });
    assert.equal(await database.prepare("SELECT status FROM stripe_webhook_receipts WHERE stripe_event_id = ?").bind(event.stripeEventId).first("status"), "applied");
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled Worker Stripe handling stays disabled when staging selectors are absent", async () => {
  const result = await runScheduledStripeWebhookDispatches({ env: {}, scheduledTime: Date.parse(NOW) });
  assert.deepEqual(result, {
    status: "disabled", claimed: 0, applied: 0, ignored: 0,
    deadLettered: 0, retryable: 0, leaseLost: 0,
  });
});

test("scheduled Stripe API key is bound to the dispatch livemode", () => {
  assert.equal(stripeSecretKeyForMode(" sk_test_synthetic ", false), "sk_test_synthetic");
  assert.equal(stripeSecretKeyForMode("rk_live_synthetic", true), "rk_live_synthetic");
  assert.throws(() => stripeSecretKeyForMode("sk_live_synthetic", false), /stripe_dispatch_configuration_invalid/u);
  assert.throws(() => stripeSecretKeyForMode("sk_test_synthetic", true), /stripe_dispatch_configuration_invalid/u);
  assert.throws(() => stripeSecretKeyForMode(undefined, false), /stripe_dispatch_configuration_invalid/u);
});

test("Stripe subscription identity cannot be reassigned across users or customers", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    await assert.rejects(database.prepare(`
      INSERT INTO user_subscriptions (
        id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      "00000000-0000-4000-8000-000000000202",
      "00000000-0000-4000-8000-000000000202",
      "cus_synthetic_other_user",
      SUBSCRIPTION_ID,
      "prod_synthetic_other_user",
      "active",
      NOW,
      NOW,
    ).run());
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM user_subscriptions WHERE stripe_subscription_id = ?")
      .bind(SUBSCRIPTION_ID).first("count"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("stale dispatch lease cannot write payment state", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedMapping(database);
    const claim = await receiveAndClaim(database, invoiceEvent());
    const clock = { now: NOW };
    const invoice = paymentIntentInvoice({ invoiceId: SOURCE_INVOICE_ID });
    const fixtureProvider = provider({ sourceInvoice: invoice });
    const result = await applyStripeInvoiceReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => clock.now,
      provider: {
        async retrieveInvoice(invoiceId) {
          const value = await fixtureProvider.retrieveInvoice(invoiceId);
          clock.now = "2026-09-26T04:11:00.000Z";
          return value;
        },
        retrieveSubscription: (subscriptionId) => fixtureProvider.retrieveSubscription(subscriptionId),
      }, createId: nextUuid,
    });
    assert.equal(result.status, "stale");
    assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM stripe_application_ledger").first("count"), 0);
    assert.deepEqual(await getRow(database, `SELECT payment_failure_at, next_payment_attempt, payment_failure_type FROM user_subscriptions WHERE id = ?`, [SUBSCRIPTION_ROW_ID]), {
      payment_failure_at: "2026-09-25T01:00:00.000Z",
      next_payment_attempt: "2026-09-27T01:00:00.000Z",
      payment_failure_type: "invoice.payment_failed",
    });
  } finally {
    await miniflare.dispose();
  }
});

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
];
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const ingressModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-ingress.ts");
const dispatchModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-dispatch.ts");
const applicationModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-application.ts");
const scheduledModulePath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-scheduled.ts");
const { acceptStripeWebhookReceiptIntoD1 } = await import(pathToFileURL(ingressModulePath).href);
const { claimStripeWebhookDispatchesFromD1 } = await import(pathToFileURL(dispatchModulePath).href);
const { applyStripeExtensionReceiptInD1 } = await import(pathToFileURL(applicationModulePath).href);
const { dispatchStripeWebhookBatchInD1 } = await import(pathToFileURL(scheduledModulePath).href);

const NOW = "2026-09-26T04:05:06.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const LICENSE_ID = "00000000-0000-4000-8000-000000000002";
const FANMARK_ID = "00000000-0000-4000-8000-000000000003";
const INTENT_ID = "00000000-0000-4000-8000-000000000004";
const REQUEST_ID = "00000000-0000-4000-8000-000000000005";
const SESSION_ID = "cs_synthetic_extension_001";
const EXPECTED_TOTAL = 1200;

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
        name: "fanmark-stripe-webhook-d1-application-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-stripe-webhook-d1-application-test" } },
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

function metadata(overrides = {}) {
  return {
    type: "license_extension",
    user_id: USER_ID,
    license_id: LICENSE_ID,
    fanmark_id: FANMARK_ID,
    tier_level: "2",
    months: "3",
    billing_intent_id: INTENT_ID,
    price_id: "price_synthetic_months_3",
    expected_total_yen: String(EXPECTED_TOTAL),
    allow_zero_total: "false",
    ...overrides,
  };
}

function stripeEvent({ eventId, type = "checkout.session.completed", paymentStatus = "paid", status = "complete", amountTotal = EXPECTED_TOTAL, currency = "jpy", meta = metadata(), sessionId = SESSION_ID } = {}) {
  return {
    stripeEventId: eventId,
    livemode: false,
    eventType: type,
    objectType: "checkout.session",
    objectId: sessionId,
    apiVersion: "2025-08-27.basil",
    normalizedSchemaVersion: 1,
    normalizedPayload: {
      schema_version: 1,
      event: { id: eventId, type, created: 1790395506, api_version: "2025-08-27.basil", livemode: false },
      object: { type: "checkout.session", id: sessionId },
      branch: "checkout_session",
      reference: { object_type: "checkout.session", object_id: sessionId },
      checkout_session: {
        id: sessionId, mode: "payment", status, payment_status: paymentStatus,
        amount_total: amountTotal, currency, customer_id: "cus_synthetic_extension",
        subscription_id: null, payment_intent_id: "pi_synthetic_extension",
        client_reference_id: USER_ID, expires_at: 1790400000, metadata: meta,
      },
    },
    normalizedPayloadSha256: "a".repeat(64),
    rawPayloadSha256: "b".repeat(64),
  };
}

async function seedBusiness(database, { licenseEnd = "2026-10-01T00:00:00.000000Z", owner = USER_ID, transferLock = null } = {}) {
  await database.prepare(`
    INSERT INTO fanmarks (
      id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
      emoji_ids, normalized_emoji_ids, tier_level
    ) VALUES (?, '🌸', '🌸', 'roseSynthetic01', 'active', ?, ?, '["emoji-rose"]', '["emoji-rose"]', 2)
  `).bind(FANMARK_ID, NOW, NOW).run();
  await database.prepare(`
    INSERT INTO fanmark_licenses (
      id, fanmark_id, user_id, license_start, license_end, status, is_initial_license,
      created_at, updated_at, grace_expires_at, is_returned, is_transferred,
      transfer_locked_until, excluded_at, excluded_from_plan, display_fanmark
    ) VALUES (?, ?, ?, '2026-01-01T00:00:00.000000Z', ?, 'grace', 1, ?, ?,
      '2026-10-02T00:00:00.000000Z', 0, 0, ?, '2026-09-25T00:00:00.000000Z', 'free', '🌸')
  `).bind(LICENSE_ID, FANMARK_ID, owner, licenseEnd, NOW, NOW, transferLock).run();
  await database.prepare(`
    INSERT INTO stripe_extension_checkout_intents (
      id, request_id, user_id, license_id, fanmark_id, tier_level, months,
      stripe_price_id, currency, expected_total_yen, allow_zero_total, livemode,
      stripe_checkout_session_id, status, idempotency_safe_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 2, 3, 'price_synthetic_months_3', 'jpy', ?, 0, 0,
      NULL, 'created', '2026-09-27T00:00:00.000000Z', ?, ?)
  `).bind(INTENT_ID, REQUEST_ID, USER_ID, LICENSE_ID, FANMARK_ID, EXPECTED_TOTAL, NOW, NOW).run();
}

async function seedLotteryEntries(database, count = 2) {
  for (let index = 0; index < count; index += 1) {
    const entryId = `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`;
    const userId = `00000000-0000-4000-8000-${String(index + 40).padStart(12, "0")}`;
    await database.prepare(`
      INSERT INTO fanmark_lottery_entries (
        id, fanmark_id, user_id, license_id, lottery_probability, entry_status,
        applied_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '1.0', 'pending', ?, ?, ?)
    `).bind(entryId, FANMARK_ID, userId, LICENSE_ID, NOW, NOW, NOW).run();
  }
}

let uuidCounter = 100;
function nextUuid() {
  return `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, "0")}`;
}

async function acceptAndClaim(database, eventInput, now = NOW) {
  const persisted = await acceptStripeWebhookReceiptIntoD1({
    database,
    event: eventInput,
    now,
    createId: nextUuid,
  });
  const [claim] = await claimStripeWebhookDispatchesFromD1({
    database,
    livemode: false,
    batchSize: 10,
    leaseSeconds: 600,
    now,
    createLeaseToken: nextUuid,
  });
  assert.ok(claim);
  assert.equal(claim.receiptId, persisted.receiptId);
  return { persisted, claim };
}

async function row(database, sql, values = []) {
  return database.prepare(sql).bind(...values).first();
}

async function scalar(database, sql, values = []) {
  const result = await row(database, sql, values);
  return result ? Object.values(result)[0] : null;
}

function checkedDatabase(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return new Proxy(statement, {
        get(target, property) {
          if (property === "bind") {
            return (...values) => {
              const expected = (sql.match(/\?/gu) ?? []).length;
              assert.equal(values.length, expected, `SQL bind count mismatch: ${sql.slice(0, 180)}`);
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

test("paid extension applies license, lottery cancellation, audits, notifications, and receipt atomically", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    await seedLotteryEntries(database);
    const { claim } = await acceptAndClaim(database, stripeEvent({ eventId: "evt_synthetic_extension_001" }));
    const result = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: claim, now: NOW, createId: nextUuid });

    assert.equal(result.outcome, "applied");
    assert.equal(result.receiptStatus, "applied");
    assert.equal(result.dispatchStatus, "completed");
    assert.equal(result.licenseEnd, "2027-01-01T00:00:00.000000Z");
    assert.deepEqual(await row(database, `
      SELECT status, license_end, grace_expires_at, is_returned, excluded_at, excluded_from_plan
      FROM fanmark_licenses WHERE id = ?
    `, [LICENSE_ID]), {
      status: "active", license_end: "2027-01-01T00:00:00.000000Z", grace_expires_at: null,
      is_returned: 0, excluded_at: null, excluded_from_plan: null,
    });
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM fanmark_lottery_entries WHERE entry_status = 'cancelled_by_extension'"), 2);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM notification_events WHERE event_type = 'lottery_cancelled_by_extension'"), 2);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 1);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED_LOTTERY_CANCELLED'"), 1);
    assert.equal(await scalar(database, "SELECT status FROM stripe_extension_applications"), "applied");
    assert.equal(await scalar(database, "SELECT status FROM stripe_extension_checkout_intents WHERE id = ?", [INTENT_ID]), "applied");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_dispatches"), "completed");
  } finally {
    await miniflare.dispose();
  }
});

test("same Checkout Session in a different event receipt never grants time twice", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    const first = await acceptAndClaim(database, stripeEvent({ eventId: "evt_synthetic_extension_first" }));
    await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: first.claim, now: NOW, createId: nextUuid });
    const second = await acceptAndClaim(database, stripeEvent({
      eventId: "evt_synthetic_extension_async_success", type: "checkout.session.async_payment_succeeded",
    }));
    const result = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: second.claim, now: NOW, createId: nextUuid });

    assert.equal(result.outcome, "duplicate_session");
    assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2027-01-01T00:00:00.000000Z");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 1);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM stripe_extension_applications"), 1);
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts WHERE stripe_event_id = 'evt_synthetic_extension_async_success'"), "applied");
  } finally {
    await miniflare.dispose();
  }
});

test("unpaid completion grants nothing and a later asynchronous success applies once", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    const unpaid = await acceptAndClaim(database, stripeEvent({
      eventId: "evt_synthetic_extension_unpaid", paymentStatus: "unpaid",
    }));
    const awaiting = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: unpaid.claim, now: NOW, createId: nextUuid });
    assert.equal(awaiting.outcome, "awaiting_payment");
    assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2026-10-01T00:00:00.000000Z");
    assert.equal(await scalar(database, "SELECT status FROM stripe_extension_applications"), "awaiting_payment_confirmation");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts WHERE stripe_event_id = 'evt_synthetic_extension_unpaid'"), "ignored");

    const paid = await acceptAndClaim(database, stripeEvent({
      eventId: "evt_synthetic_extension_async_success", type: "checkout.session.async_payment_succeeded",
    }));
    const applied = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: paid.claim, now: NOW, createId: nextUuid });
    assert.equal(applied.outcome, "applied");
    assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2027-01-01T00:00:00.000000Z");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("expired and async-failed Checkout Sessions become terminal without granting time", async () => {
  for (const scenario of [
    { eventId: "evt_synthetic_extension_expired", type: "checkout.session.expired", status: "expired", applicationStatus: "expired" },
    { eventId: "evt_synthetic_extension_async_failed", type: "checkout.session.async_payment_failed", status: "complete", applicationStatus: "failed" },
  ]) {
    const { miniflare, database } = await createDatabase();
    try {
      await seedBusiness(database);
      const { claim } = await acceptAndClaim(database, stripeEvent({
        eventId: scenario.eventId, type: scenario.type, status: scenario.status, paymentStatus: "unpaid",
      }));
      const result = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: claim, now: NOW, createId: nextUuid });
      assert.equal(result.outcome, "no_grant");
      assert.equal(result.receiptStatus, "ignored");
      assert.equal(result.dispatchStatus, "completed");
      assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2026-10-01T00:00:00.000000Z");
      assert.equal(await scalar(database, "SELECT status FROM stripe_extension_applications"), scenario.applicationStatus);
      assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 0);
    } finally {
      await miniflare.dispose();
    }
  }
});

test("price mismatch, stale owner, and transfer lock dead-letter without changing a license", async () => {
  for (const scenario of [
    { name: "amount mismatch", seed: {}, event: { amountTotal: EXPECTED_TOTAL + 1 }, code: "extension_payment_not_verified" },
    { name: "stale owner", seed: { owner: "00000000-0000-4000-8000-000000000099" }, event: {}, code: "extension_stale_owner" },
    { name: "transfer lock", seed: { transferLock: "2026-09-27T00:00:00.000000Z" }, event: {}, code: "extension_license_ineligible" },
  ]) {
    const { miniflare, database } = await createDatabase();
    try {
      await seedBusiness(database, scenario.seed);
      const { claim } = await acceptAndClaim(database, stripeEvent({ eventId: `evt_synthetic_${scenario.name.replaceAll(" ", "_")}`, ...scenario.event }));
      const result = await applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: claim, now: NOW, createId: nextUuid });
      assert.equal(result.outcome, "dead_letter", scenario.name);
      assert.equal(result.errorCode, scenario.code, scenario.name);
      assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2026-10-01T00:00:00.000000Z", scenario.name);
      assert.equal(await scalar(database, "SELECT count(*) AS count FROM stripe_extension_applications"), 0, scenario.name);
    } finally {
      await miniflare.dispose();
    }
  }
});

test("failed audit statement rolls back the entire billing effect batch", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    await database.prepare(`
      CREATE TRIGGER synthetic_stripe_audit_failure BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'LICENSE_EXTENDED'
      BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END
    `).run();
    const { claim } = await acceptAndClaim(database, stripeEvent({ eventId: "evt_synthetic_extension_rollback" }));
    await assert.rejects(() => applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity: claim, now: NOW, createId: nextUuid }));

    assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2026-10-01T00:00:00.000000Z");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM stripe_extension_applications"), 0);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM stripe_extension_application_effects"), 0);
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "processing");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_dispatches"), "processing");
  } finally {
    await miniflare.dispose();
  }
});

test("competing receipts for one session converge on one license effect", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    const events = await Promise.all([
      acceptStripeWebhookReceiptIntoD1({ database, event: stripeEvent({ eventId: "evt_synthetic_race_a" }), now: NOW, createId: nextUuid }),
      acceptStripeWebhookReceiptIntoD1({ database, event: stripeEvent({ eventId: "evt_synthetic_race_b" }), now: NOW, createId: nextUuid }),
    ]);
    const claims = await claimStripeWebhookDispatchesFromD1({
      database, livemode: false, batchSize: 10, leaseSeconds: 600, now: NOW,
      createLeaseToken: nextUuid,
    });
    assert.equal(claims.length, 2);
    const results = await Promise.all(claims.map((identity) =>
      applyStripeExtensionReceiptInD1({ database: checkedDatabase(database), identity, now: NOW, createId: nextUuid })));
    assert.equal(results.filter((result) => result.outcome === "applied").length, 1);
    assert.equal(results.filter((result) => result.outcome === "duplicate_session").length, 1);
    assert.equal(await scalar(database, "SELECT license_end FROM fanmark_licenses WHERE id = ?", [LICENSE_ID]), "2027-01-01T00:00:00.000000Z");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 1);
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM stripe_extension_applications"), 1);
    for (const event of events) {
      assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts WHERE id = ?", [event.receiptId]), "applied");
    }
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled D1 dispatch claims and applies a paid extension receipt", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    await acceptStripeWebhookReceiptIntoD1({
      database,
      event: stripeEvent({ eventId: "evt_synthetic_scheduled_paid" }),
      now: NOW,
      createId: nextUuid,
    });
    const summary = await dispatchStripeWebhookBatchInD1({
      database, livemode: false, now: NOW, batchSize: 10, maxAttempts: 8,
    });
    assert.deepEqual(summary, {
      claimed: 1, applied: 1, ignored: 0, deadLettered: 0, retryable: 0, leaseLost: 0,
    });
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_dispatches"), "completed");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM audit_logs WHERE action = 'LICENSE_EXTENDED'"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled D1 dispatch dead-letters unsupported billing events for review", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await acceptStripeWebhookReceiptIntoD1({
      database,
      event: stripeEvent({ eventId: "evt_synthetic_scheduled_subscription", type: "customer.subscription.updated" }),
      now: NOW,
      createId: nextUuid,
    });
    const summary = await dispatchStripeWebhookBatchInD1({
      database, livemode: false, now: NOW,
    });
    assert.equal(summary.deadLettered, 1);
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "dead_letter");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_dispatches"), "dead_letter");
    assert.equal(await scalar(database, "SELECT last_error_code FROM stripe_webhook_receipts"), "stripe_event_handler_unavailable");
    assert.equal(await scalar(database, "SELECT count(*) AS count FROM fanmark_licenses"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled D1 dispatch backs off a transient failure and applies it on retry", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedBusiness(database);
    await acceptStripeWebhookReceiptIntoD1({
      database,
      event: stripeEvent({ eventId: "evt_synthetic_scheduled_retry" }),
      now: NOW,
      createId: nextUuid,
    });
    const first = await dispatchStripeWebhookBatchInD1({
      database,
      livemode: false,
      now: NOW,
      applyReceipt: async () => { throw new Error("synthetic_transient_failure"); },
    });
    assert.equal(first.retryable, 1);
    const availableAt = await scalar(database, "SELECT available_at FROM stripe_webhook_dispatches");
    assert.equal(availableAt, "2026-09-26T04:05:36.000Z");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "retryable");

    const second = await dispatchStripeWebhookBatchInD1({
      database, livemode: false, now: availableAt, batchSize: 10, maxAttempts: 8,
    });
    assert.equal(second.applied, 1);
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT status FROM stripe_webhook_dispatches"), "completed");
  } finally {
    await miniflare.dispose();
  }
});

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
  "workers/api/migrations-business/0011_stripe_subscription_free_return.sql",
];
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const receiptNormalizerPath = path.join(repoRoot, "supabase/functions/_shared/stripe-receipt-ingress/index.ts");
const ingressPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-ingress.ts");
const dispatchPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-dispatch.ts");
const reconciliationPath = path.join(repoRoot, "workers/api/src/stripe-subscription-reconciliation-d1.ts");
const scheduledPath = path.join(repoRoot, "workers/api/src/stripe-webhook-d1-scheduled.ts");
const { normalizeStripeEvent } = await import(pathToFileURL(receiptNormalizerPath).href);
const { acceptStripeWebhookReceiptIntoD1 } = await import(pathToFileURL(ingressPath).href);
const { claimStripeWebhookDispatchesFromD1 } = await import(pathToFileURL(dispatchPath).href);
const { applyStripeSubscriptionReceiptInD1 } = await import(pathToFileURL(reconciliationPath).href);
const { dispatchStripeWebhookBatchInD1 } = await import(pathToFileURL(scheduledPath).href);

const NOW = "2026-09-26T05:06:07.000Z";
const USER_ID = "00000000-0000-4000-8000-000000000301";
const SETTING_ID = "00000000-0000-4000-8000-000000000302";
const CUSTOMER_ID = "cus_synthetic_subscription_001";
const SUBSCRIPTION_ID = "sub_synthetic_subscription_001";
const PRICE_IDS = {
  creator: "price_test_creator_synthetic",
  max: "price_test_max_synthetic",
  business: "price_test_business_synthetic",
};
const LIVE_PRICE_IDS = {
  creator: "price_live_creator_synthetic",
  max: "price_live_max_synthetic",
  business: "price_live_business_synthetic",
};

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
        name: "fanmark-stripe-subscription-reconciliation-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-stripe-subscription-reconciliation-d1-test" } },
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

let uuidCounter = 300;
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
              assert.equal(values.length, (sql.match(/\?/gu) ?? []).length, `SQL bind mismatch: ${sql.slice(0, 180)}`);
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

async function seedConfiguration(database, { customerId = CUSTOMER_ID, planType = "free", livemode = false } = {}) {
  await database.prepare(`
    INSERT INTO user_settings (id, user_id, username, plan_type, created_at, updated_at, stripe_customer_id)
    VALUES (?, ?, 'synthetic-subscription-user', ?, ?, ?, ?)
  `).bind(SETTING_ID, USER_ID, planType, NOW, NOW, customerId).run();
  const ids = livemode ? LIVE_PRICE_IDS : PRICE_IDS;
  const suffix = livemode ? "_live" : "";
  const rows = [
    [`creator_stripe_price_id${suffix}`, ids.creator],
    [`max_stripe_price_id${suffix}`, ids.max],
    [`business_stripe_price_id${suffix}`, ids.business],
  ];
  for (const [settingKey, settingValue] of rows) {
    await database.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, is_public, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `).bind(settingKey, settingValue, NOW, NOW).run();
  }
}

function subscriptionSnapshot({
  subscriptionId = SUBSCRIPTION_ID,
  customerId = CUSTOMER_ID,
  status = "active",
  priceId = PRICE_IDS.creator,
  productId = `prod_${priceId}`,
  livemode = false,
  periodStart = 1790395506,
  periodEnd = 1792987506,
} = {}) {
  return {
    object: "subscription",
    id: subscriptionId,
    customer: customerId,
    livemode,
    status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    items: {
      object: "list",
      has_more: false,
      data: [{
        id: `si_${subscriptionId}`,
        quantity: 1,
        price: {
          id: priceId,
          product: productId,
          unit_amount: priceId === PRICE_IDS.business ? 12000 : priceId === PRICE_IDS.max ? 8000 : 3000,
          currency: "jpy",
          recurring: { interval: "month", interval_count: 1 },
        },
      }],
    },
    metadata: {},
  };
}

function subscriptionEvent({
  eventId = "evt_synthetic_subscription_001",
  type = "customer.subscription.updated",
  subscription = subscriptionSnapshot(),
} = {}) {
  return {
    id: eventId,
    type,
    created: 1790395506,
    api_version: "2025-08-27.basil",
    livemode: subscription.livemode,
    data: { object: subscription },
  };
}

async function acceptEvent(database, event) {
  const normalizedPayload = normalizeStripeEvent(event);
  return acceptStripeWebhookReceiptIntoD1({
    database,
    event: {
      stripeEventId: event.id,
      livemode: event.livemode,
      eventType: event.type,
      objectType: normalizedPayload.object.type,
      objectId: normalizedPayload.object.id,
      apiVersion: event.api_version,
      normalizedSchemaVersion: normalizedPayload.schema_version,
      normalizedPayload,
      normalizedPayloadSha256: "a".repeat(64),
      rawPayloadSha256: "b".repeat(64),
    },
    now: NOW,
    createId: nextUuid,
  });
}

async function claimEvent(database, event) {
  const accepted = await acceptEvent(database, event);
  const [claim] = await claimStripeWebhookDispatchesFromD1({
    database,
    livemode: event.livemode,
    now: NOW,
    leaseSeconds: 300,
    createLeaseToken: nextUuid,
  });
  assert.ok(claim);
  assert.equal(claim.receiptId, accepted.receiptId);
  return claim;
}

function provider({ current, active = [current], userId = USER_ID, customerId = CUSTOMER_ID, livemode = current.livemode } = {}) {
  return {
    async retrieveCustomer(id) {
      return { object: "customer", id, livemode, deleted: false, metadata: userId ? { user_id: userId } : {} };
    },
    async retrieveSubscription(id) {
      if (current.id !== id) throw new Error("synthetic_subscription_missing");
      return current;
    },
    async listActiveSubscriptions(id) {
      if (id !== customerId) throw new Error("synthetic_customer_mismatch");
      return active;
    },
  };
}

async function scalar(database, sql, values = []) {
  return database.prepare(sql).bind(...values).first("value");
}

let fanmarkCounter = 0;
async function seedActiveLicense(database, { licenseStart, favoriteUserId = null }) {
  const index = fanmarkCounter++;
  const fanmarkId = nextUuid();
  const licenseId = nextUuid();
  const discoveryId = nextUuid();
  const emoji = "synthetic-emoji-" + String(index);
  const shortId = "sub-return-" + String(index);
  await database.prepare(`
    INSERT INTO fanmarks (
      id, user_input_fanmark, normalized_emoji, short_id, status,
      created_at, updated_at, emoji_ids, normalized_emoji_ids, tier_level
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 1)
  `).bind(
    fanmarkId, emoji, emoji, shortId, NOW, NOW,
    JSON.stringify([index]), JSON.stringify([index]),
  ).run();
  await database.prepare(`
    INSERT INTO fanmark_licenses (
      id, fanmark_id, user_id, license_start, license_end, status,
      is_initial_license, created_at, updated_at, plan_excluded, excluded_at,
      grace_expires_at, is_returned, is_transferred, display_fanmark
    ) VALUES (?, ?, ?, ?, NULL, 'active', 0, ?, ?, 0, ?, NULL, 0, 0, ?)
  `).bind(
    licenseId, fanmarkId, USER_ID, licenseStart, NOW, NOW, NOW, emoji,
  ).run();
  await database.prepare(`
    INSERT INTO fanmark_discoveries (
      id, emoji_ids, normalized_emoji_ids, fanmark_id, availability_status,
      first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, 'owned_by_user', ?, ?)
  `).bind(
    discoveryId, JSON.stringify([index]), JSON.stringify([index]), fanmarkId, NOW, NOW,
  ).run();
  if (favoriteUserId) {
    await database.prepare(`
      INSERT INTO fanmark_favorites (
        id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nextUuid(), favoriteUserId, discoveryId, fanmarkId, JSON.stringify([index]), NOW, "favorite-" + emoji,
    ).run();
  }
  return { fanmarkId, licenseId, shortId, displayFanmark: emoji };
}

async function setSystemSetting(database, key, value) {
  await database.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, is_public, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).bind(key, String(value), NOW, NOW).run();
}

test("active subscription created/updated reconciles current Stripe state and maps plan by mode", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database);
    await database.prepare(`
      INSERT INTO user_subscriptions (
        id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
        created_at, updated_at, payment_failure_at, next_payment_attempt, payment_failure_type
      ) VALUES (?, ?, ?, ?, 'prod_old', 'past_due', ?, ?, ?, ?, 'invoice.payment_failed')
    `).bind(
      nextUuid(), USER_ID, CUSTOMER_ID, SUBSCRIPTION_ID, NOW, NOW,
      "2026-09-25T05:00:00.000Z", "2026-10-01T05:00:00.000Z",
    ).run();
    const staleEvent = subscriptionEvent({ subscription: subscriptionSnapshot({ priceId: PRICE_IDS.creator }) });
    const claim = await claimEvent(database, staleEvent);
    const current = subscriptionSnapshot({ priceId: PRICE_IDS.max, periodStart: 1790400000, periodEnd: 1792992000 });
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database),
      claim,
      now: NOW,
      getNow: () => NOW,
      provider: provider({ current, active: [current] }),
      createId: nextUuid,
      createFenceToken: nextUuid,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.effectivePlanType, "max");
    assert.equal(result.activeSubscriptionCount, 1);
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "max");
    assert.equal(await scalar(database, "SELECT price_id AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), PRICE_IDS.max);
    assert.equal(await scalar(database, "SELECT payment_failure_at AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), null);
    assert.equal(await scalar(database, "SELECT next_payment_attempt AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), null);
    assert.equal(await scalar(database, "SELECT payment_failure_type AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), null);
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_subscription_applications"), "applied");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_transaction_guards"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("non-active subscription updates are projected without granting or removing plan entitlement", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "business" });
    const current = subscriptionSnapshot({ status: "trialing" });
    const claim = await claimEvent(database, subscriptionEvent({ subscription: current }));
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current, active: [] }), createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.effectivePlanType, undefined);
    assert.equal(result.activeSubscriptionCount, 0);
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "business");
    assert.equal(await scalar(database, "SELECT status AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), "trialing");
  } finally {
    await miniflare.dispose();
  }
});

test("live subscriptions use only the explicit live Price ID settings", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { livemode: true });
    const current = subscriptionSnapshot({ livemode: true, priceId: LIVE_PRICE_IDS.business });
    const claim = await claimEvent(database, subscriptionEvent({ subscription: current }));
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current, active: [current], livemode: true }), createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.effectivePlanType, "business");
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "business");
  } finally {
    await miniflare.dispose();
  }
});

test("active subscriptions choose the highest source plan order deterministically", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database);
    const creator = subscriptionSnapshot({ subscriptionId: SUBSCRIPTION_ID, priceId: PRICE_IDS.creator });
    const business = subscriptionSnapshot({
      subscriptionId: "sub_synthetic_business_002",
      priceId: PRICE_IDS.business,
      periodStart: 1790395507,
      periodEnd: 1792987507,
    });
    const claim = await claimEvent(database, subscriptionEvent({ subscription: creator }));
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: creator, active: [creator, business] }), createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.effectivePlanType, "business");
    assert.equal(result.activeSubscriptionCount, 2);
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "business");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM user_subscriptions WHERE status = 'active'"), 2);
  } finally {
    await miniflare.dispose();
  }
});

test("deleted final subscription sets Free and atomically returns newest excess licenses with audit and notifications", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "business" });
    await setSystemSetting(database, "free_fanmarks_limit", 3);
    await setSystemSetting(database, "grace_period_days", 2);
    const favoritesUserId = "00000000-0000-4000-8000-000000000399";
    const licenses = [];
    for (let index = 1; index <= 5; index += 1) {
      licenses.push(await seedActiveLicense(database, {
        licenseStart: "2026-01-0" + String(index) + "T00:00:00.000Z",
        favoriteUserId: index === 5 ? favoritesUserId : null,
      }));
    }
    const deleted = subscriptionSnapshot({ status: "canceled" });
    const claim = await claimEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_subscription_deleted_final",
      type: "customer.subscription.deleted",
      subscription: deleted,
    }));
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: deleted, active: [] }),
      createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.status, "applied");
    assert.equal(result.effectivePlanType, "free");
    assert.equal(result.activeSubscriptionCount, 0);
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "free");
    assert.equal(await scalar(database, "SELECT status AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), "canceled");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_batches"), 1);
    assert.equal(await scalar(database, "SELECT returned_license_count AS value FROM stripe_subscription_return_batches"), 2);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_items"), 2);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM audit_logs WHERE action = 'return_fanmark' AND request_id LIKE ?", [result.applicationId + ":%"]), 2);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM notification_events WHERE event_type = 'fanmark_returned_owner'"), 2);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM notification_events WHERE event_type = 'favorite_fanmark_available'"), 1);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM fanmark_licenses WHERE user_id = ? AND status = 'active'", [USER_ID]), 3);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM fanmark_licenses WHERE user_id = ? AND status = 'grace' AND license_start >= '2026-01-04T00:00:00.000Z'", [USER_ID]), 2);
    assert.equal(await scalar(database, "SELECT grace_expires_at AS value FROM fanmark_licenses WHERE id = ?", [licenses[4].licenseId]), "2026-09-29T00:00:00.000Z");
    assert.equal(await scalar(database, "SELECT excluded_at AS value FROM fanmark_licenses WHERE id = ?", [licenses[4].licenseId]), null);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_transaction_guards"), 0);
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "applied");
  } finally {
    await miniflare.dispose();
  }
});

test("deleted subscription keeps paid entitlement and performs no returns while another active plan remains", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "creator" });
    await setSystemSetting(database, "free_fanmarks_limit", 3);
    const licenses = [];
    for (let index = 1; index <= 5; index += 1) {
      licenses.push(await seedActiveLicense(database, {
        licenseStart: "2026-02-0" + String(index) + "T00:00:00.000Z",
      }));
    }
    const deleted = subscriptionSnapshot({ status: "canceled" });
    const otherActive = subscriptionSnapshot({
      subscriptionId: "sub_synthetic_subscription_other_active",
      priceId: PRICE_IDS.max,
    });
    const claim = await claimEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_subscription_deleted_with_active",
      type: "customer.subscription.deleted",
      subscription: deleted,
    }));
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: deleted, active: [otherActive] }),
      createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.effectivePlanType, "max");
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "max");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_batches"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_items"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM audit_logs WHERE action = 'return_fanmark'"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM notification_events WHERE event_type IN ('fanmark_returned_owner', 'favorite_fanmark_available')"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM fanmark_licenses WHERE user_id = ? AND status = 'active'", [USER_ID]), licenses.length);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_webhook_receipts WHERE status = 'applied'"), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("failed return audit rolls back deletion, Free plan, licenses, notifications, and receipt", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "business" });
    await setSystemSetting(database, "free_fanmarks_limit", 3);
    await seedActiveLicense(database, { licenseStart: "2026-03-01T00:00:00.000Z" });
    await seedActiveLicense(database, { licenseStart: "2026-03-02T00:00:00.000Z" });
    await seedActiveLicense(database, { licenseStart: "2026-03-03T00:00:00.000Z" });
    await seedActiveLicense(database, { licenseStart: "2026-03-04T00:00:00.000Z" });
    await database.prepare(`
      CREATE TRIGGER fail_subscription_return_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'return_fanmark'
      BEGIN SELECT RAISE(ABORT, 'injected subscription return audit failure'); END
    `).run();
    const deleted = subscriptionSnapshot({ status: "canceled" });
    const claim = await claimEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_subscription_deleted_audit_failure",
      type: "customer.subscription.deleted",
      subscription: deleted,
    }));
    await assert.rejects(applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: deleted, active: [] }),
      createId: nextUuid, createFenceToken: nextUuid,
    }));
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "business");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM user_subscriptions"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_applications"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_batches"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_items"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM fanmark_licenses WHERE user_id = ? AND status = 'active'", [USER_ID]), 4);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM notification_events"), 0);
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "processing");
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_dispatches"), "processing");
    assert.equal(await scalar(database, "SELECT owner_token AS value FROM stripe_sync_fences"), null);
  } finally {
    await miniflare.dispose();
  }
});

test("deleted final subscription sets Free when within the default limit without returning licenses", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "creator" });
    const claim = await claimEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_subscription_deleted_under_free_limit",
      type: "customer.subscription.deleted",
      subscription: subscriptionSnapshot({ status: "canceled" }),
    }));
    const deleted = subscriptionSnapshot({ status: "canceled" });
    const result = await applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: deleted, active: [] }),
      createId: nextUuid, createFenceToken: nextUuid,
    });
    assert.equal(result.effectivePlanType, "free");
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "free");
    assert.equal(await scalar(database, "SELECT free_limit AS value FROM stripe_subscription_return_batches"), 3);
    assert.equal(await scalar(database, "SELECT active_license_count AS value FROM stripe_subscription_return_batches"), 0);
    assert.equal(await scalar(database, "SELECT returned_license_count AS value FROM stripe_subscription_return_batches"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_items"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("an active transfer blocks the entire Free-plan return batch", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "business" });
    const freeLimit = 3;
    await setSystemSetting(database, "free_fanmarks_limit", freeLimit);
    const licenses = [];
    for (let index = 1; index <= 4; index += 1) {
      licenses.push(await seedActiveLicense(database, {
        licenseStart: "2026-04-0" + String(index) + "T00:00:00.000Z",
      }));
    }
    const newest = licenses.at(-1);
    await database.prepare(`
      INSERT INTO fanmark_transfer_codes (
        id, license_id, fanmark_id, issuer_user_id, transfer_code, status,
        expires_at, disclaimer_agreed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).bind(
      nextUuid(), newest.licenseId, newest.fanmarkId, USER_ID, "SYNTHETIC-TRANSFER-CODE",
      "2026-10-01T00:00:00.000Z", NOW, NOW, NOW,
    ).run();
    const deleted = subscriptionSnapshot({ status: "canceled" });
    const claim = await claimEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_subscription_deleted_transfer_block",
      type: "customer.subscription.deleted",
      subscription: deleted,
    }));
    await assert.rejects(applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current: deleted, active: [] }),
      createId: nextUuid, createFenceToken: nextUuid,
    }));
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "business");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM user_subscriptions"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_applications"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_batches"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_items"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM audit_logs WHERE action = 'return_fanmark'"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM notification_events"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM fanmark_licenses WHERE user_id = ? AND status = 'active'", [USER_ID]), licenses.length);
    assert.equal(await scalar(database, "SELECT owner_token AS value FROM stripe_sync_fences"), null);
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled D1 dispatcher routes created/updated subscription events to reconciliation", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database);
    const current = subscriptionSnapshot();
    await acceptEvent(database, subscriptionEvent({ subscription: current }));
    const summary = await dispatchStripeWebhookBatchInD1({
      database: checkedDatabase(database),
      livemode: false,
      now: NOW,
      getNow: () => NOW,
      subscriptionProvider: provider({ current, active: [current] }),
    });
    assert.deepEqual(summary, {
      claimed: 1, applied: 1, ignored: 0, deadLettered: 0, retryable: 0, leaseLost: 0,
    });
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "creator");
  } finally {
    await miniflare.dispose();
  }
});

test("scheduled D1 dispatcher routes deleted events through atomic Free reconciliation", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { planType: "business" });
    const current = subscriptionSnapshot({ status: "canceled" });
    await acceptEvent(database, subscriptionEvent({
      eventId: "evt_synthetic_scheduled_subscription_deleted",
      type: "customer.subscription.deleted",
      subscription: current,
    }));
    const summary = await dispatchStripeWebhookBatchInD1({
      database: checkedDatabase(database),
      livemode: false,
      now: NOW,
      getNow: () => NOW,
      subscriptionProvider: provider({ current, active: [] }),
    });
    assert.deepEqual(summary, {
      claimed: 1, applied: 1, ignored: 0, deadLettered: 0, retryable: 0, leaseLost: 0,
    });
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "applied");
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "free");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_return_batches"), 1);
    assert.equal(await scalar(database, "SELECT status AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), "canceled");
  } finally {
    await miniflare.dispose();
  }
});

test("missing exact customer mapping fails closed without email matching or partial writes", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database, { customerId: null });
    const current = subscriptionSnapshot();
    const claim = await claimEvent(database, subscriptionEvent({ subscription: current }));
    await assert.rejects(applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current, active: [current], userId: null }), createId: nextUuid, createFenceToken: nextUuid,
    }), /subscription_customer_mapping_review_required/u);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM user_subscriptions"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_applications"), 0);
    assert.equal(await scalar(database, "SELECT status AS value FROM stripe_webhook_receipts"), "processing");
    assert.equal(await scalar(database, "SELECT owner_token AS value FROM stripe_sync_fences"), null);
  } finally {
    await miniflare.dispose();
  }
});

test("subscription ownership conflict aborts the full D1 application batch", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await seedConfiguration(database);
    const otherUser = "00000000-0000-4000-8000-000000000399";
    await database.prepare(`
      INSERT INTO user_subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id,
        product_id, status, created_at, updated_at)
      VALUES (?, ?, 'cus_synthetic_other', ?, 'prod_other', 'canceled', ?, ?)
    `).bind("00000000-0000-4000-8000-000000000398", otherUser, SUBSCRIPTION_ID, NOW, NOW).run();
    const current = subscriptionSnapshot();
    const claim = await claimEvent(database, subscriptionEvent({ subscription: current }));
    await assert.rejects(applyStripeSubscriptionReceiptInD1({
      database: checkedDatabase(database), claim, now: NOW, getNow: () => NOW,
      provider: provider({ current, active: [current] }), createId: nextUuid, createFenceToken: nextUuid,
    }));
    assert.equal(await scalar(database, "SELECT user_id AS value FROM user_subscriptions WHERE stripe_subscription_id = ?", [SUBSCRIPTION_ID]), otherUser);
    assert.equal(await scalar(database, "SELECT plan_type AS value FROM user_settings WHERE user_id = ?", [USER_ID]), "free");
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_applications"), 0);
    assert.equal(await scalar(database, "SELECT COUNT(*) AS value FROM stripe_subscription_transaction_guards"), 0);
  } finally {
    await miniflare.dispose();
  }
});

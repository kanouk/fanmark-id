#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const modulePath = path.join(repoRoot, "workers/api/src/stripe-plan-change-d1-api.ts");
const { handleStripePlanChangeD1Request, isStripePlanChangePath } = await import(pathToFileURL(modulePath).href);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000009";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-09-26T08:00:00.000000Z";
const ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const CUSTOMER_ID = "cus_syntheticCustomer01";
const SUBSCRIPTION_ID = "sub_syntheticSubscription01";
const CREATOR_PRICE_ID = "price_syntheticCreator01";
const MAX_PRICE_ID = "price_syntheticMax01";
const BUSINESS_PRICE_ID = "price_syntheticBusiness01";

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

async function createFixture() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-stripe-plan-change-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { BUSINESS_DB: { type: "d1", name: "fanmark-stripe-plan-change-business-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("BUSINESS_DB");
  try {
    for (const migration of [
      "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
      "workers/api/migrations-business/0012_stripe_plan_checkout_commands.sql",
      "workers/api/migrations-business/0013_stripe_plan_change_commands.sql",
    ]) {
      const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
      for (const statement of splitSqlStatements(sql)) {
        const result = await database.prepare(statement).run();
        assert.equal(result.success, true, `${migration}: ${statement.slice(0, 120)}`);
      }
    }
    return { miniflare, database };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

function configuredEnv(database, overrides = {}) {
  return {
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_URL: ORIGIN,
    CORS_ALLOWED_ORIGINS: ORIGIN,
    STRIPE_PLAN_CHANGE_BACKEND: "d1",
    STRIPE_WEBHOOK_BACKEND: "d1",
    STRIPE_DISPATCH_BACKEND: "d1",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_SECRET_KEY_TEST: "sk_test_synthetic",
    STRIPE_SECRET_KEY_LIVE: "sk_live_synthetic",
    ...overrides,
  };
}

function request({
  method = "POST", origin = ORIGIN,
  body = { new_plan_type: "max", request_id: REQUEST_ID },
} = {}) {
  return new Request(`${ORIGIN}/api/billing/plan-change`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

async function insertPrice(database, plan, priceId, suffix = "") {
  await database.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, is_public, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).bind(`${plan}_stripe_price_id${suffix}`, priceId, NOW, NOW).run();
}

async function insertUser(database, { userId = USER_ID, plan = "creator", customerId = CUSTOMER_ID,
  subscriptionCustomerId = customerId, subscriptionId = SUBSCRIPTION_ID, priceId = CREATOR_PRICE_ID } = {}) {
  await database.prepare(`
    INSERT INTO user_settings (
      id, user_id, username, plan_type, preferred_language, created_at, updated_at, stripe_customer_id
    ) VALUES (?, ?, ?, ?, 'ja', ?, ?, ?)
  `).bind(`00000000-0000-4000-8000-${userId.slice(-12)}`, userId, `user-${userId.slice(-4)}`,
    plan, NOW, NOW, customerId).run();
  await database.prepare(`
    INSERT INTO user_subscriptions (
      id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
      created_at, updated_at, price_id, amount, currency, interval, interval_count
    ) VALUES (?, ?, ?, ?, 'prod_synthetic', 'active', ?, ?, ?, 1000, 'jpy', 'month', 1)
  `).bind(`00000000-0000-4000-8000-${userId.slice(-12, -1)}1`, userId, subscriptionCustomerId,
    subscriptionId, NOW, NOW, priceId).run();
}

async function insertPrices(database, currentPlan = "creator", currentPrice = CREATOR_PRICE_ID) {
  await insertPrice(database, "creator", CREATOR_PRICE_ID);
  await insertPrice(database, "max", MAX_PRICE_ID);
  await insertPrice(database, "business", BUSINESS_PRICE_ID);
  assert.equal(currentPlan === "creator" ? currentPrice : currentPlan === "max" ? currentPrice : BUSINESS_PRICE_ID,
    currentPlan === "creator" ? CREATOR_PRICE_ID : currentPlan === "max" ? MAX_PRICE_ID : BUSINESS_PRICE_ID);
}

async function addActiveLicense(database, suffix = "4") {
  const fanmarkId = `10000000-0000-4000-8000-00000000000${suffix}`;
  const licenseId = `20000000-0000-4000-8000-00000000000${suffix}`;
  await database.prepare(`
    INSERT INTO fanmarks (
      id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, tier_level
    ) VALUES (?, '🌸', ?, ?, 'active', ?, ?, 1)
  `).bind(fanmarkId, `synthetic-${suffix}`, `synthetic-${suffix}`, NOW, NOW).run();
  await database.prepare(`
    INSERT INTO fanmark_licenses (
      id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 'active', 1, ?, ?)
  `).bind(licenseId, fanmarkId, USER_ID, NOW, NOW, NOW).run();
}

function fakeStripe({ currentPriceId = CREATOR_PRICE_ID, resultStatus = "active", paymentStatus = "succeeded",
  loseFirstUpdateAck = false, loseFirstCancelAck = false } = {}) {
  const calls = [];
  const resultsByKey = new Map();
  let loseUpdate = loseFirstUpdateAck;
  let loseCancel = loseFirstCancelAck;
  let subscription = {
    id: SUBSCRIPTION_ID,
    status: "active",
    livemode: false,
    cancel_at_period_end: true,
    customer: CUSTOMER_ID,
    items: { data: [{ id: "si_synthetic01", price: { id: currentPriceId } }] },
    latest_invoice: { payment_intent: { status: "succeeded" } },
  };
  return {
    calls,
    liveSubscription: () => structuredClone(subscription),
    createStripeClient(secret) {
      calls.push({ type: "client", secret });
      return {
        prices: {
          async retrieve(id) {
            calls.push({ type: "price", id });
            return {
              id,
              active: true,
              livemode: false,
              type: "recurring",
              currency: "jpy",
              recurring: { interval: "month", interval_count: 1 },
            };
          },
        },
        subscriptions: {
          async retrieve(id, params) {
            calls.push({ type: "subscription_retrieve", id, params });
            return structuredClone(subscription);
          },
          async update(id, params, options) {
            calls.push({ type: "subscription_update", id, params, options });
            let result = resultsByKey.get(options.idempotencyKey);
            if (!result) {
              subscription = {
                ...subscription,
                status: resultStatus,
                cancel_at_period_end: params.cancel_at_period_end,
                items: { data: [{ id: params.items[0].id, price: { id: params.items[0].price } }] },
                latest_invoice: { payment_intent: { status: paymentStatus } },
              };
              result = structuredClone(subscription);
              resultsByKey.set(options.idempotencyKey, result);
            }
            if (loseUpdate) { loseUpdate = false; throw new Error("synthetic_update_ack_lost"); }
            return structuredClone(result);
          },
          async cancel(id, params, options) {
            calls.push({ type: "subscription_cancel", id, params, options });
            let result = resultsByKey.get(options.idempotencyKey);
            if (!result) {
              subscription = { ...subscription, status: "canceled" };
              result = structuredClone(subscription);
              resultsByKey.set(options.idempotencyKey, result);
            }
            if (loseCancel) { loseCancel = false; throw new Error("synthetic_cancel_ack_lost"); }
            return structuredClone(result);
          },
        },
      };
    },
  };
}

function deps(stripe, userId = USER_ID) {
  return { resolveUser: async () => userId, now: () => new Date(NOW), ...stripe };
}

async function invoke(database, stripe, { body, userId = USER_ID, env = {}, origin = ORIGIN } = {}) {
  return handleStripePlanChangeD1Request(request({ body, origin }), configuredEnv(database, env), deps(stripe, userId));
}

test("plan-change route is off by default and requires the complete webhook/dispatch path", async () => {
  const fixture = await createFixture();
  try {
    assert.equal(isStripePlanChangePath("/api/billing/plan-change"), true);
    assert.equal(isStripePlanChangePath("/api/billing/plan-change/"), false);
    const stripe = fakeStripe();
    assert.equal(await handleStripePlanChangeD1Request(request(), {}, { resolveUser: async () => { throw new Error("unused"); } }), null);
    const result = await invoke(fixture.database, stripe, {
      env: { STRIPE_DISPATCH_BACKEND: undefined },
    });
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: "stripe_plan_change_not_ready" });
    assert.deepEqual(stripe.calls, []);
  } finally { await fixture.miniflare.dispose(); }
});

test("upgrade uses proration, same-time billing anchor, stable command, and webhook-only entitlement", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database);
    const stripe = fakeStripe();
    const response = await invoke(fixture.database, stripe);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, updated: true, pending: true });
    const update = stripe.calls.find((call) => call.type === "subscription_update");
    assert.equal(update.id, SUBSCRIPTION_ID);
    assert.equal(update.params.items[0].price, MAX_PRICE_ID);
    assert.equal(update.params.proration_behavior, "create_prorations");
    assert.equal(update.params.billing_cycle_anchor, "now");
    assert.equal(update.params.payment_behavior, "default_incomplete");
    assert.equal(update.options.idempotencyKey, `fanmark-plan-change:${REQUEST_ID}`);
    const profile = await fixture.database.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?")
      .bind(USER_ID).first();
    assert.equal(profile.plan_type, "creator");
    const command = await fixture.database.prepare("SELECT status, from_plan_type, to_plan_type FROM stripe_plan_change_commands WHERE request_id = ?")
      .bind(REQUEST_ID).first();
    assert.deepEqual(command, { status: "submitted", from_plan_type: "creator", to_plan_type: "max" });
    const retry = await invoke(fixture.database, stripe);
    assert.equal(retry.status, 200);
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_update").length, 1);
  } finally { await fixture.miniflare.dispose(); }
});

test("paid downgrade uses no proration and refuses to proceed before selected licenses fit", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database, "max", MAX_PRICE_ID);
    await insertUser(fixture.database, { plan: "max", priceId: MAX_PRICE_ID });
    const stripe = fakeStripe({ currentPriceId: MAX_PRICE_ID });
    const allowed = await invoke(fixture.database, stripe, {
      body: { new_plan_type: "creator", request_id: REQUEST_ID },
    });
    assert.equal(allowed.status, 200);
    assert.equal(stripe.calls.find((call) => call.type === "subscription_update").params.proration_behavior, "none");

    const blockedFixture = await createFixture();
    try {
      await insertPrices(blockedFixture.database, "max", MAX_PRICE_ID);
      await insertUser(blockedFixture.database, { plan: "max", priceId: MAX_PRICE_ID });
      await blockedFixture.database.prepare(`
        INSERT INTO system_settings (setting_key, setting_value, is_public, created_at, updated_at)
        VALUES ('creator_fanmarks_limit', '0', 0, ?, ?)
      `).bind(NOW, NOW).run();
      await addActiveLicense(blockedFixture.database);
      const blockedStripe = fakeStripe({ currentPriceId: MAX_PRICE_ID });
      const denied = await invoke(blockedFixture.database, blockedStripe, {
        body: { new_plan_type: "creator", request_id: REQUEST_ID },
      });
      assert.equal(denied.status, 409);
      assert.deepEqual(await denied.json(), { error: "plan_limit_exceeded" });
      assert.equal(blockedStripe.calls.some((call) => call.type === "subscription_update"), false);
    } finally { await blockedFixture.miniflare.dispose(); }
  } finally { await fixture.miniflare.dispose(); }
});

test("immediate return to Free cancels Stripe but does not grant the Free plan locally", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database);
    const stripe = fakeStripe();
    const response = await invoke(fixture.database, stripe, {
      body: { new_plan_type: "free", request_id: REQUEST_ID },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, updated: true, pending: true });
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_cancel").length, 1);
    assert.equal(stripe.calls.some((call) => call.type === "subscription_update"), false);
    const profile = await fixture.database.prepare("SELECT plan_type FROM user_settings WHERE user_id = ?")
      .bind(USER_ID).first();
    assert.equal(profile.plan_type, "creator");
    const retry = await invoke(fixture.database, stripe, {
      body: { new_plan_type: "free", request_id: REQUEST_ID },
    });
    assert.equal(retry.status, 200);
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_cancel").length, 1);
  } finally { await fixture.miniflare.dispose(); }
});

test("lost update acknowledgement resumes from Stripe current state without a second mutation", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database);
    const stripe = fakeStripe({ loseFirstUpdateAck: true });
    const first = await invoke(fixture.database, stripe);
    assert.equal(first.status, 502);
    const stored = await fixture.database.prepare("SELECT status FROM stripe_plan_change_commands WHERE request_id = ?")
      .bind(REQUEST_ID).first();
    assert.equal(stored.status, "prepared");
    const retry = await invoke(fixture.database, stripe);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { success: true, updated: true, pending: true });
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_update").length, 1);
  } finally { await fixture.miniflare.dispose(); }
});

test("payment action stays pending, request ownership conflicts, and a second open command is blocked", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database);
    const stripe = fakeStripe({ resultStatus: "incomplete", paymentStatus: "requires_action" });
    const response = await invoke(fixture.database, stripe);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, updated: false, pending: true, requires_action: true });
    const otherOwner = await invoke(fixture.database, stripe, { userId: OTHER_USER_ID });
    assert.equal(otherOwner.status, 409);
    assert.deepEqual(await otherOwner.json(), { error: "request_id_conflict" });
    const second = await invoke(fixture.database, stripe, {
      body: { new_plan_type: "business", request_id: OTHER_REQUEST_ID },
    });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: "plan_change_payment_required" });
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_update").length, 1);
  } finally { await fixture.miniflare.dispose(); }
});

test("current customer, subscription, Price, and plan must agree before Stripe mutation", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database, { customerId: "cus_differentOwner" });
    const stripe = fakeStripe();
    const response = await invoke(fixture.database, stripe);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "stripe_subscription_mismatch" });
    assert.equal(stripe.calls.some((call) => call.type === "subscription_update"), false);
  } finally { await fixture.miniflare.dispose(); }
});

test("profile and subscription customer mappings must agree and live mode never uses test credentials", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database, { subscriptionCustomerId: "cus_differentOwner" });
    const stripe = fakeStripe();
    const mappingMismatch = await invoke(fixture.database, stripe);
    assert.equal(mappingMismatch.status, 409);
    assert.deepEqual(await mappingMismatch.json(), { error: "stripe_customer_mapping_invalid" });
    assert.equal(stripe.calls.some((call) => call.type === "subscription_update"), false);

    await fixture.database.prepare("DELETE FROM user_subscriptions WHERE user_id = ?").bind(USER_ID).run();
    await fixture.database.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(USER_ID).run();
    await insertUser(fixture.database);
    const liveMode = await invoke(fixture.database, fakeStripe(), {
      env: {
        STRIPE_SECRET_KEY: "sk_live_synthetic",
        STRIPE_SECRET_KEY_LIVE: "sk_live_synthetic",
      },
    });
    assert.equal(liveMode.status, 409);
    assert.deepEqual(await liveMode.json(), { error: "stripe_subscription_mismatch" });
  } finally { await fixture.miniflare.dispose(); }
});

test("concurrent different commands serialize on the owner open-command index", async () => {
  const fixture = await createFixture();
  try {
    await insertPrices(fixture.database);
    await insertUser(fixture.database);
    const stripe = fakeStripe();
    const [first, second] = await Promise.all([
      invoke(fixture.database, stripe, { body: { new_plan_type: "max", request_id: REQUEST_ID } }),
      invoke(fixture.database, stripe, { body: { new_plan_type: "business", request_id: OTHER_REQUEST_ID } }),
    ]);
    const payloads = await Promise.all([first.clone().json(), second.clone().json()]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    assert.deepEqual(statuses, [200, 409], JSON.stringify(payloads));
    assert.equal(stripe.calls.filter((call) => call.type === "subscription_update").length, 1);
    const open = await fixture.database.prepare("SELECT COUNT(*) AS count FROM stripe_plan_change_commands WHERE status IN ('prepared','requires_action')").first();
    assert.equal(open.count, 0);
  } finally { await fixture.miniflare.dispose(); }
});

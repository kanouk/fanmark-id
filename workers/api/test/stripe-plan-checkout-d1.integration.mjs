#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const modulePath = path.join(repoRoot, "workers/api/src/stripe-plan-checkout-d1-api.ts");
const { handleStripePlanCheckoutD1Request, isStripePlanCheckoutPath } = await import(pathToFileURL(modulePath).href);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-09-26T08:00:00.000000Z";
const ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const CUSTOMER_ID = "cus_syntheticCustomer01";
const PRICE_ID = "price_syntheticCreator01";
const SESSION_ID = "cs_test_syntheticSession01";

function splitSqlStatements(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements = [];
  let current = "";
  let parentheses = 0;
  let trigger = false;
  for (const line of source.split(/\r?\n/u)) {
    current += `${line}\n`;
    if (!trigger && /^\s*CREATE\s+TRIGGER\b/iu.test(current)) trigger = true;
    if (!trigger) {
      for (const character of line) {
        if (character === "(") parentheses += 1;
        if (character === ")") parentheses -= 1;
      }
      if (line.trimEnd().endsWith(";") && parentheses === 0) {
        statements.push(current.trim());
        current = "";
      }
    } else if (/^\s*END;\s*$/u.test(line)) {
      statements.push(current.trim());
      current = "";
      trigger = false;
      parentheses = 0;
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
        name: "fanmark-stripe-plan-checkout-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { BUSINESS_DB: { type: "d1", name: "fanmark-stripe-plan-checkout-business-test" } },
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
    STRIPE_PLAN_CHECKOUT_BACKEND: "d1",
    STRIPE_WEBHOOK_BACKEND: "d1",
    STRIPE_DISPATCH_BACKEND: "d1",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_SECRET_KEY_TEST: "sk_test_synthetic",
    STRIPE_SECRET_KEY_LIVE: "sk_live_synthetic",
    ...overrides,
  };
}

function request({ method = "POST", origin = ORIGIN, body = { plan_type: "creator", request_id: REQUEST_ID } } = {}) {
  return new Request(`${ORIGIN}/api/billing/plan-checkout`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

async function insertUser(database, { plan = "free", stripeCustomerId = null } = {}) {
  await database.prepare(`
    INSERT INTO user_settings (
      id, user_id, username, plan_type, preferred_language, created_at, updated_at, stripe_customer_id
    ) VALUES (?, ?, 'synthetic-user', ?, 'ja', ?, ?, ?)
  `).bind("00000000-0000-4000-8000-000000000010", USER_ID, plan, NOW, NOW, stripeCustomerId).run();
}

async function insertPrice(database, { plan = "creator", priceId = PRICE_ID, suffix = "" } = {}) {
  await database.prepare(`
    INSERT INTO system_settings (setting_key, setting_value, is_public, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).bind(`${plan}_stripe_price_id${suffix}`, priceId, NOW, NOW).run();
}

function fakeStripe({
  checkoutUrl = "https://checkout.stripe.com/c/pay/synthetic",
  price = {},
  sessionStatus = "open",
  customerErrorOnce = false,
} = {}) {
  const calls = [];
  const sessions = new Map();
  const customersByIdempotencyKey = new Map();
  let failCustomerAcknowledgement = customerErrorOnce;
  return {
    calls,
    createStripeClient(secret) {
      calls.push({ type: "client", secret });
      return {
        prices: {
          async retrieve(priceId) {
            calls.push({ type: "price", priceId });
            return {
              id: PRICE_ID,
              active: true,
              livemode: false,
              type: "recurring",
              currency: "jpy",
              recurring: { interval: "month", interval_count: 1 },
              ...price,
            };
          },
        },
        customers: {
          async create(params, options) {
            calls.push({ type: "customer_create", params, options });
            let customer = customersByIdempotencyKey.get(options.idempotencyKey);
            if (!customer) {
              customer = { id: CUSTOMER_ID };
              customersByIdempotencyKey.set(options.idempotencyKey, customer);
            }
            if (failCustomerAcknowledgement) {
              failCustomerAcknowledgement = false;
              throw new Error("synthetic_customer_response_lost");
            }
            return customer;
          },
        },
        checkout: {
          sessions: {
            async create(params, options) {
              calls.push({ type: "session_create", params, options });
              const session = {
                id: SESSION_ID,
                url: checkoutUrl,
                status: sessionStatus,
                customer: params.customer,
              };
              sessions.set(session.id, session);
              return session;
            },
            async retrieve(sessionId) {
              calls.push({ type: "session_retrieve", sessionId });
              return sessions.get(sessionId) ?? { id: sessionId, url: null, status: "expired", customer: CUSTOMER_ID };
            },
          },
        },
      };
    },
  };
}

function deps(stripe, user = { id: USER_ID, email: "synthetic@example.com" }) {
  return {
    resolveUser: async () => user,
    now: () => new Date(NOW),
    ...stripe,
  };
}

test("plan checkout is disabled until selected and refuses incomplete Stripe readiness", async () => {
  const fixture = await createFixture();
  try {
    assert.equal(isStripePlanCheckoutPath("/api/billing/plan-checkout"), true);
    assert.equal(isStripePlanCheckoutPath("/api/billing/plan-checkout/"), false);
    assert.equal(await handleStripePlanCheckoutD1Request(request(), {}, {
      resolveUser: async () => { throw new Error("must not resolve"); },
    }), null);
    const stripe = fakeStripe();
    const unready = await handleStripePlanCheckoutD1Request(request(), configuredEnv(fixture.database, {
      STRIPE_DISPATCH_BACKEND: undefined,
    }), deps(stripe));
    assert.equal(unready?.status, 503);
    assert.deepEqual(await unready?.json(), { error: "stripe_checkout_not_ready" });
    assert.deepEqual(stripe.calls, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("plan checkout enforces allowed origin, method, payload, and Better Auth identity", async () => {
  const fixture = await createFixture();
  try {
    const stripe = fakeStripe();
    const environment = configuredEnv(fixture.database);
    let authCalls = 0;
    const dependencies = {
      ...deps(stripe),
      resolveUser: async () => { authCalls += 1; return { id: USER_ID, email: "synthetic@example.com" }; },
    };
    const options = await handleStripePlanCheckoutD1Request(request({ method: "OPTIONS" }), environment, dependencies);
    assert.equal(options?.status, 204);
    assert.equal(authCalls, 0);
    const blocked = await handleStripePlanCheckoutD1Request(request({ origin: "https://attacker.example" }), environment, dependencies);
    assert.equal(blocked?.status, 403);
    assert.equal(authCalls, 0);
    const get = await handleStripePlanCheckoutD1Request(request({ method: "GET" }), environment, dependencies);
    assert.equal(get?.status, 405);
    assert.equal(authCalls, 0);
    const unauthenticated = await handleStripePlanCheckoutD1Request(request(), environment, {
      ...dependencies,
      resolveUser: async () => null,
    });
    assert.equal(unauthenticated?.status, 401);
    const invalidBody = await handleStripePlanCheckoutD1Request(request({ body: { plan_type: "free", request_id: "bad" } }), environment, dependencies);
    assert.equal(invalidBody?.status, 400);
    assert.deepEqual(stripe.calls, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("plan checkout creates an owner-mapped customer and an idempotent monthly subscription session", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    const stripe = fakeStripe();
    const response = await handleStripePlanCheckoutD1Request(
      request(), configuredEnv(fixture.database), deps(stripe),
    );
    assert.equal(response?.status, 200);
    assert.deepEqual(await response?.json(), { url: "https://checkout.stripe.com/c/pay/synthetic" });
    assert.deepEqual(stripe.calls, [
      { type: "client", secret: "sk_test_synthetic" },
      { type: "price", priceId: PRICE_ID },
      {
        type: "customer_create",
        params: { email: "synthetic@example.com", metadata: { user_id: USER_ID } },
        options: { idempotencyKey: `fanmark-plan-customer:${USER_ID}` },
      },
      {
        type: "session_create",
        params: {
          mode: "subscription",
          customer: CUSTOMER_ID,
          client_reference_id: USER_ID,
          line_items: [{ price: PRICE_ID, quantity: 1 }],
          success_url: `${ORIGIN}/plans?checkout=success`,
          cancel_url: `${ORIGIN}/plans?checkout=canceled`,
          metadata: { user_id: USER_ID, plan_type: "creator", billing_command_id: REQUEST_ID },
          subscription_data: { metadata: { user_id: USER_ID, plan_type: "creator", billing_command_id: REQUEST_ID } },
        },
        options: { idempotencyKey: `fanmark-plan-checkout:${REQUEST_ID}` },
      },
    ]);
    const mapped = await fixture.database.prepare(
      "SELECT stripe_customer_id, plan_type FROM user_settings WHERE user_id = ?",
    ).bind(USER_ID).first();
    assert.equal(mapped.stripe_customer_id, CUSTOMER_ID);
    assert.equal(mapped.plan_type, "free", "Checkout initiation must not grant entitlement before the webhook");
    const command = await fixture.database.prepare(
      "SELECT request_id, user_id, plan_type, stripe_customer_id, stripe_checkout_session_id, status FROM stripe_plan_checkout_commands",
    ).first();
    assert.deepEqual(command, {
      request_id: REQUEST_ID,
      user_id: USER_ID,
      plan_type: "creator",
      stripe_customer_id: CUSTOMER_ID,
      stripe_checkout_session_id: SESSION_ID,
      status: "session_created",
    });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("plan checkout retry retrieves the same open session and never creates another customer or session", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    const stripe = fakeStripe();
    const environment = configuredEnv(fixture.database);
    const first = await handleStripePlanCheckoutD1Request(request(), environment, deps(stripe));
    assert.equal(first?.status, 200);
    const second = await handleStripePlanCheckoutD1Request(request(), environment, deps(stripe));
    assert.equal(second?.status, 200);
    assert.deepEqual(await second?.json(), { url: "https://checkout.stripe.com/c/pay/synthetic" });
    assert.equal(stripe.calls.filter((call) => call.type === "customer_create").length, 1);
    assert.equal(stripe.calls.filter((call) => call.type === "session_create").length, 1);
    assert.equal(stripe.calls.filter((call) => call.type === "session_retrieve").length, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("unknown Stripe customer acknowledgement is recovered with the same provider idempotency key", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    const stripe = fakeStripe({ customerErrorOnce: true });
    const environment = configuredEnv(fixture.database);
    const lost = await handleStripePlanCheckoutD1Request(request(), environment, deps(stripe));
    assert.equal(lost?.status, 502);
    assert.deepEqual(await lost?.json(), { error: "stripe_checkout_unavailable" });
    const pending = await fixture.database.prepare(
      "SELECT status, stripe_customer_id FROM stripe_plan_customer_commands WHERE user_id = ?",
    ).bind(USER_ID).first();
    assert.deepEqual(pending, { status: "pending", stripe_customer_id: null });

    const retried = await handleStripePlanCheckoutD1Request(request(), environment, deps(stripe));
    assert.equal(retried?.status, 200);
    assert.equal(stripe.calls.filter((call) => call.type === "customer_create").length, 2);
    assert.deepEqual(
      stripe.calls.filter((call) => call.type === "customer_create").map((call) => call.options.idempotencyKey),
      [`fanmark-plan-customer:${USER_ID}`, `fanmark-plan-customer:${USER_ID}`],
    );
    const recovered = await fixture.database.prepare(
      "SELECT status, stripe_customer_id FROM stripe_plan_customer_commands WHERE user_id = ?",
    ).bind(USER_ID).first();
    assert.deepEqual(recovered, { status: "created", stripe_customer_id: CUSTOMER_ID });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("an unresolved customer creation past Stripe idempotency retention fails closed", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    await fixture.database.prepare(`
      INSERT INTO stripe_plan_customer_commands (
        user_id, stripe_customer_id, status, idempotency_safe_until, created_at, updated_at
      ) VALUES (?, NULL, 'pending', ?, ?, ?)
    `).bind(USER_ID, "2026-09-26T07:59:59.000000Z", NOW, NOW).run();
    const stripe = fakeStripe();
    const response = await handleStripePlanCheckoutD1Request(request({
      body: { plan_type: "creator", request_id: "00000000-0000-4000-8000-000000000003" },
    }), configuredEnv(fixture.database), deps(stripe));
    assert.equal(response?.status, 409);
    assert.deepEqual(await response?.json(), { error: "stripe_customer_reconciliation_required" });
    assert.equal(stripe.calls.some((call) => call.type === "customer_create"), false);
    const settings = await fixture.database.prepare(
      "SELECT stripe_customer_id FROM user_settings WHERE user_id = ?",
    ).bind(USER_ID).first();
    assert.equal(settings.stripe_customer_id, null);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("plan checkout rejects request ID reuse for a different plan and requires an unlinked free account", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    await insertPrice(fixture.database, { plan: "business", priceId: "price_syntheticBusiness01" });
    const stripe = fakeStripe();
    const environment = configuredEnv(fixture.database);
    const first = await handleStripePlanCheckoutD1Request(request(), environment, deps(stripe));
    assert.equal(first?.status, 200);
    const conflict = await handleStripePlanCheckoutD1Request(request({
      body: { plan_type: "business", request_id: REQUEST_ID },
    }), environment, deps(stripe));
    assert.equal(conflict?.status, 409);
    assert.deepEqual(await conflict?.json(), { error: "request_id_conflict" });
    assert.equal(stripe.calls.filter((call) => call.type === "session_create").length, 1);

    const paid = await createFixture();
    try {
      await insertUser(paid.database, { plan: "creator" });
      await insertPrice(paid.database);
      const noSecondPurchase = await handleStripePlanCheckoutD1Request(
        request(), configuredEnv(paid.database), deps(fakeStripe()),
      );
      assert.equal(noSecondPurchase?.status, 409);
      assert.deepEqual(await noSecondPurchase?.json(), { error: "paid_plan_already_active" });
    } finally {
      await paid.miniflare.dispose();
    }
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("plan checkout validates mode and recurring price, and rejects a non-Stripe redirect URL", async () => {
  const fixture = await createFixture();
  try {
    await insertUser(fixture.database);
    await insertPrice(fixture.database);
    const badPrice = fakeStripe({ price: { livemode: true } });
    const mismatch = await handleStripePlanCheckoutD1Request(
      request(), configuredEnv(fixture.database), deps(badPrice),
    );
    assert.equal(mismatch?.status, 503);
    assert.deepEqual(await mismatch?.json(), { error: "stripe_price_mismatch" });
    assert.equal(badPrice.calls.some((call) => call.type === "customer_create"), false);

    const badRedirect = fakeStripe({ checkoutUrl: "https://attacker.example/pay" });
    const invalidSession = await handleStripePlanCheckoutD1Request(
      request(), configuredEnv(fixture.database, { STRIPE_PLAN_CHECKOUT_BACKEND: "d1" }), deps(badRedirect),
    );
    assert.equal(invalidSession?.status, 502);
    assert.deepEqual(await invalidSession?.json(), { error: "stripe_checkout_session_invalid" });
  } finally {
    await fixture.miniflare.dispose();
  }
});

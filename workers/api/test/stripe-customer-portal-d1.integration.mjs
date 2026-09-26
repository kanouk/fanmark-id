#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const modulePath = path.join(repoRoot, "workers/api/src/stripe-customer-portal-d1-api.ts");
const { handleStripeCustomerPortalD1Request, isStripeCustomerPortalPath } = await import(pathToFileURL(modulePath).href);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-09-26T08:00:00.000000Z";
const ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const CUSTOMER_ID = "cus_testCustomer01";

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
        name: "fanmark-stripe-customer-portal-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { BUSINESS_DB: { type: "d1", name: "fanmark-stripe-customer-portal-business-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("BUSINESS_DB");
  const migration = "workers/api/migrations-business/0000_business_schema_v4_staging.sql";
  try {
    const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      const result = await database.prepare(statement).run();
      assert.equal(result.success, true, `${migration}: ${statement.slice(0, 120)}`);
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
    STRIPE_CUSTOMER_PORTAL_BACKEND: "d1",
    STRIPE_WEBHOOK_BACKEND: "d1",
    STRIPE_DISPATCH_BACKEND: "d1",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_SECRET_KEY_TEST: "sk_test_synthetic",
    STRIPE_SECRET_KEY_LIVE: "sk_live_synthetic",
    ...overrides,
  };
}

function request({ method = "POST", origin = ORIGIN } = {}) {
  return new Request(`${ORIGIN}/api/billing/customer-portal`, {
    method,
    headers: origin ? { origin } : {},
  });
}

async function insertSettings(database, stripeCustomerId = CUSTOMER_ID) {
  await database.prepare(`
    INSERT INTO user_settings (id, user_id, username, plan_type, preferred_language, created_at, updated_at, stripe_customer_id)
    VALUES (?, ?, 'synthetic-user', 'creator', 'ja', ?, ?, ?)
  `).bind("00000000-0000-4000-8000-000000000010", USER_ID, NOW, NOW, stripeCustomerId).run();
}

function fakeStripe(resultUrl = "https://billing.stripe.com/p/session/synthetic") {
  const calls = [];
  return {
    calls,
    createStripeClient(secret) {
      calls.push({ type: "client", secret });
      return {
        billingPortal: {
          sessions: {
            async create(params) {
              calls.push({ type: "portal", params });
              return { url: resultUrl };
            },
          },
        },
      };
    },
  };
}

test("customer portal route is disabled until selected and refuses incomplete billing readiness", async (t) => {
  const disabled = await createFixture();
  try {
    assert.equal(isStripeCustomerPortalPath("/api/billing/customer-portal"), true);
    assert.equal(isStripeCustomerPortalPath("/api/billing/customer-portal/"), false);
    assert.equal(await handleStripeCustomerPortalD1Request(request(), {}, {
      resolveUser: async () => { throw new Error("must not resolve"); },
    }), null);
  } finally {
    await disabled.miniflare.dispose();
  }

  const fixture = await createFixture();
  try {
    const stripe = fakeStripe();
    const response = await handleStripeCustomerPortalD1Request(request(), fixture.database, {
      resolveUser: async () => USER_ID,
      ...stripe,
    });
    assert.equal(response, null);
    const unready = await handleStripeCustomerPortalD1Request(request(), configuredEnv(fixture.database, {
      STRIPE_DISPATCH_BACKEND: undefined,
    }), { resolveUser: async () => USER_ID, ...stripe });
    assert.equal(unready?.status, 503);
    assert.equal((await unready?.json()).error, "stripe_portal_not_ready");
    const missingModeKey = await handleStripeCustomerPortalD1Request(request(), configuredEnv(fixture.database, {
      STRIPE_SECRET_KEY_LIVE: undefined,
    }), { resolveUser: async () => USER_ID, ...stripe });
    assert.equal(missingModeKey?.status, 503);
    assert.deepEqual(stripe.calls, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("customer portal enforces allowed same-origin requests and auth", async (t) => {
  const fixture = await createFixture();
  try {
    const stripe = fakeStripe();
    let authCalls = 0;
    const deps = { resolveUser: async () => { authCalls += 1; return USER_ID; }, ...stripe };
    const options = await handleStripeCustomerPortalD1Request(request({ method: "OPTIONS" }), configuredEnv(fixture.database), deps);
    assert.equal(options?.status, 204);
    assert.equal(options?.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(authCalls, 0);

    const blocked = await handleStripeCustomerPortalD1Request(request({ origin: "https://attacker.example" }), configuredEnv(fixture.database), deps);
    assert.equal(blocked?.status, 403);
    assert.equal(authCalls, 0);

    const missingOrigin = await handleStripeCustomerPortalD1Request(request({ origin: "" }), configuredEnv(fixture.database), deps);
    assert.equal(missingOrigin?.status, 403);
    assert.equal(authCalls, 0);

    const unauthenticated = await handleStripeCustomerPortalD1Request(request(), configuredEnv(fixture.database), {
      resolveUser: async () => null,
      ...stripe,
    });
    assert.equal(unauthenticated?.status, 401);
    assert.deepEqual(stripe.calls, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("customer portal needs an exact local Stripe customer mapping and never looks up by email", async () => {
  const fixture = await createFixture();
  try {
    await insertSettings(fixture.database, null);
    const stripe = fakeStripe();
    const response = await handleStripeCustomerPortalD1Request(request(), configuredEnv(fixture.database), {
      resolveUser: async () => USER_ID,
      ...stripe,
    });
    assert.equal(response?.status, 404);
    assert.equal((await response?.json()).error, "stripe_customer_not_linked");
    assert.deepEqual(stripe.calls, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("customer portal passes only the owner-mapped customer and safe return URL to Stripe", async () => {
  const fixture = await createFixture();
  try {
    await insertSettings(fixture.database);
    const stripe = fakeStripe();
    const response = await handleStripeCustomerPortalD1Request(request(), configuredEnv(fixture.database), {
      resolveUser: async () => USER_ID.toUpperCase(),
      ...stripe,
    });
    assert.equal(response?.status, 200);
    assert.deepEqual(await response?.json(), { url: "https://billing.stripe.com/p/session/synthetic" });
    assert.deepEqual(stripe.calls, [
      { type: "client", secret: "sk_test_synthetic" },
      { type: "portal", params: { customer: CUSTOMER_ID, return_url: `${ORIGIN}/plans` } },
    ]);
    const users = await fixture.database.prepare("SELECT COUNT(*) AS count FROM user_settings").first();
    assert.equal(users.count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("customer portal rejects malformed customer IDs and unsafe Stripe URLs", async () => {
  const badCustomer = await createFixture();
  try {
    await insertSettings(badCustomer.database, "cus_ bad");
    const stripe = fakeStripe();
    const response = await handleStripeCustomerPortalD1Request(request(), configuredEnv(badCustomer.database), {
      resolveUser: async () => USER_ID,
      ...stripe,
    });
    assert.equal(response?.status, 404);
    assert.deepEqual(stripe.calls, []);
  } finally {
    await badCustomer.miniflare.dispose();
  }

  const badUrl = await createFixture();
  try {
    await insertSettings(badUrl.database);
    const stripe = fakeStripe("javascript:alert(1)");
    const response = await handleStripeCustomerPortalD1Request(request(), configuredEnv(badUrl.database), {
      resolveUser: async () => USER_ID,
      ...stripe,
    });
    assert.equal(response?.status, 502);
    assert.deepEqual(await response?.json(), { error: "stripe_portal_unavailable" });
  } finally {
    await badUrl.miniflare.dispose();
  }
});

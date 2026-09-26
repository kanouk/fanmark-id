#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  activateReferenceMasterRelease,
  stageReferenceMasterRelease,
} from "../../../scripts/migration/reference-master-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const businessMigrations = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0006_stripe_webhook_ingress_staging.sql",
  "workers/api/migrations-business/0007_stripe_extension_application_staging.sql",
];
const masterMigrations = [
  "workers/api/migrations/0004_reference_master_releases.sql",
  "workers/api/migrations/0006_reference_master_extension_prices.sql",
];
const checkoutModulePath = path.join(repoRoot, "workers/api/src/stripe-extension-checkout-d1-api.ts");
const { handleStripeExtensionCheckoutD1Request } = await import(pathToFileURL(checkoutModulePath).href);

const NOW = new Date("2026-09-26T04:05:06.000Z");
const NOW_SQL = "2026-09-26T04:05:06.000000Z";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const LICENSE_ID = "00000000-0000-4000-8000-000000000002";
const FANMARK_ID = "00000000-0000-4000-8000-000000000003";
const REQUEST_ID = "00000000-0000-4000-8000-000000000004";
const INTENT_ID = "00000000-0000-4000-8000-000000000005";
const RELEASE_VERSION = "a".repeat(64);

const sourceSnapshot = [
  {
    table_name: "fanmark_tiers",
    row_count: 1,
    source_sha256: "1".repeat(64),
    records: [{
      id: "00000000-0000-4000-8000-000000000011",
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: "Synthetic tier",
      display_name: "Synthetic",
      emoji_count_max: 5,
      emoji_count_min: 1,
      initial_license_days: 30,
      is_active: true,
      monthly_price_usd: "3.00",
      tier_level: 2,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "languages",
    row_count: 1,
    source_sha256: "2".repeat(64),
    records: [{
      code: "ja",
      created_at: "2026-09-23T01:02:03.123456+00:00",
      id: "00000000-0000-4000-8000-000000000012",
      is_active: true,
      label: "Japanese",
      native_label: "日本語",
      sort_order: 1,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "reserved_emoji_patterns",
    row_count: 1,
    source_sha256: "3".repeat(64),
    records: [{
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: null,
      id: "00000000-0000-4000-8000-000000000013",
      is_active: false,
      pattern: "🧪",
      price_yen: 1200,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "fanmark_tier_extension_prices",
    row_count: 1,
    source_sha256: "4".repeat(64),
    records: [{
      created_at: "2026-09-23T01:02:03.123456+00:00",
      id: "00000000-0000-4000-8000-000000000014",
      is_active: true,
      months: 3,
      price_yen: 1200,
      stripe_price_id: "price_syntheticTest1",
      stripe_price_id_live: "price_syntheticLive1",
      tier_level: 2,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
];

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

async function applyMigrations(database, migrationPaths) {
  for (const migration of migrationPaths) {
    const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
    for (const statement of splitSqlStatements(sql)) {
      const result = await database.prepare(statement).run();
      assert.equal(result.success, true, `${migration}: ${statement.slice(0, 120)}`);
    }
  }
}

async function createFixture({ licenseStatus = "active", transferLock = null } = {}) {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-stripe-extension-checkout-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: {
          BUSINESS_DB: { type: "d1", name: "fanmark-stripe-extension-checkout-business-test" },
          MASTER_DB: { type: "d1", name: "fanmark-stripe-extension-checkout-master-test" },
        },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const business = await miniflare.getD1Database("BUSINESS_DB");
  const master = await miniflare.getD1Database("MASTER_DB");
  try {
    await applyMigrations(business, businessMigrations);
    await applyMigrations(master, masterMigrations);
    await stageReferenceMasterRelease({ database: master, snapshot: sourceSnapshot, snapshotSha256: RELEASE_VERSION });
    await activateReferenceMasterRelease({ database: master, releaseVersion: RELEASE_VERSION, expectedActiveVersion: null });
    await business.prepare(`
      INSERT INTO fanmarks (
        id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
        emoji_ids, normalized_emoji_ids, tier_level
      ) VALUES (?, '🧪', '🧪', 'testFanmark01', 'active', ?, ?, '["emoji-test"]', '["emoji-test"]', 2)
    `).bind(FANMARK_ID, NOW_SQL, NOW_SQL).run();
    await business.prepare(`
      INSERT INTO fanmark_licenses (
        id, fanmark_id, user_id, license_start, license_end, status, is_initial_license,
        created_at, updated_at, is_returned, is_transferred, transfer_locked_until, display_fanmark
      ) VALUES (?, ?, ?, '2026-01-01T00:00:00.000000Z', '2026-12-31T00:00:00.000000Z', ?, 1,
        ?, ?, 0, 0, ?, '🧪')
    `).bind(LICENSE_ID, FANMARK_ID, USER_ID, licenseStatus, NOW_SQL, NOW_SQL, transferLock).run();
    return { miniflare, business, master };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

function createFakeStripe() {
  const calls = { create: [], retrieve: [] };
  const sessions = new Map();
  return {
    calls,
    client: {
      checkout: {
        sessions: {
          async create(params, options) {
            calls.create.push({ params, options });
            const session = {
              id: `cs_synthetic_${calls.create.length}`,
              url: `https://checkout.stripe.com/c/pay/synthetic-${calls.create.length}`,
              status: "open",
              payment_status: "unpaid",
            };
            sessions.set(session.id, session);
            return session;
          },
          async retrieve(id) {
            calls.retrieve.push(id);
            return sessions.get(id) ?? { id, status: "expired", url: null };
          },
        },
      },
    },
  };
}

function envFor(business, master, overrides = {}) {
  return {
    D1_TOPOLOGY: "split",
    AUTH_BACKEND: "better-auth",
    STRIPE_EXTENSION_CHECKOUT_BACKEND: "d1",
    STRIPE_WEBHOOK_BACKEND: "d1",
    STRIPE_DISPATCH_BACKEND: "d1",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic_only",
    STRIPE_SECRET_KEY: "sk_test_synthetic_only",
    BETTER_AUTH_URL: "https://app.synthetic.example",
    CORS_ALLOWED_ORIGINS: "https://app.synthetic.example",
    FANMARK_DB: business,
    MASTER_DB: master,
    ...overrides,
  };
}

function request({ months = 3, userId = USER_ID, requestId = REQUEST_ID } = {}) {
  return new Request("https://app.synthetic.example/api/billing/extension-checkout", {
    method: "POST",
    headers: {
      origin: "https://app.synthetic.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ license_id: LICENSE_ID, months, request_id: requestId }),
  });
}

function dependencies(fakeStripe, overrides = {}) {
  return {
    resolveUser: async () => USER_ID,
    createStripeClient: () => fakeStripe.client,
    createId: () => INTENT_ID,
    now: () => NOW,
    ...overrides,
  };
}

test("paid D1 checkout pins the active price, persists its intent, and reuses the same open Session", async () => {
  const { miniflare, business, master } = await createFixture();
  try {
    const stripe = createFakeStripe();
    const env = envFor(business, master);
    const first = await handleStripeExtensionCheckoutD1Request(
      request(), env, dependencies(stripe),
    );
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(first.headers.get("access-control-allow-origin"), "https://app.synthetic.example");
    const firstBody = await first.json();
    assert.equal(firstBody.url, "https://checkout.stripe.com/c/pay/synthetic-1");
    assert.equal(stripe.calls.create.length, 1);
    assert.equal(stripe.calls.create[0].params.mode, "payment");
    assert.equal(stripe.calls.create[0].params.line_items[0].price, "price_syntheticTest1");
    assert.equal(stripe.calls.create[0].params.metadata.billing_intent_id, INTENT_ID);
    assert.equal(stripe.calls.create[0].params.metadata.expected_total_yen, "1200");
    assert.equal(stripe.calls.create[0].params.metadata.allow_zero_total, "false");
    assert.equal(stripe.calls.create[0].options.idempotencyKey, `fanmark-extension-checkout:${INTENT_ID}`);
    assert.deepEqual(await business.prepare(`
      SELECT request_id, user_id, license_id, fanmark_id, tier_level, months,
        stripe_price_id, currency, expected_total_yen, allow_zero_total, livemode,
        stripe_checkout_session_id, status
      FROM stripe_extension_checkout_intents WHERE id = ?
    `).bind(INTENT_ID).first(), {
      request_id: REQUEST_ID,
      user_id: USER_ID,
      license_id: LICENSE_ID,
      fanmark_id: FANMARK_ID,
      tier_level: 2,
      months: 3,
      stripe_price_id: "price_syntheticTest1",
      currency: "jpy",
      expected_total_yen: 1200,
      allow_zero_total: 0,
      livemode: 0,
      stripe_checkout_session_id: "cs_synthetic_1",
      status: "open",
    });

    const retry = await handleStripeExtensionCheckoutD1Request(
      request(), env, dependencies(stripe),
    );
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), firstBody);
    assert.equal(stripe.calls.create.length, 1);
    assert.deepEqual(stripe.calls.retrieve, ["cs_synthetic_1"]);
    assert.equal(await business.prepare("SELECT COUNT(*) AS count FROM stripe_extension_checkout_intents")
      .first().then((row) => row.count), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("request ID reuse with changed terms is rejected before another Stripe call", async () => {
  const { miniflare, business, master } = await createFixture();
  try {
    const stripe = createFakeStripe();
    const env = envFor(business, master);
    const first = await handleStripeExtensionCheckoutD1Request(request(), env, dependencies(stripe));
    assert.equal(first.status, 200);
    const replay = await handleStripeExtensionCheckoutD1Request(
      request({ months: 4 }), env, dependencies(stripe),
    );
    assert.equal(replay.status, 409);
    assert.deepEqual(await replay.json(), { error: "checkout_request_conflict" });
    assert.equal(stripe.calls.create.length, 1);
  } finally {
    await miniflare.dispose();
  }
});

test("checkout requires the D1 webhook to be selected and refuses a non-owner", async () => {
  const { miniflare, business, master } = await createFixture();
  try {
    const stripe = createFakeStripe();
    const noWebhook = await handleStripeExtensionCheckoutD1Request(
      request(), envFor(business, master, { STRIPE_WEBHOOK_BACKEND: undefined }), dependencies(stripe),
    );
    assert.equal(noWebhook.status, 503);
    assert.deepEqual(await noWebhook.json(), { error: "stripe_checkout_not_ready" });
    const nonOwner = await handleStripeExtensionCheckoutD1Request(
      request(), envFor(business, master), dependencies(stripe, {
        resolveUser: async () => "00000000-0000-4000-8000-000000000099",
      }),
    );
    assert.equal(nonOwner.status, 403);
    assert.equal(stripe.calls.create.length, 0);
    assert.equal(await business.prepare("SELECT COUNT(*) AS count FROM stripe_extension_checkout_intents")
      .first().then((row) => row.count), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("grace checkout obeys the user's configured active-fanmark limit", async () => {
  const { miniflare, business, master } = await createFixture({ licenseStatus: "grace" });
  try {
    await business.prepare(`
      INSERT INTO user_settings (user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES (?, 'synthetic-user', 'free', 'ja', ?, ?)
    `).bind(USER_ID, NOW_SQL, NOW_SQL).run();
    await business.prepare(`
      INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
      VALUES ('free_fanmarks_limit', '1', ?, ?)
    `).bind(NOW_SQL, NOW_SQL).run();
    await business.prepare(`
      INSERT INTO fanmarks (
        id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
        emoji_ids, normalized_emoji_ids, tier_level
      ) VALUES ('00000000-0000-4000-8000-000000000020', '🌼', '🌼', 'testFanmark02', 'active', ?, ?,
        '["emoji-other"]', '["emoji-other"]', 2)
    `).bind(NOW_SQL, NOW_SQL).run();
    await business.prepare(`
      INSERT INTO fanmark_licenses (
        id, fanmark_id, user_id, license_start, license_end, status, is_initial_license,
        created_at, updated_at, is_returned, is_transferred
      ) VALUES ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020', ?,
        '2026-01-01T00:00:00.000000Z', '2026-12-31T00:00:00.000000Z', 'active', 1, ?, ?, 0, 0)
    `).bind(USER_ID, NOW_SQL, NOW_SQL).run();

    const stripe = createFakeStripe();
    const response = await handleStripeExtensionCheckoutD1Request(
      request(), envFor(business, master), dependencies(stripe),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "fanmark_limit_exceeded" });
    assert.equal(stripe.calls.create.length, 0);
    assert.equal(await business.prepare("SELECT COUNT(*) AS count FROM stripe_extension_checkout_intents")
      .first().then((row) => row.count), 0);
  } finally {
    await miniflare.dispose();
  }
});

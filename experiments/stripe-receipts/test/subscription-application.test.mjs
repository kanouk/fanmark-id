import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { processAcceptedStripeSubscriptionReceipt } from "../../../supabase/functions/_shared/stripe-subscription-application/index.ts";

const migration = async (name) =>
  readFile(
    new URL(`../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
const foundationSql = await migration(
  "20260921090000_add_stripe_receipt_foundation.sql",
);
const leaseSql = await migration(
  "20260921100000_add_stripe_dispatch_leases.sql",
);
const invoiceProjectionSql = await migration(
  "20260921110000_add_stripe_invoice_projection.sql",
);
const targetedClaimSql = await migration(
  "20260929170000_add_targeted_stripe_dispatch_claim.sql",
);
const subscriptionSql = await migration(
  "20260929210000_add_stripe_subscription_projection.sql",
);
const baseSchemaStatements = [
  "create role anon nologin",
  "create role authenticated nologin",
  "create role service_role nologin",
  "create schema auth",
  `create function auth.role() returns text language sql stable
    as $$ select current_setting('request.jwt.claim.role', true) $$`,
  "create type public.user_plan as enum ('free','creator','max','business','admin')",
  `create table public.user_settings (
    user_id uuid primary key, stripe_customer_id text unique, plan_type public.user_plan not null default 'free',
    updated_at timestamptz not null default now()
  )`,
  `create table public.user_subscriptions (
    id uuid primary key default gen_random_uuid(), user_id uuid not null, stripe_customer_id text not null,
    stripe_subscription_id text not null, product_id text not null, status text not null,
    current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean default false,
    price_id text, amount integer, currency text, interval text, interval_count integer,
    payment_failure_at timestamptz, next_payment_attempt timestamptz, payment_failure_type text,
    updated_at timestamptz default now(), unique(user_id,stripe_subscription_id)
  )`,
  "create table public.system_settings (setting_key text primary key, setting_value text, is_public boolean not null default false)",
  "create table public.fanmarks (id uuid primary key, user_input_fanmark text not null, short_id text)",
  `create table public.fanmark_licenses (
    id uuid primary key, fanmark_id uuid not null, user_id uuid, license_start timestamptz not null,
    license_end timestamptz, status text not null default 'active', display_fanmark text,
    grace_expires_at timestamptz, is_returned boolean not null default false, excluded_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`,
  "create table public.fanmark_transfer_codes (id uuid primary key default gen_random_uuid(), license_id uuid not null, status text not null)",
  "create table public.fanmark_favorites (fanmark_id uuid not null, user_id uuid not null, display_fanmark text)",
  `create table public.audit_logs (
    id uuid primary key default gen_random_uuid(), user_id uuid, action text not null,
    resource_type text not null, resource_id text, request_id text, metadata jsonb, created_at timestamptz not null default now()
  )`,
  `create table public.notification_events (
    id uuid primary key default gen_random_uuid(), event_type text not null, event_version integer default 1,
    source text not null, payload jsonb not null, trigger_at timestamptz default now(), dedupe_key text,
    status text default 'pending', created_at timestamptz default now(), updated_at timestamptz default now()
  )`,
  `create function public.create_notification_event(event_type_param text, payload_param jsonb,
    source_param text default 'system', dedupe_key_param text default null,
    trigger_at_param timestamptz default now()) returns uuid language plpgsql as $$
  declare event_id uuid;
  begin
    if dedupe_key_param is not null then
      select id into event_id from public.notification_events
        where dedupe_key = dedupe_key_param and status in ('pending','processing') limit 1;
      if found then return event_id; end if;
    end if;
    insert into public.notification_events(event_type,payload,source,dedupe_key,trigger_at,status)
      values(event_type_param,payload_param,source_param,dedupe_key_param,trigger_at_param,'pending')
      returning id into event_id;
    return event_id;
  end $$`,
];

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "cus_subscription_projection";
const TEST_PRICES = {
  creator: "price_test_creator",
  max: "price_test_max",
  business: "price_test_business",
};
const LIVE_PRICES = {
  creator: "price_live_creator",
  max: "price_live_max",
  business: "price_live_business",
};
const PRICE_IDS = { test: TEST_PRICES, live: LIVE_PRICES };
const acceptSql =
  `select * from public.accept_stripe_webhook_receipt($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`;
let db;
const logSetup = (message) => {
  if (process.env.CI === "true") {
    process.stderr.write(`[subscription-application setup] ${message}\n`);
  }
};

async function query(sql, params = []) {
  return db.query(sql, params);
}

async function acceptSubscription({
  eventId,
  subscriptionId,
  customerId = CUSTOMER_ID,
  eventType = "customer.subscription.created",
}) {
  const payload = {
    schema_version: 1,
    event: {
      id: eventId,
      type: eventType,
      created: 1_750_000_000,
      api_version: "2025-08-27.basil",
      livemode: true,
    },
    object: { type: "subscription", id: subscriptionId },
    branch: "subscription",
    reference: { object_type: "subscription", object_id: subscriptionId },
    subscription: { id: subscriptionId, customer_id: customerId },
  };
  const result = await query(acceptSql, [
    eventId,
    true,
    eventType,
    "subscription",
    subscriptionId,
    "2025-08-27.basil",
    1,
    JSON.stringify(payload),
    "a".repeat(64),
    "b".repeat(64),
  ]);
  return result.rows[0];
}

function currentSubscription({
  id = "sub_current",
  status = "active",
  customerId = CUSTOMER_ID,
  plan = "creator",
} = {}) {
  return {
    object: "subscription",
    id,
    customer: customerId,
    livemode: true,
    status,
    cancel_at_period_end: false,
    items: {
      data: [{
        id: `si_${id}`,
        current_period_start: 1_750_000_000,
        current_period_end: 1_752_592_000,
        price: {
          id: LIVE_PRICES[plan],
          product: { id: `prod_${plan}` },
          unit_amount: 1200,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
        },
      }],
    },
  };
}

function provider({ current, active = [] }) {
  return {
    retrieveSubscription: async (id) => {
      assert.equal(id, current.id);
      return current;
    },
    listActiveSubscriptions: async (customerId) => {
      assert.equal(customerId, CUSTOMER_ID);
      return active;
    },
    retrieveCustomer: async (id) => ({
      id,
      livemode: true,
      metadata: { user_id: USER_ID },
    }),
  };
}

function createRpcClient() {
  const specs = {
    claim_stripe_webhook_dispatch_by_id: {
      sql:
        "select * from public.claim_stripe_webhook_dispatch_by_id($1::uuid,$2,$3)",
      values: (a) => [a.p_dispatch_id, a.p_livemode, a.p_lease_seconds],
    },
    acquire_stripe_customer_fence: {
      sql:
        "select * from public.acquire_stripe_customer_fence($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7)",
      values: (
        a,
      ) => [
        a.p_receipt_id,
        a.p_dispatch_id,
        a.p_livemode,
        a.p_lease_token,
        a.p_claim_generation,
        a.p_stripe_customer_id,
        a.p_lease_seconds,
      ],
    },
    release_stripe_customer_fence: {
      sql:
        "select * from public.release_stripe_customer_fence($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,$8)",
      values: (
        a,
      ) => [
        a.p_receipt_id,
        a.p_dispatch_id,
        a.p_livemode,
        a.p_lease_token,
        a.p_claim_generation,
        a.p_stripe_customer_id,
        a.p_fence_token,
        a.p_fence_generation,
      ],
    },
    apply_stripe_subscription_projection: {
      sql:
        "select * from public.apply_stripe_subscription_projection($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,$8,$9,$10::jsonb,$11,$12::uuid,$13)",
      values: (
        a,
      ) => [
        a.p_receipt_id,
        a.p_dispatch_id,
        a.p_livemode,
        a.p_lease_token,
        a.p_claim_generation,
        a.p_stripe_customer_id,
        a.p_local_user_id,
        a.p_link_customer,
        a.p_current_subscription_id,
        JSON.stringify(a.p_subscriptions),
        a.p_effective_plan_type,
        a.p_fence_token,
        a.p_fence_generation,
      ],
    },
    retry_stripe_webhook_dispatch: {
      sql:
        "select * from public.retry_stripe_webhook_dispatch($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8)",
      values: (
        a,
      ) => [
        a.p_receipt_id,
        a.p_dispatch_id,
        a.p_livemode,
        a.p_lease_token,
        a.p_claim_generation,
        a.p_retry_after_seconds,
        a.p_error_code,
        a.p_error_message,
      ],
    },
  };
  return {
    rpc: async (name, args) => {
      const spec = specs[name];
      if (!spec) throw new Error(`unexpected RPC ${name}`);
      try {
        const result = await query(spec.sql, spec.values(args));
        return { data: result.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

function inputs(
  receipt,
  stripeProvider,
  { needsCustomerLink = false, userId = USER_ID } = {},
) {
  return {
    client: createRpcClient(),
    provider: stripeProvider,
    receipt,
    livemode: true,
    loadPriceIds: async () => PRICE_IDS,
    resolveUser: async () => ({ userId, needsCustomerLink }),
  };
}

async function seedUser({ linked = true, plan = "free" } = {}) {
  await query(
    "insert into public.user_settings (user_id, stripe_customer_id, plan_type) values ($1::uuid, $2, $3::public.user_plan)",
    [USER_ID, linked ? CUSTOMER_ID : null, plan],
  );
  const settings = [
    ...Object.entries(TEST_PRICES).map(([planType, priceId]) => [
      `${planType}_stripe_price_id`,
      priceId,
    ]),
    ...Object.entries(LIVE_PRICES).map(([planType, priceId]) => [
      `${planType}_stripe_price_id_live`,
      priceId,
    ]),
  ];
  for (const [key, value] of settings) {
    await query(
      "insert into public.system_settings (setting_key, setting_value, is_public) values ($1,$2,false)",
      [key, value],
    );
  }
  await query(
    "insert into public.system_settings (setting_key, setting_value, is_public) values ('free_fanmarks_limit','3',false),('grace_period_days','1',false)",
  );
}

async function statusFor(eventId) {
  return (await query(
    `
    select r.status as receipt_status, d.status as dispatch_status, a.status as application_status
      from billing_ingress.stripe_webhook_receipts r
      join billing_ingress.stripe_webhook_dispatches d on d.receipt_id = r.id
      left join billing_ingress.stripe_subscription_applications a on a.receipt_id = r.id
     where r.stripe_event_id = $1
  `,
    [eventId],
  )).rows[0];
}

async function seedLicenseSet(count = 5) {
  const licenses = [];
  for (let index = 1; index <= count; index += 1) {
    const fanmarkId = `aaaaaaaa-aaaa-4aaa-8aaa-${
      String(index).padStart(12, "0")
    }`;
    const licenseId = `bbbbbbbb-bbbb-4bbb-8bbb-${
      String(index).padStart(12, "0")
    }`;
    const start = new Date(Date.UTC(2025, 0, index)).toISOString();
    await query(
      "insert into public.fanmarks (id,user_input_fanmark,short_id) values ($1::uuid,$2,$3)",
      [fanmarkId, `🌸${index}`, `short${index}id`],
    );
    await query(
      `insert into public.fanmark_licenses
      (id,fanmark_id,user_id,license_start,license_end,status,display_fanmark,created_at)
      values ($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,'active',$5,$4::timestamptz)`,
      [licenseId, fanmarkId, USER_ID, start, `🌸${index}`],
    );
    await query(
      "insert into public.fanmark_favorites (fanmark_id,user_id,display_fanmark) values ($1::uuid,$2::uuid,$3)",
      [fanmarkId, "22222222-2222-4222-8222-222222222222", `fav${index}`],
    );
    licenses.push({ licenseId, fanmarkId });
  }
  return licenses;
}

before(async () => {
  logSetup("construct PGlite");
  db = new PGlite();
  logSetup(`create base schema (${baseSchemaStatements.length} statements)`);
  for (const [index, statement] of baseSchemaStatements.entries()) {
    logSetup(`base schema statement ${index + 1}/${baseSchemaStatements.length}`);
    await db.exec(statement);
  }
  logSetup("base schema ready");
  for (const [name, sql] of [
    ["receipt foundation", foundationSql],
    ["dispatch leases", leaseSql],
    ["invoice projection", invoiceProjectionSql],
    ["targeted claim", targetedClaimSql],
    ["subscription projection", subscriptionSql],
  ]) {
    logSetup(`apply ${name}`);
    await db.exec(sql);
    logSetup(`${name} ready`);
  }
  logSetup("set service role");
  await query(
    "select set_config('request.jwt.claim.role','service_role',false)",
  );
  logSetup("setup complete");
});

beforeEach(async () => {
  await query(
    "truncate billing_ingress.stripe_subscription_applications, billing_ingress.stripe_application_ledger, billing_ingress.stripe_sync_fences, billing_ingress.stripe_webhook_dispatches, billing_ingress.stripe_webhook_receipts cascade",
  );
  await query(
    "truncate public.notification_events, public.audit_logs, public.fanmark_favorites, public.fanmark_transfer_codes, public.fanmark_licenses, public.fanmarks, public.user_subscriptions, public.user_settings, public.system_settings cascade",
  );
});

after(async () => db.close());

test("subscription.created binds a customer and applies current rows, plan, ledger, receipt, and dispatch atomically", async () => {
  await seedUser({ linked: false });
  const current = currentSubscription();
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_create",
    subscriptionId: current.id,
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current, active: [current] }), {
      needsCustomerLink: true,
    }),
  );

  assert.deepEqual(result, {
    status: "applied",
    outcome: "applied",
    effectivePlanType: "creator",
    activeSubscriptionCount: 1,
  });
  assert.deepEqual(await statusFor("evt_subscription_create"), {
    receipt_status: "applied",
    dispatch_status: "completed",
    application_status: "applied",
  });
  const settings = (await query(
    "select stripe_customer_id, plan_type from public.user_settings where user_id=$1::uuid",
    [USER_ID],
  )).rows[0];
  assert.equal(settings.stripe_customer_id, CUSTOMER_ID);
  assert.equal(settings.plan_type, "creator");
  const subscription = (await query(
    "select status,price_id,current_period_start,current_period_end from public.user_subscriptions where stripe_subscription_id=$1",
    [current.id],
  )).rows[0];
  assert.equal(subscription.status, "active");
  assert.equal(subscription.price_id, LIVE_PRICES.creator);
});

test("an active updated subscription clears its payment failure fields under the customer fence", async () => {
  await seedUser({ plan: "creator" });
  const current = currentSubscription({ plan: "business" });
  await query(
    `insert into public.user_subscriptions
    (user_id,stripe_customer_id,stripe_subscription_id,product_id,status,payment_failure_at,next_payment_attempt,payment_failure_type)
    values ($1::uuid,$2,$3,'prod_creator','past_due','2025-09-01T00:00:00Z','2025-09-03T00:00:00Z','invoice.payment_failed')`,
    [USER_ID, CUSTOMER_ID, current.id],
  );
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_updated",
    subscriptionId: current.id,
    eventType: "customer.subscription.updated",
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current, active: [current] })),
  );

  assert.equal(result.status, "applied");
  assert.equal(result.effectivePlanType, "business");
  const currentRow = (await query(
    `select status,payment_failure_at,next_payment_attempt,payment_failure_type
    from public.user_subscriptions where stripe_subscription_id=$1`,
    [current.id],
  )).rows[0];
  assert.equal(currentRow.status, "active");
  assert.equal(currentRow.payment_failure_at, null);
  assert.equal(currentRow.next_payment_attempt, null);
  assert.equal(currentRow.payment_failure_type, null);
});

test("a deleted last subscription is retained as a tombstone and Free returns newest excess licenses with audit and outbox rows", async () => {
  await seedUser({ plan: "business" });
  const licenses = await seedLicenseSet(5);
  const current = currentSubscription({
    id: "sub_deleted",
    status: "canceled",
  });
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_deleted",
    subscriptionId: current.id,
    eventType: "customer.subscription.deleted",
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current })),
  );

  assert.deepEqual(result, {
    status: "applied",
    outcome: "applied",
    effectivePlanType: "free",
    activeSubscriptionCount: 0,
  });
  assert.equal(
    (await query(
      "select plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].plan_type,
    "free",
  );
  assert.equal(
    (await query(
      "select status from public.user_subscriptions where stripe_subscription_id=$1",
      [current.id],
    )).rows[0].status,
    "canceled",
  );
  const returned = (await query(
    "select id from public.fanmark_licenses where status='grace' order by license_start",
  )).rows;
  assert.deepEqual(returned.map((row) => row.id), [
    licenses[3].licenseId,
    licenses[4].licenseId,
  ]);
  assert.equal(
    (await query(
      "select count(*)::int as count from public.audit_logs where action='return_fanmark'",
    )).rows[0].count,
    2,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.notification_events where event_type='fanmark_returned_owner'",
    )).rows[0].count,
    2,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.notification_events where event_type='favorite_fanmark_available'",
    )).rows[0].count,
    2,
  );
});

test("deletion with another active subscription preserves the highest paid plan and returns no licenses", async () => {
  await seedUser({ plan: "creator" });
  const licenses = await seedLicenseSet(5);
  const current = currentSubscription({
    id: "sub_deleted",
    status: "canceled",
  });
  const other = currentSubscription({ id: "sub_other", plan: "business" });
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_deleted_other_active",
    subscriptionId: current.id,
    eventType: "customer.subscription.deleted",
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current, active: [other] })),
  );

  assert.equal(result.status, "applied");
  assert.equal(result.effectivePlanType, "business");
  assert.equal(result.activeSubscriptionCount, 1);
  assert.equal(
    (await query(
      "select plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].plan_type,
    "business",
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.fanmark_licenses where status='grace'",
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.fanmark_licenses where id=any($1::uuid[]) and status='active'",
      [licenses.map((item) => item.licenseId)],
    )).rows[0].count,
    5,
  );
});

test("a transfer conflict rolls back every subscription, customer, plan, receipt, and Free-return mutation", async () => {
  await seedUser({ linked: false, plan: "business" });
  const licenses = await seedLicenseSet(5);
  await query(
    "insert into public.fanmark_transfer_codes (license_id,status) values ($1::uuid,'active')",
    [licenses[4].licenseId],
  );
  const current = currentSubscription({
    id: "sub_deleted",
    status: "canceled",
  });
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_transfer_conflict",
    subscriptionId: current.id,
    eventType: "customer.subscription.deleted",
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current }), { needsCustomerLink: true }),
  );

  assert.equal(result.status, "retryable");
  assert.equal(
    (await statusFor("evt_subscription_transfer_conflict")).receipt_status,
    "retryable",
  );
  assert.equal(
    (await statusFor("evt_subscription_transfer_conflict")).dispatch_status,
    "retryable",
  );
  assert.equal(
    (await query(
      "select stripe_customer_id,plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].stripe_customer_id,
    null,
  );
  assert.equal(
    (await query(
      "select plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].plan_type,
    "business",
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.user_subscriptions where stripe_subscription_id=$1",
      [current.id],
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.fanmark_licenses where status='grace'",
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query("select count(*)::int as count from public.audit_logs"))
      .rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.notification_events",
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from billing_ingress.stripe_subscription_applications",
    )).rows[0].count,
    0,
  );
});

test("a subscription ID already owned by another customer cannot be reassigned", async () => {
  await seedUser({ plan: "free" });
  const otherUser = "33333333-3333-4333-8333-333333333333";
  await query(
    "insert into public.user_settings (user_id,stripe_customer_id,plan_type) values ($1::uuid,'cus_other','creator')",
    [otherUser],
  );
  const current = currentSubscription({ id: "sub_owned_elsewhere" });
  await query(
    `insert into public.user_subscriptions
    (user_id,stripe_customer_id,stripe_subscription_id,product_id,status)
    values ($1::uuid,'cus_other',$2,'prod_creator','active')`,
    [otherUser, current.id],
  );
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_owner_conflict",
    subscriptionId: current.id,
  });
  const result = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current, active: [current] })),
  );

  assert.equal(result.status, "retryable");
  assert.equal(
    (await statusFor("evt_subscription_owner_conflict")).receipt_status,
    "retryable",
  );
  assert.equal(
    (await query(
      "select plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].plan_type,
    "free",
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from public.user_subscriptions where stripe_subscription_id=$1",
      [current.id],
    )).rows[0].count,
    1,
  );
  assert.equal(
    (await query(
      "select user_id from public.user_subscriptions where stripe_subscription_id=$1",
      [current.id],
    )).rows[0].user_id,
    otherUser,
  );
});

test("an expired customer fence cannot commit after a newer worker takes ownership", async () => {
  await seedUser();
  const current = currentSubscription();
  const oldReceipt = await acceptSubscription({
    eventId: "evt_subscription_old_fence",
    subscriptionId: current.id,
  });
  const client = createRpcClient();
  const oldClaim = (await client.rpc("claim_stripe_webhook_dispatch_by_id", {
    p_dispatch_id: oldReceipt.dispatch_id,
    p_livemode: true,
    p_lease_seconds: 300,
  })).data[0];
  const oldFence = (await client.rpc("acquire_stripe_customer_fence", {
    p_receipt_id: oldClaim.receipt_id,
    p_dispatch_id: oldClaim.dispatch_id,
    p_livemode: true,
    p_lease_token: oldClaim.lease_token,
    p_claim_generation: oldClaim.claim_generation,
    p_stripe_customer_id: CUSTOMER_ID,
    p_lease_seconds: 300,
  })).data[0];
  await query(
    "update billing_ingress.stripe_sync_fences set lease_until=clock_timestamp()-interval '1 second' where stripe_customer_id=$1",
    [CUSTOMER_ID],
  );

  const newReceipt = await acceptSubscription({
    eventId: "evt_subscription_new_fence",
    subscriptionId: current.id,
  });
  const newClaim = (await client.rpc("claim_stripe_webhook_dispatch_by_id", {
    p_dispatch_id: newReceipt.dispatch_id,
    p_livemode: true,
    p_lease_seconds: 300,
  })).data[0];
  const newFence = (await client.rpc("acquire_stripe_customer_fence", {
    p_receipt_id: newClaim.receipt_id,
    p_dispatch_id: newClaim.dispatch_id,
    p_livemode: true,
    p_lease_token: newClaim.lease_token,
    p_claim_generation: newClaim.claim_generation,
    p_stripe_customer_id: CUSTOMER_ID,
    p_lease_seconds: 300,
  })).data[0];
  assert.ok(
    Number(newFence.fence_generation) > Number(oldFence.fence_generation),
  );

  const staleApply = await client.rpc("apply_stripe_subscription_projection", {
    p_receipt_id: oldClaim.receipt_id,
    p_dispatch_id: oldClaim.dispatch_id,
    p_livemode: true,
    p_lease_token: oldClaim.lease_token,
    p_claim_generation: oldClaim.claim_generation,
    p_stripe_customer_id: CUSTOMER_ID,
    p_local_user_id: USER_ID,
    p_link_customer: false,
    p_current_subscription_id: current.id,
    p_subscriptions: [{
      id: current.id,
      customer_id: CUSTOMER_ID,
      status: "active",
      current_period_start: "2025-06-15T15:06:40.000Z",
      current_period_end: "2025-07-15T15:06:40.000Z",
      cancel_at_period_end: false,
      product_id: "prod_creator",
      price_id: LIVE_PRICES.creator,
      amount: 1200,
      currency: "usd",
      recurring_interval: "month",
      interval_count: 1,
      plan_type: "creator",
    }],
    p_effective_plan_type: "creator",
    p_fence_token: oldFence.fence_token,
    p_fence_generation: oldFence.fence_generation,
  });
  assert.equal(staleApply.error?.code, "P0001");
  assert.equal(
    (await query(
      "select count(*)::int as count from public.user_subscriptions",
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select count(*)::int as count from billing_ingress.stripe_subscription_applications",
    )).rows[0].count,
    0,
  );
  assert.equal(
    (await query(
      "select plan_type from public.user_settings where user_id=$1::uuid",
      [USER_ID],
    )).rows[0].plan_type,
    "free",
  );
});

test("a terminal duplicate skips all current Stripe reads", async () => {
  await seedUser();
  const current = currentSubscription();
  const receipt = await acceptSubscription({
    eventId: "evt_subscription_duplicate",
    subscriptionId: current.id,
  });
  const first = await processAcceptedStripeSubscriptionReceipt(
    inputs(receipt, provider({ current, active: [current] })),
  );
  assert.equal(first.status, "applied");
  const duplicate = await acceptSubscription({
    eventId: "evt_subscription_duplicate",
    subscriptionId: current.id,
  });
  assert.equal(duplicate.outcome, "duplicate_terminal");
  const second = await processAcceptedStripeSubscriptionReceipt(
    inputs(duplicate, {
      retrieveSubscription: async () => {
        throw new Error("must not read Stripe");
      },
      listActiveSubscriptions: async () => {
        throw new Error("must not read Stripe");
      },
      retrieveCustomer: async () => {
        throw new Error("must not read Stripe");
      },
    }),
  );
  assert.equal(second.status, "applied");
  assert.equal(second.outcome, "duplicate_terminal");
  assert.equal(
    (await query(
      "select count(*)::int as count from billing_ingress.stripe_subscription_applications",
    )).rows[0].count,
    1,
  );
});

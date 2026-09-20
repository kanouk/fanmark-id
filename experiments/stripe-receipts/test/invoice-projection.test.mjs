import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createStripeInvoiceProjectionProvider,
  createSupabaseInvoiceProjectionRuntime,
  processStripeInvoiceDispatch,
} from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";

const foundationSql = await readFile(
  new URL("../../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql", import.meta.url),
  "utf8",
);
const leaseSql = await readFile(
  new URL("../../../supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql", import.meta.url),
  "utf8",
);
const projectionSql = await readFile(
  new URL("../../../supabase/migrations/20260921110000_add_stripe_invoice_projection.sql", import.meta.url),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_ROW_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "cus_projection";
const SUBSCRIPTION_ID = "sub_projection";

const acceptSql = `
  select * from public.accept_stripe_webhook_receipt(
    $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
  )
`;
const claimSql = "select * from public.claim_stripe_webhook_dispatches($1, $2, $3)";

let db;

async function execute(sql, params = []) {
  return db.query(sql, params);
}

async function setRequestRole(role) {
  await execute("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

function invoicePayload({
  eventId,
  invoiceId,
  customerId = CUSTOMER_ID,
  subscriptionId = SUBSCRIPTION_ID,
}) {
  return {
    schema_version: 1,
    event: {
      id: eventId,
      type: "invoice.payment_failed",
      created: 1_750_000_000,
      api_version: "2025-08-27.basil",
      livemode: true,
    },
    object: { type: "invoice", id: invoiceId },
    branch: "invoice",
    reference: { object_type: "invoice", object_id: invoiceId },
    invoice: {
      id: invoiceId,
      customer_id: customerId,
      subscription_id: subscriptionId,
      subscription_relation_source: "basil_parent",
    },
  };
}

async function accept({
  eventId,
  eventType = "invoice.payment_failed",
  invoiceId = "in_source",
  payload = invoicePayload({ eventId, invoiceId }),
}) {
  payload.event.type = eventType;
  const result = await execute(acceptSql, [
    eventId,
    true,
    eventType,
    "invoice",
    invoiceId,
    "2025-08-27.basil",
    1,
    JSON.stringify(payload),
    "a".repeat(64),
    "b".repeat(64),
  ]);
  return result.rows[0];
}

async function claim() {
  const result = await execute(claimSql, [true, 1, 300]);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

function createRpcClient() {
  const specs = {
    acquire_stripe_customer_fence: {
      sql: `select * from public.acquire_stripe_customer_fence($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7)`,
      values: (a) => [a.p_receipt_id, a.p_dispatch_id, a.p_livemode, a.p_lease_token, a.p_claim_generation, a.p_stripe_customer_id, a.p_lease_seconds],
    },
    release_stripe_customer_fence: {
      sql: `select * from public.release_stripe_customer_fence($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,$8)`,
      values: (a) => [a.p_receipt_id, a.p_dispatch_id, a.p_livemode, a.p_lease_token, a.p_claim_generation, a.p_stripe_customer_id, a.p_fence_token, a.p_fence_generation],
    },
    apply_stripe_invoice_projection: {
      sql: `select * from public.apply_stripe_invoice_projection($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,$15,$16,$17::timestamptz)`,
      values: (a) => [a.p_receipt_id, a.p_dispatch_id, a.p_livemode, a.p_lease_token, a.p_claim_generation, a.p_stripe_customer_id, a.p_stripe_subscription_id, a.p_source_invoice_id, a.p_current_invoice_id, a.p_invoice_attempt_key, a.p_fence_token, a.p_fence_generation, a.p_source_event_type, a.p_current_outcome, a.p_current_invoice_status, a.p_payment_intent_status, a.p_next_payment_attempt],
    },
    retry_stripe_webhook_dispatch: {
      sql: `select * from public.retry_stripe_webhook_dispatch($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8)`,
      values: (a) => [a.p_receipt_id, a.p_dispatch_id, a.p_livemode, a.p_lease_token, a.p_claim_generation, a.p_retry_after_seconds, a.p_error_code, a.p_error_message],
    },
  };
  return {
    rpc: async (name, args) => {
      const spec = specs[name];
      if (!spec) throw new Error(`unexpected RPC ${name}`);
      try {
        const result = await execute(spec.sql, spec.values(args));
        return { data: result.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

async function seedSubscription({ failureAt = null, nextAttempt = null, failureType = null } = {}) {
  await execute(
    `insert into public.user_settings (user_id, stripe_customer_id, plan_type)
     values ($1::uuid, $2, 'creator')`,
    [USER_ID, CUSTOMER_ID],
  );
  await execute(
    `insert into public.user_subscriptions
      (id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
       payment_failure_at, next_payment_attempt, payment_failure_type)
     values ($1::uuid, $2::uuid, $3, $4, 'prod_creator', 'active', $5::timestamptz, $6::timestamptz, $7)`,
    [SUBSCRIPTION_ROW_ID, USER_ID, CUSTOMER_ID, SUBSCRIPTION_ID, failureAt, nextAttempt, failureType],
  );
}

function stripeInvoice({
  id,
  status,
  paymentIntentId = "pi_projection",
  paymentIntentStatus = null,
  attemptCount = 1,
  customerId = CUSTOMER_ID,
  subscriptionId = SUBSCRIPTION_ID,
  livemode = true,
  parent = true,
}) {
  const paymentIntentStatusValue = paymentIntentStatus
    ?? (status === "paid" ? "succeeded" : "requires_payment_method");
  const paymentData = paymentIntentId === null
    ? []
    : [{
        object: "invoice_payment",
        id: `inpay_${id}`,
        invoice: id,
        livemode,
        payment: {
          type: "payment_intent",
          payment_intent: {
            object: "payment_intent",
            id: paymentIntentId,
            customer: customerId,
            livemode,
            status: paymentIntentStatusValue,
          },
        },
        status: status === "paid" ? "paid" : "open",
      }];
  return {
    object: "invoice",
    id,
    livemode,
    customer: customerId,
    ...(parent
      ? { parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } } }
      : { subscription: subscriptionId }),
    status,
    payments: { object: "list", data: paymentData, has_more: false, total_count: paymentData.length },
    attempt_count: attemptCount,
    next_payment_attempt: status === "open" ? 1_800_000_000 : null,
  };
}

function stripeSubscription({ latestInvoiceId = "in_source", customerId = CUSTOMER_ID, livemode = true } = {}) {
  return {
    object: "subscription",
    id: SUBSCRIPTION_ID,
    livemode,
    customer: customerId,
    latest_invoice: latestInvoiceId,
  };
}

function providerFrom(records) {
  return {
    retrieveInvoice: async (id) => records.invoices[id],
    retrieveSubscription: async () => records.subscription,
  };
}

function createForgedApplyRpcClient(forge) {
  const client = createRpcClient();
  const rpc = client.rpc;
  client.rpc = async (name, args) => {
    if (name === "apply_stripe_invoice_projection") {
      return { data: [forge(args)], error: null };
    }
    return rpc(name, args);
  };
  return client;
}

async function state() {
  const result = await execute(`
    select r.status as receipt_status,
           r.terminal_at,
           d.status as dispatch_status,
           d.lease_token,
           d.lease_until,
           d.available_at,
           s.payment_failure_at,
           s.next_payment_attempt,
           s.payment_failure_type
      from billing_ingress.stripe_webhook_receipts r
      join billing_ingress.stripe_webhook_dispatches d on d.receipt_id = r.id
      left join public.user_subscriptions s on s.stripe_subscription_id = $1
  `, [SUBSCRIPTION_ID]);
  return result.rows[0];
}

async function ledgerRows() {
  return (await execute(`
    select stripe_event_id, source_invoice_id, current_invoice_id,
           invoice_attempt_key, current_outcome, status
      from billing_ingress.stripe_application_ledger
     order by created_at, id
  `)).rows;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create function auth.role()
    returns text language sql stable
    as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table public.user_settings (
      user_id uuid primary key,
      stripe_customer_id text unique,
      plan_type text
    );
    create table public.user_subscriptions (
      id uuid primary key,
      user_id uuid not null,
      stripe_customer_id text not null,
      stripe_subscription_id text not null,
      product_id text not null,
      status text not null,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean default false,
      price_id text,
      amount integer,
      currency text,
      interval text,
      interval_count integer,
      payment_failure_at timestamptz,
      next_payment_attempt timestamptz,
      payment_failure_type text,
      updated_at timestamptz default now(),
      unique (user_id, stripe_subscription_id)
    );
  `);
  await db.exec(foundationSql);
  await db.exec(leaseSql);
  await db.exec(projectionSql);
  await setRequestRole("service_role");
});

beforeEach(async () => {
  await execute("reset role");
  await setRequestRole("service_role");
  await execute("set search_path = public");
  await execute("truncate billing_ingress.stripe_application_ledger, billing_ingress.stripe_sync_fences, billing_ingress.stripe_webhook_dispatches, billing_ingress.stripe_webhook_receipts cascade");
  await execute("delete from public.user_subscriptions");
  await execute("delete from public.user_settings");
});

after(async () => {
  await db.close();
});

test("the Stripe provider adapter pins Basil and expands InvoicePayment plus latest invoice", async () => {
  const calls = [];
  const provider = createStripeInvoiceProjectionProvider({
    invoices: {
      retrieve: async (...args) => {
        calls.push(["invoice", ...args]);
        return {};
      },
    },
    subscriptions: {
      retrieve: async (...args) => {
        calls.push(["subscription", ...args]);
        return {};
      },
    },
  });
  await provider.retrieveInvoice("in_provider");
  await provider.retrieveSubscription("sub_provider");
  assert.deepEqual(calls, [
    ["invoice", "in_provider", { expand: ["payments.data.payment.payment_intent"] }, { apiVersion: "2025-08-27.basil" }],
    ["subscription", "sub_provider", { expand: ["latest_invoice"] }, { apiVersion: "2025-08-27.basil" }],
  ]);
});

test("InvoicePayment invoice identity is verified before projection", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_payment_invoice_mismatch", "in_payment_invoice_mismatch");
  const invoice = stripeInvoice({ id: "in_payment_invoice_mismatch", status: "paid" });
  invoice.payments.data[0].invoice = "in_other";
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_payment_invoice_mismatch: invoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_payment_invoice_mismatch" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_payment_relation_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("expanded PaymentIntent customer and mode are verified before projection", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_payment_identity_mismatch", "in_payment_identity_mismatch");
  const invoice = stripeInvoice({ id: "in_payment_identity_mismatch", status: "paid" });
  invoice.payments.data[0].payment.payment_intent.customer = "cus_other";
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_payment_identity_mismatch: invoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_payment_identity_mismatch" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_payment_relation_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("InvoicePayment mode is verified before projection", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_payment_mode_mismatch", "in_payment_mode_mismatch");
  const invoice = stripeInvoice({ id: "in_payment_mode_mismatch", status: "paid" });
  invoice.payments.data[0].livemode = false;
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_payment_mode_mismatch: invoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_payment_mode_mismatch" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_payment_relation_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("canceled historical and non-PaymentIntent entries cannot classify an open invoice", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_canceled_history", "in_canceled_history");
  const invoice = stripeInvoice({
    id: "in_canceled_history",
    status: "open",
    paymentIntentStatus: "requires_payment_method",
  });
  invoice.payments.data[0].status = "canceled";
  invoice.payments.data.push({
    object: "invoice_payment",
    id: "inpay_record_history",
    invoice: invoice.id,
    livemode: true,
    payment: { type: "charge", charge: "ch_history" },
    status: "paid",
  });
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_canceled_history: invoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_canceled_history" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_current_state_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("forged apply RPC receipt identity or terminal status is never acknowledged", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_forged_rpc", "in_forged_rpc");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createForgedApplyRpcClient((args) => ({
      application_id: "app_forged",
      receipt_id: "wrong_receipt",
      dispatch_id: args.p_dispatch_id,
      outcome: "paid",
      ledger_status: "applied",
      receipt_status: "applied",
      dispatch_status: "completed",
      local_user_id: USER_ID,
      source_invoice_id: args.p_source_invoice_id,
      current_invoice_id: args.p_current_invoice_id,
      invoice_attempt_key: args.p_invoice_attempt_key,
      fence_generation: args.p_fence_generation,
    }))),
    provider: providerFrom({
      invoices: { in_forged_rpc: stripeInvoice({ id: "in_forged_rpc", status: "paid" }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_forged_rpc" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_projection_rpc_shape_invalid");
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
  assert.equal((await ledgerRows()).length, 0);
});

test("current paid latest invoice clears failure fields and commits ledger plus terminal receipt atomically", async () => {
  await seedSubscription({
    failureAt: "2026-01-01T00:00:00Z",
    nextAttempt: "2026-01-02T00:00:00Z",
    failureType: "invoice.payment_failed",
  });
  const accepted = await accept({ eventId: "evt_projection_paid_old", invoiceId: "in_old" });
  const dispatch = await claim();
  const runtime = createSupabaseInvoiceProjectionRuntime(createRpcClient());
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime,
    provider: providerFrom({
      invoices: {
        in_old: stripeInvoice({ id: "in_old", status: "open", paymentIntentId: "pi_old" }),
        in_latest: stripeInvoice({ id: "in_latest", status: "paid", paymentIntentId: "pi_latest" }),
      },
      subscription: stripeSubscription({ latestInvoiceId: "in_latest" }),
    }),
  });

  assert.equal(result.status, "applied");
  assert.equal(result.outcome, "paid");
  assert.equal(result.currentInvoiceId, "in_latest");
  const row = await state();
  assert.equal(row.receipt_status, "applied");
  assert.equal(row.dispatch_status, "completed");
  assert.equal(row.lease_token, null);
  assert.equal(row.payment_failure_at, null);
  assert.equal(row.next_payment_attempt, null);
  assert.equal(row.payment_failure_type, null);
  const rows = await ledgerRows();
  assert.deepEqual(rows, [{
    stripe_event_id: "evt_projection_paid_old",
    source_invoice_id: "in_old",
    current_invoice_id: "in_latest",
    invoice_attempt_key: "pi_latest:attempt:1:outcome:paid",
    current_outcome: "paid",
    status: "applied",
  }]);
});

test("failure and action-required attempts share no invoice-ID dedupe and retain distinct attempt keys", async () => {
  await seedSubscription();
  const runtime = createSupabaseInvoiceProjectionRuntime(createRpcClient());
  const records = {
    invoices: {
      in_attempt: stripeInvoice({
        id: "in_attempt",
        status: "open",
        paymentIntentId: "pi_attempt_1",
        paymentIntentStatus: "requires_payment_method",
        attemptCount: 1,
      }),
    },
    subscription: stripeSubscription({ latestInvoiceId: "in_attempt" }),
  };
  const first = await accept({ eventId: "evt_projection_attempt_1", invoiceId: "in_attempt" });
  const firstDispatch = await claim();
  const firstResult = await processStripeInvoiceDispatch(firstDispatch, {
    runtime,
    provider: providerFrom(records),
  });
  assert.equal(firstResult.status, "applied");

  records.invoices.in_attempt = stripeInvoice({
    id: "in_attempt",
    status: "open",
    paymentIntentId: "pi_attempt_2",
    paymentIntentStatus: "requires_action",
    attemptCount: 2,
  });
  const second = await accept({
    eventId: "evt_projection_attempt_2",
    eventType: "invoice.payment_action_required",
    invoiceId: "in_attempt",
  });
  const secondDispatch = await claim();
  const secondResult = await processStripeInvoiceDispatch(secondDispatch, {
    runtime,
    provider: providerFrom(records),
  });
  assert.equal(secondResult.status, "applied");
  assert.equal(secondResult.outcome, "requires_action");

  const rows = await ledgerRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stripe_event_id, "evt_projection_attempt_1");
  assert.equal(rows[1].stripe_event_id, "evt_projection_attempt_2");
  assert.notEqual(rows[0].invoice_attempt_key, rows[1].invoice_attempt_key);
  const row = await state();
  assert.equal(row.payment_failure_type, "invoice.payment_action_required");
});

test("a stale success event reconciles the current open failure and cannot clear it", async () => {
  await seedSubscription();
  const accepted = await accept({
    eventId: "evt_projection_stale_success",
    eventType: "invoice.payment_succeeded",
    invoiceId: "in_old_success",
    payload: invoicePayload({
      eventId: "evt_projection_stale_success",
      invoiceId: "in_old_success",
    }),
  });
  const dispatch = await claim();
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: {
        in_old_success: stripeInvoice({ id: "in_old_success", status: "paid", paymentIntentId: "pi_old_success" }),
        in_new_failure: stripeInvoice({
          id: "in_new_failure",
          status: "open",
          paymentIntentId: "pi_new_failure",
          paymentIntentStatus: "requires_payment_method",
          attemptCount: 3,
        }),
      },
      subscription: stripeSubscription({ latestInvoiceId: "in_new_failure" }),
    }),
  });

  assert.equal(result.status, "applied");
  assert.equal(result.outcome, "payment_failed");
  assert.equal(result.currentInvoiceId, "in_new_failure");
  const row = await state();
  assert.equal(row.payment_failure_type, "invoice.payment_failed");
  assert.ok(row.payment_failure_at);
  assert.ok(row.next_payment_attempt);
  assert.equal((await ledgerRows())[0].stripe_event_id, "evt_projection_stale_success");
});

test("an old failed event cannot classify a current open invoice without a current payment state", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_open_without_payment", "in_old_failed");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: {
        in_old_failed: stripeInvoice({ id: "in_old_failed", status: "open", paymentIntentId: null }),
      },
      subscription: stripeSubscription({ latestInvoiceId: "in_old_failed" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_current_state_review_required");
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
  assert.equal(row.payment_failure_at, null);
  assert.ok(new Date(row.available_at).getTime() > Date.now());
});

test("missing customer mapping remains retryable and creates no application row", async () => {
  const accepted = await accept({ eventId: "evt_projection_missing_mapping" });
  const dispatch = await claim();
  const provider = providerFrom({
    invoices: { in_source: stripeInvoice({ id: "in_source", status: "paid" }) },
    subscription: stripeSubscription({ latestInvoiceId: "in_source" }),
  });
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider,
  });

  assert.equal(result.status, "retryable");
  assert.match(result.code, /mapping|projection/);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
  assert.equal((await ledgerRows()).length, 0);
  assert.equal(accepted.outcome, "accepted");
});

test("duplicate customer mapping is review-required instead of choosing a user", async () => {
  await seedSubscription();
  await execute("alter table public.user_settings drop constraint user_settings_stripe_customer_id_key");
  await execute(
    `insert into public.user_settings (user_id, stripe_customer_id, plan_type)
     values ($1::uuid, $2, 'creator')`,
    ["33333333-3333-4333-8333-333333333333", CUSTOMER_ID],
  );
  const dispatch = await claimFromAccepted("evt_projection_duplicate_mapping", "in_duplicate_mapping");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_duplicate_mapping: stripeInvoice({ id: "in_duplicate_mapping", status: "paid" }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_duplicate_mapping" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_customer_mapping_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("a missing source relationship retries before remote reconciliation", async () => {
  await seedSubscription();
  const payload = invoicePayload({ eventId: "evt_projection_missing_relation", invoiceId: "in_missing_relation" });
  payload.invoice.subscription_id = null;
  const dispatch = await (async () => {
    await accept({
      eventId: "evt_projection_missing_relation",
      invoiceId: "in_missing_relation",
      payload,
    });
    return claim();
  })();
  let providerCalled = false;
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: {
      retrieveInvoice: async () => {
        providerCalled = true;
        return {};
      },
      retrieveSubscription: async () => {
        providerCalled = true;
        return {};
      },
    },
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_relation_review_required");
  assert.equal(providerCalled, false);
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
});

test("current identity or Basil relationship conflicts remain retryable and non-mutating", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_identity_conflict", "in_identity_conflict");
  const badInvoice = stripeInvoice({ id: "in_identity_conflict", status: "paid" });
  badInvoice.customer = "cus_other_customer";
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_identity_conflict: badInvoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_identity_conflict" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_identity_review_required");
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
});

test("a Basil current invoice with only the legacy top-level subscription relation is review-required", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_legacy_relation", "in_legacy_relation");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_legacy_relation: stripeInvoice({ id: "in_legacy_relation", status: "paid", parent: false }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_legacy_relation" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_relation_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("a Basil invoice carrying the removed top-level payment_intent field is review-required", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_legacy_payment", "in_legacy_payment");
  const invoice = stripeInvoice({ id: "in_legacy_payment", status: "paid" });
  invoice.payment_intent = { id: "pi_legacy", status: "succeeded" };
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_legacy_payment: invoice },
      subscription: stripeSubscription({ latestInvoiceId: "in_legacy_payment" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_payment_relation_review_required");
  assert.equal((await ledgerRows()).length, 0);
});

test("unsupported current draft state is retryable without a terminal effect", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_draft", "in_draft");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_draft: stripeInvoice({ id: "in_draft", status: "draft" }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_draft" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_current_state_review_required");
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
});

test("uncollectible current state records failure without a next attempt", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_uncollectible", "in_uncollectible");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_uncollectible: stripeInvoice({ id: "in_uncollectible", status: "uncollectible", paymentIntentId: null }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_uncollectible" }),
    }),
  });
  assert.equal(result.status, "applied");
  assert.equal(result.outcome, "uncollectible");
  const row = await state();
  assert.equal(row.payment_failure_type, "invoice.payment_failed");
  assert.ok(row.payment_failure_at);
  assert.equal(row.next_payment_attempt, null);
});

async function claimFromAccepted(eventId, invoiceId) {
  await accept({ eventId, invoiceId });
  return claim();
}

test("void remains retryable pending an explicit lifecycle policy", async () => {
  await seedSubscription({
    failureAt: "2026-01-01T00:00:00Z",
    nextAttempt: "2026-01-02T00:00:00Z",
    failureType: "invoice.payment_failed",
  });
  const dispatch = await claimFromAccepted("evt_projection_void", "in_void");
  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_void: stripeInvoice({ id: "in_void", status: "void", paymentIntentId: null }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_void" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal(result.code, "invoice_void_lifecycle_review_required");
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
  assert.equal(row.payment_failure_type, "invoice.payment_failed");
  assert.ok(row.payment_failure_at);
  assert.ok(row.next_payment_attempt);
});

test("a subscription update failure rolls back the ledger and receipt terminal transition", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_rollback", "in_rollback");
  await db.exec(`
    create schema projection_test;
    create function projection_test.fail_subscription_update()
    returns trigger language plpgsql as $$
    begin
      raise exception 'forced invoice projection rollback';
    end;
    $$;
    create trigger fail_subscription_update
      before update on public.user_subscriptions
      for each row execute function projection_test.fail_subscription_update();
  `);

  const result = await processStripeInvoiceDispatch(dispatch, {
    runtime: createSupabaseInvoiceProjectionRuntime(createRpcClient()),
    provider: providerFrom({
      invoices: { in_rollback: stripeInvoice({ id: "in_rollback", status: "paid" }) },
      subscription: stripeSubscription({ latestInvoiceId: "in_rollback" }),
    }),
  });
  assert.equal(result.status, "retryable");
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "retryable");
  assert.equal(row.dispatch_status, "retryable");
  await db.exec(`
    drop trigger fail_subscription_update on public.user_subscriptions;
    drop function projection_test.fail_subscription_update();
    drop schema projection_test;
  `);
});

test("a stale fence is rejected by the final RPC and leaves the subscription untouched", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_stale_fence", "in_stale_fence");
  const runtime = createSupabaseInvoiceProjectionRuntime(createRpcClient());
  const fence = await runtime.acquireFence({
    dispatch,
    stripeCustomerId: CUSTOMER_ID,
  });
  assert.ok(fence);
  await execute(
    "update billing_ingress.stripe_sync_fences set lease_until = clock_timestamp() - interval '1 second' where livemode = true and stripe_customer_id = $1",
    [CUSTOMER_ID],
  );
  await assert.rejects(
    () => runtime.apply({
      dispatch,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      sourceInvoiceId: "in_stale_fence",
      currentInvoiceId: "in_stale_fence",
      invoiceAttemptKey: "pi_stale:attempt:1:outcome:paid",
      fence,
      currentOutcome: "paid",
      currentInvoiceStatus: "paid",
      paymentIntentStatus: "succeeded",
      nextPaymentAttempt: null,
    }),
    /rpc_P0001|rpc_42501|invoice projection/i,
  );
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "processing");
  assert.equal(row.dispatch_status, "processing");
});

test("projection SQL rejects null event outcome or invoice status before mutation", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_null_discriminator", "in_null_discriminator");
  const runtime = createSupabaseInvoiceProjectionRuntime(createRpcClient());
  const fence = await runtime.acquireFence({ dispatch, stripeCustomerId: CUSTOMER_ID });
  assert.ok(fence);
  await assert.rejects(
    () => runtime.apply({
      dispatch,
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUBSCRIPTION_ID,
      sourceInvoiceId: "in_null_discriminator",
      currentInvoiceId: "in_null_discriminator",
      invoiceAttemptKey: "invoice:in_null_discriminator:attempt:unknown:outcome:paid",
      fence,
      currentOutcome: null,
      currentInvoiceStatus: null,
      paymentIntentStatus: null,
      nextPaymentAttempt: null,
    }),
    /rpc_22023|invoice projection/i,
  );
  assert.equal((await ledgerRows()).length, 0);
  const row = await state();
  assert.equal(row.receipt_status, "processing");
  assert.equal(row.dispatch_status, "processing");
});

test("a dispatch lease expiring during ledger insertion cannot commit payment fields", async () => {
  await seedSubscription({ failureType: "invoice.payment_failed", failureAt: "2026-01-01T00:00:00Z" });
  const dispatch = await claimFromAccepted("evt_projection_elapsed_lease", "in_elapsed");
  const client = createRpcClient();
  const runtime = createSupabaseInvoiceProjectionRuntime(client);
  const fence = await runtime.acquireFence({ dispatch, stripeCustomerId: CUSTOMER_ID });
  assert.ok(fence);
  await db.exec(`
    create function public.delay_projection_ledger() returns trigger language plpgsql as $$
    begin
      perform pg_sleep(1.2);
      return new;
    end;
    $$;
    create trigger delay_projection_ledger before insert on billing_ingress.stripe_application_ledger
      for each row execute function public.delay_projection_ledger();
  `);
  try {
    await execute("update billing_ingress.stripe_webhook_dispatches set lease_until = clock_timestamp() + interval '0.6 seconds' where id = $1::uuid", [dispatch.dispatch_id]);
    const response = await client.rpc("apply_stripe_invoice_projection", {
      p_receipt_id: dispatch.receipt_id, p_dispatch_id: dispatch.dispatch_id,
      p_livemode: true, p_lease_token: dispatch.lease_token,
      p_claim_generation: dispatch.claim_generation,
      p_stripe_customer_id: CUSTOMER_ID, p_stripe_subscription_id: SUBSCRIPTION_ID,
      p_source_invoice_id: "in_elapsed", p_current_invoice_id: "in_elapsed",
      p_invoice_attempt_key: "pi_elapsed:attempt:1:outcome:paid",
      p_fence_token: fence.fence_token, p_fence_generation: fence.fence_generation,
      p_source_event_type: dispatch.event_type, p_current_outcome: "paid",
      p_current_invoice_status: "paid", p_payment_intent_status: "succeeded",
      p_next_payment_attempt: null,
    });
    assert.equal(response.error?.code, "P0001");
    assert.match(response.error?.message ?? "", /lease expired at mutation boundary/);
    assert.equal((await ledgerRows()).length, 0);
    const row = await state();
    assert.equal(row.receipt_status, "processing");
    assert.equal(row.dispatch_status, "processing");
    assert.equal(row.payment_failure_type, "invoice.payment_failed");
    assert.ok(row.payment_failure_at);
  } finally {
    await db.exec("drop trigger delay_projection_ledger on billing_ingress.stripe_application_ledger; drop function public.delay_projection_ledger();");
  }
});

test("anonymous roles cannot invoke projection RPCs and service_role cannot read projection tables", async () => {
  await seedSubscription();
  const dispatch = await claimFromAccepted("evt_projection_acl", "in_acl");
  for (const role of ["anon", "authenticated"]) {
    await execute(`set role ${role}`);
    await setRequestRole("service_role");
    await assert.rejects(
      () => execute("select * from public.acquire_stripe_customer_fence($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7)", [dispatch.receipt_id, dispatch.dispatch_id, true, dispatch.lease_token, dispatch.claim_generation, CUSTOMER_ID, 300]),
      /permission denied/,
    );
    await execute("reset role");
    await setRequestRole("service_role");
  }
  await execute("set role service_role");
  await assert.rejects(
    () => execute("select count(*) from billing_ingress.stripe_application_ledger"),
    /permission denied/,
  );
  await assert.rejects(
    () => execute("select count(*) from billing_ingress.stripe_sync_fences"),
    /permission denied/,
  );
  await execute("reset role");
  await setRequestRole("service_role");
});

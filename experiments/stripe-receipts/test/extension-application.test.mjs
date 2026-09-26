import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const foundationSql = await readFile(
  new URL("../../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql", import.meta.url),
  "utf8",
);
const leasesSql = await readFile(
  new URL("../../../supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql", import.meta.url),
  "utf8",
);
const applicationSql = await readFile(
  new URL("../../../supabase/migrations/20260925120000_add_stripe_extension_application.sql", import.meta.url),
  "utf8",
);

const USER_ID = "10000000-0000-4000-8000-000000000001";
const LICENSE_ID = "20000000-0000-4000-8000-000000000001";
const FANMARK_ID = "30000000-0000-4000-8000-000000000001";
const ENTRY_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_ENTRY_ID = "40000000-0000-4000-8000-000000000002";

const baseSchemaSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create function auth.role()
  returns text language sql stable
  as $$ select current_setting('request.jwt.claim.role', true) $$;

  create table public.fanmarks (
    id uuid primary key,
    status text not null,
    tier_level smallint not null
  );
  create table public.fanmark_licenses (
    id uuid primary key,
    fanmark_id uuid not null,
    user_id uuid,
    license_end timestamptz,
    status text not null check (status in ('active', 'grace', 'expired')),
    updated_at timestamptz not null default now(),
    grace_expires_at timestamptz,
    is_returned boolean not null default false,
    is_transferred boolean not null default false,
    transfer_locked_until timestamptz,
    excluded_at timestamptz,
    excluded_from_plan text,
    display_fanmark text
  );
  create table public.fanmark_transfer_requests (
    id uuid primary key,
    license_id uuid not null,
    status text not null
  );
  create table public.fanmark_lottery_entries (
    id uuid primary key,
    fanmark_id uuid not null,
    user_id uuid not null,
    license_id uuid not null,
    entry_status text not null,
    cancellation_reason text,
    cancelled_at timestamptz,
    updated_at timestamptz not null default now()
  );
  create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid,
    action text not null,
    resource_type text not null,
    resource_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create table public.notification_events (
    id uuid primary key default gen_random_uuid(),
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    source text not null,
    dedupe_key text,
    trigger_at timestamptz not null default now(),
    status text not null default 'pending'
  );
  create function public.create_notification_event(
    event_type_param text,
    payload_param jsonb,
    source_param text default 'system',
    dedupe_key_param text default null,
    trigger_at_param timestamptz default now()
  ) returns uuid language plpgsql security definer as $$
  declare
    event_id uuid;
  begin
    if dedupe_key_param is not null then
      select id into event_id from public.notification_events
       where dedupe_key = dedupe_key_param and status in ('pending', 'processing')
       limit 1;
      if found then return event_id; end if;
    end if;
    insert into public.notification_events (
      event_type, payload, source, dedupe_key, trigger_at, status
    ) values (
      event_type_param, payload_param, source_param, dedupe_key_param,
      trigger_at_param, 'pending'
    ) returning id into event_id;
    return event_id;
  end;
  $$;
`;

let db;

async function execute(sql, params = []) {
  return db.query(sql, params);
}

async function setRequestRole(role) {
  await execute("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

function checkoutPayload({
  eventId,
  eventType = "checkout.session.completed",
  sessionId = "cs_extension_001",
  status = "complete",
  paymentStatus = "paid",
  amount = 1200,
  currency = "jpy",
  userId = USER_ID,
  licenseId = LICENSE_ID,
  fanmarkId = FANMARK_ID,
  tierLevel = "2",
  months = "1",
  expectedTotal = "1200",
  allowZero = "false",
  metadataOverrides = {},
} = {}) {
  const metadata = {
    type: "license_extension",
    user_id: userId,
    license_id: licenseId,
    fanmark_id: fanmarkId,
    tier_level: tierLevel,
    months,
    ...metadataOverrides,
  };
  if (expectedTotal !== null) metadata.expected_total_yen = expectedTotal;
  if (allowZero !== null) metadata.allow_zero_total = allowZero;
  return {
    schema_version: 1,
    event: {
      id: eventId,
      type: eventType,
      created: 1790320000,
      api_version: "2025-08-27.basil",
      livemode: false,
    },
    object: { type: "checkout.session", id: sessionId },
    branch: "checkout_session",
    reference: { object_type: "checkout.session", object_id: sessionId },
    checkout_session: {
      id: sessionId,
      mode: "payment",
      status,
      payment_status: paymentStatus,
      amount_total: amount,
      currency,
      customer_id: null,
      subscription_id: null,
      payment_intent_id: "pi_extension_001",
      client_reference_id: userId,
      expires_at: null,
      metadata,
    },
  };
}

async function accept({
  eventId = "evt_extension_001",
  eventType = "checkout.session.completed",
  sessionId = "cs_extension_001",
  payloadOverrides = {},
} = {}) {
  const normalizedPayload = checkoutPayload({
    eventId,
    eventType,
    sessionId,
    ...payloadOverrides,
  });
  const result = await execute(`
    select * from public.accept_stripe_webhook_receipt(
      $1, false, $2, 'checkout.session', $3, '2025-08-27.basil', 1,
      $4::jsonb, $5, $6
    )
  `, [eventId, eventType, sessionId, JSON.stringify(normalizedPayload), "a".repeat(64), "b".repeat(64)]);
  return result.rows[0];
}

async function apply(receiptId) {
  const result = await execute(
    "select * from public.apply_stripe_extension_receipt($1::uuid)",
    [receiptId],
  );
  return result.rows[0];
}

async function beginIntent({
  requestId = "50000000-0000-4000-8000-000000000001",
  userId = USER_ID,
  licenseId = LICENSE_ID,
  months = 1,
  tierLevel = 2,
  priceId = "price_extension_1200",
  totalYen = 1200,
  livemode = false,
} = {}) {
  const result = await execute(`
    select * from public.begin_stripe_extension_checkout_intent(
      $1::uuid, $2::uuid, $3::uuid, $4::smallint, $5::smallint, $6::text, $7::bigint, $8::boolean
    )
  `, [requestId, userId, licenseId, months, tierLevel, priceId, totalYen, livemode]);
  return result.rows[0];
}

async function seedLicense({
  status = "active",
  ownerId = USER_ID,
  licenseEnd = "2026-09-25T12:00:00.000Z",
  isReturned = false,
  isTransferred = false,
  transferLock = null,
  tierLevel = 2,
  displayFanmark = "🌸",
} = {}) {
  await execute("insert into public.fanmarks (id, status, tier_level) values ($1::uuid, 'active', $2)", [FANMARK_ID, tierLevel]);
  await execute(`
    insert into public.fanmark_licenses (
      id, fanmark_id, user_id, license_end, status,
      is_returned, is_transferred, transfer_locked_until, display_fanmark
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, $7, $8::timestamptz, $9)
  `, [LICENSE_ID, FANMARK_ID, ownerId, licenseEnd, status, isReturned, isTransferred, transferLock, displayFanmark]);
  await execute(`
    insert into public.fanmark_lottery_entries (id, fanmark_id, user_id, license_id, entry_status)
    values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'pending'),
           ($5::uuid, $2::uuid, $3::uuid, $4::uuid, 'cancelled')
  `, [ENTRY_ID, FANMARK_ID, USER_ID, LICENSE_ID, OTHER_ENTRY_ID]);
}

before(async () => {
  db = new PGlite();
  await db.exec(baseSchemaSql);
  await db.exec(foundationSql);
  await db.exec(leasesSql);
  await db.exec(applicationSql);
  await setRequestRole("service_role");
});

beforeEach(async () => {
  await execute("reset role");
  await setRequestRole("service_role");
  await execute("set time zone 'UTC'");
  await execute("set search_path = public");
  await execute(`
    truncate billing_ingress.stripe_extension_applications,
             billing_ingress.stripe_extension_checkout_intents,
             billing_ingress.stripe_webhook_dispatches,
             billing_ingress.stripe_webhook_receipts,
             public.audit_logs,
             public.notification_events,
             public.fanmark_lottery_entries,
             public.fanmark_transfer_requests,
             public.fanmark_licenses,
             public.fanmarks cascade
  `);
});

test("creates one intent per user request, rejects changed terms, and binds one Session", async () => {
  await seedLicense();
  const first = await beginIntent();
  const retry = await beginIntent();
  assert.equal(first.intent_id, retry.intent_id);
  const priceChanged = await beginIntent({ priceId: "price_extension_1400", totalYen: 1400 });
  assert.equal(priceChanged.intent_id, first.intent_id);
  assert.equal(priceChanged.intent_price_id, "price_extension_1200");
  assert.equal(Number(priceChanged.intent_expected_total_yen), 1200);
  assert.equal(first.stripe_checkout_session_id, null);
  assert.equal(first.intent_status, "created");
  assert.equal(first.can_create_session, true);
  await assert.rejects(beginIntent({ months: 2 }), /reused with different terms/);

  const bound = await execute(
    "select * from public.attach_stripe_extension_checkout_session($1::uuid, $2::text)",
    [first.intent_id, "cs_intent_001"],
  );
  assert.deepEqual(bound.rows[0], {
    intent_status: "open",
    stripe_checkout_session_id: "cs_intent_001",
  });
  const boundRetry = await execute(
    "select * from public.attach_stripe_extension_checkout_session($1::uuid, $2::text)",
    [first.intent_id, "cs_intent_001"],
  );
  assert.deepEqual(boundRetry.rows[0], bound.rows[0]);
  await assert.rejects(
    execute("select * from public.attach_stripe_extension_checkout_session($1::uuid, $2::text)", [first.intent_id, "cs_intent_002"]),
    /already bound to another Session/,
  );
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_checkout_intents")).rows[0].n, 1);
});

test("stops retrying an unbound intent before Stripe can prune its idempotency key", async () => {
  await seedLicense();
  const intent = await beginIntent();
  await execute(
    "update billing_ingress.stripe_extension_checkout_intents set idempotency_safe_until = clock_timestamp() - interval '1 second' where id = $1::uuid",
    [intent.intent_id],
  );
  const retry = await beginIntent({ priceId: null, totalYen: null });
  assert.equal(retry.intent_id, intent.intent_id);
  assert.equal(retry.intent_status, "reconciliation_required");
  assert.equal(retry.can_create_session, false);
  assert.equal(retry.stripe_checkout_session_id, null);
});

test("cannot create an extension checkout intent for a license owned by someone else", async () => {
  await seedLicense({ ownerId: "10000000-0000-4000-8000-000000000002" });
  await assert.rejects(beginIntent(), /license is not eligible/);
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_checkout_intents")).rows[0].n, 0);
});

test("a signed Session applies only through its matching intent and marks it applied", async () => {
  await seedLicense();
  const intent = await beginIntent();
  const accepted = await accept({
    payloadOverrides: {
      metadataOverrides: {
        billing_intent_id: intent.intent_id,
        price_id: "price_extension_1200",
      },
    },
  });
  const result = await apply(accepted.receipt_id);
  assert.equal(result.outcome, "applied");
  const storedIntent = await execute(
    "select status, stripe_checkout_session_id from billing_ingress.stripe_extension_checkout_intents where id = $1::uuid",
    [intent.intent_id],
  );
  assert.deepEqual(storedIntent.rows[0], {
    status: "applied",
    stripe_checkout_session_id: "cs_extension_001",
  });
  assert.equal((await execute("select billing_intent_id from billing_ingress.stripe_extension_applications")).rows[0].billing_intent_id, intent.intent_id);
});

test("checkout intent storage is not directly readable by client roles", async () => {
  await seedLicense();
  await beginIntent();
  await execute("set role anon");
  await setRequestRole("anon");
  await assert.rejects(
    execute("select * from billing_ingress.stripe_extension_checkout_intents"),
    /permission denied/,
  );
  await execute("reset role");
  await setRequestRole("service_role");
});

after(async () => {
  await db.close();
});

test("applies one paid extension and commits license, lottery, audit, ledger, receipt, and dispatch together", async () => {
  await seedLicense({ licenseEnd: "2026-10-01T12:00:00.000Z" });
  const accepted = await accept();
  await execute("set time zone 'America/Los_Angeles'");
  const result = await apply(accepted.receipt_id);
  await execute("set time zone 'UTC'");

  assert.equal(result.outcome, "applied");
  assert.equal(result.receipt_status, "applied");
  assert.equal(result.dispatch_status, "completed");
  assert.equal(result.license_end.toISOString(), "2026-11-02T00:00:00.000Z");

  const license = await execute("select status, license_end, grace_expires_at, is_returned from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID]);
  assert.deepEqual(license.rows[0], {
    status: "active",
    license_end: result.license_end,
    grace_expires_at: null,
    is_returned: false,
  });
  const entries = await execute("select id, entry_status, cancellation_reason from public.fanmark_lottery_entries order by id");
  assert.deepEqual(entries.rows, [
    { id: ENTRY_ID, entry_status: "cancelled_by_extension", cancellation_reason: "license_extended" },
    { id: OTHER_ENTRY_ID, entry_status: "cancelled", cancellation_reason: null },
  ]);
  const audit = await execute("select action, resource_id, metadata ->> 'payment_session_id' as session_id from public.audit_logs");
  assert.deepEqual(audit.rows, [
    { action: "LICENSE_EXTENDED", resource_id: LICENSE_ID, session_id: "cs_extension_001" },
    { action: "LICENSE_EXTENDED_LOTTERY_CANCELLED", resource_id: LICENSE_ID, session_id: "cs_extension_001" },
  ]);
  const notifications = await execute("select event_type, payload ->> 'user_id' as recipient, payload ->> 'fanmark_name' as fanmark_name, payload ->> 'extended_by_user_id' as extended_by, dedupe_key from public.notification_events");
  assert.deepEqual(notifications.rows, [{
    event_type: "lottery_cancelled_by_extension",
    recipient: USER_ID,
    fanmark_name: "🌸",
    extended_by: USER_ID,
    dedupe_key: "stripe-extension-lottery:cs_extension_001:" + ENTRY_ID,
  }]);
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_applications where status = 'applied'")).rows[0].n, 1);

  const duplicate = await apply(accepted.receipt_id);
  assert.equal(duplicate.outcome, "duplicate_terminal");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 2);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 1);
});

test("conflicting signed metadata for one Session permanently blocks its extension", async () => {
  await seedLicense();
  const unpaid = await accept({ payloadOverrides: { paymentStatus: "unpaid" } });
  assert.equal((await apply(unpaid.receipt_id)).outcome, "awaiting_payment");

  const conflict = await accept({
    eventId: "evt_extension_conflicting_session_metadata",
    payloadOverrides: { metadataOverrides: { months: "2" } },
  });
  assert.equal((await apply(conflict.receipt_id)).outcome, "dead_letter");

  const paid = await accept({
    eventId: "evt_extension_original_session_paid",
    eventType: "checkout.session.async_payment_succeeded",
  });
  assert.equal((await apply(paid.receipt_id)).outcome, "dead_letter");
  assert.equal((await execute("select license_end from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].license_end.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 0);
});

test("deduplicates distinct Stripe events for the same Checkout Session", async () => {
  await seedLicense();
  const first = await accept();
  const second = await accept({ eventId: "evt_extension_async_001", eventType: "checkout.session.async_payment_succeeded" });

  assert.equal((await apply(first.receipt_id)).outcome, "applied");
  const duplicate = await apply(second.receipt_id);
  assert.equal(duplicate.outcome, "duplicate_session");
  assert.equal(duplicate.receipt_status, "applied");
  assert.equal(duplicate.dispatch_status, "completed");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 2);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 1);
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_applications")).rows[0].n, 1);
});

test("unpaid completion waits, then an async success applies exactly once", async () => {
  await seedLicense();
  const unpaid = await accept({ payloadOverrides: { paymentStatus: "unpaid" } });
  const waiting = await apply(unpaid.receipt_id);
  assert.equal(waiting.outcome, "awaiting_payment");
  assert.equal(waiting.receipt_status, "ignored");
  assert.equal((await execute("select status from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].status, "active");

  const paid = await accept({
    eventId: "evt_extension_async_001",
    eventType: "checkout.session.async_payment_succeeded",
  });
  assert.equal((await apply(paid.receipt_id)).outcome, "applied");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 2);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 1);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 1);
});

test("a failed or expired session cannot later grant time", async () => {
  await seedLicense();
  const expired = await accept({
    eventType: "checkout.session.expired",
    sessionId: "cs_extension_expired",
    payloadOverrides: { status: "expired", paymentStatus: "unpaid" },
  });
  assert.equal((await apply(expired.receipt_id)).outcome, "no_grant");

  const failed = await accept({
    eventId: "evt_extension_failed",
    eventType: "checkout.session.async_payment_failed",
    sessionId: "cs_extension_failed",
    payloadOverrides: { paymentStatus: "unpaid" },
  });
  assert.equal((await apply(failed.receipt_id)).outcome, "no_grant");

  const latePaid = await accept({
    eventId: "evt_extension_late_paid",
    eventType: "checkout.session.async_payment_succeeded",
    sessionId: "cs_extension_failed",
  });
  const rejected = await apply(latePaid.receipt_id);
  assert.equal(rejected.outcome, "dead_letter");
  assert.equal(rejected.receipt_status, "dead_letter");
  assert.equal((await execute("select license_end from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].license_end.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 0);
});

test("amount, currency, and zero-total policy mismatches are durably rejected", async () => {
  await seedLicense();
  const bad = await accept({ payloadOverrides: { amount: 1199 } });
  const result = await apply(bad.receipt_id);
  assert.equal(result.outcome, "dead_letter");
  assert.equal(result.receipt_status, "dead_letter");
  assert.equal((await execute("select status from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].status, "active");

  const zero = await accept({
    eventId: "evt_extension_zero",
    sessionId: "cs_extension_zero",
    payloadOverrides: {
      paymentStatus: "no_payment_required",
      amount: 0,
      expectedTotal: "0",
      allowZero: "true",
    },
  });
  assert.equal((await apply(zero.receipt_id)).outcome, "dead_letter");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 0);
});

test("a stale owner or transfer lock cannot be extended", async () => {
  await seedLicense({ ownerId: "10000000-0000-4000-8000-000000000099" });
  const staleOwner = await accept();
  assert.equal((await apply(staleOwner.receipt_id)).outcome, "dead_letter");

  await execute("truncate billing_ingress.stripe_extension_applications, billing_ingress.stripe_webhook_dispatches, billing_ingress.stripe_webhook_receipts, public.audit_logs, public.fanmark_lottery_entries, public.fanmark_licenses, public.fanmarks cascade");
  await seedLicense({ transferLock: "2026-09-26T00:00:00.000Z" });
  const locked = await accept();
  assert.equal((await apply(locked.receipt_id)).outcome, "dead_letter");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 0);
});

test("a failure in the audit write rolls back every business and ledger change", async () => {
  await seedLicense();
  const accepted = await accept();
  await execute(`
    create function public.reject_license_extension_audit() returns trigger
    language plpgsql as $$
    begin
      if new.action = 'LICENSE_EXTENDED' then raise exception 'synthetic audit failure'; end if;
      return new;
    end $$;
  `);
  await execute(`
    create trigger reject_license_extension_audit
    before insert on public.audit_logs
    for each row execute function public.reject_license_extension_audit()
  `);

  await assert.rejects(apply(accepted.receipt_id), /synthetic audit failure/);
  assert.equal((await execute("select license_end from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].license_end.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal((await execute("select entry_status from public.fanmark_lottery_entries where id = $1::uuid", [ENTRY_ID])).rows[0].entry_status, "pending");
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_applications")).rows[0].n, 0);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 0);
  assert.equal((await execute("select status from billing_ingress.stripe_webhook_receipts where id = $1::uuid", [accepted.receipt_id])).rows[0].status, "received");
  assert.equal((await execute("select status from billing_ingress.stripe_webhook_dispatches where receipt_id = $1::uuid", [accepted.receipt_id])).rows[0].status, "pending");
});

test("a notification enqueue failure rolls back the extension and cancellation", async () => {
  await seedLicense();
  const accepted = await accept();
  await execute(`
    create function public.reject_extension_notification() returns trigger
    language plpgsql as $$
    begin
      if new.event_type = 'lottery_cancelled_by_extension' then
        raise exception 'synthetic notification failure';
      end if;
      return new;
    end $$;
  `);
  await execute(`
    create trigger reject_extension_notification
    before insert on public.notification_events
    for each row execute function public.reject_extension_notification()
  `);

  await assert.rejects(apply(accepted.receipt_id), /synthetic notification failure/);
  assert.equal((await execute("select license_end from public.fanmark_licenses where id = $1::uuid", [LICENSE_ID])).rows[0].license_end.toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal((await execute("select entry_status from public.fanmark_lottery_entries where id = $1::uuid", [ENTRY_ID])).rows[0].entry_status, "pending");
  assert.equal((await execute("select count(*)::int as n from public.audit_logs")).rows[0].n, 0);
  assert.equal((await execute("select count(*)::int as n from public.notification_events")).rows[0].n, 0);
  assert.equal((await execute("select count(*)::int as n from billing_ingress.stripe_extension_applications")).rows[0].n, 0);
  assert.equal((await execute("select status from billing_ingress.stripe_webhook_receipts where id = $1::uuid", [accepted.receipt_id])).rows[0].status, "received");
  assert.equal((await execute("select status from billing_ingress.stripe_webhook_dispatches where receipt_id = $1::uuid", [accepted.receipt_id])).rows[0].status, "pending");
});

test("client roles cannot invoke the application RPC or read the effect ledger", async () => {
  await seedLicense();
  const accepted = await accept();
  await execute("reset role");
  await setRequestRole("anon");
  await execute("set role anon");
  await assert.rejects(apply(accepted.receipt_id), /permission denied/);
  await execute("reset role");
  await setRequestRole("service_role");
  await execute("set role service_role");
  await assert.rejects(execute("select * from billing_ingress.stripe_extension_applications"), /permission denied/);
  await execute("reset role");
  await setRequestRole("service_role");
});

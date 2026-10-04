-- Customer-fenced invoice projection primitives for Stripe migration issue #32.
--
-- This migration consumes a claimed receipt only through a service-role RPC.
-- It does not grant licenses, change plan_type, send notifications, or wire the
-- existing webhook. The worker must acquire a customer fence before remote
-- Stripe reconciliation and must apply the current invoice state atomically.

alter table billing_ingress.stripe_webhook_dispatches
  add constraint stripe_webhook_dispatches_binding_unique
  unique (id, receipt_id, livemode, stripe_event_id);

create table billing_ingress.stripe_sync_fences (
  livemode boolean not null,
  stripe_customer_id text not null,
  generation bigint not null default 0,
  owner_token uuid,
  lease_until timestamptz,
  last_reconciled_at timestamptz,
  last_invoice_id text,
  last_invoice_attempt_key text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (livemode, stripe_customer_id),
  constraint stripe_sync_fences_customer_check
    check (length(btrim(stripe_customer_id)) > 0),
  constraint stripe_sync_fences_generation_check
    check (generation >= 0),
  constraint stripe_sync_fences_lease_check
    check ((owner_token is null) = (lease_until is null)),
  constraint stripe_sync_fences_attempt_key_check
    check (last_invoice_attempt_key is null or length(last_invoice_attempt_key) <= 512),
  constraint stripe_sync_fences_error_code_check
    check (last_error_code is null or octet_length(last_error_code) <= 128)
);

comment on table billing_ingress.stripe_sync_fences is
  'Service-only per-customer generation fence for Stripe subscription and invoice reconciliation.';
comment on column billing_ingress.stripe_sync_fences.generation is
  'Monotonically increasing fence generation; an older remote read cannot commit after a newer owner.';

create table billing_ingress.stripe_application_ledger (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  dispatch_id uuid not null,
  stripe_event_id text not null,
  livemode boolean not null,
  effect_kind text not null,
  effect_key text not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  source_invoice_id text not null,
  current_invoice_id text not null,
  invoice_attempt_key text not null,
  local_user_id uuid not null,
  fence_generation bigint not null,
  input_hash text not null,
  current_outcome text not null,
  status text not null default 'applying',
  result_summary jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint stripe_application_ledger_receipt_fk
    foreign key (receipt_id, livemode, stripe_event_id)
    references billing_ingress.stripe_webhook_receipts (id, livemode, stripe_event_id)
    on delete cascade,
  constraint stripe_application_ledger_dispatch_fk
    foreign key (dispatch_id, receipt_id, livemode, stripe_event_id)
    references billing_ingress.stripe_webhook_dispatches (id, receipt_id, livemode, stripe_event_id)
    on delete cascade,
  constraint stripe_application_ledger_event_check
    check (length(btrim(stripe_event_id)) > 0),
  constraint stripe_application_ledger_effect_kind_check
    check (effect_kind = 'invoice_projection'),
  constraint stripe_application_ledger_effect_key_check
    check (length(btrim(effect_key)) > 0 and length(effect_key) <= 512),
  constraint stripe_application_ledger_customer_check
    check (length(btrim(stripe_customer_id)) > 0),
  constraint stripe_application_ledger_subscription_check
    check (length(btrim(stripe_subscription_id)) > 0),
  constraint stripe_application_ledger_source_invoice_check
    check (length(btrim(source_invoice_id)) > 0),
  constraint stripe_application_ledger_current_invoice_check
    check (length(btrim(current_invoice_id)) > 0),
  constraint stripe_application_ledger_attempt_key_check
    check (length(btrim(invoice_attempt_key)) > 0 and length(invoice_attempt_key) <= 512),
  constraint stripe_application_ledger_generation_check
    check (fence_generation > 0),
  constraint stripe_application_ledger_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint stripe_application_ledger_outcome_check
    check (current_outcome in ('paid', 'payment_failed', 'requires_action', 'uncollectible')),
  constraint stripe_application_ledger_status_check
    check (status in ('applying', 'applied', 'superseded', 'rejected', 'retryable', 'dead_letter')),
  constraint stripe_application_ledger_summary_check
    check (jsonb_typeof(result_summary) = 'object'),
  constraint stripe_application_ledger_failure_code_check
    check (failure_code is null or octet_length(failure_code) <= 128),
  constraint stripe_application_ledger_failure_message_check
    check (failure_message is null or octet_length(failure_message) <= 1000),
  constraint stripe_application_ledger_attempt_count_check
    check (attempt_count > 0),
  constraint stripe_application_ledger_applied_at_check
    check ((status = 'applied') = (applied_at is not null)),
  constraint stripe_application_ledger_event_effect_unique
    unique (livemode, stripe_event_id, effect_kind),
  constraint stripe_application_ledger_effect_key_unique
    unique (livemode, effect_key)
);

comment on table billing_ingress.stripe_application_ledger is
  'Service-only invoice projection effects; one source event may commit at most one effect row.';
comment on column billing_ingress.stripe_application_ledger.invoice_attempt_key is
  'Replayable payment-attempt identity; invoice ID alone is not a dedupe key.';
comment on column billing_ingress.stripe_application_ledger.result_summary is
  'Bounded current-state evidence only; never a provider payload or secret.';

create index stripe_sync_fences_lease_idx
  on billing_ingress.stripe_sync_fences (livemode, lease_until);
create index stripe_application_ledger_invoice_idx
  on billing_ingress.stripe_application_ledger
    (livemode, stripe_customer_id, stripe_subscription_id, source_invoice_id);

alter table billing_ingress.stripe_sync_fences enable row level security;
alter table billing_ingress.stripe_application_ledger enable row level security;

revoke all on table billing_ingress.stripe_sync_fences from public;
revoke all on table billing_ingress.stripe_application_ledger from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table billing_ingress.stripe_sync_fences from anon';
    execute 'revoke all on table billing_ingress.stripe_application_ledger from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table billing_ingress.stripe_sync_fences from authenticated';
    execute 'revoke all on table billing_ingress.stripe_application_ledger from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table billing_ingress.stripe_sync_fences from service_role';
    execute 'revoke all on table billing_ingress.stripe_application_ledger from service_role';
  end if;
end
$$;

-- Lock order for all functions in this migration is receipt, dispatch, fence,
-- mapped user_settings row, then subscription. It matches the receipt-first
-- lease functions and prevents a
-- worker from acquiring a customer fence while another path holds a later row.
create or replace function public.acquire_stripe_customer_fence(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_stripe_customer_id text,
  p_lease_seconds integer default 300
)
returns table (
  stripe_customer_id text,
  livemode boolean,
  fence_generation bigint,
  fence_token uuid,
  lease_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
declare
  v_request_role text;
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_fence billing_ingress.stripe_sync_fences%rowtype;
  v_now timestamptz;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe customer fence'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or p_dispatch_id is null or p_livemode is null
     or p_lease_token is null or p_claim_generation is null then
    raise exception 'receipt, dispatch, mode, token, and generation are required'
      using errcode = '22023';
  end if;
  if p_claim_generation < 1 then
    raise exception 'claim generation must be positive' using errcode = '22023';
  end if;
  if p_stripe_customer_id is null or length(btrim(p_stripe_customer_id)) = 0 then
    raise exception 'Stripe customer ID is required' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'fence lease duration must be between 1 and 3600 seconds'
      using errcode = '22023';
  end if;

  -- Receipt then dispatch: the same order used by claim, renew, and retry.
  select r.*
    into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
   where r.id = p_receipt_id
     and r.livemode = p_livemode
     and r.status = 'processing'
   for update;
  if not found then
    return;
  end if;

  select d.*
    into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.id = p_dispatch_id
     and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null
     and d.lease_until > clock_timestamp()
   for update;
  if not found then
    return;
  end if;

  v_now := clock_timestamp();
  insert into billing_ingress.stripe_sync_fences (
    livemode,
    stripe_customer_id
  ) values (
    p_livemode,
    btrim(p_stripe_customer_id)
  ) on conflict on constraint stripe_sync_fences_pkey do nothing;

  select f.*
    into v_fence
    from billing_ingress.stripe_sync_fences as f
   where f.livemode = p_livemode
     and f.stripe_customer_id = btrim(p_stripe_customer_id)
   for update;

  -- The dispatch row is held while the fence row is locked. Re-sample SQL
  -- time after that potentially blocking lock so an expired worker cannot be
  -- handed a new fence generation.
  v_now := clock_timestamp();
  if v_dispatch.lease_until is null or v_dispatch.lease_until <= v_now then
    return;
  end if;
  if v_fence.owner_token is not null
     and v_fence.lease_until is not null
     and v_fence.lease_until > v_now then
    return;
  end if;

  update billing_ingress.stripe_sync_fences as f
     set generation = f.generation + 1,
         owner_token = gen_random_uuid(),
         lease_until = v_now + make_interval(secs => p_lease_seconds),
         last_error_code = null,
         updated_at = v_now
   where f.livemode = p_livemode
     and f.stripe_customer_id = btrim(p_stripe_customer_id)
   returning f.* into v_fence;

  stripe_customer_id := v_fence.stripe_customer_id;
  livemode := v_fence.livemode;
  fence_generation := v_fence.generation;
  fence_token := v_fence.owner_token;
  lease_until := v_fence.lease_until;
  return next;
end;
$$;

-- Release a fence after a remote read fails or is reviewable. This has the
-- same receipt/dispatch/fence order and is safe when a newer generation won:
-- the token and generation predicate then return no row.
create or replace function public.release_stripe_customer_fence(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_stripe_customer_id text,
  p_fence_token uuid,
  p_fence_generation bigint
)
returns table (released boolean)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
declare
  v_request_role text;
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_updated integer;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe customer fence release'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or p_dispatch_id is null or p_livemode is null
     or p_lease_token is null or p_claim_generation is null
     or p_fence_token is null or p_fence_generation is null
     or p_stripe_customer_id is null then
    raise exception 'receipt, dispatch, mode, lease, and fence identity are required'
      using errcode = '22023';
  end if;

  select r.* into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
   where r.id = p_receipt_id
     and r.livemode = p_livemode
     and r.status = 'processing'
   for update;
  if not found then
    released := false;
    return next;
    return;
  end if;

  select d.* into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.id = p_dispatch_id
     and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null
     and d.lease_until > clock_timestamp()
   for update;
  if not found then
    released := false;
    return next;
    return;
  end if;

  update billing_ingress.stripe_sync_fences as f
     set owner_token = null,
         lease_until = null,
         updated_at = clock_timestamp()
   where f.livemode = p_livemode
     and f.stripe_customer_id = btrim(p_stripe_customer_id)
     and f.owner_token = p_fence_token
     and f.generation = p_fence_generation;
  get diagnostics v_updated = row_count;
  released := v_updated = 1;
  return next;
end;
$$;

create or replace function public.apply_stripe_invoice_projection(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_source_invoice_id text,
  p_current_invoice_id text,
  p_invoice_attempt_key text,
  p_fence_token uuid,
  p_fence_generation bigint,
  p_source_event_type text,
  p_current_outcome text,
  p_current_invoice_status text,
  p_payment_intent_status text default null,
  p_next_payment_attempt timestamptz default null
)
returns table (
  application_id uuid,
  receipt_id uuid,
  dispatch_id uuid,
  outcome text,
  ledger_status text,
  receipt_status text,
  dispatch_status text,
  local_user_id uuid,
  source_invoice_id text,
  current_invoice_id text,
  invoice_attempt_key text,
  fence_generation bigint
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
declare
  v_request_role text;
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_fence billing_ingress.stripe_sync_fences%rowtype;
  v_application billing_ingress.stripe_application_ledger%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_user_id uuid;
  v_now timestamptz;
  v_effect_key text;
  v_existing boolean := false;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe invoice projection'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or p_dispatch_id is null or p_livemode is null
     or p_lease_token is null or p_claim_generation is null
     or p_fence_token is null or p_fence_generation is null then
    raise exception 'receipt, dispatch, lease, and fence identity are required'
      using errcode = '22023';
  end if;
  if p_claim_generation < 1 or p_fence_generation < 1 then
    raise exception 'claim and fence generations must be positive'
      using errcode = '22023';
  end if;
  if p_stripe_customer_id is null or length(btrim(p_stripe_customer_id)) = 0
     or p_stripe_subscription_id is null or length(btrim(p_stripe_subscription_id)) = 0
     or p_source_invoice_id is null or length(btrim(p_source_invoice_id)) = 0
     or p_current_invoice_id is null or length(btrim(p_current_invoice_id)) = 0
     or p_invoice_attempt_key is null or length(btrim(p_invoice_attempt_key)) = 0
     or length(p_invoice_attempt_key) > 512 then
    raise exception 'invoice projection identifiers are required and bounded'
      using errcode = '22023';
  end if;
  if p_source_event_type is null
     or p_current_outcome is null
     or p_current_invoice_status is null then
    raise exception 'invoice projection event, outcome, and invoice status are required'
      using errcode = '22023';
  end if;
  if p_source_event_type not in (
    'invoice.payment_failed',
    'invoice.payment_action_required',
    'invoice.payment_succeeded'
  ) then
    raise exception 'unsupported invoice projection event type'
      using errcode = '22023';
  end if;
  if p_current_outcome not in ('paid', 'payment_failed', 'requires_action', 'uncollectible') then
    raise exception 'unsupported current invoice outcome'
      using errcode = '22023';
  end if;
  if p_current_invoice_status not in ('open', 'paid', 'uncollectible') then
    raise exception 'unsupported current invoice status'
      using errcode = '22023';
  end if;
  if p_current_outcome = 'paid' and p_current_invoice_status <> 'paid' then
    raise exception 'paid outcome requires a paid invoice' using errcode = '22023';
  end if;
  if p_current_outcome = 'payment_failed'
     and p_current_invoice_status <> 'open' then
    raise exception 'failed outcome requires an open invoice'
      using errcode = '22023';
  end if;
  if p_current_outcome = 'requires_action' and p_current_invoice_status <> 'open' then
    raise exception 'action-required outcome requires an open invoice'
      using errcode = '22023';
  end if;
  if p_current_outcome = 'uncollectible' and p_current_invoice_status <> 'uncollectible' then
    raise exception 'uncollectible outcome requires an uncollectible invoice'
      using errcode = '22023';
  end if;
  if p_current_invoice_status = 'open'
     and p_current_outcome in ('payment_failed', 'requires_action')
     and p_payment_intent_status is null then
    raise exception 'open invoice outcome requires current payment intent state'
      using errcode = '22023';
  end if;
  if p_payment_intent_status is not null
     and (length(btrim(p_payment_intent_status)) = 0 or length(p_payment_intent_status) > 128) then
    raise exception 'payment intent status is invalid or too long' using errcode = '22023';
  end if;
  if p_current_outcome = 'paid'
     and p_payment_intent_status is not null
     and p_payment_intent_status <> 'succeeded' then
    raise exception 'paid outcome has a contradictory payment intent state'
      using errcode = '22023';
  end if;
  if p_current_outcome = 'requires_action'
     and p_payment_intent_status is not null
     and p_payment_intent_status <> 'requires_action' then
    raise exception 'action-required outcome has a contradictory payment intent state'
      using errcode = '22023';
  end if;
  if p_current_outcome = 'payment_failed'
     and p_current_invoice_status = 'open'
     and p_payment_intent_status is not null
     and p_payment_intent_status not in ('requires_payment_method', 'canceled') then
    raise exception 'failed outcome has a contradictory payment intent state'
      using errcode = '22023';
  end if;

  -- Receipt then dispatch, matching every lease transition.
  select r.* into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
   where r.id = p_receipt_id
     and r.livemode = p_livemode
     and r.status = 'processing'
   for update;
  if not found then
    raise exception 'invoice projection receipt is not processing'
      using errcode = 'P0001';
  end if;

  select d.* into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.id = p_dispatch_id
     and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null
     and d.lease_until > clock_timestamp()
   for update;
  if not found then
    raise exception 'invoice projection dispatch lease is stale'
      using errcode = 'P0001';
  end if;
  if v_receipt.event_type <> p_source_event_type
     or v_receipt.object_type is distinct from 'invoice'
     or v_receipt.object_id is distinct from btrim(p_source_invoice_id)
     or v_receipt.normalized_payload->>'branch' is distinct from 'invoice'
     or v_receipt.normalized_payload->'invoice'->>'id' is distinct from btrim(p_source_invoice_id)
     or v_receipt.normalized_payload->'invoice'->>'customer_id' is distinct from btrim(p_stripe_customer_id)
     or v_receipt.normalized_payload->'invoice'->>'subscription_id' is distinct from btrim(p_stripe_subscription_id) then
    raise exception 'invoice projection source receipt does not match'
      using errcode = 'P0001';
  end if;

  select f.* into v_fence
    from billing_ingress.stripe_sync_fences as f
   where f.livemode = p_livemode
     and f.stripe_customer_id = btrim(p_stripe_customer_id)
   for update;
  if not found
     or v_fence.owner_token is distinct from p_fence_token
     or v_fence.generation is distinct from p_fence_generation
     or v_fence.lease_until is null
     or v_fence.lease_until <= clock_timestamp() then
    raise exception 'invoice projection customer fence is stale'
      using errcode = 'P0001';
  end if;

  -- INTO STRICT prevents a duplicate mapping from being silently collapsed to
  -- an arbitrary user. Both zero and multiple rows are review-required.
  begin
    select us.user_id into strict v_user_id
      from public.user_settings as us
     where us.stripe_customer_id = btrim(p_stripe_customer_id)
     for update;
  exception
    when no_data_found or too_many_rows then
      raise exception 'invoice projection customer mapping requires review'
        using errcode = 'P0002';
  end;

  -- Recheck before taking the potentially blocking subscription lock.
  v_now := clock_timestamp();
  if v_dispatch.lease_until is null
     or v_dispatch.lease_until <= v_now
     or v_fence.lease_until is null
     or v_fence.lease_until <= v_now then
    raise exception 'invoice projection lease expired before subscription lock'
      using errcode = 'P0001';
  end if;

  select us.* into v_subscription
    from public.user_subscriptions as us
   where us.user_id = v_user_id
     and us.stripe_customer_id = btrim(p_stripe_customer_id)
     and us.stripe_subscription_id = btrim(p_stripe_subscription_id)
   for update;
  if not found then
    raise exception 'invoice projection subscription mapping requires review'
      using errcode = 'P0003';
  end if;

  -- The subscription lock is now held. Recheck every fencing predicate with
  -- fresh SQL time immediately before any business-row mutation.
  v_now := clock_timestamp();
  if v_dispatch.lease_until is null
     or v_dispatch.lease_until <= v_now
     or v_dispatch.lease_token is distinct from p_lease_token
     or v_dispatch.claim_generation is distinct from p_claim_generation
     or v_fence.owner_token is distinct from p_fence_token
     or v_fence.generation is distinct from p_fence_generation
     or v_fence.lease_until is null
     or v_fence.lease_until <= v_now then
    raise exception 'invoice projection lease expired before mutation'
      using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();
  v_effect_key := 'invoice-projection:' || v_receipt.stripe_event_id;
  insert into billing_ingress.stripe_application_ledger (
    receipt_id,
    dispatch_id,
    stripe_event_id,
    livemode,
    effect_kind,
    effect_key,
    stripe_customer_id,
    stripe_subscription_id,
    source_invoice_id,
    current_invoice_id,
    invoice_attempt_key,
    local_user_id,
    fence_generation,
    input_hash,
    current_outcome,
    status,
    result_summary,
    attempt_count
  ) values (
    v_receipt.id,
    v_dispatch.id,
    v_receipt.stripe_event_id,
    p_livemode,
    'invoice_projection',
    v_effect_key,
    btrim(p_stripe_customer_id),
    btrim(p_stripe_subscription_id),
    btrim(p_source_invoice_id),
    btrim(p_current_invoice_id),
    btrim(p_invoice_attempt_key),
    v_user_id,
    p_fence_generation,
    v_receipt.normalized_payload_sha256,
    p_current_outcome,
    'applying',
    jsonb_build_object(
      'source_event_type', p_source_event_type,
      'source_invoice_id', btrim(p_source_invoice_id),
      'current_invoice_id', btrim(p_current_invoice_id),
      'invoice_attempt_key', btrim(p_invoice_attempt_key),
      'invoice_status', p_current_invoice_status,
      'payment_intent_status', p_payment_intent_status,
      'outcome', p_current_outcome
    ),
    1
  )
  on conflict (livemode, stripe_event_id, effect_kind) do nothing
  returning * into v_application;

  if not found then
    select a.* into v_application
      from billing_ingress.stripe_application_ledger as a
     where a.livemode = p_livemode
       and a.stripe_event_id = v_receipt.stripe_event_id
       and a.effect_kind = 'invoice_projection'
     for update;
    v_existing := true;
  end if;

  if v_existing and v_application.status = 'applied' then
    v_now := clock_timestamp();
    if v_dispatch.lease_until is null
       or v_dispatch.lease_until <= v_now
       or v_dispatch.lease_token is distinct from p_lease_token
       or v_dispatch.claim_generation is distinct from p_claim_generation
       or v_fence.owner_token is distinct from p_fence_token
       or v_fence.generation is distinct from p_fence_generation
       or v_fence.lease_until is null
       or v_fence.lease_until <= v_now then
      raise exception 'invoice projection lease expired before duplicate repair'
        using errcode = 'P0001';
    end if;
    update billing_ingress.stripe_sync_fences as f
       set owner_token = null,
           lease_until = null,
           last_reconciled_at = v_now,
           last_invoice_id = v_application.current_invoice_id,
           last_invoice_attempt_key = v_application.invoice_attempt_key,
           updated_at = v_now
     where f.livemode = p_livemode
       and f.stripe_customer_id = btrim(p_stripe_customer_id)
       and f.owner_token = p_fence_token
       and f.generation = p_fence_generation;
    update billing_ingress.stripe_webhook_dispatches as d
       set status = 'completed',
           completed_at = v_now,
           claimed_at = null,
           lease_until = null,
           lease_token = null,
           updated_at = v_now
     where d.id = v_dispatch.id;
    update billing_ingress.stripe_webhook_receipts as r
       set status = 'applied',
           terminal_at = v_now,
           updated_at = v_now
     where r.id = v_receipt.id;
    application_id := v_application.id;
    receipt_id := v_receipt.id;
    dispatch_id := v_dispatch.id;
    outcome := 'duplicate_applied';
    ledger_status := v_application.status;
    receipt_status := 'applied';
    dispatch_status := 'completed';
    local_user_id := v_application.local_user_id;
    source_invoice_id := v_application.source_invoice_id;
    current_invoice_id := v_application.current_invoice_id;
    invoice_attempt_key := v_application.invoice_attempt_key;
    fence_generation := v_application.fence_generation;
    return next;
    return;
  end if;

  if v_existing then
    raise exception 'invoice projection application already exists in nonterminal state'
      using errcode = 'P0001';
  end if;

  -- The ledger row is now reserved. Recheck immediately before changing the
  -- subscription so a lease that expires during the insert cannot authorize
  -- the business-row effect.
  v_now := clock_timestamp();
  if v_dispatch.lease_until is null
     or v_dispatch.lease_until <= v_now
     or v_dispatch.lease_token is distinct from p_lease_token
     or v_dispatch.claim_generation is distinct from p_claim_generation
     or v_fence.owner_token is distinct from p_fence_token
     or v_fence.generation is distinct from p_fence_generation
     or v_fence.lease_until is null
     or v_fence.lease_until <= v_now then
    raise exception 'invoice projection lease expired at mutation boundary'
      using errcode = 'P0001';
  end if;

  if p_current_outcome = 'paid' then
    update public.user_subscriptions
       set payment_failure_at = null,
           next_payment_attempt = null,
           payment_failure_type = null,
           updated_at = v_now
     where id = v_subscription.id;
  elsif p_current_outcome in ('payment_failed', 'requires_action', 'uncollectible') then
    update public.user_subscriptions
       set payment_failure_at = v_now,
           next_payment_attempt = case
             when p_current_outcome = 'uncollectible' then null
             else p_next_payment_attempt
           end,
           payment_failure_type = case
             when p_current_outcome = 'requires_action' then 'invoice.payment_action_required'
             else 'invoice.payment_failed'
           end,
           updated_at = v_now
     where id = v_subscription.id;
  end if;

  update billing_ingress.stripe_application_ledger as a
     set status = 'applied',
         applied_at = v_now,
         updated_at = v_now
   where a.id = v_application.id
   returning a.* into v_application;

  update billing_ingress.stripe_sync_fences as f
     set owner_token = null,
         lease_until = null,
         last_reconciled_at = v_now,
         last_invoice_id = btrim(p_current_invoice_id),
         last_invoice_attempt_key = btrim(p_invoice_attempt_key),
         last_error_code = null,
         updated_at = v_now
   where f.livemode = p_livemode
     and f.stripe_customer_id = btrim(p_stripe_customer_id)
     and f.owner_token = p_fence_token
     and f.generation = p_fence_generation;

  update billing_ingress.stripe_webhook_dispatches as d
     set status = 'completed',
         completed_at = v_now,
         claimed_at = null,
         lease_until = null,
         lease_token = null,
         updated_at = v_now
   where d.id = v_dispatch.id
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation;

  update billing_ingress.stripe_webhook_receipts as r
     set status = 'applied',
         terminal_at = v_now,
         updated_at = v_now
   where r.id = v_receipt.id
     and r.status = 'processing';

  application_id := v_application.id;
  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  outcome := p_current_outcome;
  ledger_status := v_application.status;
  receipt_status := 'applied';
  dispatch_status := 'completed';
  local_user_id := v_user_id;
  source_invoice_id := btrim(p_source_invoice_id);
  current_invoice_id := btrim(p_current_invoice_id);
  invoice_attempt_key := btrim(p_invoice_attempt_key);
  fence_generation := p_fence_generation;
  return next;
end;
$$;

comment on function public.acquire_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, integer) is
  'Service-role-only receipt/dispatch-guarded customer fence acquisition before remote Stripe reconciliation.';
comment on function public.release_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, uuid, bigint) is
  'Service-role-only release for a current customer fence after a retryable remote reconciliation result.';
comment on function public.apply_stripe_invoice_projection(uuid, uuid, boolean, uuid, bigint, text, text, text, text, text, uuid, bigint, text, text, text, text, timestamptz) is
  'Service-role-only atomic current-invoice projection; marks receipt/dispatch terminal only with the subscription update.';

revoke all on function public.acquire_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, integer) from public;
revoke all on function public.release_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, uuid, bigint) from public;
revoke all on function public.apply_stripe_invoice_projection(uuid, uuid, boolean, uuid, bigint, text, text, text, text, text, uuid, bigint, text, text, text, text, timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.acquire_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, integer) from anon';
    execute 'revoke all on function public.release_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, uuid, bigint) from anon';
    execute 'revoke all on function public.apply_stripe_invoice_projection(uuid, uuid, boolean, uuid, bigint, text, text, text, text, text, uuid, bigint, text, text, text, text, timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.acquire_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, integer) from authenticated';
    execute 'revoke all on function public.release_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, uuid, bigint) from authenticated';
    execute 'revoke all on function public.apply_stripe_invoice_projection(uuid, uuid, boolean, uuid, bigint, text, text, text, text, text, uuid, bigint, text, text, text, text, timestamptz) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.acquire_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, integer) to service_role';
    execute 'grant execute on function public.release_stripe_customer_fence(uuid, uuid, boolean, uuid, bigint, text, uuid, bigint) to service_role';
    execute 'grant execute on function public.apply_stripe_invoice_projection(uuid, uuid, boolean, uuid, bigint, text, text, text, text, text, uuid, bigint, text, text, text, text, timestamptz) to service_role';
  end if;
end
$$;

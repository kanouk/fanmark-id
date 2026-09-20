-- Durable, service-only Stripe ingress foundation for migration issue #32.
--
-- This migration records an authenticated webhook receipt and its durable
-- dispatch row in one transaction. It deliberately does not apply billing
-- state, grant licenses, or connect the receipt to the existing webhook.

create schema billing_ingress;

-- The billing_ingress schema is intentionally outside the client-facing API surface.
revoke all on schema billing_ingress from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema billing_ingress from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema billing_ingress from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on schema billing_ingress from service_role';
  end if;
end
$$;

create table billing_ingress.stripe_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  livemode boolean not null,
  event_type text not null,
  object_type text,
  object_id text,
  api_version text,
  normalized_schema_version integer not null,
  normalized_payload jsonb not null,
  normalized_payload_sha256 text not null,
  raw_payload_sha256 text not null,
  status text not null default 'received',
  delivery_count integer not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  terminal_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_receipts_event_id_check
    check (length(btrim(stripe_event_id)) > 0),
  constraint stripe_webhook_receipts_event_type_check
    check (length(btrim(event_type)) > 0),
  constraint stripe_webhook_receipts_schema_version_check
    check (normalized_schema_version > 0),
  constraint stripe_webhook_receipts_payload_object_check
    check (jsonb_typeof(normalized_payload) = 'object'),
  constraint stripe_webhook_receipts_normalized_hash_check
    check (normalized_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint stripe_webhook_receipts_raw_hash_check
    check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint stripe_webhook_receipts_status_check
    check (status in ('received', 'processing', 'retryable', 'applied', 'ignored', 'dead_letter')),
  constraint stripe_webhook_receipts_delivery_count_check
    check (delivery_count > 0),
  constraint stripe_webhook_receipts_terminal_at_check
    check ((status in ('applied', 'ignored', 'dead_letter')) = (terminal_at is not null)),
  constraint stripe_webhook_receipts_event_key_unique
    unique (livemode, stripe_event_id),
  constraint stripe_webhook_receipts_binding_unique
    unique (id, livemode, stripe_event_id)
);

comment on table billing_ingress.stripe_webhook_receipts is
  'Authenticated Stripe event receipts and replayable normalized snapshots; service-only.';
comment on column billing_ingress.stripe_webhook_receipts.normalized_payload is
  'Versioned, redacted normalized snapshot retained for deterministic replay; no raw body is required here.';
comment on column billing_ingress.stripe_webhook_receipts.normalized_payload_sha256 is
  'SHA-256 supplied by the trusted ingress over the canonical normalized snapshot.';
comment on column billing_ingress.stripe_webhook_receipts.raw_payload_sha256 is
  'SHA-256 of the verified raw request body; the raw body is not stored by this foundation.';
comment on column billing_ingress.stripe_webhook_receipts.livemode is
  'Stripe live/test mode boundary; event IDs are unique within, and never conflated across, modes.';

create table billing_ingress.stripe_webhook_dispatches (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  stripe_event_id text not null,
  livemode boolean not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_token uuid,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_dispatches_receipt_event_fk
    foreign key (receipt_id, livemode, stripe_event_id)
    references billing_ingress.stripe_webhook_receipts (id, livemode, stripe_event_id)
    on delete cascade,
  constraint stripe_webhook_dispatches_event_id_check
    check (length(btrim(stripe_event_id)) > 0),
  constraint stripe_webhook_dispatches_status_check
    check (status in ('pending', 'processing', 'retryable', 'completed', 'dead_letter')),
  constraint stripe_webhook_dispatches_attempt_count_check
    check (attempt_count >= 0),
  constraint stripe_webhook_dispatches_completed_at_check
    check ((status = 'completed') = (completed_at is not null)),
  constraint stripe_webhook_dispatches_receipt_unique
    unique (receipt_id),
  constraint stripe_webhook_dispatches_event_key_unique
    unique (livemode, stripe_event_id)
);

comment on table billing_ingress.stripe_webhook_dispatches is
  'Durable internal dispatch queue paired one-to-one with a Stripe receipt.';

create index stripe_webhook_receipts_status_idx
  on billing_ingress.stripe_webhook_receipts (status, last_received_at);

create index stripe_webhook_dispatches_ready_idx
  on billing_ingress.stripe_webhook_dispatches (status, available_at)
  where status in ('pending', 'retryable');

alter table billing_ingress.stripe_webhook_receipts enable row level security;
alter table billing_ingress.stripe_webhook_dispatches enable row level security;

-- No client policy is created. The only access path introduced here is the
-- narrowly scoped SECURITY DEFINER RPC below, granted to service_role only.
revoke all on table billing_ingress.stripe_webhook_receipts from public;
revoke all on table billing_ingress.stripe_webhook_dispatches from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table billing_ingress.stripe_webhook_receipts from anon';
    execute 'revoke all on table billing_ingress.stripe_webhook_dispatches from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table billing_ingress.stripe_webhook_receipts from authenticated';
    execute 'revoke all on table billing_ingress.stripe_webhook_dispatches from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table billing_ingress.stripe_webhook_receipts from service_role';
    execute 'revoke all on table billing_ingress.stripe_webhook_dispatches from service_role';
  end if;
end
$$;

create or replace function public.accept_stripe_webhook_receipt(
  p_stripe_event_id text,
  p_livemode boolean,
  p_event_type text,
  p_object_type text,
  p_object_id text,
  p_api_version text,
  p_normalized_schema_version integer,
  p_normalized_payload jsonb,
  p_normalized_payload_sha256 text,
  p_raw_payload_sha256 text
)
returns table (
  receipt_id uuid,
  dispatch_id uuid,
  outcome text,
  receipt_status text,
  dispatch_status text,
  delivery_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
declare
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_inserted boolean := false;
  v_request_role text;
  v_repair_status text;
  v_repair_completed_at timestamptz;
begin
  -- The EXECUTE ACL is the primary client boundary. The request claim and
  -- auth.role() check is defense in depth for the Supabase request context;
  -- an arbitrary SQL caller can set a custom GUC and must not be treated as
  -- authenticated by that GUC alone.
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe receipt ingress'
      using errcode = '42501';
  end if;

  if p_stripe_event_id is null or length(btrim(p_stripe_event_id)) = 0 then
    raise exception 'Stripe event ID is required' using errcode = '22023';
  end if;
  if p_event_type is null or length(btrim(p_event_type)) = 0 then
    raise exception 'Stripe event type is required' using errcode = '22023';
  end if;
  if p_normalized_schema_version is null or p_normalized_schema_version <= 0 then
    raise exception 'normalized schema version must be positive' using errcode = '22023';
  end if;
  if p_normalized_payload is null then
    raise exception 'normalized payload is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_normalized_payload) is distinct from 'object' then
    raise exception 'normalized payload must be a JSON object'
      using errcode = '22023';
  end if;
  if p_normalized_payload_sha256 is null
     or p_normalized_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'normalized payload SHA-256 must be 64 lowercase hex characters'
      using errcode = '22023';
  end if;
  if p_raw_payload_sha256 is null
     or p_raw_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'raw payload SHA-256 must be 64 lowercase hex characters'
      using errcode = '22023';
  end if;

  insert into billing_ingress.stripe_webhook_receipts (
    stripe_event_id,
    livemode,
    event_type,
    object_type,
    object_id,
    api_version,
    normalized_schema_version,
    normalized_payload,
    normalized_payload_sha256,
    raw_payload_sha256
  ) values (
    btrim(p_stripe_event_id),
    p_livemode,
    btrim(p_event_type),
    nullif(btrim(p_object_type), ''),
    nullif(btrim(p_object_id), ''),
    nullif(btrim(p_api_version), ''),
    p_normalized_schema_version,
    p_normalized_payload,
    p_normalized_payload_sha256,
    p_raw_payload_sha256
  )
  on conflict (livemode, stripe_event_id) do nothing
  returning * into v_receipt;

  if found then
    v_inserted := true;
  else
    select *
      into v_receipt
      from billing_ingress.stripe_webhook_receipts
     where livemode = p_livemode
       and stripe_event_id = btrim(p_stripe_event_id)
     for update;

    if v_receipt.event_type is distinct from btrim(p_event_type)
       or v_receipt.object_type is distinct from nullif(btrim(p_object_type), '')
       or v_receipt.object_id is distinct from nullif(btrim(p_object_id), '')
       or v_receipt.api_version is distinct from nullif(btrim(p_api_version), '')
       or v_receipt.normalized_schema_version is distinct from p_normalized_schema_version
       or v_receipt.normalized_payload is distinct from p_normalized_payload
       or v_receipt.normalized_payload_sha256 is distinct from p_normalized_payload_sha256
       or v_receipt.raw_payload_sha256 is distinct from p_raw_payload_sha256 then
      raise exception 'Stripe receipt conflicts with immutable event data for %/%',
        case when p_livemode then 'live' else 'test' end,
        btrim(p_stripe_event_id)
        using errcode = 'P0001',
              detail = 'The existing receipt was left unchanged; reconcile the verified event payload.';
    end if;

    update billing_ingress.stripe_webhook_receipts as r
       set delivery_count = r.delivery_count + 1,
           last_received_at = now(),
           updated_at = now()
     where r.id = v_receipt.id
     returning r.* into v_receipt;
  end if;

  if v_inserted then
    insert into billing_ingress.stripe_webhook_dispatches (
      receipt_id,
      stripe_event_id,
      livemode
    ) values (
      v_receipt.id,
      v_receipt.stripe_event_id,
      v_receipt.livemode
    )
    returning * into v_dispatch;

    receipt_id := v_receipt.id;
    dispatch_id := v_dispatch.id;
    outcome := 'accepted';
  else
    select *
      into v_dispatch
      from billing_ingress.stripe_webhook_dispatches as d
     where d.receipt_id = v_receipt.id;

    if not found then
      v_repair_status := case
        when v_receipt.status in ('applied', 'ignored') then 'completed'
        when v_receipt.status = 'dead_letter' then 'dead_letter'
        else 'pending'
      end;
      v_repair_completed_at := case
        when v_repair_status = 'completed' then coalesce(v_receipt.terminal_at, now())
        else null
      end;

      insert into billing_ingress.stripe_webhook_dispatches (
        receipt_id,
        stripe_event_id,
        livemode,
        status,
        completed_at
      ) values (
        v_receipt.id,
        v_receipt.stripe_event_id,
        v_receipt.livemode,
        v_repair_status,
        v_repair_completed_at
      )
      on conflict on constraint stripe_webhook_dispatches_receipt_unique do nothing;
    elsif v_receipt.status not in ('applied', 'ignored', 'dead_letter')
      and v_dispatch.status in ('completed', 'dead_letter') then
      raise exception 'nonterminal Stripe receipt has terminal dispatch; reconciliation required for %',
        v_receipt.id
        using errcode = 'P0001',
              detail = 'The active dispatch was not reclaimed or overwritten.';
    end if;

    select *
      into v_dispatch
      from billing_ingress.stripe_webhook_dispatches as d
     where d.receipt_id = v_receipt.id;

    receipt_id := v_receipt.id;
    dispatch_id := v_dispatch.id;
    receipt_status := v_receipt.status;
    dispatch_status := v_dispatch.status;
    delivery_count := v_receipt.delivery_count;
    outcome := case
      when v_receipt.status in ('applied', 'ignored', 'dead_letter')
        then 'duplicate_terminal'
      else 'duplicate_nonterminal'
    end;
    return next;
    return;
  end if;

  receipt_status := v_receipt.status;
  dispatch_status := v_dispatch.status;
  delivery_count := v_receipt.delivery_count;
  return next;
end;
$$;

comment on function public.accept_stripe_webhook_receipt(
  text, boolean, text, text, text, text, integer, jsonb, text, text
) is
  'Service-role-only atomic insert of an immutable Stripe receipt and one durable dispatch row.';

revoke all on function public.accept_stripe_webhook_receipt(
  text, boolean, text, text, text, text, integer, jsonb, text, text
) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.accept_stripe_webhook_receipt(text, boolean, text, text, text, text, integer, jsonb, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.accept_stripe_webhook_receipt(text, boolean, text, text, text, text, integer, jsonb, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.accept_stripe_webhook_receipt(text, boolean, text, text, text, text, integer, jsonb, text, text) to service_role';
  end if;
end
$$;

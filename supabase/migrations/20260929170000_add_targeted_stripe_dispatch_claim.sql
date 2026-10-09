-- Claim one exact receipt dispatch from its signed webhook request. This lets
-- synchronous Edge Function processing avoid claiming unrelated queue items.
create or replace function public.claim_stripe_webhook_dispatch_by_id(
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_seconds integer default 300
)
returns table (
  receipt_id uuid,
  dispatch_id uuid,
  stripe_event_id text,
  livemode boolean,
  event_type text,
  object_type text,
  object_id text,
  api_version text,
  normalized_schema_version integer,
  normalized_payload jsonb,
  normalized_payload_sha256 text,
  raw_payload_sha256 text,
  attempt_count integer,
  claim_generation bigint,
  lease_token uuid,
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
  v_now timestamptz;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe dispatch claim'
      using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_livemode is null then
    raise exception 'dispatch identity and livemode are required' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease duration must be between 1 and 3600 seconds'
      using errcode = '22023';
  end if;

  -- Match the established lock order: receipt first, then dispatch.
  select r.* into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
    join billing_ingress.stripe_webhook_dispatches as d
      on d.receipt_id = r.id
     and d.livemode = r.livemode
     and d.stripe_event_id = r.stripe_event_id
   where d.id = p_dispatch_id
     and d.livemode = p_livemode
     and r.status in ('received', 'retryable', 'processing')
   for update of r;
  if not found then
    return;
  end if;

  v_now := clock_timestamp();
  update billing_ingress.stripe_webhook_dispatches as d
     set status = 'processing',
         attempt_count = d.attempt_count + 1,
         claimed_at = v_now,
         lease_until = v_now + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
         claim_generation = d.claim_generation + 1,
         updated_at = v_now
   where d.id = p_dispatch_id
     and d.receipt_id = v_receipt.id
     and d.livemode = p_livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
     and (
       (d.status in ('pending', 'retryable') and d.available_at <= v_now)
       or
       (d.status = 'processing' and d.lease_until is not null and d.lease_until <= v_now)
     )
   returning d.* into v_dispatch;
  if not found then
    return;
  end if;

  update billing_ingress.stripe_webhook_receipts as r
     set status = 'processing',
         updated_at = v_now
   where r.id = v_receipt.id
   returning r.* into v_receipt;
  if not found then
    raise exception 'Stripe receipt disappeared during dispatch claim'
      using errcode = 'P0001';
  end if;

  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  stripe_event_id := v_receipt.stripe_event_id;
  livemode := v_receipt.livemode;
  event_type := v_receipt.event_type;
  object_type := v_receipt.object_type;
  object_id := v_receipt.object_id;
  api_version := v_receipt.api_version;
  normalized_schema_version := v_receipt.normalized_schema_version;
  normalized_payload := v_receipt.normalized_payload;
  normalized_payload_sha256 := v_receipt.normalized_payload_sha256;
  raw_payload_sha256 := v_receipt.raw_payload_sha256;
  attempt_count := v_dispatch.attempt_count;
  claim_generation := v_dispatch.claim_generation;
  lease_token := v_dispatch.lease_token;
  lease_until := v_dispatch.lease_until;
  return next;
end;
$$;

comment on function public.claim_stripe_webhook_dispatch_by_id(uuid, boolean, integer) is
  'Service-role-only lease claim for the exact durable Stripe dispatch returned by one signed webhook delivery.';

revoke all on function public.claim_stripe_webhook_dispatch_by_id(uuid, boolean, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.claim_stripe_webhook_dispatch_by_id(uuid, boolean, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.claim_stripe_webhook_dispatch_by_id(uuid, boolean, integer) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_stripe_webhook_dispatch_by_id(uuid, boolean, integer) to service_role';
  end if;
end
$$;

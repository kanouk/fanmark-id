-- Service-only claim, lease, and retry primitives for the Stripe receipt
-- dispatch queue. This migration does not apply a billing effect or mark a
-- receipt/dispatch applied or completed.

-- The foundation predates lease columns. Do not guess whether an existing
-- processing row is still owned by a worker: require an explicit operator
-- reconciliation before installing the fencing boundary.
do $$
begin
  if exists (
    select 1
      from billing_ingress.stripe_webhook_dispatches
     where status = 'processing'
  ) then
    raise exception 'processing Stripe dispatch rows require lease reconciliation before migration'
      using errcode = 'P0001';
  end if;
end
$$;

alter table billing_ingress.stripe_webhook_dispatches
  add column lease_until timestamptz,
  add column claim_generation bigint not null default 0,
  add constraint stripe_webhook_dispatches_claim_generation_check
    check (claim_generation >= 0),
  add constraint stripe_webhook_dispatches_lease_state_check
    check (
      (
        status = 'processing'
        and claimed_at is not null
        and lease_until is not null
        and lease_token is not null
        and claim_generation > 0
      )
      or
      (
        status <> 'processing'
        and claimed_at is null
        and lease_until is null
        and lease_token is null
      )
    );

comment on column billing_ingress.stripe_webhook_dispatches.lease_until is
  'Authoritative SQL expiry for the current processing lease; null outside processing.';
comment on column billing_ingress.stripe_webhook_dispatches.claim_generation is
  'Monotonically increasing fencing value for every successful claim of this dispatch.';

create index stripe_webhook_dispatches_claim_idx
  on billing_ingress.stripe_webhook_dispatches
    (livemode, status, available_at, lease_until, receipt_id)
  where status in ('pending', 'retryable', 'processing');

-- Claim a bounded batch. The candidate query locks receipts first with
-- SKIP LOCKED. The guarded dispatch update then takes the dispatch lock. This
-- preserves the same receipt-before-dispatch order as receipt acceptance and
-- avoids a claim/ingress lock inversion.
create or replace function public.claim_stripe_webhook_dispatches(
  p_livemode boolean,
  p_batch_size integer default 10,
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
  v_candidate record;
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
  if p_livemode is null then
    raise exception 'livemode is required' using errcode = '22023';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'batch size must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease duration must be between 1 and 3600 seconds'
      using errcode = '22023';
  end if;

  -- Only receipt rows are locked by this candidate query. The dispatch is
  -- locked below by the status/token/due guard after the receipt lock.
  for v_candidate in
    select r.id as receipt_id,
           r.livemode,
           r.stripe_event_id
      from billing_ingress.stripe_webhook_receipts as r
     where r.livemode = p_livemode
       and r.status in ('received', 'retryable', 'processing')
       and exists (
         select 1
           from billing_ingress.stripe_webhook_dispatches as d
          where d.receipt_id = r.id
            and d.livemode = r.livemode
            and d.stripe_event_id = r.stripe_event_id
            and (
              (d.status in ('pending', 'retryable')
               and d.available_at <= clock_timestamp())
              or
              (d.status = 'processing'
               and d.lease_until is not null
               and d.lease_until <= clock_timestamp())
            )
       )
     order by r.last_received_at, r.id
     limit p_batch_size
     for update of r skip locked
  loop
    v_now := clock_timestamp();

    update billing_ingress.stripe_webhook_dispatches as d
       set status = 'processing',
           attempt_count = d.attempt_count + 1,
           claimed_at = v_now,
           lease_until = v_now + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(),
           claim_generation = d.claim_generation + 1,
           updated_at = v_now
     where d.receipt_id = v_candidate.receipt_id
       and d.livemode = v_candidate.livemode
       and d.stripe_event_id = v_candidate.stripe_event_id
       and (
         (d.status in ('pending', 'retryable')
          and d.available_at <= v_now)
         or
         (d.status = 'processing'
          and d.lease_until is not null
          and d.lease_until <= v_now)
       )
     returning d.* into v_dispatch;

    if found then
      update billing_ingress.stripe_webhook_receipts as r
         set status = 'processing',
             updated_at = v_now
       where r.id = v_candidate.receipt_id
       returning r.* into v_receipt;

      if found then
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
      end if;
    end if;
  end loop;
end;
$$;

-- Renew only the current, unexpired owner. The receipt is locked before the
-- guarded dispatch update so stale workers cannot win a lock race.
create or replace function public.renew_stripe_webhook_dispatch_lease(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_seconds integer default 300
)
returns table (
  receipt_id uuid,
  dispatch_id uuid,
  stripe_event_id text,
  livemode boolean,
  receipt_status text,
  dispatch_status text,
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
    raise exception 'service role required for Stripe dispatch renewal'
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
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease duration must be between 1 and 3600 seconds'
      using errcode = '22023';
  end if;

  -- Lock the receipt first; the dispatch is locked only by the guarded update.
  select r.*
    into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
    join billing_ingress.stripe_webhook_dispatches as d
      on d.receipt_id = r.id
     and d.livemode = r.livemode
     and d.stripe_event_id = r.stripe_event_id
   where r.id = p_receipt_id
     and r.livemode = p_livemode
     and r.status = 'processing'
     and d.id = p_dispatch_id
   for update of r;

  if not found then
    return;
  end if;

  v_now := clock_timestamp();
  update billing_ingress.stripe_webhook_dispatches as d
     set lease_until = greatest(
           d.lease_until,
           v_now + make_interval(secs => p_lease_seconds)
         ),
         updated_at = v_now
   where d.id = p_dispatch_id
     and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null
     and d.lease_until > v_now
   returning d.* into v_dispatch;

  if not found then
    return;
  end if;

  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  stripe_event_id := v_receipt.stripe_event_id;
  livemode := v_receipt.livemode;
  receipt_status := v_receipt.status;
  dispatch_status := v_dispatch.status;
  claim_generation := v_dispatch.claim_generation;
  lease_token := v_dispatch.lease_token;
  lease_until := v_dispatch.lease_until;
  return next;
end;
$$;

-- Move the current lease back to retryable without changing the normalized
-- receipt snapshot. This function intentionally has no dead-letter or terminal
-- operation; retry exhaustion policy belongs to the reviewed worker design.
create or replace function public.retry_stripe_webhook_dispatch(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_retry_after_seconds integer default 0,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  receipt_id uuid,
  dispatch_id uuid,
  stripe_event_id text,
  livemode boolean,
  receipt_status text,
  dispatch_status text,
  claim_generation bigint,
  available_at timestamptz,
  attempt_count integer
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
  v_error_code text;
  v_error_message text;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe dispatch retry'
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
  if p_retry_after_seconds is null
     or p_retry_after_seconds < 0
     or p_retry_after_seconds > 86400 then
    raise exception 'retry delay must be between 0 and 86400 seconds'
      using errcode = '22023';
  end if;
  if p_error_code is not null and octet_length(p_error_code) > 128 then
    raise exception 'retry error code is too long' using errcode = '22023';
  end if;
  if p_error_message is not null and octet_length(p_error_message) > 1000 then
    raise exception 'retry error message is too long' using errcode = '22023';
  end if;
  v_error_code := nullif(btrim(p_error_code), '');
  v_error_message := nullif(btrim(p_error_message), '');

  -- Lock the receipt first; the dispatch and receipt updates commit or roll
  -- back together. The lease guard rejects an expired or stale owner.
  select r.*
    into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
    join billing_ingress.stripe_webhook_dispatches as d
      on d.receipt_id = r.id
     and d.livemode = r.livemode
     and d.stripe_event_id = r.stripe_event_id
   where r.id = p_receipt_id
     and r.livemode = p_livemode
     and r.status = 'processing'
     and d.id = p_dispatch_id
   for update of r;

  if not found then
    return;
  end if;

  v_now := clock_timestamp();
  update billing_ingress.stripe_webhook_dispatches as d
     set status = 'retryable',
         available_at = v_now + make_interval(secs => p_retry_after_seconds),
         claimed_at = null,
         lease_until = null,
         lease_token = null,
         last_error_code = v_error_code,
         last_error_message = v_error_message,
         updated_at = v_now
   where d.id = p_dispatch_id
     and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode
     and d.status = 'processing'
     and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null
     and d.lease_until > v_now
   returning d.* into v_dispatch;

  if not found then
    return;
  end if;

  update billing_ingress.stripe_webhook_receipts as r
     set status = 'retryable',
         last_error_code = v_error_code,
         last_error_message = v_error_message,
         updated_at = v_now
   where r.id = p_receipt_id
   returning r.* into v_receipt;

  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  stripe_event_id := v_receipt.stripe_event_id;
  livemode := v_receipt.livemode;
  receipt_status := v_receipt.status;
  dispatch_status := v_dispatch.status;
  claim_generation := v_dispatch.claim_generation;
  available_at := v_dispatch.available_at;
  attempt_count := v_dispatch.attempt_count;
  return next;
end;
$$;

comment on function public.claim_stripe_webhook_dispatches(boolean, integer, integer) is
  'Service-role-only bounded receipt-first claim with SQL-time lease and fencing generation; never completes business work.';
comment on function public.renew_stripe_webhook_dispatch_lease(uuid, uuid, boolean, uuid, bigint, integer) is
  'Service-role-only renewal for the current unexpired dispatch owner; stale tokens return no row.';
comment on function public.retry_stripe_webhook_dispatch(uuid, uuid, boolean, uuid, bigint, integer, text, text) is
  'Service-role-only retry transition that clears the current lease and preserves the receipt snapshot; no dead-letter/finalization.';

revoke all on function public.claim_stripe_webhook_dispatches(boolean, integer, integer) from public;
revoke all on function public.renew_stripe_webhook_dispatch_lease(uuid, uuid, boolean, uuid, bigint, integer) from public;
revoke all on function public.retry_stripe_webhook_dispatch(uuid, uuid, boolean, uuid, bigint, integer, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.claim_stripe_webhook_dispatches(boolean, integer, integer) from anon';
    execute 'revoke all on function public.renew_stripe_webhook_dispatch_lease(uuid, uuid, boolean, uuid, bigint, integer) from anon';
    execute 'revoke all on function public.retry_stripe_webhook_dispatch(uuid, uuid, boolean, uuid, bigint, integer, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.claim_stripe_webhook_dispatches(boolean, integer, integer) from authenticated';
    execute 'revoke all on function public.renew_stripe_webhook_dispatch_lease(uuid, uuid, boolean, uuid, bigint, integer) from authenticated';
    execute 'revoke all on function public.retry_stripe_webhook_dispatch(uuid, uuid, boolean, uuid, bigint, integer, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_stripe_webhook_dispatches(boolean, integer, integer) to service_role';
    execute 'grant execute on function public.renew_stripe_webhook_dispatch_lease(uuid, uuid, boolean, uuid, bigint, integer) to service_role';
    execute 'grant execute on function public.retry_stripe_webhook_dispatch(uuid, uuid, boolean, uuid, bigint, integer, text, text) to service_role';
  end if;
end
$$;

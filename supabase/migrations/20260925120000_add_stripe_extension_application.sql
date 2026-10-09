-- Session-keyed, atomic license-extension application for migration issue #32.
-- This migration is local-only until the Stripe rollout gates are reviewed.

create table billing_ingress.stripe_extension_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null,
  license_id uuid not null,
  fanmark_id uuid not null,
  tier_level smallint not null,
  months smallint not null,
  stripe_price_id text not null,
  currency text not null default 'jpy',
  expected_total_yen bigint not null,
  allow_zero_total boolean not null default false,
  livemode boolean not null,
  stripe_checkout_session_id text,
  stripe_session_status text,
  stripe_payment_status text,
  status text not null default 'created',
  idempotency_safe_until timestamptz not null default (clock_timestamp() + interval '20 hours'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint stripe_extension_checkout_intents_months_check check (months between 1 and 12),
  constraint stripe_extension_checkout_intents_tier_check check (tier_level > 0),
  constraint stripe_extension_checkout_intents_price_check check (length(btrim(stripe_price_id)) > 0),
  constraint stripe_extension_checkout_intents_total_check check (expected_total_yen > 0),
  constraint stripe_extension_checkout_intents_zero_policy_check check (allow_zero_total = false),
  constraint stripe_extension_checkout_intents_currency_check check (currency = 'jpy'),
  constraint stripe_extension_checkout_intents_status_check
    check (status in ('created', 'open', 'awaiting_payment_confirmation', 'applied', 'expired', 'failed', 'blocked_stale_owner', 'reconciliation_required')),
  constraint stripe_extension_checkout_intents_user_request_unique unique (user_id, request_id),
  constraint stripe_extension_checkout_intents_session_unique unique (livemode, stripe_checkout_session_id)
);

comment on table billing_ingress.stripe_extension_checkout_intents is
  'Authenticated extension purchase command recorded before Stripe Checkout creation; retries reuse request_id and the derived Stripe idempotency key.';

alter table billing_ingress.stripe_extension_checkout_intents enable row level security;
revoke all on table billing_ingress.stripe_extension_checkout_intents from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table billing_ingress.stripe_extension_checkout_intents from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table billing_ingress.stripe_extension_checkout_intents from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table billing_ingress.stripe_extension_checkout_intents from service_role';
  end if;
end
$$;

create table billing_ingress.stripe_extension_applications (
  id uuid primary key default gen_random_uuid(),
  billing_intent_id uuid references billing_ingress.stripe_extension_checkout_intents(id),
  livemode boolean not null,
  stripe_checkout_session_id text not null,
  source_receipt_id uuid not null references billing_ingress.stripe_webhook_receipts(id),
  last_receipt_id uuid not null references billing_ingress.stripe_webhook_receipts(id),
  applied_receipt_id uuid references billing_ingress.stripe_webhook_receipts(id),
  user_id uuid not null,
  license_id uuid not null,
  fanmark_id uuid not null,
  tier_level smallint not null,
  months smallint not null,
  expected_total_yen bigint,
  allow_zero_total boolean not null default false,
  status text not null default 'awaiting_payment_confirmation',
  result_code text not null default 'awaiting_payment_confirmation',
  failure_code text,
  previous_license_end timestamptz,
  new_license_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  terminal_at timestamptz,
  constraint stripe_extension_applications_session_check
    check (length(btrim(stripe_checkout_session_id)) > 0),
  constraint stripe_extension_applications_months_check
    check (months between 1 and 12),
  constraint stripe_extension_applications_total_check
    check (expected_total_yen is null or expected_total_yen > 0),
  constraint stripe_extension_applications_zero_policy_check
    check (allow_zero_total = false),
  constraint stripe_extension_applications_status_check
    check (status in ('awaiting_payment_confirmation', 'applied', 'failed', 'expired', 'dead_letter')),
  constraint stripe_extension_applications_terminal_check
    check ((status = 'awaiting_payment_confirmation') = (terminal_at is null)),
  constraint stripe_extension_applications_applied_at_check
    check ((status = 'applied') = (applied_at is not null)),
  constraint stripe_extension_applications_session_unique
    unique (livemode, stripe_checkout_session_id),
  constraint stripe_extension_applications_intent_unique
    unique (billing_intent_id)
);

comment on table billing_ingress.stripe_extension_applications is
  'One durable extension state per Stripe Checkout Session; the Session ID is the effect idempotency key.';

alter table billing_ingress.stripe_extension_applications enable row level security;
revoke all on table billing_ingress.stripe_extension_applications from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table billing_ingress.stripe_extension_applications from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table billing_ingress.stripe_extension_applications from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table billing_ingress.stripe_extension_applications from service_role';
  end if;
end
$$;

create or replace function public.begin_stripe_extension_checkout_intent(
  p_request_id uuid,
  p_user_id uuid,
  p_license_id uuid,
  p_months smallint,
  p_tier_level smallint,
  p_stripe_price_id text,
  p_expected_total_yen bigint,
  p_livemode boolean
)
returns table (
  intent_id uuid,
  stripe_checkout_session_id text,
  intent_status text,
  can_create_session boolean,
  intent_price_id text,
  intent_expected_total_yen bigint
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress, public, auth
as $$
declare
  v_role text;
  v_fanmark_id uuid;
  v_current_tier smallint;
  v_intent billing_ingress.stripe_extension_checkout_intents%rowtype;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role());
  if coalesce(v_role, '') <> 'service_role' then
    raise exception 'service role required for extension checkout intent' using errcode = '42501';
  end if;
  if p_request_id is null or p_user_id is null or p_license_id is null
     or p_months is null or p_months < 1 or p_months > 12
     or p_tier_level is null or p_tier_level < 1
     or ((p_stripe_price_id is null) <> (p_expected_total_yen is null))
     or (p_stripe_price_id is not null and length(btrim(p_stripe_price_id)) = 0)
     or (p_expected_total_yen is not null and p_expected_total_yen <= 0)
     or p_livemode is null then
    raise exception 'invalid extension checkout intent input' using errcode = '22023';
  end if;

  select l.fanmark_id, f.tier_level
    into v_fanmark_id, v_current_tier
    from public.fanmark_licenses as l
    join public.fanmarks as f on f.id = l.fanmark_id
   where l.id = p_license_id
     and l.user_id = p_user_id
     and l.status in ('active', 'grace')
     and l.license_end is not null
     and not l.is_returned
     and not l.is_transferred
     and (l.transfer_locked_until is null or l.transfer_locked_until <= clock_timestamp())
     and not exists (
       select 1 from public.fanmark_transfer_requests as tr
        where tr.license_id = l.id and tr.status in ('pending', 'approved')
     )
   for update of l;
  if not found then
    raise exception 'license is not eligible for extension checkout' using errcode = '42501';
  end if;
  if v_current_tier is distinct from p_tier_level then
    raise exception 'extension tier changed while starting checkout' using errcode = '22023';
  end if;

  select * into v_intent
    from billing_ingress.stripe_extension_checkout_intents as i
   where i.user_id = p_user_id and i.request_id = p_request_id
   for update;
  if found then
    if v_intent.license_id is distinct from p_license_id
       or v_intent.fanmark_id is distinct from v_fanmark_id
       or v_intent.tier_level is distinct from p_tier_level
       or v_intent.months is distinct from p_months
       or v_intent.livemode is distinct from p_livemode then
      raise exception 'extension checkout request ID was reused with different terms' using errcode = '22023';
    end if;
    if v_intent.stripe_checkout_session_id is null
       and v_intent.status = 'created'
       and v_intent.idempotency_safe_until <= clock_timestamp() then
      update billing_ingress.stripe_extension_checkout_intents as i
         set status = 'reconciliation_required', updated_at = clock_timestamp()
       where i.id = v_intent.id;
      v_intent.status := 'reconciliation_required';
    end if;
    return query select v_intent.id, v_intent.stripe_checkout_session_id, v_intent.status,
      (v_intent.stripe_checkout_session_id is null
        and v_intent.status = 'created'
        and v_intent.idempotency_safe_until > clock_timestamp()),
      v_intent.stripe_price_id, v_intent.expected_total_yen;
    return;
  end if;

  if p_stripe_price_id is null or p_expected_total_yen is null then
    return;
  end if;

  insert into billing_ingress.stripe_extension_checkout_intents (
    request_id, user_id, license_id, fanmark_id, tier_level, months,
    stripe_price_id, expected_total_yen, livemode
  ) values (
    p_request_id, p_user_id, p_license_id, v_fanmark_id, p_tier_level, p_months,
    p_stripe_price_id, p_expected_total_yen, p_livemode
  ) on conflict (user_id, request_id) do nothing;

  select * into v_intent
    from billing_ingress.stripe_extension_checkout_intents as i
   where i.user_id = p_user_id and i.request_id = p_request_id
   for update;
  if not found then
    raise exception 'extension checkout intent could not be read back' using errcode = 'P0002';
  end if;
  if v_intent.license_id is distinct from p_license_id
     or v_intent.fanmark_id is distinct from v_fanmark_id
     or v_intent.tier_level is distinct from p_tier_level
     or v_intent.months is distinct from p_months
     or v_intent.livemode is distinct from p_livemode then
    raise exception 'extension checkout request ID was reused with different terms' using errcode = '22023';
  end if;

  if v_intent.stripe_checkout_session_id is null
     and v_intent.status = 'created'
     and v_intent.idempotency_safe_until <= clock_timestamp() then
    update billing_ingress.stripe_extension_checkout_intents as i
       set status = 'reconciliation_required', updated_at = clock_timestamp()
     where i.id = v_intent.id;
    v_intent.status := 'reconciliation_required';
  end if;

  return query select v_intent.id, v_intent.stripe_checkout_session_id, v_intent.status,
    (v_intent.stripe_checkout_session_id is null
      and v_intent.status = 'created'
      and v_intent.idempotency_safe_until > clock_timestamp()),
    v_intent.stripe_price_id, v_intent.expected_total_yen;
end;
$$;

create or replace function public.attach_stripe_extension_checkout_session(
  p_intent_id uuid,
  p_stripe_checkout_session_id text
)
returns table (intent_status text, stripe_checkout_session_id text)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress, auth
as $$
declare
  v_role text;
  v_intent billing_ingress.stripe_extension_checkout_intents%rowtype;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role());
  if coalesce(v_role, '') <> 'service_role' then
    raise exception 'service role required for extension Checkout Session binding' using errcode = '42501';
  end if;
  if p_intent_id is null or p_stripe_checkout_session_id is null
     or length(btrim(p_stripe_checkout_session_id)) = 0 then
    raise exception 'invalid extension Checkout Session binding' using errcode = '22023';
  end if;

  select * into v_intent
    from billing_ingress.stripe_extension_checkout_intents as i
   where i.id = p_intent_id
   for update;
  if not found then
    raise exception 'extension checkout intent not found' using errcode = 'P0002';
  end if;
  if v_intent.stripe_checkout_session_id is not null
     and v_intent.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    raise exception 'extension checkout intent is already bound to another Session' using errcode = '23505';
  end if;

  update billing_ingress.stripe_extension_checkout_intents as i
     set stripe_checkout_session_id = p_stripe_checkout_session_id,
         status = case when i.status = 'created' then 'open' else i.status end,
         updated_at = clock_timestamp()
   where i.id = p_intent_id;
  return query select i.status, i.stripe_checkout_session_id
    from billing_ingress.stripe_extension_checkout_intents as i where i.id = p_intent_id;
end;
$$;

revoke all on function public.begin_stripe_extension_checkout_intent(uuid, uuid, uuid, smallint, smallint, text, bigint, boolean) from public;
revoke all on function public.attach_stripe_extension_checkout_session(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.begin_stripe_extension_checkout_intent(uuid, uuid, uuid, smallint, smallint, text, bigint, boolean) from anon';
    execute 'revoke all on function public.attach_stripe_extension_checkout_session(uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.begin_stripe_extension_checkout_intent(uuid, uuid, uuid, smallint, smallint, text, bigint, boolean) from authenticated';
    execute 'revoke all on function public.attach_stripe_extension_checkout_session(uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.begin_stripe_extension_checkout_intent(uuid, uuid, uuid, smallint, smallint, text, bigint, boolean) to service_role';
    execute 'grant execute on function public.attach_stripe_extension_checkout_session(uuid, text) to service_role';
  end if;
end
$$;

create or replace function billing_ingress._sync_stripe_extension_intent_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
begin
  if new.billing_intent_id is null then return new; end if;
  update billing_ingress.stripe_extension_checkout_intents as i
     set status = case new.status
       when 'applied' then 'applied'
       when 'expired' then 'expired'
       when 'failed' then 'failed'
       when 'dead_letter' then 'blocked_stale_owner'
       else 'awaiting_payment_confirmation'
     end,
     updated_at = clock_timestamp()
   where i.id = new.billing_intent_id
     and i.status not in ('applied', 'blocked_stale_owner');
  return new;
end;
$$;

create trigger stripe_extension_application_sync_intent
after insert or update of status on billing_ingress.stripe_extension_applications
for each row execute function billing_ingress._sync_stripe_extension_intent_status();

revoke all on function billing_ingress._sync_stripe_extension_intent_status() from public;

create or replace function billing_ingress._finish_stripe_extension_receipt(
  p_receipt_id uuid,
  p_receipt_status text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
declare
  v_dispatch_status text;
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  if p_receipt_status not in ('applied', 'ignored', 'dead_letter') then
    raise exception 'invalid Stripe extension receipt terminal state'
      using errcode = '22023';
  end if;

  v_dispatch_status := case when p_receipt_status = 'dead_letter' then 'dead_letter' else 'completed' end;

  update billing_ingress.stripe_webhook_receipts
     set status = p_receipt_status,
         terminal_at = v_now,
         last_error_code = p_error_code,
         last_error_message = null,
         updated_at = v_now
   where id = p_receipt_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Stripe extension receipt disappeared during finalization'
      using errcode = 'P0002';
  end if;

  update billing_ingress.stripe_webhook_dispatches
     set status = v_dispatch_status,
         completed_at = case when v_dispatch_status = 'completed' then v_now else null end,
         claimed_at = null,
         lease_until = null,
         lease_token = null,
         last_error_code = p_error_code,
         last_error_message = null,
         updated_at = v_now
   where receipt_id = p_receipt_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Stripe extension dispatch disappeared during finalization'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function billing_ingress._dead_letter_stripe_extension(
  p_receipt_id uuid,
  p_application_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress
as $$
begin
  if p_application_id is not null then
    update billing_ingress.stripe_extension_applications
       set status = 'dead_letter',
           result_code = p_failure_code,
           failure_code = p_failure_code,
           applied_at = null,
           terminal_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = p_application_id
       and status <> 'applied';
  end if;
  perform billing_ingress._finish_stripe_extension_receipt(
    p_receipt_id,
    'dead_letter',
    p_failure_code
  );
end;
$$;

revoke all on function billing_ingress._finish_stripe_extension_receipt(uuid, text, text) from public;
revoke all on function billing_ingress._dead_letter_stripe_extension(uuid, uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function billing_ingress._finish_stripe_extension_receipt(uuid, text, text) from anon';
    execute 'revoke all on function billing_ingress._dead_letter_stripe_extension(uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function billing_ingress._finish_stripe_extension_receipt(uuid, text, text) from authenticated';
    execute 'revoke all on function billing_ingress._dead_letter_stripe_extension(uuid, uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function billing_ingress._finish_stripe_extension_receipt(uuid, text, text) from service_role';
    execute 'revoke all on function billing_ingress._dead_letter_stripe_extension(uuid, uuid, text) from service_role';
  end if;
end
$$;

create or replace function public.apply_stripe_extension_receipt(p_receipt_id uuid)
returns table (
  receipt_id uuid,
  outcome text,
  receipt_status text,
  dispatch_status text,
  application_id uuid,
  license_end timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress, public
as $$
declare
  v_request_role text;
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_application billing_ingress.stripe_extension_applications%rowtype;
  v_session jsonb;
  v_metadata jsonb;
  v_session_id text;
  v_user_id uuid;
  v_license_id uuid;
  v_fanmark_id uuid;
  v_tier_level smallint;
  v_months smallint;
  v_expected_total bigint;
  v_expected_total_text text;
  v_allow_zero text;
  v_billing_intent_id uuid;
  v_billing_intent_text text;
  v_price_id text;
  v_intent billing_ingress.stripe_extension_checkout_intents%rowtype;
  v_payment_status text;
  v_session_status text;
  v_mode text;
  v_currency text;
  v_amount_total numeric;
  v_now timestamptz := clock_timestamp();
  v_license public.fanmark_licenses%rowtype;
  v_fanmark public.fanmarks%rowtype;
  v_lottery_entry public.fanmark_lottery_entries%rowtype;
  v_base_end timestamptz;
  v_extended_end timestamptz;
  v_utc_midnight timestamp without time zone;
  v_new_end timestamptz;
  v_existing_audit record;
  v_rows integer;
  v_cancelled_count integer := 0;
  v_outcome text;
  v_receipt_status text;
  v_dispatch_status text;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe extension application'
      using errcode = '42501';
  end if;
  if p_receipt_id is null then
    raise exception 'Stripe receipt ID is required' using errcode = '22023';
  end if;

  select * into v_receipt
    from billing_ingress.stripe_webhook_receipts
   where id = p_receipt_id
   for update;
  if not found then
    raise exception 'Stripe receipt not found' using errcode = 'P0002';
  end if;

  select d.* into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.receipt_id = v_receipt.id
     and d.livemode = v_receipt.livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
   for update;
  if not found then
    raise exception 'Stripe receipt dispatch not found' using errcode = 'P0002';
  end if;

  if v_receipt.status in ('applied', 'ignored', 'dead_letter') then
    if (v_receipt.status in ('applied', 'ignored') and v_dispatch.status = 'completed')
       or (v_receipt.status = 'dead_letter' and v_dispatch.status = 'dead_letter') then
      return query select v_receipt.id, 'duplicate_terminal'::text,
                          v_receipt.status, v_dispatch.status,
                          null::uuid, null::timestamptz;
      return;
    end if;
    raise exception 'Stripe receipt and dispatch terminal states conflict'
      using errcode = 'P0001';
  end if;

  if v_receipt.status not in ('received', 'retryable')
     or v_dispatch.status not in ('pending', 'retryable')
     or v_dispatch.available_at > v_now then
    raise exception 'Stripe receipt is currently leased or not due for application'
      using errcode = '55P03';
  end if;

  v_session := v_receipt.normalized_payload -> 'checkout_session';
  v_metadata := v_session -> 'metadata';
  v_session_id := v_session ->> 'id';
  if v_session is null
     or jsonb_typeof(v_session) is distinct from 'object'
     or v_session_id is null
     or v_session_id is distinct from v_receipt.object_id
     or coalesce(v_metadata ->> 'type', '') <> 'license_extension' then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, 'extension_session_metadata_invalid'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        null::uuid, null::timestamptz;
    return;
  end if;

  if coalesce(v_metadata ->> 'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(v_metadata ->> 'license_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(v_metadata ->> 'fanmark_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(v_metadata ->> 'tier_level', '') !~ '^[1-9][0-9]{0,3}$'
     or coalesce(v_metadata ->> 'months', '') !~ '^[1-9][0-9]?$' then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, 'extension_target_metadata_invalid'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        null::uuid, null::timestamptz;
    return;
  end if;

  v_user_id := (v_metadata ->> 'user_id')::uuid;
  v_license_id := (v_metadata ->> 'license_id')::uuid;
  v_fanmark_id := (v_metadata ->> 'fanmark_id')::uuid;
  v_tier_level := (v_metadata ->> 'tier_level')::smallint;
  v_months := (v_metadata ->> 'months')::smallint;
  if v_months < 1 or v_months > 12 or v_tier_level < 1 then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, 'extension_plan_metadata_out_of_range'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        null::uuid, null::timestamptz;
    return;
  end if;

  v_expected_total_text := v_metadata ->> 'expected_total_yen';
  v_allow_zero := v_metadata ->> 'allow_zero_total';
  v_billing_intent_text := v_metadata ->> 'billing_intent_id';
  v_price_id := v_metadata ->> 'price_id';
  if v_billing_intent_text is not null then
    if v_billing_intent_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_price_id is null or length(btrim(v_price_id)) = 0 then
      perform billing_ingress._dead_letter_stripe_extension(
        v_receipt.id, null, 'extension_intent_metadata_invalid'
      );
      return query select v_receipt.id, 'dead_letter'::text,
                          'dead_letter'::text, 'dead_letter'::text,
                          null::uuid, null::timestamptz;
      return;
    end if;
    v_billing_intent_id := v_billing_intent_text::uuid;
  elsif v_price_id is not null then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, 'extension_intent_metadata_incomplete'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        null::uuid, null::timestamptz;
    return;
  end if;
  if (v_expected_total_text is null) <> (v_allow_zero is null) then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, 'extension_price_metadata_incomplete'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        null::uuid, null::timestamptz;
    return;
  end if;
  if v_expected_total_text is not null then
    if v_expected_total_text !~ '^[1-9][0-9]{0,15}$'
       or v_allow_zero is distinct from 'false' then
      perform billing_ingress._dead_letter_stripe_extension(
        v_receipt.id, null, 'extension_price_metadata_invalid'
      );
      return query select v_receipt.id, 'dead_letter'::text,
                          'dead_letter'::text, 'dead_letter'::text,
                          null::uuid, null::timestamptz;
      return;
    end if;
    v_expected_total := v_expected_total_text::bigint;
  end if;

  v_mode := v_session ->> 'mode';
  v_session_status := v_session ->> 'status';
  v_payment_status := v_session ->> 'payment_status';
  v_currency := lower(coalesce(v_session ->> 'currency', ''));
  if jsonb_typeof(v_session -> 'amount_total') = 'number'
     and (v_session ->> 'amount_total') ~ '^[0-9]+$' then
    v_amount_total := (v_session ->> 'amount_total')::numeric;
  else
    v_amount_total := null;
  end if;

  if v_billing_intent_id is not null then
    select * into v_intent
      from billing_ingress.stripe_extension_checkout_intents as i
     where i.id = v_billing_intent_id
     for update;
    if not found
       or v_intent.user_id is distinct from v_user_id
       or v_intent.license_id is distinct from v_license_id
       or v_intent.fanmark_id is distinct from v_fanmark_id
       or v_intent.tier_level is distinct from v_tier_level
       or v_intent.months is distinct from v_months
       or v_intent.stripe_price_id is distinct from v_price_id
       or v_intent.expected_total_yen is distinct from v_expected_total
       or v_intent.livemode is distinct from v_receipt.livemode
       or v_intent.allow_zero_total is distinct from false
       or v_intent.status in ('expired', 'failed', 'blocked_stale_owner', 'reconciliation_required')
       or (v_intent.stripe_checkout_session_id is not null
           and v_intent.stripe_checkout_session_id is distinct from v_session_id) then
      perform billing_ingress._dead_letter_stripe_extension(
        v_receipt.id, null, 'extension_intent_conflict'
      );
      return query select v_receipt.id, 'dead_letter'::text,
                          'dead_letter'::text, 'dead_letter'::text,
                          null::uuid, null::timestamptz;
      return;
    end if;

    if exists (
      select 1 from billing_ingress.stripe_extension_checkout_intents as other_intent
       where other_intent.livemode = v_receipt.livemode
         and other_intent.stripe_checkout_session_id = v_session_id
         and other_intent.id <> v_billing_intent_id
    ) then
      update billing_ingress.stripe_extension_checkout_intents
         set status = 'blocked_stale_owner', updated_at = v_now
       where id = v_billing_intent_id and status <> 'applied';
      perform billing_ingress._dead_letter_stripe_extension(
        v_receipt.id, null, 'extension_session_bound_to_other_intent'
      );
      return query select v_receipt.id, 'dead_letter'::text,
                          'dead_letter'::text, 'dead_letter'::text,
                          null::uuid, null::timestamptz;
      return;
    end if;

    update billing_ingress.stripe_extension_checkout_intents
       set stripe_checkout_session_id = coalesce(stripe_checkout_session_id, v_session_id),
           stripe_session_status = v_session_status,
           stripe_payment_status = v_payment_status,
           status = case when status in ('applied', 'blocked_stale_owner') then status else 'open' end,
           updated_at = v_now
     where id = v_billing_intent_id;
  end if;

  insert into billing_ingress.stripe_extension_applications (
    billing_intent_id, livemode, stripe_checkout_session_id, source_receipt_id, last_receipt_id,
    user_id, license_id, fanmark_id, tier_level, months,
    expected_total_yen, allow_zero_total
  ) values (
    v_billing_intent_id, v_receipt.livemode, v_session_id, v_receipt.id, v_receipt.id,
    v_user_id, v_license_id, v_fanmark_id, v_tier_level, v_months,
    v_expected_total, false
  )
  on conflict (livemode, stripe_checkout_session_id) do nothing;

  select * into v_application
    from billing_ingress.stripe_extension_applications
   where livemode = v_receipt.livemode
     and stripe_checkout_session_id = v_session_id
   for update;
  if not found then
    raise exception 'Stripe extension application disappeared'
      using errcode = 'P0002';
  end if;

  if v_application.billing_intent_id is distinct from v_billing_intent_id
     or v_application.user_id is distinct from v_user_id
     or v_application.license_id is distinct from v_license_id
     or v_application.fanmark_id is distinct from v_fanmark_id
     or v_application.tier_level is distinct from v_tier_level
     or v_application.months is distinct from v_months
     or v_application.expected_total_yen is distinct from v_expected_total
     or v_application.allow_zero_total is distinct from false then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_session_metadata_conflict'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, v_application.new_license_end;
    return;
  end if;

  update billing_ingress.stripe_extension_applications
     set last_receipt_id = v_receipt.id,
         updated_at = v_now
   where id = v_application.id;

  if v_application.status = 'applied' then
    perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'applied', null);
    return query select v_receipt.id, 'duplicate_session'::text,
                        'applied'::text, 'completed'::text,
                        v_application.id, v_application.new_license_end;
    return;
  end if;

  if v_application.status = 'dead_letter' then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, null, coalesce(v_application.failure_code, 'extension_application_dead_letter')
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, v_application.new_license_end;
    return;
  end if;

  if v_receipt.event_type = 'checkout.session.async_payment_failed'
     or v_receipt.event_type = 'checkout.session.expired' then
    if (v_receipt.event_type = 'checkout.session.async_payment_failed'
        and (v_mode is distinct from 'payment' or v_session_status is distinct from 'complete'))
       or (v_receipt.event_type = 'checkout.session.expired'
        and (v_mode is distinct from 'payment' or v_session_status is distinct from 'expired')) then
      perform billing_ingress._dead_letter_stripe_extension(
        v_receipt.id, v_application.id, 'extension_checkout_terminal_state_invalid'
      );
      return query select v_receipt.id, 'dead_letter'::text,
                          'dead_letter'::text, 'dead_letter'::text,
                          v_application.id, null::timestamptz;
      return;
    end if;

    if v_application.status = 'awaiting_payment_confirmation' then
      update billing_ingress.stripe_extension_applications
         set status = case when v_receipt.event_type = 'checkout.session.expired' then 'expired' else 'failed' end,
             result_code = case when v_receipt.event_type = 'checkout.session.expired' then 'checkout_expired' else 'async_payment_failed' end,
             failure_code = null,
             terminal_at = v_now,
             updated_at = v_now
       where id = v_application.id;
    end if;
    perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'ignored', null);
    return query select v_receipt.id, 'no_grant'::text,
                        'ignored'::text, 'completed'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_receipt.event_type not in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     ) then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_checkout_event_unsupported'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_mode is distinct from 'payment' or v_session_status is distinct from 'complete' then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_checkout_session_not_complete'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_payment_status = 'unpaid'
     and v_receipt.event_type = 'checkout.session.completed' then
    if v_application.status in ('failed', 'expired') then
      perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'ignored', null);
      return query select v_receipt.id, 'no_grant'::text,
                          'ignored'::text, 'completed'::text,
                          v_application.id, null::timestamptz;
      return;
    end if;
    if v_application.status = 'awaiting_payment_confirmation' then
      perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'ignored', null);
      return query select v_receipt.id, 'awaiting_payment'::text,
                          'ignored'::text, 'completed'::text,
                          v_application.id, null::timestamptz;
      return;
    end if;
  end if;

  if v_application.status in ('failed', 'expired') then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'payment_after_terminal_checkout_state'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_payment_status is distinct from 'paid'
     or v_currency is distinct from 'jpy'
     or v_amount_total is null
     or v_amount_total <= 0
     or (v_expected_total is not null and v_amount_total <> v_expected_total) then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_payment_not_verified'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  select * into v_license
    from public.fanmark_licenses
   where id = v_license_id
   for update;
  if not found then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_license_missing'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_license.user_id is distinct from v_user_id
     or v_license.fanmark_id is distinct from v_fanmark_id then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_stale_owner'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  if v_license.status not in ('active', 'grace')
     or v_license.license_end is null
     or v_license.is_returned
     or v_license.is_transferred
     or (v_license.transfer_locked_until is not null and v_license.transfer_locked_until > v_now)
     or exists (
       select 1
         from public.fanmark_transfer_requests as tr
        where tr.license_id = v_license.id
          and tr.status in ('pending', 'approved')
     ) then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_license_ineligible'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  select * into v_fanmark
    from public.fanmarks
   where id = v_fanmark_id
   for update;
  if not found then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_fanmark_missing'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;
  if v_fanmark.status <> 'active' or v_fanmark.tier_level <> v_tier_level then
    perform billing_ingress._dead_letter_stripe_extension(
      v_receipt.id, v_application.id, 'extension_fanmark_ineligible'
    );
    return query select v_receipt.id, 'dead_letter'::text,
                        'dead_letter'::text, 'dead_letter'::text,
                        v_application.id, null::timestamptz;
    return;
  end if;

  select al.created_at, al.metadata ->> 'new_license_end' as new_license_end
    into v_existing_audit
    from public.audit_logs as al
   where al.action = 'LICENSE_EXTENDED'
     and al.resource_type = 'fanmark_license'
     and al.resource_id = v_license_id::text
     and al.metadata ->> 'payment_session_id' = v_session_id
   order by al.created_at desc
   limit 1;
  if found then
    v_new_end := case
      when v_existing_audit.new_license_end ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then v_existing_audit.new_license_end::timestamptz
      else v_license.license_end
    end;
    update billing_ingress.stripe_extension_applications
       set status = 'applied',
           result_code = 'legacy_audit_reconciled',
           failure_code = null,
           applied_receipt_id = v_receipt.id,
           previous_license_end = v_license.license_end,
           new_license_end = v_new_end,
           applied_at = v_existing_audit.created_at,
           terminal_at = v_now,
           updated_at = v_now
     where id = v_application.id;
    perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'applied', null);
    return query select v_receipt.id, 'legacy_audit_reconciled'::text,
                        'applied'::text, 'completed'::text,
                        v_application.id, v_new_end;
    return;
  end if;

  v_base_end := greatest(v_license.license_end, v_now);
  v_extended_end := ((v_base_end at time zone 'UTC')
    + make_interval(months => v_months::integer)) at time zone 'UTC';
  v_utc_midnight := date_trunc('day', v_extended_end at time zone 'UTC');
  v_new_end := case
    when (v_extended_end at time zone 'UTC') = v_utc_midnight
      then (v_utc_midnight at time zone 'UTC')
    else ((v_utc_midnight + interval '1 day') at time zone 'UTC')
  end;

  update public.fanmark_licenses
     set status = 'active',
         license_end = v_new_end,
         grace_expires_at = null,
         is_returned = false,
         excluded_at = null,
         excluded_from_plan = null,
         updated_at = v_now
   where id = v_license.id
     and user_id = v_user_id
     and fanmark_id = v_fanmark_id
     and status in ('active', 'grace');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'extension license changed after its lock was acquired'
      using errcode = '40001';
  end if;

  for v_lottery_entry in
    select *
      from public.fanmark_lottery_entries
     where fanmark_id = v_fanmark_id
       and entry_status = 'pending'
     for update
  loop
    update public.fanmark_lottery_entries
       set entry_status = 'cancelled_by_extension',
           cancellation_reason = 'license_extended',
           cancelled_at = v_now,
           updated_at = v_now
     where id = v_lottery_entry.id
       and entry_status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_cancelled_count := v_cancelled_count + 1;
      perform public.create_notification_event(
        'lottery_cancelled_by_extension',
        jsonb_build_object(
          'user_id', v_lottery_entry.user_id,
          'fanmark_id', v_fanmark_id,
          'fanmark_name', coalesce(v_license.display_fanmark, ''),
          'extended_by_user_id', v_user_id
        ),
        'edge_function',
        'stripe-extension-lottery:' || v_session_id || ':' || v_lottery_entry.id::text,
        v_now
      );
    end if;
  end loop;

  insert into public.audit_logs (
    user_id, action, resource_type, resource_id, metadata
  ) values (
    v_user_id,
    'LICENSE_EXTENDED',
    'fanmark_license',
    v_license_id::text,
    jsonb_build_object(
      'fanmark_id', v_fanmark_id,
      'months', v_months,
      'payment_session_id', v_session_id,
      'new_license_end', v_new_end,
      'grace_cleared', true,
      'stripe_event_id', v_receipt.stripe_event_id
    )
  );

  if v_cancelled_count > 0 then
    insert into public.audit_logs (
      user_id, action, resource_type, resource_id, metadata
    ) values (
      v_user_id,
      'LICENSE_EXTENDED_LOTTERY_CANCELLED',
      'fanmark_license',
      v_license_id::text,
      jsonb_build_object(
        'fanmark_id', v_fanmark_id,
        'cancelled_entries_count', v_cancelled_count,
        'payment_session_id', v_session_id
      )
    );
  end if;

  update billing_ingress.stripe_extension_applications
     set status = 'applied',
         result_code = 'applied',
         failure_code = null,
         applied_receipt_id = v_receipt.id,
         previous_license_end = v_license.license_end,
         new_license_end = v_new_end,
         applied_at = v_now,
         terminal_at = v_now,
         updated_at = v_now
   where id = v_application.id;

  perform billing_ingress._finish_stripe_extension_receipt(v_receipt.id, 'applied', null);
  return query select v_receipt.id, 'applied'::text,
                      'applied'::text, 'completed'::text,
                      v_application.id, v_new_end;
end;
$$;

revoke all on function public.apply_stripe_extension_receipt(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.apply_stripe_extension_receipt(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.apply_stripe_extension_receipt(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.apply_stripe_extension_receipt(uuid) from service_role';
    execute 'grant execute on function public.apply_stripe_extension_receipt(uuid) to service_role';
  end if;
end
$$;

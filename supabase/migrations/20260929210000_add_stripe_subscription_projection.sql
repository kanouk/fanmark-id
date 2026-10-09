-- Durable, customer-fenced subscription reconciliation for Stripe issue #32.
-- Subscription rows, plan entitlement, Free-limit returns, audit/outbox events,
-- application ledger, fence release, receipt, and dispatch commit together.

create table billing_ingress.stripe_subscription_applications (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  dispatch_id uuid not null,
  stripe_event_id text not null,
  livemode boolean not null,
  effect_key text not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  local_user_id uuid not null,
  fence_generation bigint not null,
  input_hash text not null,
  effective_plan_type text,
  active_subscription_count integer not null,
  status text not null default 'applying',
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint stripe_subscription_applications_receipt_fk
    foreign key (receipt_id, livemode, stripe_event_id)
    references billing_ingress.stripe_webhook_receipts (id, livemode, stripe_event_id)
    on delete cascade,
  constraint stripe_subscription_applications_dispatch_fk
    foreign key (dispatch_id, receipt_id, livemode, stripe_event_id)
    references billing_ingress.stripe_webhook_dispatches (id, receipt_id, livemode, stripe_event_id)
    on delete cascade,
  constraint stripe_subscription_applications_event_check
    check (length(btrim(stripe_event_id)) > 0),
  constraint stripe_subscription_applications_effect_key_check
    check (length(btrim(effect_key)) > 0 and length(effect_key) <= 512),
  constraint stripe_subscription_applications_customer_check
    check (length(btrim(stripe_customer_id)) > 0),
  constraint stripe_subscription_applications_subscription_check
    check (length(btrim(stripe_subscription_id)) > 0),
  constraint stripe_subscription_applications_fence_check
    check (fence_generation > 0),
  constraint stripe_subscription_applications_hash_check
    check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint stripe_subscription_applications_plan_check
    check (effective_plan_type is null or effective_plan_type in ('free', 'creator', 'max', 'business')),
  constraint stripe_subscription_applications_active_count_check
    check (active_subscription_count between 0 and 100),
  constraint stripe_subscription_applications_status_check
    check (status in ('applying', 'applied')),
  constraint stripe_subscription_applications_summary_check
    check (jsonb_typeof(result_summary) = 'object'),
  constraint stripe_subscription_applications_applied_at_check
    check ((status = 'applied') = (applied_at is not null)),
  constraint stripe_subscription_applications_event_unique
    unique (livemode, stripe_event_id),
  constraint stripe_subscription_applications_effect_key_unique
    unique (livemode, effect_key)
);

comment on table billing_ingress.stripe_subscription_applications is
  'One current-state Stripe subscription reconciliation effect per signed event.';
comment on column billing_ingress.stripe_subscription_applications.input_hash is
  'Hash of the authenticated normalized source event; current provider state is summarized separately.';

alter table billing_ingress.stripe_subscription_applications enable row level security;
revoke all on table billing_ingress.stripe_subscription_applications from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table billing_ingress.stripe_subscription_applications from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table billing_ingress.stripe_subscription_applications from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table billing_ingress.stripe_subscription_applications from service_role';
  end if;
end
$$;

create or replace function public.apply_stripe_subscription_projection(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_stripe_customer_id text,
  p_local_user_id uuid,
  p_link_customer boolean,
  p_current_subscription_id text,
  p_subscriptions jsonb,
  p_effective_plan_type text,
  p_fence_token uuid,
  p_fence_generation bigint
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
  effective_plan_type text,
  active_subscription_count integer,
  fence_generation bigint
)
language plpgsql
security definer
set search_path = pg_catalog, billing_ingress, public, auth
as $$
declare
  v_request_role text;
  v_receipt billing_ingress.stripe_webhook_receipts%rowtype;
  v_dispatch billing_ingress.stripe_webhook_dispatches%rowtype;
  v_fence billing_ingress.stripe_sync_fences%rowtype;
  v_application billing_ingress.stripe_subscription_applications%rowtype;
  v_user_settings public.user_settings%rowtype;
  v_now timestamptz;
  v_event_customer_id text;
  v_event_type text;
  v_expected_plan text;
  v_max_rank integer := 0;
  v_active_count integer := 0;
  v_row_count integer;
  v_subscription record;
  v_license record;
  v_active_licenses integer := 0;
  v_free_limit integer := 3;
  v_grace_days integer := 1;
  v_grace_base timestamptz;
  v_grace_expires_at timestamptz;
  v_setting_value text;
  v_effect_key text;
  v_summary jsonb;
  v_returned_count integer := 0;
begin
  v_request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()
  );
  if coalesce(v_request_role, '') <> 'service_role' then
    raise exception 'service role required for Stripe subscription projection'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or p_dispatch_id is null or p_livemode is null
     or p_lease_token is null or p_claim_generation is null or p_claim_generation < 1
     or p_local_user_id is null or p_link_customer is null
     or p_fence_token is null or p_fence_generation is null or p_fence_generation < 1 then
    raise exception 'receipt, dispatch, user, lease, and fence identity are required'
      using errcode = '22023';
  end if;
  if p_stripe_customer_id is null or length(btrim(p_stripe_customer_id)) = 0
     or p_current_subscription_id is null or length(btrim(p_current_subscription_id)) = 0
     or p_subscriptions is null or jsonb_typeof(p_subscriptions) is distinct from 'array'
     or jsonb_array_length(p_subscriptions) < 1 or jsonb_array_length(p_subscriptions) > 101 then
    raise exception 'subscription projection input is invalid or out of bounds'
      using errcode = '22023';
  end if;
  if p_effective_plan_type is not null
     and p_effective_plan_type not in ('free', 'creator', 'max', 'business') then
    raise exception 'subscription entitlement plan is invalid' using errcode = '22023';
  end if;

  -- Lock order mirrors invoice projection: receipt, dispatch, fence, user,
  -- then subscription rows. The remote Stripe reads happened under this fence.
  select r.* into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
   where r.id = p_receipt_id and r.livemode = p_livemode and r.status = 'processing'
   for update;
  if not found then
    raise exception 'subscription receipt is not processing' using errcode = 'P0001';
  end if;
  select d.* into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.id = p_dispatch_id and d.receipt_id = p_receipt_id
     and d.livemode = p_livemode and d.stripe_event_id = v_receipt.stripe_event_id
     and d.status = 'processing' and d.lease_token = p_lease_token
     and d.claim_generation = p_claim_generation
     and d.lease_until is not null and d.lease_until > clock_timestamp()
   for update;
  if not found then
    raise exception 'subscription dispatch lease is stale' using errcode = 'P0001';
  end if;
  v_event_type := v_receipt.event_type;
  if v_event_type not in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ) or v_receipt.object_type <> 'subscription'
    or v_receipt.object_id is distinct from btrim(p_current_subscription_id)
    or v_receipt.normalized_schema_version <> 1
    or v_receipt.normalized_payload->'event'->>'id' is distinct from v_receipt.stripe_event_id
    or v_receipt.normalized_payload->'event'->>'type' is distinct from v_event_type
    or (v_receipt.normalized_payload->'event'->>'livemode')::boolean is distinct from p_livemode
    or v_receipt.normalized_payload->>'branch' is distinct from 'subscription'
    or v_receipt.normalized_payload->'subscription'->>'id' is distinct from btrim(p_current_subscription_id) then
    raise exception 'subscription receipt identity is invalid' using errcode = '22023';
  end if;
  v_event_customer_id := v_receipt.normalized_payload->'subscription'->>'customer_id';
  if v_event_customer_id is null or v_event_customer_id is distinct from btrim(p_stripe_customer_id) then
    raise exception 'subscription receipt customer does not match' using errcode = '22023';
  end if;

  select f.* into v_fence
    from billing_ingress.stripe_sync_fences as f
   where f.livemode = p_livemode and f.stripe_customer_id = btrim(p_stripe_customer_id)
   for update;
  if not found or v_fence.owner_token is distinct from p_fence_token
     or v_fence.generation is distinct from p_fence_generation
     or v_fence.lease_until is null or v_fence.lease_until <= clock_timestamp() then
    raise exception 'subscription customer fence is stale' using errcode = 'P0001';
  end if;

  select us.* into v_user_settings
    from public.user_settings as us
   where us.user_id = p_local_user_id
   for update;
  if not found then
    raise exception 'subscription customer mapping requires review' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.user_settings as other_user
     where other_user.stripe_customer_id = btrim(p_stripe_customer_id)
       and other_user.user_id <> p_local_user_id
  ) then
    raise exception 'subscription customer mapping conflict' using errcode = 'P0002';
  end if;
  if v_user_settings.stripe_customer_id is null then
    if not p_link_customer then
      raise exception 'subscription customer link changed during reconciliation' using errcode = 'P0002';
    end if;
    update public.user_settings
       set stripe_customer_id = btrim(p_stripe_customer_id), updated_at = clock_timestamp()
     where user_id = p_local_user_id and stripe_customer_id is null;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
      raise exception 'subscription customer link was not bound' using errcode = 'P0002';
    end if;
  elsif v_user_settings.stripe_customer_id is distinct from btrim(p_stripe_customer_id) then
    raise exception 'subscription customer mapping conflict' using errcode = 'P0002';
  elsif p_link_customer then
    raise exception 'subscription customer mapping changed during reconciliation' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:' || btrim(p_current_subscription_id), 0));

  if exists (
    select 1 from jsonb_to_recordset(p_subscriptions) as x(
      id text, customer_id text, status text, current_period_start timestamptz,
      current_period_end timestamptz, cancel_at_period_end boolean, product_id text,
      price_id text, amount integer, currency text, recurring_interval text,
      interval_count integer, plan_type text
    ) where x.id is null or length(btrim(x.id)) = 0 or x.customer_id is distinct from btrim(p_stripe_customer_id)
      or x.status is null or x.status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')
      or x.product_id is null or length(btrim(x.product_id)) = 0
      or x.price_id is null or length(btrim(x.price_id)) = 0
      or x.plan_type is null or x.plan_type not in ('creator','max','business')
      or x.current_period_start is null or x.current_period_end is null
      or x.current_period_end < x.current_period_start
      or not exists (
        select 1 from public.system_settings as s
         where s.setting_key = case
           when x.plan_type = 'creator' and p_livemode then 'creator_stripe_price_id_live'
           when x.plan_type = 'creator' then 'creator_stripe_price_id'
           when x.plan_type = 'max' and p_livemode then 'max_stripe_price_id_live'
           when x.plan_type = 'max' then 'max_stripe_price_id'
           when x.plan_type = 'business' and p_livemode then 'business_stripe_price_id_live'
           else 'business_stripe_price_id'
         end
           and s.setting_value = x.price_id and s.is_public = false
      )
      or (select count(*) from public.system_settings as s
           where s.setting_key = case
             when x.plan_type = 'creator' and p_livemode then 'creator_stripe_price_id_live'
             when x.plan_type = 'creator' then 'creator_stripe_price_id'
             when x.plan_type = 'max' and p_livemode then 'max_stripe_price_id_live'
             when x.plan_type = 'max' then 'max_stripe_price_id'
             when x.plan_type = 'business' and p_livemode then 'business_stripe_price_id_live'
             else 'business_stripe_price_id'
           end) <> 1
  ) then
    raise exception 'subscription current-state projection is malformed' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(p_subscriptions) as x(id text))
      <> (select count(distinct x.id) from jsonb_to_recordset(p_subscriptions) as x(id text))
     or not exists (
       select 1 from jsonb_to_recordset(p_subscriptions) as x(id text)
        where x.id = btrim(p_current_subscription_id)
     ) then
    raise exception 'subscription current-state set is duplicated or incomplete' using errcode = '22023';
  end if;
  select count(*) into v_active_count
    from jsonb_to_recordset(p_subscriptions) as x(id text, status text)
   where x.status = 'active';
  if v_active_count > 100 then
    raise exception 'active subscription projection exceeds limit' using errcode = '22023';
  end if;
  select coalesce(max(case x.plan_type when 'creator' then 1 when 'max' then 2 when 'business' then 3 end), 0)
    into v_max_rank
    from jsonb_to_recordset(p_subscriptions) as x(status text, plan_type text)
   where x.status = 'active';
  v_expected_plan := case v_max_rank when 1 then 'creator' when 2 then 'max' when 3 then 'business' else null end;
  if v_event_type = 'customer.subscription.deleted' and v_expected_plan is null then
    v_expected_plan := 'free';
  end if;
  if p_effective_plan_type is distinct from v_expected_plan then
    raise exception 'subscription effective plan does not match current active set' using errcode = '22023';
  end if;

  v_effect_key := 'subscription-reconcile:' || v_receipt.stripe_event_id;
  select a.* into v_application
    from billing_ingress.stripe_subscription_applications as a
   where a.livemode = p_livemode and a.stripe_event_id = v_receipt.stripe_event_id
   for update;
  if found then
    if v_application.status <> 'applied' or v_application.receipt_id <> v_receipt.id then
      raise exception 'subscription application already exists in a nonterminal state' using errcode = 'P0001';
    end if;
    v_now := clock_timestamp();
    update billing_ingress.stripe_sync_fences as f
       set owner_token = null, lease_until = null, last_reconciled_at = v_now,
           last_error_code = null, updated_at = v_now
     where f.livemode = p_livemode and f.stripe_customer_id = btrim(p_stripe_customer_id)
       and f.owner_token = p_fence_token and f.generation = p_fence_generation;
    update billing_ingress.stripe_webhook_dispatches as d
       set status = 'completed', completed_at = v_now, claimed_at = null,
           lease_until = null, lease_token = null, updated_at = v_now
     where d.id = v_dispatch.id;
    update billing_ingress.stripe_webhook_receipts as r
       set status = 'applied', terminal_at = v_now, updated_at = v_now
     where r.id = v_receipt.id;
    application_id := v_application.id;
    receipt_id := v_receipt.id;
    dispatch_id := v_dispatch.id;
    outcome := 'duplicate_applied';
    ledger_status := v_application.status;
    receipt_status := 'applied';
    dispatch_status := 'completed';
    local_user_id := v_application.local_user_id;
    effective_plan_type := v_application.effective_plan_type;
    active_subscription_count := v_application.active_subscription_count;
    fence_generation := v_application.fence_generation;
    return next;
    return;
  end if;

  v_now := clock_timestamp();
  v_summary := jsonb_build_object(
    'event_type', v_event_type,
    'current_subscription_id', btrim(p_current_subscription_id),
    'effective_plan_type', p_effective_plan_type,
    'active_subscription_count', v_active_count
  );
  insert into billing_ingress.stripe_subscription_applications (
    receipt_id, dispatch_id, stripe_event_id, livemode, effect_key,
    stripe_customer_id, stripe_subscription_id, local_user_id, fence_generation,
    input_hash, effective_plan_type, active_subscription_count, status,
    result_summary, created_at, updated_at
  ) values (
    v_receipt.id, v_dispatch.id, v_receipt.stripe_event_id, p_livemode, v_effect_key,
    btrim(p_stripe_customer_id), btrim(p_current_subscription_id), p_local_user_id,
    p_fence_generation, v_receipt.normalized_payload_sha256, p_effective_plan_type,
    v_active_count, 'applying', v_summary, v_now, v_now
  ) returning * into v_application;

  -- A subscription ID must never be re-owned by another local user/customer.
  -- Advisory locking also serializes the case where two customers race before
  -- a legacy database has the global unique index used by the D1 target.
  for v_subscription in
    select x.*
      from jsonb_to_recordset(p_subscriptions) as x(
        id text, customer_id text, status text, current_period_start timestamptz,
        current_period_end timestamptz, cancel_at_period_end boolean, product_id text,
        price_id text, amount integer, currency text, recurring_interval text,
        interval_count integer, plan_type text
      )
     order by x.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:' || v_subscription.id, 0));
    perform 1 from public.user_subscriptions as us
     where us.stripe_subscription_id = v_subscription.id
     for update;
    if exists (
      select 1 from public.user_subscriptions as us
       where us.stripe_subscription_id = v_subscription.id
         and (us.user_id <> p_local_user_id or us.stripe_customer_id <> btrim(p_stripe_customer_id))
    ) then
      raise exception 'subscription row ownership conflict' using errcode = 'P0003';
    end if;
    insert into public.user_subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, product_id, status,
      current_period_start, current_period_end, cancel_at_period_end,
      price_id, amount, currency, interval, interval_count, updated_at
    ) values (
      p_local_user_id, btrim(p_stripe_customer_id), v_subscription.id, v_subscription.product_id,
      v_subscription.status, v_subscription.current_period_start, v_subscription.current_period_end,
      v_subscription.cancel_at_period_end, v_subscription.price_id, v_subscription.amount,
      v_subscription.currency, v_subscription.recurring_interval, v_subscription.interval_count, v_now
    ) on conflict (user_id, stripe_subscription_id) do update set
      stripe_customer_id = excluded.stripe_customer_id,
      product_id = excluded.product_id,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      price_id = excluded.price_id,
      amount = excluded.amount,
      currency = excluded.currency,
      interval = excluded.interval,
      interval_count = excluded.interval_count,
      updated_at = excluded.updated_at;
  end loop;

  if exists (
    select 1 from jsonb_to_recordset(p_subscriptions) as x(id text, status text)
     where x.id = btrim(p_current_subscription_id) and x.status = 'active'
  ) then
    update public.user_subscriptions
       set payment_failure_at = null, next_payment_attempt = null,
           payment_failure_type = null, updated_at = v_now
     where user_id = p_local_user_id and stripe_customer_id = btrim(p_stripe_customer_id)
       and stripe_subscription_id = btrim(p_current_subscription_id);
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
      raise exception 'active subscription failure fields were not cleared' using errcode = 'P0001';
    end if;
  end if;

  if p_effective_plan_type is not null then
    update public.user_settings
       set plan_type = p_effective_plan_type::public.user_plan, updated_at = v_now
     where user_id = p_local_user_id and stripe_customer_id = btrim(p_stripe_customer_id);
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
      raise exception 'subscription plan projection was not applied' using errcode = 'P0001';
    end if;
  end if;

  if v_event_type = 'customer.subscription.deleted' and p_effective_plan_type = 'free' then
    select setting_value into v_setting_value
      from public.system_settings where setting_key = 'free_fanmarks_limit';
    if not found then
      v_free_limit := 3;
    elsif v_setting_value ~ '^[1-9][0-9]{0,5}$' then
      v_free_limit := v_setting_value::integer;
    else
      v_free_limit := 3;
    end if;
    select setting_value into v_setting_value
      from public.system_settings where setting_key = 'grace_period_days';
    if found and v_setting_value ~ '^[1-9][0-9]{0,5}$' then
      v_grace_days := v_setting_value::integer;
    end if;
    select count(*) into v_active_licenses
      from public.fanmark_licenses as l
     where l.user_id = p_local_user_id and l.status = 'active'
       and (l.license_end is null or l.license_end > v_now);
    if v_active_licenses > v_free_limit then
      v_grace_base := v_now + make_interval(days => v_grace_days);
      v_grace_expires_at := case
        when v_grace_base = date_trunc('day', v_grace_base) then v_grace_base
        else date_trunc('day', v_grace_base) + interval '1 day'
      end;
      for v_license in
        select l.id, l.fanmark_id, l.user_id, l.display_fanmark,
               f.user_input_fanmark, f.short_id
          from public.fanmark_licenses as l
          join public.fanmarks as f on f.id = l.fanmark_id
         where l.user_id = p_local_user_id and l.status = 'active'
           and (l.license_end is null or l.license_end > v_now)
         order by l.license_start desc, l.created_at desc, l.id desc
         limit (v_active_licenses - v_free_limit)
         for update of l
      loop
        if exists (
          select 1 from public.fanmark_transfer_codes as tc
           where tc.license_id = v_license.id and tc.status in ('active', 'applied')
        ) then
          raise exception 'Free plan return conflicts with an active transfer' using errcode = 'P0001';
        end if;
        update public.fanmark_licenses
           set status = 'grace', license_end = v_now, grace_expires_at = v_grace_expires_at,
               is_returned = true, excluded_at = null, updated_at = v_now
         where id = v_license.id and user_id = p_local_user_id and status = 'active'
           and (license_end is null or license_end > v_now);
        get diagnostics v_row_count = row_count;
        if v_row_count <> 1 then
          raise exception 'Free plan license return transition failed' using errcode = 'P0001';
        end if;
        v_returned_count := v_returned_count + 1;
        insert into public.audit_logs (
          user_id, action, resource_type, resource_id, request_id, metadata, created_at
        ) values (
          p_local_user_id, 'return_fanmark', 'fanmark', v_license.fanmark_id::text,
          v_application.id::text || ':' || v_license.id::text,
          jsonb_build_object(
            'user_input_fanmark', coalesce(v_license.display_fanmark, ''),
            'returned_at', v_now,
            'grace_expires_at', v_grace_expires_at
          ), v_now
        );
        perform public.create_notification_event(
          'fanmark_returned_owner',
          jsonb_build_object(
            'user_id', p_local_user_id,
            'fanmark_id', v_license.fanmark_id,
            'fanmark_name', coalesce(nullif(btrim(v_license.display_fanmark), ''), 'ファンマーク'),
            'fanmark_short_id', coalesce(v_license.short_id, ''),
            'grace_expires_at', v_grace_expires_at,
            'link', case when coalesce(v_license.short_id, '') <> '' then '/f/' || v_license.short_id else null end
          ), 'edge_function', 'fanmark_returned_owner_' || v_license.fanmark_id || '_' || p_local_user_id,
          v_now
        );
        perform public.create_notification_event(
          'favorite_fanmark_available',
          jsonb_build_object(
            'user_id', fav.user_id,
            'fanmark_id', v_license.fanmark_id,
            'fanmark_name', coalesce(fav.display_fanmark, ''),
            'fanmark_short_id', coalesce(v_license.short_id, ''),
            'grace_expires_at', v_grace_expires_at,
            'link', case when coalesce(v_license.short_id, '') <> '' then '/f/' || v_license.short_id else null end
          ), 'edge_function', 'favorite_available_' || v_license.fanmark_id || '_' || fav.user_id,
          v_now
        )
        from public.fanmark_favorites as fav
        where fav.fanmark_id = v_license.fanmark_id and fav.user_id <> p_local_user_id;
      end loop;
      if v_returned_count <> (v_active_licenses - v_free_limit) then
        raise exception 'Free plan return count did not match the required excess' using errcode = 'P0001';
      end if;
      if (select count(*) from public.fanmark_licenses as l
           where l.user_id = p_local_user_id and l.status = 'active'
             and (l.license_end is null or l.license_end > v_now)) <> v_free_limit then
        raise exception 'Free plan limit was not fully enforced' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_now := clock_timestamp();
  update billing_ingress.stripe_subscription_applications as a
     set status = 'applied', applied_at = v_now, updated_at = v_now
   where a.id = v_application.id and a.status = 'applying'
   returning a.* into v_application;
  if not found then
    raise exception 'subscription application did not terminalize' using errcode = 'P0001';
  end if;
  update billing_ingress.stripe_sync_fences as f
     set owner_token = null, lease_until = null, last_reconciled_at = v_now,
         last_error_code = null, updated_at = v_now
   where f.livemode = p_livemode and f.stripe_customer_id = btrim(p_stripe_customer_id)
     and f.owner_token = p_fence_token and f.generation = p_fence_generation
     and f.lease_until > v_now;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'subscription fence expired at commit boundary' using errcode = 'P0001';
  end if;
  update billing_ingress.stripe_webhook_dispatches as d
     set status = 'completed', completed_at = v_now, claimed_at = null,
         lease_until = null, lease_token = null, updated_at = v_now
   where d.id = v_dispatch.id and d.status = 'processing'
     and d.lease_token = p_lease_token and d.claim_generation = p_claim_generation
     and d.lease_until > v_now;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'subscription dispatch expired at commit boundary' using errcode = 'P0001';
  end if;
  update billing_ingress.stripe_webhook_receipts as r
     set status = 'applied', terminal_at = v_now, updated_at = v_now
   where r.id = v_receipt.id and r.status = 'processing';
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception 'subscription receipt did not terminalize' using errcode = 'P0001';
  end if;

  application_id := v_application.id;
  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  outcome := 'applied';
  ledger_status := 'applied';
  receipt_status := 'applied';
  dispatch_status := 'completed';
  local_user_id := p_local_user_id;
  effective_plan_type := p_effective_plan_type;
  active_subscription_count := v_active_count;
  fence_generation := p_fence_generation;
  return next;
end;
$$;

comment on function public.apply_stripe_subscription_projection(uuid, uuid, boolean, uuid, bigint, text, uuid, boolean, text, jsonb, text, uuid, bigint) is
  'Service-role-only atomic current subscription projection and last-subscription Free-plan return transaction.';
revoke all on function public.apply_stripe_subscription_projection(uuid, uuid, boolean, uuid, bigint, text, uuid, boolean, text, jsonb, text, uuid, bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.apply_stripe_subscription_projection(uuid, uuid, boolean, uuid, bigint, text, uuid, boolean, text, jsonb, text, uuid, bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.apply_stripe_subscription_projection(uuid, uuid, boolean, uuid, bigint, text, uuid, boolean, text, jsonb, text, uuid, bigint) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.apply_stripe_subscription_projection(uuid, uuid, boolean, uuid, bigint, text, uuid, boolean, text, jsonb, text, uuid, bigint) to service_role';
  end if;
end
$$;

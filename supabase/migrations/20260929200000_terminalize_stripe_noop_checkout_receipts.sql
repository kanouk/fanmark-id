-- Durably acknowledge Checkout events that do not represent license extensions.
-- Plan state continues to come from customer.subscription.* events.
create or replace function public.ignore_stripe_non_extension_checkout_receipt(
  p_receipt_id uuid,
  p_dispatch_id uuid,
  p_livemode boolean,
  p_lease_token uuid,
  p_claim_generation bigint
)
returns table (
  receipt_id uuid,
  dispatch_id uuid,
  receipt_status text,
  dispatch_status text,
  finalized boolean
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
    raise exception 'service role required for Stripe checkout receipt finalization'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or p_dispatch_id is null or p_livemode is null
     or p_lease_token is null or p_claim_generation is null or p_claim_generation < 1 then
    raise exception 'receipt, dispatch, and lease identity are required'
      using errcode = '22023';
  end if;

  -- Keep the established receipt-before-dispatch lock order.
  select r.* into v_receipt
    from billing_ingress.stripe_webhook_receipts as r
   where r.id = p_receipt_id
     and r.livemode = p_livemode
   for update;
  if not found then
    return;
  end if;

  select d.* into v_dispatch
    from billing_ingress.stripe_webhook_dispatches as d
   where d.id = p_dispatch_id
     and d.receipt_id = v_receipt.id
     and d.livemode = v_receipt.livemode
     and d.stripe_event_id = v_receipt.stripe_event_id
   for update;
  if not found then
    return;
  end if;

  if v_receipt.event_type not in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed',
       'checkout.session.expired'
     )
     or v_receipt.object_type is distinct from 'checkout.session'
     or v_receipt.normalized_schema_version <> 1
     or v_receipt.normalized_payload #>> '{branch}' is distinct from 'checkout_session'
     or v_receipt.normalized_payload #>> '{checkout_session,id}' is distinct from v_receipt.object_id
     or v_receipt.normalized_payload #>> '{checkout_session,metadata,type}' = 'license_extension' then
    raise exception 'Stripe receipt is not an eligible non-extension Checkout event'
      using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  if v_receipt.status <> 'processing'
     or v_dispatch.status <> 'processing'
     or v_dispatch.lease_token is distinct from p_lease_token
     or v_dispatch.claim_generation <> p_claim_generation
     or v_dispatch.lease_until is null
     or v_dispatch.lease_until <= v_now then
    receipt_id := v_receipt.id;
    dispatch_id := v_dispatch.id;
    receipt_status := v_receipt.status;
    dispatch_status := v_dispatch.status;
    finalized := false;
    return next;
    return;
  end if;

  update billing_ingress.stripe_webhook_receipts as r
     set status = 'ignored',
         terminal_at = v_now,
         last_error_code = null,
         last_error_message = null,
         updated_at = v_now
   where r.id = v_receipt.id;

  update billing_ingress.stripe_webhook_dispatches as d
     set status = 'completed',
         completed_at = v_now,
         claimed_at = null,
         lease_until = null,
         lease_token = null,
         last_error_code = null,
         last_error_message = null,
         updated_at = v_now
   where d.id = v_dispatch.id;

  receipt_id := v_receipt.id;
  dispatch_id := v_dispatch.id;
  receipt_status := 'ignored';
  dispatch_status := 'completed';
  finalized := true;
  return next;
end;
$$;

comment on function public.ignore_stripe_non_extension_checkout_receipt(uuid, uuid, boolean, uuid, bigint) is
  'Fenced service-only terminalization for signed non-extension Checkout receipts; does not grant licenses or update plan state.';

revoke all on function public.ignore_stripe_non_extension_checkout_receipt(uuid, uuid, boolean, uuid, bigint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ignore_stripe_non_extension_checkout_receipt(uuid, uuid, boolean, uuid, bigint) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ignore_stripe_non_extension_checkout_receipt(uuid, uuid, boolean, uuid, bigint) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ignore_stripe_non_extension_checkout_receipt(uuid, uuid, boolean, uuid, bigint) to service_role';
  end if;
end
$$;

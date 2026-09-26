# Stripe Checkout extension application validation (#32)

Date: 2026-09-25 JST

## Implemented locally

The `handle-stripe-webhook` Edge Function now routes these license-extension
events through durable receipt persistence and one PostgreSQL application RPC:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

The handler verifies Stripe signatures against the exact raw request bytes and
caps the streamed body at 256 KiB. It saves the redacted normalized receipt
and its pending dispatch before applying an extension. A receipt is
acknowledged only after the RPC returns one consistent terminal receipt and
dispatch state. Duplicate terminal receipts are safe to acknowledge; transient
database errors return a retryable 5xx.

`20260925120000_add_stripe_extension_application.sql` adds a private effect row
unique by `(livemode, stripe_checkout_session_id)`. The service-only RPC locks
the receipt, dispatch, session effect, license, and fanmark, then commits the
license update, pending lottery cancellation, `LICENSE_EXTENDED` audit,
lottery-cancellation audit, per-applicant notification events, effect status,
receipt status, and dispatch status in one transaction. It checks
current ownership, finite active/grace eligibility, tier, return/transfer
state, and any active transfer request. Month arithmetic is calculated in UTC.

New Checkout Sessions record the server-selected positive JPY amount and
`allow_zero_total=false`. The application verifies the paid status, JPY
currency, positive total, and expected amount. Legacy paid Sessions without
the price metadata remain supported. Unpaid completion remains pending for a
later async success; failed/expired Sessions do not grant time, and later
payment after a terminal failure/expiry is dead-lettered. No automatic refund
or operator alert currently handles that late-payment case. Conflicting
metadata for the same Session is denied.

## Local verification

Command, from `experiments/stripe-receipts`:

```sh
node --import tsx --test \
  test/extension-application.test.mjs \
  test/extension-application-result.test.mjs \
  test/ingress.test.mjs \
  test/checkout-payment-assessment.test.mjs
```

Result: 35 tests passed. PGlite applied the receipt foundation, dispatch lease
migration, and new effect migration to an isolated source-shaped fixture. The
tests cover a single paid application and complete terminal state, duplicate
event IDs and distinct events for one Session, unpaid-to-paid async settlement,
failed/expired late payment, amount/currency/zero-policy mismatch, conflicting
Session metadata, stale owner and transfer lock, per-applicant notification
payloads, UTC rounding across a DST boundary under a non-UTC database timezone,
rollback after audit or notification enqueue failure, and service-only ACLs.

Additional checks passed:

```sh
deno check supabase/functions/handle-stripe-webhook/index.ts \
  supabase/functions/create-extension-checkout/index.ts \
  supabase/functions/_shared/stripe-receipt-ingress/index.ts \
  supabase/functions/_shared/stripe-extension-application.ts
npm run typecheck  # from experiments/stripe-receipts
npm run check:ci
git diff --check
```

## Limits and remaining work

The SQL was executed only in isolated PGlite tests. This does not prove a
Supabase migration against the live schema, independent-connection Postgres
concurrency, Stripe endpoint/event configuration, deployment, or production
behavior. The migration is unapplied; the Edge Functions are undeployed. No
Stripe account settings, user/Auth/object data, D1, R2, or domain/DNS state was
changed by this slice.

Production needs a monitored reconciliation flow for dead-lettered late
payments before this webhook path is enabled; the current code does not refund
or alert operators. Checkout intents and Stripe API idempotency keys, the
remaining billing webhook event paths, general worker recovery, independent
Postgres concurrency tests, and a Cloudflare D1 port remain open for issue #32.

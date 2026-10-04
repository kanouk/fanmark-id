# Stripe Checkout extension application validation (#32)

Date: 2026-09-25 JST

## Real staging extension acceptance (2026-10-04)

On runtime 87b61ef / Worker ca971193, a disposable signed-in owner registered a
single emoji through the actual app API (Tier4/S, finite initial license). The
one-month extension API created one test Checkout at JPY2000 and reused it for
the identical request UUID. A hosted generic-decline test attempt left the
license end and application/effect/audit unchanged. The same Checkout then
completed a real test 3DS challenge; the Stripe Dashboard showed payment and
3DS authentication success, alongside the prior decline history.

The actual signed completed event was processed by the natural minute Cron.
Independent read-only D1 evidence showed 2026-10-12 UTC -> 2026-11-12 UTC and
one application, effect and LICENSE_EXTENDED audit. Dashboard resend produced
delivery_count=2 with the same end and one effect. The journal-owned fixture was
removed only after drain. Separate-process readback confirmed fixture rows0,
original human identities2/accounts6/session1, original owned40-table counts,
all Master history, MFA and wake preservation. Test provider history/settings
remain. See [aggregate evidence](evidence/stripe-staging-extension-provider-2026-10-04.json).

This accepts hosted one-time extension decline/3DS and duplicate delivery; it
does not accept subscription invoice failures, initial out-of-order delivery,
async/expired provider events, pending-lottery provider cancellation, or a
single-user whole-application browser journey. The harness's initial Tier1
misclassification stopped before creating Checkout; its fixture was cleaned,
then the exact baseline was independently verified before the corrected run.
Runtime/schema were unchanged. The overall migration remains incomplete.


## D1 per-entry cancellation audits (2026-10-03)

The D1 billing application now writes `LOTTERY_ENTRY_STATUS_CHANGED` for each
pending lottery entry cancelled by a paid extension. The record includes the
applicant and entry IDs, old/new status, `license_extended` reason, application
request ID and operation time. These records share the billing-effect batch.
Before marking the application applied, SQL verifies the exact per-entry audit
against the durable cancellation snapshot. A missing audit or corrupted
metadata makes the batch fail and roll back; retry preserves one extension and
one audit per entry even when another receipt arrives for the same Session.

The regression first reproduced zero per-entry records for two cancelled
entries. The complete local Stripe ingress/application/invoice/subscription/
portal suite passes 70/70, including ignored audit inserts, corrupted metadata,
transaction rollback and duplicate-Session replay. Worker typecheck, ESLint and
diff check pass. Providers are synthetic; no real Stripe request ran. The coupon
command-trigger writer remains a separate parity review.

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

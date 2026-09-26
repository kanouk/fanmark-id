# Stripe D1 ingress validation

Checkpoint: 2026-09-26. The ingress, paid-extension effect, Checkout intent,
and scheduled-dispatch behavior are locally tested for the D1 port under
[issue #32's design](stripe-ledger-design.md). Additive schema migrations are
also applied to isolated staging business D1; the production/staging Stripe
route remains disabled.

`workers/api/migrations-business/0006_stripe_webhook_ingress_staging.sql`
defines receipt and durable-dispatch tables with test/live event deduplication,
redacted normalized JSON, raw-body hashes only, paired foreign keys, terminal
state checks, processing lease/fencing fields, and query indexes.
`workers/api/src/stripe-webhook-d1-ingress.ts` adds a persistence function for
a normalized event. It uses an atomic D1 batch to insert the receipt and
dispatch, count matching retries, repair a missing dispatch without erasing
terminal state, and fail closed on immutable-event or receipt/dispatch
conflicts. `workers/api/src/stripe-webhook-d1-api.ts` connects the existing
raw-body and Stripe-signature verifier to that persistence function. It
provides `POST /api/stripe/webhook` only when `STRIPE_WEBHOOK_BACKEND=d1` and
`STRIPE_WEBHOOK_SECRET` are present. The selector and secret are absent from
the staging config, so the route is disabled. The `workers/api` command
`workers/api/src/stripe-webhook-d1-dispatch.ts` adds bounded claim, renewal,
and retry lease primitives with token/generation fencing.
The original receipt, ingress, and lease cases pass 20/20 local Miniflare
checks. The extension effect adds 7 cases and the scheduled processor adds 3;
all 30 pass through `npm run test:stripe-webhook-ingress-schema`:

- expected tables/indexes exist and there is no raw request-body column;
- a receipt and dispatch can be committed together, repeated deliveries
  converge on one pair, concurrent deliveries converge, and event IDs are
  unique per mode;
- a dispatch constraint failure rolls back the receipt in the same D1 batch;
- invalid normalized JSON, hashes, status, delivery count, live mode, terminal
  state, or incomplete lease state is rejected;
- immutable replay conflicts leave the stored receipt unchanged, missing
  dispatch repair preserves terminal state, inconsistent terminal state fails
  closed, and invalid inputs write no rows;
- a valid SDK-signed raw request is durably accepted before a 200 response,
  repeats are acknowledged as duplicates, and invalid/stale signatures or
  missing route configuration write no rows.
- claims filter by mode and due time, concurrent claims converge, expired
  leases advance token/generation, renewals cannot shorten a lease, retries
  clear the lease and update both rows, and injected receipt-update failures
  roll back the claim/retry batch.

`workers/api/migrations-business/0007_stripe_extension_application_staging.sql`
adds private D1 checkout-intent, session-application, effect, and canceled
lottery-entry tables. `workers/api/src/stripe-webhook-d1-application.ts`
applies only signed, normalized extension sessions bound to an exact local
intent. It checks positive JPY amount/currency, owner/license/tier state,
transfer locks, and the current receipt lease. One D1 batch updates the
license, cancels pending lottery entries, writes notification events and both
audits, finalizes the application, and terminalizes receipt/dispatch. Session
identity and a unique application ledger prevent a repeated or competing
receipt from extending twice. Unpaid completion waits for async success;
expired and failed sessions grant no time. A mismatch or stale/locked target
is dead-lettered.

The new Miniflare suite passes 7/7 against the source-shaped 40-table D1
baseline plus migrations `0006` and `0007`. It covers the paid transaction,
same-session replay, competing receipts, unpaid then asynchronous success,
expired/failed no-grant, amount/owner/transfer-lock rejection, and rollback
after an injected audit failure. All fixtures use synthetic identities and
rows.

`workers/api/src/stripe-extension-checkout-d1-api.ts` adds a Worker Checkout
endpoint behind `STRIPE_EXTENSION_CHECKOUT_BACKEND=d1`. It reads the active
versioned extension-price row from Master D1, checks owner/status/transfer
state and the grace-period plan limit, snapshots the price into a private
request-id intent, and uses an intent-derived Stripe idempotency key. An open
Session is reused on request replay; after the conservative 20-hour window a
missing Session enters reconciliation. Checkout is refused unless the matching
D1 webhook selector, signing secret, and dispatch selector are configured.
The frontend has an opt-in `VITE_STRIPE_EXTENSION_CHECKOUT_BACKEND=worker`
client; Supabase remains the default. Four Miniflare cases and five client
contract cases pass with synthetic data and a fake Stripe client.

`workers/api/src/stripe-webhook-d1-scheduled.ts` connects bounded D1 claims to
the extension application and the invoice projection. Transient failures
receive increasing retry delays and then dead-letter at the attempt limit.
Subscription events remain review-only. `0008_stripe_invoice_projection_staging.sql`
adds the customer generation fence and private application ledger;
`workers/api/src/stripe-invoice-projection-d1.ts` reuses the Basil normalizer
and current Invoice/Subscription retrieval contract from the source-side
projection. It confirms the exact Stripe customer-to-user and subscription
mapping in D1, then atomically writes only the payment-failure fields, ledger,
fence, receipt, and dispatch state. No email matching, plan change, entitlement,
license, or notification write is used. The caller clock is refreshed after
remote Stripe reads; SDK calls use a 10-second timeout, zero SDK retries, and a
300-second dispatch/customer lease.

Nine additional Miniflare cases cover current paid/failure/action-required
state, stale failed and success events, missing mapping, concurrent/expired
customer fences, failure rollback followed by successful retry, scheduled
invoice dispatch, a Stripe read that outlives its dispatch lease, and the
disabled-by-default scheduled path. The expanded
`npm run test:stripe-webhook-ingress-schema` command passes 39/39.
Invoice behavior uses synthetic D1 and an injected provider; the staging
selectors, Stripe API key, signing secret, and Stripe Cron dispatch remain off.
Subscription entitlement/free-plan return and other billing effects remain
unimplemented.

Behavioral tests still use synthetic local D1 and fake Stripe clients. On
2026-09-26 Wrangler applied
migrations `0006` and `0007` to `fanmark-business-staging` after confirming
the referenced lottery table existed. Remote readback found all six new
tables, all six empty; `fanmarks`, `fanmark_licenses`, and `user_settings`
also remained empty. A subsequent migration-list read returned no pending
migrations. Migration `0008` was subsequently applied and verified: the
expected invoice fence/application tables and indexes exist, and fence,
application, receipt, and dispatch counts are all zero. Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` was then deployed at 100% to workers.dev
staging.

The staging Worker still has no Stripe signing secret, API secret, or backend
selectors, so checkout and webhook routes remain disabled. A synthetic webhook
request returned 404 with the selector unset. No Stripe API call, Stripe
Dashboard change, production state, user data, or DNS was changed.

The final staging secret inventory contains no Stripe API or signing secret,
and all Stripe selectors are unset. Remote D1 verification after applying
`0008` found the expected schema and zero rows in the invoice ledger, fence,
receipt, and dispatch tables. The deployed webhook route remains unreachable
while the selector is unset.

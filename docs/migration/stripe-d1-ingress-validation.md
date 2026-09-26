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
Created/updated/deleted subscription events now have a local D1 reconciliation
path. `0008_stripe_invoice_projection_staging.sql`
adds the customer generation fence and private application ledger;
`workers/api/src/stripe-invoice-projection-d1.ts` reuses the Basil normalizer
and current Invoice/Subscription retrieval contract from the source-side
projection. It confirms the exact Stripe customer-to-user and subscription
mapping in D1, then atomically writes only the payment-failure fields, ledger,
fence, receipt, and dispatch state. No email matching, plan change, entitlement,
license, or notification write is used. The caller clock is refreshed after
remote Stripe reads; SDK calls use a 10-second timeout, zero SDK retries, and a
300-second dispatch/customer lease.

`workers/api/src/stripe-subscription-reconciliation-d1.ts` retrieves the
current Subscription, current active subscriptions for its customer, and the
Stripe Customer under a mode-specific customer fence. It resolves users only
through an exact D1 customer relation or a verified UUID in Customer metadata;
it never falls back to email. It uses private test/live Price ID settings,
projects current status and billing fields, and applies plan changes only for
active subscriptions. If more than one active subscription exists, the
highest existing plan order (Creator, Max, Business) determines the plan.
An active update also clears that subscription's local payment-failure fields.
Non-active updates do not grant or remove entitlement. A CHECK-backed D1 batch
guard keeps the subscription rows, customer link, plan, application ledger,
fence, receipt, and dispatch terminal state atomic.

For a deleted subscription, the worker keeps the current canceled row as a
tombstone and reconciles all other current active subscriptions first. A
remaining active subscription keeps the corresponding highest paid plan. If
none remain, the same D1 batch sets Free and returns only the newest excess
unexpired active licenses, using the configured free limit (default 3) and
grace period (default 1 day). Each return changes the license to Grace,
records an audit, and inserts the owner/favorite notification events with the
existing dedupe keys. A transfer in progress or any missing return effect
aborts the entire batch; the plan, license rows, subscription projection,
ledger, receipt, and dispatch do not partially commit.

Eleven additional Miniflare cases cover current paid/failure/action-required
state, stale failed and success events, missing mapping, concurrent/expired
customer fences, failure rollback followed by successful retry, scheduled
invoice dispatch, a Stripe read that outlives its dispatch lease, and the
disabled-by-default scheduled path. The suite also rejects a test-mode API key
for a live queue (and vice versa), and rejects reassignment of one Stripe
subscription ID across users/customers. Scheduled invoice retrieval creates
separate providers from `STRIPE_SECRET_KEY_TEST` and `STRIPE_SECRET_KEY_LIVE`.
Thirteen subscription cases cover current-state reconciliation, active-only plan
behavior, mode-specific Price IDs, deterministic multiple-active plan choice,
deletion with and without another active plan, newest-excess returns,
default/configured Free limits, transfer blocking, audit rollback, dispatcher
routing, exact customer mapping, and ownership conflict rollback. The expanded
`npm run test:stripe-webhook-ingress-schema` command passes 54/54;
Worker typecheck also passes.
Invoice behavior uses synthetic D1 and an injected provider; the staging
selectors, mode-specific Stripe API keys, signing secret, and Stripe Cron
dispatch remain off. The generic `STRIPE_SECRET_KEY` used by the separate
extension Checkout creator is not reused for scheduled invoice retrieval.
The created/updated/deleted subscription handler remains local-only and has
not been deployed. Plan Checkout/change/Portal commands, Stripe sandbox
acceptance, other billing effects, and end-to-end Worker acceptance remain
unimplemented.

Behavioral tests still use synthetic local D1 and fake Stripe clients. On
2026-09-26 Wrangler applied
migrations `0006` and `0007` to `fanmark-business-staging` after confirming
the referenced lottery table existed. Remote readback found all six new
tables, all six empty; `fanmarks`, `fanmark_licenses`, and `user_settings`
also remained empty. A subsequent migration-list read returned no pending
migrations. Migration `0008` was subsequently applied and verified: the
expected invoice fence/application tables and indexes exist, and fence,
application, receipt, and dispatch counts are all zero. Migration `0009` then
added a target-side unique index over `user_subscriptions.stripe_subscription_id`.
Remote readback confirmed the exact index definition, `unique=1`, no pending
migrations, no foreign-key violations, and zero subscriptions, fanmarks,
licenses, user settings, webhook receipts, or dispatches. Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` was then deployed at 100% to workers.dev
staging. Migration `0010_stripe_subscription_reconciliation_staging.sql` was
subsequently applied to the same empty business D1. Remote readback confirms
its application ledger, transaction-guard table, and customer index; the new
ledger and guard tables are empty, `user_subscriptions` remains empty, and
Wrangler reports no pending migrations. Migration
`0011_stripe_subscription_free_return.sql` was then applied and read back:
the return batch/item tables and license index exist, return rows remain zero,
the business user/license/subscription/application counts remain zero, the
foreign-key check is empty, and no migrations are pending. The deployed Worker
is still the older version above; the new subscription handler is not deployed.

The staging Worker still has no Stripe signing secret, API secret, or backend
selectors, so checkout and webhook routes remain disabled. A synthetic webhook
request returned 404 with the selector unset. No Stripe API call, Stripe
Dashboard change, production state, user data, or DNS was changed.

The final staging secret inventory contains no Stripe API or signing secret,
and all Stripe selectors are unset. Remote D1 verification after applying
`0008`–`0011` found the expected schemas and zero rows in the invoice and
subscription ledgers, subscription return batches/items, fence, receipt,
dispatch, and subscription tables. The deployed webhook route remains
unreachable while the selector is unset.

## 2026-09-26 subscription reconciliation staging deployment

The deleted-subscription/Free-return Worker handler from commit `0ed264a` is now included in workers.dev staging version `cec31381-d388-492d-906c-879b70d03cf3` at 100%. It is not enabled for incoming Stripe events: the Stripe backend selectors and signing/API secrets are absent, and read-only `GET /api/stripe/webhook` returns 404. The recurring notification Cron remains configured; the daily expiry Cron is configured but its backend selector remains absent. D1 migrations `0006`–`0011` are applied, with zero user/license/return/event rows.

Post-deploy checks returned 200 for the SPA root, robots, and Auth health; 54/54 Stripe integration tests, Worker typecheck, staging build, Wrangler dry-run, and staging schema readback passed. No Stripe API call or production/user-data/domain change occurred.

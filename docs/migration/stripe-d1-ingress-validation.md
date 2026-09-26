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
the extension application. Transient application failures receive increasing
retry delays and then dead-letter at the attempt limit. Non-extension billing
events are explicitly dead-lettered for review because subscription and
invoice projections are not ported. Three additional Miniflare cases cover
scheduled paid application, unsupported-event dead-lettering, and retry then
success.

Behavioral tests still use synthetic local D1 and fake Stripe clients; the
staging apply only created empty schema. On 2026-09-26 Wrangler applied
migrations `0006` and `0007` to `fanmark-business-staging` after confirming
the referenced lottery table existed. Remote readback found all six new
tables, all six empty; `fanmarks`, `fanmark_licenses`, and `user_settings`
also remained empty. A subsequent migration-list read returned no pending
migrations. The Worker was not redeployed for this schema-only change.

The staging Worker still has no Stripe signing secret, API secret, backend
selectors, or Cron trigger, so checkout and webhook routes remain disabled.
Subscription/invoice event paths still need migration before any Stripe
cutover. No Stripe API call, Stripe Dashboard change, production state, user
data, or DNS was changed.

Read-only Wrangler secret inventory for the staging Worker showed no
`STRIPE_WEBHOOK_SECRET`; no signing secret was created. A read-only remote D1
migration-list request returned Cloudflare error 7403, so the current remote
ledger was not refreshed in this checkpoint. No remote migration apply or
Worker deploy command was run.

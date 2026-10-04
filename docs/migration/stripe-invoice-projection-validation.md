# Stripe invoice projection validation (#32)

## Actual D1 invoice authentication acceptance (2026-10-04)

The same runtime 87b61ef / Worker ca971193 was used for a new disposable owner.
The app requested Creator -> Business; paying the resulting open invoice with
the official always-authenticate test method produced a real requires_action
PaymentIntent and signed invoice.payment_failed/payment_action_required events.
Natural minute dispatch classified the actual current InvoicePayment status,
projected invoice.payment_action_required, and retained Creator before payment.

The hosted invoice confirmed the already-attached Visa3184 test card and opened
the official 3D Secure 2 Test Page. Completing the challenge paid the same invoice
and PaymentIntent; no replacement card or second intent supplied the recovery.
The paid invoice was visible at JPY1000 (proration); the monthly subscription
projection became Business/active at JPY2000 and cleared the failure fields.
Separate read-only processes verified waiting, recovery, app Free cancellation,
owned cleanup and exact original Auth/Business/Master/MFA/wake preservation.
The dedicated webhook's ten event selection was unchanged throughout.

See [authentication evidence](evidence/stripe-staging-invoice-authentication-2026-10-04.json).
The initial contract was a provider API fixture, not an additional app Checkout
proof. A same-user whole-application UI flow, actual phone and full migration
remain unaccepted. Test provider history and staging settings are retained.


## Actual D1 staging invoice acceptance (2026-10-04)

The current staging candidate is 87b61ef / Worker ca971193, with CI37200812928
both jobs successful. A disposable owner used a real test provider subscription
fixture and app plan-change API. Invoice payment with the official decline
method returned HTTP402/card_declined. Natural signed-event dispatch projected
past_due and invoice.payment_failed into D1 and the owner subscription DTO.
The unconfirmed Business upgrade kept the profile at Creator.

The dedicated test endpoint temporarily held only the initial success event;
its original ten events were restored immediately after fixture creation. An
independent read established that success receipt was absent after the newer
failure applied. Stripe CLI then delivered this actual old event for the first
time. It applied with delivery_count=1, reconciled the current failed invoice,
and preserved failure. This proves initial reverse delivery, not just replay
of an already-applied receipt. Paying that same open invoice with the official
success method produced actual signed recovery: Business/active, failure
time/type cleared. Separate read-only processes confirmed each phase, app Free
cancellation, owned cleanup and exact original state preservation.

See [aggregate evidence](evidence/stripe-staging-invoice-provider-2026-10-04.json).
Provider test history/settings remain. The additional authentication proof is
recorded above; a same-user whole-application UI flow and full migration remain unaccepted.
The following sections retain historical local/Postgres evidence; statements
that staging selectors were absent describe the earlier deployment state.


Status: offline implementation and local Edge Function wiring are complete;
staging and production wiring remain pending. This slice adds a reusable
projection adapter, an exact-dispatch lease claim, and a service-only SQL
transaction for the existing invoice payment fields. It does not grant
licenses, change `plan_type`, send payment notifications, call Stripe in
production, or deploy either migration.

The checked-in `handle-stripe-webhook` now sends the three invoice payment
event types through durable receipt acceptance, exact dispatch claim, and
current-state projection. It returns 200 only after an atomic terminal result
or a previously terminal duplicate. A busy lease or retryable projection
returns 503 so Stripe can redeliver. Other webhook event branches keep their
existing handlers.

The migration is
[`20260921110000_add_stripe_invoice_projection.sql`](../../supabase/migrations/20260921110000_add_stripe_invoice_projection.sql).
The additional exact-dispatch lease RPC is in
[`20260929170000_add_targeted_stripe_dispatch_claim.sql`](../../supabase/migrations/20260929170000_add_targeted_stripe_dispatch_claim.sql).
It adds two private `billing_ingress` tables:

- `stripe_sync_fences` is one live/test-scoped generation fence per Stripe
  customer. A worker acquires its lease while the claimed receipt and
  dispatch are still processing, before remote reconciliation.
- `stripe_application_ledger` records one invoice projection effect per source
  event and effect kind. Its effect key is event-based; the retained
  `invoice_attempt_key` includes the current payment intent when available,
  attempt count, and outcome. Invoice ID alone is never a dedupe key.

The new SQL functions are service-role-only `SECURITY DEFINER` functions with
fixed `pg_catalog, billing_ingress` search paths:

- `acquire_stripe_customer_fence` locks the receipt, dispatch, and customer
  fence in that order and returns a new generation/token. An active fence or
  stale dispatch returns no row.
- `release_stripe_customer_fence` uses the same order and token predicates for
  retryable remote failures.
- `apply_stripe_invoice_projection` locks receipt, dispatch, fence, the mapped `user_settings` row,
  and its `user_subscriptions` row. It rechecks the unexpired dispatch lease and
  current fence before updating payment fields, inserting the ledger row,
  clearing the fence, and marking the receipt/dispatch terminal in one
  transaction.
- `claim_stripe_webhook_dispatch_by_id` locks receipt then dispatch and leases
  only the dispatch returned by this webhook's durable receipt. It cannot claim
  unrelated queue entries; an active lease returns no row.

Anonymous and authenticated roles cannot execute these functions or read the
private tables. `service_role` can call the functions but cannot read the
tables directly. The request JWT role check is defense in depth; SQL execute
ACLs are the actual caller boundary.

## Reconciliation and state authority

[`stripe-invoice-projection/index.ts`](../../supabase/functions/_shared/stripe-invoice-projection/index.ts)
accepts a claimed normalized invoice receipt and pins every provider request to
the `2025-08-27.basil` API version. Invoice retrieval expands
`payments.data.payment.payment_intent`, the Basil InvoicePayment relationship;
it does not read the removed top-level `invoice.payment_intent` field. It
retrieves the source invoice and its subscription after acquiring the customer
fence, then retrieves the subscription's `latest_invoice` when it differs from
the source event. It verifies every current invoice, subscription, customer,
mode, and latest-invoice identity. It never compares `event.created` values.

The adapter requires the stored `user_settings.stripe_customer_id` mapping and
the matching `user_subscriptions` row. It does not search Auth by email or
create a customer linkage. Missing mapping, missing subscription, conflicting
Invoice relationships, identity mismatch, stale lease/fence, remote failure,
and unsupported current state use the existing bounded dispatch retry RPC;
they do not mark a receipt applied, ignored, or dead-letter.
The Supabase runtime schedules these retryable results 60 seconds later by
default; the factory accepts a bounded 0–86400 second override for tests or a
reviewed dispatcher policy, and has no terminal exhaustion policy.

The current Supabase schema has a unique partial index on non-null
`user_settings.stripe_customer_id` values and a per-user/subscription unique
key. The RPC still uses `SELECT INTO STRICT` so a malformed fixture or future
schema drift becomes a bounded mapping review instead of choosing an arbitrary
user; D1 migration must preserve the same uniqueness boundary.

The current state mapping is deliberately narrow:

| Current retrieved state | Projection result |
| --- | --- |
| Invoice `paid` | Clear payment failure fields. This wins over an older failed event. |
| Invoice `open` with exactly one active InvoicePayment (`status=open`, `type=payment_intent`) whose expanded PaymentIntent is `requires_action` | Set `payment_failure_type` to `invoice.payment_action_required`. |
| Invoice `open` with exactly one active InvoicePayment whose expanded PaymentIntent is `requires_payment_method` or `canceled` | Set `payment_failure_type` to `invoice.payment_failed`. |
| Invoice `open` without a current expanded PaymentIntent status | Retry for bounded review. The old event type is never used to classify the current attempt. |
| Invoice `uncollectible` | Preserve failure state with `invoice.payment_failed` and no next attempt. |
| Invoice `void` | Retry without mutation while the product lifecycle policy is unresolved. |
| `draft`, missing status, unknown status, or contradictory PaymentIntent state | Retryable review outcome with no application row. |

The Stripe Invoice API defines the invoice statuses as `draft`, `open`,
`paid`, `uncollectible`, and `void`; payment failure and action-required
events describe failed or user-action payment attempts. See the [Invoice API
reference](https://docs.stripe.com/api/invoices/object) and the [InvoicePayment
object](https://docs.stripe.com/api/invoice-payment/object?api-version=2025-08-27.preview).
Stripe documents invoice payments as a list whose payment relation can be a
PaymentIntent; the adapter rejects an incomplete or ambiguous list rather than
guessing which attempt is current. The implementation leaves `void` pending a
separate lifecycle decision because the existing product code only clears
failure fields after a successful payment.

For Basil current objects, the relationship is verified through
`parent.type=subscription_details` and
`parent.subscription_details.subscription`; an old top-level relationship is
rejected for a pinned Basil provider response rather than used as a fallback. A
conflict or malformed relationship is retryable and non-mutating.

## Atomicity and tests

An applied result commits all of these together:

1. the current `user_subscriptions` payment fields;
2. the source-event application ledger row;
3. the customer fence release; and
4. the dispatch `completed` plus receipt `applied` terminal states.

A failed subscription update rolls back the ledger and terminal states. A
later payment attempt for the same invoice produces a distinct ledger row and
attempt key. A stale success event reconciles the current latest invoice and
cannot clear a newer current failure.

The focused PGlite harness is
[`invoice-projection.test.mjs`](../../experiments/stripe-receipts/test/invoice-projection.test.mjs).
It applies the foundation, dispatch lease, and projection migrations to a
real local PostgreSQL-compatible engine and covers:

- paid latest-invoice clearing and older-event reconciliation;
- failed and action-required attempts without invoice-ID dedupe;
- missing customer mapping, unsupported draft state, missing current payment
  state, strict Basil relationships, and void retry behavior;
- forced SQL rollback with no ledger or terminal receipt;
- stale fence rejection and private table/function ACLs;
- a real SQL delay during ledger insertion that outlasts the dispatch lease,
  rejects the final mutation, and rolls back the ledger without changing payment
  fields or terminal states.
- exact-dispatch claim isolation, rejection of an active duplicate claim, and
  service-role-only access to the targeted claim RPC;
- the accepted-receipt orchestration and terminal duplicate path, including no
  second Stripe read for an already-applied event.

The reusable adapter also has a compile fixture against Supabase JS `2.57.4`
and Stripe `18.5.0`. Run from `experiments/stripe-receipts/`:

```sh
npm test
npm run typecheck
```

PGlite uses one in-memory connection. These tests exercise the actual SQL
functions, constraints, role ACLs, and transaction rollback, but they do not
prove independent-connection `SKIP LOCKED` concurrency or managed Supabase
Postgres behavior. The D1 Worker port now bounds Stripe reads with a 10-second
request timeout, disables SDK retries, and rechecks the receipt/customer lease
after the remote reads before applying state. It does not renew during a long
provider call; work that may exceed the 300-second lease is rejected for retry.
The additive D1 migration is applied only to the empty APAC staging database;
the invoice projection code initially stayed disabled before Stripe selectors
and secrets were configured. The current test-only D1 acceptance is recorded above. Production migration and reviewed
live endpoint cutover remain open.

The current invoice projection suite passes 28 tests under repository Node
22.6.0, including targeted-claim and accepted-receipt orchestration tests. The
Edge Function source now wires these invoice event types locally, but neither
the new Supabase migration nor that webhook edit has been deployed. Subscription
and plan Checkout events still use their existing handler paths; cutover still
requires their durable application path and reviewed staging/production wiring.

## Separate PostgreSQL connection proof

The additional [PostgreSQL 17 concurrency harness](postgres-concurrency.md)
uses separate backend connections and observes real lock waits for duplicate
receipt and customer-fence contention. It also holds the first claim transaction
open while another connection claims disjoint rows, and verifies final lease
expiry and rollback. All five cases passed independently under Node 22.6.0
with local PostgreSQL 17.10. This supplements the PGlite evidence above; it
does not establish managed PostgreSQL 17.6 configuration or production wiring.

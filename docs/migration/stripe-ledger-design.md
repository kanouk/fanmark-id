# Stripe receipt, application ledger, and outbox design (#32)

Status: partial local implementation for paid license-extension webhook
receipt, intent, effect deduplication, and atomic PostgreSQL and D1
application. D1 migrations `0006` and `0007`, the signature-verifying ingress,
lease primitives, positive-priced Checkout creator, scheduled extension
dispatcher, and application transaction now have local Miniflare validation.
No Stripe migration is applied to a remote database; the D1 route and Cron
remain disabled. Subscription and invoice D1 projections, broader command and
reconciliation operations, and non-extension effect handling remain open. The
PostgreSQL receipt/dispatch foundation,
signed ingress adapter, and claim/renew/retry lease RPCs have bounded offline
implementations for review; their validation records are [here](stripe-receipt-validation.md),
[here](stripe-ingress-validation.md), and
[here](stripe-dispatch-validation.md). The non-granting invoice projection
slice is recorded [here](stripe-invoice-projection-validation.md), and the
local D1 ingress and extension application proofs are recorded
[here](stripe-d1-ingress-validation.md).
This is the implementation boundary for issue #32 under parent issue #28.

The design starts with the current Supabase/Postgres system and keeps the
same logical tables and invariants portable to D1. A Stripe webhook is treated
as an authenticated input to a durable workflow. The HTTP receipt and the
business application are separate stages, but the receipt dispatch and the
business state transition each have a transaction boundary that can be
retried.

The checked-in implementation uses Stripe API version
2025-08-27.basil in the webhook and billing functions. The live endpoint's
selected version, enabled events, live/test parity, and whether an event
destination exists still require an operations readback before receipt
takeover; see the separate [live observations](live-observations.md). A
checked-in source file or a generated type is not evidence that current
production has the same handler, endpoint configuration, or data.

## Required invariants

1. Verify the raw request body and Stripe-Signature before inserting a receipt
   or changing any application row. An invalid signature leaves no durable
   application record.
2. The event ID is unique. A second delivery of the same event cannot create a
   second committed business effect. Retries may create or reclaim processing
   attempts, but they reuse the same receipt/effect identity.
3. A paid license extension is also unique by Checkout Session ID. The
   completed and asynchronous-success events for one session share one
   application key. Distinct successful sessions have distinct keys and each
   adds its own months.
4. A receipt is acknowledged only after its receipt row and durable dispatch
   job commit. A database outage, failed commit, or failed durable enqueue
   returns a retryable 5xx. A signed event must never be acknowledged merely
   because its JSON was parsed.
5. A business application is complete only in the same committed transaction
   as its authoritative row changes, audit rows, and queued notification
   work. There is no completed marker before that transaction commits.
6. Stripe object order is not inferred from event.created. Subscription and
   invoice work is serialized by Stripe customer and protected by a fencing
   generation. The worker retrieves current Stripe state before applying the
   projection.
7. A Stripe customer is linked to a local user only through an existing
   immutable mapping: the local stripe_customer_id relation, a Stripe Customer
   metadata user_id that has been checked against the local account, or an
   explicit operator-reviewed linkage. An email match alone never merges or
   reassigns an account.
8. An external send is made only after the database transaction commits. Every
   retry uses a stable outbox idempotency key and records the provider result.
9. An unpaid, failed, expired, or unapproved delayed extension Checkout
   Session never grants license time. The current paid flow requires a
   positive JPY total equal to the server-selected expected amount; a
   zero-total Session cannot grant time under the current product policy.
10. A stale license owner cannot resurrect a license. The application
    transaction rechecks the current owner and allowed status while locking the
    license row.

Stripe's official webhook guidance says signatures require the raw body,
events can be retried and delivered out of order, duplicate events should be
tracked by event ID and object/type, and asynchronous processing should use a
queue. The receipt-first acknowledgment rule above adds the project's
lossless-persistence requirement: persist the queue job before returning 2xx.
See [Stripe webhook guidance](https://docs.stripe.com/webhooks),
[undelivered event processing](https://docs.stripe.com/webhooks/process-undelivered-events),
and [Checkout Session payment status](https://docs.stripe.com/api/checkout/sessions).

## What the current code does

The following is the current checked-in behavior. It does not establish that
the same handler or endpoint configuration is live in production.

| Current path | Current side effects | Durable workflow consequence |
| --- | --- | --- |
| handle-stripe-webhook, signature and client setup ([source](../../supabase/functions/handle-stripe-webhook/index.ts)) | Reads raw request bytes under a 256 KiB limit, verifies Stripe-Signature, then creates a service-role Supabase client. The Stripe client is pinned to Basil. | Keep signature verification first and return 2xx only after the durable application reaches a checked terminal state. |
| extension Checkout Session events ([source](../../supabase/functions/handle-stripe-webhook/index.ts), [application migration](../../supabase/migrations/20260925120000_add_stripe_extension_application.sql)) | Persists a redacted receipt, then calls a service-only transaction for completed, asynchronous success/failure, and expired sessions. The effect is unique by live/test mode plus Checkout Session ID. The transaction checks paid amount/currency and current license/fanmark/transfer state, then updates the license, cancels pending lottery rows, writes both audits, enqueues one notification per applicant, and terminalizes its application/receipt/dispatch. | Offline PGlite and local Miniflare tests cover the SQL and D1 application. The D1 Checkout creator and scheduled extension dispatcher exist locally, but remain disabled and unconnected in staging. Add subscription/invoice projection, independent Postgres concurrency tests, monitored late-payment reconciliation, and staging rehearsal before treating this as complete. |
| subscription.created and subscription.updated ([source](../../supabase/functions/handle-stripe-webhook/index.ts#L336-L456)) | Resolves the user from stripe_customer_id and then has an exact-email Auth fallback; maps the first subscription item to a configured plan; upserts user_subscriptions; for active status sets user_settings.plan_type and clears payment failure fields. | Use immutable customer linkage, retrieve current Stripe state, serialize by customer, and fence the commit. Do not let a stale event or a stale worker overwrite a newer subscription state. |
| subscription.deleted ([source](../../supabase/functions/handle-stripe-webhook/index.ts#L458-L526)) | Reads the local user, deletes user_subscriptions, lists one active Stripe subscription, sets free only when none remains, then calls enforceFreePlanLimit. The helper orders license_start descending and slices the first excess rows, so the checked-in behavior returns the newest excess licenses one at a time; each return performs separate writes. | Keep a subscription tombstone and reconcile all relevant customer subscriptions. If the customer has no qualifying subscription, set free and perform deterministic limit returns, audit, and notification queue inserts in one retryable application transaction. Preserve the current newest-excess policy unless Product explicitly changes it. |
| invoice.payment_failed and invoice.payment_action_required ([source](../../supabase/functions/handle-stripe-webhook/index.ts#L528-L570)) | Resolves a user, then writes payment_failure_at, next_payment_attempt, and payment_failure_type. An update error is logged and the handler still returns 200. | A failed application remains retryable. Preserve the three fields, fence them against a newer invoice state, and do not acknowledge a persistence failure. |
| invoice.payment_succeeded ([source](../../supabase/functions/handle-stripe-webhook/index.ts#L572-L606)) | Resolves a user and clears payment failure fields. An update error is logged while the outer handler still returns 200. | Clear failure state only when the current invoice/subscription reconciliation says this success is authoritative. A stale success must not erase a newer failure. |
| all other event types ([source](../../supabase/functions/handle-stripe-webhook/index.ts#L608-L624)) | Logs an unhandled type and returns 200. | Persist unknown or currently ignored event metadata as a receipt. Mark it ignored only after the receipt is durable, so event selection can be audited without accidentally granting state. |
| paid checkout creation ([source](../../supabase/functions/create-extension-checkout/index.ts), [local intent migration](../../supabase/migrations/20260925120000_add_stripe_extension_application.sql)) | A browser request ID maps to a service-only local intent before Stripe is called. The intent snapshots the owner, license, tier, months, Price ID, and positive JPY amount. Checkout metadata carries the intent and Price IDs; a key derived from the intent ID is passed to Stripe. The returned Session ID is attached under a live/test unique key and reused on retry. A parallel Worker/D1 endpoint and frontend client are now implemented behind unset selectors. | PGlite verifies same-request replay, payload conflict, immutable price snapshot, one-Session binding, webhook-to-intent matching, stale-owner rejection, and client ACLs. Four Miniflare D1 and five client tests cover the new Worker path with a fake Stripe client. A missing Session after the conservative 20-hour retry window enters reconciliation instead of creating another Session. This remains local-only; independent Postgres concurrency coverage and monitored reconciliation remain open. |
| plan checkout creation ([source](../../supabase/functions/create-checkout/index.ts#L65-L154)) | Looks up or creates a Stripe customer, including an email search fallback, and creates a subscription Checkout Session with client_reference_id. There is no explicit idempotency key or local command row. | Link by stored customer ID or explicit metadata mapping; remove email-only merge; record the command and use a stable idempotency key for customer/session creation. Subscription entitlement still comes from reconciled subscription events. |
| plan change ([source](../../supabase/functions/change-subscription/index.ts#L49-L334)) | Lists a customer by stored ID or email fallback, updates/cancels Stripe subscriptions, creates Portal sessions for required action, and relies on webhooks for the durable mirror. There are no visible idempotency keys. | Give each user command a local command ID and stable Stripe idempotency key. Treat the webhook reconciliation as the source of the local plan state; do not mark the requested plan as applied from the HTTP response alone. |
| direct extend-fanmark-license ([source](../../supabase/functions/extend-fanmark-license/index.ts#L233-L360)) | A separate license-extension operation updates the license and also writes an audit row, cancels pending lottery entries by license_id, creates lottery-cancel notifications, and writes a cancellation audit through separate calls. | Treat it as a separately authorized product command with an explicit billing source, identity, and idempotency boundary. It must use the same locked license transition and command ledger, but must not be confused with paid Checkout fulfillment. |
| return helper used by the free-limit path ([source](../../supabase/functions/_shared/return-helpers.ts#L41-L297)) | Transitions an active license to grace, writes return audit, and enqueues owner/favorite notification events with dedupe keys. These are separate calls and notification/audit failures can be logged after the license update. | Move the transition, audit, and notification-event inserts into one database transaction. Keep the existing dedupe semantics and make a failed transaction retryable. |

Product constraints that the application transaction must carry forward are
documented in [PRODUCT.md](../PRODUCT.md#L73-L85) and its extension matrix
([PRODUCT.md](../PRODUCT.md#L310-L322): Free 3, Creator 10, Max 500,
Business 50; active/grace extension; expired and Tier C no extension;
transfer-in-progress blocked; Admin's extension is a separate free path).
The intent/application boundary must recheck finite-license and active-transfer
constraints at fulfillment, even if an earlier request check ran. A payment
that arrives after a plan-limit or transfer change needs an explicit policy
rather than silently charging and discarding the grant. PRODUCT expects
lottery cancellation notifications
([PRODUCT.md](../PRODUCT.md#L501-L507)). The local paid-checkout transaction
now enqueues one notification per canceled applicant and writes a separate
lottery-cancellation audit, matching the product contract and direct extension
path. The earlier webhook omitted these effects; this local change is not
deployed.

The current schema supports the related business rows: fanmark_licenses
contains owner, status, end, grace, returned, and exclusion fields
([remote_schema.sql](../../supabase/remote_schema.sql#L2576-L2594));
fanmark_lottery_entries contains the license relation, pending state, and
cancellation fields ([remote_schema.sql](../../supabase/remote_schema.sql#L2604-L2621));
user_subscriptions is the local Stripe mirror
([remote_schema.sql](../../supabase/remote_schema.sql#L3049-L3066)); audit_logs
is append-oriented metadata ([remote_schema.sql](../../supabase/remote_schema.sql#L2334-L2343));
and notification_events is an existing retryable queue with a dedupe_key
([remote_schema.sql](../../supabase/remote_schema.sql#L2816-L2833)). The
current unique constraint is only user_id plus stripe_subscription_id
([remote_schema.sql](../../supabase/remote_schema.sql#L3394-L3401)); the design
adds a Stripe subscription identity and history rule rather than deleting a
row on cancellation.

## Durable Supabase-first model

The receipt/dispatch foundation and Checkout Session extension effect table
are defined in local-only migrations. They have not been applied remotely.
The broader ledger, command, intent, and customer-fence tables below remain
design guidance. All billing-private tables should be inaccessible to
anonymous and ordinary authenticated clients; webhook and worker paths use a
narrow internal operation. The event payload may contain customer data, so if
the raw body is retained it must be encrypted/private with a separately
reviewed retention period. The public design records fields and hashes, never
customer rows, credentials, or payload examples.

### 1. stripe_webhook_receipts

One row represents one signed Stripe Event delivery.

| Field | Requirement |
| --- | --- |
| receipt_id | Local UUID/ULID. |
| stripe_event_id | Required, unique, immutable. This is the exact-delivery dedupe key. |
| event_type, event_created_at, api_version, livemode | Normalized envelope fields. Store api_version from the event, not only the current client setting. |
| object_type, object_id | ID and type from data.object when present. Keep nullable for valid events without an object. |
| stripe_customer_id, stripe_subscription_id, stripe_invoice_id, stripe_checkout_session_id | Nullable normalized foreign identifiers for routing and observability. |
| payload_sha256, normalized_payload, normalized_schema_version | Hash of the raw body plus a private, schema-versioned normalized snapshot containing every field required to route and replay the application (metadata, payment state, relationships, and relevant amount/discount values). The normalized snapshot is retained for the receipt repair window; do not rely indefinitely on Stripe's event-retrieval window. |
| raw_payload_ciphertext | Optional encrypted raw body for signature forensics/replay, with separately reviewed retention. Never put it in logs. |
| signature_verified_at, received_at | Evidence that authentication happened before persistence. |
| status | received, processing, retryable, applied, ignored, or dead_letter. A terminal status includes a result code such as applied, superseded, rejected_stale_owner, or unsupported. |
| attempt_count, lease_token, lease_until, next_attempt_at | Atomic worker claim and retry fields. |
| last_error_code, last_error_at, handler_version, applied_at | Bounded diagnostics and deploy compatibility. Do not store secrets or full user data in error strings. |

The ingress transaction inserts the receipt with an event-ID unique constraint
and inserts a dispatch outbox row with key stripe-webhook:<event ID>. On a
unique conflict, a terminal receipt returns 2xx because the durable work has
already finished; a nonterminal receipt is re-queued if needed and returns 2xx
only because the prior transaction already committed durable work. If the
receipt or its dispatch row cannot commit, return 5xx. A unique conflict is
not permission to run the business effect again.

### 2. stripe_application_ledger

One row represents one intended business effect, rather than merely one
delivery.

| Field | Requirement |
| --- | --- |
| application_id | Local ID. |
| effect_key | Required unique deterministic key for the business effect. |
| effect_kind | license_extension, subscription_reconcile, subscription_deleted_reconcile, invoice_failure, invoice_success, free_limit_return, or another reviewed kind. |
| source_receipt_id, stripe_event_id | Link to the receipt; source event is evidence, not the ordering authority. |
| stripe_checkout_session_id, stripe_customer_id, stripe_subscription_id, stripe_invoice_id, invoice_attempt_key | Nullable aggregate identifiers; invoice_attempt_key is the defined payment-attempt identity used for later-attempt reconciliation and notifications. |
| local_user_id, license_id, fanmark_id | Nullable local aggregates, set only after an authenticated mapping. |
| status | applying, applied, superseded, rejected, retryable, or dead_letter. |
| fence_generation | Customer/subscription fence used for state projections. |
| input_hash, result_summary, failure_code, attempt_count, timestamps | Detect changed normalized payloads and explain/retry an outcome without copying a full raw body. |

Required uniqueness rules:

- Every source event has one receipt by stripe_event_id.
- A license extension has effect_key license-extension:<Checkout Session ID>
  and a partial unique index on the extension Session ID. The
  checkout.session.completed and checkout.session.async_payment_succeeded
  events therefore compete for one application row.
- Each subscription receipt creates a reconciliation row keyed by source event
  ID plus effect kind. Customer serialization and the fence determine which
  current Stripe projection can commit; a later receipt may supersede an
  earlier snapshot, but it cannot be silently lost or deduplicated by
  event.created.
- Every invoice receipt gets its own invoice application row keyed by source
  event ID plus effect kind. Event-ID dedupe prevents replaying one delivery,
  while a later event for the same invoice creates a new reconciliation row
  and is fenced against current Stripe state; invoice ID alone must never
  suppress a later payment attempt or changed next_payment_attempt.
- Derive an invoice_attempt_key from the Stripe payment-attempt/payment-intent
  identity and attempt outcome. If Stripe does not provide one in the
  snapshot, use invoice ID plus attempt_count and the normalized outcome; if
  neither is available, use the source event ID and require reconciliation.
  Notification outbox keys use this defined attempt key, not only invoice ID.
- A free-limit return has a stable reconciliation ID plus license ID. The
  active-to-grace conditional transition is also the final guard, so a retry
  cannot create another return for an already returned license.
- Separate Checkout Sessions always have separate extension effect keys. A
  transaction lock on the license makes their end-date calculation additive:
  the second committed application uses the first application's new end.

An application row is never changed to applied before the related business
transaction commits. The row, receipt terminal status, authoritative business
rows, audit entries, and in-app notification queue inserts are committed
together. A worker crash rolls them all back or leaves a retryable leased row.

### 3. stripe_outbox

This is the durable dispatch table for work that must happen after the
business transaction.

| Field | Requirement |
| --- | --- |
| outbox_id, kind | Local ID and webhook-dispatch, stripe-command, notification-dispatch, or external-send. |
| idempotency_key | Required unique key for the intended external operation, for example stripe-webhook:<event ID>, resend:payment-failed:<invoice-attempt-key>, or stripe-command:<local command ID>. |
| aggregate IDs and payload reference | Identify the effect without putting sensitive payload in logs. Payload is private and versioned. |
| status, available_at, attempt_count, lease_token, lease_until | Claim/retry state. |
| provider_request_id, provider_message_id, sent_at, last_error | Idempotent provider readback and bounded diagnostics. |

The webhook dispatch row is inserted with the receipt. Audit rows and
notification_events are inserted with the application transaction. An
external mail or provider call is made only by a committed outbox worker. If
the worker crashes after the provider accepted a request and before sent_at
is stored, it retries the same idempotency key and reconciles the provider
request/message ID. If the provider has no idempotency support, the worker
must use a deterministic provider-visible message key and a reconciliation
lookup before retry; an at-least-once send without such a key is not an
acceptable completion criterion.

The existing notification_events table remains the application-facing
in-app notification queue. Its existing dedupe_key is preserved. The new
outbox is the wakeup and external-delivery boundary; it does not replace
notification history without a separate product decision.

### 4. billing_checkout_intents

A local intent is required before creating an extension Checkout Session.

| Field | Requirement |
| --- | --- |
| intent_id, request_id | Local IDs; `(user_id, request_id)` is unique for one user command. |
| user_id, license_id, fanmark_id, owner_snapshot | Identity and target captured from the authenticated request. |
| months, tier_level, price_id, currency, expected_subtotal, expected_total, discount_policy, allow_zero_total, livemode | Server-side price and discount decision used to create the Session. |
| stripe_checkout_session_id | Nullable until Stripe returns; unique when present. |
| status | created, open, awaiting_payment_confirmation, applied, expired, failed, or blocked_stale_owner. |
| stripe_payment_status, stripe_session_status, applied_application_id | Last observed Session state and link to the application ledger. |
| created_at, updated_at, failure_code | Retry and review metadata. |

The intent is committed before calling Stripe. The Checkout metadata contains
the intent ID, Price ID, and immutable target IDs. Stripe
checkout.sessions.create uses a stable key derived from the intent ID, which
is unique per authenticated user request. A retry first reads the intent and
reuses its snapshotted Price ID and amount; if a Session ID is already bound,
the creator retrieves and returns that same open Session. The webhook can bind
the Session from signed metadata if it arrives before the creator stores the
response. Stripe may prune keys after they are at least 24 hours old, so the
intent stops automatic creation after 20 hours if no Session ID was recorded
and requires reconciliation instead of risking a second payment Session.
The Checkout Session ID is unique per live/test mode. [Stripe documents the
key retention behavior](https://docs.stripe.com/api/idempotent_requests).

The plan Checkout flow should use an analogous billing command row even though
it does not itself grant an extension. The subscription event remains the
entitlement source. Customer creation, Checkout creation, subscription
update/cancel, and Portal-session creation each receive a command ID and a
stable Stripe idempotency key. See [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

### 5. stripe_sync_fences

One row per Stripe customer is the serialization boundary for subscription
and invoice projections.

| Field | Requirement |
| --- | --- |
| stripe_customer_id | Unique scope key. |
| generation | Monotonically increasing fence token. |
| owner_token, lease_until | Worker lease; a newer claimant invalidates an older worker. |
| pending_reconcile_id, last_observed_at, last_applied_at | Queue and observability state. |
| last_subscription_snapshot_hash, last_invoice_id, last_invoice_attempt_key, last_error | Compact state evidence, with no raw payload. |

A worker claims the customer in a short transaction, increments generation,
and receives the token. It retrieves the current Stripe customer,
subscriptions, or invoice outside the database transaction. It then commits
the projection only when the token is still current. A newer event can advance
the generation while an older worker is retrieving data; the old worker's
conditional commit fails and it is marked superseded/requeued. This is
customer serialization with fencing, not a comparison of event.created
timestamps. The same logical structure maps to a D1 lease row and a
conditional UPDATE.

## Processing flows

### Signed ingress

1. Read the raw request body and Stripe-Signature.
2. Verify with the official Stripe library configured for the endpoint secret.
   Do not parse, normalize, or persist a business payload before this check.
3. Parse only the event envelope and safe routing identifiers. A Basil event
   with an unknown type still gets a receipt.
4. In one Supabase/Postgres transaction, insert the receipt by event ID and
   insert/update its webhook-dispatch outbox row. Persist the body hash and a
   versioned normalized snapshot containing the fields needed for deterministic
   replay; store encrypted raw payload only if the forensic replay policy
   requires it.
5. Return 2xx after commit. Return 5xx on any database or durable-dispatch
   failure, allowing Stripe retry. Return 4xx for an invalid signature or
   malformed request that cannot be authenticated.

Stripe recommends a quick 2xx response and asynchronous processing. The
endpoint therefore does only signature verification, normalized receipt
persistence, and durable dispatch. The project-specific exception is that
the 2xx is delayed until that persistence transaction commits; complex
business calls stay in the worker.

### Receipt worker

1. Claim one nonterminal receipt with a lease token. An expired lease is
   retryable; an active lease is not processed concurrently.
2. Normalize the event using its api_version and event type. For a stateful
   Stripe aggregate, retrieve the current Stripe resource before the
   application transaction.
3. Resolve the local user from the immutable customer mapping. If no mapping
   exists, create a rejected/dead-letter application record and an operator
   task; do not search Auth by email and do not mutate a license or plan.
4. Create the effect row by its deterministic effect key. If it is already
   applied, mark this receipt applied with duplicate result and stop. If a
   different event points to the same current aggregate, reconcile rather
   than blindly repeating the effect.
5. Start the business transaction. Lock the aggregate rows, recheck identity
   and status, apply the state transition, insert audit and notification
   events, insert any post-commit outbox rows, mark the effect applied, and
   mark the receipt applied.
6. Commit. Only after commit may the worker acknowledge its queue item and
   dispatch external outbox work. On any failure, roll back the business
   changes, retain the receipt/effect as retryable, and record a bounded error.

### License extension payment

The application handler accepts an extension only when:

- the intent and Session metadata agree on intent, license, fanmark, user, tier,
  and allowed month count;
- mode is payment, the Session status is complete, and payment_status is paid;
- the payment is in the same live/test mode as the intent;
- the current license row is still owned by the intent user and is active or
  grace, subject to the existing product rules;
- the license is finite (not Tier C with license_end null), has no active
  transfer request/lock, and remains eligible under the explicit limit policy;
- the current license row is locked in the transaction.

checkout.session.completed with unpaid remains awaiting_payment_confirmation.
The async payment success event rechecks the current Session
and may then apply the same effect key; async payment failure and
checkout.session.expired close the intent without any grant. Stripe also
defines no_payment_required as a legitimate Checkout state, but the current
product specification routes free Admin extensions outside Stripe. The paid
extension Checkout therefore requires a positive integer JPY price and rejects
zero-total Sessions. A future zero-total Stripe path needs an explicit product
rule and a server-side intent that records that authorization.

At intent creation, persist the expected price, currency, subtotal/total,
discount or coupon authorization, and an explicit allow_zero_total flag
derived from server-side pricing rules. At fulfillment, retrieve the current
Session and verify metadata, mode, currency, amount_total, discount
identifiers, and the allow_zero_total policy. The current paid extension route
stores a positive expected JPY total and sets allow_zero_total=false; a
no_payment_required Session cannot fulfill it. A future zero-total path must
record explicit authorization in the intent and use a bounded reconciliation
deadline. See the [Checkout Session payment_status reference](https://docs.stripe.com/api/checkout/sessions).

Within the committed application transaction:

1. Lock billing_checkout_intents and the target fanmark_licenses row.
2. If current user_id differs from the intent owner, or is null, mark
   blocked_stale_owner and do not update the license. A prior owner cannot
   resurrect a transferred, deleted, or reassigned license.
3. If the status is no longer an allowed active/grace state, mark rejected or
   manual review according to the explicit expiry policy. Do not silently
   turn an expired row active.
4. Set base time to the later of the current committed license_end and now,
   add the purchased months, and apply the current UTC-midnight rounding rule.
5. Set active, clear grace_expires_at/is_returned/exclusion fields as the
   current handler intends. The update must be conditional on the locked
   owner and allowed status.
6. Cancel the intended pending lottery entries and record the cancellation
   audit. The paid webhook currently cancels by fanmark_id; the direct
   extension endpoint cancels by license_id. Preserve the selected product
   boundary deliberately and test it; do not allow a stale owner to cancel
   another owner's entries.
7. Insert the LICENSE_EXTENDED audit row with the Session ID and application
   ID. A duplicate application cannot insert a second row.
8. Mark the intent, application, and receipt in the same commit.

Two distinct paid Sessions are two distinct application rows. Row locking and
the later-of-current-end-or-now calculation make parallel purchases additive;
last-writer-wins updates are prohibited.

### Subscription and invoice reconciliation

For subscription.created, subscription.updated, and subscription.deleted:

1. Normalize customer and subscription IDs from the event.
2. Resolve the local user through the stored customer relation or verified
   Customer metadata. Missing mapping is reviewable failure, never an
   email-only merge.
3. Queue one customer reconciliation. The worker claims a new fence generation.
4. Retrieve the current subscription and the customer's current subscription
   list. For deletion, retain a local tombstone with the canceled/deleted
   state and reconcile all remaining subscriptions before changing plan_type.
5. In the fenced transaction, upsert the subscription projection, including
   current period, price/product, cancellation state, and status. Add a unique
   Stripe subscription identity rule so a historical canceled row is not
   confused with a new user row.
6. Derive user_settings.plan_type from the authoritative qualifying
   subscription set. Do not set free while a qualifying subscription remains.
   The exact qualifying status set (currently the code lists active only) is an
   unresolved product decision and must be tested before implementation.
7. Clear payment failure fields only when the current subscription/invoice
   state makes the success authoritative. A stale success does not erase a
   newer failure.
8. If no qualifying subscription remains, apply the free-plan limit transition
   in the same application transaction.

For invoice.payment_failed and invoice.payment_action_required, normalize
invoice.customer and resolve the subscription through the versioned Invoice
relationship rule below. Retrieve the current invoice/subscription when
required. Write payment_failure_at, next_payment_attempt, and
payment_failure_type only under the customer/subscription fence. For
invoice.payment_succeeded, clear those fields only when the invoice is current
and paid according to the retrieved state or the current subscription's latest
invoice relation. If the invoice is historical, its relationship is ambiguous,
or its relationship shape conflicts, retain the failure and enqueue
reconciliation instead of clearing it.

The current webhook writes no external payment-failure email. The outbox is
ready for a later product decision, but this design does not invent a new
customer notification.

### Free-plan limit and return side effects

The current deletion path sets free only after listing active Stripe
subscriptions and then calls enforceFreePlanLimit. That helper reads the
configured free limit, orders active non-expired licenses by license_start
descending, and returns the first excess rows. Therefore the checked-in
behavior returns the newest excess licenses, not the oldest. The return helper
changes the license to grace and creates:

- a return audit row;
- an owner notification event with a stable dedupe key;
- one favorite-available notification per favorite with a stable dedupe key.

The replacement transaction must:

1. Reconcile the customer's subscription set under its fence.
2. Lock the user's relevant license rows in deterministic order, preserving
   the current license_start-descending order and first-excess selection unless
   Product explicitly changes that policy.
3. Determine the free limit from system settings. The current helper falls
   back to 3 when the setting read errors; the billing worker should not
   silently mutate many licenses on a configuration read failure. Choose and
   document an explicit fallback before implementation.
4. Set plan_type free only when no qualifying subscription remains.
5. For each excess active license, conditionally transition active to grace,
   write the return audit, and insert the owner/favorite notification events
   with their existing dedupe keys.
6. Insert the per-license free_limit_return application rows and commit all
   state plus queue inserts together. A retry sees the already-grace state and
   does not return it twice.

This preserves the current path while removing its partial-success behavior.
If a multi-license transaction is too large for operational limits, use one
deterministic per-license application transaction after a committed
subscription reconciliation, with an explicit state showing which returns
remain; do not silently swallow errors as the current loop does.

## Basil event compatibility

Keep the configured Stripe client and destination at
2025-08-27.basil during this migration. Do not reinterpret an old event using
the current SDK's type declarations. Stripe says a snapshot Event's structure
is fixed by the API version at event creation/destination configuration and
stores the version in event.api_version; event.created is not an ordering
token. See the [Event API reference](https://docs.stripe.com/api/events) and
[Stripe webhook versioning guidance](https://docs.stripe.com/webhooks#api-versioning).

Stripe's [Basil invoicing change](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects)
introduced `Invoice.parent` and says Invoice consumers must use
`invoice.parent.subscription_details.subscription` after checking that
`invoice.parent.type` is `subscription_details`; the deprecated top-level
Invoice subscription field was removed from that version's REST shape. The
[2025-08-27.basil Invoice reference](https://docs.stripe.com/api/invoices/object?api-version=2025-08-27.basil)
continues to expose `parent`. Therefore the Basil adapter uses the nested
parent path as its primary relationship and treats the old top-level field as
a compatibility input for a legacy event snapshot only.

The normalizer should accept these Basil-compatible forms:

- data.object may be absent for an event that is valid but not handled;
  object ID/type remain nullable.
- customer and ordinary subscription relationships may be IDs or expanded
  objects. For an Invoice in a Basil snapshot, require
  `parent.type === "subscription_details"` and resolve the subscription from
  `parent.subscription_details.subscription`; accept its string ID, or an
  explicitly expanded object only after extracting a non-empty `object.id`.
  The legacy top-level `invoice.subscription` path is accepted only by an
  adapter for an event snapshot whose `event.api_version` predates the Basil
  parent-field change. If both paths are present, their normalized IDs must
  match; a disagreement, wrong parent type, or malformed nested value is a
  rejected/reviewable shape error with no invoice mutation. A Basil payload
  without the nested path does not guess from line items; a legacy payload
  without either path is recorded as no-subscription and reconciled.
- Subscription items may contain expanded price objects. The current product
  expects one relevant price; multiple items require an explicit policy rather
  than silently selecting an arbitrary first item.
- Checkout Sessions expose separate status and payment_status values. Use
  payment_status for fulfillment and status for lifecycle/expiry.
- next_payment_attempt may be a Unix timestamp or null.
- Unknown event types and unknown fields are recorded as receipts and routed
  to an ignored/reviewable result; they must not crash the dedupe path.

The parser should be fixture-tested with event.api_version set to Basil and
with a legacy snapshot shape that can still arrive during retry. A resource
retrieval used for reconciliation is version-pinned and its response is
normalized into the internal shape; it does not rewrite the original receipt.
The current live endpoint selection remains unverified.

## Actionable implementation units and tests

| Unit | Implementation boundary | Required tests |
| --- | --- | --- |
| Remaining application ledger and intent | Add the general private application/outbox/intent/customer-fence model beyond the local extension-session effect table; unique indexes and internal access path. The receipt/dispatch tables and event-ID boundary are covered by the [receipt foundation](stripe-receipt-validation.md). | Event ID and effect uniqueness; concurrent insert leaves one receipt/dispatch row; intent/session recovery. |
| Signed ingress (extension route wired locally) | Keep raw-body verification first; normalize envelope; transactionally insert receipt plus dispatch outbox; return 5xx on commit/application failure. Other billing event paths and unknown-event receipt policy remain open. | Invalid signature leaves no receipt; valid event with DB failure returns retryable 5xx; duplicate terminal/nonterminal delivery does not apply twice. See the [offline ingress validation](stripe-ingress-validation.md) and [extension application validation](stripe-extension-application-validation.md). |
| Worker lease (PostgreSQL and D1 claim/renew/retry primitives are local) | The D1 scheduled dispatcher now applies extension events, retries transient failures, and dead-letters unsupported billing events for review. Staging Cron/selectors remain off; operator recovery runbook remains open. | Crash before commit retries; active lease prevents double worker; expired lease can be reclaimed; receipt is not terminal until application commit. See the [dispatch lease validation](stripe-dispatch-validation.md) and [D1 validation](stripe-d1-ingress-validation.md). |
| Extension intent and command (local PostgreSQL and D1 implementations) | Persist intent before Stripe call; pin active master price; attach/recover Session ID using an intent-derived idempotency key. The local D1 API requires Better Auth and matching D1 webhook/dispatch configuration. | PGlite and four Miniflare cases cover replay, changed-request rejection, immutable pricing, one-Session binding, grace plan limit, and owner checks. Five client contract tests cover the opt-in Worker client. A lost Stripe response with no Session ID remains reconciliation-only after 20 hours. No real Stripe request or staging selector is enabled. |
| Paid extension application (local PostgreSQL transaction and D1 application slice implemented) | D1 checkout creation snapshots a matching private intent; the scheduler connects signed extension receipts to the application transaction. | PostgreSQL covers session-keyed idempotency and atomic business effects. D1 local Miniflare covers positive JPY payment, same-session replay and competing receipts, unpaid then async success, expired/failed sessions, stale owner, transfer lock, and injected audit rollback. Remote staging, subscription/non-extension events, and manual reconciliation remain open. See [D1 validation](stripe-d1-ingress-validation.md). |
| Subscription reconciliation | Customer queue, current Stripe retrieval, generation fence, tombstone upsert, authoritative plan derivation. | Updated then deleted and deleted then updated converge to current Stripe state; an old fence cannot overwrite a new one; multiple subscriptions prevent premature free; no mapping never merges by email. |
| Invoice projection (D1 Worker processor deployed to staging but disabled) | Basil relationship normalizer and current invoice/subscription check; customer generation fence; transactional non-granting D1 projection. | Same event ID is applied once; a later attempt for the same invoice is reconciled rather than suppressed; Basil relationship fixtures, exact customer/subscription mapping, failure/action-required/paid state, stale event ordering, rollback/retry, expired lease, and concurrent fence cases are covered. D1 application changes only `user_subscriptions` payment state, never plan or license entitlements. Empty staging schema is applied and Worker code is deployed, but Stripe selectors/secrets remain unset; subscription entitlement and free-plan-return event paths remain open. See the [D1 validation](stripe-d1-ingress-validation.md) and [offline validation](stripe-invoice-projection-validation.md). |
| Free-plan return transaction | Current license_start-descending order and first-excess selection, conditional active-to-grace transition, audit and existing notification-event dedupe. | No qualifying subscription sets free and returns the newest excess licenses under current behavior; one transaction failure leaves no partial return; retry returns no license twice; owner/favorite dedupe keys remain stable. |
| External outbox | Post-commit provider worker, stable idempotency key, provider result reconciliation, retry/backoff. | Crash after provider acceptance does not send a second logical message; retryable provider error keeps row pending; receipt dispatch is durable before 2xx. |
| Outbound Stripe commands | Command ID for customer/create Checkout/update/cancel/Portal calls; stable idempotency keys; webhook remains state source. | retrying each command returns the same Stripe result; client timeout does not create a second customer/session; HTTP success alone does not set entitlement. |
| Basil fixtures and observability | Store versioned normalized replay fields plus hash/error result fields without raw user data in logs; add runbook for receipt replay and manual review. | Basil snapshots, legacy retry snapshot, expanded/unexpanded references, unknown event type, duplicate object/type event, changed payload hash, same-invoice later attempt, and authorized zero-total Session. |

## Supabase and D1 transaction boundary

Supabase's current JavaScript data API calls are separate requests. They
cannot make a license update, audit insert, lottery cancellation,
notification insert, ledger update, and receipt completion atomic by chaining
awaits. The Supabase implementation therefore needs one server-only SQL
transaction: either a narrowly scoped stored procedure/RPC invoked once by the
worker, or a server-side Postgres transaction path. The RPC must validate
internal caller context, lock rows in a fixed order, and expose only a
minimal result. A worker must not mark a receipt complete after making
several independent REST writes.

The Supabase rollout needs migrations for the private billing tables and
indexes, an internal worker/cron invocation, a retention policy for receipt
payloads and errors, and a verified Stripe endpoint secret/API-version/event
selection. It also needs a controlled cutover so the old handler and new
handler cannot both apply the same events. No production migration or
endpoint change is part of this document.

D1 can keep the same logical schema and effect keys with text IDs. Timestamptz
values for application tables must use fixed-width UTC text that preserves the
source microsecond precision, as required by the [schema conversion
rules](schema-conversion.md#representation-decisions-for-implementation); do
not round-trip them through JavaScript `Date` or prescribe millisecond
timestamps. An integer-microsecond encoding is a future option only after a
range proof and an end-to-end exact bigint binding test; this design does not
make that claim. Use D1's batch API (`env.DB.batch(...)`) for each atomic group of
SQL statements; do not issue `BEGIN`/`COMMIT` or rely on an interactive
JavaScript transaction from Worker code. Every batch statement that claims or
applies work must carry unique or conditional guards for the effect key,
receipt status/lease token, owner/status, and fence generation. Treat a batch
conflict as retry/reconcile, rather than assuming a stale read can be
serialized later. Lease/fence rows and scheduled/queue dispatch replace
Postgres row locks, RPCs, and triggers with explicit guarded statements. The
receipt/application/outbox contracts should remain unchanged so a later D1
move does not change Stripe's dedupe or fulfillment semantics.

## Rollout, reconciliation, and open decisions

Before implementation:

- Confirm the live webhook endpoint, signing secret ownership, API version,
  enabled events, live/test mode, and whether a second endpoint is active.
- Decide the qualifying subscription statuses for plan entitlement, including
  trialing, past_due, unpaid, paused, and cancellation-at-period-end.
- The current product rule says free Admin extensions bypass Stripe. Keep the
  paid extension route positive-priced and reject
  payment_status=no_payment_required; any future zero-total coupon path needs
  an explicit product decision and intent policy.
- Confirm whether the current fanmark-wide lottery cancellation in the webhook
  and license-scoped cancellation in the user extension operation are
  intentional; define one parity rule.
- Define the exact expired/grace/returned behavior for a paid Session whose
  owner changed or whose license expired while payment was pending.
- Define how Stripe Customer metadata and local stripe_customer_id are
  repaired when neither side has an immutable mapping. Email-only repair is
  excluded.
- Decide whether payment failure/recovery sends email or only updates the
  local subscription mirror. No new email is assumed here.
- Decide receipt normalized-payload retention/redaction and raw-payload
  encryption/operator access. The private normalized snapshot must remain
  replayable through the repair window; the public repository contains only
  field definitions, hashes, and metadata, never payload data.
- Verify provider support for idempotency/reconciliation for Resend and any
  future external sender.
- Define reconciliation/backfill rules for historical events. Stripe's
  official undelivered-event flow covers recent events only; the Events API
  documents a 30-day retrieval window. Older state needs a current Stripe
  object reconciliation or a reviewed database repair, never blind replay.
- Keep a local Stripe command/result row beyond Stripe's idempotency-key
  retention window. A retry after provider-key pruning must first reconcile
  the known provider object/request ID; it must not blindly issue a new
  customer, Session, or subscription mutation.

Cutover should first run receipt capture and reconciliation in a shadow or
review-only mode, compare effects, then switch one verified endpoint to the
new applying worker. Existing rows must be reconciled before enabling grants.
The old handler must be disabled for applying work before the new endpoint is
allowed to mutate state. A rollback restores code only after queued receipts,
ledger states, and Stripe endpoint ownership are accounted for; DNS rollback
alone does not undo a committed grant.

Offline implementation evidence already exists for the receipt/dispatch
foundation and RPC, the signed ingress/normalizer adapter, the dispatch
claim/renew/retry leases, the non-granting invoice projection, and one D1
paid-extension transaction; see the validation records linked at the top.
These changes are not applied to Supabase or remote D1, connected to a
scheduled dispatcher, or deployed. Paid Checkout fulfillment remains disabled
until D1 intent creation and dispatch processing are complete. Subscription
reconciliation and free-limit returns, the remaining outbox/intent work, external-send
idempotency, live-settings verification, and production rollout remain
unimplemented and require separate review.

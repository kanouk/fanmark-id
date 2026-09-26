# Stripe signed ingress and receipt adapter

This document records the reusable request-handler and normalizer validation
for migration issue #32 at
[`supabase/functions/_shared/stripe-receipt-ingress/index.ts`](../../supabase/functions/_shared/stripe-receipt-ingress/index.ts).
The standalone factory behavior below remains covered by its tests. The
checked-in `handle-stripe-webhook` now reuses the raw-byte reader, normalizer,
and receipt persister for license-extension events; the separate
[extension-application validation](stripe-extension-application-validation.md)
covers that connection. Neither the local webhook edit nor SQL migration has
been deployed or applied remotely.

## Validation boundary

The factory accepts only `POST` and requires `stripe-signature`. It reads the
request body as bytes from the `ReadableStream`; it does not call
`Request.text()` or parse before signature verification. The default body cap
is 256 KiB and is enforced on each chunk, including when no trustworthy
`Content-Length` is present. A declared length above the cap is rejected
early with 413.

The supplied Stripe SDK's `constructEventAsync` verifies those exact bytes with
the configured endpoint secret, a fixed default timestamp tolerance of 300
seconds, and the handler's clock. A missing, stale, or tampered signature
returns a sanitized 400 and never calls the persistence adapter. The module
does not log request bodies, normalized payloads, secrets, or provider error
messages. Body reads also have a bounded 5-second default; a stalled stream
receives 408 and cancellation is initiated without waiting on an untrusted
cancel hook.

After verification, the event envelope and the known object shape are checked.
Only then does the factory calculate the SHA-256 hash of the raw bytes, build a
schema-versioned normalized object, and call the injected persister. The
persister provided by `createSupabaseReceiptPersister` calls the existing
`public.accept_stripe_webhook_receipt` RPC with these arguments:

| RPC argument | Adapter value |
| --- | --- |
| `p_stripe_event_id` | verified event `id` |
| `p_livemode` | verified event `livemode` |
| `p_event_type` | verified event `type` |
| `p_object_type`, `p_object_id` | bounded `data.object.object` and `data.object.id` |
| `p_api_version` | verified event `api_version`, or null |
| `p_normalized_schema_version` | `1` |
| `p_normalized_payload` | normalized JSON object below |
| `p_normalized_payload_sha256` | SHA-256 of canonical normalized UTF-8 JSON |
| `p_raw_payload_sha256` | SHA-256 of the exact verified request bytes |

The handler waits for a validated durable RPC result before returning 200.
Both the Supabase adapter and the handler validate result cardinality or
structure, IDs, outcome/status consistency, and positive integer delivery count;
a future injected persister cannot bypass the handler's acknowledgement check. The
first receipt, a nonterminal duplicate, and a terminal duplicate are returned
as their RPC outcome. An RPC error, malformed RPC result, or 5-second default
timeout returns 503 so Stripe can retry. No business effect is run by this
module.

## Normalized schema version 1

Every normalized object is a JSON object with these envelope fields:

```json
{
  "schema_version": 1,
  "event": {
    "id": "evt_...",
    "type": "...",
    "created": 1750000000,
    "api_version": "2025-08-27.basil",
    "livemode": false
  },
  "object": { "type": "...", "id": "..." },
  "branch": "checkout_session|subscription|invoice|unknown",
  "reference": { "object_type": "...", "object_id": "..." }
}
```

The `checkout_session` branch retains `id`, mode, status,
`payment_status`, amount and currency, customer, subscription,
`payment_intent`, `client_reference_id`, expiry, and the approved metadata
allowlist. It covers the current completed and asynchronous/expired Checkout
event names so the worker can make a reviewed payment-state decision instead
of assuming that receipt delivery means payment.

The `subscription` branch retains the subscription and customer IDs, status,
top-level period and cancellation/trial timestamps, every bounded item ID,
price/product ID, unit amount, currency, recurring interval/count, item period,
and the approved metadata allowlist. Items are retained as a bounded array; the
normalizer does not silently select a different item as an entitlement.

The current invoice branches (`invoice.payment_failed`,
`invoice.payment_action_required`, and `invoice.payment_succeeded`) retain the
invoice and customer IDs, subscription ID and relationship source, status,
amount fields, currency, `next_payment_attempt`, `attempt_count`, payment
intent ID, bounded discount IDs and amounts, and the approved metadata
allowlist. It also retains whether a parent field was present and its bounded
parent type. API versions dated 2025-03-31 or later use the modern parent
relationship, including later named releases; an unparseable or missing API
version is not treated as a legacy version. For Basil events, the subscription
relationship is read from
`invoice.parent.subscription_details.subscription` when the parent type is
`subscription_details`. For legacy event versions, the top-level
`invoice.subscription` form is supported. If both forms are present with
different IDs, normalization rejects the event. A Basil invoice that only
offers the legacy relationship is rejected instead of guessing. No
line-item-based relationship inference is performed.

An event type outside these current branches stores only the verified
envelope and bounded `data.object` type/ID reference under `branch: "unknown"`.
It cannot grant or mutate anything through this adapter. An incomplete known
object or a conflicting invoice relationship returns 400 and is not persisted.

The metadata allowlist is exactly:

```text
type, user_id, license_id, fanmark_id, months, tier_level, intent_id,
billing_intent_id, request_id, price_id, plan_type
```

Metadata outside that list is discarded. This is a routing/replay snapshot,
not a copy of an arbitrary Stripe object; raw bodies and arbitrary fields are
not retained by the adapter.

## Size and canonicalization limits

The limits are constants in the module and apply before the RPC call:

| Value | Limit |
| --- | ---: |
| Raw request body | 256 KiB |
| Canonical normalized payload | 64 KiB UTF-8 |
| Individual retained string/ID | 256 UTF-8 bytes |
| Allowlisted metadata entries | 16 |
| Subscription items, discount IDs/amounts | 20 each, otherwise reject |
| Persistence wait | 5 seconds |

Canonical JSON sorts object keys recursively, preserves array order, rejects
undefined and non-finite numbers, and is UTF-8 encoded before hashing. Raw
payload hashing is over the exact bytes that were signature-verified. The
database stores the normalized object and both hashes through the existing
service-only RPC; it does not require storing the raw body.

Known replay-critical Stripe lists are rejected when they are over the 20
entry cap or carry `has_more: true`; they are never silently truncated. A
malformed retained relationship ID or a known `data.object.object` type that
does not match its event branch is rejected before persistence. Unknown event
types retain only their bounded reference, so these strict checks do not turn
future unrecognized objects into arbitrary snapshots.

If the normalized shape changes, the implementation must publish a new
positive schema version and a version-specific parser. Existing receipts keep
their original normalized object, version, and canonical hash; a later parser
must not reinterpret version 1 in place or silently recompute a different hash.
Unknown events remain replayable only at the retained envelope/reference
level until a reviewed newer normalizer explicitly supports their fields.

## Offline checks

The experiment package uses Stripe `18.5.0` for local signature generation
and verification, Supabase JS `2.57.4` for an adapter compile-compatibility
fixture, and PGlite `0.5.8` for the real receipt RPC path. It includes
checks for valid raw-byte signatures, tampered and stale signatures with zero
persistence calls, streaming body limits, POST-only handling, canonical hash
determinism, Basil/legacy invoice relationship conflicts, sanitized database
failure and timeout responses, durable duplicate outcomes, allowlisted
metadata, unknown-event bounding, and a PGlite-backed receipt/dispatch insert.

Run from `experiments/stripe-receipts/` after installing the pinned package
dependencies:

```sh
npm test
npm run typecheck
```

The local run for this handoff completed 29 tests, including the previously
existing receipt-foundation checks, and the compatibility typecheck passed.
This is offline evidence only; it does not
verify current Stripe account settings, a live endpoint, production secrets,
or deployment state.

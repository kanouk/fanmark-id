# D1 paid-plan change command

`POST /api/billing/plan-change` changes an existing paid subscription through
the authenticated user's Better Auth session. The frontend selects it only
with `VITE_STRIPE_PLAN_CHANGE_BACKEND=worker`; the Worker requires
`STRIPE_PLAN_CHANGE_BACKEND=d1`, split business D1, and the D1 webhook/dispatch
path. All selectors default off.

```json
{
  "new_plan_type": "business",
  "request_id": "00000000-0000-4000-8000-000000000002"
}
```

The request does not accept a client-supplied current plan, Stripe Customer,
Subscription, Price, or entitlement. The Worker requires one active local
subscription and proves that the authenticated owner, profile Customer,
subscription Customer, current plan, local Price ID, Stripe Customer, Stripe
Subscription, current Price, and test/live mode agree. Ambiguous, stale, or
unknown mappings fail closed. It does not find Customers by email.

Before any Stripe mutation the Worker inserts an immutable owner-bound command
in business D1. A unique open-command slot serializes changes per user. The
request UUID is also the Stripe idempotency key; an uncertain response resumes
from the stored command and current Stripe state. Commands are considered safe
to replay for 23 hours. After that, an unresolved prepared command requires
operator reconciliation instead of another mutation.

The Worker follows the existing Product rules: Creator-to-Max/Business and
Max-to-Business upgrades prorate immediately; paid-plan downgrades update the
price without proration; paid-to-Free cancels immediately. The server checks
the active, unexpired license count against the target limit before calling
Stripe. The user first confirms any required fanmark returns in the existing
selection flow. A payment-action response sends the user to the existing
Customer Portal Worker client.

This command never writes `user_settings.plan_type` or subscription projection
rows. Those change only after the signed Stripe event is processed by the
existing receipt/dispatch/reconciliation pipeline. A response means the
provider command was submitted; the UI polls the authoritative profile until
the webhook projection arrives. Confirmation runs for up to 90 seconds across the
one-minute dispatch schedule, serializing profile/subscription read batches. On
timeout the UI retains the pending plan and command request ID, blocks another
plan selection, and offers a read-only confirmation retry. It neither resubmits
the command nor reports an unconfirmed change as complete.

## Verification and deployment boundary

The Miniflare D1 suite covers disabled readiness, upgrade/downgrade request
terms, immediate Free cancellation, target-limit rejection before mutation,
customer/subscription/Price mismatches, a lost update acknowledgement,
payment-action fencing, owner-bound retries, and concurrent commands. The
frontend client contract checks same-origin credentials, stable request IDs,
response bounds, and payment-action responses. No Stripe API request or
entitlement change was performed by these tests.

The staging frontend selects the Worker client. Business migration
`0013_stripe_plan_change_commands.sql` adds only the command table and indexes;
it carries no user data. The test-only server selectors and credentials were enabled on 2026-10-04.
An owned synthetic user completed Creator Checkout, Business payment confirmation
through Customer Portal, and immediate Free cancellation with signed webhook
projection and independently verified cleanup. Extension payments, failure/3DS,
first-delivery reordering, and the final same-user browser flow remain unaccepted.
See `evidence/stripe-staging-real-provider-2026-10-04.json`. Production routing, user-data
migration, and domain/DNS are unchanged.

## Populated downgrade UI follow-up (2026-10-06 JST)

Native Safari completed the actual test Creator→Free flow with five owned
fanmarks: exact three selection, fourth-selection denial, confirmation, two
returns, canceled subscription, signed Free projection and dashboard3/3.
The natural Free webhook saw three remaining active licenses and made zero
additional returns. Independent reads matched three active/two grace licenses
to the native selection. UI logout, drained owned cleanup and independent
Auth3/7/2/Master24/unowned scoped rows/FK0 readback passed. Wake23/23 was retained.
Stripe's canceled test customer and invoice/payment history remain.
[Bounded populated UI proof](evidence/staging-populated-plan-limit-native-ui-2026-10-06.json).
Paid-account deletion, imported-user parity and actual-phone acceptance remain
separate. Earlier pending whole-UI statements above are historical checkpoints.

## Known display-delay correction (2026-10-09 JST)

The previous native paid flow stopped confirming Free before the natural minute
dispatch applied the signed cancellation. The UI now confirms for up to 90 seconds
and offers a read-only retry afterward. Four actual-module tests cover a delayed
projection, a bounded timeout without storage-driven automatic restart, read-only
retry for both checkout/change, and serialized slow or failing read batches.

On normal staging version 49e191a8, one disposable JA desktop user completed
Creator Checkout → Business Portal confirmation → Free cancellation → logout,
with no manual reload or retry click. Seven signed receipts and dispatches
completed, including a naturally retried invoice reconciliation. Exact-owned
cleanup left all current and retained store hashes unchanged. Test provider
history remains; no live payment, source user migration, or domain change occurred.
[Bounded native proof](evidence/staging-plan-projection-sync-native-2026-10-09.json).

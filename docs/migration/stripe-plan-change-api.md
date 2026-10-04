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
the webhook projection arrives.

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
it carries no user data. The server selector and Stripe secrets remain unset,
so staging cannot initiate a plan change until Stripe sandbox configuration
and integrated acceptance are completed. Production routing, user-data
migration, and domain/DNS are unchanged.

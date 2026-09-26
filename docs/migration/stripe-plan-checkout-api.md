# D1 plan Checkout API

`POST /api/billing/plan-checkout` starts a subscription Checkout Session for an
authenticated Better Auth user whose D1 `user_settings.plan_type` is `free`.
The accepted plan types are `creator`, `max`, and `business`. The frontend calls
this route only when `VITE_STRIPE_PLAN_CHECKOUT_BACKEND=worker`; the server
requires `STRIPE_PLAN_CHECKOUT_BACKEND=d1`. Both selectors default off in
production configuration.

## Request and ownership

```json
{
  "plan_type": "creator",
  "request_id": "00000000-0000-4000-8000-000000000002"
}
```

The request is same-origin HTTPS only and must use the configured Better Auth
origin. The Worker resolves the current Better Auth session, reads the email
from that exact Auth D1 user row, and requires exactly one matching business-D1
`user_settings` row. It does not search Stripe Customers by email. A stored
`stripe_customer_id` is used only for its mapped owner; otherwise the Worker
creates a Customer with `metadata.user_id` and a per-user Stripe idempotency key.

The route chooses the test or live `*_stripe_price_id` setting from the mode of
`STRIPE_SECRET_KEY`, then retrieves the Stripe Price and requires it to be
active, recurring monthly in JPY, and in the same mode. The generic key must
exactly match its mode-specific dispatch key. The route also requires D1 webhook
and dispatch selectors plus a webhook signing secret, so Checkout cannot be
enabled separately from the subscription event path.

## Durable retries and entitlement

Migration `0012_stripe_plan_checkout_commands.sql` adds two minimal ledgers:

- `stripe_plan_customer_commands` persists the per-user customer-creation
  fence before calling Stripe. The retry key remains stable, and the D1 owner
  mapping and Customer result are committed together. If Stripe created a
  Customer but its response could not be recorded, a retry uses the same key
  during Stripe's idempotency window. After that window, an unresolved row
  returns `stripe_customer_reconciliation_required`; the Worker does not create
  another Customer blindly.
- `stripe_plan_checkout_commands` binds one request UUID to its owner, plan,
  exact Price, mode, Customer, and Checkout Session. Reuse with different terms
  returns `request_id_conflict`. Repeated calls retrieve the same open Session;
  they do not create a second Session. The request key is retained for 23 hours,
  below the Checkout Session's maximum lifetime.

The Session carries the authenticated user, plan, and command UUID in Stripe
metadata. Success and cancellation return to the allowlisted `/plans` page. The
Worker never writes the requested plan to D1: `user_settings.plan_type` and
`user_subscriptions` change only through verified subscription reconciliation.
The browser persists the request UUID for retries and clears it after Stripe
returns to the app.

## Verification and deployment boundary

The Miniflare D1 suite covers selector/readiness gates, CORS and identity,
profile ownership, free-plan eligibility, test/live Price verification, stable
Customer and Session retries, lost Customer acknowledgements, request conflicts,
unsafe redirect rejection, and no entitlement before the webhook. The frontend
contract suite checks same-origin credentials, retry IDs, response bounds, and
Checkout URL validation.

The staging frontend selects the Worker client, but the server-side
`STRIPE_PLAN_CHECKOUT_BACKEND` selector and Stripe credentials remain unset.
Deploying the endpoint does not activate it; requests remain unavailable until
the complete webhook, dispatch, test-mode price, and signing-secret
configuration is reviewed. This work does not execute a Stripe transaction,
migrate user data, change
production, or change DNS/domain routing. Existing paid subscriptions use the
separate [D1 plan change command](stripe-plan-change-api.md). Stripe sandbox
acceptance remains separate work.

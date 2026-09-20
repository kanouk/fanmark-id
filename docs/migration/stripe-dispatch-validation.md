# Stripe dispatch leases

This slice adds
[`20260921100000_add_stripe_dispatch_leases.sql`](../../supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql)
on top of the receipt foundation. It provides service-only claim, lease
renewal, and retry transitions for the durable Stripe dispatch queue. It does
not run a billing effect, finalize a receipt, mark a dispatch completed, add an
endpoint, schedule a worker, or deploy anything.

## Lease state

`billing_ingress.stripe_webhook_dispatches` gains:

| Column | Meaning |
| --- | --- |
| `lease_until` | Expiry evaluated with authoritative SQL time. It is non-null only while `status = 'processing'`. |
| `claim_generation` | Nonnegative fencing value, starting at 0 and increasing on every successful claim or reclaim. A processing row has a positive generation. |

The migration adds a state check requiring a processing row to have
`claimed_at`, `lease_until`, and `lease_token`, and requiring those fields to
be cleared for every other dispatch status. It also adds a bounded claim index.
Before altering the table, it fails explicitly if a legacy `processing` row is
present. The foundation had no lease expiry for such a row, so silently
replaying or expiring it would be an unsafe ownership decision; an operator
must reconcile that row before this migration can apply.

## RPC contract

All three functions are `SECURITY DEFINER`, use a fixed
`pg_catalog, billing_ingress` search path, and are executable only by
`service_role`. The request role check is defense in depth; the execute ACL is
the SQL boundary. Anonymous and authenticated clients have no table access or
function execute grant.

### Claim

`public.claim_stripe_webhook_dispatches(livemode, batch_size, lease_seconds)`
accepts a batch size from 1 through 100 and a lease duration from 1 through
3,600 seconds. It considers only receipts in `received`, `retryable`, or
`processing` and dispatches in the requested mode whose SQL-time state is:

- `pending` or `retryable` with `available_at <= clock_timestamp()`; or
- `processing` with a non-null `lease_until <= clock_timestamp()`.

The candidate query locks receipts first with `FOR UPDATE SKIP LOCKED`. Each
guarded dispatch update then obtains the dispatch lock using the mode, event,
and receipt identity. A successful claim sets both receipt and dispatch to
`processing`, increments `attempt_count`, increments `claim_generation`,
creates a new random `lease_token`, and sets `claimed_at`/`lease_until` from
SQL time. It returns the normalized snapshot and the current fencing values so
the worker can use the receipt without another unguarded read.

Terminal receipts and dispatches are never claimable. A future retry is left
untouched. A stale or concurrent dispatch change causes the guarded update to
return no row rather than overwriting the current owner.

### Renew

`public.renew_stripe_webhook_dispatch_lease(receipt_id, dispatch_id,
livemode, lease_token, claim_generation, lease_seconds)` requires every
identity and fencing field plus a duration from 1 through 3,600 seconds. It
locks the receipt first, then renews only a matching, unexpired processing
dispatch. A stale token, stale generation, wrong mode/identity, terminal row,
or expired lease returns no row. Renewal uses the later of the existing expiry
and `SQL now + duration`, so a short heartbeat cannot shorten a valid lease.
It does not increment the claim generation.

### Retry

`public.retry_stripe_webhook_dispatch(receipt_id, dispatch_id, livemode,
lease_token, claim_generation, retry_after_seconds, error_code,
error_message)` uses the same receipt-first lock and current-owner guard.
`retry_after_seconds` is bounded to 0 through 86,400. The code is limited to
128 bytes and the message to 1,000 bytes; callers must provide sanitized
diagnostic values only and must never pass provider payloads, credentials, or
full user records. The function changes the dispatch and receipt to
`retryable`, schedules `available_at` with SQL time, clears the lease fields,
and stores the bounded diagnostics. The normalized snapshot and hashes remain
unchanged.

There is deliberately no retry-limit or dead-letter RPC in this migration.
`attempt_count` is observable for the later worker policy; an explicit
dead-letter decision must define operator recovery and terminal receipt
semantics before it is added. No function here declares an application
effect, receipt, or dispatch complete.

## Atomicity and lock order

Claim, renew, and retry use the same receipt-before-dispatch order as the
receipt acceptance RPC. Claim locks the candidate receipt before the guarded
dispatch update; renew and retry lock the identified receipt before checking
the dispatch token and generation. Retry updates the dispatch and receipt in
one transaction, so a failure in the second state update rolls back the lease
release and error record. Claim likewise rolls back its dispatch claim if the
receipt state update fails. A future business worker must keep the lease token
and generation in every state-changing predicate and must not treat a lease as
an application transaction.

## Offline validation

`experiments/stripe-receipts/test/dispatch-leases.test.mjs` applies the
foundation and lease migrations to PGlite and checks:

- live/test mode separation, bounded batches, due/future/terminal filtering;
- expired reclaim with a new token, attempt count, and generation;
- renewal fencing, expiry rejection, and no-shortening behavior;
- retry scheduling, lease clearing, snapshot preservation, and diagnostics;
- claim/retry rollback when the second state update is forced to fail;
- invalid parameter rejection, terminal non-claimability, ACL checks, and a
  caller search path that cannot alter the SECURITY DEFINER lookup.

The test database uses one PGlite connection. It verifies SQL behavior and
rollback, but it is not an independent-connection concurrency proof for
`SKIP LOCKED`; that requires a later Postgres integration check. Run from
`experiments/stripe-receipts/`:

```sh
npm test
npm run typecheck
```

The local run for this handoff passed 39 tests across the receipt foundation,
signed ingress, and dispatch lease suites. This is offline evidence only; it
does not verify live queue state, production migration status, Stripe account
settings, or deployment.

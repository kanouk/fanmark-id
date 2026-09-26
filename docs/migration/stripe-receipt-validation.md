# Stripe receipt foundation validation (#32)

Status: local implementation for review. The migration is not applied to
Supabase, the existing webhook is not connected, and no billing or license
state is changed by this foundation.

The implementation is deliberately limited to the first durable boundary:
after a trusted caller has verified a Stripe signature and produced a
versioned normalized snapshot, one service-only RPC stores the immutable
receipt and its dispatch row in the same PostgreSQL transaction. The business
application ledger, customer fences, Checkout intents, and worker status
transitions remain follow-up work from
[the approved ledger design](stripe-ledger-design.md).

The new migration is
[20260921090000_add_stripe_receipt_foundation.sql](../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql).
It creates a `billing_ingress` schema with two RLS-enabled tables:

- `billing_ingress.stripe_webhook_receipts` stores the `(livemode, stripe_event_id)`
  identity, envelope identifiers, API version, replayable normalized JSONB,
  schema version, normalized-payload SHA-256, raw-body SHA-256, delivery count,
  and receipt status. Raw request bodies are not stored.
- `billing_ingress.stripe_webhook_dispatches` stores exactly one durable dispatch row
  for each receipt, with pending/processing/retryable/completed/dead-letter
  state and future lease/error fields. One composite foreign key binds the
  receipt ID, live/test mode, and event ID together, so those identities cannot
  be mixed across rows.

The tables have no client policies, client grants are revoked, and the
billing_ingress schema is not granted to `anon`, `authenticated`, or `service_role`.
The only new access path is the narrowly typed
`public.accept_stripe_webhook_receipt(...)` SECURITY DEFINER function. Its
EXECUTE ACL is granted to `service_role` only; the Supabase JWT role
(`auth.role()` with the request claim fallback) is an additional request
context check. A caller-controlled custom GUC is not treated as authentication
for arbitrary SQL sessions. Its fixed `pg_catalog, billing_ingress` search path
prevents caller-controlled objects from changing table or function resolution.

The RPC inserts a receipt with `ON CONFLICT DO NOTHING`, locks an existing
same-mode receipt for comparison, and refuses any changed immutable envelope
field, normalized JSON object, schema version, or hash. An exact duplicate
increments delivery evidence but does not create another receipt or dispatch.
A nonterminal duplicate returns `duplicate_nonterminal`; a receipt already
marked `applied`, `ignored`, or `dead_letter` returns `duplicate_terminal`.
If a terminal receipt is missing its dispatch row, duplicate handling repairs a
completed or dead-letter dispatch without reopening work. If a nonterminal
receipt has a terminal dispatch, the RPC raises a reconciliation error without
stealing the active lease or overwriting the dispatch. Live and test deliveries
with the same Stripe event ID are separate rows by design. If dispatch
insertion fails, the statement rolls back both inserts.

The focused harness is
[experiments/stripe-receipts](../../experiments/stripe-receipts/), using the
pinned `@electric-sql/pglite` `0.5.8` package and Node's built-in test runner:

```sh
cd experiments/stripe-receipts
npm ci
npm test
```

PGlite runs PostgreSQL in WebAssembly; the local run reported PostgreSQL
18.3. The project describes PGlite as an embeddable PostgreSQL build for
Node.js and documents its in-memory mode in the [official repository
README](https://github.com/electric-sql/pglite). The test suite exercises the
actual SQL engine, PL/pgSQL function, constraints, grants, and RLS settings;
it is not a mock SQL interpreter.

The validation run completed **14 tests, 14 passed**:

| Boundary | Evidence |
| --- | --- |
| First durable write | One receipt and one pending dispatch are returned and stored. |
| Duplicate delivery | Sequential and overlapping same-mode calls converge on one receipt and one dispatch. |
| Terminal retry | A terminal receipt returns `duplicate_terminal` without another dispatch; missing terminal dispatch rows are repaired without reopening work. |
| Mismatch handling | A nonterminal receipt with a terminal dispatch requires reconciliation and leaves the dispatch unchanged. |
| Mode separation | The same event ID is accepted independently in live and test mode. |
| Identity binding | The composite receipt/event/mode foreign key rejects a dispatch row assembled from different receipts. |
| Immutable conflict | Changed event fields or normalized hash raise an error and leave the original row unchanged. |
| Atomic rollback | A test-only database trigger rejects dispatch insertion; the receipt insert is absent after the failed RPC and a later retry succeeds. |
| Client denial | `anon` and `authenticated` cannot invoke the RPC or read either billing_ingress table; `service_role` can use the RPC but cannot read the tables directly. |
| Search-path safety | A caller-created `evil` schema cannot redirect the SECURITY DEFINER function. |
| Constraints | Invalid hashes, scalar/non-object normalized payloads, and receipt statuses are rejected by the function/table checks. |

The PGlite instance is an isolated in-memory, single-user PostgreSQL engine;
it does not prove Supabase's managed Postgres version, PostgREST claim wiring,
or locking behavior across independent network sessions. The migration still
needs review and a disposable Supabase/local-Postgres application before it is
applied. The trusted ingress must compute the canonical normalized hash after
signature verification; this RPC validates its format and preserves it for
conflict detection, but does not attempt to canonicalize arbitrary JSON on the
database side. A later worker must add receipt leases, application effects,
and explicit terminal transitions without connecting this foundation to the
current grant path until those transactions are reviewed.

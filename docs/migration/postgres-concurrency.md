# PostgreSQL 17 concurrency validation

This is an offline validation of the Stripe receipt, dispatch lease, and invoice projection SQL:

- `supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql`
- `supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql`
- `supabase/migrations/20260921110000_add_stripe_invoice_projection.sql`

It uses a new local PostgreSQL cluster with synthetic rows. It never accepts a `DATABASE_URL`, Supabase URL, or external DSN. The test starts PostgreSQL on `127.0.0.1` with a random port and private SCRAM password, and checks both the executable version and `server_version_num` before applying migrations.

## Reproducible local run

The tested runtime is macOS arm64 with Node 22.6.0. Keep the package installation outside the repository:

~~~sh
runtime_root="$(mktemp -d /tmp/fanmark-pg17-runtime.XXXXXX)"
cat > "$runtime_root/package.json" <<'JSON'
{
  "name": "fanmark-pg17-runtime",
  "private": true,
  "type": "module",
  "dependencies": {
    "@embedded-postgres/darwin-arm64": "17.10.0-beta.17",
    "pg": "8.23.0"
  }
}
JSON
npm install --ignore-scripts --no-audit --no-fund --prefix "$runtime_root"
(cd "$runtime_root/node_modules/@embedded-postgres/darwin-arm64" && node scripts/hydrate-symlinks.js)
FANMARK_PG17_RUNTIME_ROOT="$runtime_root" \
  /Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --test experiments/stripe-receipts/test/postgres-concurrency.mjs
~~~

The test deliberately runs only when `FANMARK_PG17_RUNTIME_ROOT` is set. This file is not part of the ordinary `test/*.test.mjs` glob because CI does not carry the temporary PostgreSQL runtime. Running the command without the variable makes the five cases skip with an explicit reason.

The exact platform package is `@embedded-postgres/darwin-arm64@17.10.0-beta.17` with SHA-512 integrity:

`sha512-E2dxhSllrcyAJBHuvgTrBTx2BaPlX2vvjXClPKHxfwBezk+nTZ01uAEraKiRJMpzHSCyN8J1dTjKh4q/uTsBLQ==`

The exact client package is `pg@8.23.0` with SHA-512 integrity:

`sha512-Ip2EQCngowJLGOfCwkFhPXU7/ljlhn6Rxlmy4XYfL2Y+vyRM59+8uR2xqRWKdYmbXmxCFOAmKxBuSUCdF34qLg==`

Package provenance is available from the [embedded-postgres source repository](https://github.com/leinelissen/embedded-postgres), the [platform package registry record](https://www.npmjs.com/package/@embedded-postgres/darwin-arm64/v/17.10.0-beta.17), and the [pg registry record](https://www.npmjs.com/package/pg/v/8.23.0). PostgreSQL behavior references the [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/).

The test uses the direct `initdb`, `pg_ctl`, and `postgres` binaries. It does not run the wrapper's host-user creation option, install Homebrew services, start Docker, or modify a global package installation. The test-created cluster, password, socket directory, log, and child server are removed only after its own server identity is observed stopped. An uncertain PID or `ps` probe fails closed and preserves the private cluster path for review.

## Cases covered

| Case | Held overlap | Evidence asserted |
| --- | --- | --- |
| Duplicate receipt delivery | Connection A keeps its receipt insert uncommitted. Connection B submits the same event and is observed waiting on A through `pg_stat_activity` and `pg_blocking_pids`. | After A commits, B converges on the same receipt and dispatch; one result is accepted and one is nonterminal duplicate. |
| `SKIP LOCKED` claim separation | Connection A begins a transaction and keeps two claimed receipt rows locked while connection B claims. | B returns two different rows while A remains `idle in transaction`; all four dispatch IDs are unique after both commit. |
| Customer fence contention | Connection A holds the inserted and updated customer fence row uncommitted. Connection B attempts a different dispatch for the same customer and is observed waiting on A. | A owns one fence generation; B receives no fence after A commits. |
| Expired holder | A real PostgreSQL trigger sleeps 2.2 seconds during ledger insertion while the dispatch and customer leases are two seconds. | The final mutation guard raises the lease-expired error; no ledger or terminal transitions commit, subscription fields remain unchanged, and existing fence ownership is retained. |
| Transaction rollback | A real trigger raises during the subscription update after ledger reservation. | The ledger insert and all terminal transitions roll back; receipt and dispatch remain processing and subscription failure fields remain unchanged. |

Each database connection is a separate `pg.Client` connection to the temporary cluster. The test uses actual PostgreSQL transactions and locks rather than a PGlite or mock concurrency model.

The observed local run on 2026-09-21 was:

~~~
postgres (PostgreSQL) 17.10
server_version_num=170010
1..5
# pass 5
# fail 0
# skipped 0
~~~

The test then stopped its own server, removed its temporary cluster, and left no PostgreSQL process or `fanmark-pg17-concurrency-*` directory. The runtime package directory remains outside the repository until its owner removes it.

## Evidence boundary

This validates PostgreSQL 17.10 lock and transaction behavior for the checked-in migration functions with a minimal synthetic schema. Current managed production was observed separately as PostgreSQL 17.6.1.005; the minor-version difference, managed settings, extensions, connection pool behavior, and production load are not established by this test. The minimal `auth`, `user_settings`, and `user_subscriptions` objects are fixtures, not a claim that the full production schema was reproduced.

The test does not connect a webhook endpoint, scheduler, Stripe API client, worker, or live database. It does not validate remote event delivery, customer reconciliation, Supabase deployment state, or D1 behavior. Those remain separate mapping and integration gates.

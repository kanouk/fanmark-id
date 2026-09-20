# D1 concurrency fixture

This fixture is preparation for issue #31. It is an isolated local Workers/D1 proof and is not wired into the fanmark.id application or any production database.

## What is pinned and how to run it

The harness uses the same local Workers test stack as the authentication feasibility fixture:

- Wrangler `4.135.0`
- Miniflare `5.20260918.0-alpha`
- `@cloudflare/vitest-plugin` `1.1.13`
- Vitest `4.1.0`

Run it from the fixture directory:

```sh
cd experiments/cloudflare-d1-concurrency
npm ci
npm test
```

The Vitest Workers plugin provides the `DB` D1 binding from `wrangler.jsonc`. Tests import `env.DB` from `cloudflare:workers` and execute prepared SQL against the local D1 runtime. There is no mocked database or in-memory replacement.

## Invariants exercised

The schema in `experiments/cloudflare-d1-concurrency/migrations/0001_concurrency_fixture.sql` is intentionally small. It models only the columns needed for the race proofs:

- `fanmark_licenses` has a partial unique index for an active or grace normalized fanmark and a unique `operation_id`.
- Acquisition is one conditional `INSERT ... SELECT`. The `SELECT` requires the user's current active count to be below `active_limit`, rejects an already-active or grace normalized fanmark, and rejects a previously used operation ID.
- The same D1 `batch()` contains an `INSERT OR IGNORE ... SELECT` for `acquisition_audit`. It selects only the row with the inserted `operation_id`; when the acquisition inserts zero rows, the audit also inserts zero rows.
- A forced SQL error after the conditional insert verifies that the batch rolls back both the license and audit. Retrying the same operation after rollback then succeeds.
- Coupon redemption stores an `applied_at` marker. The debit and marker update are scoped to the same operation, coupon, and user, so a retry cannot decrement a remaining balance twice and reusing an operation ID for another coupon/user cannot debit either record.

`test/concurrency.test.mjs` runs `Promise.all` against the actual binding for:

1. Two users acquiring the same normalized fanmark: exactly one license and one audit survive.
2. One user with one remaining slot acquiring two different normalized fanmarks: exactly one license and one audit survive.
3. Retrying one successful operation: no duplicate license or audit is created.
4. A grace license: the same normalized fanmark cannot be acquired and creates no audit.
5. Retrying a successful operation: no duplicate license or audit is created.
6. A later SQL failure: no partial license or audit remains, and the operation can be retried.
7. A one-use coupon claim: a conditional claim and decrement allow one concurrent redemption.
8. A multi-use coupon retry and operation reuse: the original balance is decremented once and another coupon/user is untouched.
9. A pending transfer approval: a `status = 'pending'` compare-and-set update allows one approver and one audit.

The coupon and transfer cases are small CAS examples. They do not model the full product rules for coupons, licenses, transfers, settings copying, permissions, notifications, or billing.

## Why the SQL is shaped this way

The product requirements say that acquisition, return, transfer, lottery, coupon use, and plan limits must not be implemented as a read followed by an unconditional update. The parent migration issue also requires D1 uniqueness, conditional SQL, and an atomic batch for the remaining-slot and normalized-fanmark races.

The first acquisition statement therefore makes the eligibility test part of the write. The unique active-fanmark index is a second database guard. The audit statement is dependent on the operation ID inside the same batch, so a losing request cannot manufacture an audit row from a stale read. The audit's unique operation key makes a successful retry idempotent.

Cloudflare documents `D1Database.batch()` as sequential, non-concurrent execution whose statements form a SQL transaction; a failure aborts or rolls back the sequence. D1 databases are also single-threaded and queue concurrent requests for a database instance. These properties are the basis for this local proof, while the SQL conditions and unique constraints express the application invariants themselves.

## Limits of this proof

This fixture demonstrates behavior in the pinned local D1/Miniflare runtime only. It does not measure production D1 latency, queue depth, overload behavior, regional placement, read-replica lag, request limits, or throughput. It does not prove that a future Workers API will preserve the same transaction boundary, bind the same database, or enforce all fanmark.id permissions and lifecycle rules. Production migration still requires a staging database, API-level authorization tests, retry policy tests, data-shape tests, and an observed production-like concurrency/load run.

The fixture also does not enable D1 read replication. If a later design uses replicas for reads, the application must decide where the latest committed value is required and test D1 Sessions/bookmarks for sequential consistency. No production D1 resource, schema, secret, or deployment setting is changed by these files.

## Primary references

- [D1 Database binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/): prepared statements, `batch()` transaction/rollback behavior, and Sessions.
- [D1 limits and concurrency](https://developers.cloudflare.com/d1/platform/limits/): single-threaded database instances, queuing, overload, and throughput guidance.
- [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/): Wrangler local D1 development.
- [Workers Vitest test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/): access to `env` and D1 bindings in the Workers runtime.
- [Miniflare testing](https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/): binding setup and the distinction between local Worker runtime and Node test code.

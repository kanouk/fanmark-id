# Local proofs for the active-to-grace expiry slice

The first suite below is a preparatory local proof for issue #34. It exercises
an isolated synthetic D1 schema. The newer source-shaped suite uses catalog
table names and the reviewed lifecycle extensions, but it too uses synthetic
rows and a deliberately small catalog. Neither suite wires a cron, Worker
route, production setting, or source database to the implementation.

Run it from the repository root with the repository's Node 22 runtime:

```sh
npm --prefix workers/api run test:license-expiry
npm --prefix workers/api run test:license-expiry-source
```

The original suite creates a local Miniflare D1 binding, applies
`workers/api/test/fixtures/license-expiry.sql`, inserts synthetic rows, and
disposes the runtime. The source-shaped suite also uses Miniflare D1, but
generates its fixture from a synthetic catalog and applies the lifecycle
extensions. Neither test uses remote credentials or a live Cloudflare
resource.

## Contract exercised

`workers/api/src/license-expiry.mjs` accepts only a D1 binding, an internal run
identity, and one canonical UTC timestamp with six fractional digits. The
server-side caller owns the clock and identity; the repository does not accept
an HTTP owner, browser timestamp, or transition decision.

Each run binds its captured timestamp and parsed grace-period setting in a
durable run record. The source-compatible setting behavior is preserved: a
successful single row is parsed with decimal `parseInt` (`2days` becomes two),
and a non-positive or non-finite parsed value falls back to one day. A missing
row or settings query error aborts the run.

Candidate discovery uses bounded keyset pages. It selects only active licenses
with a non-null `license_end` strictly earlier than the captured time and an
active fanmark. A durable run-item journal records the candidate identity,
expected generation, operation ID, and calculated grace deadline before the
transition. This journal lets a retry recover a committed transition when a
process fails after the transition batch but before the run cursor advances.

The active-to-grace operation is one D1 batch. Its guarded update compares the
license, fanmark, owner, end time, status, generation, active fanmark, and
operation journal row. The batch then inserts the audit and outbox rows only
from the claimed license, records the run item as `processed`, and clears the
claim. Before clearing the claim, a CHECK-backed SQL guard requires the
operation-bound audit, outbox, and processed run item to exist. A missing
effect aborts inside the transaction, so a successful zero-row effect cannot
leave a committed license transition. The temporary guard is deleted in the
same batch, and a final SQL assertion aborts if cleanup leaves that guard
behind. A failed batch rolls back the state and effects together.

An uncertain batch acknowledgement is accepted only when the current license,
run item, audit payload, outbox payload, operation ID, dedupe key, and captured
time all bind to the same operation. ACK recovery preserves `processed` as the
logical outcome; a competing runner cannot rewrite it to a separate
`already_committed` logical state. A stale owner/end/generation or competing
extension, return, or transfer produces a conflict with no expiry effects.

## Evidence covered by the local test

The proof covers:

- strict expiry selection, inactive fanmarks, perpetual licenses, equality at
  the captured boundary, returned licenses, generation changes, and retained
  `license_end`;
- UTC midnight, microsecond-after-midnight, month, leap-day, and year-boundary
  deadline behavior;
- setting prefix parsing, fallback, missing-setting failure, query failure,
  and durable run binding;
- atomic rollback when any mandatory audit/outbox/run-item effect is suppressed,
  including a successful zero-row statement or suppressed guard cleanup, clean
  retry, and no retained guard;
- atomic rollback, lost-ACK recovery, exact operation/dedupe binding, and
  retry without duplicate audit or outbox effects;
- different-run concurrency, same-run concurrent callers, stale candidate
  guards, and competing extension/return/transfer CAS operations;
- a 65-row keyset traversal across multiple pages with a bounded 32-item
  result sample;
- a synthetic crash after the transition commits but before run progress
  updates, followed by two same-run resumptions whose durable counts and
  audit/outbox cardinalities remain consistent.

The successful command prints:

```text
Miniflare D1 license expiry proof passed: active->grace CAS, UTC precision, pagination, rollback, ACK retry, and competing operations.
```

## Deliberate limits and gates

This slice implements only `active -> grace`. `grace -> expired`, lottery
selection, configuration projection deletion, notification delivery, transfer
completion, and extension policy remain design gates. The direct competing
operations in the test are synthetic CAS fixtures; they do not claim that the
existing production endpoints already use this shared operation ledger.

The fixture does not prove the full converted source schema, production D1
latency or limits, Cloudflare cron scheduling, source/Auth/Storage consistency,
environment protection, or deployment readiness. The live-only manual expiry
entrypoint and its operational invocation remain a separate parity gate. No
production resource or external setting was changed by this proof.

## Source-shaped suite

`workers/api/src/license-expiry-source.mjs` runs the same state transition
against catalog-shaped source tables and the target-only lifecycle/generation
extensions. It writes the existing `audit_logs` and `notification_events`
shapes, accepts historical licenses with a null owner, and advances
`lifecycle_generation` and `access_generation` independently. The shared
protected-access generation statement does not write password bytes or
`password_generation`. The durable run item preserves the captured
`normalized_emoji` and stable `short_id`; the notification retains the current
`fanmark_name` value and adds `fanmark_short_id` plus its `/f/:shortId` link.

The source-shaped suite runs ten Miniflare checks over synthetic rows. It
verifies exact readback, strict expiry boundary behavior, lost-ack recovery,
rollback when each mandatory effect is suppressed, safe resume, notification
display/link payloads, and a stale fanmark conflict. It does not yet use the
full 40-table profile, run through the migration importer, wire an API/cron
route, or prove production parity.

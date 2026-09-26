# Local proofs for the active-to-grace expiry slice

The first suite below is a preparatory local proof for issue #34. It exercises
an isolated synthetic D1 schema. The newer source-shaped suite uses catalog
table names and the reviewed lifecycle extensions, but it too uses synthetic
rows and a deliberately small catalog. The local suites do not trigger a live
Cron or connect to the source database. A separate one-shot staging canary
later exercised the deployed scheduled entrypoint with synthetic rows; its
result and boundaries are recorded below. The staging config explicitly sets
`triggers.crons: []` and leaves the feature flag unset, so no recurring job is
active.

Run it from the repository root with the repository's Node 22 runtime:

```sh
npm --prefix workers/api run test:license-expiry
npm --prefix workers/api run test:license-expiry-source
npm --prefix workers/api run test:license-expiry-scheduled
```

The original suite creates a local Miniflare D1 binding, applies
`workers/api/test/fixtures/license-expiry.sql`, inserts synthetic rows, and
disposes the runtime. The source-shaped suite also uses Miniflare D1, but
generates its fixture from a synthetic catalog by default and applies the
lifecycle extensions. To run that same proof against the latest complete
private source catalog, set `FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG` to a
`0600` readiness JSON file outside the repository:

```sh
FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG=/private/path/schema-readiness.json \
  npm --prefix workers/api run test:license-expiry-source
```

The full-catalog mode regenerates all 40 source tables and safe indexes in a
disposable local D1, adds the lifecycle/generation/credential extensions, and
inserts only synthetic rows needed by the tests. It does not read or import
source data and does not connect to Cloudflare. The 2026-09-24 current-catalog
run passed all 11 checks. Neither mode uses remote credentials or a live
Cloudflare resource.

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

The implementation now covers `active -> grace` plus a bounded, local-only
`grace -> expired` transition when there are no pending lottery entries. Grace
finalization deletes the four access configuration projections, advances the
access generation, and writes its audit/outbox effects atomically. Pending
lottery entries are deferred. Lottery selection and winner issuance, transfer
cleanup, notification delivery, and extension policy remain design gates. The
direct competing operations in the test are synthetic CAS fixtures; they do
not claim that the existing production endpoints already use this shared
operation ledger.

The fixture does not prove the full converted source schema, production D1
latency or limits, live Cloudflare Cron scheduling, source/Auth/Storage consistency,
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

The source-shaped suite runs eleven top-level Miniflare checks over synthetic
rows (including four mandatory-effect subtests). It
verifies exact readback, strict expiry boundary behavior, lost-ack recovery,
rollback when each mandatory effect is suppressed, safe resume, notification
display/link payloads, a stale fanmark conflict, and bounded-page resumption.
It does not yet use the full 40-table profile in this run, run through the
migration importer, activate the staging Cron, or prove production parity.

## Worker scheduled entrypoint

`workers/api/src/license-expiry-scheduled.mjs` connects the source-shaped
active-to-grace repository and no-pending grace finalizer to the Worker
`scheduled` event. It does nothing
unless `LICENSE_EXPIRY_BACKEND=d1` is set, and then requires split D1 plus an
explicit target-incarnation token and schema-extension digest. It reads only
the exact `grace_period_days` setting, preserving the current parse/fallback
behavior, and shares the four-page default budget between both phases. A
single durable open run resumes on the next scheduled invocation using its
original timestamp and grace-period value. New run IDs are deterministic for
the scheduled timestamp, so a retry reuses the same run. Invalid bindings or
multiple open runs fail closed. Because the source computes the grace deadline
from the already-expired `license_end`, a delayed cron can move a license to
grace with a deadline that is already past. The same-tick finalizer excludes
licenses processed by that active-to-grace run; a later scheduled timestamp
can finalize them. Pending lottery entries stay in grace for the unimplemented
lottery phase.

Eight scheduler contract tests cover disabled-by-default behavior, split-D1
and profile guards, stable run IDs, resuming the persisted run binding, page
budget sharing, and deferral while the first phase remains open. The full
40-table source-profile Miniflare suite passes 20 checks, including grace
finalization rollback when an outbox or config delete is suppressed, resume,
lottery deferral, and the delayed-cron two-tick case. The source-shaped suite
also checks the page cap: 65 synthetic candidates
require two bounded pages, then a final invocation to close the durable run.
This is local execution evidence; by itself it does not prove Cloudflare Cron
timing, production CPU/plan fit, or populated-user behavior. On 2026-09-25 the
staging business D1 received only the public `grace_period_days=1` setting
copied from the exact Supabase public value and Product default. A deployed
workers.dev scheduled-event canary passed on 2026-09-26 with one synthetic
lottery winner. It restored `grace_period_days=1`, removed all synthetic
business rows and lifecycle journals, preserved the pre-canary lifecycle
registry, and left Auth user tables empty. The temporary lifecycle trigger and
`LICENSE_EXPIRY_BACKEND` selector were removed afterward. Later notification
processing restored the every-minute trigger; the current staging config also
declares a separate daily trigger while keeping the expiry selector unset. This
proves one scheduled execution on staging, not recurring lifecycle activation,
production CPU/plan fit, or populated-user behavior. No user rows were copied.

The canary is opt-in and targets the configured staging resources only:

```sh
FANMARK_STAGING_CRON_CANARY=1 node scripts/migration/staging-license-expiry-lottery-smoke.mjs
```

It temporarily deploys `* * * * *` and explicitly overrides
`LICENSE_EXPIRY_CRON` to that value, waits up to 17 minutes for durable job
completion, disables the temporary lifecycle selector before detailed
readback, and runs cleanup in all exit paths. Cloudflare documents that trigger
updates may take up to 15 minutes to propagate; see [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

The Worker dispatcher now routes the normal `0 0 * * *` trigger to lifecycle
expiry and `* * * * *` to notifications and Stripe dispatch. Staging config
declares both triggers, but `LICENSE_EXPIRY_BACKEND` remains unset, so the
daily lifecycle handler exits disabled without querying or changing D1. The
synthetic lifecycle canary remains the only remote expiry execution.

## 2026-09-26 staging Cron revalidation

The opt-in canary guard now accepts only the checked-in staging Cron baseline
(`* * * * *` notifications plus `0 0 * * *` lifecycle schedule), requires the
lifecycle backend/target bindings to stay unset in the restored config, and
counts all approved system-setting, availability-rule, and notification-master
baseline rows. A staging canary rerun completed with `winner_finalized`; after
cleanup, the 40 source-table baseline matched, synthetic business rows and
lifecycle journals were zero, Auth tables remained empty, and retained
incarnation/access-version state matched its pre-run snapshot. The restored
Worker deployment is version `a358996e-ce86-4410-be53-40e6f355ee9e` at 100%.
Read-only workers.dev probes returned 200 for the app root, robots, and
Better Auth health, and 404 for Stripe webhook. D1 readback also confirms zero
plan-checkout commands, users, licenses, fanmarks, and lifecycle runs.

This revalidates the one-shot synthetic scheduled path on the current staging
Worker; `LICENSE_EXPIRY_BACKEND` remains unset, so recurring lifecycle
processing is still disabled. No real user rows, production route, or domain
state changed.

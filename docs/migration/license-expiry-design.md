# License expiry job design for D1/Workers

This is design input for issue #34. It does not add a Worker, a D1 schema, a
cron binding, or a production setting. The checked-in Supabase implementation
and the product/lifecycle documents are the evidence boundary. Any behavior
marked as a gate needs an explicit parity decision and a test before the D1 job
can replace the source job.

## Current source contract

The following behavior is verified in `docs/PRODUCT.md`,
`docs/LICENSE_LIFECYCLE.md`, `supabase/functions/check-expired-licenses`, and
the shared return helper. The source performs these writes as separate
Supabase requests; that is an observation, not the target transaction model.

| Transition | Verified guard and time boundary | Verified state change | Required effects |
| --- | --- | --- | --- |
| Expiry `active -> grace` | `status = active`, a finite `license_end` is strictly earlier than the job's `now`, and the joined fanmark is active | Set `status = grace`, set `grace_expires_at` to the next UTC midnight after `license_end + grace_period_days`, and set `is_returned = false`. The expiry path leaves `license_end` unchanged. | `license_grace_started` audit and notification event. Configuration remains available during grace. |
| Manual/bulk return `active -> grace` | The caller owns an active license and `has_active_transfer` is false | Set `status = grace`, `license_end = now`, `grace_expires_at` to the next UTC midnight after `now + grace_period_days`, `is_returned = true`, and clear exclusion fields. | `return_fanmark` audit, owner notification, and `favorite_fanmark_available` events. Configuration remains available during grace. |
| Grace expiry `grace -> expired` | `status = grace`, `grace_expires_at` is less than or equal to `now`, and the joined fanmark is active | Set `status = expired` and `excluded_at = now`. | Delete expired configuration projections, write `license_expired` audit/event, then resolve the lottery. |
| Extension `grace -> active` | Owner request or verified Stripe extension; finite license; active or grace state; no active transfer | Use `max(now, current license_end)`, add the selected months, round up to the next UTC midnight, set active, clear grace/return/exclusion fields. | Cancel pending lottery entries, write an extension audit, and enqueue cancellation events. |
| Transfer | The pending request and transfer code still identify the active owner and the old license is active | Expire the old license, create the recipient's new active license, remove old configuration, create the new inactive basic projection, and finish the code/request. | Cancel old pending lottery entries, write transfer audit/event. |

The source's grace and expired scans only select licenses whose related
`fanmarks.status` is active. A target must preserve that rule or explicitly
introduce a reconciliation path for inactive/deleted fanmarks; it must not
silently broaden the scan.

A Tier C license has `license_end = NULL` and is not an expiry candidate. A
manual return can still put it into grace; extension rejects a perpetual
license. An expired license does not delete the `fanmarks` identity,
`short_id`, discovery row, favorite row, or historical audit data.

## UTC and boundary rules

Every invocation captures one `now_utc` at the beginning of a run and passes it
to every candidate query and transition. The value is stored in the operation
journal and event payload metadata so a retry cannot recalculate a different
boundary. The operation boundary and stored timestamps use canonical UTC with
six fractional digits (or an equivalent integer epoch-microsecond value). A
Worker clock with only millisecond resolution may supply a value ending in
`000`, but the worker must never parse a stored timestamp through a millisecond
`Date` and silently round it. In particular, `00:00:00.000001` is after UTC
midnight and must round to the following UTC midnight. UTC calendar operations
must be explicit; JavaScript local-time `setDate` behavior is not a safe D1
contract.

The source boundaries are intentionally asymmetric:

- `active -> grace` uses `license_end < now_utc`. An exact equality remains
  active for that run.
- `grace -> expired` uses `grace_expires_at <= now_utc`. An exact deadline is
  expired.
- The expiry deadline is `roundUpToNextUtcMidnight(license_end + days)` for
  expiry-driven grace and `roundUpToNextUtcMidnight(now_utc + days)` for a
  return. An exact UTC midnight remains that midnight; any later instant is
  rounded to the following UTC midnight.
- `grace_period_days` must be a positive integer. The source requires the settings query to succeed with one row; a missing
  row or query error aborts the job. For a present row it uses decimal
  `parseInt`, then falls back to one day when the parsed value is non-finite or
  non-positive. Prefix parsing such as `2days` therefore currently yields two.
  Local proofs must preserve this distinction; adopting strict whole-string
  integer validation is a separate parity decision before cutover.

The worker must not use a browser-provided time, a per-row wall clock, or
floating-point date arithmetic. Candidate reads and conditional writes bind
the same `now_utc`; a late job therefore processes all rows against one
well-defined boundary. Transfer-code expiry currently uses a strict `<` check
and needs a separate decision if the target is to normalize it to the grace
job's inclusive deadline convention.

## D1 transition and outbox boundary

D1 has no application-visible row lock that can span multiple Worker requests.
The target therefore needs an explicit, durable lifecycle operation record. The
following are proposed target concepts; their final names and columns belong
to the schema conversion/import work:

- `fanmark_licenses.lifecycle_version` is an integer compare-and-set version.
- A short-lived `lifecycle_claim_id` (or an equivalent unique operation row)
  reserves one license transition. All return, extension, transfer, and expiry
  writes use the same claim guard.
- `license_lifecycle_operations` records `operation_id`, license/fanmark
  identity, transition kind, captured `now_utc`, expected version, prepared
  lottery outcome, state, and completion time. It has a unique operation key
  for retries.
- `license_lifecycle_outbox` stores audit/notification work with a unique
  transition-based dedupe key and a delivery state. It is consumed by the
  notification worker after the lifecycle transaction commits.

The operation is shaped as a guarded D1 `batch()`, rather than a read followed
by an unconditional update:

1. Candidate discovery reads only eligible rows and records the expected
   status, version, end time, and fanmark identity.
2. A claim statement succeeds only when the expected status/version still
   matches, the claim is empty, the fanmark is eligible, and no active transfer
   claim exists. A competing extension, return, transfer, or expiry operation
   therefore receives a retryable conflict and cannot continue with a stale
   read.
3. Every following statement in the batch is conditioned on that same claim
   token. The audit row and outbox row are inserted from the claimed license,
   not from a Worker copy of a stale object. The final statement increments the
   lifecycle version and clears the claim. If the claim update changes zero
   rows, all dependent statements insert/delete zero rows; the caller records a
   conflict or a prior stored result, never a completed transition. A zero-row
   claim is not success, and no completion marker may be written for it.
4. A statement failure rolls back the state mutation, configuration changes,
   lottery writes, audit, and outbox together. The unique operation/dedupe
   keys make a successful retry a no-op.

Grace expiry requires a short preparation phase because the pending lottery
set and the capacity check are inputs to winner selection. The preparation
phase claims the grace license, snapshots the pending entry IDs and plan
capacity, and stores the chosen outcome and random seed in the operation row.
The finishing batch then performs all of the following under the claim:

- removes the expired configuration projections;
- marks entries as won, lost, cancelled, or `limit_exceeded`;
- inserts a new active license only when the stored outcome still passes the
  final capacity and uniqueness guards;
- inserts the no-winner or winner history;
- writes the expiry audit and all lifecycle outbox events;
- changes the old license to expired and clears the claim.

The finishing batch must put `WHERE EXISTS`/claim predicates on every delete,
update, and insert that depends on the old license. A crash after the claim but
before completion leaves a resumable operation, not a second lottery. A repair
run either completes the stored plan or clears a verified stale claim; it must
never silently reroll a winner. The Worker checks the final statement's
`changes` result before recording completion: `changes = 0` is a stale claim or
conflict, while a previously completed operation returns its stored result.
Local D1 tests must prove this exact batch shape, including rollback, zero-row
claims, and a competing extension/transfer. No production D1 atomicity or
throughput is proven by this document.

For the final plan-capacity guard, an active license counts when it is
`status = active`, not returned, and either has no end or has an end strictly
later than the same `now_utc`. The old expired license is excluded. This
explicit `NULL` branch is required for perpetual licenses. A partial unique
index or equivalent conditional insert must enforce at most one active license
for a fanmark; application checks alone are insufficient.

## Projection, audit, notification, and short IDs

Grace is a retained owner state. Owner dashboards may show a grace license,
but acquisition and public availability must treat it as blocking. Expiry
removes the public configuration projection before the fanmark can be offered
to a new owner. Configuration deletion is a transition effect, not a reason to
delete the fanmark identity or its discovery/favorite history.

The lifecycle transaction writes a durable audit record and a lifecycle
outbox record. It does not send email or mutate a scheduler from inside the
transition. Outbox event types cover the observed contract: grace started,
license expired, lottery won/lost/limit exceeded, lottery cancelled by
extension, owner return, and favorite availability. The outbox dedupe key is
unique across delivered and failed events, unlike a check that only suppresses
currently pending notification rows. A later delivery retry changes delivery
state only; it never repeats the license mutation.

`fanmarks.short_id` is a stable identity across return, expiry, lottery, and
transfer. The expiry job must capture it in event payloads and link payloads
from the authoritative fanmark row. It must not regenerate a short ID from an
emoji or expose a missing-ID fallback. Public `/f/:shortId` and other public
projections must resolve the current active license and its current public
configuration. Favorites retain their saved `display_fanmark`; lifecycle
notifications must use that stored display value or a reviewed display
projection, not an arbitrary normalized string from a stale candidate read.

A lottery or transfer creates a new license for the same fanmark identity and
short ID. The new license's `display_fanmark`, recipient, configuration name,
and owner notification are explicit inputs to that operation. The expiry job
must never reuse a prior owner's private configuration or infer the new
owner's display spelling from the old license.

## Lottery and owner-change ordering

After a grace deadline, the worker evaluates the pending entries while the
license claim is held:

- no pending entries: expire and record a no-winner result;
- one pending entry: award it only if the capacity and active-license guards
  pass;
- multiple entries: select using a cryptographically generated, persisted
  seed and the stored weights, then record the full outcome and probabilities.

The source uses a runtime random value and performs several independent writes.
The target must persist one auditable seed/outcome, enforce one entry per user
and fanmark, and mark every pending entry in the same finishing batch. A
candidate at the plan limit becomes `limit_exceeded`; it must not receive a
partially created license or audit event. If every candidate is at the limit,
write a no-winner history and keep the fanmark expired.

Transfer and extension are mutually exclusive with a held expiry claim. If a
transfer claim wins first, expiry defers; approval creates the recipient
license and cancels the old pending lottery before releasing the claim. If the
expiry claim wins first, a pending transfer request/code is not allowed to
create a new owner from the expired license and must be cancelled or reconciled
by the same owner-change state machine. An extension that loses the claim returns a conflict/retry result. Whether a
delayed cron may extend a grace license whose deadline has already passed is a
parity gate: the current endpoint checks status but not the deadline, while the
product lifecycle says the deadline has expired. A transfer or extension that
commits first makes the expiry CAS match zero rows, so no stale audit, deletion,
or lottery is emitted.

The transfer-code cleanup pass remains separate but uses the same guard: an
expired code or a code attached to a non-active license is marked expired and
pending requests are cancelled. It must not race an approval that holds the
license claim.

## Retry, failure, and observability contract

The cron may run repeatedly, overlap, or restart after a process failure.
Rerunning a completed operation finds a different status/version and emits no
new transition or notification. Rerunning an incomplete claimed operation
resumes its stored plan. A failed D1 batch leaves the pre-batch state intact;
a failed outbox delivery leaves a pending retry without reapplying the
license transition.

Worker logs and responses contain counts, transition kinds, operation status,
and sanitized error codes. They must not contain service credentials, raw
stack traces, owner email addresses, private configuration, or arbitrary
upstream error bodies. Metrics should distinguish skipped conflicts, completed
transitions, unresolved claims, outbox failures, and configuration gates. A
successful job response means the claimed transitions and durable outbox rows
committed; it does not mean email delivery or a production cutover completed.

## Parity gates before implementation or cutover

These are known gates from the repository and are deliberately not resolved by
this design document:

1. A live-only `manual-expire-grace-licenses` function is recorded in
   `docs/migration/live-observations.md`, but its body, invocation contract,
   authorization, and relationship to the local cron function are not present
   in this repository. It needs a read-only production review and an explicit
   migrate/replace/retire decision.
2. The lifecycle memo says expired processing deletes the profile projection,
   while the local `check-expired-licenses` source deletes basic, redirect,
   messageboard, and password projections but does not delete the profile.
   Confirm which projection is canonical before enabling deletion in D1.
3. The local lottery path rounds the new license end differently from the
   lifecycle memo. The target needs one approved rule and a boundary test.
4. The local lottery capacity query omits `NULL` (perpetual) ends when it
   counts active licenses. The target design above includes them, but this is a
   source-parity correction that requires an explicit acceptance test.
5. The expiry source and transfer/extension endpoints perform separate writes
   without a shared compare-and-set transaction. Existing behavior therefore
   permits partial audit/notification/configuration state after a failure and
   does not prove race safety. The D1 operation ledger and outbox are a proposed
   replacement, not an observed deployed feature.
6. The invalid grace-period setting fallback, strict transfer-code boundary,
   plan names/limits, lottery randomness, inactive-fanmark handling, and
   display-value choice need product decisions where the checked-in documents
   and source differ.
7. The D1 schema/import, Auth identity mapping, notification delivery worker,
   RLS replacement, staging concurrency run, and production environment
   protection are separate prerequisites. No production D1 resource, secret,
   cron, or deployment is configured by this design.

The design can proceed to a local implementation with synthetic boundary and
concurrency tests while these parity decisions remain open. Before a staging
or production cutover, each gate needs an owner, a read-only staging proof, and
rollback evidence. Production cutover remains a later approval after the
reviewed Worker, import, notification consumer, and environment settings exist.

## Source references

- [Product lifecycle requirements](../PRODUCT.md)
- [Checked-in lifecycle memo](../LICENSE_LIFECYCLE.md)
- [`check-expired-licenses`](../../supabase/functions/check-expired-licenses/index.ts)
- [Shared return helpers](../../supabase/functions/_shared/return-helpers.ts)
- [`extend-fanmark-license`](../../supabase/functions/extend-fanmark-license/index.ts)
- [`approve-transfer-request`](../../supabase/functions/approve-transfer-request/index.ts)
- [Live-only observations](live-observations.md)
- [D1 concurrency fixture](d1-concurrency.md)

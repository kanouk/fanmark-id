# Grace-expiry lottery finalization

`workers/api/src/license-lottery-selection.mjs` implements deterministic
weighted selection. The source-profile finalizer in
`workers/api/src/license-grace-finalization-source.mjs` now uses it when an
expired grace license has pending lottery entries.

The finalizer fences each license by incarnation and lifecycle/access
generations. Before drawing, it claims the license and persists a cryptographic
seed and exact input snapshot. It then persists the selection plan, which is
replayed from the stored seed and inputs on retries instead of drawing again.
Input and plan JSON are each limited to 1 MB and together to 1.8 MB so the
journal row has headroom below D1's per-row size limit.

Weights remain canonical positive decimal strings and are converted to
common-scale `BigInt` values; no weight is converted to JavaScript `Number`.
The selection records each draw and outcome. The final D1 batch rechecks the
license claim and current winner capacity, expires the old license, advances
access generations, removes license-scoped configuration, updates lottery
entries, issues a winner license when eligible, writes lottery history,
notifications and audit effects, completes the journal item, and releases the
claim atomically. A stale capacity or eligibility snapshot records a durable
conflict without applying the transition.

The source lottery-entry status constraint permits `pending`, `won`, `lost`,
`cancelled`, and `cancelled_by_extension`; it does not permit
`limit_exceeded`. A capacity-rejected draw is therefore stored as `lost` in the
entry row, with `rejected_reason: "limit_exceeded"` in its history and a
`lottery_limit_exceeded` event. This preserves the reason without violating
the current source constraint.

The finalizer has local integration coverage for winner issuance, weighted
winner/loser outcomes, a sole applicant over capacity, stale capacity,
transaction rollback on required-event failure, and exact-plan retry. The
focused source integration suite passes 25/25; lottery selection passes
10/10; scheduled-expiry tests pass 8/8.

On 2026-09-25, a one-shot scheduled-event canary ran the current Worker code
with a remote binding to the isolated `fanmark-business-staging` D1. One
synthetic pending entry won; readback confirmed old-license expiry, a new
active winner license, lottery history, persisted seed/input/plan, audit and
notification events, zero conflicts, and removal of the four access
configuration projections. The source behavior retains the separate profile
row. Cleanup returned all 40 source business tables and the lifecycle run/item
journals to zero, while the retained incarnation registry exactly matched its
pre-canary snapshot. No Auth user was created. The deployed app keeps
`LICENSE_EXPIRY_BACKEND` unset and has no Cron trigger, so scheduled processing
remains disabled; this canary does not import user lottery rows or change
production/domain routing.

Reproduce the staging proof with:

`npm run test:staging-license-expiry-lottery-smoke`

It requires the authenticated
Cloudflare account and exact staging bindings; it refuses to seed unless the
business source tables and lifecycle journals satisfy their empty-state
preflight, then checks cleanup in `finally`.

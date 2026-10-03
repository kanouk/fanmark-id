# Fanmark lottery entry Worker API

This is the staging D1 implementation of the current `apply-fanmark-lottery`
and `cancel-lottery-entry` Edge Function contracts. It covers application and
cancellation only; selecting a winner, issuing the next license, and finalizing
an expired grace period remain separate lifecycle work.

## Routes and selection

- `POST /api/fanmarks/lottery/apply` accepts `{ "fanmark_id": "..." }`.
- `POST /api/fanmarks/lottery/cancel` accepts `{ "entry_id": "..." }`.
- Both routes require a Better Auth session and resolve the applicant from the
  server-side session. The cancellation route checks entry ownership.
- `VITE_FANMARK_LOTTERY_BACKEND=worker` selects these same-origin endpoints.
  The default remains Supabase, and a selected Worker error never falls back
  to Supabase.
- `FANMARK_LOTTERY_BACKEND=d1` enables the app Worker's D1 implementation.

## Preserved source behavior

Application requires one related grace license whose deadline is strictly
later than the request time. A missing or ambiguous license is rejected. The
applicant must have one `user_settings` row. Plan limits come from the
corresponding `system_settings` key, default to three when the setting is
missing/unreadable, and leave `admin` unlimited. The target active count is active, not returned, and unexpired, including
perpetual licenses with a null end date. This follows the product's capacity
requirement; the source Edge query only uses `license_end > now` and therefore
excludes perpetual licenses.

There is one entry per `(fanmark_id, user_id, license_id)`. A pending entry is
rejected, a cancelled entry is reused and reset to pending, and a new entry
starts with probability `1.0`. The admission mutation rechecks grace validity,
capacity, and entry uniqueness inside a D1 batch. Its audit record is in the
same batch, matching the source table trigger's rollback behavior. Notification
event creation happens after the saved entry and is best effort, as in the
source function. Pending count is response metadata and also best effort.

Cancellation updates only the authenticated owner's pending entry. The status
change and its trigger-equivalent audit record are one D1 batch. A race that
changes the entry first cannot overwrite that status.

## Evidence and limits

The native D1 suite applies all 25 canonical Business migrations and all four
selected Auth migrations, then uses actual Better Auth credential sign-in and
cookies through the Worker router. No auth resolver or API response is stubbed.
42 cases pass: admission, duplicate/reuse, quota/default/perpetual limits,
ownership, session/origin, concurrent apply/cancel, claimed/stale licenses,
audit abort and best-effort notification failure, 27 audit integrity faults,
caller-selected owner rejection and warmed-session revocation. Both databases'
foreign keys are checked after each case. The suite is now invoked by
`test:api-contracts-d1`, and thus Worker `npm test`/Cloudflare validation CI.
The frontend contract suite remains separate.

The reviewed source `log_lottery_entry_changes()` definition has SHA-256
`487ca629d71ec1cad7bfab41fc158394c85e8f6e74b337d0a1733e5faf98f7f0`;
its enabled INSERT/UPDATE binding has SHA-256
`122ce5fd21b07a781531ac9f53039c99b6107189ede65e1908e10dbefc60ee76`.
Its INSERT audit contains applicant/entry/fanmark/license/probability; a status
change records the old/new statuses and cancellation reason. Apply/reapply and
cancel explicitly reproduce those effects inside their D1 batches, rather than
installing a general trigger that would duplicate other writers' audits.

Nine initial new/reapply/cancel × ignored/changed/deleted audit cases returned
200 on the prior code. The new server-generated audit UUID identifies exactly
this mutation. A final SQL assertion in the same batch compares its owner,
action, resource, timestamp, request identity and metadata against the saved
entry and expected state. Missing/corrupted audits raise a SQLite error before
batch commit; entry, audit and event baselines remain unchanged. The native
suite covers nine failure modes for each action and safe retry after removing
the injected fault. Duplicate and status/capacity races retain their normal
refusal responses. The assertion creates no persistent guard row and requires
no new remote schema. Other lottery writers, external callers and whole-trigger
acceptance remain separate requirements.

This candidate's local 42/42/typecheck/lint proof is not deployed acceptance.
The currently accepted staging runtime remains 47b69c5; CI, guarded deployment
and a synthetic lottery HTTP readback for the new code remain next steps.

The current business D1 staging database contains schema/master projections,
not imported user rows. Synthetic fixtures can prove these route mechanics;
they do not prove imported-user or source-row parity. The staging HTTP rehearsal
must create and delete its own Better Auth user, user settings, fanmark,
license, entry, audit, and notification rows and verify the 40 business tables
are empty afterward. Lottery drawing/selection, active-license issuance,
notification delivery, and full plan/master-data parity are not established by
this API slice.

The source-shaped grace finalizer separately persists selection, license,
entry status, audit and notification effects with replay guards. See
[`lottery-selection.md`](lottery-selection.md) and the lifecycle contracts for
its own acceptance; this API suite does not establish recurring lifecycle,
archive/retention, real provider or imported-user acceptance.

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
missing/unreadable, and leave `admin` unlimited. The active count follows the
source query exactly: active, not returned, and `license_end > now`; perpetual
licenses with a null end date are not counted by this particular source query.

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

The isolated Miniflare suite exercises success, duplicate/reuse, quota and
default limit, null-ended active licenses, ownership, session/origin checks,
same-entry concurrency, audit rollback, and notification failure. The frontend
suite checks routing, cookie credentials, no-store behavior, backend selection,
and no fallback after Worker failure.

The current business D1 staging database contains schema/master projections,
not imported user rows. Synthetic fixtures can prove these route mechanics;
they do not prove imported-user or source-row parity. The staging HTTP rehearsal
must create and delete its own Better Auth user, user settings, fanmark,
license, entry, audit, and notification rows and verify the 40 business tables
are empty afterward. Lottery drawing/selection, active-license issuance,
notification delivery, and full plan/master-data parity are not established by
this API slice.

The separate deterministic selection primitive is documented in
[`lottery-selection.md`](lottery-selection.md). It is not wired to the expiry
job and does not persist a decision in D1, so a cron retry cannot yet resume a
lottery from this helper alone.

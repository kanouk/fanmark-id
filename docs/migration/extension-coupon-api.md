# Extension coupon D1 API

Cloudflare staging routes the existing extension-coupon UI to D1 when its
explicit frontend and Worker selectors are enabled. Production/default builds
continue to use Supabase. The staging seed now contains only four verified,
never-used coupon definitions. Usage history, consumed definitions, creator
identity, license rows, and user rows remain excluded.

## User redemption

`POST /api/me/licenses/extend-with-coupon` requires the current Better Auth
session and accepts exactly:

```json
{
  "license_id": "uuid",
  "coupon_code": "UPPERCASE-CODE",
  "request_id": "uuid"
}
```

The Worker rechecks active coupon, expiry, remaining capacity, allowed tier,
per-user/fanmark duplication, current license ownership/status, transfer state,
perpetual status, and the Grace plan limit in D1. The request's date result is
computed from `max(now, license_end)`, with month-end clamping and UTC-midnight
rounding.

One `extension_coupon_application_commands` INSERT runs database triggers in
the same D1 write transaction. It claims one coupon use, inserts its usage row,
updates the license, cancels pending lottery entries using the valid
`license_extended` reason, emits one deduplicated notification event per
cancelled applicant, writes audit entries, and records the response snapshot.
Additive migration `0021_coupon_lottery_status_audit.sql` restores the source
per-entry `LOTTERY_ENTRY_STATUS_CHANGED` audit. The trigger runs only when a
pending entry is cancelled with a newly assigned coupon-command marker. It
checks the processing command identity and captured time, then verifies the
inserted audit's applicant, entry, command ID, action, resource, metadata and
time. Missing or corrupted audit rows abort the whole command, including
coupon capacity, usage, license change and notifications. A later update by
another writer that retains an old coupon marker does not create a duplicate.
Previously applied migrations 0015 and 0019 are unchanged. This describes the
locally tested migration; its guarded remote application and synthetic
command/replay/cleanup smoke passed on 2026-10-03, as recorded in HANDOFF.
A unique `(user_id, request_id)` key makes sequential or concurrent retries
return the original result; a conflicting payload receives 409. Grace-state
commands snapshot the plan type and configured/fallback limit, then the trigger
rejects a configuration change before applying the command. A second unique
index prevents another request from applying the same coupon to the same user's
fanmark.

The route keeps the error codes used by `ExtendLicenseDialog`, including
`coupon_not_found`, `coupon_expired`, `coupon_usage_exceeded`,
`tier_not_allowed`, `coupon_already_used_on_fanmark`,
`fanmark_limit_exceeded`, `perpetual_license`, and `transfer_in_progress`.

## Admin management

`/api/admin/extension-coupons` requires Better Auth administrator role and a
recent MFA assurance bound to the session/factor. It supports list/create,
active-state PATCH with an `expected_updated_at` compare-and-swap, deletion of
unused coupons only, and `GET /:couponId/usages`. Usage display names and
fanmark labels are returned only to the authorized admin route. All responses
are `no-store`; origins are checked against the Worker allowlist.

Staging configuration selects the user route with `EXTENSION_COUPON_BACKEND=d1`
and the admin route with `EXTENSION_COUPON_ADMIN_BACKEND=d1`. The browser uses
`VITE_EXTENSION_COUPON_BACKEND=worker` and
`VITE_EXTENSION_COUPON_ADMIN_BACKEND=worker`. An explicit Worker failure never
falls back to Supabase. A guarded read-only source projection and staging seed
selected exactly four definitions with `used_count = 0` and no matching usage
row. The source creator ID is omitted and `created_by` is NULL in staging. The
seed binds canonical row content to a pinned digest, refuses any existing
non-empty or changed target, and verifies exact D1 readback plus zero usage
rows. Source codes and row values are held only in a mode-0600 temporary file;
they are not checked into Git or printed by the script.

The live source aggregate also found four consumed definitions, 20 usage rows,
and two mismatches between definition counts and usage history. Those records
and all usage history remain in Supabase for the deferred user-data phase;
the four staged definitions are not evidence of full coupon parity or a
reconciled redemption history.

## Verification boundary

Dedicated Miniflare tests use synthetic users, coupons, licenses, and lottery
entries to check atomic success, response replay, coupon-cap competition,
duplicate use, transfer and tier rejection, Grace limits, notification/audit
creation, suppressed/corrupted per-entry audit rollback and retry, retained
marker scoping, admin MFA-gated route wiring, and safe coupon deletion. The
redemption suite passes 11/11 after reproducing the missing two per-entry logs
in the pre-fix implementation. These tests do
not establish live Supabase parity, imported-record readiness, a successful
authenticated staging redemption against imported user data, or production
behavior. The staging definitions are restricted to the four verified unused
masters described above.

## Guarded staging rehearsal

Run `node scripts/migration/staging-coupon-lottery-audit-smoke.mjs` for read-only
preflight. `--apply-and-smoke` additionally applies only migration 0021 if the
canonical ledger is immediately before it, uses a private file import containing
the migration and its ledger INSERT together, verifies the exact new trigger and
existing 0015/0019 triggers, then creates a synthetic coupon/license/two entries.
The command checks individual audits, same-request replay, usage and notification
counts, then removes its own source-table rows and coupon commands and proves the
40-source-table/master baseline plus empty Auth. Lifecycle incarnation
tombstones remain intentional runtime metadata, separate from imported user rows.
The target guard pins account, Worker and both D1 bindings; source-backed master
rows must retain their verified baseline. The synthetic cleanup journal is kept
outside the repository in a private temporary directory. No provider, production
Supabase, real user import or domain operation occurs.


## Native staging UI follow-up (2026-10-06 JST)

Actual Safari coupon redemption was accepted with disposable synthetic identities
and read-only D1 comparison. Exact owned cleanup and a separate least-privilege
process preserved human Auth3/7/2, all24 Master table hashes, existing coupon
definitions, profiles/MFA/templates, anonymous search history5/8 and FK0.
[UI and cleanup evidence](evidence/staging-coupon-return-lottery-ui-2026-10-06.json).
This does not prove imported-user parity, winner selection or actual-phone use.
Earlier zero-Auth/global-empty cleanup descriptions are historical canaries.

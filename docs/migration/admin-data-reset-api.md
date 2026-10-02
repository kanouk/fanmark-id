# Administrator data reset migration

The legacy `AdminDataReset` screen invokes `reset-fanmark-data`. Its eight
explicit deletes exclude the nil UUID and leave Auth users, user settings,
invitations, waitlist and system/master settings in place. Native source FKs
also cascade some dependent rows or reject a delete with restrictive history
references. The legacy function does not check every delete error; the target
must not report successful completion after a partial delete.

The prepared Worker operation is `POST /api/admin/data-reset`, requiring an
allowed explicit Origin, Better Auth, the existing administrator role and
current-session MFA gate, split Business D1, and `ADMIN_DATA_RESET_BACKEND=d1`.
Its only request fields are a UUID `requestId` and `confirmation="DELETE"`.
Caller-supplied actor/table/SQL/count fields are rejected. The server role gate
records `UNAUTHORIZED_DATA_RESET_ATTEMPT` for an authenticated non-admin,
retaining actor/time/CRITICAL_RISK while omitting source email metadata.
Anonymous, Origin and MFA failures do not manufacture a source actor audit.
Failure to persist a role-denial audit closes authorization with 503.

Additive Business migration `0023_admin_data_reset.sql` creates a durable
command receipt and native INSERT trigger. In one transaction the trigger
captures counts for the eight source tables, performs the ordered deletes,
checks no eligible row remains, builds the result, and persists/verifies the
exact `ADMIN_DATA_RESET` audit. Rejected or suppressed deletes, missing or
corrupted audits, and restrictive FKs abort all effects and the receipt.
Completed receipts cannot be updated. Reusing the same request ID for the same
actor returns its stored result without deleting rows created after the first
commit; another actor cannot use that ID. No password/cookie/email is stored
in a receipt or reset audit. License incarnation tombstones remain monotonic,
so a reset does not make an old access proof valid if a UUID is reused.

Restrictive source coupon-history and target lifecycle-journal references
return `409 data_reset_blocked_by_history` with no partial deletion. This
operation does not discard or rewrite these histories merely to clear an FK.
A request-ID collision also returns 409 without a mutation. Other database or
receipt failures return a bounded 503. The success DTO retains the source
`success`, `deletedCounts` and `totalDeleted` shape; counts describe explicit
eligible rows, with native cascading behavior separate from those counts.

The opt-in frontend Worker adapter validates the exact DTO/count sum and has
no Supabase fallback. Its dialog requires typing DELETE and retains the
operation ID after an uncertain result, so retry checks the existing operation.
Normal builds continue selecting Supabase. The next Cloudflare staging build selects
`VITE_ADMIN_DATA_RESET_BACKEND=worker` with `ADMIN_DATA_RESET_BACKEND=d1`.
The currently deployed Worker has neither enabled; local configuration is
preparation for the guarded rehearsal, not remote acceptance.

Local D1 tests apply every checked-in Business migration (24 at this checkpoint)
and exercise complete-schema deletion, preserved settings/discoveries,
incarnation fences, concurrent retries and new rows, nil UUIDs, empty reset,
immutable receipts, delete ABORT/IGNORE, audit ABORT/IGNORE/corruption,
restrictive source/target history, confirmation/identity/origin/MFA gates and
role-denial audit failures. D1 tests pass 15/15; frontend adapter/mode tests 6/6,
Worker/app typecheck, ESLint, staging build and migration data 244/244 pass.

Remote 0023 application, runtime enabling, guarded synthetic TOTP/API reset
with operator recovery and cleanup, and rendered dialog acceptance remain.
Those must guard account/version/split bindings, empty real user/source rows,
exact migration trigger definitions and all retained master baselines before
any delete. The `--admin-data-reset-roundtrip` / `--admin-data-reset-browser` modes of
`workers/api/test/staging-admin-totp-smoke.mjs` cannot compose with other actions.
They require the fixed account and 100% deployment version, canonical migration
ledger and exact trigger SQL, all source business/user tables empty apart from
retained masters, empty Auth, and no stale reset guards/receipts. A private
journal records actor, target identity, fixture UUIDs and trigger names before
remote writes. Eight temporary native BEFORE DELETE guards reject any row
outside the fixture even if another writer races the preflight; a full-schema
D1 case verifies that the entire reset then rolls back. Guard tests pass 2/2.
The rehearsal checks sign-in/enrollment/MFA, eight deletes, exact audit/receipt,
a later-row retry, non-admin rejection, retained config/catalog/Auth fingerprints
and exact fixture cleanup. Browser mode additionally checks typed DELETE, actual
frontend request/receipt and rendered one-row result. Its synthetic admin profile
is included in the shared cleanup, and the full source-empty guard runs again.

After an interrupted run, inspect the private journal first. Recover only its
eight fixture IDs, discovery ID, actor-bound reset receipts/audits and exact
trigger names, then the two journaled synthetic Auth identities/profiles. Do not
run the reset API as cleanup or delete unrelated rows. Preserve license
incarnation tombstones and the MFA generation singleton.
No source production row or real Auth/business/Storage row was migrated,
read or deleted by this local preparation. Domain/DNS cutover stays deferred.

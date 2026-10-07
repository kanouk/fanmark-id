# Fanmark transfer D1 API

The transfer UI remains on Supabase unless `VITE_FANMARK_TRANSFER_BACKEND=worker` is explicitly set. The Worker requires `FANMARK_TRANSFER_BACKEND=d1`, Better Auth session cookies, split business/auth/master D1 bindings, and the configured CORS origin. Worker errors never cause the UI to switch back to Supabase.

The authenticated routes are `GET /api/me/transfers` and `POST /api/me/transfers/{issue,apply,cancel,approve,reject}`. Issued codes are visible only to their issuer; pending requests are scoped to either the issuer's active/applied codes or the authenticated requester. Transfer codes are generated from 60 random bits and are never written to logs.

Issue, apply, reject, cancel, and approval state changes use D1 batches. Approval retires the old license, creates a fresh recipient license from the active master-tier duration, sets the 30-day transfer lock, deletes the old access/profile/password configuration, creates an inactive basic config, cancels pending lottery entries, and writes the audit/outbox records. It does not copy the old configuration. The UI may provide the new basic-config display name.

Recipient capacity is reserved while an incoming transfer request is pending.
The limit check counts active, unexpired licenses plus pending requests whose
transfer code is applied. The code transition to `applied` repeats this count
inside its D1 batch, so two simultaneous applications cannot reserve the last
available slot. Approval checks capacity again inside the first conditional
statement of its batch before it retires the sender's license. It counts all
pending reservations, including its own, as the slot that is being converted
into an active license;
it is allowed when active licenses plus applied pending requests are at or
below the current limit. If the recipient plan or active license count changed
after application and that total is now above the limit, approval fails with
`fanmark_limit_exceeded` and leaves the request, transfer code, sender license,
and associated settings unchanged.

Approval also records `LOTTERY_ENTRY_STATUS_CHANGED` once for each pending
lottery entry it cancels, matching the source `log_lottery_entry_changes`
trigger. Each row records the applicant ID, entry ID, old/new status,
`system` cancellation reason, and captured approval time. These writes share the approval batch. The Worker captures pending entry
identities and assigns an independent server UUID to each intended audit.
A first assertion rejects any changed snapshot before effects; cancellation
updates only captured rows. A later assertion checks every captured row and
its exact audit UUID, actor, action, resource, time, null request ID and metadata.
New uncaptured pending rows also abort the batch. The completion assertion
checks both licenses, code/request, configuration cleanup/new inactive config,
the exact transfer audit and notification outbox. A missing, altered or
suppressed required write rolls back all approval effects. Previously cancelled entries
and entries on another license are unaffected; a repeated approval creates no
additional cancellation audit. These cases are covered by the D1 suite.

The current Supabase schema constrains `fanmark_lottery_entries.cancellation_reason` to `user_request`, `license_extended`, or `system`, while `approve-transfer-request` attempts to write `license_transferred`. The D1 implementation records this transfer-triggered cancellation as `system`, which satisfies the current source DDL and keeps approval atomic. Aligning the source check and event vocabulary remains a separate source-schema correction.

Local proof is provided by `workers/api/test/fanmark-transfer-d1.test.ts` and `src/lib/fanmark-transfer-api.test.ts`, including two synthetic transfer requests competing for one recipient slot and a plan-limit change between application and approval. The staging smoke uses only short-lived synthetic Better Auth users and synthetic business rows, then verifies cleanup. It does not import existing Auth/users or touch domain/DNS state.

## Native integrity follow-up (2026-10-03 JST)

The prior implementation returned200 in nine actual native
ignored/altered/deleted entry-audit cases. The upgraded suite passes37/37 using
all25 Business and4 Auth migrations, real credential sign-in/session cookies,
and the Worker router. Its Master binding uses a focused Tier fixture rather
than the entire Master schema. The router supplies its existing injected
operation clock; production still uses current time.

Coverage includes ten entry-audit field/suppression faults, three transfer-audit
faults, eight suppressed required effects, one missing audit among multiple
applicants, a new uncaptured native-trigger applicant, a pre-batch concurrent
snapshot change, empty pending entries, ownership from the actual session,
warmed-session revocation and capacity races. Every injected failure checks the
entire relevant row set (including wake state) and safe retry. The competing
real-session application test accepts400 for a preflight limit refusal or409
for a conditional-batch loss, and still requires exactly one reservation.
All three bindings receive foreign-key checks after each test.

## Staging integrity acceptance (2026-10-03 JST)

Code c6a4f9d CI37090152096 passes both jobs and is deployed as Worker
71d1612f-5220-4bf1-bc7f-99cc43adbbd7 at100%. Independent02:45:22.182Z readback
follows five actual HTTP fault/rollback/retry cases: one of two applicant audits
ignored, metadata-changed or deleted; transfer audit ignored; old profile DELETE
ignored. Each fault is scoped to generated fixture IDs and is removed before
retry. Failures500 preserve exact approval rows, event IDs and requested wake
generation. Retries200 verify exact audits for both applicants and the transfer,
old/new licenses, configuration deletion/new inactive config, lock and outbox.
Repeated approval400 adds no rows. Native Master remains a fixture; the remote
flow reads the actual Master Tier1 row and verifies the resulting license.

Journal transfer-audit-5LT5tv/canary.json is verified-and-cleaned. All three
synthetic Auth users, business fixtures and inboxes are removed; the temporary
trigger is gone, all other trigger definitions match, both DB FK checks pass
and cookies return null sessions. Master canonical3944/release7888/import/
activation/history, MFA generation236 and the three secret names are unchanged.
Wake legitimately advances7→17 and is acknowledged17:17; it is not reset.
Static assets match and unconfigured provider entries stay closed. Private
acceptance: /tmp/fanmark-transfer-c6a4f9d-staging-acceptance.json.

Account-deletion audit integrity, other source runtime/RLS/callers, real provider/
phone/CPU/plan and operational acceptance remain separate open work. Existing
real users and domain/DNS have not moved; this is scoped transfer acceptance.

## Recorded native transfer UI (2026-10-06 JST)

The disposable Safari sender/recipient flow already accepted issue, application,
approval, expired sender view and the recipient's seven-day inactive license.
The D1 inactive reset and thirty-day lock, two delivered in-app events, UI logout,
owned cleanup and independent preservation readback were confirmed.
[Bounded UI evidence](evidence/staging-transfer-ui-2026-10-06.json).
The eight captured transfer frontend/router files are unchanged from0ed4213 to
runtime4445297; this is linkage to that prior proof, not a new UI run.
Code reissuance during the lock, all former profile/password configurations,
physical phones and the whole multilingual flow were not accepted by that proof.
Final shared dependencies/integration retain their own requirements.

## Historical staging lifecycle canary (2026-09-25 JST)

Worker version `929280ae-3285-4936-af67-a6f146aae03e` was active at 100% on
`fanmark-app-staging`. The live synthetic issue/apply/approve flow passed. Its
first run exposed a D1 batch metadata mismatch: the database had committed the
complete transfer, while the handler returned `409` because the reported
change count did not match. At that checkpoint, approval read back the request, code, old
license, and recipient license and returns success only when those exact rows
show a completed transfer.

The successful staging rerun verified the retired owner license, active
recipient license, configuration reset, 30-day lock, lottery cancellation,
audit/outbox rows, and clean recipient inbox. Cleanup returned all 40 source
business tables and all user-owned Auth tables to zero; the global MFA
generation counter matched its pre-canary value. The Worker remains on the
workers.dev staging hostname. No source users, production routes, or domain/DNS
settings changed.

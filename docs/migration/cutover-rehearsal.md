# Synthetic cutover and recovery rehearsal

Parent issues: [#28](https://github.com/kanouk/fanmark-id/issues/28) and
[#37](https://github.com/kanouk/fanmark-id/issues/37).

## Scope and current decision

This runbook defines the synthetic staging rehearsal for moving the application
write authority from Supabase to Cloudflare. It does not authorize a production
freeze, read or copy real user rows, switch public hostnames, or change DNS.
Those operations remain in the final phase tracked by #38.

The systems must have exactly one business-data writer at a time. Supabase
remains authoritative until a reviewed final import is reconciled. Cloudflare
staging canaries use synthetic identities and rows only. Do not enable a
production selector or a second writer to make this rehearsal easier.

Reverse migration after Cloudflare accepts a successful business write is not
proven. The recovery policy is therefore split at that event:

1. **Before Cloudflare accepts writes:** keep the application in maintenance,
   disable Cloudflare write selectors, and resume the old Supabase application
   only after confirming no Cloudflare business write succeeded.
2. **After Cloudflare accepts a write:** keep Cloudflare as the sole authority.
   Repair forward on Cloudflare while in maintenance. If the Worker cannot
   serve traffic, retain maintenance and use individual support; do not point
   traffic at Supabase, because that would hide the accepted Cloudflare write.
   A later recovery must restore a verified Cloudflare backup and reconcile its
   durable operation/Stripe ledgers before writes resume.

No old/new dual-write window is allowed. Once Stripe receipt intake is moved,
one durable receipt ledger remains available throughout. A single dispatcher
applies each event to business state; the previous dispatcher is stopped before
the new dispatcher is enabled. Receipt continuity does not mean both systems
may apply the same event.

The Cloudflare Worker has a separate `CUTOVER_WRITE_FREEZE` switch. The staging
config defaults it to `false`; setting it to `true` blocks non-read API
operations (including admin mutations and signup), while preserving only
administrator sign-in/session/TOTP verification and the Stripe webhook receipt
endpoint. It also skips all Worker scheduled jobs. An unknown non-empty value
fails closed in the same way. This switch does not pause Supabase writes or
Supabase Cron jobs; those source-side writers must be frozen and drained
separately at the authorized final operation. The regular user-facing
`maintenance_mode` remains a page gate and is not a substitute for this switch.

The latest read-only source inventory (2026-09-27 JST) found Supabase
`check-expired-licenses-daily` active at `0 0 * * *` with direct target
`check-expired-licenses`; its `cron.timezone` is `GMT`. The old
`process-notification-events-every-minute` job is inactive. These are current
production observations, not staging actions. Before the final writer freeze,
re-read the source jobs and timezone, stop the then-current old expiry schedule,
and confirm no old invocation remains in flight before enabling the Cloudflare
daily lifecycle trigger. Do not change the production schedule during the
staging rehearsal.

## Rehearsal sequence

Run each phase against the isolated workers.dev app and staging D1/R2 resources,
with synthetic identities and unique marker values. Record start/end times,
commands, deployment IDs, database names, counts, digests, and cleanup readback.
Do not record tokens, password hashes, email addresses, or row contents in the
public report.

| Phase | Action | Evidence required to continue |
| --- | --- | --- |
| 0. Preflight | Confirm staging account and exact Worker, split D1, R2, Cron, selectors, and backup bucket. Confirm default/production selectors still use Supabase. Pin the current master-release digests and synthetic test identities. | Account/resource readback; no production hostname or production binding; synthetic-only preflight. |
| 1. Prepare | Build and test the Worker/SPA. Apply the reviewed D1 migration chain to an empty disposable rehearsal target. Verify master release pointers and required allowlisted configuration. Keep signup, business mutation, lifecycle, and Stripe dispatch closed until the rehearsal enables them explicitly. | Clean migration ledger; schema and master digests; route/selector inventory; synthetic canary cleanup preflight. |
| 2. Quiesce old writers | In staging, enable maintenance and `CUTOVER_WRITE_FREEZE=true`; stop all old application mutation paths and scheduled business writers. Drain or account for in-flight writes. Keep the old Stripe receiver durably recording receipts while its business dispatcher is paused. Confirm only one receiver/ledger owns each event ID and no event is lost or applied twice. | Mutating Worker API requests return 503, scheduled jobs do not run, sign-in/TOTP still work, and the Stripe receipt endpoint remains reachable. Anonymous and synthetic old-path writes are rejected; receipt IDs are durable; in-flight count is zero or reconciled. |
| 3. Final synthetic copy | Capture a catalog-fingerprinted repeatable-read snapshot and a separate Storage inventory. Import the synthetic business snapshot into the disposable D1 target, seed only reviewed masters, and apply the reviewed credential transform to synthetic credentials. | Snapshot verification; row/key/hash and FK reconciliation; sequence state; Storage object hash/readback; no unresolved import acknowledgement. |
| 4. Resume new writer | Enable only the staging Worker selectors. Enable the single chosen Stripe dispatcher after receipt-ledger handoff. Exercise registration, owner updates, return/transfer/lottery, notification processing, R2 upload/delete, one duplicate/replayed synthetic event, and the PWA shell while offline. | Synthetic end-to-end results; exact event-once behavior; D1/R2 readback; offline navigation serves only the static shell while API requests remain uncached; old write paths remain closed; cleanup leaves only documented master and anti-replay state. |
| 5. Recover | Run two explicit failure drills: fail before the first Cloudflare business write and fail after one acknowledged Cloudflare write. Prove the pre-write path can resume Supabase, and prove the post-write path stays on Cloudflare under maintenance and restores/reconciles from its verified backup. | Timestamped recovery record, measured interruption for each drill, restored digests, and exact synthetic row/ledger reconciliation. |

Measure the user-visible interruption from the first old-path rejection through
the first successful new-path synthetic mutation. Report this as a staging
measurement, not a production RTO promise. Record snapshot/export/import and
reconciliation durations separately so the maintenance window can be estimated
from observed work rather than assumed.

## Go/no-go gates

The rehearsal is not complete until each applicable gate has evidence. A green
unit suite or an empty-table readback alone is insufficient.

- The refreshed source catalog fingerprint matches the conversion and import
  artifacts. Converter v11 reports 13 unresolved groups across 226 locations
  (8 row-conversion groups / 133 locations and 5 schema/operation groups / 93
  locations) and `deployable: false`. The fresh-catalog synthetic replay passes
  40/40 table checkpoints, but the full schema/import parity gate remains open;
  see [schema conversion](schema-conversion.md#version-11-descriptor-aware-fresh-catalog-replay-2026-09-28-jst).
- The current schema's synthetic import/restart rehearsal passes, including
  constraints, sequence state, exact codecs, credential transform, and
  typed readback. This does not imply that real user rows have been exported.
- Auth identity mapping and Storage object inventory are represented by
  separate, verified synthetic artifacts; neither is inferred from the public
  database snapshot.
- Stripe receipt intake, dispatch ownership, and replay behavior are explicit.
  The current staging selectors/secrets keep payment routes closed, so the
  Stripe handoff drill has not passed.
- The selected Workers plan can run the measured authentication, authorization,
  lifecycle, and scheduled workloads with adequate CPU headroom. The latest
  staging sample includes successful requests above the Free plan's 10 ms
  limit; occasional over-limit success is not a recurring-traffic guarantee.
  Either optimize the auth/admin/lifecycle paths that exceeded the limit and
  repeat representative staging measurements, or have the account owner select
  a plan with sufficient CPU limits before production acceptance. See the CPU sample in
  [HANDOFF.md](HANDOFF.md) and Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Each recovery drill records elapsed time and exact reconciliation. Until the
  post-write forward-recovery drill passes, returning traffic to Supabase after
  a Cloudflare write remains prohibited.
- A separate review confirms the implementation, deployment, and operational
  evidence. Production approval and DNS are outside this runbook.

## Evidence at 2026-09-27

Already verified with synthetic data: integrated staging registration/Auth/
business/R2 flows; lifecycle Cron canary and cleanup; encrypted snapshot
restore across processes; private staging R2 encrypted-object round-trip;
staging master edit/restore; and current-catalog importer rehearsal over all
40 source tables. Local migration-data, Worker, typecheck, staging-build, and
Wrangler dry-run suites are recorded in [HANDOFF.md](HANDOFF.md).

The current staging deployment has an isolated anonymous browser check: `/plans`
and `/plan` redirect to `/auth`; the active service worker controls `/pwa`, its
precache includes both manifest icons, and offline reload serves the shell
while the API/catalog request shows the retry screen. Native install/standalone
launch on the staging workers.dev hostname in Chrome on macOS and the deployed
staging service-worker update transition both passed on 2026-09-28.
Cross-browser/OS and custom-domain behavior remain open; see
[`static-assets.md`](static-assets.md).

Not verified: a coordinated freeze of the actual old Supabase writers with
receipt continuity, a timed full final-copy window, the complete pre/post-write
recovery drills, resolved schema gates, live Stripe sandbox acceptance,
production backup key custody/retention, or production operation. The staging
write-freeze receipt canary and the isolated application-schema post-ack restore
below are narrower proofs; neither stops a Supabase writer or applies a Stripe
business effect. A short Worker-only staging drill is also verified: its freeze
rejected a synthetic mutation, preserved the sign-in preflight, and accepted
then deduplicated one locally signed synthetic Stripe receipt while leaving its
dispatch pending. The synthetic receipt and dispatch were removed, the
temporary webhook secret was deleted, and staging was restored to the default
unfrozen configuration. No Supabase writer was stopped or tested. The live Cron
pause log was not captured in that initial rehearsal; the follow-up on
2026-09-28 captured it below.

A separate 2026-09-28 loopback-only local smoke now covers one component of the
pre-write path: synthetic email/password sign-in, Auth UUID preservation,
owner-scoped `user_settings` read/update/readback, and Auth deletion cascading
the settings row. Its API sequence took 284 ms on the latest run. The
disposable local project uses the checked-in SQL migrations with a local-only
`is_admin() = false` shim
because the historical chain drops that function before later policies refer
to it; it mirrors the read-only-observed `user_settings` grants only inside the
local container. The smoke cleaned its container, volumes, network, and
temporary files. It does not rehearse the Cloudflare first-write boundary,
source-writer/Cron freeze, full application switch, browser session recovery, or
the timed pre-write rollback. Issue #37's complete pre-write drill therefore
remains open. See
[`prewrite-supabase-resume-smoke.mjs`](../../scripts/migration/prewrite-supabase-resume-smoke.mjs).

The 2026-09-27 read-only Supabase catalog query succeeds through
`npx supabase@2.118.0`; it reads no application rows and still produces 18
blocking schema-conversion gates. The earlier post-reauth Wrangler Keychain
failure is resolved: current `wrangler whoami` succeeds for
`fanmark.id@gmail.com` and the intended account. At the end of the 2026-09-27
rehearsal, Worker version `21f0be9e-2099-49d8-b975-a3a61604c12e` had the freeze
selector set to `false`; subsequent staging deployments are recorded below.
These updates do not close the source schema gates or constitute a completed
integration/cutover rehearsal.

The user-data import and public domain/DNS switch remain explicitly deferred.

## Frozen receipt continuity and Cron-pause follow-up (2026-09-28 JST)

The guarded
[`staging-stripe-receipt-freeze-smoke.mjs`](../../scripts/migration/staging-stripe-receipt-freeze-smoke.mjs)
canary used only `fanmark-app-staging`, the pinned business staging D1, and a
random temporary Stripe-signature secret. It deployed version
`625895a0-931c-4c12-8f18-8ee54d063223` with `CUTOVER_WRITE_FREEZE=true` and
`STRIPE_WEBHOOK_BACKEND=d1`; Stripe dispatch, API keys, checkout, and Resend
remained disabled. While frozen, an admin mutation was rejected with 503 and
sign-in OPTIONS returned 204. A locally signed synthetic `customer.updated`
receipt was accepted, then replayed as `duplicate_nonterminal`. D1 held one
receipt with delivery count 2 and one pending dispatch; the event was not
dispatched or applied to billing. No Stripe API request was made.

During the same freeze configuration, `wrangler tail` captured the scheduled
`* * * * *` invocation logging `status=paused` and
`reason=cutover_write_freeze`. The measured canary sequence took 29.13 seconds;
that duration is not a production cutover RTO because no Supabase writer was
stopped and no business write was switched.

The canary deleted its receipt, dispatch, and temporary signing secret, then
restored ordinary staging Worker version
`4c23f796-fa12-419d-85fb-9a905a5f7ceb`. Independent readback found zero Stripe
receipts/dispatches, zero profiles, and zero broadcast delivery rows. The SPA
and Auth health returned 200, unauthenticated admin returned 401, and Stripe
webhook returned 404. The only secrets remaining were the three pre-existing
Better Auth/reference/verified-access secrets.

This closes the staging-only webhook receipt continuity and scheduled-pause
check. Coordinated Supabase-writer freeze, final copy, both pre/post-write
recovery drills, full schema gates, Stripe sandbox business-effect acceptance,
and production backup policy remain open. User-data import and domain/DNS
cutover remain outside this rehearsal.

## Earlier schema/API parity checkpoint before converter v8 (2026-09-28 JST)

The private v6 conversion recognizes the single
`recent_active_fanmarks` source view only by its exact catalog shape and
definition fingerprint, then records its replacement by the tested D1 Worker
query. Unknown or changed views remain gated. At that checkpoint, this left 16
unresolved gate groups (10 row-conversion, 6 schema/operation) and did not
establish full schema readiness. A later read-only catalog refresh and
converter-v8 report are recorded in [`schema-conversion.md`](schema-conversion.md).
The public recent-list endpoint now accepts the source RPC's 1..50 limit on both Supabase and D1; the landing page still requests 20.
Converter 13/13, recent Worker API 15/15, D1 recent repository 6/6, the full
migration-data suite 163/163, and Worker typecheck passed on Node 22.6.0 at that
checkpoint. These local proofs do not satisfy the freeze, Stripe handoff,
recovery, or full-schema gates above.

## Isolated D1 post-ack Time Travel drill (2026-09-28 JST)

Cloudflare account `fanmark.id@gmail.com` created disposable APAC D1
`fanmark-recovery-drill-20260928-1` (`56bdf369-3c44-4361-a943-051b6430a0d1`),
with no Worker binding. It contained only synthetic tables and rows for one
acknowledged business effect, its applied Stripe receipt, and its completed
dispatch. The exact post-ack bookmark was
`00000000-0000000c-000050f3-816afb5b73e504d7008294d01b6f8bfa`. Three later
synthetic rows were then added to represent state after the verified recovery
point. Restoring the earlier bookmark succeeded; remote readback found exactly
one business effect, one applied receipt, and one completed dispatch, with the
original payload digest intact. The later effect/event/dispatch were absent.
Explicit relationship queries found zero orphan dispatches and zero missing
receipts; all readbacks reported `changed_db=false` and `rows_written=0`.

The remote SQL endpoint rejected `PRAGMA foreign_key_check` and
`PRAGMA integrity_check` with `SQLITE_AUTH`, so this run claims only the exact
row/hash/relationship readback above, not a full remote integrity check. The
temporary database was deleted after readback; `wrangler d1 list` then showed
only the three pre-existing staging databases. No app Worker, existing staging
database, Supabase resource, real user data, R2 object, provider, production
route, or domain/DNS was changed. A precise elapsed-time measurement was not
captured.

This proves that the account's APAC D1 Time Travel restore can preserve one
acknowledged synthetic effect and its operation-ledger rows while discarding
later state. It is not an application-level restore: it did not use the actual
business schema or Worker, reconcile all operational tables, verify a complete
backup, or exercise the pre-write recovery path. Issue #37 and the post-write
application recovery gate remain open.

## Temporary Worker and business-schema post-ack restore (2026-09-28 JST)

Created disposable APAC D1 `fanmark-recovery-app-20260928-x7p4`
(`73c4fe01-4950-438c-9b61-bd0d67a7c01c`) and applied all 17 checked-in
business migrations (`0000` through `0016`). An isolated temporary Worker
`fanmark-recovery-worker-20260928-x7p4` (version
`ff87f3c8-8d47-4223-af21-1045b4c7673e`) ran the actual `workers/api/src/index.ts`
with only that D1 business binding, a temporary Rate Limit binding, and a
synthetic-only Stripe signing secret. It had no Auth, master, R2,
production, or custom-domain binding.

The Worker accepted one synthetic `/api/waitlist` write (`202`) and one signed
`customer.updated` event through `/api/stripe/webhook` (`200`). Replaying the
same event left one receipt/dispatch pair and raised the receipt's delivery
count to 2; dispatch remained pending, with no Stripe API key or business
dispatcher enabled. A Time Travel bookmark was captured after these
acknowledged writes. Two later synthetic writes—one waitlist row and a second
signed event—were accepted. Before restore, readback found two target waitlist
rows, two receipts, and two dispatches. Restore to the post-ack bookmark kept
the first waitlist row and its single receipt/dispatch pair (`received` /
`pending`, delivery count 2) and removed both later writes. Independent
post-restore reads reported `changed_db=false` and `rows_written=0`; restore
plus reconciliation readback took 4.069 seconds. This is a narrow D1 restore
measurement, not a complete cutover RTO.

The temporary Worker and D1 were deleted. A final account list showed only the
three pre-existing staging databases, and Wrangler confirmed the temporary
Worker no longer exists. The short-lived config and synthetic marker file were
removed. No existing staging database, real user/Auth data, Supabase writer,
Stripe API, R2 object, production route, or domain/DNS setting was changed.
This proves an actual application write plus a pending Stripe receipt/dispatch
can be reconciled after restoring the app's business schema. It does not prove
the pre-write Supabase-resume path, an applied Stripe business effect, a
complete verified backup, or all application tables; issue #37 remains open.

## Guarded synthetic post-write recovery command (2026-09-28 JST)

The guarded command
`npm run test:migration:staging-postwrite-recovery` now repeats the application
post-write drill using resources with random names. Calling the underlying
script without all four explicit staging/synthetic/cleanup flags returns
before remote access. It verifies the Cloudflare account and existing staging
target, creates a disposable APAC D1, applies and
reads back all 17 checked-in business migrations, then deploys the actual API
as a temporary workers.dev Worker with only the disposable business D1 and a
unique Rate Limit namespace. It configures no Auth, master, R2, custom-domain,
Cron, or Stripe API binding; the webhook uses a random synthetic signing secret.

For D1 `fanmark-recovery-1790564852366-c4e47dddb2153c48`
(`3c0248f3-174e-40b5-be8d-7b064ff30249`) and Worker versions
`33732429-30a2-43ad-9e99-69ecb3a9399a` / frozen version
`442373d8-37d7-402f-8f0c-cdc7e0ca0291`, the real `/api/waitlist` route
acknowledged one synthetic row. `/api/stripe/webhook` accepted one locally
signed `customer.updated` event twice; readback showed one `received` receipt,
one `pending` dispatch, and delivery count 2. The bookmark
`00000000-00000032-000050f4-343f8f9406b4f7438b6f865d01508dc2` was captured
after those acknowledgements. A second synthetic waitlist row was accepted,
then the temporary Worker was redeployed with `CUTOVER_WRITE_FREEZE=true`.
The freeze rejected a further valid mutation with 503 and that marker never
appeared in D1. No Stripe event was sent after the bookmark.

Restoring the bookmark while the Worker remained frozen retained the first
waitlist row and its exact receipt/dispatch state and digest; the later
waitlist row disappeared. The acknowledged and restored state digest was
`838bfc29fe98c0dd3ff755118a206995d5ca087ded4b4f84264c6f9c4067bd85` on both
readbacks. Restore plus reconciliation took 5.027 seconds. The script checks
that every reconciliation query is read-only, the dispatch has a matching
receipt, and cleanup removes the temporary Worker, D1, and local config. The
final D1 account list contained only the three pre-existing staging databases.
The private report was written with mode 0600 outside the repository.

This is a repeatable application-schema Time Travel drill with one synthetic
business write and a pending receipt ledger. It does not exercise a live Stripe
delivery during the restore window, an applied Stripe business effect, Auth,
R2, a complete encrypted backup, or a coordinated Supabase-writer freeze. It
does not close issue #37's integrated acceptance gate.

## Repeat post-ack application restore and phase diagnostics (2026-09-28 JST)

Two preliminary reruns failed during synthetic write acknowledgement and
cleaned up their temporary resources. The guarded command then passed after
adding sanitized phase and failure labels to its private report; no request
bodies, row contents, or credentials are stored in that diagnostic metadata.
The successful disposable D1 was
`e87563cb-78b4-48d3-8948-b163e3a5bb2c`; temporary Worker versions were
`d56272f0-55cb-42cf-8834-20940dabd731` and frozen
`b40bf6a9-ef16-4e83-8caf-e3a8aedc3503`. All 17 business migrations were
readback-verified. The synthetic waitlist row and duplicate signed
`customer.updated` receipt were acknowledged before the bookmark. After one
later waitlist write, the Worker freeze rejected another mutation with 503;
restoring the bookmark removed the later row and retained the acknowledged row
plus its single pending receipt/dispatch. The acknowledged and restored
readback digests matched at
`488b3ecde4c5fa8c0941b839e454e82f1b7207ae0452096355d3dbf84ef8d76a`.
Restore and reconciliation took 4.530 seconds. The temporary Worker, D1, and
config were all removed. The private report is
`/var/folders/c4/_087tnms6n95sb58l4rg8vpw0000gn/T/fanmark-postwrite-recovery-993573263a49672e.json`.

This verifies post-ack restore for the isolated application schema and pending
receipt ledger only. It still does not apply a Stripe business effect, restore
Auth or R2, use a complete encrypted backup, or coordinate a Supabase-writer
freeze; issue #37 remains open.

## Targeted auth/lifecycle CPU readback (2026-09-28 JST)

A repeat synthetic TOTP/admin/lifecycle canary on the deployed staging Worker
captured per-request CPU through a ready Wrangler Tail stream. Successful
email/password sign-in used 128 ms, first-time TOTP enrollment 88 ms, TOTP
verification 17 ms, and the MFA-protected empty lifecycle run 32 ms. Static
shell and Auth health reads used 1–2 ms. The detailed statuses and session
readings are recorded in [HANDOFF.md](HANDOFF.md).

Cloudflare's [current Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
list 10 ms per request for Free. The sample confirms that auth and lifecycle
paths exceed that threshold; a few successful overages do not prove recurring
traffic is supported. No Worker plan or billing change was made. This keeps
the CPU-plan-fit gate open pending safe optimization or an account-owner plan
decision. The smoke cleaned its
synthetic Auth/business/lifecycle rows and found all user-owned Auth tables
empty; Cron expiry stayed disabled. It did not change the Supabase writer,
production route, real user data, or domain/DNS.

## Integrated synthetic pre-write fallback drill (2026-09-28 JST)

The guarded command `npm run test:migration:staging-prewrite-resume` now
connects the staging write-freeze check to the source-shaped resume test. It
requires the exact staging account/database and explicit flags, checks the
`workers.dev`-only Worker configuration, verifies the Stripe selectors/secrets
are absent, and confirms the local Supabase CLI and Docker are available before
deploying anything. It waits for an invalid-content-type `/api/waitlist` probe
to return `cutover_write_freeze`; before the new version is active, the same
probe returns 415 without reaching the limiter or D1. Only after that readiness
signal does it send one valid synthetic `example.invalid` signup request.

The frozen public mutation returned 503 and the exact marker was absent from
business D1. Sign-in preflight remained 204. While the Worker remained frozen,
the isolated loopback Supabase project passed synthetic email/password Auth,
UUID preservation, owner-scoped `user_settings` read/update/readback, and
cascade cleanup. The first owner-scoped `user_settings` update was acknowledged
30,472 ms after the Cloudflare rejection. This interval includes local
Docker/Supabase startup and is only a harness measurement, not a production
outage or RTO.

The same frozen Worker accepted a locally signed synthetic `customer.updated`
receipt and deduplicated its replay into one pending dispatch; no Stripe API
or business effect was invoked. Cleanup removed the marker, receipt, dispatch,
and temporary webhook secret, then restored the ordinary Worker as version
`e54b22c6-b19d-4172-be71-445e2a29b52a`. Independent readback found zero
waitlist, receipt, dispatch, profile, and Auth-owned rows; the expected staging
secret names remained, `/` and Auth health returned 200, the webhook returned
404, and unauthenticated admin returned 401. No local rehearsal container,
volume, or network remained.

This closes the isolated pre-write fallback subgate only. It did not stop a
linked Supabase writer or Cron, rehearse a real browser session, copy data,
verify a full outage window, or complete the post-write application restore.
Issue #37 remains open; no real user data, production route, or domain/DNS
setting changed.

The 2026-09-28 follow-up rerun passed with temporary Worker
`71094a8b-6cbb-4f42-afcd-47a5957dc69a` and restored Worker
`6da0dd8d-5da3-46f5-9c7e-86258a50b181` at 100%. The first loopback
owner-settings write followed the freeze rejection by 31,937 ms; total harness
time was 75,970 ms. Final receipt and dispatch counts were zero, no Stripe API
calls occurred, and a separate readback confirmed only the three pre-existing
staging secrets. This repeat still does not stop a linked writer or Cron.

## Rendered subscription UI poll (2026-09-28 JST)

The guarded `npm run test:migration:staging-subscription-ui-poll` authenticated
a temporary headless Chrome session against the isolated staging Worker. It
opened `/profile`'s Plan section and saw the synthetic owner subscription as
active. After changing only that D1 projection to `canceled`, the UI showed its
localized inactive state after the next foreground 30-second poll, measured at
29,440 ms. Cleanup read back zero synthetic subscription, profile, and Auth
rows. No Stripe API, email, user data, production resource, or domain/DNS
setting was used. This proves a single rendered transition; it is not
worst-case latency or load evidence and does not close the broader #37 gate.

## Anonymous search-record write (2026-09-28 JST)

The guarded `npm run test:migration:staging-fanmark-search-record` passed on
the isolated workers.dev app. It verified CORS preflight, rejection of an
untrusted origin and malformed emoji ID, then one valid anonymous D1 write.
Readback found one synthetic discovery and one `search` event with a null user
ID. Cleanup removed those exact rows and its final readback found zero matches.
The `fanmark_events` SQLite sequence advanced by one and was left monotonic.
This proves only the new-search staging path; historical search/user data
remains deferred, and this does not close the integrated #37 gate.

## Freshest source catalog and v8 gate count (2026-09-28 JST)

The latest linked-project read-only catalog query completed at
`2026-09-27T23:31:08.407538Z`. It again returned 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
non-internal triggers, and 77 RLS policies. The locale-bound Unicode regex
probe tested 1,112,063 scalar values with zero extra matches. Converter v8
generated the same SQL as v7 and retained 14 unresolved gate groups across
227 locations; `deployable` remains `false`. This refresh read catalogs only,
not application rows, and did not write D1 or change production/domain state.

## Converter v9 date constraint and synthetic D1 replay (2026-09-28 JST)

The same current schema-only catalog was processed with converter v9. Its
generated DDL adds a canonical-calendar `CHECK` for source `date` columns, so
the former date import-validation gate is closed for both import and later
writes. The report now has 13 unresolved groups across 226 locations and
`deployable: false`; generated DDL changed only for
`fanmark_access_daily_stats`.

Under Node 22.6.0, the local synthetic D1 replay passed with 10 synthetic rows,
two transformed active credentials, one deferred inactive credential, all 40
table checkpoints, and conflict rejection. It reports
`public_rows_reconciled`; `fullMigrationReconciled` remains false. The
catalog/report/DDL remained private outside Git. No source application rows,
remote D1/R2 writes, production route, or domain/DNS change occurred.

## Converter v10 timestamp constraints and synthetic D1 replay (2026-09-28 JST)

The v10 converter adds canonical UTC microsecond `CHECK` constraints for all
source timestamptz columns. Schema-converter tests pass 15/15, row-conversion
tests 7/7, migration-data tests 168/168, and the Miniflare D1 importer suite
18/18; the D1 integration directly confirms impossible dates and millisecond-
only timestamp text are rejected on later writes, leaving the imported
canonical value intact.

The fresh-catalog local replay still reconciles 10 synthetic rows, two
transformed credentials, one deferred credential, 40/40 checkpoints, and
conflict rejection. It reports `public_rows_reconciled`, with deployment and
full migration reconciliation false. This is constraint/import evidence only;
it does not close operation-level timestamp precision or the full #37 recovery
rehearsal. No source rows, remote D1/R2, production route, or domain/DNS state
was changed.

The core registration, return, transfer, lottery, settings, favorites, access
analytics, and notification read-state APIs now emit the same fixed-width UTC
microsecond format; their focused D1 tests pass 72/72 and frontend API
contracts pass 44/44. Other D1 write paths and the 79 untranslated timestamp
defaults remain outside this subgate, so the generated schema is still not
deployable.

## Business and Auth D1 restore rehearsal (2026-09-28 JST)

The guarded post-write rehearsal now creates separate disposable APAC business
and Auth D1 databases. It applies 17/17 business migrations and the explicit
three-file Better Auth migration allowlist, deploys the API with both isolated
bindings, signs in a synthetic account, and acknowledges one waitlist write
plus one pending Stripe receipt/dispatch. It bookmarks each D1, accepts a later
waitlist row and Auth session, freezes Worker writes, then restores both
bookmarks. The acknowledged state digest matched after restore, later writes
were absent, and the original Auth session cookie still resolved to the same
synthetic UUID. Restore and reconciliation took 13.660 seconds. Cleanup removed
the Worker, both databases, and temporary config; readback showed only the
three pre-existing staging databases.

This uncovered and repaired a remote-only migration issue: Cloudflare D1's
server statement splitter currently fails on lowercase trigger-body `begin`
with `SQLITE_ERROR 7500`, although SQLite/Wrangler local accepts it. The Auth
triggers now use uppercase `BEGIN`, and `.gitattributes` enforces LF for both
migration directories. Regression coverage checks both conditions. This is a
formatting-only SQL change; see [Workers SDK issue #15314](https://github.com/cloudflare/workers-sdk/issues/15314).

This rehearsal proves the post-write business/Auth D1 bookmark path with
synthetic state only. It does not restore R2, apply Stripe effects, validate a
complete encrypted backup, freeze Supabase writers/Cron, or import real user
data. Issue #37 remains open, and public DNS/domain changes remain deferred to
the final migration phase.

## Business/Auth D1 plus encrypted R2 recovery slice (2026-09-28 JST)

The guarded command
`npm run test:migration:staging-postwrite-recovery` now also exercises the
private migration-backup bucket. Preflight confirmed the exact APAC staging
bucket was empty, had no public `r2.dev` access or custom domain, and was not
bound to the app Worker. The temporary API Worker had no R2 binding.

After the synthetic waitlist row, one pending `customer.updated` receipt and
dispatch, and one Better Auth session were acknowledged, the rehearsal
exported only these six synthetic tables: `waitlist`,
`stripe_webhook_receipts`, `stripe_webhook_dispatches`, Auth `user`, `account`,
and `session`. It put those table-filtered SQL exports in a synthetic fixture
row, sealed that row with a fresh in-memory AES-256-GCM key using the existing
encrypted snapshot format, then uploaded the header and ciphertext to R2.
Downloaded object bytes matched, bundle authentication and snapshot verification
passed, and the decrypted SQL exactly matched all six private source exports.
No real user or source Supabase rows were read.

The run bookmarked Business and Auth D1, created later waitlist/Auth-session
writes, and redeployed the temporary Worker with `CUTOVER_WRITE_FREEZE=true`.
Five consecutive valid waitlist POSTs returned 503
`cutover_write_freeze`; none was accepted. Better Auth sign-in remained
available and created a synthetic session during the freeze. Time Travel then
restored the two bookmarks: the initial waitlist/receipt/dispatch/session
digest matched exactly, later writes disappeared, and the first session cookie
still resolved to the same UUID. Restore plus reconciliation took 11.992 s.

To exercise archive recovery as well, the command deleted those six synthetic
rows from the disposable databases and replayed the SQL restored from R2. The
replayed digest exactly matched the acknowledged and Time Travel-restored
digest `a1b36eb8d1a4e488d95314d39bb19b7289bb425a751bb5e0a3a33f884ee67ca3`;
the original session cookie remained valid. R2 upload/readback/decrypt and
SQL replay took 28.436 s. The private report records bundle digest
`79ea0580d9b4b9770716217dfc3cfa00fa4757fc7fb4b22d7699f4668dcbb23c`.

An earlier attempt observed a 202 valid mutation after a readiness request had
returned 503. The smoke now treats readiness as insufficient and requires five
consecutive actual write rejections. Wrangler's deployment-list read did not
reconcile the temporary freeze version, so these results prove repeated
behavior from the tested workers.dev origin, not global or multi-region rollout
completion.

Cleanup removed the temporary Worker, both D1s, the local private bundle, and
both R2 objects. Independent readback confirmed only the three pre-existing
staging D1s and an empty backup bucket. This is a six-table synthetic restore
slice, not a complete Business/Auth/Storage backup. It does not apply a Stripe
business effect, exercise Storage-object recovery, coordinate Supabase-writer
or Cron freeze, or import real user data. No existing staging D1, production
route, user data, or DNS/domain state was changed. Issue #37 remains open.

## Synthetic avatar recovery extension (2026-09-28 JST)

A follow-up run of
`npm run test:migration:staging-postwrite-recovery` bound only the exact
APAC `fanmark-avatars-staging` bucket to the temporary Worker and enabled its
R2 storage route. The run uploaded one 1x1 synthetic PNG through the
authenticated avatar API, verified its public bytes and HTTP metadata, and
included its metadata and bytes in the standard encrypted snapshot bundle.
The encrypted R2 objects contained neither the plaintext PNG nor its plaintext
metadata. No real Storage inventory or user object was read.

After bookmarking Business/Auth D1, the run verified that the avatar survived
Time Travel, deleted the exact synthetic key, restored it from the decrypted
encrypted bundle, and verified identical bytes, content type, and cache
control through the Worker. The acknowledged, Time-Travel-restored, and
encrypted-bundle-replayed state digests matched at
`25280f7aee69fc5b87059043f3d00451fd696a37c9e9d64775e1835e2737c7a2`.
Time Travel restore plus reconciliation took 10.673 seconds; replay from the
encrypted bundle took 31.019 seconds. Avatar upload during the write freeze
returned 503 `cutover_write_freeze`.

Freeze propagation was not instantaneous in this probe: one early synthetic
waitlist POST returned 202 after the freeze deployment, followed by five
consecutive valid POSTs rejected with 503. Time Travel removed the accepted
post-bookmark row, and the final acknowledged state reconciled exactly. This
confirms stable rejection at the tested workers.dev origin after repeated
readback; it does not prove global or multi-region freeze completion at the
instant deployment returns. The script therefore retains its five-consecutive
rejection gate.

Cleanup readback confirmed deletion of the temporary Worker, both disposable
D1s, temporary config, both encrypted backup objects, the synthetic avatar,
and the private local bundle. The two staging R2 buckets were left empty, and
only the three pre-existing staging D1s remained. This adds synthetic Storage
object recovery to the earlier six-table slice; it still does not constitute a
complete Business/Auth/Storage backup or recovery drill. It does not apply a
Stripe business effect, freeze Supabase writers or Cron, import real user
data, or change production routing or DNS/domain state. Issue #37 remains
open.

## Lifecycle Cron retry and unverified cleanup (2026-09-28 JST)

The guarded command
`FANMARK_STAGING_CRON_CANARY=1 FANMARK_SMOKE_DIAGNOSTICS=1`
`staging-license-expiry-lottery-smoke.mjs` passed its initial Cloudflare
identity check and completed the first 47 remote Business D1 reads. Read 48
started, then the process exited with `staging_cron_disable_failed` while
handling the temporary Cron deployment. Its finalizer attempted to restore the
baseline staging Worker and clean the synthetic fixture, but no successful
deployment confirmation or D1 cleanup readback was captured. The post-run
Worker Cron configuration and synthetic-row state are unknown; this attempt
does not count as a passed canary.

An independent `wrangler whoami --json` check now resolves to a Cloudflare
account that does not match the staging configuration. The authenticated
Dashboard route is under the configured account ID, but D1 Studio returns
404/unauthorized. Wrangler's read-only D1/deployment requests also fail with
authentication error 10000. This prevents a read-only post-run verification.
Public GET probes of the workers.dev origin
returned 200 for `/` and `/api/auth/ok`, 401 for anonymous `/api/admin/session`,
200/null for `/api/auth/get-session`, and 404 for the disabled Stripe webhook.
These probes establish basic route health only; they do not reveal the current
Cron triggers, active deployment version, or D1 cleanup state.

The smoke harness now retains sanitized summaries for the original canary
error, baseline redeployment failure, and synthetic-cleanup failure, while
redacting email addresses and credential-like values. Node 22.6.0 syntax
checking and the focused staging-expiry guard suite pass. Before any further
staging mutation, verify the intended Cloudflare account, active Worker
version/triggers, and zero canary rows. No real user data, production route,
or domain/DNS setting was read or changed.

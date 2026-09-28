# Cloudflare migration handoff

Checkpoint: 2026-09-28. The migration is **not complete**. PR #41 is open and
draft. Isolated Cloudflare staging D1 and Workers deployments are present; no
production Worker deployment, user-data import, or public DNS/domain cutover
has been performed.

## Resume boundary

Use branch `codex/cloudflare-api-preparation` in the migration worktree. The
original checkout contains unrelated UI work. Use Node 22.6.0 explicitly;
the shell's default Node version differs. Workers/API/Auth/concurrency Vitest
projects pin Vite 6.4.3 for this Node version and have passed clean `npm ci`.

On 2026-09-23, the user explicitly removed the old remaining-usage stop rule and
asked us to continue without reserving a percentage. Do not stop at 20% or 22%;
report only an actual service limit or tool rejection.

The current migration order is:
1. Build the basic Workers app/infrastructure in local or staging environments,
   using synthetic identities and data. Keep Supabase production as the sole
   business-data writer until the final operation.
2. Move only explicitly classified non-user master data, especially the
   versioned emoji catalog. Do not copy `system_settings` wholesale.
3. Complete integrated app/master-data rehearsal with synthetic users.
4. Import and reconcile real Auth, business, and user-owned Storage data only in
   the final operational phase tracked by #38. Existing Supabase sessions will
   require users to sign in again.
5. Switch public DNS/hostnames only after data and application reconciliation.
   Registrar transfer is a separate decision and is not required for DNS cutover.

An earlier 2026-09-23 status saying latest Supabase schema retrieval was waiting
for terminal input referred to the choice to enter the DB password in the
masked terminal or defer. It is historical: a linked-project read-only
schema-only refresh completed on 2026-09-27, reading no application rows. The
current schema-conversion checkpoint is recorded below; no terminal input is
currently pending for that fetch.

The 2026-09-28 local PWA update-transition check confirmed that the current
`autoUpdate` behavior installs a new worker and reloads the page; a synthetic
unsaved DOM input was lost while `localStorage` remained. A later guarded
staging browser canary also verified updates between deployed Worker versions
and removal of its temporary precache asset. An isolated Chrome profile then
installed the staging PWA and launched it in a standalone app window. These
checks close the staging workers.dev PWA update and native-launch subgates;
authenticated flows, custom-domain behavior, and the remaining integrated
recovery acceptance stay open. See [`static-assets.md`](static-assets.md).

The 2026-09-28 application-level post-ack restore probe used a temporary
Worker and a fresh APAC D1 with all 17 business migrations. The actual waitlist
API wrote one synthetic business row, and Stripe webhook ingress created one
receipt/dispatch pair; after a bookmark, later synthetic writes were removed by
Time Travel while the acknowledged row and pending ledger pair remained.
Restore plus exact reconciliation took 4.069 seconds. The Worker/database were
deleted and account readback returned to the three pre-existing staging D1s.
This closes only the narrow app-schema post-ack restore probe, not the complete
pre/post-write drills or issue #37; see
[`cutover-rehearsal.md`](cutover-rehearsal.md).

The same date, a loopback-only local Supabase smoke passed email/password Auth,
UUID preservation, owner-scoped settings read/update/readback, and cascade
cleanup in 284 ms of API calls on the latest run. It uses a disposable local
project, the checked-in SQL migrations, and a local-only non-admin shim plus
grants mirrored from read-only-observed metadata. No linked Supabase project or
Cloudflare resource was used. This verifies an old-path component only; it does
not close the full pre-write cutover/recovery drill. Details are in
[`cutover-rehearsal.md`](cutover-rehearsal.md).

## Browser shell check and current PR validation (2026-09-27 JST)

The in-app browser loaded the deployed staging SPA root and its Japanese home
screen, including the search controls and navigation. A separate `/auth` route
rendered the login form. After deploying the admin return-link fix, `/admin`
rendered the Cloudflare Auth/MFA login and its “トップに戻る” link resolved to
the same `fanmark-app-staging.fanmark-id.workers.dev` origin. The first
post-deploy browser read still displayed the prior link; a fresh navigation
after the update displayed the corrected link. That initial shell check did not
enter credentials or perform an authenticated admin operation or email send.
Later targeted authenticated staging checks are recorded in the acceptance
table below; broader feature and release acceptance remains open.

Commit `6219e37` fixes the return URL for `workers.dev` and `pages.dev` preview
hosts while preserving localhost and production admin-subdomain behavior.
The focused Node 22.6 test passed 3/3; application typecheck, targeted ESLint,
staging build, and Wrangler deploy dry-run passed. GitHub Actions run
`36289627111` passed both required jobs: Worker API tests/typecheck/deploy
dry-run and staging-app migration-data tests, the new return-URL test,
typecheck, and build. The fix is deployed to staging Worker version
`74933bd7-be29-43d0-9c34-d85f865cfc1e`; no production route, user data, R2
object, or domain/DNS setting changed. Supabase Preview was skipped by design
under CI isolation.

Fresh anonymous HTTP verification on 2026-09-27 confirmed that browser-style
navigation requests (`Accept: text/html,...`) return the noindex SPA shell with
HTTP 200 for `/`, `/auth`, `/pwa`, `/plans`, and `/plan`. `/api/auth/ok` returned
200 with `{ "ok": true }`, and the public `/api/emoji/catalog` page returned
200 for active release `10ec42c1…`. A generic fetch request with only
`Accept: */*` returns 404 for nested SPA routes; this is the expected static
asset fallback boundary, not a browser-navigation failure. This readback did
not execute client JavaScript or authenticate, and it made no writes or
user-row reads.

Staging enables the public D1 extension-price reader and Better Auth/MFA-gated D1 reference-master editor together. A complete synthetic TOTP admin Tier C edit/restore canary passed, and a separate one-month extension-price edit/restore canary passed through the deployed API. Tier C is null again; the tier-1 one-month price read back at ¥500, its pre-canary value. Anonymous writes returned 401, stale-version writes returned 409 without changing the active release, and canonical values for all four reference masters matched after each restore, including both Stripe IDs. Only the expected active-release metadata and edited-row updated_at changed. The active pointer is generation 8; the append-only history retains the canary edit/restore activations. An initial Tier canary exposed a test-harness cleanup omission; its exact synthetic rows were removed, the guard was fixed, and the repeat run completed with Auth and business canary rows at zero. The Stripe extension-checkout route remains deliberately disabled and returns 404 because server/webhook/dispatch selectors and Stripe secrets are absent; no payment was attempted. Production/default builds remain on Supabase.

The user says the user base is small and planned maintenance plus individual
support are acceptable. That can avoid overengineering for zero downtime; it is
not acceptance of account/entitlement mislinks, secret exposure, or data that
cannot be recovered. The old/new systems must not dual-write business rows.

## 2026-09-27 local validation, staging deploy, and schema refresh

Re-ran `npm run test:migration-data` under Node 22.6.0 (149/149) and the full
`workers/api` `npm test` chain (exit 0). The prior root and Worker TypeScript
checks, `npm run build:cloudflare-staging`, Worker Wrangler deploy dry-run, and
`npm run check:ci` remain the latest recorded passes. These are local/synthetic
proofs; this refresh did not change remote state.

The coordinated cutover and recovery sequence is now captured in
[`cutover-rehearsal.md`](cutover-rehearsal.md), including the single-writer
rule, the Stripe receipt/dispatch handoff, and separate recovery behavior before
and after Cloudflare accepts a write. This is an operator procedure, not a
completed rehearsal: the old-writer freeze, timed final-copy drill, and both
recovery drills remain unverified. Issue #37 stays open.

The linked project is `ppqgtbjykitqtiaisyji` (`fanmark.id`). The installed
Supabase CLI 2.67.1 can list the linked project but lacks `db query`; the
ephemeral `npx supabase@2.118.0` CLI successfully ran the reviewed
`schema-readiness.sql` in its read-only transaction. The 2026-09-27T00:27:21Z
catalog has 40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum
labels, one view, 58 functions, 36 triggers, and 77 RLS policies. No
application rows were read. The private catalog and generated artifacts have
mode 0600. Schema conversion v4 still reports 18 unresolved gates and
`deployable: false`; a fresh synthetic current-catalog importer rehearsal
passed all 40 checkpoints with `public_rows_reconciled`, while
`fullMigrationReconciled` remains false. Details are in
`schema-conversion.md` and `d1-import.md`.

The source catalog and synthetic rehearsal were refreshed again at
`2026-09-27T12:13:53Z`; the CLI required no terminal input. The descriptor-aware
report still has 10 row-conversion groups and 8 schema/operation groups, and
the current-catalog synthetic run reconciled four generated rows across 40
checkpoints while rejecting a conflicting replay. No source rows or remote D1
rows were read or written.

The full-catalog fixture now also combines enabled and disabled active-license
credentials with an inactive-license credential. Its 10 synthetic source rows
reconciled through 40/40 table checkpoints: two credential hashes were
transformed and the inactive credential was recorded as deferred; typed
readback verified 3 source / 2 target / 1 deferred credential rows. Whole-
target reconciliation, acknowledgement-loss resume, and conflicting-coverage
rejection passed. This remains a disposable local D1 rehearsal using
schema-only source metadata; no Supabase application rows or remote D1 rows
were read or written.

The migration-data test suite passed 160/160 under Node 22.6.0. The fake
`psql` protocol test uses a 15-second finite subprocess limit so parallel test
load does not cause a false timeout; it passes alone and within the suite.
GitHub Actions run `36323205817`, attempt 2, passed both required jobs,
including the Worker API suite, migration boundaries, all 90 Stripe receipt
tests, both typechecks, staging build, and non-deploying Wrangler validation.
The first attempt timed out in the Stripe PGlite snapshot test after 180
seconds; the same file passed alone locally, the full Stripe suite passed
locally, and an unchanged-code CI retry passed. No deployment occurred.

A read-only comparison of this catalog's generated target profile with remote
`fanmark-business-staging` found all 40 source tables and 406 source columns,
with all converted SQLite types and nullability matching. The staging schema
has three extra reviewed lifecycle/coupon columns and 32 extra operational
indexes; all 66 indexes emitted from the source profile are present. The
introspection queries wrote zero rows and reported `changed_db: false`; no
business row values were read. This narrows the open D1 parity work to the
remaining 18 gates and behavior verification rather than missing base columns.

A fresh Wrangler `--no-data` export and local comparison at 2026-09-27 12:22
UTC reconfirmed the target profile: 73 staging tables, 98 indexes, and 34
triggers; all 40 source tables and 406 columns have matching converted types
and nullability. All 66 generated source indexes are present, along with the
three reviewed extra columns and 32 operational indexes. Wrangler reports no
business migrations pending. No application rows were exported or written.

The local D1 importer now preserves signed int64 values as canonical decimal
text, binds them with `CAST(? AS INTEGER)`, and independently verifies exact
text readback plus SQLite integer storage. The Miniflare fixture imports both
signed boundaries and values beyond JavaScript's safe-integer range while
reconciling the snapshot's bytewise primary-key order; the focused row-converter
tests pass 6/6 and the Cloudflare D1 codec package passes 9/9. The schema gate
remains open for application-facing D1 reads that may expose INTEGER as an
imprecise JavaScript Number. This is synthetic importer proof, not a live-data
import or production cutover.

After that change, the refreshed private current-catalog rehearsal also passed
40/40 table checkpoints with four synthetic rows, including
`fanmark_events.id = 9007199254740993`; exact target text and AUTOINCREMENT
sequence readbacks matched. An injected ACK-unknown resume and tampered-coverage
rejection also passed. The result remains `public_rows_reconciled`, with
`deployable` and `fullMigrationReconciled` false.

A read-only Workers plan-page check showed the account on the Free plan ($0)
with a 10 ms maximum CPU time per request. No plan change was made; production
CPU headroom and paid-plan need remain unverified.

Commit `4a6dd0a` keeps the admin-role check first and combines the user's
2FA-enabled state, up-to-two verified-factor cardinality, and exact
session/factor MFA assurance into one D1 read. Its synthetic staging TOTP and
admin user list/detail canary passed on Worker version
`1ae4ffb0-5af5-4b19-8759-f79cc201b45a`; Auth/profile/audit canary rows were
removed and user-owned Auth tables read back empty. Wrangler tail sampled the
authorized `GET /api/admin/session` at 4 ms CPU / 83 ms wall time (200), the
pre-enrollment gate at 50 ms CPU / 161 ms wall time (403), and an anonymous
request at 2 ms CPU / 2 ms wall time (401). Separate requests on this version
sampled TOTP enable at 93 ms CPU and verification at 13 ms. These are narrow
staging samples, not recurring-load or production evidence; the 10 ms CPU-plan
gate remains open.

A fresh read-only Supabase scheduler query found the daily
`check-expired-licenses` Edge Function job active at `0 0 * * *` in `GMT`; the
old every-minute notification job is inactive. Its command body was not
recorded, and no schedules were changed. The source job must be re-read and
stopped with in-flight work reconciled during the final writer freeze, before
enabling Cloudflare's daily lifecycle trigger. See
[`live-observations.md`](live-observations.md) and
[`cutover-rehearsal.md`](cutover-rehearsal.md).

Current coarse weighted estimate (2026-09-28): about 53% of the full migration,
or about 73% of the prioritized app/infrastructure/non-user master-data scope
with synthetic staging acceptance. The latter excludes real user-data import
and public domain/DNS cutover; this is a scope estimate, not an issue-count or
go-live-readiness score. Synthetic registration, notification, analytics,
return/transfer, owner settings/password, R2 profile/storage, authenticated
administration, and staging PWA update/install checks have passed bounded
canaries. The lifecycle settings API and rendered `AdminSettings` form now
also pass an MFA-protected change/readback/restore canary; cleanup returned
synthetic Auth/profile records to zero. The static audit covers 43 typed
staging backend selectors, but runtime acceptance is still required. The
manual expiry Worker route is active only for explicit admin runs; scheduled
expiry remains disabled because `LICENSE_EXPIRY_BACKEND` is unset.

The fresh schema-converter-v11 report has 13 unresolved gate groups across 226
locations and remains `deployable: false`; this catalog-only run omitted the
private credential descriptor, so `credential_descriptor_required` remains a
gate. Generated D1 checks enforce canonical calendar dates and fixed-width UTC
timestamp text. Version 11 emits a canonical-shaped fallback for all 79 source
timestamptz `now()` defaults, while clock precision and transaction-time
semantics remain gated for operation-level proof. All 40 generated tables
loaded in SQLite with `integrity_check=ok` and no foreign-key violations.
After the core API writes, account deletion, profile/password setup,
administrator user actions, lifecycle/maintenance/system settings, waitlist
admin/signup, invitation admin/signup, and extension-coupon admin/application
writes, admin email-template updates, broadcast administration/delivery
leases/retries, and Resend webhook event persistence also use the fixed-width
formatter; the combined focused D1 suites pass 179/179 (with 107 tests covering
these added paths). The full writer/default inventory remains incomplete, so
Stripe webhook receipt/dispatch, invoice projection, and subscription
reconciliation writes now use the same format; their synthetic D1 integration
suite passes 59/59. These bounded suites do not close the complete timestamp
writer/default inventory. Emoji master create/update/import, reference-master
release creation/verification/activation, and scheduled notification
event/lease/retry timestamps also use the fixed-width formatter; the Auth D1
suite passes 21/21, reference-master API 6/6, and notification D1 12/12. The
local release suites now read back six-digit `created_at`, `verified_at`,
`updated_at`, and activation-audit timestamps (emoji release 7/7, reference
release 5/5). Migration `0007_release_audit_timestamps.sql` binds derived audit
times to the active pointer's canonical `updated_at`; staging migration
selectors include that exact filename while excluding the Auth-only 0007
migration. Wrangler applied it to staging Master D1; the follow-up list shows
no migrations pending. A readback confirmed all four emoji/reference audit
triggers use `NEW.updated_at`; the SELECT reported `changed_db=false` and zero
rows written. D1-writing synthetic staging smoke scripts were also aligned to
six-digit UTC. Worker typecheck and lifecycle/schema tests pass (16/16).
The full `workers/api` test chain, staging Vite build, and Worker Wrangler
dry-run also pass; the dry-run read the built assets and exited without deploy.
GitHub Actions run `36368026109` for `f241a89` passed both required jobs. The
13-gate report and coarse progress estimate remain unchanged. Issue #37's full writer-freeze, timed
final-copy, and pre/post-write recovery rehearsal remains open, as do
provider-backed Resend/Stripe acceptance, broad authenticated UI coverage, and
Workers CPU/plan fit. Issue #38's real user-data import and public domain/DNS
cutover are intentionally deferred final phases. No production Worker, real
user-data import, or public domain/DNS cutover has occurred. See
[`EXECUTION.md`](EXECUTION.md).

## Unused extension coupon master seed (2026-09-27 JST)

A fresh read-only Supabase projection confirmed four active coupon definitions
with `used_count = 0` and no usage rows. Only their definition fields were
staged into `fanmark-business-staging`; all four read back exactly with the
pinned source content digest
`6472e758c2896f8f83bf5a48da5a3c038b24651e5278866b177231412dda3d79`,
`created_by` was set to NULL, and staging usage count remains zero. The source
aggregate also reports four consumed definitions, 20 usage rows, and two
definition/use-count mismatches; those records remain excluded for the final
user-data reconciliation. The private export and SQL were mode 0600 and are not
in the repository. No production setting, license, user, domain, or DNS state
was changed. Existing staging baseline checks now accept the coupon rows only
after this exact content and zero-usage verification. See
[`extension-coupon-api.md`](extension-coupon-api.md).

The Worker-backed own-profile hook now synchronizes successful profile changes
across same-tab consumers and quietly revalidates on focus/visibility, replacing
the former Supabase Realtime path without periodic D1 reads. This app-consistency
repair does not materially change the coarse weighted progress estimate.

The staging baseline checks now verify both localized email-template groups
using a single read query and their pinned content digests. Live D1 readback
confirmed 16 auth templates plus 12 broadcast templates; the full migration
data suite passes 154/154. Notification processing, analytics concurrency,
owner registration/lottery, owner-settings/password, single and bulk license
return, transfer lifecycle, and avatar/cover R2 profile canaries passed. Their
synthetic Auth rows and transient Business rows were removed; the bulk-return
canary intentionally retains two synthetic license-incarnation tombstones,
with access-version and MFA-generation state verified. These checks add
staging evidence only; mail delivery, the integrated rehearsal, and production
acceptance remain open.

The latest Supabase read-only query selected only the three supported
broadcast template types and returned 12 active rows across `en`, `id`, `ja`,
`ko`; the normalized full-row digest is
`770459e45e66f1c81ba58ea507b518f00c67004d289f5919d8c16c0f2c279f14`. A
guarded staging-only seed wrote those rows to `fanmark-business-staging` and
verified exact full-row readback. The 16 authentication templates were
unchanged; a second run was a no-op. No drafts, user rows, recipient addresses,
email sends, production routing, or domain settings were touched. The private
source payload is not checked into Git. The broadcast UI MFA canary and the
separate send-queue/provider design remain open; see
`broadcast-email-admin-api.md` and `live-observations.md`.

The staging search hook now writes new search aggregates through
`POST /api/fanmarks/search/record`; regular builds still use Supabase. The
staging Worker has a dedicated 120-request/60-second hashed-IP rate-limit
binding. The live synthetic API canary passed on version
`34779025-2fdd-47f2-8ac4-37e2dde02b8b`: it returned 200; D1 readback confirmed `search_count=1` and
`fanmark_events.user_id IS NULL`, then the exact synthetic event and discovery
rows were deleted and a final readback found zero. The local API tests,
typechecks, staging build, Wrangler dry-run, and 147 migration-data tests pass.
The final staging app version `47dd045f-ae0c-4b46-8138-bdd59037f7ab` omits
session credentials from the anonymous write and was verified to serve the
matching bundle and Worker health endpoint.
Historical Supabase search events and user attribution remain for the final
user-data phase. No production selector, user row, or domain/DNS was changed.
This narrow route does not materially change the coarse progress estimate.

The earlier Wrangler Keychain failure was resolved. Wrangler now authenticates
to the intended account; staging deployment
`cdeb759e-8e52-4b8a-9d63-6451b871c262` is active at 100%, and the isolated PWA
and master-route checks are recorded below. PR #41 includes the PWA fix and
refreshed evidence. Preserve the unrelated modified
`supabase/.temp/cli-latest` file.

The production-only `manual-expire-grace-licenses` function was downloaded and
reviewed read-only: it remains active in Supabase and has no local callsite.
The D1 lifecycle Cron covers scheduled finalization, but there is no on-demand
bulk Worker route. The function was not invoked or changed. External
callers/schedules and any remaining manual bulk need are unverified; see
`live-observations.md`.

## Prior staging checkpoint (2026-09-27 JST, before PWA icon deployment)

Weighted progress estimate at this checkpoint: about 70% of the prioritized
basic-app/infrastructure/master-data stage and about 55–60% of the full
migration. The live registration/auth/business/R2 rehearsal below now covers a
major integrated path, but broader #37 acceptance, the 18 schema gates,
production acceptance, user-data import, and final DNS cutover remain open.
The plan/general-settings and read-only subscription-display slices are now
staged and deployed. The profile username-availability lookup is also selected
through D1 on staging; this narrow addition does not materially change the
coarse weighted estimate. Self-service account deletion is now also selected
through Better Auth/D1 on the staging build; its focused live synthetic canary
passed, without materially changing the coarse estimate. Public waitlist
submission is now also selected through D1 on staging; its isolated synthetic
canary passed and does not materially change the coarse estimate.

At this checkpoint, `fanmark-app-staging` was deployed at 100% as version
`243e68a0-df6a-4e7c-b290-1ec20bdd2005` at
`https://fanmark-app-staging.fanmark-id.workers.dev`. The split business/Auth/
master D1 bindings and the two image R2 buckets remain isolated to this
workers.dev app. A third, dedicated APAC Standard migration-backup bucket is
private, empty after its synthetic round-trip, and not bound to the app Worker.

The 2026-09-27 expiry/lottery staging Cron canary completed one synthetic
active-to-grace expiry, grace finalization, lottery winner issuance, and both
in-app notifications. The temporary every-minute lifecycle trigger and
`LICENSE_EXPIRY_BACKEND` selector were removed by the harness; deployment
`243e68a0-df6a-4e7c-b290-1ec20bdd2005` is the restored staging build. Readback
confirmed zero synthetic business rows, notifications, events, lifecycle
journals, and Auth rows; the 45 pre-existing license-incarnation tombstones
were unchanged. No email, Stripe call, production route, real data, or DNS was
used. The harness now checks the pinned auth-template content digest while
allowing the expected `updated_at` advance from its edit/restore canary, and
deletes the exact synthetic notifications before their source events.

Read-only browser QA before the current deployment rendered the public home,
`/auth`, and PWA search screen at `/pwa`; a direct `/plans` visit showed the
generic missing-profile page. That browser's auth state was not independently
isolated, so it did not prove the anonymous result. The local source wraps
`/plans` and `/plan` with `ProtectedRoute`; a separate local staging-mode
preview with synthetic `maintenance_mode=false` and Better Auth session `null`
redirected both to `/auth`. Deployment `cdeb759e-8e52-4b8a-9d63-6451b871c262`
now contains the current source bundle. Live browser-style requests return the
noindex SPA shell for `/plans`, `/plan`, `/auth`, and `/pwa`. A fresh anonymous
headless Chromium profile executed the deployed client: both `/plans` and
`/plan` redirected to `/auth`, where the login form rendered.

The earlier Wrangler Keychain failure was resolved. Current `wrangler whoami`
reports `fanmark.id@gmail.com` and the intended account ID. The lockfile-pinned
Wrangler dry-run read only the staging Worker configuration and `dist-staging`
assets. Deployment `cdeb759e-8e52-4b8a-9d63-6451b871c262` is now active at
100% on `fanmark-app-staging`; it uploaded the new PWA icons and built app
assets. D1 and R2 bindings still point to the staging resources, and no D1
migration, user-data import, or R2 object import was run by this deployment.

Later on 2026-09-27 JST, a fresh Wrangler device-auth flow was approved for
`fanmark.id@gmail.com` after the default Chrome profile proved to be the
separate `fragrance.radio@gmail.com` account; that wrong-account consent was
cancelled. The approved grant was limited to required User Read/Background
Access plus Workers Write, Workers Scripts Write, and D1 Write. Wrangler 4.139.0
then failed reading the macOS Keychain key (exit 51); 4.141.0 `whoami` failed
the same way. `default.enc` was updated and no plaintext `default.toml` exists,
but a secret-value read of the `wrangler/default` Keychain item also exits 51.
No staging deployment, D1 write, production change, or domain/DNS action
followed this auth attempt. Keep the keyring-backed credential path; do not
switch this login to plaintext. Wrangler access is currently blocked on
resolving the local Keychain read failure.

A fresh anonymous headless Chromium profile also verified that the deployed
service worker is active and controls `/pwa`; its Workbox precache contains
both install icons. With network emulation disabled, reloading `/pwa` served
the app shell and showed the expected catalog-network retry screen. API routes
remain uncached, so this does not establish offline catalog/search support.
Native install/standalone launch, service-worker update transitions, and
authenticated flows remain unverified.

Read-only master-D1 verification on 2026-09-27 used the staging config and the
remote `fanmark-emoji-master-staging` database. Wrangler reported no pending
migrations. The active emoji catalog API returned 200 with 3,944 records and
release `10ec42c1…`; the reference-master APIs all returned 200 on release
`ba598c61…` (4 tiers, 4 languages, 5 reserved patterns, 16 extension-price
rows). Direct pointer and row-count queries reported `changed_db: false` and
zero rows written. This verifies the Cloudflare staging master projections
and Worker routes. A fresh, explicit-eight-column, read-only Supabase export
then matched all 3,944 rows in the active Cloudflare release after canonical
normalization. `recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`,
`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`,
and version `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`
matched. The active pointer remains generation 3/action `rollback`; readback
reported `changed_db=false` and zero rows written. This closes current emoji
master source-row parity for the staging release. No source rows were imported
or written during comparison; Auth/business user data remains empty.

On 2026-09-27, the staging build added `POST /api/me/account/delete`, selected
only by `VITE_ACCOUNT_DELETION_BACKEND=worker` and
`ACCOUNT_DELETION_BACKEND=d1`. It requires an authenticated same-origin Better
Auth session, exact `DELETE` confirmation, and current password; checks
source-FK and license/transfer blockers before Stripe; uses exact customer links; returns eligible active
licenses including indefinite Tier C; then cleans user-owned business rows
before deleting the Auth user. Stripe cancellation fails closed when a linked
customer cannot be mapped to exactly one mode and every nonterminal
subscription cannot be confirmed canceled. Direct `/api/auth/delete-user` and
callback paths remain closed. Worker account-deletion D1 tests pass 4/4,
Stripe tests 4/4, the complete Worker suite passes, the frontend client tests
are included in migration-data (130/130), staging build and Wrangler dry-run
pass. Staging version `e64d6cd4-1cb0-4592-a4a2-276a648adf06` passed a live
synthetic Better Auth sign-in and deletion (200/200); remote readback showed
zero synthetic Auth user/account/session rows and zero user-owned business
rows. The deletion audit was observed, then the exact synthetic audit row was
removed after verification. No message or Stripe request ran; there were no
linked billing rows or Stripe selectors/secrets. Production/default selectors
remain on Supabase; no real user data, production route, or domain/DNS changed.

On 2026-09-27, a staging frontend-selector audit found the build omitted
`VITE_LANGUAGE_READ_BACKEND`, `VITE_PUBLIC_ACCESS_READ_BACKEND`, and
`VITE_REFERENCE_MASTER_READ_BACKEND`, leaving those SPA reads on their default
Supabase paths despite the deployed Worker APIs. The staging build now selects
all three through Worker/D1; a migration-data regression test now requires an
explicit value for every typed frontend backend selector. The app was deployed
as version `49bbff45-dd2c-43d7-bf89-7ebc3babc266`. The live JavaScript asset hash matched
the locally built asset and contained all three `worker` values; the language,
tier, and reserved-pattern routes returned 4, 4, and 5 rows with `no-store`.
The root remained 200/noindex and an absent synthetic public lookup returned
404. This changed only static assets; no D1 rows, R2 objects, production route,
user data, or DNS was changed. Node 22.6 staging build, 19 public/reference
client contract tests, and the full migration-data suite (126/126) pass.
Recent, availability, public-access, auth, profile, owned-fanmark,
fanmark-profile, fanmark-settings, fanmark-search details, authenticated
fanmark-whois details, fanmark-return,
favorites, notifications, verified-access, maintenance and lifecycle settings,
emoji/reference master, and R2 routes use their explicit Worker/D1/R2
selectors on staging. The authenticated subscription display is selected
through `VITE_SUBSCRIPTION_BACKEND=worker` and reads only the signed-in user's
D1 subscription projection; Stripe IDs are omitted and the route is read-only.
The user-owned subscription table remains empty in staging; Stripe selectors
and secrets remain unset. `GET /api/me/username-availability` derives its
owner from Better Auth and reads only the candidate-name availability boolean
from business D1. A synthetic live profile/R2 smoke verified own-name and
available-candidate checks, anonymous rejection, owner-ID injection rejection,
and cleanup to zero Auth/profile rows and absent R2 objects. The general
plan/config API is also selected through
`VITE_SYSTEM_SETTINGS_BACKEND=worker`; its exact 18-row source projection is
staged and digest-verified in business D1. A synthetic administrator completed
MFA-gated settings read/update, stale-write rejection, restoration, and audit
cleanup. The Auth user-owned rows returned to zero; the monotonic
`mfaGeneration` singleton reads 60 and remains retained. Live
owner-settings/protected-access and single-return smokes
passed after deployment.

Live synthetic Better Auth accounts exercised profile GET/PATCH, owned list,
fanmark-profile GET/PATCH, favorite add/list/remove, notification list/unread/read,
and R2 avatar upload/public-read/owner-delete. An unauthenticated profile request returned 401. All
synthetic Auth/business rows, including the generated favorite discovery, were
deleted and exact-ID/composite readback returned zero. The owner API client/Worker suites pass 31/31; storage Worker/client suites
pass 12/12 and Worker typecheck passes. This proves those API paths against staging
D1, not the complete application, full notification-source/channel parity, or
business operation/security parity. No real user data, production routing, Stripe
transaction, or domain/DNS setting was changed. Schema conversion remains
`deployable: false` with 18 unresolved gates; real user-data and domain work
stay in the final phases. The remote business migration ledger is `0000`
through `0015`; staging business D1 also has the six Stripe ingress/extension
tables, all empty, while Stripe selectors and secrets remain disabled. A
workers.dev Cron is enabled every minute for the D1 notification processor;
the lifecycle and Stripe handlers remain disabled by their unset selectors.
The business baseline has 10 global notification rules, 40 localized in-app
templates, and 16 localized auth email templates (`signup`, `recovery`,
`magiclink`, and `email_change`), four disabled availability rules, and 20
explicitly allowlisted system settings. The 18 plan/pricing/feature settings
match the private Supabase projection digest in D1; the baseline public
settings remain `grace_period_days=1` and `max_emoji_characters=5`. User-owned
business tables and Auth tables read back empty after the latest synthetic
canaries. The latest redeploy selects the D1 analytics writer/read APIs and
their SPA adapters. Its workers.dev canary recorded exactly one synthetic
access despite four duplicates, verified the owner analytics DTOs, and removed
the synthetic Auth/business rows; all 40 ordinary business tables read back at
zero. Protected-access extensions retain their documented synthetic audit,
reservation, rate-limit, policy, and incarnation-tombstone state. Master D1 serves the original
emoji release at activation generation 3 after a staging-only promotion/rollback
rehearsal; reference-master release generation 8 remains active.

On 2026-09-27, the integrated registration smoke passed against the current
workers.dev staging app after the preflight learned to recognize only the exact
16-row auth email-template baseline by content digest. Registration, Better
Auth session use, R2 cover upload/public read, profile save, lottery apply and
cancel, anonymous/owner details, and rejection paths passed. Cleanup read back
zero ordinary business rows, zero synthetic Auth rows, and an absent R2 object;
the template baseline matched before and after. This does not complete all of
#37 or verify email delivery, Stripe, production, or imported-user behavior.

Admin password reset is now wired in the same staging deployment through
`POST /api/admin/users/:userId/password-reset`, same-session admin MFA, and
Better Auth's reset-token sender. The endpoint keeps reset credentials inside
Better Auth and returns no email or link. `wrangler secret list` shows no
Resend API/from secrets, so the route returns 503 before target lookup or
audit when delivery is unavailable. The anonymous route probe returned 401;
no reset email was attempted. Local Worker route/provider tests and the full
Worker suite pass; authenticated staging mail acceptance remains gated on a
secure Resend setup and synthetic mailbox.

The 2026-09-26 redeploy had no pending business, Auth, or master D1 migrations.
Read-only post-deploy checks returned SPA `/` 200, `/api/auth/ok` 200,
emoji catalog 200, all four reference masters 200/no-store with 4/4/5/16
rows, and unauthenticated `/api/admin/session` 401. A single public
`grace_period_days=1` configuration row was separately copied from the exact
Supabase public setting before deploy; no user data was written. It remains
staging-only. Later deployed synthetic Cron canaries confirmed delivery for all
10 migrated in-app rules plus the exercised return and transfer event paths;
all generated canary rows were removed. Remaining unexercised notification
event sources/channels, Stripe, signup and OAuth, email delivery, recurring
production fit, production routing, user-data import, and custom-domain/DNS
migration are still open.

On 2026-09-26, a deployed workers.dev Cron canary completed the scheduled
grace-expiry lottery against synthetic D1 rows. It verified the expired
license, one active winner license, saved lottery inputs/plan, audit, and both
notification events. The canary immediately redeployed the staging config
with `triggers.crons: []` and no `LICENSE_EXPIRY_BACKEND`; remote readback
confirmed `grace_period_days=1`, all non-settings business tables and lifecycle
journals empty, Auth user tables empty, and retained lifecycle state unchanged.
That lifecycle canary was followed by notification-processor deployments that
re-enabled the shared every-minute Cron. At that checkpoint Worker version
`1413b726-0930-45f4-b779-67865fffa24d` was active at 100%; the deployed
synthetic notification and analytics canaries passed with exact cleanup. The lifecycle selector
remains unset, so lifecycle processing is still disabled. Notification event
source parity, production fit, and integrated operational parity remain open.
See `docs/migration/license-expiry-proof.md` and
`docs/migration/notifications-api.md`.

The latest deployed admin user-directory read canary exercised MFA-protected
email and profile-field search plus user detail on split Auth/business D1. The
email substring lookup now uses literal `instr(lower(...), ?)`, avoiding the
remote D1 `LIKE` pattern failure. Anonymous list/detail requests returned 401.
After cleanup, Auth user/account/session/verification/two-factor/admin-role/MFA
assurance rows and business profile/license/audit rows all read back at zero;
the monotonic `mfaGeneration` singleton remains at 1 by design. Worker version
`9db2a730-a8e2-49ad-b980-4441368c681e` is active at 100%.

The same Worker version also adds the MFA-protected admin plan update. Its D1
batch changes `user_settings`, inserts the admin audit record, and creates or
removes Enterprise overrides atomically. A synthetic staging canary changed
Free→Enterprise→Max→Free, read back the exact override fields/actor, and
restored the baseline. Independent remote checks found zero Auth users,
accounts, sessions, verification rows, factors, roles, assurances, business
profiles, Enterprise settings, licenses, or audits; `mfaGeneration` remains 1.
Plan changes are now routed to D1 in the staging SPA. Suspension, password
reset, and immediate-expiry mutations remain disabled. These were synthetic
staging checks; user-data import, production routing, and domain/DNS remain
unperformed.

## Verified implementation checkpoint

| Area | Saved change | Evidence and limit |
| --- | --- | --- |
| Integrated registration/auth/business/R2 staging rehearsal | Current worktree + workers.dev staging | The synthetic registration smoke passed login/session use, registration, R2 cover upload/public read/owner delete, profile save, lottery apply/cancel, anonymous versus owner details, and rejection paths. It verified all 16 auth email-template rows against the pinned digest before and after, then read back zero ordinary business rows, zero user-owned Auth rows, and no R2 object. No email, Stripe, production, real user data, or DNS was used. Broader #37 acceptance remains open. |
| Self-service account deletion | Current worktree + workers.dev staging | The staging-selected Worker requires a Better Auth session, same-origin request, exact confirmation, and current password; it preflights source-FK and license-transfer blockers before exact D1 billing links, returns eligible licenses, removes account-owned D1 state, and deletes Auth last. Local D1 tests 5/5 and Stripe mode/cancellation tests 4/4 pass; the complete Worker test chain, migration-data 130/130, staging build, and Wrangler dry-run pass. Live synthetic sign-in and deletion returned 200/200; exact remote readback showed zero synthetic Auth user/account/session rows and zero user-owned business rows. Its deletion audit was read back and then removed. No Stripe call, email, real user data, production route, or DNS was used. Production remains on Supabase; cross-system recovery/order and populated-account billing acceptance remain open. See `docs/migration/account-deletion-api.md`. |
| Credential transform target profile | Current worktree | Exact local DDL is bound to the source catalog, lifecycle/generation schema, and descriptor. The special six-column writer atomically applies transformed/disabled rows for active licenses. Inactive/returned rows now atomically receive metadata-only `deferred_inactive` coverage and checkpoint advancement, with no destination row/hash; a synthetic ACK-unknown restart and full reconciliation test passes. The credential schema/import suite passes 11/11. The current-catalog rehearsal now includes four synthetic rows, including an int64 event ID beyond JavaScript's safe range, and completes all 40 checkpoints; no live user data was read. `deployable` and `fullMigrationReconciled` remain false with 18 schema gates unresolved. See `docs/migration/credential-import-integration.md`. |
| License expiry source-shaped integration | Current worktree + deployed staging Cron canary | Local source-shaped suite passes 25 checks; lottery selection 10 and scheduler contract 8 pass. The remote staging canary completed one synthetic winner through an actual workers.dev scheduled event, then restored the baseline setting, removed synthetic rows/journals, and preserved retained lifecycle state. The latest Worker routes `0 0 * * *` only to lifecycle and `* * * * *` to notifications/Stripe dispatch. Staging declares both triggers but keeps `LICENSE_EXPIRY_BACKEND` unset, so daily lifecycle invocations return disabled before D1 access. A separate earlier local `--test-scheduled` rerun hit `ECONNRESET`; the deployed lifecycle Cron run supplies the live scheduler evidence. Production CPU/plan fit, recurring activation, and user-row cutover remain open. See `docs/migration/license-expiry-proof.md` and `docs/migration/lottery-selection.md`. |
| Credential descriptor/row path | `59a02f1` + current worktree | Six-column mapping, exact `credential-to-bcrypt` codec, manifest/descriptor/target binding, private one-use credential input, prepared hash reuse, atomic artifact/coverage/checkpoint write, and typed readback are integrated. Disabled rows on active licenses transform to bcrypt; inactive/returned rows are durably deferred without writing a target credential. |
| Credential import projection | `ddcbfea` + current worktree | Projection preserves source row/hash/PK evidence while withholding plaintext from generic bindings. The current full-catalog synthetic rehearsal passed after an injected ACK-unknown stop; no real credential was read or imported. |
| PostgreSQL event sequence and encrypted backup | Current worktree + synthetic APAC R2 staging destination | Snapshot format 4 captures and verifies the reviewed `fanmark_events.id` sequence definition, exact decimal `lastValue`, and `isCalled`; local D1 import reads back the seeded next ID for called and unused cases. The Git-external archive is one AES-256-GCM ciphertext with hidden source names/counts. A fresh Node process restored a persisted synthetic bundle; a separate canary uploaded the encrypted bundle to a private APAC R2 bucket, downloaded/hash-checked/restored it, deleted both objects, and read the bucket back empty. The full migration-data suite passes 125/125 with no skips. Synthetic only: no live sequence/user rows were read or migrated. Independent key custody, least-privilege destination credentials, retention policy, complete Auth/Storage backup, source freeze, and production restore remain open. See `docs/migration/snapshot-export-design.md` and `docs/migration/d1-import.md`. |
| Local Better Auth/D1 proof | `docs/migration/auth-feasibility.md` | Better Auth 1.7.5 + bcryptjs 3.0.3 verified synthetic `$2a$10$`/`$2b$10$` password, UUID/session, and TOTP flows under workerd. No real Auth rows or hashes were exported. |
| Application Worker Auth and emoji admin route | Staging Worker + conditional Auth wiring | `/api/auth/*` reaches Better Auth through dedicated `AUTH_DB`; admin routes require role and current-session MFA assurance. The synthetic TOTP/admin canary passed on prior deployed version `1413b726-0930-45f4-b779-67865fffa24d`; it exercised sign-in, enrollment, session rotation, and gated admin reads, then removed all synthetic Auth rows. Current version `bc5ad53e-5f08-492b-81fb-8046c9be9600` adds conditional Resend verification/reset and four existing-account OAuth providers. Live capabilities return all email/signup flags false and no providers; sign-up, reset, social sign-in, and OAuth callback probes return 403. Email/OAuth selectors and secrets remain unset; no message or provider callback ran. Broader admin authorization, user/Auth import, and CPU plan fit remain open. See `docs/migration/auth-feasibility.md` and `live-observations.md`. |
| R2 image Storage API | Current worktree + staging Worker/SPA; new uploads enabled on workers.dev staging only | APAC buckets `fanmark-avatars-staging` and `fanmark-cover-images-staging` are bound to the current app Worker with `STORAGE_BACKEND=r2`; `VITE_STORAGE_BACKEND=r2` is in the staging build. Local Worker tests 5/5 and client tests 7/7 pass. Live synthetic PNG upload, public read, owner delete, and post-delete 404 passed; no canary object remains. Existing Supabase objects were not copied and production remains on its default Supabase selector. See `docs/migration/storage-r2-app-api.md`. |
| Owner-scoped dashboard list API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET /api/me/fanmarks` derives the only `user_id` predicate from Better Auth and returns the bounded dashboard DTO. `OWNED_FANMARKS_BACKEND=d1` and `VITE_OWNED_FANMARKS_BACKEND=worker` are active in staging; the live synthetic account received its one owned row, then that row was deleted and read back as zero. Four split-D1 tests and four client tests pass. No user rows were imported. |
| Better Auth own-profile API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/PATCH /api/me/profile` uses session identity and omits billing/invitation fields; writes allow only display name, language, and a same-owner R2 avatar URL. The live synthetic account read and updated its display name/language; cleanup left no profile row. Five Worker integration and four client contract tests pass. Wider profile and upload flows remain split across Supabase and Cloudflare. |
| Notifications inbox API and event processor | Current worktree + staging Worker/SPA; inbox and processor enabled on workers.dev staging only | Session-scoped list/unread/read-one/read-all routes use bounded DTOs. The deployed workers.dev Cron processed synthetic return/favorite events and all three transfer events (`transfer_requested`, `transfer_rejected`, `transfer_approved`), with one delivered Japanese in-app notification for each intended owner/requester. A separate canary ran all 10 migrated in-app master rules through the Cron and confirmed one delivered Japanese notification per rule, then removed every synthetic row. `NOTIFICATION_PROCESSOR_BACKEND=d1` and a one-minute Cron are active on staging. The Worker-backed header preview now refreshes every 30 seconds in the foreground and pauses in background tabs; Supabase selection retains Realtime. Email/Web Push, unexercised source-specific events, production recurring fit, and populated-user CPU/authorization review remain open. See `docs/migration/notifications-api.md`. |
| Notification admin and logs | Master editor, payload-minimized read routes, and manual event creation deployed to workers.dev staging | Deployment `938f880d-f3db-46d5-9634-60612e4e2814` includes the MFA-gated D1 rule/template editor, event log, and delivery log. A synthetic admin completed TOTP/MFA; the canary read 10/40 masters and both logs. Anonymous requests returned 401, notification payloads were omitted, and delivery user IDs were truncated to eight characters. On 2026-09-27 a separate MFA-authorized manual-event POST canary passed: the deployed Cron produced one delivered Japanese in-app notification for a synthetic recipient, then event, notification, profile, and Auth rows were removed and read back at zero. No real user rows were touched. See `docs/migration/notifications-api.md`. |
| Invitation code admin API | Current worktree + workers.dev staging | The staging screen selector and `INVITATION_ADMIN_BACKEND=d1` are active. A same-session MFA canary passed list/create/CAS edit/stale-write rejection/disable/delete; exact D1 readback found zero invitation rows afterward. DTOs omit creator IDs. Worker tests pass 5/5 and client tests 4/4. Invitation data has not been imported; signup, validation/consumption, and mode-setting stay closed. See `docs/migration/invitation-admin-api.md`. |
| Owner fanmark profile API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/PATCH /api/me/fanmarks/{fanmarkId}/profile` resolves the active license from Better Auth identity. Live synthetic GET/PATCH passed and its profile row was removed; same-origin R2 profile URLs now enforce correct bucket and owner. An integrated cover upload/read/profile-save/foreign-path rejection/delete canary passed on current staging; five Worker and five client tests pass. See `docs/migration/fanmark-profile-api.md`. |
| Owner fanmark settings API and protected access | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | Both settings selectors and `VERIFIED_ACCESS_BACKEND=d1` are active in staging. Live synthetic settings GET/PATCH returned 200/200; unauthenticated access and wrong password returned 401; valid verification returned 204 and protected content returned 200. Runtime evidence matched the password generation, no password/hash was returned, and cleanup read back zero canary rows. Worker/client settings suites pass 6/6 and 5/5; source-profile and verified-access suites pass. See `docs/migration/fanmark-settings-api.md` and `live-observations.md`. |
| Fanmark single and bulk return APIs | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `POST /api/me/fanmarks/return` and `/bulk-return` use Better Auth identity and business D1; both guard active ownership and active/applied transfer codes, transition licenses to grace, and best-effort write audit/owner/favorite events. Bulk accepts 1–50 distinct license IDs and returns 207 on partial success. Synthetic staging returned 207 for one success plus one blocked license, then 200 after removing the second test transfer code. Cleanup read back zero rows across 40 source business tables and user-owned Auth tables; access-version state and singleton MFA generation were unchanged. The retained license-incarnation registry is now 21 rows (16 earlier rows and five synthetic anti-reuse tombstones accumulated during return canaries); no access-version rows remain. Local Worker suite passes 17/17 and client suite 7/7. Notification delivery remains separate. See `docs/migration/fanmark-return-api.md` and `live-observations.md`. |
| Favorites API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/POST/DELETE /api/me/favorites` resolves emoji IDs against active Master D1 and uses business D1 for owner rows. Live synthetic add/list/remove passed; the favorite, event, and newly-created discovery rows were removed and composite readback was zero. Four Worker and four client tests pass. No historical favorites were imported. See `docs/migration/favorites-api.md`. |
| Emoji master D1 staging/API/frontend | Current worktree + APAC staging D1/Worker | Two independent read-only exports of the 3,944-row public master matched. A staging-only release with unchanged UUID/emoji/codepoint identities was promoted then rolled back using the guarded remote runner; activation history reads generation 1 promotion, generation 2 promotion, generation 3 rollback. Original release `10ec…` is active and the API returns 3,944 rows. Canonical `emoji_master` remains at 3,944 rows; the temporary non-user release stays inactive for immutable audit history. Migration-data tests pass 93/93 and the Miniflare release suite passes 7/7. See `docs/migration/emoji-releases.md` and `live-observations.md`. |
| Other non-user reference masters | Current worktree + APAC staging D1/Worker | Migrations `0004` and `0006` are applied; active generation 8 has 4 tiers, 4 languages, 5 reserved patterns, and 16 extension prices. All four public routes return HTTP 200/no-store and omit Stripe IDs. The private HMAC route is deployed. A synthetic TOTP admin completed Tier C null→1→null and tier-1 one-month price ¥500→¥501→¥500 through the deployed MFA API; anonymous writes returned 401, stale CAS returned 409, and all four masters plus Stripe IDs matched after restore. Auth/profile business canary rows returned to zero after cleanup. Stripe extension checkout remains disabled and returns 404 until server/webhook/dispatch selectors and secrets are configured. Production/default pricing remains on Supabase. See `docs/migration/reference-master-data.md` and `live-observations.md`. |
| Availability against versioned reference release | Current worktree | Added a separate Miniflare integration suite that applies the checked-in `0004` reference-master migration, stages/activates a synthetic release, and exercises the real `fanmark_tiers` active view through the Worker availability route. It verifies integer-cent storage/USD response conversion, selection of a second tier, and inactive-tier behavior. The older focused availability suite remains in place for validation and lifecycle boundaries. Three integration cases, eight focused availability cases, and three reference-master API cases pass; Worker typecheck, targeted ESLint, CI isolation check, and `git diff --check` pass. No remote D1/R2 write, user data, production deployment, or DNS change. |
| Public access reads | Current worktree + staging Worker/SPA | `PUBLIC_ACCESS_BACKEND=d1` and `VITE_PUBLIC_ACCESS_READ_BACKEND=worker` are active on workers.dev staging. Emoji normalization uses `MASTER_DB`; fanmark/license/config/profile projections use `FANMARK_DB`. Local split-D1 tests pass 11/11. Live synthetic routes returned 200/no-store and their canary rows were removed. `VERIFIED_ACCESS_BACKEND=d1` and its frontend selector are also active on staging; the synthetic protected-read smoke passed, but real imported hash compatibility and CPU fit remain unverified. Paired analytics write/read APIs are active in staging; historical analytics remain in Supabase. Owner/history details use the separate staging endpoint recorded below. No production traffic was switched. See `docs/migration/public-access-contract.md`. |
| WhoIs owner/history details | Current worktree + workers.dev staging | `VITE_FANMARK_DETAILS_BACKEND=worker` and `FANMARK_DETAILS_BACKEND=d1` select `/api/fanmarks/details`. Local Worker D1 tests pass 3/3, including a two-owner history fixture, and frontend contract tests pass 4/4. A synthetic staging canary verified authenticated one-row owner/lottery state; today's anonymous live read returned the versioned not-found DTO. User IDs, email, and license IDs are omitted. Browser acceptance, imported-row parity, and production routing remain open; no real user data was read. See `docs/migration/fanmark-details-api.md`. |
| Public access and owner analytics APIs | Current worktree + workers.dev staging | The staging SPA and Worker select D1 for `POST /api/fanmarks/access` and the session-scoped `/api/me/analytics/*` reads. The synthetic canary recorded one event, suppressed four duplicates, verified owner metrics and summary, received 401 anonymously, then removed its Auth/business rows. Worker D1 tests pass 8/8 and frontend client tests pass 3/3 for each adapter. Historical analytics remain in Supabase; user data, production traffic, and domain/DNS were untouched. Abuse controls, retention, populated-user authorization, and production CPU/plan fit remain open. See `docs/migration/fanmark-access-analytics-api.md`. |
| D1 role separation | Current worktree + APAC staging | `D1_TOPOLOGY=split` selects business `FANMARK_DB`, Better Auth `AUTH_DB`, and emoji/reference `MASTER_DB`, failing closed for missing bindings. Business staging has 40 source-shaped tables plus applied lifecycle/credential/access extensions; its application baseline contains 10/40 global notification masters, four disabled availability rules, and the two explicitly allowlisted public settings `grace_period_days=1` and `max_emoji_characters=5`. User-owned business/Auth rows are empty. The separate protected-access tables retain documented synthetic canary telemetry and license-incarnation tombstones. Master D1 has 3,944 canonical emoji rows and active release, with reference-master generation 8. The source refresh has 40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum labels, 36 triggers, 77 policies, 58 functions, and one view. Snapshot format 4 fingerprints eight scopes and validates the reviewed event sequence state; fresh v11 schema-only report without the credential descriptor has 13 blocking groups (8 row-conversion, 5 schema/operation across 226 locations) and `deployable: false`; generated date and timestamp checks preserve canonical values on imports and later writes, while operation-level timestamp precision remains a gate; four exact GIN definitions have reviewed query-contract dispositions. No real rows or live event sequence state were migrated. |
| Lifecycle settings API | Current worktree + staging Worker/SPA | Public `GET /api/system/lifecycle` reads only the public `grace_period_days` row through split business D1; `PATCH /api/admin/system-settings/lifecycle` requires administrator role and current-session MFA. Supabase public value `1` was read-only verified and copied as one staging config row. Client 4/4, combined settings D1 9/9, full standard suites 30/30 and 10/10 pass. A new synthetic staging TOTP canary verified anonymous 401, authenticated temporary update, invalid value 400, public no-store readback, restoration to `1`, and empty user-owned Auth tables after cleanup. The API canary and rendered AdminSettings browser form both updated the setting from `1` to synthetic `2`, read it back through D1, restored `1`, and removed synthetic Auth/profile rows. The value is at baseline; `updated_at` advanced and the MFA generation counter may have advanced during factor enrollment/removal. The shared staging Cron is active for notifications; `LICENSE_EXPIRY_BACKEND` remains unset, so lifecycle execution is disabled. See `docs/migration/lifecycle-settings-api.md`. |
| Plan and general system settings | Current worktree + workers.dev staging | An exact allowlist of 18 non-user Supabase settings was added to the two existing settings (20 total). Source and D1 canonical digests match `d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f`; the public GET returns exactly 17 public keys and omits both private Enterprise settings. Public GET and SPA returned 200/no-store; anonymous admin GET returned 401/no-store. A synthetic Better Auth administrator passed TOTP/MFA read/update, exact D1 readback, stale-write rejection, baseline restoration, audit-value minimization, and audit cleanup. Worker tests 5/5, client tests 4/4, migration-data 124/124, typechecks, staging build, and dry-run pass. Deployed at 100% as version `3310b139-f639-4cf2-8a15-ad2b63f9fbd6`. Browser UI acceptance and payment behavior remain open; production stays on Supabase. See `docs/migration/system-settings-api.md`. |
| Availability-rule administration | Current worktree + workers.dev staging | `AdminPatternRules` selects the MFA-protected D1 API only in staging. Four explicit source rules were seeded with `created_by=NULL`, remained disabled, and were read/edit/CAS-restored by the deployed TOTP canary. Worker tests 4/4 and frontend tests 5/5 pass. This does not move Stripe enforcement or other admin CRUD. See `docs/migration/availability-rules-admin-api.md`. |
| Current app staging deployment | APAC `fanmark-app-staging` Worker + Static Assets | Current version `708ff90b-abec-405d-9dd0-6a0d14cafe3c` at 100%; split D1 and both image R2 bindings remain. PR #41 commit `2ecbb25` adds a 30-second foreground refresh to the Worker-backed subscription view while keeping focus/visibility refresh and Supabase Realtime behavior. The served JavaScript SHA-256 `a1c1588560062c017d59377a60f537aedef080ae6e5ca7c4dbda738040fe8bc9` matches local `dist-staging`; SPA and Auth health returned 200, and unauthenticated `/api/me/subscription` returned 401. Earlier staging versions added the notification-preview foreground refresh and same-tab/focus/visibility own-profile synchronization. The deployment readback itself made no D1 writes; a later isolated subscription canary wrote two temporary synthetic rows and removed them. No real user-data imports, production routing, or domain/DNS changes occurred. The separate `fanmark-migration-backups-staging` bucket is APAC Standard, private, has no custom domain or r2.dev access, and is not bound to the app; its encrypted synthetic upload/download/restore/delete canary returned it to zero objects. Business migrations through `0015` and Auth migration `0008_auth_user_suspension.sql` are applied; all eight user-owned Auth tables, including status audit, read back empty after the latest TOTP canary. The 16 localized auth email master rows remain readback-verified against their pinned content/seed digests. MFA-gated user list/detail, plan, suspension/restoration, immediate license expiry, password-reset mutation, system settings, subscription display, profile username availability, and account deletion use split D1/Better Auth. Subscription display reads only the signed-in user's row and omits Stripe IDs; the user-owned subscription table remains empty and no Stripe or user data was copied. Resend secrets remain absent, so password-reset delivery is closed with 503 before audit; no email was attempted. Prior live canary verified suspension, current-session revocation, restoration, immediate expiry, four config deletions, two audit rows, one notification event, and repeat safety, then cleaned synthetic rows. Post-run readback found zero user settings/licenses/favorites/notifications/user events/expiry audits/four config types and zero Auth user-owned rows; 45 license-incarnation tombstones remain as retained synthetic anti-reuse state. Signup and email delivery remain disabled because delivery is not configured; OAuth providers remain unset. The every-minute Cron remains for notification/Stripe dispatch; the separate daily lifecycle trigger is configured with its execution selector unset. A separate synthetic account-deletion canary passed and was cleaned; the expiry/lottery Cron canary also restored its exact baseline. No real user data, production routing, or domain/DNS changed. Authenticated subscription browser refresh, reset-mail acceptance, remaining app/API inventory, Stripe sandbox/integrated acceptance, key custody/retention policy, real user/Auth/object import, production routing, and domain/DNS remain open. |
| Broadcast email admin browser acceptance | Current worktree + workers.dev staging, version `21f0be9e-2099-49d8-b975-a3a61604c12e` | A synthetic administrator signed in through the deployed Better Auth UI and completed TOTP/MFA. The D1-backed 一括メール screen rendered its staging-only banner and zero baseline; the UI created a synthetic draft, showed the saved draft in history, and previewed its exact subject/body. Test-send and bulk-send buttons were disabled. After logout, readback found zero canary Auth user/account/session/factor/role/assurance rows and zero profile/draft/audit rows; private credentials and TOTP artifacts were removed. No email or real user data was sent or copied, and production routing/domain/DNS were unchanged. This closes the broadcast-screen browser canary only; provider delivery, bulk queue semantics, and broader authenticated UI acceptance remain open. |
| Authenticated master-data admin screens | Current worktree + workers.dev staging, version `21f0be9e-2099-49d8-b975-a3a61604c12e` | A synthetic administrator signed in through the deployed Better Auth UI and completed TOTP/MFA. Read-only navigation loaded the emoji master with active release `10ec42c1…` and 79 pages, system settings, plan settings, 10 notification rules and 10 grouped notification templates (4 locale variants each), and the signup-confirmation email template in JA/EN/KO/ID. No controls were saved, no manual notification or email was sent, and no user/event-log screens were opened. After logout, exact D1 readback found zero synthetic Auth users/accounts/sessions/factors/admin roles/MFA assurances and zero profile/audit rows; temporary credentials and helper state were removed. No production routing or domain/DNS changed. This verifies these screens' authenticated rendering and reads only; write flows and broader acceptance remain open. |
| Lifecycle target schema | `01a1507`, `8034735` | Exact source/extension DDL and fingerprint consistency; actual 40-table catalog applied to empty local D1. No production rows. |
| Credential incarnation authority | `7cf0fe6` | Missing retained authority is rejected by reads and final SQL; credential suite 19 passed. Isolated proof schema. |
| Lifecycle/access-generation and protected-access integration | Current worktree + workers.dev staging | 24 triggers invalidate proofs on license/password and source-backed fanmark selector, basic/redirect/messageboard/profile changes. The Worker verifier reads the same 40-table source profile and checks descriptor-bound credential provenance. Dedicated D1 and full source-profile tests pass; the frontend contract is covered. Deployed synthetic settings/protected-access canary passed and cleaned all rows. The selectors are active on staging only. Real source password-format compatibility, Cloudflare CPU and multi-instance checks, deployed-origin security review, and full browser acceptance remain open. |

These checks ran on Node 22.6.0 without skips. The combined Supabase CI/deploy
workflow remains manually disabled because it also applies Supabase production
migrations on main. A separate `.github/workflows/cloudflare-migration-validation.yml`
now runs the migration-data tests, staging application build, complete Worker
suite, typecheck, and non-deploying Worker dry-run on PR/main-push/manual events.
The local isolation checker requires that workflow to stay secret-free and
without Supabase or remote-deploy commands; a hosted run is still pending.

The protected-access implementation separately binds license incarnation and
password/access generations. The full source-profile test now rejects stale
proofs and reads synthetic protected text through the connected Worker route.
The older isolated proof suite remains historical supporting evidence; it is
not a substitute for the current source-shaped integration or the outstanding
staging/password-compatibility gates.


A subsequent bounded unit added `credential-import-projection.mjs`: canonical
snapshot records are checked with the existing row converter and record hash/PK
contract, then split into five ordinary bindings and a one-use opaque transform
input. Parent verification passed 74 migration-data tests, actual 40-table
metadata plus one synthetic row, and CI isolation checks. The generic importer
is still guarded. The integration design now requires a single six-column
INSERT assembled with the prepared hash, preserving NOT NULL and avoiding a
second trigger increment; deferred rows remain whole in the private source.

## Next implementation sequence

Staging follow-up completed on 2026-09-23 and advanced on 2026-09-24. The
current app Worker is `c9d51d92-3b7a-49e9-b152-b210d24a36f1`; it binds separate
business, Auth, and master D1 databases plus two R2 buckets. Live smoke checks
passed for noindex, Better Auth health/session, the emoji and all three
reference-master APIs, anonymous admin denial, and R2 reads. Synthetic
sign-in/session/logout/wrong-password and first-time TOTP/admin-authorization
cycles passed, then all Auth user-owned tables returned to zero. The MFA
generation singleton advanced monotonically from 0 to 2 through the synthetic
factor create/delete lifecycle. The deployed Cloudflare-staging JavaScript matches
the local build and selects Better Auth for email login; broader business flows and avatar upload still retain Supabase paths; the
own-profile API is now explicitly selected for staging. The live
public schema was refreshed on 2026-09-24; at this historical checkpoint the
business D1 remained empty while the full synthetic operation/security rehearsal was built. The same deployment
now connects the emoji-master admin UI to MFA-protected canonical draft APIs;
the active emoji release remained unchanged during a live edit/restore smoke.

A bounded recent-fanmarks API slice now connects the search screen to the
shared Worker loader and preserves both the public short ID and fanmark ID.
Local Supabase/D1 contracts, frontend typecheck/build, and app Worker dry-run
pass. At that checkpoint the recent backend was not selected; subsequent staging
updates enabled the recent route and are recorded below.

The public short-ID/emoji/profile read routes have a frontend adapter behind
`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`. The `/a/:shortId`, emoji-path, QR,
and published-profile reads use the reviewed Worker projection when selected;
errors do not fall back to Supabase. Seven client tests and 11 split-D1 Worker
tests pass. The selector is enabled only in the workers.dev staging build.
Synthetic live staging reads returned 200/no-store for short-ID, emoji, and
published-profile routes; the canary rows were removed and read back as zero.
The default Supabase path retains password verification. At this earlier
public-read checkpoint, access analytics and owner/history details still
remained on Supabase. The separate
`VITE_VERIFIED_ACCESS_BACKEND=worker` selector is still off, so password-
protected Worker reads fail closed. This is not a production public-access
cutover. See `docs/migration/public-access-contract.md` and
`docs/migration/verified-access-design.md`.

On 2026-09-24, a descriptor-bound codec slice was added: credential-bearing
schema conversion no longer selects ordinary `text`, and the same descriptor
is required by snapshot verification, row validation, and target-profile
fingerprinting. The generic importer's private run/checkpoint/report identity
also records its digest while the pre-write credential guard stays enabled.
The schema-conversion and importer report/ledger versions are now 2, preventing
older codec or checkpoint state from resuming under the changed policy.
The migration-data suite passes 85 tests, the lifecycle/credential-schema
integration passes 9 tests, the Worker suite passes 30 tests, and Worker
TypeScript checking passes. The integrated credential row INSERT, artifact
preparation/application, coverage write, and checkpoint atomicity remain open.
R2 bucket enumeration after user activation confirmed the two expected staging
buckets; this was a read-only check and copied no objects.

1. Continue the basic local/staging application and infrastructure slice
   under #34: the latest schema-converter-v4 private report covers the
   2026-09-25 catalog, parses 40 tables and 66 indexes, and passes isolated
   SQLite foreign-key/integrity checks. It still has 18 unresolved gate groups
   (10 row-conversion and 8 schema/operation), so `deployable: false`; schema-
   only DDL is now applied to the previously empty business-staging D1 (40
  tested. Next connect and validate business routes, authorization, and the
   application tables, 66 indexes), with no imported user rows. Recent,
   availability, public access, analytics, and most owner API selectors are
   now enabled in staging after synthetic canaries were cleaned up. The
   active-to-grace lifecycle repository, guarded password verifier, and
   scheduled entrypoint have source-shaped synthetic coverage. Next resolve
   the remaining schema-conversion/importer gates, complete required Worker +
   Static Assets routes/jobs, finish integrated business authorization across
   the synthetic Auth boundary, and run focused permission/parallel-operation
   checks plus the broader synthetic rehearsal. No production rows or secrets
   enter these local proofs. The refreshed catalog is structurally the same size as the
   prior one (40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum
   labels), while the source also has 58 functions, 36 triggers, 77 RLS
   policies, and one view that are not yet translated to Worker/D1 behavior.
   Remote migration history confirms the three 2026-09-21 Stripe migrations
   in this repository are not applied to Supabase; do not silently add them to
   the current-source D1 profile.
2. Continue #36's emoji-master path: the verified UUID-bearing release was
   built from two matching read-only exports of the authoritative public master
   and all 3,944 rows passed isolated local D1 staging/readback on 2026-09-23.
   A local private pointer and read-only API/frontend selector now support the
   release path with identity guards. The verified master is staged and active
   in an isolated APAC remote D1. Auth schema is applied with empty user tables, and
   both the dedicated catalog API and app SPA/API Worker are deployed on
   `workers.dev`. The app Worker read back all 3,944 pinned catalog records
   with matching hashes; the dedicated versionless API read back the full
   active release with matching hashes. Keep user-held references for #38;
   focus pre-#37 work on browser acceptance, integrated authorization, and
   Wrangler plan/CPU fit. Language and public tier/price reads, plus editable
   tier-day and extension-price screens, use versioned Worker/D1 paths on
   staging. MFA-gated Tier C and extension-price edit/restore canaries passed.
   Coupon admin CRUD and redemption use the D1 Worker path, with four verified
   unused definitions staged; consumed definitions and usage history remain
   excluded for user-data reconciliation. Five reserved-pattern rows
   are in the active release and feed the Worker read/availability path; no
   dedicated editing UI consumer is present. R2 is enabled: staging avatar/cover uploads and
   profile URLs use the two bound R2 buckets, while existing Supabase objects
   have not been copied and production remains on Supabase.
   Use synthetic
   users only; do not attach the production domain or import real user data.
   Production application routing remains part of #38.
3. Complete the synthetic end-to-end rehearsal in #37 across the app, explicit
   masters, auth, storage, and billing sandbox. Exercise planned maintenance
   and individual support steps where that is simpler than zero-downtime
   machinery.
4. The #35 encrypted snapshot exporter and local synthetic D1 restore path now
   exist, including a single authenticated ciphertext archive with hidden file
   names/counts and 64 KiB-rounded size metadata. A synthetic bundle now
   restores and verifies in a fresh Node process from persisted local files; a
   second canary uploaded its ciphertext to the dedicated private APAC staging
   R2 bucket, downloaded and restored it, then confirmed both remote objects
   were deleted and the bucket returned to zero bytes. Both plaintext restore
   trees were removed. After #37 acceptance, complete independent key custody,
   destination ACL design, retention/deletion policy, and production backup
   destination. Run the real snapshot only in #38's final user-data operation:
   source freeze, Auth/business/Storage import, independent reconciliation,
   and documented handling for MFA/session and credential outcomes.
5. Switch public DNS/hostnames after reconciliation succeeds, then monitor the
   new single-writer environment. Keep registrar transfer separate.

The generic importer still rejects any snapshot containing the credential
column with `credential_transform_required` before target mutation. Earlier
successful 40-table nonzero imports preceded this guard. Do not remove it
until the integrated transformed-row path and its failure tests are ready.

## Remaining external and release gates

- Wrangler identity, target D1 listing, and remote D1 query/write now work. The
  isolated emoji and app staging Workers are deployed; remote `0004` and the
  three non-user reference masters are active in D1. Remaining application and
  business-schema integrations still require their separate rehearsal. The
  Workers CPU/plan decision remains unresolved; no paid upgrade has been made.
- At the pre-bootstrap checkpoint, business D1 was empty. A 2026-09-24 `public` schema-only dump succeeded
  after Docker Desktop was started. The 180,288-byte private DDL artifact has
  SHA-256 `aac7f38c912b358019a9bb9f282813a10bcd3e20af09e929d1ec41a2705b42cd`;
  it contains no top-level `COPY` or `INSERT` data statements. The refreshed
  catalog was converted and parsed in an isolated local SQLite database; that
  older converter report had 19 unresolved gates and `deployable: false`.
  Schema conversion v3 translates UUID defaults to D1-native RFC 4122 version-4
  text and maps `fanmark_events.id` to AUTOINCREMENT; the exact PostgreSQL
  sequence value remains an import-stage gate. The report has 18 gates (10
  import and 8 schema/operation). The generated 40-table SQL parses in isolated SQLite with
  66 indexes, no foreign-key errors, and `integrity_check=ok`. The report still
  says `deployable: false`; schema-only DDL has since been applied to the
  previously empty business-staging D1. No source rows were imported and recent/availability/public-access and authenticated owner API selectors are
  enabled only on workers.dev staging; user rows remain absent.
  The 2026-09-21 Stripe migrations
  are local-only, with no remote-only migration IDs. The checked-in TypeScript
  public schema block matches a fresh CLI type generation, but this does not
  replace full operation, trigger, view, and authorization parity. See
  [live observations](live-observations.md) and
  [schema conversion gates](schema-generator.md).
- Two APAC Standard image buckets are bound to the staging Worker and R2 image
  selectors pass synthetic upload/read/delete. A separate APAC Standard
  `fanmark-migration-backups-staging` bucket is unbound and private: r2.dev access
  is disabled, there are no custom domains, and a synthetic encrypted snapshot
  round-trip restored successfully before its objects were deleted. The backup
  bucket is empty. No source Storage inventory or real object transfer has
  occurred. Independent key custody, destination ACL design, retention policy,
  and production backup storage remain open. Standard R2 includes 10 GB-month
  storage, 1 million Class A, and 10 million Class B operations each month;
  usage beyond those allowances is billed. The tiny synthetic canary was
  within the included allowance; the Cloudflare invoice/dashboard was not
  inspected.
  See [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
  [R2 setup](https://developers.cloudflare.com/r2/get-started/).
- Real-data compatibility and the final consistent snapshot, source freeze/drain,
  Auth/OAuth/MFA and Storage capture, independent key custody, retention policy,
  production restore, and single-writer cutover remain open.
- Local PostgreSQL and Miniflare results do not prove production parity or
  remote capacity. Read-only inventories do not implement RLS/trigger/function
  behavior.
- No production database, OAuth provider, Stripe, or public DNS change has been
  made. Staging deployments do not change the current production app. The user's
  migration request covers the eventual cutover, but it stays at the final gate
  and begins only after the listed reconciliation and rollback checks pass.
  Keep PR #41 draft.

The dashboard now has a local-only owner-scoped list path at
`GET /api/me/fanmarks`. Better Auth supplies the owner ID and D1 applies that
identity in the license query; the response omits user ID and email. Its four
synthetic Worker integration tests now run against the same 16-table
source-shaped fixture used by protected-access verification, with source
columns for fanmarks, licenses, and basic configs. Four frontend contract tests
also pass. A staging-mode frontend build forced this selector to `supabase`,
and the app Worker staging configuration passed Wrangler dry-run with separate
D1 and both R2 bindings; this route was not deployed. Business D1 has no
application schema or rows. R2 remains enabled with both staging buckets
present. No remote D1/R2 writes, real user data, production changes, or
DNS/domain changes occurred.

Detailed evidence and limitations are in [EXECUTION.md](EXECUTION.md),
[credential integration](credential-import-integration.md),
[lifecycle integration](lifecycle-schema-integration.md), and the corresponding
validation documents. Source values, private compatibility reports, and secret
material remain outside Git and must not be copied into issue/PR descriptions.

## Business schema and master-data checkpoint (2026-09-25 JST)

`fanmark-app-staging` is now version
`3733c771-2903-40cd-8bdc-5a0f94412c82`, with both existing R2 buckets bound.
Auth health/root noindex and read-only R2 route checks passed; the public
missing-object request returned 404 and the unauthenticated upload returned
401. Both R2 buckets are present and bound. Master D1 has migration `0006` and
reference release generation 2 with 29 rows across four masters. All four live
master API routes return 200 with `no-store`; extension-price DTOs omit Stripe
IDs. The schema snapshot is now format 3 and fingerprints 40-table DDL plus
triggers, RLS, functions, and views. Schema conversion v4 has 18 blocking
gates (10 row-conversion and 8 schema/operation) and remains non-deployable.
The later structural bootstrap applied 40 application tables and 66 indexes to
the previously empty business D1; it applied no rows and does not close those
gates. Migration-data tests pass 90/90 and D1 importer tests 13/13. No user rows, Storage objects,
production service, or domain/DNS state changed. See `docs/migration/live-observations.md`.

The fresh 2026-09-25 gate report splits into ten row-conversion groups and
eight schema/operation groups. The latter include untranslated view/function/
trigger/RLS behavior, external Auth references, timestamp defaults, three
checks, and four GIN indexes. The source event sequence state remains an import
gate. A live read-only
query before the bootstrap found only Cloudflare's internal `_cf_KV`; the
structural DDL is now recorded separately in `live-observations.md`. No user
data was applied. See
[`schema-generator.md`](schema-generator.md) for the exact gate boundary.

The 2026-09-25 private full-catalog `test:license-expiry-source` run passes 20
checks on the 40-table D1 profile, including the no-pending grace finalizer and
the delayed-cron two-tick ordering. `test:lifecycle-schema` passes 9/9 and
`test:license-expiry-scheduled` passes 8/8; Worker typecheck, targeted ESLint,
and `git diff --check` pass. This does not complete lottery selection/winner
issuance, transfer cleanup, notification delivery, the importer, or live Cron.
Details are in `docs/migration/lifecycle-schema-integration.md`.

The local favorites vertical is now implemented behind disabled selectors.
Synthetic split-D1 tests cover active-release skin-tone normalization,
owner-scoped listing, duplicate add/remove behavior, favorite-count updates,
event writes, and CORS/auth gates; the browser adapter and details-page state
have matching contract tests and wiring. The converter now recognizes
`seq_key(uuid[])` as an index on canonical JSON text, but the saved private gate
report has not been rerun and D1 event sequence state remains unresolved. The
business staging D1 now has schema only; only local synthetic favorites rows
were read or written and no Worker deployment was performed. See
`docs/migration/favorites-api.md`.

## Notifications inbox API (2026-09-25 JST)

The notification inbox routes and frontend selector are active on the
workers.dev staging app. Better Auth session identity is the only owner source;
list, unread count, one-row read, and bulk read use bounded DTOs and owner-scoped
SQL. Six synthetic Worker integration tests and four frontend client contract
tests pass, and a live synthetic account exercised the routes before cleanup.
The separately gated D1 event processor passed one synthetic scheduled run
against staging D1 through a local Worker; the event and generated in-app
notification were cleaned and the prior baseline was restored. No deployed
processor selector or Cron is active. Remaining event-source parity, email/Web
Push, and recurring Cron are open. Business staging has no imported user rows.
R2 remains enabled for existing staging bindings; production and domain/DNS are
unchanged. Details are in
[`notifications-api.md`](notifications-api.md).

The owner fanmark profile read/write vertical is active on staging behind
`VITE_FANMARK_PROFILE_BACKEND=worker`. It covers the edit and preview screens
and uses Better Auth session identity for ownership. The owner-settings API is
also active on staging; synthetic GET/PATCH/password/protected-access checks
passed and its live rows were cleaned up. `FanmarkMessageboardPreview` now uses
the same owner-only settings GET instead of calling `get_fanmark_complete_data`
directly. User rows remain absent from business D1, and full app/data parity is
still open. See `fanmark-profile-api.md` and `fanmark-settings-api.md`.

The 2026-09-25 local verification corrected the Workers test split: profile,
notifications, and favorites integration suites use their dedicated Vitest
configs. The dedicated suites and default Worker suite pass. Static Assets
expects the current recent-fanmarks DTO (`fanmarkId` and `shortId`); its 14
integration cases and Wrangler HTTP smoke pass. Full results are recorded in
[`EXECUTION.md`](EXECUTION.md).


## Staging deployment before owner API activation (2026-09-25 JST)

After the empty business-schema bootstrap, `fanmark-app-staging` was deployed
to its workers.dev URL as version
`3733c771-2903-40cd-8bdc-5a0f94412c82`. The staging frontend bundle contains
the same-origin Worker base URL. Staging explicitly selects D1 for recent
fanmarks, availability, and public short-ID/emoji/profile reads; owner/profile
write selectors remain disabled. The business database contains schema only
after removal of the temporary canary rows.

A temporary synthetic business fixture with two active licenses and one grace
license verified `GET /api/fanmarks/recent`: active ordering, limit 1/2, DTO
IDs/emoji/short IDs, grace exclusion, no-store, and invalid-limit rejection.
The script deleted all six inserted rows; subsequent remote counts for
`fanmarks` and `fanmark_licenses` were both zero. `POST
/api/fanmarks/availability` used a canonical public emoji-master ID and returned
a valid available tier-4 DTO with exact CORS origin and no-store. After the
canary, the recent endpoint returned an empty list as expected. All seven
Better Auth user-owned tables also read back zero.

Node 22.6.0 validation passed: migration-data 90/90; frontend and Worker
typechecks; default Worker 26/26 plus verified-access 9/9; recent D1 6/6 and
client 9/9; availability D1 8/8, split reference-master availability 3/3, and
client 6/6; synthetic profile 5/5, owned-fanmarks 4/4, scheduled expiry 8/8,
and public-access client 7/7; staging build, Wrangler dry-run, and
`git diff --check`. No user data, production service, or domain/DNS changed.
The schema-conversion report still has 18 unresolved gates and remains
`deployable: false`; the rest of the app is not yet cut over.

## Public access staging verification (2026-09-25 JST)

The staging Worker is version `3733c771-2903-40cd-8bdc-5a0f94412c82`. The
frontend public-read selector and Worker D1 backend are enabled only on the
workers.dev staging app. A temporary synthetic fanmark with a published
profile returned HTTP 200 and `Cache-Control: no-store` through short-ID,
emoji-ID, and public-profile endpoints. The emoji lookup used the canonical
emoji in `MASTER_DB` while the business D1 `emoji_master` table had zero rows;
this caught and fixed a split-D1 repository binding error. The four synthetic
business rows were deleted and exact-ID readback found zero in all four
tables. The business database remains schema-only.

The split-D1 public-access Worker suite passes 11/11, Worker typecheck and
targeted ESLint pass, staging build and Wrangler dry-run pass, and the corrected
Worker was redeployed. Password-verification selection remains disabled;
production reads, user data, and domain/DNS are unchanged.

## Current owner API staging verification (2026-09-25 JST)

The app config now selects D1 for profile, owned fanmarks, owner fanmark
profile, favorites, and notifications. The staging SPA build script records the
matching `VITE_*_BACKEND=worker` values so subsequent staging builds keep the
Worker selectors. `fanmark-app-staging` version
`70cb8111-2a25-4e43-8662-e59dfd8add8d` passed Wrangler deploy and dry-run with
split business/Auth/master D1 and both R2 buckets.

A temporary verified Better Auth account exercised profile GET/PATCH, owned
fanmark listing, owner fanmark profile GET/PATCH, favorite add/list/remove,
and notification list/unread/read operations. An unauthenticated profile call
returned 401. The first synthetic account fixture used the wrong Better Auth
`accountId` and was rejected; it was cleaned up, then the fixture was corrected
to use the synthetic user ID. The successful canary deleted the session, user,
profile, license, fanmark, notification, favorite, event, and discovery rows;
remote exact-ID/composite readback found zero. Local focused client/Worker tests
pass 31/31 across seven suites. Event generation/delivery, the rest of the
settings/save flows, full business parity, real data, production routing, and
domain/DNS remain open. See `live-observations.md` and the feature API notes.

## Fanmark registration Worker slice (2026-09-25 JST)

Added `POST /api/fanmarks/register` in
`workers/api/src/fanmark-registration-d1-api.ts` and routed all four existing
frontend registration callers through the explicit
`VITE_FANMARK_REGISTRATION_BACKEND` selector. Supabase remains the default;
the Cloudflare staging build selects the Worker and the staging Worker selects
business D1. The adapter verifies the submitted ordered emoji IDs against the
ready active catalog release, derives skin-tone-neutral identity IDs on the
server, reads the active tier, then atomically writes the fanmark, initial
license, license-scoped basic/redirect/text/profile config, and audit record.
The D1 mutation rechecks active-license, grace-window, and expired-grace pending
lottery guards so competing requests cannot both acquire the same identity.

Node 22.6 verification passed: frontend registration API 6/6, Worker D1
registration 8/8, frontend and Worker typechecks, CI isolation check, staging
build, Wrangler deploy dry-run, and `git diff --check`. Staging deployment
`29dd848d-604c-4405-9bf5-58aff04a00f2` is at 100% on
`fanmark-app-staging`. A live synthetic owner registered the active catalog's
rose emoji as tier 4; duplicate registration returned 409, unauthenticated
registration returned 401, and readback showed the active license, basic
config, profile, and audit record. Cleanup readback returned zero for the
synthetic Auth user/account/session, fanmark/license/config/profile/audit rows,
and all 40 business tables. No Supabase rows, production route, or domain/DNS
state changed.

This is a staging app-operation proof only. It does not prove imported-user
behavior or production parity. The existing source registration function does
not enforce its computed `requiresPayment` result; this implementation keeps
that observed behavior and does not call Stripe. Bulk return, transfer and
winner-draw/finalization operations, notification delivery, remaining schema
and credential gates, and full cross-feature rehearsal remain open. Details are in
[`fanmark-registration-api.md`](fanmark-registration-api.md).

## Fanmark lottery application and cancellation slice (2026-09-25 JST)

Implemented D1 routes for lottery application and cancellation and routed
`useLotteryEntry.tsx` through the explicit `VITE_FANMARK_LOTTERY_BACKEND`
selector. Supabase remains the default. The D1 application path requires one
live grace license, one applicant settings row, enforces plan capacity with a
guarded insert/update, blocks duplicate pending entries, and reuses cancelled
entries. Cancellation verifies ownership and updates only a pending entry.
Both state transitions write the source trigger-equivalent audit log in the
same D1 batch. Notification-event enqueue remains best effort, matching the
source function.

Local evidence: Worker D1 suite 11/11 and frontend API suite 6/6; frontend and
Worker typechecks pass. The suite includes same-entry concurrency, audit-failure
rollback, notification-failure behavior, default and configured limits, and
synthetic owner/status checks. Staging Worker deployment
`513d9cba-2424-4528-814a-3b1d83425b73` is at 100%. Its canary applied for the
rose fanmark (200), rejected a duplicate (400), cancelled the entry (200), and
rejected an unauthenticated application (401). Cleanup readback found zero
synthetic user/settings, fanmark/license/entry/audit/event, and Auth
user/account/session rows; all 40 business tables returned to zero. Winner
selection/license issuance, full user-data import, production routing, and
domain/DNS remain out of scope.

## Latest migration checkpoint (2026-09-25 JST)

The current Supabase public schema refresh is already complete; it was not
waiting for terminal input. The earlier Docker-blocked attempt is superseded.
Cloudflare staging has the lottery journal schema extension with exact
readback. A one-shot synthetic scheduled-event canary verified winner
finalization against staging D1; its run/item journals and all 40 business
tables were cleaned, and the retained incarnation registry matched its
pre-canary snapshot. The app's scheduled backend remains disabled and no Cron
trigger is configured. Transfer and lottery finalization now have staging
synthetic proofs. Continue with remaining API/schema gates; keep real
user/Auth/object import and domain/DNS cutover for the last stage.

## Earlier checkpoint: Stripe extension settlement precondition (2026-09-25 JST)

The paid extension Checkout creator now records its expected positive JPY total
in Session metadata and sets `allow_zero_total=false`, matching the Product rule
that free Admin extensions bypass Stripe. The webhook extension path requires
a complete payment-mode Session with `payment_status=paid`; an unpaid completed
Session waits for the asynchronous settlement event, which now reaches the same
extension branch. Failed and expired asynchronous Sessions do not grant time.
New Sessions with a changed amount or currency fail closed. Legacy paid Sessions
without the expected-total metadata remain accepted during the compatibility
window.

Node 22.6 billing tests pass 70/70, the experiment TypeScript check passes,
Deno checks pass for both changed Edge Functions, and `git diff --check` passes.
This was the checkpoint before the receipt/effect transaction below.

## Stripe extension receipt-to-effect transaction (2026-09-25 JST)

The four extension Checkout Session event types now pass through the verified
raw-byte receipt ingress and then `apply_stripe_extension_receipt`. The local
PostgreSQL migration adds one effect row per live/test Checkout Session. Its
single transaction extends an eligible current license, cancels pending
lottery entries, writes both license and lottery-cancellation audits, enqueues
one cancellation notification per applicant, and terminalizes the application,
receipt, and dispatch together. Paid amount and JPY currency are checked
against new Session metadata; unpaid completion waits for async settlement,
while failed/expired sessions and late payments are denied. Duplicate events
and separate events for the same Session cannot grant twice. A changed owner,
tier, returned/expired status, transfer lock, or conflicting Session metadata
fails closed.

Local evidence: the focused receipt/settlement/effect suites pass 35/35;
PGlite covers audit and notification rollback, notification payloads, and role ACLs. Deno checks pass for the
webhook, checkout creator, and shared modules; the Stripe experiment
typecheck, CI workflow-isolation check, and `git diff --check` pass. The new
migration has been executed only in isolated PGlite tests. It has not been
applied to Supabase or D1, and neither Edge Function was deployed. No Stripe
endpoint configuration, production data, user/Auth/object data, or domain/DNS
was changed.

Still open for #32: checkout intents and Stripe API idempotency keys, other
billing webhook event paths, independent Postgres concurrency testing, and D1
porting are also open.
A payment received after a failed/expired Checkout is dead-lettered without a
license grant, but there is no automatic refund or operator alert. Add and test
a monitored reconciliation workflow before enabling this path in production.

## Search details API on staging (2026-09-25 JST)

The `useFanmarkSearch` detail lookup now has an explicit Worker/D1 path at
`POST /api/fanmarks/search/details`. The frontend uses the Worker only when
`VITE_FANMARK_SEARCH_BACKEND=worker`; the staging Worker also requires
`FANMARK_SEARCH_BACKEND=d1` and `AUTH_BACKEND=better-auth`. The Worker derives
lottery-entry identity from the Better Auth session and returns an allowlisted
search projection without redirect URLs, message text, or password settings.
`record_fanmark_search` remains on Supabase until user-derived data is migrated.

`fanmark-app-staging` version
`e3d47df4-eb20-4ade-8857-398cde3aab0d` is deployed at 100%. Business D1 reports
no pending migrations. The live anonymous details request returned 200 with
`{schemaVersion:1,result:null}` because staging has no imported fanmark rows;
Better Auth health returned 200 and unauthenticated admin returned 401. Root
typecheck/staging build, Worker typecheck/dry-run, frontend API tests 5/5,
Worker default tests 30/30, and verified-access tests 10/10 passed. Synthetic
Worker tests also cover signed-in and anonymous lottery projections, protected
field omission, and invalid-origin/input rejection. Live signed-in detail
projection is not yet demonstrated against populated D1. Real user/Auth/object
data and domain/DNS remain deferred; the search-history write is not migrated.

## Stripe Checkout intent and idempotency checkpoint (2026-09-25 JST)

The extension Checkout path now accepts one browser-generated request ID per
purchase intent and keeps it in `sessionStorage` across a tab reload. Before
Stripe is called, a service-only PostgreSQL function records the authenticated
owner, eligible license, fanmark/tier, months, Price ID, and positive JPY
amount. Replays reuse that immutable price snapshot and the same
intent-derived Stripe idempotency key. A returned Session ID is attached under
a live/test uniqueness constraint; a retry retrieves an already attached
open Session. Signed webhook metadata must match the intent, target, Price ID,
amount, and mode before application. Successful return clears the browser
request ID so a later intentional extension gets a new one.

An unbound intent is allowed to call Stripe only within a conservative
20-hour window. Stripe documents that it may prune idempotency keys after they
are at least 24 hours old; once the local window ends, a missing Session ID
requires reconciliation and the code refuses to start another Checkout
Session. [Stripe idempotency reference](https://docs.stripe.com/api/idempotent_requests).

Local evidence: the full Stripe receipt experiment passes 90/90, including PGlite
checks for request replay, changed terms, pinned price after master-price
changes, Session binding, owner rejection, reconciliation timeout, webhook
matching, and client ACL. Root TypeScript, Deno checks, the Stripe experiment
typecheck, workflow-isolation check, targeted ESLint with the file's existing
unrelated lint violations suppressed, and `git diff --check` pass. The normal
ESLint run still reports existing `any` uses and hook-dependency warnings in
`FanmarkDashboard.tsx`, outside this change. The SQL ran only in PGlite; no
Supabase migration was applied, no Edge Function was deployed, and no Stripe
or production state was changed. R2 was enabled by the user, but this Stripe
slice does not use R2.

Still open for #32: monitored reconciliation for late payments and lost
responses past the local window, non-extension webhook paths, independent
Postgres concurrency coverage, dispatch processing, and billing-effect
application. The D1 receipt/dispatch schema, signature-verifying ingress, and
claim/renew/retry lease primitives pass 20/20 local Miniflare tests. The route
is behind an unset selector and signing secret; its migration remains
unapplied remotely and the route is not deployed. See
`docs/migration/stripe-d1-ingress-validation.md`. Do not treat the Stripe
stage as deployable or migration-complete yet.

## R2 avatar and profile API integration proof (2026-09-25 JST)

The profile D1 integration fixture now binds local Miniflare R2. Its synthetic
Better Auth test runs avatar upload, public byte readback, profile URL save and
readback, rejection of another user's object path, owner delete, profile URL
clear, and final object/profile readback. The integrated profile suite passes
6/6; the existing standalone R2 API suite passes 5/5 and Worker typecheck
passes. The same end-to-end sequence passed against workers.dev staging with a
temporary `example.invalid` account. The final Auth/profile row counts were all
zero, and the public object URL returned 404 after cleanup. Both staging R2
buckets and Worker selectors are active, while existing user rows/objects
remain deferred to the user-data stage and production remains on Supabase.

After the user enabled R2, a fresh account inventory confirmed both staging
buckets exist. The staging smoke now also uploads a synthetic cover image,
reads identical bytes from its public URL, deletes it as the owner, and checks
404 after cleanup. Avatar and cover flows both passed with matching SHA-256;
the synthetic D1 rows returned to zero. Worker storage tests pass 5/5,
storage-client tests pass 7/7, script syntax and targeted ESLint pass. The
existing Supabase Storage objects are still reserved for the final user-data
phase.

The Worker fanmark-profile PATCH now validates same-origin R2 image paths
before D1 writes: cover URLs must use `cover-images`, profile images must use
`avatars`, and both must be under the signed-in owner's prefix. Other owners,
the wrong bucket, and non-public object routes are rejected; external legacy
URLs stay accepted. The source-shaped Miniflare profile suite passes 5/5, the
frontend client suite passes 5/5, and Worker typecheck passes. Staging version
`a6b0a110-9169-4921-9cdc-60e51a521714` passed a synthetic cover image/profile
canary with 201 upload, 200 public read and same-owner save, 400 cross-owner and
wrong-bucket rejection, 204 owner delete, and 404 after cleanup. Synthetic
Auth and source business rows returned to zero.

## Active emoji release availability alignment (2026-09-25 JST)

The D1 availability repository now reads IDs and emoji strings only from the
active ready emoji release, matching registration and favorites. It no longer
uses the mutable canonical `emoji_master` table for request-time identity.
Focused D1 tests prove stale canonical values do not affect the result,
canonical-only retired IDs are rejected, and a missing active pointer fails
closed. The dedicated split-D1 integration applies the real emoji activation
and reference-master migrations and passes 4/4 cases; the focused availability
suite passes 10/10. The Worker default suite passes 30/30, both TypeScript
checks, the staging SPA build, lint, and Wrangler dry-run pass.

Staging version `b381e0b3-7e03-41c2-a217-aeb1d5c5cf68` is deployed at 100%.
Read-only live checks returned root/auth health 200, the active emoji release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed` with
3,944 records, and availability 200 for one ID obtained from that release.
The check made no business or master D1 write. Production routing, user-data
import, and domain/DNS remain deferred.

## Maintenance settings Worker slice (2026-09-25 JST)

The staging app now selects the dedicated Worker maintenance-settings API.
Only `maintenance_mode`, `maintenance_message`, and `maintenance_end_time`
are exposed; other `system_settings` keys, including billing values, are not
returned. The admin PATCH uses the existing Better Auth admin authorization
path, which requires the session-bound MFA assurance. The settings are not
copied wholesale from Supabase. Missing public keys default to maintenance-off
and empty display values. Worker errors do not fall back to Supabase, and the
gate keeps general users out when the maintenance configuration cannot be read.

Client tests pass 4/4, the dedicated D1 Worker suite 5/5, Worker default suites
30/30, verified-access suites 10/10, both typechecks, targeted ESLint, the
Cloudflare staging build, Wrangler dry-run, and `git diff --check` pass. Staging
version `b7b208c7-68f8-4918-bfd9-b785ef66003d` returned the three expected
defaults with `no-store`; an anonymous PATCH returned 401, and a subsequent
GET matched the prior state. This live check did not perform an authorized
PATCH, create settings rows, alter maintenance mode, or prove an authenticated
admin browser flow. The Supabase production selector remains the default.

## Lifecycle settings Worker slice (2026-09-25 JST)

The grace-period configuration now has a dedicated read/write path. The
dashboard reads the public setting from `GET /api/system/lifecycle`; the
administrator console writes it through
`PATCH /api/admin/system-settings/lifecycle`, guarded by the existing
Better Auth role and current-session MFA check. Both screens use the same hook
and backend selector. Staging received exactly one public
`grace_period_days=1` setting row after a direct read-only Supabase check
returned that same value. No other setting or user row was copied.

Client tests 4/4, the combined maintenance/lifecycle Worker settings suite
9/9, Worker standard suites 30/30, verified-access 10/10, both typechecks,
focused ESLint (excluding pre-existing dashboard findings), staging build,
Wrangler dry-run, and `git diff --check` pass. After deployment
`bf951bd0-4aee-42f2-a9a7-997beffe06de`, live anonymous lifecycle GET returned
200/no-store with only `{grace_period_days:1}`; anonymous admin PATCH returned
401. Root/noindex and Better Auth health returned 200. Authenticated admin
read/write remains untested.

A rerun of the staging scheduler canary with baseline-setting preservation lost
the local Wrangler test-scheduled connection (`ECONNRESET`). Its cleanup
restored the setting; direct readback showed zero licenses, zero lifecycle
journal/effect rows, and 22 retained incarnation tombstones. That rerun is not
a scheduled-event pass. The scheduler selector and Cron trigger stay disabled
until the bounded check succeeds.

The linked Supabase catalog was refreshed read-only on 2026-09-26 through the
Management API. It still has 40 base tables and 406 table columns; the 411
`information_schema` total includes five columns from its one view. The fresh
converter output still has 18 blocking gates and `deployable: false`, while all
40 table names and 406 column names match the staging baseline. A read-only
notification-master export contains 10 in-app rules and 40 active in-app
templates across four locales; `created_by` was excluded. Its idempotent seed
SQL has now been applied to business D1 and exact readback matched the private
source snapshot across every projected field. Rules/templates are 10/40,
`created_by` is NULL, notification preferences/events/notifications, user
settings, fanmarks, and licenses are zero, and the one public lifecycle setting
remains intact. The dedicated verifier and source digest are recorded in
`docs/migration/notifications-api.md`. Wrangler's earlier 7403 error did not
recur on the successful read/write path.

The D1 notification event processor is now implemented behind the unset
`NOTIFICATION_PROCESSOR_BACKEND=d1` selector and shares the Worker scheduled
entrypoint. Synthetic local D1 tests verify template rendering, immediate and
delayed in-app status, and no duplicate processing on a later poll. Staging has
no Cron trigger and the selector remains unset, so generation has not been
activated or deployed. One failed audit, reservation, and resource rate-limit
bucket from the documented 2026-09-25 synthetic protected-access canary remain
in the dedicated access-security tables; they contain only digests and counts,
not raw IP or password data, and were preserved.

## Stripe extension application D1 slice (2026-09-26 JST)

Added `0007_stripe_extension_application_staging.sql` and
`stripe-webhook-d1-application.ts`. A verified Checkout receipt must match a
private D1 intent, positive expected JPY amount, current owner/license/tier,
and transfer state. The single D1 batch extends the license, cancels pending
lottery entries, writes event/audit rows, and terminalizes the application,
receipt, and dispatch. Unpaid, expired, and asynchronously failed sessions do
not grant time; same-session and competing-receipt replays converge on one
effect. The Miniflare suite passes 7/7, including forced audit rollback.

The paired Worker Checkout endpoint and scheduled dispatcher are now
implemented locally. Checkout reads the active versioned price from Master D1,
checks Better Auth ownership and transfer state, persists the private request
intent before the Stripe request, and reuses the Session through a stable
idempotency key. The scheduled path applies extension receipts, retries
transient errors, and dead-letters subscription/invoice and other unsupported
events for review. The expanded D1 suites pass 30/30; checkout integration
passes 4/4 and client contract tests pass 5/5.

The frontend selector, API selector, webhook selector, dispatch selector, and
Cron remain off in staging. Migrations `0006` and `0007` were subsequently
applied to the isolated staging business D1; all six new tables read back
empty, as did `fanmarks`, `fanmark_licenses`, and `user_settings`. No real
Stripe API call, user data, production routing, R2 object, or DNS changed.
Subscription/invoice effects, operator reconciliation, and a sandbox staging
rehearsal remain open before any billing cutover.

## Transfer-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-transfer-smoke.mjs` against
the current workers.dev app. The synthetic owner issued a transfer code; a
second synthetic user applied, the owner rejected that request, and the same
code was reapplied and approved. `transfer_rejected` reached `processed` and
delivered one Japanese notification to the requester. The subsequent
`transfer_requested` and `transfer_approved` events each reached `processed`
and delivered exactly one Japanese notification to the owner/requester.

Cleanup deleted notification rows before their event rows, then removed the
synthetic transfer, fanmark, license, audit, user settings, Better Auth users,
accounts, and sessions. Independent readback returned zero for all those rows,
including notifications/events/audits; the MFA generation baseline was
unchanged. The active transfer lifecycle was tested only with synthetic
staging identities. No real user data, production resource, or domain/DNS
setting changed.

## WhoIs detail endpoint and R2 revalidation (2026-09-26 JST)

Added `/api/fanmarks/details` and selected it in the staging frontend with
`VITE_FANMARK_DETAILS_BACKEND=worker`. Anonymous D1 reads return only the
public overview; Better Auth session reads may include bounded ownership
history, account display names, and the caller's derived favorite, owner, and
lottery state. The DTO excludes user IDs, email addresses, and license IDs.
Unset selectors retain the existing Supabase path. The Worker and frontend
contract tests pass 3/3 and 4/4, typechecks and staging build pass, and the
full Worker package suite passes 84 tests.

Deployed staging version `44d56b91-dbcf-46ce-ac9a-900431b143f9`. Readback
confirmed the SPA and Better Auth health endpoints return 200, while an
absent whois short ID returns `{ "schemaVersion": 1, "result": null }`. The
extended registration smoke used a temporary Better Auth identity and fanmark
to verify anonymous redaction and authenticated one-row ownership/lottery
history. It removed the synthetic rows and read back zero business rows. A
separate R2 profile smoke uploaded, publicly read, and deleted a synthetic
image from both avatar and cover buckets; both objects returned 404 after
cleanup, and Auth/business synthetic row counts returned zero. No real user
data, production route, or domain/DNS state changed.

## Latest non-user configuration checkpoint (2026-09-26 JST)

The public registration maximum and availability-rule administration are now
connected on workers.dev staging. Staging contains exactly four explicitly
seeded availability rules (all disabled, `created_by=NULL`) and two
allowlisted public settings: `grace_period_days=1` and
`max_emoji_characters=5`. The rule editor uses the MFA-protected Worker API;
staging registration reads its configured maximum from business D1. These
changes do not establish billing/Stripe parity.

At that configuration checkpoint, the app version was `00ebddee-9f63-4840-abc8-f00dfe847ff5` at 100%.
The live admin CAS/TOTP canary and synthetic registration/lottery/details/R2
canary passed, including rejection of six emoji IDs, and removed synthetic
Auth, business, and object rows. The full Worker package suite passes 88/88,
registration D1 tests 10/10, migration-data tests 93/93, and frontend/Worker
typechecks, baseline checks, staging build, and Wrangler dry-run pass. Schema
conversion remains `deployable: false`; user/Auth
and Storage object imports, Stripe, remaining admin/event routes, production
traffic, and domain/DNS remain open.

## OGP Worker staging slice (2026-09-26 JST)

`workers/api/src/ogp.ts` serves crawler metadata for `/a/:shortId` and the
legacy `/:emojiPath` route from the shared public D1 access/profile projections,
plus bounded escaped SVG at `/api/ogp-image`. Emoji paths require exactly one
active spelling match and emit the canonical short-ID URL; ambiguous matches
receive generic metadata. Password-protected profile names are not read.
Browser navigation continues through Static Assets to the SPA. Crawler HTML
uses `no-store` and `Vary: user-agent`; staging adds `X-Robots-Tag: noindex,
nofollow`.

Deployed `fanmark-app-staging` version
`4988be1e-5f1b-4839-8f3f-511d0a4238f6` to the existing workers.dev origin.
Live checks passed for absent short-ID and emoji-path crawler fallbacks,
browser SPA navigation for an emoji path, SVG image generation, oversized-input
rejection, and existing Auth health. No D1 row or R2 object was written.
Synthetic published/protected profile rendering, duplicate rejection, escaping,
and browser-navigation fallback passed in the local D1 suite (13 tests); live
staging currently has no public fanmark row, so profile rendering is not claimed
as a remote canary. Full Worker suite, staging build, Worker/frontend
typechecks, lint, Wrangler dry-run, and `git diff --check` passed. Production
OGP, user data, and domain/DNS remain open.

## Snapshot sequence-state rehearsal (2026-09-26 JST)

Snapshot format 4 now includes `sequenceStates`. The exporter binds the sole
reviewed `public.fanmark_events_id_seq` to `public.fanmark_events.id`, records
the exact decimal `lastValue` and `isCalled`, and rejects unexpected sequence
definitions. The offline verifier checks the manifest against the catalog.
The local D1 importer seeds AUTOINCREMENT after row import, reads back
`sqlite_sequence` as exact decimal text, and records source/imported/prior/target
watermarks. Synthetic Miniflare tests confirm next IDs after both a called
sequence and an unused sequence. The combined migration-data suite passes
111/111 with the importer now included in CI's command. The source sequence is
not part of PostgreSQL MVCC, so a final real-data capture must freeze event
writers. No source event rows or live sequence value were read, no remote D1
was written, and schema conversion remains blocked with 18 gates.

## R2 and staging master readback (2026-09-26 JST)

After the user enabled R2, read-only Wrangler checks confirmed the authenticated
Cloudflare account and both staging buckets, `fanmark-avatars-staging` and
`fanmark-cover-images-staging`. The staging app config already binds both and
selects `STORAGE_BACKEND=r2`; prior synthetic staging uploads/readbacks/deletes
covered both buckets. This confirms staging readiness only: no existing
Supabase Storage objects were copied.

Read-only aggregate queries against `fanmark-emoji-master-staging` returned
3,944 canonical emoji rows, one active-release pointer, three import journal
rows, and 7,888 release-staging rows. Reference master has two releases and one
active pointer; its staged language/tier/extension-price/reserved-pattern row
counts are 8/8/16/10. These counts do not inspect Auth or user rows. No remote
write was made.

The fresh linked public catalog remains 40 tables and 406 columns. Its local
synthetic D1 rehearsal now completes three synthetic source rows through all
40 table checkpoints, an injected acknowledgement-unknown stop, resume, typed
readback, foreign-key check, and a tampered-coverage rejection. The final state
is `public_rows_reconciled`; `deployable` and `fullMigrationReconciled` remain
false. Miniflare D1 rejects the extra `PRAGMA integrity_check` diagnostic with
`SQLITE_AUTH`, so the rehearsal relies on the importer's full per-table/hash
readback and the supported foreign-key check. No real source rows or remote D1
were used.

At the 2026-09-26 check, the workers.dev deployment was version
`7a2a780d-3fed-476b-a84e-905fc6d29aad` at 100%. At that checkpoint,
read-only migration checks showed no pending migrations on business, Auth, or
master D1. The local staging build's HTML-referenced JavaScript and CSS matched
the deployed assets byte-for-byte. Anonymous session/profile/admin guards,
public lifecycle settings, emoji catalog, and missing R2-object responses
returned the expected status codes.

Live synthetic registration rehearsal passed on that staging app: tier-4
registration, five-emoji limit, duplicate/anonymous denial, lottery apply,
duplicate/cancel, anonymous and authenticated detail redaction, owner-checked
cover upload/read/save/delete, and zero-row cleanup in business/Auth with the
R2 object returning 404. The transfer rehearsal issued, rejected, reapplied,
and approved a transfer; Cron processed three events and delivered three
localized notifications. Its synthetic business/Auth rows were removed and
the MFA generation baseline was unchanged. No real user data or DNS was
changed.

The normal migration-data suite passes 116/116, lifecycle schema suite 14/14,
and the expanded Worker package suite 148/148. Focused R2 API, emoji release,
reference release, and reference API suites pass 5/5, 7/7, 5/5, and 6/6.
Frontend/Worker typechecks and Cloudflare staging build pass. Dedicated D1 API
contract suites are now included in the standard Worker test command, using
their isolated Miniflare configurations.

Two more synthetic canaries passed on this deployment. The access-analytics
canary recorded one event, suppressed four concurrent duplicates, verified the
owner's aggregate and summary, rejected an anonymous read with 401, and cleaned
Auth/business rows back to zero. The bulk-return canary verified partial return
(207) while a transfer lock existed, then successful return (200) after removing
the synthetic lock. Audit and notification-event effects were present exactly
once per license; cleanup returned user/business rows to zero, retained only
the two expected synthetic incarnation tombstones, and left MFA generation
unchanged. Its cleanup check now uses the shared staging-baseline exclusion so
the four seeded availability rules are not miscounted as test residue. No real
user data, production route, external email, R2 object, or DNS state changed.

## Stripe invoice projection checkpoint (2026-09-26 JST)

The current worktree adds a D1 port of the existing Basil non-granting invoice
projection, plus additive business migration `0008`. It re-fetches the source
invoice and current subscription/latest invoice under a per-customer generation
fence, requires the exact D1 customer and subscription mapping, and never
matches by email. The atomic D1 batch updates only the existing subscription's
payment-failure fields and terminalizes its private application ledger, fence,
receipt, and dispatch. Plan type, license rights, notifications, and Stripe
objects are not changed. Dynamic lease checks happen after provider retrieval;
the Stripe client uses 10-second request timeouts and disables SDK retries.

Nine Miniflare tests cover failure/action-required/paid state, stale event
ordering both ways, missing mapping, concurrent and expired fences, rollback
then retry, scheduled processing, a provider call that outlives the receipt
lease, and the disabled-by-default scheduled path. The complete Stripe
ingress/application/projection suite passes 39/39; Worker typecheck and
Wrangler dry-run pass. Migration `0008` is applied to the empty APAC
`fanmark-business-staging` database. Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` is deployed at 100% to workers.dev
staging. Stripe API/signing secrets and all Stripe selectors remain unset;
subscription entitlement reconciliation, free-plan returns, production
billing, and Stripe operational rehearsal remain open.

## Extension coupon D1 staging slice (2026-09-26 JST)

Business migration `0015_extension_coupon_application.sql` is applied to
`fanmark-business-staging`; Wrangler reports no pending migrations. Readback
confirmed the command table, guard/apply triggers, unique usage index, and
lottery-entry index. At this checkpoint, coupon, usage, and command tables were
all empty.

The staging app uses Better Auth for the owner redemption API and the
admin-role/MFA-protected coupon CRUD and usage API. Worker version
`09cb56d8-e0c2-4a4e-af40-d6506922e9a6` is active at 100% on workers.dev.
Read-only smoke checks returned 200 for `/` and `/api/auth/ok`, and 401 for
anonymous redemption and anonymous coupon administration. Production/default
selectors stay on Supabase; this deployment imported no user, license, coupon,
or usage rows and did not change production or domain/DNS.

Focused D1 application tests pass 7/7, coupon-admin tests 4/4, frontend
contracts 10/10, and the complete Worker `npm test` command passes after the
final concurrency retry change. Root and Worker typechecks, CI isolation,
staging build, deploy dry-run, and `git diff --check` pass. This is API/schema
staging acceptance with synthetic local fixtures, not successful redemption
against imported data. Continue #34's remaining app/API inventory and #37's
synthetic integrated rehearsal. Keep real user-data migration and public
domain/DNS as the final operational phase.

## 2026-09-26 checkpoint: Admin user directory read path

PR #41 now contains local MFA-gated D1 list/detail APIs for the admin user
directory, a same-origin frontend adapter, and a Cloudflare-staging read-only
screen mode. Synthetic split-D1 tests cover profile/email filtering, session
last-sign-in projection, license counts, enterprise settings, recent fanmarks,
factor presence, audit metadata redaction, rejected MFA, and invalid requests.
Frontend contract tests verify cookie credentials, no-store behavior,
same-origin enforcement, and malformed-response rejection. Both typechecks and
the dedicated suites pass.

Deployed `fanmark-app-staging` version
`54c932cf-9589-4dc6-9409-7651ba0648a5` to
`https://fanmark-app-staging.fanmark-id.workers.dev`. Read-only probes returned
200 for `/` and `/api/auth/ok`; anonymous `POST /api/admin/users` returned 401
with `no-store`. The full Worker test command, Worker typecheck, frontend/root
checks, staging build, and Wrangler deploy passed. No authenticated admin
session or user-row mutation was used, and this deployment did not change
production or domain/DNS.

An authenticated synthetic staging TOTP canary has since passed the D1
user-list/detail, plan-mutation, suspension/restoration, and immediate-license-
expiry routes, including anonymous denial, session revocation, exact D1
readback, lifecycle/audit/notification effects, repeat safety, and cleanup.
These API paths are covered in
[`EXECUTION.md`](EXECUTION.md). Browser UI acceptance remains open. Password-
reset delivery remains closed until Resend is configured; no email was sent.
Production and imported-user acceptance remain open.

## 2026-09-26 local checkpoint: auth email template D1 path

The worktree now contains an MFA-gated D1 auth-template editor, a same-origin
frontend client, D1-backed Better Auth verification/reset copies, and a
16-row staging seed plus exact readback verifier. The local Worker tests pass
7/7 for auth email and 4/4 for the admin D1 API; the client tests pass 3/3 and
both typechecks pass. `magiclink` and `email_change` masters are editable, while
the currently wired Better Auth sender covers signup verification and recovery.

This slice is not deployed. Saved Wrangler credentials now return Cloudflare
authentication error 10000, and the browser OAuth session exposed only the
other Cloudflare account. Do not authorize that account for this migration.
After the user signs into the `bfc2890741f0b3fb236e2d755b6c9adc` account,
recheck D1 baseline, seed and compare the exact 16 master rows, then deploy the
staging Worker and SPA. No email or user data was sent or imported.

## Plan and general system settings staging (2026-09-27 JST)

The exact 18-key non-user configuration projection is present in staging
business D1 and matches the private Supabase export's pinned canonical digest.
The original two explicitly allowlisted settings remain, for an exact 20-row
manifest. The Worker public route and staging SPA use D1; the public API returns
exactly 17 public keys, omits the two private Enterprise keys, and anonymous
admin settings reads return 401. A synthetic Better Auth administrator passed
the same-session MFA admin read/update canary, stale-write rejection, exact
readback, restoration, audit minimization, and cleanup. The admin UI itself has
not been browser-driven. Auth user-owned rows read back empty and the
monotonic `mfaGeneration` singleton is retained at 60.

Version `3310b139-f639-4cf2-8a15-ad2b63f9fbd6` is active at 100% on
`fanmark-app-staging`. Live checks returned SPA 200, public API 200/no-store,
and anonymous admin API 401/no-store. Migration-data tests pass 124/124,
settings Worker tests 5/5, settings client tests 4/4, both typechecks and the
staging build pass. No production route, Stripe operation, real user/Auth row,
Storage object, or domain/DNS setting was changed. Authenticated admin
acceptance, Stripe/integrated coverage, production, real user-data import, and
domain cutover remain open. See `docs/migration/system-settings-api.md`.

## Auth email-template edit/restore on staging (2026-09-27 JST)

The explicit `--auth-email-template-edit-roundtrip` MFA smoke passed against
`fanmark-app-staging`. It authenticated a synthetic TOTP administrator, read
the 16 allowlisted auth templates, rejected an anonymous edit (401), changed
only the Japanese signup subject, rejected a stale write (409), and restored
the original subject/body/button through the same Worker API. A direct D1
readback confirmed every template's content and non-editable fields matched
baseline; only the edited row's `updated_at` advanced. The two canary audit rows
and synthetic auth identity/profile were removed and read back at zero. No
Resend API key or sender secret is configured, and this API path does not send
email; no message was sent.

The first run revealed that the new standalone action was missing from the
shared synthetic target cleanup condition. The exact `example.invalid` Auth
row/profile were removed by ID, all user-owned staging tables were read back
empty, and the cleanup guard was fixed before the successful rerun. Worker
email-template D1 tests pass 4/4, frontend client tests 3/3, script syntax and
`git diff --check` pass. This is staging-only API acceptance; browser UI review,
production, imported users, and domain/DNS cutover remain open.

## Waitlist admin list/reveal on staging (2026-09-27 JST)

Draft PR #41 adds the staging-selected Worker/D1 implementation of restricted
waitlist admin reads. A live synthetic canary passed sign-in, same-session
TOTP/MFA authorization, anonymous denial, email-hash-only listing, and explicit
email reveal with an `EMAIL_ACCESS` audit row whose metadata contains no
address. It ran against staging version
`676be6eb-f0fb-4741-8f84-4880fbb9052f`. The exact waitlist entry, temporary
admin profile, audit rows, and synthetic Auth identities were removed; direct
readback returned the waitlist, business profiles, audit canary rows, and all
user-owned Auth tables to zero. The monotonic MFA generation counter remains
retained and may have advanced.

The first live run exposed two gaps in the smoke harness cleanup: the list
access audit stores a null resource ID, and this standalone action had omitted
the common synthetic target user's cleanup branch. Exact synthetic rows were
removed after ID/marker verification, both cleanup conditions were fixed, and
the repeat canary exited successfully with empty-table readback. Waitlist D1
route tests pass 6/6 and frontend API client tests pass 5/5; CI run
`36270707064` passed both Worker and staging-app validation jobs. No real
waitlist data was imported; at that checkpoint, public submission still used
Supabase. No production route or domain/DNS was changed. See
`docs/migration/waitlist-admin-api.md`.

## Public waitlist signup on staging (2026-09-27 JST)

The staging frontend now selects `POST /api/waitlist` through
`VITE_WAITLIST_SIGNUP_BACKEND=worker`; the Worker requires its explicit D1
selector, split business D1, and a 120-per-60-second Rate Limiting binding.
The route normalizes email casing/whitespace, accepts duplicates with the same
generic 202 result, and rejects an untrusted Origin. A synthetic
`example.invalid` canary verified OPTIONS 204, invalid-Origin 403, first and
duplicate POST 202, exact normalized D1 storage, and deletion of only its own
marked row. Remote readback returned zero waitlist rows after cleanup. The
initial smoke harness invocation failed during Wrangler preflight before a
request; D1 remained empty. The harness now calls the lockfile-installed
Wrangler CLI and the repeated staging canary passed.

Worker `fanmark-app-staging` version
`9c54ceda-b840-482b-bc43-4c22e9c18923` is deployed at 100%. The workers.dev
root returned 200/noindex and its JavaScript asset SHA-256
`bf8ec6a3534ca8f83f6f43a0fbef12bc66dfc22e83e68c4a26a95d5e80aff953` matched
local `dist-staging`. The complete Worker CI job, staging-app CI job, Worker
typecheck, frontend typecheck, migration-data tests (139 assertions), targeted
lint, standard production build, and staging build passed; CI run
`36272821613` passed both required jobs. The regular app build still defaults
to Supabase; no real waitlist entries, production route, email, or domain/DNS
were used. Rate Limiting is only a coarse staging guard; its IP key may group
users behind shared networks and its counters are per Cloudflare location.
See `docs/migration/waitlist-signup-api.md`.

## Broadcast email D1 draft-only slice (2026-09-27 JST)

The local branch now includes MFA/admin-plan guarded Worker endpoints for
listing broadcast drafts and active broadcast templates, estimating recipients
from business D1, and creating a draft with a server-derived creator ID and an
atomic minimized audit row. The Cloudflare staging frontend selector is set to
Worker in the build config. Standard/default builds still use Supabase. Both
bulk delivery and test delivery are disabled in Worker mode; there is no Worker
send route or Supabase fallback from that mode.

The isolated Worker API tests pass 6/6 and the full Worker chain completed with
exit 0. The latest root migration-data suite passes 147/147 tests.
Frontend API contract tests pass 4/4, frontend and Worker typechecks pass,
staging build passes, selector coverage passes, and targeted ESLint plus
`git diff --check` pass. The live Supabase template rows were subsequently
queried in a read-only transaction and exactly seeded/read back in business
staging; see the current checkpoint above. An authenticated browser canary
remains open.

This draft-only API slice made no email, user-data, production-routing, remote
D1, R2-object, or domain/DNS change. A later staging Worker deployment and PR
update are recorded in the current checkpoint above; they still did not perform
a D1 migration, user-data import, or R2 object import. The unrelated
`supabase/.temp/cli-latest` change remains unstaged.

The Cloudflare staging build now explicitly disables the legacy
`AdminDataReset` control with `VITE_ADMIN_DATA_RESET_BACKEND=disabled`. That
screen would otherwise invoke the Supabase function that deletes fanmarks,
licenses, configs, profiles, and favorites; the standard build still defaults
to its existing Supabase behavior. The staging mode contract test, frontend
typecheck, staging build, Wrangler dry-run, and targeted lint pass. This keeps
the staging admin page from crossing into the live Supabase data plane while
user-data migration is deferred.

## Broadcast email fixed-recipient test-send implementation (2026-09-27 JST)

The Worker now has a separately gated test-send route for broadcast drafts.
It requires the explicit `BROADCAST_TEST_SEND_BACKEND=resend` selector, a
server-configured fixed recipient, Resend credentials, Better Auth
administrator MFA, and the business-D1 admin plan. It accepts only draft IDs,
language, and a UUID request ID; it never accepts a recipient address from the
browser. Subject and body text are HTML-escaped, and the minimized audit record
omits the recipient. Bulk delivery remains disabled, and the frontend
test-send selector defaults off. The open dialog preserves its idempotency key
for a retry after an uncertain provider response.

The Resend adapter was exercised only with injected fetch/provider mocks. The
Worker and SPA were deployed to `fanmark-app-staging`, version
`0ef26792-edb2-4d66-9b94-7a208d4d7f4a`, with the test-send selectors off; the
fixed recipient and Resend key/from are unset, and no email was sent. Read-only
smoke returned SPA 200/noindex, Better Auth health 200/no-store, and 401/no-store
for unauthenticated broadcast listing and test-send POST.

An authenticated staging canary then provisioned a synthetic Better Auth
administrator, completed sign-in and same-session TOTP/MFA, read the 12 active
broadcast templates, checked a future-date recipient estimate of zero, and
created/read back one marked draft. Test-send returned 503 with the provider
selector absent; the bulk-send route returned 404. The canary removed its
synthetic Auth identity, target/profile, draft, and audit rows; direct final
readback returned all Auth user-owned tables and business `user_settings`,
`broadcast_emails`, and `audit_logs` to zero. The first harness attempt stopped
at an incorrect empty-profile precondition; its exact synthetic target rows
were cleaned by ID, the target-profile baseline and cleanup guard were fixed,
and the repeated canary passed. No email was sent. Authenticated browser UI
review remains open. Production routes, R2 objects, and domain/DNS were not
changed. The unrelated `supabase/.temp/cli-latest` modification remains outside
the commit.

Validation on this worktree: broadcast Worker tests 10/10; the complete Worker
test chain exited 0; frontend broadcast API tests 5/5; frontend and Worker
typechecks, targeted ESLint, Cloudflare staging build, app-staging Wrangler
dry-run, and `git diff --check` passed. The staging build does not set the
test-send frontend selector, and the deployed Worker config omits the
test-send selector. Wrangler's staging secret list contains no Resend API key.

## Local cutover write-freeze guard (2026-09-27 JST)

The Worker now has a separate `CUTOVER_WRITE_FREEZE` guard for the synthetic
writer-handoff rehearsal. Staging defaults it to `false`. When enabled, the
guard blocks mutating API requests before route dispatch and pauses all Worker
scheduled jobs; unknown non-empty selector values fail closed. It permits only
the explicitly listed administrator email sign-in/session/TOTP/logout routes
and Stripe webhook receipt intake. Unlisted Better Auth routes, including GET
OAuth callbacks, remain blocked because those requests can create sessions.
The guard does not stop Supabase application writes or Supabase Cron; source
writers still need their separately authorized final-operation freeze.

Under Node 22.6.0, the focused Worker suite passed 15/15 tests, Worker
TypeScript checking and app-staging Wrangler `--dry-run` passed, and
`git diff --check` passed. This was the initial local-only checkpoint; the
subsequent staging deployment and rehearsal are recorded below. It does not
close the full staging recovery rehearsal or any live cutover gate.

## Staging write-freeze and receipt rehearsal (2026-09-27 JST)

PR #41 commits `8f7a490` and `2175c82` add the fail-closed, default-off Worker
freeze guard. Both migration CI jobs passed on run `36292579695`. The ordinary
staging deployment is version `31d7d859-6ad7-42e7-9e9b-61f7d7792f2c`, with
`CUTOVER_WRITE_FREEZE=false`. Anonymous post-deploy reads returned 200 for the
SPA root, Better Auth health, and emoji catalog; the deployed JavaScript bundle
SHA-256 matched the local staging build exactly.

A short synthetic rehearsal temporarily deployed version
`1ee62b78-6614-4a25-93b3-ef9d3f443844` with the freeze enabled and only the D1
Stripe receipt selector enabled. A mutation request was rejected before route
validation with 503 `cutover_write_freeze`; the login preflight returned 204.
A locally signed, synthetic `customer.updated` event was durably accepted with
HTTP 200. Replaying it returned `duplicate_nonterminal`; remote business-D1
readback found one receipt and one pending dispatch with delivery count 2.
There was no Stripe API key, external Stripe call, or email-send selector.

The exact synthetic receipt and dispatch were deleted by event ID and their
final remote counts are both zero. The one-off `STRIPE_WEBHOOK_SECRET` was
deleted and the Worker was restored to version
`21f0be9e-2099-49d8-b975-a3a61604c12e`: freeze is `false`, the Stripe webhook
selector is absent, and only the three pre-existing Better Auth/reference/
verified-access secrets remain. Post-restore reads returned 200 for the SPA
and Auth health; an invalid empty waitlist request returned its ordinary 400,
and the disabled Stripe endpoint returned 404. All three staging D1
configurations still report no migrations to apply.

The scheduled-handler unit test verifies that freeze skips scheduled work. The
Cron pause log was not captured during this initial rehearsal; the live Cron
pause was verified in a follow-up staging observation below. The pause
deployment did not change the Cron schedules, production routes, user rows,
email, or domain/DNS.

The latest read-only source catalog refresh completed at
`2026-09-27T09:40:27Z` and read catalog metadata only: 40 tables, 406 columns,
144 constraints, and 139 indexes. After unwrapping the Supabase CLI's
`rows[0].jsonb_build_object` envelope and supplying the value-free credential
descriptor, the mode-0600 conversion report still has 18 gate groups and
`deployable=false`: 10 row-conversion groups (227 locations) and 8
schema/operation groups (101 locations). The row groups cover arrays, bigint,
credential transformation, dates, exact decimals, JSON, money cents, sequence
state, timestamp precision, and UUID validation. The schema/operation groups
cover external Auth references, timestamp defaults, the four untranslated
catalog scopes (functions, RLS policies, triggers, and views), three CHECK
translations, and four unsupported index methods. The source-shaped synthetic
D1 import/restart rehearsal passed with four generated rows, all 40 table
checkpoints completed, public rows reconciled, and conflicting replay rejected;
`deployable` and `fullMigrationReconciled` correctly remain false. The private
catalog, generated DDL, and report remain outside Git with mode `0600`. This
does not materially change the coarse weighted estimate of about 60% for the
full migration and 70–75% for the prioritized app/infrastructure/master-data
stage; the complete old-writer freeze and both recovery drills remain open.

The earlier macOS Keychain error is no longer the current blocker: fresh
`wrangler whoami` succeeds for `fanmark.id@gmail.com` and the intended account,
with credentials retained in the encrypted/keyring-backed store.

## Stripe migration validation checkpoint (2026-09-27 JST)

The isolated `experiments/stripe-receipts` suite now passes 90/90 on Node
22.6.0, with its TypeScript contract check and the workflow-isolation check
passing. The Cloudflare migration validation workflow now runs that suite and
typecheck. The suite test files run serially to avoid the hosted-runner stall;
commit `2348670` passed both migration CI jobs in run `36311897378`. A stale
bigint assertion was aligned with the exact decimal-text import codec; the
JavaScript read-precision gate remains open. A transfer-lock test now uses a
future fixture date. Issue #32 remains open: the current
Supabase Webhook still handles subscription and invoice events outside the full
durable reconciliation path. No Stripe API call, Supabase migration, staging
write, real user data, production routing, or domain/DNS change was made.

## Manual lifecycle API staging acceptance (2026-09-27 JST)

PR #41 now contains the separate manual lifecycle selector, its staging
zero-candidate canary, and the edge empty-body fix through commit `713cccc`.
Workers.dev staging version `4988d9d0-b4ec-44d1-9ccc-00ac501aac36` selects
`LIFECYCLE_RUN_BACKEND=d1` with the explicit staging target, schema digest, and
four-page bound. `LICENSE_EXPIRY_BACKEND` remains unset; both Cron schedules
remain configured, and scheduled lifecycle execution stays disabled.

The authenticated synthetic TOTP/admin canary returned HTTP 200 with
aggregate-only zero candidates in both lifecycle phases. It read back exactly
one completed zero-count run journal per phase with the expected target and
schema digest, then removed both. Independent APAC-primary D1 readbacks found
zero profiles, fanmarks, licenses, lifecycle journals/items/effect guards, and
all seven user-owned Auth tables; both readbacks reported `changed_db=false`
and `rows_written=0`. The temporary synthetic administrator was removed. The
MFA generation counter is retained and may have advanced as intended. The first
staging call returned 400 because the runtime surfaced an empty POST as a
zero-byte stream; the handler now accepts only an EOF zero-byte stream within
one second and retains rejection for any payload.

The manual API proof does not materially change the coarse weighted estimate
of about 60% of the full migration and about 75% of the prioritized
app/infrastructure/master-data stage. User/Auth/object import and domain/DNS
cutover remain deferred. Latest migration-data boundaries pass 160/160. In CI
run `36314570636`, both the Worker API and staging application jobs passed,
including Worker API/D1 tests, Worker typecheck/bundle dry-run, migration data
boundaries, Stripe receipt/billing tests, app typecheck, and staging build.
Local lifecycle API tests pass 5/5 with Worker typecheck and staging dry-run.
No real user data, production route, email, or domain/DNS state was changed.

## Workers Free CPU fit measurement (2026-09-27 UTC)

Using `wrangler tail` without changing deployment configuration, staging
version `4988d9d0-b4ec-44d1-9ccc-00ac501aac36` reported CPU time for requests
to `fanmark-app-staging`. Read-only public requests measured 2 ms for
`GET /api/auth/ok`, 2 ms for `GET /api/fanmarks/recent?limit=1`, and 5–11 ms
across five `GET /api/emoji/catalog` requests (all HTTP 200). An unauthenticated
`GET /api/me/subscription` returned 401 at 0 ms.

The synthetic admin/TOTP/lifecycle canary passed and cleaned its synthetic
Auth, profile, audit, and business rows. Tail samples included 164 ms for
first-time `POST /api/auth/two-factor/enable`, 30 ms for
`POST /api/auth/two-factor/verify-totp`, 29 ms for the empty manual lifecycle
run, and 8–47 ms for successful admin user/status/plan operations. These were
HTTP-successful staging requests; a successful occasional overage does not
prove the Free plan will tolerate recurring production traffic. Cloudflare's
current published Free limit is 10 ms/request and documents only occasional
over-limit flexibility. The plan was not changed. Production CPU fit remains a
release gate: reduce consistently expensive paths and repeat the sample, or
have the account owner enable a suitable Workers plan before production
acceptance. No billing, production, user-data, email, or domain/DNS change was
made. Detailed evidence is in [`live-observations.md`](live-observations.md).


## Stripe test CI follow-up (2026-09-27 UTC)

The initial TSX/plain-JavaScript split passed all 90 tests locally and in an
Ubuntu Node 22.6 container, but GitHub Actions run `36320827030` remained in the
Stripe test step for more than four minutes and was canceled; the app job still
did not verify the change. The runner now launches each suite in its own Node
process, with a 180-second per-file timeout and TSX loaded only by the four
TypeScript-importing suites. Local Stripe tests, Stripe typecheck, app
typecheck, admin auth URL tests (3/3), and staging build pass. Fresh GitHub
Actions verification is pending.

## CI verification follow-up (2026-09-27 13:12 UTC)

Commit 14bebed passed GitHub Actions run 36321290841. Both the Cloudflare Worker
API job and the staging application job succeeded, including the per-file
Stripe test runner, migration-data boundaries, typechecks, and staging build.
The workflow performed no deployment.

## Broadcast email delivery design checkpoint (2026-09-27 JST)

Reviewed the remaining Supabase `send-broadcast-email` contract and the current
Worker draft/test-send API. The Cloudflare bulk-send architecture is now
recorded in [`broadcast-email-delivery-design.md`](broadcast-email-delivery-design.md):
an immutable Auth-user/language snapshot with no email-address copy into
Business D1, an MFA-authorized send command, a durable leased recipient queue,
stable per-recipient Resend idempotency, verified delivery events, and
aggregate-only admin responses. It preserves the existing service-notice
contract and keeps all bulk-send selectors off. Resend's documented 24-hour
idempotency window sets a hard boundary for automatic retries; an uncertain
send after that window requires operator reconciliation.

This is a design checkpoint only: no queue migration, send route, scheduler,
webhook, provider secret, recipient snapshot, or email was created or changed.
Implementation and synthetic crash/replay tests remain open. Queue-record
retention and production activation still require an operator policy. This
does not change the coarse weighted progress estimate of about 60% for the
full migration and 75% for the prioritized app/infrastructure/master-data
stage.

## Broadcast queue implementation checkpoint (2026-09-27 JST)

The local branch now adds Business D1 migration `0016_broadcast_email_delivery.sql`,
an MFA/admin-plan-gated idempotent `POST /api/admin/broadcast-emails/send`, and
a default-off minute-Cron snapshot processor. The API freezes the draft filter
and active language templates, queues a run without invoking Resend, and returns
aggregate status only. The snapshot processor reads Auth IDs (not email fields),
applies Business D1 filter/settings page by page, stores only user ID and
language, defaults missing unfiltered language settings to Japanese, and uses a
lease plus cursor compare-and-swap to resume. More than 10,000 matching
recipients fails closed. Permanent bounces and complaints create address-free
suppression rows; transient bounces do not. Integration tests apply the
migration to Miniflare and cover these boundaries. No migration was deployed,
no real Auth audience was queried, and no provider request was made.

Evidence in the local worktree: `npm run test:broadcast-email-delivery-d1`
(3/3), `npm run test:broadcast-email-admin-d1` (10/10), scheduler routing
(4/4), and Worker TypeScript typecheck pass. Remaining broadcast work is actual
Resend dispatch with bounded retries/idempotency, verified webhook ingestion,
end-to-end crash/replay tests, and UI activation. All bulk selectors remain
disabled; queue retention and uncertain-send operator policy remain open.

## Broadcast delivery implementation and UI checkpoint (2026-09-28 JST)

This checkpoint supersedes the earlier implementation checkpoint above. The
local migration worktree now includes the Resend dispatcher, signed webhook
handler, address-free Auth-ID queue, and a default-off bulk-send control in the
Cloudflare admin UI. The UI requires `VITE_BROADCAST_SEND_BACKEND=worker`; the
Worker independently requires the D1 selectors, split topology, and provider
configuration. The retry path retains one idempotency key and HMAC fingerprint
per recipient; changed Auth email or payload stops in `needs_review` instead of
retrying different content. Terminal completion audit and webhook deduplication
are idempotent.

Focused verification passes: broadcast delivery Miniflare integration 8/8,
admin API 10/10, scheduled routing 4/4, frontend broadcast API contract 6/6,
Worker typecheck, app typecheck, migration-data suite 161/161, Cloudflare
staging build, and Wrangler Worker dry-run. The complete Worker `npm test` chain
also passed after the final 8/8 delivery integration was added.
The tests include stable-payload retry, changed-email pause, lost acknowledgement
after committed page state, the 24-hour idempotency stop, lease exclusion,
signature/tamper/staleness rejection, event replay, permanent suppression, and
one-time completion audit.

Business staging D1 migration `0016_broadcast_email_delivery.sql` was applied
as a structure-only change. Readback found no pending migration, no foreign-key
errors, no email/address column in the recipient queue, and zero profile,
broadcast, delivery-run, recipient, suppression, or webhook-event rows. The
staging Worker was deployed to workers.dev as version
`4cf9657f-bee3-42bb-aa89-802e9ed0aa89`; its Resend and bulk/test-send selectors
remain disabled, and no provider secrets are configured. Anonymous smoke
returned 200 for `/` and `/api/auth/ok`, and 401 for the protected list/send
routes. No real Auth audience was read and no email was sent.

The authenticated synthetic staging canary then verified the deployed send
route: test-send and bulk-send both returned the expected selector-disabled
503s, and direct readback found zero profiles, drafts, delivery runs, recipients,
suppressions, webhook events, or broadcast audits after cleanup. The synthetic
Auth identity/session/TOTP rows were removed and all user-owned Auth tables
returned to empty; the monotonic MFA generation counter was preserved. No
recipient snapshot or provider request occurred.

Still open are authenticated browser review of the new send control, queue
retention and uncertain-send operator policy, full staging recovery/cutover
drills, Stripe business-effect/sandbox reconciliation, and the deferred real
user/Auth/object import and domain/DNS cutover.

## Staging write-freeze scheduled pause verification (2026-09-28 JST)

Deployed a brief workers.dev-only staging version
`68f3a92a-ebc7-4de6-a364-5e675f37b561` with `CUTOVER_WRITE_FREEZE=true` to close
the earlier missing Cron evidence. Read-only Auth health remained 200, an
administrator API POST returned 503 `cutover_write_freeze` before route
validation, and the sign-in OPTIONS preflight remained 204. `wrangler tail`
captured the `* * * * *` event and the log
`{"job":"scheduled-dispatch","status":"paused","reason":"cutover_write_freeze"}`.

Restored the ordinary config immediately in version
`e61343d4-fc5d-41d0-9630-c8394d882039`; it reports `CUTOVER_WRITE_FREEZE=false`.
Post-restore reads returned 200 for the SPA and Auth health, and 401 for the
unauthenticated admin route, proving the freeze response no longer applies.
Business staging still has zero profiles, broadcast drafts, delivery runs,
recipients, suppressions, or webhook events; only the three pre-existing
Better Auth/reference/verified-access secrets are present. No source freeze,
real user row, Stripe call, email, production route, or public domain/DNS was
changed.

## Frozen Stripe receipt continuity staging canary (2026-09-28 JST)

Added guarded script
[`staging-stripe-receipt-freeze-smoke.mjs`](../../scripts/migration/staging-stripe-receipt-freeze-smoke.mjs)
and ran it with its explicit staging-write, exact-account, exact-D1, and no-Stripe-API
flags. The script uses a random temporary signing secret and never configures a
Stripe API key or dispatcher. Temporary workers.dev version
`625895a0-931c-4c12-8f18-8ee54d063223` enabled only the D1 webhook receipt
selector while `CUTOVER_WRITE_FREEZE=true`.

A mutation request returned 503 `cutover_write_freeze`, sign-in OPTIONS returned
204, and the synthetic signed `customer.updated` webhook returned `accepted`.
Replaying the same bytes returned `duplicate_nonterminal`. Readback showed one
receipt (`delivery_count=2`, status `received`) and one pending dispatch. The
freeze kept scheduled dispatch paused, so the event had no billing effect and
made no Stripe API request. The full script sequence measured 29,130 ms; this
is not a cutover RTO because source writers were not stopped and no business
write authority changed.

Cleanup deleted the synthetic receipt/dispatch and temporary webhook secret,
then restored normal staging as Worker version
`4c23f796-fa12-419d-85fb-9a905a5f7ceb`. Independent readback found zero Stripe
receipts/dispatches, user profiles, broadcast runs, or recipients; the only
secrets are the three pre-existing Better Auth/reference/verified-access
secrets. `/`, Auth health, the disabled webhook, and an unauthenticated admin
mutation returned 200, 200, 404, and 401 respectively. Stripe sandbox business
effects, coordinated source-writer freeze, and both recovery drills remain
unverified.

## Broadcast delivery pause visibility (2026-09-28 JST)

The D1 admin list now projects only the fixed `needs_review` delivery state
from a broadcast's stored error marker. This change is deployed to staging
Worker version `30ce0b27-fb72-4400-a8b6-6d86b46b5167`. The Cloudflare admin UI displays
“要確認・送信停止中” and explains that automatic retry has stopped. The API
does not return raw provider/error details; tests include a synthetic
address-like value and provider body and assert that both remain hidden. The
focused admin API tests pass 11/11, delivery integration tests pass 8/8, both
app/Worker typechecks and the Cloudflare staging build pass. Targeted ESLint
and `git diff --check` pass. Manual visual browser review could not run because
the host Mac was locked. The authenticated synthetic staging canary confirmed
bulk/test send return selector-disabled 503s, the paused delivery state is
visible without raw details, and all synthetic Auth/business rows are removed.
Independent APAC-primary D1 readbacks found zero profiles, drafts, delivery
runs, recipients, suppressions, webhook events, Auth users, accounts, sessions,
TOTP factors, roles, and MFA assurances. The SPA and Auth health returned 200;
the static staging bundle contains the pause warning. No Resend secret or email
was used. Provider-backed delivery, queue retention/reconciliation policy, and
production acceptance remain open.

## Schema converter v5 query-contract review (2026-09-28 JST)

The reviewed Supabase schema-only query completed against the linked project;
the catalog timestamp is `2026-09-27T16:02:02Z`. It returned the same 40 tables,
406 columns, 144 constraints, 139 indexes, 15 enum labels, one view, 58
functions, 36 non-internal triggers, and 77 RLS policies. No application rows
were read. The CLI envelope was unwrapped into mode-0600 files outside Git.

The fresh schema-converter-v5 report now has 17 unresolved gate groups: 10
row-conversion groups and 7 schema/operation groups. It records the four exact
live GIN definitions as `omitted_after_query_contract_review`. The source and
Worker query audit found no array containment/overlap or full-text query; exact
normalized-ID equality is covered by a D1 UNIQUE constraint, and emoji admin
search remains substring matching. An unknown or changed GIN definition is
still blocked. The report remains `deployable: false`; this conversion run did
not receive the private credential descriptor and still requires the explicit
descriptor before the dedicated password transform can proceed.

The focused schema-converter suite passes 12/12 under Node 22.6.0. Converter
v5 did not modify the existing staging D1 schema or data. No Supabase
application rows, real user data, production routes, provider, or domain/DNS
were changed. Full schema/operation gates and synthetic cutover recovery drills
remain open.

A follow-up attempt to complete the pending authenticated browser review used
the Computer Use path. macOS reports Accessibility and Screenshots permissions
as granted, but Orca still returns `permission_denied` when reading the Codex
window's accessibility tree. No browser content or staging UI was changed by
that attempt; the visual review remains open.

## Schema converter v6 and recent-list parity (2026-09-28 JST)

The current read-only schema catalog was refreshed at `2026-09-27T16:14:11Z`;
it retains the same 40 tables, 406 columns, 144 constraints, 139 indexes, 15
enum labels, one view, 58 functions, 36 triggers, and 77 RLS policies. No
application rows were read. Converter v6 fingerprints the single
`recent_active_fanmarks` definition and records its replacement by the tested
D1 recent-list query. Changed, malformed, or additional views stay gated. The
fresh private report has 16 gate groups (10 row-conversion and 6
schema/operation), 96 schema/operation locations, and `deployable: false`.
The credential descriptor remains intentionally absent from this run.

The Supabase RPC and D1 Worker now share the source-supported 1..50 recent-list
limit; the landing-page UI continues to request 20. Converter tests passed
13/13, migration-data 163/163, recent Worker API tests 15/15, D1 repository
tests 6/6, the full Worker `npm test` chain, both typechecks, CI
workflow-isolation check, staging build, Worker deploy dry-run, and
`git diff --check` passed on Node 22.6.0. The private catalog, SQL, and report
are mode 0600 outside Git. No live application rows, remote D1, production
state, or domain/DNS were changed. The prior coarse estimate remains about 60% for the
full migration and 75% for the prioritized scope; this narrow gate closure
does not materially change it.

## Current staging Worker rollout (2026-09-28 JST)

The tested branch is deployed to the isolated `fanmark-app-staging` Worker as
version `708ff90b-abec-405d-9dd0-6a0d14cafe3c`. The exact staging config keeps
split business/Auth/master D1 bindings, R2 buckets, noindex, and the workers.dev
hostname. Wrangler reported no migrations pending. The SPA and Better Auth
health routes returned 200; `GET /api/fanmarks/recent?limit=50` returned 200
with zero items; an anonymous broadcast-admin read returned 401; the disabled
Stripe webhook returned 404.

The delivery migration's four remote tables exist and all have zero rows. The
staging secret-name inventory has no Resend or Stripe credentials, and the
broadcast send selector remains unset. The staging deployment therefore adds
the tested code without enabling email or billing effects. No real user data,
production route, D1 row, R2 object, or domain/DNS setting was read or changed.
GitHub Actions run `36333924986` for the docs follow-up passed both Cloudflare
staging-app and Worker API jobs; Supabase Preview was skipped by the isolation
rule. The same Worker and migration suites passed locally before deployment.

## Isolated D1 post-ack Time Travel drill (2026-09-28 JST)

Created disposable APAC D1 `fanmark-recovery-drill-20260928-1`
(`56bdf369-3c44-4361-a943-051b6430a0d1`) with no Worker binding. It contained
only synthetic rows for one acknowledged business effect and its applied
Stripe receipt/completed dispatch. After recording the post-ack bookmark, added
three later synthetic rows and restored the earlier bookmark. Readback found
exactly the acknowledged effect and ledgers with the original SHA-256; the
later rows were gone, and explicit queries found zero orphan dispatches or
missing receipts. The restore was confined to this disposable database.

Wrangler's remote SQL API rejected `PRAGMA foreign_key_check` and
`PRAGMA integrity_check` with `SQLITE_AUTH`; no full remote integrity check is
claimed. A precise elapsed-time measurement was not captured. The temporary
database was deleted after readback, and a new D1 inventory showed only the
three pre-existing staging databases. No existing staging database, Worker,
Supabase resource, real user data, R2 object, provider, production route, or
domain/DNS setting was changed. This proves the D1 restore primitive only; the
pre-write path and end-to-end application recovery/ledger reconciliation in
issue #37 remain open. Cloudflare documents D1 Time Travel restore as an
in-place overwrite of the target database: https://developers.cloudflare.com/d1/reference/time-travel/.

## Schema converter v7: source-locale regex proof (2026-09-28 JST)

The read-only `schema-readiness.sql` catalog now records a locale-bound probe
for the exact invitation-code, settings-key, and waitlist-email CHECKs. The
linked Supabase refresh observed 40 tables / 406 columns and
`en_US.UTF-8`; the probe tested all 1,112,063 valid Unicode scalar values with
zero matches outside each expected ASCII class. It read no application rows.
Converter v7 embeds that proof in its private report and emits equivalent D1
CHECKs only when the proof matches the catalog locale. Its email expression
also rejects non-letter characters after the final TLD dot, closing a synthetic
false-positive in the prior GLOB expression. A read-only PostgreSQL sample
matched the SQLite cases for valid addresses, dotted subdomains, invalid TLD
characters, and trailing newlines.

The fresh private report now has 15 unresolved gate groups (10 row-conversion,
5 schema/operation) across 320 locations; `deployable` remains `false`.
Converter tests pass 13/13, snapshot-export tests 19/19, and
`npm run test:migration-data` passes 163/163 on Node 22.6.0. The generated
40-table DDL loads in local SQLite with 66 indexes, no foreign-key violations,
and `integrity_check=ok`. The catalog, SQL, and report are mode `0600` outside
Git. The proof and DDL were not applied to any remote D1; real user data,
production routes, and domain/DNS remain untouched. The prior GitHub Actions
run `36338168509` passed both Cloudflare staging-app and Worker API jobs on
commit `43b318d`; Supabase Preview was skipped by design.

## Schema converter v8: UUID import validation (2026-09-28 JST)

Snapshot verification and the D1 importer both use the catalog-bound row
converter for UUID columns. It now requires exact-width UUID text, canonicalizes
valid uppercase values to lowercase, and rejects malformed input (including a
trailing newline) before a D1 binding is produced. A local D1 test confirms an
import ledger created with an older row-codec version cannot resume under the
updated contract. The schema-conversion version is now 8 and the import codec
version is 3.

Regenerating from the current private 2026-09-28 schema-only catalog produces
14 unresolved groups (9 row-conversion and 5 schema/operation) across 227
locations; `deployable` remains `false`. The 40-table generated SQL is byte-for-
byte identical to v7, so this change affects only validation/readiness metadata
and import fencing. The catalog/report/SQL remain mode `0600` outside Git, and
the DDL was not applied to remote D1. No source application rows were read;
real user-data import and domain/DNS cutover remain deferred.

Focused Node 22.6.0 tests pass: value/row/schema-converter 26/26 and local D1
importer 18/18. The complete `npm run test:migration-data` suite passes 166/166
on Node 22.6.0. GitHub Actions run `36344541475` on commit `6a78e02` passed both
required Cloudflare Worker API and staging-application jobs; Supabase Preview
was skipped by the workflow-isolation design.

## Repeat staging authentication and lifecycle canary (2026-09-28 JST)

Read-only `wrangler deployments list` showed `fanmark-app-staging` version
`708ff90b-abec-405d-9dd0-6a0d14cafe3c` at 100%. The pinned staging smoke
verified that the Auth-owned tables were empty before provisioning synthetic
identities. It then passed email/password sign-in, first-time TOTP enrollment,
TOTP verification with session rotation, same-session administrator
authorization, and the MFA-protected manual lifecycle endpoint with zero
candidates. Cron expiry remained disabled. Cleanup removed the synthetic Auth,
business profile, audit, and lifecycle rows; the smoke's final Auth readback
found every user-owned table empty. The monotonic MFA generation counter was
preserved and may have advanced.

The attempt to collect per-request CPU via `wrangler tail` returned no
invocation records, so this run provides no CPU measurement and does not close
the Workers plan-fit gate. This was staging-only synthetic activity: no
Supabase or production resource, real user data, email, Stripe operation,
R2 object, production route, or domain/DNS setting was changed.

## Staging auth/lifecycle CPU follow-up and PR validation (2026-09-28 JST)

Repeated the same guarded staging TOTP/admin/lifecycle canary while a ready
`wrangler tail` stream captured only request path, status, and per-invocation
CPU/wall time. On Worker version
`708ff90b-abec-405d-9dd0-6a0d14cafe3c`, `/` used 1 ms CPU (200) and
`/api/auth/ok` used 2 ms (200). Synthetic email/password sign-in used 128 ms
(200), the first-time TOTP gate used 45 ms (403), TOTP enrollment used 88 ms
(200), TOTP verification used 17 ms (200), authenticated admin assurance
used 4 ms (200), and the MFA-protected empty lifecycle run used 32 ms (200).
Session reads measured 4 and 29 ms in separate requests. These are individual
staging samples, not a load test or production guarantee. Cloudflare's
[current Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
list 10 ms per HTTP request on Free and 30 seconds by default on Paid (up to
5 minutes); infrequent Free overages may succeed, while consistent over-limit
work can be terminated. No plan or billing change was made, so CPU-plan fit
remains an explicit release gate.

The repeat canary passed sign-in, first-time TOTP, session rotation,
same-session admin authorization, and the manual lifecycle endpoint. Cron
expiry stayed disabled; cleanup and independent readback found every
user-owned Auth table empty. The monotonic MFA generation counter may have
advanced. Only synthetic staging identity/state was used.

PR #41 commit `457ecca` passed GitHub Actions run `36339923139`: both the
staging-application and Worker API jobs succeeded. The app job includes the
full migration-data, Stripe receipt/billing, typecheck, admin URL, and staging
build checks. The PGlite snapshot export test now runs before the other
database-heavy Stripe suites; the CI run verifies the reordered full suite.

## Current-schema v8 synthetic import replay (2026-09-28 JST)

The linked Supabase `schema-readiness.sql` query completed at
`2026-09-27T19:52:51Z` without a terminal prompt and read catalogs only. The
40-table/406-column source shape, 144 constraints, 139 indexes, 58 functions,
36 non-internal triggers, and 77 RLS policies remain present. Under Node
22.6.0, the refreshed catalog passed the source-shaped D1 rehearsal after
converter v8: 10 synthetic rows traversed all 40 table checkpoints; 2 active
credentials were transformed, 1 inactive credential was explicitly deferred,
the injected acknowledgement-unknown restart converged, and tampered coverage
was rejected. Status is `public_rows_reconciled`; `deployable` and
`fullMigrationReconciled` remain false. This closes a fresh-schema replay check
only; it does not import source application rows or close the remaining
schema/operation gates.

The catalog lived in a mode-0600 temporary file outside Git and was removed
after the local Miniflare rehearsal. No remote D1/R2, production route, or
domain/DNS setting was changed.

## Authenticated subscription projection canary (2026-09-28 JST)

Added `scripts/migration/staging-subscription-display-smoke.mjs` and ran it
against the workers.dev staging app with a synthetic Better Auth user and two
synthetic subscription rows. The anonymous request returned 401; the signed-in
owner first received `subscription: null`, then only the owner's active
projection. The response omitted Stripe customer/subscription/price IDs and
used `Cache-Control: no-store`. After a synthetic D1 update, a fresh GET
returned the updated period end and amount. Cleanup read back zero canary
subscription rows and zero canary Auth user/account/session/factor/role rows. A separate
aggregate read-only check then confirmed `user_subscriptions` and every checked
Auth user-owned table remained at zero; both D1 reads reported `changed_db=false`.

The canary made no Stripe API request and touched no real user data, production
resource, or domain/DNS setting. It verifies the authenticated API and its
read-after-update behavior; the rendered UI's 30-second foreground polling and
Stripe sandbox acceptance remain open.

## Integrated synthetic pre-write fallback rehearsal (2026-09-28 JST)

Added the explicitly guarded `npm run test:migration:staging-prewrite-resume`
to keep the workers.dev Worker frozen while a disposable loopback Supabase
project exercises the source-shaped recovery write. A non-writing invalid-body
probe waits until the frozen version is active; then a valid unique synthetic
waitlist request returns 503 and leaves no D1 marker. The isolated Supabase
flow passed synthetic password sign-in, UUID preservation, owner-scoped
`user_settings` update/readback, and cleanup. The first acknowledged
owner-scoped `user_settings` update took 30,472 ms after the frozen Cloudflare
rejection, including local Docker/Supabase startup; this is not a production
downtime/RTO measure.

The frozen staging webhook accepted and deduplicated one synthetic receipt,
leaving one pending dispatch and no Stripe API/business effect. Cleanup removed
the temporary marker, receipt/dispatch, secret, local containers/volumes/network,
and restored ordinary staging Worker version
`e54b22c6-b19d-4172-be71-445e2a29b52a`. Independent readback reported zero
waitlist, receipt, dispatch, profile, and Auth-owned rows; health and auth routes
returned 200, webhook 404, and anonymous admin 401. No linked Supabase writer,
real user data, production route, or domain/DNS was changed.

This verifies only the isolated pre-write fallback subgate. The coordinated
source-writer/Cron freeze, complete final-copy timing, applied Stripe business
effect, post-write application restore, recurring CPU-plan fit, and other issue
#37/#38 gates remain open.

## Rendered subscription foreground-poll canary (2026-09-28 JST)

The opt-in `npm run test:migration:staging-subscription-ui-poll` passed on the
isolated workers.dev staging app. It creates a random synthetic Better Auth
user, profile, owner subscription, and decoy subscription; authenticates a
temporary headless Chrome profile; opens `/profile`'s Plan section; and checks
the rendered active state. After only the synthetic owner row changed to
`canceled`, the page showed the localized inactive state after the next
foreground 30-second poll (29,440 ms).

Script cleanup verified zero synthetic subscription, profile, Auth user,
account, session, verification, factor, role, and assurance rows. No Stripe API
or email was called, and no real user data, production resource, or domain/DNS
setting changed. This proves one UI poll transition; it is not worst-case
latency/load evidence and does not close Stripe sandbox or the remaining #37
integration/recovery acceptance.

## Anonymous search-record canary (2026-09-28 JST)

The guarded `npm run test:migration:staging-fanmark-search-record` passed
against the exact workers.dev staging app and split D1 databases. Its
three-emoji synthetic request produced one discovery and one anonymous search
event; the exact rows were removed and reread as zero. The event autoincrement
sequence advanced and remains advanced. This is staging-path proof for new
anonymous search activity only. Historical searches and attribution remain in
the deferred user-data stage; issue #37 and integration acceptance stay open.

## Broadcast send-control browser review (2026-09-28 JST)

The guarded `npm run test:migration:staging-broadcast-email-ui` passed on the
deployed workers.dev staging app. A synthetic MFA administrator opened the
broadcast tab in a temporary headless Chrome profile; the exact synthetic draft
appeared, both test-send and send-start controls were visibly disabled, and the
Cloudflare-mode notice explained that state. No send control was clicked.
Selector-disabled API checks and the synthetic paused-delivery projection also
passed. Cleanup and independent readback confirmed zero synthetic Auth rows,
profiles, drafts, audits, delivery runs, or recipients. No email/provider call,
real user data, production route, or domain/DNS setting was touched. This closes
the browser-review gap for disabled controls, not provider-backed delivery or
the full #37 integration/recovery rehearsal.

## Fresh schema descriptor replay (2026-09-28 JST)

A separate private linked-project query completed at
`2026-09-27T20:56:46.804464Z` and read schema catalogs only. The catalog retained
40 tables and the same counts recorded in `schema-conversion.md`. Converter v8
reported 14 unresolved gates after applying the value-free credential
descriptor. The synthetic 40-table local D1 replay passed with 10 synthetic
rows, two transformed credentials, one deferred inactive credential, and all
checkpoints. `public_rows_reconciled` is the limited result; deployability and
full migration reconciliation remain false. All temporary files were removed.
No source rows or remote D1/R2 were touched.

## Admin user-management mutation browser acceptance (2026-09-28 JST)

`npm run test:migration:staging-admin-user-ui` passed against the isolated
workers.dev app after deploying Worker version
`92b30cf6-1432-4e02-a790-956f193799dc`. A synthetic MFA administrator used the
rendered management screen to change a profile Free→Max→Free and suspend then
restore it. The restored list row showed `Free / 有効`; business D1 contained
Free with no Enterprise override, Auth D1 showed `banned=0` and null ban
metadata, and the UI suspend/restore audit entries were present.

The same complete canary passed its TOTP, MFA-gated admin API, immediate
license-expiry, and cleanup checks. Its final readback returned all synthetic
Auth user-owned tables, both temporary profiles, admin audit records, test
license/configuration rows, and expiry notification artifacts to zero. No
email or payment provider call was made. This closes the admin mutation
browser subgate only; #37 still needs provider-backed acceptance and the full
integrated recovery sequence. Real user-data import and domain/DNS cutover
remain deferred to the final phase.

## Deployed PWA update transition (2026-09-28 JST)

The guarded `npm run test:migration:staging-pwa-update` check deployed a
temporary precache marker to isolated staging, verified the live service-worker
update and automatic `/pwa` reload, retained a synthetic `localStorage` value,
discarded an unsaved DOM field, then removed the marker and restored the normal
staging build. Worker versions were
`f19d38cb-6708-4aa9-87f1-a58a2166337e` (canary) and
`c78dbb17-9c9b-42fc-bad5-9dc9ae0cfc65` (restored). The removed asset returned
404 and was absent from the restored service worker and Workbox precache. The
isolated browser profile and synthetic storage were cleaned. Native install
and standalone launch were subsequently verified in an isolated Chrome profile
and app window, documented in `static-assets.md`. No real user, production, or
domain/DNS resource was involved. Full evidence is in
[`static-assets.md`](static-assets.md).

## Native staging PWA install and standalone launch (2026-09-28 JST)

Chrome on macOS offered installation for the staging workers.dev `/pwa` route.
After installing, launching the `fanmark.id` Chrome app opened the search screen
in a standalone window without browser address controls. The profile was
anonymous and temporary. The generated app bundle and profile were moved to the
Trash after the check. This closes only the staging-origin native install and
standalone-launch subgate; it does not verify authenticated flows, another
browser or OS, custom-domain behavior, or the full #37 recovery rehearsal.

## Schema converter v9 and current-catalog replay (2026-09-28 JST)

Converter v9 emits a D1 `CHECK` for PostgreSQL `date` columns that accepts only
canonical `YYYY-MM-DD` values for real calendar days in years 0001–9999. This
keeps the row codec's date validation in force for later writes as well as
imports. The refreshed catalog report drops the date-only import gate: 13
groups across 226 locations remain and `deployable` is still false.

The v9 schema-converter suite passes 14/14 and row-conversion passes 7/7. A
fresh-catalog synthetic local D1 replay also passed: 10 source-shaped synthetic
rows, two transformed credentials, one deferred credential, all 40 table
checkpoints, and conflict rejection. Status remains
`public_rows_reconciled`; this is not a source-row import or full-recovery
rehearsal. The catalog and generated DDL stayed outside Git; no remote D1/R2,
production route, real user data, or domain/DNS state was changed.

## Schema converter v10 and D1 timestamp write guard (2026-09-28 JST)

Converter v10 adds a D1 `CHECK` to source `timestamp with time zone` columns.
It requires canonical `YYYY-MM-DDTHH:mm:ss.ffffffZ` text, a real calendar date
in years 0001–9999, and valid time fields. The current schema-only catalog has
103 timestamp columns across 40 tables; generated DDL changes for all 40 table
blocks. The gate report remains 13 groups across 226 locations, including
`timestamp_import_precision`, because a schema check does not prove that every
application write supplies the correct timestamp.

Schema-converter tests pass 15/15, row-conversion tests 7/7, and the migration
data suite 168/168 under Node 22.6.0. The Miniflare D1 importer suite passes
18/18 and confirms that an impossible leap date and millisecond-only text are
rejected on later D1 `UPDATE`s while the stored canonical timestamp remains
unchanged. The fresh
catalog synthetic D1 replay passes with 10 synthetic rows, two transformed
credentials, one deferred credential, all 40 checkpoints, and conflict
rejection. Its status remains `public_rows_reconciled`; `deployable` and
`fullMigrationReconciled` remain false. No source application rows, remote
D1/R2, production route, real user data, or domain/DNS setting was changed.

Core Worker write paths for registration, return, transfer, lottery, settings,
favorites, access analytics, and notification read state now share a
fixed-width UTC microsecond formatter. Their seven focused D1 suites pass
72/72 locally, and their frontend API contract tests pass 44/44. This covers
those APIs' generated timestamps; the 79
`now()`-default operation gates and the full 103-column timestamp-operation
gate remain open until the rest of the D1 writers are audited and verified.

## Schema converter v11 `now()` fallback representation (2026-09-28 JST)

Version 11 emits a canonical-shaped UTC D1 default for all 79 source timestamptz
`now()` expressions. The SQLite unit test and Miniflare D1 importer test pass;
the latter applies generated DDL, omits the timestamp on insert, and reads
back a 27-character `...SSS000Z` value. The converter retains
`timestamp_default_requires_operation` because the clock has only millisecond
resolution and SQLite does not reproduce PostgreSQL transaction-time
semantics. Non-timestamptz `now()` defaults stay omitted and gated.

The converter version bump invalidates older snapshot manifests; re-export is
required before a later verification/import. A fresh schema-only catalog report
without the credential descriptor has 13 open groups / 226 locations (8
row-conversion and 5 schema/operation) and remains `deployable: false`. The
v11 DDL parses into all 40 tables with clean SQLite integrity and foreign-key
checks. The converter suite passes 16/16 and the synthetic D1 importer suite
passes 19/19 under Node 22.6.0 locally; the full migration-data suite passes
170/170.

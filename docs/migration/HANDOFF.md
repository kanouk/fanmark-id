# Cloudflare migration handoff

Checkpoint: 2026-09-27. The migration is **not complete**. PR #41 is open and
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

Staging enables the public D1 extension-price reader and Better Auth/MFA-gated D1 reference-master editor together. A complete synthetic TOTP admin Tier C edit/restore canary passed, and a separate one-month extension-price edit/restore canary passed through the deployed API. Tier C is null again; the tier-1 one-month price read back at ¥500, its pre-canary value. Anonymous writes returned 401, stale-version writes returned 409 without changing the active release, and canonical values for all four reference masters matched after each restore, including both Stripe IDs. Only the expected active-release metadata and edited-row updated_at changed. The active pointer is generation 8; the append-only history retains the canary edit/restore activations. An initial Tier canary exposed a test-harness cleanup omission; its exact synthetic rows were removed, the guard was fixed, and the repeat run completed with Auth and business canary rows at zero. The Stripe extension-checkout route remains deliberately disabled and returns 404 because server/webhook/dispatch selectors and Stripe secrets are absent; no payment was attempted. Production/default builds remain on Supabase.

The user says the user base is small and planned maintenance plus individual
support are acceptable. That can avoid overengineering for zero downtime; it is
not acceptance of account/entitlement mislinks, secret exposure, or data that
cannot be recovered. The old/new systems must not dual-write business rows.

## Current staging state (2026-09-27 JST)

Weighted progress estimate at this checkpoint: about 70% of the prioritized
basic-app/infrastructure/master-data stage and about 55–60% of the full
migration. The live registration/auth/business/R2 rehearsal below now covers a
major integrated path, but broader #37 acceptance, the 18 schema gates,
production acceptance, user-data import, and final DNS cutover remain open.
The plan/general-settings and read-only subscription-display slices are now
staged and deployed. The profile username-availability lookup is also selected
through D1 on staging; this narrow addition does not materially change the
coarse weighted estimate.

`fanmark-app-staging` is deployed at 100% as version
`6572c37d-3d8c-4bf1-89a6-6a131dc4bb09` at
`https://fanmark-app-staging.fanmark-id.workers.dev`. The split business/Auth/
master D1 bindings and the two image R2 buckets remain isolated to this
workers.dev app. A third, dedicated APAC Standard migration-backup bucket is
private, empty after its synthetic round-trip, and not bound to the app Worker.
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
| Credential transform target profile | Current worktree | Exact local DDL is bound to the source catalog, lifecycle/generation schema, and descriptor. The special six-column writer atomically applies transformed/disabled rows for active licenses. Inactive/returned rows now atomically receive metadata-only `deferred_inactive` coverage and checkpoint advancement, with no destination row/hash; a synthetic ACK-unknown restart and full reconciliation test passes. The credential schema/import suite passes 11/11. The separate current-catalog rehearsal still covers 3 synthetic rows and all 40 checkpoints; no live user data was read. `deployable` and `fullMigrationReconciled` remain false with 18 schema gates unresolved. See `docs/migration/credential-import-integration.md`. |
| License expiry source-shaped integration | Current worktree + deployed staging Cron canary | Local source-shaped suite passes 25 checks; lottery selection 10 and scheduler contract 8 pass. The remote staging canary completed one synthetic winner through an actual workers.dev scheduled event, then restored the baseline setting, removed synthetic rows/journals, and preserved retained lifecycle state. The latest Worker routes `0 0 * * *` only to lifecycle and `* * * * *` to notifications/Stripe dispatch. Staging declares both triggers but keeps `LICENSE_EXPIRY_BACKEND` unset, so daily lifecycle invocations return disabled before D1 access. A separate earlier local `--test-scheduled` rerun hit `ECONNRESET`; the deployed lifecycle Cron run supplies the live scheduler evidence. Production CPU/plan fit, recurring activation, and user-row cutover remain open. See `docs/migration/license-expiry-proof.md` and `docs/migration/lottery-selection.md`. |
| Credential descriptor/row path | `59a02f1` + current worktree | Six-column mapping, exact `credential-to-bcrypt` codec, manifest/descriptor/target binding, private one-use credential input, prepared hash reuse, atomic artifact/coverage/checkpoint write, and typed readback are integrated. Disabled rows on active licenses transform to bcrypt; inactive/returned rows are durably deferred without writing a target credential. |
| Credential import projection | `ddcbfea` + current worktree | Projection preserves source row/hash/PK evidence while withholding plaintext from generic bindings. The current full-catalog synthetic rehearsal passed after an injected ACK-unknown stop; no real credential was read or imported. |
| PostgreSQL event sequence and encrypted backup | Current worktree + synthetic APAC R2 staging destination | Snapshot format 4 captures and verifies the reviewed `fanmark_events.id` sequence definition, exact decimal `lastValue`, and `isCalled`; local D1 import reads back the seeded next ID for called and unused cases. The Git-external archive is one AES-256-GCM ciphertext with hidden source names/counts. A fresh Node process restored a persisted synthetic bundle; a separate canary uploaded the encrypted bundle to a private APAC R2 bucket, downloaded/hash-checked/restored it, deleted both objects, and read the bucket back empty. The full migration-data suite passes 125/125 with no skips. Synthetic only: no live sequence/user rows were read or migrated. Independent key custody, least-privilege destination credentials, retention policy, complete Auth/Storage backup, source freeze, and production restore remain open. See `docs/migration/snapshot-export-design.md` and `docs/migration/d1-import.md`. |
| Local Better Auth/D1 proof | `docs/migration/auth-feasibility.md` | Better Auth 1.7.5 + bcryptjs 3.0.3 verified synthetic `$2a$10$`/`$2b$10$` password, UUID/session, and TOTP flows under workerd. No real Auth rows or hashes were exported. |
| Application Worker Auth and emoji admin route | Staging Worker + conditional Auth wiring | `/api/auth/*` reaches Better Auth through dedicated `AUTH_DB`; admin routes require role and current-session MFA assurance. The synthetic TOTP/admin canary passed on prior deployed version `1413b726-0930-45f4-b779-67865fffa24d`; it exercised sign-in, enrollment, session rotation, and gated admin reads, then removed all synthetic Auth rows. Current version `bc5ad53e-5f08-492b-81fb-8046c9be9600` adds conditional Resend verification/reset and four existing-account OAuth providers. Live capabilities return all email/signup flags false and no providers; sign-up, reset, social sign-in, and OAuth callback probes return 403. Email/OAuth selectors and secrets remain unset; no message or provider callback ran. Broader admin authorization, user/Auth import, and CPU plan fit remain open. See `docs/migration/auth-feasibility.md` and `live-observations.md`. |
| R2 image Storage API | Current worktree + staging Worker/SPA; new uploads enabled on workers.dev staging only | APAC buckets `fanmark-avatars-staging` and `fanmark-cover-images-staging` are bound to the current app Worker with `STORAGE_BACKEND=r2`; `VITE_STORAGE_BACKEND=r2` is in the staging build. Local Worker tests 5/5 and client tests 7/7 pass. Live synthetic PNG upload, public read, owner delete, and post-delete 404 passed; no canary object remains. Existing Supabase objects were not copied and production remains on its default Supabase selector. See `docs/migration/storage-r2-app-api.md`. |
| Owner-scoped dashboard list API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET /api/me/fanmarks` derives the only `user_id` predicate from Better Auth and returns the bounded dashboard DTO. `OWNED_FANMARKS_BACKEND=d1` and `VITE_OWNED_FANMARKS_BACKEND=worker` are active in staging; the live synthetic account received its one owned row, then that row was deleted and read back as zero. Four split-D1 tests and four client tests pass. No user rows were imported. |
| Better Auth own-profile API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/PATCH /api/me/profile` uses session identity and omits billing/invitation fields; writes allow only display name, language, and a same-owner R2 avatar URL. The live synthetic account read and updated its display name/language; cleanup left no profile row. Five Worker integration and four client contract tests pass. Wider profile and upload flows remain split across Supabase and Cloudflare. |
| Notifications inbox API and event processor | Current worktree + staging Worker/SPA; inbox and processor enabled on workers.dev staging only | Session-scoped list/unread/read-one/read-all routes use bounded DTOs. The deployed workers.dev Cron processed synthetic return/favorite events and all three transfer events (`transfer_requested`, `transfer_rejected`, `transfer_approved`), with one delivered Japanese in-app notification for each intended owner/requester. A separate canary ran all 10 migrated in-app master rules through the Cron and confirmed one delivered Japanese notification per rule, then removed every synthetic row. `NOTIFICATION_PROCESSOR_BACKEND=d1` and a one-minute Cron are active on staging. Email/Web Push, unexercised source-specific events, production recurring fit, and populated-user CPU/authorization review remain open. See `docs/migration/notifications-api.md`. |
| Notification admin and logs | Master editor, payload-minimized read routes, and manual event creation deployed to workers.dev staging | Deployment `938f880d-f3db-46d5-9634-60612e4e2814` includes the MFA-gated D1 rule/template editor, event log, and delivery log. A synthetic admin completed TOTP/MFA; the canary read 10/40 masters and both logs. Anonymous requests returned 401, notification payloads were omitted, and delivery user IDs were truncated to eight characters. On 2026-09-27 a separate MFA-authorized manual-event POST canary passed: the deployed Cron produced one delivered Japanese in-app notification for a synthetic recipient, then event, notification, profile, and Auth rows were removed and read back at zero. No real user rows were touched. See `docs/migration/notifications-api.md`. |
| Invitation code admin API | Current worktree + workers.dev staging | The staging screen selector and `INVITATION_ADMIN_BACKEND=d1` are active. A same-session MFA canary passed list/create/CAS edit/stale-write rejection/disable/delete; exact D1 readback found zero invitation rows afterward. DTOs omit creator IDs. Worker tests pass 5/5 and client tests 4/4. Invitation data has not been imported; signup, validation/consumption, and mode-setting stay closed. See `docs/migration/invitation-admin-api.md`. |
| Owner fanmark profile API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/PATCH /api/me/fanmarks/{fanmarkId}/profile` resolves the active license from Better Auth identity. Live synthetic GET/PATCH passed and its profile row was removed; same-origin R2 profile URLs now enforce correct bucket and owner. An integrated cover upload/read/profile-save/foreign-path rejection/delete canary passed on current staging; five Worker and five client tests pass. See `docs/migration/fanmark-profile-api.md`. |
| Owner fanmark settings API and protected access | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | Both settings selectors and `VERIFIED_ACCESS_BACKEND=d1` are active in staging. Live synthetic settings GET/PATCH returned 200/200; unauthenticated access and wrong password returned 401; valid verification returned 204 and protected content returned 200. Runtime evidence matched the password generation, no password/hash was returned, and cleanup read back zero canary rows. Worker/client settings suites pass 6/6 and 5/5; source-profile and verified-access suites pass. See `docs/migration/fanmark-settings-api.md` and `live-observations.md`. |
| Fanmark single and bulk return APIs | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `POST /api/me/fanmarks/return` and `/bulk-return` use Better Auth identity and business D1; both guard active ownership and active/applied transfer codes, transition licenses to grace, and best-effort write audit/owner/favorite events. Bulk accepts 1–50 distinct license IDs and returns 207 on partial success. Synthetic staging returned 207 for one success plus one blocked license, then 200 after removing the second test transfer code. Cleanup read back zero rows across 40 source business tables and user-owned Auth tables; access-version state and singleton MFA generation were unchanged. The retained license-incarnation registry is now 21 rows (16 earlier rows and five synthetic anti-reuse tombstones accumulated during return canaries); no access-version rows remain. Local Worker suite passes 17/17 and client suite 7/7. Notification delivery remains separate. See `docs/migration/fanmark-return-api.md` and `live-observations.md`. |
| Favorites API | Current worktree + staging Worker/SPA; enabled on workers.dev staging only | `GET/POST/DELETE /api/me/favorites` resolves emoji IDs against active Master D1 and uses business D1 for owner rows. Live synthetic add/list/remove passed; the favorite, event, and newly-created discovery rows were removed and composite readback was zero. Four Worker and four client tests pass. No historical favorites were imported. See `docs/migration/favorites-api.md`. |
| Emoji master D1 staging/API/frontend | Current worktree + APAC staging D1/Worker | Two independent read-only exports of the 3,944-row public master matched. A staging-only release with unchanged UUID/emoji/codepoint identities was promoted then rolled back using the guarded remote runner; activation history reads generation 1 promotion, generation 2 promotion, generation 3 rollback. Original release `10ec…` is active and the API returns 3,944 rows. Canonical `emoji_master` remains at 3,944 rows; the temporary non-user release stays inactive for immutable audit history. Migration-data tests pass 93/93 and the Miniflare release suite passes 7/7. See `docs/migration/emoji-releases.md` and `live-observations.md`. |
| Other non-user reference masters | Current worktree + APAC staging D1/Worker | Migrations `0004` and `0006` are applied; active generation 8 has 4 tiers, 4 languages, 5 reserved patterns, and 16 extension prices. All four public routes return HTTP 200/no-store and omit Stripe IDs. The private HMAC route is deployed. A synthetic TOTP admin completed Tier C null→1→null and tier-1 one-month price ¥500→¥501→¥500 through the deployed MFA API; anonymous writes returned 401, stale CAS returned 409, and all four masters plus Stripe IDs matched after restore. Auth/profile business canary rows returned to zero after cleanup. Stripe extension checkout remains disabled and returns 404 until server/webhook/dispatch selectors and secrets are configured. Production/default pricing remains on Supabase. See `docs/migration/reference-master-data.md` and `live-observations.md`. |
| Availability against versioned reference release | Current worktree | Added a separate Miniflare integration suite that applies the checked-in `0004` reference-master migration, stages/activates a synthetic release, and exercises the real `fanmark_tiers` active view through the Worker availability route. It verifies integer-cent storage/USD response conversion, selection of a second tier, and inactive-tier behavior. The older focused availability suite remains in place for validation and lifecycle boundaries. Three integration cases, eight focused availability cases, and three reference-master API cases pass; Worker typecheck, targeted ESLint, CI isolation check, and `git diff --check` pass. No remote D1/R2 write, user data, production deployment, or DNS change. |
| Public access reads | Current worktree + staging Worker/SPA | `PUBLIC_ACCESS_BACKEND=d1` and `VITE_PUBLIC_ACCESS_READ_BACKEND=worker` are active on workers.dev staging. Emoji normalization uses `MASTER_DB`; fanmark/license/config/profile projections use `FANMARK_DB`. Local split-D1 tests pass 11/11. Live synthetic routes returned 200/no-store and their canary rows were removed. `VERIFIED_ACCESS_BACKEND=d1` and its frontend selector are also active on staging; the synthetic protected-read smoke passed, but real imported hash compatibility and CPU fit remain unverified. Paired analytics write/read APIs are active in staging; owner/history details remain on Supabase. No production traffic was switched. See `docs/migration/public-access-contract.md`. |
| Public access and owner analytics APIs | Current worktree + workers.dev staging | The staging SPA and Worker select D1 for `POST /api/fanmarks/access` and the session-scoped `/api/me/analytics/*` reads. The synthetic canary recorded one event, suppressed four duplicates, verified owner metrics and summary, received 401 anonymously, then removed its Auth/business rows. Worker D1 tests pass 8/8 and frontend client tests pass 3/3 for each adapter. Historical analytics remain in Supabase; user data, production traffic, and domain/DNS were untouched. Abuse controls, retention, populated-user authorization, and production CPU/plan fit remain open. See `docs/migration/fanmark-access-analytics-api.md`. |
| D1 role separation | Current worktree + APAC staging | `D1_TOPOLOGY=split` selects business `FANMARK_DB`, Better Auth `AUTH_DB`, and emoji/reference `MASTER_DB`, failing closed for missing bindings. Business staging has 40 source-shaped tables plus applied lifecycle/credential/access extensions; its application baseline contains 10/40 global notification masters, four disabled availability rules, and the two explicitly allowlisted public settings `grace_period_days=1` and `max_emoji_characters=5`. User-owned business/Auth rows are empty. The separate protected-access tables retain documented synthetic canary telemetry and license-incarnation tombstones. Master D1 has 3,944 canonical emoji rows and active release, with reference-master generation 8. The source refresh has 40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum labels, 36 triggers, 77 policies, 58 functions, and one view. Snapshot format 4 fingerprints eight scopes and validates the reviewed event sequence state; conversion v4 still has 18 blocking gates and `deployable: false`. No real rows or live event sequence state were migrated. |
| Lifecycle settings API | Current worktree + staging Worker/SPA | Public `GET /api/system/lifecycle` reads only the public `grace_period_days` row through split business D1; `PATCH /api/admin/system-settings/lifecycle` requires administrator role and current-session MFA. Supabase public value `1` was read-only verified and copied as one staging config row. Client 4/4, combined settings D1 9/9, full standard suites 30/30 and 10/10 pass. Live GET returns 200/no-store; anonymous PATCH returns 401. The shared staging Cron is active for notifications; `LICENSE_EXPIRY_BACKEND` remains unset, so the lifecycle handler is disabled. Authenticated admin browser flow remains unverified. See `docs/migration/lifecycle-settings-api.md`. |
| Plan and general system settings | Current worktree + workers.dev staging | An exact allowlist of 18 non-user Supabase settings was added to the two existing settings (20 total). Source and D1 canonical digests match `d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f`; the public GET returns exactly 17 public keys and omits both private Enterprise settings. Public GET and SPA returned 200/no-store; anonymous admin GET returned 401/no-store. A synthetic Better Auth administrator passed TOTP/MFA read/update, exact D1 readback, stale-write rejection, baseline restoration, audit-value minimization, and audit cleanup. Worker tests 5/5, client tests 4/4, migration-data 124/124, typechecks, staging build, and dry-run pass. Deployed at 100% as version `3310b139-f639-4cf2-8a15-ad2b63f9fbd6`. Browser UI acceptance and payment behavior remain open; production stays on Supabase. See `docs/migration/system-settings-api.md`. |
| Availability-rule administration | Current worktree + workers.dev staging | `AdminPatternRules` selects the MFA-protected D1 API only in staging. Four explicit source rules were seeded with `created_by=NULL`, remained disabled, and were read/edit/CAS-restored by the deployed TOTP canary. Worker tests 4/4 and frontend tests 5/5 pass. This does not move Stripe enforcement or other admin CRUD. See `docs/migration/availability-rules-admin-api.md`. |
| Current app staging deployment | APAC `fanmark-app-staging` Worker + Static Assets | Current version `6572c37d-3d8c-4bf1-89a6-6a131dc4bb09` at 100%; split D1 and both image R2 bindings remain. The separate `fanmark-migration-backups-staging` bucket is APAC Standard, private, has no custom domain or r2.dev access, and is not bound to the app; its encrypted synthetic upload/download/restore/delete canary returned it to zero objects. Business migrations through `0015` and Auth migration `0008_auth_user_suspension.sql` are applied; all eight user-owned Auth tables, including status audit, read back empty after the latest TOTP canary. The 16 localized auth email master rows remain readback-verified against their pinned content/seed digests. MFA-gated user list/detail, plan, suspension/restoration, immediate license expiry, password-reset mutation, system settings, subscription display, and profile username availability use split D1/Better Auth. Subscription display reads only the signed-in user's row and omits Stripe IDs; the user-owned subscription table remains empty and no Stripe or user data was copied. Resend secrets remain absent, so password-reset delivery is closed with 503 before audit; no email was attempted. Prior live canary verified suspension, current-session revocation, restoration, immediate expiry, four config deletions, two audit rows, one notification event, and repeat safety, then cleaned synthetic rows. Post-run readback found zero user settings/licenses/favorites/notifications/user events/expiry audits/four config types and zero Auth user-owned rows; 43 license-incarnation tombstones remain as retained synthetic anti-reuse state. Signup and email delivery remain disabled because delivery is not configured; OAuth providers remain unset. The every-minute Cron remains for notification/Stripe dispatch; the separate daily lifecycle trigger is configured with its execution selector unset. No real user data, production routing, or domain/DNS changed. Authenticated reset-mail acceptance, remaining app/API inventory, Stripe sandbox/integrated acceptance, key custody/retention policy, real user/Auth/object import, production routing, and domain/DNS remain open. |
| Lifecycle target schema | `01a1507`, `8034735` | Exact source/extension DDL and fingerprint consistency; actual 40-table catalog applied to empty local D1. No production rows. |
| Credential incarnation authority | `7cf0fe6` | Missing retained authority is rejected by reads and final SQL; credential suite 19 passed. Isolated proof schema. |
| Lifecycle/access-generation and protected-access integration | Current worktree + workers.dev staging | 24 triggers invalidate proofs on license/password and source-backed fanmark selector, basic/redirect/messageboard/profile changes. The Worker verifier reads the same 40-table source profile and checks descriptor-bound credential provenance. Dedicated D1 and full source-profile tests pass; the frontend contract is covered. Deployed synthetic settings/protected-access canary passed and cleaned all rows. The selectors are active on staging only. Real source password-format compatibility, Cloudflare CPU and multi-instance checks, deployed-origin security review, and full browser acceptance remain open. |

These checks ran on Node 22.6.0 without skips. CI configuration isolation checks
passed, but the GitHub workflow remains manually disabled; local results are
not a successful hosted CI run.

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
The default Supabase path retains password verification; access analytics and
owner/history details remain on Supabase. The separate
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
   active release with matching hashes. Next reconcile
   user-held references, finish business API wiring, and verify Wrangler
   plan/CPU fit before #37. Language reads and the read-only tier projection in
   the extension-coupon admin screen now use Worker APIs in staging; coupon
   admin CRUD and redemption use the D1 Worker path, with existing coupon and
   usage rows still excluded from import. Editable tier settings remain on
   Supabase, and no frontend uses reserved patterns yet. R2 is enabled: staging avatar/cover uploads and
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

The latest observed workers.dev deployment is version
`7a2a780d-3fed-476b-a84e-905fc6d29aad` at 100%. Read-only migration checks show
no pending migrations on business, Auth, or master D1. The current local
staging build's HTML-referenced JavaScript and CSS match the deployed assets
byte-for-byte. Anonymous session/profile/admin guards, public lifecycle
settings, emoji catalog, and missing R2-object responses returned the expected
status codes.

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
lottery-entry index. Coupon, usage, and command tables remain at zero rows.

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

Plan mutation, suspension, password-reset, and immediate-license-expiry
controls remain disabled in Worker mode. Continue by porting those routes and
run an authenticated staging canary before calling user management complete.

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

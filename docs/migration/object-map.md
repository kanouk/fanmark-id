# Cloudflare migration object map (proposal)

This is the reviewable mapping proposal for the migration design pass. Its
table and function targets remain proposals unless a specific implementation
and proof are linked from the migration handoff. Since this inventory was
written, several isolated Worker APIs and master-data releases have been
implemented; that progress does not yet provide a complete D1 schema or Worker
API. Names and locations cover the checked-in inventory and the read-only live
metadata available when the mapping was prepared; target choices remain
subject to the evidence recorded in their implementation documents.

The checked-in inventory was generated from base commit
b307dd41fe7f151821730c24044a93f4ee5c54fe. The private live catalog was
observed at 2026-09-20T16:18:46.451758+00:00. It contained object metadata
only: no user rows, storage objects, credentials, or function bodies are
stored in this repository. The redacted function read was used to identify
purpose, but its definitions are not reproduced here.

## Evidence boundary

The offline AST inventory at commit `b34638b` contains 211 frontend callsites:
84 table calls across 27 tables, 37 RPC calls across 24 functions, 36 Edge
invocations across 28 functions, 8 Realtime calls across 3 subscribed tables,
40 Auth/Auth-MFA calls, and 6 Storage calls across the `avatars` and
`cover-images` buckets. Each extracted target is represented in the table,
function, Edge, or non-table dependency map below. This is target coverage,
not proof that every callsite's owner, data class, replacement behavior, or
live production state is settled; the AST scanner also does not resolve
arbitrary wrappers or indirect calls.

| Surface | Observed count | What it supports |
| --- | ---: | --- |
| Generated public types (checkout plus live name readback) | 40 tables, 1 view, 45 typed RPCs | Checked-in locations and a separate live generator readback for names/type shape |
| Read-only live catalog | 40 tables, 58 public functions, 36 triggers, 77 policies, 144 constraints | Current metadata names and aggregate policy/constraint/trigger counts at the observation time |
| Local Edge entrypoints | 34 | Checked-in supabase/functions/*/index.ts routes |
| Live-only Edge name | 1 | manual-expire-grace-licenses, recorded separately in [live observations](live-observations.md) |

The initial private live catalog did not contain a view collection. A direct
read-only catalog inspection on 2026-09-21 subsequently confirmed
`recent_active_fanmarks`: join `fanmark_licenses` to `fanmarks` by fanmark ID,
select the license ID, fanmark ID/short ID, license `display_fanmark`, and license
`created_at`, and filter only license `status = active`. It has
`security_invoker=true`. The `list_recent_fanmarks(integer)` wrapper is stable,
security-definer, fixes search_path to public, orders license created_at
descending, and clamps its limit to 1..50 (default 20). Equal timestamp order is
not defined. The current view adds no separate license-end or fanmark-status
filter; a target adapter must not silently invent one. This is observed query
behavior, not evidence that all authorization or product cases are correct.
The readback contains no user rows. Reproducible metadata SQL is in
[scripts/migration/recent-contract-readiness.sql](../../scripts/migration/recent-contract-readiness.sql).
A checked-in type or migration history alone is not proof of production state.

The subsequent column/index catalog readback covers 406 columns and 139 indexes.
Exact numeric, timestamp, array, enum, and constraint conversion requirements
are recorded in [schema-conversion.md](schema-conversion.md); the reproducible
query is `scripts/migration/schema-readiness.sql`. No target schema or data
import is implied by that readback.

The live catalog reports rls=true and force_rls=false for each of the 40
tables. Table rows below show live P/C/T counts for policy, constraint, and
user-defined trigger metadata. These are observations of the current database
configuration, not the product authorization contract. The target boundary
column is the intended migration boundary inferred from PRODUCT, ARCHITECTURE,
frontend callsites, Edge code, and SQL references; it must be revalidated
before cutover.

Target labels:

- D1 table: authoritative relational state or a durable queue/config table.
- Worker public: unauthenticated or deliberately public data/validation.
- Worker user: authenticated owner or participant operation.
- Worker admin: administrator-only operation.
- Worker internal: cron, webhook, trigger replacement, or service operation
  with no browser-facing contract.
- Derived artifact: a read model, aggregate, static catalog, or generated
  object whose source and refresh rule must be explicit.
- Retain: keep in an external service such as Auth, R2, Stripe, or Resend.

Current DB policy metadata must not be copied into the Worker contract without
separately deciding whether the product intends public, user, admin, or
service access. In particular, an RLS policy observation does not by itself
authorize a D1 row or a public route.

Source shorthand used below:

- T = src/integrations/supabase/types.ts
- R = supabase/remote_schema.sql
- M = supabase/migrations/20260104091448_remote_schema.sql
- N = supabase/migrations/20260725044303_make_notification_cron_on_demand.sql
- S = supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql
- F = a frontend callsite named in the local inventory
- E = a local Edge entrypoint under supabase/functions
- P = docs/PRODUCT.md or docs/ARCHITECTURE.md

## Tables

| Table | Live metadata (P/C/T) | Evidence location | Tentative target and operation boundary | Uncertainty / decision |
| --- | --- | --- | --- | --- |
| audit_logs | RLS; 2/1/1 | T:17; F src/components/SecureWaitlistAdmin.tsx:91; P audit trail | D1 append-only table; Worker internal writes, Worker admin reads | Medium: retention, redaction, and whether user-visible history is required |
| broadcast_emails | RLS; 1/3/1 | T:50; F src/components/AdminBroadcastEmail.tsx:144,240 | Staging draft/list/count/send-start APIs and address-free durable delivery queue use business D1; admin routes require Better Auth MFA plus D1 admin role | Send-start replay, recipient snapshot, bounded Resend dispatch/retry, signed suppression webhook, and fixed-recipient test-send are implemented with synthetic Miniflare coverage. Authenticated browser review confirmed the synthetic draft and both disabled send controls; selectors/secrets remain off, and no provider email or real recipient snapshot has run. See `broadcast-email-admin-api.md` |
| email_templates | RLS; 2/2/1 | T:107; F src/components/AdminEmailTemplates.tsx:48,61 | D1 config; Worker admin edits, Worker internal renders and sends | Sixteen Auth templates and twelve allowlisted broadcast templates are seeded/read back in staging; the MFA editor and CAS path are verified. Better Auth delivery and Resend remain disabled without provider configuration; production/default builds remain Supabase. See `email-templates.md` and `broadcast-email-admin-api.md` |
| emoji_master | RLS; 2/2/2 | T:143; F src/components/AdminEmojiMaster.tsx:60,131; F src/lib/emoji-master-utils.ts:120 | D1 reference table; Worker public reads safe catalog, Worker admin updates; derived search catalog may be generated | Medium: preserve live DB UUIDs as initial migration authority; Unicode source updates and versioned catalog publication follow a separate release |
| enterprise_user_settings | RLS; 2/2/1 | T:182; R:2370 | D1 private table; Worker user/admin as applicable, Worker internal for enterprise automation | High: no frontend callsite in the offline inventory; confirm product owner and fields |
| extension_coupon_usages | RLS; 3/4/0 | T:215; F src/hooks/useExtensionCouponAdmin.ts | D1 append-only usage table; atomic Worker command records redemption, MFA admin reads joined display DTO | Existing usage rows remain in Supabase until the separately excluded user-data migration; enforce per-coupon/user/fanmark uniqueness in D1 |
| extension_coupons | RLS; 1/3/1 | T:271; F src/hooks/useExtensionCouponAdmin.ts | D1 coupon master; MFA Worker admin creates/updates activation, Worker user applies through atomic operation | Four source definitions with zero uses and no usage rows are digest-pinned and readback-verified in business staging; consumed definitions and all usage history stay deferred with user data. See `extension-coupon-api.md` |
| fanmark_access_daily_stats | RLS; 1/4/0 | T:313; F src/components/FanmarkDashboard.tsx:551; F src/pages/Analytics.tsx:159 | D1 derived aggregate; Worker internal updates, Worker user reads owned fanmark stats, Worker admin reads as needed | Medium: aggregation window, timezone, and rebuild path are unverified |
| fanmark_access_logs | RLS; 1/3/0 | T:401; R:2459; P analytics | D1 append-only log; Worker public ingress writes through a bounded operation, Worker user reads owned data, Worker internal aggregates | Medium: retention and abuse/rate limits need a decision |
| fanmark_availability_rules | RLS; 2/4/1 | T:480; F src/components/AdminPatternRules.tsx:37,57,90; E supabase/functions/register-fanmark/index.ts:278,532 | D1 admin config; MFA-protected Worker admin API reads/writes staging rules. The Worker availability repository does not read this table. The Supabase registration function filters for `is_available=true` and only uses the returned `isAvailable` value to reject; it computes but does not enforce `requiresPayment` or `priceUsd`. A read-only Supabase config check on 2026-09-27 found four rows and none enabled, so this check currently has no effect on registration. | Current staging DTO/CAS behavior is verified. Runtime intent is unclear: preserve the observed no-op behavior, or separately specify and test whether rules should block registration or require payment. Do not infer pricing/availability behavior from the table shape. |
| fanmark_basic_configs | RLS; 1/3/1 | T:519; F src/components/FanmarkDashboard.tsx:411; F src/components/FanmarkSettings.tsx:402 | D1 table; Worker user owns reads/writes, Worker public reads only published fields | Medium: public projection must be explicit so private draft fields do not cross the boundary |
| fanmark_discoveries | RLS; 1/3/0 | T:561; R:2518; P:34-36 | D1 aggregate relation; Worker public reads safe aggregate, Worker internal updates from search/favorite events | Medium: preserve anonymous aggregation without exposing user behavior |
| fanmark_events | RLS; 1/2/0 | T:605; R:2535; P audit/events | D1 append-only domain-event table or derived event log; Worker internal writes and consumes, Worker admin inspects | High: no direct frontend callsite; define event retention and replay need |
| fanmark_favorites | RLS; 1/4/0 | T:640; F src/components/FanmarkAcquisition.tsx:279,288; P:34-36 | D1 user relation; Worker user adds/removes/lists own favorites | Medium: public availability projection belongs in a separate read model |
| fanmark_licenses | RLS; 2/4/1 | T:685; F src/components/FanmarkDashboard.tsx:370; P:19-22,76-83 | D1 authoritative license state; Worker public reads only intended WHOIS fields, Worker user reads own, Worker admin/internal mutate lifecycle | Medium: active/grace/expired transitions, ownership history, and public projection need cutover tests |
| fanmark_lottery_entries | RLS; 4/7/2 | T:753; E apply-fanmark-lottery, cancel-lottery-entry; P:28-32 | D1 transactional relation; Worker user applies/cancels, Worker internal expires/selects, Worker admin reviews | Medium: weighted selection and uniqueness must remain atomic |
| fanmark_lottery_history | RLS; 2/5/0 | T:823; R:2627; P:28-32 | D1 append-only history; Worker internal writes, Worker admin reads | High: no frontend callsite; retention and public visibility are unspecified |
| fanmark_messageboard_configs | RLS; 1/3/1 | T:894; F src/components/FanmarkSettings.tsx:428; P:7-10 | D1 table; Worker user writes owned config, Worker public reads published message content | Medium: draft/published distinction needs an explicit read model |
| fanmark_password_configs | RLS; 1/3/1 | T:933; F src/components/FanmarkSettings.tsx:443,452,462; P:7-10 | D1 private table; Worker user writes through a guarded operation, Worker public verifies without exposing secrets | High: hash format, rate limits, and secret handling require a dedicated migration design |
| fanmark_profiles | RLS; 4/3/1 | T:975; F src/hooks/useEmojiProfile.tsx:54,82,113; P:7-10 | D1 table; Worker user edits owned profile, Worker public reads only is_public projection | Medium: media URLs and profile projection must align with R2 policy |
| fanmark_redirect_configs | RLS; 1/3/1 | T:1026; F src/components/FanmarkSettings.tsx:416; P:7-10 | D1 table; Worker user writes owned config, Worker public reads validated redirect target | Medium: URL/tel: validation and redirect abuse controls need parity tests |
| fanmark_tier_extension_prices | RLS; 1/5/1 | T:1065; F src/components/AdminTierExtensionPrices.tsx:55,119; F src/components/ExtendLicenseDialog.tsx:84 | D1 config; Worker public reads active prices, Worker admin updates, Worker user consumes via checkout operation | Versioned D1 read/editor selectors are active on staging; synthetic MFA edit/restore returned tier-1 one-month price to ¥500. Stripe checkout stays closed until Worker webhook/dispatch configuration and test secrets exist; production defaults remain Supabase. |
| fanmark_tiers | RLS; 4/2/1 | T:1101; F src/components/AdminTierExtensionPrices.tsx:60,327; P:13-17 | D1 config; Worker public reads active tier data, Worker admin updates, Worker internal classifies | Versioned D1 admin edits and availability reads are active on staging. A synthetic Tier C edit/restore confirmed `initial_license_days` returns to `null`; full integrated availability precedence and production/default parity remain open. |
| fanmark_transfer_codes | RLS; 3/5/1 | T:1143; F src/hooks/useTransferCode.ts:49; P:24-27 | D1 transactional table; Worker user owner/recipient operations, Worker admin/internal lifecycle checks | Medium: one-code/expiry/transfer-lock invariants need D1 transaction tests |
| fanmark_transfer_requests | RLS; 3/5/1 | T:1204; F src/hooks/useTransferCode.ts:82,121; P:24-27 | D1 transactional table; Worker user participants approve/reject, Worker internal finalizes | Medium: ownership checks and copy-on-transfer behavior need end-to-end mapping |
| fanmarks | RLS; 2/8/2 | T:1284; R:2775; P:6-10,76-83 | D1 authoritative registry; Worker public reads active registry projection, Worker user/admin/internal create or update through operations | Low/medium: public fields are intentional by product design, but exact projection and uniqueness must be preserved |
| invitation_codes | RLS; 1/5/1 | T:1323; F src/hooks/useInvitationAdmin.ts:26,57,74,98; P:44-48 | D1 table; Worker public validates, Worker user consumes during signup, Worker admin manages | Medium: consumption must be atomic across retries |
| languages | RLS; 2/2/1 | T:1362; F src/hooks/useLanguages.tsx:42 | D1 versioned reference master; Worker public reads, Worker admin/internal release tooling updates | Four active language rows are read by the staging Worker selector and match the pinned release. No in-app write screen exists; production/default reads remain Supabase until cutover. |
| notification_events | RLS; 2/4/2 | T:1395; F src/components/AdminNotificationManager.tsx:83; P:34-36 | D1 durable queue; Worker internal creates/processes, Worker admin inspects through MFA-protected APIs | Staging manual event creation, redacted event/delivery logs, scheduled processing, and synthetic in-app delivery are verified. Unported event sources, email/Web Push, recurring production fit, and authenticated browser review remain open; production/default builds remain Supabase. See `notifications-api.md` |
| notification_preferences | RLS; 1/4/1 | T:1446; R:2843; P:34-36 | D1 user settings; Worker user reads/writes own preferences, Worker internal evaluates | Medium: no direct frontend callsite in the inventory; confirm channel and default behavior |
| notification_rules | RLS; 1/4/1 | T:1476; F src/components/AdminNotificationManager.tsx:113,141; P:34-36 | Versioned D1 config; same-session MFA administrator edits, scheduled Worker evaluates | Ten allowlisted in-app rules are seeded and read back on staging; edit/restore, stale-write rejection, and synthetic scheduled processing are verified. Remaining source event coverage and production recurring fit stay open. See `notifications-api.md` |
| notification_templates | RLS; 2/3/1 | T:1536; F src/components/AdminNotificationManager.tsx:127,162; P:34-36 | Versioned D1 locale config; same-session MFA administrator edits, Worker renders | Forty allowlisted templates across four locales are seeded and read back on staging; editor/restore and synthetic in-app rendering are verified. Email/Web Push and production/default routing remain open. See `notifications-api.md` |
| notifications | RLS; 4/7/1 | T:1581; F src/pages/Notifications.tsx:38,79,111; P:34-36 | D1 user inbox; Worker internal inserts, Worker user reads/marks own, Worker admin reads as needed | Staging inbox/list/unread/read APIs use owner-bound Better Auth sessions and bounded no-store DTOs; foreground polling replaces Realtime only in Worker mode. Synthetic event processing and read-state checks pass. Email/Web Push, unported event sources, recurring production fit, and populated-user review remain open. See `notifications-api.md` |
| notifications_history | RLS; 1/1/0 | T:1662; R:2949; P:34-36 | D1 history; Worker internal archiver writes, Worker admin reads | D1 archiver implements the checked-in 90-day delivered/failed move with bounded batches and conflict retention; explicit selector is absent in staging. Source invocation remains unverified, and history purge/long-term retention is undefined |
| reserved_emoji_patterns | RLS; 1/2/1 | T:1680; R:2977; P:13-17 | Versioned D1 reference master with a live public read route. Neither the Worker availability repository nor the Supabase registration function reads this table; no dedicated source UI consumer was found. | Five active rows are present in the staging release, but that alone does not establish runtime effect. Architecture describes this as public pricing/registration information, while no runtime consumer was found. Define an intended consumer and behavior before adding it to availability or registration; no precedence behavior is inferred. |
| system_settings | RLS; 3/3/1 | T:1710; F src/hooks/useSystemSettings.tsx:59,129; P:66-71 | D1 config; Worker public reads explicitly public settings, Worker admin writes, Worker internal reads secrets only through a private path | Medium: separate public settings from private payment/operational settings before API design |
| user_roles | RLS; 2/4/0 | T:1740; R:3006; F src/components/AdminApp.tsx:43 | D1 authz table; Worker internal/admin authorization checks, no public row API | High: role source of truth and bootstrap/recovery path require explicit design |
| user_settings | RLS; 3/5/3 | T:1764; F src/hooks/useProfile.tsx:46,72; P:44-48,81-83 | D1 private user table; Worker user reads/writes own, Worker admin reads only required fields | Medium: PII projection, account deletion, and Auth linkage need a data-classification decision |
| user_subscriptions | RLS; 3/3/1 | T:1817; F src/hooks/useSubscription.tsx:86,170; P:73-84,453-482 | D1 billing mirror; Worker user reads own status, Worker internal webhook syncs, Worker admin reads; retain Stripe as payment system | High: webhook idempotency and source-of-truth rules are not established by local code alone |
| waitlist | RLS; 2/4/0 | T:1883; F src/hooks/useInvitationCode.tsx:83; P:44-48 | D1 private table; restricted Worker admin hash-list and audited one-row reveal are implemented for staging; public/user submission remains Supabase | High: no real rows imported; email PII retention and export/deletion behavior require a decision |

## First explicit reference-data allowlist

The 2026-09-23 v1 reference release is limited to `fanmark_tiers`,
`languages`, and `reserved_emoji_patterns`. These three tables have no owner
user relation in the current mapping and are staged as one versioned D1
release. This does not make every configuration-looking table non-user data:
`system_settings` is never copied wholesale. Staging contains the individually
allowlisted public `grace_period_days` and `max_emoji_characters` rows plus a
separate exact 18-key plan/pricing/feature projection. Two Enterprise values
remain private and are served only by the MFA-protected admin API. The source
projection and staged D1 readback match the pinned canonical digest; see
[`system-settings-api.md`](system-settings-api.md). Availability rules and
notification rules/templates use documented row/field allowlists. The active
versioned reference release now includes all four public masters, including 16
tier-extension prices; the staging Worker reads them through the pinned release
and omits Stripe IDs. Four verified unused extension-coupon definitions are
also staged with `created_by` removed. Consumed coupon definitions and all 20
usage rows remain in the deferred user-data reconciliation; no remaining table
is bulk-exported just because it looks like configuration. See
[`reference-master-data.md`](reference-master-data.md) and
[`extension-coupon-api.md`](extension-coupon-api.md).

## View

| View | Evidence | Tentative target and boundary | Uncertainty / decision |
| --- | --- | --- | --- |
| recent_active_fanmarks | T:1909; R:2963; F src/components/RecentFanmarksScroll.tsx and src/hooks/useFanmarkSearch.tsx; UI calls list_recent_fanmarks through the shared loader | D1 query behind the reviewed Worker public projection; frontend continues using the API/RPC boundary | The recent Worker route and frontend selector are enabled on workers.dev staging; a current read-only GET returned HTTP 200 (see `live-observations.md`). No real user rows are staged, so source-row parity remains for the final data phase and production/default routing remains Supabase. |

## Public functions and RPCs

The live catalog has 58 public function names. The generated type file covers 45
of them; the remaining 13 are trigger/auth/audit helpers that are not a
typed frontend RPC surface. T and M locations are checked-in evidence
locations, not proof that the corresponding snapshot is the live definition.

| Function | Source location | Tentative Worker target | Boundary and evidence | Uncertainty |
| --- | --- | --- | --- | --- |
| activate_notification_worker | T:1929; N:45 | Worker internal | Native Business 0024 generation plus post-commit SQLite Durable Object wake | Local workerd 17/17; bounded source hash review and protected recovery are prepared in `notification-worker-wake.md`. Remote 0024/namespace/alarm activation and runtime acceptance remain pending. |
| activate_notification_worker_on_pending_event | N:45,112; live catalog | Worker internal | Native AFTER INSERT/UPDATE OF status, trigger_at marker when NEW pending; HTTP/scheduled flush after commit | The marker is atomic with event persistence; the D1-to-DO bridge is replayable but not atomic. Local 17/17; staging interrupted-bridge recovery is prepared, unexecuted. Broader catalog gate remains open. See `notification-worker-wake.md`. |
| add_fanmark_favorite | T:1930; F FanmarkAcquisition.tsx:288 | Worker user | Authenticated favorite write in PRODUCT and frontend | Low/medium: preserve saved display spelling and idempotency |
| archive_old_notifications | T:1934; M:66 | Worker internal | D1 scheduled operation moves delivered/failed notifications older than 90 days into `notifications_history`; preserves source fields in `original_data`, limits each invocation to 2,500 rows, and retains rows with conflicting history | Medium: target selector is disabled in staging; source production invocation is unverified, and history purge/long-term retention is undefined |
| check_fanmark_availability | T:1938; F useFanmarkSearch.tsx:281,547 | Worker public | Public advisory availability; preserve earliest current blocker with NULL last | Fresh catalog body review matches `availability-contract.md`; the complete-data latest-license contract is distinct. Public response omits owner/license/config fields. Integrated imported-row parity remains open. |
| check_fanmark_availability_secure | T:1942; M:234 | Worker internal | Registration's server-side active perpetual/finite and grace blocker check | Fresh body review matches the advisory blocker predicate. Registration rechecks inside its transaction; advisory availability never grants acquisition. See `fanmark-search-api.md` and `fanmark-registration-api.md`. |
| check_username_availability_secure | T:1946; F useProfile.tsx:94, src/lib/profile-utils.ts:48 | Worker user | Profile username check | Medium: pre-auth versus authenticated use and normalization need confirmation |
| classify_fanmark_tier | T:1950; F E:register-fanmark | Worker internal | Tier decision in registration flow | Low/medium: preserve PRODUCT tier boundaries and Unicode normalization |
| count_fanmark_emoji_units | T:1959; M:343 | Derived artifact / Worker internal | Pure normalization/tier helper | Medium: implement once and use the same helper in availability and registration |
| create_notification_event | T:1960; F AdminNotificationManager.tsx:58; F E:check-expired-licenses | Worker internal/admin | Event creation from admin and lifecycle operations | Medium: dedupe and trigger timing require durable queue semantics |
| deactivate_notification_worker_if_idle | T:1970; N:45 | Worker internal | Short serialized DO reconciliation and native generation CAS; empty queue deletes alarm | Local 17/17 covers enqueue/sleep race, future pending, stale processing and outage retention. Current remote staging still uses minute Cron; real alarm NULL-after-drain acceptance is pending. See `notification-worker-wake.md`. |
| generate_safe_display_name | T:1971; M:425 | Worker internal | Auth/user provisioning helper | High: no frontend callsite; preserve collision and localization behavior only after confirmation |
| generate_transfer_code_string | T:1975; M:446; F E:generate-transfer-code | Worker internal | AuthCode generation helper | Medium: entropy, expiry, and one-code invariants need tests |
| get_fanmark_by_emoji | T:1976; F FanmarkAccess.tsx | Worker public | Public access by emoji path; explicit frontend read selector uses the reviewed public projection | Medium: anonymous public D1 reads are selected in staging; locked content uses the separate guarded verification API, and production/default routing plus historical analytics remain on Supabase |
| get_fanmark_by_short_id | T:1992; F FanmarkAccessByShortId.tsx, useFanmarkByShortId.ts | Worker public | Public short-id access and QR lookup use the same opt-in projection; OGP remains separate | Medium: local D1 projection tests pass; Worker mode declines locked content; owner/history fields use the separately staged details endpoint |
| get_fanmark_complete_data | T:2013; F useFanmarkSearch.tsx:327,560; F preview/settings pages | Worker public/user | Search uses a narrow DTO and Better Auth session-derived pending lottery state; settings/profile use separate owner APIs | Fresh body review and full-schema native D1 search 12/12 cover real sessions, anonymous state, caller-ID refusal, lifecycle precision and config omission. Source latest NULL-first ordering is retained; NULL-end history ties and imported-row parity remain open. See `fanmark-search-api.md`. |
| get_fanmark_details_by_short_id | T:2043; F useFanmarkDetails.tsx:66 | Worker public/user | Staging `POST /api/fanmarks/details` returns anonymous-redacted or Better Auth session-scoped whois/history and favorite state | Local owner/other-user tests and a rendered staging `/f/:shortId` canary pass. The synthetic owner sees one history row; after session-cookie removal the anonymous page shows no history/owner name. Imported-row parity and production route remain open. |
| get_fanmark_ownership_status | T:2073; M:807 | Worker user/internal | Legacy license-ID ownership helper | Fresh definition excludes NULL-end licenses; no executable frontend/Edge call or name mention in other captured function bodies. External consumers remain unverified. Do not use as Worker authorization; see `public-profile-runtime-review.md`. |
| get_favorite_fanmarks | T:2080; F useFavoriteFanmarks.ts:33 | Worker user | Session owner's favorites; target redacts protected name/target/text for owner and other users alike | Fresh source selects raw protected fields; target intentionally follows the existing verified-access boundary instead. Native D1 11/11/client6/6 and CI20026f7 pass; deployed acceptance is pending. Source/default is unchanged. See `favorites-api.md`. |
| get_public_emoji_profile | T:2107; F useEmojiProfile.tsx; F E:fanmark-ogp | Worker public | Published-profile, short-ID, emoji-path, and QR reads use the reviewed Worker projection when `VITE_PUBLIC_ACCESS_READ_BACKEND=worker`; OGP uses the same mapper | Local split-D1 tests and synthetic staging reads (200/no-store) pass. No real profiles are staged, so media/source-row parity and production/default routing remain open. See `public-access-contract.md` and `fanmark-ogp-api.md`. |
| get_public_fanmark_profile | T:2119; M:903 | Worker public | Legacy fanmark-ID profile RPC; actual UI/OGP uses license-ID `get_public_emoji_profile` | Fresh definition references missing `fanmark_profiles.fanmark_id`. No executable frontend/Edge callsite; external consumers remain unverified. Do not invent a compatibility column/route; see `public-profile-runtime-review.md`. |
| get_unread_notification_count | T:2132; F useUnreadNotifications.ts:18 | Worker user | Authenticated inbox count | 2026-10-02 production schema-only readback confirms `SECURITY DEFINER` trusts supplied `user_id_param` and execution is granted to `anon`; the function exposes a per-user count but not notification content. Worker API derives the owner from the Better Auth session, tightening access. Treat as an explicit authorization change, not exact parity. See `live-observations.md` |
| get_waitlist_email_by_id | T:2136; M:957; F SecureWaitlistAdmin.tsx:107 | Worker admin | Restricted waitlist email lookup | High: keep behind an explicit admin operation and audit path |
| get_waitlist_secure | T:2140; M:1019; F SecureWaitlistAdmin.tsx:76 | Worker admin | Restricted waitlist listing | Medium: pagination and PII projection need API definition |
| has_active_transfer | T:2150; M:1131; F E:return-fanmark, E:extend-fanmark-license | Worker user/internal | Transfer lock guard in lifecycle operations | Low/medium: preserve lock window and race behavior |
| has_role | T:2151; R:1222; P:ARCHITECTURE authz section | Worker internal/admin | Central role check used by admin gates | High: role source and bootstrap must be mapped before replacing RLS |
| is_admin | T:2158; R:1238; F AdminApp.tsx:43 | Worker admin/internal | Admin gate and maintenance bypass | Medium: do not use a client-supplied role; define server-side session check |
| is_fanmark_licensed | T:2159; M:1161 | Worker internal/user | Legacy license-ID state helper | Fresh definition excludes perpetual NULL-end licenses. No executable frontend/Edge call or other captured function body mention; external consumers remain open. Worker authorization uses explicit owner/active/finite-or-perpetual predicates. See `public-profile-runtime-review.md`. |
| is_fanmark_password_protected | T:2163; M:1177 | Worker public | Safe password-protection flag for access flow | Medium: never expose password material; pair with rate-limited verify operation |
| is_super_admin | T:2167; R:1299; F SecureWaitlistAdmin.tsx:48 | Worker admin | Elevated admin gate | High: map role hierarchy and recovery path separately |
| link_fanmark_discovery | T:2168; M:1190; 2026-10-02 schema-only definition readback | Worker internal | Source matches ordered normalized UUID sequences, updates discovery fanmark_id/owned_by_user, then links all favorites of that discovery | Additive Business migration 0022 links discoveries/all owners’ favorites atomically for every new fanmark writer. Ordered UUID case/NULL/JSON whitespace semantics are preserved; failures/suppressed updates/ambiguous identity abort registration. Local registration suite 18/18. Business 0022 exact trigger/ledger and guarded deployed registration/favorites API/cleanup verification passed on Worker 1eb5d9ac. |
| list_recent_fanmarks | T:2172; F RecentFanmarksScroll.tsx and useFanmarkSearch.tsx | Worker public | Recent list for landing page and search, capped by limit; the shared frontend loader selects the Worker API on workers.dev staging and retains Supabase as the default fallback | Local adapter contracts pass and the live staging GET returned HTTP 200 (see `live-observations.md`). No real user rows are staged; source-row parity and production/default routing remain for the final data/cutover phases. |
| mark_all_notifications_read | T:2182; F Notifications.tsx:111 | Worker user | Authenticated inbox mutation | Low/medium: bind user identity to session |
| mark_notification_read | T:2186; F AppHeader.tsx:139, Notifications.tsx:79 | Worker user | Authenticated inbox mutation | Low/medium: bind notification ownership to session |
| normalize_emoji_ids | T:2190; M:1483 | Derived artifact / Worker internal | Canonical emoji identity helper | Low/medium: must be shared by search, registration, and uniqueness |
| record_fanmark_search | T:2191; F useFanmarkSearch.tsx:301 | Worker public (staging); Supabase default | Search-side aggregate update; D1 event uses `user_id = NULL` | Medium: deployed staging D1 path has a 120/min hashed-IP limiter; historical user-attributed events remain for final user-data migration |
| remove_fanmark_favorite | T:2195; F FanmarkAcquisition.tsx:279 | Worker user | Authenticated favorite delete | Low/medium: preserve idempotent delete behavior |
| render_notification_template | T:2199; M:1628; F E:process-notification-events | Worker internal | Notification rendering helper | Medium: template version/locale behavior needs parity fixtures |
| search_fanmarks_with_lottery | T:2208; M:1685 | Worker public/user | Combined advisory earliest-blocker availability and caller-derived pending lottery state | Fresh definition reviewed; only its generated type declaration was found in current frontend/Edge files. No literal invocation was found, but external/dynamic callers remain unknown; do not mark this ordinary function inactive. Actual search uses separate availability/details APIs. See `fanmark-search-api.md`. |
| seq_key | T:2212; M:1830 | Derived artifact / Worker internal | Stable discovery/favorite key helper | Medium: preserve ordering and normalization exactly |
| toggle_fanmark_favorite | T:2213; M:1885 | Worker user | Favorite toggle helper | High: no current frontend callsite found; keep only if a live caller remains |
| upsert_fanmark_discovery | T:2217; M:1934 | Worker internal | Search/favorite aggregate write | Medium: use atomic increments and avoid user-level event exposure |
| upsert_fanmark_password_config | T:2221; F FanmarkSettings.tsx:443,452,462 | Worker user | Owner password settings mutation | High: password storage and reauthentication behavior need a dedicated design |
| use_invitation_code | T:2229; F useAuthForm.tsx:165, useInvitationCode.tsx:56 | Worker public/user | Signup-time code consumption | Medium: make decrement and expiry checks atomic |
| validate_invitation_code | T:2237; F useAuthForm.tsx:126, useInvitationCode.tsx:25 | Worker public | Pre-auth invitation validation | Medium: response must avoid code enumeration |
| verify_fanmark_password | T:2245; F PasswordProtection.tsx:32 | Worker public | Public access verification | High: rate limits, hash compatibility, and failure logging remain to be specified |
| handle_new_user | M:1079 | Worker internal / retain Auth trigger behavior | New-user settings/provisioning hook | High: map Auth provider lifecycle and retry semantics before moving |
| link_fanmark_discovery_trigger | M:1220; 2026-10-02 schema-only definition readback | Business D1 trigger or atomic registration transaction | Source fanmarks INSERT invokes link_fanmark_discovery(NEW.id, NEW.normalized_emoji_ids) | Implemented by native AFTER INSERT trigger in Business migration 0022. Local API/native-writer, ordering, null/case, rollback/retry and duplicate-identity coverage passes; remote migration/exact trigger and guarded synthetic registration/favorites API readback/cleanup passed. |
| log_emoji_master_changes | M:1251; 2026-10-02 schema-only definition readback | Master D1 native triggers and transaction-scoped administrator context | Additive Master migration 0008 records the source INSERT/UPDATE/DELETE action, actor, emoji UUID, emoji/short_name metadata and operation time. Authenticated draft writes and per-row audits share a Master D1 batch; trusted CLI writes retain NULL actors. Missing/corrupted audits abort the mutation. | Local D1 fault/bulk/concurrent-actor tests and staging exact trigger/TOTP/100-row import/102-audit/public-catalog/cleanup verification pass. Administrator user-detail now merges Business/Auth/Master latest-20 audits; local D1 tests pass 14/14. Extended staging latest-20 exact history API readback/cleanup passed on Worker 1eb5d9ac; authenticated desktop rendered history acceptance passed: 20 rows matched their exact API order/metadata, including 18 Master audits, with screenshot and scoped cleanup. Published release activation audits are separate. See emoji-master-change-audit.md; broad functions/RLS/triggers gate remains. |
| log_lottery_entry_changes | M:1309 | Worker internal | Lottery audit trigger helper | High: preserve audit ordering with lottery writes |
| log_profile_cache_access | M:1358 | Worker internal / derived artifact | Profile cache/audit helper | 2026-10-03 all-schema source binding readback finds no registered trigger/event binding for the exact reviewed definition. Do not introduce a logging trigger; see `source-runtime-review.md`. Source definition remains recorded. |
| log_waitlist_access | M:1388 | Worker internal | Waitlist audit helper | 2026-10-03 all-schema readback confirms the exact trigger function is unbound. Do not add its trigger; active waitlist RPC audit effects are separately reproduced by the Worker. See `source-runtime-review.md`. |
| notify_security_breach | M:1549; 2026-10-02 schema-only definition readback | Worker structured security diagnostics | Source emits a database NOTICE for UNAUTHORIZED_WAITLIST_ACCESS or UNAUTHORIZED_EMAIL_ACCESS; its definition makes no external delivery call. | Target retains denied list/email actions in D1; email denial now preserves resource ID/CRITICAL_RISK/email_address. A bounded post-commit Worker warning carries only action/audit ID/time; raw actor/email/IP/credentials stay out. Local 9/9 includes exact correlation and audit-failure closed behavior. Worker 4199fd09 staging authorized/denied canary, exact live operator-log/D1 audit correlation and scoped cleanup passed; external alert delivery is not an existing source integration. |
| prevent_user_settings_insert_escalation | S:46 | Worker internal | User-settings write guard / trigger replacement | Source service-role bypass and non-admin plan invariants were reviewed against own-profile exact allowlist/no INSERT and server-Free signup provisioning; local profile/signup D1 tests pass 10/10 each. See source-user-settings-guards.md. Imported roles and broad catalog gate remain. |
| prevent_user_settings_privilege_escalation | S:15 | Worker internal | User-settings write guard / trigger replacement | Source service-role bypass and non-admin plan invariants were reviewed against own-profile exact allowlist/no INSERT and server-Free signup provisioning; local profile/signup D1 tests pass 10/10 each. See source-user-settings-guards.md. Imported roles and broad catalog gate remain. |
| sync_public_profile_cache | M:1855 | Derived artifact / Worker internal | Public profile cache maintenance | 2026-10-03 all-schema source binding readback confirms this exact trigger function is unbound. Do not introduce a cache-maintenance trigger. Public profile RPC/read projection needs its separate runtime review; see `source-runtime-review.md`. |
| update_updated_at_column | M:1922 | Worker internal or D1 trigger | Generic timestamp helper | Low/medium: D1 trigger support and write ownership determine implementation |
| validate_display_name | M:2054 | Derived artifact / Worker internal | Display-name validation helper | 2026-10-03 all-schema readback confirms this exact trigger function is unbound. Do not add automatic display-name rewriting to the Worker. Its ordinary helper `generate_safe_display_name` retains separate RPC review; see `source-runtime-review.md`. |

The following 13 names are live-only relative to generated
types: activate_notification_worker_on_pending_event,
handle_new_user, link_fanmark_discovery_trigger,
log_emoji_master_changes, log_lottery_entry_changes,
log_profile_cache_access, log_waitlist_access, notify_security_breach,
prevent_user_settings_insert_escalation,
prevent_user_settings_privilege_escalation, sync_public_profile_cache,
update_updated_at_column, and validate_display_name.

## Edge entrypoints

Each local entrypoint is a candidate Worker route. The existing inventory's
verify_jwt value is a checked-in config observation, not a complete
authorization decision; the target boundary below is the proposed contract.

| Entrypoint | Local source | Tentative Worker boundary | Uncertainty / decision |
| --- | --- | --- | --- |
| admin-expire-license | E: supabase/functions/admin-expire-license/index.ts | Worker admin | Implemented for workers.dev staging in `docs/migration/admin-license-expiry-api.md`; same-session MFA, ownership binding, atomic expiry/config cleanup/audit/notification, and synthetic rollback/idempotency tests are covered. Production remains on Supabase. |
| admin-get-user-detail | E: supabase/functions/admin-get-user-detail/index.ts | Worker admin | Staging D1 route and same-origin frontend adapter are implemented; MFA, bounded projections, and sensitive-field redaction are tested. The authenticated staging browser canary rendered the synthetic cross-D1 row/detail and passed plan and suspend/restore UI round-trips with D1/Auth/audit readback and cleanup (2026-09-28). Real-user parity remains open; see the admin user-management browser acceptance record in `HANDOFF.md`. |
| admin-list-users | E: supabase/functions/admin-list-users/index.ts | Worker admin | Staging D1 route and same-origin frontend adapter are implemented; pagination, filters, session/license projections, MFA, and PII minimization have synthetic coverage. The authenticated staging browser canary rendered the synthetic cross-D1 row/detail and passed plan and suspend/restore UI round-trips with D1/Auth/audit readback and cleanup (2026-09-28). Real-user parity remains open; see the admin user-management browser acceptance record in `HANDOFF.md`. |
| admin-toggle-user-status | E: supabase/functions/admin-toggle-user-status/index.ts | Worker admin | Implemented for workers.dev staging in `docs/migration/admin-user-status-api.md`; Auth D1 suspension state, session revocation, same-batch Auth audit, and same-session MFA are covered. Production remains on Supabase. |
| admin-trigger-password-reset | E: supabase/functions/admin-trigger-password-reset/index.ts | Worker admin / retain Auth | Implemented locally for workers.dev staging in `docs/migration/admin-password-reset-api.md`; reset tokens remain inside Better Auth and email delivery fails closed without Resend configuration. |
| admin-update-user-plan | E: supabase/functions/admin-update-user-plan/index.ts | Worker admin/internal | MFA-gated D1 update is selected on staging; a synthetic Free→Enterprise→Max→Free canary verified atomic settings, overrides, audit, and restoration. Production routing and real-user acceptance remain open. |
| apply-extension-coupon | E: supabase/functions/apply-extension-coupon/index.ts | Worker user | Medium: coupon redemption must be atomic |
| apply-fanmark-lottery | E: supabase/functions/apply-fanmark-lottery/index.ts | Worker user | Medium: preserve one-entry and grace checks |
| apply-transfer-code | E: supabase/functions/apply-transfer-code/index.ts | Worker user | Medium: preserve participant and expiry checks |
| approve-transfer-request | E: supabase/functions/approve-transfer-request/index.ts | Worker user | Medium: owner approval and finalization must be atomic |
| bulk-return-fanmarks | E: supabase/functions/bulk-return-fanmarks/index.ts | Worker user | Resolved: process each license independently and return partial failures as 207, matching the source contract; audit/notification effects remain best-effort |
| cancel-lottery-entry | E: supabase/functions/cancel-lottery-entry/index.ts | Worker user | Medium: preserve lottery state transitions |
| cancel-transfer-code | E: supabase/functions/cancel-transfer-code/index.ts | Worker user | Medium: preserve transfer lock release |
| change-subscription | E: supabase/functions/change-subscription/index.ts | Worker user/internal + retain Stripe | High: proration, downgrade selection, and webhook reconciliation |
| check-email-exists | E: supabase/functions/check-email-exists/index.ts | Worker public/user auth helper | High: response must not enable account enumeration |
| check-expired-licenses | E: supabase/functions/check-expired-licenses/index.ts | Worker internal Cron | Synthetic source-shaped D1 and deployed staging Cron canaries cover expiry, grace finalization, lottery issuance, notifications, baseline restoration, and cleanup. Recurring production activation, CPU/plan fit, and imported-row parity remain open. See `license-expiry-proof.md` and `lottery-selection.md`. |
| check-subscription | E: supabase/functions/check-subscription/index.ts | Worker user/internal + retain Stripe | Medium: polling response and D1 mirror freshness |
| create-checkout | E: supabase/functions/create-checkout/index.ts | Worker user + retain Stripe | Medium: checkout ownership and redirect validation |
| create-extension-checkout | E: supabase/functions/create-extension-checkout/index.ts | Worker user + retain Stripe | Medium: price lookup and license binding |
| customer-portal | E: supabase/functions/customer-portal/index.ts | Worker user + retain Stripe | Medium: portal session ownership |
| delete-user-account | E: supabase/functions/delete-user-account/index.ts | Worker user/internal + retain Auth; staged `POST /api/me/account/delete` coordinator | Medium: local D1/Stripe tests and a live synthetic staging deletion/readback pass; populated Stripe customer cancellation, concurrent-transfer recovery, imported credential compatibility, and production cutover remain unverified. The direct Better Auth delete route stays closed. See `docs/migration/account-deletion-api.md`. |
| extend-fanmark-license | E: supabase/functions/extend-fanmark-license/index.ts | Worker user + retain Stripe | Medium: grace, lottery, and payment invariants |
| fanmark-ogp | E: supabase/functions/fanmark-ogp/index.ts | Worker public | The workers.dev Worker serves crawler metadata through the reviewed public D1 projection; protected content receives generic metadata. Browser/crawler, privacy, and escaping tests pass. Real-profile rendering and production routing remain unverified. See `fanmark-ogp-api.md`. |
| generate-ogp-image | E: supabase/functions/generate-ogp-image/index.ts | Worker public / derived artifact | The workers.dev Worker serves bounded, XML-escaped SVG from `/api/ogp-image`; input and cache behavior have local tests and live staging checks. Existing production function and routing remain unchanged. See `fanmark-ogp-api.md`. |
| generate-transfer-code | E: supabase/functions/generate-transfer-code/index.ts | Worker user | Medium: code entropy and transfer lock |
| handle-stripe-webhook | E: supabase/functions/handle-stripe-webhook/index.ts | Worker internal webhook + retain Stripe | High: signature verification, idempotency, and replay handling |
| process-notification-events | E: supabase/functions/process-notification-events/index.ts | Worker internal Cron/alarm | Staging in-app processing is accepted through minute Cron. Pending-only SQLite DO wake/sleep is local 17/17 with a journaled TOTP alarm rehearsal prepared; remote activation/acceptance remain pending. External channels, remaining sources and production CPU/operational fit remain open. See `notification-worker-wake.md`. |
| record-fanmark-access | E: supabase/functions/record-fanmark-access/index.ts | Worker public ingress → D1 atomic log + daily aggregate; paired with owner-scoped `/api/me/analytics/*` readers on workers.dev staging | Medium: historical data stays in Supabase; abuse controls, retention, populated-user authorization, and production CPU/plan fit remain open |
| register-fanmark | E: supabase/functions/register-fanmark/index.ts | Worker user | Medium: D1 transaction must cover registry, license, discovery, and audit |
| reject-transfer-request | E: supabase/functions/reject-transfer-request/index.ts | Worker user | Medium: participant authorization and notification |
| reset-fanmark-data | Legacy administrator screen deletes eight tables sequentially, excludes nil UUID and ignores per-delete errors | Staging MFA/Origin/DELETE-protected Worker API plus Business 0023 native atomic command/audit/receipt; same-ID retry does not delete later rows | Local full-schema D1 15/15, row guard 2/2 and frontend 6/6. Restrictive source coupon/target lifecycle history stays protective. Worker 13dca8cf passed guarded synthetic TOTP/API eight-row reset, later-row retry, role denial, typed DELETE desktop result and retained Master/Auth/scoped cleanup. Ledger 24; temporary guards/receipts and source user/Auth rows returned to zero. Mobile and production remain unverified. See admin-data-reset-api.md |
| return-fanmark | E: supabase/functions/return-fanmark/index.ts | Worker user | Medium: grace transition and notification side effects |
| send-auth-email | E: supabase/functions/send-auth-email/index.ts | Worker internal + retain Auth/email provider | High: provider lifecycle and template ownership |
| send-broadcast-email | E: supabase/functions/send-broadcast-email/index.ts | Worker admin/internal + retain Resend | High: recipient selection, retries, and opt-out behavior |
| manual-expire-grace-licenses | Local Supabase source now has a guarded replacement, but live version 14 remains deployed without an administrator/MFA gate; no repository caller was found | MFA-protected `/api/admin/license-expiry/run` uses the D1 lifecycle engine. The local Supabase source preserves the bulk operation behind administrator + current-session AAL2 authorization; it is prepared, not deployed. | High: verify external callers/schedules and review the remaining non-transactional legacy effects before deploying or retiring; no production invocation/change was made |

The guarded source is counted as a local Edge Function entrypoint, while the
read-only deployed inventory still records version 14 as the active
production implementation. Its lack of an in-repository caller does not rule
out external schedules or manual invocation; those need a separate
operator-side review before production retirement.

The read-only review maps scheduled behavior to the D1 lifecycle Cron. The new
on-demand route is a replacement for the app's existing manual batch button,
not proof of behavioral equivalence with the live-only function. External
invocations remain unknown, so retirement still requires an operator-side
caller/schedule review.

## Non-table dependencies

| Dependency observed in the repository | Tentative migration treatment | Source / open mapping |
| --- | --- | --- |
| Supabase Auth and auth.uid() / auth.users | Retain an Auth provider; Worker establishes the user identity used by D1 authorization. The 11 exact business-to-Auth references are omitted as cross-DB D1 constraints and recorded as reviewed dispositions; snapshot import still preflights every non-NULL Auth UUID before business writes. Account deletion applies the source CASCADE/SET NULL/NO ACTION behavior in the Worker operation. | Frontend auth calls in src/**/*; `supabase/remote_schema.sql`; `scripts/migration/schema-convert.mjs`; `scripts/migration/d1-import.mjs`; account-deletion D1 tests. Provider, redirect, and session claims still need live verification. |
| Storage buckets avatars, cover-images | Retain as R2 or selected object storage; Worker issues the public or signed URL boundary | src/hooks/useAvatarUpload.tsx:28,38,101; src/hooks/useCoverImageUpload.tsx:28,38,107; SQL storage refs in repository-inventory.md |
| Stripe checkout, customer portal, and webhooks | Retain Stripe; Worker owns authenticated initiation and idempotent webhook projection into user_subscriptions | PRODUCT:73-84,453-482; D1 webhook/reconciliation and owner-bound Free-to-paid/paid-plan commands are implemented and staged behind disabled Stripe selectors; sandbox acceptance and remaining billing effects/operations remain |
| Resend/auth and broadcast email delivery | Retain delivery provider; Worker internal queue and template projection | TECH email guidance; send-auth-email, send-broadcast-email, notification pipeline |
| pg_cron, pg_net, and Realtime channels | Worker Cron handles staging notification processing; lifecycle scheduling is deployed but its execution selector remains unset. Worker-backed notification views use foreground polling, own-profile views use same-tab events plus foreground refresh, and subscription views refresh on focus/visibility plus a 30-second foreground poll. Supabase-selected builds retain Realtime. | `supabase/config.toml:60-84`; `notifications-api.md`; `own-profile-api.md`; `HANDOFF.md`. Source scheduler shutdown/drain and production scale/latency acceptance remain for the final rehearsal/cutover. |

## Current unresolved design and acceptance gates (2026-09-27)

1. `recent_active_fanmarks` and `list_recent_fanmarks` have a source-shaped D1
   query, staging Worker route, and Worker-backed SPA selector. Synthetic
   route/contract checks pass. Imported-row parity remains in the final
   user-data phase; it is no longer an unimplemented staging route.
2. The live catalog has 58 function names while generated types expose 45
   frontend RPC names. This map now lists the function/helper dispositions;
   the remaining review is to confirm caller and schedule ownership for
   trigger/auth/audit helpers, especially live-only
   `manual-expire-grace-licenses`, before production retirement or activation.
3. Public projections for fanmarks, licenses, profile/configuration, and
   notifications are implemented for the documented staging routes. Imported
   source-row parity and the remaining browser acceptance are still open.
4. D1 transaction boundaries and synthetic tests exist for registration,
   lifecycle, lottery, transfer, coupon, and notification paths. The coordinated
   integrated rehearsal in [#37](https://github.com/kanouk/fanmark-id/issues/37)
   still needs its full synthetic write/recovery sequence; individual canaries
   do not close that gate. The authenticated admin user-management UI has now
   passed a synthetic Free→Max→Free and suspend/restore browser round-trip with
   D1/Auth/audit readback and cleanup (2026-09-28); this closes that UI subgate
   only.
5. User-owned tables and non-user allowlists are classified in the migration
   plan. Real user/Auth/object export is deferred to #38. Product-level audit,
   notification-history, and waitlist retention decisions remain open where
   the source behavior does not define a retention period.
6. Better Auth, R2, D1 selectors, Cron paths, and Worker replacements for the
   frontend Realtime channels are staged. Resend and Stripe acceptance still
   require test-provider configuration; production writer/schedule handoff
   stays in the final cutover phase. No production schedule or provider was
   changed by the staging work.

This map is intentionally a design input. It does not claim that local
snapshots, current policies, or the observed live metadata are sufficient to
deploy a replacement.

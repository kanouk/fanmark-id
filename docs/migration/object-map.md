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
| broadcast_emails | RLS; 1/3/1 | T:50; F src/components/AdminBroadcastEmail.tsx:144,240 | D1 admin queue/record; Worker admin creates, Worker internal sends; retain Resend delivery | Medium: delivery state and retry ownership need a queue decision |
| email_templates | RLS; 2/2/1 | T:107; F src/components/AdminEmailTemplates.tsx:48,61 | D1 config; Worker admin edits, Worker internal renders and sends | Medium: template versioning and locale fallback are not fixed |
| emoji_master | RLS; 2/2/2 | T:143; F src/components/AdminEmojiMaster.tsx:60,131; F src/lib/emoji-master-utils.ts:120 | D1 reference table; Worker public reads safe catalog, Worker admin updates; derived search catalog may be generated | Medium: preserve live DB UUIDs as initial migration authority; Unicode source updates and versioned catalog publication follow a separate release |
| enterprise_user_settings | RLS; 2/2/1 | T:182; R:2370 | D1 private table; Worker user/admin as applicable, Worker internal for enterprise automation | High: no frontend callsite in the offline inventory; confirm product owner and fields |
| extension_coupon_usages | RLS; 3/4/0 | T:215; F src/hooks/useExtensionCouponAdmin.ts | D1 append-only usage table; atomic Worker command records redemption, MFA admin reads joined display DTO | Existing usage rows remain in Supabase until the separately excluded user-data migration; enforce per-coupon/user/fanmark uniqueness in D1 |
| extension_coupons | RLS; 1/3/1 | T:271; F src/hooks/useExtensionCouponAdmin.ts | D1 coupon master; MFA Worker admin creates/updates activation, Worker user applies through atomic operation | Staging API is implemented; existing coupon rows and usage counts are not imported |
| fanmark_access_daily_stats | RLS; 1/4/0 | T:313; F src/components/FanmarkDashboard.tsx:551; F src/pages/Analytics.tsx:159 | D1 derived aggregate; Worker internal updates, Worker user reads owned fanmark stats, Worker admin reads as needed | Medium: aggregation window, timezone, and rebuild path are unverified |
| fanmark_access_logs | RLS; 1/3/0 | T:401; R:2459; P analytics | D1 append-only log; Worker public ingress writes through a bounded operation, Worker user reads owned data, Worker internal aggregates | Medium: retention and abuse/rate limits need a decision |
| fanmark_availability_rules | RLS; 2/4/1 | T:480; F src/components/AdminPatternRules.tsx:37,57,90 | D1 config; MFA-protected Worker admin API reads/writes staging rules, Worker availability path reads active rules | Medium: staging admin DTO/CAS is verified; full precedence with tiers and reserved patterns still needs a test matrix |
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
| fanmark_tier_extension_prices | RLS; 1/5/1 | T:1065; F src/components/AdminTierExtensionPrices.tsx:55,119; F src/components/ExtendLicenseDialog.tsx:84 | D1 config; Worker public reads active prices, Worker admin updates, Worker user consumes via checkout operation | Medium: Stripe price mapping remains external and must be validated against settings |
| fanmark_tiers | RLS; 4/2/1 | T:1101; F src/components/AdminTierExtensionPrices.tsx:60,327; P:13-17 | D1 config; Worker public reads active tier data, Worker admin updates, Worker internal classifies | Medium: keep tier rules and license-day behavior consistent with PRODUCT |
| fanmark_transfer_codes | RLS; 3/5/1 | T:1143; F src/hooks/useTransferCode.ts:49; P:24-27 | D1 transactional table; Worker user owner/recipient operations, Worker admin/internal lifecycle checks | Medium: one-code/expiry/transfer-lock invariants need D1 transaction tests |
| fanmark_transfer_requests | RLS; 3/5/1 | T:1204; F src/hooks/useTransferCode.ts:82,121; P:24-27 | D1 transactional table; Worker user participants approve/reject, Worker internal finalizes | Medium: ownership checks and copy-on-transfer behavior need end-to-end mapping |
| fanmarks | RLS; 2/8/2 | T:1284; R:2775; P:6-10,76-83 | D1 authoritative registry; Worker public reads active registry projection, Worker user/admin/internal create or update through operations | Low/medium: public fields are intentional by product design, but exact projection and uniqueness must be preserved |
| invitation_codes | RLS; 1/5/1 | T:1323; F src/hooks/useInvitationAdmin.ts:26,57,74,98; P:44-48 | D1 table; Worker public validates, Worker user consumes during signup, Worker admin manages | Medium: consumption must be atomic across retries |
| languages | RLS; 2/2/1 | T:1362; F src/hooks/useLanguages.tsx:42 | D1 reference table or derived static artifact; Worker public reads, Worker admin/internal updates | High: no product-level write path found; choose static versus authoritative table |
| notification_events | RLS; 2/4/2 | T:1395; F src/components/AdminNotificationManager.tsx:83; P:34-36 | D1 durable queue; Worker internal creates/processes, Worker admin inspects | High: pending-event wakeup must become an atomic Worker queue/cron design |
| notification_preferences | RLS; 1/4/1 | T:1446; R:2843; P:34-36 | D1 user settings; Worker user reads/writes own preferences, Worker internal evaluates | Medium: no direct frontend callsite in the inventory; confirm channel and default behavior |
| notification_rules | RLS; 1/4/1 | T:1476; F src/components/AdminNotificationManager.tsx:113,141; P:34-36 | D1 config; Worker admin writes, Worker internal evaluates | Medium: rule expression and evaluation order need an API/schema decision |
| notification_templates | RLS; 2/3/1 | T:1536; F src/components/AdminNotificationManager.tsx:127,162; P:34-36 | D1 config; Worker admin writes, Worker internal renders | Medium: versioning and locale fallback need parity tests |
| notifications | RLS; 4/7/1 | T:1581; F src/pages/Notifications.tsx:38,79,111; P:34-36 | D1 user inbox; Worker internal inserts, Worker user reads/marks own, Worker admin reads as needed | Medium: Realtime replacement and expiry semantics require a delivery design |
| notifications_history | RLS; 1/1/0 | T:1662; R:2949; P:34-36 | D1 archive or derived artifact; Worker internal archives, Worker admin reads | High: no frontend callsite; determine retention and whether D1 is the long-term store |
| reserved_emoji_patterns | RLS; 1/2/1 | T:1680; R:2977; P:13-17 | D1 config or derived lookup artifact; Worker public reads active rules, Worker admin updates | Medium: precedence with availability rules and tier classification needs explicit tests |
| system_settings | RLS; 3/3/1 | T:1710; F src/hooks/useSystemSettings.tsx:59,129; P:66-71 | D1 config; Worker public reads explicitly public settings, Worker admin writes, Worker internal reads secrets only through a private path | Medium: separate public settings from private payment/operational settings before API design |
| user_roles | RLS; 2/4/0 | T:1740; R:3006; F src/components/AdminApp.tsx:43 | D1 authz table; Worker internal/admin authorization checks, no public row API | High: role source of truth and bootstrap/recovery path require explicit design |
| user_settings | RLS; 3/5/3 | T:1764; F src/hooks/useProfile.tsx:46,72; P:44-48,81-83 | D1 private user table; Worker user reads/writes own, Worker admin reads only required fields | Medium: PII projection, account deletion, and Auth linkage need a data-classification decision |
| user_subscriptions | RLS; 3/3/1 | T:1817; F src/hooks/useSubscription.tsx:86,170; P:73-84,453-482 | D1 billing mirror; Worker user reads own status, Worker internal webhook syncs, Worker admin reads; retain Stripe as payment system | High: webhook idempotency and source-of-truth rules are not established by local code alone |
| waitlist | RLS; 2/4/0 | T:1883; F src/hooks/useInvitationCode.tsx:83; P:44-48 | D1 private table; Worker public/user submits, Worker admin reads through a restricted operation | High: email PII retention and export/deletion behavior require a decision |

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
notification rules/templates use documented row/field allowlists; coupons,
tier-extension prices, and remaining candidates still require per-table
allowlists before export. Coupon configuration can move separately from
owner-bound usage records; do not copy `created_by`, usage rows, or infer
redemption history during master-data staging.

## View

| View | Evidence | Tentative target and boundary | Uncertainty / decision |
| --- | --- | --- | --- |
| recent_active_fanmarks | T:1909; R:2963; F src/components/RecentFanmarksScroll.tsx and src/hooks/useFanmarkSearch.tsx; UI calls list_recent_fanmarks through the shared loader | D1 query behind the reviewed Worker public projection; frontend continues using the API/RPC boundary | Local Supabase/D1 adapter contract tests pass; staging has only an empty 40-table structural baseline and no explicit recent backend, so the deployed D1 route and production parity remain unverified |

## Public functions and RPCs

The live catalog has 58 public function names. The generated type file covers 45
of them; the remaining 13 are trigger/auth/audit helpers that are not a
typed frontend RPC surface. T and M locations are checked-in evidence
locations, not proof that the corresponding snapshot is the live definition.

| Function | Source location | Tentative Worker target | Boundary and evidence | Uncertainty |
| --- | --- | --- | --- | --- |
| activate_notification_worker | T:1929; N:45 | Worker internal | Cron wakeup used by notification processing | Medium: replace scheduler mutation with an idempotent queue/cron mechanism |
| activate_notification_worker_on_pending_event | N:45,112; live catalog | Worker internal | Notification-event trigger helper | High: live-only body/trigger behavior needs an explicit D1/Worker atomicity design |
| add_fanmark_favorite | T:1930; F FanmarkAcquisition.tsx:288 | Worker user | Authenticated favorite write in PRODUCT and frontend | Low/medium: preserve saved display spelling and idempotency |
| archive_old_notifications | T:1934; M:66 | Worker internal | Retention/archive job | Medium: retention period and history storage are not product-defined |
| check_fanmark_availability | T:1938; F useFanmarkSearch.tsx:281,547 | Worker public | Search/availability response described by PRODUCT and ARCHITECTURE | Medium: response fields and rate limits need an API contract |
| check_fanmark_availability_secure | T:1942; M:234 | Worker internal | Server-side availability guard used by registration logic | Medium: keep it behind registration and do not widen the public response |
| check_username_availability_secure | T:1946; F useProfile.tsx:94, src/lib/profile-utils.ts:48 | Worker user | Profile username check | Medium: pre-auth versus authenticated use and normalization need confirmation |
| classify_fanmark_tier | T:1950; F E:register-fanmark | Worker internal | Tier decision in registration flow | Low/medium: preserve PRODUCT tier boundaries and Unicode normalization |
| count_fanmark_emoji_units | T:1959; M:343 | Derived artifact / Worker internal | Pure normalization/tier helper | Medium: implement once and use the same helper in availability and registration |
| create_notification_event | T:1960; F AdminNotificationManager.tsx:58; F E:check-expired-licenses | Worker internal/admin | Event creation from admin and lifecycle operations | Medium: dedupe and trigger timing require durable queue semantics |
| deactivate_notification_worker_if_idle | T:1970; N:45 | Worker internal | Notification worker sleep decision | High: replace database scheduler mutation after queue design |
| generate_safe_display_name | T:1971; M:425 | Worker internal | Auth/user provisioning helper | High: no frontend callsite; preserve collision and localization behavior only after confirmation |
| generate_transfer_code_string | T:1975; M:446; F E:generate-transfer-code | Worker internal | AuthCode generation helper | Medium: entropy, expiry, and one-code invariants need tests |
| get_fanmark_by_emoji | T:1976; F FanmarkAccess.tsx | Worker public | Public access by emoji path; explicit frontend read selector uses the reviewed public projection | Medium: anonymous public D1 reads are selected in staging; locked content uses the separate guarded verification API, and production/default routing plus historical analytics remain on Supabase |
| get_fanmark_by_short_id | T:1992; F FanmarkAccessByShortId.tsx, useFanmarkByShortId.ts | Worker public | Public short-id access and QR lookup use the same opt-in projection; OGP remains separate | Medium: local D1 projection tests pass; Worker mode declines locked content; owner/history fields use the separately staged details endpoint |
| get_fanmark_complete_data | T:2013; F useFanmarkSearch.tsx:327,560; F preview/settings pages | Worker public/user | Shared read with request-context lottery and owner fields | Medium: split public preview from owner-specific fields in the Worker API |
| get_fanmark_details_by_short_id | T:2043; F useFanmarkDetails.tsx:66 | Worker public/user | Staging `POST /api/fanmarks/details` returns anonymous-redacted or Better Auth session-scoped whois/history and favorite state | Medium: local owner/other-user tests and synthetic staging canary pass; imported-row parity, browser acceptance, and production route remain open |
| get_fanmark_ownership_status | T:2073; M:807 | Worker user/internal | License ownership helper for lifecycle operations | High: no frontend callsite in the inventory; confirm whether it remains an internal helper |
| get_favorite_fanmarks | T:2080; F useFavoriteFanmarks.ts:33 | Worker user | Authenticated user's favorite list | Low/medium: preserve aggregate fields without exposing unrelated user activity |
| get_public_emoji_profile | T:2107; F useEmojiProfile.tsx; F E:fanmark-ogp | Worker public | Published profile read uses the same explicit frontend selector; OGP remains separate | Medium: local D1 projection tests pass; media URL and live staging/business-schema parity remain unverified |
| get_public_fanmark_profile | T:2119; M:903 | Worker public | Published profile projection | High: no direct frontend callsite in the inventory; confirm whether it is legacy or OGP-only |
| get_unread_notification_count | T:2132; F useUnreadNotifications.ts:13 | Worker user | Authenticated inbox count | Low/medium: enforce caller identity rather than trusting an arbitrary user id |
| get_waitlist_email_by_id | T:2136; M:957; F SecureWaitlistAdmin.tsx:107 | Worker admin | Restricted waitlist email lookup | High: keep behind an explicit admin operation and audit path |
| get_waitlist_secure | T:2140; M:1019; F SecureWaitlistAdmin.tsx:76 | Worker admin | Restricted waitlist listing | Medium: pagination and PII projection need API definition |
| has_active_transfer | T:2150; M:1131; F E:return-fanmark, E:extend-fanmark-license | Worker user/internal | Transfer lock guard in lifecycle operations | Low/medium: preserve lock window and race behavior |
| has_role | T:2151; R:1222; P:ARCHITECTURE authz section | Worker internal/admin | Central role check used by admin gates | High: role source and bootstrap must be mapped before replacing RLS |
| is_admin | T:2158; R:1238; F AdminApp.tsx:43 | Worker admin/internal | Admin gate and maintenance bypass | Medium: do not use a client-supplied role; define server-side session check |
| is_fanmark_licensed | T:2159; M:1161 | Worker internal/user | License state helper | High: no direct frontend callsite; align with grace and expiry semantics |
| is_fanmark_password_protected | T:2163; M:1177 | Worker public | Safe password-protection flag for access flow | Medium: never expose password material; pair with rate-limited verify operation |
| is_super_admin | T:2167; R:1299; F SecureWaitlistAdmin.tsx:48 | Worker admin | Elevated admin gate | High: map role hierarchy and recovery path separately |
| link_fanmark_discovery | T:2168; M:1190; F lifecycle Edge helpers | Worker internal | Link newly registered fanmark to discovery aggregate | Medium: transaction boundary with registration must be preserved |
| list_recent_fanmarks | T:2172; F RecentFanmarksScroll.tsx and useFanmarkSearch.tsx | Worker public | Recent list for landing page and search, capped by limit; Supabase RPC remains the unset-origin fallback | Low/medium: local adapter contracts pass; staging business-table parity and deployed route remain unverified |
| mark_all_notifications_read | T:2182; F Notifications.tsx:111 | Worker user | Authenticated inbox mutation | Low/medium: bind user identity to session |
| mark_notification_read | T:2186; F AppHeader.tsx:139, Notifications.tsx:79 | Worker user | Authenticated inbox mutation | Low/medium: bind notification ownership to session |
| normalize_emoji_ids | T:2190; M:1483 | Derived artifact / Worker internal | Canonical emoji identity helper | Low/medium: must be shared by search, registration, and uniqueness |
| record_fanmark_search | T:2191; F useFanmarkSearch.tsx:301 | Worker public | Search-side aggregate update | Medium: public ingress needs rate limits and no user-level tracking |
| remove_fanmark_favorite | T:2195; F FanmarkAcquisition.tsx:279 | Worker user | Authenticated favorite delete | Low/medium: preserve idempotent delete behavior |
| render_notification_template | T:2199; M:1628; F E:process-notification-events | Worker internal | Notification rendering helper | Medium: template version/locale behavior needs parity fixtures |
| search_fanmarks_with_lottery | T:2208; M:1685 | Worker public/user | Search result with lottery state | High: no current frontend callsite found; determine whether it is legacy or required API |
| seq_key | T:2212; M:1830 | Derived artifact / Worker internal | Stable discovery/favorite key helper | Medium: preserve ordering and normalization exactly |
| toggle_fanmark_favorite | T:2213; M:1885 | Worker user | Favorite toggle helper | High: no current frontend callsite found; keep only if a live caller remains |
| upsert_fanmark_discovery | T:2217; M:1934 | Worker internal | Search/favorite aggregate write | Medium: use atomic increments and avoid user-level event exposure |
| upsert_fanmark_password_config | T:2221; F FanmarkSettings.tsx:443,452,462 | Worker user | Owner password settings mutation | High: password storage and reauthentication behavior need a dedicated design |
| use_invitation_code | T:2229; F useAuthForm.tsx:165, useInvitationCode.tsx:56 | Worker public/user | Signup-time code consumption | Medium: make decrement and expiry checks atomic |
| validate_invitation_code | T:2237; F useAuthForm.tsx:126, useInvitationCode.tsx:25 | Worker public | Pre-auth invitation validation | Medium: response must avoid code enumeration |
| verify_fanmark_password | T:2245; F PasswordProtection.tsx:32 | Worker public | Public access verification | High: rate limits, hash compatibility, and failure logging remain to be specified |
| handle_new_user | M:1079 | Worker internal / retain Auth trigger behavior | New-user settings/provisioning hook | High: map Auth provider lifecycle and retry semantics before moving |
| link_fanmark_discovery_trigger | M:1220 | Worker internal | Database trigger replacement for discovery linkage | High: choose D1 trigger versus explicit registration transaction |
| log_emoji_master_changes | M:1251 | Worker internal | Audit trigger helper | High: define audit retention and payload redaction |
| log_lottery_entry_changes | M:1309 | Worker internal | Lottery audit trigger helper | High: preserve audit ordering with lottery writes |
| log_profile_cache_access | M:1358 | Worker internal / derived artifact | Profile cache/audit helper | High: no direct frontend callsite; verify whether it is still required |
| log_waitlist_access | M:1388 | Worker internal | Waitlist audit helper | High: keep PII out of routine logs |
| notify_security_breach | M:1549 | Worker internal | Security notification trigger helper | High: destination, rate limiting, and escalation policy need a separate review |
| prevent_user_settings_insert_escalation | S:46 | Worker internal | User-settings write guard / trigger replacement | High: preserve invariant in a single server-side write path |
| prevent_user_settings_privilege_escalation | S:15 | Worker internal | User-settings write guard / trigger replacement | High: preserve invariant in a single server-side write path |
| sync_public_profile_cache | M:1855 | Derived artifact / Worker internal | Public profile cache maintenance | High: determine whether a D1 read model or on-demand projection is preferable |
| update_updated_at_column | M:1922 | Worker internal or D1 trigger | Generic timestamp helper | Low/medium: D1 trigger support and write ownership determine implementation |
| validate_display_name | M:2054 | Derived artifact / Worker internal | Display-name validation helper | High: no frontend callsite found; confirm whether Auth/user provisioning still uses it |

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
| admin-get-user-detail | E: supabase/functions/admin-get-user-detail/index.ts | Worker admin | High: minimize PII response |
| admin-list-users | E: supabase/functions/admin-list-users/index.ts | Worker admin | High: pagination and PII projection need review |
| admin-toggle-user-status | E: supabase/functions/admin-toggle-user-status/index.ts | Worker admin | Implemented for workers.dev staging in `docs/migration/admin-user-status-api.md`; Auth D1 suspension state, session revocation, same-batch Auth audit, and same-session MFA are covered. Production remains on Supabase. |
| admin-trigger-password-reset | E: supabase/functions/admin-trigger-password-reset/index.ts | Worker admin / retain Auth | Implemented locally for workers.dev staging in `docs/migration/admin-password-reset-api.md`; reset tokens remain inside Better Auth and email delivery fails closed without Resend configuration. |
| admin-update-user-plan | E: supabase/functions/admin-update-user-plan/index.ts | Worker admin/internal | High: define Stripe and D1 source-of-truth behavior |
| apply-extension-coupon | E: supabase/functions/apply-extension-coupon/index.ts | Worker user | Medium: coupon redemption must be atomic |
| apply-fanmark-lottery | E: supabase/functions/apply-fanmark-lottery/index.ts | Worker user | Medium: preserve one-entry and grace checks |
| apply-transfer-code | E: supabase/functions/apply-transfer-code/index.ts | Worker user | Medium: preserve participant and expiry checks |
| approve-transfer-request | E: supabase/functions/approve-transfer-request/index.ts | Worker user | Medium: owner approval and finalization must be atomic |
| bulk-return-fanmarks | E: supabase/functions/bulk-return-fanmarks/index.ts | Worker user | Resolved: process each license independently and return partial failures as 207, matching the source contract; audit/notification effects remain best-effort |
| cancel-lottery-entry | E: supabase/functions/cancel-lottery-entry/index.ts | Worker user | Medium: preserve lottery state transitions |
| cancel-transfer-code | E: supabase/functions/cancel-transfer-code/index.ts | Worker user | Medium: preserve transfer lock release |
| change-subscription | E: supabase/functions/change-subscription/index.ts | Worker user/internal + retain Stripe | High: proration, downgrade selection, and webhook reconciliation |
| check-email-exists | E: supabase/functions/check-email-exists/index.ts | Worker public/user auth helper | High: response must not enable account enumeration |
| check-expired-licenses | E: supabase/functions/check-expired-licenses/index.ts | Worker internal Cron | Medium: grace/lottery transaction and retry semantics |
| check-subscription | E: supabase/functions/check-subscription/index.ts | Worker user/internal + retain Stripe | Medium: polling response and D1 mirror freshness |
| create-checkout | E: supabase/functions/create-checkout/index.ts | Worker user + retain Stripe | Medium: checkout ownership and redirect validation |
| create-extension-checkout | E: supabase/functions/create-extension-checkout/index.ts | Worker user + retain Stripe | Medium: price lookup and license binding |
| customer-portal | E: supabase/functions/customer-portal/index.ts | Worker user + retain Stripe | Medium: portal session ownership |
| delete-user-account | E: supabase/functions/delete-user-account/index.ts | Worker user/internal + retain Auth; staged `POST /api/me/account/delete` coordinator | Medium: local D1/Stripe tests and a live synthetic staging deletion/readback pass; populated Stripe customer cancellation, concurrent-transfer recovery, imported credential compatibility, and production cutover remain unverified. The direct Better Auth delete route stays closed. See `docs/migration/account-deletion-api.md`. |
| extend-fanmark-license | E: supabase/functions/extend-fanmark-license/index.ts | Worker user + retain Stripe | Medium: grace, lottery, and payment invariants |
| fanmark-ogp | E: supabase/functions/fanmark-ogp/index.ts | Worker public | Medium: cache headers and public projection |
| generate-ogp-image | E: supabase/functions/generate-ogp-image/index.ts | Worker public / derived artifact | Medium: move image generation and cache storage to the selected asset path |
| generate-transfer-code | E: supabase/functions/generate-transfer-code/index.ts | Worker user | Medium: code entropy and transfer lock |
| handle-stripe-webhook | E: supabase/functions/handle-stripe-webhook/index.ts | Worker internal webhook + retain Stripe | High: signature verification, idempotency, and replay handling |
| process-notification-events | E: supabase/functions/process-notification-events/index.ts | Worker internal Cron/Queue | High: replace pg_cron/pg_net wake/sleep behavior |
| record-fanmark-access | E: supabase/functions/record-fanmark-access/index.ts | Worker public ingress → D1 atomic log + daily aggregate; paired with owner-scoped `/api/me/analytics/*` readers on workers.dev staging | Medium: historical data stays in Supabase; abuse controls, retention, populated-user authorization, and production CPU/plan fit remain open |
| register-fanmark | E: supabase/functions/register-fanmark/index.ts | Worker user | Medium: D1 transaction must cover registry, license, discovery, and audit |
| reject-transfer-request | E: supabase/functions/reject-transfer-request/index.ts | Worker user | Medium: participant authorization and notification |
| reset-fanmark-data | E: supabase/functions/reset-fanmark-data/index.ts | Worker admin/internal | High: destructive operation needs explicit scope and audit |
| return-fanmark | E: supabase/functions/return-fanmark/index.ts | Worker user | Medium: grace transition and notification side effects |
| send-auth-email | E: supabase/functions/send-auth-email/index.ts | Worker internal + retain Auth/email provider | High: provider lifecycle and template ownership |
| send-broadcast-email | E: supabase/functions/send-broadcast-email/index.ts | Worker admin/internal + retain Resend | High: recipient selection, retries, and opt-out behavior |
| manual-expire-grace-licenses | Live-only name in [live observations](live-observations.md):10; no local source | Worker admin/internal candidate | High: purpose, invocation, and permission mapping remain open; keep as an explicit live-only reconciliation item |

The live-only entrypoint is not counted as a local route and is not folded into
the offline scanner's counts. It must be classified, migrated, or retired
after a read-only production review.

## Non-table dependencies

| Dependency observed in the repository | Tentative migration treatment | Source / open mapping |
| --- | --- | --- |
| Supabase Auth and auth.uid() / auth.users | Retain an Auth provider; Worker establishes the user identity used by D1 authorization | Frontend auth calls in src/**/*; SQL auth refs in repository-inventory.md; provider, redirect, and session claims need live verification |
| Storage buckets avatars, cover-images | Retain as R2 or selected object storage; Worker issues the public or signed URL boundary | src/hooks/useAvatarUpload.tsx:28,38,101; src/hooks/useCoverImageUpload.tsx:28,38,107; SQL storage refs in repository-inventory.md |
| Stripe checkout, customer portal, and webhooks | Retain Stripe; Worker owns authenticated initiation and idempotent webhook projection into user_subscriptions | PRODUCT:73-84,453-482; D1 webhook/reconciliation and owner-bound Free-to-paid/paid-plan commands are implemented and staged behind disabled Stripe selectors; sandbox acceptance and remaining billing effects/operations remain |
| Resend/auth and broadcast email delivery | Retain delivery provider; Worker internal queue and template projection | TECH email guidance; send-auth-email, send-broadcast-email, notification pipeline |
| pg_cron, pg_net, and Realtime channels | Replace with Worker Cron/Queues and explicit polling or WebSocket design | supabase/config.toml:60-84; repository-inventory.md cron and unresolved Realtime callsites |

## Decisions required before implementation

1. Exercise recent_active_fanmarks and list_recent_fanmarks against the
   source-shaped synthetic business D1 schema and verify the deployed Worker
   route; business staging has the empty 40-table structural baseline, while
   the feature selector remains disabled and the route is unverified live.
2. Reconcile the 58 live function names with the 45 generated types and
   decide which of the 13 trigger/auth/audit helpers become D1 triggers,
   explicit Worker writes, derived artifacts, or retirements.
3. Define public projections for fanmarks, fanmark_licenses, profile/config
   tables, and notifications before creating public Worker routes.
4. Define D1 transaction boundaries for registration, license lifecycle,
   lottery selection, transfer finalization, coupon redemption, and
   notification enqueue/dequeue.
5. Confirm the private-table data classification and deletion/retention rules
   for user_settings, user_subscriptions, waitlist, audit_logs, and
   password configuration.
6. Verify Auth providers, Storage buckets/policies, Cron schedules, Realtime
   usage, Stripe/Resend webhooks, and the live-only route before any cutover.

This map is intentionally a design input. It does not claim that local
snapshots, current policies, or the observed live metadata are sufficient to
deploy a replacement.

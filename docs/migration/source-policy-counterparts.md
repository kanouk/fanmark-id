# Source policy counterparts for the current application

Reviewed against branch `0019568` on 2026-10-03 JST. This links every one of the
77 source policies to the current Worker surface or to an explicitly uncopied
legacy row surface. It does not declare full source authorization equivalence,
provider acceptance, production readiness or external-client compatibility.

## Source identity and interpretation

The metadata-only authorization report observed the linked source at
`2026-10-03T04:12:13.485862Z`, fingerprint
`8e9859a0fe06eb1e7b123f55f3cde2c1ae482081ed6912dd9dbc53a7452cd273`.
All 40 source tables have RLS, with 77 permissive policies. Appendix policy
identities, commands, roles and expression SHA-256 values come from that report;
no user/Auth rows or raw function/policy bodies are included here.

PostgreSQL table grants, applicable roles, RLS and SECURITY DEFINER RPC body
checks are separate controls. Applicable permissive policies combine with OR;
`ALL` also applies to SELECT. Missing WITH CHECK is not a blanket permission:
PostgreSQL can use the policy USING predicate. Direct password-table denial and
waitlist SELECT denial do not describe the separate internal/RPC operations.
An API service-role bypass is not a client authorization mechanism to recreate.

Target D1 is private to the Worker. The session resolver derives identity from
Better Auth without cookie-cache authority. `authorizeAdminRequest` in
`workers/api/src/index.ts` checks Auth D1 `adminRole`, exactly one verified
factor and unexpired MFA assurance bound to the same user/session/factor.
Most source admin policies use a plan; the source user_roles admin policy uses
a role instead. This target difference is deliberate. The waitlist route also
requires the admin plan and persists authorized/denied security audits.

## Current application correspondence by table

Each C identifier below is the target correspondence for every source policy
of that table in the appendix. The source summary preserves separate action
predicates. The evidence links identify existing contracts and test coverage;
listing a test file does not imply a fresh run or full-schema/remote coverage.
Accepted runtime versions and their actual scopes remain in HANDOFF.md.

### C01: audit_logs (2 policies)

Source: Owner SELECT; admin/service INSERT.

Target: Internal append from domain commands; MFA waitlist security-log DTO and target-user admin audit DTO. No general owner audit-row API.

Implementation: [waitlist-admin-d1-api.ts](../../workers/api/src/waitlist-admin-d1-api.ts), [admin-user-management-d1-api.ts](../../workers/api/src/admin-user-management-d1-api.ts). Contracts: [waitlist-admin-api.md](waitlist-admin-api.md), [admin-user-status-api.md](admin-user-status-api.md). Coverage: [waitlist-admin-d1.test.ts](../../workers/api/test/waitlist-admin-d1.test.ts), [admin-user-management-d1.test.ts](../../workers/api/test/admin-user-management-d1.test.ts).

Difference or remaining condition: The current SecureWaitlistAdmin Worker branch reads its logs in the waitlist response and never executes its Supabase audit query. General self audit access is an uncopied legacy surface; retention remains operational.

### C02: broadcast_emails (1 policies)

Source: Admin ALL.

Target: MFA campaign list/create/update and controlled delivery actions; internal delivery/webhook state.

Implementation: [broadcast-email-admin-d1-api.ts](../../workers/api/src/broadcast-email-admin-d1-api.ts), [broadcast-email-delivery-d1.ts](../../workers/api/src/broadcast-email-delivery-d1.ts). Contracts: [broadcast-email-admin-api.md](broadcast-email-admin-api.md), [broadcast-email-delivery-design.md](broadcast-email-delivery-design.md). Coverage: [broadcast-email-admin-d1.test.ts](../../workers/api/test/broadcast-email-admin-d1.test.ts), [broadcast-email-delivery-d1.integration.mjs](../../workers/api/test/broadcast-email-delivery-d1.integration.mjs).

Difference or remaining condition: Source broad ALL becomes bounded campaign commands. The approved fixed-recipient test-send API was accepted with native draft creation, Resend Delivered and matching D1 audit; see [the bounded delivery evidence](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json). Native fixed-recipient test-send UI is accepted with Delivered/audit/restore/cleanup in [the later native evidence](evidence/staging-main-auth-mfa-admin-mail-native-2026-10-07.json). Bulk, actual signed delivery/retry and retention remain unaccepted.

### C03: email_templates (2 policies)

Source: Admin ALL; service SELECT.

Target: MFA template list/edit; internal rendering reads.

Implementation: [admin-email-templates-d1-api.ts](../../workers/api/src/admin-email-templates-d1-api.ts), [broadcast-email-delivery-d1.ts](../../workers/api/src/broadcast-email-delivery-d1.ts). Contracts: [email-templates.md](email-templates.md). Coverage: [admin-email-templates-d1.test.ts](../../workers/api/test/admin-email-templates-d1.test.ts).

Difference or remaining condition: Template SQL/source text is not a public DTO. External send acceptance is separate.

### C04: emoji_master (2 policies)

Source: Admin ALL; authenticated SELECT true.

Target: MFA canonical draft CRUD/import; public versioned catalog projection from Master D1.

Implementation: [emoji-master-admin-d1-repository.ts](../../workers/api/src/emoji-master-admin-d1-repository.ts), [emoji-master-d1-repository.ts](../../workers/api/src/emoji-master-d1-repository.ts). Contracts: [emoji-releases.md](emoji-releases.md), [emoji-master-change-audit.md](emoji-master-change-audit.md). Coverage: [emoji-master-release.integration.mjs](../../workers/api/test/emoji-master-release.integration.mjs).

Difference or remaining condition: Public catalog supports anonymous search by design. Stable IDs, publication and identity protection replace direct row edits.

### C05: enterprise_user_settings (2 policies)

Source: Owner SELECT; admin ALL.

Target: MFA user list/detail and plan-change Enterprise overrides; internal deletion cleanup.

Implementation: [admin-user-management-d1-api.ts](../../workers/api/src/admin-user-management-d1-api.ts), [account-deletion-d1-api.ts](../../workers/api/src/account-deletion-d1-api.ts). Contracts: [admin-user-status-api.md](admin-user-status-api.md), [account-deletion-api.md](account-deletion-api.md). Coverage: [admin-user-management-d1.test.ts](../../workers/api/test/admin-user-management-d1.test.ts).

Difference or remaining condition: No current executable frontend owner-row reader was found. Owner SELECT is an uncopied legacy surface, not an excuse to remove stored Enterprise overrides.

### C06: extension_coupon_usages (3 policies)

Source: Owner SELECT; admin ALL; service INSERT.

Target: MFA usage DTO; authenticated application command atomically creates only its own receipt.

Implementation: [extension-coupon-admin-d1-api.ts](../../workers/api/src/extension-coupon-admin-d1-api.ts), [extension-coupon-application-d1-api.ts](../../workers/api/src/extension-coupon-application-d1-api.ts). Contracts: [extension-coupon-api.md](extension-coupon-api.md). Coverage: [extension-coupon-admin-d1.integration.mjs](../../workers/api/test/extension-coupon-admin-d1.integration.mjs), [extension-coupon-application-d1.integration.mjs](../../workers/api/test/extension-coupon-application-d1.integration.mjs).

Difference or remaining condition: No arbitrary usage INSERT/UPDATE/DELETE API or general self usage reader; coupon command identity is session-bound.

### C07: extension_coupons (1 policies)

Source: Admin ALL.

Target: MFA coupon management; session-bound application resolves code internally.

Implementation: [extension-coupon-admin-d1-api.ts](../../workers/api/src/extension-coupon-admin-d1-api.ts), [extension-coupon-application-d1-api.ts](../../workers/api/src/extension-coupon-application-d1-api.ts). Contracts: [extension-coupon-api.md](extension-coupon-api.md). Coverage: [extension-coupon-admin-d1.integration.mjs](../../workers/api/test/extension-coupon-admin-d1.integration.mjs), [extension-coupon-application-d1.integration.mjs](../../workers/api/test/extension-coupon-application-d1.integration.mjs).

Difference or remaining condition: Public callers cannot enumerate coupon rows; used coupon deletion is refused.

### C08: fanmark_access_daily_stats (1 policies)

Source: SELECT where any license for fanmark belongs to caller.

Target: Session-bound analytics DTOs and internal public-access aggregate mutation.

Implementation: [fanmark-analytics-d1-api.ts](../../workers/api/src/fanmark-analytics-d1-api.ts), [fanmark-access-analytics-d1-api.ts](../../workers/api/src/fanmark-access-analytics-d1-api.ts). Contracts: [fanmark-access-analytics-api.md](fanmark-access-analytics-api.md). Coverage: [fanmark-access-analytics-d1.test.ts](../../workers/api/test/fanmark-access-analytics-d1.test.ts).

Difference or remaining condition: Target uses endpoint-specific active/current license and plan guards, narrower than any historical owner. The current Analytics screen already selects status=active licenses, and the dashboard filters derived-active licenses before reading stats; these caller scopes correspond to the target. See the current-screen review in fanmark-access-analytics-api.md. Broader historical-owner direct-row access, imported rows, retention and final populated-user integration remain separate data/operations/cutover requirements.

### C09: fanmark_access_logs (1 policies)

Source: SELECT where any license for fanmark belongs to caller.

Target: Session-bound analytics projections; bounded public event command.

Implementation: [fanmark-analytics-d1-api.ts](../../workers/api/src/fanmark-analytics-d1-api.ts), [fanmark-access-analytics-d1-api.ts](../../workers/api/src/fanmark-access-analytics-d1-api.ts). Contracts: [fanmark-access-analytics-api.md](fanmark-access-analytics-api.md). Coverage: [fanmark-access-analytics-d1.test.ts](../../workers/api/test/fanmark-access-analytics-d1.test.ts).

Difference or remaining condition: No raw log-row reader. Client event IDs must match one active fanmark; IP is hashed for limiting and not stored. Retention remains open.

### C10: fanmark_availability_rules (2 policies)

Source: Public SELECT is_available; admin ALL.

Target: MFA bounded rules read/PATCH; no current Worker availability consumer.

Implementation: [availability-rules-admin-d1-api.ts](../../workers/api/src/availability-rules-admin-d1-api.ts), [availability-d1-repository.ts](../../workers/api/src/availability-d1-repository.ts). Contracts: [availability-rules-admin-api.md](availability-rules-admin-api.md), [availability-contract.md](availability-contract.md). Coverage: [availability-rules-admin-d1.test.ts](../../workers/api/test/availability-rules-admin-d1.test.ts), [availability-d1.test.ts](../../workers/api/test/availability-d1.test.ts).

Difference or remaining condition: No generic public rule-row API. The [checked-in current consumer review](source-availability-rule-review.md) establishes no blocking/payment effect for valid enabled or disabled source configurations; Worker availability/registration preserve that outcome. Deployed source Edge bodies, malformed historical JSON and external consumers remain outside that bounded proof. Future pricing/blocking behavior requires an explicit product rule.

### C11: fanmark_basic_configs (1 policies)

Source: ALL owner of active license with NULL/future end.

Target: Session owner settings; anonymous/proof-protected public projection.

Implementation: [fanmark-settings-d1-api.ts](../../workers/api/src/fanmark-settings-d1-api.ts), [public-access-d1-repository.ts](../../workers/api/src/public-access-d1-repository.ts). Contracts: [fanmark-settings-api.md](fanmark-settings-api.md), [public-access-contract.md](public-access-contract.md). Coverage: [fanmark-settings-d1.test.ts](../../workers/api/test/fanmark-settings-d1.test.ts), [verified-access-d1.test.ts](../../workers/api/test/verified-access-d1.test.ts).

Difference or remaining condition: Owner and lifecycle predicates are rechecked at mutation; public projection derives from source RPC contracts, not this row policy.

### C12: fanmark_discoveries (1 policies)

Source: Public SELECT true.

Target: Public search/discovery DTO; atomic internal search/favorite event/count changes.

Implementation: [fanmark-search-d1-api.ts](../../workers/api/src/fanmark-search-d1-api.ts), [discovery-mutations.ts](../../workers/api/src/discovery-mutations.ts). Contracts: [fanmark-search-api.md](fanmark-search-api.md), [favorites-api.md](favorites-api.md). Coverage: [fanmark-search-d1.test.ts](../../workers/api/test/fanmark-search-d1.test.ts), [favorites-d1.test.ts](../../workers/api/test/favorites-d1.test.ts).

Difference or remaining condition: No arbitrary discovery mutation from a caller; current bce8993 runtime accepted the four reproduced event/count failures.

### C13: fanmark_events (1 policies)

Source: Admin/service SELECT.

Target: Internal append/readback via atomic discovery commands; no event-log HTTP reader.

Implementation: [discovery-mutations.ts](../../workers/api/src/discovery-mutations.ts). Contracts: [fanmark-search-api.md](fanmark-search-api.md), [favorites-api.md](favorites-api.md). Coverage: [fanmark-search-d1.test.ts](../../workers/api/test/fanmark-search-d1.test.ts), [favorites-d1.test.ts](../../workers/api/test/favorites-d1.test.ts).

Difference or remaining condition: No executable current frontend/Edge event-row reader found; admin raw read is an uncopied legacy surface. Event retention/replay remains operational.

### C14: fanmark_favorites (1 policies)

Source: ALL self user_id, including CHECK.

Target: Current session list/add/remove commands.

Implementation: [favorites-d1-api.ts](../../workers/api/src/favorites-d1-api.ts), [discovery-mutations.ts](../../workers/api/src/discovery-mutations.ts). Contracts: [favorites-api.md](favorites-api.md). Coverage: [favorites-d1.test.ts](../../workers/api/test/favorites-d1.test.ts).

Difference or remaining condition: Caller-selected user IDs are rejected; duplicate commands preserve counts/events rather than exposing raw ALL.

### C15: fanmark_licenses (2 policies)

Source: Owner SELECT; admin ALL.

Target: Owned list/settings/details; MFA target-user detail/expiry; dedicated register/return/transfer/lifecycle commands.

Implementation: [fanmark-settings-d1-api.ts](../../workers/api/src/fanmark-settings-d1-api.ts), [fanmark-details-d1-api.ts](../../workers/api/src/fanmark-details-d1-api.ts), [admin-user-management-d1-api.ts](../../workers/api/src/admin-user-management-d1-api.ts). Contracts: [fanmark-settings-api.md](fanmark-settings-api.md), [fanmark-details-api.md](fanmark-details-api.md), [admin-license-expiry-api.md](admin-license-expiry-api.md). Coverage: [fanmark-settings-d1.test.ts](../../workers/api/test/fanmark-settings-d1.test.ts), [admin-user-management-d1.test.ts](../../workers/api/test/admin-user-management-d1.test.ts).

Difference or remaining condition: The source broad admin mutation surface is replaced by explicit commands, not an unrestricted license PATCH.

### C16: fanmark_lottery_entries (4 policies)

Source: Owner SELECT; own INSERT for unexpired grace; own pending UPDATE to pending/cancelled; admin ALL.

Target: Session apply/cancel/list and internal atomic winner/cancellation paths.

Implementation: [fanmark-lottery-d1-api.ts](../../workers/api/src/fanmark-lottery-d1-api.ts), [license-grace-finalization-source.mjs](../../workers/api/src/license-grace-finalization-source.mjs). Contracts: [fanmark-lottery-api.md](fanmark-lottery-api.md), [lottery-selection.md](lottery-selection.md). Coverage: [fanmark-lottery-d1.test.ts](../../workers/api/test/fanmark-lottery-d1.test.ts), [license-lottery-selection.test.mjs](../../workers/api/test/license-lottery-selection.test.mjs).

Difference or remaining condition: Commands recheck owner, grace, current pending state and audit effects. No caller-controlled arbitrary status or admin ALL endpoint.

### C17: fanmark_lottery_history (2 policies)

Source: Admin SELECT; service INSERT.

Target: Internal finalization creates retained history; supported lottery DTOs do not expose arbitrary history rows.

Implementation: [license-grace-finalization-source.mjs](../../workers/api/src/license-grace-finalization-source.mjs), [fanmark-lottery-d1-api.ts](../../workers/api/src/fanmark-lottery-d1-api.ts). Contracts: [lottery-selection.md](lottery-selection.md), [fanmark-lottery-api.md](fanmark-lottery-api.md). Coverage: [license-lottery-selection.test.mjs](../../workers/api/test/license-lottery-selection.test.mjs), [fanmark-lottery-d1.test.ts](../../workers/api/test/fanmark-lottery-d1.test.ts).

Difference or remaining condition: No generic admin history-row reader; finalization and retention are distinct from direct INSERT authorization.

### C18: fanmark_messageboard_configs (1 policies)

Source: ALL owner of active license with NULL/future end.

Target: Session owner settings; public/proof-protected text projection.

Implementation: [fanmark-settings-d1-api.ts](../../workers/api/src/fanmark-settings-d1-api.ts), [public-access-d1-repository.ts](../../workers/api/src/public-access-d1-repository.ts). Contracts: [fanmark-settings-api.md](fanmark-settings-api.md), [public-access-contract.md](public-access-contract.md). Coverage: [fanmark-settings-d1.test.ts](../../workers/api/test/fanmark-settings-d1.test.ts), [verified-access-d1.test.ts](../../workers/api/test/verified-access-d1.test.ts).

Difference or remaining condition: Enabled password redacts anonymous text; proof is independent of Better Auth session.

### C19: fanmark_password_configs (1 policies)

Source: ALL false USING and CHECK: direct denial.

Target: Internal bcrypt storage only; owner settings returns enabled state, verified-access issues scoped proof.

Implementation: [fanmark-settings-d1-api.ts](../../workers/api/src/fanmark-settings-d1-api.ts). Contracts: [fanmark-settings-api.md](fanmark-settings-api.md), [verified-access-design.md](verified-access-design.md), [credential-transform-design.md](credential-transform-design.md). Coverage: [fanmark-settings-d1.test.ts](../../workers/api/test/fanmark-settings-d1.test.ts), [verified-access-d1.test.ts](../../workers/api/test/verified-access-d1.test.ts).

Difference or remaining condition: No hash/password-config row API. Internal writes remain necessary despite direct RLS denial; imported generations are checked by codec v5.

### C20: fanmark_profiles (4 policies)

Source: Authenticated public-or-own SELECT; active finite own INSERT; own-only UPDATE/DELETE with no lifecycle check.

Target: Active NULL/future owner read/upsert; public/proof projection requires public flag and valid non-returned license.

Implementation: [fanmark-profile-d1-api.ts](../../workers/api/src/fanmark-profile-d1-api.ts), [public-access-d1-repository.ts](../../workers/api/src/public-access-d1-repository.ts). Contracts: [fanmark-profile-api.md](fanmark-profile-api.md), [public-profile-runtime-review.md](public-profile-runtime-review.md). Coverage: [fanmark-profile-d1.test.ts](../../workers/api/test/fanmark-profile-d1.test.ts), [verified-access-d1.test.ts](../../workers/api/test/verified-access-d1.test.ts).

Difference or remaining condition: Explicit PRODUCT correction accepts perpetual owner creation and refuses grace/expired edits. Anonymous profile behavior follows public RPC, not authenticated row SELECT. Private/password content is redacted in SQL before mapping.

### C21: fanmark_redirect_configs (1 policies)

Source: ALL owner of active license with NULL/future end.

Target: Session owner settings; public/proof-protected redirect projection.

Implementation: [fanmark-settings-d1-api.ts](../../workers/api/src/fanmark-settings-d1-api.ts), [public-access-d1-repository.ts](../../workers/api/src/public-access-d1-repository.ts). Contracts: [fanmark-settings-api.md](fanmark-settings-api.md), [public-access-contract.md](public-access-contract.md). Coverage: [fanmark-settings-d1.test.ts](../../workers/api/test/fanmark-settings-d1.test.ts), [verified-access-d1.test.ts](../../workers/api/test/verified-access-d1.test.ts).

Difference or remaining condition: Anonymous locked response never includes redirect target.

### C22: fanmark_tier_extension_prices (1 policies)

Source: Authenticated SELECT active.

Target: Public active-only versioned price DTO; MFA price management; service-only publication.

Implementation: [reference-master-d1-repository.ts](../../workers/api/src/reference-master-d1-repository.ts), [reference-master-admin-d1-repository.ts](../../workers/api/src/reference-master-admin-d1-repository.ts). Contracts: [reference-master-data.md](reference-master-data.md). Coverage: [reference-master-d1-api.test.ts](../../workers/api/test/reference-master-d1-api.test.ts), [reference-master-release.integration.mjs](../../workers/api/test/reference-master-release.integration.mjs).

Difference or remaining condition: The current candidate filters inactive price members after full-release verification. Anonymous minimal price preview is the established target contract, distinct from source authenticated row SELECT, and exposes no Stripe IDs. Real sandbox and deployed-candidate acceptance remain open.

### C23: fanmark_tiers (4 policies)

Source: Public active SELECT; overlapping admin SELECT/UPDATE/ALL.

Target: Public DTO of the selected release; MFA draft/publication operations and internal Tier resolution.

Implementation: [reference-master-d1-repository.ts](../../workers/api/src/reference-master-d1-repository.ts), [reference-master-admin-d1-repository.ts](../../workers/api/src/reference-master-admin-d1-repository.ts). Contracts: [reference-master-data.md](reference-master-data.md), [source-emoji-helpers-review.md](source-emoji-helpers-review.md). Coverage: [reference-master-d1-api.test.ts](../../workers/api/test/reference-master-d1-api.test.ts), [reference-master-release.integration.mjs](../../workers/api/test/reference-master-release.integration.mjs).

Difference or remaining condition: Multiple permissive source admin policies overlap; they are not four separate target permissions. The current candidate returns only active Tier members after full-release verification, preserving source public visibility. Admin pricing retains all members; deployed-candidate acceptance remains open.

### C24: fanmark_transfer_codes (3 policies)

Source: Issuer SELECT; issuer active UPDATE to cancelled; admin/service ALL.

Target: Session issuer list/create/cancel and internal guarded approval/rejection effects.

Implementation: [fanmark-transfer-d1-api.ts](../../workers/api/src/fanmark-transfer-d1-api.ts). Contracts: [fanmark-transfer-api.md](fanmark-transfer-api.md). Coverage: [fanmark-transfer-d1.test.ts](../../workers/api/test/fanmark-transfer-d1.test.ts).

Difference or remaining condition: Issuer from session; no generic admin/service token grants arbitrary code access. Expiry, pending request and transfer lock are command predicates.

### C25: fanmark_transfer_requests (3 policies)

Source: Requester SELECT; issuer SELECT via code; admin/service ALL.

Target: Session incoming/outgoing DTO and participant-bound apply/approve/reject.

Implementation: [fanmark-transfer-d1-api.ts](../../workers/api/src/fanmark-transfer-d1-api.ts). Contracts: [fanmark-transfer-api.md](fanmark-transfer-api.md). Coverage: [fanmark-transfer-d1.test.ts](../../workers/api/test/fanmark-transfer-d1.test.ts).

Difference or remaining condition: Both participant directions are explicit; another user cannot approve by supplying a request ID.

### C26: fanmarks (2 policies)

Source: Public active SELECT; authenticated SELECT all rows.

Target: Public minimal access/search/recent DTO and own/admin domain projections.

Implementation: [public-access-d1-repository.ts](../../workers/api/src/public-access-d1-repository.ts), [fanmark-search-d1-api.ts](../../workers/api/src/fanmark-search-d1-api.ts), [fanmark-details-d1-api.ts](../../workers/api/src/fanmark-details-d1-api.ts). Contracts: [public-access-contract.md](public-access-contract.md), [fanmark-search-api.md](fanmark-search-api.md), [fanmark-details-api.md](fanmark-details-api.md). Coverage: [fanmark-search-d1.test.ts](../../workers/api/test/fanmark-search-d1.test.ts), [recent-api.test.ts](../../workers/api/test/recent-api.test.ts).

Difference or remaining condition: Authenticated row grant does not authorize config contents. Target will not copy full-row SELECT or bypass password/public guards.

### C27: invitation_codes (1 policies)

Source: Admin ALL.

Target: MFA management; public token validation and internal transactional signup consumption.

Implementation: [invitation-admin-d1-api.ts](../../workers/api/src/invitation-admin-d1-api.ts), [invitation-signup-d1-api.ts](../../workers/api/src/invitation-signup-d1-api.ts). Contracts: [invitation-admin-api.md](invitation-admin-api.md), [invitation-signup-api.md](invitation-signup-api.md). Coverage: [invitation-admin-d1.test.ts](../../workers/api/test/invitation-admin-d1.test.ts), [invitation-signup-d1.test.ts](../../workers/api/test/invitation-signup-d1.test.ts).

Difference or remaining condition: Validation is a bounded RPC counterpart, not public list access. Email/signup provider acceptance remains pending.

### C28: languages (2 policies)

Source: Public SELECT true; admin ALL.

Target: Selected-release public language DTO; MFA reference management.

Implementation: [reference-master-d1-repository.ts](../../workers/api/src/reference-master-d1-repository.ts), [reference-master-admin-d1-repository.ts](../../workers/api/src/reference-master-admin-d1-repository.ts). Contracts: [reference-master-data.md](reference-master-data.md). Coverage: [reference-master-d1-api.test.ts](../../workers/api/test/reference-master-d1-api.test.ts), [reference-master-release.integration.mjs](../../workers/api/test/reference-master-release.integration.mjs).

Difference or remaining condition: Source allows all language rows. Target returns all selected-release members with isActive; the language frontend filters inactive members. Release selection is distinct from row activation.

### C29: notification_events (2 policies)

Source: Admin SELECT; service ALL.

Target: MFA payload-free event log/manual supported event command; internal producer/processor/wake.

Implementation: [notification-master-d1-api.ts](../../workers/api/src/notification-master-d1-api.ts), [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts), [notification-wake.ts](../../workers/api/src/notification-wake.ts). Contracts: [notifications-api.md](notifications-api.md), [notification-worker-wake.md](notification-worker-wake.md). Coverage: [notification-master-admin-d1.test.ts](../../workers/api/test/notification-master-admin-d1.test.ts), [notification-wake.test.ts](../../workers/api/test/notification-wake.test.ts).

Difference or remaining condition: No service-role token accepted over HTTP. Manual event DTOs/inputs are allowlisted; real email/Web Push providers are separate.

### C30: notification_preferences (1 policies)

Source: ALL self user_id.

Target: Internal processor honors channel/event opt-out; account deletion cleans own preferences.

Implementation: [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts), [account-deletion-d1-api.ts](../../workers/api/src/account-deletion-d1-api.ts). Contracts: [notifications-api.md](notifications-api.md), [account-deletion-api.md](account-deletion-api.md). Coverage: [notifications-d1.test.ts](../../workers/api/test/notifications-d1.test.ts).

Difference or remaining condition: No executable current frontend preference-row editor found. No new unused CRUD API is added; legacy own CRUD compatibility remains open.

### C31: notification_rules (1 policies)

Source: Admin ALL.

Target: MFA rule list/bounded optimistic update; internal processor reads.

Implementation: [notification-master-d1-api.ts](../../workers/api/src/notification-master-d1-api.ts), [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts). Contracts: [notifications-api.md](notifications-api.md). Coverage: [notification-master-admin-d1.test.ts](../../workers/api/test/notification-master-admin-d1.test.ts), [notifications-d1.test.ts](../../workers/api/test/notifications-d1.test.ts).

Difference or remaining condition: No general INSERT/DELETE supplied by the source ALL grant; supported application operations use explicit fields.

### C32: notification_templates (2 policies)

Source: Admin ALL; authenticated active SELECT.

Target: MFA template list/copy/activation update; internal active language/version rendering.

Implementation: [notification-master-d1-api.ts](../../workers/api/src/notification-master-d1-api.ts), [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts). Contracts: [notifications-api.md](notifications-api.md). Coverage: [notification-master-admin-d1.test.ts](../../workers/api/test/notification-master-admin-d1.test.ts), [notifications-d1.test.ts](../../workers/api/test/notifications-d1.test.ts).

Difference or remaining condition: No current authenticated raw-template reader; source SELECT is an uncopied legacy surface. Public notifications expose rendered content only.

### C33: notifications (4 policies)

Source: Owner SELECT/UPDATE; admin SELECT; service ALL.

Target: Session owner inbox/count/read/read-all; MFA payload-free delivery log; internal processor/archive.

Implementation: [notifications-d1-api.ts](../../workers/api/src/notifications-d1-api.ts), [notification-master-d1-api.ts](../../workers/api/src/notification-master-d1-api.ts), [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts). Contracts: [notifications-api.md](notifications-api.md). Coverage: [notifications-d1.test.ts](../../workers/api/test/notifications-d1.test.ts), [notification-master-admin-d1.test.ts](../../workers/api/test/notification-master-admin-d1.test.ts).

Difference or remaining condition: UPDATE narrows to read operations and rejects supplied owner identities; processor changes cannot be requested by an ordinary user.

### C34: notifications_history (1 policies)

Source: Admin SELECT.

Target: Internal conflict-safe archive retains full original data; no HTTP history-body reader.

Implementation: [notifications-scheduled.ts](../../workers/api/src/notifications-scheduled.ts). Contracts: [notifications-api.md](notifications-api.md). Coverage: [notifications-d1.test.ts](../../workers/api/test/notifications-d1.test.ts).

Difference or remaining condition: Source archiver has a separate service-role execution grant. Archive selector is absent in staging; retention/operations and legacy admin history-reader disposition remain open.

### C35: reserved_emoji_patterns (1 policies)

Source: Public active SELECT.

Target: Selected-release public DTO and MFA reference management; no current registration/availability consumer.

Implementation: [reference-master-d1-repository.ts](../../workers/api/src/reference-master-d1-repository.ts), [reference-master-admin-d1-repository.ts](../../workers/api/src/reference-master-admin-d1-repository.ts). Contracts: [reference-master-data.md](reference-master-data.md), [availability-contract.md](availability-contract.md). Coverage: [reference-master-d1-api.test.ts](../../workers/api/test/reference-master-d1-api.test.ts).

Difference or remaining condition: The current candidate filters inactive patterns, preserving source active-only SELECT while keeping full release storage. Deployed-candidate acceptance remains open. Admin management is a release workflow; lack of a source admin row policy does not prohibit service-role writes.

### C36: system_settings (3 policies)

Source: Public is_public SELECT; authenticated admin SELECT/UPDATE.

Target: Public key allowlist; MFA private/admin key allowlist and specialized lifecycle/maintenance commands.

Implementation: [system-settings-d1-api.ts](../../workers/api/src/system-settings-d1-api.ts), [lifecycle-settings-d1-api.ts](../../workers/api/src/lifecycle-settings-d1-api.ts), [maintenance-settings-d1-api.ts](../../workers/api/src/maintenance-settings-d1-api.ts). Contracts: [system-settings-api.md](system-settings-api.md), [lifecycle-settings-api.md](lifecycle-settings-api.md), [maintenance-settings-api.md](maintenance-settings-api.md). Coverage: [system-settings-d1.test.ts](../../workers/api/test/system-settings-d1.test.ts), [lifecycle-settings-d1.test.ts](../../workers/api/test/lifecycle-settings-d1.test.ts), [maintenance-settings-d1.test.ts](../../workers/api/test/maintenance-settings-d1.test.ts).

Difference or remaining condition: Source is_public alone is broader; target validates both expected visibility and supported keys. No arbitrary setting-key write.

### C37: user_roles (2 policies)

Source: Self SELECT; admin ALL via caller user_roles.admin, not is_admin plan.

Target: Server-managed Auth D1 adminRole plus same-session MFA; business user_roles retained for import/history and deletion.

Implementation: [index.ts](../../workers/api/src/index.ts), [account-deletion-d1-api.ts](../../workers/api/src/account-deletion-d1-api.ts). Contracts: [source-access-helpers-review.md](source-access-helpers-review.md), [auth-feasibility.md](auth-feasibility.md). Coverage: [auth-d1.test.ts](../../workers/api/test/auth-d1.test.ts).

Difference or remaining condition: No generic role-query/CRUD API. Actual administrator identity mapping belongs to deferred user-data work; bootstrap/key custody belongs to operations.

### C38: user_settings (3 policies)

Source: Own INSERT/UPDATE/SELECT.

Target: Session own profile allowlist; server signup provisioning; MFA plan/status actions and verified billing projection.

Implementation: [profile-d1-repository.ts](../../workers/api/src/profile-d1-repository.ts), [invitation-signup-d1-api.ts](../../workers/api/src/invitation-signup-d1-api.ts), [admin-user-management-d1-api.ts](../../workers/api/src/admin-user-management-d1-api.ts). Contracts: [own-profile-api.md](own-profile-api.md), [source-user-settings-guards.md](source-user-settings-guards.md), [oauth-signup-provisioning.md](oauth-signup-provisioning.md). Coverage: [profile-d1.test.ts](../../workers/api/test/profile-d1.test.ts), [oauth-signup-d1.test.ts](../../workers/api/test/oauth-signup-d1.test.ts), [admin-user-management-d1.test.ts](../../workers/api/test/admin-user-management-d1.test.ts).

Difference or remaining condition: Owner profile input cannot set plan, roles, Stripe IDs or MFA; source plan-escalation triggers map to server-controlled paths.

### C39: user_subscriptions (3 policies)

Source: Owner SELECT; admin SELECT; service ALL.

Target: Session own minimal read DTO; signed Stripe projection/command paths only for billing writes.

Implementation: [subscription-d1-api.ts](../../workers/api/src/subscription-d1-api.ts), [stripe-subscription-reconciliation-d1.ts](../../workers/api/src/stripe-subscription-reconciliation-d1.ts). Contracts: [stripe-plan-change-api.md](stripe-plan-change-api.md), [stripe-invoice-projection-validation.md](stripe-invoice-projection-validation.md). Coverage: [subscription-d1-api.test.mjs](../../workers/api/test/subscription-d1-api.test.mjs), [stripe-subscription-reconciliation-d1.integration.mjs](../../workers/api/test/stripe-subscription-reconciliation-d1.integration.mjs).

Difference or remaining condition: No arbitrary subscription-row mutation/general admin row-reader. Signature, livemode and account identity checks replace service-role ingress. Actual sandbox Checkout/Portal, signed projection, duplicate/out-of-order/retry and refusal/3DS recovery are accepted within [the provider evidence](evidence/stripe-staging-real-provider-2026-10-04.json) and [the same-user subscription UI](evidence/stripe-staging-subscription-ui-2026-10-05.json). Paid deletion and final integrated UI remain unaccepted.

### C40: waitlist (2 policies)

Source: Anonymous/authenticated validated email INSERT; SELECT false.

Target: Bounded rate-limited public join; MFA plus admin-plan secure list/email-reveal with persisted audit.

Implementation: [waitlist-signup-d1-api.ts](../../workers/api/src/waitlist-signup-d1-api.ts), [waitlist-admin-d1-api.ts](../../workers/api/src/waitlist-admin-d1-api.ts). Contracts: [waitlist-signup-api.md](waitlist-signup-api.md), [waitlist-admin-api.md](waitlist-admin-api.md). Coverage: [waitlist-signup-d1.test.ts](../../workers/api/test/waitlist-signup-d1.test.ts), [waitlist-admin-d1.test.ts](../../workers/api/test/waitlist-admin-d1.test.ts).

Difference or remaining condition: Email regex is deliberately narrower than SQL LIKE. List returns hashes; reveal only follows durable audit. Source NULL admin fallthrough is not copied.

## Uncopied legacy surfaces and remaining decisions

No current executable frontend callsite was found for general own audit rows,
own Enterprise rows, own coupon-usage rows, notification-preference CRUD,
authenticated template-row SELECT, generic role-row access, admin event/history
rows or arbitrary admin ALL CRUD. The Edge processor reads preferences, Edge
user administration reads/writes Enterprise overrides, and shared Edge admin
helpers read user_roles: these are accounted for by the internal processor,
MFA administration and server-managed Auth authority above, not marked inactive.
The current Worker SecureWaitlistAdmin branch returns before its Supabase
security-log/RPC path. Source frontend branches are retained for the production
Supabase backend; their presence is not an active Worker fallback.

This is repository callsite evidence, not proof of absence of external clients.
External-consumer compatibility decisions remain explicit source-correspondence
items. Do not add unused broad CRUD endpoints to reproduce table grants.
Actual owner/administrator identity mapping remains in the deferred data phase;
operator bootstrap/custody, analytics/history retention, archive scheduling,
provider connections and final integration remain in this phase.

Source profile finite-only INSERT versus perpetual target ownership is already
an explicit PRODUCT correction. Source raw authenticated fanmark access does
not override target public/password guards. The active-only pattern/Tier/price visibility gap found during inventory is
fixed in the current candidate: full release verification precedes filtering,
and admin/storage retention remains intact. Native API9/client8/release6 and
both typechecks/focused lint pass; this is not deployed acceptance. Public
minimal price preview remains the documented anonymous target API contract.
The source language SELECT permits inactive members, and the language frontend
filters its selected-release DTO. Public latest-license selection and
historical-owner analytics are separately documented semantic/product gates;
this inventory does not silently resolve them.

The 77-policy **identity-to-current-path inventory is complete**. It makes no
claim that all underlying route/transaction/provider contracts or source
functions/indices are fully accepted. The existing authorization report keeps
`authorizationReconciled=false` and `deployable=false`.

## Exact policy identities

The expression digest covers the report's paired USING/WITH CHECK expressions.
Roles are PostgreSQL policy role metadata, not Cloudflare HTTP roles.

| ID | Source table / policy | Command | Roles | Correspondence | Expression SHA-256 |
| --- | --- | --- | --- | --- | --- |
| P001 | `audit_logs` / Admins can write audit logs | INSERT | public | C01 | `ced826ca52758e186419e294ea395973543d6d48c649f5497eca7c869f4e2859` |
| P002 | `audit_logs` / Users can view their own audit logs | SELECT | public | C01 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P003 | `broadcast_emails` / Admins can manage broadcast emails | ALL | public | C02 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P004 | `email_templates` / Admins can manage email templates | ALL | public | C03 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P005 | `email_templates` / System can read email templates | SELECT | public | C03 | `f0103ffb504182d8c5c423689e1864623e7b2c85e9035a79d65b97079185025b` |
| P006 | `emoji_master` / Admins can manage emoji master | ALL | public | C04 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P007 | `emoji_master` / Authenticated users can view emoji catalog | SELECT | authenticated | C04 | `d1405b66718869464a5e5521d9d8c222b03178347ff0dbd20d0af91b93b09cec` |
| P008 | `enterprise_user_settings` / Enterprise users can view their own settings | SELECT | public | C05 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P009 | `enterprise_user_settings` / Only admins can manage enterprise user settings | ALL | public | C05 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P010 | `extension_coupon_usages` / Admins can manage all usages | ALL | public | C06 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P011 | `extension_coupon_usages` / System can insert usages | INSERT | public | C06 | `3a50e53d3fb21d3eae8c8e816ff996199ae9ba43c3875523eff8d76b03fd9165` |
| P012 | `extension_coupon_usages` / Users can view their own usages | SELECT | public | C06 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P013 | `extension_coupons` / Admins can manage all coupons | ALL | public | C07 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P014 | `fanmark_access_daily_stats` / Owners can view their fanmark daily stats | SELECT | public | C08 | `0ec3fdf5a55e8da98665d6a547c93d9fc222b022741967a668219e94f1b3b27d` |
| P015 | `fanmark_access_logs` / Owners can view their fanmark access logs | SELECT | public | C09 | `0ec3fdf5a55e8da98665d6a547c93d9fc222b022741967a668219e94f1b3b27d` |
| P016 | `fanmark_availability_rules` / Anyone can view active availability rules | SELECT | public | C10 | `dbedfba36e2959542b7590fa49ca18924ab83510573de486d200e0158126dd2b` |
| P017 | `fanmark_availability_rules` / Only admins can manage availability rules | ALL | public | C10 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P018 | `fanmark_basic_configs` / Users can manage configs for their own licenses | ALL | public | C11 | `0c844009d52dd2c7aec00702e57deba89bc7f090403b7ac5d4699ae2d1be1586` |
| P019 | `fanmark_discoveries` / Allow read discoveries | SELECT | public | C12 | `d1405b66718869464a5e5521d9d8c222b03178347ff0dbd20d0af91b93b09cec` |
| P020 | `fanmark_events` / Allow read events | SELECT | public | C13 | `1fe6038e620deb0ebbc9e6c93b5f7857264790e5be3bcc3df0a008089888e69b` |
| P021 | `fanmark_favorites` / Users manage favorites | ALL | public | C14 | `1d781dd5da6b201e0975fc6fc619b176fed320ab5f968754dedbaffc7be33028` |
| P022 | `fanmark_licenses` / Only admins can manage all licenses | ALL | public | C15 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P023 | `fanmark_licenses` / Users can view their own licenses | SELECT | public | C15 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P024 | `fanmark_lottery_entries` / Admins can manage all lottery entries | ALL | public | C16 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P025 | `fanmark_lottery_entries` / Users can cancel their pending entries | UPDATE | public | C16 | `b2c3bcf9f465188565be2b3327db55d0f9932342737e1626418a258267f5a3be` |
| P026 | `fanmark_lottery_entries` / Users can create entries for grace licenses | INSERT | public | C16 | `c1ae15819d857bfaa00bab6271a58825626ad0c6e9774b4cc1e2eecc3b1c438f` |
| P027 | `fanmark_lottery_entries` / Users can view their own entries | SELECT | public | C16 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P028 | `fanmark_lottery_history` / Admins can view lottery history | SELECT | public | C17 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P029 | `fanmark_lottery_history` / System can create lottery history | INSERT | public | C17 | `3a50e53d3fb21d3eae8c8e816ff996199ae9ba43c3875523eff8d76b03fd9165` |
| P030 | `fanmark_messageboard_configs` / Users can manage messageboard configs for their own licenses | ALL | public | C18 | `3ad17ad6491a3f5904b9f05467b255a4c371fd94801d10af611d36a9871a7f06` |
| P031 | `fanmark_password_configs` / Deny direct access to password configs | ALL | public | C19 | `c52b5e7c8d3fbc4ca914b6b22bc20d2bc50595b574ff4d81c631929decac922b` |
| P032 | `fanmark_profiles` / Authenticated users can view public profiles or own | SELECT | authenticated | C20 | `19ff9ad23094a815dc0ef33e72a08a747b8effef2065aa92a5cd920cf2c164d7` |
| P033 | `fanmark_profiles` / Users can create profiles for their own licenses | INSERT | public | C20 | `737729b8d519f5421d3192fe0efb4d343518d31408aebb275a9fc54669578d24` |
| P034 | `fanmark_profiles` / Users can delete their own profiles | DELETE | public | C20 | `ff2203e4d6f751ad89c5806f214cfa6a92a7da8e9f36fad46608601419f7033e` |
| P035 | `fanmark_profiles` / Users can update their own profiles | UPDATE | public | C20 | `ff2203e4d6f751ad89c5806f214cfa6a92a7da8e9f36fad46608601419f7033e` |
| P036 | `fanmark_redirect_configs` / Users can manage redirect configs for their own licenses | ALL | public | C21 | `d3a7fb581fd0b234fc0f715ecdab96d21dc05b067995aade840fb4ad25c965e7` |
| P037 | `fanmark_tier_extension_prices` / Allow authenticated read extension prices | SELECT | authenticated | C22 | `1d663457805b0bb4a608b9a0ef6493d4dcc36a4fbf6173d6d00db42e0d36f709` |
| P038 | `fanmark_tiers` / Allow admin read fanmark tiers | SELECT | public | C23 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P039 | `fanmark_tiers` / Allow admin update fanmark tiers | UPDATE | public | C23 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P040 | `fanmark_tiers` / Anyone can view active tiers | SELECT | public | C23 | `aceb9a91d1245080513fce058732ebba165c277b17e716753473b740c66229cb` |
| P041 | `fanmark_tiers` / Only admins can manage tiers | ALL | public | C23 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P042 | `fanmark_transfer_codes` / Issuers can cancel their active transfer codes | UPDATE | public | C24 | `90a6ef9659c0e288c275b5973f4debf3073b9a98effc976aac9c0ecc265de557` |
| P043 | `fanmark_transfer_codes` / Issuers can view their own transfer codes | SELECT | public | C24 | `e4361caecafbb886e9a0d62e8724bf806f552d3c1d1444a33ccaad1088815d36` |
| P044 | `fanmark_transfer_codes` / System can manage all transfer codes | ALL | public | C24 | `1fe6038e620deb0ebbc9e6c93b5f7857264790e5be3bcc3df0a008089888e69b` |
| P045 | `fanmark_transfer_requests` / Issuers can view requests for their codes | SELECT | public | C25 | `0785f56e83e3ef02528c3ad00a102fb99ae75628eb5806af92f7359469222cae` |
| P046 | `fanmark_transfer_requests` / Requesters can view their own transfer requests | SELECT | public | C25 | `59f7689019286a2177d6cf45d88ea786e485c16557ad4effcabb0a7364322381` |
| P047 | `fanmark_transfer_requests` / System can manage all transfer requests | ALL | public | C25 | `1fe6038e620deb0ebbc9e6c93b5f7857264790e5be3bcc3df0a008089888e69b` |
| P048 | `fanmarks` / Anyone can view active fanmarks | SELECT | public | C26 | `1595a7b9d0c42970cbab095428240591d6102ec623a7ec9017e6a5078d347c88` |
| P049 | `fanmarks` / Fanmarks are accessible to authenticated users | SELECT | public | C26 | `4a4da6fab465fc9da842452f5d946f5c084070f71180e41daa8d445c115ba0a8` |
| P050 | `invitation_codes` / Only admins can manage invitation codes | ALL | public | C27 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P051 | `languages` / Languages are publicly readable | SELECT | public | C28 | `d1405b66718869464a5e5521d9d8c222b03178347ff0dbd20d0af91b93b09cec` |
| P052 | `languages` / Only admins can modify languages | ALL | public | C28 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P053 | `notification_events` / Admins can view notification events | SELECT | public | C29 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P054 | `notification_events` / System can manage notification events | ALL | public | C29 | `f0103ffb504182d8c5c423689e1864623e7b2c85e9035a79d65b97079185025b` |
| P055 | `notification_preferences` / Users can manage their own preferences | ALL | public | C30 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P056 | `notification_rules` / Admins can manage notification rules | ALL | public | C31 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P057 | `notification_templates` / Admins can manage templates | ALL | public | C32 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P058 | `notification_templates` / Authenticated users can view active templates | SELECT | public | C32 | `16a92e21a100f778f11a311f7b72591b5b3d62b2a18d3404d654ecfbf0b5f4e6` |
| P059 | `notifications` / Admins can view all notifications | SELECT | public | C33 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P060 | `notifications` / System can manage all notifications | ALL | public | C33 | `f0103ffb504182d8c5c423689e1864623e7b2c85e9035a79d65b97079185025b` |
| P061 | `notifications` / Users can update their own notifications | UPDATE | public | C33 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P062 | `notifications` / Users can view their own notifications | SELECT | public | C33 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P063 | `notifications_history` / Admins can view notification history | SELECT | public | C34 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P064 | `reserved_emoji_patterns` / Anyone can view active reserved patterns | SELECT | public | C35 | `aceb9a91d1245080513fce058732ebba165c277b17e716753473b740c66229cb` |
| P065 | `system_settings` / Admins can update all settings | UPDATE | authenticated | C36 | `59bf4bdb9d777fd26e26f857ad448fc1e1a9c210d454b0c9a9e2d1912f2beb6f` |
| P066 | `system_settings` / Admins can view all settings | SELECT | authenticated | C36 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P067 | `system_settings` / Anyone can view public settings | SELECT | public | C36 | `45092943423c79998c4692597e49c0d5df9094ee28db093db03140bc8b5872d4` |
| P068 | `user_roles` / Admins can manage all user roles | ALL | public | C37 | `aa7d02b71dadb84030add605f273a1fa14132ec29cd8f30714c0171337a31cb0` |
| P069 | `user_roles` / Users can view their own roles | SELECT | public | C37 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P070 | `user_settings` / Users can insert their own settings | INSERT | public | C38 | `cf321ab2c87e0790bfe05485464864d54ee3c3bc3cfa3a29d1a7148f7ca442f1` |
| P071 | `user_settings` / Users can update their own settings | UPDATE | public | C38 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P072 | `user_settings` / Users can view their own settings | SELECT | public | C38 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P073 | `user_subscriptions` / Admins can view all subscriptions | SELECT | public | C39 | `f0fa793ce9eac245f80cb36c1e202ab3f68594d111e7025274d1b0ab6cb9dc82` |
| P074 | `user_subscriptions` / Service role can manage all subscriptions | ALL | public | C39 | `f0103ffb504182d8c5c423689e1864623e7b2c85e9035a79d65b97079185025b` |
| P075 | `user_subscriptions` / Users can view their own subscriptions | SELECT | public | C39 | `9ab9d26b5c1eac4836f6cf3f2915640f9a6142f9bdec2ed2a0bd3a59b179334b` |
| P076 | `waitlist` / Anyone can join waitlist | INSERT | anon, authenticated | C40 | `91ae98cdd9c2beeb34dfc8ace9113ab43f823ee58a1d5ef03afbdeb2365a203e` |
| P077 | `waitlist` / Waitlist access only through secure functions | SELECT | public | C40 | `787c367e836be1483d06375183e3c9ebd0775f62120f82f258f7b66b98bb6ada` |

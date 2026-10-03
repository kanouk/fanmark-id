# Source trigger counterpart review

Current catalog-only observations: runtime2026-10-03T04:12:13.370671Z and
ACL2026-10-03T04:12:13.485862Z. All58 definitions,37 registered triggers,
77 policies and both fingerprints match the earlier snapshots. These are
separate read-only observations; no application/Auth rows were selected.
Runtime fingerprint:8ee600ced4b859664feba7e29c94b2166734473a40f920b0c8aef991be11b579.
Authorization fingerprint:8e9859a0fe06eb1e7b123f55f3cde2c1ae482081ed6912dd9dbc53a7452cd273.

## Privilege guards and current application paths

| Source function | Exact definition SHA-256 | Target and scope |
| --- | --- | --- |
| prevent_user_settings_insert_escalation | 0fae1473f8fa3b1caffa6f2dfd26a19a3215373b0bd17790c56c6128632d4de3 | Source permits service_role, otherwise requires is_admin for an admin-plan insert. Credential/OAuth provisioning always inserts server-selected free; no public generic settings insert exists. Real new-provider provisioning is still separately pending. |
| prevent_user_settings_privilege_escalation | 5d75756c214881d9ee330bc04d9795e6abae18d8aa3004ffc1d6ddacb9faa61d | Source permits service_role/admin and rejects any non-admin plan change. Target own-profile PATCH allows display_name/avatar_url/preferred_language only; the user cannot write plan/owner/Stripe/invitation fields. Administrator plan mutations pass the router's current-session MFA authorizer first. Billing changes come from verified reconciliation, whose price map contains creator/max/business only. |
| notify_security_breach | 0565124948f692b68362bfd980b8bee1222210cea800bcf721f9398d459fda81 | Source AFTER INSERT audit trigger raises a NOTICE for two unauthorized-waitlist/email action names; it stores no extra row and sends no email. Audit storage/route refusal and operator telemetry are separate target responsibilities. A real notification-delivery feature is not inferred from this function name; final operational logging acceptance remains open. |

Source user_settings INSERT/UPDATE/SELECT policies bind auth.uid() to user_id.
Target routes derive that UUID from Better Auth and expose no generic D1 table
access. Source PostgreSQL service-role bypass is replaced by named internal
operations and the administrator gate; source DB grants are not client inputs.
This reviews the named application paths, not arbitrary legacy SDK/RPC consumers.
The complete77-policy reconciliation retains its own requirement.

The existing own-profile native10 cases now apply all25 Business migrations
and Auth0003/0007/0008/0009, select staging suspension/OAuth-provisioning backends,
use real sessions and local R2, and check both stores' foreign keys after every
case. The invitation reference is seeded instead of omitting its real FK.
They cover own/foreign profile preservation, rejected privilege/identity fields,
R2 upload/update/delete/readback and password setup/retry. Local10/10,
Worker typecheck and focused lint pass. The old reduced fixture and its custom
privilege trigger are removed, so target validation is proved without that
fixture-only guard. test:profile-d1 now joins test:api-contracts-d1/npm test;
new exact-head CI is required. No runtime deployment is required for this test
change; accepted runtime remains bce8993/Workerc09. Source guard definitions
and the production Supabase environment are unchanged.

## Registered bindings and finite timestamp review

The29 update_updated_at_column bindings all assign NEW.updated_at=now() in
PostgreSQL. Target application writes capture trusted server timestamps;
immutable reference releases retain source timestamps and change only edited
records. Imports preserve historical timestamps. Target-only lease/claim fields
have separate bookkeeping semantics. Direct D1 console writes do not inherit
PostgreSQL BEFORE-trigger behavior.

The index below accounts for all37 registered bindings exactly once. A located
writer is a review entry point, not approval of all its statements or callers.
Remaining timestamp work is to verify each mutable current writer and document
no-op/import/internal-bookkeeping differences against its feature contract.
The initial scan flagged dynamic profile SQL, a legacy fixture runner, and
internal lifecycle_claim_id writes; manual inspection is needed to distinguish
these from a missing timestamp on a real business transition. Source-shaped
lifecycle transitions explicitly store/verify captured_now in their updated_at;
license-expiry-scheduled.mjs uses those source-shaped repositories.

| Source binding | Function | Definition SHA-256 prefix | Target review entry point |
| --- | --- | --- | --- |
| `auth.users.on_auth_user_created` | `handle_new_user` | `0da996fbca2881e1` | invitation-signup-d1-api.ts / oauth-signup-provisioning.mjs; real provider setup remains pending |
| `public.audit_logs.security_alert_trigger` | `notify_security_breach` | `f2ce3b273899bc48` | NOTICE-only source behavior; audit storage and operational logging are separate, above |
| `public.broadcast_emails.update_broadcast_emails_updated_at` | `update_updated_at_column` | `84f1b85aa5d880e6` | broadcast-email-admin-d1-api.ts, broadcast-email-delivery-d1.ts |
| `public.email_templates.update_email_templates_updated_at` | `update_updated_at_column` | `9c9494a079abea3b` | admin-email-templates-d1-api.ts |
| `public.emoji_master.audit_emoji_master_changes` | `log_emoji_master_changes` | `003687c5df57e0b3` | emoji-master-admin-d1-repository.ts + Master0008; emoji-master-change-audit.md |
| `public.emoji_master.update_emoji_master_updated_at` | `update_updated_at_column` | `46c9854aca01e2c1` | emoji-master-admin-d1-repository.ts |
| `public.enterprise_user_settings.update_enterprise_user_settings_updated_at` | `update_updated_at_column` | `a54404fc4fd0332b` | admin-user-management-d1-api.ts |
| `public.extension_coupons.update_extension_coupons_updated_at` | `update_updated_at_column` | `45f61532573a0f3a` | extension-coupon-admin-d1-api.ts |
| `public.fanmark_availability_rules.update_fanmark_availability_rules_updated_at` | `update_updated_at_column` | `c537477a3f83808b` | account-deletion-d1-api.ts, availability-rules-admin-d1-api.ts |
| `public.fanmark_basic_configs.update_fanmark_basic_configs_updated_at` | `update_updated_at_column` | `16ceba96d100168f` | fanmark-registration-d1-api.ts, fanmark-settings-d1-api.ts, fanmark-transfer-d1-api.ts |
| `public.fanmark_licenses.update_fanmark_licenses_updated_at` | `update_updated_at_column` | `4b1fd179f2dc025e` | account-deletion-d1-api.ts, admin-user-management-d1-api.ts, fanmark-registration-d1-api.ts, fanmark-return-d1-api.ts, fanmark-transfer-d1-api.ts, license-expiry-source.mjs, license-expiry.mjs, license-grace-finalization-source.mjs, stripe-subscription-reconciliation-d1.ts, stripe-webhook-d1-application.ts |
| `public.fanmark_lottery_entries.audit_lottery_entry_changes` | `log_lottery_entry_changes` | `122ce5fd21b07a78` | fanmark-lottery-d1-api.ts / lottery-cancellation-audit.ts; fanmark-lottery-api.md; remaining writers separately |
| `public.fanmark_lottery_entries.update_lottery_entries_updated_at` | `update_updated_at_column` | `a195cd1d84ce699c` | fanmark-lottery-d1-api.ts, license-grace-finalization-source.mjs, lottery-cancellation-audit.ts, stripe-webhook-d1-application.ts |
| `public.fanmark_messageboard_configs.update_fanmark_messageboard_configs_updated_at` | `update_updated_at_column` | `604da5cc0c25a78d` | fanmark-registration-d1-api.ts, fanmark-settings-d1-api.ts |
| `public.fanmark_password_configs.update_fanmark_password_configs_updated_at` | `update_updated_at_column` | `d098a5c9d75ee67b` | fanmark-settings-d1-api.ts |
| `public.fanmark_profiles.update_fanmark_profiles_updated_at` | `update_updated_at_column` | `0f1183a55d171c2e` | fanmark-profile-d1-api.ts, fanmark-registration-d1-api.ts, fanmark-settings-d1-api.ts |
| `public.fanmark_redirect_configs.update_fanmark_redirect_configs_updated_at` | `update_updated_at_column` | `f3dbf8d9b9ff9e83` | fanmark-registration-d1-api.ts, fanmark-settings-d1-api.ts |
| `public.fanmark_tier_extension_prices.update_fanmark_tier_extension_prices_updated_at` | `update_updated_at_column` | `c61f46fd4d8f8567` | reference-master-admin-d1-repository.ts (versioned rows/import; tier/price edits) |
| `public.fanmark_tiers.update_fanmark_tiers_updated_at` | `update_updated_at_column` | `9bb96e54f9538f45` | reference-master-admin-d1-repository.ts (versioned rows/import; tier/price edits) |
| `public.fanmark_transfer_codes.update_fanmark_transfer_codes_updated_at` | `update_updated_at_column` | `8a86d53411f4e81e` | fanmark-transfer-d1-api.ts |
| `public.fanmark_transfer_requests.update_fanmark_transfer_requests_updated_at` | `update_updated_at_column` | `a64167a6750e12f2` | fanmark-transfer-d1-api.ts |
| `public.fanmarks.trg_link_fanmark_discovery` | `link_fanmark_discovery_trigger` | `8b3deef998acb5bc` | Business0022 + registration; fanmark-registration-api.md |
| `public.fanmarks.update_fanmarks_updated_at` | `update_updated_at_column` | `60a887477a5d3b22` | fanmark-registration-d1-api.ts |
| `public.invitation_codes.update_invitation_codes_updated_at` | `update_updated_at_column` | `03f2ffd0f3ddb4e8` | invitation-admin-d1-api.ts |
| `public.languages.update_languages_updated_at` | `update_updated_at_column` | `3e3bbb569f1f70f2` | reference-master-admin-d1-repository.ts (versioned rows/import; tier/price edits) |
| `public.notification_events.activate_notification_worker_on_pending_event` | `activate_notification_worker_on_pending_event` | `94b483239739ccc0` | Business0024 + notification-wake.ts; notification-worker-wake.md |
| `public.notification_events.update_notification_events_updated_at` | `update_updated_at_column` | `31fa188a244d9960` | admin-user-management-d1-api.ts, fanmark-lottery-d1-api.ts, license-expiry-source.mjs, license-grace-finalization-source.mjs, notification-master-d1-api.ts, notifications-scheduled.ts |
| `public.notification_preferences.update_notification_preferences_updated_at` | `update_updated_at_column` | `596de274340b1991` | No current app editor; importer preserves timestamps; notifications-scheduled.ts reads preferences |
| `public.notification_rules.update_notification_rules_updated_at` | `update_updated_at_column` | `a57a527cfb12041d` | account-deletion-d1-api.ts, notification-master-d1-api.ts |
| `public.notification_templates.update_notification_templates_updated_at` | `update_updated_at_column` | `99d05107957c0366` | notification-master-d1-api.ts |
| `public.notifications.update_notifications_updated_at` | `update_updated_at_column` | `c716c2864dfba493` | notifications-d1-api.ts, notifications-scheduled.ts |
| `public.reserved_emoji_patterns.update_reserved_emoji_patterns_updated_at` | `update_updated_at_column` | `c8f05d7ec5dc8284` | reference-master-admin-d1-repository.ts (versioned rows/import; tier/price edits) |
| `public.system_settings.update_system_settings_updated_at` | `update_updated_at_column` | `caf30054c155f1c5` | lifecycle-settings-d1-api.ts, maintenance-settings-d1-api.ts, system-settings-d1-api.ts |
| `public.user_settings.update_user_settings_updated_at` | `update_updated_at_column` | `75b42674639b8eda` | admin-user-management-d1-api.ts, invitation-signup-d1-api.ts, oauth-signup-provisioning.mjs, password-setup-d1-api.ts, profile-d1-repository.ts, stripe-plan-checkout-d1-api.ts, stripe-subscription-reconciliation-d1.ts |
| `public.user_settings.user_settings_prevent_insert_escalation` | `prevent_user_settings_insert_escalation` | `66bf1b4da720561b` | Server-selected free signup / named administrator operations; reviewed above |
| `public.user_settings.user_settings_prevent_privilege_escalation` | `prevent_user_settings_privilege_escalation` | `eed48f4d36b3ad69` | Own-profile allowlist / current-session MFA / verified billing; reviewed above |
| `public.user_subscriptions.update_user_subscriptions_updated_at` | `update_updated_at_column` | `d9b7b5ff1913af93` | stripe-invoice-projection-d1.ts, stripe-subscription-reconciliation-d1.ts |

The four unbound trigger definitions remain in source-runtime-review.md and do
not gain target triggers. Ordinary functions without bindings still require
body/caller review; they are not classified inactive from this index.
Catalog classifiers remain fullRuntimeReconciled=false and
authorizationReconciled=false. No source/index/import/provider/ops gate is
cleared merely by listing its counterpart. See COMPLETION.md for the six
remaining work packages and the final real-user/domain phase.

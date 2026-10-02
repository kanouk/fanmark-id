# fanmark.id repository inventory (offline)

Base commit: `b34638b41b7cd1604263a58140bf297821e30807`

This report is generated from the checked-out repository only. It makes no network calls, reads no credentials, and does not claim that local generated types, migrations, or SQL snapshots equal the current production state.

Run from the repository root:

```sh
node scripts/migration/inventory.mjs --output docs/migration/repository-inventory.md
```

## Generated Supabase types

Source: `src/integrations/supabase/types.ts` (generated checkout artifact; counts are not live counts).

| Object kind | Count |
| --- | --- |
| Tables | 40 |
| Views | 1 |
| Functions / RPCs | 45 |

### Tables

- `audit_logs` (types.ts:17)
- `broadcast_emails` (types.ts:50)
- `email_templates` (types.ts:107)
- `emoji_master` (types.ts:143)
- `enterprise_user_settings` (types.ts:182)
- `extension_coupon_usages` (types.ts:215)
- `extension_coupons` (types.ts:271)
- `fanmark_access_daily_stats` (types.ts:313)
- `fanmark_access_logs` (types.ts:401)
- `fanmark_availability_rules` (types.ts:480)
- `fanmark_basic_configs` (types.ts:519)
- `fanmark_discoveries` (types.ts:561)
- `fanmark_events` (types.ts:605)
- `fanmark_favorites` (types.ts:640)
- `fanmark_licenses` (types.ts:685)
- `fanmark_lottery_entries` (types.ts:753)
- `fanmark_lottery_history` (types.ts:823)
- `fanmark_messageboard_configs` (types.ts:894)
- `fanmark_password_configs` (types.ts:933)
- `fanmark_profiles` (types.ts:975)
- `fanmark_redirect_configs` (types.ts:1026)
- `fanmark_tier_extension_prices` (types.ts:1065)
- `fanmark_tiers` (types.ts:1101)
- `fanmark_transfer_codes` (types.ts:1143)
- `fanmark_transfer_requests` (types.ts:1204)
- `fanmarks` (types.ts:1284)
- `invitation_codes` (types.ts:1323)
- `languages` (types.ts:1362)
- `notification_events` (types.ts:1395)
- `notification_preferences` (types.ts:1446)
- `notification_rules` (types.ts:1476)
- `notification_templates` (types.ts:1536)
- `notifications` (types.ts:1581)
- `notifications_history` (types.ts:1662)
- `reserved_emoji_patterns` (types.ts:1680)
- `system_settings` (types.ts:1710)
- `user_roles` (types.ts:1740)
- `user_settings` (types.ts:1764)
- `user_subscriptions` (types.ts:1817)
- `waitlist` (types.ts:1883)

### Views

- `recent_active_fanmarks` (types.ts:1909)

### Functions / RPCs

- `activate_notification_worker` (types.ts:1929)
- `add_fanmark_favorite` (types.ts:1930)
- `archive_old_notifications` (types.ts:1934)
- `check_fanmark_availability` (types.ts:1938)
- `check_fanmark_availability_secure` (types.ts:1942)
- `check_username_availability_secure` (types.ts:1946)
- `classify_fanmark_tier` (types.ts:1950)
- `count_fanmark_emoji_units` (types.ts:1959)
- `create_notification_event` (types.ts:1960)
- `deactivate_notification_worker_if_idle` (types.ts:1970)
- `generate_safe_display_name` (types.ts:1971)
- `generate_transfer_code_string` (types.ts:1975)
- `get_fanmark_by_emoji` (types.ts:1976)
- `get_fanmark_by_short_id` (types.ts:1992)
- `get_fanmark_complete_data` (types.ts:2013)
- `get_fanmark_details_by_short_id` (types.ts:2043)
- `get_fanmark_ownership_status` (types.ts:2073)
- `get_favorite_fanmarks` (types.ts:2080)
- `get_public_emoji_profile` (types.ts:2107)
- `get_public_fanmark_profile` (types.ts:2119)
- `get_unread_notification_count` (types.ts:2132)
- `get_waitlist_email_by_id` (types.ts:2136)
- `get_waitlist_secure` (types.ts:2140)
- `has_active_transfer` (types.ts:2150)
- `has_role` (types.ts:2151)
- `is_admin` (types.ts:2158)
- `is_fanmark_licensed` (types.ts:2159)
- `is_fanmark_password_protected` (types.ts:2163)
- `is_super_admin` (types.ts:2167)
- `link_fanmark_discovery` (types.ts:2168)
- `list_recent_fanmarks` (types.ts:2172)
- `mark_all_notifications_read` (types.ts:2182)
- `mark_notification_read` (types.ts:2186)
- `normalize_emoji_ids` (types.ts:2190)
- `record_fanmark_search` (types.ts:2191)
- `remove_fanmark_favorite` (types.ts:2195)
- `render_notification_template` (types.ts:2199)
- `search_fanmarks_with_lottery` (types.ts:2208)
- `seq_key` (types.ts:2212)
- `toggle_fanmark_favorite` (types.ts:2213)
- `upsert_fanmark_discovery` (types.ts:2217)
- `upsert_fanmark_password_config` (types.ts:2221)
- `use_invitation_code` (types.ts:2229)
- `validate_invitation_code` (types.ts:2237)
- `verify_fanmark_password` (types.ts:2245)

## Edge entrypoints

Found 34 local directories with `index.ts` (`_shared` excluded). 34 have an explicit `verify_jwt` entry in `supabase/config.toml`; an absent value is reported as unconfigured and requires live verification.

| Function | Entrypoint | verify_jwt in config | Handler signal |
| --- | --- | --- | --- |
| `admin-expire-license` | `supabase/functions/admin-expire-license/index.ts` | false | serve:13 |
| `admin-get-user-detail` | `supabase/functions/admin-get-user-detail/index.ts` | false | serve:82 |
| `admin-list-users` | `supabase/functions/admin-list-users/index.ts` | false | serve:98 |
| `admin-toggle-user-status` | `supabase/functions/admin-toggle-user-status/index.ts` | false | serve:22 |
| `admin-trigger-password-reset` | `supabase/functions/admin-trigger-password-reset/index.ts` | false | serve:9 |
| `admin-update-user-plan` | `supabase/functions/admin-update-user-plan/index.ts` | false | serve:32 |
| `apply-extension-coupon` | `supabase/functions/apply-extension-coupon/index.ts` | true | serve:63 |
| `apply-fanmark-lottery` | `supabase/functions/apply-fanmark-lottery/index.ts` | true | serve:11 |
| `apply-transfer-code` | `supabase/functions/apply-transfer-code/index.ts` | true | serve:10 |
| `approve-transfer-request` | `supabase/functions/approve-transfer-request/index.ts` | true | serve:19 |
| `bulk-return-fanmarks` | `supabase/functions/bulk-return-fanmarks/index.ts` | false | serve:26 |
| `cancel-lottery-entry` | `supabase/functions/cancel-lottery-entry/index.ts` | true | serve:11 |
| `cancel-transfer-code` | `supabase/functions/cancel-transfer-code/index.ts` | true | serve:9 |
| `change-subscription` | `supabase/functions/change-subscription/index.ts` | false | serve:15 |
| `check-email-exists` | `supabase/functions/check-email-exists/index.ts` | false | serve:95 |
| `check-expired-licenses` | `supabase/functions/check-expired-licenses/index.ts` | false | serve:10 |
| `check-subscription` | `supabase/functions/check-subscription/index.ts` | false | serve:15 |
| `create-checkout` | `supabase/functions/create-checkout/index.ts` | false | serve:15 |
| `create-extension-checkout` | `supabase/functions/create-extension-checkout/index.ts` | true | serve:31 |
| `customer-portal` | `supabase/functions/customer-portal/index.ts` | false | serve:15 |
| `delete-user-account` | `supabase/functions/delete-user-account/index.ts` | false | serve:251 |
| `extend-fanmark-license` | `supabase/functions/extend-fanmark-license/index.ts` | false | serve:56 |
| `fanmark-ogp` | `supabase/functions/fanmark-ogp/index.ts` | false | serve:135 |
| `generate-ogp-image` | `supabase/functions/generate-ogp-image/index.ts` | false | serve:111 |
| `generate-transfer-code` | `supabase/functions/generate-transfer-code/index.ts` | true | serve:12 |
| `handle-stripe-webhook` | `supabase/functions/handle-stripe-webhook/index.ts` | false | serve:81 |
| `process-notification-events` | `supabase/functions/process-notification-events/index.ts` | false | serve:33 |
| `record-fanmark-access` | `supabase/functions/record-fanmark-access/index.ts` | false | serve:117 |
| `register-fanmark` | `supabase/functions/register-fanmark/index.ts` | true | serve:386 |
| `reject-transfer-request` | `supabase/functions/reject-transfer-request/index.ts` | true | serve:9 |
| `reset-fanmark-data` | `supabase/functions/reset-fanmark-data/index.ts` | false | serve:8 |
| `return-fanmark` | `supabase/functions/return-fanmark/index.ts` | true | serve:13 |
| `send-auth-email` | `supabase/functions/send-auth-email/index.ts` | false | serve:343 |
| `send-broadcast-email` | `supabase/functions/send-broadcast-email/index.ts` | true | serve:514 |

## Frontend Supabase callsites

Scanned `src/**/*.{ts,tsx}`: 211 callsites. Each row records the first line of the call and the extracted operation.

All 211 checked-in static callsites now have an owner, data-class, and Cloudflare
replacement or retention mapping across this document and the
[remaining-callsite map](frontend-callsite-map.md). This closes the static
mapping count only; wrapper/indirect calls and live production reconciliation
remain separate checks.

| Location | Kind | Target | Operation | Dynamic expression |
| --- | --- | --- | --- | --- |
| `src/components/AdminApp.tsx:44` | rpc | `is_admin` | `rpc` |  |
| `src/components/AdminApp.tsx:88` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/components/AdminApp.tsx:100` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/AdminApp.tsx:137` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/components/AdminBroadcastEmail.tsx:160` | table | `broadcast_emails` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:161` | table | `email_templates` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:192` | table | `user_settings` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:246` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:249` | table | `broadcast_emails` | `table.insert` |  |
| `src/components/AdminBroadcastEmail.tsx:285` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:288` | edge | `send-broadcast-email` | `edge_function_invoke` |  |
| `src/components/AdminBroadcastEmail.tsx:319` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:322` | edge | `send-broadcast-email` | `edge_function_invoke` |  |
| `src/components/AdminDataReset.tsx:38` | edge | `reset-fanmark-data` | `edge_function_invoke` |  |
| `src/components/AdminEmailTemplates.tsx:52` | table | `email_templates` | `table.select` |  |
| `src/components/AdminEmailTemplates.tsx:74` | table | `email_templates` | `table.update` |  |
| `src/components/AdminEmojiMaster.tsx:89` | table | `emoji_master` | `table.select` |  |
| `src/components/AdminEmojiMaster.tsx:180` | table | `emoji_master` | `table.update` |  |
| `src/components/AdminEmojiMaster.tsx:184` | table | `emoji_master` | `table.insert` |  |
| `src/components/AdminEmojiMaster.tsx:192` | table | `emoji_master` | `table.delete` |  |
| `src/components/AdminEmojiMaster.tsx:229` | table | `emoji_master` | `table.upsert` |  |
| `src/components/AdminExpirationTest.tsx:66` | edge | `check-expired-licenses` | `edge_function_invoke` |  |
| `src/components/AdminExtensionCoupons.tsx:99` | table | `fanmark_tiers` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:64` | rpc | `create_notification_event` | `rpc` |  |
| `src/components/AdminNotificationManager.tsx:89` | table | `notification_events` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:105` | table | `notifications` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:124` | table | `notification_rules` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:139` | table | `notification_templates` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:157` | table | `notification_rules` | `table.update` |  |
| `src/components/AdminNotificationManager.tsx:189` | table | `notification_templates` | `table.update` |  |
| `src/components/AdminPatternRules.tsx:31` | table | `fanmark_availability_rules` | `table.select` |  |
| `src/components/AdminPatternRules.tsx:81` | table | `fanmark_availability_rules` | `table.update` |  |
| `src/components/AdminPatternRules.tsx:129` | table | `fanmark_availability_rules` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:80` | table | `fanmark_tier_extension_prices` | `table.select` |  |
| `src/components/AdminTierExtensionPrices.tsx:85` | table | `fanmark_tiers` | `table.select` |  |
| `src/components/AdminTierExtensionPrices.tsx:149` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:186` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:264` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:306` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:373` | table | `fanmark_tiers` | `table.update` |  |
| `src/components/AdminUserManagement.tsx:186` | edge | `admin-list-users` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:204` | edge | `admin-get-user-detail` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:235` | edge | `admin-update-user-plan` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:275` | edge | `admin-toggle-user-status` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:315` | edge | `admin-trigger-password-reset` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:359` | edge | `admin-expire-license` | `edge_function_invoke` |  |
| `src/components/auth/MFAChallenge.tsx:43` | auth_mfa | `auth` | `auth.mfa.unenroll` |  |
| `src/components/auth/MFAChallenge.tsx:73` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/auth/MFAChallenge.tsx:108` | auth_mfa | `auth` | `auth.mfa.challenge` |  |
| `src/components/auth/MFAChallenge.tsx:120` | auth_mfa | `auth` | `auth.mfa.verify` |  |
| `src/components/auth/MFAEnrollment.tsx:37` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/auth/MFAEnrollment.tsx:62` | auth_mfa | `auth` | `auth.mfa.unenroll` |  |
| `src/components/auth/MFAEnrollment.tsx:82` | auth_mfa | `auth` | `auth.mfa.enroll` |  |
| `src/components/auth/MFAEnrollment.tsx:136` | auth_mfa | `auth` | `auth.mfa.challenge` |  |
| `src/components/auth/MFAEnrollment.tsx:148` | auth_mfa | `auth` | `auth.mfa.verify` |  |
| `src/components/ExtendLicenseDialog.tsx:102` | table | `fanmark_tier_extension_prices` | `table.select` |  |
| `src/components/ExtendLicenseDialog.tsx:336` | edge | `apply-extension-coupon` | `edge_function_invoke` |  |
| `src/components/FanmarkAccess.tsx:130` | rpc | `get_fanmark_by_emoji` | `rpc` |  |
| `src/components/FanmarkAccessByShortId.tsx:87` | rpc | `get_fanmark_by_short_id` | `rpc` |  |
| `src/components/FanmarkAccessByShortId.tsx:146` | edge | `record-fanmark-access` | `edge_function_invoke` |  |
| `src/components/FanmarkAcquisition.tsx:228` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkDashboard.tsx:233` | edge | `return-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkDashboard.tsx:332` | edge | `create-extension-checkout` | `edge_function_invoke` |  |
| `src/components/FanmarkDashboard.tsx:443` | table | `fanmark_licenses` | `table.select` |  |
| `src/components/FanmarkDashboard.tsx:484` | table | `fanmark_basic_configs` | `table.select` |  |
| `src/components/FanmarkDashboard.tsx:630` | table | `fanmark_access_daily_stats` | `table.select` |  |
| `src/components/FanmarkQuickRegistration.tsx:139` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkRegistrationForm.tsx:220` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkSettings.tsx:439` | table | `fanmark_basic_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:453` | table | `fanmark_redirect_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:465` | table | `fanmark_messageboard_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:480` | rpc | `upsert_fanmark_password_config` | `rpc` |  |
| `src/components/FanmarkSettings.tsx:490` | rpc | `upsert_fanmark_password_config` | `rpc` |  |
| `src/components/FanmarkSettings.tsx:506` | table | `fanmark_profiles` | `table.select` |  |
| `src/components/FanmarkSettings.tsx:514` | table | `fanmark_profiles` | `table.update` |  |
| `src/components/FanmarkSettings.tsx:524` | table | `fanmark_profiles` | `table.insert` |  |
| `src/components/layout/AppHeader.tsx:98` | table | `notifications` | `table.select` |  |
| `src/components/layout/AppHeader.tsx:117` | realtime | `notifications` | `realtime.channel` | `` `notifications-preview-${user.id}` `` |
| `src/components/layout/AppHeader.tsx:135` | realtime | `notifications` | `realtime.removeChannel` |  |
| `src/components/layout/AppHeader.tsx:164` | rpc | `mark_notification_read` | `rpc` |  |
| `src/components/MaintenanceGate.tsx:48` | rpc | `is_admin` | `rpc` |  |
| `src/components/PasswordProtection.tsx:59` | rpc | `verify_fanmark_password` | `rpc` |  |
| `src/components/RecentFanmarksScroll.tsx:25` | rpc | `list_recent_fanmarks` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:54` | rpc | `is_super_admin` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:93` | rpc | `get_waitlist_secure` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:108` | table | `audit_logs` | `table.select` |  |
| `src/components/SecureWaitlistAdmin.tsx:137` | rpc | `get_waitlist_email_by_id` | `rpc` |  |
| `src/components/UserProfileForm.tsx:143` | edge | `bulk-return-fanmarks` | `edge_function_invoke` |  |
| `src/hooks/useAuth.tsx:52` | table | `user_settings` | `table.select` |  |
| `src/hooks/useAuth.tsx:134` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/useAuth.tsx:149` | auth | `auth` | `auth.onAuthStateChange` |  |
| `src/hooks/useAuth.tsx:186` | auth | `auth` | `auth.signOut` |  |
| `src/hooks/useAuthForm.tsx:94` | edge | `check-email-exists` | `edge_function_invoke` |  |
| `src/hooks/useAuthForm.tsx:153` | rpc | `validate_invitation_code` | `rpc` |  |
| `src/hooks/useAuthForm.tsx:183` | auth | `auth` | `auth.signUp` |  |
| `src/hooks/useAuthForm.tsx:192` | rpc | `use_invitation_code` | `rpc` |  |
| `src/hooks/useAuthForm.tsx:204` | table | `user_settings` | `table.update` |  |
| `src/hooks/useAuthForm.tsx:259` | auth | `auth` | `auth.signInWithPassword` |  |
| `src/hooks/useAuthForm.tsx:304` | auth | `auth` | `auth.resetPasswordForEmail` |  |
| `src/hooks/useAuthForm.tsx:340` | auth | `auth` | `auth.resend` |  |
| `src/hooks/useAuthForm.tsx:375` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:403` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:431` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:459` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAvatarUpload.tsx:35` | storage | `avatars` | `storage.upload` |  |
| `src/hooks/useAvatarUpload.tsx:45` | storage | `avatars` | `storage.getPublicUrl` |  |
| `src/hooks/useAvatarUpload.tsx:113` | storage | `avatars` | `storage.remove` |  |
| `src/hooks/useCoverImageUpload.tsx:39` | storage | `cover-images` | `storage.upload` |  |
| `src/hooks/useCoverImageUpload.tsx:49` | storage | `cover-images` | `storage.getPublicUrl` |  |
| `src/hooks/useCoverImageUpload.tsx:123` | storage | `cover-images` | `storage.remove` |  |
| `src/hooks/useEmojiProfile.tsx:51` | rpc | `get_public_emoji_profile` | `rpc` |  |
| `src/hooks/useEmojiProfile.tsx:73` | table | `fanmark_profiles` | `table.select` |  |
| `src/hooks/useEmojiProfile.tsx:115` | table | `fanmark_profiles` | `table.select` |  |
| `src/hooks/useEmojiProfile.tsx:154` | table | `fanmark_profiles` | `table.upsert` |  |
| `src/hooks/useExtensionCouponAdmin.ts:58` | table | `extension_coupons` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:91` | table | `extension_coupons` | `table.insert` |  |
| `src/hooks/useExtensionCouponAdmin.ts:124` | table | `extension_coupons` | `table.update` |  |
| `src/hooks/useExtensionCouponAdmin.ts:147` | table | `extension_coupons` | `table.delete` |  |
| `src/hooks/useExtensionCouponAdmin.ts:166` | table | `extension_coupon_usages` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:177` | table | `fanmark_licenses` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:183` | table | `user_settings` | `table.select` |  |
| `src/hooks/useFanmarkByShortId.ts:57` | rpc | `get_fanmark_by_short_id` | `rpc` |  |
| `src/hooks/useFanmarkDetails.tsx:93` | rpc | `get_fanmark_details_by_short_id` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:148` | rpc | `list_recent_fanmarks` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:254` | auth | `auth` | `auth.getUser` |  |
| `src/hooks/useFanmarkSearch.tsx:287` | rpc | `check_fanmark_availability` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:301` | rpc | `record_fanmark_search` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:334` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:517` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/hooks/useFanmarkSearch.tsx:559` | rpc | `check_fanmark_availability` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:569` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/hooks/useInvitationAdmin.ts:37` | table | `invitation_codes` | `table.select` |  |
| `src/hooks/useInvitationAdmin.ts:81` | table | `invitation_codes` | `table.insert` |  |
| `src/hooks/useInvitationAdmin.ts:110` | table | `invitation_codes` | `table.update` |  |
| `src/hooks/useInvitationAdmin.ts:139` | table | `invitation_codes` | `table.delete` |  |
| `src/hooks/useInvitationCode.tsx:42` | rpc | `validate_invitation_code` | `rpc` |  |
| `src/hooks/useInvitationCode.tsx:76` | rpc | `use_invitation_code` | `rpc` |  |
| `src/hooks/useInvitationCode.tsx:120` | table | `waitlist` | `table.insert` |  |
| `src/hooks/useLanguages.tsx:44` | table | `languages` | `table.select` |  |
| `src/hooks/useLifecycleSettings.ts:21` | table | `system_settings` | `table.select` |  |
| `src/hooks/useLifecycleSettings.ts:33` | table | `system_settings` | `table.update` |  |
| `src/hooks/useLotteryEntry.tsx:125` | edge | `apply-fanmark-lottery` | `edge_function_invoke` |  |
| `src/hooks/useLotteryEntry.tsx:172` | edge | `cancel-lottery-entry` | `edge_function_invoke` |  |
| `src/hooks/useMaintenanceSettings.ts:36` | table | `system_settings` | `table.select` |  |
| `src/hooks/useMaintenanceSettings.ts:50` | table | `system_settings` | `table.update` |  |
| `src/hooks/usePasswordReset.tsx:34` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/usePasswordReset.tsx:47` | auth | `auth` | `auth.setSession` |  |
| `src/hooks/usePasswordReset.tsx:83` | auth | `auth` | `auth.updateUser` |  |
| `src/hooks/usePreferredLanguage.ts:28` | table | `user_settings` | `table.update` |  |
| `src/hooks/useProfile.tsx:23` | table | `user_settings` | `table.select` |  |
| `src/hooks/useProfile.tsx:58` | realtime | `user_settings` | `realtime.channel` |  |
| `src/hooks/useProfile.tsx:70` | realtime | `user_settings` | `realtime.removeChannel` |  |
| `src/hooks/useProfile.tsx:120` | table | `user_settings` | `table.update` |  |
| `src/hooks/useProfile.tsx:145` | rpc | `check_username_availability_secure` | `rpc` |  |
| `src/hooks/useSubscription.tsx:84` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/useSubscription.tsx:86` | edge | `check-subscription` | `edge_function_invoke` |  |
| `src/hooks/useSubscription.tsx:93` | table | `user_subscriptions` | `table.select` |  |
| `src/hooks/useSubscription.tsx:124` | realtime | `user_subscriptions` | `realtime.channel` |  |
| `src/hooks/useSubscription.tsx:132` | realtime | `user_subscriptions` | `realtime.removeChannel` |  |
| `src/hooks/useSystemSettings.tsx:96` | table | `system_settings` | `table.select` |  |
| `src/hooks/useSystemSettings.tsx:178` | table | `system_settings` | `table.update` |  |
| `src/hooks/useTransferCode.ts:61` | table | `fanmark_transfer_codes` | `table.select` |  |
| `src/hooks/useTransferCode.ts:94` | table | `fanmark_transfer_requests` | `table.select` |  |
| `src/hooks/useTransferCode.ts:133` | table | `fanmark_transfer_requests` | `table.select` |  |
| `src/hooks/useTransferCode.ts:193` | edge | `generate-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:277` | edge | `apply-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:379` | edge | `approve-transfer-request` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:405` | edge | `reject-transfer-request` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:431` | edge | `cancel-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useUnreadNotifications.ts:18` | rpc | `get_unread_notification_count` | `rpc` |  |
| `src/lib/emoji-master-utils.ts:120` | table | `emoji_master` | `table.select` |  |
| `src/lib/favorites-backend.ts:13` | rpc | `get_favorite_fanmarks` | `rpc` |  |
| `src/lib/favorites-backend.ts:22` | rpc | `add_fanmark_favorite` | `rpc` |  |
| `src/lib/favorites-backend.ts:33` | rpc | `remove_fanmark_favorite` | `rpc` |  |
| `src/lib/plan-utils.ts:58` | table | `fanmark_licenses` | `table.select` |  |
| `src/lib/profile-utils.ts:27` | auth | `auth` | `auth.getUser` |  |
| `src/lib/profile-utils.ts:34` | table | `user_settings` | `table.select` |  |
| `src/lib/profile-utils.ts:59` | rpc | `check_username_availability_secure` | `rpc` |  |
| `src/pages/AdminAuth.tsx:42` | auth | `auth` | `auth.getSession` |  |
| `src/pages/AdminAuth.tsx:76` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/pages/AdminAuth.tsx:89` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/pages/AdminAuth.tsx:118` | auth | `auth` | `auth.signInWithPassword` |  |
| `src/pages/AdminAuth.tsx:172` | auth | `auth` | `auth.signOut` |  |
| `src/pages/Analytics.tsx:132` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/Analytics.tsx:161` | table | `fanmark_basic_configs` | `table.select` |  |
| `src/pages/Analytics.tsx:222` | table | `fanmark_access_daily_stats` | `table.select` |  |
| `src/pages/EmojiProfileEdit.tsx:39` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/FanmarkMessageboardPreview.tsx:69` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkProfilePreview.tsx:113` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkSettingsPage.tsx:79` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkSettingsPage.tsx:113` | table | `fanmark_profiles` | `table.select` |  |
| `src/pages/ForgotPassword.tsx:65` | auth | `auth` | `auth.resetPasswordForEmail` |  |
| `src/pages/Index.tsx:85` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/Notifications.tsx:42` | table | `notifications` | `table.select` |  |
| `src/pages/Notifications.tsx:66` | realtime | `notifications` | `realtime.channel` |  |
| `src/pages/Notifications.tsx:83` | realtime | `notifications` | `realtime.removeChannel` |  |
| `src/pages/Notifications.tsx:92` | rpc | `mark_notification_read` | `rpc` |  |
| `src/pages/Notifications.tsx:128` | rpc | `mark_all_notifications_read` | `rpc` |  |
| `src/pages/Notifications.tsx:139` | table | `notifications` | `table.select` |  |
| `src/pages/PasswordSetup.tsx:89` | auth | `auth` | `auth.updateUser` |  |
| `src/pages/PasswordSetup.tsx:92` | table | `user_settings` | `table.update` |  |
| `src/pages/PlanSelection.tsx:194` | edge | `customer-portal` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:372` | edge | `create-checkout` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:425` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:505` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:564` | edge | `bulk-return-fanmarks` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:589` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/Profile.tsx:135` | auth | `auth` | `auth.updateUser` |  |
| `src/pages/Profile.tsx:139` | table | `user_settings` | `table.update` |  |
| `src/pages/Profile.tsx:257` | edge | `delete-user-account` | `edge_function_invoke` |  |
| `src/pages/Profile.tsx:314` | edge | `customer-portal` | `edge_function_invoke` |  |

Operation summary:

- `auth.getSession`: 7
- `auth.getUser`: 2
- `auth.mfa.challenge`: 2
- `auth.mfa.enroll`: 1
- `auth.mfa.getAuthenticatorAssuranceLevel`: 3
- `auth.mfa.listFactors`: 4
- `auth.mfa.unenroll`: 2
- `auth.mfa.verify`: 2
- `auth.onAuthStateChange`: 1
- `auth.resend`: 1
- `auth.resetPasswordForEmail`: 2
- `auth.setSession`: 1
- `auth.signInWithOAuth`: 4
- `auth.signInWithPassword`: 2
- `auth.signOut`: 2
- `auth.signUp`: 1
- `auth.updateUser`: 3
- `edge_function_invoke`: 36
- `realtime.channel`: 4
- `realtime.removeChannel`: 4
- `rpc`: 37
- `storage.getPublicUrl`: 2
- `storage.remove`: 2
- `storage.upload`: 2
- `table.delete`: 3
- `table.insert`: 6
- `table.select`: 48
- `table.update`: 22
- `table.upsert`: 5

### Unresolved call arguments

_none detected in frontend source._

### Unsupported or unknown receiver aliases

_none detected in frontend source._

## SQL, cron, storage, and auth references

The following references are grouped from current checkout migrations, the two checked-in schema snapshots, and `supabase/config.toml`. Locations are compressed by file and line range. These are evidence references, not a declaration of live state.

Evidence files (31): `supabase/migrations/20251231070109_remote_schema.sql`, `supabase/migrations/20251231072222_restore_rls_policies.sql`, `supabase/migrations/20251231201348_add_display_fanmark.sql`, `supabase/migrations/20251231222000_fix_password_config_license_check.sql`, `supabase/migrations/20260101090000_add_payment_failure_fields_to_user_subscriptions.sql`, `supabase/migrations/20260102102233_e5e3404a-2341-4bbf-80ea-b67d62e3423a.sql`, `supabase/migrations/20260102123300_a3d9ffa4-0b8d-4730-84f4-8a5eb680b3f1.sql`, `supabase/migrations/20260102125523_547b82b2-018b-4be4-adac-6b9d9fe3d491.sql`, `supabase/migrations/20260102125748_7bb11f5c-8252-49e2-a6db-42d9db393b30.sql`, `supabase/migrations/20260102215623_653e4d11-8e5c-4a5c-9abd-1d952afffa3a.sql`, `supabase/migrations/20260102221550_3bcc9909-4952-431c-b45c-7b39dc1d5db8.sql`, `supabase/migrations/20260102235155_0efff4a2-63a7-497b-b2c5-b54425604749.sql`, `supabase/migrations/20260103011437_remote_schema.sql`, `supabase/migrations/20260103120000_fix_oauth_password_setup.sql`, `supabase/migrations/20260103123000_add_maintenance_settings.sql`, `supabase/migrations/20260104025602_remote_schema.sql`, `supabase/migrations/20260104032906_cf240bf8-d8e2-448d-9194-ac6ce70a3096.sql`, `supabase/migrations/20260104091448_remote_schema.sql`, `supabase/migrations/20260104120000_update_public_access_grace.sql`, `supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql`, `supabase/migrations/20260725044303_make_notification_cron_on_demand.sql`, `supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql`, `supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql`, `supabase/migrations/20260921110000_add_stripe_invoice_projection.sql`, `supabase/migrations/20260925120000_add_stripe_extension_application.sql`, `supabase/migrations/20260929170000_add_targeted_stripe_dispatch_claim.sql`, `supabase/migrations/20260929200000_terminalize_stripe_noop_checkout_receipts.sql`, `supabase/migrations/20260929210000_add_stripe_subscription_projection.sql`, `supabase/remote_schema.sql`, `supabase/remote_schema_before_rls_push.sql`, `supabase/config.toml`

### Auth references

| Reference | Locations |
| --- | --- |
| `auth.role` | supabase/migrations/20260102123300_a3d9ffa4-0b8d-4730-84f4-8a5eb680b3f1.sql:29; supabase/migrations/20260104091448_remote_schema.sql:2130,2200,2258,2266; supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql:24,53; supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql:181,186; supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql:94,226,335; supabase/migrations/20260921110000_add_stripe_invoice_projection.sql:183,308,417; supabase/migrations/20260925120000_add_stripe_extension_application.sql:146,268,504; supabase/migrations/20260929170000_add_targeted_stripe_dispatch_claim.sql:38; supabase/migrations/20260929200000_terminalize_stripe_noop_checkout_receipts.sql:29; supabase/migrations/20260929210000_add_stripe_subscription_projection.sql:141 |
| `auth.sessions` | supabase/migrations/20251231070109_remote_schema.sql:1327; supabase/remote_schema_before_rls_push.sql:1327; supabase/remote_schema.sql:1328 |
| `auth.uid` | supabase/migrations/20251231070109_remote_schema.sql:79,649,759,906,1016,1054,1081,1112,1131,1244,1307,1443,1458,1473,1553,1583,1590,1609,1646,1764,1784,1897,2087,2190; supabase/migrations/20251231201348_add_display_fanmark.sql:36,119,336,474; supabase/migrations/20251231222000_fix_password_config_license_check.sql:19; supabase/migrations/20260103011437_remote_schema.sql:1699,2256,2366,2513,2621,2658,2685,2715,2734,2948,2963,2978,3056,3085,3092,3110,3146,3260,3279,3390,3577,3676,3834,3843,3852,3861,3870,3879; supabase/migrations/20260104025602_remote_schema.sql:21,578,688,835,943,980,1007,1037,1056,1270,1285,1300,1378,1407,1414,1432,1468,1582,1601,1712,1899,1998; supabase/migrations/20260104091448_remote_schema.sql:17,574,684,831,939,976,1003,1033,1052,1266,1281,1296,1374,1403,1410,1428,1464,1578,1597,1708,1895,1994; supabase/remote_schema_before_rls_push.sql:79,649,759,906,1016,1054,1081,1112,1131,1244,1307,1443,1458,1473,1553,1583,1590,1609,1646,1764,1784,1897,2087,2190; supabase/remote_schema.sql:79,650,760,907,1017,1055,1082,1113,1132,1245,1308,1444,1459,1474,1554,1584,1591,1610,1647,1765,1785,1898,2088,2191 |
| `auth.users` | supabase/migrations/20260102221550_3bcc9909-4952-431c-b45c-7b39dc1d5db8.sql:12; supabase/migrations/20260103011437_remote_schema.sql:3808; supabase/migrations/20260103120000_fix_oauth_password_setup.sql:6 |

### Storage references

| Reference | Locations |
| --- | --- |
| `bucket_id` | supabase/migrations/20260103011437_remote_schema.sql:3816,3825,3834,3843,3852,3861,3870,3879 |
| `bucket:avatars` | supabase/migrations/20260103011437_remote_schema.sql:3816,3834,3852,3870 |
| `bucket:cover-images` | supabase/migrations/20260103011437_remote_schema.sql:3825,3843,3861,3879 |
| `storage.foldername` | supabase/migrations/20260103011437_remote_schema.sql:3834,3843,3852,3861,3870,3879 |
| `storage.objects` | supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql:78,80-81 |

### Cron / pg_net references

| Reference | Locations |
| --- | --- |
| `cron.alter_job` | supabase/config.toml:134; supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:32,92 |
| `cron.job` | supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:23,83 |
| `edge-url:check-expired-licenses` | supabase/config.toml:119 |
| `edge-url:process-notification-events` | supabase/config.toml:127 |
| `net.http_post` | supabase/config.toml:118,126 |
| `pg_cron` | supabase/config.toml:110; supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:2,5 |

## Reproduction and tests

- `node --check scripts/migration/inventory.mjs`
- `node scripts/migration/test-inventory.mjs` (fixture covers comments/strings, multiline and same-line calls, unfinished chains, import aliases, auth MFA, Realtime, and dynamic RPC/Edge arguments retained as unresolved)
- The report is deterministic for a fixed checkout: it contains the Git base commit and no generation timestamp or live response payload.

## Archive and live-state limits

- `supabase/migrations_archive/` contains 187 historical SQL files. They are excluded from all generated-type/current-object counts; historical names can describe prior states and are not evidence of what is deployed now.
- `supabase/remote_migration_versions.sql` is a migration-history export and is used only as a limitation marker, not as a current-object source.
- `remote_schema.sql` and `remote_schema_before_rls_push.sql` are checked-in snapshots. Their presence does not prove the current production schema, function permissions, cron jobs, storage buckets, auth configuration, secrets, DNS, or deployment state.
- The scanner does not read `.env`, does not enumerate user rows or storage objects, and does not export network data.
- AST call classification uses standard receiver names and imports whose module path contains `supabase`; it is not whole-program symbol/dataflow analysis. Destructured or arbitrary aliases, computed properties, wrappers, and indirect calls need manual follow-up. An empty unsupported-alias list is not proof that no callsite was missed.

### Unverified live-only inventory

- No live-only names are knowable from this offline scan. See the coordinator-owned [live observations](live-observations.md) for separately captured read-only observations; those observations are not imported into these local counts.

Reconcile the live observations with this checkout report before treating any mapping as complete.

## Remaining mapping work

- Verify every local Edge entrypoint, configured JWT policy, deployed version, and any live-only function against the production project read-only.
- Reconcile generated types and checked-in SQL snapshots with a fresh, access-controlled production schema readback; resolve drift before selecting Cloudflare D1/R2/Workers targets.
- Review the completed static frontend mapping in this document and the [remaining-callsite map](frontend-callsite-map.md). Realtime cleanup aliases are resolved to their statically subscribed table; interpolated channel topics remain visible in the Dynamic expression column. Arbitrary wrappers and indirect calls still need manual review.
- Confirm pg_cron/pg_net schedules, Auth providers and redirect URLs, Storage buckets/policies, Realtime channels, Stripe/Resend webhooks, and deployment secrets in the live environment. None are proven by this offline report.

## Semantic mapping completed slice: Authentication and MFA

This slice classifies the 40 direct Auth/Auth-MFA callsites in the 211-callsite
inventory. The production/default UI still uses Supabase Auth. The explicit
Cloudflare staging build uses Better Auth and Worker APIs; staging synthetic
proof does not mean existing users, password hashes, sessions, or MFA factors
were imported. Those identity records remain deferred to #38.

| Callsite(s) | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/hooks/useAuth.tsx:134,149,186` | Load session, observe auth changes, and sign out the current user. | Private identity and session. | Better Auth `getSession`/`signOut` with HttpOnly Worker cookies; Worker mode skips the Supabase auth-state listener. Synthetic session and logout passed in local/staging proof. |
| `src/components/AdminApp.tsx:88,100,137`; `src/pages/AdminAuth.tsx:42,76,89,118,172` | Admin session, password sign-in, AAL/factor checks, and sign-out. | Restricted admin identity and MFA assurance. | `CloudflareAdminAuth` uses Better Auth sign-in/TOTP and `/api/admin/session`; each protected Worker operation checks admin role and same-session, current-factor assurance. The Supabase `AdminAuth` branch remains for Supabase mode. |
| `src/components/auth/MFAChallenge.tsx:43,73,108,120`; `src/components/auth/MFAEnrollment.tsx:37,62,82,136,148` | List, enroll, challenge, verify, or remove TOTP factors. | MFA secret, factor identity, and challenge state. | These components are only rendered by `SupabaseAdminAuth`. Cloudflare mode uses inline Better Auth `enableTotp`/`verifyTotp` flows in `CloudflareAdminAuth`; synthetic enrollment, challenge, replacement, and session-bound assurance are tested. Supabase factor secrets were not read or migrated. |
| `src/hooks/useAuthForm.tsx:183` | Create an identity and send verification email. | Email, password credential, invitation attribution. | `POST /api/auth/sign-up/email` uses a recoverable split-D1 command; account creation remains closed until selector and Resend are configured. No real email was sent. See [invitation signup API](invitation-signup-api.md). |
| `src/hooks/useAuthForm.tsx:259` | Sign in with email and password. | Password credential and session. | Better Auth email sign-in verifies the existing D1 account and sets a secure session cookie. Synthetic bcrypt-compatible credentials passed; actual Supabase hashes/users remain unmigrated. |
| `src/hooks/useAuthForm.tsx:304,340`; `src/pages/ForgotPassword.tsx:65` | Request password reset and resend signup verification. | Email address and one-time token/link. | Better Auth callbacks send through Resend and return no token to the browser. Capability remains false while Resend settings are absent. No real delivery was attempted. |
| `src/hooks/useAuthForm.tsx:375,403,431,459` | Start Google, GitHub, Discord, or Apple OAuth. | Provider identity, OAuth state, and callback. | Better Auth supports the four provider paths and state-bound synthetic callback tests. Real credentials and provider-console callback verification are absent, so staging capabilities list no enabled providers. |
| `src/hooks/usePasswordReset.tsx:34,47,83` | Validate a recovery session/token and set a new password. | Password credential and short-lived recovery token. | Worker mode requires the Better Auth reset token and calls its reset-password API; the Supabase session/setSession/updateUser path remains conditional on Supabase mode. Resend-gated delivery is unverified. |
| `src/pages/PasswordSetup.tsx:89` | Complete the first-password setup gate. | Password credential and own-account setup state. | Better Auth `setupPassword` updates the credential and owner profile through the Worker; the Supabase password/profile updates remain the legacy branch. Synthetic API contract is tested. |
| `src/pages/Profile.tsx:135` | Change the signed-in user's password. | Current/new password credential. | Better Auth `changePassword` uses the authenticated session; the Supabase `updateUser` call runs only in Supabase mode. |
| `src/hooks/useFanmarkSearch.tsx:254`; `src/lib/profile-utils.ts:27`; `src/hooks/useSubscription.tsx:84` | Read current user/session before protected profile, search, or subscription behavior. | Private identity and session. | Worker-backed profile/search/subscription APIs derive the owner from Better Auth cookies; no client-supplied user ID selects the account. Existing user projections remain in their deferred data phase. |
| `src/components/AdminBroadcastEmail.tsx:246,285,319` | Read the current administrator session before email-management actions. | Restricted administrator identity. | Worker calls use same-origin Better Auth cookies, then each admin API independently checks role and MFA assurance. Broadcast delivery remains disabled until reviewed Resend/provider selectors are configured. |

All 40 direct Auth/Auth-MFA callsites now have a retention or replacement
decision. These mappings document checked-in branches and synthetic evidence;
they do not establish real OAuth/Resend acceptance or user credential parity.
See [Auth feasibility](auth-feasibility.md) for the identity migration gates.

## Semantic mapping completed slice: Own and fanmark profiles

This slice classifies 20 profile and user-settings operations. Worker routes
derive the account or active license from Better Auth and do not accept a
caller-supplied owner. The checked-in profile rows and Storage objects remain
in Supabase until the separate real-user/data phase.

| Callsite(s) | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/hooks/useAuth.tsx:52`; `src/hooks/useProfile.tsx:23,120`; `src/hooks/usePreferredLanguage.ts:28`; `src/lib/profile-utils.ts:34` | Read or update the signed-in user's profile and preferred language. | Private account/profile fields, including plan and password-setup state. | `GET/PATCH /api/me/profile`; session owns the row. PATCH allows display name, avatar URL, and language; plan, Stripe IDs, invitation fields, and password-setup state are not client-writable. Existing rows are not imported. |
| `src/hooks/useProfile.tsx:145`; `src/lib/profile-utils.ts:59` | Check whether a candidate username is available, excluding the current user. | Username and account existence signal. | `GET /api/me/username-availability`; Worker derives the excluded ID from Better Auth and returns only a boolean. It is a read-only check and does not reserve the name. |
| `src/pages/PasswordSetup.tsx:92`; `src/pages/Profile.tsx:139` | Clear `requires_password_setup` after a password change. | Private account security state. | Better Auth `setupPassword` and `changePassword` own these transitions; Worker mode does not expose a generic profile flag write. The direct table writes remain in Supabase mode. |
| `src/hooks/useAuthForm.tsx:204` | Record the invitation attribution on the new user's profile. | Private signup attribution. | The split-D1 signup command creates the source-shaped profile and consumes the reserved invitation atomically; the legacy post-signup update runs only in Supabase mode. |
| `src/components/AdminBroadcastEmail.tsx:192` | Count recipients matching allowlisted plan, language, and date filters. | Aggregate user population count. | `POST /api/admin/broadcast-emails/estimate` requires admin role and MFA and returns only `{count}`; it does not expose user IDs or addresses. Delivery remains selector/secret gated. |
| `src/hooks/useExtensionCouponAdmin.ts:183` | Enrich coupon-use records with a user's display name or username. | Restricted user display label. | `GET /api/admin/extension-coupons/:couponId/usages` returns bounded display labels only to an MFA-authorized admin; it does not expose email or other profile fields. |
| `src/components/FanmarkSettings.tsx:506,514,524`; `src/hooks/useEmojiProfile.tsx:73,115,154`; `src/pages/FanmarkSettingsPage.tsx:113` | Read, create, update, or preserve `fanmark_profiles` visibility for the owner's active fanmark. | Owner profile content and publication state. | Profile editor/preview use `GET/PATCH /api/me/fanmarks/{fanmarkId}/profile`; access-mode settings use `GET/PATCH /api/me/fanmarks/{fanmarkId}/settings`. Worker checks active ownership and preserves omitted bio/theme fields. The two Worker APIs are separate from the public read route. |
| `src/hooks/useEmojiProfile.tsx:51` | Read a profile for public display. | Public profile projection; private profiles remain private. | `GET /api/fanmarks/public-profile/:licenseId` returns only a published, non-password-protected projection and omits owner/account identifiers. See [public access contract](public-access-contract.md). |

The route contracts and synthetic staging evidence are in
[own-profile-api.md](own-profile-api.md), [fanmark-profile-api.md](fanmark-profile-api.md),
[fanmark-settings-api.md](fanmark-settings-api.md), and
[public-access-contract.md](public-access-contract.md). None of these reads or
tests imported real account/profile rows.

## Semantic mapping completed slice: Fanmark settings and image storage

This slice maps five owner-settings writes and six avatar/cover Storage calls.
The staging app routes new operations to D1/R2; existing account settings and
image objects remain in Supabase until the separately deferred user-data phase.

| Callsite(s) | Operation and owner | Cloudflare replacement and remaining boundary |
| --- | --- | --- |
| `src/components/FanmarkSettings.tsx:439,453,465` | Save the active fanmark's basic name/access mode and its selected redirect URL or messageboard text. | `VITE_FANMARK_SETTINGS_BACKEND=worker` sends one owner-bound PATCH to `/api/me/fanmarks/:fanmarkId/settings`; D1 applies related configuration writes together and accepts only mode-specific fields. Synthetic staging GET/PATCH and cleanup passed. |
| `src/components/FanmarkSettings.tsx:480,490` | Enable/update or disable the owner's four-digit access password. | The same D1 settings route hashes a newly supplied password server-side and records hash-free runtime evidence atomically. The live synthetic wrong/correct-password and protected-read canary passed; existing Supabase password hashes have not been imported. |
| `src/hooks/useAvatarUpload.tsx:35,45,113`; `src/hooks/useCoverImageUpload.tsx:39,49,123` | Upload, publicly read, and owner-delete profile avatars and fanmark cover images. | `VITE_STORAGE_BACKEND=r2` routes authenticated uploads and owner-checked deletion through the Worker, with public reads from the bound staging R2 buckets. Avatar upload, rendered profile image, profile save/delete, and cover upload/read/delete canaries passed with zero final objects. Existing Supabase Storage objects remain in the deferred data phase. |

See [owner settings API](fanmark-settings-api.md) and
[R2 application Storage API](storage-r2-app-api.md). This proves the new
staging write/read paths, not imported-user or imported-object parity.

## Semantic mapping completed slice: Master and reference data

This slice classifies 19 callsites for non-user catalog, pricing, language,
and availability configuration. These records are separated from account
data, although some admin operations still require a Better Auth admin session
and current MFA assurance.

| Callsite(s) | Operation and data owner | Cloudflare replacement and remaining boundary |
| --- | --- | --- |
| `src/components/AdminEmojiMaster.tsx:89,180,184,192,229` | Read, create, update, delete, or import canonical public emoji catalog records. | In staging, `/api/admin/emoji-master` reads and edits the protected `MASTER_DB` draft. Import preserves existing UUIDs; published identity changes and deletions are refused. Draft writes do not publish a catalog version; release build, continuity review, and explicit activation remain separate. Supabase stays the default. |
| `src/lib/emoji-master-utils.ts:120` | Legacy full-table emoji lookup loader. | This helper still contains a direct Supabase query and has no other `src` import. The staging app installs the versioned Worker catalog in `src/main.tsx` before React mounts. Keep the unused helper identified for cleanup rather than assuming it is a second active staging read path. |
| `src/hooks/useLanguages.tsx:44` | Read public language labels and active/sort state. | `VITE_LANGUAGE_READ_BACKEND=worker` reads the active reference release through `/api/reference-masters/languages`; the production default remains Supabase. The hook keeps its built-in defaults if the selected read fails. |
| `src/components/AdminExtensionCoupons.tsx:99` | Read active tier labels and eligibility for coupon administration. | `VITE_REFERENCE_MASTER_READ_BACKEND=worker` reads the versioned tier projection. Coupon CRUD and application are separate operations and retain their own selectors. |
| `src/components/ExtendLicenseDialog.tsx:102` | Read active extension terms and yen prices for the extension dialog. | `VITE_EXTENSION_PRICING_BACKEND=worker` reads the public 16-field pricing projection from the active reference release. This only moves the price read; checkout and license mutation remain independently gated by Stripe/provider configuration. |
| `src/components/AdminTierExtensionPrices.tsx:80,85,149,186,264,306,373` | Read and edit tier extension prices, Stripe price references, active flags, and initial license days. | The staging selector uses MFA-protected `/api/admin/reference-masters/pricing`; each edit stages a complete immutable release and activates it only if the expected release is current. Stripe IDs are returned only to an authorized admin. Staging readback is proven; a live authenticated edit is not recorded as accepted evidence. Supabase remains the default. |
| `src/components/AdminPatternRules.tsx:31,81,129` | Read global availability rules and edit enabled state or prefix-price configuration. | Staging uses `/api/admin/availability-rules` with admin MFA and compare-and-set updates. Four source rules were seeded disabled and the TOTP canary read, edited, restored, and verified them. This migrates the admin configuration surface; it does not activate runtime availability or Stripe enforcement. |

The source reference masters have a verified staging release for four tiers,
four languages, five reserved patterns, and 16 extension-price rows. Their
active D1 projection and API reads are distinct from the user-owned tables in
the deferred data phase. See [reference masters](reference-master-data.md),
[emoji releases](emoji-releases.md), and
[availability-rule administration](availability-rules-admin-api.md).

## Semantic mapping completed slice: Search and registration

This slice maps eight callsites in the acquisition search path. The app can
select Worker APIs against staging D1, but source-row parity still depends on
the deferred user-data import. The already-mapped auth read is described in
the Auth slice above.

| Callsite(s) | Operation and owner | Cloudflare replacement and remaining boundary |
| --- | --- | --- |
| `src/components/RecentFanmarksScroll.tsx:25`; `src/hooks/useFanmarkSearch.tsx:148` | Read recent public fanmarks for the landing view and search suggestions. | The shared `/api/fanmarks/recent` projection is selected in staging and sends no session credentials. Existing production/default builds retain Supabase. Staging HTTP readback passed; it does not prove parity before user-owned fanmark rows are imported. |
| `src/hooks/useFanmarkSearch.tsx:287,559` | Check whether one or more canonical emoji IDs can be acquired. | The staging Worker resolves IDs through the active Master D1 release and evaluates synthetic business D1 state; requests carry no auth cookies. It preserves the public result contract and fails closed without Supabase fallback. This is advisory availability, not authorization or payment enforcement. |
| `src/hooks/useFanmarkSearch.tsx:301` | Record a completed anonymous search in discovery aggregates. | The staging Worker batches `search_count`/`last_seen_at` with a search event, sets `user_id=NULL`, and rate-limits by a hashed client-IP key. A synthetic staging canary passed and its rows were removed. Historical user-attributed Supabase events remain deferred. |
| `src/hooks/useFanmarkSearch.tsx:334,569` | Read a candidate fanmark, license status, and pending lottery state for the current search. | Staging `POST /api/fanmarks/search/details` uses Better Auth to derive the optional owner and returns an allowlisted bounded projection. The client cannot choose a user ID; private settings and content are excluded. Synthetic owner/anonymous integration paths are documented separately. |
| `src/hooks/useFanmarkSearch.tsx:517` | Register or acquire the selected fanmark. | `VITE_FANMARK_REGISTRATION_BACKEND=worker` sends this operation to the owner-bound D1 registration API, which reads the active emoji/tier masters and writes dependent fanmark/license/settings/profile/audit rows atomically. Integrated synthetic staging readback and cleanup passed; production stays on Supabase. |

The API contracts and staging evidence are in [search APIs](fanmark-search-api.md),
[availability validation](availability-validation.md),
[recent fanmarks](recent-api-contract.md), and
[registration](fanmark-registration-api.md). The existing owner's historical
rows and event attribution are still outside this phase.

## Semantic mapping completed slice: Transfer and lottery actions

This slice maps ten user-owned transfer and lottery callsites. Cloudflare
staging routes operate on disposable synthetic accounts; no existing transfer
codes, requests, lottery entries, or user rows were imported.

| Callsite(s) | Operation and owner | Cloudflare replacement and remaining boundary |
| --- | --- | --- |
| `src/hooks/useTransferCode.ts:61` | List the signed-in issuer's active/applied transfer codes and related public fanmark labels. | `GET /api/me/transfers` derives the issuer from Better Auth, returns only the issuer's codes, and omits secrets from logs. |
| `src/hooks/useTransferCode.ts:94` | List pending requests addressed to codes issued by the current user. | The same owner-scoped list route includes requests only when their code belongs to the authenticated issuer; the client no longer relies on a global pending-request query in Worker mode. |
| `src/hooks/useTransferCode.ts:133` | List the signed-in user's outgoing requests. | The route derives requester identity from the session and returns only that user's pending/history projection. |
| `src/hooks/useTransferCode.ts:193,277,379,405,431` | Issue a code, apply for a transfer, approve or reject a request, or cancel a code. | Five authenticated POST operations use D1 batches for state, license/configuration effects, audit, and notification outbox. Approval uses the active master-tier duration, retires the sender license, creates an inactive recipient config, and applies the 30-day lock. A staging synthetic issue/apply/approve and notification rehearsal passed with cleanup verified. |
| `src/hooks/useLotteryEntry.tsx:125,172` | Apply to or cancel the signed-in user's lottery entry. | The selected D1 routes verify the session owner, grace/license eligibility, plan limit, and one-entry constraint in the mutation batch; status and audit are atomic while notification enqueue is best effort. A staging synthetic canary passed apply, duplicate rejection, cancellation, and anonymous denial, then confirmed cleanup. Winner selection/finalization and production source-row parity remain separate gates. |

See [transfer API](fanmark-transfer-api.md) and
[lottery application API](fanmark-lottery-api.md). The transfer path maps an
existing Supabase cancellation-reason vocabulary mismatch explicitly; the
source check-constraint correction remains separate.

## Semantic mapping completed slice: Favorites

This slice classifies the three favorite RPC callsites. Favorites are private
per-user rows; source history remains in Supabase until the deferred user-data
phase. Worker mode uses a session-bound route and active emoji Master D1.

| Callsite | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/lib/favorites-backend.ts:13` | List the signed-in user's saved fanmarks and their public discovery counters. | Private favorite relation plus aggregate discovery counts. | `GET /api/me/favorites`; Worker derives owner from Better Auth, normalizes exact bigint counts as decimal strings, and caps the response at 500 rows. |
| `src/lib/favorites-backend.ts:22` | Add a favorite for the signed-in user. | Private favorite relation and public favorite-count/event effects. | `POST /api/me/favorites`; active Master D1 resolves canonical emoji IDs, and one D1 batch updates the relation, count, and event with idempotent change guards. |
| `src/lib/favorites-backend.ts:33` | Remove a favorite for the signed-in user. | Private favorite relation and public favorite-count effect. | `DELETE /api/me/favorites`; same owner check and atomic count/event reconciliation, with a zero floor. |

Synthetic local and workers.dev staging add/list/remove canaries passed and
cleaned their favorite, event, and discovery rows. No historical favorite
records were copied. Details are in [favorites API](favorites-api.md).

## Semantic mapping completed slice: Notifications data operations

This slice classifies the 14 inbox and notification-admin callsites in the
211-callsite inventory. Admin endpoints require Better Auth admin role and
same-session MFA assurance. All mappings describe the checked-in application
and Worker contracts; they do not mean that existing user notification rows
were imported.

| Callsite | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/components/layout/AppHeader.tsx:98` | Read the signed-in user's five newest inbox rows. | Private user notification content and read/delivery state. | `GET /api/me/notifications?limit=5`; Worker selector polls every 30 seconds. |
| `src/components/layout/AppHeader.tsx:164` | Mark one notification read with `read_via=menu`; recipient owns the row. | Private user notification state. | `PATCH /api/me/notifications/{uuid}/read` with `readVia=menu`; Worker derives recipient from session. |
| `src/hooks/useUnreadNotifications.ts:18` | Read unread count for the signed-in user. | Private user activity count. | `GET /api/me/notifications/unread-count`; Worker derives recipient from session and the UI refreshes every 30 seconds. A production schema-only readback on 2026-10-02 confirmed the Supabase `SECURITY DEFINER` RPC trusts a supplied user ID and grants execution to `anon`, so a caller who knows a UUID can read that account's count. The Worker route tightens access to the session owner; see [live observations](live-observations.md) and treat this as an authorization change, not exact parity. |
| `src/pages/Notifications.tsx:42` | Read up to 50 newest rows for the signed-in user. | Private user notification content and read/delivery state. | `GET /api/me/notifications?limit=50`; Better Auth session owns the filter and Worker mode polls every 30 seconds. |
| `src/pages/Notifications.tsx:92` | Mark one notification read with `read_via=app`; recipient owns the row. | Private user notification state. | `PATCH /api/me/notifications/{uuid}/read` with `readVia=app`; same owner-bound behavior. |
| `src/pages/Notifications.tsx:128` | Mark eligible unread rows read for the signed-in user. | Private user notification state. | `POST /api/me/notifications/read-all`; Worker derives owner from session and preserves delivered/unexpired eligibility filters. |
| `src/pages/Notifications.tsx:139` | Reload the inbox after mark-all-read. | Private user notification content and read/delivery state. | `GET /api/me/notifications?limit=50`; same bounded read route as initial load. |
| `src/components/AdminNotificationManager.tsx:64` | Create a manually requested notification event; only an MFA-authorized admin may initiate it. | User-targeted operational event and payload; existing rows remain in the deferred user-data phase. | `POST /api/admin/notification-masters/events`; Worker allowlists the three event types exposed by this UI and records an `admin_manual` source. |
| `src/components/AdminNotificationManager.tsx:89` | Read the latest 100 notification event records as an administrator. | Restricted operational queue metadata; payload is withheld by the Worker DTO. | `GET /api/admin/notification-masters/events`; requires admin role and same-session MFA. |
| `src/components/AdminNotificationManager.tsx:105` | Read the latest 100 delivery records as an administrator. | Restricted delivery metadata, including a shortened user ID; payload is withheld. | `GET /api/admin/notification-masters/notifications`; requires admin role and same-session MFA and returns only a user-ID prefix. |
| `src/components/AdminNotificationManager.tsx:124` | Read global notification rules as an administrator. | Global operational master configuration. | `GET /api/admin/notification-masters/rules`; versioned D1 data, MFA protected. |
| `src/components/AdminNotificationManager.tsx:139` | Read global notification templates as an administrator. | Global localized message master data. | `GET /api/admin/notification-masters/templates`; versioned D1 data, MFA protected. |
| `src/components/AdminNotificationManager.tsx:157` | Update a notification rule as an administrator. | Global operational master configuration. | `PATCH /api/admin/notification-masters/rules/{uuid}`; allowlisted fields and `updated_at` compare-and-swap reject stale edits. |
| `src/components/AdminNotificationManager.tsx:189` | Update a notification template as an administrator. | Global localized message master data. | `PATCH /api/admin/notification-masters/templates/{uuid}`; allowlisted fields and `updated_at` compare-and-swap reject stale edits. |

The unread-count ACL evidence above is a current live schema readback, not a
functional PostgREST probe. Endpoint and selector details are in
[notifications-api.md](notifications-api.md).

## Semantic mapping completed slice: Dashboard and analytics

This slice classifies eight dashboard/analytics callsites. Staging routes new
owner reads and writes to D1, while historical access statistics remain in
Supabase. The extension checkout client is mapped to its Cloudflare route but
remains disabled until Stripe selectors and staging keys are configured.

| Callsite | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/components/FanmarkDashboard.tsx:233` | Return one fanmark owned by the signed-in user. | Owner license state and return side effects. | `POST /api/me/fanmarks/return` uses Better Auth identity and D1; the synthetic staging return canary passed with cleanup verified. |
| `src/components/FanmarkDashboard.tsx:332` | Begin a paid extension checkout for the owner’s selected license. | Owner license and payment intent metadata. | The Worker client calls `/api/billing/extension-checkout`, which is gated on staging and returns 404 while Stripe selectors/secrets are absent. The server implementation has synthetic contract tests; no Stripe request or transaction was made, so provider acceptance remains open. |
| `src/components/FanmarkDashboard.tsx:443,484` | List the owner’s active/history fanmarks and their basic display/access settings. | Owner licenses, fanmark labels, and configuration. | `VITE_OWNED_FANMARKS_BACKEND=worker` calls `GET /api/me/fanmarks`; the Better Auth session scopes the combined license/config projection. The rendered staging UI canary passed with synthetic rows cleaned up. |
| `src/components/FanmarkDashboard.tsx:630`; `src/pages/Analytics.tsx:222` | Read daily access aggregates for the owner’s active fanmarks or selected date range. | Owner analytics aggregates and historical activity. | The paired `VITE_FANMARK_ANALYTICS_BACKEND=worker` route reads the owner-scoped D1 projection. The staging UI canary rendered access and visitor totals of 1/1 after duplicate suppression; historical Supabase aggregates were not copied. |
| `src/pages/Analytics.tsx:132,161` | List active fanmarks and basic names for the analytics selector. | Owner licenses and display settings. | `GET /api/me/analytics/fanmarks` derives the owner from Better Auth and returns the D1 projection; the analytics UI canary verified the Worker-backed page. |

See [return API](fanmark-return-api.md), [access analytics API](fanmark-access-analytics-api.md),
and [extension checkout validation](stripe-extension-application-validation.md).
Mapping these callsites does not mean historical rows or payment-provider
behavior have been migrated.

## Semantic mapping completed slice: Realtime

The following eight rows are the four Realtime subscriptions and their four
cleanup calls from the 211-callsite scan. Ownership and data classification
come from the checked-in product behavior and row-scoped API contracts; this is
local source analysis, not a fresh production readback. Cloudflare routes are
implemented behind explicit staging selectors, but this table does not claim
real-user migration or provider acceptance.

| Callsite | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/components/layout/AppHeader.tsx:117` | Subscribe to any change in the signed-in user's `notifications`; recipient owns the read, system/admin workflows create rows. | Private user notification content and delivery/read state. | `GET /api/me/notifications?limit=5` plus `/api/me/notifications/unread-count`; Worker mode polls every 30 seconds while visible. This replaces push updates with bounded polling. |
| `src/components/layout/AppHeader.tsx:135` | Remove the component's Supabase channel on cleanup. | No persisted data; browser subscription lifecycle only. | Worker mode creates no channel. React Query's component lifecycle and polling configuration own cleanup. |
| `src/pages/Notifications.tsx:66` | Subscribe to any change in the signed-in user's `notifications` and reload up to 50 rows; recipient owns the read. | Private user notification content and delivery/read state. | `GET /api/me/notifications?limit=50`; Worker mode polls every 30 seconds. Immediate cross-device refresh becomes eventual polling. |
| `src/pages/Notifications.tsx:83` | Remove the page's Supabase channel on cleanup. | No persisted data; browser subscription lifecycle only. | Worker mode creates no channel; the 30-second interval is cleared when the page unmounts. |
| `src/hooks/useProfile.tsx:58` | Receive `UPDATE` for the signed-in user's `user_settings` row and replace local profile state; the user owns the row. | Private account profile and preference fields. | `GET/PATCH /api/me/profile`; same-runtime local update events plus a quiet refresh on focus/visibility. A change from another device is not pushed immediately. |
| `src/hooks/useProfile.tsx:70` | Remove the Supabase channel on cleanup. | No persisted data; browser subscription lifecycle only. | Worker mode removes its local event handler and focus/visibility listeners. |
| `src/hooks/useSubscription.tsx:124` | Receive any change to the signed-in user's latest `user_subscriptions` record and refetch it; the user owns the read, Stripe webhook processing owns provider-state writes. | Private billing entitlement and subscription projection metadata. | Read-only `GET /api/me/subscription`; focus/visibility refresh and a 30-second visible-tab interval. Stripe webhook projection replaces database push; no Stripe secret or payment action is exposed to the client. |
| `src/hooks/useSubscription.tsx:132` | Remove the Supabase channel on cleanup. | No persisted data; browser subscription lifecycle only. | Worker mode removes focus/visibility listeners and clears the interval. |

The route contracts are documented in [notifications-api.md](notifications-api.md),
[own-profile-api.md](own-profile-api.md), and the subscription API implementation
in `workers/api/src/subscription-d1-api.ts`.

## Semantic mapping completed slice: Home usage count and plan downgrade selection

This slice maps the two remaining owner-license reads used by the home screen
and plan downgrade UI. The Worker obtains the account only from the Better Auth
session. Active licenses without an end date count toward the plan limit, as
required for perpetual Tier C licenses.

| Callsite | Operation and owner | Data class | Cloudflare replacement and parity |
| --- | --- | --- | --- |
| `src/pages/Index.tsx:85` | Count the current user's valid active licenses for the home screen. | Private owner license count. | With `VITE_OWNED_FANMARKS_BACKEND=worker`, read the owner-scoped `GET /api/me/fanmarks` projection and count active, unexpired licenses, including perpetual licenses. The Supabase query now uses the same no-end-or-future-end rule. |
| `src/lib/plan-utils.ts:58` | Load the current user's eligible fanmarks before plan downgrade selection in `PlanSelection` or `UserProfileForm`. | Private owner license state and fanmark labels/configuration. | With the Worker selector, use the same session-scoped `GET /api/me/fanmarks` route and project its allowlisted DTO into the existing selection shape. No user ID is sent to the Worker. Synthetic tests cover perpetual inclusion and expired/grace exclusion; production/default remains Supabase. |

The Worker uses the same API and session boundary as the dashboard list; see
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and
[`workers/api/src/owned-fanmarks-d1-repository.ts`](../../workers/api/src/owned-fanmarks-d1-repository.ts).
The 68 previously unmapped static callsites are classified in
[`frontend-callsite-map.md`](frontend-callsite-map.md), completing all 211
locations in this report. Wrapper and indirect-call review remains open.

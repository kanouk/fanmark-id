# fanmark.id repository inventory (offline)

Base commit: `b307dd41fe7f151821730c24044a93f4ee5c54fe`

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

Found 34 local directories with `index.ts` (`_shared` excluded). 18 have an explicit `verify_jwt` entry in `supabase/config.toml`; an absent value is reported as unconfigured and requires live verification.

| Function | Entrypoint | verify_jwt in config | Handler signal |
| --- | --- | --- | --- |
| `admin-expire-license` | `supabase/functions/admin-expire-license/index.ts` | unconfigured | serve:13 |
| `admin-get-user-detail` | `supabase/functions/admin-get-user-detail/index.ts` | unconfigured | serve:82 |
| `admin-list-users` | `supabase/functions/admin-list-users/index.ts` | unconfigured | serve:98 |
| `admin-toggle-user-status` | `supabase/functions/admin-toggle-user-status/index.ts` | unconfigured | serve:22 |
| `admin-trigger-password-reset` | `supabase/functions/admin-trigger-password-reset/index.ts` | unconfigured | serve:9 |
| `admin-update-user-plan` | `supabase/functions/admin-update-user-plan/index.ts` | unconfigured | serve:32 |
| `apply-extension-coupon` | `supabase/functions/apply-extension-coupon/index.ts` | true | serve:63 |
| `apply-fanmark-lottery` | `supabase/functions/apply-fanmark-lottery/index.ts` | true | serve:11 |
| `apply-transfer-code` | `supabase/functions/apply-transfer-code/index.ts` | true | serve:10 |
| `approve-transfer-request` | `supabase/functions/approve-transfer-request/index.ts` | true | serve:19 |
| `bulk-return-fanmarks` | `supabase/functions/bulk-return-fanmarks/index.ts` | unconfigured | serve:26 |
| `cancel-lottery-entry` | `supabase/functions/cancel-lottery-entry/index.ts` | true | serve:11 |
| `cancel-transfer-code` | `supabase/functions/cancel-transfer-code/index.ts` | true | serve:9 |
| `change-subscription` | `supabase/functions/change-subscription/index.ts` | unconfigured | serve:15 |
| `check-email-exists` | `supabase/functions/check-email-exists/index.ts` | unconfigured | serve:95 |
| `check-expired-licenses` | `supabase/functions/check-expired-licenses/index.ts` | false | serve:10 |
| `check-subscription` | `supabase/functions/check-subscription/index.ts` | unconfigured | serve:15 |
| `create-checkout` | `supabase/functions/create-checkout/index.ts` | unconfigured | serve:15 |
| `create-extension-checkout` | `supabase/functions/create-extension-checkout/index.ts` | true | serve:16 |
| `customer-portal` | `supabase/functions/customer-portal/index.ts` | unconfigured | serve:15 |
| `delete-user-account` | `supabase/functions/delete-user-account/index.ts` | unconfigured | serve:251 |
| `extend-fanmark-license` | `supabase/functions/extend-fanmark-license/index.ts` | unconfigured | serve:55 |
| `fanmark-ogp` | `supabase/functions/fanmark-ogp/index.ts` | false | serve:135 |
| `generate-ogp-image` | `supabase/functions/generate-ogp-image/index.ts` | false | serve:111 |
| `generate-transfer-code` | `supabase/functions/generate-transfer-code/index.ts` | true | serve:12 |
| `handle-stripe-webhook` | `supabase/functions/handle-stripe-webhook/index.ts` | false | serve:183 |
| `process-notification-events` | `supabase/functions/process-notification-events/index.ts` | false | serve:33 |
| `record-fanmark-access` | `supabase/functions/record-fanmark-access/index.ts` | unconfigured | serve:117 |
| `register-fanmark` | `supabase/functions/register-fanmark/index.ts` | true | serve:386 |
| `reject-transfer-request` | `supabase/functions/reject-transfer-request/index.ts` | true | serve:9 |
| `reset-fanmark-data` | `supabase/functions/reset-fanmark-data/index.ts` | unconfigured | serve:8 |
| `return-fanmark` | `supabase/functions/return-fanmark/index.ts` | true | serve:13 |
| `send-auth-email` | `supabase/functions/send-auth-email/index.ts` | false | serve:343 |
| `send-broadcast-email` | `supabase/functions/send-broadcast-email/index.ts` | true | serve:514 |

## Frontend Supabase callsites

Scanned `src/**/*.{ts,tsx}`: 211 callsites. Each row records the first line of the call and the extracted operation.

| Location | Kind | Target | Operation | Dynamic expression |
| --- | --- | --- | --- | --- |
| `src/components/AdminApp.tsx:43` | rpc | `is_admin` | `rpc` |  |
| `src/components/AdminApp.tsx:87` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/components/AdminApp.tsx:99` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/AdminApp.tsx:136` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/components/AdminBroadcastEmail.tsx:144` | table | `broadcast_emails` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:160` | table | `email_templates` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:175` | table | `user_settings` | `table.select` |  |
| `src/components/AdminBroadcastEmail.tsx:220` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:240` | table | `broadcast_emails` | `table.insert` |  |
| `src/components/AdminBroadcastEmail.tsx:272` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:275` | edge | `send-broadcast-email` | `edge_function_invoke` |  |
| `src/components/AdminBroadcastEmail.tsx:296` | auth | `auth` | `auth.getSession` |  |
| `src/components/AdminBroadcastEmail.tsx:299` | edge | `send-broadcast-email` | `edge_function_invoke` |  |
| `src/components/AdminDataReset.tsx:35` | edge | `reset-fanmark-data` | `edge_function_invoke` |  |
| `src/components/AdminEmailTemplates.tsx:48` | table | `email_templates` | `table.select` |  |
| `src/components/AdminEmailTemplates.tsx:61` | table | `email_templates` | `table.update` |  |
| `src/components/AdminEmojiMaster.tsx:60` | table | `emoji_master` | `table.select` |  |
| `src/components/AdminEmojiMaster.tsx:131` | table | `emoji_master` | `table.update` |  |
| `src/components/AdminEmojiMaster.tsx:135` | table | `emoji_master` | `table.insert` |  |
| `src/components/AdminEmojiMaster.tsx:142` | table | `emoji_master` | `table.delete` |  |
| `src/components/AdminEmojiMaster.tsx:167` | table | `emoji_master` | `table.upsert` |  |
| `src/components/AdminExpirationTest.tsx:18` | edge | `check-expired-licenses` | `edge_function_invoke` |  |
| `src/components/AdminExtensionCoupons.tsx:79` | table | `fanmark_tiers` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:58` | rpc | `create_notification_event` | `rpc` |  |
| `src/components/AdminNotificationManager.tsx:83` | table | `notification_events` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:98` | table | `notifications` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:113` | table | `notification_rules` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:127` | table | `notification_templates` | `table.select` |  |
| `src/components/AdminNotificationManager.tsx:141` | table | `notification_rules` | `table.update` |  |
| `src/components/AdminNotificationManager.tsx:162` | table | `notification_templates` | `table.update` |  |
| `src/components/AdminPatternRules.tsx:37` | table | `fanmark_availability_rules` | `table.select` |  |
| `src/components/AdminPatternRules.tsx:57` | table | `fanmark_availability_rules` | `table.update` |  |
| `src/components/AdminPatternRules.tsx:90` | table | `fanmark_availability_rules` | `table.update` |  |
| `src/components/AdminPlanSettings.tsx:57` | table | `system_settings` | `table.update` |  |
| `src/components/AdminSettings.tsx:54` | table | `system_settings` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:55` | table | `fanmark_tier_extension_prices` | `table.select` |  |
| `src/components/AdminTierExtensionPrices.tsx:60` | table | `fanmark_tiers` | `table.select` |  |
| `src/components/AdminTierExtensionPrices.tsx:119` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:151` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:224` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:263` | table | `fanmark_tier_extension_prices` | `table.update` |  |
| `src/components/AdminTierExtensionPrices.tsx:327` | table | `fanmark_tiers` | `table.update` |  |
| `src/components/AdminUserManagement.tsx:259` | edge | `admin-list-users` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:277` | edge | `admin-get-user-detail` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:301` | edge | `admin-update-user-plan` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:334` | edge | `admin-toggle-user-status` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:367` | edge | `admin-trigger-password-reset` | `edge_function_invoke` |  |
| `src/components/AdminUserManagement.tsx:396` | edge | `admin-expire-license` | `edge_function_invoke` |  |
| `src/components/auth/MFAChallenge.tsx:43` | auth_mfa | `auth` | `auth.mfa.unenroll` |  |
| `src/components/auth/MFAChallenge.tsx:73` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/auth/MFAChallenge.tsx:108` | auth_mfa | `auth` | `auth.mfa.challenge` |  |
| `src/components/auth/MFAChallenge.tsx:120` | auth_mfa | `auth` | `auth.mfa.verify` |  |
| `src/components/auth/MFAEnrollment.tsx:37` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/components/auth/MFAEnrollment.tsx:62` | auth_mfa | `auth` | `auth.mfa.unenroll` |  |
| `src/components/auth/MFAEnrollment.tsx:82` | auth_mfa | `auth` | `auth.mfa.enroll` |  |
| `src/components/auth/MFAEnrollment.tsx:136` | auth_mfa | `auth` | `auth.mfa.challenge` |  |
| `src/components/auth/MFAEnrollment.tsx:148` | auth_mfa | `auth` | `auth.mfa.verify` |  |
| `src/components/ExtendLicenseDialog.tsx:84` | table | `fanmark_tier_extension_prices` | `table.select` |  |
| `src/components/ExtendLicenseDialog.tsx:298` | edge | `apply-extension-coupon` | `edge_function_invoke` |  |
| `src/components/FanmarkAccess.tsx:118` | rpc | `get_fanmark_by_emoji` | `rpc` |  |
| `src/components/FanmarkAccessByShortId.tsx:75` | rpc | `get_fanmark_by_short_id` | `rpc` |  |
| `src/components/FanmarkAccessByShortId.tsx:108` | edge | `record-fanmark-access` | `edge_function_invoke` |  |
| `src/components/FanmarkAcquisition.tsx:218` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkAcquisition.tsx:279` | rpc | `remove_fanmark_favorite` | `rpc` |  |
| `src/components/FanmarkAcquisition.tsx:288` | rpc | `add_fanmark_favorite` | `rpc` |  |
| `src/components/FanmarkDashboard.tsx:206` | edge | `return-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkDashboard.tsx:271` | edge | `create-extension-checkout` | `edge_function_invoke` |  |
| `src/components/FanmarkDashboard.tsx:370` | table | `fanmark_licenses` | `table.select` |  |
| `src/components/FanmarkDashboard.tsx:411` | table | `fanmark_basic_configs` | `table.select` |  |
| `src/components/FanmarkDashboard.tsx:551` | table | `fanmark_access_daily_stats` | `table.select` |  |
| `src/components/FanmarkQuickRegistration.tsx:124` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkRegistrationForm.tsx:205` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/components/FanmarkSettings.tsx:402` | table | `fanmark_basic_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:416` | table | `fanmark_redirect_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:428` | table | `fanmark_messageboard_configs` | `table.upsert` |  |
| `src/components/FanmarkSettings.tsx:443` | rpc | `upsert_fanmark_password_config` | `rpc` |  |
| `src/components/FanmarkSettings.tsx:452` | rpc | `upsert_fanmark_password_config` | `rpc` |  |
| `src/components/FanmarkSettings.tsx:462` | rpc | `upsert_fanmark_password_config` | `rpc` |  |
| `src/components/FanmarkSettings.tsx:477` | table | `fanmark_profiles` | `table.select` |  |
| `src/components/FanmarkSettings.tsx:485` | table | `fanmark_profiles` | `table.update` |  |
| `src/components/FanmarkSettings.tsx:495` | table | `fanmark_profiles` | `table.insert` |  |
| `src/components/layout/AppHeader.tsx:77` | table | `notifications` | `table.select` |  |
| `src/components/layout/AppHeader.tsx:96` | realtime | `<unresolved>` | `realtime.channel` | `` `notifications-preview-${user.id}` `` |
| `src/components/layout/AppHeader.tsx:114` | realtime | `<unresolved>` | `realtime.removeChannel` | `channel` |
| `src/components/layout/AppHeader.tsx:139` | rpc | `mark_notification_read` | `rpc` |  |
| `src/components/MaintenanceGate.tsx:41` | rpc | `is_admin` | `rpc` |  |
| `src/components/PasswordProtection.tsx:32` | rpc | `verify_fanmark_password` | `rpc` |  |
| `src/components/RecentFanmarksScroll.tsx:23` | rpc | `list_recent_fanmarks` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:48` | rpc | `is_super_admin` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:76` | rpc | `get_waitlist_secure` | `rpc` |  |
| `src/components/SecureWaitlistAdmin.tsx:91` | table | `audit_logs` | `table.select` |  |
| `src/components/SecureWaitlistAdmin.tsx:107` | rpc | `get_waitlist_email_by_id` | `rpc` |  |
| `src/components/UserProfileForm.tsx:138` | edge | `bulk-return-fanmarks` | `edge_function_invoke` |  |
| `src/hooks/useAuth.tsx:39` | table | `user_settings` | `table.select` |  |
| `src/hooks/useAuth.tsx:90` | auth | `auth` | `auth.onAuthStateChange` |  |
| `src/hooks/useAuth.tsx:97` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/useAuth.tsx:127` | auth | `auth` | `auth.signOut` |  |
| `src/hooks/useAuthForm.tsx:88` | edge | `check-email-exists` | `edge_function_invoke` |  |
| `src/hooks/useAuthForm.tsx:126` | rpc | `validate_invitation_code` | `rpc` |  |
| `src/hooks/useAuthForm.tsx:156` | auth | `auth` | `auth.signUp` |  |
| `src/hooks/useAuthForm.tsx:165` | rpc | `use_invitation_code` | `rpc` |  |
| `src/hooks/useAuthForm.tsx:177` | table | `user_settings` | `table.update` |  |
| `src/hooks/useAuthForm.tsx:207` | auth | `auth` | `auth.signInWithPassword` |  |
| `src/hooks/useAuthForm.tsx:240` | auth | `auth` | `auth.resetPasswordForEmail` |  |
| `src/hooks/useAuthForm.tsx:270` | auth | `auth` | `auth.resend` |  |
| `src/hooks/useAuthForm.tsx:298` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:319` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:340` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAuthForm.tsx:361` | auth | `auth` | `auth.signInWithOAuth` |  |
| `src/hooks/useAvatarUpload.tsx:28` | storage | `avatars` | `storage.upload` |  |
| `src/hooks/useAvatarUpload.tsx:38` | storage | `avatars` | `storage.getPublicUrl` |  |
| `src/hooks/useAvatarUpload.tsx:101` | storage | `avatars` | `storage.remove` |  |
| `src/hooks/useCoverImageUpload.tsx:28` | storage | `cover-images` | `storage.upload` |  |
| `src/hooks/useCoverImageUpload.tsx:38` | storage | `cover-images` | `storage.getPublicUrl` |  |
| `src/hooks/useCoverImageUpload.tsx:107` | storage | `cover-images` | `storage.remove` |  |
| `src/hooks/useEmojiProfile.tsx:32` | rpc | `get_public_emoji_profile` | `rpc` |  |
| `src/hooks/useEmojiProfile.tsx:54` | table | `fanmark_profiles` | `table.select` |  |
| `src/hooks/useEmojiProfile.tsx:82` | table | `fanmark_profiles` | `table.select` |  |
| `src/hooks/useEmojiProfile.tsx:113` | table | `fanmark_profiles` | `table.upsert` |  |
| `src/hooks/useExtensionCouponAdmin.ts:46` | table | `extension_coupons` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:69` | table | `extension_coupons` | `table.insert` |  |
| `src/hooks/useExtensionCouponAdmin.ts:91` | table | `extension_coupons` | `table.update` |  |
| `src/hooks/useExtensionCouponAdmin.ts:112` | table | `extension_coupons` | `table.delete` |  |
| `src/hooks/useExtensionCouponAdmin.ts:129` | table | `extension_coupon_usages` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:153` | table | `fanmark_licenses` | `table.select` |  |
| `src/hooks/useExtensionCouponAdmin.ts:164` | table | `user_settings` | `table.select` |  |
| `src/hooks/useFanmarkByShortId.ts:49` | rpc | `get_fanmark_by_short_id` | `rpc` |  |
| `src/hooks/useFanmarkDetails.tsx:66` | rpc | `get_fanmark_details_by_short_id` | `rpc` |  |
| `src/hooks/useFanmarkDetails.tsx:132` | rpc | `remove_fanmark_favorite` | `rpc` |  |
| `src/hooks/useFanmarkDetails.tsx:142` | rpc | `add_fanmark_favorite` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:165` | rpc | `list_recent_fanmarks` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:252` | auth | `auth` | `auth.getUser` |  |
| `src/hooks/useFanmarkSearch.tsx:281` | rpc | `check_fanmark_availability` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:301` | rpc | `record_fanmark_search` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:327` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:501` | edge | `register-fanmark` | `edge_function_invoke` |  |
| `src/hooks/useFanmarkSearch.tsx:547` | rpc | `check_fanmark_availability` | `rpc` |  |
| `src/hooks/useFanmarkSearch.tsx:560` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/hooks/useFavoriteFanmarks.ts:33` | rpc | `get_favorite_fanmarks` | `rpc` |  |
| `src/hooks/useInvitationAdmin.ts:26` | table | `invitation_codes` | `table.select` |  |
| `src/hooks/useInvitationAdmin.ts:57` | table | `invitation_codes` | `table.insert` |  |
| `src/hooks/useInvitationAdmin.ts:74` | table | `invitation_codes` | `table.update` |  |
| `src/hooks/useInvitationAdmin.ts:98` | table | `invitation_codes` | `table.delete` |  |
| `src/hooks/useInvitationCode.tsx:25` | rpc | `validate_invitation_code` | `rpc` |  |
| `src/hooks/useInvitationCode.tsx:56` | rpc | `use_invitation_code` | `rpc` |  |
| `src/hooks/useInvitationCode.tsx:83` | table | `waitlist` | `table.insert` |  |
| `src/hooks/useLanguages.tsx:42` | table | `languages` | `table.select` |  |
| `src/hooks/useLotteryEntry.tsx:123` | edge | `apply-fanmark-lottery` | `edge_function_invoke` |  |
| `src/hooks/useLotteryEntry.tsx:171` | edge | `cancel-lottery-entry` | `edge_function_invoke` |  |
| `src/hooks/usePasswordReset.tsx:20` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/usePasswordReset.tsx:33` | auth | `auth` | `auth.setSession` |  |
| `src/hooks/usePasswordReset.tsx:65` | auth | `auth` | `auth.updateUser` |  |
| `src/hooks/usePreferredLanguage.ts:23` | table | `user_settings` | `table.update` |  |
| `src/hooks/useProfile.tsx:24` | realtime | `user-settings-updates` | `realtime.channel` |  |
| `src/hooks/useProfile.tsx:36` | realtime | `<unresolved>` | `realtime.removeChannel` | `channel` |
| `src/hooks/useProfile.tsx:46` | table | `user_settings` | `table.select` |  |
| `src/hooks/useProfile.tsx:72` | table | `user_settings` | `table.update` |  |
| `src/hooks/useProfile.tsx:94` | rpc | `check_username_availability_secure` | `rpc` |  |
| `src/hooks/useSubscription.tsx:70` | auth | `auth` | `auth.getSession` |  |
| `src/hooks/useSubscription.tsx:73` | edge | `check-subscription` | `edge_function_invoke` |  |
| `src/hooks/useSubscription.tsx:86` | table | `user_subscriptions` | `table.select` |  |
| `src/hooks/useSubscription.tsx:145` | realtime | `user-subscription-updates` | `realtime.channel` |  |
| `src/hooks/useSubscription.tsx:162` | realtime | `<unresolved>` | `realtime.removeChannel` | `channel` |
| `src/hooks/useSubscription.tsx:170` | table | `user_subscriptions` | `table.select` |  |
| `src/hooks/useSystemSettings.tsx:59` | table | `system_settings` | `table.select` |  |
| `src/hooks/useSystemSettings.tsx:129` | table | `system_settings` | `table.update` |  |
| `src/hooks/useTransferCode.ts:49` | table | `fanmark_transfer_codes` | `table.select` |  |
| `src/hooks/useTransferCode.ts:82` | table | `fanmark_transfer_requests` | `table.select` |  |
| `src/hooks/useTransferCode.ts:121` | table | `fanmark_transfer_requests` | `table.select` |  |
| `src/hooks/useTransferCode.ts:166` | edge | `generate-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:236` | edge | `apply-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:325` | edge | `approve-transfer-request` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:337` | edge | `reject-transfer-request` | `edge_function_invoke` |  |
| `src/hooks/useTransferCode.ts:349` | edge | `cancel-transfer-code` | `edge_function_invoke` |  |
| `src/hooks/useUnreadNotifications.ts:13` | rpc | `get_unread_notification_count` | `rpc` |  |
| `src/lib/emoji-master-utils.ts:120` | table | `emoji_master` | `table.select` |  |
| `src/lib/plan-utils.ts:58` | table | `fanmark_licenses` | `table.select` |  |
| `src/lib/profile-utils.ts:21` | auth | `auth` | `auth.getUser` |  |
| `src/lib/profile-utils.ts:28` | table | `user_settings` | `table.select` |  |
| `src/lib/profile-utils.ts:48` | rpc | `check_username_availability_secure` | `rpc` |  |
| `src/pages/AdminAuth.tsx:62` | auth | `auth` | `auth.getSession` |  |
| `src/pages/AdminAuth.tsx:96` | auth_mfa | `auth` | `auth.mfa.getAuthenticatorAssuranceLevel` |  |
| `src/pages/AdminAuth.tsx:109` | auth_mfa | `auth` | `auth.mfa.listFactors` |  |
| `src/pages/AdminAuth.tsx:138` | auth | `auth` | `auth.signInWithPassword` |  |
| `src/pages/AdminAuth.tsx:192` | auth | `auth` | `auth.signOut` |  |
| `src/pages/Analytics.tsx:81` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/Analytics.tsx:110` | table | `fanmark_basic_configs` | `table.select` |  |
| `src/pages/Analytics.tsx:159` | table | `fanmark_access_daily_stats` | `table.select` |  |
| `src/pages/EmojiProfileEdit.tsx:32` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/FanmarkMessageboardPreview.tsx:51` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkProfilePreview.tsx:97` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkSettingsPage.tsx:48` | rpc | `get_fanmark_complete_data` | `rpc` |  |
| `src/pages/FanmarkSettingsPage.tsx:85` | table | `fanmark_profiles` | `table.select` |  |
| `src/pages/ForgotPassword.tsx:41` | auth | `auth` | `auth.resetPasswordForEmail` |  |
| `src/pages/Index.tsx:85` | table | `fanmark_licenses` | `table.select` |  |
| `src/pages/Notifications.tsx:38` | table | `notifications` | `table.select` |  |
| `src/pages/Notifications.tsx:57` | realtime | `notifications-updates` | `realtime.channel` |  |
| `src/pages/Notifications.tsx:74` | realtime | `<unresolved>` | `realtime.removeChannel` | `channel` |
| `src/pages/Notifications.tsx:79` | rpc | `mark_notification_read` | `rpc` |  |
| `src/pages/Notifications.tsx:111` | rpc | `mark_all_notifications_read` | `rpc` |  |
| `src/pages/PasswordSetup.tsx:85` | auth | `auth` | `auth.updateUser` |  |
| `src/pages/PasswordSetup.tsx:88` | table | `user_settings` | `table.update` |  |
| `src/pages/PlanSelection.tsx:301` | edge | `create-checkout` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:350` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:422` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:477` | edge | `bulk-return-fanmarks` | `edge_function_invoke` |  |
| `src/pages/PlanSelection.tsx:500` | edge | `change-subscription` | `edge_function_invoke` |  |
| `src/pages/Profile.tsx:124` | auth | `auth` | `auth.updateUser` |  |
| `src/pages/Profile.tsx:128` | table | `user_settings` | `table.update` |  |
| `src/pages/Profile.tsx:240` | edge | `delete-user-account` | `edge_function_invoke` |  |
| `src/pages/Profile.tsx:291` | edge | `customer-portal` | `edge_function_invoke` |  |

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
- `edge_function_invoke`: 35
- `realtime.channel`: 4
- `realtime.removeChannel`: 4
- `rpc`: 40
- `storage.getPublicUrl`: 2
- `storage.remove`: 2
- `storage.upload`: 2
- `table.delete`: 3
- `table.insert`: 6
- `table.select`: 46
- `table.update`: 22
- `table.upsert`: 5

### Unresolved or dynamic call arguments

- `src/components/layout/AppHeader.tsx:96`: realtime (realtime.channel), expression `` `notifications-preview-${user.id}` ``
- `src/components/layout/AppHeader.tsx:114`: realtime (realtime.removeChannel), expression `channel`
- `src/hooks/useProfile.tsx:36`: realtime (realtime.removeChannel), expression `channel`
- `src/hooks/useSubscription.tsx:162`: realtime (realtime.removeChannel), expression `channel`
- `src/pages/Notifications.tsx:74`: realtime (realtime.removeChannel), expression `channel`

### Unsupported or unknown receiver aliases

_none detected in frontend source._

## SQL, cron, storage, and auth references

The following references are grouped from current checkout migrations, the two checked-in schema snapshots, and `supabase/config.toml`. Locations are compressed by file and line range. These are evidence references, not a declaration of live state.

Evidence files (24): `supabase/migrations/20251231070109_remote_schema.sql`, `supabase/migrations/20251231072222_restore_rls_policies.sql`, `supabase/migrations/20251231201348_add_display_fanmark.sql`, `supabase/migrations/20251231222000_fix_password_config_license_check.sql`, `supabase/migrations/20260101090000_add_payment_failure_fields_to_user_subscriptions.sql`, `supabase/migrations/20260102102233_e5e3404a-2341-4bbf-80ea-b67d62e3423a.sql`, `supabase/migrations/20260102123300_a3d9ffa4-0b8d-4730-84f4-8a5eb680b3f1.sql`, `supabase/migrations/20260102125523_547b82b2-018b-4be4-adac-6b9d9fe3d491.sql`, `supabase/migrations/20260102125748_7bb11f5c-8252-49e2-a6db-42d9db393b30.sql`, `supabase/migrations/20260102215623_653e4d11-8e5c-4a5c-9abd-1d952afffa3a.sql`, `supabase/migrations/20260102221550_3bcc9909-4952-431c-b45c-7b39dc1d5db8.sql`, `supabase/migrations/20260102235155_0efff4a2-63a7-497b-b2c5-b54425604749.sql`, `supabase/migrations/20260103011437_remote_schema.sql`, `supabase/migrations/20260103120000_fix_oauth_password_setup.sql`, `supabase/migrations/20260103123000_add_maintenance_settings.sql`, `supabase/migrations/20260104025602_remote_schema.sql`, `supabase/migrations/20260104032906_cf240bf8-d8e2-448d-9194-ac6ce70a3096.sql`, `supabase/migrations/20260104091448_remote_schema.sql`, `supabase/migrations/20260104120000_update_public_access_grace.sql`, `supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql`, `supabase/migrations/20260725044303_make_notification_cron_on_demand.sql`, `supabase/remote_schema.sql`, `supabase/remote_schema_before_rls_push.sql`, `supabase/config.toml`

### Auth references

| Reference | Locations |
| --- | --- |
| `auth.role` | supabase/migrations/20260102123300_a3d9ffa4-0b8d-4730-84f4-8a5eb680b3f1.sql:29; supabase/migrations/20260104091448_remote_schema.sql:2130,2200,2258,2266; supabase/migrations/20260706154554_20260706154550_32813e3f-4473-4046-beb2-ec66ba8580e1.sql:24,53 |
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
| `cron.alter_job` | supabase/config.toml:84; supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:32,92 |
| `cron.job` | supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:23,83 |
| `edge-url:check-expired-licenses` | supabase/config.toml:69 |
| `edge-url:process-notification-events` | supabase/config.toml:77 |
| `net.http_post` | supabase/config.toml:68,76 |
| `pg_cron` | supabase/config.toml:60; supabase/migrations/20260725044303_make_notification_cron_on_demand.sql:2,5 |

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
- Resolve the dynamic frontend calls listed above and map each static table/RPC/function/storage operation to an owner, data classification, and Cloudflare replacement or retention decision.
- Confirm pg_cron/pg_net schedules, Auth providers and redirect URLs, Storage buckets/policies, Realtime channels, Stripe/Resend webhooks, and deployment secrets in the live environment. None are proven by this offline report.

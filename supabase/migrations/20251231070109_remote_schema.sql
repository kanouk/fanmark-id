create extension if not exists "pg_net" with schema "public" version '0.19.5';

revoke delete on table "public"."audit_logs" from "anon";

revoke insert on table "public"."audit_logs" from "anon";

revoke references on table "public"."audit_logs" from "anon";

revoke select on table "public"."audit_logs" from "anon";

revoke trigger on table "public"."audit_logs" from "anon";

revoke truncate on table "public"."audit_logs" from "anon";

revoke update on table "public"."audit_logs" from "anon";

revoke delete on table "public"."audit_logs" from "authenticated";

revoke insert on table "public"."audit_logs" from "authenticated";

revoke references on table "public"."audit_logs" from "authenticated";

revoke select on table "public"."audit_logs" from "authenticated";

revoke trigger on table "public"."audit_logs" from "authenticated";

revoke truncate on table "public"."audit_logs" from "authenticated";

revoke update on table "public"."audit_logs" from "authenticated";

revoke delete on table "public"."audit_logs" from "service_role";

revoke insert on table "public"."audit_logs" from "service_role";

revoke references on table "public"."audit_logs" from "service_role";

revoke select on table "public"."audit_logs" from "service_role";

revoke trigger on table "public"."audit_logs" from "service_role";

revoke truncate on table "public"."audit_logs" from "service_role";

revoke update on table "public"."audit_logs" from "service_role";

revoke delete on table "public"."emoji_master" from "anon";

revoke insert on table "public"."emoji_master" from "anon";

revoke references on table "public"."emoji_master" from "anon";

revoke select on table "public"."emoji_master" from "anon";

revoke trigger on table "public"."emoji_master" from "anon";

revoke truncate on table "public"."emoji_master" from "anon";

revoke update on table "public"."emoji_master" from "anon";

revoke delete on table "public"."emoji_master" from "authenticated";

revoke insert on table "public"."emoji_master" from "authenticated";

revoke references on table "public"."emoji_master" from "authenticated";

revoke select on table "public"."emoji_master" from "authenticated";

revoke trigger on table "public"."emoji_master" from "authenticated";

revoke truncate on table "public"."emoji_master" from "authenticated";

revoke update on table "public"."emoji_master" from "authenticated";

revoke delete on table "public"."emoji_master" from "service_role";

revoke insert on table "public"."emoji_master" from "service_role";

revoke references on table "public"."emoji_master" from "service_role";

revoke select on table "public"."emoji_master" from "service_role";

revoke trigger on table "public"."emoji_master" from "service_role";

revoke truncate on table "public"."emoji_master" from "service_role";

revoke update on table "public"."emoji_master" from "service_role";

revoke delete on table "public"."enterprise_user_settings" from "anon";

revoke insert on table "public"."enterprise_user_settings" from "anon";

revoke references on table "public"."enterprise_user_settings" from "anon";

revoke select on table "public"."enterprise_user_settings" from "anon";

revoke trigger on table "public"."enterprise_user_settings" from "anon";

revoke truncate on table "public"."enterprise_user_settings" from "anon";

revoke update on table "public"."enterprise_user_settings" from "anon";

revoke delete on table "public"."enterprise_user_settings" from "authenticated";

revoke insert on table "public"."enterprise_user_settings" from "authenticated";

revoke references on table "public"."enterprise_user_settings" from "authenticated";

revoke select on table "public"."enterprise_user_settings" from "authenticated";

revoke trigger on table "public"."enterprise_user_settings" from "authenticated";

revoke truncate on table "public"."enterprise_user_settings" from "authenticated";

revoke update on table "public"."enterprise_user_settings" from "authenticated";

revoke delete on table "public"."enterprise_user_settings" from "service_role";

revoke insert on table "public"."enterprise_user_settings" from "service_role";

revoke references on table "public"."enterprise_user_settings" from "service_role";

revoke select on table "public"."enterprise_user_settings" from "service_role";

revoke trigger on table "public"."enterprise_user_settings" from "service_role";

revoke truncate on table "public"."enterprise_user_settings" from "service_role";

revoke update on table "public"."enterprise_user_settings" from "service_role";

revoke delete on table "public"."extension_coupon_usages" from "anon";

revoke insert on table "public"."extension_coupon_usages" from "anon";

revoke references on table "public"."extension_coupon_usages" from "anon";

revoke select on table "public"."extension_coupon_usages" from "anon";

revoke trigger on table "public"."extension_coupon_usages" from "anon";

revoke truncate on table "public"."extension_coupon_usages" from "anon";

revoke update on table "public"."extension_coupon_usages" from "anon";

revoke delete on table "public"."extension_coupon_usages" from "authenticated";

revoke insert on table "public"."extension_coupon_usages" from "authenticated";

revoke references on table "public"."extension_coupon_usages" from "authenticated";

revoke select on table "public"."extension_coupon_usages" from "authenticated";

revoke trigger on table "public"."extension_coupon_usages" from "authenticated";

revoke truncate on table "public"."extension_coupon_usages" from "authenticated";

revoke update on table "public"."extension_coupon_usages" from "authenticated";

revoke delete on table "public"."extension_coupon_usages" from "service_role";

revoke insert on table "public"."extension_coupon_usages" from "service_role";

revoke references on table "public"."extension_coupon_usages" from "service_role";

revoke select on table "public"."extension_coupon_usages" from "service_role";

revoke trigger on table "public"."extension_coupon_usages" from "service_role";

revoke truncate on table "public"."extension_coupon_usages" from "service_role";

revoke update on table "public"."extension_coupon_usages" from "service_role";

revoke delete on table "public"."extension_coupons" from "anon";

revoke insert on table "public"."extension_coupons" from "anon";

revoke references on table "public"."extension_coupons" from "anon";

revoke select on table "public"."extension_coupons" from "anon";

revoke trigger on table "public"."extension_coupons" from "anon";

revoke truncate on table "public"."extension_coupons" from "anon";

revoke update on table "public"."extension_coupons" from "anon";

revoke delete on table "public"."extension_coupons" from "authenticated";

revoke insert on table "public"."extension_coupons" from "authenticated";

revoke references on table "public"."extension_coupons" from "authenticated";

revoke select on table "public"."extension_coupons" from "authenticated";

revoke trigger on table "public"."extension_coupons" from "authenticated";

revoke truncate on table "public"."extension_coupons" from "authenticated";

revoke update on table "public"."extension_coupons" from "authenticated";

revoke delete on table "public"."extension_coupons" from "service_role";

revoke insert on table "public"."extension_coupons" from "service_role";

revoke references on table "public"."extension_coupons" from "service_role";

revoke select on table "public"."extension_coupons" from "service_role";

revoke trigger on table "public"."extension_coupons" from "service_role";

revoke truncate on table "public"."extension_coupons" from "service_role";

revoke update on table "public"."extension_coupons" from "service_role";

revoke delete on table "public"."fanmark_access_daily_stats" from "anon";

revoke insert on table "public"."fanmark_access_daily_stats" from "anon";

revoke references on table "public"."fanmark_access_daily_stats" from "anon";

revoke select on table "public"."fanmark_access_daily_stats" from "anon";

revoke trigger on table "public"."fanmark_access_daily_stats" from "anon";

revoke truncate on table "public"."fanmark_access_daily_stats" from "anon";

revoke update on table "public"."fanmark_access_daily_stats" from "anon";

revoke delete on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke insert on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke references on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke select on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke trigger on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke truncate on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke update on table "public"."fanmark_access_daily_stats" from "authenticated";

revoke delete on table "public"."fanmark_access_daily_stats" from "service_role";

revoke insert on table "public"."fanmark_access_daily_stats" from "service_role";

revoke references on table "public"."fanmark_access_daily_stats" from "service_role";

revoke select on table "public"."fanmark_access_daily_stats" from "service_role";

revoke trigger on table "public"."fanmark_access_daily_stats" from "service_role";

revoke truncate on table "public"."fanmark_access_daily_stats" from "service_role";

revoke update on table "public"."fanmark_access_daily_stats" from "service_role";

revoke delete on table "public"."fanmark_access_logs" from "anon";

revoke insert on table "public"."fanmark_access_logs" from "anon";

revoke references on table "public"."fanmark_access_logs" from "anon";

revoke select on table "public"."fanmark_access_logs" from "anon";

revoke trigger on table "public"."fanmark_access_logs" from "anon";

revoke truncate on table "public"."fanmark_access_logs" from "anon";

revoke update on table "public"."fanmark_access_logs" from "anon";

revoke delete on table "public"."fanmark_access_logs" from "authenticated";

revoke insert on table "public"."fanmark_access_logs" from "authenticated";

revoke references on table "public"."fanmark_access_logs" from "authenticated";

revoke select on table "public"."fanmark_access_logs" from "authenticated";

revoke trigger on table "public"."fanmark_access_logs" from "authenticated";

revoke truncate on table "public"."fanmark_access_logs" from "authenticated";

revoke update on table "public"."fanmark_access_logs" from "authenticated";

revoke delete on table "public"."fanmark_access_logs" from "service_role";

revoke insert on table "public"."fanmark_access_logs" from "service_role";

revoke references on table "public"."fanmark_access_logs" from "service_role";

revoke select on table "public"."fanmark_access_logs" from "service_role";

revoke trigger on table "public"."fanmark_access_logs" from "service_role";

revoke truncate on table "public"."fanmark_access_logs" from "service_role";

revoke update on table "public"."fanmark_access_logs" from "service_role";

revoke delete on table "public"."fanmark_availability_rules" from "anon";

revoke insert on table "public"."fanmark_availability_rules" from "anon";

revoke references on table "public"."fanmark_availability_rules" from "anon";

revoke select on table "public"."fanmark_availability_rules" from "anon";

revoke trigger on table "public"."fanmark_availability_rules" from "anon";

revoke truncate on table "public"."fanmark_availability_rules" from "anon";

revoke update on table "public"."fanmark_availability_rules" from "anon";

revoke delete on table "public"."fanmark_availability_rules" from "authenticated";

revoke insert on table "public"."fanmark_availability_rules" from "authenticated";

revoke references on table "public"."fanmark_availability_rules" from "authenticated";

revoke select on table "public"."fanmark_availability_rules" from "authenticated";

revoke trigger on table "public"."fanmark_availability_rules" from "authenticated";

revoke truncate on table "public"."fanmark_availability_rules" from "authenticated";

revoke update on table "public"."fanmark_availability_rules" from "authenticated";

revoke delete on table "public"."fanmark_availability_rules" from "service_role";

revoke insert on table "public"."fanmark_availability_rules" from "service_role";

revoke references on table "public"."fanmark_availability_rules" from "service_role";

revoke select on table "public"."fanmark_availability_rules" from "service_role";

revoke trigger on table "public"."fanmark_availability_rules" from "service_role";

revoke truncate on table "public"."fanmark_availability_rules" from "service_role";

revoke update on table "public"."fanmark_availability_rules" from "service_role";

revoke delete on table "public"."fanmark_basic_configs" from "anon";

revoke insert on table "public"."fanmark_basic_configs" from "anon";

revoke references on table "public"."fanmark_basic_configs" from "anon";

revoke select on table "public"."fanmark_basic_configs" from "anon";

revoke trigger on table "public"."fanmark_basic_configs" from "anon";

revoke truncate on table "public"."fanmark_basic_configs" from "anon";

revoke update on table "public"."fanmark_basic_configs" from "anon";

revoke delete on table "public"."fanmark_basic_configs" from "authenticated";

revoke insert on table "public"."fanmark_basic_configs" from "authenticated";

revoke references on table "public"."fanmark_basic_configs" from "authenticated";

revoke select on table "public"."fanmark_basic_configs" from "authenticated";

revoke trigger on table "public"."fanmark_basic_configs" from "authenticated";

revoke truncate on table "public"."fanmark_basic_configs" from "authenticated";

revoke update on table "public"."fanmark_basic_configs" from "authenticated";

revoke delete on table "public"."fanmark_basic_configs" from "service_role";

revoke insert on table "public"."fanmark_basic_configs" from "service_role";

revoke references on table "public"."fanmark_basic_configs" from "service_role";

revoke select on table "public"."fanmark_basic_configs" from "service_role";

revoke trigger on table "public"."fanmark_basic_configs" from "service_role";

revoke truncate on table "public"."fanmark_basic_configs" from "service_role";

revoke update on table "public"."fanmark_basic_configs" from "service_role";

revoke delete on table "public"."fanmark_discoveries" from "anon";

revoke insert on table "public"."fanmark_discoveries" from "anon";

revoke references on table "public"."fanmark_discoveries" from "anon";

revoke select on table "public"."fanmark_discoveries" from "anon";

revoke trigger on table "public"."fanmark_discoveries" from "anon";

revoke truncate on table "public"."fanmark_discoveries" from "anon";

revoke update on table "public"."fanmark_discoveries" from "anon";

revoke delete on table "public"."fanmark_discoveries" from "authenticated";

revoke insert on table "public"."fanmark_discoveries" from "authenticated";

revoke references on table "public"."fanmark_discoveries" from "authenticated";

revoke select on table "public"."fanmark_discoveries" from "authenticated";

revoke trigger on table "public"."fanmark_discoveries" from "authenticated";

revoke truncate on table "public"."fanmark_discoveries" from "authenticated";

revoke update on table "public"."fanmark_discoveries" from "authenticated";

revoke delete on table "public"."fanmark_discoveries" from "service_role";

revoke insert on table "public"."fanmark_discoveries" from "service_role";

revoke references on table "public"."fanmark_discoveries" from "service_role";

revoke select on table "public"."fanmark_discoveries" from "service_role";

revoke trigger on table "public"."fanmark_discoveries" from "service_role";

revoke truncate on table "public"."fanmark_discoveries" from "service_role";

revoke update on table "public"."fanmark_discoveries" from "service_role";

revoke delete on table "public"."fanmark_events" from "anon";

revoke insert on table "public"."fanmark_events" from "anon";

revoke references on table "public"."fanmark_events" from "anon";

revoke select on table "public"."fanmark_events" from "anon";

revoke trigger on table "public"."fanmark_events" from "anon";

revoke truncate on table "public"."fanmark_events" from "anon";

revoke update on table "public"."fanmark_events" from "anon";

revoke delete on table "public"."fanmark_events" from "authenticated";

revoke insert on table "public"."fanmark_events" from "authenticated";

revoke references on table "public"."fanmark_events" from "authenticated";

revoke select on table "public"."fanmark_events" from "authenticated";

revoke trigger on table "public"."fanmark_events" from "authenticated";

revoke truncate on table "public"."fanmark_events" from "authenticated";

revoke update on table "public"."fanmark_events" from "authenticated";

revoke delete on table "public"."fanmark_events" from "service_role";

revoke insert on table "public"."fanmark_events" from "service_role";

revoke references on table "public"."fanmark_events" from "service_role";

revoke select on table "public"."fanmark_events" from "service_role";

revoke trigger on table "public"."fanmark_events" from "service_role";

revoke truncate on table "public"."fanmark_events" from "service_role";

revoke update on table "public"."fanmark_events" from "service_role";

revoke delete on table "public"."fanmark_favorites" from "anon";

revoke insert on table "public"."fanmark_favorites" from "anon";

revoke references on table "public"."fanmark_favorites" from "anon";

revoke select on table "public"."fanmark_favorites" from "anon";

revoke trigger on table "public"."fanmark_favorites" from "anon";

revoke truncate on table "public"."fanmark_favorites" from "anon";

revoke update on table "public"."fanmark_favorites" from "anon";

revoke delete on table "public"."fanmark_favorites" from "authenticated";

revoke insert on table "public"."fanmark_favorites" from "authenticated";

revoke references on table "public"."fanmark_favorites" from "authenticated";

revoke select on table "public"."fanmark_favorites" from "authenticated";

revoke trigger on table "public"."fanmark_favorites" from "authenticated";

revoke truncate on table "public"."fanmark_favorites" from "authenticated";

revoke update on table "public"."fanmark_favorites" from "authenticated";

revoke delete on table "public"."fanmark_favorites" from "service_role";

revoke insert on table "public"."fanmark_favorites" from "service_role";

revoke references on table "public"."fanmark_favorites" from "service_role";

revoke select on table "public"."fanmark_favorites" from "service_role";

revoke trigger on table "public"."fanmark_favorites" from "service_role";

revoke truncate on table "public"."fanmark_favorites" from "service_role";

revoke update on table "public"."fanmark_favorites" from "service_role";

revoke delete on table "public"."fanmark_licenses" from "anon";

revoke insert on table "public"."fanmark_licenses" from "anon";

revoke references on table "public"."fanmark_licenses" from "anon";

revoke select on table "public"."fanmark_licenses" from "anon";

revoke trigger on table "public"."fanmark_licenses" from "anon";

revoke truncate on table "public"."fanmark_licenses" from "anon";

revoke update on table "public"."fanmark_licenses" from "anon";

revoke delete on table "public"."fanmark_licenses" from "authenticated";

revoke insert on table "public"."fanmark_licenses" from "authenticated";

revoke references on table "public"."fanmark_licenses" from "authenticated";

revoke select on table "public"."fanmark_licenses" from "authenticated";

revoke trigger on table "public"."fanmark_licenses" from "authenticated";

revoke truncate on table "public"."fanmark_licenses" from "authenticated";

revoke update on table "public"."fanmark_licenses" from "authenticated";

revoke delete on table "public"."fanmark_licenses" from "service_role";

revoke insert on table "public"."fanmark_licenses" from "service_role";

revoke references on table "public"."fanmark_licenses" from "service_role";

revoke select on table "public"."fanmark_licenses" from "service_role";

revoke trigger on table "public"."fanmark_licenses" from "service_role";

revoke truncate on table "public"."fanmark_licenses" from "service_role";

revoke update on table "public"."fanmark_licenses" from "service_role";

revoke delete on table "public"."fanmark_lottery_entries" from "anon";

revoke insert on table "public"."fanmark_lottery_entries" from "anon";

revoke references on table "public"."fanmark_lottery_entries" from "anon";

revoke select on table "public"."fanmark_lottery_entries" from "anon";

revoke trigger on table "public"."fanmark_lottery_entries" from "anon";

revoke truncate on table "public"."fanmark_lottery_entries" from "anon";

revoke update on table "public"."fanmark_lottery_entries" from "anon";

revoke delete on table "public"."fanmark_lottery_entries" from "authenticated";

revoke insert on table "public"."fanmark_lottery_entries" from "authenticated";

revoke references on table "public"."fanmark_lottery_entries" from "authenticated";

revoke select on table "public"."fanmark_lottery_entries" from "authenticated";

revoke trigger on table "public"."fanmark_lottery_entries" from "authenticated";

revoke truncate on table "public"."fanmark_lottery_entries" from "authenticated";

revoke update on table "public"."fanmark_lottery_entries" from "authenticated";

revoke delete on table "public"."fanmark_lottery_entries" from "service_role";

revoke insert on table "public"."fanmark_lottery_entries" from "service_role";

revoke references on table "public"."fanmark_lottery_entries" from "service_role";

revoke select on table "public"."fanmark_lottery_entries" from "service_role";

revoke trigger on table "public"."fanmark_lottery_entries" from "service_role";

revoke truncate on table "public"."fanmark_lottery_entries" from "service_role";

revoke update on table "public"."fanmark_lottery_entries" from "service_role";

revoke delete on table "public"."fanmark_lottery_history" from "anon";

revoke insert on table "public"."fanmark_lottery_history" from "anon";

revoke references on table "public"."fanmark_lottery_history" from "anon";

revoke select on table "public"."fanmark_lottery_history" from "anon";

revoke trigger on table "public"."fanmark_lottery_history" from "anon";

revoke truncate on table "public"."fanmark_lottery_history" from "anon";

revoke update on table "public"."fanmark_lottery_history" from "anon";

revoke delete on table "public"."fanmark_lottery_history" from "authenticated";

revoke insert on table "public"."fanmark_lottery_history" from "authenticated";

revoke references on table "public"."fanmark_lottery_history" from "authenticated";

revoke select on table "public"."fanmark_lottery_history" from "authenticated";

revoke trigger on table "public"."fanmark_lottery_history" from "authenticated";

revoke truncate on table "public"."fanmark_lottery_history" from "authenticated";

revoke update on table "public"."fanmark_lottery_history" from "authenticated";

revoke delete on table "public"."fanmark_lottery_history" from "service_role";

revoke insert on table "public"."fanmark_lottery_history" from "service_role";

revoke references on table "public"."fanmark_lottery_history" from "service_role";

revoke select on table "public"."fanmark_lottery_history" from "service_role";

revoke trigger on table "public"."fanmark_lottery_history" from "service_role";

revoke truncate on table "public"."fanmark_lottery_history" from "service_role";

revoke update on table "public"."fanmark_lottery_history" from "service_role";

revoke delete on table "public"."fanmark_messageboard_configs" from "anon";

revoke insert on table "public"."fanmark_messageboard_configs" from "anon";

revoke references on table "public"."fanmark_messageboard_configs" from "anon";

revoke select on table "public"."fanmark_messageboard_configs" from "anon";

revoke trigger on table "public"."fanmark_messageboard_configs" from "anon";

revoke truncate on table "public"."fanmark_messageboard_configs" from "anon";

revoke update on table "public"."fanmark_messageboard_configs" from "anon";

revoke delete on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke insert on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke references on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke select on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke trigger on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke truncate on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke update on table "public"."fanmark_messageboard_configs" from "authenticated";

revoke delete on table "public"."fanmark_messageboard_configs" from "service_role";

revoke insert on table "public"."fanmark_messageboard_configs" from "service_role";

revoke references on table "public"."fanmark_messageboard_configs" from "service_role";

revoke select on table "public"."fanmark_messageboard_configs" from "service_role";

revoke trigger on table "public"."fanmark_messageboard_configs" from "service_role";

revoke truncate on table "public"."fanmark_messageboard_configs" from "service_role";

revoke update on table "public"."fanmark_messageboard_configs" from "service_role";

revoke delete on table "public"."fanmark_password_configs" from "anon";

revoke insert on table "public"."fanmark_password_configs" from "anon";

revoke references on table "public"."fanmark_password_configs" from "anon";

revoke select on table "public"."fanmark_password_configs" from "anon";

revoke trigger on table "public"."fanmark_password_configs" from "anon";

revoke truncate on table "public"."fanmark_password_configs" from "anon";

revoke update on table "public"."fanmark_password_configs" from "anon";

revoke delete on table "public"."fanmark_password_configs" from "authenticated";

revoke insert on table "public"."fanmark_password_configs" from "authenticated";

revoke references on table "public"."fanmark_password_configs" from "authenticated";

revoke select on table "public"."fanmark_password_configs" from "authenticated";

revoke trigger on table "public"."fanmark_password_configs" from "authenticated";

revoke truncate on table "public"."fanmark_password_configs" from "authenticated";

revoke update on table "public"."fanmark_password_configs" from "authenticated";

revoke delete on table "public"."fanmark_password_configs" from "service_role";

revoke insert on table "public"."fanmark_password_configs" from "service_role";

revoke references on table "public"."fanmark_password_configs" from "service_role";

revoke select on table "public"."fanmark_password_configs" from "service_role";

revoke trigger on table "public"."fanmark_password_configs" from "service_role";

revoke truncate on table "public"."fanmark_password_configs" from "service_role";

revoke update on table "public"."fanmark_password_configs" from "service_role";

revoke delete on table "public"."fanmark_profiles" from "anon";

revoke insert on table "public"."fanmark_profiles" from "anon";

revoke references on table "public"."fanmark_profiles" from "anon";

revoke select on table "public"."fanmark_profiles" from "anon";

revoke trigger on table "public"."fanmark_profiles" from "anon";

revoke truncate on table "public"."fanmark_profiles" from "anon";

revoke update on table "public"."fanmark_profiles" from "anon";

revoke delete on table "public"."fanmark_profiles" from "authenticated";

revoke insert on table "public"."fanmark_profiles" from "authenticated";

revoke references on table "public"."fanmark_profiles" from "authenticated";

revoke select on table "public"."fanmark_profiles" from "authenticated";

revoke trigger on table "public"."fanmark_profiles" from "authenticated";

revoke truncate on table "public"."fanmark_profiles" from "authenticated";

revoke update on table "public"."fanmark_profiles" from "authenticated";

revoke delete on table "public"."fanmark_profiles" from "service_role";

revoke insert on table "public"."fanmark_profiles" from "service_role";

revoke references on table "public"."fanmark_profiles" from "service_role";

revoke select on table "public"."fanmark_profiles" from "service_role";

revoke trigger on table "public"."fanmark_profiles" from "service_role";

revoke truncate on table "public"."fanmark_profiles" from "service_role";

revoke update on table "public"."fanmark_profiles" from "service_role";

revoke delete on table "public"."fanmark_redirect_configs" from "anon";

revoke insert on table "public"."fanmark_redirect_configs" from "anon";

revoke references on table "public"."fanmark_redirect_configs" from "anon";

revoke select on table "public"."fanmark_redirect_configs" from "anon";

revoke trigger on table "public"."fanmark_redirect_configs" from "anon";

revoke truncate on table "public"."fanmark_redirect_configs" from "anon";

revoke update on table "public"."fanmark_redirect_configs" from "anon";

revoke delete on table "public"."fanmark_redirect_configs" from "authenticated";

revoke insert on table "public"."fanmark_redirect_configs" from "authenticated";

revoke references on table "public"."fanmark_redirect_configs" from "authenticated";

revoke select on table "public"."fanmark_redirect_configs" from "authenticated";

revoke trigger on table "public"."fanmark_redirect_configs" from "authenticated";

revoke truncate on table "public"."fanmark_redirect_configs" from "authenticated";

revoke update on table "public"."fanmark_redirect_configs" from "authenticated";

revoke delete on table "public"."fanmark_redirect_configs" from "service_role";

revoke insert on table "public"."fanmark_redirect_configs" from "service_role";

revoke references on table "public"."fanmark_redirect_configs" from "service_role";

revoke select on table "public"."fanmark_redirect_configs" from "service_role";

revoke trigger on table "public"."fanmark_redirect_configs" from "service_role";

revoke truncate on table "public"."fanmark_redirect_configs" from "service_role";

revoke update on table "public"."fanmark_redirect_configs" from "service_role";

revoke delete on table "public"."fanmark_tier_extension_prices" from "anon";

revoke insert on table "public"."fanmark_tier_extension_prices" from "anon";

revoke references on table "public"."fanmark_tier_extension_prices" from "anon";

revoke select on table "public"."fanmark_tier_extension_prices" from "anon";

revoke trigger on table "public"."fanmark_tier_extension_prices" from "anon";

revoke truncate on table "public"."fanmark_tier_extension_prices" from "anon";

revoke update on table "public"."fanmark_tier_extension_prices" from "anon";

revoke delete on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke insert on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke references on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke select on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke trigger on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke truncate on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke update on table "public"."fanmark_tier_extension_prices" from "authenticated";

revoke delete on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke insert on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke references on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke select on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke trigger on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke truncate on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke update on table "public"."fanmark_tier_extension_prices" from "service_role";

revoke delete on table "public"."fanmark_tiers" from "anon";

revoke insert on table "public"."fanmark_tiers" from "anon";

revoke references on table "public"."fanmark_tiers" from "anon";

revoke select on table "public"."fanmark_tiers" from "anon";

revoke trigger on table "public"."fanmark_tiers" from "anon";

revoke truncate on table "public"."fanmark_tiers" from "anon";

revoke update on table "public"."fanmark_tiers" from "anon";

revoke delete on table "public"."fanmark_tiers" from "authenticated";

revoke insert on table "public"."fanmark_tiers" from "authenticated";

revoke references on table "public"."fanmark_tiers" from "authenticated";

revoke select on table "public"."fanmark_tiers" from "authenticated";

revoke trigger on table "public"."fanmark_tiers" from "authenticated";

revoke truncate on table "public"."fanmark_tiers" from "authenticated";

revoke update on table "public"."fanmark_tiers" from "authenticated";

revoke delete on table "public"."fanmark_tiers" from "service_role";

revoke insert on table "public"."fanmark_tiers" from "service_role";

revoke references on table "public"."fanmark_tiers" from "service_role";

revoke select on table "public"."fanmark_tiers" from "service_role";

revoke trigger on table "public"."fanmark_tiers" from "service_role";

revoke truncate on table "public"."fanmark_tiers" from "service_role";

revoke update on table "public"."fanmark_tiers" from "service_role";

revoke delete on table "public"."fanmark_transfer_codes" from "anon";

revoke insert on table "public"."fanmark_transfer_codes" from "anon";

revoke references on table "public"."fanmark_transfer_codes" from "anon";

revoke select on table "public"."fanmark_transfer_codes" from "anon";

revoke trigger on table "public"."fanmark_transfer_codes" from "anon";

revoke truncate on table "public"."fanmark_transfer_codes" from "anon";

revoke update on table "public"."fanmark_transfer_codes" from "anon";

revoke delete on table "public"."fanmark_transfer_codes" from "authenticated";

revoke insert on table "public"."fanmark_transfer_codes" from "authenticated";

revoke references on table "public"."fanmark_transfer_codes" from "authenticated";

revoke select on table "public"."fanmark_transfer_codes" from "authenticated";

revoke trigger on table "public"."fanmark_transfer_codes" from "authenticated";

revoke truncate on table "public"."fanmark_transfer_codes" from "authenticated";

revoke update on table "public"."fanmark_transfer_codes" from "authenticated";

revoke delete on table "public"."fanmark_transfer_codes" from "service_role";

revoke insert on table "public"."fanmark_transfer_codes" from "service_role";

revoke references on table "public"."fanmark_transfer_codes" from "service_role";

revoke select on table "public"."fanmark_transfer_codes" from "service_role";

revoke trigger on table "public"."fanmark_transfer_codes" from "service_role";

revoke truncate on table "public"."fanmark_transfer_codes" from "service_role";

revoke update on table "public"."fanmark_transfer_codes" from "service_role";

revoke delete on table "public"."fanmark_transfer_requests" from "anon";

revoke insert on table "public"."fanmark_transfer_requests" from "anon";

revoke references on table "public"."fanmark_transfer_requests" from "anon";

revoke select on table "public"."fanmark_transfer_requests" from "anon";

revoke trigger on table "public"."fanmark_transfer_requests" from "anon";

revoke truncate on table "public"."fanmark_transfer_requests" from "anon";

revoke update on table "public"."fanmark_transfer_requests" from "anon";

revoke delete on table "public"."fanmark_transfer_requests" from "authenticated";

revoke insert on table "public"."fanmark_transfer_requests" from "authenticated";

revoke references on table "public"."fanmark_transfer_requests" from "authenticated";

revoke select on table "public"."fanmark_transfer_requests" from "authenticated";

revoke trigger on table "public"."fanmark_transfer_requests" from "authenticated";

revoke truncate on table "public"."fanmark_transfer_requests" from "authenticated";

revoke update on table "public"."fanmark_transfer_requests" from "authenticated";

revoke delete on table "public"."fanmark_transfer_requests" from "service_role";

revoke insert on table "public"."fanmark_transfer_requests" from "service_role";

revoke references on table "public"."fanmark_transfer_requests" from "service_role";

revoke select on table "public"."fanmark_transfer_requests" from "service_role";

revoke trigger on table "public"."fanmark_transfer_requests" from "service_role";

revoke truncate on table "public"."fanmark_transfer_requests" from "service_role";

revoke update on table "public"."fanmark_transfer_requests" from "service_role";

revoke delete on table "public"."fanmarks" from "anon";

revoke insert on table "public"."fanmarks" from "anon";

revoke references on table "public"."fanmarks" from "anon";

revoke select on table "public"."fanmarks" from "anon";

revoke trigger on table "public"."fanmarks" from "anon";

revoke truncate on table "public"."fanmarks" from "anon";

revoke update on table "public"."fanmarks" from "anon";

revoke delete on table "public"."fanmarks" from "authenticated";

revoke insert on table "public"."fanmarks" from "authenticated";

revoke references on table "public"."fanmarks" from "authenticated";

revoke select on table "public"."fanmarks" from "authenticated";

revoke trigger on table "public"."fanmarks" from "authenticated";

revoke truncate on table "public"."fanmarks" from "authenticated";

revoke update on table "public"."fanmarks" from "authenticated";

revoke delete on table "public"."fanmarks" from "service_role";

revoke insert on table "public"."fanmarks" from "service_role";

revoke references on table "public"."fanmarks" from "service_role";

revoke select on table "public"."fanmarks" from "service_role";

revoke trigger on table "public"."fanmarks" from "service_role";

revoke truncate on table "public"."fanmarks" from "service_role";

revoke update on table "public"."fanmarks" from "service_role";

revoke delete on table "public"."invitation_codes" from "anon";

revoke insert on table "public"."invitation_codes" from "anon";

revoke references on table "public"."invitation_codes" from "anon";

revoke select on table "public"."invitation_codes" from "anon";

revoke trigger on table "public"."invitation_codes" from "anon";

revoke truncate on table "public"."invitation_codes" from "anon";

revoke update on table "public"."invitation_codes" from "anon";

revoke delete on table "public"."invitation_codes" from "authenticated";

revoke insert on table "public"."invitation_codes" from "authenticated";

revoke references on table "public"."invitation_codes" from "authenticated";

revoke select on table "public"."invitation_codes" from "authenticated";

revoke trigger on table "public"."invitation_codes" from "authenticated";

revoke truncate on table "public"."invitation_codes" from "authenticated";

revoke update on table "public"."invitation_codes" from "authenticated";

revoke delete on table "public"."invitation_codes" from "service_role";

revoke insert on table "public"."invitation_codes" from "service_role";

revoke references on table "public"."invitation_codes" from "service_role";

revoke select on table "public"."invitation_codes" from "service_role";

revoke trigger on table "public"."invitation_codes" from "service_role";

revoke truncate on table "public"."invitation_codes" from "service_role";

revoke update on table "public"."invitation_codes" from "service_role";

revoke delete on table "public"."notification_events" from "anon";

revoke insert on table "public"."notification_events" from "anon";

revoke references on table "public"."notification_events" from "anon";

revoke select on table "public"."notification_events" from "anon";

revoke trigger on table "public"."notification_events" from "anon";

revoke truncate on table "public"."notification_events" from "anon";

revoke update on table "public"."notification_events" from "anon";

revoke delete on table "public"."notification_events" from "authenticated";

revoke insert on table "public"."notification_events" from "authenticated";

revoke references on table "public"."notification_events" from "authenticated";

revoke select on table "public"."notification_events" from "authenticated";

revoke trigger on table "public"."notification_events" from "authenticated";

revoke truncate on table "public"."notification_events" from "authenticated";

revoke update on table "public"."notification_events" from "authenticated";

revoke delete on table "public"."notification_events" from "service_role";

revoke insert on table "public"."notification_events" from "service_role";

revoke references on table "public"."notification_events" from "service_role";

revoke select on table "public"."notification_events" from "service_role";

revoke trigger on table "public"."notification_events" from "service_role";

revoke truncate on table "public"."notification_events" from "service_role";

revoke update on table "public"."notification_events" from "service_role";

revoke delete on table "public"."notification_preferences" from "anon";

revoke insert on table "public"."notification_preferences" from "anon";

revoke references on table "public"."notification_preferences" from "anon";

revoke select on table "public"."notification_preferences" from "anon";

revoke trigger on table "public"."notification_preferences" from "anon";

revoke truncate on table "public"."notification_preferences" from "anon";

revoke update on table "public"."notification_preferences" from "anon";

revoke delete on table "public"."notification_preferences" from "authenticated";

revoke insert on table "public"."notification_preferences" from "authenticated";

revoke references on table "public"."notification_preferences" from "authenticated";

revoke select on table "public"."notification_preferences" from "authenticated";

revoke trigger on table "public"."notification_preferences" from "authenticated";

revoke truncate on table "public"."notification_preferences" from "authenticated";

revoke update on table "public"."notification_preferences" from "authenticated";

revoke delete on table "public"."notification_preferences" from "service_role";

revoke insert on table "public"."notification_preferences" from "service_role";

revoke references on table "public"."notification_preferences" from "service_role";

revoke select on table "public"."notification_preferences" from "service_role";

revoke trigger on table "public"."notification_preferences" from "service_role";

revoke truncate on table "public"."notification_preferences" from "service_role";

revoke update on table "public"."notification_preferences" from "service_role";

revoke delete on table "public"."notification_rules" from "anon";

revoke insert on table "public"."notification_rules" from "anon";

revoke references on table "public"."notification_rules" from "anon";

revoke select on table "public"."notification_rules" from "anon";

revoke trigger on table "public"."notification_rules" from "anon";

revoke truncate on table "public"."notification_rules" from "anon";

revoke update on table "public"."notification_rules" from "anon";

revoke delete on table "public"."notification_rules" from "authenticated";

revoke insert on table "public"."notification_rules" from "authenticated";

revoke references on table "public"."notification_rules" from "authenticated";

revoke select on table "public"."notification_rules" from "authenticated";

revoke trigger on table "public"."notification_rules" from "authenticated";

revoke truncate on table "public"."notification_rules" from "authenticated";

revoke update on table "public"."notification_rules" from "authenticated";

revoke delete on table "public"."notification_rules" from "service_role";

revoke insert on table "public"."notification_rules" from "service_role";

revoke references on table "public"."notification_rules" from "service_role";

revoke select on table "public"."notification_rules" from "service_role";

revoke trigger on table "public"."notification_rules" from "service_role";

revoke truncate on table "public"."notification_rules" from "service_role";

revoke update on table "public"."notification_rules" from "service_role";

revoke delete on table "public"."notification_templates" from "anon";

revoke insert on table "public"."notification_templates" from "anon";

revoke references on table "public"."notification_templates" from "anon";

revoke select on table "public"."notification_templates" from "anon";

revoke trigger on table "public"."notification_templates" from "anon";

revoke truncate on table "public"."notification_templates" from "anon";

revoke update on table "public"."notification_templates" from "anon";

revoke delete on table "public"."notification_templates" from "authenticated";

revoke insert on table "public"."notification_templates" from "authenticated";

revoke references on table "public"."notification_templates" from "authenticated";

revoke select on table "public"."notification_templates" from "authenticated";

revoke trigger on table "public"."notification_templates" from "authenticated";

revoke truncate on table "public"."notification_templates" from "authenticated";

revoke update on table "public"."notification_templates" from "authenticated";

revoke delete on table "public"."notification_templates" from "service_role";

revoke insert on table "public"."notification_templates" from "service_role";

revoke references on table "public"."notification_templates" from "service_role";

revoke select on table "public"."notification_templates" from "service_role";

revoke trigger on table "public"."notification_templates" from "service_role";

revoke truncate on table "public"."notification_templates" from "service_role";

revoke update on table "public"."notification_templates" from "service_role";

revoke delete on table "public"."notifications" from "anon";

revoke insert on table "public"."notifications" from "anon";

revoke references on table "public"."notifications" from "anon";

revoke select on table "public"."notifications" from "anon";

revoke trigger on table "public"."notifications" from "anon";

revoke truncate on table "public"."notifications" from "anon";

revoke update on table "public"."notifications" from "anon";

revoke delete on table "public"."notifications" from "authenticated";

revoke insert on table "public"."notifications" from "authenticated";

revoke references on table "public"."notifications" from "authenticated";

revoke select on table "public"."notifications" from "authenticated";

revoke trigger on table "public"."notifications" from "authenticated";

revoke truncate on table "public"."notifications" from "authenticated";

revoke update on table "public"."notifications" from "authenticated";

revoke delete on table "public"."notifications" from "service_role";

revoke insert on table "public"."notifications" from "service_role";

revoke references on table "public"."notifications" from "service_role";

revoke select on table "public"."notifications" from "service_role";

revoke trigger on table "public"."notifications" from "service_role";

revoke truncate on table "public"."notifications" from "service_role";

revoke update on table "public"."notifications" from "service_role";

revoke delete on table "public"."notifications_history" from "anon";

revoke insert on table "public"."notifications_history" from "anon";

revoke references on table "public"."notifications_history" from "anon";

revoke select on table "public"."notifications_history" from "anon";

revoke trigger on table "public"."notifications_history" from "anon";

revoke truncate on table "public"."notifications_history" from "anon";

revoke update on table "public"."notifications_history" from "anon";

revoke delete on table "public"."notifications_history" from "authenticated";

revoke insert on table "public"."notifications_history" from "authenticated";

revoke references on table "public"."notifications_history" from "authenticated";

revoke select on table "public"."notifications_history" from "authenticated";

revoke trigger on table "public"."notifications_history" from "authenticated";

revoke truncate on table "public"."notifications_history" from "authenticated";

revoke update on table "public"."notifications_history" from "authenticated";

revoke delete on table "public"."notifications_history" from "service_role";

revoke insert on table "public"."notifications_history" from "service_role";

revoke references on table "public"."notifications_history" from "service_role";

revoke select on table "public"."notifications_history" from "service_role";

revoke trigger on table "public"."notifications_history" from "service_role";

revoke truncate on table "public"."notifications_history" from "service_role";

revoke update on table "public"."notifications_history" from "service_role";

revoke delete on table "public"."reserved_emoji_patterns" from "anon";

revoke insert on table "public"."reserved_emoji_patterns" from "anon";

revoke references on table "public"."reserved_emoji_patterns" from "anon";

revoke select on table "public"."reserved_emoji_patterns" from "anon";

revoke trigger on table "public"."reserved_emoji_patterns" from "anon";

revoke truncate on table "public"."reserved_emoji_patterns" from "anon";

revoke update on table "public"."reserved_emoji_patterns" from "anon";

revoke delete on table "public"."reserved_emoji_patterns" from "authenticated";

revoke insert on table "public"."reserved_emoji_patterns" from "authenticated";

revoke references on table "public"."reserved_emoji_patterns" from "authenticated";

revoke select on table "public"."reserved_emoji_patterns" from "authenticated";

revoke trigger on table "public"."reserved_emoji_patterns" from "authenticated";

revoke truncate on table "public"."reserved_emoji_patterns" from "authenticated";

revoke update on table "public"."reserved_emoji_patterns" from "authenticated";

revoke delete on table "public"."reserved_emoji_patterns" from "service_role";

revoke insert on table "public"."reserved_emoji_patterns" from "service_role";

revoke references on table "public"."reserved_emoji_patterns" from "service_role";

revoke select on table "public"."reserved_emoji_patterns" from "service_role";

revoke trigger on table "public"."reserved_emoji_patterns" from "service_role";

revoke truncate on table "public"."reserved_emoji_patterns" from "service_role";

revoke update on table "public"."reserved_emoji_patterns" from "service_role";

revoke delete on table "public"."system_settings" from "anon";

revoke insert on table "public"."system_settings" from "anon";

revoke references on table "public"."system_settings" from "anon";

revoke select on table "public"."system_settings" from "anon";

revoke trigger on table "public"."system_settings" from "anon";

revoke truncate on table "public"."system_settings" from "anon";

revoke update on table "public"."system_settings" from "anon";

revoke delete on table "public"."system_settings" from "authenticated";

revoke insert on table "public"."system_settings" from "authenticated";

revoke references on table "public"."system_settings" from "authenticated";

revoke select on table "public"."system_settings" from "authenticated";

revoke trigger on table "public"."system_settings" from "authenticated";

revoke truncate on table "public"."system_settings" from "authenticated";

revoke update on table "public"."system_settings" from "authenticated";

revoke delete on table "public"."system_settings" from "service_role";

revoke insert on table "public"."system_settings" from "service_role";

revoke references on table "public"."system_settings" from "service_role";

revoke select on table "public"."system_settings" from "service_role";

revoke trigger on table "public"."system_settings" from "service_role";

revoke truncate on table "public"."system_settings" from "service_role";

revoke update on table "public"."system_settings" from "service_role";

revoke delete on table "public"."user_roles" from "anon";

revoke insert on table "public"."user_roles" from "anon";

revoke references on table "public"."user_roles" from "anon";

revoke select on table "public"."user_roles" from "anon";

revoke trigger on table "public"."user_roles" from "anon";

revoke truncate on table "public"."user_roles" from "anon";

revoke update on table "public"."user_roles" from "anon";

revoke delete on table "public"."user_roles" from "authenticated";

revoke insert on table "public"."user_roles" from "authenticated";

revoke references on table "public"."user_roles" from "authenticated";

revoke select on table "public"."user_roles" from "authenticated";

revoke trigger on table "public"."user_roles" from "authenticated";

revoke truncate on table "public"."user_roles" from "authenticated";

revoke update on table "public"."user_roles" from "authenticated";

revoke delete on table "public"."user_roles" from "service_role";

revoke insert on table "public"."user_roles" from "service_role";

revoke references on table "public"."user_roles" from "service_role";

revoke select on table "public"."user_roles" from "service_role";

revoke trigger on table "public"."user_roles" from "service_role";

revoke truncate on table "public"."user_roles" from "service_role";

revoke update on table "public"."user_roles" from "service_role";

revoke delete on table "public"."user_settings" from "anon";

revoke insert on table "public"."user_settings" from "anon";

revoke references on table "public"."user_settings" from "anon";

revoke select on table "public"."user_settings" from "anon";

revoke trigger on table "public"."user_settings" from "anon";

revoke truncate on table "public"."user_settings" from "anon";

revoke update on table "public"."user_settings" from "anon";

revoke delete on table "public"."user_settings" from "authenticated";

revoke insert on table "public"."user_settings" from "authenticated";

revoke references on table "public"."user_settings" from "authenticated";

revoke select on table "public"."user_settings" from "authenticated";

revoke trigger on table "public"."user_settings" from "authenticated";

revoke truncate on table "public"."user_settings" from "authenticated";

revoke update on table "public"."user_settings" from "authenticated";

revoke delete on table "public"."user_settings" from "service_role";

revoke insert on table "public"."user_settings" from "service_role";

revoke references on table "public"."user_settings" from "service_role";

revoke select on table "public"."user_settings" from "service_role";

revoke trigger on table "public"."user_settings" from "service_role";

revoke truncate on table "public"."user_settings" from "service_role";

revoke update on table "public"."user_settings" from "service_role";

revoke delete on table "public"."user_subscriptions" from "anon";

revoke insert on table "public"."user_subscriptions" from "anon";

revoke references on table "public"."user_subscriptions" from "anon";

revoke select on table "public"."user_subscriptions" from "anon";

revoke trigger on table "public"."user_subscriptions" from "anon";

revoke truncate on table "public"."user_subscriptions" from "anon";

revoke update on table "public"."user_subscriptions" from "anon";

revoke delete on table "public"."user_subscriptions" from "authenticated";

revoke insert on table "public"."user_subscriptions" from "authenticated";

revoke references on table "public"."user_subscriptions" from "authenticated";

revoke select on table "public"."user_subscriptions" from "authenticated";

revoke trigger on table "public"."user_subscriptions" from "authenticated";

revoke truncate on table "public"."user_subscriptions" from "authenticated";

revoke update on table "public"."user_subscriptions" from "authenticated";

revoke delete on table "public"."user_subscriptions" from "service_role";

revoke insert on table "public"."user_subscriptions" from "service_role";

revoke references on table "public"."user_subscriptions" from "service_role";

revoke select on table "public"."user_subscriptions" from "service_role";

revoke trigger on table "public"."user_subscriptions" from "service_role";

revoke truncate on table "public"."user_subscriptions" from "service_role";

revoke update on table "public"."user_subscriptions" from "service_role";

revoke delete on table "public"."waitlist" from "anon";

revoke insert on table "public"."waitlist" from "anon";

revoke references on table "public"."waitlist" from "anon";

revoke select on table "public"."waitlist" from "anon";

revoke trigger on table "public"."waitlist" from "anon";

revoke truncate on table "public"."waitlist" from "anon";

revoke update on table "public"."waitlist" from "anon";

revoke delete on table "public"."waitlist" from "authenticated";

revoke insert on table "public"."waitlist" from "authenticated";

revoke references on table "public"."waitlist" from "authenticated";

revoke select on table "public"."waitlist" from "authenticated";

revoke trigger on table "public"."waitlist" from "authenticated";

revoke truncate on table "public"."waitlist" from "authenticated";

revoke update on table "public"."waitlist" from "authenticated";

revoke delete on table "public"."waitlist" from "service_role";

revoke insert on table "public"."waitlist" from "service_role";

revoke references on table "public"."waitlist" from "service_role";

revoke select on table "public"."waitlist" from "service_role";

revoke trigger on table "public"."waitlist" from "service_role";

revoke truncate on table "public"."waitlist" from "service_role";

revoke update on table "public"."waitlist" from "service_role";

drop function if exists "public"."is_admin"();

drop function if exists "public"."is_super_admin"();

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_fanmark_favorite(input_emoji_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_add', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_old_notifications(days_old integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  archived_count integer;
  cutoff_date timestamptz;
BEGIN
  cutoff_date := now() - (days_old || ' days')::interval;

  -- Move to history table
  WITH archived AS (
    DELETE FROM public.notifications
    WHERE created_at < cutoff_date
      AND status IN ('delivered', 'failed')
    RETURNING id, jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'event_id', event_id,
      'rule_id', rule_id,
      'template_id', template_id,
      'template_version', template_version,
      'channel', channel,
      'status', status,
      'payload', payload,
      'priority', priority,
      'triggered_at', triggered_at,
      'delivered_at', delivered_at,
      'read_at', read_at,
      'read_via', read_via,
      'expires_at', expires_at,
      'retry_count', retry_count,
      'error_reason', error_reason,
      'created_at', created_at,
      'updated_at', updated_at
    ) as original_data
  )
  INSERT INTO public.notifications_history (id, original_data)
  SELECT id, original_data FROM archived;

  GET DIAGNOSTICS archived_count = ROW_COUNT;

  RETURN archived_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'tier_display_name', tier_info.display_name,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = 'grace' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = 'grace' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = 'grace' THEN 'grace_period'
      ELSE 'taken'
    END;
  END IF;

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    'available_at', available_at,
    'blocking_status', blocking_status
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND (
        (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
        OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
      )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_username_availability_secure(username_to_check text, current_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Return false if username is empty
  IF username_to_check IS NULL OR username_to_check = '' THEN
    RETURN false;
  END IF;
  
  -- Check if username exists for a different user
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.user_settings
    WHERE username = lower(username_to_check)
      AND user_id != COALESCE(current_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.classify_fanmark_tier(input_emoji_ids uuid[])
 RETURNS TABLE(tier_level integer, display_name text, initial_license_days integer, monthly_price_usd numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  normalized_ids uuid[];
  emoji_count integer;
  unique_count integer;
  candidate_tier integer;
  tier_record RECORD;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := input_emoji_ids;
  emoji_count := array_length(normalized_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT id) INTO unique_count
  FROM unnest(normalized_ids) AS t(id);

  IF emoji_count = 1 THEN
    candidate_tier := 4;
  ELSIF unique_count = 1 AND emoji_count BETWEEN 2 AND 5 THEN
    candidate_tier := 3;
  ELSIF emoji_count >= 4 THEN
    candidate_tier := 1;
  ELSIF emoji_count = 3 THEN
    candidate_tier := 2;
  ELSIF emoji_count = 2 THEN
    candidate_tier := 3;
  ELSE
    candidate_tier := 1;
  END IF;

  SELECT
    ft.tier_level,
    ft.display_name,
    ft.initial_license_days,
    ft.monthly_price_usd
  INTO tier_record
  FROM public.fanmark_tiers AS ft
  WHERE ft.tier_level = candidate_tier
    AND ft.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tier_record.tier_level,
    tier_record.display_name,
    tier_record.initial_license_days,
    tier_record.monthly_price_usd;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.count_fanmark_emoji_units(input text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  normalized text;
  base_only text;
  zwj_count integer;
BEGIN
  -- Variation Selector と肌色修飾子を除去
  normalized := regexp_replace(
    input,
    format(
      '[%s%s]',
      chr(x'FE0F'::int),
      chr(x'1F3FB'::int) || chr(x'1F3FC'::int) || chr(x'1F3FD'::int) ||
      chr(x'1F3FE'::int) || chr(x'1F3FF'::int)
    ),
    '',
    'g'
  );

  -- ZWJ を数える
  SELECT count(*) INTO zwj_count
  FROM regexp_matches(normalized, chr(x'200D'::int), 'g');

  -- ZWJ を除いたベースの絵文字数を取得
  base_only := regexp_replace(normalized, chr(x'200D'::int), '', 'g');

  RETURN greatest(char_length(base_only) - coalesce(zwj_count, 0), 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_notification_event(event_type_param text, payload_param jsonb, source_param text DEFAULT 'system'::text, dedupe_key_param text DEFAULT NULL::text, trigger_at_param timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  event_id uuid;
BEGIN
  -- Check for duplicate if dedupe_key is provided
  IF dedupe_key_param IS NOT NULL THEN
    SELECT id INTO event_id
    FROM public.notification_events
    WHERE dedupe_key = dedupe_key_param
      AND status IN ('pending', 'processing')
    LIMIT 1;

    IF FOUND THEN
      RAISE NOTICE 'Duplicate event found with dedupe_key: %', dedupe_key_param;
      RETURN event_id;
    END IF;
  END IF;

  -- Insert new event
  INSERT INTO public.notification_events (
    event_type,
    payload,
    source,
    dedupe_key,
    trigger_at,
    status
  )
  VALUES (
    event_type_param,
    payload_param,
    source_param,
    dedupe_key_param,
    trigger_at_param,
    'pending'
  )
  RETURNING id INTO event_id;

  RETURN event_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_safe_display_name(user_email text, user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Extract username part before @ from email, or use user_ + first 8 chars of UUID
  RETURN COALESCE(
    CASE 
      WHEN user_email IS NOT NULL AND user_email LIKE '%@%' THEN 
        split_part(user_email, '@', 1)
      ELSE 
        'user_' || substring(user_id::text, 1, 8)
    END,
    'user_' || substring(user_id::text, 1, 8)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_transfer_code_string()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || '-';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  result := result || '-';
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
 RETURNS TABLE(id uuid, user_input_fanmark text, emoji_ids uuid[], fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, short_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = 'active'
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji_ids = normalized_ids
    AND f.status = 'active';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
 RETURNS TABLE(id uuid, short_id text, user_input_fanmark text, emoji_ids uuid[], fanmark_name text, access_type text, target_url text, text_content text, status text, is_password_protected boolean, license_id uuid, license_status text, license_end timestamp with time zone, grace_expires_at timestamp with time zone, is_returned boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.short_id,
        f.user_input_fanmark,
        f.emoji_ids,
        COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
        COALESCE(bc.access_type, 'inactive') AS access_type,
        rc.target_url,
        mc.content AS text_content,
        f.status,
        COALESCE(pc.is_enabled, false) AS is_password_protected,
        fl.id AS license_id,
        fl.status AS license_status,
        fl.license_end,
        fl.grace_expires_at,
        fl.is_returned
    FROM fanmarks f
    LEFT JOIN LATERAL (
        SELECT fl_inner.*
        FROM fanmark_licenses fl_inner
        WHERE fl_inner.fanmark_id = f.id
          AND fl_inner.status IN ('active', 'grace')
        ORDER BY fl_inner.license_end DESC NULLS LAST
        LIMIT 1
    ) fl ON TRUE
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
      AND f.status = 'active';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(fanmark_id_param uuid DEFAULT NULL::uuid, emoji_ids_param uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, user_input_fanmark text, emoji_ids uuid[], normalized_emoji text, short_id text, access_type text, status text, created_at timestamp with time zone, updated_at timestamp with time zone, fanmark_name text, target_url text, text_content text, is_password_protected boolean, current_owner_id uuid, license_end timestamp with time zone, has_active_license boolean, license_id uuid, current_license_status text, current_grace_expires_at timestamp with time zone, is_blocked_for_registration boolean, next_available_at timestamp with time zone, lottery_entry_count bigint, has_user_lottery_entry boolean, user_lottery_entry_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN latest.license_end
      ELSE NULL
    END AS next_available_at,
    COALESCE(lottery_info.entry_count, 0) AS lottery_entry_count,
    COALESCE(lottery_info.has_entry, false) AS has_user_lottery_entry,
    lottery_info.user_entry_id AS user_lottery_entry_id
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id FROM fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = f.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id
      AND fle.entry_status = 'pending'
  ) AS lottery_info ON true
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
 RETURNS TABLE(fanmark_id uuid, user_input_fanmark text, emoji_ids uuid[], normalized_emoji text, short_id text, fanmark_created_at timestamp with time zone, current_license_id uuid, current_owner_username text, current_owner_display_name text, current_license_start timestamp with time zone, current_license_end timestamp with time zone, current_license_status text, current_grace_expires_at timestamp with time zone, current_is_returned boolean, is_currently_active boolean, first_acquired_date timestamp with time zone, first_owner_username text, first_owner_display_name text, license_history jsonb, is_favorited boolean, lottery_entry_count bigint, has_user_lottery_entry boolean, user_lottery_entry_id uuid, current_owner_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = 'active';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id AS license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start AS first_date,
      us.username AS first_username,
      us.display_name AS first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          'license_start', fl.license_start,
          'license_end', fl.license_end,
          'grace_expires_at', fl.grace_expires_at,
          'excluded_at', fl.excluded_at,
          'is_returned', fl.is_returned,
          'username', us.username,
          'display_name', us.display_name,
          'status', fl.status,
          'is_initial_license', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) AS history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.fanmark_favorites ff
      WHERE ff.fanmark_id = fanmark_record.id
        AND ff.user_id = current_user_id
    ) AS is_fav
  ),
  lottery_info AS (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id 
       FROM public.fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = fanmark_record.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM public.fanmark_lottery_entries fle
    WHERE fle.fanmark_id = fanmark_record.id
      AND fle.entry_status = 'pending'
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,

    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    ll.is_returned,
    CASE WHEN ll.status = 'active' AND ll.license_end > now() THEN true ELSE false END AS is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    COALESCE(h.history_data, '[]'::jsonb),
    COALESCE(fs.is_fav, false),
    
    COALESCE(li.entry_count, 0)::bigint,
    COALESCE(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE
  LEFT JOIN lottery_info li ON TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fanmark_ownership_status(fanmark_license_id uuid)
 RETURNS TABLE(is_taken boolean, has_active_license boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    CASE WHEN fl.id IS NOT NULL THEN true ELSE false END as is_taken,
    CASE WHEN fl.status = 'active' AND fl.license_end > now() THEN true ELSE false END as has_active_license
  FROM public.fanmark_licenses fl
  WHERE fl.id = fanmark_license_id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_favorite_fanmarks()
 RETURNS TABLE(favorite_id uuid, discovery_id uuid, favorited_at timestamp with time zone, fanmark_id uuid, normalized_emoji_ids uuid[], emoji_ids uuid[], sequence_key uuid, availability_status text, search_count bigint, favorite_count bigint, short_id text, fanmark_name text, access_type text, target_url text, text_content text, current_owner_username text, current_owner_display_name text, current_license_start timestamp with time zone, current_license_end timestamp with time zone, current_license_status text, is_password_protected boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  auth_user_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT
    ff.id AS favorite_id,
    ff.discovery_id,
    ff.created_at AS favorited_at,
    d.fanmark_id,
    ff.normalized_emoji_ids,
    d.emoji_ids,
    seq_key(d.normalized_emoji_ids) AS sequence_key,
    d.availability_status,
    d.search_count,
    d.favorite_count,
    f.short_id,
    bc.fanmark_name,
    bc.access_type,
    rc.target_url,
    mc.content AS text_content,
    us.username AS current_owner_username,
    us.display_name AS current_owner_display_name,
    fl.license_start AS current_license_start,
    fl.license_end AS current_license_end,
    fl.status AS current_license_status,
    COALESCE(pc.is_enabled, false) AS is_password_protected
  FROM public.fanmark_favorites ff
  JOIN public.fanmark_discoveries d ON d.id = ff.discovery_id
  LEFT JOIN public.fanmarks f ON f.id = d.fanmark_id
  LEFT JOIN LATERAL (
    SELECT fl_inner.*
    FROM public.fanmark_licenses fl_inner
    WHERE fl_inner.fanmark_id = f.id
    ORDER BY fl_inner.license_end DESC NULLS LAST
    LIMIT 1
  ) fl ON true
  LEFT JOIN public.user_settings us ON us.user_id = fl.user_id
  LEFT JOIN public.fanmark_basic_configs bc ON bc.license_id = fl.id
  LEFT JOIN public.fanmark_redirect_configs rc ON rc.license_id = fl.id
  LEFT JOIN public.fanmark_messageboard_configs mc ON mc.license_id = fl.id
  LEFT JOIN public.fanmark_password_configs pc ON pc.license_id = fl.id
  WHERE ff.user_id = auth_user_id
  ORDER BY ff.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_license_id uuid)
 RETURNS TABLE(license_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT 
        fp.license_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.created_at,
        fp.updated_at
    FROM public.fanmark_profiles fp
    WHERE fp.license_id = profile_license_id
        AND fp.is_public = true
    ORDER BY fp.updated_at DESC
    LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_public_fanmark_profile(profile_fanmark_id uuid)
 RETURNS TABLE(id uuid, fanmark_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    fp.id,
    fp.fanmark_id,
    fp.display_name,
    fp.bio,
    fp.social_links,
    fp.theme_settings,
    fp.created_at,
    fp.updated_at
  FROM public.fanmark_profiles fp
  WHERE fp.fanmark_id = profile_fanmark_id 
    AND fp.is_public = true
  ORDER BY fp.updated_at DESC
  LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(user_id_param uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  unread_count integer;
BEGIN
  current_user_id := COALESCE(user_id_param, auth.uid());

  IF current_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO unread_count
  FROM public.notifications
  WHERE user_id = current_user_id
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN unread_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'UNAUTHORIZED_EMAIL_ACCESS',
      'waitlist',
      waitlist_id::text,
      jsonb_build_object(
        'timestamp', NOW(),
        'security_level', 'CRITICAL_RISK',
        'attempted_resource', 'email_address'
      )
    );
    
    RAISE EXCEPTION 'Unauthorized access to email data';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'EMAIL_ACCESS',
    'waitlist',
    waitlist_id::text,
    jsonb_build_object(
      'timestamp', NOW(),
      'security_level', 'ADMIN_VERIFIED',
      'purpose', 'email_retrieval'
    )
  );

  RETURN email_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_waitlist_secure(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, email_hash text, referral_source text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if not public.is_super_admin() then
    insert into public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) values (
      auth.uid(),
      'UNAUTHORIZED_WAITLIST_ACCESS',
      'waitlist',
      jsonb_build_object(
        'timestamp', now(),
        'ip_address', coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'),
        'attempted_action', 'get_waitlist_secure',
        'security_level', 'HIGH_RISK'
      )
    );
    raise exception 'Unauthorized access to waitlist data';
  end if;

  insert into public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) values (
    auth.uid(),
    'AUTHORIZED_WAITLIST_ACCESS',
    'waitlist',
    jsonb_build_object(
      'timestamp', now(),
      'record_count', (select count(*) from public.waitlist),
      'limit', p_limit,
      'offset', p_offset,
      'security_level', 'ADMIN_VERIFIED'
    )
  );

  return query
  select
    w.id,
    encode(digest(convert_to(w.email, 'UTF8'), 'sha256'), 'hex') as email_hash,
    w.referral_source,
    w.status,
    w.created_at
  from public.waitlist w
  order by w.created_at desc
  limit p_limit
  offset p_offset;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  generated_username TEXT;
BEGIN
  -- Generate username: user_ + first 8 chars of UUID
  generated_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    'user_' || substring(NEW.id::text, 1, 8)
  );

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  )
  VALUES (
    NEW.id,
    generated_username,
    -- Use the same value as username for display_name (privacy protection)
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', generated_username),
    COALESCE((NEW.raw_user_meta_data ->> 'plan_type')::user_plan, 'free'),
    COALESCE((NEW.raw_user_meta_data ->> 'preferred_language')::user_language, 'ja'),
    NEW.raw_user_meta_data ->> 'invited_by_code',
    COALESCE((NEW.raw_user_meta_data ->> 'requires_password_setup')::boolean, false)
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_active_transfer(license_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.fanmark_transfer_codes
    WHERE license_id = license_uuid
    AND status IN ('active', 'applied')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_fanmark_licensed(fanmark_license_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses 
    WHERE id = fanmark_license_id 
      AND status = 'active'
      AND license_end > now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_fanmark_password_protected(fanmark_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.fanmark_password_configs WHERE fanmark_id = fanmark_uuid),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.link_fanmark_discovery(new_fanmark_id uuid, normalized_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_discovery_id uuid;
BEGIN
  IF new_fanmark_id IS NULL OR normalized_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_discoveries
  SET fanmark_id = new_fanmark_id,
      availability_status = 'owned_by_user'
  WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
  RETURNING id INTO linked_discovery_id;

  IF linked_discovery_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fanmark_favorites
  SET fanmark_id = new_fanmark_id
  WHERE discovery_id = linked_discovery_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.link_fanmark_discovery_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.link_fanmark_discovery(NEW.id, NEW.normalized_emoji_ids);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.list_recent_fanmarks(p_limit integer DEFAULT 20)
 RETURNS TABLE(license_id uuid, fanmark_id uuid, fanmark_short_id text, display_emoji text, license_created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    raf.license_id,
    raf.fanmark_id,
    raf.fanmark_short_id,
    raf.display_emoji,
    raf.license_created_at
  FROM public.recent_active_fanmarks raf
  ORDER BY raf.license_created_at DESC
  LIMIT LEAST(50, GREATEST(1, COALESCE(p_limit, 20)));
$function$
;

CREATE OR REPLACE FUNCTION public.log_emoji_master_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_DELETE',
      'emoji_master',
      OLD.id::text,
      jsonb_build_object('emoji', OLD.emoji, 'short_name', OLD.short_name)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_UPDATE',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'EMOJI_MASTER_INSERT',
      'emoji_master',
      NEW.id::text,
      jsonb_build_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_lottery_entry_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_CREATED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'fanmark_id', NEW.fanmark_id,
        'license_id', NEW.license_id,
        'lottery_probability', NEW.lottery_probability
      )
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.entry_status != NEW.entry_status THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_STATUS_CHANGED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'old_status', OLD.entry_status,
        'new_status', NEW.entry_status,
        'cancellation_reason', NEW.cancellation_reason
      )
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_profile_cache_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only log if accessing multiple profiles (potential scraping behavior)
  -- This is a placeholder for more sophisticated monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'public_profile_cache',
    NEW.id::text,
    json_build_object(
      'accessed_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent'
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_waitlist_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Log all SELECT operations on waitlist for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'waitlist',
    NEW.id::text,
    json_build_object(
      'table', 'waitlist',
      'access_time', now(),
      'user_role', (SELECT role FROM public.profiles WHERE user_id = auth.uid())
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(user_id_param uuid, read_via_param text DEFAULT 'app'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  updated_count integer;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow users to mark their own notifications as read
  IF current_user_id != user_id_param THEN
    RAISE EXCEPTION 'Unauthorized: can only mark own notifications as read';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE user_id = user_id_param
    AND read_at IS NULL
    AND status = 'delivered'
    AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_id_param uuid, read_via_param text DEFAULT 'app'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.notifications
  SET read_at = now(),
      read_via = read_via_param,
      updated_at = now()
  WHERE id = notification_id_param
    AND user_id = current_user_id
    AND read_at IS NULL;

  RETURN FOUND;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_emoji_ids(input_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
AS $function$
DECLARE
  normalized_ids uuid[];
  id_count int;
  missing_count int;
  unresolved_count int;
BEGIN
  IF input_ids IS NULL OR array_length(input_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  id_count := array_length(input_ids, 1);

  WITH resolved AS (
    SELECT ids.ord, em.id AS master_id, em.codepoints
    FROM unnest(input_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  ),
  normalized AS (
    SELECT
      r.ord,
      r.master_id,
      CASE
        WHEN r.codepoints IS NULL THEN NULL
        ELSE ARRAY(
          SELECT cp_value
          FROM unnest(r.codepoints) WITH ORDINALITY cp(cp_value, idx)
          WHERE cp_value NOT IN ('1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF')
          ORDER BY idx
        )
      END AS normalized_codepoints
    FROM resolved r
  ),
  lookup AS (
    SELECT
      n.ord,
      n.master_id,
      n.normalized_codepoints,
      em_norm.id AS normalized_id
    FROM normalized n
    LEFT JOIN public.emoji_master em_norm
      ON em_norm.codepoints = n.normalized_codepoints
  )
  SELECT
    COUNT(*) FILTER (WHERE master_id IS NULL),
    COUNT(*) FILTER (WHERE normalized_id IS NULL),
    array_agg(normalized_id ORDER BY ord)
  INTO missing_count, unresolved_count, normalized_ids
  FROM lookup;

  IF missing_count > 0 OR unresolved_count > 0 THEN
    RETURN NULL;
  END IF;

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> id_count THEN
    RETURN NULL;
  END IF;

  RETURN normalized_ids;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_security_breach()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Log critical security events
  IF NEW.action = 'UNAUTHORIZED_WAITLIST_ACCESS' OR NEW.action = 'UNAUTHORIZED_EMAIL_ACCESS' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE 'SECURITY ALERT: Unauthorized access attempt by user % at %', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_fanmark_search(input_emoji_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  discovery_id uuid;
  auth_user_id uuid;
BEGIN
  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, true);
  SELECT auth.uid() INTO auth_user_id;
  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('search', auth_user_id, discovery_id, public.normalize_emoji_ids(input_emoji_ids));
  RETURN discovery_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_fanmark_favorite(input_emoji_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  deleted_record RECORD;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  DELETE FROM public.fanmark_favorites
  WHERE user_id = auth_user_id
    AND normalized_emoji_ids = normalized_ids
  RETURNING discovery_id INTO deleted_record;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = GREATEST(favorite_count - 1, 0)
  WHERE id = deleted_record.discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_remove', auth_user_id, deleted_record.discovery_id, normalized_ids);

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.render_notification_template(template_id_param uuid, template_version_param integer, payload_param jsonb, language_param text DEFAULT 'ja'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  template_record RECORD;
  rendered_title text;
  rendered_body text;
  rendered_summary text;
  key_name text;
  payload_value text;
  datetime_keys text[] := ARRAY['grace_expires_at', 'license_end', 'expires_at', 'created_at', 'updated_at'];
BEGIN
  SELECT title, body, summary
  INTO template_record
  FROM public.notification_templates
  WHERE template_id = template_id_param
    AND version = template_version_param
    AND language = language_param
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: % version % language %',
      template_id_param, template_version_param, language_param;
  END IF;

  rendered_title := template_record.title;
  rendered_body := template_record.body;
  rendered_summary := template_record.summary;

  FOR key_name IN SELECT jsonb_object_keys(payload_param)
  LOOP
    IF NOT (key_name = ANY(datetime_keys)) THEN
      payload_value := payload_param->>key_name;
      IF payload_value IS NOT NULL THEN
        rendered_title := REPLACE(rendered_title, '{{' || key_name || '}}', payload_value);
        rendered_body := REPLACE(rendered_body, '{{' || key_name || '}}', payload_value);
        IF rendered_summary IS NOT NULL THEN
          rendered_summary := REPLACE(rendered_summary, '{{' || key_name || '}}', payload_value);
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'title', rendered_title,
    'body', rendered_body,
    'summary', rendered_summary,
    'metadata', payload_param
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_fanmarks_with_lottery(input_emoji_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
  lottery_entry_count bigint := 0;
  has_user_lottery_entry boolean := false;
  user_lottery_entry_id uuid := NULL;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'tier_display_name', tier_info.display_name,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days,
        'lottery_entry_count', 0,
        'has_user_lottery_entry', false,
        'user_lottery_entry_id', NULL
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  -- Get lottery information
  SELECT
    COUNT(*),
    BOOL_OR(fle.user_id = current_user_id),
    (SELECT fle2.id FROM fanmark_lottery_entries fle2 
     WHERE fle2.fanmark_id = fanmark_record.id 
       AND fle2.user_id = current_user_id 
       AND fle2.entry_status = 'pending' 
     LIMIT 1)
  INTO lottery_entry_count, has_user_lottery_entry, user_lottery_entry_id
  FROM fanmark_lottery_entries fle
  WHERE fle.fanmark_id = fanmark_record.id
    AND fle.entry_status = 'pending';

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = 'grace' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = 'grace' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = 'grace' THEN 'grace_period'
      ELSE 'taken'
    END;
  END IF;

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    'available_at', available_at,
    'blocking_status', blocking_status,
    'lottery_entry_count', lottery_entry_count,
    'has_user_lottery_entry', has_user_lottery_entry,
    'user_lottery_entry_id', user_lottery_entry_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seq_key(normalized_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
  hash text;
BEGIN
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'normalized_ids cannot be null or empty';
  END IF;

  hash := md5(array_to_string(normalized_ids, ','));

  RETURN (
    substr(hash, 1, 8) || '-' ||
    substr(hash, 9, 4) || '-' ||
    substr(hash, 13, 4) || '-' ||
    substr(hash, 17, 4) || '-' ||
    substr(hash, 21, 12)
  )::uuid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.toggle_fanmark_favorite(fanmark_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_user_id uuid;
  is_favorited boolean;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;
  
  -- Check if already favorited
  SELECT EXISTS(
    SELECT 1 FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id
  ) INTO is_favorited;
  
  IF is_favorited THEN
    -- Remove favorite
    DELETE FROM public.fanmark_favorites 
    WHERE fanmark_id = fanmark_uuid AND user_id = current_user_id;
    RETURN false;
  ELSE
    -- Add favorite
    INSERT INTO public.fanmark_favorites (fanmark_id, user_id) 
    VALUES (fanmark_uuid, current_user_id);
    RETURN true;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_fanmark_discovery(input_emoji_ids uuid[], increment_search boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  normalized_ids uuid[];
  discovery_id uuid;
  search_increment int := CASE WHEN increment_search THEN 1 ELSE 0 END;
BEGIN
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  INSERT INTO public.fanmark_discoveries (
    emoji_ids,
    normalized_emoji_ids,
    last_seen_at,
    search_count
  )
  VALUES (
    input_emoji_ids,
    normalized_ids,
    now(),
    search_increment
  )
  ON CONFLICT (seq_key(normalized_emoji_ids))
  DO UPDATE SET
    emoji_ids = EXCLUDED.emoji_ids,
    last_seen_at = now(),
    search_count = public.fanmark_discoveries.search_count + search_increment
  RETURNING id INTO discovery_id;

  IF discovery_id IS NULL THEN
    SELECT id INTO discovery_id
    FROM public.fanmark_discoveries
    WHERE seq_key(normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  RETURN discovery_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_fanmark_password_config(license_uuid uuid, new_password text, enable_password boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    config_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.fanmark_licenses fl
        WHERE fl.id = license_uuid 
          AND fl.user_id = auth.uid() 
          AND fl.status = 'active' 
          AND fl.license_end > now()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User does not have active license';
    END IF;

    INSERT INTO public.fanmark_password_configs (
        license_id,
        access_password,
        is_enabled
    ) VALUES (
        license_uuid,
        new_password,
        enable_password
    )
    ON CONFLICT (license_id) DO UPDATE SET
        access_password = EXCLUDED.access_password,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = now()
    RETURNING id INTO config_id;
    
    RETURN config_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
 RETURNS TABLE(success boolean, special_perks jsonb, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '{}'::jsonb, 'Invalid or expired invitation code'::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''::text;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_display_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Check if display_name looks like an email address
  IF NEW.display_name IS NOT NULL AND NEW.display_name LIKE '%@%.%' THEN
    -- Replace with safe display name
    NEW.display_name = public.generate_safe_display_name(NEW.display_name, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
 RETURNS TABLE(is_valid boolean, special_perks jsonb, remaining_uses integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, '{}'::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_fanmark_password(fanmark_uuid uuid, provided_password text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  stored_password text;
  is_enabled boolean;
BEGIN
  -- Get the password configuration for the fanmark through license
  SELECT 
    pc.access_password,
    pc.is_enabled
  INTO stored_password, is_enabled
  FROM public.fanmarks f
  JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  JOIN public.fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.id = fanmark_uuid;
  
  -- Return false if no password config found or not enabled
  IF stored_password IS NULL OR is_enabled IS FALSE THEN
    RETURN false;
  END IF;
  
  -- Return true if passwords match
  RETURN stored_password = provided_password;
END;
$function$
;


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();


  create policy "Avatar images are publicly accessible"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Cover images are publicly accessible"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'cover-images'::text));



  create policy "Users can delete their own avatar"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can delete their own cover images"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'cover-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update their own avatar"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can update their own cover images"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'cover-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));



  create policy "Users can upload their own cover images"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'cover-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));




-- Restore RLS and policies from remote schema dump
-- source: supabase/remote_schema_before_rls_push.sql

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."emoji_master" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."enterprise_user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."extension_coupon_usages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."extension_coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_access_daily_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_availability_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_basic_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_discoveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_licenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_lottery_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_lottery_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_messageboard_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_password_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_redirect_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_tier_extension_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_transfer_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmark_transfer_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."fanmarks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."invitation_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reserved_emoji_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all coupons" ON public."extension_coupons";
CREATE POLICY "Admins can manage all coupons" ON "public"."extension_coupons" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can manage all lottery entries" ON public."fanmark_lottery_entries";
CREATE POLICY "Admins can manage all lottery entries" ON "public"."fanmark_lottery_entries" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can manage all usages" ON public."extension_coupon_usages";
CREATE POLICY "Admins can manage all usages" ON "public"."extension_coupon_usages" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can manage all user roles" ON public."user_roles";
CREATE POLICY "Admins can manage all user roles" ON "public"."user_roles" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("ur"."role" = 'admin'::"public"."app_role")))));

DROP POLICY IF EXISTS "Admins can manage emoji master" ON public."emoji_master";
CREATE POLICY "Admins can manage emoji master" ON "public"."emoji_master" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can manage notification rules" ON public."notification_rules";
CREATE POLICY "Admins can manage notification rules" ON "public"."notification_rules" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can manage templates" ON public."notification_templates";
CREATE POLICY "Admins can manage templates" ON "public"."notification_templates" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can update all settings" ON public."system_settings";
CREATE POLICY "Admins can update all settings" ON "public"."system_settings" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view all notifications" ON public."notifications";
CREATE POLICY "Admins can view all notifications" ON "public"."notifications" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view all settings" ON public."system_settings";
CREATE POLICY "Admins can view all settings" ON "public"."system_settings" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public."user_subscriptions";
CREATE POLICY "Admins can view all subscriptions" ON "public"."user_subscriptions" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view lottery history" ON public."fanmark_lottery_history";
CREATE POLICY "Admins can view lottery history" ON "public"."fanmark_lottery_history" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view notification events" ON public."notification_events";
CREATE POLICY "Admins can view notification events" ON "public"."notification_events" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can view notification history" ON public."notifications_history";
CREATE POLICY "Admins can view notification history" ON "public"."notifications_history" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Admins can write audit logs" ON public."audit_logs";
CREATE POLICY "Admins can write audit logs" ON "public"."audit_logs" FOR INSERT WITH CHECK (("public"."is_admin"() OR ("auth"."role"() = 'service_role'::"text")));

DROP POLICY IF EXISTS "Allow admin read fanmark tiers" ON public."fanmark_tiers";
CREATE POLICY "Allow admin read fanmark tiers" ON "public"."fanmark_tiers" FOR SELECT USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Allow admin update fanmark tiers" ON public."fanmark_tiers";
CREATE POLICY "Allow admin update fanmark tiers" ON "public"."fanmark_tiers" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Allow authenticated read extension prices" ON public."fanmark_tier_extension_prices";
CREATE POLICY "Allow authenticated read extension prices" ON "public"."fanmark_tier_extension_prices" FOR SELECT TO "authenticated" USING (("is_active" IS TRUE));

DROP POLICY IF EXISTS "Allow read discoveries" ON public."fanmark_discoveries";
CREATE POLICY "Allow read discoveries" ON "public"."fanmark_discoveries" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read events" ON public."fanmark_events";
CREATE POLICY "Allow read events" ON "public"."fanmark_events" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public."waitlist";
CREATE POLICY "Anyone can join waitlist" ON "public"."waitlist" FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view active availability rules" ON public."fanmark_availability_rules";
CREATE POLICY "Anyone can view active availability rules" ON "public"."fanmark_availability_rules" FOR SELECT USING (("is_available" = true));

DROP POLICY IF EXISTS "Anyone can view active fanmark licenses for recent activity" ON public."fanmark_licenses";
CREATE POLICY "Anyone can view active fanmark licenses for recent activity" ON "public"."fanmark_licenses" FOR SELECT USING (("status" = 'active'::"text"));

DROP POLICY IF EXISTS "Anyone can view active fanmarks" ON public."fanmarks";
CREATE POLICY "Anyone can view active fanmarks" ON "public"."fanmarks" FOR SELECT USING (("status" = 'active'::"text"));

DROP POLICY IF EXISTS "Anyone can view active reserved patterns" ON public."reserved_emoji_patterns";
CREATE POLICY "Anyone can view active reserved patterns" ON "public"."reserved_emoji_patterns" FOR SELECT USING (("is_active" = true));

DROP POLICY IF EXISTS "Anyone can view active tiers" ON public."fanmark_tiers";
CREATE POLICY "Anyone can view active tiers" ON "public"."fanmark_tiers" FOR SELECT USING (("is_active" = true));

DROP POLICY IF EXISTS "Anyone can view public settings" ON public."system_settings";
CREATE POLICY "Anyone can view public settings" ON "public"."system_settings" FOR SELECT USING (("is_public" = true));

DROP POLICY IF EXISTS "Authenticated users can validate active coupons" ON public."extension_coupons";
CREATE POLICY "Authenticated users can validate active coupons" ON "public"."extension_coupons" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("is_active" = true) AND (("expires_at" IS NULL) OR ("expires_at" > "now"())) AND ("used_count" < "max_uses")));

DROP POLICY IF EXISTS "Authenticated users can validate transfer codes" ON public."fanmark_transfer_codes";
CREATE POLICY "Authenticated users can validate transfer codes" ON "public"."fanmark_transfer_codes" FOR SELECT USING ((("auth"."uid"() IS NOT NULL) AND ("status" = 'active'::"text")));

DROP POLICY IF EXISTS "Authenticated users can view active templates" ON public."notification_templates";
CREATE POLICY "Authenticated users can view active templates" ON "public"."notification_templates" FOR SELECT USING ((("is_active" = true) AND ("auth"."uid"() IS NOT NULL)));

DROP POLICY IF EXISTS "Authenticated users can view emoji catalog" ON public."emoji_master";
CREATE POLICY "Authenticated users can view emoji catalog" ON "public"."emoji_master" FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "Authenticated users can view public profiles or own" ON public."fanmark_profiles";
CREATE POLICY "Authenticated users can view public profiles or own" ON "public"."fanmark_profiles" FOR SELECT TO "authenticated" USING ((("is_public" = true) OR (EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"()))))));

DROP POLICY IF EXISTS "Deny direct access to password configs" ON public."fanmark_password_configs";
CREATE POLICY "Deny direct access to password configs" ON "public"."fanmark_password_configs" USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Enterprise users can view their own settings" ON public."enterprise_user_settings";
CREATE POLICY "Enterprise users can view their own settings" ON "public"."enterprise_user_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Fanmarks are accessible to authenticated users" ON public."fanmarks";
CREATE POLICY "Fanmarks are accessible to authenticated users" ON "public"."fanmarks" FOR SELECT USING (("auth"."uid"() IS NOT NULL));

DROP POLICY IF EXISTS "Issuers can cancel their active transfer codes" ON public."fanmark_transfer_codes";
CREATE POLICY "Issuers can cancel their active transfer codes" ON "public"."fanmark_transfer_codes" FOR UPDATE USING ((("auth"."uid"() = "issuer_user_id") AND ("status" = 'active'::"text"))) WITH CHECK (("status" = 'cancelled'::"text"));

DROP POLICY IF EXISTS "Issuers can view requests for their codes" ON public."fanmark_transfer_requests";
CREATE POLICY "Issuers can view requests for their codes" ON "public"."fanmark_transfer_requests" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_transfer_codes" "tc"
  WHERE (("tc"."id" = "fanmark_transfer_requests"."transfer_code_id") AND ("tc"."issuer_user_id" = "auth"."uid"())))));

DROP POLICY IF EXISTS "Issuers can view their own transfer codes" ON public."fanmark_transfer_codes";
CREATE POLICY "Issuers can view their own transfer codes" ON "public"."fanmark_transfer_codes" FOR SELECT USING (("auth"."uid"() = "issuer_user_id"));

DROP POLICY IF EXISTS "Only admins can manage all licenses" ON public."fanmark_licenses";
CREATE POLICY "Only admins can manage all licenses" ON "public"."fanmark_licenses" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Only admins can manage availability rules" ON public."fanmark_availability_rules";
CREATE POLICY "Only admins can manage availability rules" ON "public"."fanmark_availability_rules" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Only admins can manage enterprise user settings" ON public."enterprise_user_settings";
CREATE POLICY "Only admins can manage enterprise user settings" ON "public"."enterprise_user_settings" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Only admins can manage invitation codes" ON public."invitation_codes";
CREATE POLICY "Only admins can manage invitation codes" ON "public"."invitation_codes" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

DROP POLICY IF EXISTS "Only admins can manage tiers" ON public."fanmark_tiers";
CREATE POLICY "Only admins can manage tiers" ON "public"."fanmark_tiers" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "Owners can view their fanmark access logs" ON public."fanmark_access_logs";
CREATE POLICY "Owners can view their fanmark access logs" ON "public"."fanmark_access_logs" FOR SELECT USING (("fanmark_id" IN ( SELECT "fl"."fanmark_id"
   FROM "public"."fanmark_licenses" "fl"
  WHERE ("fl"."user_id" = "auth"."uid"()))));

DROP POLICY IF EXISTS "Owners can view their fanmark daily stats" ON public."fanmark_access_daily_stats";
CREATE POLICY "Owners can view their fanmark daily stats" ON "public"."fanmark_access_daily_stats" FOR SELECT USING (("fanmark_id" IN ( SELECT "fl"."fanmark_id"
   FROM "public"."fanmark_licenses" "fl"
  WHERE ("fl"."user_id" = "auth"."uid"()))));

DROP POLICY IF EXISTS "Requesters can view their own transfer requests" ON public."fanmark_transfer_requests";
CREATE POLICY "Requesters can view their own transfer requests" ON "public"."fanmark_transfer_requests" FOR SELECT USING (("auth"."uid"() = "requester_user_id"));

DROP POLICY IF EXISTS "Service role can manage all subscriptions" ON public."user_subscriptions";
CREATE POLICY "Service role can manage all subscriptions" ON "public"."user_subscriptions" USING (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "System can create lottery history" ON public."fanmark_lottery_history";
CREATE POLICY "System can create lottery history" ON "public"."fanmark_lottery_history" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "System can insert usages" ON public."extension_coupon_usages";
CREATE POLICY "System can insert usages" ON "public"."extension_coupon_usages" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "System can manage all notifications" ON public."notifications";
CREATE POLICY "System can manage all notifications" ON "public"."notifications" USING (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "System can manage all transfer codes" ON public."fanmark_transfer_codes";
CREATE POLICY "System can manage all transfer codes" ON "public"."fanmark_transfer_codes" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "System can manage all transfer requests" ON public."fanmark_transfer_requests";
CREATE POLICY "System can manage all transfer requests" ON "public"."fanmark_transfer_requests" USING ((("auth"."role"() = 'service_role'::"text") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "System can manage notification events" ON public."notification_events";
CREATE POLICY "System can manage notification events" ON "public"."notification_events" USING (("auth"."role"() = 'service_role'::"text"));

DROP POLICY IF EXISTS "Users can cancel their pending entries" ON public."fanmark_lottery_entries";
CREATE POLICY "Users can cancel their pending entries" ON "public"."fanmark_lottery_entries" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND ("entry_status" = 'pending'::"text"))) WITH CHECK (("entry_status" = ANY (ARRAY['cancelled'::"text", 'pending'::"text"])));

DROP POLICY IF EXISTS "Users can create entries for grace licenses" ON public."fanmark_lottery_entries";
CREATE POLICY "Users can create entries for grace licenses" ON "public"."fanmark_lottery_entries" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_lottery_entries"."license_id") AND ("fl"."status" = 'grace'::"text") AND ("fl"."grace_expires_at" > "now"()))))));

DROP POLICY IF EXISTS "Users can create profiles for their own licenses" ON public."fanmark_profiles";
CREATE POLICY "Users can create profiles for their own licenses" ON "public"."fanmark_profiles" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND ("fl"."license_end" > "now"())))));

DROP POLICY IF EXISTS "Users can delete their own profiles" ON public."fanmark_profiles";
CREATE POLICY "Users can delete their own profiles" ON "public"."fanmark_profiles" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"())))));

DROP POLICY IF EXISTS "Users can insert their own settings" ON public."user_settings";
CREATE POLICY "Users can insert their own settings" ON "public"."user_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can manage configs for their own licenses" ON public."fanmark_basic_configs";
CREATE POLICY "Users can manage configs for their own licenses" ON "public"."fanmark_basic_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_basic_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));

DROP POLICY IF EXISTS "Users can manage messageboard configs for their own licenses" ON public."fanmark_messageboard_configs";
CREATE POLICY "Users can manage messageboard configs for their own licenses" ON "public"."fanmark_messageboard_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_messageboard_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));

DROP POLICY IF EXISTS "Users can manage redirect configs for their own licenses" ON public."fanmark_redirect_configs";
CREATE POLICY "Users can manage redirect configs for their own licenses" ON "public"."fanmark_redirect_configs" USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_redirect_configs"."license_id") AND ("fl"."user_id" = "auth"."uid"()) AND ("fl"."status" = 'active'::"text") AND (("fl"."license_end" IS NULL) OR ("fl"."license_end" > "now"()))))));

DROP POLICY IF EXISTS "Users can manage their own preferences" ON public."notification_preferences";
CREATE POLICY "Users can manage their own preferences" ON "public"."notification_preferences" USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can update their own notifications" ON public."notifications";
CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can update their own profiles" ON public."fanmark_profiles";
CREATE POLICY "Users can update their own profiles" ON "public"."fanmark_profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."fanmark_licenses" "fl"
  WHERE (("fl"."id" = "fanmark_profiles"."license_id") AND ("fl"."user_id" = "auth"."uid"())))));

DROP POLICY IF EXISTS "Users can update their own settings" ON public."user_settings";
CREATE POLICY "Users can update their own settings" ON "public"."user_settings" FOR UPDATE USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can validate invitation codes" ON public."invitation_codes";
CREATE POLICY "Users can validate invitation codes" ON "public"."invitation_codes" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND (("expires_at" IS NULL) OR ("expires_at" > "now"()))));

DROP POLICY IF EXISTS "Users can view their own audit logs" ON public."audit_logs";
CREATE POLICY "Users can view their own audit logs" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own entries" ON public."fanmark_lottery_entries";
CREATE POLICY "Users can view their own entries" ON "public"."fanmark_lottery_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own licenses" ON public."fanmark_licenses";
CREATE POLICY "Users can view their own licenses" ON "public"."fanmark_licenses" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own notifications" ON public."notifications";
CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own roles" ON public."user_roles";
CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own settings" ON public."user_settings";
CREATE POLICY "Users can view their own settings" ON "public"."user_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public."user_subscriptions";
CREATE POLICY "Users can view their own subscriptions" ON "public"."user_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users can view their own usages" ON public."extension_coupon_usages";
CREATE POLICY "Users can view their own usages" ON "public"."extension_coupon_usages" FOR SELECT USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Users manage favorites" ON public."fanmark_favorites";
CREATE POLICY "Users manage favorites" ON "public"."fanmark_favorites" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "Waitlist access only through secure functions" ON public."waitlist";
CREATE POLICY "Waitlist access only through secure functions" ON "public"."waitlist" FOR SELECT USING (false);

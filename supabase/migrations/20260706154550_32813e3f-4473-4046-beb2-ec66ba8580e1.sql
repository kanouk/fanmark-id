
-- 1. fanmark_licenses: remove anonymous public SELECT
DROP POLICY IF EXISTS "Anyone can view active fanmark licenses for recent activity" ON public.fanmark_licenses;

-- 2. extension_coupons: remove broad authenticated SELECT
DROP POLICY IF EXISTS "Authenticated users can validate active coupons" ON public.extension_coupons;

-- 3. invitation_codes: remove broad authenticated SELECT (validation still works via SECURITY DEFINER RPC)
DROP POLICY IF EXISTS "Users can validate invitation codes" ON public.invitation_codes;

-- 4. fanmark_transfer_codes: remove broad authenticated SELECT
DROP POLICY IF EXISTS "Authenticated users can validate transfer codes" ON public.fanmark_transfer_codes;

-- 5. user_settings: prevent privilege escalation via plan_type change
CREATE OR REPLACE FUNCTION public.prevent_user_settings_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT public.is_admin() INTO caller_is_admin;

  IF NOT caller_is_admin THEN
    IF NEW.plan_type IS DISTINCT FROM OLD.plan_type THEN
      RAISE EXCEPTION 'Only administrators can modify plan_type';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_settings_prevent_privilege_escalation ON public.user_settings;
CREATE TRIGGER user_settings_prevent_privilege_escalation
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.prevent_user_settings_privilege_escalation();

-- Also disallow non-admin inserting themselves as admin
CREATE OR REPLACE FUNCTION public.prevent_user_settings_insert_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_type = 'admin' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can assign the admin plan';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_settings_prevent_insert_escalation ON public.user_settings;
CREATE TRIGGER user_settings_prevent_insert_escalation
BEFORE INSERT ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.prevent_user_settings_insert_escalation();

-- 6. waitlist: replace with_check(true) with minimal validation
DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist"
ON public.waitlist
FOR INSERT
TO anon, authenticated
WITH CHECK (email IS NOT NULL AND length(trim(email)) > 3 AND email LIKE '%_@_%._%');

-- 7. Storage: drop broad public SELECT on storage.objects for public buckets
-- Files remain fetchable via the public bucket URL (bucket.public=true) but anonymous LIST is denied.
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Cover images are publicly accessible" ON storage.objects;

-- 8. Fix mutable search_path on utility functions
ALTER FUNCTION public.normalize_emoji_ids(uuid[]) SET search_path = public;
ALTER FUNCTION public.count_fanmark_emoji_units(text) SET search_path = public;
ALTER FUNCTION public.seq_key(uuid[]) SET search_path = public;

-- 9. Revoke EXECUTE on internal-only SECURITY DEFINER functions from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_emoji_master_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_lottery_entry_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_security_breach() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_waitlist_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_profile_cache_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_public_profile_cache() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_fanmark_discovery_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_user_settings_privilege_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_user_settings_insert_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_old_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification_event(text, jsonb, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_waitlist_email_by_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_waitlist_secure(integer, integer) FROM PUBLIC, anon, authenticated;

-- Remove the public access policy that exposes user_id
-- The "recent fanmarks" feature uses the list_recent_fanmarks() SECURITY DEFINER function
-- which doesn't expose user_id, so this change won't break that feature
DROP POLICY IF EXISTS "Anyone can view active fanmark licenses for recent activity" ON public.fanmark_licenses;
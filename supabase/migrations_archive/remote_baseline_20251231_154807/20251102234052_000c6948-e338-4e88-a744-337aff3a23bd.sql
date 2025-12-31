-- Allow anyone (including non-authenticated users) to view active fanmark licenses
-- This enables social proof on the homepage RecentFanmarksScroll component
-- Security: user_id is not exposed, only emoji and creation date are shown

CREATE POLICY "Anyone can view active fanmark licenses for recent activity"
ON public.fanmark_licenses
FOR SELECT
TO public
USING (
  status = 'active' 
  AND license_end > now()
);
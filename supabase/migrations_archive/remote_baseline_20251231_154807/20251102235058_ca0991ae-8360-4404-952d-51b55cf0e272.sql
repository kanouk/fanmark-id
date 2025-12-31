-- Allow anyone to view active fanmarks
-- This complements the fanmark_licenses policy for the RecentFanmarksScroll component
-- Security: Only emoji and basic fanmark info are exposed, no personal data

CREATE POLICY "Anyone can view active fanmarks"
ON public.fanmarks
FOR SELECT
TO public
USING (status = 'active');
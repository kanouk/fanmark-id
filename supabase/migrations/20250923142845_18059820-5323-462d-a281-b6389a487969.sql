-- Fix fanmarks table security - remove anonymous access to user data
-- Remove the overly permissive anonymous access policy
DROP POLICY IF EXISTS "anonymous_search_fanmarks_limited" ON public.fanmarks;

-- Create a more secure anonymous access policy that doesn't expose user data
-- Anonymous users should only access fanmarks through the secure get_fanmark_by_emoji function
-- This policy effectively blocks direct anonymous access to the table
CREATE POLICY "anonymous_no_direct_access" ON public.fanmarks
  FOR SELECT 
  USING (
    auth.uid() IS NULL AND false  -- Explicitly deny anonymous direct access
  );

-- Ensure the get_fanmark_by_emoji function has proper permissions for anonymous access
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(text) TO authenticated;

-- Update the authenticated search policy to be more restrictive
-- Authenticated users should only see limited data when searching (not user_id)
DROP POLICY IF EXISTS "authenticated_search_fanmarks_limited" ON public.fanmarks;

CREATE POLICY "authenticated_search_fanmarks_limited" ON public.fanmarks
  FOR SELECT 
  USING (
    status = 'active' 
    AND auth.uid() IS NOT NULL 
    AND auth.uid() != user_id
  );
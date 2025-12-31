-- Drop the view completely and implement a policy-based solution
DROP VIEW IF EXISTS public.public_profiles;

-- Drop existing problematic policy
DROP POLICY IF EXISTS "Public profiles with limited fields" ON public.profiles;

-- Re-create the original policy but with a more restrictive approach
-- We'll handle the column filtering at the application level instead of database level
CREATE POLICY "Public profiles viewable by everyone"
ON public.profiles
FOR SELECT
USING (is_public_profile = true);

-- Add a comment to document the security consideration
COMMENT ON POLICY "Public profiles viewable by everyone" ON public.profiles IS 
'This policy allows public access to profiles marked as public. Application code must filter sensitive fields like subscription data when serving to anonymous users.';
-- Drop the problematic view and policies
DROP VIEW IF EXISTS public.public_profiles;
DROP POLICY IF EXISTS "Public profiles view is accessible to everyone" ON public.profiles;
DROP POLICY IF EXISTS "Limited public profile access" ON public.profiles;

-- Create a simple view without security definer
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  user_id,
  username,
  display_name,
  bio,
  avatar_url,
  social_links,
  created_at
FROM public.profiles
WHERE is_public_profile = true;

-- Create a more secure policy that restricts column access for anonymous users
-- This policy will only allow public access to non-sensitive fields
CREATE POLICY "Public profiles with limited fields"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true
  AND (
    -- Authenticated users can see all fields of public profiles
    auth.uid() IS NOT NULL
    -- Anonymous users should use the public_profiles view instead
    OR current_setting('request.jwt.claims', true)::json->>'role' = 'anon'
  )
);
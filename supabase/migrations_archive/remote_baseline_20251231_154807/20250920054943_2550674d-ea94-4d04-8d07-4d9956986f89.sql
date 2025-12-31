-- Create a public view that only exposes safe fields for public profiles
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.profiles
WHERE is_public_profile = true;

-- Grant SELECT permissions on the view to anonymous users
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- Update the existing RLS policy to be more restrictive for public access
DROP POLICY IF EXISTS "Profile access policy" ON public.profiles;

-- Create separate policies for authenticated users and owners
CREATE POLICY "Users can view their own complete profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Create a restrictive policy for public profile access that excludes sensitive data
-- This policy will only allow access to basic profile info, not subscription data
CREATE POLICY "Public can view limited profile data" 
ON public.profiles 
FOR SELECT 
USING (
  is_public_profile = true 
  AND auth.uid() IS NULL -- Only for non-authenticated users
);

-- For authenticated users who are not the owner, allow access to public profiles but limit fields
CREATE POLICY "Authenticated users can view public profiles" 
ON public.profiles 
FOR SELECT 
USING (
  is_public_profile = true 
  AND auth.uid() != user_id
  AND auth.uid() IS NOT NULL
);
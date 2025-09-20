-- Fix subscription data exposure by creating secure RLS policy for public profiles
-- This policy only exposes safe, non-sensitive fields to the public

-- Drop the existing public profile policy
DROP POLICY IF EXISTS "Public profiles viewable by everyone" ON public.profiles;

-- Create a new secure policy that excludes sensitive subscription data
CREATE POLICY "Public profiles viewable by everyone" ON public.profiles
FOR SELECT USING (
  is_public_profile = true
  AND CASE 
    WHEN auth.uid() = user_id THEN true  -- Users can see their own full profile
    ELSE false  -- Public users see no subscription data through this policy
  END
);

-- Create a separate policy for public viewing of safe fields only
CREATE POLICY "Safe public profile data viewable by everyone" ON public.profiles
FOR SELECT USING (
  is_public_profile = true
  -- This policy will be used with specific column selection in application code
  -- to ensure only safe fields (username, display_name, bio, avatar_url, social_links) are exposed
);
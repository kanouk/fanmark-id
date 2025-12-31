-- Fix security vulnerability: Remove public access to emoji_profiles that exposes user_id
-- The current policy allows anyone to view emoji profiles including user_id when is_public = true

-- Drop the problematic public viewing policy
DROP POLICY IF EXISTS "Users can view public emoji profiles" ON public.emoji_profiles;

-- Create a secure function to get public emoji profile data without exposing user_id
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  id uuid,
  fanmark_id uuid,
  bio text,
  social_links jsonb,
  theme_settings jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ep.id,
    ep.fanmark_id,
    ep.bio,
    ep.social_links,
    ep.theme_settings,
    ep.created_at,
    ep.updated_at
  FROM public.emoji_profiles ep
  WHERE ep.fanmark_id = profile_fanmark_id 
    AND ep.is_public = true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Create a new policy that only allows viewing public profiles via the secure function
-- This prevents direct access to the table that would expose user_id
CREATE POLICY "Users can access emoji profiles through secure function only" 
ON public.emoji_profiles 
FOR SELECT 
USING (
  -- Only allow access to own profiles or through the security definer function
  auth.uid() = user_id
);

-- Grant execute permission on the function to authenticated users
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon;
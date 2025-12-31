-- Fix the security definer view warning by using a function approach instead

-- Drop the view that was flagged as a security issue
DROP VIEW IF EXISTS public.public_fanmark_profiles;

-- Update the existing function to be more secure while maintaining functionality
-- This approach is safer than a SECURITY DEFINER view
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  fanmark_id uuid, 
  display_name text, 
  bio text, 
  social_links jsonb, 
  theme_settings jsonb, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 
    fp.fanmark_id,
    fp.display_name,
    fp.bio,
    fp.social_links,
    fp.theme_settings,
    fp.created_at,
    fp.updated_at
  FROM public.fanmark_profiles fp
  WHERE fp.fanmark_id = profile_fanmark_id
    AND fp.is_public = true
  ORDER BY fp.updated_at DESC
  LIMIT 1;
$$;

-- Grant execute permission to both anon and authenticated users for public profile access
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon, authenticated;
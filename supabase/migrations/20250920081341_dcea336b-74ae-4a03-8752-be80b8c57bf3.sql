-- Fix security issue: Recreate public_profiles as a secure view
-- Drop the existing view first
DROP VIEW IF EXISTS public.public_profiles;

-- Create a secure view that only shows profiles marked as public
-- This references the profiles table which already has proper RLS policies
CREATE VIEW public.public_profiles AS
SELECT 
    p.id,
    p.username,
    p.display_name,
    p.bio,
    p.avatar_url,
    p.created_at
FROM public.profiles p
WHERE p.is_public_profile = true;

-- Grant SELECT permissions to authenticated and anonymous users
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO anon;
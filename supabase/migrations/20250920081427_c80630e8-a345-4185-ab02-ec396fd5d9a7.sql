-- Fix security definer view issue
-- Recreate the view without SECURITY DEFINER to respect user permissions
DROP VIEW IF EXISTS public.public_profiles;

-- Create the view with default security (not SECURITY DEFINER)
-- This ensures it respects the querying user's permissions
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

-- Grant appropriate permissions
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO anon;
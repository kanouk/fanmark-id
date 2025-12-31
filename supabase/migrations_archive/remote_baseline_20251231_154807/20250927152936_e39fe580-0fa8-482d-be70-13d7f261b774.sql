-- Fix get_public_emoji_profile function to work with RLS by making it SECURITY DEFINER
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_license_id uuid)
 RETURNS TABLE(license_id uuid, display_name text, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT 
        fp.license_id,
        fp.display_name,
        fp.bio,
        fp.social_links,
        fp.theme_settings,
        fp.created_at,
        fp.updated_at
    FROM public.fanmark_profiles fp
    WHERE fp.license_id = profile_license_id
        AND fp.is_public = true
    ORDER BY fp.updated_at DESC
    LIMIT 1;
$function$;

-- Grant execute permissions to anon and authenticated users so they can access public profiles
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated;
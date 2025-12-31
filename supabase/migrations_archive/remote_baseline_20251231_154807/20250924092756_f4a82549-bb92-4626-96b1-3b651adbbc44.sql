-- Clean up duplicate emoji_profiles records, keeping only the latest one
WITH duplicate_profiles AS (
  SELECT 
    fanmark_id,
    user_id,
    ROW_NUMBER() OVER (PARTITION BY fanmark_id, user_id ORDER BY updated_at DESC) as rn
  FROM emoji_profiles
),
profiles_to_delete AS (
  SELECT ep.id
  FROM emoji_profiles ep
  JOIN duplicate_profiles dp ON ep.fanmark_id = dp.fanmark_id AND ep.user_id = dp.user_id
  WHERE dp.rn > 1
)
DELETE FROM emoji_profiles 
WHERE id IN (SELECT id FROM profiles_to_delete);

-- Update the get_public_emoji_profile function to always return the most recent record
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
 RETURNS TABLE(id uuid, fanmark_id uuid, bio text, social_links jsonb, theme_settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND ep.is_public = true
  ORDER BY ep.updated_at DESC
  LIMIT 1;
END;
$function$;
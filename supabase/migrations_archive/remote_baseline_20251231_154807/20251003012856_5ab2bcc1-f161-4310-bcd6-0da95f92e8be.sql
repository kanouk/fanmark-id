-- Drop existing function first
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text);

-- Refactor get_fanmark_details_by_short_id to use fanmarks-first LEFT JOIN approach
CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  fanmark_id uuid,
  emoji_combination text,
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  fanmark_record RECORD;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  -- Get fanmark basic info
  SELECT f.id, f.emoji_combination, f.normalized_emoji, f.short_id, f.created_at
  INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param AND f.status = 'active';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id as license_id,
      fl.user_id,
      fl.status,
      us.username,
      us.display_name,
      fl.license_start,
      fl.license_end
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_end DESC
    LIMIT 1
  ),
  first_license AS (
    SELECT 
      fl.license_start as first_date,
      us.username as first_username,
      us.display_name as first_display_name
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
    ORDER BY fl.license_start ASC
    LIMIT 1
  ),
  history AS (
    SELECT 
      jsonb_agg(
        jsonb_build_object(
          'license_start', fl.license_start,
          'license_end', fl.license_end,
          'excluded_at', fl.excluded_at,
          'username', us.username,
          'display_name', us.display_name,
          'status', fl.status,
          'is_initial_license', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) as history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.emoji_combination,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,
    
    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    CASE 
      WHEN ll.status IN ('active', 'grace') AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, '[]'::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON true
  LEFT JOIN first_license fl ON true
  LEFT JOIN history h ON true
  LEFT JOIN favorite_status fs ON true;
END;
$function$;
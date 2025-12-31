-- Drop and recreate get_fanmark_details_by_short_id with lottery information
DROP FUNCTION IF EXISTS public.get_fanmark_details_by_short_id(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_details_by_short_id(shortid_param text)
RETURNS TABLE(
  fanmark_id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  fanmark_created_at timestamp with time zone,
  current_license_id uuid,
  current_owner_username text,
  current_owner_display_name text,
  current_license_start timestamp with time zone,
  current_license_end timestamp with time zone,
  current_license_status text,
  current_grace_expires_at timestamp with time zone,
  current_is_returned boolean,
  is_currently_active boolean,
  first_acquired_date timestamp with time zone,
  first_owner_username text,
  first_owner_display_name text,
  license_history jsonb,
  is_favorited boolean,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid,
  current_owner_id uuid
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

  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
    INTO fanmark_record
  FROM public.fanmarks f
  WHERE f.short_id = shortid_param
    AND f.status = 'active';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_license AS (
    SELECT 
      fl.id AS license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
      fl.is_returned,
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
      fl.license_start AS first_date,
      us.username AS first_username,
      us.display_name AS first_display_name
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
          'grace_expires_at', fl.grace_expires_at,
          'excluded_at', fl.excluded_at,
          'is_returned', fl.is_returned,
          'username', us.username,
          'display_name', us.display_name,
          'status', fl.status,
          'is_initial_license', fl.is_initial_license
        ) ORDER BY fl.license_start DESC
      ) AS history_data
    FROM public.fanmark_licenses fl
    LEFT JOIN public.user_settings us ON fl.user_id = us.user_id
    WHERE fl.fanmark_id = fanmark_record.id
  ),
  favorite_status AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.fanmark_favorites ff
      WHERE ff.fanmark_id = fanmark_record.id
        AND ff.user_id = current_user_id
    ) AS is_fav
  ),
  lottery_info AS (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id 
       FROM public.fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = fanmark_record.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM public.fanmark_lottery_entries fle
    WHERE fle.fanmark_id = fanmark_record.id
      AND fle.entry_status = 'pending'
  )
  SELECT 
    fanmark_record.id,
    fanmark_record.user_input_fanmark,
    fanmark_record.emoji_ids,
    fanmark_record.normalized_emoji,
    fanmark_record.short_id,
    fanmark_record.created_at,

    ll.license_id,
    ll.username,
    ll.display_name,
    ll.license_start,
    ll.license_end,
    ll.status,
    ll.grace_expires_at,
    ll.is_returned,
    CASE WHEN ll.status = 'active' AND ll.license_end > now() THEN true ELSE false END AS is_currently_active,

    fl.first_date,
    fl.first_username,
    fl.first_display_name,

    COALESCE(h.history_data, '[]'::jsonb),
    COALESCE(fs.is_fav, false),
    
    COALESCE(li.entry_count, 0)::bigint,
    COALESCE(li.has_entry, false),
    li.user_entry_id,
    ll.user_id
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE
  LEFT JOIN lottery_info li ON TRUE;
END;
$function$;
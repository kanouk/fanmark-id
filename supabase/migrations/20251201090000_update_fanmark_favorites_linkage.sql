-- Align favorite linkage with normalized sequence keys and improve discovery syncing

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
  
  SELECT f.id,
         f.user_input_fanmark,
         f.emoji_ids,
         f.normalized_emoji,
         f.short_id,
         f.created_at,
         f.normalized_emoji_ids
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
      fl.id as license_id,
      fl.user_id,
      fl.status,
      fl.grace_expires_at,
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
          'grace_expires_at', fl.grace_expires_at,
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
    SELECT
      CASE
        WHEN current_user_id IS NULL THEN false
        ELSE EXISTS (
          SELECT 1
          FROM public.fanmark_favorites ff
          WHERE ff.user_id = current_user_id
            AND seq_key(ff.normalized_emoji_ids) = seq_key(fanmark_record.normalized_emoji_ids)
        )
      END AS is_fav
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
    CASE 
      WHEN ll.status = 'active' AND ll.license_end > now() 
      THEN true 
      ELSE false 
    END as is_currently_active,
    
    fl.first_date,
    fl.first_username,
    fl.first_display_name,
    
    COALESCE(h.history_data, '[]'::jsonb),
    
    COALESCE(fs.is_fav, false)
  FROM (SELECT 1) AS dummy
  LEFT JOIN latest_license ll ON TRUE
  LEFT JOIN first_license fl ON TRUE
  LEFT JOIN history h ON TRUE
  LEFT JOIN favorite_status fs ON TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_fanmark_favorite(input_emoji_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  auth_user_id uuid;
  normalized_ids uuid[];
  discovery_id uuid;
  linked_fanmark_id uuid;
BEGIN
  SELECT auth.uid() INTO auth_user_id;
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);
  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invalid emoji ids';
  END IF;

  discovery_id := public.upsert_fanmark_discovery(input_emoji_ids, false);

  SELECT fanmark_id INTO linked_fanmark_id
  FROM public.fanmark_discoveries
  WHERE id = discovery_id;

  IF linked_fanmark_id IS NULL THEN
    SELECT f.id
    INTO linked_fanmark_id
    FROM public.fanmarks f
    WHERE seq_key(f.normalized_emoji_ids) = seq_key(normalized_ids)
    LIMIT 1;
  END IF;

  IF linked_fanmark_id IS NOT NULL THEN
    UPDATE public.fanmark_discoveries
    SET fanmark_id = linked_fanmark_id
    WHERE id = discovery_id
      AND fanmark_id IS DISTINCT FROM linked_fanmark_id;
  END IF;

  INSERT INTO public.fanmark_favorites (
    user_id,
    discovery_id,
    fanmark_id,
    normalized_emoji_ids
  )
  VALUES (
    auth_user_id,
    discovery_id,
    linked_fanmark_id,
    normalized_ids
  )
  ON CONFLICT (user_id, seq_key(normalized_emoji_ids))
  DO NOTHING;

  IF NOT FOUND THEN
    IF linked_fanmark_id IS NOT NULL THEN
      UPDATE public.fanmark_favorites
      SET fanmark_id = linked_fanmark_id
      WHERE user_id = auth_user_id
        AND normalized_emoji_ids = normalized_ids
        AND fanmark_id IS DISTINCT FROM linked_fanmark_id;
    END IF;
    RETURN false;
  END IF;

  UPDATE public.fanmark_discoveries
  SET favorite_count = favorite_count + 1
  WHERE id = discovery_id;

  INSERT INTO public.fanmark_events (event_type, user_id, discovery_id, normalized_emoji_ids)
  VALUES ('favorite_add', auth_user_id, discovery_id, normalized_ids);

  RETURN true;
END;
$function$;

-- Ensure discoveries and favorites are linked to concrete fanmarks where possible
SELECT public.link_fanmark_discovery(f.id, f.normalized_emoji_ids)
FROM public.fanmarks f;

-- Rename fanmarks.emoji_combination to user_input_fanmark and update dependent functions

ALTER TABLE public.fanmarks
  RENAME COLUMN emoji_combination TO user_input_fanmark;

ALTER TABLE public.fanmarks
  RENAME CONSTRAINT fanmarks_emoji_combination_unique TO fanmarks_user_input_fanmark_unique;

DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text);
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  access_type text,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  fanmark_name text,
  target_url text,
  text_content text,
  is_password_protected boolean,
  current_owner_id uuid,
  license_end timestamp with time zone,
  has_active_license boolean,
  license_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF fanmark_id_param IS NULL AND (emoji_ids_param IS NULL OR array_length(emoji_ids_param, 1) = 0) THEN
    RETURN;
  END IF;

  IF fanmark_id_param IS NULL THEN
    WITH resolved AS (
      SELECT em.emoji, ids.ord
      FROM unnest(emoji_ids_param) WITH ORDINALITY AS ids(id, ord)
      LEFT JOIN public.emoji_master em ON em.id = ids.id
    )
    SELECT
      COUNT(*) FILTER (WHERE emoji IS NULL),
      string_agg(emoji, '' ORDER BY ord)
    INTO missing_count, emoji_sequence
    FROM resolved;

    IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
      RETURN;
    END IF;

    normalized_input := translate(
      emoji_sequence,
      chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
      ''
    );
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    f.normalized_emoji,
    f.short_id,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    f.status,
    f.created_at,
    f.updated_at,
    bc.fanmark_name,
    rc.target_url,
    mc.content AS text_content,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    fl.user_id AS current_owner_id,
    fl.license_end,
    CASE
      WHEN fl.status = 'active' AND fl.license_end > now() THEN true
      ELSE false
    END AS has_active_license,
    fl.id AS license_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = 'active'
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(uuid[]);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  short_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  WITH resolved AS (
    SELECT em.emoji, ids.ord
    FROM unnest(input_emoji_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  )
  SELECT
    COUNT(*) FILTER (WHERE emoji IS NULL),
    string_agg(emoji, '' ORDER BY ord)
  INTO missing_count, emoji_sequence
  FROM resolved;

  IF missing_count > 0 OR emoji_sequence IS NULL OR emoji_sequence = '' THEN
    RETURN;
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );

  RETURN QUERY
  SELECT
    f.id,
    f.user_input_fanmark,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
    COALESCE(bc.access_type, 'inactive') AS access_type,
    rc.target_url,
    mc.content AS text_content,
    f.status,
    COALESCE(pc.is_enabled, false) AS is_password_protected,
    f.short_id
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id
    AND fl.status = 'active'
    AND fl.license_end > now()
  LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.normalized_emoji = normalized_input
    AND f.status = 'active';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO authenticated;

DROP FUNCTION IF EXISTS public.get_fanmark_by_short_id(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE (
    id uuid,
    short_id text,
    user_input_fanmark text,
    emoji_ids uuid[],
    fanmark_name text,
    access_type text,
    target_url text,
    text_content text,
    status text,
    is_password_protected boolean,
    license_id uuid,
    license_status text,
    license_end timestamptz,
    grace_expires_at timestamptz,
    is_returned boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.short_id,
        f.user_input_fanmark,
        f.emoji_ids,
        COALESCE(bc.fanmark_name, f.user_input_fanmark) AS fanmark_name,
        COALESCE(bc.access_type, 'inactive') AS access_type,
        rc.target_url,
        mc.content AS text_content,
        f.status,
        COALESCE(pc.is_enabled, false) AS is_password_protected,
        fl.id AS license_id,
        fl.status AS license_status,
        fl.license_end,
        fl.grace_expires_at,
        fl.is_returned
    FROM fanmarks f
    LEFT JOIN LATERAL (
        SELECT fl_inner.*
        FROM fanmark_licenses fl_inner
        WHERE fl_inner.fanmark_id = f.id
          AND fl_inner.status IN ('active', 'grace')
        ORDER BY fl_inner.license_end DESC NULLS LAST
        LIMIT 1
    ) fl ON TRUE
    LEFT JOIN fanmark_basic_configs bc ON fl.id = bc.license_id
    LEFT JOIN fanmark_redirect_configs rc ON fl.id = rc.license_id
    LEFT JOIN fanmark_messageboard_configs mc ON fl.id = mc.license_id
    LEFT JOIN fanmark_password_configs pc ON fl.id = pc.license_id
    WHERE f.short_id = shortid_param
      AND f.status = 'active';
END;
$function$;

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
  
  SELECT f.id, f.user_input_fanmark, f.emoji_ids, f.normalized_emoji, f.short_id, f.created_at
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
    SELECT EXISTS(
      SELECT 1 FROM public.fanmark_favorites ff 
      WHERE ff.fanmark_id = fanmark_record.id 
        AND ff.user_id = current_user_id
    ) as is_fav
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

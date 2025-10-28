-- Phase 1: Extend get_fanmark_complete_data to include lottery information
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL,
  emoji_ids_param uuid[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  user_input_fanmark text,
  emoji_ids uuid[],
  normalized_emoji text,
  short_id text,
  access_type text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  fanmark_name text,
  target_url text,
  text_content text,
  is_password_protected boolean,
  current_owner_id uuid,
  license_end timestamptz,
  has_active_license boolean,
  license_id uuid,
  current_license_status text,
  current_grace_expires_at timestamptz,
  is_blocked_for_registration boolean,
  next_available_at timestamptz,
  lottery_entry_count bigint,
  has_user_lottery_entry boolean,
  user_lottery_entry_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  missing_count int;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
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
    latest.user_id AS current_owner_id,
    latest.license_end,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      ELSE false
    END AS has_active_license,
    latest.id AS license_id,
    latest.status AS current_license_status,
    latest.grace_expires_at AS current_grace_expires_at,
    CASE
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN true
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN true
      ELSE false
    END AS is_blocked_for_registration,
    CASE
      WHEN latest.status = 'grace' AND COALESCE(latest.grace_expires_at, latest.license_end) > now() THEN COALESCE(latest.grace_expires_at, latest.license_end)
      WHEN latest.status = 'active' AND (latest.license_end IS NULL OR latest.license_end > now()) THEN latest.license_end
      ELSE NULL
    END AS next_available_at,
    COALESCE(lottery_info.entry_count, 0) AS lottery_entry_count,
    COALESCE(lottery_info.has_entry, false) AS has_user_lottery_entry,
    lottery_info.user_entry_id AS user_lottery_entry_id
  FROM fanmarks f
  LEFT JOIN LATERAL (
    SELECT fl.*
    FROM fanmark_licenses fl
    WHERE fl.fanmark_id = f.id
    ORDER BY (fl.license_end IS NULL) DESC, fl.license_end DESC
    LIMIT 1
  ) AS latest ON true
  LEFT JOIN fanmark_basic_configs bc ON latest.id = bc.license_id
  LEFT JOIN fanmark_redirect_configs rc ON latest.id = rc.license_id
  LEFT JOIN fanmark_messageboard_configs mc ON latest.id = mc.license_id
  LEFT JOIN fanmark_password_configs pc ON latest.id = pc.license_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS entry_count,
      BOOL_OR(fle.user_id = current_user_id) AS has_entry,
      (SELECT fle2.id FROM fanmark_lottery_entries fle2 
       WHERE fle2.fanmark_id = f.id 
         AND fle2.user_id = current_user_id 
         AND fle2.entry_status = 'pending' 
       LIMIT 1) AS user_entry_id
    FROM fanmark_lottery_entries fle
    WHERE fle.fanmark_id = f.id
      AND fle.entry_status = 'pending'
  ) AS lottery_info ON true
  WHERE
    (fanmark_id_param IS NOT NULL AND f.id = fanmark_id_param)
    OR
    (fanmark_id_param IS NULL AND normalized_input IS NOT NULL AND f.normalized_emoji = normalized_input);
END;
$function$;

-- Phase 1.2: Create new RPC function for search with lottery information
CREATE OR REPLACE FUNCTION public.search_fanmarks_with_lottery(input_emoji_ids uuid[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  blocking_license RECORD;
  is_available boolean;
  emoji_count integer;
  missing_count integer;
  available_at timestamptz;
  blocking_reason text;
  blocking_status text;
  lottery_entry_count bigint := 0;
  has_user_lottery_entry boolean := false;
  user_lottery_entry_id uuid := NULL;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
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
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  normalized_input := translate(
    emoji_sequence,
    chr(127995) || chr(127996) || chr(127997) || chr(127998) || chr(127999),
    ''
  );
  emoji_count := array_length(input_emoji_ids, 1);

  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level,
           display_name,
           initial_license_days,
           monthly_price_usd
    INTO tier_info
    FROM public.classify_fanmark_tier(input_emoji_ids)
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'tier_display_name', tier_info.display_name,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days,
        'lottery_entry_count', 0,
        'has_user_lottery_entry', false,
        'user_lottery_entry_id', NULL
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  -- Get lottery information
  SELECT
    COUNT(*),
    BOOL_OR(fle.user_id = current_user_id),
    (SELECT fle2.id FROM fanmark_lottery_entries fle2 
     WHERE fle2.fanmark_id = fanmark_record.id 
       AND fle2.user_id = current_user_id 
       AND fle2.entry_status = 'pending' 
     LIMIT 1)
  INTO lottery_entry_count, has_user_lottery_entry, user_lottery_entry_id
  FROM fanmark_lottery_entries fle
  WHERE fle.fanmark_id = fanmark_record.id
    AND fle.entry_status = 'pending';

  SELECT fl.status,
         fl.license_end,
         fl.grace_expires_at,
         CASE
           WHEN fl.status = 'grace' THEN COALESCE(fl.grace_expires_at, fl.license_end)
           ELSE fl.license_end
         END AS blocking_until
  INTO blocking_license
  FROM public.fanmark_licenses fl
  WHERE fl.fanmark_id = fanmark_record.id
    AND (
      (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
      OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
    )
  ORDER BY blocking_until ASC NULLS LAST
  LIMIT 1;

  is_available := blocking_license IS NULL;

  IF NOT is_available THEN
    blocking_status := blocking_license.status;
    available_at := CASE
      WHEN blocking_license.status = 'grace' THEN COALESCE(blocking_license.blocking_until, blocking_license.license_end)
      ELSE NULL
    END;
    blocking_reason := CASE
      WHEN blocking_license.status = 'grace' THEN 'grace_period'
      ELSE 'taken'
    END;
  END IF;

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN is_available THEN NULL ELSE blocking_reason END,
    'available_at', available_at,
    'blocking_status', blocking_status,
    'lottery_entry_count', lottery_entry_count,
    'has_user_lottery_entry', has_user_lottery_entry,
    'user_lottery_entry_id', user_lottery_entry_id
  );
END;
$function$;
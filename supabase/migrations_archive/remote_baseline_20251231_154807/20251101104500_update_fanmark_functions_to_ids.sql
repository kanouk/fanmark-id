-- Migrate fanmark lookup functions to use emoji IDs for lookup

DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, text);
DROP FUNCTION IF EXISTS public.get_fanmark_complete_data(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(uuid[]);

CREATE OR REPLACE FUNCTION public.get_fanmark_complete_data(
  fanmark_id_param uuid DEFAULT NULL::uuid,
  emoji_ids_param uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
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
    f.emoji_combination,
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

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(input_emoji_ids uuid[])
RETURNS TABLE(
  id uuid,
  emoji_combination text,
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
    f.emoji_combination,
    f.emoji_ids,
    COALESCE(bc.fanmark_name, f.emoji_combination) AS fanmark_name,
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

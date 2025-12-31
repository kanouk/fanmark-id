-- Normalize emoji handling to rely on normalized_emoji_ids arrays

CREATE OR REPLACE FUNCTION public.normalize_emoji_ids(input_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
AS $function$
DECLARE
  normalized_ids uuid[];
  id_count int;
  missing_count int;
  unresolved_count int;
BEGIN
  IF input_ids IS NULL OR array_length(input_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  id_count := array_length(input_ids, 1);

  WITH resolved AS (
    SELECT ids.ord, em.id AS master_id, em.codepoints
    FROM unnest(input_ids) WITH ORDINALITY AS ids(id, ord)
    LEFT JOIN public.emoji_master em ON em.id = ids.id
  ),
  normalized AS (
    SELECT
      r.ord,
      r.master_id,
      CASE
        WHEN r.codepoints IS NULL THEN NULL
        ELSE ARRAY(
          SELECT cp_value
          FROM unnest(r.codepoints) WITH ORDINALITY cp(cp_value, idx)
          WHERE cp_value NOT IN ('1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF')
          ORDER BY idx
        )
      END AS normalized_codepoints
    FROM resolved r
  ),
  lookup AS (
    SELECT
      n.ord,
      n.master_id,
      n.normalized_codepoints,
      em_norm.id AS normalized_id
    FROM normalized n
    LEFT JOIN public.emoji_master em_norm
      ON em_norm.codepoints = n.normalized_codepoints
  )
  SELECT
    COUNT(*) FILTER (WHERE master_id IS NULL),
    COUNT(*) FILTER (WHERE normalized_id IS NULL),
    array_agg(normalized_id ORDER BY ord)
  INTO missing_count, unresolved_count, normalized_ids
  FROM lookup;

  IF missing_count > 0 OR unresolved_count > 0 THEN
    RETURN NULL;
  END IF;

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> id_count THEN
    RETURN NULL;
  END IF;

  RETURN normalized_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public
AS $function$
DECLARE
  fanmark_record RECORD;
  tier_info RECORD;
  is_available boolean;
  emoji_count int;
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_length');
  END IF;

  emoji_count := array_length(input_emoji_ids, 1);
  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) <> emoji_count THEN
    RETURN json_build_object('available', false, 'reason', 'invalid_emoji_ids');
  END IF;

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji_ids = normalized_ids
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT tier_level, monthly_price_usd, initial_license_days
    INTO tier_info
    FROM public.fanmark_tiers
    WHERE emoji_count_min <= emoji_count
      AND emoji_count_max >= emoji_count
      AND is_active = true
    ORDER BY tier_level ASC
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'available', true,
        'tier_level', tier_info.tier_level,
        'price', tier_info.monthly_price_usd,
        'license_days', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

  is_available := public.check_fanmark_availability_secure(fanmark_record.id);

  RETURN json_build_object(
    'available', is_available,
    'fanmark_id', fanmark_record.id,
    'reason', CASE WHEN NOT is_available THEN 'taken' ELSE null END
  );
END;
$function$;

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
SET search_path TO public
AS $function$
DECLARE
  normalized_ids uuid[];
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := public.normalize_emoji_ids(input_emoji_ids);

  IF normalized_ids IS NULL OR array_length(normalized_ids, 1) = 0 THEN
    RETURN;
  END IF;

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
  WHERE f.normalized_emoji_ids = normalized_ids
    AND f.status = 'active';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fanmark_by_emoji(uuid[]) TO authenticated;

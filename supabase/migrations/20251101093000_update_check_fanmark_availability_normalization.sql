-- Update fanmark availability normalization to avoid regex escape issues

CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
DECLARE
  emoji_sequence text;
  normalized_input text;
  fanmark_record RECORD;
  tier_info RECORD;
  is_available boolean;
  emoji_count int;
  missing_count int;
BEGIN
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

  SELECT id
  INTO fanmark_record
  FROM public.fanmarks
  WHERE normalized_emoji = normalized_input
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

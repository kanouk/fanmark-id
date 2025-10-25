-- Rework fanmark tier definitions and introduce tier classification helper
-- Tier mapping:
--   Tier 1 -> display "C" (4+ emojis, excluding consecutive sequences)
--   Tier 2 -> display "B" (3 emojis)
--   Tier 3 -> display "A" (2 emojis or any consecutive sequence 2-5)
--   Tier 4 -> display "S" (single emoji)

-- Allow null initial license days for perpetual tiers
ALTER TABLE public.fanmark_tiers
  ALTER COLUMN initial_license_days DROP NOT NULL;

-- Add human readable display name
ALTER TABLE public.fanmark_tiers
  ADD COLUMN IF NOT EXISTS display_name text;

-- Ensure license records can represent perpetual usage
ALTER TABLE public.fanmark_licenses
  ALTER COLUMN license_end DROP NOT NULL;

-- Update existing tiers to new configuration
UPDATE public.fanmark_tiers
SET
  display_name = CASE tier_level
    WHEN 1 THEN 'C'
    WHEN 2 THEN 'B'
    WHEN 3 THEN 'A'
    ELSE display_name
  END,
  emoji_count_min = CASE tier_level
    WHEN 1 THEN 4
    WHEN 2 THEN 3
    WHEN 3 THEN 2
    ELSE emoji_count_min
  END,
  emoji_count_max = CASE tier_level
    WHEN 1 THEN 5
    WHEN 2 THEN 3
    WHEN 3 THEN 5
    ELSE emoji_count_max
  END,
  initial_license_days = CASE tier_level
    WHEN 1 THEN NULL
    WHEN 2 THEN 30
    WHEN 3 THEN 14
    ELSE initial_license_days
  END,
  description = CASE tier_level
    WHEN 1 THEN 'Four or more emojis (non-consecutive sequences)'
    WHEN 2 THEN 'Three emoji combinations'
    WHEN 3 THEN 'Two emojis or consecutive sequences (2-5 emojis)'
    ELSE description
  END,
  updated_at = now()
WHERE tier_level IN (1, 2, 3);

-- Insert or update Tier 4 definition (single emoji -> "S")
INSERT INTO public.fanmark_tiers (
  id,
  tier_level,
  display_name,
  emoji_count_min,
  emoji_count_max,
  initial_license_days,
  monthly_price_usd,
  is_active,
  description,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  4,
  'S',
  1,
  1,
  7,
  monthly_price_usd,
  is_active,
  'Single emoji fanmarks',
  now(),
  now()
FROM public.fanmark_tiers
WHERE tier_level = 3
ON CONFLICT (tier_level)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  emoji_count_min = EXCLUDED.emoji_count_min,
  emoji_count_max = EXCLUDED.emoji_count_max,
  initial_license_days = EXCLUDED.initial_license_days,
  monthly_price_usd = EXCLUDED.monthly_price_usd,
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description,
  updated_at = now();

-- Make display name mandatory going forward
ALTER TABLE public.fanmark_tiers
  ALTER COLUMN display_name SET NOT NULL;

-- Clone Tier 3 extension prices to Tier 4 so existing pricing continues to work
INSERT INTO public.fanmark_tier_extension_prices (
  id,
  tier_level,
  months,
  price_yen,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  4,
  months,
  price_yen,
  is_active,
  now(),
  now()
FROM public.fanmark_tier_extension_prices
WHERE tier_level = 3
ON CONFLICT (tier_level, months) DO NOTHING;

-- Helper function to classify tier based on emoji id array
CREATE OR REPLACE FUNCTION public.classify_fanmark_tier(input_emoji_ids uuid[])
RETURNS TABLE(
  tier_level integer,
  display_name text,
  initial_license_days integer,
  monthly_price_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
DECLARE
  normalized_ids uuid[];
  emoji_count integer;
  unique_count integer;
  candidate_tier integer;
  tier_record RECORD;
BEGIN
  IF input_emoji_ids IS NULL OR array_length(input_emoji_ids, 1) = 0 THEN
    RETURN;
  END IF;

  normalized_ids := input_emoji_ids;
  emoji_count := array_length(normalized_ids, 1);

  -- Reject counts outside supported range (1-5)
  IF emoji_count < 1 OR emoji_count > 5 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT id) INTO unique_count
  FROM unnest(normalized_ids) AS t(id);

  IF emoji_count = 1 THEN
    candidate_tier := 4; -- Tier 4 (S)
  ELSIF unique_count = 1 AND emoji_count BETWEEN 2 AND 5 THEN
    candidate_tier := 3; -- Tier 3 (A) consecutive sequence overrides count rules
  ELSIF emoji_count >= 4 THEN
    candidate_tier := 1; -- Tier 1 (C)
  ELSIF emoji_count = 3 THEN
    candidate_tier := 2; -- Tier 2 (B)
  ELSIF emoji_count = 2 THEN
    candidate_tier := 3; -- Tier 3 (A)
  ELSE
    candidate_tier := 1;
  END IF;

  SELECT
    ft.tier_level,
    ft.display_name,
    ft.initial_license_days,
    ft.monthly_price_usd
  INTO tier_record
  FROM public.fanmark_tiers AS ft
  WHERE ft.tier_level = candidate_tier
    AND ft.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    tier_record.tier_level,
    tier_record.display_name,
    tier_record.initial_license_days,
    tier_record.monthly_price_usd;
END;
$function$;

-- Ensure secure availability helper respects perpetual licenses
CREATE OR REPLACE FUNCTION public.check_fanmark_availability_secure(fanmark_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.fanmark_id = fanmark_uuid
      AND (
        (fl.status = 'active' AND (fl.license_end IS NULL OR fl.license_end > now()))
        OR (fl.status = 'grace' AND COALESCE(fl.grace_expires_at, fl.license_end) > now())
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Update availability function to rely on new classification helper
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(input_emoji_ids uuid[])
RETURNS json AS $$
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
        'license_days', tier_info.initial_license_days
      );
    ELSE
      RETURN json_build_object('available', false, 'reason', 'invalid_length');
    END IF;
  END IF;

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
    'blocking_status', blocking_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

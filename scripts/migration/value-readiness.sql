-- Read-only conversion preflight. Outputs aggregate counts only; keep private.
-- This checks the identified exact numeric and array columns, not every
-- business invariant, JSON numeric value, or timestamp in the database.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'unsafe_javascript_integers', (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.column_name) FROM (
      SELECT 'fanmark_discoveries.search_count' AS column_name,
        count(*) FILTER (WHERE search_count < -9007199254740991 OR search_count > 9007199254740991) AS affected
      FROM public.fanmark_discoveries
      UNION ALL
      SELECT 'fanmark_discoveries.favorite_count',
        count(*) FILTER (WHERE favorite_count < -9007199254740991 OR favorite_count > 9007199254740991)
      FROM public.fanmark_discoveries
      UNION ALL
      SELECT 'fanmark_events.id',
        count(*) FILTER (WHERE id < -9007199254740991 OR id > 9007199254740991)
      FROM public.fanmark_events
    ) x
  ),
  'unsafe_exact_usd_cents', (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.column_name) FROM (
      SELECT 'fanmark_availability_rules.price_usd' AS column_name,
        count(*) FILTER (WHERE price_usd::text IN ('NaN', 'Infinity', '-Infinity')
          OR price_usd * 100 <> trunc(price_usd * 100)
          OR abs(price_usd * 100) > 9007199254740991) AS affected
      FROM public.fanmark_availability_rules
      UNION ALL
      SELECT 'fanmark_tiers.monthly_price_usd',
        count(*) FILTER (WHERE monthly_price_usd::text IN ('NaN', 'Infinity', '-Infinity')
          OR monthly_price_usd * 100 <> trunc(monthly_price_usd * 100)
          OR abs(monthly_price_usd * 100) > 9007199254740991)
      FROM public.fanmark_tiers
    ) x
  ),
  'unsupported_array_dimensions', (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.column_name) FROM (
      SELECT 'emoji_master.keywords' AS column_name,
        count(*) FILTER (WHERE cardinality(keywords) > 0 AND
          (array_ndims(keywords) <> 1 OR array_lower(keywords, 1) <> 1)) AS affected
      FROM public.emoji_master
      UNION ALL
      SELECT 'emoji_master.codepoints', count(*) FILTER (WHERE cardinality(codepoints) > 0 AND
        (array_ndims(codepoints) <> 1 OR array_lower(codepoints, 1) <> 1)) FROM public.emoji_master
      UNION ALL
      SELECT 'extension_coupons.allowed_tier_levels', count(*) FILTER (WHERE cardinality(allowed_tier_levels) > 0 AND
        (array_ndims(allowed_tier_levels) <> 1 OR array_lower(allowed_tier_levels, 1) <> 1)) FROM public.extension_coupons
      UNION ALL
      SELECT 'fanmark_discoveries.emoji_ids', count(*) FILTER (WHERE cardinality(emoji_ids) > 0 AND
        (array_ndims(emoji_ids) <> 1 OR array_lower(emoji_ids, 1) <> 1)) FROM public.fanmark_discoveries
      UNION ALL
      SELECT 'fanmark_discoveries.normalized_emoji_ids', count(*) FILTER (WHERE cardinality(normalized_emoji_ids) > 0 AND
        (array_ndims(normalized_emoji_ids) <> 1 OR array_lower(normalized_emoji_ids, 1) <> 1)) FROM public.fanmark_discoveries
      UNION ALL
      SELECT 'fanmark_events.normalized_emoji_ids', count(*) FILTER (WHERE cardinality(normalized_emoji_ids) > 0 AND
        (array_ndims(normalized_emoji_ids) <> 1 OR array_lower(normalized_emoji_ids, 1) <> 1)) FROM public.fanmark_events
      UNION ALL
      SELECT 'fanmark_favorites.normalized_emoji_ids', count(*) FILTER (WHERE cardinality(normalized_emoji_ids) > 0 AND
        (array_ndims(normalized_emoji_ids) <> 1 OR array_lower(normalized_emoji_ids, 1) <> 1)) FROM public.fanmark_favorites
      UNION ALL
      SELECT 'fanmarks.emoji_ids', count(*) FILTER (WHERE cardinality(emoji_ids) > 0 AND
        (array_ndims(emoji_ids) <> 1 OR array_lower(emoji_ids, 1) <> 1)) FROM public.fanmarks
      UNION ALL
      SELECT 'fanmarks.normalized_emoji_ids', count(*) FILTER (WHERE cardinality(normalized_emoji_ids) > 0 AND
        (array_ndims(normalized_emoji_ids) <> 1 OR array_lower(normalized_emoji_ids, 1) <> 1)) FROM public.fanmarks
    ) x
  ),
  'recent_license_timestamp', (
    SELECT jsonb_build_object(
      'nonfinite', count(*) FILTER (WHERE NOT isfinite(created_at)),
      'outside_four_digit_ad_year', count(*) FILTER (WHERE isfinite(created_at) AND
        (extract(year FROM created_at AT TIME ZONE 'UTC') < 1 OR extract(year FROM created_at AT TIME ZONE 'UTC') > 9999)),
      'requires_microsecond_precision', count(*) FILTER (WHERE isfinite(created_at) AND
        created_at <> date_trunc('milliseconds', created_at))
    ) FROM public.fanmark_licenses
  ),
  'lottery_probability', (
    SELECT jsonb_build_object(
      'nonfinite', count(*) FILTER (WHERE lottery_probability::text IN ('NaN', 'Infinity', '-Infinity')),
      'negative', count(*) FILTER (WHERE lottery_probability < 0)
    ) FROM public.fanmark_lottery_entries
  )
);
COMMIT;

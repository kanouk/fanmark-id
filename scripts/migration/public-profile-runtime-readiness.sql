-- Catalog-only profile/ownership review. Keep raw output private.
-- No application/Auth rows are selected or changed.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'definition', pg_get_functiondef(p.oid)
    ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('get_public_emoji_profile', 'get_public_fanmark_profile',
        'get_fanmark_ownership_status', 'is_fanmark_licensed',
        'get_fanmark_by_emoji', 'get_fanmark_by_short_id')
  ),
  'profile_columns', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull
    ) ORDER BY a.attnum), '[]'::jsonb)
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'fanmark_profiles'
      AND a.attnum > 0 AND NOT a.attisdropped
  ),
  'profile_policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', p.polname, 'command', p.polcmd,
      'using', pg_get_expr(p.polqual, p.polrelid),
      'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
    ) ORDER BY p.polname), '[]'::jsonb)
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'fanmark_profiles'
  )
);
COMMIT;

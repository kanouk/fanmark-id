-- Catalog-only fingerprints for public search and its internal helpers.
-- This query does not invoke the functions or read user rows.
BEGIN READ ONLY;
SELECT jsonb_agg(jsonb_build_object(
  'name', p.proname,
  'args', pg_get_function_identity_arguments(p.oid),
  'result', pg_get_function_result(p.oid),
  'security_definer', p.prosecdef,
  'volatility', p.provolatile,
  'settings', p.proconfig,
  'definition_md5', md5(pg_get_functiondef(p.oid))
) ORDER BY p.proname)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'check_fanmark_availability', 'check_fanmark_availability_secure',
    'normalize_emoji_ids', 'classify_fanmark_tier'
  );
COMMIT;

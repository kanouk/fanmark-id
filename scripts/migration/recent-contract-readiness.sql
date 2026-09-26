-- Read-only metadata for the public recent-list contract; no user rows.
-- The function body is fingerprinted, not returned. Keep operational outputs private.
BEGIN READ ONLY;
SELECT
  pg_get_viewdef('public.recent_active_fanmarks'::regclass, true) AS view_definition,
  c.reloptions AS view_options,
  p.prosecdef AS function_security_definer,
  p.provolatile AS function_volatility,
  p.proconfig AS function_settings,
  pg_get_function_result(p.oid) AS function_result,
  md5(pg_get_functiondef(p.oid)) AS function_definition_fingerprint
FROM pg_class c
CROSS JOIN pg_proc p
WHERE c.oid = 'public.recent_active_fanmarks'::regclass
  AND p.oid = 'public.list_recent_fanmarks(integer)'::regprocedure;
COMMIT;

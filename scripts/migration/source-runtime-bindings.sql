-- Catalog-only evidence. No application/Auth rows are selected or changed.
-- Function bodies and policies may contain deployment constants: keep output private.
-- Unlike schema-readiness.sql, include bindings on non-public tables when the
-- trigger function is public (in particular auth.users -> handle_new_user).
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'coverage', jsonb_build_object(
    'public_functions', true,
    'public_table_triggers', true,
    'all_schema_public_function_triggers', true,
    'public_function_event_triggers', true
  ),
  'functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'language', l.lanname,
      'security_definer', p.prosecdef,
      'volatility', p.provolatile,
      'definition', pg_get_functiondef(p.oid)
    ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  ),
  'trigger_bindings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_schema', n.nspname,
      'table_name', c.relname,
      'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid, true),
      'function_schema', pn.nspname,
      'function_name', p.proname,
      'function_identity_arguments', pg_get_function_identity_arguments(p.oid),
      'enabled', t.tgenabled
    ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE NOT t.tgisinternal AND (n.nspname = 'public' OR pn.nspname = 'public')
  ),
  'event_trigger_bindings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', t.evtname, 'event', t.evtevent, 'enabled', t.evtenabled,
      'function_schema', n.nspname, 'function_name', p.proname,
      'function_identity_arguments', pg_get_function_identity_arguments(p.oid)
    ) ORDER BY t.evtname), '[]'::jsonb)
    FROM pg_event_trigger t
    JOIN pg_proc p ON p.oid = t.evtfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  )
);
COMMIT;

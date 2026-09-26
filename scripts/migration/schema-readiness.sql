-- Read-only source schema evidence for D1 conversion; never reads table rows.
-- Defaults, function bodies, view definitions, and policy expressions can
-- contain deployment-specific constants: keep the result private and review
-- before extracting public documentation.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'database_locale', (
    SELECT jsonb_build_object('collate', d.datcollate, 'ctype', d.datctype)
    FROM pg_database d
    WHERE d.datname = current_database()
  ),
  'columns', (
    SELECT jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'column_name', a.attname,
      'ordinal', a.attnum,
      'postgres_type', format_type(a.atttypid, a.atttypmod),
      'type_schema', tn.nspname,
      'type_name', t.typname,
      'type_kind', t.typtype,
      'not_null', a.attnotnull,
      'default_expression', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity,
      'generated', a.attgenerated,
      'collation', CASE WHEN a.attcollation = 0 THEN NULL ELSE a.attcollation::regcollation::text END
    ) ORDER BY c.relname, a.attnum)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  'constraints', (
    SELECT jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'name', k.conname,
      'kind', k.contype,
      'definition', pg_get_constraintdef(k.oid, true),
      'validated', k.convalidated,
      'deferrable', k.condeferrable,
      'initially_deferred', k.condeferred
    ) ORDER BY c.relname, k.conname)
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  'indexes', (
    SELECT jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'name', ic.relname,
      'definition', pg_get_indexdef(i.indexrelid),
      'valid', i.indisvalid,
      'unique', i.indisunique,
      'primary', i.indisprimary
    ) ORDER BY c.relname, ic.relname)
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  'enums', (
    SELECT jsonb_agg(jsonb_build_object(
      'type_name', t.typname,
      'value', e.enumlabel,
      'sort_order', e.enumsortorder
    ) ORDER BY t.typname, e.enumsortorder)
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
  ),
  'triggers', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', c.relname,
      'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid, true),
      'function_name', p.proname,
      'enabled', t.tgenabled
    ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  ),
  'rls_policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table_name', tablename,
      'name', policyname,
      'permissive', permissive,
      'roles', roles,
      'command', cmd,
      'using', qual,
      'with_check', with_check
    ) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname = 'public'
  ),
  'views', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', CASE c.relkind WHEN 'm' THEN 'materialized' ELSE 'view' END,
      'definition', pg_get_viewdef(c.oid, true)
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
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
  )
);
COMMIT;

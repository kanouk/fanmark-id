-- Catalog only: no application or Auth rows are selected or changed.
-- Keep raw policy expressions and function bodies in private local evidence.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'coverage', jsonb_build_object(
    'public_tables', true, 'public_policies', true,
    'public_function_acl', true, 'api_role_effective_privileges', true,
    'function_definitions_and_types', true, 'relation_options', true
  ),
  'roles', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', rolname, 'superuser', rolsuper, 'inherit', rolinherit, 'bypass_rls', rolbypassrls
    ) ORDER BY rolname)
    FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ),
  'tables', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'owner', pg_get_userbyid(c.relowner), 'kind', c.relkind,
      'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
      'options', COALESCE(to_jsonb(c.reloptions), '[]'::jsonb),
      'effective_privileges', (
        SELECT jsonb_agg(jsonb_build_object(
          'role', r.rolname, 'select', has_table_privilege(r.oid, c.oid, 'SELECT'),
          'insert', has_table_privilege(r.oid, c.oid, 'INSERT'),
          'update', has_table_privilege(r.oid, c.oid, 'UPDATE'),
          'delete', has_table_privilege(r.oid, c.oid, 'DELETE')
        ) ORDER BY r.rolname)
        FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      )
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  ),
  'policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'permissive', permissive,
      'roles', roles, 'command', cmd, 'using', qual, 'check', with_check
    ) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies WHERE schemaname = 'public'
  ),
  'functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', p.proname, 'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'kind', p.prokind, 'result', pg_get_function_result(p.oid),
      'definition', pg_get_functiondef(p.oid),
      'security_definer', p.prosecdef, 'owner', pg_get_userbyid(p.proowner),
      'acl', (
        SELECT jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'privilege', a.privilege_type, 'grantable', a.is_grantable
        ) ORDER BY a.grantor, a.grantee, a.privilege_type)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      ),
      'effective_execute', (
        SELECT jsonb_agg(jsonb_build_object(
          'role', r.rolname, 'execute', has_function_privilege(r.oid, p.oid, 'EXECUTE')
        ) ORDER BY r.rolname)
        FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      )
    ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  )
);
COMMIT;

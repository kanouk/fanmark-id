-- SENSITIVE: output contains credentials, MFA secrets and personal data.
-- Run only through a private encrypted capture; never print or commit output.
-- This preliminary copy does not freeze Auth writers or establish cutover readiness.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object(
  'version', 1,
  'observedAt', transaction_timestamp(),
  'users', (SELECT coalesce(jsonb_agg(t ORDER BY t.id), '[]'::jsonb) FROM (
    SELECT id, email, coalesce(encrypted_password, '') encrypted_password,
      email_confirmed_at, banned_until, is_anonymous, is_sso_user,
      is_super_admin, deleted_at, created_at, updated_at
    FROM auth.users
  ) t),
  'identities', (SELECT coalesce(jsonb_agg(t ORDER BY t.id), '[]'::jsonb) FROM (
    SELECT id, user_id, provider, provider_id, identity_data->>'sub' subject,
      created_at, updated_at FROM auth.identities
  ) t),
  'factors', (SELECT coalesce(jsonb_agg(t ORDER BY t.id), '[]'::jsonb) FROM (
    SELECT id, user_id, factor_type::text, status::text, secret FROM auth.mfa_factors
  ) t),
  'roles', (SELECT coalesce(jsonb_agg(t ORDER BY t.user_id), '[]'::jsonb) FROM (
    SELECT user_id, role::text FROM public.user_roles
  ) t),
  'settings', (SELECT coalesce(jsonb_agg(t ORDER BY t.user_id), '[]'::jsonb) FROM (
    SELECT user_id, display_name, plan_type::text FROM public.user_settings
  ) t)
) AS snapshot;
COMMIT;

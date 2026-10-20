-- Literal-only expressions from the reviewed handle_new_user (09d55e8d)
-- and generate_safe_display_name (1f7d9d41) definitions. No stored application
-- function, application/Auth row, trigger or provider is read or invoked.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH cases(label, user_id, user_meta, app_meta) AS (VALUES
  ('credential_en', '11111111-1111-4111-8111-111111111111'::uuid, '{"preferred_language":"en"}'::jsonb, '{"provider":"email"}'::jsonb),
  ('credential_ja', '22222222-2222-4222-8222-222222222222'::uuid, '{"preferred_language":"ja"}'::jsonb, '{"provider":"email"}'::jsonb),
  ('credential_ko', '33333333-3333-4333-8333-333333333333'::uuid, '{"preferred_language":"ko"}'::jsonb, '{"provider":"email"}'::jsonb),
  ('credential_id', '44444444-4444-4444-8444-444444444444'::uuid, '{"preferred_language":"id"}'::jsonb, '{"provider":"email"}'::jsonb),
  ('oauth_google', '55555555-5555-4555-8555-555555555555'::uuid, '{"preferred_language":"en"}'::jsonb, '{"provider":"google"}'::jsonb),
  ('custom_metadata', '66666666-6666-4666-8666-666666666666'::uuid, '{"username":"chosen-admin","display_name":"chosen-admin","plan_type":"admin","preferred_language":"ko","invited_by_code":"UNRESERVED","requires_password_setup":true}'::jsonb, '{"provider":"email"}'::jsonb)
), derived AS (
  SELECT *, COALESCE(user_meta->>'username', 'user_' || substring(user_id::text,1,8)) AS username,
    ((COALESCE(app_meta->>'provider','') <> '' AND app_meta->>'provider' <> 'email')
      OR user_meta ? 'iss' OR user_meta ? 'provider' OR user_meta ? 'provider_id') AS is_oauth
  FROM cases
), helpers(label, email, user_id) AS (VALUES
  ('email_prefix', 'private-prefix@example.invalid'::text, '77777777-7777-4777-8777-777777777777'::uuid),
  ('empty_prefix', '@example.invalid'::text, '77777777-7777-4777-8777-777777777777'::uuid),
  ('no_at', 'no-at'::text, '77777777-7777-4777-8777-777777777777'::uuid),
  ('null_email', NULL::text, '77777777-7777-4777-8777-777777777777'::uuid)
)
SELECT jsonb_build_object(
  'observed_at', clock_timestamp(),
  'provisioning', (SELECT jsonb_agg(jsonb_build_object(
    'label', label, 'user_id', user_id, 'username', username,
    'display_name', COALESCE(user_meta->>'display_name', username),
    'plan_type', COALESCE((user_meta->>'plan_type')::public.user_plan, 'free'),
    'preferred_language', COALESCE((user_meta->>'preferred_language')::public.user_language, 'ja'),
    'invited_by_code', user_meta->>'invited_by_code',
    'requires_password_setup', CASE WHEN is_oauth THEN true ELSE COALESCE((user_meta->>'requires_password_setup')::boolean, false) END
  ) ORDER BY label) FROM derived),
  'display_name_helper', (SELECT jsonb_agg(jsonb_build_object('label', label,
    'expected', COALESCE(CASE WHEN email IS NOT NULL AND email LIKE '%@%' THEN split_part(email,'@',1)
      ELSE 'user_' || substring(user_id::text,1,8) END, 'user_' || substring(user_id::text,1,8))
  ) ORDER BY label) FROM helpers)
) AS oracle;
COMMIT;

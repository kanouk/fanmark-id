-- Run only against the intended Supabase project using an authorized SQL role.
-- No passwords, hashes, factor secrets, emails, or user IDs leave the database.
-- Aggregate results are private operational evidence; do not commit the output.
BEGIN READ ONLY;
SELECT 'password_formats' AS category,
       coalesce(jsonb_agg(s), '[]'::jsonb)::text AS summary
FROM (
  SELECT CASE
    WHEN encrypted_password IS NULL OR encrypted_password = '' THEN 'none'
    WHEN encrypted_password ~ '^\$2[aby]\$[0-9]{2}\$'
      THEN left(encrypted_password, 7)
    ELSE 'other'
  END AS format, count(*) AS count
  FROM auth.users
  GROUP BY 1
) s
UNION ALL
SELECT 'identity_providers', coalesce(jsonb_agg(s), '[]'::jsonb)::text
FROM (
  SELECT provider, count(*) AS count FROM auth.identities GROUP BY provider
) s
UNION ALL
SELECT 'mfa_factors', coalesce(jsonb_agg(s), '[]'::jsonb)::text
FROM (
  SELECT factor_type::text, status::text, count(*) AS count
  FROM auth.mfa_factors GROUP BY 1, 2
) s;
COMMIT;

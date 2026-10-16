-- Literal-only decision oracle for is_super_admin's non-STRICT SELECT INTO
-- and IF NOT branch. No application/Auth relation or stored function is read.
-- CASE WHEN follows the same true-only branch rule as PL/pgSQL IF.
BEGIN READ ONLY;

WITH cases(case_name, plan_type, has_recent_session) AS (
  VALUES
    ('admin_recent', 'admin'::text, true),
    ('admin_stale', 'admin'::text, false),
    ('non_admin_recent', 'free'::text, true),
    ('missing_plan_recent', NULL::text, true),
    ('non_admin_stale', 'free'::text, false)
), plan_lookup AS (
  SELECT case_name, plan_type, has_recent_session,
    (SELECT true WHERE plan_type = 'admin' LIMIT 1) AS selected_admin_flag
  FROM cases
)
SELECT jsonb_build_object(
  'observedAt', clock_timestamp(),
  'cases', jsonb_agg(jsonb_build_object(
    'caseName', case_name,
    'selectedAdminFlag', selected_admin_flag,
    'sourceReturnsBeforeSessionCheck', CASE WHEN NOT selected_admin_flag THEN true ELSE false END,
    'sourceDecisionWithRecentSession', CASE WHEN NOT selected_admin_flag THEN false ELSE has_recent_session END,
    'explicitPlanDecision', (plan_type = 'admin') IS TRUE AND has_recent_session
  ) ORDER BY case_name)
) AS oracle
FROM plan_lookup;

COMMIT;

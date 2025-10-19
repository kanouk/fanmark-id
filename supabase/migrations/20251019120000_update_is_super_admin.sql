-- Relax aal check to avoid invalid enum errors and accept sessions with NULL aal
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  has_recent_session boolean := false;
  is_admin_user boolean := false;
BEGIN
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT true
  INTO is_admin_user
  FROM public.user_settings us
  WHERE us.user_id = current_user_id
    AND us.plan_type = 'admin'
  LIMIT 1;

  IF NOT is_admin_user THEN
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM auth.sessions s
    WHERE s.user_id = current_user_id
      AND s.created_at > now() - interval '4 hours'
  )
  INTO has_recent_session;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    current_user_id,
    'ADMIN_CHECK',
    'system',
    jsonb_build_object(
      'timestamp', now(),
      'session_valid', has_recent_session,
      'admin_check_result', has_recent_session
    )
  );

  RETURN has_recent_session;
END;
$$;

COMMENT ON FUNCTION public.is_super_admin IS
'Additional guard for critical operations. Requires admin plan and a recent valid session.';

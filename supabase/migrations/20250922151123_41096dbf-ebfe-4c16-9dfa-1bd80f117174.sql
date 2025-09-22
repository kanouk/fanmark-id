-- CRITICAL SECURITY FIX: Enhance waitlist security and admin authentication
-- Address multiple security concerns with waitlist access and admin verification

-- 1. Create enhanced admin authentication with additional security checks
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  user_profile RECORD;
  session_valid BOOLEAN := false;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Get user profile with role information
  SELECT * INTO user_profile 
  FROM public.profiles 
  WHERE user_id = auth.uid() 
  AND role = 'admin';

  -- If no admin profile found, return false
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Additional security check: verify session is recent (within last 4 hours)
  -- This prevents stale admin sessions from being used
  SELECT EXISTS(
    SELECT 1 FROM auth.sessions 
    WHERE user_id = auth.uid() 
    AND created_at > NOW() - INTERVAL '4 hours'
    AND NOT (aal IS NULL OR aal = '')
  ) INTO session_valid;

  -- Log admin access attempt for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    'ADMIN_CHECK',
    'system',
    jsonb_build_object(
      'timestamp', NOW(),
      'ip_address', COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'),
      'user_agent', COALESCE(current_setting('request.headers', true)::json->>'user-agent', 'unknown'),
      'session_valid', session_valid,
      'admin_check_result', session_valid
    )
  );

  RETURN session_valid;
END;
$$;

-- 2. Create function for secure waitlist access with comprehensive logging
CREATE OR REPLACE FUNCTION public.get_waitlist_secure(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  email_hash TEXT,  -- Return hash instead of actual email
  referral_source TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Verify admin access with enhanced security
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      metadata
    ) VALUES (
      auth.uid(),
      'UNAUTHORIZED_WAITLIST_ACCESS',
      'waitlist',
      jsonb_build_object(
        'timestamp', NOW(),
        'ip_address', COALESCE(current_setting('request.headers', true)::json->>'x-forwarded-for', 'unknown'),
        'attempted_action', 'get_waitlist_secure',
        'security_level', 'HIGH_RISK'
      )
    );
    
    RAISE EXCEPTION 'Unauthorized access to waitlist data';
  END IF;

  -- Log authorized admin access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    metadata
  ) VALUES (
    auth.uid(),
    'AUTHORIZED_WAITLIST_ACCESS',
    'waitlist',
    jsonb_build_object(
      'timestamp', NOW(),
      'record_count', (SELECT COUNT(*) FROM public.waitlist),
      'limit', p_limit,
      'offset', p_offset,
      'security_level', 'ADMIN_VERIFIED'
    )
  );

  -- Return waitlist data with email hashed for additional security
  RETURN QUERY
  SELECT 
    w.id,
    encode(digest(w.email, 'sha256'), 'hex') as email_hash,  -- Hash email for privacy
    w.referral_source,
    w.status,
    w.created_at
  FROM public.waitlist w
  ORDER BY w.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 3. Create function to get actual email (for legitimate admin use only)
CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  email_result TEXT;
BEGIN
  -- Strict admin verification for email access
  IF NOT public.is_super_admin() THEN
    -- Log unauthorized email access attempt
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      auth.uid(),
      'UNAUTHORIZED_EMAIL_ACCESS',
      'waitlist',
      waitlist_id::text,
      jsonb_build_object(
        'timestamp', NOW(),
        'security_level', 'CRITICAL_RISK',
        'attempted_resource', 'email_address'
      )
    );
    
    RAISE EXCEPTION 'Unauthorized access to email data';
  END IF;

  -- Get email with logging
  SELECT email INTO email_result 
  FROM public.waitlist 
  WHERE id = waitlist_id;

  -- Log email access
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'EMAIL_ACCESS',
    'waitlist',
    waitlist_id::text,
    jsonb_build_object(
      'timestamp', NOW(),
      'security_level', 'ADMIN_VERIFIED',
      'purpose', 'email_retrieval'
    )
  );

  RETURN email_result;
END;
$$;

-- 4. Update waitlist policies with enhanced security
DROP POLICY IF EXISTS "Only admins can view waitlist data" ON public.waitlist;

-- New restrictive policy - no direct table access
CREATE POLICY "Waitlist access only through secure functions" 
ON public.waitlist 
FOR SELECT 
USING (false);  -- Block all direct access

-- Keep insert policy for user registration
-- The existing "Anyone can join waitlist" policy is fine for INSERT

-- 5. Grant execute permissions only to authenticated users
GRANT EXECUTE ON FUNCTION public.get_waitlist_secure(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_waitlist_email_by_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- 6. Create notification function for security alerts
CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Log critical security events
  IF NEW.action = 'UNAUTHORIZED_WAITLIST_ACCESS' OR NEW.action = 'UNAUTHORIZED_EMAIL_ACCESS' THEN
    -- In a real implementation, this could send alerts to security team
    RAISE NOTICE 'SECURITY ALERT: Unauthorized access attempt by user % at %', NEW.user_id, NEW.created_at;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 7. Create trigger for security monitoring
DROP TRIGGER IF EXISTS security_alert_trigger ON public.audit_logs;
CREATE TRIGGER security_alert_trigger
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_security_breach();
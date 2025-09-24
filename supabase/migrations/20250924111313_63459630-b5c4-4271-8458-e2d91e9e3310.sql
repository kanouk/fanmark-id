-- Fix function search path issues by explicitly setting search_path for all functions
CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
RETURNS TABLE(is_valid boolean, special_perks jsonb, remaining_uses integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, '{}'::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
RETURNS TABLE(success boolean, special_perks jsonb, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '{}'::jsonb, 'Invalid or expired invitation code'::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_waitlist_secure(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, email_hash text, referral_source text, status text, created_at timestamp with time zone)
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

CREATE OR REPLACE FUNCTION public.get_waitlist_email_by_id(waitlist_id uuid)
RETURNS text
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
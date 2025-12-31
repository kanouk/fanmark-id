-- Fix function search path security warnings
-- Add proper search_path settings to all functions for security

-- Fix notify_security_breach function
CREATE OR REPLACE FUNCTION public.notify_security_breach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
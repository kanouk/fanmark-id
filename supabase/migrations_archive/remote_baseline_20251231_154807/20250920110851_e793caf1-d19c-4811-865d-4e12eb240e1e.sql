-- Add secure admin-only SELECT policy for waitlist table
-- This ensures that only authenticated users with admin role can view waitlist data
-- preventing email harvesting while allowing legitimate admin access

-- First, create a security definer function to check admin role safely
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if the current user has admin role in profiles table
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Add admin-only SELECT policy for waitlist
CREATE POLICY "Only admins can view waitlist data"
ON public.waitlist
FOR SELECT
USING (public.is_admin());

-- Add audit logging for waitlist access (security monitoring)
CREATE OR REPLACE FUNCTION public.log_waitlist_access()
RETURNS TRIGGER AS $$
BEGIN
  -- Log all SELECT operations on waitlist for security monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'waitlist',
    NEW.id::text,
    json_build_object(
      'table', 'waitlist',
      'access_time', now(),
      'user_role', (SELECT role FROM public.profiles WHERE user_id = auth.uid())
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for audit logging (only fires on SELECT via function)
-- Note: We'll track this in application code since triggers don't fire on SELECT
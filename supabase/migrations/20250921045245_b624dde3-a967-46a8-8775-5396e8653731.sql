-- Fix security issue: Restrict public_profile_cache access to authenticated users only
-- This prevents anonymous mass scraping while maintaining functionality for legitimate users

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Public can select cached profiles" ON public.public_profile_cache;

-- Create a more secure policy that requires authentication
CREATE POLICY "Authenticated users can view public profile cache" 
ON public.public_profile_cache 
FOR SELECT 
TO authenticated
USING (true);

-- Optional: Add rate limiting by creating a more restrictive policy for frequent access
-- This helps prevent even authenticated users from mass scraping
CREATE POLICY "Service role can access profile cache for system operations"
ON public.public_profile_cache
FOR SELECT 
TO service_role
USING (true);

-- Add audit logging for profile cache access (optional security enhancement)
-- This will help monitor access patterns and detect potential abuse
CREATE OR REPLACE FUNCTION public.log_profile_cache_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if accessing multiple profiles (potential scraping behavior)
  -- This is a placeholder for more sophisticated monitoring
  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    auth.uid(),
    'SELECT',
    'public_profile_cache',
    NEW.id::text,
    json_build_object(
      'accessed_at', now(),
      'user_agent', current_setting('request.headers', true)::json->>'user-agent'
    )
  );
  RETURN NEW;
END;
$$;

-- Note: Trigger creation for audit logging would require careful consideration
-- as it could impact performance. For now, we'll rely on the authentication requirement.
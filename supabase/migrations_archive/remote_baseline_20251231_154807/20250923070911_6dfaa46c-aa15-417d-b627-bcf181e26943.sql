-- Fix fanmark_licenses table security vulnerability
-- Remove public access to license data while preserving legitimate functionality

-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS "read_active_or_grace_licenses_public" ON public.fanmark_licenses;

-- Create a secure function to check if a fanmark is currently licensed (without exposing user data)
CREATE OR REPLACE FUNCTION public.is_fanmark_licensed(fanmark_license_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses 
    WHERE id = fanmark_license_id 
      AND status = 'active'
      AND license_end > now()
  );
$function$;

-- Create a secure function to get minimal fanmark ownership info for search (without exposing user details)
CREATE OR REPLACE FUNCTION public.get_fanmark_ownership_status(fanmark_license_id uuid)
RETURNS TABLE(is_taken boolean, has_active_license boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 
    CASE WHEN fl.id IS NOT NULL THEN true ELSE false END as is_taken,
    CASE WHEN fl.status = 'active' AND fl.license_end > now() THEN true ELSE false END as has_active_license
  FROM public.fanmark_licenses fl
  WHERE fl.id = fanmark_license_id
  LIMIT 1;
$function$;

-- The existing policies remain for legitimate access:
-- "Only admins can manage all licenses" - Admins can do everything
-- "Users can view their own licenses" - Users can see their own license data

-- Grant execute permissions on the new functions
GRANT EXECUTE ON FUNCTION public.is_fanmark_licensed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_fanmark_licensed(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fanmark_ownership_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fanmark_ownership_status(uuid) TO anon;
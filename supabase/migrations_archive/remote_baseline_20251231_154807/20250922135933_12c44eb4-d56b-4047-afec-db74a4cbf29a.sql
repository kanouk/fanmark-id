-- Fix security issue: Restrict license management to admins only
DROP POLICY IF EXISTS "System can manage licenses" ON public.fanmark_licenses;

-- Create a more secure policy that only allows admins to manage all licenses
CREATE POLICY "Only admins can manage all licenses" 
ON public.fanmark_licenses
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

-- Keep the existing policy for users to view their own licenses
-- (This policy already exists and is secure)
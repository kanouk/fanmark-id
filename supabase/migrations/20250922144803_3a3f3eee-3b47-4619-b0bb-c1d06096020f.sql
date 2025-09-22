-- Fix the remaining RLS policy issue for invitation_codes table
-- This table has RLS enabled but no policies, making it completely inaccessible

-- Add basic policies for invitation_codes table
-- Only admins should be able to manage invitation codes
CREATE POLICY "Only admins can manage invitation codes" 
ON public.invitation_codes 
FOR ALL 
USING (is_admin())
WITH CHECK (is_admin());

-- Allow authenticated users to validate codes (read-only for validation purposes)
CREATE POLICY "Users can validate invitation codes" 
ON public.invitation_codes 
FOR SELECT 
TO authenticated
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Note: The leaked password protection warning needs to be fixed in Supabase auth settings
-- This requires manual configuration in the Supabase dashboard
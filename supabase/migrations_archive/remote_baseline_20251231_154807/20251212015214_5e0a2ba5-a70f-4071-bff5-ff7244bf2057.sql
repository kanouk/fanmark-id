-- Restore the public access policy for fanmark_licenses
-- This is intentional design: fanmark ownership is public information (like domain WHOIS)
-- user_id is a UUID that cannot be linked to PII without access to user_settings (which is protected)

CREATE POLICY "Anyone can view active fanmark licenses for recent activity" 
ON public.fanmark_licenses
FOR SELECT
USING (status = 'active');
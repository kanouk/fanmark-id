-- Phase 1: Emergency fix for 🍔🍟 license
-- Update the active but expired license to grace status
UPDATE fanmark_licenses
SET 
  status = 'grace',
  updated_at = now()
WHERE id = 'b91277ae-a72c-4c8d-b14c-7d40be66522d'
  AND status = 'active'
  AND license_end < now();

-- Phase 3: Improve RLS policies to allow editing during grace period
-- Drop existing policies
DROP POLICY IF EXISTS "Users can manage configs for their own licenses" ON fanmark_basic_configs;
DROP POLICY IF EXISTS "Users can manage redirect configs for their own licenses" ON fanmark_redirect_configs;
DROP POLICY IF EXISTS "Users can manage messageboard configs for their own licenses" ON fanmark_messageboard_configs;

-- Recreate policies with grace period support
CREATE POLICY "Users can manage configs for their own licenses"
ON fanmark_basic_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_basic_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = 'active' AND fl.license_end > now())
        OR (fl.status = 'grace' AND fl.excluded_at IS NULL)
      )
  )
);

CREATE POLICY "Users can manage redirect configs for their own licenses"
ON fanmark_redirect_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_redirect_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = 'active' AND fl.license_end > now())
        OR (fl.status = 'grace' AND fl.excluded_at IS NULL)
      )
  )
);

CREATE POLICY "Users can manage messageboard configs for their own licenses"
ON fanmark_messageboard_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_messageboard_configs.license_id
      AND fl.user_id = auth.uid()
      AND (
        (fl.status = 'active' AND fl.license_end > now())
        OR (fl.status = 'grace' AND fl.excluded_at IS NULL)
      )
  )
);
-- Backfill excluded_at for expired licenses that were manually returned
-- This ensures data consistency for licenses that were expired before excluded_at tracking was implemented

-- Update expired licenses that have no excluded_at but have future license_end
-- Use updated_at as the excluded_at value (represents when the license was actually returned)
UPDATE fanmark_licenses
SET excluded_at = updated_at
WHERE status = 'expired'
  AND excluded_at IS NULL
  AND license_end > now();
-- Add grace_expires_at column to fanmark_licenses table
ALTER TABLE fanmark_licenses 
ADD COLUMN grace_expires_at TIMESTAMP WITH TIME ZONE;

-- Backfill existing grace licenses
-- Calculate grace_expires_at as license_end + grace_period_days
UPDATE fanmark_licenses fl
SET grace_expires_at = fl.license_end + (
  SELECT CAST(setting_value AS INTEGER) * INTERVAL '1 day'
  FROM system_settings 
  WHERE setting_key = 'grace_period_days'
)
WHERE fl.status = 'grace' AND fl.grace_expires_at IS NULL;

-- Backfill existing expired licenses (for historical reference)
-- Calculate grace_expires_at as license_end + grace_period_days
UPDATE fanmark_licenses fl
SET grace_expires_at = fl.license_end + (
  SELECT CAST(setting_value AS INTEGER) * INTERVAL '1 day'
  FROM system_settings 
  WHERE setting_key = 'grace_period_days'
)
WHERE fl.status = 'expired' AND fl.grace_expires_at IS NULL;

-- Add index for grace expiration queries (performance optimization)
CREATE INDEX idx_fanmark_licenses_grace_expires 
ON fanmark_licenses(grace_expires_at) 
WHERE status = 'grace';

-- Add index for grace re-acquisition check
CREATE INDEX idx_fanmark_licenses_fanmark_grace 
ON fanmark_licenses(fanmark_id, status, grace_expires_at)
WHERE status IN ('active', 'grace');
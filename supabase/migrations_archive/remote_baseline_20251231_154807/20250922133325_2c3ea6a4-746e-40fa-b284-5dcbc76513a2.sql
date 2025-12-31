-- Update fanmarks status constraint to only allow active/inactive
ALTER TABLE fanmarks DROP CONSTRAINT IF EXISTS fanmarks_status_check;
ALTER TABLE fanmarks ADD CONSTRAINT fanmarks_status_check CHECK (status IN ('active', 'inactive'));

-- Update fanmark_licenses status constraint to include grace
ALTER TABLE fanmark_licenses DROP CONSTRAINT IF EXISTS fanmark_licenses_status_check;
ALTER TABLE fanmark_licenses ADD CONSTRAINT fanmark_licenses_status_check CHECK (status IN ('active', 'grace', 'expired'));

-- Add grace period setting to system_settings
INSERT INTO system_settings (setting_key, setting_value, description, is_public) 
VALUES ('grace_period_days', '7', 'Number of days for license grace period after expiration', true)
ON CONFLICT (setting_key) DO UPDATE SET 
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;
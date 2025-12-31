-- Emergency fix: Update overdue grace licenses to expired status
-- This fixes licenses that should have transitioned to expired but didn't

DO $$
DECLARE
  grace_days integer;
  affected_count integer;
BEGIN
  -- Get grace period from system settings
  SELECT CAST(setting_value AS integer) INTO grace_days
  FROM system_settings
  WHERE setting_key = 'grace_period_days';

  -- Update grace licenses that have exceeded grace period
  WITH overdue_grace AS (
    SELECT id, license_end
    FROM fanmark_licenses
    WHERE status = 'grace'
      AND license_end + (grace_days || ' days')::interval < NOW()
  )
  UPDATE fanmark_licenses
  SET 
    status = 'expired',
    excluded_at = NOW(),
    updated_at = NOW()
  FROM overdue_grace
  WHERE fanmark_licenses.id = overdue_grace.id;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Updated % overdue grace licenses to expired status', affected_count;

  -- Fix expired licenses that are missing excluded_at
  UPDATE fanmark_licenses
  SET 
    excluded_at = COALESCE(excluded_at, updated_at, license_end),
    updated_at = NOW()
  WHERE status = 'expired'
    AND excluded_at IS NULL;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % expired licenses with missing excluded_at', affected_count;

  -- Delete configuration data for expired licenses
  DELETE FROM fanmark_basic_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = 'expired'
  );

  DELETE FROM fanmark_redirect_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = 'expired'
  );

  DELETE FROM fanmark_messageboard_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = 'expired'
  );

  DELETE FROM fanmark_password_configs
  WHERE license_id IN (
    SELECT id FROM fanmark_licenses WHERE status = 'expired'
  );

  RAISE NOTICE 'Cleaned up configuration data for expired licenses';
END $$;
-- Atomic, idempotent coupon-based license extension. This migration creates
-- structure only; no Supabase coupon, usage, license, or user rows are copied.

CREATE TABLE extension_coupon_application_commands (
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  coupon_id TEXT NOT NULL,
  coupon_code TEXT NOT NULL,
  fanmark_id TEXT NOT NULL,
  tier_level INTEGER NOT NULL,
  months INTEGER NOT NULL,
  previous_status TEXT NOT NULL,
  previous_license_end TEXT NOT NULL,
  grace_plan_type TEXT,
  grace_plan_limit_key TEXT,
  grace_plan_setting_value TEXT,
  grace_plan_limit INTEGER,
  new_license_end TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  cancelled_lottery_entries INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT extension_coupon_application_commands_pkey PRIMARY KEY (id),
  CONSTRAINT extension_coupon_application_commands_request_key UNIQUE (user_id, request_id),
  CONSTRAINT extension_coupon_application_commands_coupon_fkey
    FOREIGN KEY (coupon_id) REFERENCES extension_coupons(id),
  CONSTRAINT extension_coupon_application_commands_license_fkey
    FOREIGN KEY (license_id) REFERENCES fanmark_licenses(id),
  CONSTRAINT extension_coupon_application_commands_status_check CHECK (status IN ('processing', 'completed')),
  CONSTRAINT extension_coupon_application_commands_months_check CHECK (months IN (1, 2, 3, 6)),
  CONSTRAINT extension_coupon_application_commands_previous_status_check CHECK (previous_status IN ('active', 'grace')),
  CONSTRAINT extension_coupon_application_commands_cancel_count_check CHECK (cancelled_lottery_entries >= 0)
);

-- Supabase checked this condition in the Edge Function. Enforce it in D1 too,
-- so separate request IDs cannot redeem one coupon twice on the same fanmark.
CREATE UNIQUE INDEX extension_coupon_usages_coupon_user_fanmark_key
  ON extension_coupon_usages (coupon_id, user_id, fanmark_id);

ALTER TABLE fanmark_lottery_entries
  ADD COLUMN coupon_extension_command_id TEXT
  REFERENCES extension_coupon_application_commands(id);

CREATE INDEX fanmark_lottery_entries_coupon_extension_command_idx
  ON fanmark_lottery_entries (coupon_extension_command_id)
  WHERE coupon_extension_command_id IS NOT NULL;

CREATE TRIGGER extension_coupon_application_guard
BEFORE INSERT ON extension_coupon_application_commands
BEGIN
  SELECT RAISE(ABORT, 'coupon_not_found')
  WHERE NOT EXISTS (
    SELECT 1 FROM extension_coupons c
    WHERE c.id = NEW.coupon_id AND c.code = NEW.coupon_code AND c.is_active = 1
  );

  SELECT RAISE(ABORT, 'coupon_expired')
  WHERE EXISTS (
    SELECT 1 FROM extension_coupons c
    WHERE c.id = NEW.coupon_id AND c.expires_at IS NOT NULL
      AND julianday(c.expires_at) < julianday(NEW.applied_at)
  );

  SELECT RAISE(ABORT, 'coupon_usage_exceeded')
  WHERE EXISTS (
    SELECT 1 FROM extension_coupons c
    WHERE c.id = NEW.coupon_id AND c.used_count >= c.max_uses
  );

  SELECT RAISE(ABORT, 'invalid_coupon_configuration')
  WHERE NOT EXISTS (
    SELECT 1 FROM extension_coupons c
    WHERE c.id = NEW.coupon_id AND c.months IN (1, 2, 3, 6)
  );

  SELECT RAISE(ABORT, 'tier_not_allowed')
  WHERE EXISTS (
    SELECT 1 FROM extension_coupons c
    WHERE c.id = NEW.coupon_id AND c.allowed_tier_levels IS NOT NULL
      AND json_array_length(c.allowed_tier_levels) > 0
      AND NOT EXISTS (
        SELECT 1 FROM json_each(c.allowed_tier_levels) allowed
        WHERE CAST(allowed.value AS INTEGER) = NEW.tier_level
      )
  );

  SELECT RAISE(ABORT, 'coupon_already_used_on_fanmark')
  WHERE EXISTS (
    SELECT 1 FROM extension_coupon_usages u
    WHERE u.coupon_id = NEW.coupon_id AND u.user_id = NEW.user_id
      AND u.fanmark_id = NEW.fanmark_id
  );

  SELECT RAISE(ABORT, 'perpetual_license')
  WHERE EXISTS (
    SELECT 1 FROM fanmark_licenses l
    WHERE l.id = NEW.license_id AND l.user_id = NEW.user_id
      AND l.status IN ('active', 'grace') AND l.license_end IS NULL
  );

  SELECT RAISE(ABORT, 'no_eligible_license')
  WHERE NOT EXISTS (
    SELECT 1 FROM fanmark_licenses l
    JOIN fanmarks f ON f.id = l.fanmark_id
    WHERE l.id = NEW.license_id AND l.user_id = NEW.user_id
      AND l.fanmark_id = NEW.fanmark_id AND f.tier_level = NEW.tier_level
      AND l.status = NEW.previous_status AND l.status IN ('active', 'grace')
      AND l.license_end = NEW.previous_license_end
      AND l.is_returned = 0 AND l.is_transferred = 0
  );

  SELECT RAISE(ABORT, 'transfer_in_progress')
  WHERE EXISTS (
    SELECT 1 FROM fanmark_licenses l
    WHERE l.id = NEW.license_id AND (
      (l.transfer_locked_until IS NOT NULL
        AND julianday(l.transfer_locked_until) > julianday(NEW.applied_at))
      OR EXISTS (
        SELECT 1 FROM fanmark_transfer_codes tc
        WHERE tc.license_id = l.id AND tc.status IN ('active', 'applied')
      )
      OR EXISTS (
        SELECT 1 FROM fanmark_transfer_requests tr
        WHERE tr.license_id = l.id AND tr.status IN ('pending', 'approved')
      )
    )
  );

  SELECT RAISE(ABORT, 'invalid_plan_limit_snapshot')
  WHERE NEW.previous_status = 'grace' AND (
    NEW.grace_plan_type IS NULL
    OR (NEW.grace_plan_type = 'admin' AND (
      NEW.grace_plan_limit_key IS NOT NULL OR NEW.grace_plan_limit IS NOT NULL
    ))
    OR (NEW.grace_plan_type <> 'admin' AND (
      NEW.grace_plan_limit_key IS NULL
      OR typeof(NEW.grace_plan_limit) <> 'integer'
      OR NEW.grace_plan_limit < 0
    ))
  );

  SELECT RAISE(ABORT, 'plan_limit_changed')
  WHERE NEW.previous_status = 'grace'
    AND COALESCE((SELECT plan_type FROM user_settings WHERE user_id = NEW.user_id LIMIT 1), 'free')
      <> NEW.grace_plan_type;

  SELECT RAISE(ABORT, 'plan_limit_changed')
  WHERE NEW.previous_status = 'grace'
    AND NEW.grace_plan_type <> 'admin'
    AND (SELECT setting_value FROM system_settings
      WHERE setting_key = NEW.grace_plan_limit_key LIMIT 1) IS NOT NEW.grace_plan_setting_value;

  SELECT RAISE(ABORT, 'fanmark_limit_exceeded')
  WHERE NEW.previous_status = 'grace'
    AND NEW.grace_plan_type <> 'admin'
    AND (SELECT COUNT(*) FROM fanmark_licenses l
      WHERE l.user_id = NEW.user_id AND l.status = 'active'
        AND (l.license_end IS NULL OR julianday(l.license_end) > julianday(NEW.applied_at)))
      >= NEW.grace_plan_limit;
END;

CREATE TRIGGER extension_coupon_application_apply
AFTER INSERT ON extension_coupon_application_commands
BEGIN
  UPDATE extension_coupons
  SET used_count = used_count + 1, updated_at = NEW.applied_at
  WHERE id = NEW.coupon_id;

  INSERT INTO extension_coupon_usages (coupon_id, user_id, fanmark_id, license_id, used_at)
  VALUES (NEW.coupon_id, NEW.user_id, NEW.fanmark_id, NEW.license_id, NEW.applied_at);

  UPDATE fanmark_licenses
  SET status = 'active', license_end = NEW.new_license_end, grace_expires_at = NULL,
      is_returned = 0, excluded_at = NULL, excluded_from_plan = NULL, updated_at = NEW.applied_at
  WHERE id = NEW.license_id AND user_id = NEW.user_id;

  UPDATE fanmark_lottery_entries
  SET entry_status = 'cancelled_by_extension', cancelled_at = NEW.applied_at,
      cancellation_reason = 'license_extended', updated_at = NEW.applied_at,
      coupon_extension_command_id = NEW.id
  WHERE license_id = NEW.license_id AND entry_status = 'pending';

  INSERT INTO notification_events (
    event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at
  )
  SELECT 'lottery_cancelled_by_extension', 1, 'edge_function',
    json_object(
      'user_id', entry.user_id,
      'fanmark_id', NEW.fanmark_id,
      'fanmark_name', COALESCE(license.display_fanmark, ''),
      'extended_by_user_id', NEW.user_id
    ),
    NEW.applied_at,
    'coupon-extension:' || NEW.id || ':' || entry.id,
    'pending', NEW.applied_at, NEW.applied_at
  FROM fanmark_lottery_entries entry
  JOIN fanmark_licenses license ON license.id = NEW.license_id
  WHERE entry.coupon_extension_command_id = NEW.id;

  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
  VALUES (
    NEW.user_id,
    'extend_fanmark_license_by_coupon',
    'fanmark_license',
    NEW.license_id,
    json_object(
      'fanmark_id', NEW.fanmark_id,
      'coupon_id', NEW.coupon_id,
      'coupon_code', NEW.coupon_code,
      'months', NEW.months,
      'previous_license_end', NEW.previous_license_end,
      'new_license_end', NEW.new_license_end
    ),
    NEW.applied_at
  );

  INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
  SELECT
    NEW.user_id,
    'COUPON_EXTENSION_LOTTERY_CANCELLED',
    'fanmark_license',
    NEW.license_id,
    json_object(
      'fanmark_id', NEW.fanmark_id,
      'cancelled_entries_count', COUNT(*),
      'coupon_code', NEW.coupon_code
    ),
    NEW.applied_at
  FROM fanmark_lottery_entries
  WHERE coupon_extension_command_id = NEW.id
  HAVING COUNT(*) > 0;

  UPDATE extension_coupon_application_commands
  SET status = 'completed',
      cancelled_lottery_entries = (
        SELECT COUNT(*) FROM fanmark_lottery_entries WHERE coupon_extension_command_id = NEW.id
      )
  WHERE id = NEW.id;
END;

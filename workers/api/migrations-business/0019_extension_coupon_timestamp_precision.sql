-- The 0015 coupon guard used julianday(), which rounds canonical UTC
-- microseconds. Compare the fixed-width timestamp text directly instead.
DROP TRIGGER extension_coupon_application_guard;

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
      AND c.expires_at < NEW.applied_at
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
        AND l.transfer_locked_until > NEW.applied_at)
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
        AND (l.license_end IS NULL OR l.license_end > NEW.applied_at))
      >= NEW.grace_plan_limit;
END;

CREATE TABLE user_settings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'creator', 'max', 'business', 'enterprise', 'admin')),
  preferred_language TEXT NOT NULL CHECK (preferred_language IN ('en', 'ja', 'ko', 'id')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  invited_by_code TEXT,
  requires_password_setup INTEGER NOT NULL CHECK (requires_password_setup IN (0, 1)),
  stripe_customer_id TEXT UNIQUE
);

CREATE TRIGGER user_settings_prevent_privilege_escalation
BEFORE UPDATE ON user_settings
WHEN NEW.plan_type <> OLD.plan_type
  OR NEW.invited_by_code IS NOT OLD.invited_by_code
  OR NEW.requires_password_setup <> OLD.requires_password_setup
  OR NEW.stripe_customer_id IS NOT OLD.stripe_customer_id
BEGIN
  SELECT RAISE(ABORT, 'user_settings_privileged_field');
END;

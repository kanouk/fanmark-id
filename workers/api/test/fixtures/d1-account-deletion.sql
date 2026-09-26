CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY NOT NULL,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT,
  display_fanmark TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'expired')),
  license_end TEXT,
  grace_expires_at TEXT,
  is_returned INTEGER NOT NULL DEFAULT 0,
  excluded_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_transfer_codes (
  id TEXT PRIMARY KEY NOT NULL,
  license_id TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE system_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  setting_value TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'edge_function',
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  payload_schema TEXT,
  trigger_at TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_at TEXT,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_type, dedupe_key)
);

CREATE TABLE fanmark_favorites (
  id TEXT PRIMARY KEY NOT NULL,
  fanmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_fanmark TEXT
);

CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_availability_rules (
  id TEXT PRIMARY KEY NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE fanmark_lottery_entries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  entry_status TEXT NOT NULL,
  cancelled_at TEXT,
  cancellation_reason TEXT CHECK (cancellation_reason IS NULL OR cancellation_reason IN ('user_request', 'license_extended', 'system')),
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_lottery_history (
  id TEXT PRIMARY KEY NOT NULL,
  winner_user_id TEXT
);

CREATE TABLE notifications (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
CREATE TABLE notification_preferences (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);

CREATE TABLE user_settings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE
);

CREATE TABLE enterprise_user_settings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE
);

CREATE TABLE user_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE broadcast_emails (
  id TEXT PRIMARY KEY NOT NULL,
  created_by TEXT
);

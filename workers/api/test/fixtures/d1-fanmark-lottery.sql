PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  user_input_fanmark TEXT NOT NULL,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT,
  license_end TEXT,
  status TEXT NOT NULL,
  is_returned INTEGER NOT NULL DEFAULT 0,
  lifecycle_claim_id TEXT,
  grace_expires_at TEXT,
  display_fanmark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  plan_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_lottery_entries (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  lottery_probability TEXT NOT NULL DEFAULT '1.0',
  entry_status TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (fanmark_id, user_id, license_id)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  trigger_at TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT,
  rule_id TEXT,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled', 'sending', 'sent')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  triggered_at TEXT NOT NULL,
  expires_at TEXT,
  delivered_at TEXT,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  read_via TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notifications_user_triggered_at_idx
  ON notifications (user_id, triggered_at DESC, id ASC);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  payload_schema TEXT,
  trigger_at TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'skipped')),
  processed_at TEXT,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 5,
  segment_filter TEXT,
  cooldown_window_seconds INTEGER,
  max_per_user INTEGER,
  cancel_condition TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_templates (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ja',
  title TEXT,
  body TEXT NOT NULL,
  summary TEXT,
  payload_schema TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE user_settings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'ja'
);

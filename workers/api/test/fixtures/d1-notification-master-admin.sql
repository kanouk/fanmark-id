CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  delay_seconds INTEGER NOT NULL DEFAULT 0 CHECK (delay_seconds >= 0),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  segment_filter TEXT,
  cooldown_window_seconds INTEGER,
  max_per_user INTEGER,
  cancel_condition TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE notification_templates (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webpush')),
  language TEXT NOT NULL DEFAULT 'ja',
  title TEXT,
  body TEXT NOT NULL,
  summary TEXT,
  payload_schema TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (template_id, version, channel, language)
);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  payload_schema TEXT,
  trigger_at TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_at TEXT,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT,
  rule_id TEXT,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
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

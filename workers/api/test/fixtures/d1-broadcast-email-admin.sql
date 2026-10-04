CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  plan_type TEXT NOT NULL,
  preferred_language TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE broadcast_emails (
  id TEXT NOT NULL PRIMARY KEY,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  email_type TEXT NOT NULL,
  recipient_filter TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_by TEXT,
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_details TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE email_templates (
  id TEXT NOT NULL PRIMARY KEY,
  email_type TEXT NOT NULL,
  language TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  button_text TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE audit_logs (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

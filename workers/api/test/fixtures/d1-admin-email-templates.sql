PRAGMA foreign_keys = ON;
CREATE TABLE email_templates (
  id TEXT PRIMARY KEY,
  email_type TEXT NOT NULL,
  language TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  button_text TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(email_type, language)
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  plan_type TEXT NOT NULL
);

CREATE TABLE waitlist (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  referral_source TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'converted')),
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

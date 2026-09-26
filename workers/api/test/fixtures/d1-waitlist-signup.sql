CREATE TABLE waitlist (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  referral_source TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'converted')),
  created_at TEXT NOT NULL
);

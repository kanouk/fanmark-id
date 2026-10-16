-- Local business-D1 availability contract fixture only.
CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  normalized_emoji TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  status TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT
);

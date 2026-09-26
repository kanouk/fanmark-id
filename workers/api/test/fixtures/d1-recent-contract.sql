-- This is a local contract fixture, not the production fanmark schema.
-- It contains only the columns needed to execute the observed recent view.
CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL,
  normalized_emoji TEXT,
  user_input_fanmark TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  display_fanmark TEXT,
  status TEXT NOT NULL,
  license_end TEXT,
  created_at TEXT NOT NULL
);

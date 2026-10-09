CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  user_input_fanmark TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL,
  emoji_ids TEXT NOT NULL,
  normalized_emoji_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  user_id TEXT,
  license_start TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  excluded_at TEXT,
  is_returned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  is_initial_license INTEGER NOT NULL DEFAULT 0,
  display_fanmark TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE fanmark_lottery_entries (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  entry_status TEXT NOT NULL
);

CREATE TABLE fanmark_discoveries (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT,
  normalized_emoji_ids TEXT NOT NULL
);

CREATE TABLE fanmark_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discovery_id TEXT NOT NULL,
  fanmark_id TEXT,
  normalized_emoji_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  display_fanmark TEXT
);

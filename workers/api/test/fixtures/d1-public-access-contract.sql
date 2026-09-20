-- Local public-access proof fixture only. This is not a deployable or partial
-- production migration and contains no production rows.
CREATE TABLE IF NOT EXISTS emoji_master (
  id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  codepoints TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL,
  user_input_fanmark TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL,
  emoji_ids TEXT NOT NULL,
  normalized_emoji_ids TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  display_fanmark TEXT,
  status TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  is_returned INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_basic_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  fanmark_name TEXT,
  access_type TEXT
);

CREATE TABLE IF NOT EXISTS fanmark_redirect_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  target_url TEXT
);

CREATE TABLE IF NOT EXISTS fanmark_messageboard_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  content TEXT
);

CREATE TABLE IF NOT EXISTS fanmark_password_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  is_enabled INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_profiles (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  social_links TEXT,
  theme_settings TEXT,
  is_public INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

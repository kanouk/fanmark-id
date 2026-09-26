PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  user_input_fanmark TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL UNIQUE,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  emoji_ids TEXT NOT NULL CHECK (json_valid(emoji_ids) AND json_type(emoji_ids) = 'array'),
  normalized_emoji_ids TEXT NOT NULL UNIQUE CHECK (json_valid(normalized_emoji_ids) AND json_type(normalized_emoji_ids) = 'array'),
  tier_level INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT,
  license_start TEXT NOT NULL,
  license_end TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','grace','expired')),
  is_initial_license INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  grace_expires_at TEXT,
  display_fanmark TEXT
);

CREATE TABLE IF NOT EXISTS fanmark_lottery_entries (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  entry_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_basic_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_name TEXT,
  access_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_redirect_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_messageboard_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  social_links TEXT NOT NULL DEFAULT '{}',
  theme_settings TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  user_id TEXT,
  license_start TEXT NOT NULL,
  license_end TEXT,
  status TEXT NOT NULL
);

CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  fanmark_name TEXT,
  access_type TEXT NOT NULL
);

CREATE TABLE fanmark_redirect_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL
);

CREATE TABLE fanmark_messageboard_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  content TEXT
);

CREATE TABLE fanmark_password_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1))
);

CREATE TABLE user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT
);

CREATE TABLE fanmark_discoveries (
  id TEXT PRIMARY KEY,
  emoji_ids TEXT NOT NULL CHECK (json_valid(emoji_ids) AND json_type(emoji_ids) = 'array'),
  normalized_emoji_ids TEXT NOT NULL CHECK (json_valid(normalized_emoji_ids) AND json_type(normalized_emoji_ids) = 'array'),
  fanmark_id TEXT,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX fanmark_discoveries_seq_key_idx ON fanmark_discoveries (normalized_emoji_ids);

CREATE TABLE fanmark_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discovery_id TEXT NOT NULL,
  fanmark_id TEXT,
  normalized_emoji_ids TEXT NOT NULL CHECK (json_valid(normalized_emoji_ids) AND json_type(normalized_emoji_ids) = 'array'),
  created_at TEXT NOT NULL,
  display_fanmark TEXT
);
CREATE UNIQUE INDEX fanmark_favorites_user_seq_idx ON fanmark_favorites (user_id, normalized_emoji_ids);

CREATE TABLE fanmark_events (
  id INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  discovery_id TEXT,
  normalized_emoji_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);

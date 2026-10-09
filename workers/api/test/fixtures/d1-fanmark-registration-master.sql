CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_imports (
  release_version TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_active_release (
  singleton_id INTEGER PRIMARY KEY,
  release_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_staging (
  release_version TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  codepoints_json TEXT NOT NULL CHECK (json_valid(codepoints_json) AND json_type(codepoints_json) = 'array'),
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, ordinal)
);

CREATE TABLE IF NOT EXISTS fanmark_tiers (
  tier_level INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  initial_license_days INTEGER,
  is_active INTEGER NOT NULL
);

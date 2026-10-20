CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_imports (
  release_version TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_staging (
  release_version TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  short_name TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  codepoints_json TEXT NOT NULL,
  sort_order INTEGER,
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, ordinal)
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_active_release (
  singleton_id INTEGER PRIMARY KEY,
  release_version TEXT NOT NULL,
  previous_release_version TEXT,
  activation_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  generation INTEGER NOT NULL
);

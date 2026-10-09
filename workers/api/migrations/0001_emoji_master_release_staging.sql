-- Private, version-bound staging for the non-user emoji master catalog.
-- These tables are not read by public API routes and do not change emoji_master.
CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_imports (
  release_version TEXT PRIMARY KEY
    CHECK (length(release_version) = 64 AND release_version NOT GLOB '*[^0-9a-f]*'),
  manifest_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  status TEXT NOT NULL CHECK (status IN ('loading', 'ready', 'failed')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_staging (
  release_version TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  short_name TEXT NOT NULL,
  keywords_json TEXT NOT NULL
    CHECK (json_valid(keywords_json) AND json_type(keywords_json) = 'array'),
  category TEXT,
  subcategory TEXT,
  codepoints_json TEXT NOT NULL
    CHECK (json_valid(codepoints_json) AND json_type(codepoints_json) = 'array'),
  sort_order INTEGER,
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, ordinal),
  UNIQUE (release_version, emoji),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_emoji_master_release_imports (release_version)
    ON DELETE CASCADE
);

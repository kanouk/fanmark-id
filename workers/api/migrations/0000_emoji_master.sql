-- Canonical public emoji metadata copied from the source catalog.
-- PostgreSQL text[] columns are represented as validated JSON arrays in D1.
CREATE TABLE emoji_master (
  id TEXT PRIMARY KEY NOT NULL,
  emoji TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(keywords) AND json_type(keywords) = 'array'),
  category TEXT,
  subcategory TEXT,
  codepoints TEXT NOT NULL
    CHECK (json_valid(codepoints) AND json_type(codepoints) = 'array'),
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX idx_emoji_master_short_name ON emoji_master (short_name);
CREATE INDEX idx_emoji_master_category ON emoji_master (category, subcategory);

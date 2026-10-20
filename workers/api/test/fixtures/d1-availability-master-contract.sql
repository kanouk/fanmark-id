-- Local master-D1 availability contract fixture only.
CREATE TABLE IF NOT EXISTS emoji_master (
  id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_imports (
  release_version TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_release_staging (
  release_version TEXT NOT NULL,
  id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (release_version, id)
);

CREATE TABLE IF NOT EXISTS fanmark_emoji_master_active_release (
  singleton_id INTEGER PRIMARY KEY,
  release_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_tiers (
  tier_level INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  initial_license_days INTEGER,
  -- The production numeric(10,2) column is imported as exact integer cents.
  -- The adapter converts this value back to public USD at the boundary.
  monthly_price_usd INTEGER,
  is_active INTEGER NOT NULL
);

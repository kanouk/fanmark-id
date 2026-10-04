-- Local availability contract fixture only. This is not the production schema.
CREATE TABLE IF NOT EXISTS emoji_master (
  id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  normalized_emoji TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  status TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT
);

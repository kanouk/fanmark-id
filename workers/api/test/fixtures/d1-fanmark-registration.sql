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

CREATE TABLE "fanmark_discoveries" (
  "id" TEXT NOT NULL DEFAULT (lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
  substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
  hex(randomblob(6))
)),
  "emoji_ids" TEXT NOT NULL,
  "normalized_emoji_ids" TEXT NOT NULL,
  "fanmark_id" TEXT,
  "availability_status" TEXT NOT NULL DEFAULT 'unknown',
  "first_seen_at" TEXT NOT NULL,
  "last_seen_at" TEXT NOT NULL,
  "search_count" INTEGER NOT NULL DEFAULT 0,
  "favorite_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "d1_fanmark_discoveries_emoji_ids_2" CHECK ("emoji_ids" IS NULL OR (json_valid("emoji_ids") AND json_type("emoji_ids") = 'array')),
  CONSTRAINT "d1_fanmark_discoveries_normalized_emoji_ids_4" CHECK ("normalized_emoji_ids" IS NULL OR (json_valid("normalized_emoji_ids") AND json_type("normalized_emoji_ids") = 'array')),
  CONSTRAINT "d1_fanmark_discoveries_search_count_10" CHECK (typeof("search_count") = 'integer' AND "search_count" BETWEEN -9223372036854775808 AND 9223372036854775807),
  CONSTRAINT "d1_fanmark_discoveries_favorite_count_12" CHECK (typeof("favorite_count") = 'integer' AND "favorite_count" BETWEEN -9223372036854775808 AND 9223372036854775807),
  CONSTRAINT "fanmark_discoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fanmark_discoveries_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "fanmarks" ("id") ON DELETE SET NULL,
  CONSTRAINT "fanmark_discoveries_availability_check" CHECK (availability_status IN ('unknown', 'unclaimed', 'claimed_external', 'owned_by_user'))
);

CREATE TABLE "fanmark_favorites" (
  "id" TEXT NOT NULL DEFAULT (lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
  substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
  hex(randomblob(6))
)),
  "user_id" TEXT NOT NULL,
  "discovery_id" TEXT NOT NULL,
  "fanmark_id" TEXT,
  "normalized_emoji_ids" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "display_fanmark" TEXT,
  CONSTRAINT "d1_fanmark_favorites_normalized_emoji_ids_5" CHECK ("normalized_emoji_ids" IS NULL OR (json_valid("normalized_emoji_ids") AND json_type("normalized_emoji_ids") = 'array')),
  CONSTRAINT "fanmark_favorites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fanmark_favorites_discovery_id_fkey" FOREIGN KEY ("discovery_id") REFERENCES "fanmark_discoveries" ("id") ON DELETE CASCADE,
  CONSTRAINT "fanmark_favorites_fanmark_id_fkey" FOREIGN KEY ("fanmark_id") REFERENCES "fanmarks" ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX fanmark_discoveries_seq_key_idx ON fanmark_discoveries (normalized_emoji_ids);
CREATE UNIQUE INDEX fanmark_favorites_user_seq_idx ON fanmark_favorites (user_id, normalized_emoji_ids);

PRAGMA foreign_keys = ON;

CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  user_input_fanmark TEXT NOT NULL,
  emoji_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  tier_level INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT NOT NULL,
  license_end TEXT,
  display_fanmark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_name TEXT,
  access_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_profiles (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  social_links TEXT NOT NULL,
  theme_settings TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  access_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER fanmark_profile_access_generation
AFTER UPDATE OF license_id, display_name, bio, social_links, theme_settings, is_public ON fanmark_profiles
WHEN old.license_id IS NOT new.license_id
  OR old.display_name IS NOT new.display_name
  OR old.bio IS NOT new.bio
  OR old.social_links IS NOT new.social_links
  OR old.theme_settings IS NOT new.theme_settings
  OR old.is_public IS NOT new.is_public
BEGIN
  UPDATE fanmark_access_versions
  SET access_generation = access_generation + 1,
      updated_at = 'profile-update'
  WHERE license_id IN (old.license_id, new.license_id);
END;

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
  grace_expires_at TEXT,
  is_returned INTEGER NOT NULL DEFAULT 0,
  excluded_at TEXT,
  display_fanmark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_license_incarnations (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  incarnation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  license_incarnation INTEGER NOT NULL DEFAULT 0,
  access_generation INTEGER NOT NULL DEFAULT 0,
  password_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_password_runtime_evidence (
  license_id TEXT PRIMARY KEY NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  license_incarnation INTEGER NOT NULL,
  password_generation INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  codec_id TEXT NOT NULL CHECK (codec_id = 'bcryptjs@3.0.3'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_name TEXT,
  access_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_redirect_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_messageboard_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  content TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_password_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  access_password TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fanmark_profiles (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  social_links TEXT NOT NULL DEFAULT '{}',
  theme_settings TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  trigger_at TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_type, dedupe_key)
);

CREATE TABLE system_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL
);

CREATE TABLE fanmark_transfer_codes (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  status TEXT NOT NULL
);

CREATE TABLE fanmark_discoveries (
  id TEXT PRIMARY KEY
);

CREATE TABLE fanmark_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discovery_id TEXT NOT NULL REFERENCES fanmark_discoveries(id) ON DELETE CASCADE,
  fanmark_id TEXT REFERENCES fanmarks(id) ON DELETE SET NULL,
  display_fanmark TEXT
);

CREATE TRIGGER settings_basic_insert AFTER INSERT ON fanmark_basic_configs
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id = NEW.license_id;
END;
CREATE TRIGGER settings_basic_update AFTER UPDATE OF license_id, fanmark_name, access_type ON fanmark_basic_configs
WHEN OLD.license_id IS NOT NEW.license_id OR OLD.fanmark_name IS NOT NEW.fanmark_name OR OLD.access_type IS NOT NEW.access_type
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id IN (OLD.license_id, NEW.license_id);
END;
CREATE TRIGGER settings_redirect_insert AFTER INSERT ON fanmark_redirect_configs
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id = NEW.license_id;
END;
CREATE TRIGGER settings_redirect_update AFTER UPDATE OF license_id, target_url ON fanmark_redirect_configs
WHEN OLD.license_id IS NOT NEW.license_id OR OLD.target_url IS NOT NEW.target_url
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id IN (OLD.license_id, NEW.license_id);
END;
CREATE TRIGGER settings_message_insert AFTER INSERT ON fanmark_messageboard_configs
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id = NEW.license_id;
END;
CREATE TRIGGER settings_message_update AFTER UPDATE OF license_id, content ON fanmark_messageboard_configs
WHEN OLD.license_id IS NOT NEW.license_id OR OLD.content IS NOT NEW.content
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id IN (OLD.license_id, NEW.license_id);
END;
CREATE TRIGGER settings_password_insert AFTER INSERT ON fanmark_password_configs
BEGIN
  UPDATE fanmark_access_versions
  SET access_generation = access_generation + 1, password_generation = password_generation + 1
  WHERE license_id = NEW.license_id;
END;
CREATE TRIGGER settings_password_update AFTER UPDATE ON fanmark_password_configs
WHEN OLD.license_id IS NOT NEW.license_id OR OLD.access_password IS NOT NEW.access_password OR OLD.is_enabled IS NOT NEW.is_enabled
BEGIN
  UPDATE fanmark_access_versions
  SET access_generation = access_generation + 1, password_generation = password_generation + 1
  WHERE license_id IN (OLD.license_id, NEW.license_id);
END;
CREATE TRIGGER settings_profile_insert AFTER INSERT ON fanmark_profiles
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id = NEW.license_id;
END;
CREATE TRIGGER settings_profile_update AFTER UPDATE OF license_id, display_name, bio, social_links, theme_settings, is_public ON fanmark_profiles
WHEN OLD.license_id IS NOT NEW.license_id OR OLD.display_name IS NOT NEW.display_name OR OLD.bio IS NOT NEW.bio OR
     OLD.social_links IS NOT NEW.social_links OR OLD.theme_settings IS NOT NEW.theme_settings OR OLD.is_public IS NOT NEW.is_public
BEGIN
  UPDATE fanmark_access_versions SET access_generation = access_generation + 1 WHERE license_id IN (OLD.license_id, NEW.license_id);
END;

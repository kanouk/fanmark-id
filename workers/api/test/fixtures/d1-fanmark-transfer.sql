PRAGMA foreign_keys = ON;

CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY, user_input_fanmark TEXT NOT NULL, normalized_emoji TEXT NOT NULL UNIQUE,
  short_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  emoji_ids TEXT NOT NULL DEFAULT '[]', normalized_emoji_ids TEXT NOT NULL DEFAULT '[]', tier_level INTEGER NOT NULL
);
CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY, fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT, license_start TEXT NOT NULL, license_end TEXT, status TEXT NOT NULL,
  is_initial_license INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  excluded_at TEXT, is_returned INTEGER NOT NULL DEFAULT 0, is_transferred INTEGER NOT NULL DEFAULT 0,
  transfer_locked_until TEXT, display_fanmark TEXT
);
CREATE TABLE fanmark_transfer_codes (
  id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE, issuer_user_id TEXT NOT NULL,
  transfer_code TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK (status IN ('active','applied','completed','cancelled','expired')),
  expires_at TEXT NOT NULL, disclaimer_agreed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_transfer_requests (
  id TEXT PRIMARY KEY, transfer_code_id TEXT NOT NULL REFERENCES fanmark_transfer_codes(id) ON DELETE CASCADE,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE, requester_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  disclaimer_agreed_at TEXT NOT NULL, applied_at TEXT NOT NULL, resolved_at TEXT, rejection_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, requester_username TEXT, requester_display_name TEXT
);
CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_name TEXT, access_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_redirect_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_messageboard_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  content TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_password_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  access_password TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_profiles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  display_name TEXT, bio TEXT, social_links TEXT NOT NULL DEFAULT '{}', theme_settings TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_lottery_entries (
  id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  entry_status TEXT NOT NULL, cancelled_at TEXT, cancellation_reason TEXT
    CHECK (cancellation_reason IS NULL OR cancellation_reason IN ('user_request','license_extended','system')),
  updated_at TEXT
);
CREATE TABLE user_settings (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, display_name TEXT, plan_type TEXT NOT NULL DEFAULT 'free'
);
CREATE TABLE system_settings (id TEXT PRIMARY KEY, setting_key TEXT NOT NULL UNIQUE, setting_value TEXT NOT NULL);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), user_id TEXT, action TEXT NOT NULL,
  resource_type TEXT NOT NULL, resource_id TEXT, request_id TEXT, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE notification_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), event_type TEXT NOT NULL, event_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL, payload TEXT NOT NULL, trigger_at TEXT NOT NULL, dedupe_key TEXT, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (event_type, dedupe_key)
);

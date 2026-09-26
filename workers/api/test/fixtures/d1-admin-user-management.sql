PRAGMA foreign_keys = ON;
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan_type TEXT NOT NULL,
  preferred_language TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE enterprise_user_settings (
  user_id TEXT PRIMARY KEY,
  custom_fanmarks_limit INTEGER,
  custom_pricing INTEGER,
  notes TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  user_input_fanmark TEXT NOT NULL,
  status TEXT NOT NULL,
  tier_level INTEGER NOT NULL
);
CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  plan_excluded INTEGER,
  excluded_at TEXT,
  excluded_from_plan TEXT,
  display_fanmark TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE fanmark_basic_configs (
  license_id TEXT PRIMARY KEY,
  fanmark_name TEXT,
  access_type TEXT
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  emailVerified INTEGER NOT NULL,
  twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE "session" (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE "twoFactor" (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1
);

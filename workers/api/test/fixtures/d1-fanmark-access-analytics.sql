CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  user_input_fanmark TEXT NOT NULL DEFAULT '',
  created_at TEXT
);
CREATE TABLE user_settings (user_id TEXT PRIMARY KEY, plan_type TEXT NOT NULL);
CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id),
  user_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  is_returned INTEGER DEFAULT 0,
  display_fanmark TEXT
);
CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id),
  fanmark_name TEXT
);
CREATE TABLE fanmark_access_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id),
  license_id TEXT REFERENCES fanmark_licenses(id),
  accessed_at TEXT NOT NULL,
  referrer TEXT,
  referrer_domain TEXT,
  referrer_category TEXT,
  user_agent TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  visitor_hash TEXT,
  access_type TEXT
);
CREATE TABLE fanmark_access_daily_stats (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id),
  license_id TEXT REFERENCES fanmark_licenses(id),
  stat_date TEXT NOT NULL,
  access_count INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  referrer_direct INTEGER DEFAULT 0,
  referrer_search INTEGER DEFAULT 0,
  referrer_social INTEGER DEFAULT 0,
  referrer_other INTEGER DEFAULT 0,
  device_mobile INTEGER DEFAULT 0,
  device_tablet INTEGER DEFAULT 0,
  device_desktop INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  access_type_profile INTEGER DEFAULT 0,
  access_type_redirect INTEGER DEFAULT 0,
  access_type_text INTEGER DEFAULT 0,
  access_type_inactive INTEGER DEFAULT 0,
  UNIQUE(fanmark_id, stat_date)
);

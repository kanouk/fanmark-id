CREATE TABLE users (
  id TEXT PRIMARY KEY,
  active_limit INTEGER NOT NULL CHECK (active_limit >= 0)
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  normalized_fanmark TEXT NOT NULL,
  display_fanmark TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'expired')),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX fanmark_active_normalized_unique
  ON fanmark_licenses (normalized_fanmark)
  WHERE status IN ('active', 'grace');

CREATE TABLE acquisition_audit (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses (id),
  event_type TEXT NOT NULL CHECK (event_type = 'fanmark_acquired'),
  created_at TEXT NOT NULL
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  remaining_uses INTEGER NOT NULL CHECK (remaining_uses >= 0)
);

CREATE TABLE coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  UNIQUE (coupon_id, user_id)
);

CREATE TABLE transfer_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by TEXT,
  approved_at TEXT,
  approved_operation_id TEXT
);

CREATE TABLE transfer_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES transfer_requests (id),
  event_type TEXT NOT NULL CHECK (event_type = 'transfer_approved'),
  created_at TEXT NOT NULL
);

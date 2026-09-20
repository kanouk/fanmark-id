-- Synthetic active->grace proof fixture only.
-- This is deliberately smaller than the source catalog and is not a deployable
-- fanmark.id schema or a claim of full-source schema parity.
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT
);

CREATE TABLE IF NOT EXISTS license_expiry_runs (
  run_id TEXT PRIMARY KEY,
  captured_now TEXT NOT NULL,
  grace_period_days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed')),
  last_license_id TEXT NOT NULL DEFAULT '',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  already_committed_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS license_expiry_run_items (
  run_id TEXT NOT NULL REFERENCES license_expiry_runs(run_id),
  license_id TEXT NOT NULL,
  fanmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  license_end TEXT NOT NULL,
  generation INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'processed', 'already_committed', 'conflict')),
  grace_expires_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, license_id)
);

CREATE TABLE IF NOT EXISTS fanmarks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'expired')),
  license_end TEXT,
  grace_expires_at TEXT,
  is_returned INTEGER NOT NULL DEFAULT 0 CHECK (is_returned IN (0, 1)),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  lifecycle_claim_id TEXT
);

CREATE INDEX IF NOT EXISTS fanmark_licenses_expiry_scan
  ON fanmark_licenses(status, license_end, generation);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  license_id TEXT NOT NULL,
  fanmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (license_id, generation, action)
);

CREATE TABLE IF NOT EXISTS lifecycle_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  license_id TEXT NOT NULL,
  fanmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  captured_now TEXT NOT NULL,
  run_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (license_id, generation, event_type)
);

-- Synthetic local fixture using current source-table names. It contains no
-- imported Supabase rows and is not a deployable migration.
PRAGMA foreign_keys = ON;

CREATE TABLE emoji_master (
  id TEXT PRIMARY KEY,
  codepoints TEXT NOT NULL
);

CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  user_input_fanmark TEXT NOT NULL,
  normalized_emoji TEXT NOT NULL,
  emoji_ids TEXT NOT NULL,
  normalized_emoji_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  tier_level INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  user_id TEXT,
  license_start TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  license_end TEXT,
  grace_expires_at TEXT,
  is_returned INTEGER NOT NULL DEFAULT 0,
  excluded_at TEXT,
  plan_excluded INTEGER,
  display_fanmark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lifecycle_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmark_basic_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  fanmark_name TEXT,
  access_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fanmark_redirect_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  target_url TEXT
);

CREATE TABLE fanmark_messageboard_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  content TEXT
);

CREATE TABLE fanmark_password_configs (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  access_password TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fanmark_profiles (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  social_links TEXT,
  theme_settings TEXT,
  is_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmark_license_incarnations (
  license_id TEXT PRIMARY KEY,
  incarnation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  license_incarnation INTEGER NOT NULL,
  password_generation INTEGER NOT NULL DEFAULT 0,
  access_generation INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE credential_transform_artifacts (
  artifact_id TEXT PRIMARY KEY,
  destination_license_id TEXT NOT NULL,
  destination_relation TEXT NOT NULL,
  destination_column TEXT NOT NULL,
  license_incarnation INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  codec_id TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE fanmark_access_proofs (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  finalization_id TEXT NOT NULL UNIQUE,
  selector_kind TEXT NOT NULL,
  selector_hash TEXT NOT NULL,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  password_generation INTEGER NOT NULL,
  access_generation INTEGER NOT NULL,
  license_incarnation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX fanmark_access_proofs_lookup_idx
  ON fanmark_access_proofs(token_hash, selector_kind, selector_hash);

CREATE TABLE fanmark_access_rate_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  window_ms INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  reservation_ms INTEGER NOT NULL
);
INSERT INTO fanmark_access_rate_policy VALUES (1, 300000, 5, 30000);

CREATE TABLE fanmark_access_rate_limits (
  bucket_kind TEXT NOT NULL CHECK (bucket_kind IN ('requester', 'resource')),
  bucket_hash TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  window_expires_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket_kind, bucket_hash)
);

CREATE TABLE fanmark_access_attempt_reservations (
  reservation_id TEXT PRIMARY KEY,
  requester_bucket_hash TEXT NOT NULL,
  resource_bucket_hash TEXT NOT NULL,
  license_id TEXT,
  selector_hash TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  reserved_at INTEGER NOT NULL,
  reservation_expires_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reserved', 'success', 'failure', 'expired', 'stale')),
  finalization_id TEXT,
  completed_at INTEGER
);

CREATE TABLE fanmark_access_attempt_audit (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  license_id TEXT,
  selector_hash TEXT,
  requester_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  password_generation INTEGER,
  access_generation INTEGER,
  license_incarnation INTEGER
);

CREATE UNIQUE INDEX fanmark_access_attempt_audit_once_idx
  ON fanmark_access_attempt_audit(reservation_id, outcome);

CREATE TRIGGER verified_access_license_insert_generations
AFTER INSERT ON fanmark_licenses
BEGIN
  INSERT OR IGNORE INTO fanmark_license_incarnations(license_id, incarnation)
  VALUES (new.id, 0);
  INSERT OR IGNORE INTO fanmark_access_versions
    (license_id, license_incarnation, password_generation, access_generation, updated_at)
  SELECT new.id, incarnation, 0, 0, 'license-insert'
  FROM fanmark_license_incarnations WHERE license_id = new.id;
END;

CREATE TRIGGER verified_access_license_delete_incarnation
AFTER DELETE ON fanmark_licenses
BEGIN
  INSERT INTO fanmark_license_incarnations(license_id, incarnation)
  VALUES (old.id, 1)
  ON CONFLICT(license_id) DO UPDATE SET incarnation = incarnation + 1;
END;

CREATE TRIGGER verified_access_password_generation
AFTER UPDATE OF license_id, access_password, is_enabled ON fanmark_password_configs
WHEN old.license_id IS NOT new.license_id
  OR old.access_password IS NOT new.access_password
  OR old.is_enabled IS NOT new.is_enabled
BEGIN
  UPDATE fanmark_access_versions
  SET password_generation = password_generation + 1,
      access_generation = access_generation + 1,
      updated_at = 'password-update'
  WHERE license_id IN (old.license_id, new.license_id);
END;

CREATE TRIGGER verified_access_profile_generation
AFTER UPDATE OF license_id, display_name, bio, social_links, theme_settings, is_public ON fanmark_profiles
WHEN old.license_id IS NOT new.license_id
  OR old.display_name IS NOT new.display_name
  OR old.bio IS NOT new.bio
  OR old.social_links IS NOT new.social_links
  OR old.theme_settings IS NOT new.theme_settings
  OR old.is_public IS NOT new.is_public
BEGIN
  UPDATE fanmark_access_versions
  SET access_generation = access_generation + 1, updated_at = 'profile-update'
  WHERE license_id IN (old.license_id, new.license_id);
END;

CREATE TRIGGER verified_access_reservation_guard
BEFORE INSERT ON fanmark_access_attempt_reservations
WHEN new.outcome = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'reservation blocked')
  WHERE NOT EXISTS (
    SELECT 1 FROM fanmark_access_rate_limits
    WHERE bucket_kind = 'requester' AND bucket_hash = new.requester_bucket_hash
      AND window_id = new.window_id
      AND attempt_count < (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
      AND (cooldown_until IS NULL OR cooldown_until <= new.reserved_at)
  ) OR NOT EXISTS (
    SELECT 1 FROM fanmark_access_rate_limits
    WHERE bucket_kind = 'resource' AND bucket_hash = new.resource_bucket_hash
      AND window_id = new.window_id
      AND attempt_count < (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
      AND (cooldown_until IS NULL OR cooldown_until <= new.reserved_at)
  ) OR new.reservation_expires_at <= new.reserved_at;
END;

CREATE TRIGGER verified_access_reservation_increment
AFTER INSERT ON fanmark_access_attempt_reservations
WHEN new.outcome = 'reserved'
BEGIN
  UPDATE fanmark_access_rate_limits
  SET attempt_count = attempt_count + 1, updated_at = new.reserved_at
  WHERE window_id = new.window_id
    AND ((bucket_kind = 'requester' AND bucket_hash = new.requester_bucket_hash)
      OR (bucket_kind = 'resource' AND bucket_hash = new.resource_bucket_hash));
END;

CREATE TRIGGER verified_access_reservation_success_guard
BEFORE UPDATE OF outcome ON fanmark_access_attempt_reservations
WHEN old.outcome = 'reserved' AND new.outcome = 'success'
  AND (new.completed_at IS NULL OR new.completed_at >= old.reservation_expires_at)
BEGIN
  SELECT RAISE(ABORT, 'reservation expired');
END;

CREATE TRIGGER verified_access_reservation_failure_increment
AFTER UPDATE OF outcome ON fanmark_access_attempt_reservations
WHEN old.outcome = 'reserved' AND new.outcome = 'failure'
BEGIN
  UPDATE fanmark_access_rate_limits
  SET failure_count = failure_count + 1,
      cooldown_until = MAX(COALESCE(cooldown_until, 0),
        CASE WHEN failure_count + 1 >= (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
          THEN new.completed_at + 60000 ELSE COALESCE(cooldown_until, 0) END),
      updated_at = new.completed_at
  WHERE window_id = old.window_id
    AND ((bucket_kind = 'requester' AND bucket_hash = old.requester_bucket_hash)
      OR (bucket_kind = 'resource' AND bucket_hash = old.resource_bucket_hash));
END;

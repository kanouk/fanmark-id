-- Local-only synthetic schema for the verified public-access proof.
-- It is deliberately separate from the default Better Auth migration.

PRAGMA foreign_keys = ON;

CREATE TABLE fanmarks (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  returned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  display_name TEXT NOT NULL
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  returned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE fanmark_access_configs (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  hash_scheme TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  access_type TEXT NOT NULL,
  target_url TEXT,
  text_content TEXT
);

CREATE TABLE fanmark_profiles (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  is_public INTEGER NOT NULL DEFAULT 0,
  profile_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  image_url TEXT NOT NULL
);

CREATE TABLE fanmark_emoji_selectors (
  selector_key TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id) ON DELETE CASCADE,
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id) ON DELETE CASCADE
);

-- A tombstone keeps a same-UUID license recreation from resetting the
-- lifecycle generation observed by an in-flight password comparison.
CREATE TABLE fanmark_license_incarnations (
  license_id TEXT PRIMARY KEY,
  incarnation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  password_generation INTEGER NOT NULL DEFAULT 0,
  lifecycle_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
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
  lifecycle_generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX fanmark_access_proofs_lookup_idx
  ON fanmark_access_proofs (token_hash, selector_kind, selector_hash);

CREATE TABLE fanmark_access_rate_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  window_ms INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  reservation_ms INTEGER NOT NULL
);

INSERT INTO fanmark_access_rate_policy (id, window_ms, max_attempts, reservation_ms)
VALUES (1, 300000, 5, 30000);

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

CREATE INDEX fanmark_access_attempt_reservations_window_idx
  ON fanmark_access_attempt_reservations (window_id, outcome);

CREATE TABLE fanmark_access_attempt_audit (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  license_id TEXT,
  selector_hash TEXT,
  requester_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  password_generation INTEGER,
  lifecycle_generation INTEGER
);

CREATE INDEX fanmark_access_attempt_audit_time_idx
  ON fanmark_access_attempt_audit (occurred_at);

CREATE UNIQUE INDEX fanmark_access_attempt_audit_once_idx
  ON fanmark_access_attempt_audit (reservation_id, outcome);

CREATE TRIGGER fanmark_access_license_insert_version
AFTER INSERT ON fanmark_licenses
BEGIN
  INSERT OR IGNORE INTO fanmark_access_versions
    (license_id, password_generation, lifecycle_generation, updated_at)
  VALUES (
    new.id,
    0,
    COALESCE((SELECT incarnation FROM fanmark_license_incarnations WHERE license_id = new.id), 0),
    'license-insert'
  );
END;

CREATE TRIGGER fanmark_access_license_delete_incarnation
AFTER DELETE ON fanmark_licenses
BEGIN
  INSERT INTO fanmark_license_incarnations (license_id, incarnation)
  VALUES (old.id, 1)
  ON CONFLICT (license_id) DO UPDATE SET incarnation = incarnation + 1;
END;

CREATE TRIGGER fanmark_access_config_password_generation_update
AFTER UPDATE OF license_id, enabled, hash_scheme, password_hash ON fanmark_access_configs
WHEN old.license_id IS NOT new.license_id
  OR old.enabled IS NOT new.enabled
  OR old.hash_scheme IS NOT new.hash_scheme
  OR old.password_hash IS NOT new.password_hash
BEGIN
  UPDATE fanmark_access_versions
  SET password_generation = password_generation + 1,
      updated_at = 'trigger'
  WHERE license_id IN (old.license_id, new.license_id);
  DELETE FROM fanmark_access_proofs
  WHERE license_id = old.license_id OR license_id = new.license_id;
END;

CREATE TRIGGER fanmark_access_config_lifecycle_generation_update
AFTER UPDATE OF license_id, access_type, target_url, text_content ON fanmark_access_configs
WHEN old.license_id IS NOT new.license_id
  OR old.access_type IS NOT new.access_type
  OR old.target_url IS NOT new.target_url
  OR old.text_content IS NOT new.text_content
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'trigger'
  WHERE license_id IN (old.license_id, new.license_id);
  DELETE FROM fanmark_access_proofs
  WHERE license_id = old.license_id OR license_id = new.license_id;
END;

CREATE TRIGGER fanmark_access_config_password_generation_delete
AFTER DELETE ON fanmark_access_configs
BEGIN
  UPDATE fanmark_access_versions
  SET password_generation = password_generation + 1,
      updated_at = 'trigger'
  WHERE license_id = old.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = old.license_id;
END;

CREATE TRIGGER fanmark_access_config_lifecycle_generation_delete
AFTER DELETE ON fanmark_access_configs
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'trigger'
  WHERE license_id = old.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = old.license_id;
END;

CREATE TRIGGER fanmark_access_license_lifecycle_update
AFTER UPDATE OF fanmark_id, status, returned, expires_at ON fanmark_licenses
WHEN old.fanmark_id IS NOT new.fanmark_id
  OR old.status IS NOT new.status
  OR old.returned IS NOT new.returned
  OR old.expires_at IS NOT new.expires_at
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'trigger'
  WHERE license_id IN (old.id, new.id);
  DELETE FROM fanmark_access_proofs
  WHERE license_id = old.id OR license_id = new.id;
END;

CREATE TRIGGER fanmark_access_fanmark_lifecycle_update
AFTER UPDATE OF status, returned, expires_at ON fanmarks
WHEN old.status IS NOT new.status
  OR old.returned IS NOT new.returned
  OR old.expires_at IS NOT new.expires_at
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'trigger'
  WHERE license_id IN (SELECT id FROM fanmark_licenses WHERE fanmark_id = new.id);
  DELETE FROM fanmark_access_proofs
  WHERE fanmark_id = new.id;
END;

CREATE TRIGGER fanmark_access_profile_lifecycle_update
AFTER UPDATE OF license_id, is_public, profile_name, bio, image_url ON fanmark_profiles
WHEN old.license_id IS NOT new.license_id
  OR old.is_public IS NOT new.is_public
  OR old.profile_name IS NOT new.profile_name
  OR old.bio IS NOT new.bio
  OR old.image_url IS NOT new.image_url
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'trigger'
  WHERE license_id IN (old.license_id, new.license_id);
  DELETE FROM fanmark_access_proofs
  WHERE license_id IN (old.license_id, new.license_id);
END;

CREATE TRIGGER fanmark_access_profile_lifecycle_insert
AFTER INSERT ON fanmark_profiles
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'profile-insert'
  WHERE license_id = new.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = new.license_id;
END;

CREATE TRIGGER fanmark_access_profile_lifecycle_delete
AFTER DELETE ON fanmark_profiles
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'profile-delete'
  WHERE license_id = old.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = old.license_id;
END;

CREATE TRIGGER fanmark_access_emoji_lifecycle_insert
AFTER INSERT ON fanmark_emoji_selectors
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'emoji-insert'
  WHERE license_id = new.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = new.license_id;
END;

CREATE TRIGGER fanmark_access_emoji_lifecycle_update
AFTER UPDATE OF selector_key, fanmark_id, license_id ON fanmark_emoji_selectors
WHEN old.selector_key IS NOT new.selector_key
  OR old.fanmark_id IS NOT new.fanmark_id
  OR old.license_id IS NOT new.license_id
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'emoji-update'
  WHERE license_id IN (old.license_id, new.license_id);
  DELETE FROM fanmark_access_proofs
  WHERE license_id IN (old.license_id, new.license_id);
END;

CREATE TRIGGER fanmark_access_emoji_lifecycle_delete
AFTER DELETE ON fanmark_emoji_selectors
BEGIN
  UPDATE fanmark_access_versions
  SET lifecycle_generation = lifecycle_generation + 1,
      updated_at = 'emoji-delete'
  WHERE license_id = old.license_id;
  DELETE FROM fanmark_access_proofs WHERE license_id = old.license_id;
END;

CREATE TRIGGER fanmark_access_reservation_guard
BEFORE INSERT ON fanmark_access_attempt_reservations
WHEN new.outcome = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'reservation blocked')
  WHERE NOT EXISTS (
    SELECT 1
    FROM fanmark_access_rate_limits
    WHERE bucket_kind = 'requester'
      AND bucket_hash = new.requester_bucket_hash
      AND window_id = new.window_id
      AND attempt_count < (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
      AND (cooldown_until IS NULL OR cooldown_until <= new.reserved_at)
  )
  OR NOT EXISTS (
    SELECT 1
    FROM fanmark_access_rate_limits
    WHERE bucket_kind = 'resource'
      AND bucket_hash = new.resource_bucket_hash
      AND window_id = new.window_id
      AND attempt_count < (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
      AND (cooldown_until IS NULL OR cooldown_until <= new.reserved_at)
  )
  OR new.reservation_expires_at <= new.reserved_at;
END;

CREATE TRIGGER fanmark_access_reservation_increment
AFTER INSERT ON fanmark_access_attempt_reservations
WHEN new.outcome = 'reserved'
BEGIN
  UPDATE fanmark_access_rate_limits
  SET attempt_count = attempt_count + 1,
      updated_at = new.reserved_at
  WHERE window_id = new.window_id
    AND ((bucket_kind = 'requester' AND bucket_hash = new.requester_bucket_hash)
      OR (bucket_kind = 'resource' AND bucket_hash = new.resource_bucket_hash));
END;

CREATE TRIGGER fanmark_access_reservation_success_guard
BEFORE UPDATE OF outcome ON fanmark_access_attempt_reservations
WHEN old.outcome = 'reserved'
  AND new.outcome = 'success'
  AND (new.completed_at IS NULL OR new.completed_at >= old.reservation_expires_at)
BEGIN
  SELECT RAISE(ABORT, 'reservation expired');
END;

CREATE TRIGGER fanmark_access_reservation_failure_increment
AFTER UPDATE OF outcome ON fanmark_access_attempt_reservations
WHEN old.outcome = 'reserved' AND new.outcome = 'failure'
BEGIN
  UPDATE fanmark_access_rate_limits
  SET failure_count = failure_count + 1,
      cooldown_until = MAX(
        COALESCE(cooldown_until, 0),
        CASE
          WHEN failure_count + 1 >= (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1)
          THEN new.completed_at + MIN(
            900000,
            60000 * (1 << MIN(failure_count + 1 - (SELECT max_attempts FROM fanmark_access_rate_policy WHERE id = 1), 4))
          )
          ELSE COALESCE(cooldown_until, 0)
        END
      ),
      updated_at = new.completed_at
  WHERE window_id = old.window_id
    AND ((bucket_kind = 'requester' AND bucket_hash = old.requester_bucket_hash)
      OR (bucket_kind = 'resource' AND bucket_hash = old.resource_bucket_hash));
END;

INSERT INTO fanmarks (id, short_id, status, returned, expires_at, display_name)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1111', 'active', 0, NULL, 'Profile Fanmark'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2222', 'active', 0, NULL, 'Redirect Fanmark'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '3333', 'active', 0, NULL, 'Emoji Fanmark'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '4444', 'active', 0, '2026-09-20T00:00:00.000000Z', 'Expired Fanmark');

INSERT INTO fanmark_licenses (id, fanmark_id, status, returned, expires_at, created_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', 0, NULL, '2026-09-20T00:00:00.000000Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'active', 0, NULL, '2026-09-20T00:00:00.000000Z'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'active', 0, NULL, '2026-09-20T00:00:00.000000Z'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 0, '2026-09-20T00:00:00.000000Z', '2026-09-20T00:00:00.000000Z');

INSERT INTO fanmark_access_configs
  (license_id, enabled, hash_scheme, password_hash, access_type, target_url, text_content)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 1, 'bcrypt', '$2b$10$IZQBPqwOQC21SCvJr9r00OSWTg.Zw7roFgAFFiVN51/tpzc7JPLiW', 'profile', NULL, NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', 1, 'bcrypt', '$2b$10$2cXhH7RnP1d4Cqi00xgC.OlFKQldGTaz0WYqquVNdo.a1TPA3yY3.', 'redirect', 'https://example.invalid/synthetic', NULL),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 1, 'bcrypt', '$2a$10$rf71f/KB6hHdLB14nIzeWuKj2lbEDfZ9WISSq75FtqCsozRG1HtJ2', 'text', NULL, 'Synthetic protected text'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01', 1, 'bcrypt', '$2b$10$EMIaSXLiF70qXWKgX4HYkuVEN64Td.KjBaV89Eef1aNvJCzvMe1qy', 'text', NULL, 'Expired protected text');

INSERT INTO fanmark_profiles (license_id, is_public, profile_name, bio, image_url)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 1, 'Synthetic Public Profile', 'Synthetic bio🙂', '');

INSERT INTO fanmark_emoji_selectors (selector_key, fanmark_id, license_id)
VALUES
  ('["10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"]', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01');

INSERT OR IGNORE INTO fanmark_access_versions (license_id, password_generation, lifecycle_generation, updated_at)
SELECT id, 0, 0, '2026-09-20T00:00:00.000000Z'
FROM fanmark_licenses;

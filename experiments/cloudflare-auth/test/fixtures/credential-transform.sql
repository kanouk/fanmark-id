-- Local-only synthetic schema for the credential transform proof.
-- It contains no source rows or production credentials.

PRAGMA foreign_keys = ON;

CREATE TABLE migration_targets (
  target_identity TEXT PRIMARY KEY,
  target_incarnation TEXT NOT NULL
);

CREATE TABLE fanmark_licenses (
  id TEXT PRIMARY KEY,
  fanmark_id TEXT NOT NULL,
  status TEXT NOT NULL,
  returned INTEGER NOT NULL DEFAULT 0 CHECK (returned IN (0, 1))
);

CREATE TABLE fanmark_license_incarnations (
  license_id TEXT PRIMARY KEY,
  incarnation INTEGER NOT NULL CHECK (incarnation >= 0)
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  password_generation INTEGER NOT NULL DEFAULT 0,
  lifecycle_generation INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE fanmark_access_configs (
  license_id TEXT PRIMARY KEY REFERENCES fanmark_licenses(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  hash_scheme TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  source_binding_digest TEXT NOT NULL,
  destination_transform_digest TEXT NOT NULL UNIQUE
);

CREATE TABLE credential_transform_artifacts (
  artifact_id TEXT PRIMARY KEY,
  artifact_key TEXT NOT NULL UNIQUE,
  source_identity_digest TEXT NOT NULL UNIQUE,
  source_binding_digest TEXT NOT NULL,
  source_manifest_digest TEXT NOT NULL,
  source_relation TEXT NOT NULL,
  source_primary_key TEXT NOT NULL,
  source_envelope_digest TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  target_identity TEXT NOT NULL,
  target_incarnation TEXT NOT NULL,
  -- Deliberately no FK: the immutable artifact must survive a license
  -- delete/recreate so a stale fence cannot match the new incarnation.
  destination_license_id TEXT NOT NULL,
  license_incarnation INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  codec_id TEXT NOT NULL,
  codec_cost INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  destination_hash TEXT,
  destination_transform_digest TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'prepared', 'applied', 'reconciled', 'rejected')),
  lease_id TEXT,
  lease_expires_at INTEGER,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  expected_password_generation INTEGER NOT NULL,
  expected_lifecycle_generation INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  prepared_at INTEGER,
  applied_at INTEGER,
  reconciled_at INTEGER,
  failure_code TEXT
);

CREATE INDEX credential_transform_artifacts_target_idx
  ON credential_transform_artifacts (target_identity, destination_license_id, state);

-- A failed guard raises inside the same D1 batch. This prevents a zero-row
-- authorization update from allowing later statements to commit.
CREATE TABLE credential_transform_apply_guards (
  request_id TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1))
);

CREATE TRIGGER credential_transform_apply_guard_check
BEFORE INSERT ON credential_transform_apply_guards
WHEN new.allowed <> 1
BEGIN
  SELECT RAISE(ABORT, 'transform apply denied');
END;

-- Test-only fault injection for proving D1 batch rollback. The core never
-- exposes this table or accepts its value from a request.
CREATE TABLE credential_transform_faults (
  id TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value = 0)
);

CREATE TRIGGER fanmark_license_insert_version
AFTER INSERT ON fanmark_licenses
BEGIN
  INSERT OR IGNORE INTO fanmark_access_versions
    (license_id, password_generation, lifecycle_generation, updated_at)
  VALUES (
    new.id,
    0,
    0,
    0
  );
END;

CREATE TRIGGER fanmark_license_delete_incarnation
AFTER DELETE ON fanmark_licenses
BEGIN
  INSERT INTO fanmark_license_incarnations (license_id, incarnation)
  VALUES (old.id, 1)
  ON CONFLICT (license_id) DO UPDATE SET incarnation = incarnation + 1;
END;

INSERT INTO migration_targets (target_identity, target_incarnation)
VALUES ('local-credential-transform', 'synthetic-target-incarnation-1');

INSERT INTO fanmark_licenses (id, fanmark_id, status, returned)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fanmark-synthetic', 'active', 0);

INSERT INTO fanmark_license_incarnations (license_id, incarnation)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1);

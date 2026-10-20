-- Versioned, non-user reference masters imported from an explicit allowlist.
-- Public views expose only the currently activated, fully verified release.
CREATE TABLE fanmark_reference_master_releases (
  release_version TEXT PRIMARY KEY NOT NULL
    CHECK (length(release_version) = 64 AND release_version NOT GLOB '*[^0-9a-f]*'),
  source_snapshot_sha256 TEXT NOT NULL
    CHECK (length(source_snapshot_sha256) = 64 AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  status TEXT NOT NULL CHECK (status IN ('loading', 'ready', 'failed')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  verified_at TEXT
);

CREATE TABLE fanmark_reference_master_release_tables (
  release_version TEXT NOT NULL,
  table_name TEXT NOT NULL CHECK (table_name IN (
    'fanmark_tiers', 'languages', 'reserved_emoji_patterns'
  )),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  source_sha256 TEXT NOT NULL
    CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (release_version, table_name),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE
);

CREATE TRIGGER fanmark_reference_release_insert_guard
BEFORE INSERT ON fanmark_reference_master_releases
WHEN NEW.status <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_must_start_loading');
END;

CREATE TABLE fanmark_tier_release_rows (
  release_version TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  description TEXT,
  display_name TEXT NOT NULL,
  emoji_count_max INTEGER NOT NULL,
  emoji_count_min INTEGER NOT NULL,
  initial_license_days INTEGER,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  monthly_price_cents INTEGER NOT NULL
    CHECK (monthly_price_cents BETWEEN -9999999999 AND 9999999999),
  tier_level INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, tier_level),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE
);

CREATE TABLE fanmark_language_release_rows (
  release_version TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  id TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  label TEXT NOT NULL,
  native_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (release_version, code),
  UNIQUE (release_version, id),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE
);

CREATE TABLE fanmark_reserved_emoji_pattern_release_rows (
  release_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  description TEXT,
  id TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  pattern TEXT NOT NULL,
  price_yen INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, pattern),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE
);

CREATE TABLE fanmark_reference_master_release_activations (
  activation_id TEXT PRIMARY KEY NOT NULL,
  generation INTEGER NOT NULL UNIQUE CHECK (generation > 0),
  action TEXT NOT NULL CHECK (action IN ('promotion', 'rollback')),
  from_version TEXT,
  to_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (from_version)
    REFERENCES fanmark_reference_master_releases (release_version),
  FOREIGN KEY (to_version)
    REFERENCES fanmark_reference_master_releases (release_version),
  CHECK (from_version IS NULL OR from_version <> to_version)
);

CREATE TABLE fanmark_reference_master_active_release (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  release_version TEXT NOT NULL,
  previous_release_version TEXT,
  activation_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN ('promotion', 'rollback')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version),
  FOREIGN KEY (previous_release_version)
    REFERENCES fanmark_reference_master_releases (release_version)
);

CREATE TRIGGER fanmark_reference_ready_tier_insert
BEFORE INSERT ON fanmark_tier_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_not_loading');
END;
CREATE TRIGGER fanmark_reference_ready_tier_update
BEFORE UPDATE ON fanmark_tier_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
  OR COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;
CREATE TRIGGER fanmark_reference_ready_tier_delete
BEFORE DELETE ON fanmark_tier_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;

CREATE TRIGGER fanmark_reference_ready_language_insert
BEFORE INSERT ON fanmark_language_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_not_loading');
END;
CREATE TRIGGER fanmark_reference_ready_language_update
BEFORE UPDATE ON fanmark_language_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
  OR COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;
CREATE TRIGGER fanmark_reference_ready_language_delete
BEFORE DELETE ON fanmark_language_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;

CREATE TRIGGER fanmark_reference_ready_pattern_insert
BEFORE INSERT ON fanmark_reserved_emoji_pattern_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_not_loading');
END;
CREATE TRIGGER fanmark_reference_ready_pattern_update
BEFORE UPDATE ON fanmark_reserved_emoji_pattern_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
  OR COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;
CREATE TRIGGER fanmark_reference_ready_pattern_delete
BEFORE DELETE ON fanmark_reserved_emoji_pattern_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;

CREATE TRIGGER fanmark_reference_release_metadata_update_guard
BEFORE UPDATE ON fanmark_reference_master_releases
BEGIN
  SELECT RAISE(ABORT, 'reference_release_metadata_immutable')
    WHERE OLD.status <> 'loading'
      OR NEW.release_version <> OLD.release_version
      OR NEW.source_snapshot_sha256 <> OLD.source_snapshot_sha256
      OR NEW.manifest_json <> OLD.manifest_json
      OR NEW.created_at <> OLD.created_at
      OR (NEW.status NOT IN ('ready', 'failed'));
  SELECT RAISE(ABORT, 'reference_release_rows_incomplete')
    WHERE NEW.status = 'ready' AND (
      (SELECT count(*) FROM fanmark_reference_master_release_tables
       WHERE release_version = OLD.release_version) <> 3
      OR COALESCE((SELECT row_count FROM fanmark_reference_master_release_tables
        WHERE release_version = OLD.release_version AND table_name = 'fanmark_tiers'), -1)
        <> (SELECT count(*) FROM fanmark_tier_release_rows WHERE release_version = OLD.release_version)
      OR COALESCE((SELECT row_count FROM fanmark_reference_master_release_tables
        WHERE release_version = OLD.release_version AND table_name = 'languages'), -1)
        <> (SELECT count(*) FROM fanmark_language_release_rows WHERE release_version = OLD.release_version)
      OR COALESCE((SELECT row_count FROM fanmark_reference_master_release_tables
        WHERE release_version = OLD.release_version AND table_name = 'reserved_emoji_patterns'), -1)
        <> (SELECT count(*) FROM fanmark_reserved_emoji_pattern_release_rows WHERE release_version = OLD.release_version)
    );
END;

CREATE TRIGGER fanmark_reference_release_metadata_no_delete
BEFORE DELETE ON fanmark_reference_master_releases
WHEN OLD.status <> 'loading' OR EXISTS (
  SELECT 1 FROM fanmark_reference_master_active_release
  WHERE release_version = OLD.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'reference_release_metadata_immutable');
END;

CREATE TRIGGER fanmark_reference_release_table_update_guard
BEFORE UPDATE ON fanmark_reference_master_release_tables
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;
CREATE TRIGGER fanmark_reference_release_table_delete_guard
BEFORE DELETE ON fanmark_reference_master_release_tables
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;
CREATE TRIGGER fanmark_reference_release_table_insert_guard
BEFORE INSERT ON fanmark_reference_master_release_tables
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;

CREATE TRIGGER fanmark_reference_active_insert_guard
BEFORE INSERT ON fanmark_reference_master_active_release
BEGIN
  SELECT RAISE(ABORT, 'reference_release_generation_conflict') WHERE NEW.generation <> 1;
  SELECT RAISE(ABORT, 'reference_release_not_ready') WHERE COALESCE((
    SELECT status FROM fanmark_reference_master_releases
    WHERE release_version = NEW.release_version
  ), '') <> 'ready';
  SELECT RAISE(ABORT, 'reference_release_manifest_incomplete') WHERE (
    SELECT count(*) FROM fanmark_reference_master_release_tables
    WHERE release_version = NEW.release_version
  ) <> 3;
  SELECT RAISE(ABORT, 'reference_release_initial_activation_invalid')
    WHERE NEW.action <> 'promotion' OR NEW.previous_release_version IS NOT NULL;
END;

CREATE TRIGGER fanmark_reference_active_update_guard
BEFORE UPDATE ON fanmark_reference_master_active_release
BEGIN
  SELECT RAISE(ABORT, 'reference_release_singleton_conflict') WHERE NEW.singleton_id <> OLD.singleton_id;
  SELECT RAISE(ABORT, 'reference_release_same_version') WHERE NEW.release_version = OLD.release_version;
  SELECT RAISE(ABORT, 'reference_release_previous_version_conflict')
    WHERE NEW.previous_release_version IS NOT OLD.release_version;
  SELECT RAISE(ABORT, 'reference_release_generation_conflict') WHERE NEW.generation <> OLD.generation + 1;
  SELECT RAISE(ABORT, 'reference_release_not_ready') WHERE COALESCE((
    SELECT status FROM fanmark_reference_master_releases
    WHERE release_version = NEW.release_version
  ), '') <> 'ready';
  SELECT RAISE(ABORT, 'reference_release_manifest_incomplete') WHERE (
    SELECT count(*) FROM fanmark_reference_master_release_tables
    WHERE release_version = NEW.release_version
  ) <> 3;
END;
CREATE TRIGGER fanmark_reference_active_no_delete
BEFORE DELETE ON fanmark_reference_master_active_release
BEGIN
  SELECT RAISE(ABORT, 'reference_release_active_pointer_immutable');
END;

CREATE TRIGGER fanmark_reference_active_insert_audit
AFTER INSERT ON fanmark_reference_master_active_release
BEGIN
  INSERT INTO fanmark_reference_master_release_activations
    (activation_id, generation, action, from_version, to_version)
  VALUES (NEW.activation_id, NEW.generation, NEW.action, NULL, NEW.release_version);
END;
CREATE TRIGGER fanmark_reference_active_update_audit
AFTER UPDATE ON fanmark_reference_master_active_release
BEGIN
  INSERT INTO fanmark_reference_master_release_activations
    (activation_id, generation, action, from_version, to_version)
  VALUES (NEW.activation_id, NEW.generation, NEW.action, OLD.release_version, NEW.release_version);
END;
CREATE TRIGGER fanmark_reference_activation_insert_guard
BEFORE INSERT ON fanmark_reference_master_release_activations
WHEN NOT EXISTS (
  SELECT 1 FROM fanmark_reference_master_active_release
  WHERE singleton_id = 1 AND activation_id = NEW.activation_id
    AND generation = NEW.generation AND action = NEW.action
    AND previous_release_version IS NEW.from_version AND release_version = NEW.to_version
)
BEGIN
  SELECT RAISE(ABORT, 'reference_release_activation_not_current');
END;
CREATE TRIGGER fanmark_reference_activation_no_update
BEFORE UPDATE ON fanmark_reference_master_release_activations
BEGIN
  SELECT RAISE(ABORT, 'reference_release_activation_immutable');
END;
CREATE TRIGGER fanmark_reference_activation_no_delete
BEFORE DELETE ON fanmark_reference_master_release_activations
BEGIN
  SELECT RAISE(ABORT, 'reference_release_activation_immutable');
END;

CREATE VIEW fanmark_tiers AS
SELECT r.id, r.created_at, r.description, r.display_name, r.emoji_count_max,
       r.emoji_count_min, r.initial_license_days, r.is_active,
       r.monthly_price_cents AS monthly_price_usd, r.tier_level, r.updated_at
FROM fanmark_tier_release_rows AS r
JOIN fanmark_reference_master_active_release AS a
  ON a.singleton_id = 1 AND a.release_version = r.release_version;

CREATE VIEW languages AS
SELECT r.code, r.created_at, r.id, r.is_active, r.label, r.native_label,
       r.sort_order, r.updated_at
FROM fanmark_language_release_rows AS r
JOIN fanmark_reference_master_active_release AS a
  ON a.singleton_id = 1 AND a.release_version = r.release_version;

CREATE VIEW reserved_emoji_patterns AS
SELECT r.created_at, r.description, r.id, r.is_active, r.pattern, r.price_yen, r.updated_at
FROM fanmark_reserved_emoji_pattern_release_rows AS r
JOIN fanmark_reference_master_active_release AS a
  ON a.singleton_id = 1 AND a.release_version = r.release_version;

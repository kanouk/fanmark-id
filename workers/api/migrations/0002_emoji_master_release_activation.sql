-- The active pointer changes atomically; a ready version is immutable.
CREATE TABLE fanmark_emoji_master_release_activations (
  activation_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL UNIQUE CHECK (generation > 0),
  action TEXT NOT NULL CHECK (action IN ('promotion', 'rollback')),
  from_version TEXT,
  to_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (from_version)
    REFERENCES fanmark_emoji_master_release_imports (release_version),
  FOREIGN KEY (to_version)
    REFERENCES fanmark_emoji_master_release_imports (release_version),
  CHECK (from_version IS NULL OR from_version <> to_version)
);

CREATE TABLE fanmark_emoji_master_active_release (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  release_version TEXT NOT NULL,
  previous_release_version TEXT,
  activation_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN ('promotion', 'rollback')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_emoji_master_release_imports (release_version),
  FOREIGN KEY (previous_release_version)
    REFERENCES fanmark_emoji_master_release_imports (release_version)
);

CREATE TRIGGER fanmark_emoji_ready_staging_immutable_insert
BEFORE INSERT ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_release_imports
  WHERE release_version = NEW.release_version AND status = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_ready_immutable');
END;

CREATE TRIGGER fanmark_emoji_ready_staging_immutable_update
BEFORE UPDATE ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_release_imports
  WHERE release_version = OLD.release_version AND status = 'ready'
) OR EXISTS (
  SELECT 1 FROM fanmark_emoji_master_release_imports
  WHERE release_version = NEW.release_version AND status = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_ready_immutable');
END;

CREATE TRIGGER fanmark_emoji_ready_staging_immutable_delete
BEFORE DELETE ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_release_imports
  WHERE release_version = OLD.release_version AND status = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_ready_immutable');
END;

CREATE TRIGGER fanmark_emoji_ready_import_metadata_immutable
BEFORE UPDATE ON fanmark_emoji_master_release_imports
WHEN OLD.status = 'ready' AND (
  NEW.release_version IS NOT OLD.release_version OR
  NEW.manifest_json IS NOT OLD.manifest_json OR
  NEW.row_count <> OLD.row_count OR
  (NEW.status <> OLD.status AND NEW.status <> 'failed')
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_ready_immutable');
END;

CREATE TRIGGER fanmark_emoji_ready_import_no_delete
BEFORE DELETE ON fanmark_emoji_master_release_imports
WHEN OLD.status = 'ready' OR EXISTS (
  SELECT 1 FROM fanmark_emoji_master_release_activations
  WHERE to_version = OLD.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_ready_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_release_insert_guard
BEFORE INSERT ON fanmark_emoji_master_active_release
BEGIN
  SELECT CASE WHEN NEW.generation <> 1
    THEN RAISE(ABORT, 'emoji_release_generation_conflict') END;
  SELECT CASE WHEN COALESCE((
    SELECT status FROM fanmark_emoji_master_release_imports
    WHERE release_version = NEW.release_version
  ), '') <> 'ready'
    THEN RAISE(ABORT, 'emoji_release_not_ready') END;
  SELECT CASE WHEN (
    SELECT row_count FROM fanmark_emoji_master_release_imports
    WHERE release_version = NEW.release_version
  ) <> (
    SELECT count(*) FROM fanmark_emoji_master_release_staging
    WHERE release_version = NEW.release_version
  ) THEN RAISE(ABORT, 'emoji_release_row_count_mismatch') END;
  SELECT CASE WHEN NEW.action <> 'promotion' OR NEW.previous_release_version IS NOT NULL
    THEN RAISE(ABORT, 'emoji_release_initial_activation_invalid') END;
END;

CREATE TRIGGER fanmark_emoji_active_release_update_guard
BEFORE UPDATE ON fanmark_emoji_master_active_release
BEGIN
  SELECT CASE WHEN NEW.singleton_id <> OLD.singleton_id
    THEN RAISE(ABORT, 'emoji_release_singleton_conflict') END;
  SELECT CASE WHEN NEW.release_version = OLD.release_version
    THEN RAISE(ABORT, 'emoji_release_same_version') END;
  SELECT CASE WHEN NEW.previous_release_version IS NOT OLD.release_version
    THEN RAISE(ABORT, 'emoji_release_previous_version_conflict') END;
  SELECT CASE WHEN NEW.generation <> OLD.generation + 1
    THEN RAISE(ABORT, 'emoji_release_generation_conflict') END;
  SELECT CASE WHEN COALESCE((
    SELECT status FROM fanmark_emoji_master_release_imports
    WHERE release_version = NEW.release_version
  ), '') <> 'ready'
    THEN RAISE(ABORT, 'emoji_release_not_ready') END;
  SELECT CASE WHEN (
    SELECT row_count FROM fanmark_emoji_master_release_imports
    WHERE release_version = NEW.release_version
  ) <> (
    SELECT count(*) FROM fanmark_emoji_master_release_staging
    WHERE release_version = NEW.release_version
  ) THEN RAISE(ABORT, 'emoji_release_row_count_mismatch') END;
  SELECT CASE WHEN NEW.action = 'rollback' AND NOT EXISTS (
    SELECT 1 FROM fanmark_emoji_master_release_activations
    WHERE to_version = NEW.release_version
  ) THEN RAISE(ABORT, 'emoji_release_rollback_target_unknown') END;
END;

CREATE TRIGGER fanmark_emoji_active_release_no_delete
BEFORE DELETE ON fanmark_emoji_master_active_release
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_active_pointer_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_release_insert_audit
AFTER INSERT ON fanmark_emoji_master_active_release
BEGIN
  INSERT INTO fanmark_emoji_master_release_activations
    (activation_id, generation, action, from_version, to_version)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, NULL, NEW.release_version);
END;

CREATE TRIGGER fanmark_emoji_active_release_update_audit
AFTER UPDATE ON fanmark_emoji_master_active_release
BEGIN
  INSERT INTO fanmark_emoji_master_release_activations
    (activation_id, generation, action, from_version, to_version)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, OLD.release_version, NEW.release_version);
END;

CREATE TRIGGER fanmark_emoji_activation_insert_guard
BEFORE INSERT ON fanmark_emoji_master_release_activations
WHEN NOT EXISTS (
  SELECT 1 FROM fanmark_emoji_master_active_release
  WHERE singleton_id = 1
    AND activation_id = NEW.activation_id
    AND generation = NEW.generation
    AND action = NEW.action
    AND previous_release_version IS NEW.from_version
    AND release_version = NEW.to_version
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_activation_not_current');
END;

CREATE TRIGGER fanmark_emoji_activation_immutable_update
BEFORE UPDATE ON fanmark_emoji_master_release_activations
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_activation_immutable');
END;

CREATE TRIGGER fanmark_emoji_activation_immutable_delete
BEFORE DELETE ON fanmark_emoji_master_release_activations
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_activation_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_staging_immutable_insert
BEFORE INSERT ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_active_release
  WHERE release_version = NEW.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_active_data_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_staging_immutable_update
BEFORE UPDATE ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_active_release
  WHERE release_version = OLD.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_active_data_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_staging_immutable_delete
BEFORE DELETE ON fanmark_emoji_master_release_staging
WHEN EXISTS (
  SELECT 1 FROM fanmark_emoji_master_active_release
  WHERE release_version = OLD.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_active_data_immutable');
END;

CREATE TRIGGER fanmark_emoji_active_import_immutable
BEFORE UPDATE ON fanmark_emoji_master_release_imports
WHEN OLD.release_version = (
  SELECT release_version FROM fanmark_emoji_master_active_release WHERE singleton_id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_release_active_data_immutable');
END;

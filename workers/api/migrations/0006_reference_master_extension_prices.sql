-- Versioned non-user extension-price master rows, bound to the same active
-- reference release as tiers, languages, and reserved emoji patterns.
CREATE TABLE fanmark_reference_master_extension_price_manifests (
  release_version TEXT PRIMARY KEY NOT NULL
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  source_sha256 TEXT NOT NULL
    CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')
);

CREATE TABLE fanmark_extension_price_release_rows (
  release_version TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 120),
  price_yen INTEGER NOT NULL CHECK (price_yen BETWEEN 0 AND 2147483647),
  stripe_price_id TEXT,
  stripe_price_id_live TEXT,
  tier_level INTEGER NOT NULL CHECK (tier_level BETWEEN 1 AND 4),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (release_version, id),
  UNIQUE (release_version, tier_level, months),
  FOREIGN KEY (release_version)
    REFERENCES fanmark_reference_master_releases (release_version) ON DELETE CASCADE
);

CREATE TRIGGER fanmark_reference_extension_price_manifest_insert_guard
BEFORE INSERT ON fanmark_reference_master_extension_price_manifests
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;
CREATE TRIGGER fanmark_reference_extension_price_manifest_update_guard
BEFORE UPDATE ON fanmark_reference_master_extension_price_manifests
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;
CREATE TRIGGER fanmark_reference_extension_price_manifest_delete_guard
BEFORE DELETE ON fanmark_reference_master_extension_price_manifests
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_manifest_immutable');
END;

CREATE TRIGGER fanmark_reference_extension_price_insert_guard
BEFORE INSERT ON fanmark_extension_price_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_not_loading');
END;
CREATE TRIGGER fanmark_reference_extension_price_update_guard
BEFORE UPDATE ON fanmark_extension_price_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
  OR COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = NEW.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;
CREATE TRIGGER fanmark_reference_extension_price_delete_guard
BEFORE DELETE ON fanmark_extension_price_release_rows
WHEN COALESCE((SELECT status FROM fanmark_reference_master_releases
  WHERE release_version = OLD.release_version), '') <> 'loading'
BEGIN
  SELECT RAISE(ABORT, 'reference_release_rows_immutable');
END;

CREATE TRIGGER fanmark_reference_extension_price_ready_guard
BEFORE UPDATE OF status ON fanmark_reference_master_releases
WHEN NEW.status = 'ready' AND (
  COALESCE((SELECT count(*) FROM fanmark_reference_master_extension_price_manifests
    WHERE release_version = OLD.release_version), 0) <> 1
  OR COALESCE((SELECT row_count FROM fanmark_reference_master_extension_price_manifests
    WHERE release_version = OLD.release_version), -1)
    <> (SELECT count(*) FROM fanmark_extension_price_release_rows
        WHERE release_version = OLD.release_version)
)
BEGIN
  SELECT RAISE(ABORT, 'reference_release_extension_prices_incomplete');
END;

CREATE VIEW fanmark_tier_extension_prices AS
SELECT r.id, r.tier_level, r.months, r.price_yen, r.is_active
FROM fanmark_reference_master_active_release AS a
JOIN fanmark_reference_master_releases AS release
  ON release.release_version = a.release_version AND release.status = 'ready'
JOIN fanmark_reference_master_extension_price_manifests AS manifest
  ON manifest.release_version = a.release_version
JOIN fanmark_extension_price_release_rows AS r
  ON r.release_version = a.release_version
WHERE a.singleton_id = 1 AND manifest.row_count = (
  SELECT count(*) FROM fanmark_extension_price_release_rows
  WHERE release_version = a.release_version
);

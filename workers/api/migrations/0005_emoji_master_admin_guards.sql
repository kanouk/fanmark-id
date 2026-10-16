-- Keep published emoji identities stable while allowing private canonical drafts.
-- Public catalog versions remain immutable and are promoted separately.
CREATE TRIGGER emoji_master_released_identity_guard
BEFORE UPDATE OF id, emoji, codepoints ON emoji_master
WHEN EXISTS (
  SELECT 1
  FROM fanmark_emoji_master_release_staging AS released
  JOIN fanmark_emoji_master_release_imports AS release
    ON release.release_version = released.release_version
  WHERE release.status = 'ready'
    AND released.id = OLD.id
    AND (
      NEW.id <> released.id OR
      NEW.emoji <> released.emoji OR
      NEW.codepoints <> released.codepoints_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_master_released_identity_immutable');
END;

CREATE TRIGGER emoji_master_released_identity_delete_guard
BEFORE DELETE ON emoji_master
WHEN EXISTS (
  SELECT 1
  FROM fanmark_emoji_master_release_staging AS released
  JOIN fanmark_emoji_master_release_imports AS release
    ON release.release_version = released.release_version
  WHERE release.status = 'ready'
    AND released.id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'emoji_master_released_identity_immutable');
END;

-- Preserve link_fanmark_discovery_trigger for all new fanmark writers.
-- Ordered typed UUID values match PostgreSQL array_to_string semantics:
-- canonicalize case and omit NULL elements; whitespace in JSON is immaterial.
CREATE TRIGGER fanmark_link_discovery_after_insert
AFTER INSERT ON fanmarks
WHEN NEW.normalized_emoji_ids IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'fanmark_discovery_identity_conflict')
  WHERE (SELECT count(*) FROM fanmark_discoveries discovery WHERE COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(discovery.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') = COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(NEW.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '')) > 1;

  UPDATE fanmark_discoveries AS discovery
  SET fanmark_id = NEW.id, availability_status = 'owned_by_user'
  WHERE COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(discovery.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') = COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(NEW.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '');

  UPDATE fanmark_favorites
  SET fanmark_id = NEW.id
  WHERE discovery_id IN (SELECT discovery.id FROM fanmark_discoveries discovery WHERE COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(discovery.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') = COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(NEW.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), ''));

  SELECT RAISE(ABORT, 'fanmark_discovery_link_required')
  WHERE EXISTS (SELECT 1 FROM fanmark_discoveries discovery
    WHERE COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(discovery.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') = COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(NEW.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '')
      AND (discovery.fanmark_id IS NOT NEW.id OR discovery.availability_status <> 'owned_by_user'))
    OR EXISTS (SELECT 1 FROM fanmark_favorites favorite
      JOIN fanmark_discoveries discovery ON discovery.id = favorite.discovery_id
      WHERE COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(discovery.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') = COALESCE((SELECT group_concat(identity, ',') FROM (SELECT lower(CAST(value AS TEXT)) AS identity FROM json_each(NEW.normalized_emoji_ids) WHERE type <> 'null' ORDER BY key)), '') AND favorite.fanmark_id IS NOT NEW.id);
END;

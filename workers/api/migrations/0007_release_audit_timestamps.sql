-- Keep derived activation audit timestamps aligned with the canonical D1 write timestamp.
DROP TRIGGER IF EXISTS fanmark_emoji_active_release_insert_audit;
DROP TRIGGER IF EXISTS fanmark_emoji_active_release_update_audit;
DROP TRIGGER IF EXISTS fanmark_reference_active_insert_audit;
DROP TRIGGER IF EXISTS fanmark_reference_active_update_audit;

CREATE TRIGGER fanmark_emoji_active_release_insert_audit
AFTER INSERT ON fanmark_emoji_master_active_release
BEGIN
  INSERT INTO fanmark_emoji_master_release_activations
    (activation_id, generation, action, from_version, to_version, created_at)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, NULL, NEW.release_version, NEW.updated_at);
END;

CREATE TRIGGER fanmark_emoji_active_release_update_audit
AFTER UPDATE ON fanmark_emoji_master_active_release
BEGIN
  INSERT INTO fanmark_emoji_master_release_activations
    (activation_id, generation, action, from_version, to_version, created_at)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, OLD.release_version, NEW.release_version, NEW.updated_at);
END;

CREATE TRIGGER fanmark_reference_active_insert_audit
AFTER INSERT ON fanmark_reference_master_active_release
BEGIN
  INSERT INTO fanmark_reference_master_release_activations
    (activation_id, generation, action, from_version, to_version, created_at)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, NULL, NEW.release_version, NEW.updated_at);
END;

CREATE TRIGGER fanmark_reference_active_update_audit
AFTER UPDATE ON fanmark_reference_master_active_release
BEGIN
  INSERT INTO fanmark_reference_master_release_activations
    (activation_id, generation, action, from_version, to_version, created_at)
  VALUES
    (NEW.activation_id, NEW.generation, NEW.action, OLD.release_version, NEW.release_version, NEW.updated_at);
END;

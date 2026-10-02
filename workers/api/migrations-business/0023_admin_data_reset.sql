-- Atomic counterpart of reset-fanmark-data. Applies schema only.
-- Existing restrictive history FKs remain protective; no history is discarded
-- merely to let a reset succeed. License incarnation tombstones stay monotonic.
CREATE TABLE admin_data_reset_commands (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 256),
  audit_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  counts_json TEXT CHECK (counts_json IS NULL OR json_valid(counts_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json))
);

CREATE TRIGGER admin_data_reset_apply
AFTER INSERT ON admin_data_reset_commands
BEGIN
  SELECT RAISE(ABORT, 'admin_data_reset_invalid_command')
    WHERE NEW.result_json IS NOT NULL OR NEW.counts_json IS NOT NULL;
  UPDATE admin_data_reset_commands SET counts_json = json_object(
      'fanmark_basic_configs', (SELECT count(*) FROM fanmark_basic_configs WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_redirect_configs', (SELECT count(*) FROM fanmark_redirect_configs WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_messageboard_configs', (SELECT count(*) FROM fanmark_messageboard_configs WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_password_configs', (SELECT count(*) FROM fanmark_password_configs WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_profiles', (SELECT count(*) FROM fanmark_profiles WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_favorites', (SELECT count(*) FROM fanmark_favorites WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmark_licenses', (SELECT count(*) FROM fanmark_licenses WHERE id <> '00000000-0000-0000-0000-000000000000'),
      'fanmarks', (SELECT count(*) FROM fanmarks WHERE id <> '00000000-0000-0000-0000-000000000000')
  ) WHERE request_id = NEW.request_id;
  DELETE FROM fanmark_basic_configs WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_redirect_configs WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_messageboard_configs WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_password_configs WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_profiles WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_favorites WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmark_licenses WHERE id <> '00000000-0000-0000-0000-000000000000';
  DELETE FROM fanmarks WHERE id <> '00000000-0000-0000-0000-000000000000';
  SELECT RAISE(ABORT, 'admin_data_reset_incomplete') WHERE
    EXISTS (SELECT 1 FROM fanmark_basic_configs WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_redirect_configs WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_messageboard_configs WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_password_configs WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_profiles WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_favorites WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmark_licenses WHERE id <> '00000000-0000-0000-0000-000000000000') OR
    EXISTS (SELECT 1 FROM fanmarks WHERE id <> '00000000-0000-0000-0000-000000000000');
  UPDATE admin_data_reset_commands SET result_json = json_object(
    'success', json('true'), 'deletedCounts', json(counts_json),
    'totalDeleted', (SELECT sum(value) FROM json_each(counts_json))
  ) WHERE request_id = NEW.request_id;
  INSERT INTO audit_logs (id, user_id, action, resource_type, request_id, metadata, created_at)
    SELECT NEW.audit_id, NEW.actor_user_id, 'ADMIN_DATA_RESET', 'system', NEW.request_id,
      json_object('timestamp', NEW.created_at,
        'deletedCounts', json_extract(result_json, '$.deletedCounts'),
        'totalDeleted', json_extract(result_json, '$.totalDeleted'),
        'security_level', 'ADMIN_VERIFIED'), NEW.created_at
    FROM admin_data_reset_commands WHERE request_id = NEW.request_id;
  SELECT RAISE(ABORT, 'admin_data_reset_audit_missing') WHERE NOT EXISTS (
    SELECT 1 FROM audit_logs AS a JOIN admin_data_reset_commands AS c
      ON c.request_id = NEW.request_id
    WHERE a.id = NEW.audit_id AND a.user_id = NEW.actor_user_id
      AND a.action = 'ADMIN_DATA_RESET' AND a.resource_type = 'system'
      AND a.resource_id IS NULL
      AND a.request_id = NEW.request_id AND a.created_at = NEW.created_at
      AND json_extract(a.metadata, '$.timestamp') = NEW.created_at
      AND json_extract(a.metadata, '$.security_level') = 'ADMIN_VERIFIED'
      AND json_extract(a.metadata, '$.deletedCounts') = json_extract(c.result_json, '$.deletedCounts')
      AND json_extract(a.metadata, '$.totalDeleted') = json_extract(c.result_json, '$.totalDeleted')
      AND a.metadata = json_object('timestamp', NEW.created_at,
        'deletedCounts', json_extract(c.result_json, '$.deletedCounts'),
        'totalDeleted', json_extract(c.result_json, '$.totalDeleted'),
        'security_level', 'ADMIN_VERIFIED')
  );
END;

CREATE TRIGGER admin_data_reset_result_immutable
BEFORE UPDATE ON admin_data_reset_commands
WHEN OLD.result_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'admin_data_reset_receipt_immutable');
END;

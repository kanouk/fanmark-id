-- Master D1 change audits share the canonical mutation transaction.
-- Context is inserted/deleted within a Worker batch, never kept across requests.
-- Trusted non-Worker seed/maintenance writes retain a NULL actor, like auth.uid().
CREATE TABLE fanmark_emoji_master_mutation_context (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  user_id TEXT NOT NULL CHECK (length(user_id) > 0),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE fanmark_emoji_master_change_audits (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2, 3) || '-' || substr('89ab', (random() & 3) + 1, 1) ||
    substr(hex(randomblob(2)), 2, 3) || '-' || hex(randomblob(6)))),
  user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('EMOJI_MASTER_INSERT', 'EMOJI_MASTER_UPDATE', 'EMOJI_MASTER_DELETE')),
  resource_type TEXT NOT NULL CHECK (resource_type = 'emoji_master'),
  resource_id TEXT NOT NULL,
  request_id TEXT,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL,
  UNIQUE (request_id, action, resource_id)
);
CREATE INDEX fanmark_emoji_master_change_audits_actor_time
  ON fanmark_emoji_master_change_audits (user_id, created_at DESC);

CREATE TRIGGER fanmark_emoji_master_change_audit_insert
AFTER INSERT ON emoji_master
BEGIN
  INSERT INTO fanmark_emoji_master_change_audits
    (user_id, action, resource_type, resource_id, request_id, metadata, created_at)
  VALUES ((SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), 'EMOJI_MASTER_INSERT', 'emoji_master', NEW.id,
    (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), json_object('emoji', NEW.emoji, 'short_name', NEW.short_name), COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')));

  SELECT RAISE(ABORT, 'emoji_master_required_audit_missing')
  WHERE NOT EXISTS (
    SELECT 1 FROM fanmark_emoji_master_change_audits audit
    WHERE audit.rowid = last_insert_rowid()
      AND audit.user_id IS (SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.action = 'EMOJI_MASTER_INSERT'
      AND audit.resource_type = 'emoji_master'
      AND audit.resource_id = NEW.id
      AND audit.request_id IS (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.metadata = json_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
      AND audit.created_at = COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
  );
END;

CREATE TRIGGER fanmark_emoji_master_change_audit_update
AFTER UPDATE ON emoji_master
BEGIN
  INSERT INTO fanmark_emoji_master_change_audits
    (user_id, action, resource_type, resource_id, request_id, metadata, created_at)
  VALUES ((SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), 'EMOJI_MASTER_UPDATE', 'emoji_master', NEW.id,
    (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), json_object('emoji', NEW.emoji, 'short_name', NEW.short_name), COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')));

  SELECT RAISE(ABORT, 'emoji_master_required_audit_missing')
  WHERE NOT EXISTS (
    SELECT 1 FROM fanmark_emoji_master_change_audits audit
    WHERE audit.rowid = last_insert_rowid()
      AND audit.user_id IS (SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.action = 'EMOJI_MASTER_UPDATE'
      AND audit.resource_type = 'emoji_master'
      AND audit.resource_id = NEW.id
      AND audit.request_id IS (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.metadata = json_object('emoji', NEW.emoji, 'short_name', NEW.short_name)
      AND audit.created_at = COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
  );
END;

CREATE TRIGGER fanmark_emoji_master_change_audit_delete
AFTER DELETE ON emoji_master
BEGIN
  INSERT INTO fanmark_emoji_master_change_audits
    (user_id, action, resource_type, resource_id, request_id, metadata, created_at)
  VALUES ((SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), 'EMOJI_MASTER_DELETE', 'emoji_master', OLD.id,
    (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), json_object('emoji', OLD.emoji, 'short_name', OLD.short_name), COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')));

  SELECT RAISE(ABORT, 'emoji_master_required_audit_missing')
  WHERE NOT EXISTS (
    SELECT 1 FROM fanmark_emoji_master_change_audits audit
    WHERE audit.rowid = last_insert_rowid()
      AND audit.user_id IS (SELECT user_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.action = 'EMOJI_MASTER_DELETE'
      AND audit.resource_type = 'emoji_master'
      AND audit.resource_id = OLD.id
      AND audit.request_id IS (SELECT request_id FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1)
      AND audit.metadata = json_object('emoji', OLD.emoji, 'short_name', OLD.short_name)
      AND audit.created_at = COALESCE((SELECT created_at FROM fanmark_emoji_master_mutation_context WHERE singleton_id = 1), strftime('%Y-%m-%dT%H:%M:%f000Z', 'now'))
  );
END;

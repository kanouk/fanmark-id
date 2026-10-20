-- SQLite REPLACE can bypass delete triggers when recursive_triggers is off.
CREATE TRIGGER fanmark_import_commit_no_replace BEFORE INSERT ON fanmark_import_operation_commits
WHEN EXISTS (SELECT 1 FROM fanmark_import_operation_commits WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'import_commit_immutable'); END;

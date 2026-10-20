-- Production cohort v2 only. Kept in backups as durable migration evidence.
CREATE TABLE fanmark_import_operation_commits (
  operation_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  batch_sha256 TEXT NOT NULL CHECK(length(batch_sha256)=64),
  target_id TEXT NOT NULL,
  target_incarnation TEXT NOT NULL,
  statement_count INTEGER NOT NULL CHECK(statement_count BETWEEN 1 AND 100),
  changes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(changes_json) AND json_type(changes_json)='array'),
  phase TEXT NOT NULL CHECK(phase IN ('building','committed')),
  CHECK(json_array_length(changes_json)<=statement_count),
  CHECK(phase<>'committed' OR json_array_length(changes_json)=statement_count)
);
CREATE TRIGGER fanmark_import_commit_no_update BEFORE UPDATE ON fanmark_import_operation_commits
WHEN OLD.phase='committed' BEGIN SELECT RAISE(ABORT,'import_commit_immutable'); END;
CREATE TRIGGER fanmark_import_commit_no_delete BEFORE DELETE ON fanmark_import_operation_commits
BEGIN SELECT RAISE(ABORT,'import_commit_immutable'); END;

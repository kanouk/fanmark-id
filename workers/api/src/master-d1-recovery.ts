/** Master-only profile: no public route or scheduled collector. */
import { createD1Recovery, D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest } from "./d1-store-recovery.ts";
import type { D1RecoveryRow, D1RecoveryObject, D1RecoverySnapshot, D1RecoveryArchive } from "./d1-store-recovery.ts";
export type MasterRecoveryRow = D1RecoveryRow;
export type MasterRecoveryObject = D1RecoveryObject;
export type MasterRecoverySnapshot = D1RecoverySnapshot;
export type MasterRecoveryArchive = D1RecoveryArchive<"fanmark-master-recovery-v1" | "fanmark-master-import-recovery-v1">;
export const MASTER_RECOVERY_TABLES = Object.freeze(["account", "adminRole", "d1_migrations", "emoji_master",
  "fanmark_emoji_master_active_release", "fanmark_emoji_master_change_audits", "fanmark_emoji_master_mutation_context",
  "fanmark_emoji_master_release_activations", "fanmark_emoji_master_release_imports", "fanmark_emoji_master_release_staging",
  "fanmark_extension_price_release_rows", "fanmark_language_release_rows", "fanmark_reference_master_active_release",
  "fanmark_reference_master_extension_price_manifests", "fanmark_reference_master_release_activations",
  "fanmark_reference_master_release_tables", "fanmark_reference_master_releases", "fanmark_reserved_emoji_pattern_release_rows",
  "fanmark_tier_release_rows", "mfaAssurance", "mfaGeneration", "session", "twoFactor", "user", "verification"].sort());
export const MASTER_RECOVERY_SCHEMA_SQL = D1_RECOVERY_SCHEMA_SQL;
export const masterRecoveryDigest = d1RecoveryDigest;
const recovery = createD1Recovery({format: "fanmark-master-recovery-v1", errorPrefix: "master_recovery",
  tables: MASTER_RECOVERY_TABLES,
  emptyTables: ["account", "adminRole", "mfaAssurance", "session", "twoFactor", "user", "verification"],
  maxSchemaObjects: 200, maxRestoreStatements: 950});
export const MASTER_IMPORT_COMMIT_TABLE = "fanmark_import_operation_commits";
const importedRecovery = createD1Recovery({format: "fanmark-master-import-recovery-v1", errorPrefix: "master_recovery",
  tables: [...MASTER_RECOVERY_TABLES, MASTER_IMPORT_COMMIT_TABLE],
  emptyTables: ["account", "adminRole", "mfaAssurance", "session", "twoFactor", "user", "verification"],
  maxSchemaObjects: 210, maxRestoreStatements: 950});
function snapshotRecovery(snapshot: MasterRecoverySnapshot) {
  return Object.hasOwn(snapshot?.tables ?? {}, MASTER_IMPORT_COMMIT_TABLE) ? importedRecovery : recovery;
}
export async function captureMasterRecoverySnapshot(database: D1Database, expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  let result: D1Result<D1RecoveryObject>;
  try { result = await database.prepare(MASTER_RECOVERY_SCHEMA_SQL).all<D1RecoveryObject>(); }
  catch { throw new Error("master_recovery_capture_failed"); }
  if (!result.success) throw new Error("master_recovery_capture_failed");
  return (result.results.some(row => row.name === MASTER_IMPORT_COMMIT_TABLE) ? importedRecovery : recovery).capture(database, expectedSchemaHash);
}
export async function sealMasterRecoverySnapshot(snapshot: MasterRecoverySnapshot, key: CryptoKey, expectedSchemaHash: string): Promise<MasterRecoveryArchive> {
  return snapshotRecovery(snapshot).seal(snapshot,key,expectedSchemaHash);
}
export async function openMasterRecoverySnapshot(archive: MasterRecoveryArchive, key: CryptoKey, expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  if (archive?.format === "fanmark-master-import-recovery-v1") return importedRecovery.open({...archive,format:archive.format},key,expectedSchemaHash);
  if (archive?.format === "fanmark-master-recovery-v1") return recovery.open({...archive,format:archive.format},key,expectedSchemaHash);
  throw new Error("master_recovery_schema_mismatch");
}
export async function restoreMasterRecoverySnapshot(database: D1Database, snapshot: MasterRecoverySnapshot, expectedSchemaHash: string): Promise<MasterRecoverySnapshot> {
  return snapshotRecovery(snapshot).restore(database,snapshot,expectedSchemaHash);
}

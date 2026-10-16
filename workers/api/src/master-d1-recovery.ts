/** Master-only profile: no public route or scheduled collector. */
import { createD1Recovery, D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest } from "./d1-store-recovery.ts";
import type { D1RecoveryRow, D1RecoveryObject, D1RecoverySnapshot, D1RecoveryArchive } from "./d1-store-recovery.ts";
export type MasterRecoveryRow = D1RecoveryRow;
export type MasterRecoveryObject = D1RecoveryObject;
export type MasterRecoverySnapshot = D1RecoverySnapshot;
export type MasterRecoveryArchive = D1RecoveryArchive<"fanmark-master-recovery-v1">;
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
export const captureMasterRecoverySnapshot = recovery.capture;
export const sealMasterRecoverySnapshot = recovery.seal;
export const openMasterRecoverySnapshot = recovery.open;
export const restoreMasterRecoverySnapshot = recovery.restore;

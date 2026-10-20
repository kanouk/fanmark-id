/** Business-only profile: no public route or scheduled collector. */
import { createD1Recovery, D1_RECOVERY_SCHEMA_SQL, d1RecoveryDigest } from "./d1-store-recovery.ts";
import type { D1RecoveryRow, D1RecoveryObject, D1RecoverySnapshot, D1RecoveryArchive } from "./d1-store-recovery.ts";
export type BusinessRecoveryRow = D1RecoveryRow;
export type BusinessRecoveryObject = D1RecoveryObject;
export type BusinessRecoverySnapshot = D1RecoverySnapshot;
export type BusinessRecoveryArchive = D1RecoveryArchive<"fanmark-business-recovery-v1" | "fanmark-business-import-recovery-v1">;
export const BUSINESS_RECOVERY_TABLES = Object.freeze([
  "admin_data_reset_commands",
  "audit_logs",
  "broadcast_delivery_recipients",
  "broadcast_delivery_runs",
  "broadcast_delivery_suppressions",
  "broadcast_delivery_webhook_events",
  "broadcast_emails",
  "credential_transform_artifacts",
  "credential_transform_coverage",
  "d1_migrations",
  "email_templates",
  "emoji_master",
  "enterprise_user_settings",
  "extension_coupon_application_commands",
  "extension_coupon_usages",
  "extension_coupons",
  "fanmark_access_attempt_audit",
  "fanmark_access_attempt_reservations",
  "fanmark_access_daily_stats",
  "fanmark_access_logs",
  "fanmark_access_proofs",
  "fanmark_access_rate_limits",
  "fanmark_access_rate_policy",
  "fanmark_access_versions",
  "fanmark_availability_rules",
  "fanmark_basic_configs",
  "fanmark_discoveries",
  "fanmark_events",
  "fanmark_favorites",
  "fanmark_license_incarnations",
  "fanmark_licenses",
  "fanmark_lottery_entries",
  "fanmark_lottery_history",
  "fanmark_messageboard_configs",
  "fanmark_password_configs",
  "fanmark_password_runtime_evidence",
  "fanmark_profiles",
  "fanmark_redirect_configs",
  "fanmark_tier_extension_prices",
  "fanmark_tiers",
  "fanmark_transfer_codes",
  "fanmark_transfer_requests",
  "fanmarks",
  "invitation_codes",
  "invitation_signup_attempts",
  "languages",
  "license_expiry_effect_guards",
  "license_expiry_run_items",
  "license_expiry_runs",
  "license_grace_finalization_items",
  "license_grace_finalization_runs",
  "notification_events",
  "notification_preferences",
  "notification_rules",
  "notification_templates",
  "notification_worker_wake_state",
  "notifications",
  "notifications_history",
  "reserved_emoji_patterns",
  "sqlite_sequence",
  "stripe_application_ledger",
  "stripe_extension_application_effects",
  "stripe_extension_application_lottery_entries",
  "stripe_extension_applications",
  "stripe_extension_checkout_intents",
  "stripe_plan_change_commands",
  "stripe_plan_checkout_commands",
  "stripe_plan_customer_commands",
  "stripe_subscription_applications",
  "stripe_subscription_return_batches",
  "stripe_subscription_return_items",
  "stripe_subscription_transaction_guards",
  "stripe_sync_fences",
  "stripe_webhook_dispatches",
  "stripe_webhook_receipts",
  "system_settings",
  "user_roles",
  "user_settings",
  "user_subscriptions",
  "waitlist"
]);
export const BUSINESS_RECOVERY_SCHEMA_SQL = D1_RECOVERY_SCHEMA_SQL;
export const businessRecoveryDigest = d1RecoveryDigest;
const recovery = createD1Recovery({format: "fanmark-business-recovery-v1", errorPrefix: "business_recovery",
  tables: BUSINESS_RECOVERY_TABLES, internalTables: ["sqlite_sequence"],
  maxSchemaObjects: 300, maxRestoreStatements: 900});
// Import checkpoints are durable migration evidence, including after recovery to a
// different target incarnation. Never drop them to make a backup profile fit.
export const BUSINESS_IMPORT_RECOVERY_TABLES = Object.freeze([
  "__fanmark_d1_import_checkpoints", "__fanmark_d1_import_guards", "__fanmark_d1_import_runs"
]);
const importedRecovery = createD1Recovery({format: "fanmark-business-import-recovery-v1", errorPrefix: "business_recovery",
  tables: [...BUSINESS_RECOVERY_TABLES, ...BUSINESS_IMPORT_RECOVERY_TABLES], internalTables: ["sqlite_sequence"],
  maxSchemaObjects: 310, maxRestoreStatements: 900});
function snapshotRecovery(snapshot: BusinessRecoverySnapshot) {
  const names = Object.keys(snapshot?.tables ?? {});
  return BUSINESS_IMPORT_RECOVERY_TABLES.some(name => names.includes(name)) ? importedRecovery : recovery;
}
export async function captureBusinessRecoverySnapshot(database: D1Database, expectedSchemaHash: string): Promise<BusinessRecoverySnapshot> {
  // This read selects one of two fixed profiles; capture rechecks the complete
  // schema and trusted hash within its own atomic batch. Partial ledgers fail.
  let result: D1Result<D1RecoveryObject>;
  try { result = await database.prepare(BUSINESS_RECOVERY_SCHEMA_SQL).all<D1RecoveryObject>(); }
  catch { throw new Error("business_recovery_capture_failed"); }
  if (!result.success) throw new Error("business_recovery_capture_failed");
  const selected = result.results.some(row => BUSINESS_IMPORT_RECOVERY_TABLES.includes(row.name)) ? importedRecovery : recovery;
  return selected.capture(database, expectedSchemaHash);
}
export async function sealBusinessRecoverySnapshot(snapshot: BusinessRecoverySnapshot, key: CryptoKey,
  expectedSchemaHash: string): Promise<BusinessRecoveryArchive> {
  return snapshotRecovery(snapshot).seal(snapshot, key, expectedSchemaHash);
}
export async function openBusinessRecoverySnapshot(archive: BusinessRecoveryArchive, key: CryptoKey,
  expectedSchemaHash: string): Promise<BusinessRecoverySnapshot> {
  if (archive?.format === "fanmark-business-import-recovery-v1")
    return importedRecovery.open({...archive, format: archive.format}, key, expectedSchemaHash);
  if (archive?.format === "fanmark-business-recovery-v1")
    return recovery.open({...archive, format: archive.format}, key, expectedSchemaHash);
  throw new Error("business_recovery_schema_mismatch");
}
export async function restoreBusinessRecoverySnapshot(database: D1Database, snapshot: BusinessRecoverySnapshot,
  expectedSchemaHash: string): Promise<BusinessRecoverySnapshot> {
  return snapshotRecovery(snapshot).restore(database, snapshot, expectedSchemaHash);
}

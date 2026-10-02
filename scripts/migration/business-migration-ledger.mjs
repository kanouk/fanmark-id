/**
 * Canonical order of checked-in Business D1 migrations. Staging verifiers use
 * this sequence so they can reject gaps or unknown entries without becoming
 * stale as soon as a later reviewed migration is applied.
 */
export const BUSINESS_MIGRATION_SEQUENCE = Object.freeze([
  "0000_business_schema_v4_staging.sql",
  "0001_lifecycle_target_staging.sql",
  "0002_lifecycle_generation_staging.sql",
  "0003_credential_transform_staging.sql",
  "0004_verified_access_staging.sql",
  "0005_lottery_plan_journal_staging.sql",
  "0006_stripe_webhook_ingress_staging.sql",
  "0007_stripe_extension_application_staging.sql",
  "0008_stripe_invoice_projection_staging.sql",
  "0009_stripe_subscription_identity.sql",
  "0010_stripe_subscription_reconciliation_staging.sql",
  "0011_stripe_subscription_free_return.sql",
  "0012_stripe_plan_checkout_commands.sql",
  "0013_stripe_plan_change_commands.sql",
  "0014_invitation_signup_attempts.sql",
  "0015_extension_coupon_application.sql",
  "0016_broadcast_email_delivery.sql",
  "0017_lifecycle_generation_timestamp_precision.sql",
  "0018_invitation_capacity_timestamp_precision.sql",
  "0019_extension_coupon_timestamp_precision.sql",
  "0020_notification_archive_index.sql",
  "0021_coupon_lottery_status_audit.sql",
  "0022_fanmark_discovery_link.sql",
  "0023_admin_data_reset.sql",
  "0024_notification_worker_wake.sql",
]);

export function isBusinessMigrationLedgerPrefix(ledger) {
  return Array.isArray(ledger) && ledger.length <= BUSINESS_MIGRATION_SEQUENCE.length &&
    ledger.every((name, index) => name === BUSINESS_MIGRATION_SEQUENCE[index]);
}

export function hasBusinessMigrationApplied(ledger, migrationName) {
  const index = BUSINESS_MIGRATION_SEQUENCE.indexOf(migrationName);
  return index >= 0 && isBusinessMigrationLedgerPrefix(ledger) && ledger.length > index;
}

export function isBusinessMigrationLedgerImmediatelyBefore(ledger, migrationName) {
  const index = BUSINESS_MIGRATION_SEQUENCE.indexOf(migrationName);
  return index > 0 && isBusinessMigrationLedgerPrefix(ledger) && ledger.length === index;
}

export function canApplyOrVerifyBusinessMigration(ledger, migrationName) {
  return isBusinessMigrationLedgerImmediatelyBefore(ledger, migrationName) ||
    hasBusinessMigrationApplied(ledger, migrationName);
}

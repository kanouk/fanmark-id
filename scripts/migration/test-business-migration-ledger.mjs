import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUSINESS_MIGRATION_SEQUENCE,
  canApplyOrVerifyBusinessMigration,
  hasBusinessMigrationApplied,
  isBusinessMigrationLedgerImmediatelyBefore,
  isBusinessMigrationLedgerPrefix,
} from "./business-migration-ledger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(ROOT, "workers/api/migrations-business");

test("canonical business migration sequence matches the checked-in files", () => {
  const actual = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(BUSINESS_MIGRATION_SEQUENCE, actual);
});

test("accepts valid prefixes and recognizes later approved migrations", () => {
  const ledger = BUSINESS_MIGRATION_SEQUENCE;
  const before = (name) => ledger.slice(0, ledger.indexOf(name));
  assert.equal(isBusinessMigrationLedgerPrefix([]), true);
  assert.equal(isBusinessMigrationLedgerPrefix(ledger.slice(0, 6)), true);
  assert.equal(isBusinessMigrationLedgerPrefix(ledger), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0005_lottery_plan_journal_staging.sql"), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0017_lifecycle_generation_timestamp_precision.sql"), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0018_invitation_capacity_timestamp_precision.sql"), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0019_extension_coupon_timestamp_precision.sql"), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0020_notification_archive_index.sql"), true);
  assert.equal(hasBusinessMigrationApplied(ledger, "0021_coupon_lottery_status_audit.sql"), true);
  assert.equal(hasBusinessMigrationApplied(before("0020_notification_archive_index.sql"), "0019_extension_coupon_timestamp_precision.sql"), true);
  assert.equal(hasBusinessMigrationApplied(before("0020_notification_archive_index.sql"), "0020_notification_archive_index.sql"), false);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    before("0021_coupon_lottery_status_audit.sql"),
    "0021_coupon_lottery_status_audit.sql",
  ), true);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    before("0019_extension_coupon_timestamp_precision.sql"),
    "0019_extension_coupon_timestamp_precision.sql",
  ), true);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    before("0020_notification_archive_index.sql"),
    "0020_notification_archive_index.sql",
  ), true);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    before("0018_invitation_capacity_timestamp_precision.sql"),
    "0018_invitation_capacity_timestamp_precision.sql",
  ), true);
  assert.equal(hasBusinessMigrationApplied(ledger.slice(0, 8), "0008_stripe_invoice_projection_staging.sql"), false);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    ledger.slice(0, 8),
    "0008_stripe_invoice_projection_staging.sql",
  ), true);
  assert.equal(isBusinessMigrationLedgerImmediatelyBefore(
    ledger.slice(0, 9),
    "0008_stripe_invoice_projection_staging.sql",
  ), false);
  assert.equal(canApplyOrVerifyBusinessMigration(
    ledger.slice(0, 8),
    "0008_stripe_invoice_projection_staging.sql",
  ), true);
  assert.equal(canApplyOrVerifyBusinessMigration(
    ledger,
    "0008_stripe_invoice_projection_staging.sql",
  ), true);
});

test("rejects gaps, reordered or duplicate entries, and unknown migrations", () => {
  const ledger = BUSINESS_MIGRATION_SEQUENCE;
  assert.equal(isBusinessMigrationLedgerPrefix([ledger[0], ledger[2]]), false);
  assert.equal(isBusinessMigrationLedgerPrefix([ledger[1], ledger[0]]), false);
  assert.equal(isBusinessMigrationLedgerPrefix([ledger[0], ledger[0]]), false);
  assert.equal(isBusinessMigrationLedgerPrefix([...ledger, "0099_unreviewed.sql"]), false);
  assert.equal(isBusinessMigrationLedgerPrefix([ledger[0], null]), false);
  assert.equal(hasBusinessMigrationApplied([ledger[0], ledger[2]], ledger[2]), false);
});

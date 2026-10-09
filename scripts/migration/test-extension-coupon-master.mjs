import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTENSION_COUPON_MASTER_ROW_COUNT,
  EXTENSION_COUPON_SOURCE_EXPORT_FIELDS,
  canonicalizeExtensionCouponSourceRows,
  canonicalizeExtensionCouponTargetRows,
  extensionCouponMasterBaselineState,
  extensionCouponMasterDigest,
} from "./extension-coupon-master.mjs";

function sourceRows() {
  return Array.from({ length: EXTENSION_COUPON_MASTER_ROW_COUNT }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    code: `SYNTHETIC${index + 1}`,
    months: [1, 2, 3, 6][index],
    allowed_tier_levels: index === 0 ? null : [index + 1],
    max_uses: index + 1,
    used_count: 0,
    expires_at: index % 2 ? null : "2026-09-27T00:00:00+00:00",
    is_active: true,
    created_at: "2026-09-27T00:00:00+00:00",
    updated_at: "2026-09-27T00:00:00+00:00",
    source_usage_rows: 0,
  }));
}

test("coupon master projection only accepts zero-use definitions with no usage rows", () => {
  const rows = sourceRows();
  assert.deepEqual(Object.keys(rows[0]).sort(), [...EXTENSION_COUPON_SOURCE_EXPORT_FIELDS].sort());
  assert.equal(canonicalizeExtensionCouponSourceRows(rows).length, 4);
  assert.throws(
    () => canonicalizeExtensionCouponSourceRows(rows.map((row, index) =>
      index === 0 ? { ...row, source_usage_rows: 1 } : row)),
    /extension_coupon_source_usage_not_empty/u,
  );
  assert.throws(
    () => canonicalizeExtensionCouponSourceRows(rows.map((row, index) =>
      index === 0 ? { ...row, used_count: 1 } : row)),
    /extension_coupon_source_row_value_invalid/u,
  );
  assert.throws(
    () => canonicalizeExtensionCouponSourceRows(rows.map((row, index) =>
      index === 0 ? { ...row, owner_email: "private@example.invalid" } : row)),
    /extension_coupon_source_row_shape_invalid/u,
  );
});

test("staging coupon baseline requires exact content, null creator IDs, and zero usages", () => {
  const source = canonicalizeExtensionCouponSourceRows(sourceRows());
  const digest = extensionCouponMasterDigest(source);
  const target = source.map((row) => ({
    ...row,
    allowed_tier_levels: row.allowed_tier_levels === null ? null : JSON.stringify(row.allowed_tier_levels),
    is_active: 1,
    created_by: null,
  }));

  assert.equal(extensionCouponMasterBaselineState([], 0), "empty");
  assert.equal(extensionCouponMasterBaselineState(target, 0, digest), "seeded");
  assert.equal(extensionCouponMasterBaselineState(target, 1, digest), "invalid");
  assert.equal(extensionCouponMasterBaselineState(target.slice(1), 0, digest), "invalid");
  assert.equal(extensionCouponMasterBaselineState(target.map((row, index) => index === 0
    ? { ...row, code: "CHANGED" }
    : row), 0, digest), "invalid");
  assert.equal(extensionCouponMasterBaselineState(target.map((row, index) => index === 0
    ? { ...row, created_by: "00000000-0000-4000-8000-000000000001" }
    : row), 0, digest), "invalid");
  assert.equal(extensionCouponMasterBaselineState(target, 0, "0".repeat(64)), "invalid");
});

test("coupon target readback canonicalizes D1 integer and JSON representations", () => {
  const source = canonicalizeExtensionCouponSourceRows(sourceRows());
  const target = source.map((row) => ({
    ...row,
    allowed_tier_levels: row.allowed_tier_levels === null ? null : JSON.stringify(row.allowed_tier_levels),
    is_active: 1,
    created_by: null,
  }));
  assert.deepEqual(canonicalizeExtensionCouponTargetRows(target), source.map(({ ...row }) => row));
});

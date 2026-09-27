import { createHash } from "node:crypto";

export const EXTENSION_COUPON_MASTER_SOURCE_DIGEST = "6472e758c2896f8f83bf5a48da5a3c038b24651e5278866b177231412dda3d79";
export const EXTENSION_COUPON_MASTER_ROW_COUNT = 4;

export const EXTENSION_COUPON_SOURCE_FIELDS = [
  "id",
  "code",
  "months",
  "allowed_tier_levels",
  "max_uses",
  "used_count",
  "expires_at",
  "is_active",
  "created_at",
  "updated_at",
];

export const EXTENSION_COUPON_TARGET_FIELDS = [
  ...EXTENSION_COUPON_SOURCE_FIELDS,
  "created_by",
];

export const EXTENSION_COUPON_SOURCE_EXPORT_FIELDS = [
  ...EXTENSION_COUPON_SOURCE_FIELDS,
  "source_usage_rows",
];

export const STAGING_EXTENSION_COUPON_READBACK_SQL = `SELECT
  id, code, months, allowed_tier_levels, max_uses, used_count,
  expires_at, is_active, created_at, updated_at, created_by
FROM extension_coupons
ORDER BY id`;

export const STAGING_EXTENSION_COUPON_USAGE_COUNT_SQL =
  "SELECT COUNT(*) AS usage_rows FROM extension_coupon_usages";

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseTierLevels(value) {
  if (value === null) return null;
  let levels = value;
  if (typeof levels === "string") {
    try {
      levels = JSON.parse(levels);
    } catch {
      fail("extension_coupon_source_tier_levels_invalid_json");
    }
  }
  if (!Array.isArray(levels) || levels.length > 4 ||
      levels.some((level) => !Number.isSafeInteger(level) || level < 1 || level > 4) ||
      new Set(levels).size !== levels.length) {
    fail("extension_coupon_source_tier_levels_invalid");
  }
  return levels;
}

function validText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}

function validTimestamp(value, nullable = false) {
  return nullable && value === null ||
    typeof value === "string" && value.length <= 64 && !value.includes("\0") && Number.isFinite(Date.parse(value));
}

function normalizeCommonRow(row, expectedFields, { source = false } = {}) {
  if (!exactKeys(row, expectedFields)) fail(source
    ? "extension_coupon_source_row_shape_invalid"
    : "extension_coupon_target_row_shape_invalid");
  if (source && row.source_usage_rows !== 0) fail("extension_coupon_source_usage_not_empty");
  if (!source && row.created_by !== null) fail("extension_coupon_target_created_by_not_null");

  const isActive = row.is_active === true || row.is_active === 1 || row.is_active === "1";
  const isInactive = row.is_active === false || row.is_active === 0 || row.is_active === "0";
  if (
    typeof row.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.id) ||
    !validText(row.code, 128) || /[\r\n]/u.test(row.code) ||
    !Number.isSafeInteger(row.months) || ![1, 2, 3, 6].includes(row.months) ||
    !Number.isSafeInteger(row.max_uses) || row.max_uses < 1 ||
    row.used_count !== 0 ||
    (!isActive && !isInactive) ||
    !validTimestamp(row.expires_at, true) ||
    !validTimestamp(row.created_at) ||
    !validTimestamp(row.updated_at)
  ) fail(source ? "extension_coupon_source_row_value_invalid" : "extension_coupon_target_row_value_invalid");

  return {
    id: row.id,
    code: row.code,
    months: row.months,
    allowed_tier_levels: parseTierLevels(row.allowed_tier_levels),
    max_uses: row.max_uses,
    used_count: row.used_count,
    expires_at: row.expires_at,
    is_active: isActive,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function canonicalizeExtensionCouponSourceRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXTENSION_COUPON_MASTER_ROW_COUNT) {
    fail("extension_coupon_source_count_invalid");
  }
  const normalized = rows.map((row) => normalizeCommonRow(row, EXTENSION_COUPON_SOURCE_EXPORT_FIELDS, { source: true }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(normalized.map((row) => row.id)).size !== normalized.length ||
      new Set(normalized.map((row) => row.code)).size !== normalized.length) {
    fail("extension_coupon_source_identity_invalid");
  }
  return normalized;
}

export function canonicalizeExtensionCouponTargetRows(rows) {
  if (!Array.isArray(rows)) fail("extension_coupon_target_rows_invalid");
  return rows.map((row) => normalizeCommonRow(row, EXTENSION_COUPON_TARGET_FIELDS))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function extensionCouponMasterDigest(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function extensionCouponMasterBaselineState(
  rows,
  usageRows,
  expectedDigest = EXTENSION_COUPON_MASTER_SOURCE_DIGEST,
) {
  if (!Array.isArray(rows) || !Number.isSafeInteger(Number(usageRows)) || Number(usageRows) < 0) return "invalid";
  if (rows.length === 0 && Number(usageRows) === 0) return "empty";
  if (rows.length !== EXTENSION_COUPON_MASTER_ROW_COUNT || Number(usageRows) !== 0) return "invalid";
  try {
    const canonical = canonicalizeExtensionCouponTargetRows(rows);
    return extensionCouponMasterDigest(canonical) === expectedDigest ? "seeded" : "invalid";
  } catch {
    return "invalid";
  }
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildExtensionCouponMasterInsertSql(rows) {
  const canonical = canonicalizeExtensionCouponSourceRows(rows);
  if (extensionCouponMasterDigest(canonical) !== EXTENSION_COUPON_MASTER_SOURCE_DIGEST) {
    fail("extension_coupon_source_digest_mismatch");
  }
  const fields = EXTENSION_COUPON_TARGET_FIELDS;
  const values = canonical.map((row) => `(${fields.map((field) => {
    if (field === "created_by") return "NULL";
    if (field === "is_active") return row.is_active ? "1" : "0";
    if (field === "allowed_tier_levels") {
      return row.allowed_tier_levels === null ? "NULL" : sqlText(JSON.stringify(row.allowed_tier_levels));
    }
    return row[field] === null ? "NULL" : sqlText(row[field]);
  }).join(", ")})`).join(",\n");
  return `INSERT INTO extension_coupons (${fields.map((field) => `"${field}"`).join(", ")}) VALUES\n${values};\n`;
}

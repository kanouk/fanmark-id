import { createHash } from "node:crypto";

export const STAGING_SYSTEM_SETTINGS_SOURCE_SHA256 = "d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f";
export const SYSTEM_SETTINGS_STAGE_KEYS = [
  "free_fanmarks_limit",
  "creator_fanmarks_limit",
  "max_fanmarks_limit",
  "business_fanmarks_limit",
  "enterprise_fanmarks_limit",
  "premium_pricing",
  "max_pricing",
  "business_pricing",
  "enterprise_pricing",
  "creator_stripe_price_id",
  "max_stripe_price_id",
  "business_stripe_price_id",
  "creator_stripe_price_id_live",
  "max_stripe_price_id_live",
  "business_stripe_price_id_live",
  "stripe_mode",
  "invitation_mode",
  "social_login_enabled",
];
const PRIVATE_KEYS = new Set(["enterprise_fanmarks_limit", "enterprise_pricing"]);
const BOOLEAN_KEYS = new Set(["invitation_mode", "social_login_enabled"]);
const PRICE_KEYS = new Set([
  "creator_stripe_price_id", "max_stripe_price_id", "business_stripe_price_id",
  "creator_stripe_price_id_live", "max_stripe_price_id_live", "business_stripe_price_id_live",
]);
const LIMIT_KEYS = new Set([
  "free_fanmarks_limit", "creator_fanmarks_limit", "max_fanmarks_limit",
  "business_fanmarks_limit", "enterprise_fanmarks_limit",
]);
const PRICE_AMOUNT_KEYS = new Set(["premium_pricing", "max_pricing", "business_pricing", "enterprise_pricing"]);
const ROW_FIELDS = ["id", "setting_key", "setting_value", "description", "is_public", "created_at", "updated_at"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalid(reason) {
  throw new Error(`system_settings_source_${reason}`);
}

function exactObjectKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validValue(key, value) {
  if (typeof value !== "string" || value.length > 256) return false;
  if (BOOLEAN_KEYS.has(key)) return value === "true" || value === "false";
  if (LIMIT_KEYS.has(key)) return /^[1-9]\d{0,5}$/u.test(value);
  if (PRICE_AMOUNT_KEYS.has(key)) return /^(?:0|[1-9]\d{0,8})$/u.test(value);
  if (PRICE_KEYS.has(key)) return /^price_[A-Za-z0-9_]{1,250}$/u.test(value);
  if (key === "stripe_mode") return value === "test" || value === "live";
  return false;
}

export function systemSettingsCanonicalDigest(rows) {
  if (!Array.isArray(rows)) invalid("rows_invalid");
  const canonical = rows.slice().sort((a, b) => String(a.setting_key).localeCompare(String(b.setting_key))).map((row) => {
    const isPublic = row.is_public === true || Number(row.is_public) === 1;
    return [row.id, row.setting_key, row.setting_value, row.description, isPublic, row.created_at, row.updated_at]
      .join("\u001f");
  }).join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseSystemSettingsSourceText(text, { requirePinnedDigest = true } = {}) {
  if (typeof text !== "string") invalid("text_invalid");
  const start = text.indexOf("{");
  if (start < 0) invalid("json_missing");
  let result;
  try {
    result = JSON.parse(text.slice(start));
  } catch {
    invalid("json_invalid");
  }
  if (!exactObjectKeys(result, ["boundary", "rows", "warning"]) || typeof result.boundary !== "string" ||
      typeof result.warning !== "string" || !result.warning.includes(`<${result.boundary}>`) || !Array.isArray(result.rows)) {
    invalid("boundary_invalid");
  }
  if (result.rows.length !== SYSTEM_SETTINGS_STAGE_KEYS.length) invalid("row_count_mismatch");
  const expected = new Set(SYSTEM_SETTINGS_STAGE_KEYS);
  const seen = new Set();
  for (const row of result.rows) {
    if (!exactObjectKeys(row, ROW_FIELDS) || typeof row.id !== "string" || !UUID.test(row.id) ||
        typeof row.setting_key !== "string" || !expected.has(row.setting_key) || seen.has(row.setting_key) ||
        typeof row.description !== "string" || typeof row.created_at !== "string" ||
        typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
        !Number.isFinite(Date.parse(row.updated_at)) || typeof row.is_public !== "boolean" ||
        row.is_public === PRIVATE_KEYS.has(row.setting_key) || !validValue(row.setting_key, row.setting_value)) {
      invalid("row_invalid");
    }
    seen.add(row.setting_key);
  }
  if (seen.size !== expected.size) invalid("keyset_mismatch");
  const rows = result.rows.slice().sort((a, b) => a.setting_key.localeCompare(b.setting_key));
  const digest = systemSettingsCanonicalDigest(rows);
  if (requirePinnedDigest && digest !== STAGING_SYSTEM_SETTINGS_SOURCE_SHA256) invalid("digest_mismatch");
  return { rows, digest };
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildSystemSettingsInsertSql(rows, { requirePinnedDigest = true } = {}) {
  if (!Array.isArray(rows) || rows.length !== SYSTEM_SETTINGS_STAGE_KEYS.length ||
      (requirePinnedDigest && systemSettingsCanonicalDigest(rows) !== STAGING_SYSTEM_SETTINGS_SOURCE_SHA256)) {
    invalid("insert_input_mismatch");
  }
  for (const row of rows) {
    if (!SYSTEM_SETTINGS_STAGE_KEYS.includes(row.setting_key) || !validValue(row.setting_key, row.setting_value) ||
        row.is_public === PRIVATE_KEYS.has(row.setting_key)) invalid("insert_row_invalid");
  }
  const tuples = rows.map((row) => `(${[
    quoteSql(row.id),
    quoteSql(row.setting_key),
    quoteSql(row.setting_value),
    quoteSql(row.description),
    row.is_public ? "1" : "0",
    quoteSql(row.created_at),
    quoteSql(row.updated_at),
  ].join(", ")})`);
  return `INSERT INTO system_settings (id, setting_key, setting_value, description, is_public, created_at, updated_at)\nVALUES\n${tuples.join(",\n")};\n`;
}

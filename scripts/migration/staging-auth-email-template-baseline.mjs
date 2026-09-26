import { createHash } from "node:crypto";

export const AUTH_EMAIL_TEMPLATE_FIELDS = Object.freeze([
  "id", "email_type", "language", "subject", "body_text", "button_text", "is_active", "created_at", "updated_at",
]);

export const AUTH_EMAIL_TEMPLATE_EXPECTED_SHA256 = "2ccb14f36ef431950871ac820a2e49f1574e415b8c0a3d2d5ad5f0bb17a108e2";

const ALLOWED_TYPES = new Set(["signup", "recovery", "magiclink", "email_change"]);
const ALLOWED_LANGUAGES = new Set(["en", "ja", "ko", "id"]);

function fail(code) {
  throw new Error(code);
}

export function stableAuthEmailTemplateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 16) fail("staging_auth_email_template_source_count_invalid");
  const normalized = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        Object.keys(row).length !== AUTH_EMAIL_TEMPLATE_FIELDS.length ||
        AUTH_EMAIL_TEMPLATE_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(row, field))) {
      fail("staging_auth_email_template_row_shape_invalid");
    }
    const active = row.is_active === true || row.is_active === 1 || row.is_active === "1";
    const stable = { ...row, is_active: active ? 1 : 0 };
    if (typeof stable.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stable.id) ||
        !ALLOWED_TYPES.has(stable.email_type) || !ALLOWED_LANGUAGES.has(stable.language) || !active ||
        typeof stable.subject !== "string" || stable.subject.length < 1 || stable.subject.length > 256 || /[\r\n]/u.test(stable.subject) ||
        typeof stable.body_text !== "string" || stable.body_text.length < 1 || stable.body_text.length > 10_000 ||
        typeof stable.button_text !== "string" || stable.button_text.trim().length < 1 || stable.button_text.length > 128 ||
        typeof stable.created_at !== "string" || !Number.isFinite(Date.parse(stable.created_at)) ||
        typeof stable.updated_at !== "string" || !Number.isFinite(Date.parse(stable.updated_at))) {
      fail("staging_auth_email_template_row_value_invalid");
    }
    return Object.fromEntries(AUTH_EMAIL_TEMPLATE_FIELDS.map((field) => [field, stable[field]]));
  }).sort((a, b) => `${a.email_type}/${a.language}`.localeCompare(`${b.email_type}/${b.language}`));

  if (new Set(normalized.map((row) => row.id)).size !== 16 ||
      new Set(normalized.map((row) => `${row.email_type}/${row.language}`)).size !== 16) {
    fail("staging_auth_email_template_source_identity_invalid");
  }
  return normalized;
}

export function authEmailTemplateBaselineState(rows, tableRowCount = rows?.length) {
  const count = Number(tableRowCount);
  if (Array.isArray(rows) && rows.length === 0 && count === 0) return "empty";
  if (count !== 16) return "invalid";
  try {
    const normalized = stableAuthEmailTemplateRows(rows);
    const actual = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return actual === AUTH_EMAIL_TEMPLATE_EXPECTED_SHA256 ? "seeded" : "invalid";
  } catch {
    return "invalid";
  }
}

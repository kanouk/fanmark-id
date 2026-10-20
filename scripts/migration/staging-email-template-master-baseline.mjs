import { createHash } from "node:crypto";

import {
  AUTH_EMAIL_TEMPLATE_CONTENT_EXPECTED_SHA256,
  AUTH_EMAIL_TEMPLATE_FIELDS,
  authEmailTemplateBaselineState,
} from "./staging-auth-email-template-baseline.mjs";

export const BROADCAST_EMAIL_TEMPLATE_CONTENT_EXPECTED_SHA256 =
  "770459e45e66f1c81ba58ea507b518f00c67004d289f5919d8c16c0f2c279f14";
export const BROADCAST_EMAIL_TEMPLATE_FIELDS = Object.freeze([
  "id", "email_type", "language", "subject", "body_text", "button_text",
  "is_active", "created_at", "updated_at",
]);
export const AUTH_EMAIL_TEMPLATE_TYPES_SQL = "'signup', 'recovery', 'magiclink', 'email_change'";
export const BROADCAST_EMAIL_TEMPLATE_TYPES_SQL =
  "'broadcast_announcement', 'broadcast_maintenance', 'broadcast_security'";

export const STAGING_AUTH_EMAIL_TEMPLATE_CONTENT_SQL = `SELECT ${AUTH_EMAIL_TEMPLATE_FIELDS.join(", ")}
  FROM email_templates WHERE email_type IN (${AUTH_EMAIL_TEMPLATE_TYPES_SQL}) ORDER BY email_type, language`;
export const STAGING_AUTH_EMAIL_TEMPLATE_COUNT_SQL = `SELECT COUNT(*) AS row_count FROM email_templates
  WHERE email_type IN (${AUTH_EMAIL_TEMPLATE_TYPES_SQL})`;
export const STAGING_BROADCAST_EMAIL_TEMPLATE_CONTENT_SQL = `SELECT ${BROADCAST_EMAIL_TEMPLATE_FIELDS.join(", ")}
  FROM email_templates WHERE email_type IN (${BROADCAST_EMAIL_TEMPLATE_TYPES_SQL}) ORDER BY email_type, language`;
export const STAGING_BROADCAST_EMAIL_TEMPLATE_COUNT_SQL = `SELECT COUNT(*) AS row_count FROM email_templates
  WHERE email_type IN (${BROADCAST_EMAIL_TEMPLATE_TYPES_SQL})`;
export const STAGING_EMAIL_TEMPLATE_TOTAL_COUNT_SQL = "SELECT COUNT(*) AS row_count FROM email_templates";
const EMAIL_TEMPLATE_JSON_FIELDS = BROADCAST_EMAIL_TEMPLATE_FIELDS
  .map((field) => `'${field}', "${field}"`).join(", ");
export const STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL = `SELECT
  (SELECT COUNT(*) FROM email_templates WHERE email_type IN (${AUTH_EMAIL_TEMPLATE_TYPES_SQL})) AS auth_count,
  (SELECT COALESCE(json_group_array(json_object(${AUTH_EMAIL_TEMPLATE_FIELDS
    .map((field) => `'${field}', "${field}"`).join(", ")})), '[]') FROM
      (SELECT ${AUTH_EMAIL_TEMPLATE_FIELDS.map((field) => `"${field}"`).join(", ")} FROM email_templates
       WHERE email_type IN (${AUTH_EMAIL_TEMPLATE_TYPES_SQL}) ORDER BY email_type, language)) AS auth_rows_json,
  (SELECT COUNT(*) FROM email_templates WHERE email_type IN (${BROADCAST_EMAIL_TEMPLATE_TYPES_SQL})) AS broadcast_count,
  (SELECT COALESCE(json_group_array(json_object(${EMAIL_TEMPLATE_JSON_FIELDS})), '[]') FROM
      (SELECT ${BROADCAST_EMAIL_TEMPLATE_FIELDS.map((field) => `"${field}"`).join(", ")} FROM email_templates
       WHERE email_type IN (${BROADCAST_EMAIL_TEMPLATE_TYPES_SQL}) ORDER BY email_type, language)) AS broadcast_rows_json,
  (SELECT COUNT(*) FROM email_templates) AS total_count`;

const BROADCAST_TEMPLATE_TYPES = ["broadcast_announcement", "broadcast_maintenance", "broadcast_security"];
const LANGUAGES = ["en", "id", "ja", "ko"];

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function broadcastTemplateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 12) fail("staging_broadcast_email_template_count_invalid");
  const normalized = rows.map((row) => {
    if (!exactKeys(row, BROADCAST_EMAIL_TEMPLATE_FIELDS)) fail("staging_broadcast_email_template_shape_invalid");
    const active = row.is_active === true || row.is_active === 1 || row.is_active === "1";
    const inactive = row.is_active === false || row.is_active === 0 || row.is_active === "0";
    if (typeof row.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.id) ||
        !BROADCAST_TEMPLATE_TYPES.includes(row.email_type) || !LANGUAGES.includes(row.language) ||
        (!active && !inactive) || typeof row.subject !== "string" || row.subject.length < 1 || row.subject.length > 256 ||
        /[\r\n]/u.test(row.subject) || typeof row.body_text !== "string" || row.body_text.length < 1 ||
        row.body_text.length > 10_000 || typeof row.button_text !== "string" || !row.button_text.trim() ||
        row.button_text.length > 128 || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
        typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) {
      fail("staging_broadcast_email_template_value_invalid");
    }
    return Object.fromEntries(BROADCAST_EMAIL_TEMPLATE_FIELDS.map((field) => [
      field,
      field === "is_active" ? (active ? 1 : 0) : row[field],
    ]));
  }).sort((left, right) => `${left.email_type}/${left.language}`.localeCompare(`${right.email_type}/${right.language}`));
  const identities = normalized.map((row) => `${row.email_type}/${row.language}`);
  if (new Set(identities).size !== 12 || new Set(normalized.map((row) => row.id)).size !== 12 ||
      BROADCAST_TEMPLATE_TYPES.some((type) => LANGUAGES.some((language) => !identities.includes(`${type}/${language}`)))) {
    fail("staging_broadcast_email_template_identity_invalid");
  }
  return normalized;
}

export function broadcastEmailTemplateContentDigest(rows) {
  return createHash("sha256").update(JSON.stringify(broadcastTemplateRows(rows))).digest("hex");
}

export function broadcastEmailTemplateBaselineState(
  rows,
  rowCount = rows?.length,
  expectedDigest = BROADCAST_EMAIL_TEMPLATE_CONTENT_EXPECTED_SHA256,
) {
  const count = Number(rowCount);
  if (Array.isArray(rows) && rows.length === 0 && count === 0) return "empty";
  if (count !== 12) return "invalid";
  try {
    return broadcastEmailTemplateContentDigest(rows) === expectedDigest ? "seeded" : "invalid";
  } catch {
    return "invalid";
  }
}

export function readStagingEmailTemplateMasterBaseline(
  readRows,
  {
    expectedAuthDigest = AUTH_EMAIL_TEMPLATE_CONTENT_EXPECTED_SHA256,
    expectedBroadcastDigest = BROADCAST_EMAIL_TEMPLATE_CONTENT_EXPECTED_SHA256,
  } = {},
) {
  if (typeof readRows !== "function") return "invalid";
  const results = readRows(STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL);
  if (!Array.isArray(results) || results.length !== 1) return "invalid";
  let authRows;
  let broadcastRows;
  try {
    authRows = JSON.parse(results[0].auth_rows_json);
    broadcastRows = JSON.parse(results[0].broadcast_rows_json);
  } catch {
    return "invalid";
  }
  const authState = authEmailTemplateBaselineState(authRows, results[0].auth_count, expectedAuthDigest);
  const broadcastState = broadcastEmailTemplateBaselineState(
    broadcastRows,
    results[0].broadcast_count,
    expectedBroadcastDigest,
  );
  const actualTotal = Number(results[0].total_count);
  const expectedTotal = (authState === "seeded" ? 16 : 0) + (broadcastState === "seeded" ? 12 : 0);
  if (authState === "invalid" || broadcastState === "invalid" || !Number.isSafeInteger(actualTotal) ||
      actualTotal !== expectedTotal) return "invalid";
  if (authState === "empty" && broadcastState === "empty") return "empty";
  if (authState === "seeded" && broadcastState === "empty") return "auth_seeded";
  if (authState === "seeded" && broadcastState === "seeded") return "seeded";
  return "invalid";
}

export function stagingEmailTemplateMasterRowCount(state) {
  if (state === "empty") return 0;
  if (state === "auth_seeded") return 16;
  if (state === "seeded") return 28;
  return null;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE = "fanmark-business-staging";
const ALLOWED_TYPES = new Set(["signup", "recovery", "magiclink", "email_change"]);
const ALLOWED_LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const FIELDS = ["id", "email_type", "language", "subject", "body_text", "button_text", "is_active", "created_at", "updated_at"];
const EXPECTED_SOURCE_SHA256 = "2ccb14f36ef431950871ac820a2e49f1574e415b8c0a3d2d5ad5f0bb17a108e2";
const EXPECTED_SEED_SQL_SHA256 = "938736e71425bcf0823d17836458619eefddd2d90b405265d6728ff0ce4df80b";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = resolve(ROOT, "workers/api");
const SEED_PATH = resolve(ROOT, "scripts/migration/staging-auth-email-template-seed.sql");
const TYPES_SQL = "'signup', 'recovery', 'magiclink', 'email_change'";
const CONTENT_QUERY = `SELECT ${FIELDS.join(", ")} FROM email_templates WHERE email_type IN (${TYPES_SQL}) ORDER BY email_type, language`;
const BASELINE_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM email_templates WHERE email_type IN (${TYPES_SQL})) AS auth_email_templates,
    (SELECT COUNT(*) FROM user_settings) AS user_settings,
    (SELECT COUNT(*) FROM fanmarks) AS fanmarks,
    (SELECT COUNT(*) FROM fanmark_licenses) AS fanmark_licenses,
    (SELECT COUNT(*) FROM fanmark_favorites) AS fanmark_favorites,
    (SELECT COUNT(*) FROM notifications) AS notifications,
    (SELECT COUNT(*) FROM notification_events) AS notification_events
`;

function fail(code) {
  throw new Error(code);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).length !== FIELDS.length || FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(row, field))) {
    fail("staging_auth_email_template_row_shape_invalid");
  }
  const active = row.is_active === true || row.is_active === 1 || row.is_active === "1";
  const normalized = { ...row, is_active: active ? 1 : 0 };
  if (typeof normalized.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized.id) ||
      !ALLOWED_TYPES.has(normalized.email_type) || !ALLOWED_LANGUAGES.has(normalized.language) ||
      !active || typeof normalized.subject !== "string" || normalized.subject.length < 1 || normalized.subject.length > 256 || /[\r\n]/u.test(normalized.subject) ||
      typeof normalized.body_text !== "string" || normalized.body_text.length < 1 || normalized.body_text.length > 10_000 ||
      typeof normalized.button_text !== "string" || normalized.button_text.trim().length < 1 || normalized.button_text.length > 128 ||
      typeof normalized.created_at !== "string" || !Number.isFinite(Date.parse(normalized.created_at)) ||
      typeof normalized.updated_at !== "string" || !Number.isFinite(Date.parse(normalized.updated_at))) {
    fail("staging_auth_email_template_row_value_invalid");
  }
  return Object.fromEntries(FIELDS.map((field) => [field, normalized[field]]));
}

function stableRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 16) fail("staging_auth_email_template_source_count_invalid");
  const normalized = rows.map(normalizeRow).sort((a, b) => `${a.email_type}/${a.language}`.localeCompare(`${b.email_type}/${b.language}`));
  if (new Set(normalized.map((row) => row.id)).size !== 16 ||
      new Set(normalized.map((row) => `${row.email_type}/${row.language}`)).size !== 16) {
    fail("staging_auth_email_template_source_identity_invalid");
  }
  return normalized;
}

function runQuery(sql) {
  const result = spawnSync("npx", [
    "wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", sql,
  ], { cwd: WORKER_DIR, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail("staging_auth_email_template_readback_failed");
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("staging_auth_email_template_readback_invalid_json");
  }
}

function resultRows(value) {
  if (!Array.isArray(value) || value.some((result) => result?.success !== true || !Array.isArray(result.results))) {
    fail("staging_auth_email_template_readback_invalid_result");
  }
  return value.map((result) => result.results);
}

function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) fail("usage: node verify-staging-auth-email-template-seed.mjs <private-source-json>");
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const allowedRootKeys = ["boundary", "rows", "warning"];
  if (!source || typeof source !== "object" || Array.isArray(source) ||
      Object.keys(source).length !== allowedRootKeys.length || allowedRootKeys.some((key) => !Object.prototype.hasOwnProperty.call(source, key)) ||
      typeof source.boundary !== "string" || !/^[0-9a-f]{32}$/u.test(source.boundary) ||
      typeof source.warning !== "string" || !source.warning.includes(`<${source.boundary}>`)) {
    fail("staging_auth_email_template_source_boundary_invalid");
  }

  const expected = stableRows(source.rows);
  const sourceSha256 = digest(Buffer.from(JSON.stringify(expected)));
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) fail("staging_auth_email_template_source_digest_mismatch");
  const seedSqlSha256 = digest(readFileSync(SEED_PATH));
  if (seedSqlSha256 !== EXPECTED_SEED_SQL_SHA256) fail("staging_auth_email_template_seed_digest_mismatch");

  const [actualRows] = resultRows(runQuery(CONTENT_QUERY));
  const [baselineRows] = resultRows(runQuery(BASELINE_QUERY));
  if (baselineRows.length !== 1) fail("staging_auth_email_template_baseline_missing");
  const counts = baselineRows[0];
  if (Number(counts.auth_email_templates) !== 16 ||
      ["user_settings", "fanmarks", "fanmark_licenses", "fanmark_favorites", "notifications", "notification_events"]
        .some((table) => Number(counts[table]) !== 0)) {
    fail("staging_auth_email_template_user_data_boundary_mismatch");
  }

  const actual = stableRows(actualRows);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail("staging_auth_email_template_content_mismatch");
  const typeCounts = Object.fromEntries([...ALLOWED_TYPES].sort().map((type) => [
    type, actual.filter((row) => row.email_type === type).length,
  ]));
  console.log(JSON.stringify({
    status: "verified",
    database: DATABASE,
    sourceContentSha256: sourceSha256,
    seedSqlSha256,
    authEmailTemplateRows: actual.length,
    types: typeCounts,
    userOwnedRows: {
      userSettings: Number(counts.user_settings),
      fanmarks: Number(counts.fanmarks),
      licenses: Number(counts.fanmark_licenses),
      favorites: Number(counts.fanmark_favorites),
      notifications: Number(counts.notifications),
      notificationEvents: Number(counts.notification_events),
    },
  }));
}

main();

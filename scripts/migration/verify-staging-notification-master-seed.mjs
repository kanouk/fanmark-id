import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DATABASE = "fanmark-business-staging";
const EXPECTED_SOURCE_SHA256 = "900f9f3a00bd5d0e68de541a0ad2a10a47c24def6613b89be69739b34584b3fb";
const JSON_COLUMNS = new Set(["segment_filter", "payload_schema"]);
const BOOLEAN_COLUMNS = new Set(["enabled", "is_active"]);
const MASTER_QUERY = `
  SELECT * FROM notification_rules ORDER BY id;
  SELECT * FROM notification_templates ORDER BY id;
`;
const BASELINE_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM notification_rules) AS notification_rules,
    (SELECT COUNT(*) FROM notification_templates) AS notification_templates,
    (SELECT COUNT(*) FROM notification_preferences) AS notification_preferences,
    (SELECT COUNT(*) FROM notification_events) AS notification_events,
    (SELECT COUNT(*) FROM notifications) AS notifications,
    (SELECT COUNT(*) FROM user_settings) AS user_settings,
    (SELECT COUNT(*) FROM fanmarks) AS fanmarks,
    (SELECT COUNT(*) FROM fanmark_licenses) AS fanmark_licenses,
    (SELECT COUNT(*) FROM system_settings) AS system_settings,
    (SELECT COUNT(*) FROM system_settings
      WHERE setting_key = 'grace_period_days' AND setting_value = '1' AND is_public = 1) AS expected_system_setting,
    (SELECT COUNT(*) FROM system_settings
      WHERE setting_key = 'max_emoji_characters' AND setting_value = '5' AND is_public = 1) AS expected_max_emoji_setting
`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function normalizeRow(row) {
  const normalized = {};
  for (const [key, original] of Object.entries(row)) {
    if (key === "created_by") continue;
    let value = original;
    if (BOOLEAN_COLUMNS.has(key)) value = typeof value === "boolean" ? Number(value) : value;
    if (JSON_COLUMNS.has(key) && value !== null) {
      value = stable(typeof value === "string" ? JSON.parse(value) : value);
    }
    normalized[key] = value;
  }
  return stable(normalized);
}

function runQuery(sql) {
  const result = spawnSync("npx", [
    "wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", sql,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error("staging_notification_master_readback_failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("staging_notification_master_readback_invalid_json");
  }
}

function resultRows(value) {
  if (!Array.isArray(value) || value.some((result) => result?.success !== true || !Array.isArray(result.results))) {
    throw new Error("staging_notification_master_readback_invalid_result");
  }
  return value.map((result) => result.results);
}

function compareTable(name, expected, actual) {
  if (!Array.isArray(expected) || expected.length < 1 || expected.length > 64) {
    throw new Error(`staging_notification_master_source_${name}_invalid`);
  }
  if (actual.length !== expected.length) throw new Error(`staging_notification_master_${name}_count_mismatch`);
  for (const row of actual) {
    if (name === "rules" && row.created_by !== null) {
      throw new Error("staging_notification_master_created_by_not_null");
    }
  }
  const expectedRows = expected.map(normalizeRow).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const actualRows = actual.map(normalizeRow).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (JSON.stringify(expectedRows) !== JSON.stringify(actualRows)) {
    throw new Error(`staging_notification_master_${name}_content_mismatch`);
  }
  return createHash("sha256").update(JSON.stringify(expectedRows)).digest("hex");
}

function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error("usage: node verify-staging-notification-master-seed.mjs <private-source-json>");
  const sourceBytes = readFileSync(sourcePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) throw new Error("staging_notification_master_source_digest_mismatch");
  const source = JSON.parse(sourceBytes.toString("utf8"));
  if (source.source !== "linked_supabase_public_master_only" ||
      Object.keys(source).some((key) => !["source", "rules", "templates"].includes(key))) {
    throw new Error("staging_notification_master_source_scope_mismatch");
  }

  const [actualRules, actualTemplates] = resultRows(runQuery(MASTER_QUERY));
  const [baseline] = resultRows(runQuery(BASELINE_QUERY));
  if (baseline.length !== 1) throw new Error("staging_notification_master_baseline_missing");
  const counts = baseline[0];
  if (counts.notification_rules !== 10 || counts.notification_templates !== 40 ||
      counts.notification_preferences !== 0 || counts.notification_events !== 0 ||
      counts.notifications !== 0 || counts.user_settings !== 0 || counts.fanmarks !== 0 ||
      counts.fanmark_licenses !== 0 || counts.system_settings !== 2 || counts.expected_system_setting !== 1 ||
      counts.expected_max_emoji_setting !== 1) {
    throw new Error("staging_notification_master_unexpected_business_baseline");
  }

  const rulesSha256 = compareTable("rules", source.rules, actualRules);
  const templatesSha256 = compareTable("templates", source.templates, actualTemplates);
  console.log(JSON.stringify({
    status: "verified",
    database: DATABASE,
    sourceSha256,
    rules: { rows: actualRules.length, canonicalSha256: rulesSha256 },
    templates: { rows: actualTemplates.length, canonicalSha256: templatesSha256 },
    userAndEventRows: "empty",
    publicSettingBaseline: "preserved",
  }));
}

main();

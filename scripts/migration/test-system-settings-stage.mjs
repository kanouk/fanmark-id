import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSystemSettingsInsertSql,
  parseSystemSettingsSourceText,
  SYSTEM_SETTINGS_STAGE_KEYS,
} from "./system-settings-stage.mjs";

const PRIVATE_KEYS = new Set(["enterprise_fanmarks_limit", "enterprise_pricing"]);

function valueFor(key) {
  if (key === "invitation_mode" || key === "social_login_enabled") return "false";
  if (key === "stripe_mode") return "test";
  if (key.endsWith("_limit") || key.endsWith("_pricing")) return "5";
  return "price_synthetic";
}

function sourceRows() {
  return SYSTEM_SETTINGS_STAGE_KEYS.map((setting_key, index) => ({
    id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    setting_key,
    setting_value: valueFor(setting_key),
    description: setting_key === "stripe_mode" ? "synthetic's description" : `synthetic ${setting_key}`,
    is_public: !PRIVATE_KEYS.has(setting_key),
    created_at: "2026-09-27T00:00:00.000Z",
    updated_at: "2026-09-27T00:00:00.000Z",
  }));
}

function envelope(rows) {
  const boundary = "synthetic-boundary";
  return `Initialising login role...\n${JSON.stringify({
    boundary,
    rows,
    warning: `Untrusted database rows are bounded by <${boundary}>`,
  })}`;
}

test("accepts the exact projected source rows and validates the output boundary", () => {
  const rows = sourceRows();
  const parsed = parseSystemSettingsSourceText(envelope(rows), { requirePinnedDigest: false });
  assert.equal(parsed.rows.length, 18);
  assert.deepEqual(parsed.rows.map((row) => row.setting_key), [...SYSTEM_SETTINGS_STAGE_KEYS].sort());
  assert.equal(parsed.rows.find((row) => row.setting_key === "enterprise_pricing")?.is_public, false);
});

test("rejects missing, duplicate, out-of-scope, private-visibility, malformed, and unpinned rows", () => {
  const rows = sourceRows();
  assert.throws(() => parseSystemSettingsSourceText(envelope(rows.slice(1)), { requirePinnedDigest: false }), /row_count_mismatch/u);
  assert.throws(() => parseSystemSettingsSourceText(envelope([...rows.slice(1), rows[0], rows[0]]), { requirePinnedDigest: false }), /row_count_mismatch/u);
  assert.throws(() => parseSystemSettingsSourceText(envelope(rows.map((row) => row.setting_key === "business_pricing"
    ? { ...row, setting_key: "created_by" } : row)), { requirePinnedDigest: false }), /row_invalid/u);
  assert.throws(() => parseSystemSettingsSourceText(envelope(rows.map((row) => row.setting_key === "enterprise_pricing"
    ? { ...row, is_public: true } : row)), { requirePinnedDigest: false }), /row_invalid/u);
  assert.throws(() => parseSystemSettingsSourceText(envelope(rows), { requirePinnedDigest: true }), /digest_mismatch/u);
  assert.throws(() => parseSystemSettingsSourceText(JSON.stringify({ rows, boundary: "wrong", warning: "no boundary" }), {
    requirePinnedDigest: false,
  }), /boundary_invalid/u);
});

test("builds one escaped multi-row insert only from the expected setting projection", () => {
  const rows = sourceRows();
  const sql = buildSystemSettingsInsertSql(rows, { requirePinnedDigest: false });
  assert.match(sql, /^INSERT INTO system_settings/u);
  assert.equal((sql.match(/\n\(/gu) ?? []).length, 18);
  assert.match(sql, /synthetic''s description/u);
  assert.doesNotMatch(sql, /created_by/u);
  assert.throws(() => buildSystemSettingsInsertSql(rows.slice(1), { requirePinnedDigest: false }), /insert_input_mismatch/u);
});

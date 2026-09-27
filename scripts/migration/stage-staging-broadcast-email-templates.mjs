#!/usr/bin/env node

/**
 * Seed only the reviewed, non-user broadcast email template masters into the
 * isolated business staging D1. Source values are supplied as a private
 * read-only Supabase CLI result and never written into the repository.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DATABASE = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const TEMPLATE_TYPES = ["broadcast_announcement", "broadcast_maintenance", "broadcast_security"];
const LANGUAGES = ["en", "id", "ja", "ko"];
const EXPECTED_SOURCE_SHA256 = "770459e45e66f1c81ba58ea507b518f00c67004d289f5919d8c16c0f2c279f14";
const FIELDS = [
  "id", "email_type", "language", "subject", "body_text", "button_text",
  "is_active", "created_at", "updated_at",
];
const TYPES_SQL = TEMPLATE_TYPES.map((value) => `'${value}'`).join(", ");
const CONTENT_QUERY = `SELECT ${FIELDS.join(", ")} FROM email_templates WHERE email_type IN (${TYPES_SQL}) ORDER BY email_type, language`;
const BASELINE_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM email_templates WHERE email_type IN (${TYPES_SQL})) AS broadcast_templates,
    (SELECT COUNT(*) FROM email_templates WHERE email_type NOT IN (${TYPES_SQL})) AS other_templates
`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = path.join(ROOT, "workers/api");
const WRANGLER_CONFIG = path.join(WORKER_DIR, "wrangler.app-staging.jsonc");

function fail(code) {
  throw new Error(code);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function nonEmptyText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}

function normalizeRow(row) {
  if (!exactKeys(row, FIELDS)) fail("broadcast_template_source_row_shape_invalid");
  const active = row.is_active === true || row.is_active === 1 || row.is_active === "1";
  const inactive = row.is_active === false || row.is_active === 0 || row.is_active === "0";
  if (
    typeof row.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.id) ||
    !TEMPLATE_TYPES.includes(row.email_type) || !LANGUAGES.includes(row.language) ||
    (!active && !inactive) ||
    !nonEmptyText(row.subject, 256) || /[\r\n]/u.test(row.subject) ||
    !nonEmptyText(row.body_text, 10_000) ||
    !nonEmptyText(row.button_text, 128) || !row.button_text.trim() ||
    typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) ||
    typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))
  ) fail("broadcast_template_source_row_value_invalid");

  return Object.fromEntries(FIELDS.map((field) => [
    field,
    field === "is_active" ? (active ? 1 : 0) : row[field],
  ]));
}

function stableRows(rows) {
  const expectedCount = TEMPLATE_TYPES.length * LANGUAGES.length;
  if (!Array.isArray(rows) || rows.length !== expectedCount) fail("broadcast_template_source_count_invalid");
  const normalized = rows.map(normalizeRow)
    .sort((left, right) => `${left.email_type}/${left.language}`.localeCompare(`${right.email_type}/${right.language}`));
  const identities = normalized.map((row) => `${row.email_type}/${row.language}`);
  if (new Set(identities).size !== expectedCount || new Set(normalized.map((row) => row.id)).size !== expectedCount) {
    fail("broadcast_template_source_identity_invalid");
  }
  for (const type of TEMPLATE_TYPES) {
    for (const language of LANGUAGES) {
      if (!identities.includes(`${type}/${language}`)) fail("broadcast_template_source_locale_missing");
    }
  }
  return normalized;
}

async function loadSource(sourcePath) {
  let source;
  const safeSourcePath = requirePath(sourcePath);
  let stats;
  try {
    stats = await fs.stat(safeSourcePath);
  } catch {
    fail("broadcast_template_source_unavailable");
  }
  if ((stats.mode & 0o077) !== 0) fail("broadcast_template_source_permissions_too_open");
  try {
    source = JSON.parse(await fs.readFile(safeSourcePath, "utf8"));
  } catch {
    fail("broadcast_template_source_invalid_json");
  }
  const rootKeys = ["boundary", "rows", "warning"];
  if (
    !exactKeys(source, rootKeys) || typeof source.boundary !== "string" || !/^[0-9a-f]{32}$/u.test(source.boundary) ||
    typeof source.warning !== "string" || !source.warning.includes(`<${source.boundary}>`) ||
    !Array.isArray(source.rows) || source.rows.length !== 1 || !exactKeys(source.rows[0], ["templates"])
  ) fail("broadcast_template_source_boundary_invalid");

  let rows = source.rows[0].templates;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      fail("broadcast_template_source_templates_invalid_json");
    }
  }
  return stableRows(rows);
}

function requirePath(value) {
  if (typeof value !== "string" || value.length === 0) fail("broadcast_template_source_path_missing");
  return value;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function renderSeed(rows) {
  const columns = FIELDS.map((field) => `"${field}"`).join(", ");
  const values = rows.map((row) => `(${FIELDS.map((field) =>
    field === "is_active" ? String(row[field]) : sqlText(row[field])
  ).join(", ")})`).join(",\n");
  return `INSERT INTO "email_templates" (${columns}) VALUES\n${values};\n`;
}

function runWrangler(args) {
  const result = spawnSync("npm", [
    "exec", "--", "wrangler", "--config", "wrangler.app-staging.jsonc",
    "d1", "execute", DATABASE, "--remote", ...args,
  ], { cwd: WORKER_DIR, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail("broadcast_template_staging_command_failed");
  return result.stdout;
}

function parseWranglerJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    fail("broadcast_template_staging_result_invalid_json");
  }
}

function readRows(query) {
  const results = parseWranglerJson(runWrangler(["--json", "--command", query]));
  if (!Array.isArray(results) || results.length !== 1 || results[0]?.success !== true || !Array.isArray(results[0].results)) {
    fail("broadcast_template_staging_read_failed");
  }
  if (results[0].meta?.changed_db !== false || Number(results[0].meta?.rows_written) !== 0) {
    fail("broadcast_template_staging_read_not_readonly");
  }
  return results[0].results;
}

async function assertStagingConfig() {
  const config = await fs.readFile(WRANGLER_CONFIG, "utf8");
  if (!config.includes(`"${DATABASE}"`) || !config.includes(`"${DATABASE_ID}"`)) {
    fail("broadcast_template_staging_database_mismatch");
  }
}

function sourceDigest(rows) {
  return digest(JSON.stringify(rows));
}

function baseline() {
  const rows = readRows(BASELINE_QUERY);
  if (rows.length !== 1) fail("broadcast_template_staging_baseline_missing");
  return {
    broadcastTemplates: Number(rows[0].broadcast_templates),
    otherTemplates: Number(rows[0].other_templates),
  };
}

async function applySeed(rows) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-broadcast-template-seed-"));
  await fs.chmod(temporaryDirectory, 0o700);
  const sqlPath = path.join(temporaryDirectory, "broadcast-templates.sql");
  try {
    await fs.writeFile(sqlPath, renderSeed(rows), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.chmod(sqlPath, 0o600);
    runWrangler(["--file", sqlPath, "--yes"]);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    try {
      await fs.stat(temporaryDirectory);
      fail("broadcast_template_seed_temporary_cleanup_failed");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sourcePath = args[0];
  const apply = args.length === 2 && args[1] === "--apply";
  if (!sourcePath || (args.length > 1 && !apply)) {
    fail("usage: node scripts/migration/stage-staging-broadcast-email-templates.mjs <private-source-json> [--apply]");
  }
  const rows = await loadSource(sourcePath);
  const sourceContentSha256 = sourceDigest(rows);
  if (sourceContentSha256 !== EXPECTED_SOURCE_SHA256) fail("broadcast_template_source_digest_mismatch");
  await assertStagingConfig();

  if (!apply) {
    console.log(JSON.stringify({
      status: "dry_run_ready",
      database: DATABASE,
      templateRows: rows.length,
      sourceContentSha256,
      remoteWrite: false,
      emailSent: false,
    }));
    return;
  }

  const before = baseline();
  if (before.otherTemplates !== 16) fail("broadcast_template_auth_master_baseline_mismatch");
  if (![0, rows.length].includes(before.broadcastTemplates)) fail("broadcast_template_partial_staging_state");
  const existing = readRows(CONTENT_QUERY);
  if (before.broadcastTemplates === rows.length && JSON.stringify(stableRows(existing)) !== JSON.stringify(rows)) {
    fail("broadcast_template_staging_content_mismatch");
  }
  let seeded = false;
  if (before.broadcastTemplates === 0) {
    await applySeed(rows);
    seeded = true;
  }

  const after = baseline();
  const actual = stableRows(readRows(CONTENT_QUERY));
  if (
    after.broadcastTemplates !== rows.length || after.otherTemplates !== before.otherTemplates ||
    JSON.stringify(actual) !== JSON.stringify(rows)
  ) fail("broadcast_template_staging_readback_mismatch");
  console.log(JSON.stringify({
    status: "verified",
    database: DATABASE,
    templateRows: actual.length,
    sourceContentSha256,
    seeded,
    otherTemplateRowsBeforeAfter: before.otherTemplates,
    changedDb: seeded,
    emailSent: false,
    userRowsReadOrWritten: false,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", code: error?.message ?? "broadcast_template_seed_failed" }));
  process.exitCode = 1;
});

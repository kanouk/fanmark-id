#!/usr/bin/env node

/** Apply the exact additive coupon audit migration and exercise synthetic rows only. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasBusinessMigrationApplied,
  isBusinessMigrationLedgerImmediatelyBefore,
} from "./business-migration-ledger.mjs";
import {
  businessTablesWithoutStagingBaselines,
  NOTIFICATION_MASTER_COUNTS_SQL,
  notificationMasterBaselineState,
  readStagingExtensionCouponMasterBaseline,
  STAGING_NON_USER_CONFIG_BASELINE_SQL,
  stagingBusinessBaselineRowCount,
  stagingNonUserConfigBaselineState,
} from "./staging-notification-master-baseline.mjs";
import {
  readStagingEmailTemplateMasterBaseline,
  stagingEmailTemplateMasterRowCount,
} from "./staging-email-template-master-baseline.mjs";
import { isStagingNotificationArchiveTarget } from "./staging-notification-archive-target.mjs";
import { safeWranglerDiagnostics } from "./safe-diagnostics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = path.join(ROOT, "workers/api");
const BUSINESS = "fanmark-business-staging";
const AUTH = "fanmark-auth-staging";
const APP_CONFIG = "wrangler.app-staging.jsonc";
const AUTH_CONFIG = "wrangler.auth-staging.jsonc";
const MIGRATION = "0021_coupon_lottery_status_audit.sql";
const TRIGGER = "extension_coupon_lottery_status_audit";
const AUTH_TABLES = ["user", "account", "session", "verification", "twoFactor", "adminRole", "mfaAssurance"];
const WRANGLER = "4.139.0";
let journalPath;
let phase = "preflight";

function fail(code) { throw new Error(code); }
function sql(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
function normalizedSql(value) {
  return String(value).replace(/^[ \t]*--.*$/gmu, "").replace(/;+\s*$/u, "").replace(/\s+/gu, " ").trim();
}
function wrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER}`, ...args], {
    cwd: WORKER_DIR, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", CI: "1" },
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error("coupon_audit_staging_wrangler_failed");
    error.command = args.slice(0, 2).join(" ");
    error.phase = phase;
    const diagnosticsDirectory = mkdtempSync(path.join(tmpdir(), "fanmark-coupon-audit-error-"));
    chmodSync(diagnosticsDirectory, 0o700);
    error.diagnosticsPath = path.join(diagnosticsDirectory, "wrangler-output.json");
    writeFileSync(error.diagnosticsPath, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }), { mode: 0o600 });
    error.diagnostics = safeWranglerDiagnostics(result.stderr);
    try {
      const output = JSON.parse(result.stdout);
      const detail = output?.error;
      if (detail && typeof detail === "object") {
        error.diagnostics.push(...safeWranglerDiagnostics([
          detail.text ?? detail.message ?? "",
          ...(Array.isArray(detail.notes) ? detail.notes.map(note => note.text ?? "") : []),
        ].join("\n")));
      }
    } catch { /* Full provider output is retained only in the private diagnostics file. */ }
    error.exit = result.status ?? result.error?.code;
    throw error;
  }
  return result.stdout.trim();
}
function json(args) {
  const output = wrangler(args);
  try { return JSON.parse(output); } catch { fail("coupon_audit_staging_json_invalid"); }
}
function d1(command, { write = false, database = BUSINESS, config = APP_CONFIG } = {}) {
  const results = json(["d1", "execute", database, "--remote", "--json", "--command", command, "--config", config]);
  if (!Array.isArray(results) || results.length === 0 || results.some(row =>
    row.success !== true || !Array.isArray(row.results) ||
    (!write && (row.meta?.changed_db !== false || Number(row.meta?.rows_written) !== 0)))) {
    fail("coupon_audit_staging_d1_result_invalid");
  }
  return results.flatMap(row => row.results);
}
function sum(tables) { return tables.map(table => `(SELECT COUNT(*) FROM "${table}")`).join(" + ") || "0"; }
function baseline(tables) {
  const masters = d1(NOTIFICATION_MASTER_COUNTS_SQL)[0];
  const settings = d1(STAGING_NON_USER_CONFIG_BASELINE_SQL)[0];
  const emails = readStagingEmailTemplateMasterBaseline(command => d1(command));
  const coupons = readStagingExtensionCouponMasterBaseline(command => d1(command));
  if (notificationMasterBaselineState(masters) !== "seeded" || stagingNonUserConfigBaselineState(settings) !== "seeded" ||
    emails === "invalid" || coupons !== "seeded") fail("coupon_audit_staging_master_baseline_invalid");
  const total = Number(d1(`SELECT ${sum(tables)} AS count`)[0]?.count);
  const expected = stagingBusinessBaselineRowCount(settings, masters) + stagingEmailTemplateMasterRowCount(emails) + 4;
  const nonBaseline = businessTablesWithoutStagingBaselines(tables, {
    verifiedEmailTemplateMasters: true, verifiedExtensionCouponMaster: true,
  });
  if (total !== expected || Number(d1(`SELECT ${sum(nonBaseline)} AS count`)[0]?.count) !== 0) {
    fail("coupon_audit_staging_business_rows_present");
  }
  if (Number(d1(`SELECT ${sum(AUTH_TABLES)} AS count`, { database: AUTH, config: AUTH_CONFIG })[0]?.count) !== 0) {
    fail("coupon_audit_staging_auth_rows_present");
  }
  for (const table of ["extension_coupon_application_commands", "stripe_extension_applications", "stripe_extension_application_lottery_entries"]) {
    if (Number(d1(`SELECT COUNT(*) AS count FROM ${table}`)[0]?.count) !== 0) fail("coupon_audit_staging_commands_present");
  }
  return { total, masters, settings, emails, coupons };
}
function ledger() { return d1("SELECT name FROM d1_migrations ORDER BY id").map(row => row.name); }
function pending() {
  return [...wrangler(["d1", "migrations", "list", BUSINESS, "--remote", "--config", APP_CONFIG])
    .matchAll(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/gu)].map(match => match[0]);
}
function verifyTrigger() {
  const rows = d1(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ${sql(TRIGGER)}`);
  const expected = readFileSync(path.join(WORKER_DIR, "migrations-business", MIGRATION), "utf8");
  if (rows.length !== 1 || normalizedSql(rows[0].sql) !== normalizedSql(expected)) fail("coupon_audit_staging_trigger_drift");
}
function verifyExistingTriggers() {
  for (const [name, migration] of [
    ["extension_coupon_application_apply", "0015_extension_coupon_application.sql"],
    ["extension_coupon_application_guard", "0019_extension_coupon_timestamp_precision.sql"],
  ]) {
    const source = readFileSync(path.join(WORKER_DIR, "migrations-business", migration), "utf8");
    const expected = source.slice(source.indexOf(`CREATE TRIGGER ${name}`));
    const rows = d1(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=${sql(name)}`);
    if (rows.length !== 1 || normalizedSql(rows[0].sql) !== normalizedSql(expected)) {
      fail("coupon_audit_staging_existing_trigger_drift");
    }
  }
}
function verifyTarget() {
  const config = JSON.parse(readFileSync(path.join(WORKER_DIR, APP_CONFIG), "utf8"));
  const identity = json(["whoami", "--json"]);
  // Reuse the stricter account/bindings/no-domain/disabled-billing guard used by archive smoke.
  if (!isStagingNotificationArchiveTarget(config, identity) || config.vars.EXTENSION_COUPON_BACKEND !== "d1" ||
    config.vars.EXTENSION_COUPON_ADMIN_BACKEND !== "d1") fail("coupon_audit_staging_target_mismatch");
  const source = readFileSync(path.join(WORKER_DIR, "migrations-business/0000_business_schema_v4_staging.sql"), "utf8");
  const tables = [...source.matchAll(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/gmu)].map(match => match[1]);
  if (tables.length !== 40) fail("coupon_audit_staging_table_inventory_mismatch");
  return tables;
}
function command(ids, now, previousEnd, newEnd) {
  return `INSERT INTO extension_coupon_application_commands
    (id, request_id, user_id, license_id, coupon_id, coupon_code, fanmark_id, tier_level, months,
     previous_status, previous_license_end, new_license_end, applied_at, status, cancelled_lottery_entries)
    SELECT ${sql(ids.command)}, ${sql(ids.request)}, ${sql(ids.owner)}, ${sql(ids.license)}, ${sql(ids.coupon)},
      ${sql(ids.code)}, ${sql(ids.fanmark)}, 2, 2, 'active', ${sql(previousEnd)}, ${sql(newEnd)}, ${sql(now)}, 'processing', 0
    WHERE NOT EXISTS (SELECT 1 FROM extension_coupon_application_commands
      WHERE user_id = ${sql(ids.owner)} AND request_id = ${sql(ids.request)})`;
}
function eventKeys(ids) {
  return [ids.entry1, ids.entry2].map(id => sql(`coupon-extension:${ids.command}:${id}`)).join(", ");
}
function cleanup(ids) {
  d1([
    `DELETE FROM notifications WHERE user_id IN (${sql(ids.applicant1)}, ${sql(ids.applicant2)})
      OR event_id IN (SELECT id FROM notification_events WHERE dedupe_key IN (${eventKeys(ids)}))`,
    `DELETE FROM notification_events WHERE dedupe_key IN (${eventKeys(ids)})`,
    `DELETE FROM audit_logs WHERE request_id = ${sql(ids.command)} OR (resource_type = 'fanmark_license' AND resource_id = ${sql(ids.license)})`,
    `DELETE FROM fanmark_lottery_entries WHERE license_id = ${sql(ids.license)}`,
    `DELETE FROM extension_coupon_usages WHERE coupon_id = ${sql(ids.coupon)}`,
    `DELETE FROM extension_coupon_application_commands WHERE id = ${sql(ids.command)}`,
    `DELETE FROM fanmark_licenses WHERE id = ${sql(ids.license)}`,
    `DELETE FROM fanmarks WHERE id = ${sql(ids.fanmark)}`,
    `DELETE FROM extension_coupons WHERE id = ${sql(ids.coupon)}`,
  ].join("; "), { write: true });
}
function smoke(tables, before) {
  const ids = Object.fromEntries(["owner", "applicant1", "applicant2", "license", "fanmark", "coupon", "command", "request", "entry1", "entry2"].map(key => [key, randomUUID()]));
  const journalDirectory = mkdtempSync(path.join(tmpdir(), "fanmark-coupon-audit-canary-"));
  chmodSync(journalDirectory, 0o700);
  journalPath = path.join(journalDirectory, "canary.json");
  ids.code = `AUDIT${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction) => `.${fraction}000Z`);
  const previousEndDate = new Date(Date.now() + 7 * 86_400_000);
  previousEndDate.setUTCHours(0, 0, 0, 0);
  const previousEnd = previousEndDate.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction) => `.${fraction}000Z`);
  const targetMonth = previousEndDate.getUTCMonth() + 2;
  const lastDay = new Date(Date.UTC(previousEndDate.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  const newEnd = new Date(Date.UTC(previousEndDate.getUTCFullYear(), targetMonth,
    Math.min(previousEndDate.getUTCDate(), lastDay))).toISOString()
    .replace(/\.(\d{3})Z$/u, (_match, fraction) => `.${fraction}000Z`);
  writeFileSync(journalPath, JSON.stringify({ ids, now, previousEnd, newEnd, state: "prepared" }), { mode: 0o600 });
  let failure;
  try {
    phase = "seed-synthetic-rows";
    d1([
      `INSERT INTO extension_coupons (id, code, months, max_uses, used_count, is_active, created_at, updated_at)
        VALUES (${sql(ids.coupon)}, ${sql(ids.code)}, 2, 1, 0, 1, ${sql(now)}, ${sql(now)})`,
      `INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at, normalized_emoji_ids, tier_level)
        VALUES (${sql(ids.fanmark)}, '🧪', ${sql(`audit-${ids.fanmark}`)}, ${sql(ids.fanmark.replaceAll("-", "").slice(0, 8))}, 'active', ${sql(now)}, ${sql(now)}, '["synthetic-audit"]', 2)`,
      `INSERT INTO fanmark_licenses (id, fanmark_id, user_id, license_start, license_end, status, created_at, updated_at, display_fanmark)
        VALUES (${sql(ids.license)}, ${sql(ids.fanmark)}, ${sql(ids.owner)}, ${sql(now)}, ${sql(previousEnd)}, 'active', ${sql(now)}, ${sql(now)}, '🧪')`,
      ...[1, 2].map(index => `INSERT INTO fanmark_lottery_entries
        (id, fanmark_id, user_id, license_id, lottery_probability, entry_status, applied_at, created_at, updated_at)
        VALUES (${sql(ids[`entry${index}`])}, ${sql(ids.fanmark)}, ${sql(ids[`applicant${index}`])}, ${sql(ids.license)}, '1.0', 'pending', ${sql(now)}, ${sql(now)}, ${sql(now)})`),
    ].join("; "), { write: true });
    const insert = command(ids, now, previousEnd, newEnd);
    phase = "apply-synthetic-command";
    d1(insert, { write: true });
    // Replay the same API command's guarded insert; the saved response and all effects stay unchanged.
    phase = "replay-synthetic-command";
    d1(insert, { write: true });
    phase = "verify-synthetic-effects";
    const saved = d1(`SELECT status, cancelled_lottery_entries FROM extension_coupon_application_commands WHERE id = ${sql(ids.command)}`)[0];
    assert.deepEqual(saved, { status: "completed", cancelled_lottery_entries: 2 });
    const audits = d1(`SELECT user_id, resource_type, resource_id, request_id, metadata, created_at
      FROM audit_logs WHERE action = 'LOTTERY_ENTRY_STATUS_CHANGED' AND request_id = ${sql(ids.command)}`);
    assert.equal(audits.length, 2);
    for (let index = 1; index <= 2; index += 1) {
      const audit = audits.find(row => row.resource_id === ids[`entry${index}`]);
      assert.equal(audit?.user_id, ids[`applicant${index}`]);
      assert.equal(audit.resource_type, "fanmark_lottery_entry");
      assert.equal(audit.created_at, now);
      assert.deepEqual(JSON.parse(audit.metadata), {
        old_status: "pending", new_status: "cancelled_by_extension", cancellation_reason: "license_extended",
      });
    }
    const counts = d1(`SELECT
      (SELECT used_count FROM extension_coupons WHERE id = ${sql(ids.coupon)}) AS used,
      (SELECT COUNT(*) FROM extension_coupon_usages WHERE coupon_id = ${sql(ids.coupon)}) AS usages,
      (SELECT COUNT(*) FROM notification_events WHERE dedupe_key IN (${eventKeys(ids)})) AS notices,
      (SELECT COUNT(*) FROM fanmark_lottery_entries WHERE license_id = ${sql(ids.license)} AND entry_status = 'cancelled_by_extension') AS cancelled`)[0];
    assert.deepEqual(counts, { used: 1, usages: 1, notices: 2, cancelled: 2 });
    assert.equal(d1(`SELECT license_end FROM fanmark_licenses WHERE id = ${sql(ids.license)}`)[0]?.license_end, newEnd);
  } catch (error) { failure = error; }
  phase = "cleanup-synthetic-rows";
  try { cleanup(ids); } catch { failure ??= new Error("coupon_audit_staging_cleanup_failed"); }
  phase = "verify-cleanup-baseline";
  try { assert.deepEqual(baseline(tables), before); } catch { failure ??= new Error("coupon_audit_staging_cleanup_readback_failed"); }
  if (failure) throw failure;
  writeFileSync(journalPath, JSON.stringify({ ids, now, previousEnd, newEnd, state: "cleaned-and-verified" }), { mode: 0o600 });
}

function main() {
  if (process.argv.slice(2).some(arg => arg !== "--apply-and-smoke")) fail("coupon_audit_staging_unknown_argument");
  const tables = verifyTarget();
  const before = baseline(tables);
  verifyExistingTriggers();
  const applied = hasBusinessMigrationApplied(ledger(), MIGRATION);
  if (!applied && !isBusinessMigrationLedgerImmediatelyBefore(ledger(), MIGRATION)) fail("coupon_audit_staging_ledger_invalid");
  const pendingNames = pending();
  assert.deepEqual(pendingNames, applied ? [] : [MIGRATION]);
  if (applied) verifyTrigger();
  else if (d1(`SELECT name FROM sqlite_master WHERE type='trigger' AND name=${sql(TRIGGER)}`).length !== 0) fail("coupon_audit_staging_unledgered_trigger");
  if (!process.argv.includes("--apply-and-smoke")) {
    console.log(JSON.stringify({ mode: "readonly", migration: MIGRATION, applied, baseline: "verified" }));
    return;
  }
  if (!applied) {
    // The file-import path preserves trigger bodies and commits their ledger row
    // together, as in the existing Business/Auth staging migration applicators.
    const directory = mkdtempSync(path.join(tmpdir(), "fanmark-coupon-audit-migration-"));
    chmodSync(directory, 0o700);
    const file = path.join(directory, MIGRATION);
    const migration = readFileSync(path.join(WORKER_DIR, "migrations-business", MIGRATION), "utf8");
    writeFileSync(file, migration + `\nINSERT INTO d1_migrations (name) VALUES (${sql(MIGRATION)});\n`, { mode: 0o600 });
    phase = "apply-migration-file";
    wrangler(["d1", "execute", BUSINESS, "--remote", "--file", file, "--config", APP_CONFIG]);
  }
  if (!hasBusinessMigrationApplied(ledger(), MIGRATION)) fail("coupon_audit_staging_ledger_readback_failed");
  assert.deepEqual(pending(), []);
  verifyTrigger();
  assert.deepEqual(baseline(tables), before);
  smoke(tables, before);
  console.log(JSON.stringify({ mode: "applied-and-smoked", migration: MIGRATION, exactTriggerReadback: true,
    applicants: 2, perEntryAudits: 2, duplicateReplay: "unchanged", cleanup: "verified", authRows: 0, pendingMigrations: 0 }));
}
try { main(); } catch (error) {
  // Provider output, source coupon values, and synthetic identifiers stay out of diagnostics.
  console.error(JSON.stringify({ error: error.message?.startsWith("coupon_audit_staging_") ? error.message : "coupon_audit_staging_verification_failed",
    command: error.command, phase: error.phase ?? phase, exit: error.exit, diagnostics: error.diagnostics, diagnosticsPath: error.diagnosticsPath, journalPath }));
  process.exitCode = 1;
}

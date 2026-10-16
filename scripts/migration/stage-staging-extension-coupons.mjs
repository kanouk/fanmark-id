#!/usr/bin/env node

/**
 * Stage only coupon definitions with zero recorded uses and no usage rows.
 * User-linked coupon usage, creator IDs, and consumed coupons are excluded.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EXTENSION_COUPON_MASTER_ROW_COUNT,
  EXTENSION_COUPON_MASTER_SOURCE_DIGEST,
  STAGING_EXTENSION_COUPON_READBACK_SQL,
  STAGING_EXTENSION_COUPON_USAGE_COUNT_SQL,
  buildExtensionCouponMasterInsertSql,
  canonicalizeExtensionCouponSourceRows,
  extensionCouponMasterBaselineState,
  extensionCouponMasterDigest,
} from "./extension-coupon-master.mjs";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const DATABASE = "fanmark-business-staging";
const DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const WRANGLER_VERSION = "4.139.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = path.join(ROOT, "workers/api");
const CONFIG_PATH = path.join(WORKER_DIR, "wrangler.app-staging.jsonc");

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function privateSourcePath(value) {
  if (typeof value !== "string" || value.length === 0) fail("extension_coupon_source_path_missing");
  const resolved = path.resolve(value);
  const relative = path.relative(ROOT, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    fail("extension_coupon_source_must_be_outside_repository");
  }
  return resolved;
}

async function loadSource(sourceArgument) {
  const sourcePath = privateSourcePath(sourceArgument);
  let stats;
  try {
    stats = await fs.stat(sourcePath);
  } catch {
    fail("extension_coupon_source_unavailable");
  }
  if (!stats.isFile() || (stats.mode & 0o077) !== 0) fail("extension_coupon_source_permissions_invalid");

  let source;
  try {
    source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  } catch {
    fail("extension_coupon_source_invalid_json");
  }
  if (!exactKeys(source, ["boundary", "rows", "warning"]) ||
      typeof source.boundary !== "string" || !/^[0-9a-f]{32}$/u.test(source.boundary) ||
      typeof source.warning !== "string" || !source.warning.includes(`<${source.boundary}>`)) {
    fail("extension_coupon_source_boundary_invalid");
  }

  let canonicalRows;
  try {
    canonicalRows = canonicalizeExtensionCouponSourceRows(source.rows);
  } catch {
    fail("extension_coupon_source_projection_invalid");
  }
  const digest = extensionCouponMasterDigest(canonicalRows);
  if (canonicalRows.length !== EXTENSION_COUPON_MASTER_ROW_COUNT || digest !== EXTENSION_COUPON_MASTER_SOURCE_DIGEST) {
    fail("extension_coupon_source_digest_mismatch");
  }
  return { sourceRows: source.rows, canonicalRows, digest };
}

function runWrangler(args) {
  const result = spawnSync("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args, "--config", "wrangler.app-staging.jsonc"], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("extension_coupon_staging_wrangler_failed");
  return result.stdout;
}

function parseJson(stdout, code) {
  const output = stdout.trim();
  try {
    return JSON.parse(output);
  } catch {
    const arrayStart = output.lastIndexOf("\n[");
    if (arrayStart < 0) fail(code);
    try {
      return JSON.parse(output.slice(arrayStart + 1));
    } catch {
      fail(code);
    }
  }
}

function readD1(sql) {
  const result = parseJson(runWrangler([
    "d1", "execute", DATABASE, "--remote", "--json", "--command", sql,
  ]), "extension_coupon_staging_read_invalid_json");
  if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true || !Array.isArray(result[0].results) ||
      result[0].meta?.changed_db !== false || Number(result[0].meta?.rows_written) !== 0) {
    fail("extension_coupon_staging_read_not_readonly");
  }
  return result[0].results;
}

function assertStagingTarget() {
  const config = parseJson(JSON.stringify(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))),
    "extension_coupon_staging_config_invalid");
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.vars?.STAGING_NO_INDEX !== "true" ||
      config.vars?.EXTENSION_COUPON_BACKEND !== "d1" ||
      config.vars?.EXTENSION_COUPON_ADMIN_BACKEND !== "d1") {
    fail("extension_coupon_staging_worker_target_mismatch");
  }
  const binding = config.d1_databases?.find((item) => item.binding === "FANMARK_DB");
  if (binding?.database_name !== DATABASE || binding.database_id !== DATABASE_ID || binding.remote !== true) {
    fail("extension_coupon_staging_database_config_mismatch");
  }
  const identity = parseJson(runWrangler(["whoami", "--json"]), "extension_coupon_staging_identity_invalid");
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("extension_coupon_staging_account_mismatch");
  const databases = parseJson(runWrangler(["d1", "list", "--json"]), "extension_coupon_staging_database_list_invalid");
  if (!Array.isArray(databases) || !databases.some((item) => item.name === DATABASE && item.uuid === DATABASE_ID)) {
    fail("extension_coupon_staging_database_not_found");
  }
}

function currentBaseline() {
  const rows = readD1(STAGING_EXTENSION_COUPON_READBACK_SQL);
  const usageRows = readD1(STAGING_EXTENSION_COUPON_USAGE_COUNT_SQL);
  if (usageRows.length !== 1) fail("extension_coupon_staging_usage_count_missing");
  const state = extensionCouponMasterBaselineState(rows, usageRows[0].usage_rows);
  if (state === "invalid") fail("extension_coupon_staging_baseline_invalid");
  return { rows, usageRows: Number(usageRows[0].usage_rows), state };
}

async function applyInsert(sourceRows) {
  const sql = buildExtensionCouponMasterInsertSql(sourceRows);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-coupon-master-stage-"));
  await fs.chmod(temporaryDirectory, 0o700);
  const sqlPath = path.join(temporaryDirectory, "coupon-master.sql");
  try {
    await fs.writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.chmod(sqlPath, 0o600);
    const result = parseJson(runWrangler([
      "d1", "execute", DATABASE, "--remote", "--json", "--file", sqlPath, "--yes",
    ]), "extension_coupon_staging_write_invalid_json");
    if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true ||
        Number(result[0]?.meta?.changes) !== EXTENSION_COUPON_MASTER_ROW_COUNT ||
        Number(result[0]?.meta?.rows_written) !== EXTENSION_COUPON_MASTER_ROW_COUNT) {
      fail("extension_coupon_staging_write_count_mismatch");
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    try {
      await fs.stat(temporaryDirectory);
      fail("extension_coupon_staging_temporary_cleanup_failed");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sourceArgument = args[0];
  const apply = args.length === 2 && args[1] === "--apply";
  if (!sourceArgument || (args.length > 1 && !apply)) {
    fail("usage: node scripts/migration/stage-staging-extension-coupons.mjs <private-source-json> [--apply]");
  }
  const source = await loadSource(sourceArgument);
  assertStagingTarget();
  const before = currentBaseline();
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      status: before.state === "seeded" ? "already_staged_and_verified" : "dry_run_ready",
      database: DATABASE,
      rows: source.canonicalRows.length,
      sourceContentSha256: source.digest,
      existingUsageRows: before.usageRows,
      userDataIncluded: false,
      remoteWrite: false,
    })}\n`);
    return;
  }

  if (before.state === "empty") await applyInsert(source.sourceRows);
  const after = currentBaseline();
  if (after.state !== "seeded") fail("extension_coupon_staging_readback_mismatch");
  process.stdout.write(`${JSON.stringify({
    status: before.state === "seeded" ? "already_staged_and_verified" : "staged_and_verified",
    database: DATABASE,
    rows: after.rows.length,
    sourceContentSha256: source.digest,
    targetContentSha256: extensionCouponMasterDigest(source.canonicalRows),
    sourceUsageRows: 0,
    stagingUsageRows: after.usageRows,
    creatorIds: "omitted",
    userDataIncluded: false,
    remoteWrite: before.state === "empty",
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "extension_coupon_staging_failed"}\n`);
    process.exitCode = 1;
  });
}

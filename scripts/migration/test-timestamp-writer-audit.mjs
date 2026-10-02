#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { auditTimestampWriterCoverage } from "./timestamp-writer-audit.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(root, extensionPattern) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath, extensionPattern);
    return extensionPattern.test(entry.name) ? [filePath] : [];
  });
}

function catalog(columns) {
  return { observed_at: "2026-09-28T14:49:37Z", columns };
}

function timestamp(table_name, column_name) {
  return {
    table_name,
    column_name,
    postgres_type: "timestamp with time zone",
    default_expression: "now()",
  };
}

test("requires every Worker INSERT into a now-default table to name each timestamp column", () => {
  const result = auditTimestampWriterCoverage(catalog([
    timestamp("audit_logs", "created_at"),
    timestamp("notification_events", "created_at"),
    timestamp("notification_events", "updated_at"),
  ]), [
    {
      file: "workers/api/src/audit.ts",
      text: `INSERT INTO audit_logs (id, created_at) VALUES (?, ?);\nINSERT INTO notification_events (id, created_at, updated_at) VALUES (?, ?, ?);`,
    },
  ]);

  assert.equal(result.timestampDefaultCount, 3);
  assert.equal(result.targetTableCount, 2);
  assert.equal(result.insertStatementCount, 2);
  assert.deepEqual(result.uncoveredTimestampDefaults, []);
  assert.deepEqual(result.timestampColumnWriters, [
    { table: "audit_logs", file: "workers/api/src/audit.ts", line: 1, columns: ["created_at"] },
    { table: "notification_events", file: "workers/api/src/audit.ts", line: 2, columns: ["created_at", "updated_at"] },
  ]);
  assert.equal(result.columnListCoverageComplete, true);
});

test("reports omitted and unparsed inserts and defaults with no Worker writer", () => {
  const result = auditTimestampWriterCoverage(catalog([
    timestamp("audit_logs", "created_at"),
    timestamp("notification_events", "created_at"),
    timestamp("notification_events", "updated_at"),
    timestamp("unreferenced_table", "created_at"),
  ]), [
    {
      file: "workers/api/src/audit.ts",
      text: `INSERT INTO audit_logs (id) VALUES (?);\nINSERT INTO public.notification_events SELECT * FROM source_events;`,
    },
  ]);

  assert.equal(result.columnListCoverageComplete, false);
  assert.deepEqual(result.uncoveredTimestampDefaults, [
    {
      table: "audit_logs",
      column: "created_at",
      reason: "insert_omits_timestamp_default_column",
      file: "workers/api/src/audit.ts",
      line: 1,
    },
    {
      table: "notification_events",
      column: "created_at",
      reason: "no_supported_insert_found",
    },
    {
      table: "notification_events",
      column: "updated_at",
      reason: "no_supported_insert_found",
    },
    {
      table: "unreferenced_table",
      column: "created_at",
      reason: "no_supported_insert_found",
    },
  ]);
  assert.deepEqual(result.unparsedTargetInserts, [
    { table: "notification_events", file: "workers/api/src/audit.ts", line: 2 },
  ]);
});

test("includes D1 trigger and seed SQL writes in the same timestamp column inventory", () => {
  const result = auditTimestampWriterCoverage(catalog([
    timestamp("extension_coupon_usages", "used_at"),
    timestamp("notification_templates", "created_at"),
    timestamp("notification_templates", "updated_at"),
  ]), [
    {
      file: "workers/api/migrations-business/0015_coupon.sql",
      text: `INSERT INTO extension_coupon_usages (coupon_id, used_at) VALUES (?, ?);`,
    },
    {
      file: "scripts/migration/staging-notification-master-seed.sql",
      text: `INSERT INTO notification_templates (id, created_at, updated_at) VALUES (?, ?, ?);`,
    },
  ]);

  assert.equal(result.insertStatementCount, 2);
  assert.deepEqual(result.uncoveredTimestampDefaults, []);
  assert.equal(result.columnListCoverageComplete, true);
});

test("resolves generated master INSERT columns and exposes omitted timestamp defaults", () => {
  const result = auditTimestampWriterCoverage(catalog([
    timestamp("emoji_master", "created_at"),
    timestamp("emoji_master", "updated_at"),
    timestamp("extension_coupons", "created_at"),
    timestamp("extension_coupons", "updated_at"),
    timestamp("email_templates", "created_at"),
    timestamp("email_templates", "updated_at"),
  ]), [
    {
      file: "scripts/migration/emoji-master-release-remote-stage.mjs",
      text: `const insertSql = "INSERT INTO emoji_master " +
        "(id, emoji, short_name)" + " VALUES (?, ?, ?)";`,
    },
    {
      file: "scripts/migration/extension-coupon-master.mjs",
      text: `const EXTENSION_COUPON_SOURCE_FIELDS = ["id", "created_at", "updated_at"];
const EXTENSION_COUPON_TARGET_FIELDS = [...EXTENSION_COUPON_SOURCE_FIELDS, "created_by"];
const fields = EXTENSION_COUPON_TARGET_FIELDS;
return \`INSERT INTO extension_coupons (\u0024{fields.map((field) => \`"\u0024{field}"\`).join(", ")}) VALUES\`;`,
    },
    {
      file: "scripts/migration/stage-staging-broadcast-email-templates.mjs",
      text: `const FIELDS = ["id", "created_at", "updated_at"];
const columns = FIELDS.map((field) => \`"\u0024{field}"\`).join(", ");
return \`INSERT INTO "email_templates" (\u0024{columns}) VALUES\`;`,
    },
  ]);

  assert.equal(result.insertStatementCount, 3);
  assert.deepEqual(result.unparsedTargetInserts, []);
  assert.deepEqual(result.uncoveredTimestampDefaults, [
    {
      table: "emoji_master",
      column: "created_at",
      reason: "insert_omits_timestamp_default_column",
      file: "scripts/migration/emoji-master-release-remote-stage.mjs",
      line: 1,
    },
    {
      table: "emoji_master",
      column: "updated_at",
      reason: "insert_omits_timestamp_default_column",
      file: "scripts/migration/emoji-master-release-remote-stage.mjs",
      line: 1,
    },
  ]);
  assert.equal(result.columnListCoverageComplete, false);
});

test("fully inventories the real generated master seed INSERT columns", () => {
  const files = [
    "scripts/migration/emoji-master-seed.mjs",
    "scripts/migration/extension-coupon-master.mjs",
    "scripts/migration/stage-staging-broadcast-email-templates.mjs",
  ];
  const tables = ["emoji_master", "extension_coupons", "email_templates"];
  const columns = tables.flatMap((table) => [
    timestamp(table, "created_at"),
    timestamp(table, "updated_at"),
  ]);
  const result = auditTimestampWriterCoverage(catalog(columns), files.map((file) => ({
    file,
    text: readFileSync(path.join(repoRoot, file), "utf8"),
  })));

  assert.equal(result.insertStatementCount, 3);
  assert.deepEqual(result.unparsedTargetInserts, []);
  assert.deepEqual(result.uncoveredTimestampDefaults, []);
  assert.equal(result.columnListCoverageComplete, true);
});

test("source-shaped versioned reference masters have no direct Worker or migration INSERT writers", () => {
  const tables = [
    "fanmark_tier_extension_prices",
    "fanmark_tiers",
    "languages",
    "reserved_emoji_patterns",
  ];
  const columns = tables.flatMap((table) => [timestamp(table, "created_at"), timestamp(table, "updated_at")]);
  const sourceRoots = [
    path.join(repoRoot, "workers/api/src"),
    path.join(repoRoot, "scripts/migration"),
  ];
  const sqlRoots = [
    path.join(repoRoot, "workers/api/migrations"),
    path.join(repoRoot, "workers/api/migrations-business"),
    path.join(repoRoot, "scripts/migration"),
  ];
  const files = [
    ...sourceRoots.flatMap((root) => sourceFiles(root, /\.(?:mjs|ts)$/u)),
    ...sqlRoots.flatMap((root) => sourceFiles(root, /\.sql$/u)),
  ].filter((filePath) => !path.basename(filePath).startsWith("test-"));
  const sources = [...new Set(files)].map((filePath) => ({
    file: path.relative(repoRoot, filePath),
    text: readFileSync(filePath, "utf8"),
  }));
  const result = auditTimestampWriterCoverage(catalog(columns), sources);

  assert.equal(result.timestampDefaultCount, 8);
  assert.equal(result.insertStatementCount, 0);
  assert.deepEqual(result.unparsedTargetInserts, []);
  assert.ok(result.uncoveredTimestampDefaults.every((entry) => entry.reason === "no_supported_insert_found"));

  const adminSource = readFileSync(
    path.join(repoRoot, "workers/api/src/reference-master-admin-d1-repository.ts"),
    "utf8",
  );
  for (const target of [
    "fanmark_tier_release_rows",
    "fanmark_language_release_rows",
    "fanmark_reserved_emoji_pattern_release_rows",
    "fanmark_extension_price_release_rows",
  ]) {
    assert.ok(adminSource.includes(target), `missing versioned D1 target ${target}`);
  }
  assert.ok(adminSource.includes('"created_at"'));
  assert.ok(adminSource.includes('"updated_at"'));
});

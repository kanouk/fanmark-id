#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";

import { auditTimestampWriterCoverage } from "./timestamp-writer-audit.mjs";

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

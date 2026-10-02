#!/usr/bin/env node

/**
 * One-off, source-shaped synthetic rehearsal against a private schema-readiness
 * result. It reads no source table rows and never writes to a remote service.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { convertSchema } from "./schema-convert.mjs";
import { exportSnapshot } from "./snapshot-export.mjs";
import { importD1Snapshot } from "./d1-import.mjs";
import { validateSequenceStates } from "./snapshot-format.mjs";
import {
  applyLifecycleTargetSchema,
  generateLifecycleTargetSchema,
} from "./lifecycle-target-schema.mjs";
import {
  applyLifecycleGenerationSchema,
  generateLifecycleGenerationSchema,
} from "./lifecycle-generation-schema.mjs";
import {
  applyCredentialTransformSchema,
  generateCredentialTransformSchema,
} from "./credential-transform-schema.mjs";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
} from "./credential-descriptor.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const passwordTable = "fanmark_password_configs";
const syntheticFanmarkId = "90000000-0000-4000-8000-000000000001";
const syntheticLicenseId = "90000000-0000-4000-8000-000000000002";
const syntheticPasswordConfigId = "90000000-0000-4000-8000-000000000003";
const syntheticEmojiId = "90000000-0000-4000-8000-000000000004";
const syntheticDisabledEmojiId = "90000000-0000-4000-8000-00000000000b";
const syntheticInactiveEmojiId = "90000000-0000-4000-8000-00000000000c";
const syntheticDisabledFanmarkId = "90000000-0000-4000-8000-000000000005";
const syntheticDisabledLicenseId = "90000000-0000-4000-8000-000000000006";
const syntheticDisabledPasswordConfigId = "90000000-0000-4000-8000-000000000007";
const syntheticInactiveFanmarkId = "90000000-0000-4000-8000-000000000008";
const syntheticInactiveLicenseId = "90000000-0000-4000-8000-000000000009";
const syntheticInactivePasswordConfigId = "90000000-0000-4000-8000-00000000000a";
const syntheticAuthUserId = "90000000-0000-4000-8000-00000000000d";
const syntheticEventId = "9007199254740993";

function failUsage() {
  throw new Error("usage: node scripts/migration/test-d1-import-current-schema.mjs /private/path/source-catalog.json");
}

function readCatalog(pathname) {
  let parsed;
  try {
    parsed = JSON.parse(pathname);
  } catch (error) {
    throw new Error("private_schema_result_invalid", { cause: error });
  }
  const catalog = parsed?.rows?.[0]?.jsonb_build_object ?? parsed;
  if (!catalog || !Array.isArray(catalog.columns) || !Array.isArray(catalog.constraints)) {
    throw new Error("private_schema_catalog_missing");
  }
  return catalog;
}

function descriptor() {
  return {
    version: 1,
    sourceRelation: passwordTable,
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: passwordTable,
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}

function columnsFor(catalog, table) {
  return catalog.columns
    .filter((column) => column.table_name === table)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((column) => column.column_name);
}

function requireColumns(catalog, table, required) {
  const actual = columnsFor(catalog, table);
  assert.deepEqual(actual, required, table + "_source_shape_changed");
  return actual;
}

function buildRows(catalog) {
  const tableNames = [...new Set(catalog.columns.map((column) => column.table_name))].sort();
  const rows = Object.fromEntries(tableNames.map((table) => [table, []]));
  const fanmarkColumns = requireColumns(catalog, "fanmarks", [
    "id", "user_input_fanmark", "normalized_emoji", "short_id", "status",
    "created_at", "updated_at", "emoji_ids", "normalized_emoji_ids", "tier_level",
  ]);
  const licenseColumns = requireColumns(catalog, "fanmark_licenses", [
    "id", "fanmark_id", "user_id", "license_start", "license_end", "status",
    "is_initial_license", "created_at", "updated_at", "plan_excluded", "excluded_at",
    "excluded_from_plan", "grace_expires_at", "is_returned", "is_transferred",
    "transfer_locked_until", "display_fanmark",
  ]);
  const credentialColumns = requireColumns(catalog, passwordTable, [
    "id", "license_id", "access_password", "is_enabled", "created_at", "updated_at",
  ]);
  const timestamp = "2026-09-26T12:00:00.000000Z";
  const makeFanmark = (id, emoji, shortId, emojiId) => ({
    schemaVersion: 1,
    table: "fanmarks",
    columns: fanmarkColumns,
    values: {
      id,
      user_input_fanmark: emoji,
      normalized_emoji: emoji,
      short_id: shortId,
      status: "active",
      created_at: timestamp,
      updated_at: timestamp,
      emoji_ids: "[]",
      normalized_emoji_ids: JSON.stringify([emojiId]),
      tier_level: "1",
    },
    arrayMetadata: {
      emoji_ids: { isNull: false, ndims: 0, lowerBound: null },
      normalized_emoji_ids: { isNull: false, ndims: 1, lowerBound: 1 },
    },
  });
  const makeLicense = (id, fanmarkId, status = "active") => {
    const active = status === "active";
    return {
      schemaVersion: 1,
      table: "fanmark_licenses",
      columns: licenseColumns,
      values: {
        id,
        fanmark_id: fanmarkId,
        user_id: null,
        license_start: "2026-09-01T12:00:00.000000Z",
        license_end: active ? "2030-09-26T12:00:00.000000Z" : "2026-09-25T12:00:00.000000Z",
        status,
        is_initial_license: "t",
        created_at: timestamp,
        updated_at: timestamp,
        plan_excluded: "f",
        excluded_at: null,
        excluded_from_plan: null,
        grace_expires_at: active ? null : "2026-10-25T12:00:00.000000Z",
        is_returned: "f",
        is_transferred: "f",
        transfer_locked_until: null,
        display_fanmark: null,
      },
      arrayMetadata: {},
    };
  };
  const makeCredential = (id, licenseId, password, enabled) => ({
    schemaVersion: 1,
    table: passwordTable,
    columns: credentialColumns,
    values: {
      id,
      license_id: licenseId,
      access_password: password,
      is_enabled: enabled ? "t" : "f",
      created_at: timestamp,
      updated_at: timestamp,
    },
    arrayMetadata: {},
  });

  rows.fanmarks = [
    makeFanmark(syntheticFanmarkId, "😀", "synthetic-current-schema", syntheticEmojiId),
    makeFanmark(syntheticDisabledFanmarkId, "🧴", "synthetic-disabled-schema", syntheticDisabledEmojiId),
    makeFanmark(syntheticInactiveFanmarkId, "🥀", "synthetic-inactive-schema", syntheticInactiveEmojiId),
  ];
  rows.fanmark_licenses = [
    makeLicense(syntheticLicenseId, syntheticFanmarkId),
    makeLicense(syntheticDisabledLicenseId, syntheticDisabledFanmarkId),
    makeLicense(syntheticInactiveLicenseId, syntheticInactiveFanmarkId, "grace"),
  ];
  rows[passwordTable] = [
    makeCredential(syntheticPasswordConfigId, syntheticLicenseId, "Synthetic-current-catalog-enabled-credential-42", true),
    makeCredential(syntheticDisabledPasswordConfigId, syntheticDisabledLicenseId, "Synthetic-current-catalog-disabled-credential-42", false),
    makeCredential(syntheticInactivePasswordConfigId, syntheticInactiveLicenseId, "Synthetic-current-catalog-inactive-credential-42", true),
  ];
  const eventColumns = requireColumns(catalog, "fanmark_events", [
    "id", "event_type", "user_id", "discovery_id", "normalized_emoji_ids", "created_at",
  ]);
  rows.fanmark_events = [{
    schemaVersion: 1,
    table: "fanmark_events",
    columns: eventColumns,
    values: {
      id: syntheticEventId,
      event_type: "synthetic_migration_probe",
      user_id: null,
      discovery_id: null,
      normalized_emoji_ids: JSON.stringify([syntheticEmojiId]),
      created_at: "2026-09-26T12:00:00.000000Z",
    },
    arrayMetadata: {
      normalized_emoji_ids: { isNull: false, ndims: 1, lowerBound: 1 },
    },
  }];
  const preferenceColumns = requireColumns(catalog, "notification_preferences", [
    "id", "user_id", "channel", "event_type", "enabled", "created_at", "updated_at",
  ]);
  rows.notification_preferences = [{
    schemaVersion: 1,
    table: "notification_preferences",
    columns: preferenceColumns,
    values: {
      id: "90000000-0000-4000-8000-00000000000e",
      user_id: syntheticAuthUserId,
      channel: "in_app",
      event_type: null,
      enabled: "t",
      created_at: timestamp,
      updated_at: timestamp,
    },
    arrayMetadata: {},
  }];
  const roleColumns = requireColumns(catalog, "user_roles", [
    "id", "user_id", "role", "created_at", "created_by",
  ]);
  rows.user_roles = [{
    schemaVersion: 1,
    table: "user_roles",
    columns: roleColumns,
    values: {
      id: "90000000-0000-4000-8000-00000000000f",
      user_id: syntheticAuthUserId,
      role: "user",
      created_at: timestamp,
      created_by: null,
    },
    arrayMetadata: {},
  }];
  return { tableNames, rows };
}

function sequenceStatesForCurrentCatalog(catalog) {
  const eventId = catalog.columns.find((column) =>
    column.table_name === "fanmark_events" && column.column_name === "id");
  if (!eventId?.default_expression?.includes("fanmark_events_id_seq")) return [];
  return validateSequenceStates(catalog, [{
    schema: "public",
    name: "fanmark_events_id_seq",
    ownerSchema: "public",
    ownerTable: "fanmark_events",
    ownerColumn: "id",
    startValue: "1",
    incrementBy: "1",
    minValue: "1",
    maxValue: "9223372036854775807",
    cacheSize: "1",
    cycle: false,
    lastValue: "1",
    isCalled: false,
  }]);
}

function splitSqlStatements(sql) {
  const source = String(sql).replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote === "'") {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function createLocalD1() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-current-catalog-d1-import-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-current-catalog-d1-import-test" } },
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" },
          },
        },
      },
    }],
  });
  return { miniflare, database: await miniflare.getD1Database("DB") };
}

async function applySql(database, sql) {
  const results = await database.batch(splitSqlStatements(sql).map((statement) => database.prepare(statement)));
  assert.equal(results.every((result) => result.success === true), true);
}

function sqlOperationHint(sql) {
  const normalized = String(sql).replace(/\s+/gu, " ").trim();
  const operation = normalized.match(/^(CREATE|DROP|INSERT|UPDATE|DELETE|SELECT|PRAGMA|ALTER)\b/iu)?.[1]?.toUpperCase() ?? "OTHER";
  if (operation === "PRAGMA") {
    const pragma = normalized.match(/^PRAGMA\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\))?/iu);
    return `PRAGMA:${pragma?.[1]?.toLowerCase() ?? "unknown"}:${pragma?.[2] ?? ""}`;
  }
  const table = normalized.match(/\b(?:INTO|FROM|UPDATE|TABLE)\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/iu);
  return `${operation}:${table?.[1] ?? table?.[2] ?? "unknown"}`;
}

function tracedDatabase(database, trace) {
  const tags = new WeakMap();
  const wrapPrepared = (statement, hint) => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...bindings) => wrapPrepared(Reflect.apply(target.bind, target, bindings), hint);
        }
        if (["all", "first", "raw", "run"].includes(property)) {
          return async (...args) => {
            try {
              return await Reflect.apply(target[property], target, args);
            } catch (error) {
              trace.push({ operation: hint, method: property, error: error?.code ?? error?.name ?? "d1_error" });
              throw error;
            }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    tags.set(wrapped, hint);
    return wrapped;
  };
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => wrapPrepared(target.prepare(sql), sqlOperationHint(sql));
      }
      if (property === "batch") {
        return async (statements) => {
          const operations = statements.map((statement) => tags.get(statement) ?? "unlabeled");
          try {
            const result = await target.batch(statements);
            if (result.some((item) => item?.success !== true)) {
              trace.push({ operation: "BATCH", statements: operations, error: "batch_statement_failed" });
            }
            return result;
          } catch (error) {
            trace.push({ operation: "BATCH", statements: operations, error: error?.code ?? error?.name ?? "d1_error" });
            throw error;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function createSyntheticSnapshot(catalog, rows, sequenceStates, directory) {
  const session = {
    async begin() { return { currentUser: "postgres", isolation: "repeatable read", readOnly: true }; },
    async readCatalog() { return catalog; },
    async readSequenceStates() { return sequenceStates; },
    async *streamTable({ table }) { for (const row of rows[table] ?? []) yield row; },
    async countTable(table) { return String((rows[table] ?? []).length); },
    async commit() {},
    async rollback() {},
    async close() {},
  };
  const result = await exportSnapshot({
    catalog,
    credentialDescriptor: descriptor(),
    outputDir: directory,
    session,
  });
  return result.manifestPath;
}

export async function runCurrentCatalogSyntheticImport(catalogResultPath) {
  if (typeof catalogResultPath !== "string" || catalogResultPath.length === 0) failUsage();
  const parsed = await fs.readFile(path.resolve(catalogResultPath), "utf8");
  const catalog = readCatalog(parsed);
  const { tableNames, rows } = buildRows(catalog);
  assert.equal(tableNames.length, 40, "current_public_table_count");
  const sequenceStates = sequenceStatesForCurrentCatalog(catalog);
  const convertedSchema = convertSchema(catalog, { credentialDescriptor: descriptor() });
  const lifecyclePlan = generateLifecycleTargetSchema({
    catalog,
    convertedSchema,
    credentialDescriptor: descriptor(),
  });
  const generationPlan = generateLifecycleGenerationSchema({
    catalog,
    convertedSchema,
    lifecyclePlan,
    credentialDescriptor: descriptor(),
  });
  const credentialPlan = generateCredentialTransformSchema({
    catalog,
    convertedSchema,
    lifecyclePlan,
    generationPlan,
    descriptor: descriptor(),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-current-catalog-import-"));
  await fs.chmod(root, 0o700);
  const snapshotDirectory = path.join(root, "snapshot");
  const reportDirectory = path.join(root, "report");
  await fs.mkdir(reportDirectory, { mode: 0o700 });
  await fs.chmod(reportDirectory, 0o700);
  const reportPath = path.join(reportDirectory, "d1-import.report.json");
  let miniflare = null;
  const trace = [];
  let phase = "snapshot";
  let authIdentityLookups = 0;
  try {
    const manifestPath = await createSyntheticSnapshot(catalog, rows, sequenceStates, snapshotDirectory);
    phase = "create-d1";
    const local = await createLocalD1();
    miniflare = local.miniflare;
    const database = tracedDatabase(local.database, trace);
    phase = "apply-converted-schema";
    await applySql(database, convertedSchema.sql);
    phase = "apply-lifecycle-schema";
    await applyLifecycleTargetSchema({
      database, plan: lifecyclePlan, catalog, convertedSchema, credentialDescriptor: descriptor(),
    });
    phase = "apply-generation-schema";
    await applyLifecycleGenerationSchema({
      database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan, credentialDescriptor: descriptor(),
    });
    phase = "apply-credential-schema";
    await applyCredentialTransformSchema({
      database, plan: credentialPlan, catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor: descriptor(),
    });
    const expectedTargetProfile = { credentialPlan, descriptor: descriptor(), generationPlan, lifecyclePlan };
    const options = {
      manifestPath,
      database,
      destinationId: "synthetic-current-source-schema",
      targetIncarnation: "synthetic-current-source-schema-1",
      reportPath,
      allowUnresolvedGates: true,
      expectedTargetProfile,
      now: () => new Date("2026-09-26T12:00:00.000Z"),
      scanBatchRows: 1,
      maxRowsPerBatch: 1,
      resolveAuthUserIds: async (requestedIds) => {
        authIdentityLookups += 1;
        assert.deepEqual(requestedIds, [syntheticAuthUserId]);
        return new Set([syntheticAuthUserId]);
      },
    };
    let ackUnknown = true;
    phase = "initial-import";
    await assert.rejects(
      importD1Snapshot({
        ...options,
        hooks: {
          afterCredentialBatchCommit() {
            if (ackUnknown) {
              ackUnknown = false;
              throw new Error("synthetic acknowledgement loss");
            }
          },
        },
      }),
      (error) => error.code === "credential_batch_ack_unknown",
    );
    phase = "resume-import";
    const resumed = await importD1Snapshot(options);
    assert.equal(resumed.status, "public_rows_reconciled");
    assert.equal(resumed.publicRowsReconciled, true);
    assert.equal(resumed.fullMigrationReconciled, false);
    assert.equal(resumed.deployable, false);
    assert.equal(resumed.objectCount, 40);

    const checkpoints = await database.prepare(
      'SELECT COUNT(*) AS "count", SUM(CASE WHEN "status" = \'complete\' THEN 1 ELSE 0 END) AS "complete" FROM "__fanmark_d1_import_checkpoints"',
    ).first();
    assert.deepEqual(checkpoints, { count: 40, complete: 40 });
    const password = await database.prepare(
      'SELECT "id", "license_id", "access_password", "is_enabled" FROM "fanmark_password_configs" WHERE "id" = ?',
    ).bind(syntheticPasswordConfigId).first();
    assert.equal(password.id, syntheticPasswordConfigId);
    assert.equal(password.license_id, syntheticLicenseId);
    assert.match(password.access_password, /^\$2[ab]\$10\$/u);
    assert.notEqual(password.access_password, "Synthetic-current-catalog-credential-42");
    assert.equal(password.is_enabled, 1);
    const disabledPassword = await database.prepare(
      'SELECT "id", "license_id", "access_password", "is_enabled" FROM "fanmark_password_configs" WHERE "id" = ?',
    ).bind(syntheticDisabledPasswordConfigId).first();
    assert.equal(disabledPassword.id, syntheticDisabledPasswordConfigId);
    assert.equal(disabledPassword.license_id, syntheticDisabledLicenseId);
    assert.match(disabledPassword.access_password, /^\$2[ab]\$10\$/u);
    assert.notEqual(disabledPassword.access_password, "Synthetic-current-catalog-disabled-credential-42");
    assert.equal(disabledPassword.is_enabled, 0);
    const inactivePassword = await database.prepare(
      'SELECT COUNT(*) AS "count" FROM "fanmark_password_configs" WHERE "id" = ? OR "license_id" = ?',
    ).bind(syntheticInactivePasswordConfigId, syntheticInactiveLicenseId).first();
    assert.equal(inactivePassword.count, 0);
    const credentialCoverage = await database.prepare(
      'SELECT "coverage_state", COUNT(*) AS "count" FROM "credential_transform_coverage" GROUP BY "coverage_state" ORDER BY "coverage_state"',
    ).all();
    assert.deepEqual(credentialCoverage.results, [
      { coverage_state: "deferred_inactive", count: 1 },
      { coverage_state: "disabled", count: 1 },
      { coverage_state: "transformed", count: 1 },
    ]);
    const generation = await database.prepare(
      'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
    ).bind(syntheticLicenseId).first();
    assert.deepEqual(generation, { password_generation: 1, access_generation: 1 });
    const disabledGeneration = await database.prepare(
      'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
    ).bind(syntheticDisabledLicenseId).first();
    assert.deepEqual(disabledGeneration, { password_generation: 1, access_generation: 1 });
    const inactiveGeneration = await database.prepare(
      'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
    ).bind(syntheticInactiveLicenseId).first();
    assert.deepEqual(inactiveGeneration, { password_generation: 0, access_generation: 0 });
    const event = await database.prepare(
      'SELECT CAST("id" AS TEXT) AS "id", typeof("id") AS "id_type", "event_type", "normalized_emoji_ids" FROM "fanmark_events" WHERE "id" = CAST(? AS INTEGER)',
    ).bind(syntheticEventId).first();
    assert.deepEqual(event, {
      id: syntheticEventId,
      id_type: "integer",
      event_type: "synthetic_migration_probe",
      normalized_emoji_ids: JSON.stringify([syntheticEmojiId]),
    });
    const sequence = await database.prepare(
      'SELECT CAST("seq" AS TEXT) AS "seq" FROM "sqlite_sequence" WHERE "name" = ?',
    ).bind("fanmark_events").first();
    assert.deepEqual(sequence, { seq: syntheticEventId });
    const rowCounts = await Promise.all([
      database.prepare('SELECT COUNT(*) AS "count" FROM "fanmarks"').first(),
      database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_licenses"').first(),
      database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_password_configs"').first(),
      database.prepare('SELECT COUNT(*) AS "count" FROM "fanmark_events"').first(),
    ]);
    assert.deepEqual(rowCounts.map((row) => row.count), [3, 3, 2, 1]);
    const resumedReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const reconciliation = resumedReport.reconciledTables.find((table) => table.table === passwordTable);
    assert.equal(reconciliation.rowCount, 3);
    assert.equal(reconciliation.targetRowCount, 2);
    assert.equal(reconciliation.deferredRows, 1);
    assert.deepEqual(await database.prepare("PRAGMA foreign_key_check").all().then((result) => result.results), []);
    const importedPreference = await database.prepare(
      'SELECT "user_id", "channel", "event_type", "enabled", "created_at", "updated_at" FROM "notification_preferences" WHERE "id" = ?',
    ).bind("90000000-0000-4000-8000-00000000000e").first();
    assert.deepEqual(importedPreference, {
      user_id: syntheticAuthUserId,
      channel: "in_app",
      event_type: null,
      enabled: 1,
      created_at: "2026-09-26T12:00:00.000000Z",
      updated_at: "2026-09-26T12:00:00.000000Z",
    });
    const importedRole = await database.prepare(
      'SELECT "user_id", "role", "created_at", "created_by" FROM "user_roles" WHERE "id" = ?',
    ).bind("90000000-0000-4000-8000-00000000000f").first();
    assert.deepEqual(importedRole, {
      user_id: syntheticAuthUserId,
      role: "user",
      created_at: "2026-09-26T12:00:00.000000Z",
      created_by: null,
    });
    assert.ok(authIdentityLookups >= 1, "external synthetic Auth references must be preflighted");
    // Miniflare's D1 authorizer rejects PRAGMA integrity_check with SQLITE_AUTH.
    // The importer has already streamed and read back every table/hash above.

    phase = "conflict-rejection";
    const completedReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
    await database.prepare(
      'UPDATE "credential_transform_coverage" SET "destination_digest" = ? WHERE "run_id" = ? AND "coverage_state" = \'transformed\'',
    ).bind("0".repeat(64), completedReport.runId).run();
    await assert.rejects(
      importD1Snapshot(options),
      (error) => error.code === "credential_coverage_readback_mismatch",
    );
    return {
      tableCount: tableNames.length,
      sourceRowCount: 12,
      transformedCredentialCount: 2,
      deferredCredentialCount: 1,
      syntheticAuthIdentityLookupCount: authIdentityLookups,
      importOnlyTimestampReadback: true,
      checkpointCount: checkpoints.count,
      completedCheckpointCount: checkpoints.complete,
      status: resumed.status,
      deployable: resumed.deployable,
      fullMigrationReconciled: resumed.fullMigrationReconciled,
      conflictRejected: true,
    };
  } catch (error) {
    error.phase = phase;
    error.trace = trace.slice(-12);
    throw error;
  } finally {
    if (miniflare) await miniflare.dispose();
    await fs.rm(root, { recursive: true, force: true });
    await assert.rejects(fs.stat(root), (error) => error.code === "ENOENT");
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runCurrentCatalogSyntheticImport(process.argv[2])
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({
        phase: error?.phase ?? "current_catalog_import_failed",
        code: error?.code ?? error?.message ?? "unknown_error",
        trace: Array.isArray(error?.trace) ? error.trace : [],
      }));
      process.exitCode = 1;
    });
}

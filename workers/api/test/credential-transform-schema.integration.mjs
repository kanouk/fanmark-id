#!/usr/bin/env node

/**
 * Synthetic local D1 proof for the credential-transform target extension.
 * It applies the source-shaped schema and both lifecycle extensions first.
 * No source rows, credentials, remote database, or deployment are used.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertSchema } from "../../../scripts/migration/schema-convert.mjs";
import {
  applyLifecycleTargetSchema,
  generateLifecycleTargetSchema,
} from "../../../scripts/migration/lifecycle-target-schema.mjs";
import {
  applyLifecycleGenerationSchema,
  generateLifecycleGenerationSchema,
} from "../../../scripts/migration/lifecycle-generation-schema.mjs";
import {
  applyCredentialTransformSchema,
  generateCredentialTransformSchema,
  inspectCredentialTransformSchema,
} from "../../../scripts/migration/credential-transform-schema.mjs";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
} from "../../../scripts/migration/credential-descriptor.mjs";
import {
  CREDENTIAL_SOURCE_COLUMNS,
} from "../../../scripts/migration/credential-descriptor.mjs";
import {
  canonicalJson,
  getPrimaryKeyInfo,
  rowRecordForEnvelope,
} from "../../../scripts/migration/snapshot-format.mjs";
import {
  compileCredentialImportProjection,
} from "../../../scripts/migration/credential-import-projection.mjs";
import {
  buildCredentialTargetInsert,
} from "../../../scripts/migration/credential-import-row.mjs";
import {
  prepareCredentialImportArtifact,
  reserveCredentialImportArtifact,
} from "../../../scripts/migration/credential-import-transform.mjs";
import { exportSnapshot } from "../../../scripts/migration/snapshot-export.mjs";
import { importD1Snapshot } from "../../../scripts/migration/d1-import.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const PASSWORD_TABLE = "fanmark_password_configs";

function column(table_name, column_name, ordinal, postgres_type, options = {}) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: options.type_schema ?? "pg_catalog",
    type_name: options.type_name ?? postgres_type,
    type_kind: options.type_kind ?? "b",
    not_null: options.not_null ?? false,
    default_expression: options.default_expression ?? null,
    identity: "",
    generated: "",
    collation: null,
  };
}

function primary(table_name) {
  return {
    table_name,
    name: table_name + "_pkey",
    kind: "p",
    definition: "PRIMARY KEY (id)",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function unique(table_name, name, columns) {
  return {
    table_name,
    name,
    kind: "u",
    definition: "UNIQUE (" + columns + ")",
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function foreign(table_name, name, definition) {
  return {
    table_name,
    name,
    kind: "f",
    definition,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function fixtureCatalog() {
  return {
    observed_at: "2026-09-23T00:00:00Z",
    columns: [
      column("fanmarks", "id", 1, "uuid", { not_null: true }),
      column("fanmarks", "short_id", 2, "text", { not_null: true }),
      column("fanmarks", "normalized_emoji", 3, "text", { not_null: true }),
      column("fanmarks", "status", 4, "text", { not_null: true }),
      column("fanmarks", "user_input_fanmark", 5, "text"),
      column("fanmarks", "emoji_ids", 6, "uuid[]"),
      column("fanmarks", "normalized_emoji_ids", 7, "uuid[]"),
      column("fanmark_licenses", "id", 1, "uuid", { not_null: true }),
      column("fanmark_licenses", "fanmark_id", 2, "uuid", { not_null: true }),
      column("fanmark_licenses", "user_id", 3, "uuid"),
      column("fanmark_licenses", "status", 4, "text", { not_null: true }),
      column("fanmark_licenses", "license_end", 5, "timestamp with time zone"),
      column("fanmark_licenses", "grace_expires_at", 6, "timestamp with time zone"),
      column("fanmark_licenses", "is_returned", 7, "boolean", { not_null: true, default_expression: "false" }),
      column("audit_logs", "id", 1, "uuid", { not_null: true }),
      column("audit_logs", "user_id", 2, "uuid"),
      column("audit_logs", "action", 3, "text", { not_null: true }),
      column("audit_logs", "resource_type", 4, "text", { not_null: true }),
      column("audit_logs", "resource_id", 5, "text"),
      column("audit_logs", "request_id", 6, "text"),
      column("audit_logs", "metadata", 7, "jsonb"),
      column("audit_logs", "created_at", 8, "timestamp with time zone", { not_null: true }),
      column("notification_events", "id", 1, "uuid", { not_null: true }),
      column("notification_events", "event_type", 2, "text", { not_null: true }),
      column("notification_events", "event_version", 3, "integer", { not_null: true }),
      column("notification_events", "source", 4, "text", { not_null: true }),
      column("notification_events", "payload", 5, "jsonb", { not_null: true }),
      column("notification_events", "payload_schema", 6, "text"),
      column("notification_events", "trigger_at", 7, "timestamp with time zone", { not_null: true }),
      column("notification_events", "dedupe_key", 8, "text"),
      column("notification_events", "status", 9, "text", { not_null: true }),
      column("notification_events", "retry_count", 10, "integer", { not_null: true }),
      column("notification_events", "created_at", 11, "timestamp with time zone", { not_null: true }),
      column("notification_events", "updated_at", 12, "timestamp with time zone", { not_null: true }),
      column("fanmark_lottery_entries", "id", 1, "uuid", { not_null: true }),
      column("fanmark_lottery_entries", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_lottery_entries", "entry_status", 3, "text", { not_null: true }),
      column(PASSWORD_TABLE, "id", 1, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "license_id", 2, "uuid", { not_null: true }),
      column(PASSWORD_TABLE, "access_password", 3, "text", { not_null: true }),
      column(PASSWORD_TABLE, "is_enabled", 4, "boolean", { not_null: true, default_expression: "true" }),
      column(PASSWORD_TABLE, "created_at", 5, "timestamp with time zone", { not_null: true }),
      column(PASSWORD_TABLE, "updated_at", 6, "timestamp with time zone", { not_null: true }),
      column("fanmark_basic_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_basic_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_basic_configs", "fanmark_name", 3, "text"),
      column("fanmark_basic_configs", "access_type", 4, "text"),
      column("fanmark_redirect_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_redirect_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_redirect_configs", "target_url", 3, "text"),
      column("fanmark_messageboard_configs", "id", 1, "uuid", { not_null: true }),
      column("fanmark_messageboard_configs", "license_id", 2, "uuid", { not_null: true }),
      column("fanmark_messageboard_configs", "content", 3, "text"),
      column("fanmark_profiles", "id", 1, "uuid", { not_null: true }),
      column("fanmark_profiles", "license_id", 2, "uuid"),
      column("fanmark_profiles", "display_name", 3, "text"),
      column("fanmark_profiles", "bio", 4, "text"),
      column("fanmark_profiles", "social_links", 5, "jsonb"),
      column("fanmark_profiles", "theme_settings", 6, "jsonb"),
      column("fanmark_profiles", "is_public", 7, "boolean"),
    ],
    constraints: [
      primary("fanmarks"),
      primary("fanmark_licenses"),
      primary("audit_logs"),
      primary("notification_events"),
      primary("fanmark_lottery_entries"),
      primary(PASSWORD_TABLE),
      primary("fanmark_basic_configs"),
      primary("fanmark_redirect_configs"),
      primary("fanmark_messageboard_configs"),
      primary("fanmark_profiles"),
      unique("fanmarks", "fanmarks_short_id_key", "short_id"),
      unique(PASSWORD_TABLE, "fanmark_password_configs_license_id_key", "license_id"),
      foreign("fanmark_licenses", "fanmark_licenses_fanmark_id_fkey", "FOREIGN KEY (fanmark_id) REFERENCES public.fanmarks (id) ON DELETE RESTRICT ON UPDATE RESTRICT"),
      foreign(PASSWORD_TABLE, "fanmark_password_configs_license_id_fkey", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses (id) ON DELETE CASCADE"),
      unique("notification_events", "notification_events_dedupe_key", "event_type, dedupe_key"),
    ],
    indexes: [],
    enums: [],
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
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

function descriptor() {
  return {
    version: 1,
    sourceRelation: PASSWORD_TABLE,
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: PASSWORD_TABLE,
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}

async function createLocalD1() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-credential-transform-schema-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-credential-transform-schema-test" } },
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": {
              type: "esm",
              contents: "export default { fetch() { return new Response('ok'); } };",
            },
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

async function prepareFixture({ credentialExtension = false } = {}) {
  const catalog = fixtureCatalog();
  const credentialDescriptor = descriptor();
  const convertedSchema = convertSchema(catalog, { credentialDescriptor });
  const lifecyclePlan = generateLifecycleTargetSchema({ catalog, convertedSchema, credentialDescriptor });
  const generationPlan = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan, credentialDescriptor });
  const credentialPlan = generateCredentialTransformSchema({
    catalog,
    convertedSchema,
    lifecyclePlan,
    generationPlan,
    descriptor: credentialDescriptor,
  });
  const local = await createLocalD1();
  try {
    await applySql(local.database, convertedSchema.sql);
    await applyLifecycleTargetSchema({ database: local.database, plan: lifecyclePlan, catalog, convertedSchema, credentialDescriptor });
    await applyLifecycleGenerationSchema({ database: local.database, plan: generationPlan, catalog, convertedSchema, lifecyclePlan, credentialDescriptor });
    if (credentialExtension) {
      await applyCredentialTransformSchema({
        database: local.database,
        plan: credentialPlan,
        catalog,
        convertedSchema,
        lifecyclePlan,
        generationPlan,
        descriptor: descriptor(),
      });
    }
    return { ...local, catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan };
  } catch (error) {
    await local.miniflare.dispose();
    throw error;
  }
}

const syntheticLicenseId = "00000000-0000-4000-8000-000000000101";
const syntheticFanmarkId = "00000000-0000-4000-8000-000000000102";
const syntheticPasswordConfigId = "00000000-0000-4000-8000-000000000103";

async function seedActiveLicense(database) {
  await database.prepare(
    'INSERT INTO "fanmarks" ("id", "short_id", "normalized_emoji", "status", "user_input_fanmark", "emoji_ids", "normalized_emoji_ids") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    syntheticFanmarkId,
    "synthetic-credential-target",
    "😀",
    "active",
    null,
    "[]",
    "[]",
  ).run();
  await database.prepare(
    'INSERT INTO "fanmark_licenses" ("id", "fanmark_id", "user_id", "status", "license_end", "grace_expires_at", "is_returned") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    syntheticLicenseId,
    syntheticFanmarkId,
    null,
    "active",
    "2030-01-01T00:00:00.000000Z",
    null,
    0,
  ).run();
}

function syntheticCredentialProjection(catalog, { enabled = true, password = "Synthetic-credential-42" } = {}) {
  const sourceEnvelope = {
    schemaVersion: 1,
    table: PASSWORD_TABLE,
    columns: [...CREDENTIAL_SOURCE_COLUMNS],
    values: {
      id: syntheticPasswordConfigId,
      license_id: syntheticLicenseId,
      access_password: password,
      is_enabled: enabled ? "t" : "f",
      created_at: "2026-09-26T12:00:00.123456Z",
      updated_at: "2026-09-26T12:00:00.654321Z",
    },
    arrayMetadata: {},
  };
  const sourceRecord = rowRecordForEnvelope(
    sourceEnvelope,
    getPrimaryKeyInfo(catalog, PASSWORD_TABLE),
    0,
  );
  const project = compileCredentialImportProjection({ catalog, descriptor: descriptor() });
  return project(canonicalJson(sourceRecord));
}

async function exportSyntheticCredentialSnapshot(catalog, credentialDescriptor) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-credential-import-snapshot-"));
  const rows = Object.fromEntries([...new Set(catalog.columns.map((entry) => entry.table_name))].map((table) => [table, []]));
  rows.fanmarks = [{
    schemaVersion: 1,
    table: "fanmarks",
    columns: ["id", "short_id", "normalized_emoji", "status", "user_input_fanmark", "emoji_ids", "normalized_emoji_ids"],
    values: {
      id: syntheticFanmarkId,
      short_id: "synthetic-credential-target",
      normalized_emoji: "😀",
      status: "active",
      user_input_fanmark: null,
      emoji_ids: "[]",
      normalized_emoji_ids: JSON.stringify(["00000000-0000-4000-8000-000000000104"]),
    },
    arrayMetadata: {
      emoji_ids: { isNull: false, ndims: 0, lowerBound: null },
      normalized_emoji_ids: { isNull: false, ndims: 1, lowerBound: 1 },
    },
  }];
  rows.fanmark_licenses = [{
    schemaVersion: 1,
    table: "fanmark_licenses",
    columns: ["id", "fanmark_id", "user_id", "status", "license_end", "grace_expires_at", "is_returned"],
    values: {
      id: syntheticLicenseId,
      fanmark_id: syntheticFanmarkId,
      user_id: null,
      status: "active",
      license_end: "2030-01-01T00:00:00.000000Z",
      grace_expires_at: null,
      is_returned: "f",
    },
    arrayMetadata: {},
  }];
  rows[PASSWORD_TABLE] = [{
    schemaVersion: 1,
    table: PASSWORD_TABLE,
    columns: [...CREDENTIAL_SOURCE_COLUMNS],
    values: {
      id: syntheticPasswordConfigId,
      license_id: syntheticLicenseId,
      access_password: "Synthetic-credential-import-42",
      is_enabled: "t",
      created_at: "2026-09-26T12:00:00.123456Z",
      updated_at: "2026-09-26T12:00:00.654321Z",
    },
    arrayMetadata: {},
  }];
  const session = {
    async begin() { return { currentUser: "postgres", isolation: "repeatable read", readOnly: true }; },
    async readCatalog() { return catalog; },
    async readSequenceStates() { return []; },
    async *streamTable({ table }) { for (const row of rows[table] ?? []) yield row; },
    async countTable(table) { return String((rows[table] ?? []).length); },
    async commit() {},
    async rollback() {},
    async close() {},
  };
  const result = await exportSnapshot({ catalog, credentialDescriptor, outputDir: directory, session });
  return { directory, manifestPath: result.manifestPath };
}

test("D1 importer atomically writes credential row, coverage, artifact and checkpoint, then resumes after ACK-unknown", async () => {
  const fixture = await prepareFixture({ credentialExtension: true });
  const reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-credential-import-report-"));
  await fs.chmod(reportDirectory, 0o700);
  const reportPath = path.join(reportDirectory, "import.report.json");
  let snapshot;
  try {
    snapshot = await exportSyntheticCredentialSnapshot(fixture.catalog, descriptor());
    const importOptions = {
      manifestPath: snapshot.manifestPath,
      database: fixture.database,
      destinationId: "synthetic-integrated-target",
      targetIncarnation: "synthetic-integrated-incarnation-1",
      reportPath,
      allowUnresolvedGates: true,
      expectedTargetProfile: {
        credentialPlan: fixture.credentialPlan,
        descriptor: descriptor(),
        generationPlan: fixture.generationPlan,
        lifecyclePlan: fixture.lifecyclePlan,
      },
      now: () => new Date("2026-09-26T12:00:00.000Z"),
    };
    let loseAcknowledgement = true;
    await assert.rejects(
      importD1Snapshot({
        ...importOptions,
        hooks: {
          afterCredentialBatchCommit() {
            if (loseAcknowledgement) {
              loseAcknowledgement = false;
              throw new Error("synthetic acknowledgement loss");
            }
          },
        },
      }),
      (error) => error.code === "credential_batch_ack_unknown",
    );
    const afterUnknownAck = await fixture.database.prepare(
      'SELECT "next_ordinal", "rows_imported", "status" FROM "__fanmark_d1_import_checkpoints" WHERE "table_name" = ?',
    ).bind(PASSWORD_TABLE).first();
    assert.deepEqual(afterUnknownAck, { next_ordinal: 1, rows_imported: 1, status: "in_progress" });
    const resumed = await importD1Snapshot(importOptions);
    assert.equal(resumed.status, "public_rows_reconciled");
    assert.equal(resumed.publicRowsReconciled, true);
    assert.equal(resumed.fullMigrationReconciled, false);
    assert.equal(resumed.deployable, false);

    const target = await fixture.database.prepare(
      'SELECT "id", "license_id", "access_password", "is_enabled", "created_at", "updated_at" FROM "fanmark_password_configs"',
    ).first();
    assert.equal(target.id, syntheticPasswordConfigId);
    assert.equal(target.license_id, syntheticLicenseId);
    assert.match(target.access_password, /^\$2[ab]\$10\$/u);
    assert.notEqual(target.access_password, "Synthetic-credential-import-42");
    assert.equal(target.is_enabled, 1);
    const artifact = await fixture.database.prepare(
      'SELECT "state", "destination_transform_digest" FROM "credential_transform_artifacts"',
    ).first();
    assert.equal(artifact.state, "reconciled");
    assert.match(artifact.destination_transform_digest, /^[0-9a-f]{64}$/u);
    const coverage = await fixture.database.prepare(
      'SELECT "coverage_state", "expected_password_generation", "expected_access_generation", "expected_lifecycle_generation", "destination_digest" FROM "credential_transform_coverage"',
    ).first();
    assert.deepEqual(coverage, {
      coverage_state: "transformed",
      expected_password_generation: 1,
      expected_access_generation: 1,
      expected_lifecycle_generation: 0,
      destination_digest: coverage.destination_digest,
    });
    assert.match(coverage.destination_digest, /^[0-9a-f]{64}$/u);
    const generations = await fixture.database.prepare(
      'SELECT "password_generation", "access_generation" FROM "fanmark_access_versions" WHERE "license_id" = ?',
    ).bind(syntheticLicenseId).first();
    assert.deepEqual(generations, { password_generation: 1, access_generation: 1 });
  } finally {
    await fixture.miniflare.dispose();
    if (snapshot) await fs.rm(snapshot.directory, { recursive: true, force: true });
    await fs.rm(reportDirectory, { recursive: true, force: true });
  }
});

test("source-shaped credential artifact binds license generations and reuses prepared bcrypt after ACK-unknown and restart", async () => {
  const fixture = await prepareFixture({ credentialExtension: true });
  try {
    await seedActiveLicense(fixture.database);
    const initialState = await fixture.database.prepare(
      'SELECT i."incarnation", v."license_incarnation", v."password_generation", v."access_generation", l."lifecycle_generation" FROM "fanmark_licenses" AS l JOIN "fanmark_license_incarnations" AS i ON i."license_id" = l."id" JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id" WHERE l."id" = ?',
    ).bind(syntheticLicenseId).first();
    assert.deepEqual(initialState, {
      incarnation: 0,
      license_incarnation: 0,
      password_generation: 0,
      access_generation: 0,
      lifecycle_generation: 0,
    });

    const sourcePassword = "Synthetic-credential-42";
    const context = {
      database: fixture.database,
      catalog: fixture.catalog,
      destinationId: "synthetic-target",
      targetIncarnation: "synthetic-target-incarnation-1",
      sourceManifestDigest: "a".repeat(64),
      targetProfileFingerprint: fixture.credentialPlan.targetProfileFingerprint,
      now: () => new Date(1_790_416_800_000),
      leaseMs: 1_000,
    };
    const reservation = await reserveCredentialImportArtifact({
      ...context,
      projection: syntheticCredentialProjection(fixture.catalog, { password: sourcePassword }),
    });
    let hashCalls = 0;
    let loseAcknowledgement = true;
    const uncertainDatabase = {
      prepare: (...args) => fixture.database.prepare(...args),
      async batch(statements) {
        const results = await fixture.database.batch(statements);
        if (loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new Error("synthetic acknowledgement loss");
        }
        return results;
      },
    };
    await assert.rejects(
      prepareCredentialImportArtifact({
        database: uncertainDatabase,
        reservation,
        now: context.now,
        onHash: () => { hashCalls += 1; },
      }),
      (error) => error.code === "credential_artifact_prepare_failed",
    );
    const afterUnknownAck = await fixture.database.prepare(
      'SELECT "state", "destination_hash", "destination_transform_digest" FROM "credential_transform_artifacts"',
    ).first();
    assert.equal(afterUnknownAck.state, "prepared");
    assert.match(afterUnknownAck.destination_hash, /^\$2[ab]\$10\$/u);
    assert.equal(afterUnknownAck.destination_hash.includes(sourcePassword), false);
    assert.equal(hashCalls, 1);

    const recovered = await prepareCredentialImportArtifact({
      database: fixture.database,
      reservation,
      now: context.now,
      onHash: () => { hashCalls += 1; },
    });
    assert.equal(recovered.destinationHash, afterUnknownAck.destination_hash);
    assert.equal(hashCalls, 1);

    let nowMs = 1_790_416_800_000 + 1_001;
    const resumedReservation = await reserveCredentialImportArtifact({
      ...context,
      now: () => new Date(nowMs),
      projection: syntheticCredentialProjection(fixture.catalog, { password: sourcePassword }),
    });
    assert.equal(resumedReservation.state, "prepared");
    assert.equal(resumedReservation.fencingToken, reservation.fencingToken + 1);
    const resumedArtifact = await prepareCredentialImportArtifact({
      database: fixture.database,
      reservation: resumedReservation,
      now: () => new Date(nowMs),
      onHash: () => { hashCalls += 1; },
    });
    assert.equal(resumedArtifact.destinationHash, afterUnknownAck.destination_hash);
    assert.equal(hashCalls, 1);

    const targetInsert = buildCredentialTargetInsert({
      projection: syntheticCredentialProjection(fixture.catalog, { password: sourcePassword }),
      preparedArtifact: resumedArtifact,
      descriptorDigest: resumedArtifact.descriptorDigest,
    });
    assert.deepEqual(targetInsert.columns, CREDENTIAL_SOURCE_COLUMNS);
    assert.equal(targetInsert.bindings[2], afterUnknownAck.destination_hash);
    assert.equal(targetInsert.bindings.includes(sourcePassword), false);
    assert.equal(JSON.stringify(targetInsert).includes(sourcePassword), false);
    await fixture.database.batch([
      fixture.database.prepare(
        'UPDATE "credential_transform_artifacts" SET "state" = ?, "applied_at" = ? WHERE "artifact_id" = ? AND "state" = ?',
      ).bind("applied", "2026-09-26T12:00:01.000Z", resumedArtifact.artifactId, "prepared"),
      fixture.database.prepare(targetInsert.sql).bind(...targetInsert.bindings),
    ]);
    const finalState = await fixture.database.prepare(
      'SELECT v."password_generation", v."access_generation", l."lifecycle_generation" FROM "fanmark_licenses" AS l JOIN "fanmark_access_versions" AS v ON v."license_id" = l."id" WHERE l."id" = ?',
    ).bind(syntheticLicenseId).first();
    assert.deepEqual(finalState, {
      password_generation: 1,
      access_generation: 1,
      lifecycle_generation: 0,
    });
    nowMs += 1_001;
    const appliedReservation = await reserveCredentialImportArtifact({
      ...context,
      now: () => new Date(nowMs),
      projection: syntheticCredentialProjection(fixture.catalog, { password: sourcePassword }),
    });
    assert.equal(appliedReservation.state, "applied");
    const appliedArtifact = await prepareCredentialImportArtifact({
      database: fixture.database,
      reservation: appliedReservation,
      now: () => new Date(nowMs),
      onHash: () => { hashCalls += 1; },
    });
    assert.equal(appliedArtifact.destinationHash, afterUnknownAck.destination_hash);
    assert.equal(hashCalls, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("credential preparation defers disabled and inactive source rows without storing artifacts", async () => {
  const fixture = await prepareFixture({ credentialExtension: true });
  try {
    await seedActiveLicense(fixture.database);
    const context = {
      database: fixture.database,
      catalog: fixture.catalog,
      destinationId: "synthetic-target",
      targetIncarnation: "synthetic-target-incarnation-1",
      sourceManifestDigest: "b".repeat(64),
      targetProfileFingerprint: fixture.credentialPlan.targetProfileFingerprint,
      now: () => new Date(1_790_416_800_000),
      leaseMs: 1_000,
    };
    await assert.rejects(
      reserveCredentialImportArtifact({
        ...context,
        projection: syntheticCredentialProjection(fixture.catalog, { enabled: false }),
      }),
      (error) => error.code === "credential_row_deferred_disabled",
    );
    await fixture.database.prepare(
      'UPDATE "fanmark_licenses" SET "status" = ? WHERE "id" = ?',
    ).bind("grace", syntheticLicenseId).run();
    await assert.rejects(
      reserveCredentialImportArtifact({
        ...context,
        projection: syntheticCredentialProjection(fixture.catalog),
      }),
      (error) => error.code === "credential_row_deferred_inactive",
    );
    const artifacts = await fixture.database.prepare(
      'SELECT COUNT(*) AS "count" FROM "credential_transform_artifacts"',
    ).first();
    assert.equal(artifacts.count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("credential input beyond bcrypt's byte boundary is rejected without storing the source value", async () => {
  const fixture = await prepareFixture({ credentialExtension: true });
  try {
    await seedActiveLicense(fixture.database);
    const sourcePassword = "x".repeat(73);
    const context = {
      database: fixture.database,
      catalog: fixture.catalog,
      destinationId: "synthetic-target",
      targetIncarnation: "synthetic-target-incarnation-1",
      sourceManifestDigest: "c".repeat(64),
      targetProfileFingerprint: fixture.credentialPlan.targetProfileFingerprint,
      now: () => new Date(1_790_416_800_000),
      leaseMs: 1_000,
    };
    const reservation = await reserveCredentialImportArtifact({
      ...context,
      projection: syntheticCredentialProjection(fixture.catalog, { password: sourcePassword }),
    });
    await assert.rejects(
      prepareCredentialImportArtifact({
        database: fixture.database,
        reservation,
        now: context.now,
      }),
      (error) => {
        assert.equal(error.code, "credential_input_too_long");
        assert.equal(error.message.includes(sourcePassword), false);
        return true;
      },
    );
    const artifact = await fixture.database.prepare(
      'SELECT "state", "failure_code", "destination_hash" FROM "credential_transform_artifacts"',
    ).first();
    assert.deepEqual(artifact, {
      state: "rejected",
      failure_code: "credential_input_too_long",
      destination_hash: null,
    });
    assert.equal(JSON.stringify(artifact).includes(sourcePassword), false);
    const targetRows = await fixture.database.prepare(
      'SELECT COUNT(*) AS "count" FROM "fanmark_password_configs"',
    ).first();
    assert.equal(targetRows.count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("credential transform profile is deterministic and binds lifecycle generations", async () => {
  const fixture = await prepareFixture();
  try {
    const second = generateCredentialTransformSchema({
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    });
    assert.equal(fixture.credentialPlan.extensionDigest, second.extensionDigest);
    assert.equal(fixture.credentialPlan.targetProfileFingerprint, second.targetProfileFingerprint);
    assert.equal(fixture.credentialPlan.sourceFingerprint, fixture.lifecyclePlan.sourceFingerprint);
    assert.equal(fixture.credentialPlan.lifecycleExtensionDigest, fixture.lifecyclePlan.extensionDigest);
    assert.equal(fixture.credentialPlan.generationExtensionDigest, fixture.generationPlan.extensionDigest);
    assert.match(fixture.credentialPlan.sql, /credential_transform_artifacts/u);
    assert.match(fixture.credentialPlan.sql, /credential_transform_coverage/u);
    assert.doesNotMatch(fixture.credentialPlan.sql, /password_hash|raw_password/u);
    assert.equal(fixture.credentialPlan.objectInventory.tables.length, 2);
    assert.equal(fixture.credentialPlan.objectInventory.indexes.length, 4);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("credential transform schema applies once, reads back exactly, and re-applies as a no-op", async () => {
  const fixture = await prepareFixture();
  try {
    const args = {
      database: fixture.database,
      plan: fixture.credentialPlan,
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    };
    assert.equal((await applyCredentialTransformSchema(args)).status, "applied");
    const inspected = await inspectCredentialTransformSchema(fixture.database, fixture.credentialPlan, {
      catalog: fixture.catalog,
      convertedSchema: fixture.convertedSchema,
      lifecyclePlan: fixture.lifecyclePlan,
      generationPlan: fixture.generationPlan,
      descriptor: descriptor(),
    });
    assert.equal(inspected.complete, true);
    assert.deepEqual(inspected.missing, []);
    assert.deepEqual(inspected.mismatched, []);
    assert.equal(inspected.extensionDigest, fixture.credentialPlan.extensionDigest);
    assert.equal((await applyCredentialTransformSchema(args)).status, "already_applied");
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("partial target extensions fail before applying the remaining credential DDL", async () => {
  const fixture = await prepareFixture();
  try {
    await fixture.database.prepare(fixture.credentialPlan.statements[0]).run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: fixture.database,
        plan: fixture.credentialPlan,
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: fixture.lifecyclePlan,
        generationPlan: fixture.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_schema_partial",
    );
    const rows = await fixture.database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'credential_transform_coverage'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("unexpected target objects and changed extension SQL fail closed", async () => {
  const unexpected = await prepareFixture();
  try {
    await unexpected.database.prepare("CREATE TABLE unexpected_target_object (id TEXT)").run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: unexpected.database,
        plan: unexpected.credentialPlan,
        catalog: unexpected.catalog,
        convertedSchema: unexpected.convertedSchema,
        lifecyclePlan: unexpected.lifecyclePlan,
        generationPlan: unexpected.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_base_schema_unexpected",
    );
    const rows = await unexpected.database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'credential_transform_artifacts'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await unexpected.miniflare.dispose();
  }

  const changed = await prepareFixture({ credentialExtension: true });
  try {
    await changed.database.prepare("DROP INDEX credential_transform_artifacts_lease").run();
    await changed.database.prepare(
      "CREATE INDEX credential_transform_artifacts_lease ON credential_transform_artifacts (target_profile_fingerprint)",
    ).run();
    await assert.rejects(
      applyCredentialTransformSchema({
        database: changed.database,
        plan: changed.credentialPlan,
        catalog: changed.catalog,
        convertedSchema: changed.convertedSchema,
        lifecyclePlan: changed.lifecyclePlan,
        generationPlan: changed.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_schema_existing_object_mismatch",
    );
  } finally {
    await changed.miniflare.dispose();
  }
});

test("tampered descriptors and lifecycle plans are rejected before target DDL", async () => {
  const fixture = await prepareFixture();
  try {
    assert.throws(
      () => generateCredentialTransformSchema({
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: fixture.lifecyclePlan,
        generationPlan: fixture.generationPlan,
        descriptor: { ...descriptor(), codecCost: 12 },
      }),
      (error) => error?.code === "credential_transform_descriptor_invalid",
    );
    const alteredLifecycle = structuredClone(fixture.lifecyclePlan);
    alteredLifecycle.extensionDigest = "0".repeat(64);
    assert.throws(
      () => generateCredentialTransformSchema({
        catalog: fixture.catalog,
        convertedSchema: fixture.convertedSchema,
        lifecyclePlan: alteredLifecycle,
        generationPlan: fixture.generationPlan,
        descriptor: descriptor(),
      }),
      (error) => error?.code === "credential_transform_profile_invalid",
    );
    const rows = await fixture.database.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'credential_transform_%'",
    ).all();
    assert.deepEqual(rows.results, []);
  } finally {
    await fixture.miniflare.dispose();
  }
});

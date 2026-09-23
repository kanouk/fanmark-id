#!/usr/bin/env node

/**
 * Build and apply the target-only credential transform ledger.
 *
 * This module creates only importer-owned metadata tables. It does not import
 * source rows, hash a password, or create the runtime access projection. The
 * source-shaped fanmark_password_configs table remains the only application
 * password table; its access_password value is deliberately absent from this
 * extension's DDL.
 */

import { convertSchema } from "./schema-convert.mjs";
import {
  canonicalJson,
  catalogFingerprint,
  schemaReportFingerprint,
  sha256Hex,
} from "./snapshot-format.mjs";
import { compileCredentialDescriptor } from "./credential-descriptor.mjs";
import {
  generateLifecycleTargetSchema,
  validateLifecycleTargetPlan,
  LIFECYCLE_TARGET_SCHEMA_VERSION,
} from "./lifecycle-target-schema.mjs";
import {
  generateLifecycleGenerationSchema,
  LIFECYCLE_GENERATION_SCHEMA_VERSION,
} from "./lifecycle-generation-schema.mjs";

export const CREDENTIAL_TRANSFORM_SCHEMA_VERSION = 1;
export const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;
export const CREDENTIAL_TRANSFORM_TABLE_NAMES = Object.freeze([
  "credential_transform_artifacts",
  "credential_transform_coverage",
]);
export const CREDENTIAL_TRANSFORM_INDEX_NAMES = Object.freeze([
  "credential_transform_artifacts_target_state",
  "credential_transform_artifacts_lease",
  "credential_transform_coverage_destination",
  "credential_transform_coverage_artifact",
]);

const PASSWORD_TABLE = "fanmark_password_configs";
const PASSWORD_COLUMN = "access_password";
const OBJECT_TYPE_ORDER = new Map([
  ["table", 0],
  ["index", 1],
  ["view", 2],
  ["trigger", 3],
]);
const DIGEST = (name) => `length(${name}) = 64 AND ${name} NOT GLOB '*[^0-9a-f]*'`;
const INTEGER = (name, minimum = 0) => `typeof(${name}) = 'integer' AND ${name} BETWEEN ${minimum} AND ${MAX_SAFE_SQL_INTEGER}`;

export class CredentialTransformSchemaError extends Error {
  constructor(code) {
    super(code);
    this.name = "CredentialTransformSchemaError";
    this.code = code;
  }
}

function fail(code) {
  throw new CredentialTransformSchemaError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectKey(type, name) {
  return `${type}:${name}`;
}

function compareObjects(left, right) {
  return (OBJECT_TYPE_ORDER.get(left.type) ?? 99) - (OBJECT_TYPE_ORDER.get(right.type) ?? 99) ||
    String(left.name).localeCompare(String(right.name));
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) fail("unsafe_identifier");
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedSql(value) {
  const input = String(value ?? "");
  let result = "";
  let quote = null;
  let pendingSpace = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      result += character;
      if (character === quote && input[index + 1] === quote) {
        result += input[index + 1];
        index += 1;
      } else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      if (pendingSpace && result.length > 0) result += " ";
      pendingSpace = false;
      quote = character;
      result += character;
      continue;
    }
    if (/\s/u.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && result.length > 0) result += " ";
    pendingSpace = false;
    result += character;
  }
  return result.trim().replace(/;+$/u, "");
}

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < String(sql).length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (character === quote && next === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function alteredLicenseSql(lifecyclePlan) {
  const source = lifecyclePlan.sourceObjectInventory.find(
    (object) => object.type === "table" && object.name === "fanmark_licenses",
  );
  if (!source) fail("credential_transform_source_table_missing");
  const close = source.sql.lastIndexOf(")");
  if (close < 0) fail("credential_transform_source_sql_invalid");
  const additions = lifecyclePlan.objectInventory.columns.map((column) =>
    `${quoteIdentifier(column.name)} ${column.type}${column.notNull ? " NOT NULL" : ""}${column.defaultValue === null ? "" : ` DEFAULT ${column.defaultValue}`}${column.check ? ` CHECK (${column.check})` : ""}`,
  );
  const before = source.sql.slice(0, close).trimEnd();
  let quote = null;
  let depth = 0;
  let constraintComma = -1;
  for (let index = 0; index < before.length; index += 1) {
    const character = before[index];
    const next = before[index + 1];
    if (quote) {
      if (character === quote && next === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 1 && /^\s*(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\b/iu.test(before.slice(index + 1))) {
      constraintComma = index;
      break;
    }
  }
  if (constraintComma >= 0) {
    const prefix = before.slice(0, constraintComma).trimEnd();
    const suffix = before.slice(constraintComma + 1).trimStart();
    return `${prefix},\n${additions.map((addition) => ` ${addition}`).join(",\n")},\n${suffix}\n${source.sql.slice(close)}`;
  }
  const separator = before.endsWith("(") ? "" : ",";
  return `${before}${separator}\n${additions.map((addition) => ` ${addition}`).join(",\n")}\n${source.sql.slice(close)}`;
}

function lifecycleBaselineObjects(lifecyclePlan) {
  const source = lifecyclePlan.sourceObjectInventory.map((object) => ({ ...object }));
  const license = source.find((object) => object.type === "table" && object.name === "fanmark_licenses");
  if (!license) fail("credential_transform_source_table_missing");
  license.sql = alteredLicenseSql(lifecyclePlan);
  return [
    ...source,
    ...lifecyclePlan.objectInventory.tables,
    ...lifecyclePlan.objectInventory.indexes,
  ].sort(compareObjects);
}

function profileObjects(lifecyclePlan, generationPlan) {
  return [
    ...lifecycleBaselineObjects(lifecyclePlan),
    ...generationPlan.objectInventory.triggers,
  ].sort(compareObjects);
}

function assertDigest(value, code) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(code);
}

function assertPlanShape(plan) {
  if (!isPlainObject(plan) || plan.schemaVersion !== CREDENTIAL_TRANSFORM_SCHEMA_VERSION) fail("invalid_credential_transform_plan");
  for (const name of ["sourceFingerprint", "sourceCatalogFingerprint", "sourceReportFingerprint", "lifecycleExtensionDigest", "generationExtensionDigest", "descriptorDigest", "targetProfileFingerprint", "extensionDigest"]) {
    assertDigest(plan[name], "credential_transform_plan_digest_invalid");
  }
  if (!Number.isSafeInteger(plan.descriptorVersion) || plan.descriptorVersion < 1 || !isPlainObject(plan.descriptor)) fail("invalid_credential_transform_plan");
  if (sha256Hex(plan.descriptor) !== plan.descriptorDigest) fail("credential_transform_descriptor_digest_mismatch");
  if (!Array.isArray(plan.statements) || !isPlainObject(plan.objectInventory)) fail("invalid_credential_transform_plan");
  if (!Array.isArray(plan.objectInventory.tables) || !Array.isArray(plan.objectInventory.indexes)) fail("invalid_credential_transform_plan");
  if (plan.sql !== `${plan.statements.join("\n\n")}\n`) fail("credential_transform_plan_sql_mismatch");
  const profile = {
    sourceFingerprint: plan.sourceFingerprint,
    sourceCatalogFingerprint: plan.sourceCatalogFingerprint,
    sourceReportFingerprint: plan.sourceReportFingerprint,
    lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
    generationExtensionDigest: plan.generationExtensionDigest,
    descriptorVersion: plan.descriptorVersion,
    descriptorDigest: plan.descriptorDigest,
  };
  if (sha256Hex(profile) !== plan.targetProfileFingerprint) fail("credential_transform_profile_digest_mismatch");
  if (sha256Hex({ schemaVersion: plan.schemaVersion, targetProfileFingerprint: plan.targetProfileFingerprint, objectInventory: plan.objectInventory, statements: plan.statements }) !== plan.extensionDigest) {
    fail("credential_transform_plan_digest_mismatch");
  }
  const allStatements = plan.statements.join("\n");
  if (/\bIF\s+NOT\s+EXISTS\b/iu.test(allStatements)) fail("credential_transform_ddl_not_exact");
}

function buildDefinition() {
  const statements = [];
  statements.push(`CREATE TABLE "credential_transform_artifacts" (
  "artifact_id" TEXT PRIMARY KEY NOT NULL,
  "artifact_key" TEXT NOT NULL UNIQUE,
  "source_binding_digest" TEXT NOT NULL UNIQUE CHECK (${DIGEST('"source_binding_digest"')}),
  "target_profile_fingerprint" TEXT NOT NULL CHECK (${DIGEST('"target_profile_fingerprint"')}),
  "source_manifest_digest" TEXT NOT NULL CHECK (${DIGEST('"source_manifest_digest"')}),
  "descriptor_digest" TEXT NOT NULL CHECK (${DIGEST('"descriptor_digest"')}),
  "source_relation" TEXT NOT NULL CHECK ("source_relation" = 'fanmark_password_configs'),
  "source_primary_key_json" TEXT NOT NULL CHECK (length("source_primary_key_json") > 0),
  "source_row_identity_digest" TEXT NOT NULL CHECK (${DIGEST('"source_row_identity_digest"')}),
  "source_envelope_digest" TEXT NOT NULL CHECK (${DIGEST('"source_envelope_digest"')}),
  "source_revision" TEXT NOT NULL CHECK (length("source_revision") > 0),
  "destination_relation" TEXT NOT NULL CHECK ("destination_relation" = 'fanmark_password_configs'),
  "destination_column" TEXT NOT NULL CHECK ("destination_column" = 'access_password'),
  "destination_license_id" TEXT NOT NULL CHECK (length("destination_license_id") > 0),
  "target_identity" TEXT NOT NULL CHECK (length("target_identity") > 0),
  "target_incarnation" TEXT NOT NULL CHECK (length("target_incarnation") > 0),
  "license_incarnation" INTEGER NOT NULL CHECK (${INTEGER('"license_incarnation"')}),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IN (0, 1)),
  "codec_id" TEXT NOT NULL CHECK ("codec_id" = 'bcryptjs@3.0.3'),
  "codec_parameters_version" INTEGER NOT NULL CHECK (${INTEGER('"codec_parameters_version"', 1)}),
  "codec_cost" INTEGER NOT NULL CHECK ("codec_cost" = 10),
  "transform_contract_version" INTEGER NOT NULL CHECK ("transform_contract_version" = 1),
  "policy_version" INTEGER NOT NULL CHECK ("policy_version" = 1),
  "expected_password_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_password_generation"')}),
  "expected_access_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_access_generation"')}),
  "expected_lifecycle_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_lifecycle_generation"')}),
  "destination_hash" TEXT,
  "destination_transform_digest" TEXT UNIQUE CHECK ("destination_transform_digest" IS NULL OR ${DIGEST('"destination_transform_digest"')}),
  "state" TEXT NOT NULL CHECK ("state" IN ('reserved', 'prepared', 'applied', 'reconciled', 'rejected')),
  "lease_id" TEXT,
  "lease_expires_at" INTEGER,
  "fencing_token" INTEGER NOT NULL CHECK (${INTEGER('"fencing_token"', 1)}),
  "created_at" TEXT NOT NULL,
  "prepared_at" TEXT,
  "applied_at" TEXT,
  "reconciled_at" TEXT,
  "failure_code" TEXT CHECK ("failure_code" IS NULL OR (length("failure_code") BETWEEN 1 AND 128 AND "failure_code" NOT GLOB '*[^a-z0-9_]*')),
  CHECK (("state" = 'reserved' AND "destination_hash" IS NULL AND "destination_transform_digest" IS NULL AND "prepared_at" IS NULL AND "applied_at" IS NULL AND "reconciled_at" IS NULL AND "failure_code" IS NULL)
      OR ("state" = 'prepared' AND "destination_hash" IS NOT NULL AND "destination_transform_digest" IS NOT NULL AND "prepared_at" IS NOT NULL AND "applied_at" IS NULL AND "reconciled_at" IS NULL AND "failure_code" IS NULL)
      OR ("state" = 'applied' AND "destination_hash" IS NOT NULL AND "destination_transform_digest" IS NOT NULL AND "prepared_at" IS NOT NULL AND "applied_at" IS NOT NULL AND "reconciled_at" IS NULL AND "failure_code" IS NULL)
      OR ("state" = 'reconciled' AND "destination_hash" IS NOT NULL AND "destination_transform_digest" IS NOT NULL AND "prepared_at" IS NOT NULL AND "applied_at" IS NOT NULL AND "reconciled_at" IS NOT NULL AND "failure_code" IS NULL)
      OR ("state" = 'rejected' AND "failure_code" IS NOT NULL))
);`);
  statements.push(`CREATE TABLE "credential_transform_coverage" (
  "run_id" TEXT NOT NULL CHECK (length("run_id") > 0),
  "target_profile_fingerprint" TEXT NOT NULL CHECK (${DIGEST('"target_profile_fingerprint"')}),
  "source_manifest_digest" TEXT NOT NULL CHECK (${DIGEST('"source_manifest_digest"')}),
  "descriptor_digest" TEXT NOT NULL CHECK (${DIGEST('"descriptor_digest"')}),
  "target_identity" TEXT NOT NULL CHECK (length("target_identity") > 0),
  "target_incarnation" TEXT NOT NULL CHECK (length("target_incarnation") > 0),
  "table_name" TEXT NOT NULL CHECK ("table_name" = 'fanmark_password_configs'),
  "source_primary_key_json" TEXT NOT NULL CHECK (length("source_primary_key_json") > 0),
  "source_row_identity_digest" TEXT NOT NULL CHECK (${DIGEST('"source_row_identity_digest"')}),
  "source_envelope_digest" TEXT NOT NULL CHECK (${DIGEST('"source_envelope_digest"')}),
  "destination_relation" TEXT NOT NULL CHECK ("destination_relation" = 'fanmark_password_configs'),
  "destination_column" TEXT NOT NULL CHECK ("destination_column" = 'access_password'),
  "destination_primary_key_json" TEXT NOT NULL CHECK (length("destination_primary_key_json") > 0),
  "destination_license_id" TEXT NOT NULL CHECK (length("destination_license_id") > 0),
  "license_incarnation" INTEGER NOT NULL CHECK (${INTEGER('"license_incarnation"')}),
  "enabled" INTEGER NOT NULL CHECK ("enabled" IN (0, 1)),
  "expected_password_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_password_generation"')}),
  "expected_access_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_access_generation"')}),
  "expected_lifecycle_generation" INTEGER NOT NULL CHECK (${INTEGER('"expected_lifecycle_generation"')}),
  "artifact_id" TEXT NOT NULL REFERENCES "credential_transform_artifacts"("artifact_id"),
  "fencing_token" INTEGER NOT NULL CHECK (${INTEGER('"fencing_token"', 1)}),
  "coverage_state" TEXT NOT NULL CHECK ("coverage_state" IN ('transformed', 'disabled', 'deferred_disabled', 'deferred_inactive', 'rejected')),
  "destination_transform_digest" TEXT CHECK ("destination_transform_digest" IS NULL OR ${DIGEST('"destination_transform_digest"')}),
  "destination_digest" TEXT CHECK ("destination_digest" IS NULL OR ${DIGEST('"destination_digest"')}),
  "reason_code" TEXT CHECK ("reason_code" IS NULL OR (length("reason_code") BETWEEN 1 AND 128 AND "reason_code" NOT GLOB '*[^a-z0-9_]*')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "table_name", "source_row_identity_digest"),
  UNIQUE ("target_identity", "target_incarnation", "table_name", "destination_primary_key_json"),
  UNIQUE ("target_identity", "target_incarnation", "destination_relation", "destination_column", "destination_license_id", "license_incarnation"),
  CHECK (("coverage_state" = 'transformed' AND "destination_transform_digest" IS NOT NULL AND "destination_digest" IS NOT NULL AND "reason_code" IS NULL)
      OR ("coverage_state" = 'disabled' AND "destination_transform_digest" IS NOT NULL AND "destination_digest" IS NOT NULL AND "reason_code" IS NULL)
      OR ("coverage_state" IN ('deferred_disabled', 'deferred_inactive', 'rejected') AND "destination_transform_digest" IS NULL AND "destination_digest" IS NULL AND "reason_code" IS NOT NULL))
);`);
  statements.push(`CREATE INDEX "credential_transform_artifacts_target_state" ON "credential_transform_artifacts" ("target_identity", "target_incarnation", "state");`);
  statements.push(`CREATE INDEX "credential_transform_artifacts_lease" ON "credential_transform_artifacts" ("state", "lease_expires_at");`);
  statements.push(`CREATE INDEX "credential_transform_coverage_destination" ON "credential_transform_coverage" ("target_identity", "target_incarnation", "destination_license_id", "license_incarnation", "coverage_state");`);
  statements.push(`CREATE INDEX "credential_transform_coverage_artifact" ON "credential_transform_coverage" ("artifact_id");`);
  return statements;
}

function expectedPlanDigest(plan) {
  return sha256Hex({
    schemaVersion: plan.schemaVersion,
    targetProfileFingerprint: plan.targetProfileFingerprint,
    objectInventory: plan.objectInventory,
    statements: plan.statements,
  });
}

function comparePlanField(left, right, field, code = "credential_transform_plan_mismatch") {
  if (canonicalJson(left[field]) !== canonicalJson(right[field])) fail(code);
}

function validateProfilePlans({ catalog, convertedSchema, lifecyclePlan, generationPlan }) {
  let converted;
  try {
    converted = convertedSchema ?? convertSchema(catalog);
    validateLifecycleTargetPlan(lifecyclePlan);
    const expectedLifecycle = generateLifecycleTargetSchema({ catalog, convertedSchema: converted });
    for (const field of ["schemaVersion", "sourceFingerprint", "sourceCatalogFingerprint", "sourceReportFingerprint", "sourceSchemaSql", "sourceObjectInventory", "statements", "objectInventory", "extensionDigest"]) {
      comparePlanField(lifecyclePlan, expectedLifecycle, field, "credential_transform_lifecycle_plan_mismatch");
    }
    const expectedGeneration = generateLifecycleGenerationSchema({ catalog, convertedSchema: converted, lifecyclePlan: expectedLifecycle });
    if (!isPlainObject(generationPlan) || generationPlan.schemaVersion !== LIFECYCLE_GENERATION_SCHEMA_VERSION) fail("credential_transform_generation_plan_mismatch");
    for (const field of ["schemaVersion", "lifecycleSchemaVersion", "lifecycleExtensionDigest", "sourceFingerprint", "sourceObjectInventory", "statements", "objectInventory", "extensionDigest"]) {
      comparePlanField(generationPlan, expectedGeneration, field, "credential_transform_generation_plan_mismatch");
    }
    if (generationPlan.lifecycleExtensionDigest !== lifecyclePlan.extensionDigest || generationPlan.sourceFingerprint !== lifecyclePlan.sourceFingerprint) fail("credential_transform_profile_mismatch");
    return { converted, lifecycle: expectedLifecycle, generation: expectedGeneration };
  } catch (error) {
    if (error instanceof CredentialTransformSchemaError) throw error;
    fail("credential_transform_profile_invalid");
  }
}

export function generateCredentialTransformSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor } = {}) {
  if (!isPlainObject(catalog) || !isPlainObject(lifecyclePlan) || !isPlainObject(generationPlan)) fail("credential_transform_configuration_invalid");
  const profile = validateProfilePlans({ catalog, convertedSchema, lifecyclePlan, generationPlan });
  let mapping;
  try {
    mapping = compileCredentialDescriptor({ catalog, descriptor });
  } catch {
    fail("credential_transform_descriptor_invalid");
  }
  const targetProfile = {
    sourceFingerprint: profile.lifecycle.sourceFingerprint,
    sourceCatalogFingerprint: profile.lifecycle.sourceCatalogFingerprint,
    sourceReportFingerprint: profile.lifecycle.sourceReportFingerprint,
    lifecycleExtensionDigest: profile.lifecycle.extensionDigest,
    generationExtensionDigest: profile.generation.extensionDigest,
    descriptorVersion: mapping.descriptorVersion,
    descriptorDigest: mapping.descriptorDigest,
  };
  const plan = {
    schemaVersion: CREDENTIAL_TRANSFORM_SCHEMA_VERSION,
    sourceFingerprint: profile.lifecycle.sourceFingerprint,
    sourceCatalogFingerprint: profile.lifecycle.sourceCatalogFingerprint,
    sourceReportFingerprint: profile.lifecycle.sourceReportFingerprint,
    lifecycleExtensionDigest: profile.lifecycle.extensionDigest,
    generationExtensionDigest: profile.generation.extensionDigest,
    descriptorVersion: mapping.descriptorVersion,
    descriptorDigest: mapping.descriptorDigest,
    descriptor: mapping.descriptor,
    targetProfileFingerprint: sha256Hex(targetProfile),
    sourceObjectInventory: profile.lifecycle.sourceObjectInventory,
    statements: buildDefinition(),
    objectInventory: {
      tables: ["credential_transform_artifacts", "credential_transform_coverage"].map((name, index) => ({ type: "table", name, sql: buildDefinition()[index] })),
      indexes: buildDefinition().slice(2).map((sql) => ({ type: "index", name: sql.match(/^CREATE INDEX "([^"]+)"/u)?.[1], sql })),
    },
    extensionDigest: "",
  };
  plan.extensionDigest = expectedPlanDigest(plan);
  plan.sql = `${plan.statements.join("\n\n")}\n`;
  validateCredentialTransformPlan(plan);
  return plan;
}

export const buildCredentialTransformSchema = generateCredentialTransformSchema;

export function validateCredentialTransformPlan(plan) {
  assertPlanShape(plan);
  if (plan.objectInventory.tables.length !== 2 || plan.objectInventory.indexes.length !== 4) fail("credential_transform_inventory_invalid");
  const statements = plan.statements.map((sql) => ({ sql, parts: sql.match(/^CREATE\s+(TABLE|INDEX)\s+"([A-Za-z_][A-Za-z0-9_]*)"/iu) }));
  if (statements.some(({ parts }) => !parts)) fail("credential_transform_inventory_invalid");
  const expectedNames = ["credential_transform_artifacts", "credential_transform_coverage", ...CREDENTIAL_TRANSFORM_INDEX_NAMES];
  if (statements.map(({ parts }) => parts[2]).join("\0") !== expectedNames.join("\0")) fail("credential_transform_inventory_invalid");
}

async function queryAll(database, sql) {
  let result;
  try {
    result = await database.prepare(sql).all();
  } catch {
    fail("credential_transform_schema_inspection_failed");
  }
  if (result?.success === false || !Array.isArray(result.results)) fail("credential_transform_schema_inspection_failed");
  return result.results;
}

async function readObjects(database) {
  const rows = await queryAll(database, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name");
  const objects = new Map();
  for (const row of rows) {
    const key = objectKey(String(row.type), String(row.name));
    if (objects.has(key)) fail("credential_transform_duplicate_object");
    objects.set(key, row);
  }
  return objects;
}

const PROVIDER_OBJECT = objectKey("table", "_cf_METADATA");

function assertObjects(actual, expected, code, allowed = new Set()) {
  const expectedByKey = new Map(expected.map((object) => [objectKey(object.type, object.name), object]));
  for (const object of expected) {
    const row = actual.get(objectKey(object.type, object.name));
    if (!row) fail(`${code}_missing`);
    if (String(row.type) !== object.type || normalizedSql(row.sql) !== normalizedSql(object.sql)) fail(`${code}_mismatch`);
  }
  for (const [key, row] of actual) {
    if (expectedByKey.has(key) || allowed.has(key) || key === PROVIDER_OBJECT) continue;
    fail(`${code}_unexpected`);
  }
}

function assertBaseline(actual, baseline, extensionKeys) {
  const allowed = new Set(extensionKeys);
  for (const object of baseline) {
    const row = actual.get(objectKey(object.type, object.name));
    if (!row) fail("credential_transform_base_schema_missing");
    if (String(row.type) !== object.type || normalizedSql(row.sql) !== normalizedSql(object.sql)) fail("credential_transform_base_schema_mismatch");
  }
  for (const key of actual.keys()) {
    if (baseline.some((object) => objectKey(object.type, object.name) === key) || allowed.has(key) || key === PROVIDER_OBJECT) continue;
    fail("credential_transform_base_schema_unexpected");
  }
}

async function extensionState(database, plan) {
  const actual = await readObjects(database);
  const expected = [
    ...plan.objectInventory.tables,
    ...plan.objectInventory.indexes,
  ];
  const missing = [];
  const mismatched = [];
  for (const object of expected) {
    const row = actual.get(objectKey(object.type, object.name));
    if (!row) missing.push(`${object.type}:${object.name}`);
    else if (normalizedSql(row.sql) !== normalizedSql(object.sql)) mismatched.push(`${object.type}:${object.name}`);
  }
  return { actual, complete: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

function validatePlanAgainstInputs({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor, plan }) {
  validateCredentialTransformPlan(plan);
  const expected = generateCredentialTransformSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor });
  for (const field of ["schemaVersion", "sourceFingerprint", "sourceCatalogFingerprint", "sourceReportFingerprint", "lifecycleExtensionDigest", "generationExtensionDigest", "descriptorVersion", "descriptorDigest", "descriptor", "targetProfileFingerprint", "sourceObjectInventory", "statements", "objectInventory", "extensionDigest", "sql"]) {
    comparePlanField(plan, expected, field);
  }
}

export async function inspectCredentialTransformSchema(database, plan, { catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor } = {}) {
  if (!database || typeof database.prepare !== "function") fail("invalid_target_database");
  if (!catalog || !lifecyclePlan || !generationPlan || !descriptor) fail("credential_transform_profile_missing");
  validatePlanAgainstInputs({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor, plan });
  const profile = validateProfilePlans({ catalog, convertedSchema, lifecyclePlan, generationPlan });
  const baseline = profileObjects(profile.lifecycle, profile.generation);
  const state = await extensionState(database, plan);
  assertBaseline(state.actual, baseline, [...CREDENTIAL_TRANSFORM_TABLE_NAMES.map((name) => objectKey("table", name)), ...CREDENTIAL_TRANSFORM_INDEX_NAMES.map((name) => objectKey("index", name))]);
  if (state.complete) assertObjects(state.actual, [...baseline, ...plan.objectInventory.tables, ...plan.objectInventory.indexes].sort(compareObjects), "credential_transform_schema");
  return { ...state, extensionDigest: plan.extensionDigest, targetProfileFingerprint: plan.targetProfileFingerprint };
}

export async function applyCredentialTransformSchema({ database, plan, catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor } = {}) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") fail("invalid_target_database");
  validatePlanAgainstInputs({ catalog, convertedSchema, lifecyclePlan, generationPlan, descriptor, plan });
  const baseline = profileObjects(lifecyclePlan, generationPlan);
  const extensionKeys = [
    ...plan.objectInventory.tables.map((object) => objectKey(object.type, object.name)),
    ...plan.objectInventory.indexes.map((object) => objectKey(object.type, object.name)),
  ];
  const before = await extensionState(database, plan);
  assertBaseline(before.actual, baseline, extensionKeys);
  if (before.mismatched.length > 0) fail("credential_transform_schema_existing_object_mismatch");
  const extensionObjects = [...plan.objectInventory.tables, ...plan.objectInventory.indexes];
  const presentExtensionCount = extensionObjects.filter((object) =>
    before.actual.has(objectKey(object.type, object.name)),
  ).length;
  if (presentExtensionCount > 0 && before.missing.length > 0) fail("credential_transform_schema_partial");
  const all = [...baseline, ...plan.objectInventory.tables, ...plan.objectInventory.indexes].sort(compareObjects);
  if (before.complete) {
    assertObjects(before.actual, all, "credential_transform_schema");
    return { status: "already_applied", extensionDigest: plan.extensionDigest, targetProfileFingerprint: plan.targetProfileFingerprint };
  }
  assertObjects(before.actual, baseline, "credential_transform_base_schema");
  let results;
  try {
    results = await database.batch(plan.statements.map((statement) => database.prepare(statement)));
  } catch {
    fail("credential_transform_schema_apply_failed");
  }
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) fail("credential_transform_schema_apply_failed");
  const after = await extensionState(database, plan);
  if (!after.complete) fail("credential_transform_schema_readback_failed");
  assertObjects(after.actual, all, "credential_transform_schema");
  return { status: "applied", extensionDigest: plan.extensionDigest, targetProfileFingerprint: plan.targetProfileFingerprint };
}

export const USAGE = "credential-transform-schema.mjs exposes generateCredentialTransformSchema, validateCredentialTransformPlan, inspectCredentialTransformSchema, and applyCredentialTransformSchema.";

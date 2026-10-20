#!/usr/bin/env node

/**
 * Build and apply the target-only state needed for protected public access.
 * The extension stores short-lived proof/rate-limit metadata and a version-bound
 * witness for Worker-authored password changes. It never stores a password,
 * password hash, request address, or browser token.
 */

import { convertSchema } from "./schema-convert.mjs";
import { canonicalJson, sha256Hex } from "./snapshot-format.mjs";
import { isD1ProviderObject } from "./d1-provider-objects.mjs";
import {
  generateLifecycleTargetSchema,
  validateLifecycleTargetPlan,
} from "./lifecycle-target-schema.mjs";
import { generateLifecycleGenerationSchema } from "./lifecycle-generation-schema.mjs";
import {
  generateCredentialTransformSchema,
  validateCredentialTransformPlan,
} from "./credential-transform-schema.mjs";

export const VERIFIED_ACCESS_SCHEMA_VERSION = 2;
export const VERIFIED_ACCESS_TABLE_NAMES = Object.freeze([
  "fanmark_password_runtime_evidence",
  "fanmark_access_proofs",
  "fanmark_access_rate_policy",
  "fanmark_access_rate_limits",
  "fanmark_access_attempt_reservations",
  "fanmark_access_attempt_audit",
]);
export const VERIFIED_ACCESS_INDEX_NAMES = Object.freeze([
  "fanmark_access_proofs_lookup_idx",
  "fanmark_access_proofs_expiry_idx",
  "fanmark_access_rate_limits_window_idx",
  "fanmark_access_attempt_reservations_expiry_idx",
  "fanmark_access_attempt_audit_license_idx",
]);
export const VERIFIED_ACCESS_TRIGGER_NAMES = Object.freeze([
  "verified_access_reservation_guard",
  "verified_access_reservation_increment",
  "verified_access_reservation_success_guard",
  "verified_access_reservation_failure_increment",
]);

const OBJECT_TYPE_ORDER = new Map([["table", 0], ["index", 1], ["view", 2], ["trigger", 3]]);

export class VerifiedAccessSchemaError extends Error {
  constructor(code) {
    super(code);
    this.name = "VerifiedAccessSchemaError";
    this.code = code;
  }
}

function fail(code) {
  throw new VerifiedAccessSchemaError(code);
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
      if (pendingSpace && result && !result.endsWith(" ")) result += " ";
      pendingSpace = false;
      quote = character;
      result += character;
      continue;
    }
    if (/\s/u.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && result && !result.endsWith(" ")) result += " ";
    pendingSpace = false;
    result += character;
  }
  return result.trim().replace(/;+$/u, "");
}

function alteredLicenseSql(lifecyclePlan) {
  const source = lifecyclePlan.sourceObjectInventory.find(
    (object) => object.type === "table" && object.name === "fanmark_licenses",
  );
  if (!source) fail("verified_access_source_table_missing");
  const close = source.sql.lastIndexOf(")");
  if (close < 0) fail("verified_access_source_sql_invalid");
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
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 1 && /^\s*(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\b/iu.test(before.slice(index + 1))) {
      constraintComma = index;
      break;
    }
  }
  if (constraintComma >= 0) {
    const prefix = before.slice(0, constraintComma).trimEnd();
    const suffix = before.slice(constraintComma + 1).trimStart();
    return `${prefix},\n${additions.map((addition) => ` ${addition}`).join(",\n")},\n${suffix}\n${source.sql.slice(close)}`;
  }
  return `${before}${before.endsWith("(") ? "" : ","}\n${additions.map((addition) => ` ${addition}`).join(",\n")}\n${source.sql.slice(close)}`;
}

function buildDefinition() {
  const max = Number.MAX_SAFE_INTEGER;
  const digest = (column) => `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
  const integer = (column, min = 0) => `typeof(${column}) = 'integer' AND ${column} BETWEEN ${min} AND ${max}`;
  const statements = [
    `CREATE TABLE "fanmark_password_runtime_evidence" (
      "license_id" TEXT PRIMARY KEY NOT NULL REFERENCES "fanmark_licenses"("id") ON DELETE CASCADE,
      "license_incarnation" INTEGER NOT NULL CHECK (${integer('"license_incarnation"')}),
      "password_generation" INTEGER NOT NULL CHECK (${integer('"password_generation"')}),
      "enabled" INTEGER NOT NULL CHECK ("enabled" IN (0, 1)),
      "codec_id" TEXT NOT NULL CHECK ("codec_id" = 'bcryptjs@3.0.3'),
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL
    );`,
    `CREATE TABLE "fanmark_access_proofs" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "token_hash" TEXT NOT NULL UNIQUE CHECK (${digest('"token_hash"')}),
      "finalization_id" TEXT NOT NULL UNIQUE,
      "selector_kind" TEXT NOT NULL CHECK ("selector_kind" IN ('short', 'emoji', 'profile')),
      "selector_hash" TEXT NOT NULL CHECK (${digest('"selector_hash"')}),
      "fanmark_id" TEXT NOT NULL REFERENCES "fanmarks"("id") ON DELETE CASCADE,
      "license_id" TEXT NOT NULL REFERENCES "fanmark_licenses"("id") ON DELETE CASCADE,
      "password_generation" INTEGER NOT NULL CHECK (${integer('"password_generation"')}),
      "access_generation" INTEGER NOT NULL CHECK (${integer('"access_generation"')}),
      "license_incarnation" INTEGER NOT NULL CHECK (${integer('"license_incarnation"')}),
      "created_at" TEXT NOT NULL,
      "expires_at" TEXT NOT NULL CHECK ("expires_at" > "created_at")
    );`,
    `CREATE TABLE "fanmark_access_rate_policy" (
      "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
      "window_ms" INTEGER NOT NULL CHECK (${integer('"window_ms"', 1000)}),
      "max_attempts" INTEGER NOT NULL CHECK (${integer('"max_attempts"', 1)}),
      "reservation_ms" INTEGER NOT NULL CHECK (${integer('"reservation_ms"', 1)} AND "reservation_ms" <= "window_ms")
    );`,
    `CREATE TABLE "fanmark_access_rate_limits" (
      "bucket_kind" TEXT NOT NULL CHECK ("bucket_kind" IN ('requester', 'resource')),
      "bucket_hash" TEXT NOT NULL CHECK (${digest('"bucket_hash"')}),
      "window_id" INTEGER NOT NULL CHECK (${integer('"window_id"')}),
      "window_started_at" INTEGER NOT NULL CHECK (${integer('"window_started_at"')}),
      "window_expires_at" INTEGER NOT NULL CHECK (${integer('"window_expires_at"')} AND "window_expires_at" > "window_started_at"),
      "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK (${integer('"attempt_count"')}),
      "failure_count" INTEGER NOT NULL DEFAULT 0 CHECK (${integer('"failure_count"')}),
      "cooldown_until" INTEGER CHECK ("cooldown_until" IS NULL OR ${integer('"cooldown_until"')}),
      "updated_at" INTEGER NOT NULL CHECK (${integer('"updated_at"')}),
      PRIMARY KEY ("bucket_kind", "bucket_hash")
    );`,
    `CREATE TABLE "fanmark_access_attempt_reservations" (
      "reservation_id" TEXT PRIMARY KEY NOT NULL,
      "requester_bucket_hash" TEXT NOT NULL CHECK (${digest('"requester_bucket_hash"')}),
      "resource_bucket_hash" TEXT NOT NULL CHECK (${digest('"resource_bucket_hash"')}),
      "license_id" TEXT REFERENCES "fanmark_licenses"("id") ON DELETE SET NULL,
      "selector_hash" TEXT NOT NULL CHECK (${digest('"selector_hash"')}),
      "window_id" INTEGER NOT NULL CHECK (${integer('"window_id"')}),
      "reserved_at" INTEGER NOT NULL CHECK (${integer('"reserved_at"')}),
      "reservation_expires_at" INTEGER NOT NULL CHECK (${integer('"reservation_expires_at"')}),
      "outcome" TEXT NOT NULL CHECK ("outcome" IN ('reserved', 'success', 'failure', 'expired', 'stale')),
      "finalization_id" TEXT UNIQUE,
      "completed_at" INTEGER CHECK ("completed_at" IS NULL OR ${integer('"completed_at"')}),
      CHECK ("outcome" <> 'reserved' OR ("finalization_id" IS NULL AND "completed_at" IS NULL)),
      CHECK ("outcome" = 'reserved' OR ("finalization_id" IS NOT NULL AND "completed_at" IS NOT NULL))
    );`,
    `CREATE TABLE "fanmark_access_attempt_audit" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "reservation_id" TEXT NOT NULL,
      "license_id" TEXT REFERENCES "fanmark_licenses"("id") ON DELETE SET NULL,
      "selector_hash" TEXT CHECK ("selector_hash" IS NULL OR ${digest('"selector_hash"')}),
      "requester_hash" TEXT NOT NULL CHECK (${digest('"requester_hash"')}),
      "outcome" TEXT NOT NULL CHECK ("outcome" IN ('blocked', 'failure', 'expired', 'success', 'stale')),
      "occurred_at" INTEGER NOT NULL CHECK (${integer('"occurred_at"')}),
      "password_generation" INTEGER CHECK ("password_generation" IS NULL OR ${integer('"password_generation"')}),
      "access_generation" INTEGER CHECK ("access_generation" IS NULL OR ${integer('"access_generation"')}),
      "license_incarnation" INTEGER CHECK ("license_incarnation" IS NULL OR ${integer('"license_incarnation"')})
    );`,
    `CREATE INDEX "fanmark_access_proofs_lookup_idx" ON "fanmark_access_proofs" ("token_hash", "selector_kind", "selector_hash");`,
    `CREATE INDEX "fanmark_access_proofs_expiry_idx" ON "fanmark_access_proofs" ("license_id", "expires_at");`,
    `CREATE INDEX "fanmark_access_rate_limits_window_idx" ON "fanmark_access_rate_limits" ("window_expires_at");`,
    `CREATE INDEX "fanmark_access_attempt_reservations_expiry_idx" ON "fanmark_access_attempt_reservations" ("outcome", "reservation_expires_at");`,
    `CREATE INDEX "fanmark_access_attempt_audit_license_idx" ON "fanmark_access_attempt_audit" ("license_id", "occurred_at");`,
    `CREATE TRIGGER "verified_access_reservation_guard"
      BEFORE INSERT ON "fanmark_access_attempt_reservations"
      WHEN new."outcome" = 'reserved'
      BEGIN
        SELECT RAISE(ABORT, 'reservation blocked')
        WHERE NOT EXISTS (
          SELECT 1 FROM "fanmark_access_rate_limits"
          WHERE "bucket_kind" = 'requester' AND "bucket_hash" = new."requester_bucket_hash"
            AND "window_id" = new."window_id"
            AND "attempt_count" < (SELECT "max_attempts" FROM "fanmark_access_rate_policy" WHERE "id" = 1)
            AND ("cooldown_until" IS NULL OR "cooldown_until" <= new."reserved_at")
        ) OR NOT EXISTS (
          SELECT 1 FROM "fanmark_access_rate_limits"
          WHERE "bucket_kind" = 'resource' AND "bucket_hash" = new."resource_bucket_hash"
            AND "window_id" = new."window_id"
            AND "attempt_count" < (SELECT "max_attempts" FROM "fanmark_access_rate_policy" WHERE "id" = 1)
            AND ("cooldown_until" IS NULL OR "cooldown_until" <= new."reserved_at")
        ) OR new."reservation_expires_at" <= new."reserved_at";
      END;`,
    `CREATE TRIGGER "verified_access_reservation_increment"
      AFTER INSERT ON "fanmark_access_attempt_reservations"
      WHEN new."outcome" = 'reserved'
      BEGIN
        UPDATE "fanmark_access_rate_limits"
        SET "attempt_count" = "attempt_count" + 1, "updated_at" = new."reserved_at"
        WHERE "window_id" = new."window_id"
          AND (("bucket_kind" = 'requester' AND "bucket_hash" = new."requester_bucket_hash")
            OR ("bucket_kind" = 'resource' AND "bucket_hash" = new."resource_bucket_hash"));
      END;`,
    `CREATE TRIGGER "verified_access_reservation_success_guard"
      BEFORE UPDATE OF "outcome" ON "fanmark_access_attempt_reservations"
      WHEN old."outcome" = 'reserved' AND new."outcome" = 'success'
        AND (new."completed_at" IS NULL OR new."completed_at" >= old."reservation_expires_at")
      BEGIN
        SELECT RAISE(ABORT, 'reservation expired');
      END;`,
    `CREATE TRIGGER "verified_access_reservation_failure_increment"
      AFTER UPDATE OF "outcome" ON "fanmark_access_attempt_reservations"
      WHEN old."outcome" = 'reserved' AND new."outcome" = 'failure'
      BEGIN
        UPDATE "fanmark_access_rate_limits"
        SET "failure_count" = "failure_count" + 1,
            "cooldown_until" = MAX(COALESCE("cooldown_until", 0),
              CASE WHEN "failure_count" + 1 >= (SELECT "max_attempts" FROM "fanmark_access_rate_policy" WHERE "id" = 1)
                THEN new."completed_at" + 60000 ELSE COALESCE("cooldown_until", 0) END),
            "updated_at" = new."completed_at"
        WHERE "window_id" = old."window_id"
          AND (("bucket_kind" = 'requester' AND "bucket_hash" = old."requester_bucket_hash")
            OR ("bucket_kind" = 'resource' AND "bucket_hash" = old."resource_bucket_hash"));
      END;`,
  ];
  const objects = statements.map((sql) => {
    const match = sql.match(/^CREATE\s+(TABLE|INDEX|TRIGGER)\s+"([A-Za-z_][A-Za-z0-9_]*)"/iu);
    if (!match) fail("verified_access_definition_invalid");
    return { type: match[1].toLowerCase(), name: match[2], sql };
  });
  return {
    statements,
    objectInventory: {
      tables: objects.filter((object) => object.type === "table"),
      indexes: objects.filter((object) => object.type === "index"),
      triggers: objects.filter((object) => object.type === "trigger"),
    },
  };
}

function validateInputProfile({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan } = {}) {
  if (!catalog || !lifecyclePlan || !generationPlan || !credentialPlan) fail("verified_access_profile_missing");
  const credentialDescriptor = credentialPlan.descriptor;
  const converted = convertedSchema ?? convertSchema(catalog, { credentialDescriptor });
  validateLifecycleTargetPlan(lifecyclePlan);
  validateCredentialTransformPlan(credentialPlan);
  const expectedLifecycle = generateLifecycleTargetSchema({ catalog, convertedSchema: converted, credentialDescriptor });
  const expectedGeneration = generateLifecycleGenerationSchema({ catalog, convertedSchema: converted, lifecyclePlan: expectedLifecycle, credentialDescriptor });
  const expectedCredential = generateCredentialTransformSchema({
    catalog,
    convertedSchema: converted,
    lifecyclePlan: expectedLifecycle,
    generationPlan: expectedGeneration,
    descriptor: credentialPlan.descriptor,
  });
  for (const [actual, expected, fields, code] of [
    [lifecyclePlan, expectedLifecycle, ["sourceFingerprint", "extensionDigest", "sourceObjectInventory", "objectInventory"], "verified_access_lifecycle_plan_mismatch"],
    [generationPlan, expectedGeneration, ["sourceFingerprint", "extensionDigest", "lifecycleExtensionDigest", "objectInventory"], "verified_access_generation_plan_mismatch"],
    [credentialPlan, expectedCredential, ["sourceFingerprint", "targetProfileFingerprint", "extensionDigest", "descriptorDigest", "objectInventory"], "verified_access_credential_plan_mismatch"],
  ]) {
    for (const field of fields) {
      if (canonicalJson(actual[field]) !== canonicalJson(expected[field])) fail(code);
    }
  }
  return { converted, lifecyclePlan: expectedLifecycle, generationPlan: expectedGeneration, credentialPlan: expectedCredential };
}

function alteredSourceObjects(lifecyclePlan) {
  const source = lifecyclePlan.sourceObjectInventory.map((object) => ({ ...object }));
  const license = source.find((object) => object.type === "table" && object.name === "fanmark_licenses");
  if (!license) fail("verified_access_source_table_missing");
  license.sql = alteredLicenseSql(lifecyclePlan);
  return source;
}

function baselineObjects(lifecyclePlan, generationPlan, credentialPlan) {
  return [
    ...alteredSourceObjects(lifecyclePlan),
    ...lifecyclePlan.objectInventory.tables,
    ...lifecyclePlan.objectInventory.indexes,
    ...generationPlan.objectInventory.triggers,
    ...credentialPlan.objectInventory.tables,
    ...credentialPlan.objectInventory.indexes,
  ].sort(compareObjects);
}

function planDigest(plan) {
  const { extensionDigest: _extensionDigest, sql: _sql, ...payload } = plan;
  return sha256Hex(payload);
}

export function generateVerifiedAccessSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan } = {}) {
  const profile = validateInputProfile({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan });
  const definition = buildDefinition();
  const targetProfileFingerprint = sha256Hex({
    sourceFingerprint: profile.lifecyclePlan.sourceFingerprint,
    lifecycleExtensionDigest: profile.lifecyclePlan.extensionDigest,
    generationExtensionDigest: profile.generationPlan.extensionDigest,
    credentialExtensionDigest: profile.credentialPlan.extensionDigest,
    credentialTargetProfileFingerprint: profile.credentialPlan.targetProfileFingerprint,
  });
  const plan = {
    schemaVersion: VERIFIED_ACCESS_SCHEMA_VERSION,
    sourceFingerprint: profile.lifecyclePlan.sourceFingerprint,
    lifecycleExtensionDigest: profile.lifecyclePlan.extensionDigest,
    generationExtensionDigest: profile.generationPlan.extensionDigest,
    credentialExtensionDigest: profile.credentialPlan.extensionDigest,
    credentialDescriptorDigest: profile.credentialPlan.descriptorDigest,
    targetProfileFingerprint,
    statements: definition.statements,
    objectInventory: definition.objectInventory,
    seedStatements: [
      'INSERT INTO "fanmark_access_rate_policy" ("id", "window_ms", "max_attempts", "reservation_ms") VALUES (1, 300000, 5, 30000) ON CONFLICT("id") DO NOTHING;',
    ],
    extensionDigest: "",
  };
  plan.extensionDigest = planDigest(plan);
  plan.sql = `${plan.statements.join("\n\n")}\n`;
  return plan;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || plan.schemaVersion !== VERIFIED_ACCESS_SCHEMA_VERSION) fail("verified_access_plan_invalid");
  const expected = planDigest(plan);
  if (plan.extensionDigest !== expected) fail("verified_access_plan_digest_mismatch");
  if (!Array.isArray(plan.statements) || !Array.isArray(plan.seedStatements) || !plan.objectInventory) fail("verified_access_plan_invalid");
  const tables = plan.objectInventory.tables;
  const indexes = plan.objectInventory.indexes;
  const triggers = plan.objectInventory.triggers;
  if (!Array.isArray(tables) || !Array.isArray(indexes) || !Array.isArray(triggers)) fail("verified_access_plan_invalid");
  if (tables.map((object) => object.name).join("\0") !== VERIFIED_ACCESS_TABLE_NAMES.join("\0")) fail("verified_access_inventory_invalid");
  if (indexes.map((object) => object.name).join("\0") !== VERIFIED_ACCESS_INDEX_NAMES.join("\0")) fail("verified_access_inventory_invalid");
  if (triggers.map((object) => object.name).join("\0") !== VERIFIED_ACCESS_TRIGGER_NAMES.join("\0")) fail("verified_access_inventory_invalid");
  if (plan.sql !== `${plan.statements.join("\n\n")}\n`) fail("verified_access_plan_sql_mismatch");
}

function expectedPlan({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan, plan }) {
  validatePlan(plan);
  const expected = generateVerifiedAccessSchema({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan });
  for (const field of ["schemaVersion", "sourceFingerprint", "lifecycleExtensionDigest", "generationExtensionDigest", "credentialExtensionDigest", "credentialDescriptorDigest", "targetProfileFingerprint", "statements", "objectInventory", "seedStatements", "extensionDigest", "sql"]) {
    if (canonicalJson(plan[field]) !== canonicalJson(expected[field])) fail("verified_access_plan_input_mismatch");
  }
  return { expected, profile: validateInputProfile({ catalog, convertedSchema, lifecyclePlan, generationPlan, credentialPlan }) };
}

async function readObjects(database) {
  let result;
  try {
    result = await database.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name").all();
  } catch {
    fail("verified_access_schema_inspection_failed");
  }
  if (result?.success === false || !Array.isArray(result.results)) fail("verified_access_schema_inspection_failed");
  const objects = new Map();
  for (const row of result.results) {
    const type = String(row.type);
    const name = String(row.name);
    const key = objectKey(type, name);
    if (objects.has(key)) fail("verified_access_duplicate_object");
    objects.set(key, row);
  }
  return objects;
}

function assertExactObjects(actual, expected, errorPrefix, allowed = new Set()) {
  const expectedByKey = new Map(expected.map((object) => [objectKey(object.type, object.name), object]));
  for (const object of expected) {
    const row = actual.get(objectKey(object.type, object.name));
    if (!row) fail(`${errorPrefix}_missing`);
    if (String(row.type) !== object.type || normalizedSql(row.sql) !== normalizedSql(object.sql)) fail(`${errorPrefix}_mismatch`);
  }
  for (const [key] of actual) {
    const [type, name] = key.split(":");
    if (expectedByKey.has(key) || allowed.has(key) || isD1ProviderObject(type, name)) continue;
    fail(`${errorPrefix}_unexpected`);
  }
}

async function extensionState(database, plan) {
  const actual = await readObjects(database);
  const expected = [...plan.objectInventory.tables, ...plan.objectInventory.indexes, ...plan.objectInventory.triggers];
  const missing = [];
  const mismatched = [];
  for (const object of expected) {
    const row = actual.get(objectKey(object.type, object.name));
    if (!row) missing.push(`${object.type}:${object.name}`);
    else if (normalizedSql(row.sql) !== normalizedSql(object.sql)) mismatched.push(`${object.type}:${object.name}`);
  }
  if (mismatched.length) fail("verified_access_schema_object_mismatch");
  const row = await database.prepare('SELECT "window_ms", "max_attempts", "reservation_ms" FROM "fanmark_access_rate_policy" WHERE "id" = 1').first().catch(() => null);
  if (!row) missing.push("seed:fanmark_access_rate_policy");
  else if (Number(row.window_ms) !== 300000 || Number(row.max_attempts) !== 5 || Number(row.reservation_ms) !== 30000) {
    fail("verified_access_schema_policy_mismatch");
  }
  return { actual, missing, complete: missing.length === 0 };
}

export async function inspectVerifiedAccessSchema(database, plan, inputs = {}) {
  if (!database || typeof database.prepare !== "function") fail("invalid_target_database");
  const { expected, profile } = expectedPlan({ ...inputs, plan });
  const state = await extensionState(database, expected);
  if (state.complete) {
    const base = baselineObjects(profile.lifecyclePlan, profile.generationPlan, profile.credentialPlan);
    const extension = [...expected.objectInventory.tables, ...expected.objectInventory.indexes, ...expected.objectInventory.triggers];
    assertExactObjects(state.actual, [...base, ...extension].sort(compareObjects), "verified_access_schema");
  }
  return {
    ...state,
    extensionDigest: expected.extensionDigest,
    targetProfileFingerprint: expected.targetProfileFingerprint,
  };
}

export async function applyVerifiedAccessSchema({ database, plan, ...inputs } = {}) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") fail("invalid_target_database");
  const { expected, profile } = expectedPlan({ ...inputs, plan });
  const baseline = baselineObjects(profile.lifecyclePlan, profile.generationPlan, profile.credentialPlan);
  const ownObjects = [...expected.objectInventory.tables, ...expected.objectInventory.indexes, ...expected.objectInventory.triggers];
  const ownKeys = new Set(ownObjects.map((object) => objectKey(object.type, object.name)));
  const beforeObjects = await readObjects(database);
  assertExactObjects(beforeObjects, baseline, "verified_access_base_schema", ownKeys);
  const before = await extensionState(database, expected);
  if (before.complete) {
    assertExactObjects(before.actual, [...baseline, ...ownObjects].sort(compareObjects), "verified_access_schema");
    return { status: "already_applied", extensionDigest: expected.extensionDigest };
  }
  const runtimeEvidenceObject = expected.objectInventory.tables.find(
    (object) => object.name === "fanmark_password_runtime_evidence",
  );
  const previousVersionInventory = ownObjects.filter((object) => object !== runtimeEvidenceObject);
  const isVersionOneUpgrade = runtimeEvidenceObject &&
    before.missing.length === 1 && before.missing[0] === "table:fanmark_password_runtime_evidence";
  if (isVersionOneUpgrade) {
    assertExactObjects(before.actual, [...baseline, ...previousVersionInventory].sort(compareObjects), "verified_access_v1_schema");
    let result;
    try {
      result = await database.prepare(runtimeEvidenceObject.sql).run();
    } catch {
      fail("verified_access_schema_apply_failed");
    }
    if (result?.success === false) fail("verified_access_schema_apply_failed");
    const afterUpgrade = await extensionState(database, expected);
    if (!afterUpgrade.complete) fail("verified_access_schema_readback_failed");
    assertExactObjects(afterUpgrade.actual, [...baseline, ...ownObjects].sort(compareObjects), "verified_access_schema");
    return { status: "upgraded", extensionDigest: expected.extensionDigest };
  }
  const presentCount = ownObjects.length - before.missing.filter((item) => !item.startsWith("seed:")).length;
  if (presentCount > 0) fail("verified_access_schema_partial");
  let results;
  try {
    results = await database.batch(expected.statements.map((statement) => database.prepare(statement)));
    if (!Array.isArray(results) || results.some((result) => result?.success === false)) fail("verified_access_schema_apply_failed");
    const seeds = await database.batch(expected.seedStatements.map((statement) => database.prepare(statement)));
    if (!Array.isArray(seeds) || seeds.some((result) => result?.success === false)) fail("verified_access_schema_apply_failed");
  } catch (error) {
    if (error instanceof VerifiedAccessSchemaError) throw error;
    fail("verified_access_schema_apply_failed");
  }
  const after = await extensionState(database, expected);
  if (!after.complete) fail("verified_access_schema_readback_failed");
  assertExactObjects(after.actual, [...baseline, ...ownObjects].sort(compareObjects), "verified_access_schema");
  return { status: "applied", extensionDigest: expected.extensionDigest };
}

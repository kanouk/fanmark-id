#!/usr/bin/env node

/**
 * Build and apply the local target's generation-authority trigger extension.
 *
 * The lifecycle target schema is supplied by lifecycle-target-schema.mjs. This
 * module deliberately does not alter that module or connect to a remote
 * source. It adds only the reviewed license-incarnation/access-version and
 * password-config mutation triggers to an injected D1 binding.
 */

import { convertSchema } from "./schema-convert.mjs";
import {
  canonicalJson,
  sha256Hex,
} from "./snapshot-format.mjs";
import {
  generateLifecycleTargetSchema,
  validateLifecycleTargetPlan,
  LIFECYCLE_TARGET_SCHEMA_VERSION,
} from "./lifecycle-target-schema.mjs";

export const LIFECYCLE_GENERATION_SCHEMA_VERSION = 1;
export const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PASSWORD_TABLE = "fanmark_password_configs";
const PASSWORD_COLUMNS = [
  { name: "id", postgresType: "uuid", targetType: "TEXT", notNull: true },
  { name: "license_id", postgresType: "uuid", targetType: "TEXT", notNull: true },
  { name: "access_password", postgresType: "text", targetType: "TEXT", notNull: true },
  { name: "is_enabled", postgresType: "boolean", targetType: "INTEGER", notNull: true },
  { name: "created_at", postgresType: "timestamp with time zone", targetType: "TEXT", notNull: true },
  { name: "updated_at", postgresType: "timestamp with time zone", targetType: "TEXT", notNull: true },
];
const TRIGGER_NAMES = [
  "fanmark_licenses_lifecycle_pk_guard",
  "fanmark_licenses_lifecycle_insert",
  "fanmark_licenses_lifecycle_delete",
  "fanmark_password_configs_generation_insert",
  "fanmark_password_configs_generation_update_same",
  "fanmark_password_configs_generation_update_move",
  "fanmark_password_configs_generation_delete",
];
const REGISTRY = '"fanmark_license_incarnations"';
const ACCESS_VERSIONS = '"fanmark_access_versions"';
const LICENSES = '"fanmark_licenses"';
const PASSWORD_CONFIGS = '"fanmark_password_configs"';
const MAX_SAFE_SQL = String(MAX_SAFE_SQL_INTEGER);
const OBJECT_TYPE_ORDER = new Map([
  ["table", 0],
  ["index", 1],
  ["view", 2],
  ["trigger", 3],
]);

export class LifecycleGenerationSchemaError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "LifecycleGenerationSchemaError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new LifecycleGenerationSchemaError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quoteIdentifier(value) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) throw fail("unsafe_identifier");
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedSql(value) {
  const input = String(value ?? "");
  let result = "";
  let quote = null;
  let pendingSpace = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote === "'") {
      result += character;
      if (character === "'" && input[index + 1] === "'") {
        result += input[index + 1];
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (quote === '"') {
      result += character;
      if (character === '"' && input[index + 1] === '"') {
        result += input[index + 1];
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
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

function compareObjects(left, right) {
  return (OBJECT_TYPE_ORDER.get(left.type) ?? 99) - (OBJECT_TYPE_ORDER.get(right.type) ?? 99) ||
    left.name.localeCompare(right.name);
}

function objectKey(type, name) {
  return `${type}\0${name}`;
}

function constraintFor(catalog, table, kind, predicate) {
  return (catalog.constraints ?? []).find((constraint) =>
    constraint.table_name === table && constraint.kind === kind && predicate(constraint));
}

function validatePasswordConfigShape(catalog, convertedSchema) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.columns) || !Array.isArray(catalog.constraints)) {
    throw fail("invalid_catalog");
  }
  const columns = catalog.columns
    .filter((column) => column.table_name === PASSWORD_TABLE)
    .sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
  if (columns.length !== PASSWORD_COLUMNS.length) throw fail("password_config_shape_mismatch");
  for (const [index, expected] of PASSWORD_COLUMNS.entries()) {
    const actual = columns[index];
    if (
      actual.column_name !== expected.name ||
      actual.postgres_type !== expected.postgresType ||
      actual.not_null !== expected.notNull
    ) {
      throw fail("password_config_shape_mismatch", expected.name);
    }
    const codec = convertedSchema.report?.target?.columnCodecs?.find(
      (entry) => entry.table === PASSWORD_TABLE && entry.column === expected.name,
    );
    if (!codec || String(codec.targetType).toUpperCase() !== expected.targetType) {
      throw fail("password_config_codec_mismatch", expected.name);
    }
  }
  const hasPrimaryKey = Boolean(constraintFor(
    catalog,
    PASSWORD_TABLE,
    "p",
    (constraint) => /^PRIMARY\s+KEY\s*\(\s*id\s*\)$/iu.test(String(constraint.definition ?? "")),
  ));
  const hasLicenseUnique = Boolean(constraintFor(
    catalog,
    PASSWORD_TABLE,
    "u",
    (constraint) => /^UNIQUE\s*\(\s*license_id\s*\)$/iu.test(String(constraint.definition ?? "")),
  ));
  const hasCascadeForeignKey = Boolean(constraintFor(
    catalog,
    PASSWORD_TABLE,
    "f",
    (constraint) => /FOREIGN\s+KEY\s*\(\s*license_id\s*\)\s+REFERENCES\s+(?:public\.)?fanmark_licenses\s*\(\s*id\s*\).*ON\s+DELETE\s+CASCADE/iu.test(String(constraint.definition ?? "")),
  ));
  if (!hasPrimaryKey || !hasLicenseUnique || !hasCascadeForeignKey) {
    throw fail("password_config_constraint_mismatch");
  }
}

function expectedLifecyclePlan({ catalog, convertedSchema, lifecyclePlan }) {
  if (!isPlainObject(lifecyclePlan)) throw fail("invalid_lifecycle_target_plan");
  const expected = generateLifecycleTargetSchema({ catalog, convertedSchema });
  const fields = [
    "schemaVersion",
    "sourceFingerprint",
    "sourceCatalogFingerprint",
    "sourceReportFingerprint",
    "sourceSchemaSql",
    "sourceObjectInventory",
    "statements",
    "objectInventory",
    "extensionDigest",
  ];
  for (const field of fields) {
    if (canonicalJson(lifecyclePlan[field]) !== canonicalJson(expected[field])) {
      throw fail("lifecycle_target_plan_mismatch", field);
    }
  }
  if (lifecyclePlan.schemaVersion !== LIFECYCLE_TARGET_SCHEMA_VERSION) {
    throw fail("lifecycle_target_plan_mismatch", "schemaVersion");
  }
  return expected;
}

function triggerStatement(name, timing, event, body) {
  return `CREATE TRIGGER ${quoteIdentifier(name)} ${timing} ${event} BEGIN\n${body.map((line) => `  ${line}`).join("\n")}\nEND;`;
}

function accessVersionMatch(licenseExpression) {
  return `(SELECT COUNT(*) FROM ${ACCESS_VERSIONS} AS av JOIN ${REGISTRY} AS ri ON ri."license_id" = av."license_id" AND ri."incarnation" = av."license_incarnation" WHERE av."license_id" = ${licenseExpression})`;
}

function accessVersionCount(licenseExpression) {
  return `(SELECT COUNT(*) FROM ${ACCESS_VERSIONS} WHERE "license_id" = ${licenseExpression})`;
}

function licenseCount(licenseExpression) {
  return `(SELECT COUNT(*) FROM ${LICENSES} WHERE "id" = ${licenseExpression})`;
}

function passwordMutationBody(licenseExpression, { allowCascadeOrphan = false } = {}) {
  const match = accessVersionMatch(licenseExpression);
  const accessCount = accessVersionCount(licenseExpression);
  const parentCount = licenseCount(licenseExpression);
  const lines = [];
  if (allowCascadeOrphan) {
    lines.push(
      `SELECT CASE WHEN ${parentCount} = 0 AND ${accessCount} = 0 THEN NULL WHEN ${parentCount} = 0 OR ${match} <> 1 THEN RAISE(ABORT, 'lifecycle_password_access_version_missing') END;`,
    );
  } else {
    lines.push(
      `SELECT CASE WHEN ${parentCount} <> 1 OR ${match} <> 1 THEN RAISE(ABORT, 'lifecycle_password_access_version_missing') END;`,
    );
  }
  lines.push(
    `SELECT CASE WHEN ${parentCount} = 0 AND ${accessCount} = 0 THEN NULL WHEN (SELECT "password_generation" FROM ${ACCESS_VERSIONS} WHERE "license_id" = ${licenseExpression}) >= ${MAX_SAFE_SQL} THEN RAISE(ABORT, 'lifecycle_password_generation_overflow') WHEN (SELECT "access_generation" FROM ${ACCESS_VERSIONS} WHERE "license_id" = ${licenseExpression}) >= ${MAX_SAFE_SQL} THEN RAISE(ABORT, 'lifecycle_access_generation_overflow') END;`,
  );
  lines.push(
    `UPDATE ${ACCESS_VERSIONS} SET "password_generation" = "password_generation" + 1, "access_generation" = "access_generation" + 1, "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "license_id" = ${licenseExpression};`,
  );
  lines.push(
    `SELECT CASE WHEN ${parentCount} = 0 AND ${accessCount} = 0 THEN NULL WHEN changes() <> 1 THEN RAISE(ABORT, 'lifecycle_password_access_version_missing') END;`,
  );
  return lines;
}

function buildTriggerDefinition() {
  const statements = [];
  statements.push(triggerStatement(
    "fanmark_licenses_lifecycle_pk_guard",
    "BEFORE",
    `UPDATE OF ${quoteIdentifier("id")} ON ${LICENSES} WHEN NEW.${quoteIdentifier("id")} IS NOT OLD.${quoteIdentifier("id")}`,
    ["SELECT RAISE(ABORT, 'lifecycle_license_id_immutable');"],
  ));
  statements.push(triggerStatement(
    "fanmark_licenses_lifecycle_insert",
    "AFTER",
    `INSERT ON ${LICENSES}`,
    [
      `INSERT OR IGNORE INTO ${REGISTRY} ("license_id", "incarnation") VALUES (NEW.${quoteIdentifier("id")}, 0);`,
      `SELECT CASE WHEN (SELECT COUNT(*) FROM ${REGISTRY} WHERE "license_id" = NEW.${quoteIdentifier("id")}) <> 1 THEN RAISE(ABORT, 'lifecycle_incarnation_missing') END;`,
      `SELECT CASE WHEN (SELECT "incarnation" FROM ${REGISTRY} WHERE "license_id" = NEW.${quoteIdentifier("id")}) > ${MAX_SAFE_SQL} THEN RAISE(ABORT, 'lifecycle_incarnation_overflow') END;`,
      `INSERT OR IGNORE INTO ${ACCESS_VERSIONS} ("license_id", "license_incarnation", "password_generation", "access_generation", "updated_at") SELECT NEW.${quoteIdentifier("id")}, "incarnation", 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM ${REGISTRY} WHERE "license_id" = NEW.${quoteIdentifier("id")};`,
      `SELECT CASE WHEN ${accessVersionCount(`NEW.${quoteIdentifier("id")}`)} <> 1 THEN RAISE(ABORT, 'lifecycle_access_version_missing') WHEN ${accessVersionMatch(`NEW.${quoteIdentifier("id")}`)} <> 1 THEN RAISE(ABORT, 'lifecycle_access_version_mismatch') END;`,
    ],
  ));
  statements.push(triggerStatement(
    "fanmark_licenses_lifecycle_delete",
    "BEFORE",
    `DELETE ON ${LICENSES}`,
    [
      `SELECT CASE WHEN (SELECT COUNT(*) FROM ${REGISTRY} WHERE "license_id" = OLD.${quoteIdentifier("id")}) <> 1 THEN RAISE(ABORT, 'lifecycle_incarnation_missing') WHEN (SELECT "incarnation" FROM ${REGISTRY} WHERE "license_id" = OLD.${quoteIdentifier("id")}) >= ${MAX_SAFE_SQL} THEN RAISE(ABORT, 'lifecycle_incarnation_overflow') END;`,
      `SELECT CASE WHEN ${accessVersionCount(`OLD.${quoteIdentifier("id")}`)} <> 1 THEN RAISE(ABORT, 'lifecycle_access_version_missing') END;`,
      `SELECT CASE WHEN ${accessVersionMatch(`OLD.${quoteIdentifier("id")}`)} <> 1 THEN RAISE(ABORT, 'lifecycle_access_version_mismatch') END;`,
      `DELETE FROM ${ACCESS_VERSIONS} WHERE "license_id" = OLD.${quoteIdentifier("id")};`,
      `SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'lifecycle_access_version_missing') END;`,
      `UPDATE ${REGISTRY} SET "incarnation" = "incarnation" + 1 WHERE "license_id" = OLD.${quoteIdentifier("id")};`,
      `SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'lifecycle_incarnation_missing') END;`,
    ],
  ));
  statements.push(triggerStatement(
    "fanmark_password_configs_generation_insert",
    "AFTER",
    `INSERT ON ${PASSWORD_CONFIGS}`,
    passwordMutationBody(`NEW.${quoteIdentifier("license_id")}`),
  ));
  statements.push(triggerStatement(
    "fanmark_password_configs_generation_update_same",
    "AFTER",
    `UPDATE ON ${PASSWORD_CONFIGS} WHEN NEW.${quoteIdentifier("license_id")} IS OLD.${quoteIdentifier("license_id")}`,
    passwordMutationBody(`NEW.${quoteIdentifier("license_id")}`),
  ));
  statements.push(triggerStatement(
    "fanmark_password_configs_generation_update_move",
    "AFTER",
    `UPDATE ON ${PASSWORD_CONFIGS} WHEN NEW.${quoteIdentifier("license_id")} IS NOT OLD.${quoteIdentifier("license_id")}`,
    [
      ...passwordMutationBody(`OLD.${quoteIdentifier("license_id")}`),
      ...passwordMutationBody(`NEW.${quoteIdentifier("license_id")}`),
    ],
  ));
  statements.push(triggerStatement(
    "fanmark_password_configs_generation_delete",
    "AFTER",
    `DELETE ON ${PASSWORD_CONFIGS}`,
    passwordMutationBody(`OLD.${quoteIdentifier("license_id")}`, { allowCascadeOrphan: true }),
  ));
  return {
    statements,
    triggers: statements.map((sql, index) => ({
      type: "trigger",
      name: TRIGGER_NAMES[index],
      sql,
    })),
  };
}

function alteredSourceTableSql(sourceObjects, tableName, addedColumns) {
  const source = sourceObjects.find((object) => object.type === "table" && object.name === tableName);
  if (!source) throw fail("source_table_missing_from_sql", tableName);
  const close = source.sql.lastIndexOf(")");
  if (close < 0) throw fail("invalid_source_table_sql", tableName);
  const additions = addedColumns.map((column) => {
    const marker = " ADD COLUMN ";
    const start = column.sql.indexOf(marker);
    if (start < 0) throw fail("invalid_lifecycle_column_sql", column.name);
    return column.sql.slice(start + marker.length, -1).trim();
  });
  const before = source.sql.slice(0, close).trimEnd();
  let quote = null;
  let depth = 0;
  let constraintComma = -1;
  for (let index = 0; index < before.length; index += 1) {
    const character = before[index];
    const next = before[index + 1];
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

function baselineObjects(lifecyclePlan) {
  const source = lifecyclePlan.sourceObjectInventory.map((object) => ({ ...object }));
  const license = source.find((object) => object.type === "table" && object.name === "fanmark_licenses");
  if (!license) throw fail("source_table_missing_from_sql", "fanmark_licenses");
  license.sql = alteredSourceTableSql(
    lifecyclePlan.sourceObjectInventory,
    "fanmark_licenses",
    lifecyclePlan.objectInventory.columns.map((column) => ({
      ...column,
      sql: `ALTER TABLE "fanmark_licenses" ADD COLUMN ${quoteIdentifier(column.name)} ${column.type}${column.notNull ? " NOT NULL" : ""}${column.defaultValue === null ? "" : ` DEFAULT ${column.defaultValue}`}${column.check ? ` CHECK (${column.check})` : ""};`,
    })),
  );
  const tables = lifecyclePlan.objectInventory.tables.map((object) => ({ type: "table", ...object }));
  const indexes = lifecyclePlan.objectInventory.indexes.map((object) => ({ type: "index", ...object }));
  return [...source, ...tables, ...indexes].sort(compareObjects);
}

function validateGenerationPlan(plan) {
  if (!isPlainObject(plan) || plan.schemaVersion !== LIFECYCLE_GENERATION_SCHEMA_VERSION) {
    throw fail("invalid_lifecycle_generation_plan");
  }
  if (
    !Array.isArray(plan.statements) ||
    !Array.isArray(plan.objectInventory?.triggers) ||
    typeof plan.extensionDigest !== "string" ||
    typeof plan.lifecycleExtensionDigest !== "string" ||
    typeof plan.sourceFingerprint !== "string"
  ) {
    throw fail("invalid_lifecycle_generation_plan");
  }
  const expected = sha256Hex({
    schemaVersion: plan.schemaVersion,
    lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
    sourceFingerprint: plan.sourceFingerprint,
    objectInventory: plan.objectInventory,
    statements: plan.statements,
  });
  if (!/^[0-9a-f]{64}$/u.test(plan.extensionDigest) || expected !== plan.extensionDigest) {
    throw fail("lifecycle_generation_plan_digest_mismatch");
  }
  if (plan.objectInventory.triggers.length !== TRIGGER_NAMES.length) {
    throw fail("invalid_lifecycle_generation_plan");
  }
  for (const [index, trigger] of plan.objectInventory.triggers.entries()) {
    if (trigger.type !== "trigger" || trigger.name !== TRIGGER_NAMES[index] || trigger.sql !== plan.statements[index]) {
      throw fail("invalid_lifecycle_generation_plan");
    }
  }
}

export function generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan } = {}) {
  const converted = convertedSchema ?? convertSchema(catalog);
  const expectedLifecycle = expectedLifecyclePlan({ catalog, convertedSchema: converted, lifecyclePlan });
  validatePasswordConfigShape(catalog, converted);
  const definition = buildTriggerDefinition();
  const objectInventory = { triggers: definition.triggers };
  const plan = {
    schemaVersion: LIFECYCLE_GENERATION_SCHEMA_VERSION,
    lifecycleSchemaVersion: expectedLifecycle.schemaVersion,
    lifecycleExtensionDigest: expectedLifecycle.extensionDigest,
    sourceFingerprint: expectedLifecycle.sourceFingerprint,
    sourceObjectInventory: expectedLifecycle.sourceObjectInventory,
    statements: definition.statements,
    objectInventory,
    extensionDigest: "",
  };
  plan.extensionDigest = sha256Hex({
    schemaVersion: plan.schemaVersion,
    lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
    sourceFingerprint: plan.sourceFingerprint,
    objectInventory: plan.objectInventory,
    statements: plan.statements,
  });
  validateGenerationPlan(plan);
  return {
    ...plan,
    sql: `${plan.statements.join("\n\n")}\n`,
  };
}

export const buildLifecycleGenerationSchema = generateLifecycleGenerationSchema;

async function queryAll(database, sql) {
  let result;
  try {
    result = await database.prepare(sql).all();
  } catch (error) {
    throw fail("lifecycle_generation_inspection_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("lifecycle_generation_inspection_failed");
  }
  return result.results;
}

async function readMasterObjects(database) {
  const rows = await queryAll(
    database,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
  );
  const objects = new Map();
  for (const row of rows) {
    const key = objectKey(String(row.type), String(row.name));
    if (objects.has(key)) throw fail("lifecycle_generation_duplicate_object", key);
    objects.set(key, row);
  }
  return objects;
}

const ALLOWED_PROVIDER_OBJECT = objectKey("table", "_cf_METADATA");

async function assertExactInventory(database, expectedObjects, code, allowedKeys = new Set()) {
  const actual = await readMasterObjects(database);
  const expected = new Map(expectedObjects.map((object) => [objectKey(object.type, object.name), object]));
  for (const object of expectedObjects) {
    const actualObject = actual.get(objectKey(object.type, object.name));
    if (!actualObject) throw fail(`${code}_missing`, object.name);
    if (normalizedSql(actualObject.sql) !== normalizedSql(object.sql)) {
      throw fail(`${code}_mismatch`, object.name);
    }
  }
  for (const [key, actualObject] of actual) {
    if (expected.has(key) || allowedKeys.has(key)) continue;
    if (key === ALLOWED_PROVIDER_OBJECT) continue;
    throw fail(`${code}_unexpected`, `${actualObject.type}:${actualObject.name}`);
  }
}

async function triggerState(database, plan) {
  const actual = await readMasterObjects(database);
  const missing = [];
  const mismatched = [];
  let present = 0;
  for (const expected of plan.objectInventory.triggers) {
    const key = objectKey(expected.type, expected.name);
    const row = actual.get(key);
    if (!row) {
      missing.push(expected.name);
      continue;
    }
    present += 1;
    if (normalizedSql(row.sql) !== normalizedSql(expected.sql)) mismatched.push(expected.name);
  }
  return {
    complete: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    present,
  };
}

async function validatePlanForApply({ database, plan, catalog, convertedSchema, lifecyclePlan }) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw fail("invalid_target_database");
  }
  validateGenerationPlan(plan);
  const expected = generateLifecycleGenerationSchema({ catalog, convertedSchema, lifecyclePlan });
  const fields = [
    "schemaVersion",
    "lifecycleSchemaVersion",
    "lifecycleExtensionDigest",
    "sourceFingerprint",
    "sourceObjectInventory",
    "statements",
    "objectInventory",
    "extensionDigest",
  ];
  for (const field of fields) {
    if (canonicalJson(plan[field]) !== canonicalJson(expected[field])) {
      throw fail("lifecycle_generation_plan_mismatch", field);
    }
  }
  return expected;
}

export async function inspectLifecycleGenerationSchema(database, plan, lifecyclePlan) {
  validateGenerationPlan(plan);
  validateLifecycleTargetPlan(lifecyclePlan);
  if (plan.sourceFingerprint !== lifecyclePlan.sourceFingerprint ||
      plan.lifecycleExtensionDigest !== lifecyclePlan.extensionDigest ||
      canonicalJson(plan.sourceObjectInventory) !== canonicalJson(lifecyclePlan.sourceObjectInventory)) {
    throw fail("lifecycle_generation_plan_mismatch");
  }
  const base = baselineObjects(lifecyclePlan);
  const trigger = await triggerState(database, plan);
  if (trigger.complete) await assertExactInventory(database, [...base, ...plan.objectInventory.triggers].sort(compareObjects), "lifecycle_generation_schema");
  return {
    ...trigger,
    extensionDigest: plan.extensionDigest,
    lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
  };
}

export async function applyLifecycleGenerationSchema({ database, plan, catalog, convertedSchema, lifecyclePlan } = {}) {
  const expected = await validatePlanForApply({ database, plan, catalog, convertedSchema, lifecyclePlan });
  const base = baselineObjects(lifecyclePlan);
  const triggerKeys = new Set(plan.objectInventory.triggers.map((object) => objectKey(object.type, object.name)));
  await assertExactInventory(database, base, "lifecycle_generation_base_schema", triggerKeys);
  const before = await triggerState(database, plan);
  if (before.mismatched.length > 0) throw fail("lifecycle_generation_schema_existing_object_mismatch", before.mismatched.join(","));
  if (before.present > 0 && !before.complete) throw fail("lifecycle_generation_schema_partial");
  const all = [...base, ...plan.objectInventory.triggers].sort(compareObjects);
  if (before.complete) {
    await assertExactInventory(database, all, "lifecycle_generation_schema");
    return {
      status: "already_applied",
      extensionDigest: plan.extensionDigest,
      lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
    };
  }
  let results;
  try {
    results = await database.batch(plan.statements.map((statement) => database.prepare(statement)));
  } catch (error) {
    throw fail("lifecycle_generation_schema_apply_failed", error);
  }
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) {
    throw fail("lifecycle_generation_schema_apply_failed");
  }
  await assertExactInventory(database, all, "lifecycle_generation_schema");
  return {
    status: "applied",
    extensionDigest: plan.extensionDigest,
    lifecycleExtensionDigest: plan.lifecycleExtensionDigest,
  };
}

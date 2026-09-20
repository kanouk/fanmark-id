#!/usr/bin/env node

/**
 * Build and apply the reviewed target-only lifecycle schema extension.
 *
 * This module accepts the already converted source catalog, but never applies
 * source schema SQL or connects to a remote database. The only write entry
 * point accepts an explicitly injected D1-compatible binding. Extension DDL
 * has no IF NOT EXISTS clauses: a complete exact extension is a no-op, while
 * a partial or changed extension fails closed before any statement is run.
 */

import { convertSchema } from "./schema-convert.mjs";
import {
  canonicalJson,
  catalogFingerprint,
  schemaReportFingerprint,
  sha256Hex,
} from "./snapshot-format.mjs";

export const LIFECYCLE_TARGET_SCHEMA_VERSION = 1;
export const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_TABLES = [
  "fanmark_licenses",
  "fanmarks",
  "audit_logs",
  "notification_events",
];

const REQUIRED_SOURCE_COLUMNS = {
  fanmark_licenses: {
    id: { postgresType: "uuid", notNull: true, primaryKey: true },
    fanmark_id: { postgresType: "uuid", notNull: true },
    user_id: { postgresType: "uuid", notNull: false },
    status: { postgresType: "text", notNull: true },
    license_end: { postgresType: "timestamp with time zone", notNull: false },
    grace_expires_at: { postgresType: "timestamp with time zone", notNull: false },
    is_returned: { postgresType: "boolean", notNull: true },
  },
  fanmarks: {
    id: { postgresType: "uuid", notNull: true, primaryKey: true },
    short_id: { postgresType: "text", notNull: true },
  },
  audit_logs: {
    id: { postgresType: "uuid", notNull: true, primaryKey: true },
    user_id: { postgresType: "uuid", notNull: false },
    action: { postgresType: "text", notNull: true },
    resource_type: { postgresType: "text", notNull: true },
    resource_id: { postgresType: "text", notNull: false },
    request_id: { postgresType: "text", notNull: false },
    metadata: { postgresType: "jsonb", notNull: false },
    created_at: { postgresType: "timestamp with time zone", notNull: true },
  },
  notification_events: {
    id: { postgresType: "uuid", notNull: true, primaryKey: true },
    event_type: { postgresType: "text", notNull: true },
    event_version: { postgresType: "integer", notNull: true },
    source: { postgresType: "text", notNull: true },
    payload: { postgresType: "jsonb", notNull: true },
    payload_schema: { postgresType: "text", notNull: false },
    trigger_at: { postgresType: "timestamp with time zone", notNull: true },
    dedupe_key: { postgresType: "text", notNull: false },
    status: { postgresType: "text", notNull: true },
    retry_count: { postgresType: "integer", notNull: true },
    created_at: { postgresType: "timestamp with time zone", notNull: true },
    updated_at: { postgresType: "timestamp with time zone", notNull: true },
  },
};

const EXTENSION_TABLE_NAMES = [
  "fanmark_license_incarnations",
  "fanmark_access_versions",
  "license_expiry_runs",
  "license_expiry_run_items",
  "license_expiry_effect_guards",
];

const EXTENSION_INDEX_NAMES = [
  "fanmark_licenses_lifecycle_scan",
  "fanmark_licenses_lifecycle_claim",
  "fanmark_license_incarnations_scan",
  "license_expiry_run_items_cursor",
];

const ALTERED_LICENSE_COLUMNS = ["lifecycle_generation", "lifecycle_claim_id"];

export class LifecycleTargetSchemaError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "LifecycleTargetSchemaError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new LifecycleTargetSchemaError(code, cause);
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
  // SQLite omits the terminal statement delimiter from sqlite_master.sql,
  // while the generated DDL keeps it for executable statements. Treat that
  // delimiter as transport syntax; all quoted/literal bytes remain intact.
  return result.trim().replace(/;+$/u, "");
}

function requiredCatalogColumn(catalog, table, column) {
  return catalog.columns.find((entry) => entry.table_name === table && entry.column_name === column) ?? null;
}

function expectedTargetType(convertedSchema, table, column) {
  const codec = convertedSchema.report?.target?.columnCodecs?.find(
    (entry) => entry.table === table && entry.column === column,
  );
  if (!codec || typeof codec.targetType !== "string") throw fail("missing_source_codec", `${table}.${column}`);
  return codec.targetType.toUpperCase();
}

function validateRequiredCatalogShape(catalog, convertedSchema) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.columns)) throw fail("invalid_catalog");
  if (!isPlainObject(convertedSchema) || typeof convertedSchema.sql !== "string" || !isPlainObject(convertedSchema.report)) {
    throw fail("invalid_converted_schema");
  }
  for (const table of SOURCE_TABLES) {
    for (const [column, expected] of Object.entries(REQUIRED_SOURCE_COLUMNS[table])) {
      const actual = requiredCatalogColumn(catalog, table, column);
      if (!actual) throw fail("source_catalog_shape_mismatch", `${table}.${column}`);
      if (actual.postgres_type !== expected.postgresType || actual.not_null !== expected.notNull) {
        throw fail("source_catalog_shape_mismatch", `${table}.${column}`);
      }
      if (expected.primaryKey) {
        const hasPrimaryKey = catalog.constraints?.some(
          (constraint) => constraint.table_name === table && constraint.kind === "p" &&
            /^PRIMARY\s+KEY\s*\(\s*id\s*\)$/iu.test(constraint.definition),
        );
        if (!hasPrimaryKey) throw fail("source_catalog_primary_key_mismatch", table);
      }
      expectedTargetType(convertedSchema, table, column);
    }
  }
}

function extensionColumnCheck(name, { minimum = 0, maximum = MAX_SAFE_SQL_INTEGER } = {}) {
  const quoted = quoteIdentifier(name);
  return `typeof(${quoted}) = 'integer' AND ${quoted} BETWEEN ${minimum} AND ${maximum}`;
}

function createTableStatement(name, body) {
  return `CREATE TABLE ${quoteIdentifier(name)} (\n${body.map((line) => `  ${line}`).join(",\n")}\n);`;
}

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  let lineComment = false;
  for (let index = 0; index < String(sql).length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (!quote && character === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
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

function parseCreateObject(statement) {
  const table = statement.match(/^CREATE\s+TABLE\s+"([A-Za-z_][A-Za-z0-9_]*)"\s*/u);
  if (table) return { type: "table", name: table[1], sql: statement };
  const index = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+"([A-Za-z_][A-Za-z0-9_]*)"\s+/u);
  if (index) return { type: "index", name: index[2], sql: statement };
  return null;
}

const OBJECT_TYPE_ORDER = new Map([
  ["table", 0],
  ["index", 1],
  ["view", 2],
  ["trigger", 3],
]);

function compareObjects(left, right) {
  return (OBJECT_TYPE_ORDER.get(left.type) ?? 99) - (OBJECT_TYPE_ORDER.get(right.type) ?? 99) ||
    left.name.localeCompare(right.name);
}

function sourceObjectInventory(sourceSql) {
  const objects = splitSqlStatements(sourceSql)
    .map(parseCreateObject)
    .filter(Boolean)
    .sort(compareObjects)
    .map((entry) => ({ ...entry }));
  if (objects.length === 0) throw fail("source_schema_has_no_objects");
  const names = new Set();
  for (const object of objects) {
    if (names.has(object.name)) throw fail("duplicate_source_object", object.name);
    names.add(object.name);
  }
  return objects;
}

function alteredSourceTableSql(sourceObjects, tableName, addedColumns) {
  const source = sourceObjects.find((object) => object.type === "table" && object.name === tableName);
  if (!source) throw fail("source_table_missing_from_sql", tableName);
  const close = source.sql.lastIndexOf(")");
  if (close < 0) throw fail("invalid_source_table_sql", tableName);
  const additions = addedColumns.map((column) => column.sql.slice(column.sql.indexOf(" ADD COLUMN ") + " ADD COLUMN ".length, -1).trim());
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
    if (character !== "," || depth !== 1) continue;
    const suffix = before.slice(index + 1);
    if (/^\s*(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)\b/iu.test(suffix)) {
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

function buildExtensionDefinition() {
  const safe = MAX_SAFE_SQL_INTEGER;
  const statements = [];
  const addedColumns = [
    {
      table: "fanmark_licenses",
      name: "lifecycle_generation",
      sql: `ALTER TABLE "fanmark_licenses" ADD COLUMN "lifecycle_generation" INTEGER NOT NULL DEFAULT 0 CHECK (${extensionColumnCheck("lifecycle_generation")});`,
      type: "INTEGER",
      notNull: 1,
      defaultValue: "0",
      check: extensionColumnCheck("lifecycle_generation"),
    },
    {
      table: "fanmark_licenses",
      name: "lifecycle_claim_id",
      sql: "ALTER TABLE \"fanmark_licenses\" ADD COLUMN \"lifecycle_claim_id\" TEXT;",
      type: "TEXT",
      notNull: 0,
      defaultValue: null,
      check: null,
    },
  ];
  statements.push(...addedColumns.map((entry) => entry.sql));

  const tables = [
    {
      name: "fanmark_license_incarnations",
      lines: [
        '"license_id" TEXT PRIMARY KEY NOT NULL',
        `"incarnation" INTEGER NOT NULL DEFAULT 0 CHECK (${extensionColumnCheck("incarnation")})`,
      ],
    },
    {
      name: "fanmark_access_versions",
      lines: [
        '"license_id" TEXT PRIMARY KEY NOT NULL REFERENCES "fanmark_licenses"("id")',
        `"license_incarnation" INTEGER NOT NULL CHECK (${extensionColumnCheck("license_incarnation")})`,
        `"password_generation" INTEGER NOT NULL DEFAULT 0 CHECK (${extensionColumnCheck("password_generation")})`,
        `"access_generation" INTEGER NOT NULL DEFAULT 0 CHECK (${extensionColumnCheck("access_generation")})`,
        '"updated_at" TEXT NOT NULL',
      ],
    },
    {
      name: "license_expiry_runs",
      lines: [
        '"run_id" TEXT PRIMARY KEY NOT NULL',
        '"target_incarnation" TEXT NOT NULL',
        '"schema_extension_digest" TEXT NOT NULL',
        '"captured_now" TEXT NOT NULL',
        `"grace_period_days" INTEGER NOT NULL CHECK (typeof("grace_period_days") = 'integer' AND "grace_period_days" BETWEEN 1 AND ${safe})`,
        '"status" TEXT NOT NULL CHECK ("status" IN (\'running\', \'completed\'))',
        '"last_license_id" TEXT NOT NULL DEFAULT \'\'',
        `"candidate_count" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("candidate_count") = 'integer' AND "candidate_count" BETWEEN 0 AND ${safe})`,
        `"processed_count" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("processed_count") = 'integer' AND "processed_count" BETWEEN 0 AND ${safe})`,
        `"conflict_count" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("conflict_count") = 'integer' AND "conflict_count" BETWEEN 0 AND ${safe})`,
        '"completed_at" TEXT',
      ],
    },
    {
      name: "license_expiry_run_items",
      lines: [
        '"run_id" TEXT NOT NULL REFERENCES "license_expiry_runs"("run_id")',
        '"license_id" TEXT NOT NULL REFERENCES "fanmark_licenses"("id")',
        '"fanmark_id" TEXT NOT NULL REFERENCES "fanmarks"("id")',
        '"user_id" TEXT',
        '"license_end" TEXT NOT NULL',
        `"license_incarnation" INTEGER NOT NULL CHECK (${extensionColumnCheck("license_incarnation")})`,
        `"license_lifecycle_generation" INTEGER NOT NULL CHECK (${extensionColumnCheck("license_lifecycle_generation")})`,
        `"access_generation" INTEGER NOT NULL CHECK (${extensionColumnCheck("access_generation")})`,
        '"operation_id" TEXT NOT NULL',
        '"audit_id" TEXT NOT NULL',
        '"notification_event_id" TEXT NOT NULL',
        '"outcome" TEXT NOT NULL DEFAULT \'pending\' CHECK ("outcome" IN (\'pending\', \'processed\', \'conflict\'))',
        '"grace_expires_at" TEXT NOT NULL',
        '"completed_at" TEXT',
        'PRIMARY KEY ("run_id", "license_id")',
        'UNIQUE ("run_id", "operation_id")',
        'UNIQUE ("run_id", "audit_id")',
        'UNIQUE ("run_id", "notification_event_id")',
      ],
    },
    {
      name: "license_expiry_effect_guards",
      lines: [
        '"operation_id" TEXT PRIMARY KEY NOT NULL',
        `"allowed" INTEGER NOT NULL CHECK (typeof("allowed") = 'integer' AND "allowed" = 1)`,
      ],
    },
  ];
  const tableSql = tables.map((table) => createTableStatement(table.name, table.lines));
  statements.push(...tableSql);

  const indexes = [
    {
      name: "fanmark_licenses_lifecycle_scan",
      table: "fanmark_licenses",
      columns: ["status", "license_end", "lifecycle_generation"],
    },
    {
      name: "fanmark_licenses_lifecycle_claim",
      table: "fanmark_licenses",
      columns: ["lifecycle_claim_id"],
    },
    {
      name: "fanmark_license_incarnations_scan",
      table: "fanmark_license_incarnations",
      columns: ["license_id", "incarnation"],
    },
    {
      name: "license_expiry_run_items_cursor",
      table: "license_expiry_run_items",
      columns: ["run_id", "license_id"],
    },
  ].map((index) => ({
    ...index,
    sql: `CREATE INDEX ${quoteIdentifier(index.name)} ON ${quoteIdentifier(index.table)} (${index.columns.map(quoteIdentifier).join(", ")});`,
  }));
  statements.push(...indexes.map((index) => index.sql));

  return {
    statements,
    addedColumns,
    tables: tables.map((table, index) => ({ name: table.name, sql: tableSql[index] })),
    indexes,
  };
}

function buildObjectInventory(definition) {
  return {
    columns: definition.addedColumns.map(({ table, name, type, notNull, defaultValue, check }) => ({
      table,
      name,
      type,
      notNull,
      defaultValue,
      check,
    })),
    tables: definition.tables.map((table) => ({ type: "table", ...table })),
    indexes: definition.indexes.map((index) => ({ type: "index", ...index })),
  };
}

function expectedPlanDigest(plan) {
  return sha256Hex({
    schemaVersion: plan.schemaVersion,
    objectInventory: plan.objectInventory,
    statements: plan.statements,
  });
}

export function validateLifecycleTargetPlan(plan) {
  if (!isPlainObject(plan) || plan.schemaVersion !== LIFECYCLE_TARGET_SCHEMA_VERSION) {
    throw fail("invalid_lifecycle_schema_plan");
  }
  if (!Array.isArray(plan.statements) || !isPlainObject(plan.objectInventory) || typeof plan.extensionDigest !== "string") {
    throw fail("invalid_lifecycle_schema_plan");
  }
  if (!Array.isArray(plan.sourceObjectInventory) || typeof plan.sourceSchemaSql !== "string") {
    throw fail("invalid_lifecycle_schema_plan");
  }
  if (!/^[0-9a-f]{64}$/u.test(plan.extensionDigest) || expectedPlanDigest(plan) !== plan.extensionDigest) {
    throw fail("lifecycle_schema_plan_digest_mismatch");
  }
  for (const key of ["sourceFingerprint", "sourceCatalogFingerprint", "sourceReportFingerprint"]) {
    if (typeof plan[key] !== "string" || !/^[0-9a-f]{64}$/u.test(plan[key])) {
      throw fail("lifecycle_schema_plan_source_mismatch");
    }
  }
  const sourceFingerprint = sha256Hex({
    catalogFingerprint: plan.sourceCatalogFingerprint,
    sourceReportFingerprint: plan.sourceReportFingerprint,
    sourceSql: plan.sourceSchemaSql,
  });
  if (sourceFingerprint !== plan.sourceFingerprint ||
      canonicalJson(sourceObjectInventory(plan.sourceSchemaSql)) !== canonicalJson(plan.sourceObjectInventory)) {
    throw fail("lifecycle_schema_plan_source_mismatch");
  }
}

const validatePlan = validateLifecycleTargetPlan;

export function generateLifecycleTargetSchema({ catalog, convertedSchema } = {}) {
  const converted = convertedSchema ?? convertSchema(catalog);
  const expectedConverted = convertSchema(catalog);
  if (canonicalJson(converted) !== canonicalJson(expectedConverted)) {
    throw fail("converted_schema_mismatch");
  }
  validateRequiredCatalogShape(catalog, converted);
  const definition = buildExtensionDefinition();
  const objectInventory = buildObjectInventory(definition);
  const sourceObjects = sourceObjectInventory(converted.sql);
  const sourceCatalogFingerprint = catalogFingerprint(catalog);
  const sourceReportFingerprint = schemaReportFingerprint(converted.report);
  const sourceFingerprint = sha256Hex({
    catalogFingerprint: sourceCatalogFingerprint,
    sourceReportFingerprint,
    sourceSql: converted.sql,
  });
  const plan = {
    schemaVersion: LIFECYCLE_TARGET_SCHEMA_VERSION,
    sourceFingerprint,
    sourceCatalogFingerprint,
    sourceReportFingerprint,
    source: converted.report.source,
    sourceSchemaSql: converted.sql,
    sourceObjectInventory: sourceObjects,
    statements: definition.statements,
    objectInventory,
    extensionDigest: "",
  };
  plan.extensionDigest = expectedPlanDigest(plan);
  return {
    ...plan,
    sql: `${plan.statements.join("\n\n")}\n`,
  };
}

export const buildLifecycleTargetSchema = generateLifecycleTargetSchema;

async function queryAll(database, sql, bindings = []) {
  let result;
  try {
    result = await database.prepare(sql).bind(...bindings).all();
  } catch (error) {
    throw fail("target_schema_inspection_failed", error);
  }
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw fail("target_schema_inspection_failed");
  }
  return result.results;
}

async function readMasterObjects(database) {
  const rows = await queryAll(
    database,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') AND substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
  );
  return new Map(rows.map((row) => [String(row.name), row]));
}

async function readTableInfo(database, table) {
  return queryAll(database, `PRAGMA table_info(${quoteIdentifier(table)})`);
}

function findSourceColumn(catalog, table, name) {
  return catalog.columns.find((column) => column.table_name === table && column.column_name === name) ?? null;
}

function convertedCodec(convertedSchema, table, name) {
  return convertedSchema.report.target.columnCodecs.find((entry) => entry.table === table && entry.column === name) ?? null;
}

async function assertSourceShape(database, plan, catalog, convertedSchema) {
  for (const table of SOURCE_TABLES) {
    const rows = await readTableInfo(database, table);
    if (rows.length === 0) throw fail("target_source_table_missing", table);
    const byName = new Map(rows.map((row) => [String(row.name), row]));
    for (const [name, expected] of Object.entries(REQUIRED_SOURCE_COLUMNS[table])) {
      const sourceColumn = findSourceColumn(catalog, table, name);
      const codec = convertedCodec(convertedSchema, table, name);
      const actual = byName.get(name);
      if (!sourceColumn || !codec || !actual) throw fail("target_source_shape_mismatch", `${table}.${name}`);
      if (
        String(actual.type).toUpperCase() !== String(codec.targetType).toUpperCase() ||
        Number(actual.notnull) !== (expected.notNull ? 1 : 0)
      ) {
        throw fail("target_source_shape_mismatch", `${table}.${name}`);
      }
      if (expected.primaryKey && Number(actual.pk) !== 1) {
        throw fail("target_source_primary_key_mismatch", table);
      }
    }
  }
  // Source columns are intentionally allowed to be more numerous than the
  // minimum contract. The extension must preserve those columns verbatim.
  void plan;
}

const ALLOWED_PROVIDER_OBJECTS = new Set(["_cf_METADATA"]);

function expectedSourceObjects(plan, includeExtensionColumns = false) {
  const objects = plan.sourceObjectInventory.map((object) => ({ ...object }));
  if (includeExtensionColumns) {
    const license = objects.find((object) => object.type === "table" && object.name === "fanmark_licenses");
    if (!license) throw fail("source_table_missing_from_sql", "fanmark_licenses");
    const additions = plan.objectInventory.columns;
    license.sql = alteredSourceTableSql(
      plan.sourceObjectInventory,
      "fanmark_licenses",
      additions.map((column) => ({
        sql: `ALTER TABLE "fanmark_licenses" ADD COLUMN ${quoteIdentifier(column.name)} ${column.type}${column.notNull ? " NOT NULL" : ""}${column.defaultValue === null ? "" : ` DEFAULT ${column.defaultValue}`}${column.check ? ` CHECK (${column.check})` : ""};`,
      })),
    );
  }
  return objects;
}

function expectedTargetObjects(plan) {
  const source = expectedSourceObjects(plan, true);
  return [...source, ...plan.objectInventory.tables, ...plan.objectInventory.indexes]
    .sort(compareObjects);
}

async function assertExactObjectInventory(database, expectedObjects, codePrefix) {
  const actualObjects = await readMasterObjects(database);
  const expectedByName = new Map(expectedObjects.map((object) => [object.name, object]));
  const actualNames = [...actualObjects.keys()];
  for (const expected of expectedObjects) {
    const actual = actualObjects.get(expected.name);
    if (!actual) throw fail(`${codePrefix}_missing`, expected.name);
    if (String(actual.type) !== expected.type || normalizedSql(actual.sql) !== normalizedSql(expected.sql)) {
      throw fail(`${codePrefix}_mismatch`, expected.name);
    }
  }
  for (const name of actualNames) {
    if (expectedByName.has(name)) continue;
    if (ALLOWED_PROVIDER_OBJECTS.has(name)) {
      const actual = actualObjects.get(name);
      if (String(actual.type) !== "table") throw fail(`${codePrefix}_mismatch`, name);
      continue;
    }
    throw fail(`${codePrefix}_unexpected`, name);
  }
}

async function assertNoUnexpectedObjects(database, allowedNames, code) {
  const actualObjects = await readMasterObjects(database);
  const allowed = new Set(allowedNames);
  for (const [name, actual] of actualObjects) {
    if (allowed.has(name)) continue;
    if (ALLOWED_PROVIDER_OBJECTS.has(name) && String(actual.type) === "table") continue;
    throw fail(code, name);
  }
}

async function readExtensionState(database, plan) {
  const objects = await readMasterObjects(database);
  const columnRows = new Map();
  for (const { table } of plan.objectInventory.columns) {
    const rows = await readTableInfo(database, table);
    for (const row of rows) columnRows.set(`${table}\0${row.name}`, row);
  }
  const missing = [];
  const mismatched = [];
  for (const expected of plan.objectInventory.tables) {
    const actual = objects.get(expected.name);
    if (!actual) missing.push(`table:${expected.name}`);
    else if (normalizedSql(actual.sql) !== normalizedSql(expected.sql)) mismatched.push(`table:${expected.name}`);
  }
  for (const expected of plan.objectInventory.indexes) {
    const actual = objects.get(expected.name);
    if (!actual) missing.push(`index:${expected.name}`);
    else if (normalizedSql(actual.sql) !== normalizedSql(expected.sql)) mismatched.push(`index:${expected.name}`);
  }
  for (const expected of plan.objectInventory.columns) {
    const actual = columnRows.get(`${expected.table}\0${expected.name}`);
    if (!actual) {
      missing.push(`column:${expected.table}.${expected.name}`);
      continue;
    }
    if (
      String(actual.type).toUpperCase() !== expected.type ||
      Number(actual.notnull) !== expected.notNull ||
      String(actual.dflt_value ?? "") !== String(expected.defaultValue ?? "")
    ) {
      mismatched.push(`column:${expected.table}.${expected.name}`);
      continue;
    }
    const tableSql = objects.get(expected.table)?.sql;
    if (expected.check && normalizedSql(tableSql).includes(normalizedSql(`CHECK (${expected.check})`)) === false) {
      mismatched.push(`column-check:${expected.table}.${expected.name}`);
    }
  }
  return {
    complete: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
  };
}

export async function inspectLifecycleTargetSchema(database, plan) {
  validatePlan(plan);
  const state = await readExtensionState(database, plan);
  if (state.complete) {
    // Column/table presence is insufficient: a complete-looking extension can
    // coexist with a changed source CHECK or an unreviewed trigger/view. The
    // same exact source+extension inventory used before/after apply is the
    // read-only inspection boundary.
    await assertExactObjectInventory(database, expectedTargetObjects(plan), "target_schema");
  }
  return {
    ...state,
    extensionDigest: plan.extensionDigest,
    objectInventory: plan.objectInventory,
  };
}

export async function applyLifecycleTargetSchema({ database, plan, catalog, convertedSchema } = {}) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw fail("invalid_target_database");
  }
  validatePlan(plan);
  const converted = convertedSchema ?? convertSchema(catalog);
  const expectedPlan = generateLifecycleTargetSchema({ catalog, convertedSchema: converted });
  if (
    expectedPlan.sourceFingerprint !== plan.sourceFingerprint ||
    expectedPlan.extensionDigest !== plan.extensionDigest ||
    canonicalJson(expectedPlan.sourceObjectInventory) !== canonicalJson(plan.sourceObjectInventory) ||
    expectedPlan.sourceSchemaSql !== plan.sourceSchemaSql
  ) {
    throw fail("lifecycle_schema_plan_source_mismatch");
  }
  await assertSourceShape(database, plan, catalog, converted);
  const before = await readExtensionState(database, plan);
  const hasAnyExtensionObject = before.missing.length <
    plan.objectInventory.tables.length + plan.objectInventory.indexes.length + plan.objectInventory.columns.length;
  if (before.mismatched.length > 0) throw fail("lifecycle_schema_existing_object_mismatch", before.mismatched.join(","));
  if (hasAnyExtensionObject && !before.complete) {
    await assertNoUnexpectedObjects(
      database,
      [...plan.sourceObjectInventory.map((object) => object.name), ...EXTENSION_TABLE_NAMES, ...EXTENSION_INDEX_NAMES, ...ALTERED_LICENSE_COLUMNS],
      "target_schema_unexpected",
    );
    throw fail("lifecycle_schema_partial");
  }
  if (before.complete) {
    await assertExactObjectInventory(database, expectedTargetObjects(plan), "target_schema");
    return {
      status: "already_applied",
      sourceFingerprint: plan.sourceFingerprint,
      extensionDigest: plan.extensionDigest,
      objectInventory: plan.objectInventory,
    };
  }

  await assertExactObjectInventory(database, expectedSourceObjects(plan, false), "target_source_schema");

  let results;
  try {
    results = await database.batch(plan.statements.map((statement) => database.prepare(statement)));
  } catch (error) {
    throw fail("lifecycle_schema_apply_failed", error);
  }
  if (!Array.isArray(results) || results.some((result) => result?.success === false)) {
    throw fail("lifecycle_schema_apply_failed");
  }
  const after = await readExtensionState(database, plan);
  if (!after.complete) throw fail("lifecycle_schema_readback_failed");
  await assertExactObjectInventory(database, expectedTargetObjects(plan), "target_schema");
  return {
    status: "applied",
    sourceFingerprint: plan.sourceFingerprint,
    extensionDigest: plan.extensionDigest,
    objectInventory: plan.objectInventory,
  };
}

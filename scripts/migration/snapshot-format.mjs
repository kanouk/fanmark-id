#!/usr/bin/env node

/**
 * Pure format and catalog helpers shared by the snapshot exporter and
 * verifier.  This file deliberately contains no database or network access.
 */

import { createHash, randomBytes } from "node:crypto";

export const SNAPSHOT_FORMAT_VERSION = 4;
export const ROW_RECORD_VERSION = 1;
export const ROW_ENVELOPE_VERSION = 1;
export const SNAPSHOT_STATUS_FILE = "snapshot.status.json";
export const SNAPSHOT_MANIFEST_FILE = "snapshot.manifest.json";
export const SNAPSHOT_CATALOG_FILE = "catalog.json";
export const SNAPSHOT_SCHEMA_REPORT_FILE = "schema-report.json";
export const TABLE_DIRECTORY = "tables";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CATALOG_KEYS = ["columns", "constraints", "enums", "functions", "indexes", "rls_policies", "triggers", "views"];
export const SUPPORTED_SEQUENCE_TARGET = Object.freeze({
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
});
const SEQUENCE_STATE_KEYS = [
  "schema", "name", "ownerSchema", "ownerTable", "ownerColumn", "startValue",
  "incrementBy", "minValue", "maxValue", "cacheSize", "cycle", "lastValue", "isCalled",
];

export class SnapshotFormatError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SnapshotFormatError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SnapshotFormatError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail("non_finite_json");
    return value;
  }
  if (typeof value !== "object") throw fail("unsupported_json_value");
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) throw fail("unsupported_json_object");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  const hash = createHash("sha256");
  hash.update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value));
  return hash.digest("hex");
}

export function randomToken(prefix = "snapshot") {
  return `${prefix}-${randomBytes(18).toString("hex")}`;
}

export function catalogForFingerprint(catalog) {
  if (!isPlainObject(catalog)) throw fail("invalid_catalog");
  for (const key of CATALOG_KEYS) {
    if (!Array.isArray(catalog[key])) throw fail("missing_catalog_scope");
  }
  // observed_at is evidence about when the catalog was captured, not schema
  // identity. Database locale is included when supplied because it can affect
  // CHECK-constraint behavior. Omitting it preserves legacy catalog digests.
  const result = Object.fromEntries(CATALOG_KEYS.map((key) => [key, canonicalize(catalog[key])]));
  if (Object.hasOwn(catalog, "database_locale")) {
    const locale = catalog.database_locale;
    if (
      !isPlainObject(locale) ||
      Object.keys(locale).length !== 2 ||
      typeof locale.collate !== "string" ||
      typeof locale.ctype !== "string"
    ) {
      throw fail("invalid_database_locale");
    }
    result.database_locale = { collate: locale.collate, ctype: locale.ctype };
  }
  return result;
}

export function catalogFingerprint(catalog) {
  return sha256Hex(catalogForFingerprint(catalog));
}

export function schemaReportFingerprint(report) {
  if (!isPlainObject(report)) throw fail("invalid_schema_report");
  return sha256Hex(report);
}

export function expectedSequenceTargets(catalog) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.columns)) throw fail("invalid_catalog");
  const sequenceColumns = catalog.columns.filter((column) => /^nextval\s*\(/i.test(String(column?.default_expression ?? "").trim()));
  if (sequenceColumns.length === 0) return [];
  if (sequenceColumns.length !== 1) throw fail("sequence_target_unsupported");
  const [column] = sequenceColumns;
  if (
    column.table_name !== SUPPORTED_SEQUENCE_TARGET.ownerTable
    || column.column_name !== SUPPORTED_SEQUENCE_TARGET.ownerColumn
    || String(column.postgres_type).toLowerCase() !== "bigint"
    || !/^nextval\s*\(\s*'(?:public\.)?fanmark_events_id_seq'\s*::\s*regclass\s*\)$/iu.test(String(column.default_expression).trim())
  ) throw fail("sequence_target_unsupported");
  const primaryKey = getPrimaryKeyInfo(catalog, SUPPORTED_SEQUENCE_TARGET.ownerTable);
  if (primaryKey.columns.length !== 1 || primaryKey.columns[0].name !== SUPPORTED_SEQUENCE_TARGET.ownerColumn) throw fail("sequence_target_unsupported");
  return [SUPPORTED_SEQUENCE_TARGET];
}

export function validateSequenceStates(catalog, sequenceStates) {
  const expected = expectedSequenceTargets(catalog);
  if (!Array.isArray(sequenceStates) || sequenceStates.length !== expected.length) throw fail("sequence_state_set_mismatch");
  const byName = new Map();
  for (const state of sequenceStates) {
    if (!isPlainObject(state) || JSON.stringify(Object.keys(state).sort()) !== JSON.stringify([...SEQUENCE_STATE_KEYS].sort())) throw fail("sequence_state_shape_invalid");
    if (typeof state.schema !== "string" || typeof state.name !== "string" || typeof state.ownerSchema !== "string" || typeof state.ownerTable !== "string" || typeof state.ownerColumn !== "string") throw fail("sequence_state_identity_invalid");
    if (byName.has(`${state.schema}.${state.name}`)) throw fail("sequence_state_duplicate");
    byName.set(`${state.schema}.${state.name}`, state);
  }
  for (const target of expected) {
    const state = byName.get(`${target.schema}.${target.name}`);
    if (!state) throw fail("sequence_state_missing");
    for (const key of ["schema", "name", "ownerSchema", "ownerTable", "ownerColumn", "startValue", "incrementBy", "minValue", "maxValue", "cacheSize", "cycle"]) {
      if (state[key] !== target[key]) throw fail("sequence_state_definition_mismatch");
    }
    if (typeof state.lastValue !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(state.lastValue) || typeof state.isCalled !== "boolean") throw fail("sequence_state_value_invalid");
    let lastValue;
    try {
      lastValue = BigInt(state.lastValue);
      if (lastValue.toString() !== state.lastValue || lastValue < BigInt(target.minValue) || lastValue > BigInt(target.maxValue)) throw fail("sequence_state_value_invalid");
      if (!state.isCalled && state.lastValue !== target.startValue) throw fail("sequence_state_value_invalid");
    } catch (error) {
      if (error instanceof SnapshotFormatError) throw error;
      throw fail("sequence_state_value_invalid", error);
    }
  }
  return sequenceStates;
}

export function tableFileName(tableName) {
  if (typeof tableName !== "string" || !IDENTIFIER_RE.test(tableName)) throw fail("unsafe_table_name");
  return `${sha256Hex(`public\0${tableName}`)}.rows.ndjson`;
}

export function tableFilePath(tableName) {
  return `${TABLE_DIRECTORY}/${tableFileName(tableName)}`;
}

export function compareUtf8(left, right) {
  return Buffer.from(String(left), "utf8").compare(Buffer.from(String(right), "utf8"));
}

export function compareUtf8Tuple(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) throw fail("invalid_primary_key_tuple");
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareUtf8(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function splitTopLevel(value) {
  const pieces = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quoted && value[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (!quoted && depth === 0 && char === ",") {
      pieces.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || depth !== 0) return null;
  pieces.push(value.slice(start).trim());
  return pieces.filter(Boolean);
}

function unquoteIdentifier(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replaceAll('""', '"');
  return trimmed;
}

function parseConstraintColumns(definition, prefix) {
  const match = String(definition).trim().match(new RegExp(`^${prefix}\\s*\\(`, "i"));
  if (!match) return null;
  const rest = String(definition).trim().slice(match[0].length);
  let depth = 0;
  let quoted = false;
  let close = -1;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "'") {
      if (quoted && rest[index + 1] === "'") index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) {
        close = index;
        break;
      }
      depth -= 1;
    }
  }
  if (quoted || close < 0 || rest.slice(close + 1).trim() !== "") return null;
  const parts = splitTopLevel(rest.slice(0, close));
  if (!parts || parts.some((part) => !IDENTIFIER_RE.test(unquoteIdentifier(part)))) return null;
  return parts.map(unquoteIdentifier);
}

function normalizeCatalogShape(catalog) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.columns) || !Array.isArray(catalog.constraints)) throw fail("invalid_catalog");
  const columnsByTable = new Map();
  const seenColumns = new Set();
  const seenOrdinals = new Set();
  for (const column of catalog.columns) {
    if (!isPlainObject(column) || typeof column.table_name !== "string" || typeof column.column_name !== "string" || !Number.isSafeInteger(column.ordinal) || column.ordinal < 1 || typeof column.postgres_type !== "string") throw fail("invalid_catalog_column");
    if (!IDENTIFIER_RE.test(column.table_name) || !IDENTIFIER_RE.test(column.column_name)) throw fail("unsafe_catalog_identifier");
    const key = `${column.table_name}\0${column.column_name}`;
    const ordinalKey = `${column.table_name}\0${column.ordinal}`;
    if (seenColumns.has(key)) throw fail("duplicate_catalog_column");
    if (seenOrdinals.has(ordinalKey)) throw fail("duplicate_catalog_ordinal");
    seenColumns.add(key);
    seenOrdinals.add(ordinalKey);
    const values = columnsByTable.get(column.table_name) ?? [];
    values.push(column);
    columnsByTable.set(column.table_name, values);
  }
  const constraintsByTable = new Map();
  for (const constraint of catalog.constraints) {
    if (!isPlainObject(constraint) || typeof constraint.table_name !== "string" || typeof constraint.name !== "string" || typeof constraint.kind !== "string" || typeof constraint.definition !== "string") throw fail("invalid_catalog_constraint");
    if (!IDENTIFIER_RE.test(constraint.table_name) || !IDENTIFIER_RE.test(constraint.name)) throw fail("unsafe_catalog_identifier");
    if (!columnsByTable.has(constraint.table_name)) throw fail("orphan_catalog_constraint");
    const list = constraintsByTable.get(constraint.table_name) ?? [];
    list.push(constraint);
    constraintsByTable.set(constraint.table_name, list);
  }
  return { columnsByTable, constraintsByTable };
}

export function getTableNames(catalog) {
  return [...normalizeCatalogShape(catalog).columnsByTable.keys()].sort((a, b) => compareUtf8(a, b));
}

export function getTableColumns(catalog, tableName) {
  const { columnsByTable } = normalizeCatalogShape(catalog);
  const columns = columnsByTable.get(tableName);
  if (!columns) throw fail("unknown_table");
  return [...columns].sort((left, right) => left.ordinal - right.ordinal);
}

export function getPrimaryKeyInfo(catalog, tableName) {
  const { columnsByTable, constraintsByTable } = normalizeCatalogShape(catalog);
  const columns = columnsByTable.get(tableName);
  if (!columns) throw fail("unknown_table");
  const primary = (constraintsByTable.get(tableName) ?? []).filter((constraint) => constraint.kind === "p");
  if (primary.length !== 1) throw fail(primary.length === 0 ? "missing_primary_key" : "duplicate_primary_key");
  const names = parseConstraintColumns(primary[0].definition, "PRIMARY KEY");
  if (!names || names.length === 0 || new Set(names).size !== names.length) throw fail("unsupported_primary_key_definition");
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  const descriptors = names.map((name) => {
    const column = byName.get(name);
    if (!column) throw fail("primary_key_column_missing");
    if (column.not_null !== true) throw fail("nullable_primary_key");
    const sourceType = column.postgres_type.toLowerCase();
    if (sourceType !== "uuid" && sourceType !== "bigint") throw fail("unsupported_primary_key_type");
    return { name, sourceType, column };
  });
  return { table: tableName, constraint: primary[0].name, columns: descriptors.map(({ name, sourceType }) => ({ name, sourceType })) };
}

export function primaryKeyProjectionExpression(descriptor) {
  if (!descriptor || typeof descriptor.name !== "string") throw fail("invalid_primary_key_descriptor");
  return `${quoteIdentifier(descriptor.name)}::text COLLATE "C"`;
}

export function addPrimaryKeyOrder(plan, primaryKey, token = null) {
  if (!isPlainObject(plan) || typeof plan.sql !== "string" || typeof plan.table !== "string" || typeof plan.schema !== "string") throw fail("invalid_row_plan");
  if (!primaryKey?.columns?.length) throw fail("missing_primary_key");
  const marker = `\nFROM ${quoteIdentifier(plan.schema)}.${quoteIdentifier(plan.table)};`;
  const markerIndex = plan.sql.lastIndexOf(marker);
  if (markerIndex < 0) throw fail("row_plan_source_marker_missing");
  const projections = primaryKey.columns.map((column, index) => `${primaryKeyProjectionExpression(column)} AS ${quoteIdentifier(`__snapshot_pk_${index}`)}`).join(",\n  ");
  const sourceSql = `${plan.sql.slice(0, markerIndex)},\n  ${projections}${plan.sql.slice(markerIndex)}`;
  const withoutSemicolon = sourceSql.trimEnd().endsWith(";") ? sourceSql.trimEnd().slice(0, -1) : sourceSql.trimEnd();
  const order = primaryKey.columns.map((_column, index) => `projected.${quoteIdentifier(`__snapshot_pk_${index}`)} COLLATE "C"`).join(", ");
  return {
    sql: [
      "SELECT jsonb_build_object(",
      "  'kind', 'row',",
      ...(token === null ? [] : [`  'token', ${quoteLiteral(token)},`]),
      `  'table', ${quoteLiteral(plan.table)},`,
      "  'payload', projected.\"__fanmark_row_envelope\"",
      ")::text AS \"__snapshot_frame\"",
      "FROM (",
      withoutSemicolon,
      ") AS projected",
      `ORDER BY ${order};`,
      "",
    ].join("\n"),
    sourceSql,
  };
}

export function frameSqlForCursor(plan, primaryKey, token, cursorName) {
  if (typeof token !== "string" || typeof cursorName !== "string") throw fail("invalid_frame_identity");
  const ordered = addPrimaryKeyOrder(plan, primaryKey, token).sql.trimEnd().replace(/;$/, "");
  return `DECLARE ${quoteIdentifier(cursorName)} NO SCROLL CURSOR FOR ${ordered};`;
}

export function primaryKeyFromEnvelope(envelope, primaryKey) {
  if (!isPlainObject(envelope) || !isPlainObject(envelope.values)) throw fail("invalid_row_envelope");
  return primaryKey.columns.map(({ name, sourceType }) => {
    const value = envelope.values[name];
    if (typeof value !== "string") throw fail("null_primary_key");
    if (sourceType === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw fail("noncanonical_primary_key");
    if (sourceType === "bigint") {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) throw fail("noncanonical_primary_key");
      try {
        if (BigInt(value).toString() !== value) throw fail("noncanonical_primary_key");
      } catch (error) {
        if (error instanceof SnapshotFormatError) throw error;
        throw fail("noncanonical_primary_key", error);
      }
    }
    return value;
  });
}

export function rowRecordForEnvelope(envelope, primaryKey, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw fail("invalid_row_ordinal");
  const key = primaryKeyFromEnvelope(envelope, primaryKey);
  return {
    recordVersion: ROW_RECORD_VERSION,
    ordinal,
    primaryKey: key,
    rowHash: sha256Hex(envelope),
    envelope,
  };
}

export function assertExactObjectKeys(value, keys, code = "unexpected_keys") {
  if (!isPlainObject(value)) throw fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) throw fail(code);
}

export function assertPrivateRelativePath(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => part === "" || part === "." || part === "..")) throw fail("unsafe_relative_path");
  return value;
}

export function isSupportedPrimaryKeyType(sourceType) {
  return sourceType === "uuid" || sourceType === "bigint";
}

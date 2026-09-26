#!/usr/bin/env node

/**
 * Convert the read-only PostgreSQL catalog JSON produced by
 * schema-readiness.sql into a structural D1/SQLite schema and a blocking-gates
 * report. This tool never reads application rows and never applies SQL.
 */

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { compileCredentialDescriptor, CREDENTIAL_COLUMN, CREDENTIAL_SOURCE_RELATION } from "./credential-descriptor.mjs";

export const SCHEMA_CONVERSION_VERSION = 4;
export const DEFAULT_SQL_FILE = "schema-d1.generated.sql";
export const DEFAULT_REPORT_FILE = "schema-d1.gates.json";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MONEY_COLUMNS = new Set([
  "fanmark_availability_rules.price_usd",
  "fanmark_tiers.monthly_price_usd",
]);
const SUPPORTED_INDEX_METHOD = "btree";
const ROW_CONVERSION_GATE_CODES = new Set([
  "uuid_import_validation",
  "bigint_import_range_validation",
  "date_import_validation",
  "timestamp_import_precision",
  "json_import_validation",
  "array_import_validation",
  "money_cents_import",
  "decimal_import_validation",
  "credential_transform_import_required",
  "credential_descriptor_required",
  "sequence_state_import_required",
]);

// SQLite/D1 has no gen_random_uuid(), but its randomblob/random functions can
// construct a standard version-4 UUID. Imported rows still provide their
// source IDs explicitly; this default only covers new target-side inserts.
const D1_UUID_V4_DEFAULT = `lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
  substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
  hex(randomblob(6))
)`;

export class SchemaConversionError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SchemaConversionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SchemaConversionError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function locationKey(location) {
  return [location.kind ?? "", location.table ?? "", location.column ?? "", location.name ?? ""].join("\0");
}

class GateBook {
  #groups = new Map();

  add(code, reason, location = {}) {
    const key = `${code}\0${reason}`;
    let group = this.#groups.get(key);
    if (!group) {
      group = { code, severity: "blocking", reason, locations: new Map() };
      this.#groups.set(key, group);
    }
    const normalized = {
      ...(location.kind ? { kind: location.kind } : {}),
      ...(location.table ? { table: location.table } : {}),
      ...(location.column ? { column: location.column } : {}),
      ...(location.name ? { name: location.name } : {}),
    };
    group.locations.set(locationKey(normalized), normalized);
  }

  values() {
    return [...this.#groups.values()]
      .map((group) => ({
        code: group.code,
        severity: group.severity,
        reason: group.reason,
        locations: [...group.locations.values()].sort(compareLocations),
      }))
      .sort((left, right) => `${left.code}\0${left.reason}`.localeCompare(`${right.code}\0${right.reason}`));
  }
}

function compareLocations(left, right) {
  return locationKey(left).localeCompare(locationKey(right));
}

function stageGateSummary(gates) {
  const codes = [...new Set(gates.map((gate) => gate.code))].sort();
  return {
    ready: gates.length === 0,
    gateGroupCount: gates.length,
    affectedLocationCount: gates.reduce((count, gate) => count + gate.locations.length, 0),
    gateCodes: codes,
  };
}

function requireArray(catalog, name) {
  if (!Array.isArray(catalog[name])) throw fail("invalid_catalog", `missing ${name}`);
  return catalog[name];
}

function normalizeCatalog(catalog) {
  if (!isPlainObject(catalog)) throw fail("invalid_catalog");
  let databaseLocale;
  if (Object.hasOwn(catalog, "database_locale")) {
    if (
      !isPlainObject(catalog.database_locale) ||
      typeof catalog.database_locale.collate !== "string" ||
      typeof catalog.database_locale.ctype !== "string"
    ) {
      throw fail("invalid_catalog_database_locale");
    }
    databaseLocale = {
      collate: catalog.database_locale.collate,
      ctype: catalog.database_locale.ctype,
    };
  }
  const columns = requireArray(catalog, "columns").map((column) => {
    if (
      !isPlainObject(column) ||
      typeof column.table_name !== "string" ||
      typeof column.column_name !== "string" ||
      !Number.isSafeInteger(column.ordinal) ||
      column.ordinal < 1 ||
      typeof column.postgres_type !== "string" ||
      typeof column.type_name !== "string" ||
      typeof column.type_schema !== "string" ||
      typeof column.not_null !== "boolean"
    ) {
      throw fail("invalid_catalog_column");
    }
    return { ...column, default_expression: column.default_expression ?? null };
  });
  const constraints = requireArray(catalog, "constraints").map((constraint) => {
    if (
      !isPlainObject(constraint) ||
      typeof constraint.table_name !== "string" ||
      typeof constraint.name !== "string" ||
      typeof constraint.kind !== "string" ||
      typeof constraint.definition !== "string" ||
      typeof constraint.validated !== "boolean" ||
      typeof constraint.deferrable !== "boolean" ||
      typeof constraint.initially_deferred !== "boolean"
    ) {
      throw fail("invalid_catalog_constraint");
    }
    return constraint;
  });
  const indexes = requireArray(catalog, "indexes").map((index) => {
    if (
      !isPlainObject(index) ||
      typeof index.table_name !== "string" ||
      typeof index.name !== "string" ||
      typeof index.definition !== "string" ||
      typeof index.valid !== "boolean" ||
      typeof index.unique !== "boolean" ||
      typeof index.primary !== "boolean"
    ) {
      throw fail("invalid_catalog_index");
    }
    return index;
  });
  const enums = requireArray(catalog, "enums").map((entry) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.type_name !== "string" ||
      typeof entry.value !== "string" ||
      typeof entry.sort_order !== "number"
    ) {
      throw fail("invalid_catalog_enum");
    }
    return entry;
  });

  const seenColumns = new Set();
  const seenOrdinals = new Set();
  for (const column of columns) {
    const key = `${column.table_name}\0${column.column_name}`;
    if (seenColumns.has(key)) throw fail("duplicate_catalog_column");
    seenColumns.add(key);
    const ordinalKey = `${column.table_name}\0${column.ordinal}`;
    if (seenOrdinals.has(ordinalKey)) throw fail("duplicate_catalog_ordinal");
    seenOrdinals.add(ordinalKey);
  }
  const tableNames = new Set(columns.map((column) => column.table_name));
  for (const name of tableNames) {
    if (!IDENTIFIER_RE.test(name)) throw fail("unsafe_catalog_table_name");
  }
  for (const column of columns) {
    if (!IDENTIFIER_RE.test(column.column_name)) throw fail("unsafe_catalog_column_name");
  }
  const seenConstraintNames = new Set();
  for (const constraint of constraints) {
    const key = `${constraint.table_name}\0${constraint.name}`;
    if (seenConstraintNames.has(key)) throw fail("duplicate_catalog_constraint_name");
    seenConstraintNames.add(key);
  }
  const seenIndexNames = new Set();
  for (const index of indexes) {
    if (seenIndexNames.has(index.name)) throw fail("duplicate_catalog_index_name");
    seenIndexNames.add(index.name);
  }

  return {
    observed_at: catalog.observed_at ?? null,
    ...(databaseLocale ? { database_locale: databaseLocale } : {}),
    columns: [...columns].sort((left, right) => left.table_name.localeCompare(right.table_name) || left.ordinal - right.ordinal),
    constraints: [...constraints].sort((left, right) => left.table_name.localeCompare(right.table_name) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)),
    indexes: [...indexes].sort((left, right) => left.table_name.localeCompare(right.table_name) || left.name.localeCompare(right.name)),
    enums: [...enums].sort((left, right) => left.type_name.localeCompare(right.type_name) || left.sort_order - right.sort_order),
  };
}

function splitTopLevel(value) {
  const pieces = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quote && value[index + 1] === "'") {
        index += 1;
      } else {
        quote = !quote;
      }
    } else if (!quote && char === "(") {
      depth += 1;
    } else if (!quote && char === ")") {
      depth -= 1;
    } else if (!quote && depth === 0 && char === ",") {
      pieces.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || depth !== 0) return null;
  pieces.push(value.slice(start).trim());
  return pieces.filter(Boolean);
}

function unquoteIdentifier(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replaceAll('""', '"');
  return trimmed;
}

function columnMap(columns) {
  return new Map(columns.map((column) => [column.column_name, column]));
}

function parseConstraintColumns(definition, prefix) {
  const match = definition.trim().match(new RegExp(`^${prefix}\\s*\\(`, "i"));
  if (!match) return null;
  const rest = definition.trim().slice(match[0].length);
  let nestedDepth = 0;
  let quoted = false;
  let closingIndex = -1;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "'") {
      if (quoted && rest[index + 1] === "'") index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") nestedDepth += 1;
    else if (char === ")") {
      if (nestedDepth === 0) {
        closingIndex = index;
        break;
      }
      nestedDepth -= 1;
    }
  }
  if (quoted || closingIndex < 0 || rest.slice(closingIndex + 1).trim() !== "") return null;
  return splitTopLevel(rest.slice(0, closingIndex))?.map(unquoteIdentifier) ?? null;
}

function ensureColumns(table, names, columnsByTable) {
  if (!names || names.length === 0) return false;
  const known = columnsByTable.get(table);
  return Boolean(known && names.every((name) => known.has(name)));
}

const SAFE_CHECK_LITERAL_CASTS = new Set([
  "text",
]);

function stripPostgresCasts(expression, allowedCasts = SAFE_CHECK_LITERAL_CASTS) {
  let result = "";
  let quoted = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "'") {
      result += char;
      if (quoted && expression[index + 1] === "'") {
        result += expression[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === ":" && expression[index + 1] === ":") {
      const castStart = index + 2;
      let castEnd = castStart;
      while (castEnd < expression.length && /[A-Za-z0-9_.]/.test(expression[castEnd])) castEnd += 1;
      if (expression[castEnd] === "[" && expression[castEnd + 1] === "]") castEnd += 2;
      const castName = expression.slice(castStart, castEnd).toLowerCase();
      const previous = result.trimEnd().at(-1);
      if (allowedCasts.has(castName) && previous === "'") {
        index = castEnd - 1;
        continue;
      }
      result += expression.slice(index, castEnd);
      index = castEnd - 1;
      continue;
    }
    result += char;
  }
  return result;
}

function rewriteOutsideQuotedLiterals(expression) {
  let result = "";
  for (let index = 0; index < expression.length;) {
    if (expression[index] === "'") {
      const start = index;
      index += 1;
      while (index < expression.length) {
        if (expression[index] === "'") {
          if (expression[index + 1] === "'") index += 2;
          else {
            index += 1;
            break;
          }
        } else index += 1;
      }
      result += expression.slice(start, index);
      continue;
    }

    const charLength = expression.slice(index).match(/^char_length\s*\(/i);
    if (charLength) {
      result += "length(";
      index += charLength[0].length;
      continue;
    }

    const anyArray = expression.slice(index).match(/^=\s*ANY\s*\(\s*ARRAY\s*\[/i);
    if (anyArray) {
      const valuesStart = index + anyArray[0].length;
      let valuesEnd = valuesStart;
      let valuesQuoted = false;
      while (valuesEnd < expression.length) {
        const charAtValue = expression[valuesEnd];
        if (charAtValue === "'") {
          if (valuesQuoted && expression[valuesEnd + 1] === "'") valuesEnd += 2;
          else {
            valuesQuoted = !valuesQuoted;
            valuesEnd += 1;
          }
        } else if (!valuesQuoted && charAtValue === "]") {
          break;
        } else {
          valuesEnd += 1;
        }
      }
      const closing = expression.slice(valuesEnd + 1).match(/^\s*\)/);
      if (!valuesQuoted && expression[valuesEnd] === "]" && closing) {
        result += `IN (${expression.slice(valuesStart, valuesEnd)})`;
        index = valuesEnd + 1 + closing[0].length;
        continue;
      }
    }

    result += expression[index];
    index += 1;
  }
  return result;
}

function unwrapCheckDefinition(definition) {
  const match = definition.trim().match(/^CHECK\s*\((.*)\)$/is);
  return match ? match[1].trim() : null;
}

function tokenizeCheckExpression(expression, allowedColumns = null) {
  const tokens = [];
  const allowedWords = new Set(["and", "or", "is", "null", "not", "in", "true", "false", "length"]);
  for (let index = 0; index < expression.length;) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let end = index + 1;
      let closed = false;
      while (end < expression.length) {
        if (expression[end] === "'") {
          if (expression[end + 1] === "'") {
            end += 2;
            continue;
          }
          closed = true;
          end += 1;
          break;
        }
        end += 1;
      }
      if (!closed) return false;
      tokens.push("literal");
      index = end;
      continue;
    }
    const word = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (word) {
      const lower = word.toLowerCase();
      if (!allowedWords.has(lower) && !(allowedColumns && allowedColumns.has(word))) return false;
      tokens.push(lower);
      index += word.length;
      continue;
    }
    const number = expression.slice(index).match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)/)?.[0];
    if (number) {
      tokens.push("number");
      index += number.length;
      continue;
    }
    const operator = expression.slice(index).match(/^(?:<=|>=|<>|!=|=|<|>|\(|\)|,)/)?.[0];
    if (operator) {
      tokens.push(operator);
      index += operator.length;
      continue;
    }
    return false;
  }
  return tokens;
}

function identifiersOutsideStrings(expression) {
  const identifiers = [];
  for (let index = 0; index < expression.length;) {
    if (expression[index] === "'") {
      index += 1;
      while (index < expression.length) {
        if (expression[index] === "'") {
          if (expression[index + 1] === "'") index += 2;
          else {
            index += 1;
            break;
          }
        } else index += 1;
      }
      continue;
    }
    const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (match) {
      identifiers.push(match[0]);
      index += match[0].length;
    } else {
      index += 1;
    }
  }
  return identifiers;
}

function representationSensitiveColumns(expression, tableColumns) {
  if (!tableColumns) return [];
  const sourceColumns = new Map(tableColumns.map((column) => [column.column_name, column]));
  const sensitive = [];
  for (const name of identifiersOutsideStrings(expression)) {
    const column = sourceColumns.get(name);
    if (!column) continue;
    if (/^numeric(?:\(|$)/i.test(column.postgres_type) || column.postgres_type.endsWith("[]") || column.postgres_type === "jsonb") {
      sensitive.push(column);
      continue;
    }
    // PostgreSQL enum ordering follows declaration order, not text collation.
    // A token allowlist is insufficient to prove equivalent enum predicates.
    if (column.type_kind === "e") sensitive.push(column);
  }
  return sensitive;
}

function unwrapSingleOuterParentheses(expression) {
  const value = expression.trim();
  if (!value.startsWith("(") || !value.endsWith(")")) return value;
  let depth = 0;
  let quotedIdentifier = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      if (quotedIdentifier && value[index + 1] === '"') index += 1;
      else quotedIdentifier = !quotedIdentifier;
    } else if (!quotedIdentifier && char === "(") depth += 1;
    else if (!quotedIdentifier && char === ")") {
      depth -= 1;
      if (depth === 0 && index !== value.length - 1) return value;
      if (depth < 0) return value;
    }
  }
  return depth === 0 && !quotedIdentifier ? value.slice(1, -1).trim() : value;
}

// Keep numeric > 0 exact after numeric columns move to canonical TEXT. Restrict
// this rule to non-null unconstrained numerics so CHECK's NULL behavior is not
// accidentally changed, and never compare through SQLite REAL.
function translatePositiveCanonicalDecimalCheck(definition, tableColumns) {
  const unwrapped = unwrapCheckDefinition(definition);
  if (unwrapped === null) return null;
  const expression = unwrapSingleOuterParentheses(unwrapped);
  const match = expression.match(
    /^(?:\"([A-Za-z_][A-Za-z0-9_]*)\"|([A-Za-z_][A-Za-z0-9_]*))\s*>\s*(?:\(\s*0(?:\.0+)?\s*\)|0(?:\.0+)?)(?:\s*::\s*(?:pg_catalog\.)?numeric)?$/i,
  );
  if (!match) return null;

  const columnName = match[1] ?? match[2];
  const column = tableColumns.find((candidate) => candidate.column_name === columnName);
  if (!column || column.postgres_type.toLowerCase() !== "numeric" || !column.not_null) return null;

  const quotedColumn = quoteIdentifier(column.column_name);
  return [
    `typeof(${quotedColumn}) = 'text'`,
    `length(${quotedColumn}) > 0`,
    `instr(${quotedColumn}, char(0)) = 0`,
    `${quotedColumn} NOT GLOB '*[^0-9.]*'`,
    `${quotedColumn} NOT GLOB '*.*.*'`,
    `substr(${quotedColumn}, 1, 1) GLOB '[0-9]'`,
    `(substr(${quotedColumn}, 1, 1) <> '0' OR substr(${quotedColumn}, 2, 1) = '.')`,
    `(instr(${quotedColumn}, '.') = 0 OR instr(${quotedColumn}, '.') < length(${quotedColumn}))`,
    `replace(replace(${quotedColumn}, '.', ''), '0', '') <> ''`,
  ].join(" AND ");
}

// Translate only the three exact ASCII validation expressions present in the
// source schema, and only when PostgreSQL's active database locale is C/C.
// SQLite GLOB's ASCII ranges then preserve the source ranges; unknown locale,
// expression, operator, collation, or column shape keeps the existing gate.
function translateKnownPostgresRegexCheck(definition, tableName, tableColumns, databaseLocale) {
  if (databaseLocale?.collate !== "C" || databaseLocale?.ctype !== "C") return null;
  const unwrapped = unwrapCheckDefinition(definition);
  if (unwrapped === null) return null;
  const expression = unwrapSingleOuterParentheses(unwrapped);
  const match = expression.match(
    /^(?:"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))\s*(~\*|~)\s*'((?:''|[^'])*)'\s*(?:::\s*(?:"text"|(?:pg_catalog\.)?text))?$/i,
  );
  if (!match) return null;

  const columnName = match[1] ?? match[2];
  const operator = match[3];
  const pattern = match[4].replaceAll("''", "'");
  const column = tableColumns.find((candidate) => candidate.column_name === columnName);
  if (
    !column ||
    column.postgres_type.toLowerCase() !== "text" ||
    (column.collation !== null && column.collation !== undefined && column.collation !== '"default"')
  ) return null;

  const name = quoteIdentifier(columnName);
  if (
    tableName === "invitation_codes" && columnName === "code" && operator === "~" &&
    pattern === "^[A-Z0-9]{6,12}$"
  ) {
    return `length(${name}) BETWEEN 6 AND 12 AND instr(${name}, char(0)) = 0 AND ${name} NOT GLOB '*[^A-Z0-9]*'`;
  }
  if (
    tableName === "system_settings" && columnName === "setting_key" && operator === "~" &&
    pattern === "^[a-z_]+$"
  ) {
    return `length(${name}) > 0 AND instr(${name}, char(0)) = 0 AND ${name} NOT GLOB '*[^a-z_]*'`;
  }
  if (
    tableName === "waitlist" && columnName === "email" && operator === "~*" &&
    pattern === "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
  ) {
    const at = `instr(${name}, '@')`;
    const local = `substr(${name}, 1, ${at} - 1)`;
    const domain = `substr(${name}, ${at} + 1)`;
    return [
      `instr(${name}, char(0)) = 0`,
      `(length(${name}) - length(replace(${name}, '@', ''))) = 1`,
      `${at} > 1`,
      `${local} NOT GLOB '*[^A-Za-z0-9._%+-]*'`,
      `length(${domain}) > 0`,
      `${domain} NOT GLOB '*[^A-Za-z0-9.-]*'`,
      `${domain} GLOB '?*.[A-Za-z][A-Za-z]*'`,
    ].join(" AND ");
  }
  return null;
}

function translateCheckExpression(definition, allowedColumns = null) {
  const unwrapped = unwrapCheckDefinition(definition);
  if (unwrapped === null) return null;
  if (/[~]/.test(unwrapped)) return null;
  const expression = rewriteOutsideQuotedLiterals(stripPostgresCasts(unwrapped));
  if (!tokenizeCheckExpression(expression, allowedColumns)) return null;
  return expression;
}

function parseSingleQuotedLiteral(value) {
  const match = value.trim().match(/^'((?:''|[^'])*)'$/s);
  return match ? match[1].replaceAll("''", "'") : null;
}

function decimalToCents(value) {
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return (sign * (whole * 100n + fraction)).toString();
}

function integerStorageCheck(column, expression) {
  const name = quoteIdentifier(column.column_name);
  return column.not_null ? expression : `${name} IS NULL OR (${expression})`;
}

function typeInfo(column, enumLabels, gates, typeCounts, credentialDescriptorPlan) {
  const sourceType = column.postgres_type;
  const location = { kind: "column", table: column.table_name, column: column.column_name };
  let targetType;
  let targetKind = "scalar";
  let codec = "unsupported";
  let checks = [];

  if (column.table_name === CREDENTIAL_SOURCE_RELATION && column.column_name === CREDENTIAL_COLUMN) {
    targetType = "TEXT";
    if (sourceType !== "text") {
      codec = "unsupported";
      gates.add("credential_source_type_invalid", "The credential source column must be PostgreSQL text and match the explicit transform descriptor.", location);
    } else if (credentialDescriptorPlan) {
      codec = "credential-to-bcrypt";
      gates.add("credential_transform_import_required", "The source credential requires the dedicated transformed-row importer; generic text INSERTs are forbidden.", location);
    } else {
      codec = "credential-descriptor-required";
      gates.add("credential_descriptor_required", "The credential column has no explicit transform descriptor and cannot use the ordinary text codec.", location);
    }
  } else if (sourceType === "uuid") {
    targetType = "TEXT";
    codec = "uuid-text";
    gates.add("uuid_import_validation", "UUID text must be validated and malformed values rejected during import.", location);
  } else if (sourceType === "text") {
    targetType = "TEXT";
    codec = "text";
  } else if (sourceType === "boolean") {
    targetType = "INTEGER";
    codec = "boolean-int01";
    checks.push(integerStorageCheck(column, `typeof(${quoteIdentifier(column.column_name)}) = 'integer' AND ${quoteIdentifier(column.column_name)} IN (0, 1)`));
  } else if (sourceType === "smallint") {
    targetType = "INTEGER";
    codec = "smallint-int16";
    checks.push(integerStorageCheck(column, `typeof(${quoteIdentifier(column.column_name)}) = 'integer' AND ${quoteIdentifier(column.column_name)} BETWEEN -32768 AND 32767`));
  } else if (sourceType === "integer") {
    targetType = "INTEGER";
    codec = "integer-int32";
    checks.push(integerStorageCheck(column, `typeof(${quoteIdentifier(column.column_name)}) = 'integer' AND ${quoteIdentifier(column.column_name)} BETWEEN -2147483648 AND 2147483647`));
  } else if (sourceType === "bigint") {
    targetType = "INTEGER";
    codec = "bigint-int64-exact";
    checks.push(integerStorageCheck(column, `typeof(${quoteIdentifier(column.column_name)}) = 'integer' AND ${quoteIdentifier(column.column_name)} BETWEEN -9223372036854775808 AND 9223372036854775807`));
    gates.add("bigint_import_range_validation", "Bigint values must be imported from exact integer text without JavaScript Number rounding; the current approved binding rejects values outside the safe JavaScript range until a D1 BigInt binding is proven.", location);
  } else if (sourceType === "date") {
    targetType = "TEXT";
    codec = "date-ymd-text";
    gates.add("date_import_validation", "Calendar dates must be validated as YYYY-MM-DD without timezone conversion.", location);
  } else if (sourceType === "timestamp with time zone") {
    targetType = "TEXT";
    codec = "timestamptz-utc-microsecond-text";
    gates.add("timestamp_import_precision", "Timestamptz imports and operation timestamps must preserve UTC microsecond text precision.", location);
  } else if (sourceType === "jsonb") {
    targetType = "TEXT";
    codec = "json-text";
    checks.push(`${quoteIdentifier(column.column_name)} IS NULL OR json_valid(${quoteIdentifier(column.column_name)})`);
    gates.add("json_import_validation", "JSONB values must be validated as JSON text while preserving JSON null versus SQL NULL.", location);
  } else if (sourceType.endsWith("[]")) {
    targetType = "TEXT";
    targetKind = "array";
    codec = "postgres-array-json-text";
    checks.push(`${quoteIdentifier(column.column_name)} IS NULL OR (json_valid(${quoteIdentifier(column.column_name)}) AND json_type(${quoteIdentifier(column.column_name)}) = 'array')`);
    gates.add("array_import_validation", "PostgreSQL array dimensions, lower bounds, element values, order, duplicates, and NULL versus empty must be validated before JSON encoding.", location);
  } else if (/^numeric\(10,2\)$/i.test(sourceType) && MONEY_COLUMNS.has(`${column.table_name}.${column.column_name}`)) {
    targetType = "INTEGER";
    targetKind = "money_cents";
    codec = "money-cents-int64";
    checks.push(integerStorageCheck(column, `typeof(${quoteIdentifier(column.column_name)}) = 'integer' AND ${quoteIdentifier(column.column_name)} BETWEEN -9999999999 AND 9999999999`));
    gates.add("money_cents_import", "numeric(10,2) must be imported as exact integer cents and exposed through a reversible money boundary.", location);
  } else if (/^numeric\(10,2\)$/i.test(sourceType) || sourceType === "numeric") {
    targetType = "TEXT";
    codec = "decimal-canonical-text";
    gates.add("decimal_import_validation", "Exact decimal values must remain canonical decimal text; binary floating-point conversion is forbidden.", location);
  } else if (column.type_kind === "e") {
    targetType = "TEXT";
    targetKind = "enum";
    codec = "enum-text-check";
    const labels = enumLabels.get(column.type_name) ?? [];
    if (labels.length === 0) {
      gates.add("missing_enum_labels", "Enum labels were not present in the catalog input.", { kind: "enum", name: column.type_name });
    } else {
      checks.push(`${quoteIdentifier(column.column_name)} IN (${labels.map(quoteLiteral).join(", ")})`);
    }
  } else {
    targetType = "BLOB";
    gates.add("unsupported_postgres_type", `No lossless D1 representation is defined for ${sourceType}.`, location);
  }

  const key = `${sourceType}->${targetType}`;
  typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  return { sourceType, targetType, targetKind, codec, checks };
}

function translateDefault(column, info, gates, sequencePrimaryKey = false) {
  const expression = column.default_expression;
  if (expression === null || expression === undefined || expression.trim() === "") return null;
  const location = { kind: "default", table: column.table_name, column: column.column_name };
  const trimmed = expression.trim();
  if (/^gen_random_uuid\s*\(\s*\)$/i.test(trimmed)) {
    if (column.postgres_type.toLowerCase() === "uuid" && info.targetType === "TEXT") {
      return `(${D1_UUID_V4_DEFAULT})`;
    }
    gates.add("uuid_default_requires_operation", "gen_random_uuid() can only be translated for UUID columns stored as TEXT.", location);
    return null;
  }
  if (/^now\s*\(\s*\)$/i.test(trimmed)) {
    gates.add("timestamp_default_requires_operation", "now() would lose source microsecond precision in a copied SQLite default; operation code must supply UTC text.", location);
    return null;
  }
  if (/^nextval\s*\(/i.test(trimmed)) {
    if (sequencePrimaryKey) {
      gates.add(
        "sequence_state_import_required",
        "D1 AUTOINCREMENT preserves monotonic allocation from imported IDs, but the frozen import must seed PostgreSQL's exact next sequence value.",
        location,
      );
      return null;
    }
    gates.add("sequence_default_requires_operation", "nextval() is not a D1 default; the event ID allocation operation must be collision-safe.", location);
    return null;
  }

  const defaultCasts = new Set(SAFE_CHECK_LITERAL_CASTS);
  if (column.postgres_type === "jsonb") defaultCasts.add("jsonb");
  if (column.postgres_type.endsWith("[]")) defaultCasts.add(column.postgres_type.toLowerCase());
  if (column.type_kind === "e") defaultCasts.add(column.type_name.toLowerCase());
  const withoutCast = stripPostgresCasts(trimmed, defaultCasts).trim();
  if (/^true$/i.test(withoutCast)) return info.targetType === "INTEGER" && column.postgres_type === "boolean" ? "1" : quoteLiteral("true");
  if (/^false$/i.test(withoutCast)) return info.targetType === "INTEGER" && column.postgres_type === "boolean" ? "0" : quoteLiteral("false");

  const literal = parseSingleQuotedLiteral(withoutCast);
  if (literal !== null) {
    if (info.targetKind === "array") {
      if (literal === "{}") return quoteLiteral("[]");
      gates.add("array_default_requires_review", "Only an empty PostgreSQL array default has a direct JSON encoding in this generator.", location);
      return null;
    }
    if (column.postgres_type === "jsonb") {
      try {
        JSON.parse(literal);
      } catch {
        gates.add("invalid_json_default", "The PostgreSQL JSONB default is not valid JSON text.", location);
        return null;
      }
    }
    if (info.targetKind === "money_cents") {
      const cents = decimalToCents(literal);
      if (cents === null) {
        gates.add("invalid_money_default", "The money default is not an exact decimal with at most two fractional digits.", location);
        return null;
      }
      return cents;
    }
    return quoteLiteral(literal);
  }

  if (/^[+-]?\d+$/.test(withoutCast)) {
    if (info.targetKind === "money_cents") {
      const cents = decimalToCents(withoutCast);
      return cents;
    }
    if (info.targetType === "INTEGER" && column.postgres_type !== "boolean") return withoutCast;
  }
  if (/^[+-]?\d+\.\d+$/.test(withoutCast) && info.sourceType === "numeric") return quoteLiteral(withoutCast);

  gates.add("unsupported_column_default", "The PostgreSQL default expression needs an explicit D1 operation or reviewed translation.", location);
  return null;
}

function parseForeignKey(definition) {
  const match = definition.match(/^FOREIGN KEY\s*\(([^)]*)\)\s+REFERENCES\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(.*)$/is);
  if (!match) return null;
  return {
    columns: splitTopLevel(match[1])?.map(unquoteIdentifier),
    reference: match[2],
    referenceColumns: splitTopLevel(match[3])?.map(unquoteIdentifier),
    actions: match[4].trim(),
  };
}

function translateForeignKey(constraint, columnsByTable, tableNames, gates) {
  const parsed = parseForeignKey(constraint.definition);
  const location = { kind: "constraint", table: constraint.table_name, name: constraint.name };
  if (!parsed || !ensureColumns(constraint.table_name, parsed.columns, columnsByTable)) {
    gates.add("unsupported_foreign_key", "Foreign-key definition or source columns could not be parsed safely.", location);
    return null;
  }
  const referenceParts = parsed.reference.split(".");
  const referenceSchema = referenceParts.length === 2 ? referenceParts[0] : "public";
  const referenceTable = referenceParts.at(-1);
  if (referenceSchema !== "public" || !tableNames.has(referenceTable)) {
    gates.add("external_foreign_key", "The catalog references an external identity table; do not create placeholder users in D1.", location);
    return null;
  }
  if (!ensureColumns(referenceTable, parsed.referenceColumns, columnsByTable)) {
    gates.add("unsupported_foreign_key", "Referenced columns were not present in the catalog input.", location);
    return null;
  }
  let actions = "";
  const remaining = parsed.actions;
  const actionMatches = [...remaining.matchAll(/ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/gi)];
  const remainder = remaining.replace(/ON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/gi, "").trim();
  if (remainder !== "") {
    gates.add("unsupported_foreign_key_action", "Foreign-key action syntax needs an explicit translation.", location);
    return null;
  }
  for (const match of actionMatches) actions += ` ON ${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
  return `CONSTRAINT ${quoteIdentifier(constraint.name)} FOREIGN KEY (${parsed.columns.map(quoteIdentifier).join(", ")}) REFERENCES ${quoteIdentifier(referenceTable)} (${parsed.referenceColumns.map(quoteIdentifier).join(", ")})${actions}`;
}

function parseIndexDefinition(definition) {
  const prefix = definition.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+([^\s]+)\s+ON\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\s+USING\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
  if (!prefix) return null;
  const rest = definition.slice(prefix[0].length);
  let nestedDepth = 0;
  let quoted = false;
  let closingIndex = -1;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (char === "'") {
      if (quoted && rest[index + 1] === "'") index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") nestedDepth += 1;
    else if (char === ")") {
      if (nestedDepth === 0) {
        closingIndex = index;
        break;
      }
      nestedDepth -= 1;
    }
  }
  if (quoted || closingIndex < 0) return null;
  const expressionText = rest.slice(0, closingIndex).trim();
  const suffix = rest.slice(closingIndex + 1).trim();
  let where = null;
  if (suffix !== "") {
    const whereMatch = suffix.match(/^WHERE\s+([\s\S]+)$/i);
    if (!whereMatch) return null;
    where = whereMatch[1].trim();
  }
  return {
    unique: Boolean(prefix[1]),
    name: unquoteIdentifier(prefix[2]),
    table: prefix[3],
    method: prefix[4].toLowerCase(),
    expressions: splitTopLevel(expressionText),
    where,
  };
}

function translateIndex(index, constraintNames, tableNames, columnsByTable, gates) {
  const location = { kind: "index", table: index.table_name, name: index.name };
  if (!index.valid) {
    gates.add("invalid_source_index", "The source index is marked invalid and cannot be treated as a target index.", location);
    return null;
  }
  if (index.primary || constraintNames.has(index.name)) return null;
  const parsed = parseIndexDefinition(index.definition);
  if (!parsed || parsed.table !== index.table_name || !tableNames.has(parsed.table)) {
    gates.add("unsupported_index_definition", "Index definition could not be parsed safely.", location);
    return null;
  }
  if (parsed.method !== SUPPORTED_INDEX_METHOD) {
    gates.add("unsupported_index_method", `The source ${parsed.method.toUpperCase()} index needs a deliberate D1 query replacement.`, location);
    return null;
  }
  if (!parsed.expressions || parsed.expressions.length === 0) {
    gates.add("unsupported_index_definition", "Index has no parseable key expressions.", location);
    return null;
  }
  const columns = [];
  for (const expression of parsed.expressions) {
    const normalizedExpression = expression.trim();
    const match = normalizedExpression.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?$/i);
    const seqKeyMatch = normalizedExpression.match(/^(?:public\.)?seq_key\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)(?:\s+(ASC|DESC))?$/i);
    if (seqKeyMatch) {
      const sourceColumn = columnsByTable.get(parsed.table)?.get(seqKeyMatch[1]);
      // Validated non-empty UUID arrays are imported as canonical,
      // order-preserving JSON text. An index on that representation preserves
      // sequence equality outside the source MD5 helper's theoretical
      // collision boundary, without recreating PostgreSQL MD5 in SQLite.
      if (!sourceColumn || sourceColumn.postgres_type.trim().toLowerCase() !== "uuid[]") {
        gates.add("unsupported_index_expression", "seq_key can only be replaced by the canonical JSON key for a UUID-array column.", location);
        return null;
      }
      columns.push(`${quoteIdentifier(seqKeyMatch[1])}${seqKeyMatch[2] ? ` ${seqKeyMatch[2].toUpperCase()}` : ""}`);
      continue;
    }
    if (!match || !columnsByTable.get(parsed.table)?.has(match[1])) {
      gates.add("unsupported_index_expression", "Expression indexes are not copied as ordinary D1 indexes.", location);
      return null;
    }
    columns.push(`${quoteIdentifier(match[1])}${match[2] ? ` ${match[2].toUpperCase()}` : ""}`);
  }
  let where = "";
  if (parsed.where) {
    const sourceColumns = [...(columnsByTable.get(parsed.table)?.values() ?? [])];
    if (representationSensitiveColumns(parsed.where, sourceColumns).length > 0) {
      gates.add(
        "representation_sensitive_index_predicate",
        "The partial-index predicate references a decimal, JSON, array, or enum representation whose PostgreSQL semantics need a reviewed D1 rewrite.",
        location,
      );
      return null;
    }
    const translated = translateCheckExpression(`CHECK (${parsed.where})`, new Set(sourceColumns.map((column) => column.column_name)));
    if (translated === null) {
      gates.add("unsupported_partial_index_predicate", "Partial-index predicate needs a reviewed SQLite translation.", location);
      return null;
    }
    where = ` WHERE ${translated}`;
  }
  return `CREATE ${parsed.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(parsed.name)} ON ${quoteIdentifier(parsed.table)} (${columns.join(", ")})${where};`;
}

function buildEnumLabels(enums) {
  const labels = new Map();
  for (const entry of enums) {
    const values = labels.get(entry.type_name) ?? [];
    if (!values.includes(entry.value)) values.push(entry.value);
    labels.set(entry.type_name, values);
  }
  return labels;
}

function renderTable(tableName, tableColumns, sourceConstraints, context) {
  const lines = [`CREATE TABLE ${quoteIdentifier(tableName)} (`];
  const definitions = [];
  const columnByName = new Map();
  const primaryConstraints = sourceConstraints.filter((constraint) => constraint.kind === "p");
  const primaryKeyColumns = primaryConstraints.length === 1
    ? parseConstraintColumns(primaryConstraints[0].definition, "PRIMARY KEY")
    : null;
  const sequencePrimaryKeyColumns = new Set();
  for (const column of tableColumns) {
    const defaultExpression = column.default_expression?.trim() ?? "";
    if (!/^nextval\s*\(/i.test(defaultExpression)) continue;
    if (
      column.postgres_type.toLowerCase() === "bigint" &&
      primaryKeyColumns?.length === 1 &&
      primaryKeyColumns[0] === column.column_name
    ) {
      sequencePrimaryKeyColumns.add(column.column_name);
    }
  }
  for (const column of tableColumns) {
    columnByName.set(column.column_name, column);
    if (column.identity) {
      context.gates.add(
        "identity_column_requires_operation",
        "PostgreSQL identity allocation is not copied into a D1 default; the import/write operation must provide a collision-safe value.",
        { kind: "column", table: tableName, column: column.column_name },
      );
    }
    if (column.generated) {
      context.gates.add(
        "generated_column_requires_review",
        "Generated-column behavior is not copied by this structural converter and needs an explicit D1 expression or operation.",
        { kind: "column", table: tableName, column: column.column_name },
      );
    }
    if (column.collation && column.collation !== '"default"') {
      context.gates.add(
        "unsupported_collation",
        "A non-default PostgreSQL collation has no implicit equivalent in the generated D1 schema.",
        { kind: "column", table: tableName, column: column.column_name },
      );
    }
    const info = typeInfo(column, context.enumLabels, context.gates, context.typeCounts, context.credentialDescriptorPlan);
    context.columnCodecs.push({
      table: tableName,
      column: column.column_name,
      sourceType: info.sourceType,
      targetType: info.targetType,
      codec: info.codec,
    });
    const parts = [quoteIdentifier(column.column_name), info.targetType];
    const sequencePrimaryKey = sequencePrimaryKeyColumns.has(column.column_name);
    if (sequencePrimaryKey) parts.push("PRIMARY KEY AUTOINCREMENT");
    if (column.not_null) parts.push("NOT NULL");
    const defaultSql = translateDefault(column, info, context.gates, sequencePrimaryKey);
    if (defaultSql !== null) parts.push(`DEFAULT ${defaultSql}`);
    definitions.push({ order: column.ordinal, sql: parts.join(" ") });
    for (const check of info.checks) {
      definitions.push({
        order: 10_000 + column.ordinal * 10 + definitions.length,
        sql: `CONSTRAINT ${quoteIdentifier(`d1_${tableName}_${column.column_name}_${definitions.length}`)} CHECK (${check})`,
      });
    }
  }
  context.columnsByTable.set(tableName, columnByName);

  const sourceOrder = { p: 1, u: 2, f: 3, c: 4 };
  for (const constraint of sourceConstraints.sort((left, right) => (sourceOrder[left.kind] ?? 99) - (sourceOrder[right.kind] ?? 99) || left.name.localeCompare(right.name))) {
    const location = { kind: "constraint", table: tableName, name: constraint.name };
    if (!constraint.validated) {
      context.gates.add("unvalidated_constraint", "The source constraint is not validated; it cannot be claimed as a target invariant.", location);
      continue;
    }
    if (constraint.deferrable || constraint.initially_deferred) {
      context.gates.add("deferrable_constraint", "D1 does not copy PostgreSQL deferrable constraint timing.", location);
      continue;
    }
    if (constraint.kind === "p" || constraint.kind === "u") {
      const prefix = constraint.kind === "p" ? "PRIMARY KEY" : "UNIQUE";
      const names = parseConstraintColumns(constraint.definition, prefix);
      if (!ensureColumns(tableName, names, context.columnsByTable)) {
        context.gates.add("unsupported_constraint", "Constraint columns could not be parsed safely.", location);
        continue;
      }
      if (constraint.kind === "p" && names.length === 1 && sequencePrimaryKeyColumns.has(names[0])) {
        context.translatedConstraints.p += 1;
        continue;
      }
      definitions.push({ order: 20_000 + sourceOrder[constraint.kind], sql: `CONSTRAINT ${quoteIdentifier(constraint.name)} ${prefix} (${names.map(quoteIdentifier).join(", ")})` });
      context.translatedConstraints[constraint.kind] += 1;
    } else if (constraint.kind === "f") {
      const foreignKey = translateForeignKey(constraint, context.columnsByTable, context.tableNames, context.gates);
      if (foreignKey) {
        definitions.push({ order: 30_000, sql: foreignKey });
        context.translatedConstraints.f += 1;
      }
    } else if (constraint.kind === "c") {
      const positiveDecimalCheck = translatePositiveCanonicalDecimalCheck(constraint.definition, tableColumns);
      if (positiveDecimalCheck !== null) {
        definitions.push({ order: 40_000, sql: `CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${positiveDecimalCheck})` });
        context.translatedConstraints.c += 1;
        continue;
      }
      const regexCheck = translateKnownPostgresRegexCheck(
        constraint.definition,
        tableName,
        tableColumns,
        context.databaseLocale,
      );
      if (regexCheck !== null) {
        definitions.push({ order: 40_000, sql: `CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${regexCheck})` });
        context.translatedConstraints.c += 1;
        continue;
      }
      if (representationSensitiveColumns(constraint.definition, tableColumns).length > 0) {
        context.gates.add(
          "representation_sensitive_check",
          "The source CHECK references a decimal, JSON, array, or enum representation whose PostgreSQL semantics need a reviewed D1 rewrite.",
          location,
        );
        continue;
      }
      const translated = translateCheckExpression(constraint.definition, new Set(tableColumns.map((column) => column.column_name)));
      if (translated === null) {
        context.gates.add("unsupported_check_constraint", "The source CHECK uses PostgreSQL-only syntax and needs an explicit SQLite equivalent.", location);
        continue;
      }
      definitions.push({ order: 40_000, sql: `CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${translated})` });
      context.translatedConstraints.c += 1;
    } else {
      context.gates.add("unsupported_constraint_kind", `Constraint kind ${constraint.kind} has no generator rule.`, location);
    }
  }

  definitions.sort((left, right) => left.order - right.order || left.sql.localeCompare(right.sql));
  lines.push(...definitions.map(({ sql }) => `  ${sql}`).map((line, index, all) => `${line}${index === all.length - 1 ? "" : ","}`));
  lines.push(");");
  return lines.join("\n");
}

export function convertSchema(catalogInput, options = {}) {
  if (!isPlainObject(options) || Object.keys(options).some((key) => key !== "credentialDescriptor")) {
    throw fail("invalid_schema_conversion_options");
  }
  const catalog = normalizeCatalog(catalogInput);
  const gates = new GateBook();
  const tableNames = new Set(catalog.columns.map((column) => column.table_name));
  const hasCredentialColumn = catalog.columns.some((column) => (
    column.table_name === CREDENTIAL_SOURCE_RELATION && column.column_name === CREDENTIAL_COLUMN
  ));
  let credentialDescriptorPlan = null;
  if (options.credentialDescriptor !== undefined) {
    try {
      credentialDescriptorPlan = compileCredentialDescriptor({ catalog: catalogInput, descriptor: options.credentialDescriptor });
    } catch (error) {
      throw fail(error?.code ?? "credential_descriptor_invalid", error);
    }
  } else if (hasCredentialColumn) {
    gates.add("credential_descriptor_required", "The credential column has no explicit transform descriptor and cannot use the ordinary text codec.", {
      kind: "column", table: CREDENTIAL_SOURCE_RELATION, column: CREDENTIAL_COLUMN,
    });
  }
  const columnsByTable = new Map();
  const enumLabels = buildEnumLabels(catalog.enums);
  const typeCounts = new Map();
  const translatedConstraints = { p: 0, u: 0, f: 0, c: 0 };
  const columnCodecs = [];
  const context = { gates, tableNames, columnsByTable, enumLabels, typeCounts, translatedConstraints, columnCodecs, credentialDescriptorPlan, databaseLocale: catalog.database_locale };

  for (const section of ["triggers", "rls_policies", "views", "functions"]) {
    if (!Object.hasOwn(catalogInput, section)) {
      gates.add("missing_catalog_scope", `The catalog input does not include ${section}; D1 parity cannot be claimed from this artifact.`, { kind: "catalog", name: section });
    } else {
      gates.add("unsupported_catalog_scope", `The catalog input includes ${section}, but this converter does not translate or verify that scope.`, { kind: "catalog", name: section });
    }
  }

  const tableGroups = new Map();
  for (const column of catalog.columns) {
    const group = tableGroups.get(column.table_name) ?? [];
    group.push(column);
    tableGroups.set(column.table_name, group);
  }
  const constraintsByTable = new Map();
  for (const constraint of catalog.constraints) {
    if (!tableNames.has(constraint.table_name)) {
      gates.add("orphan_catalog_constraint", "The constraint names a table absent from the catalog columns; no target DDL is emitted for it.", { kind: "constraint", table: constraint.table_name, name: constraint.name });
      continue;
    }
    const group = constraintsByTable.get(constraint.table_name) ?? [];
    group.push(constraint);
    constraintsByTable.set(constraint.table_name, group);
  }
  for (const [tableName, columns] of tableGroups.entries()) {
    columnsByTable.set(tableName, columnMap(columns));
  }
  const tableSql = [];
  for (const tableName of [...tableGroups.keys()].sort()) {
    tableSql.push(renderTable(tableName, tableGroups.get(tableName), constraintsByTable.get(tableName) ?? [], context));
  }

  const constraintNames = new Set(catalog.constraints.filter((constraint) => tableNames.has(constraint.table_name)).map((constraint) => constraint.name));
  const indexSql = [];
  for (const index of catalog.indexes) {
    if (!tableNames.has(index.table_name)) {
      gates.add("orphan_catalog_index", "The index names a table absent from the catalog columns; no target DDL is emitted for it.", { kind: "index", table: index.table_name, name: index.name });
      continue;
    }
    const translated = translateIndex(index, constraintNames, tableNames, columnsByTable, gates);
    if (translated) {
      indexSql.push(translated);
      context.translatedIndexes = (context.translatedIndexes ?? 0) + 1;
    }
  }

  const sourceSummary = {
    observedAt: catalog.observed_at,
    tableCount: tableNames.size,
    columnCount: catalog.columns.length,
    constraintCount: catalog.constraints.length,
    indexCount: catalog.indexes.length,
    enumLabelCount: catalog.enums.length,
  };
  const unresolvedGates = gates.values();
  const rowConversionGates = unresolvedGates.filter((gate) => ROW_CONVERSION_GATE_CODES.has(gate.code));
  const schemaAndOperationGates = unresolvedGates.filter((gate) => !ROW_CONVERSION_GATE_CODES.has(gate.code));
  const report = {
    schemaVersion: SCHEMA_CONVERSION_VERSION,
    source: sourceSummary,
    target: {
      dialect: "Cloudflare D1 SQLite",
      tableCount: tableNames.size,
      columnCount: catalog.columns.length,
      translatedConstraints,
      translatedIndexCount: context.translatedIndexes ?? 0,
      typeMappings: Object.fromEntries([...typeCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
      columnCodecs: columnCodecs.sort((left, right) => left.table.localeCompare(right.table) || left.column.localeCompare(right.column)),
    },
    deployable: unresolvedGates.length === 0,
    unresolvedGateCount: unresolvedGates.length,
    stageReadiness: {
      rowConversion: stageGateSummary(rowConversionGates),
      schemaAndOperations: stageGateSummary(schemaAndOperationGates),
    },
    gates: unresolvedGates,
  };
  const sql = [
    "-- Generated by scripts/migration/schema-convert.mjs.",
    "-- This is structural preparation only; inspect the adjacent gates report before applying.",
    `-- Source catalog: ${sourceSummary.tableCount} tables, ${sourceSummary.columnCount} columns, ${sourceSummary.constraintCount} constraints, ${sourceSummary.indexCount} indexes.`,
    `-- Deployable claim: ${report.deployable ? "true" : "false"}.`,
    "-- D1 SQL execution rejects explicit BEGIN/COMMIT; apply only through a reviewed migration runner.",
    "PRAGMA foreign_keys = ON;",
    ...tableSql,
    ...indexSql,
    "",
  ].join("\n\n");
  return { sql, report };
}

async function writeAtomic(filePath, content) {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export const USAGE = `Usage: schema-convert.mjs --catalog PATH --sql-out PATH --report-out PATH [--credential-descriptor PATH]

Reads a private schema-readiness catalog JSON and writes deterministic SQL plus
a machine-readable unresolved-gates report. It never applies SQL or reads rows.
Credential-bearing catalogs require an explicit, value-free transform descriptor;
the ordinary text codec is never used for the credential column.
`;

export function validateDistinctPaths(catalogPath, sqlPath, reportPath, credentialDescriptorPath) {
  const paths = [catalogPath, sqlPath, reportPath, ...(credentialDescriptorPath ? [credentialDescriptorPath] : [])]
    .map((value) => path.resolve(value));
  if (new Set(paths).size !== paths.length) throw fail("output_paths_must_differ");
  return {
    catalog: paths[0],
    sqlOut: paths[1],
    reportOut: paths[2],
    ...(credentialDescriptorPath ? { credentialDescriptor: paths[3] } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    const name = equals >= 0 ? arg.slice(0, equals) : arg;
    const value = equals >= 0 ? arg.slice(equals + 1) : args[++index];
    if (name === "--catalog") values.catalog = value;
    else if (name === "--sql-out") values.sqlOut = value;
    else if (name === "--report-out") values.reportOut = value;
    else if (name === "--credential-descriptor") values.credentialDescriptorPath = value;
    else throw fail("invalid_arguments");
  }
  if (!values.catalog || !values.sqlOut || !values.reportOut) throw fail("missing_output_argument");
  const outputPaths = validateDistinctPaths(values.catalog, values.sqlOut, values.reportOut, values.credentialDescriptorPath);
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(outputPaths.catalog, "utf8"));
  } catch (error) {
    throw fail("invalid_catalog_file", error);
  }
  let credentialDescriptor;
  if (values.credentialDescriptorPath) {
    try {
      credentialDescriptor = JSON.parse(await fs.readFile(outputPaths.credentialDescriptor, "utf8"));
    } catch (error) {
      throw fail("credential_descriptor_file_invalid", error);
    }
  }
  const result = convertSchema(catalog, credentialDescriptor === undefined ? {} : { credentialDescriptor });
  await writeAtomic(outputPaths.sqlOut, result.sql);
  await writeAtomic(outputPaths.reportOut, `${JSON.stringify(result.report, null, 2)}\n`);
  console.log(`Schema conversion generated ${result.report.target.tableCount} tables and ${result.report.unresolvedGateCount} unresolved gates.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof SchemaConversionError ? error.code : "conversion_failed";
    console.error(`Schema conversion failed (${code}).`);
    process.exitCode = 1;
  });
}

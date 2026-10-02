#!/usr/bin/env node

/**
 * Audit explicit column coverage for PostgreSQL timestamptz now() defaults
 * across Worker source, D1 SQL routines, and migration seed INSERT statements.
 * This is a static inventory only: it does not prove that bound values preserve
 * transaction-time semantics.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const INSERT_RE = /\bINSERT(?:\s+OR\s+[A-Za-z_]+)?\s+INTO\s+(?:(?:"public"|public)\s*\.\s*)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s*\(([^)]*)\)/giu;
const INSERT_TABLE_RE = /\bINSERT(?:\s+OR\s+[A-Za-z_]+)?\s+INTO\s+(?:(?:"public"|public)\s*\.\s*)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/giu;
const COLUMN_RE = /^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?$/u;

function isNowDefault(column) {
  return column.postgres_type === "timestamp with time zone" &&
    /^now\s*\(\s*\)$/iu.test(column.default_expression ?? "");
}

function parseColumns(rawColumns) {
  const columns = rawColumns.split(",").map((raw) => {
    const match = COLUMN_RE.exec(raw.trim());
    return match?.[1] ?? null;
  });
  return columns.length > 0 && columns.every(Boolean) ? columns : null;
}

function identifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name);
}

function resolveColumnArray(sourceText, name, seen = new Set()) {
  if (!identifier(name) || seen.has(name)) return null;
  const nextSeen = new Set(seen).add(name);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const arrayDeclaration = new RegExp(
    `(?:export\\s+)?const\\s+${escapedName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;`,
    "u",
  ).exec(sourceText);
  if (arrayDeclaration) {
    const values = [];
    for (const raw of arrayDeclaration[1].split(",").map((part) => part.trim()).filter(Boolean)) {
      const spread = /^\.\.\.\s*([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(raw);
      if (spread) {
        const expanded = resolveColumnArray(sourceText, spread[1], nextSeen);
        if (!expanded) return null;
        values.push(...expanded);
        continue;
      }
      const literal = /^["']([A-Za-z_][A-Za-z0-9_]*)["']$/u.exec(raw);
      if (!literal) return null;
      values.push(literal[1]);
    }
    return values.length > 0 ? values : null;
  }

  // Generated INSERT templates may map a literal string array into quoted
  // SQL identifiers, or alias a same-file field array before interpolating it.
  const alias = new RegExp(
    `(?:export\\s+)?const\\s+${escapedName}\\s*=\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?:\\.map\\s*\\()?`,
    "u",
  ).exec(sourceText);
  return alias ? resolveColumnArray(sourceText, alias[1], nextSeen) : null;
}

function generatedInsertColumns(source, table, offset) {
  const remainder = source.text.slice(offset, offset + 1600);
  const literalParts = new RegExp(
    `^INSERT\\s+INTO\\s+["\x60]?${table}["\x60]?\\s*["']\\s*\\+\\s*["']\\(([^"']+)\\)["']`,
    "iu",
  ).exec(remainder);
  if (literalParts) return parseColumns(literalParts[1]);

  const template = new RegExp(
    `^INSERT\\s+INTO\\s+["\x60]?${table}["\x60]?\\s*\\(\\s*\\$\\{\\s*([A-Za-z_$][A-Za-z0-9_$]*)`,
    "iu",
  ).exec(remainder);
  return template ? resolveColumnArray(source.text, template[1]) : null;
}

function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function sourceFiles(root, extensionPattern) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath, extensionPattern);
    return extensionPattern.test(entry.name) ? [filePath] : [];
  });
}

export function auditTimestampWriterCoverage(catalog, sources) {
  if (!catalog || !Array.isArray(catalog.columns) || !Array.isArray(sources)) {
    throw new TypeError("invalid_timestamp_writer_audit_input");
  }
  const timestampColumns = catalog.columns
    .filter(isNowDefault)
    .map(({ table_name, column_name }) => ({ table: table_name, column: column_name }))
    .sort((left, right) => left.table.localeCompare(right.table) || left.column.localeCompare(right.column));
  const columnsByTable = new Map();
  for (const column of timestampColumns) {
    const columns = columnsByTable.get(column.table) ?? [];
    columns.push(column.column);
    columnsByTable.set(column.table, columns);
  }

  const inserts = [];
  const unparsedTargetInserts = [];
  const targetTables = new Set(columnsByTable.keys());
  for (const source of sources) {
    if (typeof source?.file !== "string" || typeof source?.text !== "string") {
      throw new TypeError("invalid_timestamp_writer_source");
    }
    const parsedOffsets = new Set();
    for (const match of source.text.matchAll(INSERT_RE)) {
      const table = match[1].toLowerCase();
      if (!targetTables.has(table)) continue;
      const columns = parseColumns(match[2]) ?? generatedInsertColumns(source, table, match.index);
      if (!columns) {
        parsedOffsets.add(match.index);
        unparsedTargetInserts.push({ table, file: source.file, line: lineAt(source.text, match.index) });
        continue;
      }
      parsedOffsets.add(match.index);
      inserts.push({ table, columns: new Set(columns), file: source.file, line: lineAt(source.text, match.index) });
    }
    for (const match of source.text.matchAll(INSERT_TABLE_RE)) {
      const table = match[1].toLowerCase();
      if (targetTables.has(table) && !parsedOffsets.has(match.index)) {
        const columns = generatedInsertColumns(source, table, match.index);
        if (columns) {
          parsedOffsets.add(match.index);
          inserts.push({ table, columns: new Set(columns), file: source.file, line: lineAt(source.text, match.index) });
        } else {
          unparsedTargetInserts.push({ table, file: source.file, line: lineAt(source.text, match.index) });
        }
      }
    }
  }

  const uncoveredTimestampDefaults = [];
  for (const [table, columns] of columnsByTable) {
    const tableInserts = inserts.filter((insert) => insert.table === table);
    for (const column of columns) {
      if (tableInserts.length === 0) {
        uncoveredTimestampDefaults.push({ table, column, reason: "no_supported_insert_found" });
        continue;
      }
      for (const insert of tableInserts) {
        if (!insert.columns.has(column)) {
          uncoveredTimestampDefaults.push({
            table,
            column,
            reason: "insert_omits_timestamp_default_column",
            file: insert.file,
            line: insert.line,
          });
        }
      }
    }
  }

  return {
    observedAt: typeof catalog.observed_at === "string" ? catalog.observed_at : null,
    timestampDefaultCount: timestampColumns.length,
    targetTableCount: columnsByTable.size,
    insertStatementCount: inserts.length,
    timestampColumnWriters: inserts.map((insert) => ({
      table: insert.table,
      file: insert.file,
      line: insert.line,
      columns: (columnsByTable.get(insert.table) ?? []).filter((column) => insert.columns.has(column)),
    })).sort((left, right) => (
      left.file.localeCompare(right.file) || left.line - right.line || left.table.localeCompare(right.table)
    )),
    uncoveredTimestampDefaults,
    unparsedTargetInserts: unparsedTargetInserts.sort((left, right) => (
      left.file.localeCompare(right.file) || left.line - right.line || left.table.localeCompare(right.table)
    )),
    columnListCoverageComplete: uncoveredTimestampDefaults.length === 0 && unparsedTargetInserts.length === 0,
  };
}

function parseArgs(argv) {
  const options = { catalog: null, sourceRoots: [], sqlRoots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--catalog") options.catalog = argv[++index] ?? null;
    else if (argument === "--source-root") options.sourceRoots.push(argv[++index] ?? "");
    else if (argument === "--sql-root") options.sqlRoots.push(argv[++index] ?? "");
    else throw new Error("usage: timestamp-writer-audit.mjs --catalog <private-catalog.json> [--source-root <worker-source-directory>] [--sql-root <sql-directory>]");
  }
  if (!options.catalog || options.sourceRoots.includes("") || options.sqlRoots.includes("")) {
    throw new Error("usage: timestamp-writer-audit.mjs --catalog <private-catalog.json> [--source-root <worker-source-directory>] [--sql-root <sql-directory>]");
  }
  if (options.sourceRoots.length === 0) options.sourceRoots.push("workers/api/src");
  if (options.sqlRoots.length === 0) {
    options.sqlRoots.push("workers/api/migrations", "workers/api/migrations-business", "scripts/migration");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const catalog = JSON.parse(readFileSync(path.resolve(options.catalog), "utf8"));
  const files = [
    ...options.sourceRoots.flatMap((sourceRoot) => sourceFiles(path.resolve(sourceRoot), /\.(?:mjs|ts)$/u)),
    ...options.sqlRoots.flatMap((sqlRoot) => sourceFiles(path.resolve(sqlRoot), /\.sql$/u)),
  ];
  const sources = [...new Set(files)].map((filePath) => ({
    file: path.relative(root, filePath), text: readFileSync(filePath, "utf8"),
  }));
  const report = auditTimestampWriterCoverage(catalog, sources);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.columnListCoverageComplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write("timestamp_writer_audit_failed\n");
    process.exitCode = 1;
  });
}

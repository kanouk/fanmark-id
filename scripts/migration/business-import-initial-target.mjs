/** Initial schema/seed guard and fail-stop adapter for the Business importer.
 * These are internal mechanics, never production admission on their own.
 */
import { readBusinessRuntimeImportSchema } from './business-runtime-import-schema.mjs';
import { canonicalJson } from './snapshot-format.mjs';
import { isD1ProviderObject } from './d1-provider-objects.mjs';

const fail = () => { throw Error('business_initial_target_unconfirmed'); };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const literal = value => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && !value.includes('\0')) return "'" + value.replaceAll("'", "''") + "'";
  fail();
};

export async function prepareInitialBusinessTarget(database) {
  try {
    const runtime = await readBusinessRuntimeImportSchema();
    const schema = await database.prepare("SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name").all();
    if (schema?.success !== true || schema.meta?.rows_written !== 0 || !Array.isArray(schema.results) ||
        canonicalJson(schema.results.filter(o => !isD1ProviderObject(o.type, o.name))) !== canonicalJson(runtime.objects)) fail();
    // Only checked-in migration seeds enter this SQL. No caller/source values.
    // The same predicate runs again inside the first ledger-creation transaction.
    const tableSource = table => quote(table.name) + (table.name === 'sqlite_sequence' ? " WHERE name NOT IN ('d1_migrations', '_cf_KV', '_cf_METADATA')" : '');
    const dirty = runtime.initialTables.flatMap(table => [
      `(SELECT count(*) FROM ${tableSource(table)}) <> ${table.rows.length}`,
      ...table.rows.map(row => `NOT EXISTS (SELECT 1 FROM ${quote(table.name)} WHERE ${Object.entries(row).map(([key, value]) => `${quote(key)} IS ${literal(value)}`).join(' AND ')})`),
    ]).join(' OR ');
    const result = await database.prepare(`SELECT CASE WHEN ${dirty} THEN 1 ELSE 0 END AS dirty`).all();
    if (result?.success !== true || result.meta?.rows_written !== 0 || result.results?.length !== 1 || result.results[0].dirty !== 0) fail();
    const guard = `INSERT INTO "__fanmark_d1_import_guards" (token, must_be_one) SELECT 'initial-state', 0 WHERE ${dirty}`;
    if (Buffer.byteLength(guard) > 100000) fail();
    return guard;
  } catch { fail(); }
}

/** Poison ALL operations after any failed call or malformed acknowledgement.
 * Shared retry/readback/error handlers cannot continue this import attempt.
 * Native statements never escape; independent inspection uses another binding.
 */
export function createStopOnFailureD1(original) {
  let stopped = false;
  const prepared = new WeakMap();
  function check() { if (stopped) throw Error('business_import_attempt_stopped'); }
  async function execute(operation, count) {
    check();
    try {
      const result = await operation();
      const rows = count === null ? [result] : result;
      if (!Array.isArray(rows) || (count !== null && rows.length !== count) || rows.some(row =>
        row?.success !== true || !Array.isArray(row.results) || !row.meta || typeof row.meta !== 'object')) throw Error();
      return result;
    } catch { stopped = true; throw Error('business_import_attempt_stopped'); }
  }
  function prepare(sql, values = []) {
    check();
    let native;
    try { native = original.prepare(sql).bind(...values); }
    catch { stopped = true; throw Error('business_import_attempt_stopped'); }
    const statement = Object.freeze({ bind: (...next) => prepare(sql, next),
      all: () => execute(() => native.all(), null), run: () => execute(() => native.run(), null),
      async first(column) { const row = (await this.all()).results[0] ?? null; return column === undefined ? row : row?.[column] ?? null; },
    });
    prepared.set(statement, native); return statement;
  }
  return Object.freeze({ prepare, batch: statements => execute(() => {
    if (!Array.isArray(statements) || statements.length === 0 || statements.some(statement => !prepared.has(statement))) throw Error();
    return original.batch(statements.map(statement => prepared.get(statement)));
  }, statements?.length) });
}

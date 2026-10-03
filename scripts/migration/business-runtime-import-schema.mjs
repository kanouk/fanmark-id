/** Exact local import profile derived from the checked-in runtime migrations. */
import { readFile } from "node:fs/promises";
import { BUSINESS_MIGRATION_SEQUENCE } from "./business-migration-ledger.mjs";
import { isD1ProviderObject } from "./d1-provider-objects.mjs";
import { sha256Hex } from "./snapshot-format.mjs";

// Trusted migration SQL only; quoted text/comments cannot open trigger blocks.
export function businessMigrationStatements(sql) {
  const result = [];
  let start = 0;
  let depth = 0;
  let trigger = false;
  let words = [];
  for (const token of sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_]\w*|;/gu)) {
    const value = token[0];
    if (/^(?:--|\/\*|'|")/u.test(value)) continue;
    const word = value.toUpperCase();
    if (word !== ";") {
      words.push(word);
      if (words[0] === "CREATE" && word === "TRIGGER") trigger = true;
      if (trigger && (word === "BEGIN" || word === "CASE")) depth += 1;
      if (trigger && word === "END") depth -= 1;
    } else if (depth === 0) {
      const statement = sql.slice(start, token.index).trim();
      if (statement.replace(/--[^\n]*/gu, "").trim()) result.push(statement);
      start = token.index + 1;
      words = [];
      trigger = false;
    }
  }
  if (depth !== 0 || sql.slice(start).replace(/--[^\n]*/gu, "").trim()) throw new Error("business_migration_sql_incomplete");
  return result;
}

export async function readBusinessRuntimeMigrations() {
  return Promise.all(BUSINESS_MIGRATION_SEQUENCE.map(async name => ({
    name, sql: await readFile(new URL(`../../workers/api/migrations-business/${name}`, import.meta.url), "utf8"),
  })));
}

export async function applyBusinessRuntimeMigrations(database, migrations = null) {
  const sequence = migrations ?? await readBusinessRuntimeMigrations();
  for (const migration of sequence) {
    const results = await database.batch(businessMigrationStatements(migration.sql).map(sql => database.prepare(sql)));
    if (results.some(result => result.success !== true)) throw new Error("business_runtime_migration_failed");
  }
}

async function schemaObjects(database) {
  const result = await database.prepare("SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' AND type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name").all();
  return result.results.filter(object => !isD1ProviderObject(object.type, object.name));
}

let cached = null;
export async function readBusinessRuntimeImportSchema() {
  const migrations = await readBusinessRuntimeMigrations();
  const migrationDigests = migrations.map(({ name, sql }) => ({ name, sha256: sha256Hex(sql) }));
  const digest = sha256Hex(migrationDigests);
  if (cached?.digest === digest) return cached.promise;
  const promise = (async () => {
    const { Miniflare } = await import(new URL("../../workers/api/node_modules/miniflare/dist/src/index.js", import.meta.url).href);
    const miniflare = new Miniflare({ workers: [{ config: {
      name: "fanmark-runtime-import-schema", type: "worker", compatibilityDate: "2026-09-18",
      env: { DB: { type: "d1", name: "fanmark-runtime-import-schema" } },
      manifest: { mainModule: "index.js", modules: {
        "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" },
      } },
    } }] });
    try {
      const database = await miniflare.getD1Database("DB");
      await applyBusinessRuntimeMigrations(database, migrations);
      const objects = await schemaObjects(database);
      const fingerprint = sha256Hex({ migrationDigests, objects });
      return Object.freeze({ migrationDigests, objects, fingerprint });
    } finally {
      await miniflare.dispose();
    }
  })();
  cached = { digest, promise };
  try { return await promise; } catch (error) { cached = null; throw error; }
}

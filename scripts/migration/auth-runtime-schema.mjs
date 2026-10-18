/** Operator-side canonical Auth schema check; native local schema is rebuilt
 * from the same four migration files selected for the production Auth D1.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { isD1ProviderObject } from './d1-provider-objects.mjs';

const files = ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql'];
const sql = "SELECT type,name,sql FROM sqlite_master WHERE substr(name,1,7)<>'sqlite_' AND type IN ('table','index','view','trigger') ORDER BY type,name";
const fail = () => { throw Error('auth_runtime_schema_unconfirmed'); };
let canonical;
async function inventory(database) {
  let result;
  try { result = await database.prepare(sql).all(); } catch { fail(); }
  if (result?.success !== true || result.meta?.rows_written !== 0 || !Array.isArray(result.results) ||
      result.results.some(row => !row || Object.keys(row).sort().join(',') !== 'name,sql,type' ||
        typeof row.name !== 'string' || typeof row.type !== 'string' || (row.sql !== null && typeof row.sql !== 'string'))) fail();
  return result.results.filter(row => !isD1ProviderObject(row.type, row.name)).map(({ type, name, sql }) => ({ type, name, sql }));
}
async function buildCanonical() {
  const mf = new Miniflare({ workers: [{ config: { name: 'auth-schema-reference', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'auth-schema-reference' } }, manifest: { mainModule: 'index.js',
      modules: { 'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("local")}}' } } } } }] });
  try {
    const database = await mf.getD1Database('DB');
    for (const file of files) {
      const source = await readFile(new URL('../../workers/api/migrations/' + file, import.meta.url), 'utf8');
      await database.batch(businessMigrationStatements(source).map(statement => database.prepare(statement)));
    }
    return JSON.stringify(await inventory(database));
  } finally { await mf.dispose(); }
}
export async function verifyAuthRuntimeSchema(database) {
  try {
    canonical ??= buildCanonical();
    const expected = await canonical, actual = JSON.stringify(await inventory(database));
    if (actual !== expected) fail();
    return { schemaSha256: createHash('sha256').update(actual).digest('hex') };
  } catch { fail(); }
}

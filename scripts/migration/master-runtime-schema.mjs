/** Operator-side canonical Master schema check; native local schema is rebuilt
 * from the same nine migration files selected for the production Master D1.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { isD1ProviderObject } from './d1-provider-objects.mjs';
import { isProductionRemoteD1 } from './production-d1-brand.mjs';

export const MASTER_RUNTIME_MIGRATIONS = Object.freeze(['0000_emoji_master.sql', '0001_emoji_master_release_staging.sql', '0002_emoji_master_release_activation.sql', '0003_better_auth_core.sql', '0004_reference_master_releases.sql', '0005_emoji_master_admin_guards.sql', '0006_reference_master_extension_prices.sql', '0007_release_audit_timestamps.sql', '0008_emoji_master_change_audits.sql']);
export const MASTER_PRODUCTION_IMPORT_MIGRATIONS=Object.freeze(['0000_import_operation_commits.sql','0001_import_commit_no_replace.sql']);
const sql = "SELECT type,name,sql FROM sqlite_master WHERE substr(name,1,7)<>'sqlite_' AND type IN ('table','index','view','trigger') ORDER BY type,name";
const fail = () => { throw Error('master_runtime_schema_unconfirmed'); };
const canonical = new Map();
async function inventory(database) {
  let result;
  try { result = await database.prepare(sql).all(); } catch { fail(); }
  if (result?.success !== true || result.meta?.rows_written !== 0 || !Array.isArray(result.results) ||
      result.results.some(row => !row || Object.keys(row).sort().join(',') !== 'name,sql,type' ||
        typeof row.name !== 'string' || typeof row.type !== 'string' || (row.sql !== null && typeof row.sql !== 'string'))) fail();
  return result.results.filter(row => !isD1ProviderObject(row.type, row.name)).map(({ type, name, sql }) => ({ type, name, sql }));
}
async function buildCanonical(importCommitReceipts) {
  const mf = new Miniflare({ workers: [{ config: { name: 'master-schema-reference', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'master-schema-reference' } }, manifest: { mainModule: 'index.js',
      modules: { 'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("local")}}' } } } } }] });
  try {
    const database = await mf.getD1Database('DB');
    for (const file of MASTER_RUNTIME_MIGRATIONS) {
      const source = await readFile(new URL('../../workers/api/migrations/' + file, import.meta.url), 'utf8');
      await database.batch(businessMigrationStatements(source).map(statement => database.prepare(statement)));
    }
    if(importCommitReceipts)for(const file of MASTER_PRODUCTION_IMPORT_MIGRATIONS){
      const source=await readFile(new URL('../../workers/api/migrations-master-production/'+file,import.meta.url),'utf8');
      await database.batch(businessMigrationStatements(source).map(statement=>database.prepare(statement)));
    }
    return JSON.stringify(await inventory(database));
  } finally { await mf.dispose(); }
}
export async function verifyMasterRuntimeSchema(database, {importCommitReceipts=isProductionRemoteD1(database)?true:null}={}) {
  try {
    const actual=JSON.stringify(await inventory(database));
    const profiles=importCommitReceipts===null?[false,true]:[importCommitReceipts];
    let matched=false;
    for(const profile of profiles){
      if(!canonical.has(profile))canonical.set(profile,buildCanonical(profile));
      if(actual===await canonical.get(profile)){matched=true;break;}
    }
    if (!matched) fail();
    return { schemaSha256: createHash('sha256').update(actual).digest('hex') };
  } catch { fail(); }
}

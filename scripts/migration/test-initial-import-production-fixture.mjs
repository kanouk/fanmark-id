/** Native stores/services/DO with a synthetic Cloudflare control plane. No network. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { PRODUCTION_D1_TARGETS, createProductionRemoteD1, openProductionD1ImportTransport, isReadOnlyProductionSql } from './production-remote-d1.mjs';
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';
import { createProductionRemoteR2, openProductionR2ImportTransport } from './production-remote-r2.mjs';
import { createProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from '../../workers/api/src/production-runtime-identity.ts';
import { applyBusinessRuntimeMigrations, businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { MASTER_RUNTIME_MIGRATIONS } from './master-runtime-schema.mjs';

export async function createNativeProductionSetFixture({ directory, prepared, input }) {
 await mkdir(directory, { mode: 0o700 });
 const version = randomUUID(), gatewayVersion = randomUUID(), counters = { d1Writes: 0, r2Writes: 0, loseCommittedMaster: false, loseComplete: false };
 const origins = Object.fromEntries(['read-only', 'import'].map(mode => [mode, 'https://fanmark-prod-import-' + randomUUID() + '.fanmark-id.workers.dev']));
 const bundled = await build({ stdin: { contents: `export { RecoveryWriterCoordinatorProduction } from './recovery-writer-drain';
 export { ProductionR2ImportService } from './production-r2-import-service';
 export default {async fetch(r,e){const u=new URL(r.url);if(u.pathname.startsWith('/command/'))
 return e.RECOVERY_DRAIN.get(e.RECOVERY_DRAIN.idFromName('recovery-writers-v1')).fetch('https://recovery-writer.internal/migration/'+u.pathname.slice(9),{method:'POST',body:await r.text()});
 return e.IMPORT.fetch(new Request('https://production-import-r2.internal'+u.pathname.slice(3)+u.search,r));}};`,
 resolveDir: fileURLToPath(new URL('../../workers/api/src', import.meta.url)), loader: 'ts' }, bundle: true, write: false,
 format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
 const text = value => ({ type: 'text', value });
 const mf = new Miniflare({ workers: [{ config: { name: 'initial-production-fixture', type: 'worker', compatibilityDate: '2026-09-18',
 exports: { RecoveryWriterCoordinatorProduction: { type: 'durable-object', storage: 'sqlite' } }, env: {
 RECOVERY_DRAIN: { type: 'durable-object', worker: 'initial-production-fixture', exportName: 'RecoveryWriterCoordinatorProduction' },
 IMPORT: { type: 'worker', worker: 'initial-production-fixture', exportName: 'ProductionR2ImportService' },
 RECOVERY_DRAIN_SCOPE_DIGEST: text(PRODUCTION_RUNTIME.scope), RECOVERY_DRAIN_BACKEND: text('durable-object'),
 D1_TOPOLOGY: text('split'), STORAGE_BACKEND: text('r2'), CUTOVER_WRITE_FREEZE: text('receipt_only'),
 STAGING_BACKUP_SOURCE_IDS: text(JSON.stringify(PRODUCTION_STORE_IDS)), CF_VERSION_METADATA: { type: 'json', value: { id: version } },
 AUTH_DB: { type: 'd1', name: 'native-auth' }, MASTER_DB: { type: 'd1', name: 'native-master' }, FANMARK_DB: { type: 'd1', name: 'native-business' },
 AVATARS_BUCKET: { type: 'r2', name: 'native-avatars' }, COVER_IMAGES_BUCKET: { type: 'r2', name: 'native-covers' } },
 manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundled.outputFiles[0].text } } } },
 dev: { outboundService: { type: 'fetcher', handler() { throw Error('external_network_forbidden'); } } } }] });
 try {
 const native = { auth: await mf.getD1Database('AUTH_DB'), master: await mf.getD1Database('MASTER_DB'), business: await mf.getD1Database('FANMARK_DB') };
 for (const [store, migrations] of Object.entries({ auth: ['0003_better_auth_core.sql','0007_auth_signup_command.sql','0008_auth_user_suspension.sql','0009_auth_oauth_signup.sql'], master: MASTER_RUNTIME_MIGRATIONS }))
  for (const name of migrations) await native[store].batch(businessMigrationStatements(await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url),'utf8')).map(sql => native[store].prepare(sql)));
 await applyBusinessRuntimeMigrations(native.business);
 const coordinator = createProductionImportCoordinator({ owner: input.runId, incarnations: input.incarnations, manifestSha256: prepared.identitySha256,
 command: async (action, args) => { const r = await mf.dispatchFetch('https://fixture.local/command/' + action,{ method:'POST',body:JSON.stringify(args) }); if(r.status!==200)throw Error('native_coordinator_refused');const value=await r.json();if(action==='complete'&&counters.loseComplete){counters.loseComplete=false;throw Error('synthetic lost completion response');}return value; } });
 await coordinator.claim();
 const runtimeBindings = [
  ...PRODUCTION_D1_TARGETS.map(row => ({ type:'d1',name:{auth:'AUTH_DB',master:'MASTER_DB',business:'FANMARK_DB'}[row.databaseName.replace('fanmark-production-','')],id:row.databaseId })),
  ...PRODUCTION_R2_TARGETS.map(row => ({ type:'r2_bucket',name:row.store==='avatars'?'AVATARS_BUCKET':'COVER_IMAGES_BUCKET',bucket_name:row.bucketName })),
  ...Object.entries({D1_TOPOLOGY:'split',EMOJI_PUBLICATION_BACKEND:'production-service',RECOVERY_DRAIN_SCOPE_DIGEST:PRODUCTION_RUNTIME.scope,RECOVERY_DRAIN_BACKEND:'durable-object',CUTOVER_WRITE_FREEZE:'receipt_only',STORAGE_BACKEND:'r2'}).map(([name,text])=>({name,type:'plain_text',text})),
 ];
 const fetchImpl = async (url, options) => {
  assert.equal(options.redirect,'error');const u=new URL(url);
  if(u.hostname==='api.cloudflare.com'){
   if(u.pathname.includes('/d1/database/')){
    const target=PRODUCTION_D1_TARGETS.find(row=>u.pathname.includes('/'+row.databaseId));assert.ok(target);
    if(options.method==='GET')return Response.json({success:true,result:{uuid:target.databaseId,name:target.databaseName,created_at:target.createdAt}});
    const store=target.databaseName.replace('fanmark-production-',''),body=JSON.parse(options.body),batch=body.batch??[body];
    const mutation=batch.some(row=>!isReadOnlyProductionSql(row.sql));if(mutation)counters.d1Writes++;
    const result=await native[store].batch(batch.map(row=>native[store].prepare(row.sql).bind(...(row.params??[]))));
    if(mutation&&store==='master'&&counters.loseCommittedMaster){counters.loseCommittedMaster=false;throw Error('synthetic lost committed response');}
    if(mutation&&store==='business'&&counters.loseCommittedReceipts&&batch.some(row=>/INSERT INTO "stripe_webhook_receipts"/u.test(row.sql))){counters.loseCommittedReceipts=false;throw Error('synthetic lost receipt response');}
    return Response.json({success:true,result});
   }
   let result;
   if(u.pathname.includes('/r2/buckets/')){const target=PRODUCTION_R2_TARGETS.find(row=>u.pathname.endsWith('/'+row.bucketName));assert.ok(target);result={name:target.bucketName,creation_date:target.createdAt,storage_class:'Standard'};}
   else{
    const runtime=u.pathname.includes('/'+PRODUCTION_RUNTIME.worker+'/');
    const mode=Object.keys(origins).find(mode=>u.pathname.includes('/'+new URL(origins[mode]).hostname.split('.')[0]+'/'));assert.ok(runtime||mode);
    if(u.pathname.endsWith('/deployments'))result={deployments:[{versions:[{percentage:100,version_id:runtime?version:gatewayVersion}]}]};
    else{assert.ok(u.pathname.endsWith('/settings'));result={bindings:runtime?runtimeBindings:[{name:'R2_IMPORT',type:'service',service:PRODUCTION_RUNTIME.worker,entrypoint:'ProductionR2ImportService'},{name:'EXPECTED_RUNTIME',text:version},{name:'GATE_ACCESS',text:mode},{name:'EXPIRES_AT',text:String(Date.now()+600000)}]};}
   }
   return Response.json({success:true,result});
  }
  assert.ok(Object.values(origins).includes(u.origin));if(options.method==='PUT')counters.r2Writes++;
  return mf.dispatchFetch('https://fixture.local'+u.pathname+u.search,options);
 };
 const journalPaths={},databases={},readDatabases={},buckets={},readBuckets={};
 for(const row of PRODUCTION_D1_TARGETS){const store=row.databaseName.replace('fanmark-production-',''),target={...row,targetIncarnation:input.incarnations[store]};journalPaths[store]=join(directory,store+'.jsonl');
  readDatabases[store]=createProductionRemoteD1({target,token:'synthetic_token_only',fetchImpl});
  databases[store]=await openProductionD1ImportTransport({target,token:'synthetic_token_only',fetchImpl,journalPath:journalPaths[store],runId:input.runId,coordinator});}
 for(const row of PRODUCTION_R2_TARGETS){const store=row.store,target={...row,targetIncarnation:input.incarnations[store]},common={target,runtimeVersion:version,gatewayVersion,bearer:'b'.repeat(64),token:'synthetic_token_only',fetchImpl};journalPaths[store]=join(directory,store+'.jsonl');
  readBuckets[store]=createProductionRemoteR2({...common,gatewayOrigin:origins['read-only']});
  buckets[store]=await openProductionR2ImportTransport({...common,gatewayOrigin:origins.import,journalPath:journalPaths[store],runId:input.runId,coordinator});}
 return { coordinator, journalPaths, databases, readDatabases, buckets, readBuckets, counters, native, dispose:()=>mf.dispose() };
 }catch(error){await mf.dispose();throw error;}
}

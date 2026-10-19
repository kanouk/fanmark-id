import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {PRODUCTION_D1_TARGETS} from './production-d1-targets.mjs';
import {PRODUCTION_R2_TARGETS} from './production-r2-targets.mjs';
import {quarantineProductionImportExecution} from './production-import-quarantine.mjs';
import {sha256Hex} from './snapshot-format.mjs';

for(const store of ['master','business','avatars','covers'])test('partial '+store+' quarantine preserves committed data and unknown ACKs', {timeout:60000},async t=>{
 const directory=await mkdtemp(join(await realpath(tmpdir()),'fanmark-import-quarantine-'));await chmod(directory,0o700);
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const source=fileURLToPath(new URL('../../workers/api/src',import.meta.url));
 const built=await build({stdin:{contents:`export { RecoveryWriterCoordinatorProduction } from './recovery-writer-drain';
 export { ProductionImportCoordinatorService } from './production-import-coordinator';
 export default {async fetch(r,e){try{const {action,input}=await r.json();return Response.json(await e.COORDINATOR.command(action,input));}catch{return new Response(null,{status:409});}}};`,
 resolveDir:source,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const mf=new Miniflare({workers:[{config:{name:'quarantine-fixture',type:'worker',compatibilityDate:'2026-09-18',
  exports:{RecoveryWriterCoordinatorProduction:{type:'durable-object',storage:'sqlite'}},env:{
   RECOVERY_DRAIN:{type:'durable-object',worker:'quarantine-fixture',exportName:'RecoveryWriterCoordinatorProduction'},
   COORDINATOR:{type:'worker',worker:'quarantine-fixture',exportName:'ProductionImportCoordinatorService'},
   RECOVERY_DRAIN_SCOPE_DIGEST:{type:'text',value:'6c6685377bca7b2e24d637b4a43888b77a16e280fdc587ce42623156cd615e9d'},
   RECOVERY_DRAIN_BACKEND:{type:'text',value:'durable-object'},CUTOVER_WRITE_FREEZE:{type:'text',value:'receipt_only'},
   DB:{type:'d1',name:'partial-store'},IMAGES:{type:'r2',name:'partial-images'}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}},
  dev:{outboundService:{type:'fetcher',handler(){throw Error('external_network_forbidden');}}}}]});
 t.after(()=>mf.dispose());
 const runId=randomUUID(),manifestSha256='a'.repeat(64),sourceEvidenceSha256='b'.repeat(64);
 const child=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',
  `import {createImportExecutionLock} from ${JSON.stringify(new URL('./production-import-execution-lock.mjs',import.meta.url).href)};
   const lock=await createImportExecutionLock(${JSON.stringify({directory,runId,manifestSha256,sourceEvidenceSha256})});
   console.log(JSON.stringify({executorId:lock.executorId,processId:process.pid}));`])).stdout);
 const incarnations=Object.fromEntries(['auth','master','business','avatars','covers'].map(s=>[s,randomUUID()]));
 let loseQuarantine=false;
 const command=async(action,input)=>{
  const r=await mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({action,input})});
  if(r.status!==200)throw Error('refused');
  if(action==='quarantine'&&loseQuarantine)throw Error('lost_after_commit');
  return r.json();
 };
 const coordinator=createProductionImportCoordinator({owner:runId,manifestSha256,incarnations,command});
 await coordinator.claim();await coordinator.acquireExecution(child.executorId);
 const operationId=randomUUID(),batchSha256='c'.repeat(64),journalPaths={};
 for(const s of Object.keys(incarnations)){
  journalPaths[s]=join(directory,s+'.jsonl');
  const targetId=PRODUCTION_D1_TARGETS.find(r=>r.databaseName==='fanmark-production-'+s)?.databaseId??PRODUCTION_R2_TARGETS.find(r=>r.store===s).bucketName;
  const rows=[{type:'identity',format:'fanmark-production-import-journal-v1',runId,targetId,targetIncarnation:incarnations[s]}];
  if(s===store)rows.push({type:'intent',operationId,batchSha256});
  await writeFile(journalPaths[s],rows.map(r=>JSON.stringify(r)+'\n').join(''),{mode:0o600});
 }
 await coordinator.beforeWrite({store,operationId,batchSha256});
 // Real local provider commit; its acknowledgement is deliberately never sent.
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('IMAGES');
 await db.prepare('CREATE TABLE retained(id INTEGER PRIMARY KEY,value TEXT)').run();
 await db.prepare('INSERT INTO retained VALUES(1,?)').bind('partial-'+store).run();
 await bucket.put('retained-'+store,'partial-bytes-'+store);
 const dataBefore=(await db.prepare('SELECT * FROM retained').all()).results;
 const filesBefore=Object.fromEntries(await Promise.all(Object.values(journalPaths).map(async p=>[p,sha256Hex(await readFile(p))])));
 const options={coordinator:createProductionImportCoordinator({owner:runId,manifestSha256,incarnations,command}),journalPaths,sourceEvidenceSha256};
 // A live PID cannot be quarantined by this recovery wrapper.
 const lockPath=join(directory,'.initial-import-execution.lock'),lock=JSON.parse(await readFile(lockPath,'utf8'));
 await writeFile(lockPath,JSON.stringify({...lock,processId:process.pid})+'\n');
 await assert.rejects(quarantineProductionImportExecution(options));
 assert.ok(!(await readdir(directory)).some(p=>p.startsWith('import-quarantine-')));
 await writeFile(lockPath,JSON.stringify(lock)+'\n');
 if(store==='covers')loseQuarantine=true;
 if(loseQuarantine)await assert.rejects(quarantineProductionImportExecution(options));
 else assert.equal((await quarantineProductionImportExecution(options)).importPermanentlyBlocked,true);
 const observed=await coordinator.inspect();
 assert.equal(observed.quarantine.owner,runId);assert.equal(observed.state.pending.operationId,operationId);
 assert.equal(observed.state.acknowledged,0);assert.equal(observed.executorId,child.executorId);assert.equal(observed.fenceOwner,runId);
 await assert.rejects(coordinator.afterWrite({store,operationId,batchSha256}));
 await assert.rejects(coordinator.beforeWrite({store,operationId:randomUUID(),batchSha256}));
 await assert.rejects(quarantineProductionImportExecution(options));
 assert.deepEqual((await db.prepare('SELECT * FROM retained').all()).results,dataBefore);
 assert.equal(await (await bucket.get('retained-'+store)).text(),'partial-bytes-'+store);
 for(const [p,hash] of Object.entries(filesBefore))assert.equal(sha256Hex(await readFile(p)),hash);
 assert.deepEqual(JSON.parse(await readFile(lockPath,'utf8')),lock);
 assert.ok((await readdir(directory)).includes('import-quarantine-'+child.executorId+'.json.lock'));
});

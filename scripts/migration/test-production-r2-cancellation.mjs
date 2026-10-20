import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {openProductionImportJournal} from './production-import-journal.mjs';
import {inspectProductionImportSet,inspectProductionImportJournal,recoverCancelledProductionR2Import} from './production-import-inspection.mjs';
import {cancelUndispatchedProductionR2} from './production-r2-cancellation.mjs';
import {PRODUCTION_D1_TARGETS} from './production-d1-targets.mjs';
import {PRODUCTION_R2_TARGETS} from './production-r2-targets.mjs';

const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
test('exited executor seals its native R2 intent, repairs append-only journal and rejects delayed writes',{timeout:60000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fanmark-r2-cancel-'));await chmod(dir,0o700);
 const built=await build({stdin:{contents:`export {RecoveryWriterCoordinatorProductionV3} from './recovery-writer-drain';
 export {ProductionImportCoordinatorService} from './production-import-coordinator';
 export default {async fetch(r,e){try{const {action,input}=await r.json();
 if(action==='put'){await e.COORDINATOR.command('dispatch',input);await e.IMAGES.put(input.operationId,'synthetic image');return Response.json({written:true});}
 return Response.json(await e.COORDINATOR.command(action,input));}catch{return Response.json(null,{status:409});}}};`,
 resolveDir:join(here,'../../workers/api/src'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const mf=new Miniflare({workers:[{config:{name:'cancel-fixture',type:'worker',compatibilityDate:'2026-09-18',
 exports:{RecoveryWriterCoordinatorProductionV3:{type:'durable-object',storage:'sqlite'}},env:{
 RECOVERY_DRAIN:{type:'durable-object',worker:'cancel-fixture',exportName:'RecoveryWriterCoordinatorProductionV3'},
 COORDINATOR:{type:'worker',worker:'cancel-fixture',exportName:'ProductionImportCoordinatorService'},
 RECOVERY_DRAIN_SCOPE_DIGEST:{type:'text',value:'01c9f04b4679081b56a66754f041faa2df8533e8f911299f6eb67315d524f4b4'},
 RECOVERY_DRAIN_BACKEND:{type:'text',value:'durable-object'},CUTOVER_WRITE_FREEZE:{type:'text',value:'receipt_only'},IMAGES:{type:'r2',name:'owned-images'}},
 manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}},
 dev:{outboundService:{type:'fetcher',handler(){throw Error('external_network_forbidden');}}}}]});
 try{
 const bucket=await mf.getR2Bucket('IMAGES');
 await t.test('confirmed seal, late arrival, lost response and tampered local proof',async()=>{
  const runDir=join(dir,randomUUID());await import('node:fs/promises').then(fs=>fs.mkdir(runDir,{mode:0o700}));
  const owner=randomUUID(),manifestSha256='a'.repeat(64),sourceEvidenceSha256='b'.repeat(64);
  const incarnations=Object.fromEntries(['auth','master','business','avatars','covers'].map(k=>[k,randomUUID()]));
  const journalPaths=Object.fromEntries(Object.keys(incarnations).map(k=>[k,join(runDir,k+'.jsonl')]));
  const script=`import {createImportExecutionLock} from ${JSON.stringify(join(here,'production-import-execution-lock.mjs'))};
   import {openProductionImportJournal} from ${JSON.stringify(join(here,'production-import-journal.mjs'))};
   const lock=await createImportExecutionLock(${JSON.stringify({directory:runDir,runId:owner,manifestSha256,sourceEvidenceSha256})});
   const journal=await openProductionImportJournal(${JSON.stringify({path:journalPaths.avatars,runId:owner,targetId:PRODUCTION_R2_TARGETS.find(x=>x.store==='avatars').bucketName,targetIncarnation:incarnations.avatars})});
   const operationId=await journal.beforeWrite('c'.repeat(64));console.log(JSON.stringify({executorId:lock.executorId,operationId}));`;
  const child=JSON.parse((await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',script])).stdout);
  let lose=false;
  const command=async(action,input)=>{const r=await mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({action,input})});
   if(r.status!==200)throw Error('fixture_refused');if(lose&&action==='cancel-undispatched-r2'){lose=false;throw Error('lost_response');}return r.json();};
  const options={owner,manifestSha256,incarnations,command},writer=createProductionImportCoordinator(options);
  await writer.claim();await writer.acquireExecution(child.executorId);await writer.beforeWrite({operationId:child.operationId,batchSha256:'c'.repeat(64),store:'avatars'});
  for(const store of ['auth','master','business','covers'])await openProductionImportJournal({path:journalPaths[store],runId:owner,
   targetId:PRODUCTION_D1_TARGETS.find(x=>x.store===store)?.databaseId??PRODUCTION_R2_TARGETS.find(x=>x.store===store).bucketName,targetIncarnation:incarnations[store]});
  const inspector=createProductionImportCoordinator(options);
  const result=await cancelUndispatchedProductionR2({directory:runDir,runId:owner,manifestSha256,sourceEvidenceSha256,journalPaths,store:'avatars',coordinator:inspector});
  assert.equal(result.providerWrites,0);assert.equal(result.originalRequestPermanentlyRejected,true);
  const journal=await inspectProductionImportJournal(journalPaths.avatars);assert.equal(journal.pending,null);assert.equal(journal.lock,null);assert.equal(journal.operations.length,0);assert.equal(journal.cancelled.length,1);
  assert.equal((await readFile(journalPaths.avatars,'utf8')).includes('"type":"intent"'),true);
  assert.equal((await inspectProductionImportSet({journalPaths,coordinator:inspector})).journalsReconciled,true);
  const put=input=>mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({action:'put',input})});
  const original={owner,operationId:child.operationId,batchSha256:'c'.repeat(64),store:'avatars'};
  assert.equal((await put(original)).status,409);assert.equal((await bucket.list()).objects.length,0);
  await assert.rejects(writer.beforeWrite({...original}));
  const next=randomUUID();await writer.beforeWrite({...original,operationId:next});
  assert.equal((await put(original)).status,409);assert.equal((await put({...original,operationId:next})).status,200);
  await writer.afterWrite({...original,operationId:next});assert.equal((await bucket.list()).objects.length,1);
  // Lost sealing response: durable tombstone is authoritative; the original local intent remains locked.
  const path=journalPaths.covers,incarnation=incarnations.covers;
  const child2script=script.slice(0,script.indexOf('const lock='))+`const journal=await openProductionImportJournal(${JSON.stringify({path,runId:owner,targetId:PRODUCTION_R2_TARGETS.find(x=>x.store==='covers').bucketName,targetIncarnation:incarnation})});
   console.log(JSON.stringify({operationId:await journal.beforeWrite('d'.repeat(64))}));`;
  const child2=JSON.parse((await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',child2script])).stdout);
  await writer.beforeWrite({operationId:child2.operationId,batchSha256:'d'.repeat(64),store:'covers'});
  const state=await inspector.inspect();lose=true;
  await assert.rejects(inspector.cancelUndispatchedR2({executorId:child.executorId,operationId:child2.operationId,batchSha256:'d'.repeat(64),store:'covers',
   stateSha256:(await import('node:crypto')).createHash('sha256').update(JSON.stringify(state.state)).digest('hex'),proofSha256:'e'.repeat(64)}));
  assert.ok((await inspectProductionImportJournal(path)).pending);
  assert.equal((await inspector.inspectOperation(child2.operationId)).cancelled.proofSha256,'e'.repeat(64));
  await recoverCancelledProductionR2Import({journalPath:path,coordinator:inspector});
  assert.equal((await inspectProductionImportJournal(path)).pending,null);
  // Fabricated local cancellation cannot reconcile without the exact durable tombstone proof.
  const text=await readFile(path,'utf8');await writeFile(path,text.replace('e'.repeat(64),'f'.repeat(64)));
  await assert.rejects(inspectProductionImportSet({journalPaths,coordinator:inspector}));await writeFile(path,text);
 });
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

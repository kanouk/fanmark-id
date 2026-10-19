import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,chmod,rm,readFile,writeFile,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {PRODUCTION_D1_TARGETS,openProductionD1ImportTransport,createProductionRemoteD1,isReadOnlyProductionSql} from './production-remote-d1.mjs';
import {businessMigrationStatements} from './business-runtime-import-schema.mjs';
import {importAuthProjectionStage} from './auth-import-stage.mjs';
import {inspectProductionImportSet,inspectProductionImportJournal,inspectProductionImportAttempt,recoverAcknowledgedProductionImport} from './production-import-inspection.mjs';
import {openProductionImportJournal} from './production-import-journal.mjs';
import {PRODUCTION_R2_TARGETS} from './production-r2-targets.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('native production coordinator and separate filesystem journals jointly guard real D1 writes', {timeout:60000}, async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fanmark-global-import-'));await chmod(dir,0o700);
 const source=fileURLToPath(new URL('../../workers/api/src',import.meta.url));
 const built=await build({stdin:{contents:`export { RecoveryWriterCoordinatorProduction } from './recovery-writer-drain';
 export { ProductionImportCoordinatorService } from './production-import-coordinator';
 export default { async fetch(r,e){try{const {action,input}=await r.json();return Response.json(await e.COORDINATOR.command(action,input));}
 catch{return Response.json({error:'fixture_refused'},{status:409});}}};`,resolveDir:source,loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const mf=new Miniflare({workers:[{config:{name:'import-coordination-fixture',type:'worker',compatibilityDate:'2026-09-18',
  exports:{RecoveryWriterCoordinatorProduction:{type:'durable-object',storage:'sqlite'}},
  env:{RECOVERY_DRAIN:{type:'durable-object',worker:'import-coordination-fixture',exportName:'RecoveryWriterCoordinatorProduction'},
   COORDINATOR:{type:'worker',worker:'import-coordination-fixture',exportName:'ProductionImportCoordinatorService'},
   RECOVERY_DRAIN_SCOPE_DIGEST:{type:'text',value:'6c6685377bca7b2e24d637b4a43888b77a16e280fdc587ce42623156cd615e9d'},
   RECOVERY_DRAIN_BACKEND:{type:'text',value:'durable-object'},CUTOVER_WRITE_FREEZE:{type:'text',value:'receipt_only'},DB:{type:'d1',name:'coordinated-fixture'},AUTH_DB:{type:'d1',name:'auth-stage-fixture'}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}},
  dev:{outboundService:{type:'fetcher',handler(){throw Error('external_network_forbidden');}}}}]});
 try {
  const native=await mf.getD1Database('DB');await native.prepare('CREATE TABLE proof(id INTEGER PRIMARY KEY)').run();
  let loseBegin=false,loseWrite=false,loseAck=false,queries=0;
  const command=async(action,input)=>{
   const r=await mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({action,input})});
   if(r.status!==200)throw Error('refused');
   if(action==='begin'&&loseBegin){loseBegin=false;throw Error('lost begin response');}
   if(action==='acknowledge'&&loseAck){loseAck=false;throw Error('lost durable acknowledgement response');}
   return r.json();
  };
  const owner=randomUUID(),incarnations=Object.fromEntries(['auth','master','business','avatars','covers'].map(store=>[store,randomUUID()]));
  const options={owner,incarnations,manifestSha256:'a'.repeat(64),command};
  const coordinator=createProductionImportCoordinator(options);
  const target={...PRODUCTION_D1_TARGETS.find(row=>row.databaseName==='fanmark-production-business'),targetIncarnation:incarnations.business};
  const fetchImpl=async(_url,options)=>{
   if(options.method==='GET')return Response.json({success:true,result:{uuid:target.databaseId,name:target.databaseName,created_at:target.createdAt}});
   queries++;
   const state=await coordinator.inspect();assert.ok(state.state.pending,'remote intent precedes every D1 write');
   const result=await native.batch(JSON.parse(options.body).batch.map(row=>native.prepare(row.sql).bind(...row.params)));
   if(loseWrite){loseWrite=false;throw Error('lost after commit');}
   return Response.json({success:true,result});
  };
  let lastPath;
  const writer=async(client=coordinator)=>{
   lastPath=join(dir,randomUUID()+'.jsonl');
   return openProductionD1ImportTransport({journalPath:lastPath,runId:owner,target,coordinator:client,token:'synthetic-token-only',fetchImpl});
  };
  await t.test('no local writes before remote ownership; target incarnation mismatch rejects',async()=>{
   await assert.rejects(writer(),/coordination_unconfirmed/);
   await coordinator.claim();
   await assert.rejects(openProductionD1ImportTransport({journalPath:join(dir,'bad'),runId:owner,
    target:{...target,targetIncarnation:randomUUID()},coordinator,token:'synthetic-token-only',fetchImpl}),/coordination_unconfirmed/);
   assert.equal(queries,0);
  });
  await t.test('a successful batch records local intent, remote intent, native commit and both acknowledgements',async()=>{
   const remote=await writer();await remote.prepare('INSERT INTO proof VALUES(1)').run();
   const rows=(await readFile(lastPath,'utf8')).trim().split('\n').map(JSON.parse);
   assert.deepEqual(rows.map(row=>row.type),['identity','intent','acknowledged']);
   assert.equal(await native.prepare('SELECT count(*) AS n FROM proof').first('n'),1);
   const inspected=await coordinator.inspect();assert.equal(inspected.state.pending,null);assert.equal(inspected.state.acknowledged,1);
  });
  await t.test('all five journals reconcile independently; substituted or omitted acknowledged history rejects',async()=>{
   const journalPaths={business:lastPath};
   for(const store of ['auth','master','avatars','covers']){
    journalPaths[store]=join(dir,store+'.jsonl');
    const targetId=PRODUCTION_D1_TARGETS.find(row=>row.databaseName==='fanmark-production-'+store)?.databaseId ??
     PRODUCTION_R2_TARGETS.find(row=>row.store===store).bucketName;
    await openProductionImportJournal({path:journalPaths[store],runId:owner,targetId,targetIncarnation:incarnations[store]});
   }
   const independent=createProductionImportCoordinator(options),before=await independent.inspect(),beforeQueries=queries;
   const report=await inspectProductionImportSet({journalPaths,coordinator:independent});
   assert.equal(report.journalsReconciled,true);assert.equal(report.remoteAcknowledged,1);
   assert.equal(report.fullMigrationReconciled,false);assert.equal(report.productionReady,false);
   assert.equal(queries,beforeQueries);assert.deepEqual(await independent.inspect(),before);
   const content=await readFile(journalPaths.business,'utf8');
   await writeFile(journalPaths.business,content.split('\n')[0]+'\n');
   await assert.rejects(inspectProductionImportSet({journalPaths,coordinator:independent}));
   await writeFile(journalPaths.business,content);
   await assert.rejects(inspectProductionImportSet({journalPaths:{...journalPaths,covers:journalPaths.avatars},coordinator:independent}));
   await writeFile(journalPaths.master+'.lock','',{mode:0o600});
   assert.equal((await inspectProductionImportSet({journalPaths,coordinator:independent})).journalsReconciled,false);
   assert.equal((await inspectProductionImportAttempt({journalPath:journalPaths.master,coordinator:independent})).classification,'local-no-pending-lock-retained');
   await unlink(journalPaths.master+'.lock');
  });
  await t.test('exited importer with a durable remote ACK can repair only its local log and continue without replay',async()=>{
   const journalPath=join(dir,'exited-importer.jsonl');
   const moduleUrl=new URL('./production-import-journal.mjs',import.meta.url).href;
   const args={path:journalPath,runId:owner,targetId:target.databaseId,targetIncarnation:target.targetIncarnation};
   // A separate real process owns this lock and exits before inspection. The
   // native DO and D1 below model commit + durable ACK with its local ACK lost.
   await promisify(execFile)(process.execPath,['--input-type=module','-e',
    `import {openProductionImportJournal} from ${JSON.stringify(moduleUrl)};const j=await openProductionImportJournal(${JSON.stringify(args)});await j.beforeWrite('${'e'.repeat(64)}');`]);
   const local=await inspectProductionImportJournal(journalPath),operation={...local.pending,store:'business'};
   await coordinator.beforeWrite(operation);
   await native.prepare('INSERT INTO proof VALUES(7)').run();
   await coordinator.afterWrite(operation);
   const independent=createProductionImportCoordinator(options),beforeQueries=queries;
   const beforeState=await independent.inspect();
   assert.equal((await inspectProductionImportAttempt({journalPath,coordinator:independent})).classification,'remote-acknowledged-local-pending');
   const lockText=await readFile(journalPath+'.lock','utf8');
   const foreign=JSON.parse(lockText);foreign.hostHash='0'.repeat(64);
   await writeFile(journalPath+'.lock',JSON.stringify(foreign)+'\n');
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath,coordinator:independent}));
   assert.equal((await inspectProductionImportJournal(journalPath)).pending.operationId,operation.operationId);
   await writeFile(journalPath+'.lock',lockText);
   // Earlier releases wrote empty lock files. Absence of owner evidence must
   // never turn a confirmed remote ACK into permission to remove that lock.
   await writeFile(journalPath+'.lock','');
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath,coordinator:independent}));
   await writeFile(journalPath+'.lock',lockText);
   const originalJournal=await readFile(journalPath,'utf8');
   await writeFile(journalPath,originalJournal.slice(0,-1));
   await assert.rejects(inspectProductionImportJournal(journalPath));
   await writeFile(journalPath,originalJournal);
   await chmod(journalPath,0o644);
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath,coordinator:independent}));
   await chmod(journalPath,0o600);
   const link=join(dir,'journal-symlink');await symlink(journalPath,link);
   await assert.rejects(inspectProductionImportJournal(link));await unlink(link);
   const recovered=await recoverAcknowledgedProductionImport({journalPath,coordinator:independent});
   assert.equal(recovered.localAcknowledgementRecovered,true);assert.equal(recovered.providerWrites,0);
   assert.equal(queries,beforeQueries);assert.deepEqual(await independent.inspect(),beforeState);
   const repaired=await inspectProductionImportJournal(journalPath);assert.equal(repaired.pending,null);assert.equal(repaired.lock,null);
   assert.equal(await native.prepare('SELECT count(*) AS n FROM proof WHERE id=7').first('n'),1);
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath,coordinator:independent}));
   const resumed=await openProductionD1ImportTransport({journalPath,runId:owner,target,coordinator,token:'synthetic-token-only',fetchImpl});
   await resumed.prepare('INSERT INTO proof VALUES(8)').run();
   assert.equal((await inspectProductionImportJournal(journalPath)).operations.length,2);
  });
  await t.test('lost remote ACK is distinguishable but an importer still alive cannot have its lock reclaimed',async()=>{
   const remote=await writer();loseAck=true;
   await assert.rejects(remote.prepare('INSERT INTO proof VALUES(9)').run(),/coordination_unconfirmed/);
   const journalPath=lastPath,original=await readFile(journalPath,'utf8'),before=queries;
   const independent=createProductionImportCoordinator(options);
   assert.equal((await inspectProductionImportAttempt({journalPath,coordinator:independent})).classification,'remote-acknowledged-local-pending');
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath,coordinator:independent}));
   assert.equal(await readFile(journalPath,'utf8'),original);assert.equal(queries,before);
   assert.ok((await inspectProductionImportJournal(journalPath)).lock);
   assert.equal(await native.prepare('SELECT count(*) AS n FROM proof WHERE id=9').first('n'),1);
  });
  await t.test('another store holds the same fence; a different journal cannot send a D1 request',async()=>{
   const operation={operationId:randomUUID(),batchSha256:'b'.repeat(64),store:'covers'};
   await coordinator.beforeWrite(operation);const before=queries;
   const remote=await writer();await assert.rejects(remote.prepare('INSERT INTO proof VALUES(2)').run(),/coordination_unconfirmed/);
   assert.equal(queries,before);
   // Fixture-only operation: no R2 mutation was sent. Acknowledge its known completion.
   await coordinator.afterWrite(operation);
  });
  await t.test('production Auth stage uses native coordination, atomic D1 and separate readonly verification',async()=>{
   const auth=await mf.getD1Database('AUTH_DB');
   for(const name of ['0003_better_auth_core.sql','0007_auth_signup_command.sql','0008_auth_user_suspension.sql','0009_auth_oauth_signup.sql']){
    const sql=await readFile(new URL('../../workers/api/migrations/'+name,import.meta.url),'utf8');
    await auth.batch(businessMigrationStatements(sql).map(sql=>auth.prepare(sql)));
   }
   const authTarget={...PRODUCTION_D1_TARGETS.find(row=>row.databaseName==='fanmark-production-auth'),targetIncarnation:incarnations.auth};
   let authWrites=0;
   const authFetch=async(_url,options)=>{
    if(options.method==='GET')return Response.json({success:true,result:{uuid:authTarget.databaseId,name:authTarget.databaseName,created_at:authTarget.createdAt}});
    const batch=JSON.parse(options.body).batch;
    if(batch.some(row=>!isReadOnlyProductionSql(row.sql))){
     authWrites++;assert.equal((await coordinator.inspect()).state.pending.store,'auth');
    }
    return Response.json({success:true,result:await auth.batch(batch.map(row=>auth.prepare(row.sql).bind(...row.params)))});
   };
   const authWriter=await openProductionD1ImportTransport({journalPath:join(dir,'auth-stage.jsonl'),runId:owner,target:authTarget,coordinator,token:'synthetic-token-only',fetchImpl:authFetch});
   const authReader=createProductionRemoteD1({target:authTarget,token:'synthetic-token-only',fetchImpl:authFetch});
   const id='aaaaaaaa-1111-4111-8111-111111111111',time='2026-10-19T00:00:00.000Z';
   const projection={version:1,observedAt:time,omittedSessionState:['session','verification','mfaAssurance'],tables:{
    user:[{id,name:'Synthetic',email:'synthetic@example.invalid',emailVerified:1,image:null,twoFactorEnabled:1,banned:0,banExpires:null,banReason:null,createdAt:time,updatedAt:time}],
    account:[{id:'credential:'+id,accountId:id,providerId:'credential',userId:id,password:'$2b$10$'+'a'.repeat(53),createdAt:time,updatedAt:time}],
    twoFactor:[{id:'synthetic-factor',userId:id,secret:'SYNTHETIC_ENCRYPTED',backupCodes:'SYNTHETIC_ENCRYPTED_CODES',verified:1,failedVerificationCount:0,lockedUntil:null}],
    adminRole:[{userId:id,role:'admin'}],
   }};
   const report=await importAuthProjectionStage({database:authWriter,readDatabase:authReader,projection,targetIncarnation:incarnations.auth,mode:'production-stage'});
   assert.equal(report.projectionRowsReconciled,true);assert.equal(report.productionReady,false);assert.equal(authWrites,1);
   const state=await coordinator.inspect();assert.equal(state.state.pending,null);assert.equal(state.state.readbackSha256,null);assert.equal(state.fenceOwner,owner);
   await assert.rejects(importAuthProjectionStage({database:authWriter,readDatabase:authWriter,projection,targetIncarnation:incarnations.auth,mode:'production-stage'}),/transport_invalid/);
   await assert.rejects(importAuthProjectionStage({database:authWriter,readDatabase:authReader,projection,targetIncarnation:incarnations.auth,mode:'local'}),/transport_invalid/);
   assert.equal(authWrites,1);
  });
  await t.test('lost begin response sends no D1 request and cannot be replayed with a new journal',async()=>{
   const remote=await writer();loseBegin=true;const before=queries;
   await assert.rejects(remote.prepare('INSERT INTO proof VALUES(3)').run(),/coordination_unconfirmed/);
   assert.equal(queries,before);
   const independent=createProductionImportCoordinator(options);
   await assert.rejects(independent.claim(),/coordination_unconfirmed/);
   const status=await coordinator.inspect();assert.ok(status.state.pending);
   const classification=await inspectProductionImportAttempt({journalPath:lastPath,coordinator:createProductionImportCoordinator(options)});
   assert.equal(classification.classification,'remote-pending-unresolved');
   await assert.rejects(recoverAcknowledgedProductionImport({journalPath:lastPath,coordinator}));
   // Independent fixture readback proves no store request was made above.
   await coordinator.afterWrite(status.state.pending);
  });
  await t.test('lost native commit response retains both intents and blocks all stores and independent processes',async()=>{
   const remote=await writer();loseWrite=true;
   await assert.rejects(remote.prepare('INSERT INTO proof VALUES(4)').run(),/acknowledgement_unknown/);
   const pendingPath=lastPath;
   assert.equal(await native.prepare('SELECT count(*) AS n FROM proof WHERE id=4').first('n'),1);
   assert.equal(JSON.parse((await readFile(pendingPath,'utf8')).trim().split('\n').at(-1)).type,'intent');
   const before=queries;const another=await writer();
   await assert.rejects(another.prepare('INSERT INTO proof VALUES(5)').run(),/coordination_unconfirmed/);
   await assert.rejects(coordinator.beforeWrite({operationId:randomUUID(),batchSha256:'c'.repeat(64),store:'avatars'}));
   await assert.rejects(createProductionImportCoordinator(options).claim());
   await assert.rejects(coordinator.complete('d'.repeat(64)));
   assert.equal(queries,before);assert.ok((await coordinator.inspect()).state.pending);
  });
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});


test('lost executor-release acknowledgement retains durable proof and both locks and cannot be replayed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fanmark-executor-ack-'));await chmod(directory,0o700);
 try{
  const moduleUrl=new URL('./production-import-execution-lock.mjs',import.meta.url).href;
  const identity={directory,runId:randomUUID(),manifestSha256:'a'.repeat(64),sourceEvidenceSha256:'b'.repeat(64)};
  await promisify(execFile)(process.execPath,['--input-type=module','-e',
   `import {createImportExecutionLock} from ${JSON.stringify(moduleUrl)};await createImportExecutionLock(JSON.parse(process.argv[1]));`,JSON.stringify(identity)]);
  const {recoverExitedImportExecution}=await import('./production-import-execution-lock.mjs');
  const lock=JSON.parse(await readFile(join(directory,'.initial-import-execution.lock'),'utf8'));
  let releases=0;
  const options={...identity,verify:async executorId=>({executorId,synthetic:true}),release:async()=>{releases++;throw Error('lost release response');}};
  await assert.rejects(recoverExitedImportExecution(options),/lost release response/);
  const proof=JSON.parse(await readFile(join(directory,'execution-recovery-'+lock.executorId+'.json'),'utf8'));
  assert.equal(proof.owner.executorId,lock.executorId);assert.equal(proof.proof.synthetic,true);
  assert.ok(await readFile(join(directory,'.initial-import-execution.lock')));
  assert.ok(await readFile(join(directory,'.initial-import-execution.lock.recovery')));
  await assert.rejects(recoverExitedImportExecution(options),{code:'EEXIST'});
  assert.equal(releases,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

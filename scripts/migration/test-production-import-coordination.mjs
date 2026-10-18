import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,chmod,rm,readFile} from 'node:fs/promises';
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
  let loseBegin=false,loseWrite=false,queries=0;
  const command=async(action,input)=>{
   const r=await mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({action,input})});
   if(r.status!==200)throw Error('refused');
   if(action==='begin'&&loseBegin){loseBegin=false;throw Error('lost begin response');}
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

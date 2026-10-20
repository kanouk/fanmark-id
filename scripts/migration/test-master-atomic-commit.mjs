import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {businessMigrationStatements} from './business-runtime-import-schema.mjs';
import {createCloudflareCredentialLease} from './cloudflare-credential-lease.mjs';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {openProductionD1ImportTransport,PRODUCTION_D1_TARGETS} from './production-remote-d1.mjs';
import {PRODUCTION_RUNTIME} from '../../workers/api/src/production-runtime-identity.ts';
import {MASTER_RECOVERY_SCHEMA_SQL,masterRecoveryDigest,captureMasterRecoverySnapshot,sealMasterRecoverySnapshot,openMasterRecoverySnapshot,restoreMasterRecoverySnapshot} from '../../workers/api/src/master-d1-recovery.ts';
import {MASTER_RUNTIME_MIGRATIONS,verifyMasterRuntimeSchema} from './master-runtime-schema.mjs';
import {masterCommitBatch} from './master-atomic-commit.mjs';
const ddl=(await Promise.all(['0000_import_operation_commits.sql','0001_import_commit_no_replace.sql'].map(file=>readFile(new URL('../../workers/api/migrations-master-production/'+file,import.meta.url),'utf8')))).join('\n');
test('native D1 commit receipts reconcile lost responses without replay and preserve uncertain boundaries',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fanmark-atomic-'));await chmod(directory,0o700);
  const mf=new Miniflare({workers:[{config:{name:'atomic',type:'worker',compatibilityDate:'2026-09-18',env:{DB:{type:'d1',name:'atomic'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response(null)}}'}}}}}]});
  try{
    const native=await mf.getD1Database('DB');
    await native.batch(businessMigrationStatements(ddl).map(sql=>native.prepare(sql)));
    await native.batch([native.prepare('CREATE TABLE probe(id INTEGER PRIMARY KEY,n INTEGER CHECK(n>=0))'),native.prepare('CREATE TABLE audit(id INTEGER PRIMARY KEY)'),native.prepare('CREATE TRIGGER probe_audit AFTER INSERT ON probe BEGIN INSERT INTO audit VALUES(NEW.id); END')]);
    let clock=100000,expires=200000,refreshes=0,failRenew=false;
    const target={...PRODUCTION_D1_TARGETS[1],targetIncarnation:randomUUID()};
    const lease=createCloudflareCredentialLease({accountId:target.accountId,now:()=>clock,minimumValidityMs:60000,load:async()=>({accountId:target.accountId,token:'synthetic_access_token',expiresAt:expires}),refresh:async()=>{refreshes++;if(failRenew)throw Error();expires=clock+100000;}});
    async function setup(failure){
      const runId=randomUUID(),executorId=randomUUID(),journalPath=join(directory,runId+'.jsonl');let state,ack=null,writes=0,ackCalls=0,readCalls=0,metadata=0,quarantine=false;
      const coordinator=createProductionImportCoordinator({owner:runId,manifestSha256:'a'.repeat(64),incarnations:{auth:randomUUID(),master:target.targetIncarnation,business:randomUUID(),avatars:randomUUID(),covers:randomUUID()},command:async(action,input)=>{
        if(action==='claim')return state={...input,pending:null,acknowledged:0,readbackSha256:null};
        if(action==='acquire')return {...state,executorId:input.executorId};
        if(action==='begin'){ack=null;state.pending={operationId:input.operationId,batchSha256:input.batchSha256,store:input.store};}
        if(action==='operation')return {scope:PRODUCTION_RUNTIME.scope,active:0,fenceOwner:runId,executorId,state,pending:state.pending,acknowledged:ack,dispatched:null,operationId:input.operationId,...(quarantine?{quarantine:{}}:{})};
        if(action==='acknowledge'){ackCalls++;ack={...state.pending};state.pending=null;state.acknowledged++;if(failure==='lost-coordinator-ack')throw Error('lost ack');}
        return state;
      }});await coordinator.claim();await coordinator.acquireExecution(executorId);
      const fetchImpl=async(url,options)=>{
        assert.equal(options.headers.get('authorization'),'Bearer synthetic_access_token');
        if(options.method==='GET'){metadata++;if(failure==='expiry-during-metadata'){clock=expires-500;failRenew=true;}return Response.json({success:true,result:{uuid:target.databaseId,name:target.databaseName,created_at:target.createdAt}});}
        const {batch}=JSON.parse(options.body),write=batch.some(s=>/^INSERT|^UPDATE/u.test(s.sql));
        if(write){writes++;assert.match(await readFile(journalPath,'utf8'),/"type":"intent"/);}
        else readCalls++;
        let result;try{result=await native.batch(batch.map(s=>native.prepare(s.sql).bind(...s.params)));}catch{return Response.json({success:false,errors:[{code:7500,message:'private SQL diagnostic'}]},{status:400});}
        if(write&&failure==='quarantined'){quarantine=true;throw Error();}
        if(write&&['lost-response','wrong-receipt','invalid-response'].includes(failure)){
          if(failure==='invalid-response')return Response.json({success:true,result:[]});
          throw Error('lost response');
        }
        if(!write&&failure==='wrong-receipt')result[0].results[0].batch_sha256='b'.repeat(64);
        return Response.json({success:true,result});
      };
      const db=await openProductionD1ImportTransport({target,credentialLease:lease,atomicMasterCommits:true,fetchImpl,journalPath,runId,coordinator});
      return {db,journalPath,counts:()=>({writes,ackCalls,readCalls,metadata}),pending:()=>state.pending};
    }
    await t.test('lost commit response, trigger changes, and next batch complete in the same executor',async()=>{
      const f=await setup('lost-response');const result=await f.db.batch([f.db.prepare('INSERT INTO probe VALUES(1,1)'),f.db.prepare('UPDATE probe SET n=n+1 WHERE id=1')]);
      assert.deepEqual(result.map(r=>r.meta.changes),[1,1]);assert.ok(result.every(r=>r.meta.reconciled_from_commit_receipt));
      await f.db.prepare('INSERT INTO probe VALUES(2,2)').run();assert.deepEqual(f.counts(),{writes:2,ackCalls:2,readCalls:2,metadata:4});
      assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM audit').first('n'),2);assert.equal(f.pending(),null);
    });
    await t.test('lost coordinator ACK appends local completion after exact read without a second ACK',async()=>{const f=await setup('lost-coordinator-ack');await f.db.prepare('INSERT INTO probe VALUES(3,3)').run();assert.equal(f.counts().ackCalls,1);assert.equal(JSON.parse((await readFile(f.journalPath,'utf8')).trim().split('\n').at(-1)).type,'acknowledged');});
    for(const [failure,id] of [['wrong-receipt',4],['quarantined',5]])await t.test(failure+' retains pending and refuses another write',async()=>{const f=await setup(failure);await assert.rejects(f.db.prepare(`INSERT INTO probe VALUES(${id},${id})`).run());assert.ok(f.pending());await assert.rejects(f.db.prepare(`INSERT INTO probe VALUES(${id+100},1)`).run());assert.equal(f.counts().writes,1);assert.equal(f.counts().ackCalls,0);});
    await t.test('rollback leaves no committed receipt and never retries the failed SQL',async()=>{const f=await setup();const before=await native.prepare('SELECT COUNT(*) AS n FROM fanmark_import_operation_commits').first('n');await assert.rejects(f.db.batch([f.db.prepare('INSERT INTO probe VALUES(6,6)'),f.db.prepare('INSERT INTO probe VALUES(7,-1)')]),e=>e.httpStatus===400&&e.providerCodes[0]===7500);assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM probe WHERE id=6').first('n'),0);assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM fanmark_import_operation_commits').first('n'),before);assert.equal(f.counts().writes,1);assert.ok(f.pending());});
    await t.test('expired credential after metadata fails before durable intent',async()=>{const f=await setup('expiry-during-metadata');await assert.rejects(f.db.prepare('INSERT INTO probe VALUES(8,8)').run());assert.equal(f.counts().writes,0);assert.equal(f.pending(),null);assert.equal((await readFile(f.journalPath,'utf8')).trim().split('\n').length,1);assert.equal(refreshes,1);failRenew=false;expires=clock+100000;});
    await t.test('unsupported returning SQL and receipt mutation fail before dispatch',async()=>{const f=await setup();for(const sql of ['INSERT INTO probe VALUES(9,9) RETURNING id','UPDATE probe SET n=changes()','DELETE FROM fanmark_import_operation_commits'])await assert.rejects(f.db.prepare(sql).run(),/master_atomic_commit_unconfirmed/);assert.equal(f.counts().metadata,0);});
    await t.test('committed receipt is immutable including SQLite REPLACE',async()=>{await assert.rejects(native.prepare('DELETE FROM fanmark_import_operation_commits').run(),/import_commit_immutable/);await assert.rejects(native.prepare("UPDATE fanmark_import_operation_commits SET phase='building'").run(),/import_commit_immutable/);await assert.rejects(native.prepare('INSERT OR REPLACE INTO fanmark_import_operation_commits SELECT * FROM fanmark_import_operation_commits LIMIT 1').run(),/import_commit_immutable/);});
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('production receipt evidence survives archive encryption and isolated exact restore; legacy profile remains separate',async()=>{
  const mf=new Miniflare({workers:[{config:{name:'receipt-backup',type:'worker',compatibilityDate:'2026-09-18',env:{SOURCE:{type:'d1',name:'receipt-source'},TARGET:{type:'d1',name:'receipt-target'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response(null)}}'}}}}}]});
  try{
    const source=await mf.getD1Database('SOURCE'),target=await mf.getD1Database('TARGET');
    for(const name of MASTER_RUNTIME_MIGRATIONS)await source.batch(businessMigrationStatements(await readFile(new URL('../../workers/api/migrations/'+name,import.meta.url),'utf8')).map(sql=>source.prepare(sql)));
    await source.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)').run();
    await source.batch(businessMigrationStatements(ddl).map(sql=>source.prepare(sql)));
    const identity={operationId:randomUUID(),runId:randomUUID(),batchSha256:'a'.repeat(64),targetId:PRODUCTION_D1_TARGETS[1].databaseId,targetIncarnation:randomUUID()};
    const batch=masterCommitBatch([{sql:'UPDATE mfaGeneration SET generation=generation+1 WHERE id=1',params:[]}],identity);
    await source.batch(batch.map(s=>source.prepare(s.sql).bind(...s.params)));
    await verifyMasterRuntimeSchema(source,{importCommitReceipts:true});
    const schemaHash=await masterRecoveryDigest((await source.prepare(MASTER_RECOVERY_SCHEMA_SQL).all()).results),snapshot=await captureMasterRecoverySnapshot(source,schemaHash);
    assert.equal(Object.keys(snapshot.tables).length,26);assert.equal(snapshot.tables.fanmark_import_operation_commits[0].operation_id,identity.operationId);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),archive=await sealMasterRecoverySnapshot(snapshot,key,schemaHash);
    assert.equal(archive.format,'fanmark-master-import-recovery-v1');
    const restored=await restoreMasterRecoverySnapshot(target,await openMasterRecoverySnapshot(archive,key,schemaHash),schemaHash);
    assert.deepEqual(restored,snapshot);await assert.rejects(target.prepare('DELETE FROM fanmark_import_operation_commits').run(),/import_commit_immutable/);
    const missing=structuredClone(snapshot);delete missing.tables.fanmark_import_operation_commits;await assert.rejects(sealMasterRecoverySnapshot(missing,key,schemaHash));
  }finally{await mf.dispose();}
});

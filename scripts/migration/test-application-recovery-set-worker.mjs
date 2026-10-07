import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import bcrypt from '../../workers/api/node_modules/bcryptjs/index.js';
import {seedRecoverySetFixture,recoverySetFixturePins,fixtureSecret} from './recovery-set-fixture.mjs';
import {captureMasterRecoverySnapshot,sealMasterRecoverySnapshot} from '../../workers/api/src/master-d1-recovery.ts';
import {d1RecoveryDigest} from '../../workers/api/src/d1-store-recovery.ts';
import {databaseRoles,bucketRoles,fixturePassword} from './application-recovery-set-contract.mjs';

export async function exerciseApplicationRecoveryWorker({savedMaster}={}){
  const nonce='eeaa001122334455',schemaHashes=await recoverySetFixturePins();
  const vars={PROOF_ACCOUNT:'bfc2890741f0b3fb236e2d755b6c9adc',PROOF_NONCE:nonce,PROOF_HEAD:'a'.repeat(40),PROOF_ORIGIN:'https://localhost',
    PROOF_TOKEN:'b'.repeat(64),PROOF_ARCHIVE_KEY:'c'.repeat(64),PROOF_MASTER_KEY:'d'.repeat(64),PROOF_SDK_SECRET:fixtureSecret,
    ...Object.fromEntries([...databaseRoles,...bucketRoles].map(role=>[role+'_NAME',`fanmark-recovery-${nonce}-${role.toLowerCase().replaceAll('_','-')}`])),
    ...Object.fromEntries(databaseRoles.map((role,i)=>[role+'_ID','90000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]))};
  const sourceIds=prefix=>Object.fromEntries(['auth','business','master','avatars','covers'].map(store=>[store,
    ['avatars','covers'].includes(store)?vars[prefix+'_'+store.toUpperCase()+'_NAME']:vars[prefix+'_'+store.toUpperCase()+'_ID']]));
  vars.PROOF_SOURCE_SCOPE=await d1RecoveryDigest(sourceIds('S'));vars.PROOF_TARGET_SCOPE=await d1RecoveryDigest(sourceIds('T'));
  let archiveBytes;
  if(savedMaster){
    assert.equal(createHash('sha256').update(savedMaster.archiveBytes).digest('hex'),savedMaster.pins.archiveSha256);
    schemaHashes.master=savedMaster.pins.schemaHash;vars.PROOF_MASTER_KEY=savedMaster.keyHex;
    archiveBytes=savedMaster.archiveBytes;vars.PROOF_MASTER_ROWS_HASH=savedMaster.pins.rowsHash;
    vars.PROOF_MASTER_ROWS=String(savedMaster.pins.rows);vars.PROOF_CATALOG_ROWS=String(savedMaster.pins.canonicalEmojiCount);
    vars.PROOF_REFERENCE_COUNTS=JSON.stringify(savedMaster.pins.referenceViewCounts);
  }else{
    const scratch=new Miniflare({workers:[{config:{name:'application-master-fixture',type:'worker',compatibilityDate:'2026-09-18',
      env:Object.fromEntries(['auth','business','master'].map(name=>[name,{type:'d1',name}])),
      manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("fixture")}}'}}}}}]});
    try{
      const db=Object.fromEntries(await Promise.all(['auth','business','master'].map(async store=>[store,await scratch.getD1Database(store)])));
      await seedRecoverySetFixture(db);const snapshot=await captureMasterRecoverySnapshot(db.master,schemaHashes.master);
      const key=await crypto.subtle.importKey('raw',Buffer.from(vars.PROOF_MASTER_KEY,'hex'),'AES-GCM',false,['encrypt']);
      archiveBytes=Buffer.from(JSON.stringify(await sealMasterRecoverySnapshot(snapshot,key,schemaHashes.master)));
      vars.PROOF_MASTER_ROWS_HASH=snapshot.rowsHash;vars.PROOF_MASTER_ROWS=String(Object.values(snapshot.tables).reduce((n,rows)=>n+rows.length,0));
      vars.PROOF_CATALOG_ROWS='0';vars.PROOF_REFERENCE_COUNTS='{}';
    }finally{await scratch.dispose();}
  }
  vars.PROOF_SCHEMA_HASHES=JSON.stringify(schemaHashes);vars.PROOF_MASTER_ARCHIVE_HASH=createHash('sha256').update(archiveBytes).digest('hex');
  const compiled=await build({entryPoints:[fileURLToPath(new URL('./application-recovery-set-worker.mjs',import.meta.url))],bundle:true,write:false,
    format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
  const mf=new Miniflare({workers:[{config:{name:'application-recovery-local',type:'worker',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],
    exports:{SourceWriterCoordinator:{type:'durable-object',storage:'sqlite'},TargetWriterCoordinator:{type:'durable-object',storage:'sqlite'}},
    env:{...Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,{type:'text',value}])),
      ...Object.fromEntries(databaseRoles.map(role=>[role,{type:'d1',name:vars[role+'_NAME']}])),
      ...Object.fromEntries(bucketRoles.map(role=>[role,{type:'r2',name:vars[role+'_NAME']}])),
      SOURCE_DRAIN:{type:'durable-object',worker:'application-recovery-local',exportName:'SourceWriterCoordinator'},
      TARGET_DRAIN:{type:'durable-object',worker:'application-recovery-local',exportName:'TargetWriterCoordinator'}},
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',handler(){throw Error('external_provider_forbidden');}}}}]});
  const headers={authorization:'Bearer '+vars.PROOF_TOKEN,'x-proof-nonce':nonce};
  const request=(route,options={})=>mf.dispatchFetch(vars.PROOF_ORIGIN+'/_proof/'+route,{headers,...options});
  try{
    const source=Object.fromEntries(await Promise.all(['auth','business','master'].map(async store=>[store,await mf.getD1Database('S_'+store.toUpperCase())])));
    await seedRecoverySetFixture(source,{skipMaster:true});
    await source.auth.prepare("UPDATE account SET password=? WHERE providerId='credential'").bind(await bcrypt.hash(fixturePassword,10)).run();
    // Admission is checked before payload parsing. A small malformed body also
    // avoids an unread multi-MiB upload racing the transport's early rejection.
    assert.equal((await request('initialize',{method:'POST',body:'{}',headers:{}})).status,401);
    assert.equal((await request('initialize',{method:'POST',body:'{}',headers:{...headers,'x-proof-nonce':'bad'}})).status,403);
    assert.equal((await request('query',{method:'POST',body:'{}'})).status,404);
    assert.equal((await request('collect',{method:'POST'})).status,409);
    assert.equal((await request('initialize',{method:'POST',body:Buffer.alloc(8*1024*1024+1)})).status,413);
    assert.equal((await request('initialize',{method:'POST',body:'{}'})).status,400);
    assert.equal(await mf.getR2Bucket('CONTROL').then(bucket=>bucket.head('initialize-claim.json')),null);
    const initialize=await (await request('initialize',{method:'POST',body:archiveBytes})).json();assert.equal(initialize.report.state,'verified',JSON.stringify(initialize.report));
    assert.equal((await request('initialize',{method:'POST',body:archiveBytes})).status,409);
    const collect=await (await request('collect',{method:'POST'})).json();assert.equal(collect.report.state,'verified',JSON.stringify(collect.report));
    assert.equal((await request('collect',{method:'POST'})).status,409);
    const {archive}=await (await request('archive')).json();
    const tampered=structuredClone(archive);tampered.nonce[0]^=1;
    assert.equal((await request('restore',{method:'POST',body:JSON.stringify(tampered)})).status,400);
    for(const role of databaseRoles.filter(role=>role.startsWith('T_')))assert.equal((await (await mf.getD1Database(role)).prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.length,0);
    const restore=await (await request('restore',{method:'POST',body:JSON.stringify(archive)})).json();assert.equal(restore.report.state,'verified',JSON.stringify(restore.report));
    assert.equal(restore.report.progress.length,10);assert.equal(restore.report.result.captureId,collect.report.captureId);
    assert.equal(restore.report.oldSessionRejected,true);assert.equal(restore.report.normalSdkTargetLogin,true);assert.equal(restore.report.credentialBytesRetained,true);
    assert.deepEqual(restore.report.emptyR2ReadStatus,{avatars:404,'cover-images':404});
    assert.equal((await request('restore',{method:'POST',body:JSON.stringify(archive)})).status,409);
    const control=await mf.getR2Bucket('CONTROL');await control.put('unowned','preserve');
    assert.equal((await request('objects',{method:'DELETE'})).status,409);assert.equal(await (await control.get('unowned')).text(),'preserve');await control.delete('unowned');
    await control.put('restore-status.json',JSON.stringify({state:'in_progress'}));assert.equal((await request('objects',{method:'DELETE'})).status,409);
    await control.put('restore-status.json',JSON.stringify(restore.report));
    assert.equal((await (await request('objects',{method:'DELETE'})).json()).bucketsEmpty,true);
    for(const role of bucketRoles)assert.equal((await (await mf.getR2Bucket(role)).list()).objects.length,0);
    const result={initialize:initialize.report,collect:collect.report,restore:restore.report,archiveBytes:Buffer.byteLength(JSON.stringify(archive)),
      authenticationAndNonceRefused:true,oversizeBeforeClaimRefused:true,arbitrarySqlRouteAbsent:true,tamperBeforeTargetWritesRefused:true,
      repeatedPhasesRefused:true,unownedAndInProgressCleanupRefused:true,ownedBucketsEmpty:true,remoteWrites:0,providerCalls:0};
    console.info(JSON.stringify(result));return result;
  }finally{await mf.dispose();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))test('native actual app and distinct DO guards collect and restore one bounded owned set',
  {timeout:120_000},()=>exerciseApplicationRecoveryWorker());

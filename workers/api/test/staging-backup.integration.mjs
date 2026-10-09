import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createHash,randomUUID} from 'node:crypto';
import {seedRecoverySetFixture,recoverySetFixturePins,fixtureSecret} from '../../../scripts/migration/recovery-set-fixture.mjs';
import {openRecoverySet,restoreRecoverySet} from '../src/recovery-set.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ids = {auth:'fixture-auth',business:'fixture-business',master:'fixture-master',avatars:'fixture-avatars',covers:'fixture-covers'};
const names = {AUTH_DB:ids.auth,AVATARS_BUCKET:ids.avatars,COVER_IMAGES_BUCKET:ids.covers,FANMARK_DB:ids.business,MASTER_DB:ids.master};
const scope = sha(JSON.stringify({account:'bfc2890741f0b3fb236e2d755b6c9adc',worker:'fanmark-app-staging',stores:Object.entries(names).map(([binding,value])=>binding.endsWith('_DB')?{type:'d1',binding,id:value}:{type:'r2',binding,name:value})}));
const prefix='recovery/v1/', slot = new Date().toISOString().slice(0,10);

test('native staging backup RPC fences writers, verifies private R2 archive, revokes restored sessions and bounds retention', {timeout:120_000}, async t=>{
  const schemas=await recoverySetFixturePins(), keyHex='a'.repeat(64);
  const compiled=await build({entryPoints:[fileURLToPath(new URL('./staging-backup-harness.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*']});
  const vars={D1_TOPOLOGY:'split',RECOVERY_DRAIN_BACKEND:'durable-object',RECOVERY_DRAIN_SCOPE_DIGEST:scope,
    STAGING_BACKUP_BACKEND:'recovery-set-v1',STAGING_BACKUP_ADMISSION:'writers-verified-v1',
    STAGING_BACKUP_SOURCE_IDS:JSON.stringify(ids),STAGING_BACKUP_SCHEMA_HASHES:JSON.stringify(schemas),
    STAGING_BACKUP_KEY_ID:'fixture-operational-key',STAGING_BACKUP_KEY:keyHex,BETTER_AUTH_SECRET:fixtureSecret};
  const mf=new Miniflare({workers:[{config:{name:'backup-native-fixture',type:'worker',compatibilityDate:'2026-09-18',
    exports:{RecoveryWriterCoordinator:{type:'durable-object',storage:'sqlite'}},
    env:{...Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,{type:'text',value}])),
      CF_VERSION_METADATA:{type:'json',value:{id:'fixture-runtime-v1'}},
      ...Object.fromEntries(['AUTH_DB','FANMARK_DB','MASTER_DB','TARGET_AUTH','TARGET_BUSINESS','TARGET_MASTER'].map(name=>[name,{type:'d1',name}])),
      ...Object.fromEntries(['AVATARS_BUCKET','COVER_IMAGES_BUCKET','STAGING_BACKUP_BUCKET','TARGET_AVATARS','TARGET_COVERS'].map(name=>[name,{type:'r2',name}])),
      RECOVERY_DRAIN:{type:'durable-object',worker:'backup-native-fixture',exportName:'RecoveryWriterCoordinator'},
      BACKUP_SERVICE:{type:'worker',worker:'backup-native-fixture',exportName:'StagingBackupService'}},
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',handler(){throw Error('external-provider-forbidden');}}}}]});
  const request=async (path,extra={},status=200)=>{const response=await mf.dispatchFetch('https://fixture.local',{method:'POST',body:JSON.stringify({path,slot,...extra})});
    const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
  try{
    const source={auth:await mf.getD1Database('AUTH_DB'),business:await mf.getD1Database('FANMARK_DB'),master:await mf.getD1Database('MASTER_DB')};
    await seedRecoverySetFixture(source);const bucket=await mf.getR2Bucket('STAGING_BACKUP_BUCKET');
    await t.test('policy approval alone does not admit capture or create a lock',async()=>{
      assert.deepEqual(await request('blocked',{admission:'approved'},409),{error:'staging_backup_admission_required'});
      assert.equal(await bucket.head(prefix+'runs/'+slot+'.json'),null);
      const status=await request('rpc-status');assert.equal(status.receipt,null);assert.equal(status.writers.owner,null);
    });
    await t.test('existing owner blocks collection and repeated/ambiguous invocation never replays',async()=>{
      const owner=randomUUID();await request('claim',{owner});
      await request('rpc-run',{},409);const failed=await request('rpc-status');
      assert.equal(failed.receipt.state,'failed');assert.equal(failed.writers.owner,owner);
      assert.equal((await bucket.list({prefix:prefix+'archives/'})).objects.length,0);
      await request('rpc-run',{},409);await request('release',{owner});
      // Fixture-only reset after the failed operation and original fence both settled.
      await bucket.delete(prefix+'runs/'+slot+'.json');
    });
    await t.test('source error is redacted and the owned fence releases only after awaited failure',async()=>{
      await request('failure',{},409);const status=await request('rpc-status');assert.equal(status.receipt.state,'failed');
      assert.equal(status.receipt.error,'capture_failed');assert.equal(status.receipt.fenceReleased,true);assert.equal(status.writers.owner,null);
      assert.ok(!JSON.stringify(status).includes('fixture-email-password'));await request('writer');
      await bucket.delete(prefix+'runs/'+slot+'.json');
    });
    await t.test('lost R2 claim acknowledgement leaves a lock for inspection and prevents replay',async()=>{
      await request('claim-ack-loss',{},409);const status=await request('rpc-status');
      assert.equal(status.receipt.state,'claimed');assert.equal(status.writers.owner,null);
      await request('rpc-run',{},409);assert.equal((await bucket.list({prefix:prefix+'archives/'})).objects.length,0);
      // The fixture has observed the entire failed request settle and no source work start.
      await bucket.delete(prefix+'runs/'+slot+'.json');
    });
    let receipt;
    await t.test('an existing native writer drains before capture, while new writers refuse under the fence',async()=>{
      const writing=request('slow-writer');
      for(let i=0;i<30;i++){if((await request('writers')).active===1)break;if(i===29)assert.fail('writer did not enter');await new Promise(r=>setTimeout(r,20));}
      const backingUp=request('rpc-run');
      for(let i=0;i<30;i++){const status=await request('writers');if(status.owner!==null){assert.equal(status.drained,false);break;}if(i===29)assert.fail('fence did not claim');await new Promise(r=>setTimeout(r,20));}
      await request('writer',{},409);await writing;receipt=await backingUp;
      assert.equal(receipt.state,'verified');assert.equal(receipt.fenceReleased,true);
    });
    const status=await request('rpc-status');assert.equal(status.writers.owner,null);assert.equal(status.writers.active,0);
    const serialized=await (await bucket.get(receipt.objectKey)).text();assert.equal(sha(serialized),receipt.archiveHash);
    assert.ok(!serialized.includes(fixtureSecret));assert.ok(!serialized.includes('synthetic-recovery-set@example.invalid'));
    const key=await crypto.subtle.importKey('raw',Buffer.from(keyHex,'hex'),'AES-GCM',false,['encrypt','decrypt']);
    const context={sourceIds:ids,schemaHashes:schemas,keyId:vars.STAGING_BACKUP_KEY_ID,runtimeRevision:'fixture-runtime-v1',authSecret:fixtureSecret};
    const archive=JSON.parse(serialized), opened=await openRecoverySet(archive,context,key);assert.equal(opened.manifest.captureId,receipt.captureId);
    assert.equal(opened.snapshots.business.tables.user_settings[0].display_name,'settled-native-writer');
    await t.test('the same stored archive restores all five isolated stores and revokes local sessions/challenges',async()=>{
      const target={auth:await mf.getD1Database('TARGET_AUTH'),business:await mf.getD1Database('TARGET_BUSINESS'),master:await mf.getD1Database('TARGET_MASTER'),
        avatars:await mf.getR2Bucket('TARGET_AVATARS'),covers:await mf.getR2Bucket('TARGET_COVERS')};
      const targetIds=Object.fromEntries(Object.keys(ids).map(name=>[name,'isolated-target-'+name]));
      const result=await restoreRecoverySet(target,archive,context,key,{mode:'new-empty',sessionPolicy:'revoke-local-sessions-and-challenges',targetIds,
        targetGuard:{id:'owned-isolated-target',async assertHeld(expected){assert.deepEqual(expected,targetIds);}},progress:async()=>{}});
      assert.equal(result.captureId,receipt.captureId);
      for(const name of ['session','mfaAssurance','verification'])assert.equal((await target.auth.prepare('SELECT * FROM '+name).all()).results.length,0);
      assert.equal((await source.auth.prepare('SELECT * FROM session').all()).results.length,1);
      for(const db of [target.auth,target.business,target.master])assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
    await t.test('key escrow decrypts with separate archive key and exposes no plaintext SDK key',async()=>{
      const escrow=await request('escrow');assert.ok(!JSON.stringify(escrow).includes(fixtureSecret));
      const header={format:escrow.format,keyId:escrow.keyId,authKeyId:escrow.authKeyId};
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(escrow.nonce),additionalData:new TextEncoder().encode(JSON.stringify(header))},key,new Uint8Array(escrow.ciphertext));
      assert.equal(new TextDecoder().decode(plaintext),fixtureSecret);new Uint8Array(plaintext).fill(0);
      await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(escrow.nonce),additionalData:new TextEncoder().encode(JSON.stringify({...header,keyId:'wrong'}))},key,new Uint8Array(escrow.ciphertext)));
    });
    await t.test('duplicate slot leaves the first archive and successful receipt unchanged',async()=>{
      await request('rpc-run',{},409);assert.equal(await (await bucket.get(receipt.objectKey)).text(),serialized);
      assert.deepEqual((await request('rpc-status')).receipt,receipt);
    });
    await t.test('retention deletes only exact old verified archives after current archive verification',async()=>{
      const date=days=>new Date(Date.parse(slot+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
      const oldSlot=date(30),boundary=date(29),oldOwner=randomUUID();
      const old={...receipt,slot:oldSlot,owner:oldOwner,objectKey:prefix+'archives/'+oldSlot+'/'+oldOwner+'.json'};
      await bucket.put(old.objectKey,serialized);await bucket.put(prefix+'runs/'+oldSlot+'.json',JSON.stringify(old));
      await bucket.put(prefix+'runs/'+boundary+'.json',JSON.stringify({...receipt,slot:boundary}));
      await bucket.put('unrelated-keep','keep');
      assert.equal((await request('prune')).deleted,1);assert.equal(await bucket.head(old.objectKey),null);
      const retained=(await request('rpc-status')).receipt.retention;
      assert.equal(retained.days,30);assert.equal(retained.deleted,1);assert.ok(Number.isFinite(Date.parse(retained.finishedAt)));
      assert.ok(await bucket.head(prefix+'runs/'+boundary+'.json'));assert.equal(await(await bucket.get('unrelated-keep')).text(),'keep');
      await bucket.delete(receipt.objectKey);await request('prune',{},409);await bucket.put(receipt.objectKey,serialized);
    });
    await t.test('disabled/wrong Cron calls no service and service failure prevents retention',async()=>{
      assert.equal((await request('scheduler',{mode:'disabled'})).calls,0);assert.equal((await request('scheduler',{mode:'bad-cron'})).calls,0);
      assert.deepEqual(await request('scheduler',{mode:'active'}),{calls:1,alerts:1,error:'staging_backup_failed'});
    });
  }finally{await mf.dispose();}
});

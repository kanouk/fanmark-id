/** New local stores, instrumented from their first application request. No remote resources/providers. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import bcrypt from '../../workers/api/node_modules/bcryptjs/index.js';
import {seedRecoverySetFixture,recoverySetFixturePins,fixtureUser,fixtureSecret} from './recovery-set-fixture.mjs';
import {collectRecoverySet,openRecoverySet,restoreRecoverySet,RECOVERY_SET_STORES as stores} from '../../workers/api/src/recovery-set.ts';
import {d1RecoveryDigest} from '../../workers/api/src/d1-store-recovery.ts';
import {saveRecoverySetFile,readRecoverySetFile} from './recovery-set-files.mjs';

const bindingNames={auth:'AUTH_DB',business:'FANMARK_DB',master:'MASTER_DB',avatars:'AVATARS',covers:'COVERS'};
const ids=prefix=>Object.fromEntries(stores.map(store=>[store,'new-local-'+prefix+'-'+store]));
const email='synthetic-recovery-set@example.invalid',password='Synthetic-owned-recovery!2026';

test('real application login is fenced during five-store file capture and restored credentials can log in after session revocation', {timeout:90_000},async()=>{
  const schemaHashes=await recoverySetFixturePins();
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../../workers/api/src/index.ts',import.meta.url))],bundle:true,
    write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
  const scopes={source:await d1RecoveryDigest(ids('source')),target:await d1RecoveryDigest(ids('target'))};
  const workers=['source','target'].map(prefix=>({config:{name:'writer-'+prefix,type:'worker',compatibilityDate:'2026-09-18',
    compatibilityFlags:['nodejs_compat'],exports:{RecoveryWriterCoordinator:{type:'durable-object',storage:'sqlite'}},
    env:{...Object.fromEntries(Object.entries({D1_TOPOLOGY:'split',AUTH_BACKEND:'better-auth',AUTH_USER_STATUS_BACKEND:'d1',
      BETTER_AUTH_SECRET:fixtureSecret,BETTER_AUTH_URL:'https://localhost',
      CORS_ALLOWED_ORIGINS:'https://localhost',RECOVERY_DRAIN_BACKEND:'durable-object',
      RECOVERY_DRAIN_SCOPE_DIGEST:scopes[prefix]}).map(([name,value])=>[name,{type:'text',value}])),
      ...Object.fromEntries(stores.map(store=>[bindingNames[store],{type:['avatars','covers'].includes(store)?'r2':'d1',name:ids(prefix)[store]}])),
      RECOVERY_DRAIN:{type:'durable-object',worker:'writer-'+prefix,exportName:'RecoveryWriterCoordinator'}},
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',handler(){throw Error('external_provider_forbidden');}}}}));
  const mf=new Miniflare({workers}),directory=await mkdtemp(path.join(os.tmpdir(),'fanmark-tracked-recovery-'));
  const owner=randomUUID();
  try{
    const bindings=async prefix=>Object.fromEntries(await Promise.all(stores.map(async store=>[store,
      ['avatars','covers'].includes(store)?await mf.getR2Bucket(bindingNames[store],'writer-'+prefix):
      await mf.getD1Database(bindingNames[store],'writer-'+prefix)])));
    const source=await bindings('source'),target=await bindings('target');
    // Initialization ends before the first normal application request. Both app
    // incarnations are tracked from birth; no old request/job/other writer exists.
    await seedRecoverySetFixture(source);
    const credentialHash=await bcrypt.hash(password,10);
    await source.auth.prepare("UPDATE account SET password=? WHERE providerId='credential'").bind(credentialHash).run();
    const apps=Object.fromEntries(await Promise.all(['source','target'].map(async prefix=>[prefix,await mf.getWorker('writer-'+prefix)])));
    const namespaces=Object.fromEntries(await Promise.all(['source','target'].map(async prefix=>[prefix,await mf.getDurableObjectNamespace('RECOVERY_DRAIN','writer-'+prefix)])));
    const origin=()=> 'https://localhost';
    const login=prefix=>apps[prefix].fetch(origin(prefix)+'/api/auth/sign-in/email',{method:'POST',headers:{Origin:origin(prefix),'content-type':'application/json'},body:JSON.stringify({email,password})});
    const fence=async(prefix,operation,id=owner)=>{
      const namespace=namespaces[prefix],stub=namespace.get(namespace.idFromName('recovery-writers-v1'));
      return stub.fetch('https://recovery-writer.internal/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,scope:scopes[prefix]})});
    };
    const guard=prefix=>({id:'owned-local-'+prefix,async assertHeld(expected){
      assert.deepEqual(expected,ids(prefix));
      const response=await fence(prefix,'assert');assert.equal(response.status,200);
      const state=await response.json();assert.equal(state.owner,owner);assert.equal(state.scope,scopes[prefix]);
      assert.equal(state.active,0);assert.equal(state.drained,true);
    }});
    const signedIn=await login('source'),signinResult=await signedIn.json();assert.equal(signedIn.status,200,'source_login:'+JSON.stringify({error:signinResult.error,code:signinResult.code,message:signinResult.message}));
    assert.equal(signinResult.user.id,fixtureUser);
    const cookie=signedIn.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
    assert.equal(await source.auth.prepare('SELECT count(*) AS n FROM session').first('n'),2);
    for(const prefix of ['source','target']){
      const claim=await fence(prefix,'claim');assert.equal(claim.status,200);assert.equal((await claim.json()).drained,true);
      assert.equal((await login(prefix)).status,503);
      assert.equal((await fence(prefix,'release',randomUUID())).status,409);
    }
    const context={sourceIds:ids('source'),keyId:'owned-local-key',runtimeRevision:'actual-application-local',schemaHashes,authSecret:fixtureSecret};
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const archive=await collectRecoverySet(source,context,key,guard('source'));
    const filename=path.join(directory,'recovery-set.json');await saveRecoverySetFile(filename,archive,context,key);
    const reopened=await readRecoverySetFile(filename,context,key),opened=await openRecoverySet(reopened,context,key);
    assert.equal(opened.snapshots.auth.tables.session.length,2);
    assert.equal(opened.snapshots.auth.tables.account[0].password,credentialHash);
    const progress=[];
    const restored=await restoreRecoverySet(target,reopened,context,key,{mode:'new-empty',sessionPolicy:'revoke-local-sessions-and-challenges',targetIds:ids('target'),targetGuard:guard('target'),progress:async receipt=>{progress.push(receipt);}});
    assert.equal(restored.captureId,opened.manifest.captureId);assert.equal(progress.length,10);
    for(const store of ['business','master','avatars','covers'])assert.equal(restored.restoredHashes[store],opened.manifest.parts[store].snapshotHash);
    assert.equal(await target.auth.prepare('SELECT count(*) AS n FROM session').first('n'),0);
    assert.equal(await target.auth.prepare('SELECT count(*) AS n FROM verification').first('n'),0);
    assert.equal(await target.auth.prepare('SELECT password FROM account').first('password'),credentialHash);
    assert.equal((await login('target')).status,503);
    assert.equal((await fence('target','release')).status,200);
    // Same SDK secret makes this a real invalidated-session check, not a key mismatch.
    const oldSession=await apps.target.fetch(origin('target')+'/api/auth/get-session',{headers:{cookie}});
    assert.equal(oldSession.status,200);assert.equal(await oldSession.json(),null);
    const targetLogin=await login('target');assert.equal(targetLogin.status,200);
    assert.equal((await targetLogin.json()).user.id,fixtureUser);
    assert.equal(await target.auth.prepare('SELECT count(*) AS n FROM session').first('n'),1);
    for(const db of [target.auth,target.business,target.master])assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    assert.equal((await fence('source','release')).status,200);
    await assert.rejects(collectRecoverySet(source,context,key,guard('source')),/recovery_set_guard_lost/);
    console.info(JSON.stringify({proof:'actual-application-writer-recovery-local',normalSdkSourceLogin:true,
      namespacesSeparate:true,heldFenceBlocksBothLogins:true,privateFile:true,stores:5,sourceSessions:2,targetRestoredSessions:0,
      oldSessionRejected:true,normalSdkTargetLogin:true,credentialBytesRetained:true,guardReleaseRefusesCapture:true,
      remoteWrites:0,realProviderCalls:0,masterCapacityProven:false,r2ObjectClassProven:false,mainFirstActivationProven:false}));
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

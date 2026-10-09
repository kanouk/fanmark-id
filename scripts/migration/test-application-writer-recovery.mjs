/** New local stores, instrumented from their first application request. No remote resources/providers. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,stat} from 'node:fs/promises';
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
import {restoreMasterRecoverySnapshot} from '../../workers/api/src/master-d1-recovery.ts';

const bindingNames={auth:'AUTH_DB',business:'FANMARK_DB',master:'MASTER_DB',avatars:'AVATARS_BUCKET',covers:'COVER_IMAGES_BUCKET'};
const ids=prefix=>Object.fromEntries(stores.map(store=>[store,'new-local-'+prefix+'-'+store]));
const email='synthetic-recovery-set@example.invalid',password='Synthetic-owned-recovery!2026';

// Count executed statements, including batch members, without replacing native D1.
function countedD1(database, counter) {
  const originals=new WeakMap();
  const wrap=statement=>{
    const proxy=new Proxy(statement,{get(target,name){
      if(name==='bind')return (...values)=>wrap(target.bind(...values));
      if(['all','first','run','raw'].includes(name))return (...args)=>{counter.statements++;return target[name](...args);};
      const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
    }}); originals.set(proxy,statement);return proxy;
  };
  return {prepare:sql=>wrap(database.prepare(sql)),batch:statements=>{
    counter.statements+=statements.length;counter.batches++;counter.maxBatch=Math.max(counter.maxBatch,statements.length);
    return database.batch(statements.map(statement=>originals.get(statement)??statement));
  }};
}

/** Optional full Master must already be authenticated against independent saved evidence. */
export async function exerciseApplicationWriterRecovery({masterSnapshot,masterPins}={}) {
  const started=performance.now();
  const schemaHashes=await recoverySetFixturePins();
  if(masterSnapshot){
    assert.ok(masterPins,'independent_master_pins_required');
    assert.equal(masterSnapshot.schemaHash,masterPins.schemaHash);
    assert.equal(masterSnapshot.rowsHash,masterPins.rowsHash);
    assert.equal(masterSnapshot.schema.length,masterPins.schemaObjects);
    assert.equal(Object.values(masterSnapshot.tables).reduce((n,rows)=>n+rows.length,0),masterPins.rows);
    schemaHashes.master=masterPins.schemaHash;
  }else assert.equal(masterPins,undefined);
  const compiled=await build({entryPoints:[fileURLToPath(new URL('../../workers/api/src/index.ts',import.meta.url))],bundle:true,
    write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
  const scopes={source:await d1RecoveryDigest(ids('source')),target:await d1RecoveryDigest(ids('target'))};
  const workers=['source','target'].map(prefix=>({config:{name:'writer-'+prefix,type:'worker',compatibilityDate:'2026-09-18',
    compatibilityFlags:['nodejs_compat'],exports:{RecoveryWriterCoordinator:{type:'durable-object',storage:'sqlite'}},
    env:{...Object.fromEntries(Object.entries({D1_TOPOLOGY:'split',AUTH_BACKEND:'better-auth',AUTH_USER_STATUS_BACKEND:'d1',
      BETTER_AUTH_SECRET:fixtureSecret,BETTER_AUTH_URL:'https://localhost',
      CORS_ALLOWED_ORIGINS:'https://localhost',EMOJI_CATALOG_BACKEND:'d1',REFERENCE_MASTER_BACKEND:'d1',RECOVERY_DRAIN_BACKEND:'durable-object',
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
    await seedRecoverySetFixture(source,{skipMaster:Boolean(masterSnapshot)});
    if(masterSnapshot)await restoreMasterRecoverySnapshot(source.master,masterSnapshot,masterPins.schemaHash);
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
    const counts=Object.fromEntries(['capture','restore'].map(phase=>[phase,Object.fromEntries(['auth','business','master'].map(store=>[store,{statements:0,batches:0,maxBatch:0}]))]));
    const counted=(bindings,phase)=>({...bindings,...Object.fromEntries(['auth','business','master'].map(store=>[store,countedD1(bindings[store],counts[phase][store])]))});
    const captureStarted=performance.now();
    const archive=await collectRecoverySet(counted(source,'capture'),context,key,guard('source'));
    const captureMs=performance.now()-captureStarted;
    const filename=path.join(directory,'recovery-set.json');await saveRecoverySetFile(filename,archive,context,key);
    const archiveBytes=(await stat(filename)).size;
    const reopened=await readRecoverySetFile(filename,context,key),opened=await openRecoverySet(reopened,context,key);
    assert.equal(opened.snapshots.auth.tables.session.length,2);
    assert.equal(opened.snapshots.auth.tables.account[0].password,credentialHash);
    if(masterSnapshot)assert.deepEqual(opened.snapshots.master,masterSnapshot);
    const progress=[];
    const restoreStarted=performance.now();
    const restored=await restoreRecoverySet(counted(target,'restore'),reopened,context,key,{mode:'new-empty',sessionPolicy:'revoke-local-sessions-and-challenges',targetIds:ids('target'),targetGuard:guard('target'),progress:async receipt=>{progress.push(receipt);}});
    const restoreMs=performance.now()-restoreStarted;
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
    const masterReadback={};
    if(masterSnapshot){
      const catalogItems=[];let offset=0,version;
      do{
        const url=new URL('/api/emoji/catalog',origin());url.searchParams.set('offset',String(offset));
        if(version)url.searchParams.set('version',version);
        const response=await apps.target.fetch(url.toString());assert.equal(response.status,200);
        const page=await response.json();assert.equal(page.total,masterPins.canonicalEmojiCount);
        if(version)assert.equal(page.version,version);else version=page.version;
        assert.equal(page.offset,offset);catalogItems.push(...page.items);
        assert.ok(catalogItems.length<=masterPins.canonicalEmojiCount);
        if(page.nextOffset!==null)assert.ok(page.nextOffset>offset);
        offset=page.nextOffset;
      }while(offset!==null);
      assert.equal(catalogItems.length,masterPins.canonicalEmojiCount);
      assert.equal(new Set(catalogItems.map(item=>item.id)).size,masterPins.canonicalEmojiCount);
      masterReadback.canonicalEmojiCount=catalogItems.length;
      masterReadback.referenceViewCounts={};
      for(const [name,n] of Object.entries(masterPins.referenceViewCounts)){
        const response=await apps.target.fetch(origin()+'/api/reference-masters/'+name);assert.equal(response.status,200);
        const body=await response.json();assert.equal(body.items.length,n);masterReadback.referenceViewCounts[name]=body.items.length;
      }
    }
    for(const db of [target.auth,target.business,target.master])assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    assert.equal((await fence('source','release')).status,200);
    await assert.rejects(collectRecoverySet(source,context,key,guard('source')),/recovery_set_guard_lost/);
    const totals=Object.fromEntries(Object.entries(counts).map(([phase,byStore])=>[phase,Object.values(byStore).reduce((n,counter)=>n+counter.statements,0)]));
    for(const total of Object.values(totals))assert.ok(total<=1000,'collector_or_restore_statement_budget_exceeded');
    const proof={proof:'actual-application-writer-recovery-local',normalSdkSourceLogin:true,
      namespacesSeparate:true,heldFenceBlocksBothLogins:true,privateFile:true,stores:5,sourceSessions:2,targetRestoredSessions:0,
      oldSessionRejected:true,normalSdkTargetLogin:true,credentialBytesRetained:true,guardReleaseRefusesCapture:true,
      archiveBytes,counts,totals,captureMs,restoreMs,durationMs:performance.now()-started,
      masterRows:Object.values(opened.snapshots.master.tables).reduce((n,rows)=>n+rows.length,0),
      masterSchemaHash:opened.snapshots.master.schemaHash,masterRowsHash:opened.snapshots.master.rowsHash,
      ...masterReadback,remoteWrites:0,realProviderCalls:0,fullSavedMasterProven:Boolean(masterSnapshot),
      maximumCapacityProven:false,r2ObjectClassProven:false,mainFirstActivationProven:false};
    console.info(JSON.stringify(proof));return proof;
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  test('real application login is fenced during five-store file capture and restored credentials can log in after session revocation',
    {timeout:90_000},()=>exerciseApplicationWriterRecovery());

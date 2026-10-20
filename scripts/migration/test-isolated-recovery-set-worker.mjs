import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {databaseRoles, bucketRoles} from './isolated-recovery-set-worker.mjs';
import {seedRecoverySetFixture, recoverySetFixturePins, fixtureSecret} from './recovery-set-fixture.mjs';
import {saveRecoverySetFile, readRecoverySetFile} from './recovery-set-files.mjs';
import {openRecoverySet} from '../../workers/api/src/recovery-set.ts';

async function fixture(adaptClass) {
  const nonce = '0123456789abcdef';
  const vars = {PROOF_ACCOUNT: 'bfc2890741f0b3fb236e2d755b6c9adc', PROOF_NONCE: nonce, PROOF_HEAD: 'a'.repeat(40),
    PROOF_TOKEN: 'b'.repeat(64), PROOF_ARCHIVE_KEY: 'c'.repeat(64), PROOF_SDK_SECRET: fixtureSecret,
    PROOF_SCHEMA_HASHES: JSON.stringify(await recoverySetFixturePins()),
    ...Object.fromEntries([...databaseRoles,...bucketRoles].map(role => [role + '_NAME', `fanmark-recovery-${nonce}-${role.toLowerCase().replaceAll('_','-')}`])),
    ...Object.fromEntries(databaseRoles.map((role, i) => [role + '_ID', '90000000-0000-4000-8000-' + String(i + 1).padStart(12, '0')]))};
  const adapter = adaptClass ? `
    function wrap(bucket, overrides) {return new Proxy(bucket, {get(target, prop) {
      if (prop in overrides) return overrides[prop]; const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
    }});}
    const object = value => value === null ? null : wrap(value, {storageClass: value.storageClass === '' ? 'Standard' : value.storageClass});
    const adapt = bucket => wrap(bucket, {get: async (...args) => object(await bucket.get(...args)), head: async (...args) => object(await bucket.head(...args)),
      put: async (...args) => object(await bucket.put(...args)), list: async (...args) => {const page = await bucket.list(...args); return {...page, objects: page.objects.map(object)};}});
    export default {async fetch(request, env) {const adapted = {...env}; for (const role of bucketRoles) adapted[role] = adapt(env[role]); return worker.fetch(request, adapted);}};
  ` : 'export default worker;';
  const compiled = await build({stdin: {resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents:
    "import worker, {bucketRoles} from './isolated-recovery-set-worker.mjs';\n" + adapter}, bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022'});
  const mf = new Miniflare({workers: [{config: {name: 'isolated-set-local', type: 'worker', compatibilityDate: '2026-09-18',
    env: {...Object.fromEntries(Object.entries(vars).map(([name,value]) => [name,{type:'text',value}])),
      ...Object.fromEntries(databaseRoles.map(role => [role,{type:'d1',name:vars[role+'_NAME']}])),
      ...Object.fromEntries(bucketRoles.map(role => [role,{type:'r2',name:vars[role+'_NAME']}]))},
    manifest: {mainModule: 'index.js', modules: {'index.js': {type:'esm',contents:compiled.outputFiles[0].text}}}}}]});
  try {
    await seedRecoverySetFixture(Object.fromEntries(await Promise.all(['auth','business','master'].map(async store => [store,await mf.getD1Database('S_'+store.toUpperCase())]))));
  } catch (error) {await mf.dispose(); throw error;}
  const headers = {authorization: 'Bearer '+vars.PROOF_TOKEN,'x-proof-nonce':nonce};
  const request = (route, options={}) => mf.dispatchFetch('https://synthetic.example.invalid/_proof/'+route, {headers,...options});
  return {mf,vars,headers,request};
}

test('isolated set Worker refuses unauthenticated writes, class supplementation and unsafe cleanup', {timeout:90_000}, async () => {
  const {mf,headers,request} = await fixture(false);
  try {
    assert.equal((await request('collect',{method:'POST',headers:{}})).status,401);
    assert.equal((await request('collect',{method:'POST',headers:{...headers,'x-proof-nonce':'bad'}})).status,403);
    assert.equal((await request('collect?bad=1',{method:'POST'})).status,400);
    assert.equal((await request('query',{method:'POST'})).status,404);
    const control = await mf.getR2Bucket('CONTROL');
    await control.put('restore-claim.json','{}');
    assert.equal((await request('objects',{method:'DELETE'})).status,409);
    await control.delete('restore-claim.json');
    const response = await (await request('collect',{method:'POST'})).json(); assert.ok(response.report,JSON.stringify(response)); const {report}=response;
    assert.equal(report.state,'failed'); assert.equal(report.error,'r2_recovery_snapshot_invalid');
    assert.equal((await request('collect',{method:'POST'})).status,409);
    assert.equal((await request('archive')).status,409);
    assert.equal((await request('restore',{method:'POST',body:'{}'})).status,409);
    const target = await mf.getR2Bucket('T_AVATARS'); await target.put('foreign','preserve');
    assert.equal((await request('objects',{method:'DELETE'})).status,409);
    assert.equal(await (await target.get('foreign')).text(),'preserve'); await target.delete('foreign');
    assert.equal((await (await request('objects',{method:'DELETE'})).json()).bucketsEmpty,true);
  } finally {await mf.dispose();}
});

test('bundled collector exports a private file and restores that file into native empty targets', {timeout:90_000}, async () => {
  const {mf,vars,request} = await fixture(true), directory = await mkdtemp(path.join(os.tmpdir(),'fanmark-set-bundled-'));
  try {
    const collect = await (await request('collect',{method:'POST'})).json();
    assert.ok(collect.report,JSON.stringify(collect)); assert.equal(collect.report.state,'verified',JSON.stringify(collect));
    assert.equal(collect.report.sourceAuthSessions,1);
    const {archive} = await (await request('archive')).json(), identity = await (await request('identity')).json();
    const context = {sourceIds:Object.fromEntries(['auth','business','master','avatars','covers'].map(store=>[store,
      ['avatars','covers'].includes(store)?identity.buckets['S_'+store.toUpperCase()]:identity.databases['S_'+store.toUpperCase()].id])),
      keyId:'isolated-'+vars.PROOF_NONCE,runtimeRevision:vars.PROOF_HEAD,schemaHashes:JSON.parse(vars.PROOF_SCHEMA_HASHES),authSecret:fixtureSecret};
    const bytes=Buffer.from(vars.PROOF_ARCHIVE_KEY,'hex'),key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']); bytes.fill(0);
    const filename=path.join(directory,'recovery-set.json'); await saveRecoverySetFile(filename,archive,context,key);
    const reopened=await readRecoverySetFile(filename,context,key),opened=await openRecoverySet(reopened,context,key);
    const bad=structuredClone(reopened);bad.nonce[0]^=1;
    assert.equal((await request('restore',{method:'POST',body:JSON.stringify(bad)})).status,409);
    for (const role of databaseRoles.filter(role=>role.startsWith('T_'))) {
      assert.equal((await (await mf.getD1Database(role)).prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.length,0);
    }
    const restored=await (await request('restore',{method:'POST',body:JSON.stringify(reopened)})).json();
    assert.equal(restored.report.state,'verified',JSON.stringify(restored)); assert.equal(restored.report.result.captureId,opened.manifest.captureId);
    assert.equal(restored.report.result.sessionPolicy,'revoke-local-sessions-and-challenges');
    assert.notEqual(restored.report.result.restoredHashes.auth,opened.manifest.parts.auth.snapshotHash);
    for (const store of ['business','master','avatars','covers']) assert.equal(restored.report.result.restoredHashes[store],opened.manifest.parts[store].snapshotHash);
    assert.equal(restored.report.progress.length,10);
    assert.ok(Object.values(restored.report.d1Queries).reduce((a,b)=>a+b,0)<=1000);
    assert.equal((await request('restore',{method:'POST',body:JSON.stringify(reopened)})).status,409);
    assert.equal((await (await request('objects',{method:'DELETE'})).json()).bucketsEmpty,true);
    console.info(JSON.stringify({proof:'recovery-set-bundled-local',stores:5,privateFile:true,
      collectQueries:collect.report.d1Queries,restoreQueries:restored.report.d1Queries,localStorageClassAdapter:true,remoteWrites:0}));
  } finally {await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

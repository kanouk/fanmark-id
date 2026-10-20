import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {bucketRoles} from './isolated-shared-r2-recovery-worker.mjs';

const nonce = '0123456789abcdef';
const vars = {PROOF_ACCOUNT: 'bfc2890741f0b3fb236e2d755b6c9adc', PROOF_NONCE: nonce,
  PROOF_HEAD: 'a'.repeat(40), PROOF_TOKEN: 'b'.repeat(64),
  ...Object.fromEntries(bucketRoles.map(role => [role + '_NAME', `fanmark-recovery-${nonce}-${role.toLowerCase().replaceAll('_', '-')}`]))};
const headers = {authorization: `Bearer ${vars.PROOF_TOKEN}`, 'x-proof-nonce': nonce};

test('isolated shared R2 Worker gates writes and records strict local class refusal', {timeout: 60_000}, async () => {
  const compiled = await build({entryPoints: [fileURLToPath(new URL('./isolated-shared-r2-recovery-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022'});
  const mf = new Miniflare({workers: [{config: {name: 'shared-r2-proof-native', type: 'worker', compatibilityDate: '2026-09-18',
    env: {...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, {type: 'text', value}])),
      ...Object.fromEntries(bucketRoles.map(role => [role, {type: 'r2', name: vars[role + '_NAME']}]))},
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents: compiled.outputFiles[0].text}}}}}]});
  const request = (route, options = {}) => mf.dispatchFetch('https://synthetic.example.invalid/_proof/' + route, {headers, ...options});
  try {
    assert.equal((await request('run', {method: 'POST', headers: {}})).status, 401);
    assert.equal((await request('run', {method: 'POST', headers: {...headers, 'x-proof-nonce': 'bad'}})).status, 403);
    assert.equal((await request('run?extra=1', {method: 'POST'})).status, 400);
    assert.equal((await request('objects', {method: 'DELETE'})).status, 409);
    const control = await mf.getR2Bucket('CONTROL');
    assert.equal((await control.list()).objects.length, 0);
    const run = await (await request('run', {method: 'POST'})).json();
    // No adapter in the deployed Worker. This pinned local runtime omits the class,
    // and must fail rather than silently treating the remote proof as accepted.
    assert.equal(run.report.state, 'failed'); assert.equal(run.report.step, 'capture');
    assert.equal(run.report.error, 'r2_recovery_snapshot_invalid'); assert.deepEqual(run.report.storageClasses, ['']);
    assert.equal(run.report.metadataFieldTypes.contentEncoding, 'undefined');
    assert.equal((await request('run', {method: 'POST'})).status, 409);
    assert.deepEqual((await (await request('status')).json()).report, run.report);
    const target = await mf.getR2Bucket('TARGET');
    await target.put('unowned', 'preserve');
    assert.equal((await request('objects', {method: 'DELETE'})).status, 409);
    assert.equal((await control.list()).objects.length, 2);
    assert.equal(await (await target.get('unowned')).text(), 'preserve');
    await target.delete('unowned');
    assert.equal((await (await request('objects', {method: 'DELETE'})).json()).bucketsEmpty, true);
    for (const role of bucketRoles) assert.equal((await (await mf.getR2Bucket(role)).list()).objects.length, 0);
    assert.equal((await request('query', {method: 'POST'})).status, 404);
  } finally {await mf.dispose();}
});

test('proof orchestration exercises native recovery with the explicitly local class adapter', {timeout: 60_000}, async () => {
  // Adapter exists only in this inline test entrypoint. All capture/restore and HTTP
  // routes execute inside native workerd, including enumerable undefined metadata.
  const compiled = await build({stdin: {resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
    import worker, {bucketRoles} from './isolated-shared-r2-recovery-worker.mjs';
    function wrap(bucket, overrides) {return new Proxy(bucket, {get(target, prop) {
      if (prop in overrides) return overrides[prop]; const v = Reflect.get(target, prop); return typeof v === 'function' ? v.bind(target) : v;
    }});}
    const object = value => value === null ? null : wrap(value, {storageClass: value.storageClass === '' ? 'Standard' : value.storageClass});
    export default {async fetch(request, env) {
      const adapted = {...env};
      for (const role of bucketRoles) {
        const native = env[role];
        adapted[role] = wrap(native, {get: async (...args) => object(await native.get(...args)), head: async (...args) => object(await native.head(...args)),
          put: async (...args) => object(await native.put(...args)), list: async (...args) => {
            const page = await native.list(...args); return {...page, objects: page.objects.map(object)};
          }});
      }
      return worker.fetch(request, adapted);
    }};
  `}, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022'});
  const mf = new Miniflare({workers: [{config: {name: 'shared-r2-orchestration-local', type: 'worker', compatibilityDate: '2026-09-18',
    env: {...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, {type: 'text', value}])),
      ...Object.fromEntries(bucketRoles.map(role => [role, {type: 'r2', name: vars[role + '_NAME']}]))},
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents: compiled.outputFiles[0].text}}}}}]});
  try {
    const {report} = await (await mf.dispatchFetch('https://synthetic.example.invalid/_proof/run', {method: 'POST', headers})).json();
    assert.equal(report.state, 'verified', JSON.stringify(report));
    assert.equal(Object.values(report.assertions).filter(Boolean).length, 8);
    assert.equal(report.resumedWrites, 2); assert.equal(report.paginationPages, 4);
    console.info(JSON.stringify({proof: 'shared-r2-orchestration-local', localStorageClassAdapter: true, remoteWrites: 0}));
  } finally {await mf.dispose();}
});

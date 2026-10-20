import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { productionImportGatewaySource, openProductionImportGateway, closeProductionImportGateway } from './production-import-gateway.mjs';
import { PRODUCTION_RUNTIME } from '../../workers/api/src/production-runtime-identity.ts';
import { PRODUCTION_D1_TARGETS } from './production-d1-targets.mjs';
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';

test('native operator gateway requires bearer, expiration and explicit read/write capability', async () => {
  const version = randomUUID(), bearer = 'a'.repeat(64), text = value => ({ type: 'text', value });
  const worker = (name, access, expiry) => ({ config: { name, type: 'worker', compatibilityDate: '2026-09-18',
    env: { R2_IMPORT: { type: 'worker', worker: 'probe', exportName: 'Probe' }, IMPORT_COORDINATOR: { type: 'worker', worker: 'probe', exportName: 'Probe' },
      EXPECTED_RUNTIME: text(version), GATE_TOKEN: text(bearer), GATE_ACCESS: text(access), EXPIRES_AT: text(String(expiry)) },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: productionImportGatewaySource() } } } } });
  const mf = new Miniflare({ workers: [worker('readonly', 'read-only', Date.now() + 60000), worker('writer', 'import', Date.now() + 60000), worker('expired', 'import', 1),
    { config: { name: 'probe', type: 'worker', compatibilityDate: '2026-09-18', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents:
      `import {WorkerEntrypoint} from 'cloudflare:workers';export class Probe extends WorkerEntrypoint {fetch(r){return Response.json({url:r.url,method:r.method,runtime:r.headers.get('x-fanmark-import-runtime'),auth:r.headers.get('authorization')});}command(action,input){return {action,input};}} export default {fetch(){return new Response(null,{status:404})}};` } } } } } ] });
  try {
    const call = async (name, path, options = {}) => (await mf.getWorker(name)).fetch('https://fixture.local' + path, { ...options,
      headers: { authorization: 'Bearer ' + bearer, ...options.headers } });
    assert.equal((await call('readonly', '/r2/identity', { headers: { authorization: 'wrong' } })).status, 401);
    assert.equal((await call('expired', '/r2/identity')).status, 410);
    const read = await call('readonly', '/r2/object?store=avatars&key=owner%2Fa', { headers: { 'x-fanmark-import-runtime': 'caller-cannot-change' } });
    assert.deepEqual(await read.json(), { url: 'https://production-import-r2.internal/object?store=avatars&key=owner%2Fa', method: 'GET', runtime: version, auth: null });
    assert.equal((await call('readonly', '/r2/object', { method: 'PUT', body: 'no' })).status, 404);
    assert.equal((await call('writer', '/r2/object', { method: 'PUT', body: 'yes' })).status, 200);
    for (const name of ['readonly', 'writer']) {
      assert.equal((await call(name, '/r2/object', { method: 'DELETE' })).status, 404);
      assert.equal((await call(name, '/coordinator/dispatch', { method: 'POST', body: '{}' })).status, 404);
      assert.equal((await call(name, '/coordinator/reset', { method: 'POST', body: '{}' })).status, 404);
      const result = await call(name, '/coordinator/inspect', { method: 'POST', body: '{"owner":"fixture"}' });
      assert.deepEqual(await result.json(), { action: 'inspect', input: { owner: 'fixture' } });
      const operation = await call(name, '/coordinator/operation', { method: 'POST', body: '{"owner":"fixture","operationId":"fixture"}' });
      assert.deepEqual(await operation.json(), { action: 'operation', input: { owner: 'fixture', operationId: 'fixture' } });
      assert.equal((await call(name, '/coordinator/inspect', { method: 'POST', body: 'a'.repeat(1025) })).status, 413);
    }
    assert.equal((await call('readonly', '/coordinator/claim', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await call('readonly', '/coordinator/recover', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await call('readonly', '/coordinator/recover-auth', { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await call('writer', '/coordinator/recover-auth', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await call('writer', '/coordinator/claim', { method: 'POST', body: '{}' })).status, 200);
  } finally { await mf.dispose(); }
});

async function fixture(run, { loseUpload = false, rejectActivation = false, driftActivationReadback = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fanmark-import-gateway-')); await chmod(root, 0o700);
  const runtimeVersion = randomUUID(), gatewayVersion = randomUUID(), journalPath = join(root, 'gateway.jsonl');
  const bindings = [
    ...PRODUCTION_D1_TARGETS.map(row => ({ type: 'd1', name: { auth: 'AUTH_DB', business: 'FANMARK_DB', master: 'MASTER_DB' }[row.store], id: row.databaseId })),
    ...PRODUCTION_R2_TARGETS.map(row => ({ type: 'r2_bucket', name: row.store === 'avatars' ? 'AVATARS_BUCKET' : 'COVER_IMAGES_BUCKET', bucket_name: row.bucketName })),
    ...Object.entries({ D1_TOPOLOGY: 'split', EMOJI_PUBLICATION_BACKEND: 'production-service', RECOVERY_DRAIN_SCOPE_DIGEST: PRODUCTION_RUNTIME.scope,
      RECOVERY_DRAIN_BACKEND: 'durable-object', CUTOVER_WRITE_FREEZE: 'receipt_only', STORAGE_BACKEND: 'r2' }).map(([name, text]) => ({ name, text })),
  ];
  let gateway = null, deletes = 0, uploads = 0, activations = 0, drift = false;
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.authorization, 'Bearer synthetic_control_plane_token');
    const resource = new URL(url).pathname.split('/workers/scripts/')[1]; assert.ok(resource);
    if (resource.startsWith(PRODUCTION_RUNTIME.worker + '/')) {
      assert.equal(options.method, 'GET');
      if (resource.endsWith('/settings')) return Response.json({ success: true, result: { bindings } });
      assert.ok(resource.endsWith('/deployments')); return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: 100, version_id: runtimeVersion }] }] } });
    }
    assert.match(resource, /^fanmark-prod-import-[0-9a-f-]{36}(?:\/(?:settings|deployments|subdomain))?$/);
    if (options.method === 'PUT') {
      uploads++; gateway = JSON.parse(options.body.get('metadata'));
      assert.equal(await options.body.get('index.mjs').text(), productionImportGatewaySource());
      assert.equal(gateway.bindings.filter(b => b.type === 'd1' || b.type === 'r2_bucket').length, 0);
      const state = JSON.parse((await readFile(journalPath, 'utf8')).trim().split('\n').at(-1)); assert.equal(state.state, 'upload_requested');
      if (loseUpload) throw Error('lost upload response'); return Response.json({ success: true, result: {} });
    }
    if (options.method === 'DELETE') { deletes++; gateway = null; throw Error('lost deletion response'); }
    if (!gateway) return new Response(null, { status: 404 });
    if (resource.endsWith('/settings')) return Response.json({ success: true, result: { bindings: gateway.bindings } });
    if (resource.endsWith('/deployments')) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: 100, version_id: drift ? randomUUID() : gatewayVersion }] }] } });
    if (resource.endsWith('/subdomain')) {
      if (options.method === 'POST') {
        activations++;
        assert.deepEqual(JSON.parse(options.body), { enabled: true, previews_enabled: false });
        assert.equal(options.headers['Cloudflare-Workers-Script-Api-Date'], '2025-08-01');
        if (rejectActivation) return Response.json({ success: false, errors: [{ code: 10022, message: 'PRIVATE_PROVIDER_SENTINEL' }] }, { status: 400 });
      } else assert.equal(options.method, 'GET');
      return Response.json({ success: true, result: { enabled: true, previews_enabled: options.method === 'GET' && driftActivationReadback } });
    }
    return Response.json({ success: true, result: {} });
  };
  const options = { journalPath, runtimeVersion, token: 'synthetic_control_plane_token', fetchImpl };
  try { await run(options, { setDrift(value) { drift = value; }, counts: () => ({ uploads, deletes }), activations: () => activations }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test('open creates only a UUID gateway; cleanup pins ownership/version and does not replay a lost DELETE ACK', async () => fixture(async (options, control) => {
  const result = await openProductionImportGateway(options);
  assert.equal(result.state, 'open'); assert.equal(result.access, 'read-only');
  control.setDrift(true); await assert.rejects(closeProductionImportGateway(options), /gateway_unconfirmed/);
  assert.equal(control.counts().deletes, 0);
  control.setDrift(false); assert.equal((await closeProductionImportGateway(options)).removed, true);
  assert.equal((await closeProductionImportGateway(options)).removed, true);
  assert.deepEqual(control.counts(), { uploads: 1, deletes: 1 });
}));
test('unknown gateway upload retains journal and refuses automatic replacement or deletion', async () => fixture(async (options, control) => {
  await assert.rejects(openProductionImportGateway(options), /gateway_unconfirmed/);
  await assert.rejects(openProductionImportGateway(options));
  await assert.rejects(closeProductionImportGateway(options), /gateway_unconfirmed/);
  assert.deepEqual(control.counts(), { uploads: 1, deletes: 0 });
  const state = JSON.parse((await readFile(options.journalPath, 'utf8')).trim().split('\n').at(-1));
  assert.equal(state.state, 'upload_requested'); assert.equal(state.failure, 'requires_independent_control_plane_inspection');
}, { loseUpload: true }));

test('activation rejection records only numeric diagnostics and permits owned cleanup without retry', async () => fixture(async (options, control) => {
  await assert.rejects(openProductionImportGateway(options), /gateway_unconfirmed/);
  const contents = await readFile(options.journalPath, 'utf8');
  assert.equal(contents.includes('PRIVATE_PROVIDER_SENTINEL'), false);
  const state = JSON.parse(contents.trim().split('\n').at(-1));
  assert.equal(state.state, 'activation_requested');
  assert.deepEqual(state.controlPlaneFailure, { stage: 'activation_requested', method: 'POST', status: 400, errorCodes: [10022] });
  assert.equal((await closeProductionImportGateway(options)).removed, true);
  assert.equal(control.activations(), 1);
  assert.deepEqual(control.counts(), { uploads: 1, deletes: 1 });
}, { rejectActivation: true }));

test('successful activation ACK cannot override a mismatched independent preview readback', async () => fixture(async (options, control) => {
  await assert.rejects(openProductionImportGateway(options), /gateway_unconfirmed/);
  const state = JSON.parse((await readFile(options.journalPath, 'utf8')).trim().split('\n').at(-1));
  assert.equal(state.state, 'activation_requested');
  assert.equal((await closeProductionImportGateway(options)).removed, true);
  assert.equal(control.activations(), 1);
}, { driftActivationReadback: true }));

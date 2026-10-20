const credentialLease=syntheticProductionCredential('synthetic_control_plane_token');
import {syntheticProductionCredential} from './fixtures/synthetic-production-credential.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, chmod, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from '../../workers/api/src/production-runtime-identity.ts';
import { PRODUCTION_D1_TARGETS } from './production-d1-targets.mjs';
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';
import { createProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { inspectProductionImportAttempt, recoverAcknowledgedProductionImport } from './production-import-inspection.mjs';
import { createProductionRemoteR2, openProductionR2ImportTransport } from './production-remote-r2.mjs';
import { importProductionSplitR2Export, verifyProductionSplitR2Export } from './production-r2-import-stage.mjs';
import { objectIdentityHash } from './storage-export.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('production R2 client joins fixed control-plane identities, native service, remote coordinator and local journals', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fanmark-production-r2-')); await chmod(dir, 0o700);
  const owner = randomUUID(), version = randomUUID(), gatewayVersion = randomUUID();
  const origins = Object.fromEntries(['read-only', 'import'].map(mode => [mode, 'https://fanmark-prod-import-' + randomUUID() + '.fanmark-id.workers.dev']));
  const incarnations = Object.fromEntries(['auth', 'master', 'business', 'avatars', 'covers'].map(store => [store, randomUUID()]));
  const built = await build({ stdin: { contents: `export { RecoveryWriterCoordinatorProductionV3 } from './recovery-writer-drain';
    export { ProductionR2ImportService } from './production-r2-import-service';
    export default {async fetch(r,e){const u=new URL(r.url);if(u.pathname.startsWith('/command/'))
      return e.RECOVERY_DRAIN.get(e.RECOVERY_DRAIN.idFromName('recovery-writers-v1')).fetch('https://recovery-writer.internal/migration/'+u.pathname.slice(9),{method:'POST',body:await r.text()});
      return e.IMPORT.fetch(new Request('https://production-import-r2.internal'+u.pathname.slice(3)+u.search,r));}};`,
    resolveDir: fileURLToPath(new URL('../../workers/api/src', import.meta.url)), loader: 'ts' }, bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const text = value => ({ type: 'text', value });
  const mf = new Miniflare({ workers: [{ config: { name: 'production-r2-client', type: 'worker', compatibilityDate: '2026-09-18',
    exports: { RecoveryWriterCoordinatorProductionV3: { type: 'durable-object', storage: 'sqlite' } }, env: {
      RECOVERY_DRAIN: { type: 'durable-object', worker: 'production-r2-client', exportName: 'RecoveryWriterCoordinatorProductionV3' },
      IMPORT: { type: 'worker', worker: 'production-r2-client', exportName: 'ProductionR2ImportService' },
      RECOVERY_DRAIN_SCOPE_DIGEST: text(PRODUCTION_RUNTIME.scope), RECOVERY_DRAIN_BACKEND: text('durable-object'),
      D1_TOPOLOGY: text('split'), STORAGE_BACKEND: text('r2'), CUTOVER_WRITE_FREEZE: text('receipt_only'),
      STAGING_BACKUP_SOURCE_IDS: text(JSON.stringify(PRODUCTION_STORE_IDS)), CF_VERSION_METADATA: { type: 'json', value: { id: version } },
      AVATARS_BUCKET: { type: 'r2', name: 'avatars' }, COVER_IMAGES_BUCKET: { type: 'r2', name: 'covers' } },
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: built.outputFiles[0].text } } } },
      dev: { outboundService: { type: 'fetcher', handler() { throw Error('no_external_network'); } } } }] });
  try {
    const command = async (action, input) => {
      const response = await mf.dispatchFetch('https://fixture.local/command/' + action, { method: 'POST', body: JSON.stringify(input) });
      if (response.status !== 200) throw Error('fixture_coordinator_refused'); return response.json();
    };
    const coordinator = createProductionImportCoordinator({ owner, manifestSha256: 'a'.repeat(64), incarnations, command });
    await coordinator.claim();
    const base = `https://api.cloudflare.com/client/v4/accounts/${PRODUCTION_RUNTIME.accountId}`;
    const runtimeBindings = [
      ...PRODUCTION_D1_TARGETS.map(row => ({ type: 'd1', name: { auth: 'AUTH_DB', business: 'FANMARK_DB', master: 'MASTER_DB' }[row.store], id: row.databaseId })),
      ...PRODUCTION_R2_TARGETS.map(row => ({ type: 'r2_bucket', name: row.store === 'avatars' ? 'AVATARS_BUCKET' : 'COVER_IMAGES_BUCKET', bucket_name: row.bucketName })),
      ...Object.entries({ D1_TOPOLOGY: 'split', EMOJI_PUBLICATION_BACKEND: 'production-service', RECOVERY_DRAIN_SCOPE_DIGEST: PRODUCTION_RUNTIME.scope,
        RECOVERY_DRAIN_BACKEND: 'durable-object', CUTOVER_WRITE_FREEZE: 'receipt_only', STORAGE_BACKEND: 'r2' }).map(([name, text]) => ({ name, type: 'plain_text', text })),
    ];
    let drift = null, loseAck = false, puts = 0, lastPut;
    const fetchImpl = async (url, options) => {
      assert.equal(options.redirect, 'error');
      if (url.startsWith(base)) {
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic_control_plane_token');
        let result;
        if (url.includes('/r2/buckets/')) { const target = PRODUCTION_R2_TARGETS.find(t => url.endsWith('/' + t.bucketName));
          assert.ok(target); result = { name: target.bucketName, creation_date: drift === 'bucket' ? 'changed' : target.createdAt, storage_class: 'Standard' };
        } else {
          const runtime = url.includes('/' + PRODUCTION_RUNTIME.worker + '/');
          const mode = Object.entries(origins).find(([, origin]) => url.includes('/' + new URL(origin).hostname.split('.')[0] + '/'))?.[0];
          assert.ok(runtime || mode);
          if (url.endsWith('/deployments')) result = { deployments: [{ versions: [{ percentage: 100, version_id: drift === 'version' ? randomUUID() : runtime ? version : gatewayVersion }] }] };
          else { assert.ok(url.endsWith('/settings')); result = { bindings: runtime ? runtimeBindings : [
            { name: 'R2_IMPORT', type: 'service', service: drift === 'gateway' ? 'wrong' : PRODUCTION_RUNTIME.worker, entrypoint: 'ProductionR2ImportService' },
            { name: 'EXPECTED_RUNTIME', text: version }, { name: 'GATE_ACCESS', text: mode }, { name: 'EXPIRES_AT', text: String(Date.now() + 600000) },
          ] }; }
        }
        return Response.json({ success: true, result });
      }
      const u = new URL(url); assert.ok(Object.values(origins).includes(u.origin));
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + 'b'.repeat(64));
      if (options.method === 'PUT') { puts++; lastPut = { url, options }; }
      const response = await mf.dispatchFetch('https://fixture.local' + u.pathname + u.search, options);
      if (options.method === 'PUT' && loseAck) { loseAck = false; await response.body?.cancel(); throw Error('private diagnostic after commit'); }
      return response;
    };
    const common = { runtimeVersion: version, gatewayVersion, bearer: 'b'.repeat(64), token: 'synthetic_control_plane_token', fetchImpl };
    const target = store => ({ ...PRODUCTION_R2_TARGETS.find(t => t.store === store), targetIncarnation: incarnations[store] });
    const reader = store => createProductionRemoteR2({credentialLease, ...common, target: target(store), gatewayOrigin: origins['read-only'] });
    const writer = (store, journal = store) => openProductionR2ImportTransport({credentialLease, ...common, target: target(store), gatewayOrigin: origins.import,
      journalPath: join(dir, journal + '.jsonl'), runId: owner, coordinator });
    const readBuckets = { avatars: reader('avatars'), covers: reader('covers') }, buckets = { avatars: await writer('avatars'), covers: await writer('covers') };
    await t.test('control-plane bucket, runtime and gateway drift refuse before data writes', async () => {
      for (const value of ['bucket', 'version', 'gateway']) { drift = value; await assert.rejects(readBuckets.avatars.list(), /transport_unconfirmed/); }
      drift = null; assert.equal(puts, 0);
      assert.throws(() => createProductionRemoteR2({credentialLease, ...common, target: { ...target('avatars'), bucketName: 'fanmark-backups-production' }, gatewayOrigin: origins.import }), /transport_unconfirmed/);
      assert.throws(() => createProductionRemoteR2({credentialLease, ...common, target: target('avatars'), gatewayOrigin: origins.import, access: 'import' }), /transport_unconfirmed/);
    });
    await t.test('actual initial stage and independent reader preserve split keys, empty body and missing MIME', async () => {
      await mkdir(join(dir, 'objects'), { mode: 0o700 }); const objects = [];
      for (let i = 0; i < 4; i++) {
        const bucket = i % 2 ? 'cover-images' : 'avatars', key = `owner/${Math.floor(i / 2)}-日本語.png`, bytes = Buffer.from(i ? 'image-' + i : '');
        const localFile = 'objects/' + objectIdentityHash(bucket, key); await writeFile(join(dir, localFile), bytes, { mode: 0o600 });
        objects.push({ bucket, key, size: bytes.length, contentSHA256: sha(bytes), metadata: i % 2 ? null : { mimetype: 'image/png' }, localFile });
      }
      const names = ['avatars', 'cover-images'], inventory = { stable: true, beforeSHA256: sha('fixture'), afterSHA256: sha('fixture') };
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true, generatedAt: '2026-10-19T00:00:00.000Z', buckets: names, objectCount: 4, inventory, objects }), { mode: 0o600 });
      await writeFile(join(dir, 'export.status.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', startedAt: '2026-10-19T00:00:00.000Z', buckets: names, objectCount: 4, inventory }), { mode: 0o600 });
      const reportPath = join(dir, 'import.json');
      const report = await importProductionSplitR2Export({ exportDir: dir, reportPath, buckets, readBuckets, pageSize: 1 });
      assert.equal(report.objectCount, 4); assert.equal(report.transportIdentityVerified, true); assert.equal(report.productionReady, false);
      assert.equal(report.coordinatorCompleted, false); assert.equal((await coordinator.inspect()).state.acknowledged, 4);
      await unlink(reportPath);
      const before = puts; const verified = await verifyProductionSplitR2Export({ exportDir: dir, buckets: readBuckets, pageSize: 1 });
      assert.equal(verified.objectWrites, 0); assert.equal(puts, before);
      await assert.rejects(importProductionSplitR2Export({ exportDir: dir, reportPath, buckets, readBuckets }), /preflight_failed/);
      assert.equal(puts, before);
    });
    await t.test('lost native put ACK leaves both journals pending; separate reader proves bytes without resending', async () => {
      const bytes = Buffer.from('lost response'), key = 'owner/lost.png', hash = sha(bytes);
      const options = { onlyIf: { etagDoesNotMatch: '*' }, sha256: hash, httpMetadata: undefined, customMetadata: {
        'fanmark-source-bucket': 'avatars', 'fanmark-source-key': key, 'fanmark-source-sha256': hash, 'fanmark-source-size': String(bytes.length) } };
      loseAck = true;
      await assert.rejects(buckets.avatars.putWithSize(key, new Response(bytes).body, options, bytes.length), /transport_unconfirmed/);
      const failed=JSON.parse(await readFile(join(dir,'avatars.jsonl.failure.json'),'utf8'));
      assert.equal(failed.phase,'http-put');assert.equal(failed.dataRequestAttempted,true);
      assert.equal(failed.replayAllowed,false);assert.equal(failed.outcomeResolved,false);
      assert.equal((await coordinator.inspect()).state.pending.store, 'avatars');
      assert.equal(JSON.parse((await readFile(join(dir, 'avatars.jsonl'), 'utf8')).trim().split('\n').at(-1)).type, 'intent');
      const read = await readBuckets.avatars.get(key); assert.equal(Buffer.from(await read.arrayBuffer()).toString(), bytes.toString());
      const journalPath = join(dir, 'avatars.jsonl');
      const inspection = await inspectProductionImportAttempt({ journalPath, coordinator });
      assert.equal(inspection.classification, 'remote-dispatched-unresolved');
      assert.equal(inspection.replayAllowed, false);
      await assert.rejects(recoverAcknowledgedProductionImport({ journalPath, coordinator }));
      const before = puts, another = await writer('avatars', 'different-journal');
      await assert.rejects(another.putWithSize(key, new Response(bytes).body, options, bytes.length), /coordination_unconfirmed/);
      assert.equal(puts, before);
      const replay = await fetchImpl(lastPut.url, lastPut.options); assert.equal(replay.status, 409);
      assert.equal((await readBuckets.avatars.get(key)).version, read.version);
      await assert.rejects(readBuckets.avatars.putWithSize(key, new Response(bytes).body, options, bytes.length), /transport_unconfirmed/);
    });
  } finally { await mf.dispose(); await rm(dir, { recursive: true, force: true }); }
});

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
import {verifyAcknowledgedProductionR2Subset,resumeAcknowledgedProductionSplitR2Export} from './production-r2-partial-resume.mjs';
import {openProductionImportJournal} from './production-import-journal.mjs';
import {prepareStorageImportReadback} from './storage-r2-import.mjs';
import { objectIdentityHash } from './storage-export.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('partial image continuation verifies ACKed native objects and sends only missing objects', { timeout: 60000 }, async t => {
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
      await mkdir(join(dir, 'objects'), { mode: 0o700 }); const objects = [];
      for (let i = 0; i < 4; i++) {
        const bucket = i % 2 ? 'cover-images' : 'avatars', key = `owner/${Math.floor(i / 2)}-日本語.png`, bytes = Buffer.from(i ? 'image-' + i : '');
        const localFile = 'objects/' + objectIdentityHash(bucket, key); await writeFile(join(dir, localFile), bytes, { mode: 0o600 });
        objects.push({ bucket, key, size: bytes.length, contentSHA256: sha(bytes), metadata: i % 2 ? null : { mimetype: 'image/png' }, localFile });
      }
      const names = ['avatars', 'cover-images'], inventory = { stable: true, beforeSHA256: sha('fixture'), afterSHA256: sha('fixture') };
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true, generatedAt: '2026-10-19T00:00:00.000Z', buckets: names, objectCount: 4, inventory, objects }), { mode: 0o600 });
      await writeFile(join(dir, 'export.status.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', startedAt: '2026-10-19T00:00:00.000Z', buckets: names, objectCount: 4, inventory }), { mode: 0o600 });

    const expected=await prepareStorageImportReadback({exportDir:dir}),journalPaths={avatars:join(dir,'avatars.jsonl'),covers:join(dir,'covers.jsonl')};
    for(const store of ['auth','master','business']){journalPaths[store]=join(dir,store+'.jsonl');await openProductionImportJournal({path:journalPaths[store],runId:owner,targetId:PRODUCTION_D1_TARGETS.find(d=>d.store===store).databaseId,targetIncarnation:incarnations[store]});}
    const put=async object=>{const store=object.bucket==='avatars'?'avatars':'covers',bytes=await readFile(join(dir,objects.find(o=>o.bucket===object.bucket&&o.key===object.key).localFile));return buckets[store].putWithSize(object.key,new Response(bytes).body,{onlyIf:{etagDoesNotMatch:'*'},sha256:object.contentSHA256,httpMetadata:object.contentType===null?undefined:{contentType:object.contentType},customMetadata:object.customMetadata},object.size);};
    await put(expected.objects[0]);await put(expected.objects[1]);assert.equal(puts,2);
    const options={exportDir:dir,buckets:readBuckets,coordinator,journalPaths},proof=await verifyAcknowledgedProductionR2Subset(options);assert.equal(proof.existingImages,2);assert.equal(proof.missingImages,2);assert.equal(puts,2);
    const physical={avatars:await mf.getR2Bucket('AVATARS_BUCKET'),covers:await mf.getR2Bucket('COVER_IMAGES_BUCKET')};
    await t.test('extra, missing, modified bytes, metadata and omitted ACK history reject before any new PUT',async()=>{
      const obj=expected.objects[1],store=obj.bucket==='avatars'?'avatars':'covers',bucket=physical[store],current=await bucket.get(obj.key),bytes=await current.arrayBuffer(),saved={httpMetadata:current.httpMetadata,customMetadata:current.customMetadata};
      const restore=()=>bucket.put(obj.key,bytes,saved);
      await physical.avatars.put('unowned.png','unowned');await assert.rejects(verifyAcknowledgedProductionR2Subset(options));await physical.avatars.delete('unowned.png');
      await bucket.delete(obj.key);await assert.rejects(verifyAcknowledgedProductionR2Subset(options));await restore();
      await bucket.put(obj.key,Buffer.alloc(obj.size,99),saved);await assert.rejects(verifyAcknowledgedProductionR2Subset(options));await restore();
      await bucket.put(obj.key,bytes,{...saved,httpMetadata:{...saved.httpMetadata,cacheControl:'private'}});await assert.rejects(verifyAcknowledgedProductionR2Subset(options));await restore();
      const path=journalPaths[store],text=await readFile(path,'utf8');await writeFile(path,text.split('\n').slice(0,1).join('\n')+'\n');await assert.rejects(verifyAcknowledgedProductionR2Subset(options));await writeFile(path,text);
      assert.equal(puts,2);
    });
    const result=await resumeAcknowledgedProductionSplitR2Export({exportDir:dir,buckets,readBuckets,reportPath:join(dir,'resumed.json'),coordinator,journalPaths});
    assert.equal(result.retainedImages,2);assert.equal(result.newImages,2);assert.equal(puts,4);assert.equal((await coordinator.inspect()).state.acknowledged,4);
    const complete=await verifyAcknowledgedProductionR2Subset(options);assert.equal(complete.existingImages,4);assert.equal(complete.missingImages,0);
    await coordinator.beforeWrite({operationId:randomUUID(),batchSha256:'f'.repeat(64),store:'covers'});await assert.rejects(verifyAcknowledgedProductionR2Subset(options));assert.equal(puts,4);
  }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { createIsolatedRemoteR2 } from './isolated-remote-r2.mjs';
import { createSplitR2ImportTransport } from './split-r2-import-transport.mjs';
import { importStorageExport } from './storage-r2-import.mjs';
import { objectIdentityHash } from './storage-export.mjs';

const OWNER = '90000000-0000-4000-8000-00000000000d';
const token = 'a'.repeat(64);
const targetIncarnation = '91111111-1111-4111-8111-111111111111';
const expectedBuckets = { avatars: 'fanmark-recovery-synthetic-native-avatars', covers: 'fanmark-recovery-synthetic-native-covers' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('isolated HTTP recovery transport preserves real R2 create/readback and app delivery', async context => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('./isolated-recovery-r2-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const vars = { RECOVERY_TOKEN: token, RECOVERY_INCARNATION: targetIncarnation,
    RECOVERY_AVATARS_NAME: expectedBuckets.avatars, RECOVERY_COVERS_NAME: expectedBuckets.covers, STORAGE_BACKEND: 'r2' };
  const mf = new Miniflare({ workers: [{ config: {
    name: 'isolated-r2-native', type: 'worker', compatibilityDate: '2026-09-20',
    env: { ...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, { type: 'text', value }])),
      AVATARS_BUCKET: { type: 'r2', name: expectedBuckets.avatars }, COVER_IMAGES_BUCKET: { type: 'r2', name: expectedBuckets.covers } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: compiled.outputFiles[0].text } } },
  } }] });
  const root = await mkdtemp('/tmp/fanmark-isolated-r2-native-');
  try {
    const workerOrigin = (await mf.ready).origin;
    const config = { workerOrigin, token, targetIncarnation, expectedBuckets, allowLoopback: true };
    const remote = createIsolatedRemoteR2(config);
    const physical = [await mf.getR2Bucket('AVATARS_BUCKET'), await mf.getR2Bucket('COVER_IMAGES_BUCKET')];
    const r2 = createSplitR2ImportTransport(remote);
    await context.test('identity and private endpoints refuse unauthorized/mismatched destinations before writes', async () => {
      assert.deepEqual(await remote.verifyIsolatedTarget(), { targetIncarnation, buckets: expectedBuckets });
      assert.equal((await fetch(workerOrigin + '/_recovery/list/avatars')).status, 401);
      assert.throws(() => createIsolatedRemoteR2({ ...config, expectedBuckets: { ...expectedBuckets, avatars: 'fanmark-avatars-staging' } }), /recovery_transport_invalid/u);
      const wrong = createIsolatedRemoteR2({ ...config, targetIncarnation: '92222222-2222-4222-8222-222222222222' });
      await assert.rejects(wrong.avatars.get(`${OWNER}/avatar.png`), error =>
        error.code === 'recovery_identity_unavailable' && error.httpStatus === 403);
      assert.equal((await physical[0].list()).objects.length, 0);
      await assert.rejects(remote.avatars.get(`${OWNER}/other.png`), /recovery_key_invalid/u);
    });
    await context.test('identity failures retain bounded codes/status without persisting provider body or transport messages', async () => {
      const unavailable = createIsolatedRemoteR2({ ...config, fetchImpl: async () => new Response('private-provider-diagnostic', { status: 503 }) });
      await assert.rejects(unavailable.verifyIsolatedTarget(), error => error.code === 'recovery_identity_unavailable' &&
        error.httpStatus === 503 && !JSON.stringify(error).includes('private-provider-diagnostic'));
      const unreachable = createIsolatedRemoteR2({ ...config, fetchImpl: async () => {
        throw Object.assign(new Error('private-transport-diagnostic'), { cause: { code: 'ENOTFOUND' } });
      } });
      await assert.rejects(unreachable.verifyIsolatedTarget(), error => error.code === 'recovery_request_acknowledgement_unknown' &&
        error.transportCode === 'ENOTFOUND' && !JSON.stringify(error).includes('private-transport-diagnostic'));
    });
    const exportDir = path.join(root, 'export');
    await mkdir(path.join(exportDir, 'objects'), { recursive: true, mode: 0o700 });
    const objects = [];
    for (const [bucket, filename] of [['avatars', 'avatar.png'], ['cover-images', 'cover.png']]) {
      const key = `${OWNER}/${filename}`;
      const localFile = 'objects/' + objectIdentityHash(bucket, key);
      await writeFile(path.join(exportDir, localFile), png, { mode: 0o600 });
      objects.push({ bucket, key, size: png.length, contentSHA256: sha(png), metadata: { mimetype: 'image/png' }, localFile });
    }
    const inventory = { stable: true, beforeSHA256: sha(JSON.stringify(objects)), afterSHA256: sha(JSON.stringify(objects)) };
    await writeFile(path.join(exportDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true,
      generatedAt: '2026-09-26T12:00:00.000000Z', buckets: ['avatars', 'cover-images'], objectCount: 2, inventory, objects }), { mode: 0o600 });
    await writeFile(path.join(exportDir, 'export.status.json'), JSON.stringify({ schemaVersion: 1, status: 'complete',
      startedAt: '2026-09-26T12:00:00.000000Z', buckets: ['avatars', 'cover-images'], objectCount: 2, inventory }), { mode: 0o600 });
    let importedReady = false;
    await context.test('the importer copies/replays two linked images and retains physical keys, bytes and metadata', async () => {
      const options = { exportDir, reportPath: path.join(exportDir, 'import.status.json'), r2, chunkSize: 3 };
      let first;
      try { first = await importStorageExport(options); }
      catch (error) { context.diagnostic(`import failure code=${error.code} cause=${error.cause?.message ?? 'none'}`); throw error; }
      assert.equal(first.copiedCount, 2);
      assert.equal((await importStorageExport(options)).complete, true);
      for (const [index, object] of objects.entries()) {
        const imported = await r2.get(`${object.bucket}/${object.key}`);
        assert.equal(sha(Buffer.from(await imported.arrayBuffer())), object.contentSHA256);
        assert.equal(imported.httpMetadata.contentType, 'image/png');
        assert.deepEqual((await physical[index].list()).objects.map(item => item.key), [object.key]);
      }
      assert.deepEqual((await remote.avatars.list()).objects, [{ key: objects[0].key, size: png.length }]);
      importedReady = true;
    });
    assert.equal(importedReady, true, 'import must pass before checking conflict and delivery');
    await context.test('a real native conditional-create conflict returns null and leaves the winner unchanged', async () => {
      const alternate = Buffer.from(png); alternate[0] = 0;
      const result = await remote.avatars.putWithSize(objects[0].key, new Blob([alternate]).stream(), {
        onlyIf: { etagDoesNotMatch: '*' }, sha256: sha(alternate), httpMetadata: { contentType: 'image/png' }, customMetadata: {},
      }, alternate.length);
      assert.equal(result, null);
      assert.equal(sha(Buffer.from(await (await remote.avatars.get(objects[0].key)).arrayBuffer())), sha(png));
    });
    await context.test('the bundled actual app Storage GET/HEAD delivers both imported R2 objects', async () => {
      for (const object of objects) {
        const url = workerOrigin + `/api/storage/public/${object.bucket}/${object.key}`;
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(sha(Buffer.from(await response.arrayBuffer())), object.contentSHA256);
        const head = await fetch(url, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(png.length));
      }
    });
    await context.test('the owning conductor can remove its exact fixture keys and prove empty inventories', async () => {
      await remote.avatars.deleteOwnedFixture(objects[0].key);
      await remote.covers.deleteOwnedFixture(objects[1].key);
      assert.deepEqual((await remote.avatars.list()).objects, []);
      assert.deepEqual((await remote.covers.list()).objects, []);
      assert.equal(await remote.avatars.get(objects[0].key), null);
      assert.equal((await fetch(workerOrigin + `/_recovery/objects/avatars/${objects[0].key}`, { method: 'DELETE' })).status, 401);
    });
  } finally { await mf.dispose(); await rm(root, { recursive: true, force: true }); }
});

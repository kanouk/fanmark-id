import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from '../../workers/api/src/production-runtime-identity.ts';
import { importObjectDigest, importDigest, MAX_IMPORT_OBJECT_BYTES } from '../../workers/api/src/production-r2-import-contract.ts';

test('production R2 binding-only service uses native R2 and durable once-only dispatch', { timeout: 60000 }, async t => {
  const version = randomUUID(), owner = randomUUID();
  const built = await build({ stdin: { contents: `export { RecoveryWriterCoordinatorProductionV2 } from './recovery-writer-drain';
    export { ProductionR2ImportService } from './production-r2-import-service';
    export default { async fetch(r,e){const u=new URL(r.url);
      if(u.pathname.startsWith('/command/'))return e.RECOVERY_DRAIN.get(e.RECOVERY_DRAIN.idFromName('recovery-writers-v1')).fetch('https://recovery-writer.internal/migration/'+u.pathname.slice(9),{method:'POST',body:await r.text()});
      return e.IMPORT.fetch(new Request('https://production-import-r2.internal'+u.pathname+u.search,r));
    }};`, resolveDir: fileURLToPath(new URL('../../workers/api/src', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const text = value => ({ type: 'text', value });
  const mf = new Miniflare({ workers: [{ config: { name: 'r2-import-fixture', type: 'worker', compatibilityDate: '2026-09-18',
    exports: { RecoveryWriterCoordinatorProductionV2: { type: 'durable-object', storage: 'sqlite' } },
    env: { RECOVERY_DRAIN: { type: 'durable-object', worker: 'r2-import-fixture', exportName: 'RecoveryWriterCoordinatorProductionV2' },
      IMPORT: { type: 'worker', worker: 'r2-import-fixture', exportName: 'ProductionR2ImportService' },
      RECOVERY_DRAIN_SCOPE_DIGEST: text(PRODUCTION_RUNTIME.scope), RECOVERY_DRAIN_BACKEND: text('durable-object'),
      CUTOVER_WRITE_FREEZE: text('receipt_only'), D1_TOPOLOGY: text('split'), STORAGE_BACKEND: text('r2'),
      STAGING_BACKUP_SOURCE_IDS: text(JSON.stringify(PRODUCTION_STORE_IDS)), CF_VERSION_METADATA: { type: 'json', value: { id: version } },
      AVATARS_BUCKET: { type: 'r2', name: 'test-avatars' }, COVER_IMAGES_BUCKET: { type: 'r2', name: 'test-covers' } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: built.outputFiles[0].text } } } },
    dev: { outboundService: { type: 'fetcher', handler() { throw Error('external_network_forbidden'); } } } }] });
  try {
    const call = (path, options = {}) => mf.dispatchFetch('https://fixture.local' + path, { ...options,
      headers: { 'x-fanmark-import-runtime': version, ...options.headers } });
    const command = (action, input) => call('/command/' + action, { method: 'POST', body: JSON.stringify(input) });
    const inspect = async () => (await command('inspect', { owner })).json();
    const avatars = await mf.getR2Bucket('AVATARS_BUCKET'), covers = await mf.getR2Bucket('COVER_IMAGES_BUCKET');
    async function objectFor(store, key, body) {
      const sha256 = await importDigest(body);
      return { store, key, size: body.length, sha256, httpMetadata: { contentType: 'image/png' }, customMetadata: {
        'fanmark-source-bucket': store === 'avatars' ? 'avatars' : 'cover-images', 'fanmark-source-key': key,
        'fanmark-source-sha256': sha256, 'fanmark-source-size': String(body.length), 'fanmark-source-content-type': 'image/png' } };
    }
    async function operation(object) { return { owner, operationId: randomUUID(), store: object.store, batchSha256: await importObjectDigest(object) }; }
    function put(object, op, bytes, headers = {}) { return call('/object?' + new URLSearchParams({ store: object.store, key: object.key }), {
      method: 'PUT', body: bytes, headers: { 'content-length': String(bytes.length), 'x-fanmark-import-owner': owner,
        'x-fanmark-import-operation': op.operationId, 'x-fanmark-import-digest': op.batchSha256,
        'x-fanmark-import-object': Buffer.from(JSON.stringify(object)).toString('base64'), ...headers } }); }
    await t.test('identity requires exact version; read-only calls do not claim the global fence', async () => {
      assert.equal((await call('/identity', { headers: { 'x-fanmark-import-runtime': randomUUID() } })).status, 409);
      assert.deepEqual(await (await call('/identity')).json(), { runtimeVersion: version, scope: PRODUCTION_RUNTIME.scope, stores: PRODUCTION_STORE_IDS });
      assert.equal((await inspect()).state, null);
      const page = await (await call('/list?store=avatars&limit=1')).json(); assert.deepEqual(page.objects, []);
      assert.equal((await call('/object?store=avatars&key=missing')).status, 404);
    });
    await t.test('no write without matching pending operation or with invalid key/size/body/provenance', async () => {
      const bytes = new Uint8Array([1, 2, 3]), object = await objectFor('avatars', 'owner/日本語.png', bytes), op = await operation(object);
      assert.equal((await put(object, op, bytes)).status, 409);
      assert.equal(await avatars.get(object.key), null);
      assert.equal((await command('claim', { owner, manifestSha256: 'a'.repeat(64), incarnationsSha256: 'b'.repeat(64) })).status, 200);
      assert.equal((await command('begin', op)).status, 200);
      for (const modified of [{ ...object, key: '../bad' }, { ...object, size: MAX_IMPORT_OBJECT_BYTES + 1 },
        { ...object, customMetadata: { ...object.customMetadata, extra: 'bad' } }, { ...object, sha256: 'c'.repeat(64) }])
        assert.equal((await put(modified, op, bytes)).status, 409);
      assert.equal((await put(object, op, new Uint8Array([4, 5, 6]))).status, 409);
      assert.equal(await avatars.get(object.key), null);
      const response = await put(object, op, bytes); assert.equal(response.status, 200);
      const saved = await response.json(); assert.equal(saved.key, object.key);
      assert.deepEqual(new Uint8Array(await (await avatars.get(object.key)).arrayBuffer()), bytes);
      assert.deepEqual((await inspect()).state.pending, { operationId: op.operationId, batchSha256: op.batchSha256, store: 'avatars' });
      // Simulate a lost put ACK. A repeat request is refused before touching R2.
      assert.equal((await put(object, op, bytes)).status, 409);
      assert.equal((await avatars.get(object.key)).version, saved.version);
      assert.equal((await command('acknowledge', op)).status, 200);
      assert.equal((await put(object, op, bytes)).status, 409);
    });
    await t.test('split buckets preserve the same physical key, zero bytes, metadata and pagination', async () => {
      for (const key of ['owner/日本語.png', 'owner/zero.png']) {
        const bytes = new Uint8Array(0), object = await objectFor('covers', key, bytes), op = await operation(object);
        assert.equal((await command('begin', op)).status, 200);
        assert.equal((await put(object, op, bytes)).status, 200);
        assert.equal((await command('acknowledge', op)).status, 200);
        const response = await call('/object?' + new URLSearchParams({ store: 'covers', key }));
        assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, 0);
        const metadata = JSON.parse(Buffer.from(response.headers.get('x-fanmark-import-object'), 'base64'));
        assert.deepEqual(metadata.customMetadata, object.customMetadata); assert.deepEqual(metadata.httpMetadata, object.httpMetadata);
      }
      const first = await (await call('/list?store=covers&limit=1')).json(); assert.equal(first.truncated, true);
      const second = await (await call('/list?' + new URLSearchParams({ store: 'covers', limit: '1', cursor: first.cursor }))).json();
      assert.equal(second.truncated, false); assert.notEqual(first.objects[0].key, second.objects[0].key);
    });
    await t.test('conditional collision preserves bytes and keeps the global pending operation', async () => {
      const key = 'owner/collision.png', winner = await covers.put(key, 'existing');
      const bytes = new Uint8Array([7]), object = await objectFor('covers', key, bytes), op = await operation(object);
      assert.equal((await command('begin', op)).status, 200);
      assert.equal((await put(object, op, bytes)).status, 412);
      assert.equal((await covers.get(key)).version, winner.version);
      assert.equal((await put(object, op, bytes)).status, 409);
      assert.equal((await command('begin', { ...op, operationId: randomUUID() })).status, 409);
      assert.equal((await inspect()).state.pending.operationId, op.operationId);
    });
    await t.test('no delete or arbitrary bucket/path API is exposed', async () => {
      for (const path of ['/object?store=other&key=owner/a', '/list?store=avatars&limit=0', '/list?store=avatars&store=covers&limit=1'])
        assert.equal((await call(path)).status, 409);
      assert.equal((await call('/object?store=covers&key=owner/collision.png', { method: 'DELETE' })).status, 404);
      assert.equal((await covers.get('owner/collision.png')).size, 8);
    });
  } finally { await mf.dispose(); }
});

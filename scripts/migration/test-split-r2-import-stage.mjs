import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { LOCAL_R2_IMPORT_WORKER, createLocalR2ImportTransport } from './local-r2-import-transport.mjs';
import { objectIdentityHash } from './storage-export.mjs';
import { importInitialSplitR2Export, verifyImportedSplitR2Export } from './split-r2-import-stage.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, count = 4) {
  const root = await mkdtemp(path.join(tmpdir(), 'fanmark-initial-r2-'));
  await mkdir(path.join(root, 'objects'), { mode: 0o700 });
  const entries = [];
  for (let index = 0; index < count; index++) {
    const bucket = index % 2 ? 'cover-images' : 'avatars';
    // Same physical key in two logical buckets is intentional.
    const key = `90000000-0000-4000-8000-00000000000d/${Math.floor(index / 2)}-日本語.png`;
    const content = Buffer.from(index ? `synthetic-image-${index}` : '');
    const localFile = 'objects/' + objectIdentityHash(bucket, key);
    await writeFile(path.join(root, localFile), content, { mode: 0o600 });
    entries.push({ bucket, key, size: content.length, contentSHA256: sha(content), metadata: index % 2 ? null : { mimetype: 'image/png' }, localFile });
  }
  const buckets = ['avatars', 'cover-images'];
  const inventory = { stable: true, beforeSHA256: sha('fixture'), afterSHA256: sha('fixture') };
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true,
    generatedAt: '2026-10-19T00:00:00.000Z', buckets, objectCount: entries.length, inventory, objects: entries }), { mode: 0o600 });
  await writeFile(path.join(root, 'export.status.json'), JSON.stringify({ schemaVersion: 1, status: 'complete',
    startedAt: '2026-10-19T00:00:00.000Z', buckets, objectCount: entries.length, inventory }), { mode: 0o600 });
  const mf = new Miniflare({ workers: [{ config: { name: 'initial-r2-native', type: 'worker', compatibilityDate: '2026-09-18',
    env: { AVATARS_BUCKET: { type: 'r2', name: 'native-avatars' }, COVER_IMAGES_BUCKET: { type: 'r2', name: 'native-covers' } },
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: LOCAL_R2_IMPORT_WORKER } } },
  } }] });
  t.after(async () => { await mf.dispose(); await rm(root, { recursive: true, force: true }); });
  const physical = { avatars: await mf.getR2Bucket('AVATARS_BUCKET'), covers: await mf.getR2Bucket('COVER_IMAGES_BUCKET') };
  const loopbackBase = (await mf.ready).origin;
  const writer = Object.fromEntries(Object.entries(physical).map(([store, bucket]) => [store,
    createLocalR2ImportTransport({ bucket, loopbackBase, bucketBinding: store === 'avatars' ? 'AVATARS_BUCKET' : 'COVER_IMAGES_BUCKET' })]));
  const options = { exportDir: root, reportPath: path.join(root, 'initial.status.json'), buckets: writer, readBuckets: physical, pageSize: 2 };
  const verify = overrides => verifyImportedSplitR2Export({ exportDir: root, buckets: physical, pageSize: 2, ...overrides });
  return { root, entries, physical, writer, options, verify };
}
async function replace(bucket, key, transform) {
  const current = await bucket.get(key);
  const body = await current.arrayBuffer();
  const value = { body, httpMetadata: current.httpMetadata, customMetadata: current.customMetadata };
  transform(value);
  await bucket.put(key, value.body, { httpMetadata: value.httpMetadata, customMetadata: value.customMetadata });
}

test('native split R2 initial import: pagination, same physical names, empty bytes and independent readback without report', async t => {
  const f = await fixture(t, 7);
  const imported = await importInitialSplitR2Export(f.options);
  assert.equal(imported.objectCount, 7);
  assert.equal(imported.productionReady, false);
  assert.equal(imported.transportIdentityVerified, false);
  assert.equal(imported.coordinatorCompleted, false);
  await unlink(f.options.reportPath);
  const readonly = Object.fromEntries(Object.entries(f.physical).map(([store, bucket]) => [store, {
    list: bucket.list.bind(bucket), get: bucket.get.bind(bucket),
    put() { assert.fail('readback cannot write'); }, delete() { assert.fail('readback cannot delete'); },
  }]));
  const report = await f.verify({ buckets: readonly });
  assert.equal(report.objectWrites, 0);
  assert.equal(report.inventorySha256, imported.inventorySha256);
  assert.equal(JSON.stringify(report).includes('日本語'), false);
  assert.equal((await f.physical.avatars.list()).objects.length, 4);
  assert.equal((await f.physical.covers.list()).objects.length, 3);
});

test('native readback rejects missing, extra, swapped and equal-size altered bytes or metadata', async t => {
  for (const mutation of ['missing', 'extra', 'swapped', 'bytes', 'mime', 'provenance', 'extra-metadata', 'cache']) await t.test(mutation, async t => {
    const f = await fixture(t);
    await importInitialSplitR2Export(f.options);
    const entry = f.entries[2], bucket = f.physical.avatars;
    if (mutation === 'missing') await bucket.delete(entry.key);
    else if (mutation === 'extra') await bucket.put('unexpected.png', 'unexpected');
    else if (mutation === 'swapped') {
      await assert.rejects(f.verify({ buckets: { avatars: f.physical.covers, covers: f.physical.avatars } }), /readback_failed/); return;
    } else await replace(bucket, entry.key, value => {
      if (mutation === 'bytes') value.body = Buffer.alloc(entry.size, 65);
      if (mutation === 'mime') value.httpMetadata.contentType = 'image/jpeg';
      if (mutation === 'provenance') value.customMetadata['fanmark-source-bucket'] = 'cover-images';
      if (mutation === 'extra-metadata') value.customMetadata.extra = 'unexpected';
      if (mutation === 'cache') value.httpMetadata.cacheControl = 'public';
    });
    await assert.rejects(f.verify(), /readback_failed/);
  });
});

test('nonempty destination fails before writes and initial reports cannot be resumed', async t => {
  const f = await fixture(t);
  await f.physical.covers.put('unrelated.png', 'retained');
  let writes = 0;
  const buckets = Object.fromEntries(Object.entries(f.writer).map(([store, bucket]) => [store, { ...bucket,
    putWithSize() { writes++; assert.fail('must not write'); } }]));
  await assert.rejects(importInitialSplitR2Export({ ...f.options, buckets }), /preflight_failed/);
  assert.equal(writes, 0);
  assert.equal(await (await f.physical.covers.get('unrelated.png')).text(), 'retained');
  await f.physical.covers.delete('unrelated.png');
  await writeFile(f.options.reportPath, '{}', { mode: 0o600 });
  await assert.rejects(importInitialSplitR2Export({ ...f.options, buckets }), /partial_or_unknown_write/);
  assert.equal(writes, 0);
});

test('lost write ACK leaves data in place, stops before the next object and refuses restart', async t => {
  const f = await fixture(t);
  let writes = 0;
  const buckets = { ...f.writer, avatars: { ...f.writer.avatars,
    async putWithSize(...args) { writes++; await f.writer.avatars.putWithSize(...args); throw Error('PRIVATE_SENTINEL'); },
  } };
  await assert.rejects(importInitialSplitR2Export({ ...f.options, buckets }), error =>
    error.message === 'split_r2_import_partial_or_unknown_write' && error.cause === undefined);
  assert.equal(writes, 1);
  assert.equal((await f.physical.avatars.list()).objects.length, 1);
  assert.equal((await f.physical.covers.list()).objects.length, 0);
  await assert.rejects(importInitialSplitR2Export({ ...f.options, buckets }), /preflight_failed/);
  assert.equal(writes, 1);
  assert.equal((await readFile(f.options.reportPath, 'utf8')).includes('PRIVATE_SENTINEL'), false);
});

test('late native conditional-create conflict preserves the winner and stops the initial stage', async t => {
  const f = await fixture(t);
  const buckets = { ...f.writer, avatars: { ...f.writer.avatars,
    async putWithSize(key, stream, options, size) {
      await f.physical.avatars.put(key, 'winner');
      return f.writer.avatars.putWithSize(key, stream, options, size);
    },
  } };
  await assert.rejects(importInitialSplitR2Export({ ...f.options, buckets }), /partial_or_unknown_write/);
  assert.equal(await (await f.physical.avatars.get(f.entries[0].key)).text(), 'winner');
  assert.equal((await f.physical.covers.list()).objects.length, 0);
});

test('pagination cycles, inventory drift and unavailable providers cannot pass readback', async t => {
  const f = await fixture(t);
  await importInitialSplitR2Export(f.options);
  for (const list of [
    async () => ({ objects: [], truncated: true, cursor: 'repeated' }),
    async () => { throw Error('PRIVATE_SENTINEL'); },
    async () => ({ objects: [], truncated: 'false' }),
  ]) {
    const buckets = { ...f.physical, avatars: { get: f.physical.avatars.get.bind(f.physical.avatars), list } };
    await assert.rejects(f.verify({ buckets }), error => error.message === 'split_r2_import_readback_failed' && !error.cause);
  }
  let lists = 0;
  const buckets = { ...f.physical, avatars: {
    get: f.physical.avatars.get.bind(f.physical.avatars),
    async list(options) { if (++lists === 2) await f.physical.avatars.put('late.png', 'late'); return f.physical.avatars.list(options); },
  } };
  await assert.rejects(f.verify({ buckets }), /readback_failed/);
});

test('invalid source bytes are rejected before target writes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, f.entries[2].localFile), 'changed');
  await assert.rejects(importInitialSplitR2Export(f.options), /preflight_failed/);
  assert.equal((await f.physical.avatars.list()).objects.length, 0);
  assert.equal((await f.physical.covers.list()).objects.length, 0);
});

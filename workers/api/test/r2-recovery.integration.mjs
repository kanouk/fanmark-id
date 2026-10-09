import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Miniflare} from 'miniflare';
import {captureR2RecoverySnapshot as capture, sealR2RecoverySnapshot as seal,
  openR2RecoverySnapshot as open, restoreR2RecoverySnapshot as restore,
  r2RecoveryDigest} from '../src/r2-recovery.ts';
import {handleStorageRequest} from '../src/storage-r2.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MXYAAAAASUVORK5CYII=', 'base64');
const owner = '90000000-0000-4000-8000-000000000001';
function wrapped(bucket, overrides) {
  return new Proxy(bucket, {get(target, property) {
    if (property in overrides) return overrides[property];
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
}
const modes = mode => ({expectedKind: 'avatars', mode});
// This pinned Miniflare version reports an empty storageClass even after an explicit Standard PUT.
// Supply only this missing local-fixture field. Object bytes, metadata, pagination and conditional writes stay native.
// This adapter is not evidence of remote storage-class preservation; the recovery module itself rejects unknown classes.
function standardLocalBucket(bucket) {
  const object = value => value === null ? null : wrapped(value, {
    storageClass: value.storageClass === '' ? 'Standard' : value.storageClass,
  });
  return wrapped(bucket, {
    get: async (...args) => object(await bucket.get(...args)),
    head: async (...args) => object(await bucket.head(...args)),
    put: async (...args) => object(await bucket.put(...args)),
    list: async (...args) => {const page = await bucket.list(...args); return {...page, objects: page.objects.map(object)};},
  });
}
test('R2 archive codecs cross chunk boundaries without accepting noncanonical data or caller mutation', {timeout: 60_000}, async () => {
  const mf = new Miniflare({workers: [{config: {name: 'r2-recovery-codec-boundaries', type: 'worker', compatibilityDate: '2026-09-18',
    env: {SOURCE: {type: 'r2', name: 'codec-source'}, TARGET: {type: 'r2', name: 'codec-target'}},
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents:
      'export default {fetch(){return new Response("local-only")}}'}}},
  }}]});
  try {
    const source = standardLocalBucket(await mf.getR2Bucket('SOURCE')), target = standardLocalBucket(await mf.getR2Bucket('TARGET'));
    for (const size of [8190, 8191, 24575, 24576, 24577, 65537]) {
      const bytes = new Uint8Array(size); bytes.fill(78);
      await source.put(String(size), bytes, {storageClass: 'Standard', httpMetadata: {contentType: 'application/octet-stream'},
        customMetadata: {literal: 'preserve'}});
    }
    const snapshot = await capture(source, 'avatars'), expectedHash = snapshot.objectsHash;
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const sealing = seal(snapshot, key, 'avatars');
    snapshot.objects[0].bytes = 'invalid'; snapshot.objects[0].customMetadata.literal = 'mutated'; snapshot.objects.length = 0;
    const archive = await sealing;
    const opening = open(archive, key, 'avatars');
    archive.ciphertext = 'invalid'; archive.nonce = 'invalid'; archive.objectsHash = 'f'.repeat(64);
    const reopened = await opening;
    assert.equal(reopened.objectsHash, expectedHash); assert.equal(reopened.objects.length, 6);
    assert.ok(reopened.objects.every(object => object.customMetadata.literal === 'preserve'));
    const padBits = structuredClone(reopened), padded = padBits.objects.find(object => object.size === 8191);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const index = padded.bytes.length - 3;
    padded.bytes = padded.bytes.slice(0, index) + alphabet[alphabet.indexOf(padded.bytes[index]) | 1] + '==';
    await assert.rejects(seal(padBits, key, 'avatars'), /r2_recovery_encoding_invalid/);
    const internalPadding = structuredClone(reopened), large = internalPadding.objects.find(object => object.size === 65537);
    large.bytes = large.bytes.slice(0, 32764) + 'AA==' + large.bytes.slice(32768);
    await assert.rejects(seal(internalPadding, key, 'avatars'), /r2_recovery_encoding_invalid/);
    const whitespace = structuredClone(reopened); whitespace.objects[0].bytes = '    ' + whitespace.objects[0].bytes;
    await assert.rejects(seal(whitespace, key, 'avatars'), /r2_recovery_encoding_invalid/);
    const restoring = restore(target, reopened, modes('new-empty'));
    reopened.objects[0].httpMetadata.contentType = 'text/plain'; reopened.objects.length = 0;
    const restored = await restoring;
    assert.equal(restored.objectsHash, expectedHash); assert.equal(restored.objects.length, 6);
    assert.ok(restored.objects.every(object => object.httpMetadata.contentType === 'application/octet-stream'));
    const retained = await seal(restored, key, 'avatars'), before = structuredClone(retained);
    assert.equal((await open(retained, key, 'avatars')).objectsHash, expectedHash);
    assert.deepEqual(retained, before, 'releasing private decode buffers must preserve the caller archive');
  } finally {await mf.dispose();}
});
test('R2 capture and exact resumable restore on native local buckets', {timeout: 60_000}, async t => {
  const mf = new Miniflare({workers: [{config: {
    name: 'r2-recovery-local', type: 'worker', compatibilityDate: '2026-09-18',
    env: Object.fromEntries(['SOURCE', 'TARGET', 'FAILED', 'ACK', 'COVERS', 'COVER_TARGET'].map(name =>
      [name, {type: 'r2', name: 'r2-recovery-' + name}])),
    manifest: {mainModule: 'index.js', modules: {'index.js': {type: 'esm', contents:
      'export default {fetch(){return new Response("local-only")}}'}}},
  }}]});
  try {
    const source = standardLocalBucket(await mf.getR2Bucket('SOURCE')), target = standardLocalBucket(await mf.getR2Bucket('TARGET'));
    const failed = standardLocalBucket(await mf.getR2Bucket('FAILED')), ack = standardLocalBucket(await mf.getR2Bucket('ACK')),
      covers = standardLocalBucket(await mf.getR2Bucket('COVERS'));
    const coverTarget = standardLocalBucket(await mf.getR2Bucket('COVER_TARGET'));
    const keys = [owner + '/a.png', owner + '/猫 🐈.png', owner + '/zero.bin'];
    await source.put(keys[0], png, {httpMetadata: {contentType: 'image/png', contentLanguage: 'ja',
      cacheControl: 'public,max-age=120', contentDisposition: 'inline', cacheExpiry: new Date('2099-01-01T00:00:00Z')},
      customMetadata: {literal: '日本語\n$&', owner, source: 'synthetic'}, storageClass: 'Standard'});
    await source.put(keys[1], png, {httpMetadata: {contentType: 'image/png'}, customMetadata: {source: 'synthetic'}});
    await source.put(keys[2], new Uint8Array(), {httpMetadata: {contentType: 'application/octet-stream'}});
    await covers.put(owner + '/a.png', png, {httpMetadata: {contentType: 'image/png'}, customMetadata: {source: 'synthetic-cover'}});
    let pages = 0;
    const paginated = wrapped(source, {list: options => {pages++; return source.list({...options, limit: 2});}});
    const snapshot = await capture(paginated, 'avatars');
    assert.equal(snapshot.objects.length, 3); assert.equal(pages, 4);
    assert.equal(snapshot.objects.find(o => o.key === keys[2]).size, 0);
    assert.equal(snapshot.objects.find(o => o.key === keys[0]).httpMetadata.cacheExpiry, '2099-01-01T00:00:00.000Z');
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const archive = await seal(snapshot, key, 'avatars'), reopened = await open(JSON.parse(JSON.stringify(archive)), key, 'avatars');
    assert.deepEqual(reopened, snapshot); assert.ok(!JSON.stringify(archive).includes(owner));
    await t.test('integrity and bucket identity reject before restore', async () => {
      const wrong = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
      await assert.rejects(open(archive, wrong, 'avatars'), /decryption_failed/);
      await assert.rejects(open(archive, key, 'cover-images'), /archive_invalid/);
      const ciphertext = Buffer.from(archive.ciphertext, 'base64'); ciphertext[20] ^= 1;
      await assert.rejects(open({...archive, ciphertext: ciphertext.toString('base64')}, key, 'avatars'), /decryption_failed/);
      await assert.rejects(open({...archive, objectsHash: 'f'.repeat(64)}, key, 'avatars'), /decryption_failed/);
      const damaged = structuredClone(snapshot); damaged.objects[0].bytes = Buffer.from('bad bytes').toString('base64');
      await assert.rejects(restore(target, damaged, modes('new-empty')), /snapshot_invalid/);
      const duplicate = structuredClone(snapshot); duplicate.objects.push({...duplicate.objects[0]});
      await assert.rejects(restore(target, duplicate, modes('new-empty')), /snapshot_invalid/);
      const invalid = structuredClone(snapshot); invalid.objects[0].customMetadata.secret = 123;
      await assert.rejects(seal(invalid, key, 'avatars'), /snapshot_invalid/);
      assert.equal((await target.list()).objects.length, 0);
    });
    await t.test('new target restores bytes, all metadata and actual image GET/HEAD', async () => {
      assert.deepEqual(await restore(target, reopened, modes('new-empty')), snapshot);
      await assert.rejects(restore(target, reopened, modes('new-empty')), /target_not_empty/);
      assert.deepEqual(await restore(target, reopened, modes('resume-exact')), snapshot);
      const reordered = structuredClone(reopened);
      reordered.objects = reordered.objects.reverse().map(o => ({...o,
        customMetadata: Object.fromEntries(Object.entries(o.customMetadata).reverse())}));
      assert.deepEqual(await restore(target, reordered, modes('resume-exact')), snapshot);
      const path = keys[1].split('/').map(encodeURIComponent).join('/');
      const env = {STORAGE_BACKEND: 'r2', AVATARS_BUCKET: target, COVER_IMAGES_BUCKET: covers};
      for (const method of ['GET', 'HEAD']) {
        const response = await handleStorageRequest(new Request('https://synthetic.example.invalid/api/storage/public/avatars/' + path, {method}),
          env, async () => {throw new Error('public storage must not request authentication');});
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
        if (method === 'GET') assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
        else assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
      assert.notEqual((await capture(covers, 'cover-images')).objectsHash, snapshot.objectsHash);
      const coverSnapshot = await capture(covers, 'cover-images');
      const coverArchive = await seal(coverSnapshot, key, 'cover-images');
      const reopenedCover = await open(coverArchive, key, 'cover-images');
      assert.deepEqual(await restore(coverTarget, reopenedCover, {expectedKind: 'cover-images', mode: 'new-empty'}), coverSnapshot);
      const coverPath = keys[0].split('/').map(encodeURIComponent).join('/');
      const coverResponse = await handleStorageRequest(new Request('https://synthetic.example.invalid/api/storage/public/cover-images/' + coverPath),
        {...env, COVER_IMAGES_BUCKET: coverTarget}, async () => {throw new Error('public storage must not request authentication');});
      assert.equal(coverResponse.status, 200); assert.deepEqual(Buffer.from(await coverResponse.arrayBuffer()), png);
    });
    await t.test('foreign or altered objects are never overwritten or removed during resume', async () => {
      await failed.put(keys[0], 'foreign bytes', {httpMetadata: {contentType: 'image/png'}});
      let writes = 0;
      const measured = wrapped(failed, {put: (...args) => {writes++; return failed.put(...args);}});
      await assert.rejects(restore(measured, reopened, modes('resume-exact')), /target_mismatch/);
      assert.equal(writes, 0); assert.equal(await (await failed.get(keys[0])).text(), 'foreign bytes');
      await failed.delete(keys[0]);
      await failed.put(keys[0], png, {httpMetadata: {contentType: 'image/jpeg'}, customMetadata: {source: 'different'}});
      await assert.rejects(restore(measured, reopened, modes('resume-exact')), /target_mismatch/);
      assert.equal(writes, 0); assert.equal((await failed.head(keys[0])).httpMetadata.contentType, 'image/jpeg');
      await failed.delete(keys[0]);
      await failed.put('unrelated', 'keep');
      await assert.rejects(restore(measured, reopened, modes('resume-exact')), /target_mismatch/);
      assert.equal(writes, 0); assert.equal(await (await failed.get('unrelated')).text(), 'keep');
    });
    await t.test('commit with lost ACK resumes only missing objects and preserves the committed version', async () => {
      let writes = 0;
      const lost = wrapped(ack, {put: async (...args) => {await ack.put(...args); writes++; throw new Error('synthetic lost acknowledgement');}});
      await assert.rejects(restore(lost, reopened, modes('new-empty')), /restore_failed/);
      assert.equal(writes, 1); const first = (await ack.list()).objects[0];
      await assert.rejects(restore(ack, reopened, modes('new-empty')), /target_not_empty/);
      let resumedWrites = 0;
      const resume = wrapped(ack, {put: (...args) => {resumedWrites++; return ack.put(...args);}});
      assert.deepEqual(await restore(resume, reopened, modes('resume-exact')), snapshot);
      assert.equal(resumedWrites, 2); assert.equal((await ack.head(first.key)).version, first.version);
    });
    await t.test('observed source mutation and broken pagination refuse an incomplete archive', async () => {
      let mutated = false;
      const changing = wrapped(source, {get: async (...args) => {
        if (!mutated) {mutated = true; await source.put(keys[0], 'concurrent change', {httpMetadata: {contentType: 'image/png'}});}
        return source.get(...args);
      }});
      await assert.rejects(capture(changing, 'avatars'), /source_changed/);
      const looping = wrapped(source, {list: async () => ({objects: [], truncated: true, cursor: 'same', delimitedPrefixes: []})});
      await assert.rejects(capture(looping, 'avatars'), /pagination_invalid/);
    });
    assert.deepEqual(await capture(target, 'avatars'), snapshot);
    console.info(JSON.stringify({proof: 'r2-recovery-native-local', avatarObjects: 3, coverObjects: 1, bothKindsRestored: true, emptyObject: true,
      unicodeKeysAndMetadata: true, paginationObserved: 4, bytesAndMetadataExact: true,
      nativePublicImageGetHead: true, sourceMutationRefused: true, lostAckResumedWithoutOverwrite: true,
      foreignObjectsPreserved: true, localStorageClassDefaultAdapter: true, remoteStorageClassAccepted: false, remoteWrites: 0}));
  } finally {await mf.dispose();}
});

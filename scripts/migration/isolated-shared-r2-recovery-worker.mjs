/** Temporary, synthetic-only proof of the actual shared R2 recovery module. */
import {captureR2RecoverySnapshot as capture, sealR2RecoverySnapshot as seal,
  openR2RecoverySnapshot as open, restoreR2RecoverySnapshot as restore} from '../../workers/api/src/r2-recovery.ts';
import {handleStorageRequest} from '../../workers/api/src/storage-r2.ts';

export const bucketRoles = ['SOURCE', 'TARGET', 'COVERS', 'COVER_TARGET', 'ACK', 'FOREIGN', 'CONTROL'];
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const owner = '90000000-0000-4000-8000-000000000001';
const keys = [owner + '/a.png', owner + '/猫 🐈.png', owner + '/zero.bin'];
const png64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MXYAAAAASUVORK5CYII=';
const png = () => Uint8Array.from(atob(png64), c => c.charCodeAt(0));
const json = (value, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}});
function check(value, code) {if (!value) throw new Error('proof_' + code);}
function exact(a, b) {return JSON.stringify(a) === JSON.stringify(b);}
function wrapped(bucket, overrides) {
  return new Proxy(bucket, {get(target, property) {
    if (property in overrides) return overrides[property];
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  }});
}
async function refuses(action, code) {
  try {await action();} catch (error) {check(error.message === code, 'unexpected_refusal'); return;}
  throw new Error('proof_refusal_missing');
}
function identity(env) {
  if (env.PROOF_ACCOUNT !== account || !/^[a-f0-9]{16}$/u.test(env.PROOF_NONCE ?? '') ||
      !/^[a-f0-9]{64}$/u.test(env.PROOF_TOKEN ?? '') || !/^[a-f0-9]{40}$/u.test(env.PROOF_HEAD ?? '')) return null;
  const names = Object.fromEntries(bucketRoles.map(role => [role, `fanmark-recovery-${env.PROOF_NONCE}-${role.toLowerCase().replaceAll('_', '-')}`]));
  if (bucketRoles.some(role => !env[role] || env[role + '_NAME'] !== names[role])) return null;
  return {account, nonce: env.PROOF_NONCE, head: env.PROOF_HEAD, buckets: names};
}

export async function runSharedR2Proof(env, progress = async () => {}) {
  const report = {state: 'running', step: 'empty-preflight', assertions: {}, storageClasses: [], startedAt: new Date().toISOString()};
  const step = async name => {report.step = name; await progress(report);};
  try {
    await step('empty-preflight');
    for (const role of bucketRoles.filter(role => role !== 'CONTROL')) {
      const listed = await env[role].list(); check(!listed.truncated && listed.objects.length === 0, 'bucket_not_empty');
    }
    await step('seed');
    await env.SOURCE.put(keys[0], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard',
      httpMetadata: {contentType: 'image/png', contentLanguage: 'ja', cacheControl: 'public,max-age=120',
        contentDisposition: 'inline', cacheExpiry: new Date('2099-01-01T00:00:00Z')},
      customMetadata: {literal: '日本語\n$&', owner, source: 'synthetic'}});
    await env.SOURCE.put(keys[1], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard', httpMetadata: {contentType: 'image/png'}});
    await env.SOURCE.put(keys[2], new Uint8Array(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard'});
    await env.COVERS.put(keys[0], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard',
      httpMetadata: {contentType: 'image/png'}, customMetadata: {source: 'synthetic-cover'}});
    report.storageClasses = [...new Set((await env.SOURCE.list()).objects.map(o => o.storageClass))];
    report.metadataFieldTypes = Object.fromEntries(Object.entries((await env.SOURCE.head(keys[0])).httpMetadata ?? {})
      .map(([field, value]) => [field, value instanceof Date ? 'Date' : typeof value]));
    await step('capture');
    let pages = 0;
    const source = wrapped(env.SOURCE, {list: options => {pages++; return env.SOURCE.list({...options, limit: 2});}});
    const snapshot = await capture(source, 'avatars'), covers = await capture(env.COVERS, 'cover-images');
    check(snapshot.objects.length === 3 && covers.objects.length === 1 && pages === 4, 'capture_counts');
    check(snapshot.objects.every(o => o.storageClass === 'Standard') && covers.objects.every(o => o.storageClass === 'Standard'), 'storage_class');
    check(snapshot.objects[0].httpMetadata.cacheExpiry === '2099-01-01T00:00:00.000Z' &&
      snapshot.objects[0].customMetadata.literal === '日本語\n$&' && snapshot.objects.find(o => o.key === keys[2])?.size === 0, 'fixture_metadata');
    report.assertions.rawStandardClass = true; report.assertions.unicodeEmptyMetadata = true; report.paginationPages = pages;
    await step('encrypted-roundtrip');
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const archive = await seal(snapshot, key, 'avatars');
    const reopened = await open(JSON.parse(JSON.stringify(archive)), key, 'avatars');
    check(exact(reopened, snapshot) && !JSON.stringify(archive).includes(owner), 'encryption_roundtrip');
    await refuses(() => open(archive, key, 'cover-images'), 'r2_recovery_archive_invalid');
    report.assertions.encryptedRoundtripAndKind = true;
    await step('restore');
    check(exact(await restore(env.TARGET, reopened, {expectedKind: 'avatars', mode: 'new-empty'}), snapshot), 'avatar_restore');
    const coverArchive = await seal(covers, key, 'cover-images');
    check(exact(await restore(env.COVER_TARGET, await open(coverArchive, key, 'cover-images'),
      {expectedKind: 'cover-images', mode: 'new-empty'}), covers), 'cover_restore');
    await refuses(() => restore(env.TARGET, reopened, {expectedKind: 'avatars', mode: 'new-empty'}), 'r2_recovery_target_not_empty');
    check(exact(await restore(env.TARGET, reopened, {expectedKind: 'avatars', mode: 'resume-exact'}), snapshot), 'exact_resume');
    report.assertions.bothKindsBytesMetadataExact = true;
    await step('actual-image-routes');
    for (const [kind, bucket, objectKey] of [['avatars', env.TARGET, keys[1]], ['cover-images', env.COVER_TARGET, keys[0]]]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await handleStorageRequest(new Request('https://synthetic.example.invalid/api/storage/public/' + kind + '/' +
          objectKey.split('/').map(encodeURIComponent).join('/'), {method}),
        {STORAGE_BACKEND: 'r2', AVATARS_BUCKET: bucket, COVER_IMAGES_BUCKET: bucket}, async () => {throw new Error('proof_unexpected_auth');});
        check(response.status === 200 && response.headers.get('content-type') === 'image/png', 'image_response');
        const bytes = new Uint8Array(await response.arrayBuffer());
        check(method === 'HEAD' ? bytes.length === 0 : exact([...bytes], [...png()]), 'image_bytes');
      }
    }
    report.assertions.nativeImageGetHead = true;
    await step('lost-ack');
    let failedWrites = 0;
    const lost = wrapped(env.ACK, {put: async (...args) => {const stored = await env.ACK.put(...args);
      check(!!stored, 'ack_fixture_put'); failedWrites++; throw new Error('synthetic lost ACK');}});
    await refuses(() => restore(lost, reopened, {expectedKind: 'avatars', mode: 'new-empty'}), 'r2_recovery_restore_failed');
    check(failedWrites === 1, 'ack_fixture_count');
    const first = (await env.ACK.list()).objects[0];
    let resumedWrites = 0;
    const resume = wrapped(env.ACK, {put: (...args) => {resumedWrites++; return env.ACK.put(...args);}});
    check(exact(await restore(resume, reopened, {expectedKind: 'avatars', mode: 'resume-exact'}), snapshot), 'ack_resume');
    check(resumedWrites === 2 && (await env.ACK.head(first.key)).version === first.version, 'ack_version');
    report.assertions.lostAckPreservedVersion = true; report.resumedWrites = resumedWrites;
    await step('foreign-refusal');
    await env.FOREIGN.put(keys[0], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard',
      httpMetadata: {contentType: 'image/jpeg'}, customMetadata: {source: 'foreign-fixture'}});
    const foreignBefore = await capture(env.FOREIGN, 'avatars');
    let foreignWrites = 0;
    const guarded = wrapped(env.FOREIGN, {put: (...args) => {foreignWrites++; return env.FOREIGN.put(...args);}});
    await refuses(() => restore(guarded, reopened, {expectedKind: 'avatars', mode: 'resume-exact'}), 'r2_recovery_target_mismatch');
    check(foreignWrites === 0 && exact(await capture(env.FOREIGN, 'avatars'), foreignBefore), 'foreign_changed');
    report.assertions.foreignMetadataPreserved = true;
    check(exact(await capture(env.SOURCE, 'avatars'), snapshot) && exact(await capture(env.COVERS, 'cover-images'), covers), 'source_changed');
    report.assertions.sourceUnchanged = true;
    report.avatarObjects = 3; report.coverObjects = 1;
    report.avatarHash = snapshot.objectsHash; report.coverHash = covers.objectsHash;
    report.state = 'verified'; report.step = 'complete';
  } catch (error) {
    report.state = 'failed'; report.error = /^(r2_recovery|proof)_[a-z_]{1,60}$/u.test(error?.message ?? '') ? error.message : 'proof_unclassified_failure';
  }
  report.finishedAt = new Date().toISOString(); await progress(report); return report;
}

export default {
  async fetch(request, env) {
    const receipt = identity(env);
    if (!receipt) return json({error: 'proof_unconfigured'}, 503);
    if (request.headers.get('authorization') !== `Bearer ${env.PROOF_TOKEN}`) return json({error: 'unauthorized'}, 401);
    if (request.headers.get('x-proof-nonce') !== receipt.nonce) return json({error: 'target_mismatch'}, 403);
    const url = new URL(request.url);
    if (url.search || request.headers.get('content-length') && request.headers.get('content-length') !== '0') return json({error: 'invalid_request'}, 400);
    if (url.pathname === '/_proof/identity' && request.method === 'GET') return json(receipt);
    if (url.pathname === '/_proof/inventory' && request.method === 'GET') {
      const objects = {};
      for (const role of bucketRoles) {
        const page = await env[role].list();
        objects[role] = {keys: page.objects.map(o => o.key), truncated: page.truncated};
      }
      return json({identity: receipt, objects});
    }
    if (url.pathname === '/_proof/status' && request.method === 'GET') {
      const status = await env.CONTROL.get('status.json');
      return json({identity: receipt, report: status ? await status.json() : null, claimed: !!await env.CONTROL.head('claim.json')});
    }
    if (url.pathname === '/_proof/run' && request.method === 'POST') {
      const claim = await env.CONTROL.put('claim.json', JSON.stringify(receipt), {onlyIf: {etagDoesNotMatch: '*'}});
      if (!claim) return json({error: 'already_claimed'}, 409);
      const report = await runSharedR2Proof(env, value => env.CONTROL.put('status.json', JSON.stringify(value)));
      return json({identity: receipt, report});
    }
    if (url.pathname === '/_proof/objects' && request.method === 'DELETE') {
      const status = await env.CONTROL.get('status.json');
      if (!status || !['verified', 'failed'].includes((await status.json()).state)) return json({error: 'proof_not_terminal'}, 409);
      // Validate every bucket before the first deletion. Only synthetic fixture keys and journal keys may be removed.
      const listed = [];
      for (const role of bucketRoles) {
        const page = await env[role].list();
        const allowed = role === 'CONTROL' ? ['claim.json', 'status.json'] : keys;
        if (page.truncated || page.objects.some(o => !allowed.includes(o.key))) return json({error: 'unowned_object'}, 409);
        listed.push([role, page.objects.map(o => o.key)]);
      }
      for (const [role, objectKeys] of listed) if (objectKeys.length) await env[role].delete(objectKeys);
      for (const role of bucketRoles) {
        const page = await env[role].list();
        if (page.truncated || page.objects.length) return json({error: 'cleanup_incomplete'}, 500);
      }
      return json({identity: receipt, bucketsEmpty: true});
    }
    return json({error: 'route_unavailable'}, 404);
  },
};

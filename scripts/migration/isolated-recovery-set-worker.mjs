/** One isolated fixture, no app routes, Cron, DO, providers or arbitrary SQL endpoint. */
import {collectRecoverySet, restoreRecoverySet, openRecoverySet, RECOVERY_SET_STORES as stores} from '../../workers/api/src/recovery-set.ts';
import {d1RecoveryDigest} from '../../workers/api/src/d1-store-recovery.ts';

export const databaseRoles = ['S_AUTH', 'S_BUSINESS', 'S_MASTER', 'T_AUTH', 'T_BUSINESS', 'T_MASTER'];
export const bucketRoles = ['S_AVATARS', 'S_COVERS', 'T_AVATARS', 'T_COVERS', 'CONTROL'];
export const fixtureKeys = ['90000000-0000-4000-8000-000000000001/a.png', '90000000-0000-4000-8000-000000000001/c.png'];
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const check = (ok, code) => {if (!ok) throw new Error('proof_' + code);};
const json = (value, status = 200) => Response.json(value, {status, headers: {'cache-control': 'no-store'}});
const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6MXYAAAAASUVORK5CYII='), c => c.charCodeAt(0));
function identity(env) {
  if (env.PROOF_ACCOUNT !== account || !/^[a-f0-9]{16}$/u.test(env.PROOF_NONCE ?? '') || !/^[a-f0-9]{40}$/u.test(env.PROOF_HEAD ?? '') ||
      !/^[a-f0-9]{64}$/u.test(env.PROOF_TOKEN ?? '') || !/^[a-f0-9]{64}$/u.test(env.PROOF_ARCHIVE_KEY ?? '')) return null;
  const databases = Object.fromEntries(databaseRoles.map(role => [role, {id: env[role + '_ID'], name: env[role + '_NAME']}]));
  const buckets = Object.fromEntries(bucketRoles.map(role => [role, env[role + '_NAME']]));
  if (databaseRoles.some(role => !env[role] || !/^[a-f0-9-]{36}$/u.test(databases[role].id ?? '') ||
      databases[role].name !== `fanmark-recovery-${env.PROOF_NONCE}-${role.toLowerCase().replaceAll('_', '-')}`) ||
      bucketRoles.some(role => !env[role] || buckets[role] !== `fanmark-recovery-${env.PROOF_NONCE}-${role.toLowerCase().replaceAll('_', '-')}`)) return null;
  return {account, nonce: env.PROOF_NONCE, head: env.PROOF_HEAD, databases, buckets};
}
function ids(receipt, prefix) {return Object.fromEntries(stores.map(store => [store,
  ['avatars', 'covers'].includes(store) ? receipt.buckets[prefix + '_' + store.toUpperCase()] : receipt.databases[prefix + '_' + store.toUpperCase()].id]));}
function bindings(env, prefix, counts) {return Object.fromEntries(stores.map(store => {
  const native = env[prefix + '_' + store.toUpperCase()];
  if (!counts || ['avatars', 'covers'].includes(store)) return [store, native];
  const statements = new WeakMap();
  const count = n => {counts[store] = (counts[store] ?? 0) + n; check(Object.values(counts).reduce((a,b) => a+b,0) <= 1000, 'query_limit');};
  const prepare = raw => {
    const statement = {bind: (...args) => prepare(raw.bind(...args)), all: () => {count(1);return raw.all();},
      run: () => {count(1);return raw.run();}, first: (...args) => {count(1);return raw.first(...args);}};
    statements.set(statement,raw);return statement;
  };
  return [store,{prepare: sql => prepare(native.prepare(sql)),batch: items => {
    const raw = items.map(item => statements.get(item));check(raw.every(Boolean),'statement_binding');count(items.length);return native.batch(raw);
  }}];
}));}
async function contextKey(env, receipt) {
  const schemaHashes = JSON.parse(env.PROOF_SCHEMA_HASHES);
  const context = {sourceIds: ids(receipt, 'S'), keyId: 'isolated-' + receipt.nonce, runtimeRevision: receipt.head,
    schemaHashes, authSecret: env.PROOF_SDK_SECRET};
  const raw = Uint8Array.from(env.PROOF_ARCHIVE_KEY.match(/../gu), b => parseInt(b, 16));
  try {return {context, key: await crypto.subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt'])};}
  finally {raw.fill(0);}
}
function guard(env, receipt, prefix, claimKey) {
  return {id: 'isolated-' + receipt.nonce + '-' + prefix, async assertHeld(expected) {
    check(JSON.stringify(expected) === JSON.stringify(ids(receipt, prefix)), 'guard_identity');
    const claim = await env.CONTROL.get(claimKey);
    check(claim && JSON.stringify(await claim.json()) === JSON.stringify(receipt), 'guard_claim');
    // This Worker exposes no source write route or application jobs. Resource/version
    // bindings are independently pinned by the host before/after each invocation.
  }};
}
async function claim(env, receipt, key) {
  return !!await env.CONTROL.put(key, JSON.stringify(receipt), {onlyIf: {etagDoesNotMatch: '*'}});
}
async function report(env, phase, value) {await env.CONTROL.put(phase + '-status.json', JSON.stringify(value)); return value;}
function safeError(error) {return /^(proof|recovery_set|auth_recovery|business_recovery|master_recovery|r2_recovery)_[a-z_]{1,80}$/u.test(error?.message ?? '') ? error.message : 'proof_unclassified_failure';}
async function emptyBody(request) {
  if (!request.body) return true;
  const reader = request.body.getReader();
  try {for (let n = 0; n < 10; n++) {const next = await reader.read(); if (next.done) return true;
    if (next.value.byteLength) {await reader.cancel(); return false;}} await reader.cancel(); return false;}
  finally {reader.releaseLock();}
}

export default {async fetch(request, env) {
  const receipt = identity(env); if (!receipt) return json({error: 'proof_unconfigured'}, 503);
  if (request.headers.get('authorization') !== `Bearer ${env.PROOF_TOKEN}`) return json({error: 'unauthorized'}, 401);
  if (request.headers.get('x-proof-nonce') !== receipt.nonce) return json({error: 'target_mismatch'}, 403);
  const url = new URL(request.url); if (url.search) return json({error: 'invalid_request'}, 400);
  if (url.pathname === '/_proof/identity' && request.method === 'GET') return json(receipt);
  if (url.pathname === '/_proof/status' && request.method === 'GET') {
    const phases = {};
    for (const phase of ['collect', 'restore']) {const object = await env.CONTROL.get(phase + '-status.json'); phases[phase] = object ? await object.json() : null;}
    return json({identity: receipt, phases});
  }
  if (url.pathname === '/_proof/archive' && request.method === 'GET') {
    const status = await env.CONTROL.get('collect-status.json');
    if (!status || (await status.json()).state !== 'verified') return json({error: 'archive_not_verified'}, 409);
    const archive = await env.CONTROL.get('archive.json'); return json({identity: receipt, archive: await archive.json()});
  }
  if (url.pathname === '/_proof/collect' && request.method === 'POST') {
    if (!await emptyBody(request)) return json({error: 'invalid_request'}, 400);
    if (!await claim(env, receipt, 'collect-claim.json')) return json({error: 'already_claimed'}, 409);
    let value = {state: 'in_progress', startedAt: new Date().toISOString(), d1Queries: {}}; await report(env, 'collect', value);
    try {
      for (const role of bucketRoles.filter(role => role !== 'CONTROL')) {const page = await env[role].list(); check(!page.truncated && !page.objects.length, 'bucket_not_empty');}
      // The single claimed invocation seeds and then owns the isolated source. No other route can write it.
      await env.S_AVATARS.put(fixtureKeys[0], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard',
        httpMetadata: {contentType: 'image/png', cacheExpiry: new Date('2099-01-01T00:00:00Z')}, customMetadata: {fixture: '日本語\n$&'}});
      await env.S_COVERS.put(fixtureKeys[1], png(), {onlyIf: {etagDoesNotMatch: '*'}, storageClass: 'Standard', httpMetadata: {contentType: 'image/png'}, customMetadata: {fixture: 'cover'}});
      const {context, key} = await contextKey(env, receipt);
      const archive = await collectRecoverySet(bindings(env, 'S', value.d1Queries), context, key, guard(env, receipt, 'S', 'collect-claim.json'));
      const opened = await openRecoverySet(archive, context, key);
      await env.CONTROL.put('archive.json', JSON.stringify(archive), {onlyIf: {etagDoesNotMatch: '*'}});
      value = {...value, state: 'verified', captureId: opened.manifest.captureId, parts: opened.manifest.parts,
        storageClasses: [...new Set([...opened.snapshots.avatars.objects, ...opened.snapshots.covers.objects].map(o => o.storageClass))],
        sourceAuthSessions: opened.snapshots.auth.tables.session.length};
    } catch (error) {value = {...value, state: 'failed', error: safeError(error)};}
    value.finishedAt = new Date().toISOString(); await report(env, 'collect', value); return json({identity: receipt, report: value});
  }
  if (url.pathname === '/_proof/restore' && request.method === 'POST') {
    const status = await env.CONTROL.get('collect-status.json');
    if (!status || (await status.json()).state !== 'verified') return json({error: 'source_not_verified'}, 409);
    // Request parsing happens before claim or target writes and remains bounded for this tiny fixture.
    const reader = request.body?.getReader(); if (!reader) return json({error: 'archive_required'}, 400);
    const chunks = []; let size = 0;
    try {for (;;) {const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 2 * 1024 * 1024) {await reader.cancel(); return json({error: 'archive_too_large'}, 413);} chunks.push(next.value);}}
    finally {reader.releaseLock();}
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    let archive; try {archive = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {return json({error: 'archive_invalid'}, 400);} finally {bytes.fill(0);}
    const stored = await env.CONTROL.get('archive.json');
    if (await d1RecoveryDigest(archive) !== await d1RecoveryDigest(await stored.json())) return json({error: 'archive_mismatch'}, 409);
    if (!await claim(env, receipt, 'restore-claim.json')) return json({error: 'already_claimed'}, 409);
    let value = {state: 'in_progress', startedAt: new Date().toISOString(), progress: [], d1Queries: {}}; await report(env, 'restore', value);
    try {
      const {context, key} = await contextKey(env, receipt);
      const targets = bindings(env, 'T', value.d1Queries);
      const result = await restoreRecoverySet(targets, archive, context, key, {mode: 'new-empty',
        sessionPolicy: 'revoke-local-sessions-and-challenges', targetIds: ids(receipt, 'T'), targetGuard: guard(env, receipt, 'T', 'restore-claim.json'),
        progress: async entry => {value.progress.push(entry); await report(env, 'restore', value);}});
      check(await targets.auth.prepare('SELECT COUNT(*) AS count FROM session').first('count') === 0 &&
        await targets.auth.prepare('SELECT COUNT(*) AS count FROM verification').first('count') === 0, 'revocation');
      check(await targets.auth.prepare('SELECT password FROM account').first('password') === 'synthetic-password-hash-bytes', 'credential');
      value = {...value, state: 'verified', result, sessionChallengesRevoked: true, credentialBytesRetained: true};
    } catch (error) {value = {...value, state: 'failed', error: safeError(error)};}
    value.finishedAt = new Date().toISOString(); await report(env, 'restore', value); return json({identity: receipt, report: value});
  }
  if (url.pathname === '/_proof/inventory' && request.method === 'GET') {
    const objects = {}; for (const role of bucketRoles) {const page = await env[role].list(); objects[role] = {keys: page.objects.map(o => o.key), truncated: page.truncated};}
    return json({identity: receipt, objects});
  }
  if (url.pathname === '/_proof/objects' && request.method === 'DELETE') {
    const collect = await env.CONTROL.get('collect-status.json'), restore = await env.CONTROL.get('restore-status.json');
    if (await env.CONTROL.head('collect-claim.json') && !collect || await env.CONTROL.head('restore-claim.json') && !restore) return json({error: 'phase_not_terminal'}, 409);
    if (collect && !['verified', 'failed'].includes((await collect.json()).state) || restore && !['verified', 'failed'].includes((await restore.json()).state)) return json({error: 'phase_not_terminal'}, 409);
    const listed = [];
    for (const role of bucketRoles) {const page = await env[role].list(); const allowed = role === 'CONTROL'
      ? ['collect-claim.json', 'collect-status.json', 'restore-claim.json', 'restore-status.json', 'archive.json']
      : [fixtureKeys[role.endsWith('AVATARS') ? 0 : 1]];
      if (page.truncated || page.objects.some(o => !allowed.includes(o.key))) return json({error: 'unowned_object'}, 409); listed.push([role, page.objects.map(o => o.key)]);}
    for (const [role, keys] of listed) if (keys.length) await env[role].delete(keys);
    for (const role of bucketRoles) {const page = await env[role].list(); check(!page.truncated && !page.objects.length, 'cleanup_incomplete');}
    return json({identity: receipt, bucketsEmpty: true});
  }
  return json({error: 'route_unavailable'}, 404);
}};

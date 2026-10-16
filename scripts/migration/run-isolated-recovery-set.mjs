/** Explicit remote rehearsal. Resume reads the same run; it never starts a second proof. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, realpath, unlink} from 'node:fs/promises';
import {randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createIsolatedRemoteD1} from './isolated-remote-d1.mjs';
import {seedRecoverySetFixture, recoverySetFixturePins, fixtureSecret} from './recovery-set-fixture.mjs';
import {saveRecoverySetFile, readRecoverySetFile} from './recovery-set-files.mjs';
import {openRecoverySet} from '../../workers/api/src/recovery-set.ts';
import {databaseRoles, bucketRoles} from './isolated-recovery-set-worker.mjs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const apiDirectory = path.join(repo, 'workers/api');
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const roles = bucketRoles;
const [head, ciRun, resumeFlag, resumeDirectory] = process.argv.slice(2);
assert.match(head ?? '', /^[a-f0-9]{40}$/u); assert.match(ciRun ?? '', /^\d+$/u);
assert.ok(resumeFlag === undefined || resumeFlag === '--resume' && resumeDirectory);
const git = (...args) => execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
assert.equal(git('rev-parse', 'HEAD'), head);
assert.ok(git('diff', '--name-only').split('\n').filter(Boolean).every(name => name === 'supabase/.temp/cli-latest'));
assert.equal(git('diff', '--cached', '--name-only'), '');
assert.equal(git('ls-files', '--others', '--exclude-standard'), '');
const ci = JSON.parse(execFileSync('gh', ['run', 'view', ciRun, '--json', 'headSha,status,conclusion,jobs'], {cwd: repo, encoding: 'utf8'}));
assert.equal(ci.headSha, head); assert.equal(ci.status, 'completed'); assert.equal(ci.conclusion, 'success');
assert.equal(ci.jobs.length, 2); assert.ok(ci.jobs.every(job => job.conclusion === 'success'));
assert.ok(ci.jobs.some(job => job.steps.some(step => step.name === 'Test Worker API and local D1 contracts' && step.conclusion === 'success')));

let credential;
const stagingConfig = path.join(apiDirectory, 'wrangler.app-staging.jsonc');
function wrangler(args, {config = stagingConfig, input, json = false} = {}) {
  let output;
  try {output = execFileSync(path.join(apiDirectory, 'node_modules/.bin/wrangler'), [...args, '--config', config], {
    cwd: apiDirectory, encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', ...(credential ? {CLOUDFLARE_API_TOKEN: credential} : {})},
    input, stdio: ['pipe', 'pipe', 'pipe'],
  });} catch {throw new Error('proof_wrangler_' + args[0].replaceAll('-', '_') + '_failed');}
  if (!json) return;
  try {return JSON.parse(output);} catch {throw new Error('proof_cli_response_invalid');}
}
const who = wrangler(['whoami', '--json'], {json: true});
assert.equal(who.email, 'fanmark.id@gmail.com'); assert.ok(who.accounts.some(row => row.id === account));
credential = wrangler(['auth', 'token', '--json'], {json: true}).token;
assert.equal(typeof credential, 'string'); assert.ok(credential.length > 20);
async function api(resource, method = 'GET', payload, absent = false) {
  let response;
  try {response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${resource}`, {
    method, redirect: 'error', headers: {authorization: `Bearer ${credential}`, 'content-type': 'application/json'},
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
  });} catch {throw new Error('proof_resource_ack_unknown');}
  if (absent && response.status === 404) return null;
  if (method === 'DELETE' && response.status === 204) return null;
  let envelope;
  try {envelope = await response.json();} catch {throw new Error('proof_resource_response_invalid');}
  if (!response.ok || envelope.success !== true) throw new Error('proof_resource_api_' + response.status);
  return envelope.result;
}
const sorted = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
async function inventory() {
  const d1 = await api('d1/database?per_page=100'), r2 = await api('r2/buckets'), workers = await api('workers/scripts');
  assert.ok(Array.isArray(d1) && d1.length < 100 && Array.isArray(r2.buckets) && Array.isArray(workers));
  return {d1: sorted(d1.map(row => ({uuid: row.uuid, name: row.name, created_at: row.created_at}))),
    r2: sorted(r2.buckets.map(row => ({name: row.name, creation_date: row.creation_date}))),
    workers: sorted(workers.map(row => ({id: row.id, created_on: row.created_on})))};
}
const privateBase = '/Users/kanouk/.codex/fanmark-migration-private';
const root = resumeDirectory ? await realpath(resumeDirectory) : path.join(privateBase, 'recovery-set-remote-' + randomUUID());
assert.ok(root.startsWith(privateBase + '/recovery-set-remote-'));
await mkdir(root, {mode: 0o700, recursive: true});
const journalPath = path.join(root, 'journal.json'), tokenPath = path.join(root, 'request-key.txt'), config = path.join(root, 'wrangler.json');
let journal = resumeDirectory ? JSON.parse(await readFile(journalPath, 'utf8')) : {
  format: 'fanmark-recovery-set-remote-proof-v1', account, head, ciRun, nonce: randomBytes(8).toString('hex'),
  incarnation: randomUUID(), startedAt: new Date().toISOString(), databases: [], buckets: [], cleanupVerified: false,
};
assert.equal(journal.format, 'fanmark-recovery-set-remote-proof-v1'); assert.equal(journal.account, account);
assert.equal(journal.head, head); assert.equal(journal.ciRun, ciRun); assert.match(journal.nonce, /^[a-f0-9]{16}$/u);
journal.workerName = `fanmark-recovery-${journal.nonce}-recovery-set`;
const names = Object.fromEntries(roles.map(role => [role, `fanmark-recovery-${journal.nonce}-${role.toLowerCase().replaceAll('_', '-')}`]));
assert.ok(journal.buckets.every(bucket => names[bucket.role] === bucket.name && Number.isFinite(Date.parse(bucket.creation_date))));
async function save() {
  await writeFile(journalPath + '.next', JSON.stringify(journal, null, 2) + '\n', {mode: 0o600});
  await rename(journalPath + '.next', journalPath);
}
if (journal.cleanupVerified) {console.info(JSON.stringify({journal: journalPath, state: 'already-cleaned'})); process.exit(0);}
const token = resumeDirectory ? (await readFile(tokenPath, 'utf8')).trim() : randomBytes(32).toString('hex');
assert.match(token, /^[a-f0-9]{64}$/u);
if (!resumeDirectory) await writeFile(tokenPath, token + '\n', {mode: 0o600});
const origin = `https://${journal.workerName}.fanmark-id.workers.dev`;
const databaseNames = Object.fromEntries(databaseRoles.map(role => [role, `fanmark-recovery-${journal.nonce}-${role.toLowerCase().replaceAll('_', '-')}`]));
assert.ok(journal.databases.every(row => databaseNames[row.role] === row.name && /^[a-f0-9-]{36}$/u.test(row.uuid) && Number.isFinite(Date.parse(row.created_at))));
assert.equal(new Set(journal.databases.map(row => row.uuid)).size, journal.databases.length);
const identity = () => ({account, nonce: journal.nonce, head, buckets: names,
  databases: Object.fromEntries(journal.databases.map(row => [row.role, {id: row.uuid, name: row.name}]))});
const context = () => ({sourceIds: Object.fromEntries(['auth','business','master','avatars','covers'].map(store => [store,
  ['avatars','covers'].includes(store) ? names['S_' + store.toUpperCase()] : identity().databases['S_' + store.toUpperCase()].id])),
  keyId: 'isolated-' + journal.nonce, runtimeRevision: head, schemaHashes: journal.schemaHashes, authSecret: fixtureSecret});
let archiveKey;
async function loadKey() {
  const hex = (await readFile(path.join(root, 'archive-key.txt'), 'utf8')).trim(); assert.match(hex, /^[a-f0-9]{64}$/u);
  const bytes = Buffer.from(hex, 'hex');
  try {archiveKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']); return hex;}
  finally {bytes.fill(0);}
}
async function request(route, method = 'GET', payload) {
  let response;
  try {response = await fetch(origin + '/_proof/' + route, {method, redirect: 'error',
    headers: {authorization: `Bearer ${token}`, 'x-proof-nonce': journal.nonce, 'content-type': 'application/json'},
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(method === 'POST' ? 180_000 : 30_000)});
  } catch {throw new Error('proof_worker_ack_unknown');}
  let body;
  try {body = await response.json();} catch {throw new Error('proof_worker_response_invalid');}
  if (!response.ok) throw new Error('proof_worker_http_' + response.status);
  assert.deepEqual(route === 'identity' ? body : body.identity, identity());
  return body;
}
async function version() {
  const deployments = wrangler(['deployments', 'list', '--name', journal.workerName, '--json'], {config, json: true});
  const active = deployments.toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  assert.ok(active?.versions?.length === 1 && active.versions[0].percentage === 100);
  return active.versions[0].version_id;
}
async function bindingPreflight() {
  assert.equal(await version(), journal.workerVersion);
  const metadata = (await inventory()).workers.find(row => row.id === journal.workerName);
  assert.equal(metadata?.created_on, journal.workerCreatedAt);
  const bindings = (await api('workers/scripts/' + journal.workerName + '/settings')).bindings;
  assert.ok(Array.isArray(bindings));
  const text = {PROOF_ACCOUNT: account, PROOF_NONCE: journal.nonce, PROOF_HEAD: head,
    PROOF_SCHEMA_HASHES: JSON.stringify(journal.schemaHashes),
    ...Object.fromEntries(roles.map(role => [role + '_NAME', names[role]])),
    ...Object.fromEntries(journal.databases.flatMap(row => [[row.role + '_ID', row.uuid], [row.role + '_NAME', row.name]]))};
  assert.equal(bindings.length, roles.length + databaseRoles.length + Object.keys(text).length + 3);
  for (const [name, value] of Object.entries(text)) assert.ok(bindings.some(b => b.name === name && b.type === 'plain_text' && b.text === value));
  for (const role of roles) assert.ok(bindings.some(b => b.name === role && b.type === 'r2_bucket' && b.bucket_name === names[role]));
  for (const row of journal.databases) assert.ok(bindings.some(b => b.name === row.role && b.type === 'd1' && b.id === row.uuid));
  for (const name of ['PROOF_TOKEN','PROOF_ARCHIVE_KEY','PROOF_SDK_SECRET']) assert.ok(bindings.some(b => b.name === name && b.type === 'secret_text'));
  const settings = await api('workers/scripts/' + journal.workerName + '/settings');
  assert.ok(!settings.bindings.some(b => ['durable_object_namespace','queue'].includes(b.type)));
  const response = await api('workers/scripts/' + journal.workerName + '/schedules');
  const schedules = Array.isArray(response) ? response : response?.schedules;
  assert.ok(Array.isArray(schedules) && schedules.length === 0);
}
async function cleanup() {
  if (journal.pendingCreate || journal.workerDeployRequested && !journal.workerVersion) throw new Error('proof_resource_ownership_unresolved');
  if (journal.proofRequested && !journal.objectsCleared) {
    await bindingPreflight();
    const status = await request('status');
    assert.ok(Object.values(status.phases).every(value => value === null || ['verified','failed'].includes(value.state)), 'proof_phase_not_terminal');
    journal.phases = status.phases; await save();
    if (journal.objectDeleteRequested && Object.values(status.phases).every(v => v === null)) {
      const observed = (await request('inventory')).objects;
      assert.deepEqual(Object.keys(observed).sort(), roles.toSorted());
      assert.ok(Object.values(observed).every(page => !page.truncated && page.keys.length === 0));
    } else {
      journal.objectDeleteRequested = true; await save();
      assert.equal((await request('objects', 'DELETE')).bucketsEmpty, true);
    }
    journal.objectsCleared = true; await save();
  }
  // The API refuses nonempty buckets. Partial creation before proof cannot have object writes.
  for (const bucket of journal.buckets.filter(row => !row.deleted)) {
    const actual = await api('r2/buckets/' + bucket.name, 'GET', undefined, true);
    if (actual !== null) {
      assert.equal(actual.name, bucket.name); assert.equal(actual.creation_date, bucket.creation_date);
      await api('r2/buckets/' + bucket.name, 'DELETE');
    }
    assert.equal(await api('r2/buckets/' + bucket.name, 'GET', undefined, true), null);
    bucket.deleted = true; await save();
  }
  for (const row of journal.databases.filter(row => !row.deleted)) {
    const actual = await api('d1/database/' + row.uuid, 'GET', undefined, true);
    if (actual !== null) {assert.equal(actual.uuid, row.uuid); assert.equal(actual.name, row.name); assert.equal(actual.created_at, row.created_at);
      await api('d1/database/' + row.uuid, 'DELETE');}
    assert.equal(await api('d1/database/' + row.uuid, 'GET', undefined, true), null); row.deleted = true; await save();
  }
  if (journal.workerVersion && !journal.workerDeleted) {
    const actual = (await inventory()).workers.find(row => row.id === journal.workerName);
    if (actual) {
      assert.equal(actual.created_on, journal.workerCreatedAt); assert.equal(await version(), journal.workerVersion);
      await api('workers/scripts/' + journal.workerName, 'DELETE');
    }
    assert.ok((await inventory()).workers.every(row => row.id !== journal.workerName));
    journal.workerDeleted = true; await save();
  }
  journal.after = await inventory(); assert.deepEqual(journal.after, journal.before);
  for (const filename of [tokenPath, path.join(root, 'archive-key.txt')]) {
    try {await unlink(filename);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  journal.keyFilesRemoved = true;
  journal.cleanupVerified = true; journal.finishedAt = new Date().toISOString(); await save();
}
let failure;
try {
  if (!resumeDirectory) {
    journal.before = await inventory();
    assert.ok(journal.before.workers.every(row => row.id !== journal.workerName));
    assert.ok(journal.before.r2.every(row => !Object.values(names).includes(row.name))); await save();
    assert.ok(journal.before.d1.length + databaseRoles.length <= 10);
    journal.schemaHashes = await recoverySetFixturePins(); await save();
    for (const role of databaseRoles) {
      const name = databaseNames[role]; assert.ok(journal.before.d1.every(row => row.name !== name));
      journal.pendingCreate = {role, name, requestedAt: new Date().toISOString()}; await save();
      const created = await api('d1/database', 'POST', {name});
      assert.match(created.uuid ?? '', /^[a-f0-9-]{36}$/u);
      const actual = await api('d1/database/' + created.uuid);
      assert.equal(actual.name, name); assert.equal(actual.uuid, created.uuid);
      assert.ok(Number.isFinite(Date.parse(actual.created_at)));
      journal.databases.push({role, uuid: actual.uuid, name, created_at: actual.created_at}); journal.pendingCreate = null; await save();
    }
    // Only initialize the new, unrouted SOURCE databases. Restoration always uses a native Worker batch without chunking.
    const source = Object.fromEntries(journal.databases.filter(row => row.role.startsWith('S_')).map(row => {
      const db = createIsolatedRemoteD1({target: {accountId: account, databaseId: row.uuid, databaseName: row.name,
        createdAt: row.created_at, targetIncarnation: journal.incarnation}, token: credential});
      return [row.role.slice(2).toLowerCase(), {prepare: db.prepare, async batch(statements) {
        const results = []; for (let offset = 0; offset < statements.length; offset += 80) results.push(...await db.batch(statements.slice(offset, offset + 80))); return results;
      }}];
    }));
    await seedRecoverySetFixture(source); journal.sourceInitialized = true; await save();
    for (const role of roles) {
      journal.pendingCreate = {role, name: names[role], requestedAt: new Date().toISOString()}; await save();
      await api('r2/buckets', 'POST', {name: names[role]});
      const actual = await api('r2/buckets/' + names[role]);
      assert.equal(actual.name, names[role]); assert.ok(Number.isFinite(Date.parse(actual.creation_date)));
      journal.buckets.push({role, name: actual.name, creation_date: actual.creation_date}); journal.pendingCreate = null; await save();
    }
    await writeFile(config, JSON.stringify({name: journal.workerName, account_id: account,
      main: fileURLToPath(new URL('./isolated-recovery-set-worker.mjs', import.meta.url)), compatibility_date: '2026-09-18', workers_dev: true,
      vars: {PROOF_ACCOUNT: account, PROOF_NONCE: journal.nonce, PROOF_HEAD: head,
        PROOF_SCHEMA_HASHES: JSON.stringify(journal.schemaHashes),
        ...Object.fromEntries(roles.map(role => [role + '_NAME', names[role]])),
        ...Object.fromEntries(journal.databases.flatMap(row => [[row.role + '_ID', row.uuid], [row.role + '_NAME', row.name]]))},
      d1_databases: journal.databases.map(row => ({binding: row.role, database_name: row.name, database_id: row.uuid})),
      limits: {cpu_ms: 30000},
      r2_buckets: roles.map(role => ({binding: role, bucket_name: names[role]})),
    }), {mode: 0o600});
    journal.workerDeployRequested = true; await save(); wrangler(['deploy'], {config});
    await writeFile(path.join(root, 'archive-key.txt'), randomBytes(32).toString('hex') + '\n', {mode: 0o600});
    const keyHex = await loadKey();
    wrangler(['secret', 'bulk'], {config, input: JSON.stringify({PROOF_TOKEN: token, PROOF_ARCHIVE_KEY: keyHex, PROOF_SDK_SECRET: fixtureSecret})});
    journal.workerVersion = await version();
    journal.workerCreatedAt = (await inventory()).workers.find(row => row.id === journal.workerName)?.created_on;
    assert.ok(journal.workerCreatedAt); await save(); await bindingPreflight();
    let reachable = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {await request('identity'); reachable = true; break;} catch {if (attempt < 5) await delay(5000);}
    }
    assert.ok(reachable, 'proof_identity_unreachable');
    journal.proofRequested = true; journal.collectRequested = true; await save();
    try {await request('collect', 'POST');} catch {journal.collectAcknowledgementUnknown = true; await save();}
  } else {await loadKey();}
  // Resumes inspect the same one-shot phase. They never repeat collect or an unknown restore.
  if (journal.proofRequested && !journal.objectsCleared) {
    await bindingPreflight(); const status = await request('status'); journal.phases = status.phases; await save();
    assert.equal(status.phases.collect?.state, 'verified', 'proof_collect_not_verified');
    const archivePath = path.join(root, 'recovery-set.json');
    if (!journal.fileCommitted) {
      const {archive} = await request('archive');
      // An exclusive file may already have committed before a lost local acknowledgement; inspect first.
      let existing = null; try {existing = await readRecoverySetFile(archivePath, context(), archiveKey);} catch (error) {if (error.code !== 'ENOENT') throw error;}
      if (existing) assert.deepEqual(existing, archive); else await saveRecoverySetFile(archivePath, archive, context(), archiveKey);
      journal.fileCommitted = true; await save();
    }
    const restoredFile = await readRecoverySetFile(archivePath, context(), archiveKey);
    const opened = await openRecoverySet(restoredFile, context(), archiveKey);
    assert.equal(opened.manifest.captureId, status.phases.collect.captureId);
    if (!journal.restoreRequested) {
      await bindingPreflight(); journal.restoreRequested = true; await save();
      try {await request('restore', 'POST', restoredFile);} catch {journal.restoreAcknowledgementUnknown = true; await save();}
    }
    await bindingPreflight(); journal.phases = (await request('status')).phases; await save();
    assert.equal(journal.phases.restore?.state, 'verified', 'proof_restore_not_verified');
    assert.equal(journal.phases.restore.result.captureId, opened.manifest.captureId);
    assert.equal(journal.phases.restore.result.sessionPolicy, 'revoke-local-sessions-and-challenges');
    for (const store of ['business','master','avatars','covers']) assert.equal(journal.phases.restore.result.restoredHashes[store], opened.manifest.parts[store].snapshotHash);
    assert.notEqual(journal.phases.restore.result.restoredHashes.auth, opened.manifest.parts.auth.snapshotHash);
    assert.deepEqual(journal.phases.collect.storageClasses, ['Standard']);
    journal.verified = true; await save();
  }
} catch (error) {
  failure = /^proof_[a-z_0-9]+$/u.test(error.message) ? error.message : 'proof_preflight_or_identity_failed';
  journal.failure = failure; await save();
}
try {await cleanup();} catch (error) {
  journal.cleanupFailure = /^proof_[a-z_0-9]+$/u.test(error.message) ? error.message : 'proof_cleanup_identity_failed'; await save();
}
console.info(JSON.stringify({journal: journalPath, proofState: journal.verified ? 'verified' : 'not-verified',
  phases: Object.fromEntries(Object.entries(journal.phases ?? {}).map(([phase, value]) => [phase, {state: value?.state, error: value?.error}])), error: failure ?? null,
  cleanupVerified: journal.cleanupVerified, cleanupError: journal.cleanupFailure ?? null}));
if (failure || !journal.verified || !journal.cleanupVerified) process.exitCode = 1;

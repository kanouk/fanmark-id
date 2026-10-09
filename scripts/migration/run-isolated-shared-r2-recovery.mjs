/** Explicit remote rehearsal. Resume reads the same run; it never starts a second proof. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, realpath, unlink} from 'node:fs/promises';
import {randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const apiDirectory = path.join(repo, 'workers/api');
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const roles = ['SOURCE', 'TARGET', 'COVERS', 'COVER_TARGET', 'ACK', 'FOREIGN', 'CONTROL'];
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
const root = resumeDirectory ? await realpath(resumeDirectory) : path.join(privateBase, 'shared-r2-remote-' + randomUUID());
assert.ok(root.startsWith(privateBase + '/shared-r2-remote-'));
await mkdir(root, {mode: 0o700, recursive: true});
const journalPath = path.join(root, 'journal.json'), tokenPath = path.join(root, 'request-key.txt'), config = path.join(root, 'wrangler.json');
let journal = resumeDirectory ? JSON.parse(await readFile(journalPath, 'utf8')) : {
  format: 'fanmark-shared-r2-remote-proof-v1', account, head, ciRun, nonce: randomBytes(8).toString('hex'),
  startedAt: new Date().toISOString(), buckets: [], cleanupVerified: false,
};
assert.equal(journal.format, 'fanmark-shared-r2-remote-proof-v1'); assert.equal(journal.account, account);
assert.equal(journal.head, head); assert.equal(journal.ciRun, ciRun); assert.match(journal.nonce, /^[a-f0-9]{16}$/u);
journal.workerName = `fanmark-recovery-${journal.nonce}-shared-r2`;
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
const identity = {account, nonce: journal.nonce, head, buckets: names};
async function request(route, method = 'GET') {
  let response;
  try {response = await fetch(origin + '/_proof/' + route, {method, redirect: 'error',
    headers: {authorization: `Bearer ${token}`, 'x-proof-nonce': journal.nonce}, signal: AbortSignal.timeout(method === 'POST' ? 180_000 : 30_000)});
  } catch {throw new Error('proof_worker_ack_unknown');}
  let body;
  try {body = await response.json();} catch {throw new Error('proof_worker_response_invalid');}
  if (!response.ok) throw new Error('proof_worker_http_' + response.status);
  assert.deepEqual(route === 'identity' ? body : body.identity, identity);
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
    ...Object.fromEntries(roles.map(role => [role + '_NAME', names[role]]))};
  assert.equal(bindings.length, roles.length + Object.keys(text).length + 1);
  for (const [name, value] of Object.entries(text)) assert.ok(bindings.some(b => b.name === name && b.type === 'plain_text' && b.text === value));
  for (const role of roles) assert.ok(bindings.some(b => b.name === role && b.type === 'r2_bucket' && b.bucket_name === names[role]));
  assert.ok(bindings.some(b => b.name === 'PROOF_TOKEN' && b.type === 'secret_text'));
}
async function cleanup() {
  if (journal.pendingCreate || journal.workerDeployRequested && !journal.workerVersion) throw new Error('proof_resource_ownership_unresolved');
  if (journal.proofRequested && !journal.objectsCleared) {
    await bindingPreflight();
    const status = await request('status');
    if (journal.objectDeleteRequested && status.report === null && status.claimed === false) {
      // DELETE may have committed without its acknowledgement. Inspect the same
      // owned bindings; do not replay the proof or assume the cleanup succeeded.
      const observed = (await request('inventory')).objects;
      assert.deepEqual(Object.keys(observed).sort(), roles.toSorted());
      assert.ok(Object.values(observed).every(page => !page.truncated && page.keys.length === 0));
    } else {
      if (!['verified', 'failed'].includes(status.report?.state)) throw new Error('proof_not_terminal_preserved');
      journal.report = status.report; journal.objectDeleteRequested = true; await save();
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
  journal.cleanupVerified = true; journal.finishedAt = new Date().toISOString(); await save();
  await unlink(tokenPath);
}
let failure;
try {
  if (!resumeDirectory) {
    journal.before = await inventory();
    assert.ok(journal.before.workers.every(row => row.id !== journal.workerName));
    assert.ok(journal.before.r2.every(row => !Object.values(names).includes(row.name))); await save();
    for (const role of roles) {
      journal.pendingCreate = {role, name: names[role], requestedAt: new Date().toISOString()}; await save();
      await api('r2/buckets', 'POST', {name: names[role]});
      const actual = await api('r2/buckets/' + names[role]);
      assert.equal(actual.name, names[role]); assert.ok(Number.isFinite(Date.parse(actual.creation_date)));
      journal.buckets.push({role, name: actual.name, creation_date: actual.creation_date}); journal.pendingCreate = null; await save();
    }
    await writeFile(config, JSON.stringify({name: journal.workerName, account_id: account,
      main: fileURLToPath(new URL('./isolated-shared-r2-recovery-worker.mjs', import.meta.url)), compatibility_date: '2026-09-18', workers_dev: true,
      vars: {PROOF_ACCOUNT: account, PROOF_NONCE: journal.nonce, PROOF_HEAD: head,
        ...Object.fromEntries(roles.map(role => [role + '_NAME', names[role]]))},
      r2_buckets: roles.map(role => ({binding: role, bucket_name: names[role]})),
    }), {mode: 0o600});
    journal.workerDeployRequested = true; await save(); wrangler(['deploy'], {config});
    wrangler(['secret', 'put', 'PROOF_TOKEN'], {config, input: token + '\n'});
    journal.workerVersion = await version();
    journal.workerCreatedAt = (await inventory()).workers.find(row => row.id === journal.workerName)?.created_on;
    assert.ok(journal.workerCreatedAt); await save(); await bindingPreflight();
    let reachable = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {await request('identity'); reachable = true; break;} catch {if (attempt < 5) await delay(5000);}
    }
    assert.ok(reachable, 'proof_identity_unreachable');
    journal.proofRequested = true; await save();
    try {journal.report = (await request('run', 'POST')).report; await save();}
    catch {journal.runAcknowledgementUnknown = true; await save();}
  }
  // Resume never sends POST /run, even when a request acknowledgement was lost.
  if (journal.proofRequested && !journal.objectsCleared) {
    await bindingPreflight();
    const status = await request('status');
    if (!(journal.objectDeleteRequested && status.report === null && status.claimed === false)) {
      journal.report = status.report; await save();
      if (!['verified', 'failed'].includes(status.report?.state)) throw new Error('proof_not_terminal_preserved');
    }
  }
} catch (error) {
  failure = /^proof_[a-z_0-9]+$/u.test(error.message) ? error.message : 'proof_preflight_or_identity_failed';
  journal.failure = failure; await save();
}
try {await cleanup();} catch (error) {
  journal.cleanupFailure = /^proof_[a-z_0-9]+$/u.test(error.message) ? error.message : 'proof_cleanup_identity_failed'; await save();
}
console.info(JSON.stringify({journal: journalPath, proofState: journal.report?.state ?? 'not-started',
  proofStep: journal.report?.step ?? null, error: failure ?? journal.report?.error ?? null,
  cleanupVerified: journal.cleanupVerified, cleanupError: journal.cleanupFailure ?? null}));
if (failure || journal.report?.state !== 'verified' || !journal.cleanupVerified) process.exitCode = 1;

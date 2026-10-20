import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createIsolatedRemoteD1 } from './isolated-remote-d1.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const api = root + 'workers/api';
const accountId = 'bfc2890741f0b3fb236e2d755b6c9adc';
const [expectedHead, ciRun] = process.argv.slice(2);
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/u);
assert.match(ciRun ?? '', /^\d+$/u);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expectedHead);
assert.ok(git('diff', '--name-only').split('\n').filter(Boolean).every(name => name === 'supabase/.temp/cli-latest'));
assert.equal(git('diff', '--cached', '--name-only'), '');
const ci = JSON.parse(execFileSync('gh', ['run', 'view', ciRun, '--json', 'headSha,status,conclusion,jobs'], { cwd: root, encoding: 'utf8' }));
assert.equal(ci.headSha, expectedHead);
assert.equal(ci.status, 'completed', 'candidate CI still pending');
assert.equal(ci.conclusion, 'success');
assert.equal(ci.jobs.length, 2);
assert.ok(ci.jobs.every(job => job.conclusion === 'success'));
assert.ok(ci.jobs.some(job => job.steps.some(step => step.name === 'Test combined Business Auth Master and split R2 recovery' && step.conclusion === 'success')));
function wrangler(...args) {
  let stdout;
  try {
    stdout = execFileSync('npx', ['--yes', 'wrangler@4.139.0', ...args, '--config', 'wrangler.app-staging.jsonc'], {
      cwd: api, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('wrangler_command_failed'); }
  return JSON.parse(stdout);
}
const identity = wrangler('whoami', '--json');
assert.equal(identity.email, 'fanmark.id@gmail.com');
assert.ok(identity.accounts.some(account => account.id === accountId));
const auth = wrangler('auth', 'token', '--json');
assert.equal(typeof auth.token, 'string');
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
async function request(suffix, method = 'GET', body) {
  let response;
  try {
    response = await fetch(base + suffix, { method, redirect: 'error',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('resource_request_acknowledgement_unknown'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('resource_response_invalid'); }
  if (!response.ok || value.success !== true) throw new Error('resource_api_request_failed');
  return value;
}
const inventory = async () => {
  const envelope = await request('?per_page=100');
  assert.ok(Array.isArray(envelope.result));
  assert.ok((envelope.result_info?.total_pages ?? 1) <= 1);
  return envelope.result.map(row => ({ uuid: row.uuid, name: row.name, created_at: row.created_at })).sort((a,b) => a.uuid.localeCompare(b.uuid));
};
const runDirectory = await mkdtemp('/tmp/fanmark-isolated-d1-probe-');
const journalPath = runDirectory + '/journal.json';
const name = `fanmark-recovery-${randomUUID().replaceAll('-', '').slice(0,16)}-business`;
const journal = { startedAt: new Date().toISOString(), expectedHead, ciRun, accountId,
  intendedDatabaseName: name, resourceCreated: false, cleanupVerified: false, rollbackVerified: false };
async function save() {
  await writeFile(journalPath + '.next', JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  await rename(journalPath + '.next', journalPath);
}
let target = null;
let failure = null;
async function observedFetch(url, options) {
  const response = await fetch(url, options);
  let envelope;
  try { envelope = await response.clone().json(); } catch {}
  (journal.transportResponses ??= []).push({ method: options.method, status: response.status,
    success: envelope?.success, resultCount: Array.isArray(envelope?.result) ? envelope.result.length : null,
    errorCodes: envelope?.errors?.map(error => error.code),
    queryResultShape: Array.isArray(envelope?.result) ? envelope.result.map(row => ({
      success: row.success, hasResults: Array.isArray(row.results), hasMeta: typeof row.meta === 'object',
    })) : null });
  return response;
}
await save();
try {
  const before = await inventory();
  // One tiny probe only. Never delete an existing resource to make quota space.
  assert.ok(before.length < 10, 'no free-plan D1 capacity for isolated probe');
  assert.ok(before.every(row => row.name !== name));
  journal.beforeInventory = before;
  journal.createRequestedAt = new Date().toISOString();
  await save();
  const created = (await request('', 'POST', { name })).result;
  journal.createResponseIdentity = { uuid: created?.uuid, name: created?.name, created_at: created?.created_at };
  await save();
  assert.equal(created.name, name);
  assert.match(created.uuid, /^[a-f0-9-]{36}$/u);
  assert.ok(Number.isFinite(Date.parse(created.created_at)));
  target = { accountId, databaseId: created.uuid, databaseName: created.name,
    createdAt: created.created_at, targetIncarnation: randomUUID() };
  journal.target = target;
  journal.resourceCreated = true;
  await save();
  const database = createIsolatedRemoteD1({ target, token: auth.token, fetchImpl: observedFetch });
  await database.verifyIsolatedTarget();
  await database.prepare('CREATE TABLE recovery_probe(id INTEGER PRIMARY KEY,n INTEGER CHECK(n>=0),label TEXT,exact INTEGER)').run();
  const results = await database.batch([
    database.prepare('INSERT INTO recovery_probe VALUES(?,?,?,CAST(? AS INTEGER))').bind(1, 2, "日本語 ' literal", '9223372036854775807'),
    database.prepare('INSERT INTO recovery_probe VALUES(?,?,?,?)').bind(2, 3, null, null),
    database.prepare('SELECT id,label,CAST(exact AS TEXT) AS exactText,typeof(exact) AS exactType FROM recovery_probe ORDER BY id'),
  ]);
  assert.deepEqual(results[2].results, [
    { id: 1, label: "日本語 ' literal", exactText: '9223372036854775807', exactType: 'integer' },
    { id: 2, label: null, exactText: null, exactType: 'null' },
  ]);
  journal.valueRoundtripVerified = true;
  await save();
  await assert.rejects(database.batch([
    database.prepare('INSERT INTO recovery_probe(id,n) VALUES(?,?)').bind(3, 3),
    database.prepare('INSERT INTO recovery_probe(id,n) VALUES(?,?)').bind(4, -1),
  ]), error => error.code === 'remote_api_request_failed');
  const rollbackCount = await database.prepare('SELECT COUNT(*) AS count FROM recovery_probe WHERE id IN (3,4)').first('count');
  journal.failedBatchRetainedRowCount = rollbackCount;
  await save();
  assert.equal(rollbackCount, 0, 'Cloudflare REST batch must roll back earlier writes on later CHECK failure');
  journal.rollbackVerified = true;
  let writeCalls = 0;
  const loseAck = createIsolatedRemoteD1({ target, token: auth.token, fetchImpl: async (url, options) => {
    const response = await observedFetch(url, options);
    if (options.method === 'POST') {
      writeCalls += 1;
      assert.equal((await response.json()).success, true);
      throw new TypeError('synthetic acknowledgement lost after committed response');
    }
    return response;
  } });
  await assert.rejects(loseAck.prepare('INSERT INTO recovery_probe(id,n) VALUES(?,?)').bind(5, 5).run(),
    error => error.code === 'remote_request_acknowledgement_unknown');
  assert.equal(writeCalls, 1);
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM recovery_probe WHERE id=5').first('count'), 1);
  journal.committedLostAckNoAutomaticRetryVerified = true;
  journal.acceptedAt = new Date().toISOString();
  await save();
} catch (error) {
  failure = error;
  journal.failureCode = error.code ?? 'probe_assertion_or_resource_failure';
  await save();
} finally {
  if (target) {
    try {
      const metadata = (await request('/' + target.databaseId)).result;
      assert.equal(metadata.uuid, target.databaseId);
      assert.equal(metadata.name, target.databaseName);
      assert.equal(metadata.created_at, target.createdAt);
      journal.deleteRequestedAt = new Date().toISOString();
      await save();
      await request('/' + target.databaseId, 'DELETE');
      const after = await inventory();
      assert.deepEqual(after, journal.beforeInventory);
      journal.cleanupVerified = true;
      journal.cleanupVerifiedAt = new Date().toISOString();
      await save();
    } catch (error) {
      failure ??= error;
      journal.cleanupFailureCode = error.code ?? 'cleanup_identity_or_resource_failure';
      await save();
    }
  }
  auth.token = null;
}
console.log(JSON.stringify({ journalPath, rollbackVerified: journal.rollbackVerified,
  valueRoundtripVerified: journal.valueRoundtripVerified ?? false,
  committedLostAckNoAutomaticRetryVerified: journal.committedLostAckNoAutomaticRetryVerified ?? false,
  cleanupVerified: journal.cleanupVerified, failed: failure !== null }));
if (failure) process.exitCode = 1;

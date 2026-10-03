/** Explicit synthetic-only remote rehearsal; owns and journals every resource. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { createIsolatedRemoteR2 } from './isolated-remote-r2.mjs';
import { createSplitR2ImportTransport } from './split-r2-import-transport.mjs';
import { prepareCurrentCatalogSyntheticSnapshot, applySyntheticAuthSchema } from './test-d1-import-current-schema.mjs';
import { prepareSyntheticAuxiliaryBundle, createSyntheticAuxiliaryRecovery } from './synthetic-auxiliary-recovery.mjs';
import { applyBusinessRuntimeMigrations } from './business-runtime-import-schema.mjs';
import { importD1Snapshot } from './d1-import.mjs';
import { sha256Hex } from './snapshot-format.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const apiDirectory = path.join(repo, 'workers/api');
const accountId = 'bfc2890741f0b3fb236e2d755b6c9adc';
const [expectedHead, ciRun] = process.argv.slice(2);
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/u);
assert.match(ciRun ?? '', /^\d+$/u);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expectedHead);
assert.ok(git('diff', '--name-only').split('\n').filter(Boolean).every(name => name === 'supabase/.temp/cli-latest'));
assert.equal(git('diff', '--cached', '--name-only'), '');
const ci = JSON.parse(execFileSync('gh', ['run', 'view', ciRun, '--json', 'headSha,status,conclusion,jobs'], { cwd: repo, encoding: 'utf8' }));
assert.equal(ci.headSha, expectedHead);
assert.equal(ci.status, 'completed');
assert.equal(ci.conclusion, 'success');
assert.equal(ci.jobs.length, 2);
assert.ok(ci.jobs.every(job => job.conclusion === 'success'));
assert.ok(ci.jobs.some(job => job.steps.some(step => step.name === 'Test combined Business Auth Master and split R2 recovery' && step.conclusion === 'success')));
let recoveryApiToken = null;
function wrangler(args, { config = path.join(apiDirectory, 'wrangler.app-staging.jsonc'), input, json = false } = {}) {
  let output;
  try { output = execFileSync('npx', ['--yes', 'wrangler@4.139.0', ...args, '--config', config], {
    cwd: apiDirectory, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false',
      ...(recoveryApiToken ? { CLOUDFLARE_API_TOKEN: recoveryApiToken } : {}) }, input, stdio: ['pipe', 'pipe', 'pipe'],
  }); } catch (cause) {
    // Never persist stdin, environment values or raw CLI output (secret commands
    // use this same wrapper). Keep only bounded command/status/numeric API codes.
    const error = new Error('recovery_wrangler_command_failed');
    error.code = 'recovery_wrangler_command_failed';
    error.commandFailure = { command: args[0], exitCode: Number.isInteger(cause.status) ? cause.status : null,
      signal: ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(cause.signal) ? cause.signal : null,
      providerCodes: [...new Set([...String(cause.stderr ?? '').concat(String(cause.stdout ?? ''))
        .matchAll(/\[code:\s*(\d{1,10})\]/gu)].map(match => match[1]))].slice(0, 5) };
    throw error;
  }
  if (!json) return null;
  try { return JSON.parse(output); } catch { throw new Error('recovery_wrangler_response_invalid'); }
}
const who = wrangler(['whoami', '--json'], { json: true });
assert.equal(who.email, 'fanmark.id@gmail.com');
assert.ok(who.accounts.some(account => account.id === accountId));
const auth = wrangler(['auth', 'token', '--json'], { json: true });
assert.equal(typeof auth.token, 'string');
// A /tmp config otherwise selects the user's unrelated default profile. All
// subsequent CLI calls must use the already verified staging credential.
recoveryApiToken = auth.token;
const root = await mkdtemp('/tmp/fanmark-combined-remote-');
const journalPath = path.join(root, 'journal.json');
const journal = { startedAt: new Date().toISOString(), expectedHead, ciRun, accountId,
  snapshotScope: 'checked-in synthetic fixture only; Auth dependency user, not real Auth credentials', targets: [] };
async function save() {
  await writeFile(journalPath + '.next', JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  await rename(journalPath + '.next', journalPath);
}
async function apiRequest(resource, method = 'GET', payload) {
  let response;
  try { response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${resource}`, {
    method, redirect: 'error', headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000),
  }); } catch { throw new Error('recovery_resource_acknowledgement_unknown'); }
  if (response.status === 204 && method === 'DELETE') return null;
  let envelope;
  try { envelope = await response.json(); } catch { throw new Error('recovery_resource_response_invalid'); }
  if (!response.ok || envelope.success !== true) throw new Error('recovery_resource_api_failed');
  return envelope.result;
}
const sorted = values => values.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
async function inventory() {
  const d1 = await apiRequest('d1/database?per_page=100');
  const r2 = await apiRequest('r2/buckets');
  const workers = await apiRequest('workers/scripts');
  assert.ok(Array.isArray(d1) && d1.length < 100 && Array.isArray(r2.buckets) && Array.isArray(workers));
  return { d1: sorted(d1.map(row => ({ uuid: row.uuid, name: row.name, created_at: row.created_at }))),
    r2: sorted(r2.buckets.map(row => ({ name: row.name, creation_date: row.creation_date }))),
    workers: sorted(workers.map(row => ({ id: row.id, created_on: row.created_on }))) };
}
function initialization(database) {
  // Only schema initialization of a fresh owned database may span batches.
  // Snapshot row/checkpoint transactions always use the original atomic binding.
  return { prepare: database.prepare, async batch(statements) {
    const results = [];
    for (let offset = 0; offset < statements.length; offset += 80) results.push(...await database.batch(statements.slice(offset, offset + 80)));
    return results;
  } };
}
async function latestDeployment(target) {
  const deployments = wrangler(['deployments', 'list', '--name', target.workerName, '--json'], { config: target.configPath, json: true });
  const current = deployments.toSorted((a,b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  assert.ok(current?.versions?.length === 1 && current.versions[0].percentage === 100);
  return current.versions[0].version_id;
}
async function createTarget(phase) {
  const nonce = randomUUID().replaceAll('-', '').slice(0,16);
  const target = { phase, targetIncarnation: randomUUID(), databases: [], buckets: [],
    workerName: `fanmark-recovery-${nonce}-assets`, configPath: path.join(root, `${phase}-wrangler.json`), cleanupVerified: false };
  journal.targets.push(target);
  await save();
  const before = await inventory();
  assert.ok(before.d1.length + 3 <= 10, 'no free-plan D1 capacity for one owned recovery target');
  assert.ok(before.workers.every(worker => worker.id !== target.workerName));
  const bindings = {};
  for (const kind of ['business', 'auth', 'master']) {
    const name = `fanmark-recovery-${nonce}-${kind}`;
    assert.ok(before.d1.every(database => database.name !== name));
    target.pendingCreate = { kind: 'd1', name, requestedAt: new Date().toISOString() };
    await save();
    const created = await apiRequest('d1/database', 'POST', { name });
    target.createResponseIdentity = { uuid: created?.uuid, name: created?.name, created_at: created?.created_at };
    await save();
    assert.match(created?.uuid ?? '', /^[a-f0-9-]{36}$/u);
    const actual = await apiRequest('d1/database/' + created.uuid);
    assert.equal(actual.uuid, created.uuid);
    assert.ok(before.d1.every(database => database.uuid !== actual.uuid));
    assert.equal(actual.name, name);
    assert.ok(Number.isFinite(Date.parse(actual.created_at)));
    const receipt = { accountId, databaseId: actual.uuid, databaseName: name, createdAt: actual.created_at, targetIncarnation: target.targetIncarnation };
    target.databases.push(receipt);
    target.pendingCreate = null;
    await save();
    bindings[kind] = createIsolatedRemoteD1({ target: receipt, token: auth.token });
  }
  const expectedBuckets = {};
  for (const kind of ['avatars', 'covers']) {
    const name = `fanmark-recovery-${nonce}-${kind}`;
    assert.ok(before.r2.every(bucket => bucket.name !== name));
    target.pendingCreate = { kind: 'r2', name, requestedAt: new Date().toISOString() };
    await save();
    await apiRequest('r2/buckets', 'POST', { name });
    const actual = await apiRequest('r2/buckets/' + name);
    assert.equal(actual.name, name);
    assert.ok(Number.isFinite(Date.parse(actual.creation_date)));
    target.buckets.push({ name, creation_date: actual.creation_date });
    target.pendingCreate = null;
    await save();
    expectedBuckets[kind] = name;
  }
  await writeFile(target.configPath, JSON.stringify({ name: target.workerName, account_id: accountId,
    main: fileURLToPath(new URL('./isolated-recovery-r2-worker.mjs', import.meta.url)), compatibility_date: '2026-09-20', workers_dev: true,
    vars: { STORAGE_BACKEND: 'r2', RECOVERY_INCARNATION: target.targetIncarnation,
      RECOVERY_AVATARS_NAME: expectedBuckets.avatars, RECOVERY_COVERS_NAME: expectedBuckets.covers },
    r2_buckets: [{ binding: 'AVATARS_BUCKET', bucket_name: expectedBuckets.avatars }, { binding: 'COVER_IMAGES_BUCKET', bucket_name: expectedBuckets.covers }],
  }), { mode: 0o600 });
  target.workerDeployRequestedAt = new Date().toISOString();
  await save();
  wrangler(['deploy'], { config: target.configPath });
  target.workerCreated = true;
  await save();
  const token = randomBytes(32).toString('hex');
  wrangler(['secret', 'put', 'RECOVERY_TOKEN', '--name', target.workerName], { config: target.configPath, input: token + '\n' });
  target.workerVersion = await latestDeployment(target);
  const workerMetadata = (await inventory()).workers.find(worker => worker.id === target.workerName);
  assert.ok(workerMetadata?.created_on);
  target.workerCreatedAt = workerMetadata.created_on;
  await save();
  const origin = `https://${target.workerName}.fanmark-id.workers.dev`;
  const r2 = createIsolatedRemoteR2({ workerOrigin: origin, token, targetIncarnation: target.targetIncarnation, expectedBuckets });
  for (let attempt = 0;; attempt += 1) {
    try { await r2.verifyIsolatedTarget(); break; }
    catch (error) {
      if (attempt === 4) throw error;
      // Read-only identity readiness after a fresh deployment. Never retry PUT.
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { ownership: target, bindings, r2, applicationTarget: {
    database: bindings.business, authDatabase: bindings.auth, masterDatabase: bindings.master,
    masterInitializationDatabase: initialization(bindings.master), avatarBucket: r2.avatars, coverBucket: r2.covers,
    r2Transport: createSplitR2ImportTransport(r2), storageOrigin: origin,
    readApplicationStorage: request => fetch(request, { redirect: 'error', signal: AbortSignal.timeout(30000) }),
  } };
}
async function cleanup(target, live, prepared) {
  const errors = [];
  if (live) {
    try {
      await live.r2.verifyIsolatedTarget();
      for (const [index, bucket] of [live.r2.avatars, live.r2.covers].entries()) {
        const object = prepared.objects[index];
        const stored = await bucket.get(object.key);
        if (stored) {
          assert.equal(sha256Hex(Buffer.from(await stored.arrayBuffer())), object.contentSHA256);
          await bucket.deleteOwnedFixture(object.key);
        }
        assert.deepEqual((await bucket.list()).objects, []);
      }
    } catch { errors.push('r2_object_cleanup_failed'); }
  }
  // Do not remove the only access path if object cleanup needs investigation.
  if (target.workerCreated && errors.length === 0 && target.workerVersion) {
    try {
      assert.equal(await latestDeployment(target), target.workerVersion);
      const metadata = (await inventory()).workers.find(worker => worker.id === target.workerName);
      assert.equal(metadata?.created_on, target.workerCreatedAt);
      await apiRequest('workers/scripts/' + target.workerName, 'DELETE');
      target.workerDeleted = true;
      await save();
    } catch { errors.push('worker_cleanup_failed'); }
  }
  if (target.workerDeployRequestedAt && !target.workerDeleted && errors.length === 0) {
    try {
      const observed = await inventory();
      assert.ok(observed.workers.every(worker => worker.id !== target.workerName));
      target.workerAbsenceVerified = true;
      target.workerAbsenceVerifiedAt = new Date().toISOString();
      await save();
    } catch { errors.push('worker_deployment_ownership_unresolved'); }
  }
  if (errors.length === 0) for (const bucket of target.buckets) {
    try {
      const metadata = await apiRequest('r2/buckets/' + bucket.name);
      assert.equal(metadata.name, bucket.name); assert.equal(metadata.creation_date, bucket.creation_date);
      await apiRequest('r2/buckets/' + bucket.name, 'DELETE');
      bucket.deleted = true; await save();
    } catch { errors.push('bucket_cleanup_failed'); }
  }
  for (const database of target.databases) {
    try {
      const metadata = await apiRequest('d1/database/' + database.databaseId);
      assert.equal(metadata.uuid, database.databaseId); assert.equal(metadata.name, database.databaseName); assert.equal(metadata.created_at, database.createdAt);
      await apiRequest('d1/database/' + database.databaseId, 'DELETE');
      database.deleted = true; await save();
    } catch { errors.push('d1_cleanup_failed'); }
  }
  target.cleanupErrors = errors;
  target.cleanupVerified = errors.length === 0 && !target.pendingCreate &&
    (!target.workerDeployRequestedAt || target.workerDeleted === true || target.workerAbsenceVerified === true);
  await save();
  if (!target.cleanupVerified) throw new Error('recovery_cleanup_incomplete');
}
let failure = null;
await save();
try {
  const credentialConfig = path.join(root, 'credential-preflight-wrangler.json');
  await writeFile(credentialConfig, JSON.stringify({ account_id: accountId }), { mode: 0o600 });
  const temporaryIdentity = wrangler(['whoami', '--json'], { config: credentialConfig, json: true });
  assert.ok(temporaryIdentity.accounts.some(account => account.id === accountId));
  journal.temporaryConfigCredentialVerifiedAt = new Date().toISOString();
  await save();
  journal.beforeInventory = await inventory();
  assert.ok(journal.beforeInventory.d1.length + 3 <= 10);
  const fixture = await prepareCurrentCatalogSyntheticSnapshot(fileURLToPath(new URL('./fixtures/business-import-structure.json', import.meta.url)),
    { snapshotDirectory: path.join(root, 'snapshot') });
  const prepared = await prepareSyntheticAuxiliaryBundle(root, fixture.manifestPath);
  journal.bundleSHA256 = sha256Hex(prepared.bundle);
  await mkdir(path.join(root, 'reports'), { mode: 0o700 });
  await save();
  for (const phase of ['primary', 'restored']) {
    const started = performance.now();
    let live = null;
    const ownershipIndex = journal.targets.length;
    try {
      live = await createTarget(phase);
      live.ownership.stage = 'business-schema'; await save();
      await applyBusinessRuntimeMigrations(initialization(live.bindings.business));
      live.ownership.stage = 'auth-schema'; await save();
      await applySyntheticAuthSchema(initialization(live.bindings.auth));
      const reportPath = path.join(root, 'reports', phase + '-import.json');
      const options = { manifestPath: fixture.manifestPath, database: live.bindings.business,
        destinationId: 'synthetic-combined-remote-recovery', targetIncarnation: live.ownership.targetIncarnation,
        reportPath, mode: 'isolated-remote', canonicalBusinessSchema: true, allowUnresolvedGates: true,
        expectedTargetProfile: fixture.expectedTargetProfile, maxRowsPerBatch: 1, scanBatchRows: 1,
        now: () => new Date('2026-09-26T12:00:00.000Z'), resolveAuthUserIds: async ids => {
          assert.deepEqual(ids, [fixture.syntheticAuthUserId]);
          return new Set((await live.bindings.auth.prepare('SELECT id FROM "user" WHERE id=?').bind(ids[0]).all()).results.map(row => row.id));
        } };
      if (phase === 'primary') {
        live.ownership.stage = 'committed-credential-interruption'; await save();
        let cut = false;
        await assert.rejects(importD1Snapshot({ ...options, hooks: { afterCredentialBatchCommit() {
          if (!cut) { cut = true; throw new Error('synthetic committed-credential interruption'); }
        } } }), error => error.code === 'credential_batch_ack_unknown');
        live.ownership.interruptionObserved = true;
      }
      live.ownership.stage = 'import-resume-reconcile'; await save();
      const result = await importD1Snapshot(options);
      assert.equal(result.status, 'public_rows_reconciled'); assert.equal(result.objectCount, 40);
      assert.equal(result.deployable, false); assert.equal(result.fullMigrationReconciled, false);
      live.ownership.stage = 'master-and-split-r2'; await save();
      const auxiliary = await createSyntheticAuxiliaryRecovery({ preparedBundle: prepared })({ target: live.applicationTarget, root,
        manifestPath: fixture.manifestPath, phase });
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      assert.equal(report.reconciledTables.length, 40);
      assert.ok(report.reconciledTables.every(table => Number.isSafeInteger(Number(table.rowCount)) && Number(table.rowCount) >= 0));
      const summary = { sourceRows: report.reconciledTables.reduce((count, table) => count + Number(table.rowCount), 0),
        tables: report.reconciledTables.map(table => [table.table, table.rowCount, table.sourceStreamHash]), auxiliary };
      assert.equal(summary.sourceRows, 15);
      if (phase === 'primary') journal.primary = summary; else assert.deepEqual(summary, journal.primary);
      for (const binding of Object.values(live.bindings)) assert.deepEqual((await binding.prepare('PRAGMA foreign_key_check').all()).results, []);
      assert.deepEqual(await live.bindings.business.prepare('SELECT requested_generation,acknowledged_generation FROM notification_worker_wake_state WHERE singleton_id=1').first(),
        { requested_generation: 1, acknowledged_generation: 0 });
      live.ownership.acceptedAt = new Date().toISOString();
      live.ownership.stage = 'accepted';
      live.ownership.syntheticProvisionAndRestoreDurationMs = Math.round(performance.now() - started);
      live.ownership.reportPath = reportPath;
      await save();
    } catch (error) {
      const target = journal.targets[ownershipIndex];
      if (target) { target.failureStage = target.stage ?? 'create-target'; target.failureCode = error.code ?? 'recovery_step_failed';
        if (error.commandFailure) target.commandFailure = error.commandFailure;
        await save(); }
      throw error;
    } finally {
      const target = journal.targets[ownershipIndex];
      if (target) { target.stage = 'cleanup'; await save(); await cleanup(target, live, prepared); }
    }
  }
  journal.afterInventory = await inventory();
  assert.deepEqual(journal.afterInventory, journal.beforeInventory);
  assert.notEqual(journal.targets[0].targetIncarnation, journal.targets[1].targetIncarnation);
  assert.ok(journal.targets[0].databases.every(first => journal.targets[1].databases.every(second => first.databaseId !== second.databaseId)));
  assert.ok(journal.targets.every(target => target.cleanupVerified));
  journal.remoteSyntheticBundleAccepted = true;
  journal.acceptedAt = new Date().toISOString();
} catch (error) { failure = error; journal.failureCode = error.code ?? 'recovery_assertion_or_resource_failure';
  if (error.commandFailure) journal.commandFailure = error.commandFailure; }
finally { auth.token = null; recoveryApiToken = null; await save(); }
console.log(JSON.stringify({ journalPath, remoteSyntheticBundleAccepted: journal.remoteSyntheticBundleAccepted ?? false,
  targetsCleaned: journal.targets.filter(target => target.cleanupVerified).length, failed: failure !== null }));
if (failure) process.exitCode = 1;

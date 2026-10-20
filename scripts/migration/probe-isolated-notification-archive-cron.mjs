#!/usr/bin/env node
/** Actual Cron -> unchanged application scheduler -> isolated synthetic D1. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BUSINESS_MIGRATION_SEQUENCE } from './business-migration-ledger.mjs';
import { businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { createIsolatedRemoteD1 } from './isolated-remote-d1.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repo, 'workers/api');
const accountId = 'bfc2890741f0b3fb236e2d755b6c9adc';
// The common '* * * * *' expression also dispatches notification/Stripe
// stubs. Use an equivalent cadence with the archive's explicit custom Cron.
const CRON = '*/1 * * * *';
const flags = process.argv.slice(2);
assert.deepEqual(flags, ['--run-live-staging-write', '--confirm-synthetic-only', '--confirm-delete-created-resources'], 'explicit isolated write/cleanup guards required');
assert.equal(execFileSync('git', ['diff', 'a2d09dd', '--', 'workers/api/src', 'workers/api/migrations-business'], { cwd: repo, encoding: 'utf8' }), '', 'scheduler must match accepted code');
const ci = JSON.parse(execFileSync('gh', ['run', 'view', '37120631839', '--json', 'headSha,status,conclusion,jobs'], { cwd: repo, encoding: 'utf8' }));
assert.equal(ci.headSha, 'a2d09dd14a29f3c296bdc67288331bcbeac0cf27');
assert.equal(ci.status, 'completed');
assert.equal(ci.conclusion, 'success');
assert.ok(ci.jobs.every(job => job.conclusion === 'success'));
let token = null;
function wrangler(args, config = path.join(apiRoot, 'wrangler.app-staging.jsonc')) {
  try {
    return execFileSync('npx', ['--yes', 'wrangler@4.139.0', ...args, '--config', config], {
      cwd: apiRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', ...(token ? { CLOUDFLARE_API_TOKEN: token } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (cause) {
    // Do not print/persist CLI output, environment or credentials.
    const error = new Error('archive_cron_cli_failed');
    error.command = args[0]; error.exitCode = cause.status ?? null;
    throw error;
  }
}
const who = JSON.parse(wrangler(['whoami', '--json']));
assert.equal(who.email, 'fanmark.id@gmail.com');
assert.ok(who.accounts.some(account => account.id === accountId));
token = JSON.parse(wrangler(['auth', 'token', '--json'])).token;
assert.equal(typeof token, 'string');
const root = await mkdtemp('/tmp/fanmark-archive-cron-');
const journalPath = path.join(root, 'journal.json');
const nonce = randomBytes(8).toString('hex');
const workerName = `fanmark-archive-cron-${nonce}`;
const databaseName = `fanmark-recovery-archive-${nonce}-business`;
const journal = { status: 'preparing', startedAt: new Date().toISOString(), accountId,
  ciRun: 37120631839, codeHead: ci.headSha, workerName, databaseName,
  scope: 'new isolated synthetic resources only; no app/source binding or HTTP canary',
  database: null, workerCreated: false, workerDeleted: false, databaseDeleted: false };
async function save() {
  await writeFile(`${journalPath}.next`, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  await rename(`${journalPath}.next`, journalPath);
}
async function request(resource, method = 'GET', payload) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${resource}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (method === 'DELETE' && response.status === 204) return null;
  const body = await response.json();
  assert.ok(response.ok && body.success === true, 'archive_cron_control_plane_failed');
  return body.result;
}
async function inventory() {
  const databases = await request('d1/database?per_page=100');
  const workers = await request('workers/scripts');
  assert.ok(databases.length < 100);
  return { databases: databases.map(row => ({ uuid: row.uuid, name: row.name, created_at: row.created_at })).sort((a,b) => a.uuid.localeCompare(b.uuid)),
    workers: workers.map(row => ({ id: row.id, created_on: row.created_on })).sort((a,b) => a.id.localeCompare(b.id)) };
}
let database;
let failure;
await save();
console.log(JSON.stringify({ status: 'preparing', journalPath }));
try {
  journal.before = await inventory();
  assert.ok(journal.before.databases.length < 10, 'no free-plan isolated D1 capacity');
  assert.ok(journal.before.databases.every(row => row.name !== databaseName));
  assert.ok(journal.before.workers.every(row => row.id !== workerName));
  journal.pendingCreate = { databaseName, requestedAt: new Date().toISOString() }; await save();
  const created = await request('d1/database', 'POST', { name: databaseName });
  assert.equal(created.name, databaseName);
  journal.database = { accountId, databaseId: created.uuid, databaseName, createdAt: created.created_at, targetIncarnation: randomUUID() };
  journal.pendingCreate = null; await save();
  database = createIsolatedRemoteD1({ target: journal.database, token });
  for (const name of BUSINESS_MIGRATION_SEQUENCE) {
    const statements = businessMigrationStatements(await readFile(path.join(apiRoot, 'migrations-business', name), 'utf8'));
    for (let offset = 0; offset < statements.length; offset += 100) {
      await database.batch(statements.slice(offset, offset + 100).map(sql => database.prepare(sql)));
    }
  }
  await database.prepare(`CREATE TABLE migration_scheduled_dispatch_diagnostics (
    event_id TEXT PRIMARY KEY, cron TEXT NOT NULL, scheduled_time_ms INTEGER NOT NULL,
    stage TEXT NOT NULL, job_name TEXT NOT NULL, details_json TEXT NOT NULL)`).run();
  const old = '2020-01-01T00:00:00.000000Z';
  const recent = new Date().toISOString().replace(/Z$/u, '000Z');
  const fixtures = [
    { id: randomUUID(), status: 'delivered', triggered: old, archive: true },
    { id: randomUUID(), status: 'failed', triggered: old, archive: true },
    { id: randomUUID(), status: 'pending', triggered: old, archive: false },
    { id: randomUUID(), status: 'delivered', triggered: recent, archive: false },
  ];
  for (const fixture of fixtures) {
    await database.prepare(`INSERT INTO notifications
      (id,user_id,channel,template_id,payload,status,triggered_at,created_at,updated_at)
      VALUES (?,?,'in_app',?,'{"synthetic":"archive-cron"}',?,?,?,?)`)
      .bind(fixture.id, '90000000-0000-4000-8000-00000000000d', randomUUID(), fixture.status, fixture.triggered, fixture.triggered, fixture.triggered).run();
  }
  journal.fixtures = fixtures; journal.migrationCount = BUSINESS_MIGRATION_SEQUENCE.length;
  const configPath = path.join(root, 'wrangler.json');
  const config = {
    name: workerName, account_id: accountId, main: path.join(apiRoot, 'src/index.ts'),
    compatibility_date: '2026-09-18', workers_dev: false, preview_urls: false,
    triggers: { crons: [CRON] },
    vars: { D1_TOPOLOGY: 'split', NOTIFICATION_ARCHIVE_BACKEND: 'd1',
      NOTIFICATION_ARCHIVE_CRON: CRON, SCHEDULED_DISPATCH_DIAGNOSTICS: 'true' },
    d1_databases: ['FANMARK_DB', 'SCHEDULED_DISPATCH_DIAGNOSTICS_DB'].map(binding => ({ binding,
      database_name: databaseName, database_id: created.uuid, remote: true })),
    observability: { enabled: true, head_sampling_rate: 1 },
  };
  assert.equal(config.d1_databases.length, 2);
  assert.ok(config.d1_databases.every(binding => binding.database_id === journal.database.databaseId));
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  journal.configPath = configPath; journal.status = 'deploying'; await save();
  // Record intent before deploy so a lost acknowledgement cannot hide a Worker.
  journal.workerCreateIntent = true; await save();
  wrangler(['deploy'], configPath);
  journal.workerCreated = true; journal.deployedAt = new Date().toISOString(); await save();
  const scheduleResponse = await request(`workers/scripts/${workerName}/schedules`);
  const schedules = Array.isArray(scheduleResponse) ? scheduleResponse : scheduleResponse.schedules;
  assert.deepEqual(schedules.map(row => row.cron), [CRON]);
  journal.actualSchedules = schedules;
  const settings = await request(`workers/scripts/${workerName}/settings`);
  const bindings = settings.bindings.filter(binding => binding.type === 'd1');
  assert.equal(bindings.length, 2);
  assert.ok(bindings.every(binding => binding.id === journal.database.databaseId));
  journal.actualD1Bindings = bindings.map(binding => ({ name: binding.name, id: binding.id }));
  journal.status = 'waiting-for-real-cron'; await save();
  console.log(JSON.stringify({ status: journal.status, journalPath, workerName }));
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const rows = (await database.prepare('SELECT * FROM migration_scheduled_dispatch_diagnostics ORDER BY scheduled_time_ms,event_id').all()).results;
    journal.diagnostics = rows; await save();
    assert.ok(rows.every(row => row.stage !== 'job_failed'), 'actual_cron_archive_failed');
    const complete = rows.find(row => row.stage === 'job_completed' && row.job_name === 'notification-archive' && JSON.parse(row.details_json).archived === 2);
    if (complete) {
      assert.equal(complete.cron, CRON);
      assert.ok(complete.scheduled_time_ms >= Date.parse(journal.deployedAt) - 60000);
      assert.ok(rows.some(row => row.stage === 'received' && row.scheduled_time_ms === complete.scheduled_time_ms));
      assert.ok(rows.some(row => row.stage === 'selected' && row.scheduled_time_ms === complete.scheduled_time_ms &&
        JSON.stringify(JSON.parse(row.details_json).selectedJobs) === '["notification-archive"]'));
      const retained = (await database.prepare('SELECT id,status FROM notifications ORDER BY id').all()).results;
      const archived = (await database.prepare('SELECT id,original_data,archived_at FROM notifications_history ORDER BY id').all()).results;
      assert.deepEqual(retained.map(row => row.id).sort(), fixtures.filter(row => !row.archive).map(row => row.id).sort());
      assert.deepEqual(archived.map(row => row.id).sort(), fixtures.filter(row => row.archive).map(row => row.id).sort());
      for (const row of archived) assert.equal(JSON.parse(row.original_data).payload.synthetic, 'archive-cron');
      assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
      journal.proof = { receivedAt: new Date().toISOString(), scheduledTime: complete.scheduled_time_ms, details: JSON.parse(complete.details_json), retained, archived };
      journal.status = 'verified'; await save(); break;
    }
    await delay(20000);
  }
  assert.equal(journal.status, 'verified', 'actual_cron_not_observed_within_20_minutes');
} catch (error) {
  failure = error; journal.failure = { name: error.name, code: error.code ?? error.message,
    command: error.command, exitCode: error.exitCode }; journal.status = 'failed'; await save();
} finally {
  try {
    if (journal.workerCreateIntent) {
      const worker = (await request('workers/scripts')).find(row => row.id === workerName);
      if (worker) {
        assert.ok(!journal.before.workers.some(row => row.id === workerName));
        await request(`workers/scripts/${workerName}`, 'DELETE');
      }
      journal.workerDeleted = true; await save();
    }
    if (journal.database) {
      const actual = await request(`d1/database/${journal.database.databaseId}`);
      assert.equal(actual.uuid, journal.database.databaseId); assert.equal(actual.name, journal.database.databaseName);
      assert.equal(actual.created_at, journal.database.createdAt);
      await request(`d1/database/${actual.uuid}`, 'DELETE'); journal.databaseDeleted = true; await save();
    }
    if (journal.before && !journal.pendingCreate) {
      journal.after = await inventory(); assert.deepEqual(journal.after, journal.before);
      journal.cleanupVerified = true;
      if (!failure) journal.status = 'verified-and-cleaned';
    }
  } catch (error) { journal.cleanupFailure = { code: error.code ?? error.message }; failure ??= error; }
  token = null; await save();
}
console.log(JSON.stringify({ status: journal.status, cleanupVerified: journal.cleanupVerified === true, journalPath }));
if (failure) { process.exitCode = 1; }

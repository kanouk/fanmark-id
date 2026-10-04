#!/usr/bin/env node
/** Observe only the named staging Worker and aggregate Business D1 health. Never repair or activate jobs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_MIGRATION_SEQUENCE } from './business-migration-ledger.mjs';
import { createStagingMonitorApi } from './staging-monitor-api.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = path.join(repo, 'workers/api');
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const worker = 'fanmark-app-staging';
const origin = 'https://fanmark-app-staging.fanmark-id.workers.dev';
const databases = {
  FANMARK_DB: 'd4bb0c48-f24a-491f-8693-fa393ab0b873',
  AUTH_DB: '2116bc43-32ab-4e3e-b762-9378df88b95f',
  MASTER_DB: '160376b0-bde6-4d5f-8969-96deb5ae1183',
};
let token;
let stage = 'configuration';
function cli(args) {
  try {
    return JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4.139.0', ...args,
      '--config', 'wrangler.app-staging.jsonc'], {
      cwd: api, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false',
        ...(token ? { CLOUDFLARE_API_TOKEN: token } : {}) },
    }));
  } catch { throw new Error('staging_operations_cli_failed'); }
}
async function observe() {
  const args = process.argv.slice(2);
  const monitorTokenMode = args.includes('--monitor-token');
  assert.deepEqual(args, monitorTokenMode ? ['--read-only', '--monitor-token'] : ['--read-only']);
  const config = JSON.parse(await readFile(path.join(api, 'wrangler.app-staging.jsonc'), 'utf8'));
  assert.equal(config.name, worker);
  assert.equal(config.account_id, account);
  assert.equal(config.workers_dev, true);
  assert.ok(!config.routes || config.routes.length === 0);
  for (const [binding, id] of Object.entries(databases)) {
    assert.equal(config.d1_databases.find(row => row.binding === binding)?.database_id, id);
  }
  if (monitorTokenMode) {
    stage = 'monitor_token';
    token = process.env.FANMARK_STAGING_MONITOR_API_TOKEN;
    assert.ok(typeof token === 'string' && token.trim().length > 0);
  } else {
    stage = 'identity';
    const identity = cli(['whoami', '--json']);
    assert.equal(identity.email, 'fanmark.id@gmail.com');
    assert.ok(identity.accounts.some(row => row.id === account));
    stage = 'token';
    token = cli(['auth', 'token', '--json']).token;
    assert.equal(typeof token, 'string');
  }
  const monitorApi = createStagingMonitorApi({ token });
  if (monitorTokenMode) await monitorApi.verifyToken();
  stage = 'remote_bindings';
  const settings = await monitorApi.readWorkerSettings();
  assert.ok(Array.isArray(settings.bindings));
  for (const [binding, id] of Object.entries(databases)) {
    const remote = settings.bindings.find(row => row.name === binding);
    assert.equal(remote?.type, 'd1');
    assert.equal(remote.id, id);
  }
  stage = 'deployment';
  const deployments = await monitorApi.readWorkerDeployments();
  const latest = deployments.deployments?.[0];
  assert.ok(latest?.versions?.length === 1 && latest.versions[0].percentage === 100);
  const vars = Object.fromEntries(settings.bindings.filter(row => row.type === 'plain_text')
    .map(row => [row.name, row.text]));
  const selectors = Object.fromEntries([
    'CUTOVER_WRITE_FREEZE', 'LICENSE_EXPIRY_BACKEND', 'LICENSE_EXPIRY_CRON',
    'NOTIFICATION_PROCESSOR_BACKEND', 'NOTIFICATION_WAKE_BACKEND',
    'NOTIFICATION_ARCHIVE_BACKEND', 'NOTIFICATION_ARCHIVE_CRON',
    'STRIPE_DISPATCH_BACKEND', 'BROADCAST_SEND_BACKEND',
  ].map(name => [name, vars[name] ?? null]));
  for (const [name, value] of Object.entries(selectors)) {
    if (value === null) continue;
    const allowed = name.endsWith('_CRON') ? /^[0-9*/,-]+(?:\s+[0-9*/,-]+){4}$/u.test(value)
      : name === 'CUTOVER_WRITE_FREEZE' ? ['true', 'false'].includes(value)
        : name === 'NOTIFICATION_WAKE_BACKEND' ? value === 'durable-object' : value === 'd1';
    assert.ok(allowed, 'unexpected_staging_selector');
  }
  stage = 'schema_ledger';
  const ledger = monitorTokenMode ? await monitorApi.readBusinessLedger()
    : cli(['d1', 'execute', 'fanmark-business-staging', '--remote', '--json',
      '--command', 'SELECT name FROM d1_migrations ORDER BY id']);
  assert.equal(ledger[0]?.success, true);
  assert.deepEqual(ledger[0].results.map(row => row.name), [...BUSINESS_MIGRATION_SEQUENCE]);
  stage = 'aggregate_counts';
  const sql = (await readFile(path.join(repo, 'scripts/migration/staging-operations-status.sql'), 'utf8'))
    .replace(/^--[^\n]*$/gmu, '').trim();
  assert.ok(/^SELECT\s/iu.test(sql) && sql.endsWith(';') && !sql.slice(0, -1).includes(';'));
  const result = monitorTokenMode ? await monitorApi.readBusinessCounts()
    : cli(['d1', 'execute', 'fanmark-business-staging', '--remote', '--json', '--command', sql]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.success, true);
  assert.equal(result[0].results.length, 1);
  const counts = result[0].results[0];
  assert.ok(Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0));
  const attention = [];
  if (counts.foreign_key_violations > 0) attention.push('foreign_key_violations');
  if (counts.wake_singletons !== 1 || counts.wake_acknowledged > counts.wake_requested) attention.push('wake_state_invalid');
  if (counts.wake_requested > counts.wake_acknowledged) attention.push('wake_generation_gap');
  for (const field of ['notification_overdue', 'notification_stale_processing', 'notification_failed',
    'stripe_dead_letters', 'stripe_overdue', 'stripe_expired_leases']) {
    if (counts[field] > 0) attention.push(field);
  }
  const disabledJobs = ['LICENSE_EXPIRY_BACKEND', 'NOTIFICATION_ARCHIVE_BACKEND', 'STRIPE_DISPATCH_BACKEND',
    'BROADCAST_SEND_BACKEND'].filter(name => selectors[name] !== 'd1');
  stage = 'public_health';
  const publicHealth = {};
  for (const route of ['/', '/api/auth/ok']) {
    const response = await fetch(origin + route, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
    publicHealth[route] = response.status;
    await response.body?.cancel();
    if (response.status !== 200) attention.push(route === '/' ? 'app_unavailable' : 'auth_unavailable');
  }
  return { observedAt: new Date().toISOString(), scope: 'read-only staging aggregates; no repair/provider/data/domain action',
    account, worker, version: latest.versions[0].version_id, ledgerEntries: ledger[0].results.length,
    credentialSource: monitorTokenMode ? 'monitor_api_token' : 'wrangler_oauth',
    leastPrivilegeAccepted: false,
    selectors, counts, publicHealth, attention, disabledJobs,
    recurringOperationsAccepted: false, providerIntegrationAccepted: false };
}

try {
  const report = await observe();
  console.log(JSON.stringify(report, null, 2));
  if (report.attention.length > 0) process.exitCode = 2;
} catch {
  // CLI/API errors may contain SQL, credential context or private provider bodies.
  console.error(JSON.stringify({ status: 'failed', code: 'staging_operations_observation_failed', stage }));
  process.exitCode = 1;
} finally { token = undefined; }

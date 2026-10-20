#!/usr/bin/env node
/** Observe the existing staging Cron. No invocation, deployment or data mutation. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStagingMonitorApi } from './staging-monitor-api.mjs';

const worker = 'fanmark-app-staging';
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const cron = '0 0 * * *';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repo, 'workers/api');
const statuses = new Set(['completed', 'partial', 'skipped', 'failed', 'paused']);
const counters = new Set(['candidateCount', 'processed', 'conflicts', 'pagesProcessed',
  'graceFinalizationCandidates', 'graceFinalizationProcessed', 'graceFinalizationConflicts',
  'graceFinalizationPagesProcessed', 'archived', 'remaining', 'batches']);
let phase = 'arguments';

/** Only the two daily jobs' status and aggregate counters leave the tail stream. */
export function dailyInvocationProof(event, utcDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(utcDate) ||
      event?.event?.cron !== cron || (event.scriptName && event.scriptName !== worker)) return null;
  const millis = event.event.scheduledTime;
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return null;
  const scheduled = new Date(millis);
  if (!Number.isFinite(scheduled.getTime()) || scheduled.toISOString().slice(0, 16) !== `${utcDate}T00:00`) return null;
  const jobs = [];
  for (const log of Array.isArray(event.logs) ? event.logs : []) {
    for (const message of Array.isArray(log?.message) ? log.message : []) {
      if (typeof message !== 'string') continue;
      let value;
      try { value = JSON.parse(message); } catch { continue; }
      if (!value || !['license-expiry-lifecycle', 'notification-archive'].includes(value.job)) continue;
      const job = { job: value.job };
      for (const [name, entry] of Object.entries(value)) {
        if (counters.has(name) && Number.isSafeInteger(entry) && entry >= 0) job[name] = entry;
        if (['status', 'graceFinalizationStatus'].includes(name) && statuses.has(entry)) job[name] = entry;
      }
      jobs.push(job);
    }
  }
  const exceptionCount = Array.isArray(event.exceptions) ? event.exceptions.length : 0;
  const outcome = ['ok', 'exception', 'exceededCpu', 'exceededMemory', 'canceled'].includes(event.outcome)
    ? event.outcome : 'unknown';
  const lifecycle = jobs.filter(job => job.job === 'license-expiry-lifecycle');
  const archive = jobs.filter(job => job.job === 'notification-archive');
  const accepted = outcome === 'ok' && Array.isArray(event.exceptions) && exceptionCount === 0 && lifecycle.length === 1 && archive.length === 1 &&
    lifecycle[0].status === 'completed' && lifecycle[0].graceFinalizationStatus === 'completed' &&
    lifecycle[0].conflicts === 0 && lifecycle[0].graceFinalizationConflicts === 0 &&
    archive[0].status === 'completed' && archive[0].remaining === 0 && archive[0].conflicts === 0;
  return { scheduledTime: scheduled.toISOString(), outcome, exceptionCount, jobs, naturalDailyAccepted: accepted };
}

/** Stream JSON objects without assuming that a process chunk is a complete event. */
export function tailJsonObjects(onObject) {
  let depth = 0, inside = false, escaped = false, buffer = '';
  return chunk => {
    for (const character of chunk.toString()) {
      if (depth === 0) {
        if (character !== '{') continue;
        buffer = '{'; depth = 1; inside = false; escaped = false; continue;
      }
      buffer += character;
      if (inside) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inside = false;
      } else if (character === '"') inside = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        let object;
        try { object = JSON.parse(buffer); } catch { /* Ignore non-JSON CLI diagnostics. */ }
        buffer = '';
        if (object) onObject(object);
      }
      if (buffer.length > 2_000_000) throw new Error('daily_tail_event_too_large');
    }
  };
}

async function observe() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  assert.equal(args.length, 6);
  assert.equal(args[0], '--utc-date'); assert.equal(args[2], '--version'); assert.equal(args[4], '--output');
  const [utcDate, version, output] = [args[1], args[3], path.resolve(args[5])];
  assert.match(utcDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.match(version, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu);
  const expectedTime = Date.parse(`${utcDate}T00:00:00Z`);
  assert.equal(new Date(expectedTime).toISOString().slice(0, 10), utcDate);
  const deadline = expectedTime + 4 * 60_000;
  assert.ok(expectedTime - Date.now() <= 24 * 60 * 60_000 && deadline > Date.now(), 'daily_observation_window_invalid');
  assert.ok(!output.startsWith(`${repo}${path.sep}`), 'daily_output_must_be_private');
  const config = JSON.parse(await readFile(path.join(apiRoot, 'wrangler.app-staging.jsonc'), 'utf8'));
  assert.equal(config.name, worker); assert.equal(config.account_id, account);
  const cli = args => JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4.139.0', ...args,
    '--config', 'wrangler.app-staging.jsonc'], {
    cwd: apiRoot, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  }));
  phase = 'wrangler_identity';
  const identity = cli(['whoami', '--json']);
  assert.equal(identity.email, 'fanmark.id@gmail.com'); assert.ok(identity.accounts.some(row => row.id === account));
  phase = 'wrangler_tail_credential';
  let tailToken = cli(['auth', 'token', '--json']).token;
  phase = 'monitor_keychain';
  let monitorToken = execFileSync('/usr/bin/security', ['find-generic-password', '-a', 'fanmark.id@gmail.com',
    '-s', 'fanmark-app-staging-monitor', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const monitor = createStagingMonitorApi({ token: monitorToken }); monitorToken = undefined;
  phase = 'monitor_readback';
  await monitor.verifyToken();
  const verifyDeployment = async () => assert.deepEqual((await monitor.readWorkerDeployments()).deployments[0].versions,
    [{ version_id: version, percentage: 100 }]);
  await verifyDeployment();
  const settings = await monitor.readWorkerSettings();
  for (const name of ['LICENSE_EXPIRY_BACKEND', 'NOTIFICATION_ARCHIVE_BACKEND']) {
    assert.equal(settings.bindings.find(row => row.name === name)?.text, 'd1');
  }
  for (const name of ['LICENSE_EXPIRY_CRON', 'NOTIFICATION_ARCHIVE_CRON']) {
    assert.equal(settings.bindings.find(row => row.name === name)?.text, cron);
  }
  const report = { startedAt: new Date().toISOString(), worker, workerVersion: version, expectedUtcDate: utcDate,
    expectedCron: cron, manualInvocation: false, runtimeRedeployed: false, tailConnected: false,
    invocationProofAccepted: false, completionVersionVerified: false, naturalDailyAccepted: false, events: [] };
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await save();
  phase = 'tail';
  const child = spawn('npx', ['--yes', 'wrangler@4.139.0', 'tail', worker, '--config',
    'wrangler.app-staging.jsonc', '--format', 'json'], {
    cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', CLOUDFLARE_API_TOKEN: tailToken, WRANGLER_SEND_METRICS: 'false' },
  }); tailToken = undefined;
  let pending = Promise.resolve(), streamFailed = false;
  const consume = tailJsonObjects(event => {
    if (event?.event && typeof event.outcome === 'string' &&
        (!event.scriptName || event.scriptName === worker)) report.tailConnected = true;
    const proof = dailyInvocationProof(event, utcDate);
    pending = pending.then(async () => {
      if (proof) {
        report.events.push({ ...proof, observedAt: new Date().toISOString() });
        report.invocationProofAccepted ||= proof.naturalDailyAccepted;
        console.log(JSON.stringify({ event: 'daily_received', ...proof }));
      }
      await save();
      if (report.invocationProofAccepted) child.kill('SIGTERM');
    }).catch(() => { streamFailed = true; child.kill('SIGTERM'); });
  });
  child.stdout.on('data', data => { try { consume(data); } catch { streamFailed = true; child.kill('SIGTERM'); } });
  child.stderr.on('data', () => { /* Provider/CLI diagnostics can contain sensitive context. */ });
  const timer = setTimeout(() => { report.deadlineReached = true; child.kill('SIGTERM'); }, deadline - Date.now());
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log(JSON.stringify({ event: 'daily_tail_started', worker, workerVersion: version, expectedUtcDate: utcDate }));
  try {
    await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    await pending;
    try { await verifyDeployment(); report.completionVersionVerified = true; }
    catch { report.failedPhase = 'completion_version'; await save(); throw new Error('daily_completion_version_changed'); }
    report.finishedAt = new Date().toISOString();
    report.streamFailed = streamFailed;
    report.naturalDailyAccepted = report.invocationProofAccepted && !streamFailed;
    await save();
    console.log(JSON.stringify({ event: 'daily_observation_finished', accepted: report.naturalDailyAccepted,
      connected: report.tailConnected, events: report.events.length }));
    if (!report.naturalDailyAccepted) process.exitCode = 2;
  } finally { clearTimeout(timer); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  observe().catch(() => { console.error(JSON.stringify({ code: 'staging_daily_observation_failed', phase })); process.exitCode = 1; });
}

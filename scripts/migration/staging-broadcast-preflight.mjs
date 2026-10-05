#!/usr/bin/env node
/** Read only the identified staging configuration and template/queue aggregates. Never send or activate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStagingMonitorApi } from './staging-monitor-api.mjs';
import {
  STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL,
  readStagingEmailTemplateMasterBaseline,
} from './staging-email-template-master-baseline.mjs';

process.umask(0o077);
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../workers/api');
const args = process.argv.slice(2);
const expectedVersion = args[1]?.replace(/^--expected-version=/u, '');
const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const databases = {
  FANMARK_DB: 'd4bb0c48-f24a-491f-8693-fa393ab0b873',
  AUTH_DB: '2116bc43-32ab-4e3e-b762-9378df88b95f',
  MASTER_DB: '160376b0-bde6-4d5f-8969-96deb5ae1183',
};
let token;

function cli(commandArgs) {
  return JSON.parse(execFileSync('npx', [
    '--yes', 'wrangler@4.139.0', ...commandArgs, '--config', 'wrangler.app-staging.jsonc',
  ], {
    cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  }));
}

async function readRows(sql) {
  assert.match(sql, /^SELECT\s/iu);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databases.FANMARK_DB}/query`, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params: [] }), signal: AbortSignal.timeout(30000),
    },
  );
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.success, true);
  assert.equal(envelope.result.length, 1);
  const result = envelope.result[0];
  assert.equal(result.success, true);
  assert.equal(result.meta.rows_written, 0);
  assert.equal(result.meta.changed_db, false);
  assert.ok(Array.isArray(result.results));
  return result.results;
}

try {
  assert.equal(args.length, 2);
  assert.equal(args[0], '--read-only');
  assert.match(args[1], /^--expected-version=[0-9a-f-]{36}$/u);
  assert.match(expectedVersion, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  const identity = cli(['whoami', '--json']);
  assert.equal(identity.email, 'fanmark.id@gmail.com');
  assert.ok(identity.accounts.some(row => row.id === account));
  token = cli(['auth', 'token', '--json']).token;
  const api = createStagingMonitorApi({ token });
  async function assertDeployment() {
    const latest = (await api.readWorkerDeployments()).deployments[0];
    assert.deepEqual(latest.versions, [{ version_id: expectedVersion, percentage: 100 }]);
  }
  await assertDeployment();
  const settings = await api.readWorkerSettings();
  assert.ok(Array.isArray(settings.bindings));
  const binding = name => settings.bindings.find(row => row.name === name);
  for (const [name, id] of Object.entries(databases)) {
    assert.equal(binding(name)?.type, 'd1');
    assert.equal(binding(name)?.id, id);
  }
  const expectedSelectors = {
    AUTH_EMAIL_BACKEND: 'resend',
    AUTH_EMAIL_TEMPLATE_BACKEND: 'd1',
    BROADCAST_EMAIL_BACKEND: 'd1',
    BROADCAST_SEND_BACKEND: null,
    BROADCAST_TEST_SEND_BACKEND: null,
    NOTIFICATION_PROCESSOR_BACKEND: 'd1',
    NOTIFICATION_WAKE_BACKEND: 'durable-object',
    NOTIFICATION_ARCHIVE_BACKEND: 'd1',
  };
  const selectors = Object.fromEntries(Object.keys(expectedSelectors)
    .map(name => [name, binding(name)?.text ?? null]));
  // Never export an unexpected plain-text value under a known selector name.
  assert.deepEqual(selectors, expectedSelectors);
  const templateRows = await readRows(STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL);
  const templateState = readStagingEmailTemplateMasterBaseline(() => templateRows);
  assert.equal(templateState, 'seeded');
  const countRows = await readRows(`SELECT
    (SELECT count(*) FROM broadcast_emails) AS drafts,
    (SELECT count(*) FROM broadcast_delivery_runs) AS runs,
    (SELECT count(*) FROM broadcast_delivery_recipients) AS recipients,
    (SELECT count(*) FROM broadcast_delivery_suppressions) AS suppressions,
    (SELECT count(*) FROM broadcast_delivery_webhook_events) AS webhook_events,
    (SELECT count(*) FROM audit_logs WHERE action='BROADCAST_EMAIL_TEST_SENT') AS test_send_audits,
    (SELECT count(*) FROM notifications
      WHERE channel IN ('email','webpush') AND status='pending') AS other_channel_pending`);
  assert.equal(countRows.length, 1);
  const counts = countRows[0];
  assert.ok(Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0));
  await assertDeployment();
  const sender = binding('RESEND_FROM_EMAIL')?.text;
  const report = {
    observedAt: new Date().toISOString(),
    scope: 'read-only staging broadcast configuration and master/queue aggregates',
    workerVersion: expectedVersion,
    credentialSource: 'identified_app_config_wrangler_oauth',
    leastPrivilegeAccepted: false,
    selectors,
    configuration: {
      resendKeyPresent: binding('RESEND_API_KEY')?.type === 'secret_text',
      senderPresent: typeof sender === 'string' && sender.length > 0 &&
        sender.length <= 320 && sender.includes('@') && !/[\r\n]/u.test(sender),
      fixedTestRecipientPresent: Boolean(binding('BROADCAST_TEST_RECIPIENT')),
      broadcastSigningSecretPresent: binding('BROADCAST_WEBHOOK_SIGNING_SECRET')?.type === 'secret_text',
    },
    masters: {
      authTemplates: templateRows[0].auth_count,
      broadcastTemplates: templateRows[0].broadcast_count,
      totalTemplates: templateRows[0].total_count,
      contentBaseline: templateState,
    },
    counts, readOnlyReceiptAccepted: true, providerCallsMade: 0, writesMade: 0,
    testSendAccepted: false, bulkSendAccepted: false, fullMigrationAccepted: false,
  };
  console.log(JSON.stringify(report));
} catch {
  // Provider/CLI errors may contain private response bodies or credential context.
  console.error(JSON.stringify({ status: 'failed', code: 'broadcast_readonly_preflight_failed' }));
  process.exitCode = 1;
} finally {
  token = undefined;
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUSINESS_MIGRATION_SEQUENCE } from './business-migration-ledger.mjs';
import { createStagingMonitorApi } from './staging-monitor-api.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = path.join(root, 'scripts/migration/staging-operations-status.mjs');
const credential = 'Synthetic-Monitor-Token-Not-A-Real-Credential';
const envelope = result => new Response(JSON.stringify({ success: true, result }));

test('D1 write receipts are rejected even when the provider reports success', async () => {
  for (const meta of [{ rows_written: 1, changed_db: true }, { rows_written: 0, changed_db: true }, {}]) {
    const api = createStagingMonitorApi({ token: credential, fetchImpl: async () => envelope([
      { success: true, meta, results: [] },
    ]) });
    await assert.rejects(api.readBusinessLedger(), { message: 'staging_monitor_read_receipt_invalid' });
  }
});

test('inactive credentials and private provider failures never enter the public report', async () => {
  const inactive = createStagingMonitorApi({ token: credential,
    fetchImpl: async () => envelope({ status: 'expired', id: 'private-token-id' }) });
  await assert.rejects(inactive.verifyToken(), { message: 'staging_monitor_token_inactive' });
  const denied = createStagingMonitorApi({ token: credential,
    fetchImpl: async () => new Response(JSON.stringify({ error: credential }), { status: 403 }) });
  await assert.rejects(denied.readWorkerSettings(), { message: 'staging_monitor_api_failed' });
});

async function runMonitor({ suppliedToken = true, badBinding = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fanmark-monitor-test-'));
  try {
    const trap = path.join(directory, 'npx-called');
    await writeFile(path.join(directory, 'npx'), '#!/bin/sh\nprintf called > "$FANMARK_MONITOR_NPX_TRAP"\nexit 99\n');
    await chmod(path.join(directory, 'npx'), 0o700);
    const config = JSON.parse(await readFile(path.join(root, 'workers/api/wrangler.app-staging.jsonc'), 'utf8'));
    const priorHealth = JSON.parse(await readFile(path.join(root,
      'docs/migration/evidence/staging-operations-observation-2026-10-04.json'), 'utf8'));
    const bindings = config.d1_databases.map(row => ({ name: row.binding, type: 'd1', id: row.database_id }));
    if (badBinding) bindings[0].id = '00000000-0000-0000-0000-000000000000';
    bindings.push(...Object.entries(config.vars).map(([name, text]) => ({ name, type: 'plain_text', text })));
    const fixture = { credential, bindings, ledger: BUSINESS_MIGRATION_SEQUENCE.map(name => ({ name })),
      counts: priorHealth.counts, requestsFile: path.join(directory, 'requests.json') };
    const preload = path.join(directory, 'mock-cloudflare.mjs');
    // Exercise the actual command without network access or usable credentials.
    await writeFile(preload, `
      import assert from 'node:assert/strict';
      import {writeFile} from 'node:fs/promises';
      const fixture=${JSON.stringify(fixture)};
      const requests=[];
      globalThis.fetch=async(url,init={})=>{
        const target=new URL(url);
        requests.push({path:target.pathname,method:init.method??'GET'});
        await writeFile(fixture.requestsFile,JSON.stringify(requests));
        if(target.hostname==='fanmark-app-staging.fanmark-id.workers.dev'){
          assert.equal(init.headers?.authorization,undefined);
          return new Response('healthy',{status:200});
        }
        assert.equal(target.hostname,'api.cloudflare.com');
        assert.equal(init.headers.authorization,'Bearer '+fixture.credential);
        let result;
        if(target.pathname.endsWith('/user/tokens/verify'))result={status:'active',id:'private-id'};
        else if(target.pathname.endsWith('/settings'))result={bindings:fixture.bindings};
        else if(target.pathname.endsWith('/deployments'))result={deployments:[{versions:[{version_id:'synthetic-worker-version',percentage:100}]}]};
        else if(target.pathname.endsWith('/query')){
          assert.equal(init.method,'POST');
          const {sql,params}=JSON.parse(init.body);
          assert.match(sql,/^SELECT\\s/i);assert.deepEqual(params,[]);
          assert.doesNotMatch(sql,/\\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\\b/i);
          result=[{success:true,meta:{rows_written:0,changed_db:false},results:sql.includes('d1_migrations')?fixture.ledger:[fixture.counts]}];
        }else throw new Error('unexpected_resource');
        return new Response(JSON.stringify({success:true,result}));
      };
    `);
    const output = spawnSync(process.execPath, ['--import', preload, runner, '--read-only', '--monitor-token'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: directory, FANMARK_MONITOR_NPX_TRAP: trap,
        CLOUDFLARE_API_TOKEN: 'Broad-Credential-Must-Not-Be-Used',
        FANMARK_STAGING_MONITOR_API_TOKEN: suppliedToken ? credential : '' },
    });
    assert.equal(output.error, undefined);
    assert.ok(!output.stdout.includes(credential) && !output.stderr.includes(credential));
    const cliCalled = await access(trap).then(() => true, () => false);
    const requests = await readFile(fixture.requestsFile, 'utf8').then(JSON.parse, () => []);
    return { ...output, cliCalled, requests };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('missing dedicated credentials cannot fall back to Wrangler or a generic write token', async () => {
  const result = await runMonitor({ suppliedToken: false });
  assert.equal(result.status, 1);
  assert.equal(result.cliCalled, false);
  assert.deepEqual(result.requests, []);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'failed', code: 'staging_operations_observation_failed', stage: 'monitor_token',
  });
});

test('wrong remote binding stops the actual monitor command before it queries D1', async () => {
  const result = await runMonitor({ badBinding: true });
  assert.equal(result.status, 1);
  assert.equal(result.cliCalled, false);
  assert.equal(JSON.parse(result.stderr).stage, 'remote_bindings');
  assert.equal(result.requests.filter(row => row.path.endsWith('/query')).length, 0);
});

test('the actual monitor command reads a fixed deployment and aggregate health without deployment credentials', async () => {
  const result = await runMonitor();
  assert.equal(result.status, 0);
  assert.equal(result.cliCalled, false);
  const report = JSON.parse(result.stdout);
  assert.equal(report.credentialSource, 'monitor_api_token');
  assert.equal(report.leastPrivilegeAccepted, false);
  assert.equal(report.version, 'synthetic-worker-version');
  assert.equal(report.ledgerEntries, BUSINESS_MIGRATION_SEQUENCE.length);
  assert.deepEqual(report.attention, []);
  assert.equal(result.requests.filter(row => row.path.endsWith('/query')).length, 2);
});

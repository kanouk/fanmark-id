import assert from 'node:assert/strict';
import test from 'node:test';
import {createApplicationRecoveryCloudflareApi} from './application-recovery-cloudflare-api.mjs';

const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const reply = (status, result) => new Response(JSON.stringify({success: status === 200, result}), {status});

test('a committed creation followed by read401 refreshes only the read credential', async () => {
  let token = 'old', refreshes = 0;
  const calls = [];
  const api = createApplicationRecoveryCloudflareApi({account, getToken: () => token,
    refreshToken: () => {refreshes++; token = 'fresh';},
    fetchImplementation: async (url, options) => {
      calls.push({url, method: options.method, authorization: options.headers.authorization});
      if (options.method === 'POST') return reply(200, {name: 'owned'});
      return options.headers.authorization === 'Bearer old' ? reply(401) : reply(200, {name: 'owned'});
    }});
  await api('r2/buckets', 'POST', {name: 'owned'});
  assert.deepEqual(await api('r2/buckets/owned'), {name: 'owned'});
  assert.equal(refreshes, 1);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET']);
  assert.deepEqual(calls.map(call => call.authorization), ['Bearer old', 'Bearer old', 'Bearer fresh']);
  assert.ok(calls.every(call => call.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/`)));
});

test('POST and DELETE401 are never refreshed or repeated', async () => {
  for (const method of ['POST', 'DELETE']) {
    let calls = 0, refreshes = 0;
    const api = createApplicationRecoveryCloudflareApi({account, getToken: () => 'old',
      refreshToken: () => {refreshes++;}, fetchImplementation: async () => {calls++; return reply(401);}});
    await assert.rejects(api('r2/buckets/owned', method), /proof_resource_api_401/u);
    assert.equal(calls, 1); assert.equal(refreshes, 0);
  }
});

test('unknown mutation ACK is retained without refresh or replay', async () => {
  let calls = 0, refreshes = 0;
  const api = createApplicationRecoveryCloudflareApi({account, getToken: () => 'old',
    refreshToken: () => {refreshes++;}, fetchImplementation: async () => {calls++; throw new Error('transport-private-detail');}});
  await assert.rejects(api('r2/buckets', 'POST', {name: 'owned'}), /^Error: proof_resource_ack_unknown$/u);
  assert.equal(calls, 1); assert.equal(refreshes, 0);
});

test('a read retries once at most and does not refresh other failures', async () => {
  for (const status of [401, 403]) {
    let calls = 0, refreshes = 0;
    const api = createApplicationRecoveryCloudflareApi({account, getToken: () => 'old',
      refreshToken: () => {refreshes++;}, fetchImplementation: async () => {calls++; return reply(status);}});
    await assert.rejects(api('r2/buckets'), new RegExp('proof_resource_api_' + status, 'u'));
    assert.equal(calls, status === 401 ? 2 : 1); assert.equal(refreshes, status === 401 ? 1 : 0);
  }
});

test('failed identity refresh rejects without exposing credential context', async () => {
  let calls = 0;
  const api = createApplicationRecoveryCloudflareApi({account, getToken: () => 'old',
    refreshToken: () => {throw new Error('private-profile');}, fetchImplementation: async () => {calls++; return reply(401);}});
  await assert.rejects(api('r2/buckets'), /^Error: proof_credential_refresh_failed$/u);
  assert.equal(calls, 1);
});

test('confirmed absence and no-content deletion preserve cleanup receipts', async () => {
  let refreshes = 0;
  const api = createApplicationRecoveryCloudflareApi({account, getToken: () => 'fresh',
    refreshToken: () => {refreshes++;}, fetchImplementation: async (_, options) => options.method === 'DELETE'
      ? new Response(null, {status: 204}) : reply(404)});
  assert.equal(await api('r2/buckets/owned', 'GET', undefined, true), null);
  assert.equal(await api('r2/buckets/owned', 'DELETE'), null);
  assert.equal(refreshes, 0);
});

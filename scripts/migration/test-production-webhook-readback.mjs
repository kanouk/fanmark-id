import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readProductionWebhookRegistration} from './production-webhook-readback.mjs';

test('Stripe reader uses the live account first and sends only fixed-origin GETs', async () => {
  const calls = [];
  const result = await readProductionWebhookRegistration({provider: 'stripe', endpointId: 'we_expected', apiKey: 'sk_live_fixture',
    fetchImpl: async (url, options) => {
      calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer sk_live_fixture');
      return Response.json(url.endsWith('/account') ? {id: 'acct_1SFjhvJk0VCfiKUp'} : {id: 'we_expected'});
    }});
  assert.deepEqual(calls, ['https://api.stripe.com/v1/account', 'https://api.stripe.com/v1/webhook_endpoints/we_expected']);
  assert.equal(result.endpoint.id, 'we_expected');
});

test('wrong Stripe account stops before reading an endpoint; test keys and path injection make no request', async () => {
  let calls = 0;
  const options = {provider: 'stripe', endpointId: 'we_expected', apiKey: 'sk_live_fixture',
    fetchImpl: async () => {calls++; return Response.json({id: 'acct_other'});}};
  await assert.rejects(readProductionWebhookRegistration(options), /account_mismatch/); assert.equal(calls, 1);
  for (const change of [{apiKey: 'sk_test_fixture'}, {endpointId: 'we_id?token=private'}, {endpointId: '../account'}]) {
    await assert.rejects(readProductionWebhookRegistration({...options, ...change}), /identity_invalid/);
  }
  assert.equal(calls, 1);
});

test('Resend checks every domain page before returning the exact endpoint for custody verification', async () => {
  const firstId = randomUUID(), secondId = randomUUID(), endpointId = randomUUID(), calls = [];
  const result = await readProductionWebhookRegistration({provider: 'resend', endpointId, apiKey: 're_fixture',
    fetchImpl: async (url, options) => {
      calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.equal(new URL(url).origin, 'https://api.resend.com');
      if (url.includes('/webhooks/')) return Response.json({id: endpointId, signing_secret: 'whsec_private'});
      if (new URL(url).searchParams.get('after') === firstId) return Response.json({has_more: false,
        data: [{id: secondId, name: 'fanmark.id', status: 'verified'}]});
      return Response.json({has_more: true, data: [{id: firstId, name: 'other.example', status: 'verified'}]});
    }});
  assert.equal(calls.length, 3); assert.equal(result.senderDomain.name, 'fanmark.id');
  assert.equal(result.endpoint.id, endpointId);
});

test('incomplete, repeated or unverified domain inventories cannot produce a usable readback', async () => {
  for (const make of [
    id => ({data: [{id, name: 'fanmark.id', status: 'verified'}]}),
    id => ({has_more: true, data: [{id, name: 'fanmark.id', status: 'verified'}]}),
    id => ({has_more: false, data: [{id, name: 'fanmark.id', status: 'pending'}]}),
    () => ({has_more: true, data: []}),
  ]) {
    const id = randomUUID(); let endpointRequests = 0;
    await assert.rejects(readProductionWebhookRegistration({provider: 'resend', endpointId: randomUUID(), apiKey: 're_fixture',
      fetchImpl: async url => {if (url.includes('/webhooks/')) endpointRequests++; return Response.json(make(id));}}), /domain/);
    assert.equal(endpointRequests, 0);
  }
});

test('network errors, HTTP errors and oversized/invalid bodies reveal no provider key or raw response', async () => {
  const privateValue = 'sk_live_sensitivefixture';
  for (const fetchImpl of [
    async () => {throw Error(privateValue);},
    async () => new Response(privateValue, {status: 403}),
    async () => new Response(privateValue),
    async () => new Response('x'.repeat(128 * 1024 + 1) + privateValue),
  ]) await assert.rejects(readProductionWebhookRegistration({provider: 'stripe', endpointId: 'we_expected', apiKey: privateValue, fetchImpl}),
    e => e.message.startsWith('production_webhook_readback_') && !e.message.includes(privateValue));
});

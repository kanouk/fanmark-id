import assert from 'node:assert/strict';
import test from 'node:test';
import {collectSourceStripeInventory as collect} from './source-stripe-inventory.mjs';

const account = 'acct_1SFjhvJk0VCfiKUp';
const list = (data = [], has_more = false) => ({object: 'list', data, has_more});
const session = (id, overrides = {}) => ({id, object: 'checkout.session', livemode: true,
  created: 1, expires_at: 2, status: 'complete', payment_status: 'paid', mode: 'payment',
  payment_intent: 'pi_fixture', subscription: null, metadata: {type: 'license_extension', license_id: 'fixture'}, ...overrides});
function fixture(respond = () => list()) {
  const calls = [];
  return {calls, options: {secret: 'sk_live_fixture', mode: 'live', fetchImpl: async (url, options) => {
    calls.push({url: new URL(url), options});
    const body = new URL(url).pathname === '/v1/account' ? {object: 'account', id: account} : await respond(new URL(url));
    return {ok: true, json: async () => body};
  }}};
}
test('collects every page using GET and all subscription statuses without exposing private response fields', async () => {
  const f = fixture(url => url.pathname === '/v1/checkout/sessions'
    ? url.searchParams.has('starting_after') ? list([session('cs_second')])
      : list([session('cs_first', {customer_email: 'private@example.invalid', client_secret: 'secret',
        metadata: {type: 'license_extension', email: 'private@example.invalid'}})], true)
    : list());
  const result = await collect(f.options);
  assert.deepEqual(result.inventory.checkoutSessions.rows.map(r => r.id), ['cs_first', 'cs_second']);
  assert.equal(result.inventory.checkoutSessions.pages, 2);
  assert.equal(result.counts.paidCheckoutsNeedingSourceCorrelation, 2); // Old age is not fulfillment proof.
  assert.equal(result.productionReady, false);
  assert.equal(result.sourceEffectsReconciled, false);
  assert.equal(result.atomicSnapshot, false);
  assert.equal(result.eventDestinationsInventoried, false);
  for (const call of f.calls) {
    assert.equal(call.url.origin, 'https://api.stripe.com');
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.body, undefined);
  }
  assert.equal(f.calls.find(c => c.url.pathname === '/v1/subscriptions').url.searchParams.get('status'), 'all');
  assert.equal(f.calls[2].url.searchParams.get('starting_after'), 'cs_first');
  assert.doesNotMatch(JSON.stringify(result), /private@example|sk_live_fixture|client_secret/);
});
test('identifies completed but unpaid Checkout, in-flight payment, and independent new payment links', async () => {
  const f = fixture(url => ({
    '/v1/checkout/sessions': list([session('cs_open', {status: 'open', payment_status: 'unpaid'}),
      session('cs_delayed', {payment_status: 'unpaid'}), session('cs_expired', {status: 'expired', payment_status: 'unpaid'})]),
    '/v1/payment_intents': list([{id: 'pi_fixture', object: 'payment_intent', livemode: true, created: 1, status: 'processing'}]),
    '/v1/payment_links': list([{id: 'plink_fixture', object: 'payment_link', livemode: true, active: true}]),
    '/v1/events': list([{id: 'evt_fixture', object: 'event', livemode: true, created: 1,
      type: 'payment_intent.processing', pending_webhooks: 2, data: {object: {id: 'pi_fixture', client_secret: 'hidden'}}}]),
  }[url.pathname] ?? list()));
  const result = await collect(f.options);
  assert.deepEqual(result.counts, {openCheckouts: 1, completedUnpaidCheckouts: 1, paidCheckoutsNeedingSourceCorrelation: 0,
    nonterminalSubscriptions: 0, nonterminalInvoices: 0, nonterminalPaymentIntents: 1, activePaymentLinks: 1, pendingWebhookDeliveries: 2});
  assert.doesNotMatch(JSON.stringify(result), /hidden/);
});
test('never turns missing pages, a repeated cursor, or a pagination cap into complete evidence', async () => {
  for (const [response, message, maxPages] of [
    [list([], true), /page_invalid/, 20], [list([session('cs_same')], true), /duplicate_row/, 20],
    [list([session('cs_same')], true), /page_limit/, 1], [{data: [], has_more: false}, /page_invalid/, 20],
  ]) {
    const f = fixture(() => response);
    await assert.rejects(collect({...f.options, maxPages}), message);
  }
});
test('rejects wrong mode, account, mixed data, and unknown statuses', async () => {
  const f = fixture();
  await assert.rejects(collect({...f.options, mode: 'test'}), /credential_mode/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(collect({...f.options, fetchImpl: async () => ({ok: true, json: async () => ({object: 'account', id: 'acct_other'})})}), /account_mismatch/);
  for (const bad of [{livemode: false}, {status: 'future_state'}, {payment_intent: undefined}]) {
    const g = fixture(() => list([session('cs_bad', bad)]));
    await assert.rejects(collect(g.options), /identity_invalid|status_unknown|reference_invalid/);
  }
});
test('collects sandbox only with its exact account and rejects live rows under that credential', async () => {
  for (const rowMode of [false, true]) {
    const options = {secret: 'rk_test_fixture', mode: 'test', fetchImpl: async url => ({ok: true, json: async () =>
      new URL(url).pathname === '/v1/account' ? {object: 'account', id: 'acct_1SFjnMJ9Sc4J9g7E'}
        : new URL(url).pathname === '/v1/checkout/sessions' ? list([session('cs_test_fixture', {livemode: rowMode})]) : list()})};
    if (rowMode) await assert.rejects(collect(options), /row_identity/);
    else assert.equal((await collect(options)).inventory.checkoutSessions.rows[0].livemode, false);
  }
});
test('sanitizes provider, JSON, and transport failures instead of returning partial success or echoing secrets', async () => {
  for (const impl of [
    async () => { throw new Error('sk_live_private'); },
    async () => ({ok: false, json: () => { throw Error('must not read private body'); }}),
    async () => ({ok: true, json: () => { throw Error('private response'); }}),
  ]) await assert.rejects(collect({secret: 'sk_live_fixture', mode: 'live', fetchImpl: impl}), error => {
    assert.match(error.message, /^stripe_inventory_(transport_failed|http_failed|json_invalid)$/u);
    return true;
  });
});
test('keeps canceled subscription history and paid invoices while flagging unresolved billing states', async () => {
  const f = fixture(url => url.pathname === '/v1/subscriptions' ? list(['canceled', 'active'].map((s, i) => ({
    id: `sub_fixture${i}`, object: 'subscription', created: 1, livemode: true, customer: 'cus_fixture', status: s,
  }))) : url.pathname === '/v1/invoices' ? list(['paid', 'open'].map((s, i) => ({
    id: `in_fixture${i}`, object: 'invoice', created: 1, livemode: true, customer: 'cus_fixture', status: s,
  }))) : list());
  const result = await collect(f.options);
  assert.equal(result.inventory.subscriptions.rows.length, 2);
  assert.equal(result.inventory.invoices.rows.length, 2);
  assert.equal(result.counts.nonterminalSubscriptions, 1); assert.equal(result.counts.nonterminalInvoices, 1);
});

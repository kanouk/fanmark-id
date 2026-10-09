import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStripePlanChangeUrl,
  changeStripePlanThroughWorker,
  clearStripePlanChangeRequestId,
  getStripePlanChangeBackend,
  getStripePlanChangeRequestId,
  StripePlanChangeApiError,
} from './stripe-plan-change-api.ts';

const requestId = '00000000-0000-4000-8000-000000000002';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

test('plan-change selector defaults to Supabase and validates explicit Worker mode', () => {
  assert.equal(getStripePlanChangeBackend(undefined), 'supabase');
  assert.equal(getStripePlanChangeBackend(' worker '), 'worker');
  assert.throws(() => getStripePlanChangeBackend('other'), StripePlanChangeApiError);
  assert.equal(buildStripePlanChangeUrl('https://app.example/').href, 'https://app.example/api/billing/plan-change');
});

test('plan-change request IDs are stable per destination and can be cleared after reconciliation', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const generated = getStripePlanChangeRequestId('business', storage);
  assert.match(generated, /^[0-9a-f-]{36}$/u);
  assert.equal(getStripePlanChangeRequestId('business', storage), generated);
  assert.notEqual(getStripePlanChangeRequestId('free', storage), generated);
  clearStripePlanChangeRequestId('business', storage);
  assert.equal(values.has('fanmark.plan-change.request.business'), false);
  assert.match(getStripePlanChangeRequestId('business', storage), /^[0-9a-f-]{36}$/u);
});

test('plan change sends same-origin credentials and accepts the bounded pending contract', async () => {
  let calledUrl = '';
  let init: RequestInit | undefined;
  const result = await changeStripePlanThroughWorker(
    { planType: 'max', requestId: requestId.toUpperCase() },
    {
      baseUrl: 'https://app.example',
      authBaseUrl: 'https://app.example',
      fetchImpl: async (input, options) => {
        calledUrl = input.toString();
        init = options;
        return jsonResponse({ success: true, updated: true, pending: true });
      },
    },
  );
  assert.deepEqual(result, { updated: true, pending: true, requiresAction: false });
  assert.equal(calledUrl, 'https://app.example/api/billing/plan-change');
  assert.equal(init?.method, 'POST');
  assert.equal(init?.credentials, 'include');
  assert.equal(init?.cache, 'no-store');
  assert.deepEqual(JSON.parse(String(init?.body)), { new_plan_type: 'max', request_id: requestId });
});

test('plan change reports payment action and rejects changed API origins', async () => {
  let calls = 0;
  const action = await changeStripePlanThroughWorker(
    { planType: 'free', requestId },
    {
      baseUrl: 'https://app.example',
      authBaseUrl: 'https://app.example',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ success: true, updated: false, pending: true, requires_action: true });
      },
    },
  );
  assert.deepEqual(action, { updated: false, pending: true, requiresAction: true });
  await assert.rejects(
    () => changeStripePlanThroughWorker({ planType: 'creator', requestId }, {
      baseUrl: 'https://api.other.example',
      authBaseUrl: 'https://app.example',
      fetchImpl: async () => { calls += 1; return jsonResponse({ success: true, updated: true, pending: true }); },
    }),
    (error: unknown) => error instanceof StripePlanChangeApiError && error.kind === 'configuration',
  );
  assert.equal(calls, 1);
});

test('plan change errors and malformed responses stay bounded', async () => {
  await assert.rejects(
    () => changeStripePlanThroughWorker({ planType: 'business', requestId }, {
      baseUrl: 'https://app.example', authBaseUrl: 'https://app.example',
      fetchImpl: async () => jsonResponse({ error: 'plan_limit_exceeded' }, 409),
    }),
    (error: unknown) => error instanceof StripePlanChangeApiError &&
      error.kind === 'http' && error.status === 409 && error.code === 'plan_limit_exceeded',
  );
  await assert.rejects(
    () => changeStripePlanThroughWorker({ planType: 'business', requestId }, {
      baseUrl: 'https://app.example', authBaseUrl: 'https://app.example',
      fetchImpl: async () => jsonResponse({ success: true, updated: true, pending: false }),
    }),
    (error: unknown) => error instanceof StripePlanChangeApiError && error.kind === 'invalid_response',
  );
});

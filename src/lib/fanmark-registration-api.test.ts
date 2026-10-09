import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFanmarkRegistrationApiUrl,
  getFanmarkRegistrationBackend,
  invokeFanmarkRegistration,
  registerFanmarkThroughWorker,
} from './fanmark-registration-api.ts';

const successPayload = {
  success: true,
  fanmark: {
    id: '10000000-0000-4000-8000-000000000001',
    user_input_fanmark: '🌹',
    display_fanmark: '🌹',
    emoji_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    normalized_emoji_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    short_id: 'rose1234',
    canonical_url: '/a/rose1234',
    display_url: '/emoji/%F0%9F%8C%B9',
    tier_level: 4,
    tier_display_name: 'Tier 4',
    initial_license_days: 30,
  },
};

test('backend defaults to Supabase and rejects unknown selectors', () => {
  assert.equal(getFanmarkRegistrationBackend(undefined), 'supabase');
  assert.equal(getFanmarkRegistrationBackend(' worker '), 'worker');
  assert.throws(() => getFanmarkRegistrationBackend('cloudflare'), /configuration/);
});

test('builds the same-origin registration URL', () => {
  assert.equal(buildFanmarkRegistrationApiUrl('https://app.example.test/').href,
    'https://app.example.test/api/fanmarks/register');
  assert.throws(() => buildFanmarkRegistrationApiUrl('http://public.example.test'), /configuration/);
});

test('uses Better Auth cookies and no-store for the selected Worker without Supabase fallback', async () => {
  const body = { user_input_fanmark: '🌹', emoji_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(successPayload), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  let supabaseCalls = 0;
  const result = await invokeFanmarkRegistration(
    body,
    async () => { supabaseCalls += 1; return { data: null, error: null }; },
    { backend: 'worker', baseUrl: 'https://app.example.test', authBaseUrl: 'https://app.example.test', fetchImpl },
  );
  assert.equal(result.error, null);
  assert.equal(result.data?.success, true);
  assert.equal(supabaseCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.example.test/api/fanmarks/register');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), body);
});

test('preserves the existing Supabase function path by default', async () => {
  let called = false;
  const expected = { data: { success: true }, error: null };
  const result = await invokeFanmarkRegistration({}, async () => {
    called = true;
    return expected;
  }, { backend: undefined });
  assert.equal(called, true);
  assert.equal(result, expected);
});

test('does not fall back when the selected Worker rejects registration', async () => {
  let supabaseCalls = 0;
  const result = await invokeFanmarkRegistration(
    {},
    async () => { supabaseCalls += 1; return { data: null, error: null }; },
    {
      backend: 'worker',
      baseUrl: 'https://app.example.test',
      authBaseUrl: 'https://app.example.test',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'This emoji combination is already taken' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    },
  );
  assert.equal(result.data, null);
  assert.match(result.error?.message ?? '', /already taken/);
  assert.equal(supabaseCalls, 0);
});

test('rejects cross-origin cookie authentication before network access', async () => {
  let requests = 0;
  const result = await invokeFanmarkRegistration(
    {},
    async () => ({ data: null, error: null }),
    {
      backend: 'worker',
      baseUrl: 'https://api.example.test',
      authBaseUrl: 'https://app.example.test',
      fetchImpl: async () => { requests += 1; return new Response(); },
    },
  );
  assert.equal(result.data, null);
  assert.match(result.error?.message ?? '', /configuration/);
  assert.equal(requests, 0);
});

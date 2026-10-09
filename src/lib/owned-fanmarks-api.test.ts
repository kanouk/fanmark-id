import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOwnedFanmarksApiUrl,
  assertOwnedFanmarksAuthOrigin,
  getOwnedFanmarksBackend,
  loadOwnedFanmarks,
  OwnedFanmarksApiError,
  parseOwnedFanmarksApiPayload,
} from './owned-fanmarks-api.ts';

const sampleFanmark = {
  id: 'synthetic-fanmark-id',
  user_input_fanmark: '🌿',
  emoji_ids: ['emoji-id'],
  fanmark: '🌿',
  emoji_key: 'emoji-id',
  fanmark_name: 'Synthetic Leaf',
  short_id: 'leaf-123',
  access_type: 'inactive',
  tier_level: 1,
  current_license_id: 'synthetic-license-id',
  is_transferable: true,
  status: 'active',
  created_at: '2026-09-24T00:00:00.000Z',
  updated_at: '2026-09-24T00:00:00.000Z',
  current_license: {
    id: 'synthetic-license-id',
    license_start: '2026-09-24T00:00:00.000Z',
    license_end: null,
    status: 'active',
    created_at: '2026-09-24T00:00:00.000Z',
  },
  fanmark_licenses: {
    license_start: '2026-09-24T00:00:00.000Z',
    license_end: null,
    grace_expires_at: null,
    status: 'active',
    is_returned: false,
    excluded_at: null,
    excluded_from_plan: null,
  },
};

test('backend selection defaults to Supabase and rejects unknown explicit values', () => {
  assert.equal(getOwnedFanmarksBackend(undefined), 'supabase');
  assert.equal(getOwnedFanmarksBackend('worker'), 'worker');
  assert.throws(() => getOwnedFanmarksBackend('fallback'), OwnedFanmarksApiError);
});

test('API URL validation accepts only a clean HTTPS Worker base URL', () => {
  assert.equal(String(buildOwnedFanmarksApiUrl('https://api.example.test')), 'https://api.example.test/api/me/fanmarks');
  assert.throws(() => buildOwnedFanmarksApiUrl('https://api.example.test/path'), OwnedFanmarksApiError);
  assert.throws(() => buildOwnedFanmarksApiUrl('http://api.example.test'), OwnedFanmarksApiError);
  assertOwnedFanmarksAuthOrigin('https://api.example.test', 'https://api.example.test');
  assert.throws(() => assertOwnedFanmarksAuthOrigin('https://api.example.test', 'https://auth.example.test'), OwnedFanmarksApiError);
});

test('payload parsing validates the dashboard contract', () => {
  assert.deepEqual(parseOwnedFanmarksApiPayload({ schemaVersion: 1, items: [sampleFanmark] }), [sampleFanmark]);
  assert.throws(() => parseOwnedFanmarksApiPayload({ schemaVersion: 1, items: [{ ...sampleFanmark, emoji_ids: 'bad' }] }), OwnedFanmarksApiError);
  assert.throws(() => parseOwnedFanmarksApiPayload({ schemaVersion: 2, items: [] }), OwnedFanmarksApiError);
});

test('loader sends credentials and never retries through another backend', async () => {
  const calls: Array<{ url: string; credentials?: RequestCredentials; cache?: RequestCache; method?: string }> = [];
  const items = await loadOwnedFanmarks({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), credentials: init?.credentials, cache: init?.cache, method: init?.method });
      return new Response(JSON.stringify({ schemaVersion: 1, items: [sampleFanmark] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(items.length, 1);
  assert.deepEqual(calls, [{
    url: 'https://api.example.test/api/me/fanmarks',
    credentials: 'include',
    cache: 'no-store',
    method: 'GET',
  }]);

  let attempts = 0;
  await assert.rejects(loadOwnedFanmarks({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => {
      attempts += 1;
      return new Response('{"error":"unavailable"}', { status: 503 });
    },
  }), (error: unknown) => error instanceof OwnedFanmarksApiError && error.kind === 'http');
  assert.equal(attempts, 1);
});

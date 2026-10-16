import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchLanguageMaster,
  getLanguageReadBackend,
  LanguageMasterApiError,
  parseLanguageMasterPayload,
} from './language-master-api.ts';

const API_BASE = 'https://app.example.test';
const RELEASE_VERSION = 'a'.repeat(64);

function payload(items: unknown[] = [
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: true, sortOrder: 1 },
  { code: 'en', label: 'English', nativeLabel: 'English', isActive: true, sortOrder: 2 },
]) {
  return { schemaVersion: 1, releaseVersion: RELEASE_VERSION, master: 'languages', items };
}

test('language backend selector defaults to Supabase and only accepts supported values', () => {
  assert.equal(getLanguageReadBackend(''), 'supabase');
  assert.equal(getLanguageReadBackend('supabase'), 'supabase');
  assert.equal(getLanguageReadBackend('worker'), 'worker');
  assert.throws(
    () => getLanguageReadBackend('d1'),
    (error) => error instanceof LanguageMasterApiError && error.kind === 'configuration',
  );
});

test('parser accepts the minimal versioned language projection and rejects extra or duplicate fields', () => {
  assert.deepEqual(parseLanguageMasterPayload(payload()), [
    { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: true, sortOrder: 1 },
    { code: 'en', label: 'English', nativeLabel: 'English', isActive: true, sortOrder: 2 },
  ]);
  for (const invalid of [
    null,
    { ...payload(), releaseVersion: 'bad' },
    { ...payload(), items: [{ code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: 1, sortOrder: 1 }] },
    payload([
      { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: true, sortOrder: 1 },
      { code: 'ja', label: '日本語', nativeLabel: '日本語', isActive: true, sortOrder: 2 },
    ]),
    payload([{ code: 'ja', label: 'Japanese', nativeLabel: '日本語', isActive: true, sortOrder: 1, userId: 'private' }]),
  ]) {
    assert.throws(
      () => parseLanguageMasterPayload(invalid),
      (error) => error instanceof LanguageMasterApiError && error.kind === 'invalid_response',
    );
  }
});

test('Worker request is public, bounded, uncached, and validates the release projection', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const items = await fetchLanguageMaster({
    apiBaseUrl: API_BASE,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json(payload());
    },
  });
  assert.equal(requestUrl, `${API_BASE}/api/reference-masters/languages`);
  assert.equal(requestInit?.method, 'GET');
  assert.equal(requestInit?.credentials, 'omit');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(requestInit?.redirect, 'error');
  assert.equal(new Headers(requestInit?.headers).get('authorization'), null);
  assert.equal(new Headers(requestInit?.headers).get('cookie'), null);
  assert.equal(items.length, 2);
});

test('Worker errors never trigger another backend and malformed responses fail closed', async () => {
  await assert.rejects(
    fetchLanguageMaster({ apiBaseUrl: API_BASE, fetcher: async () => new Response('upstream secret', { status: 503 }) }),
    (error) => error instanceof LanguageMasterApiError && error.kind === 'http' && error.status === 503,
  );
  await assert.rejects(
    fetchLanguageMaster({ apiBaseUrl: API_BASE, fetcher: async () => Response.json({ ...payload(), items: [] }) }),
    (error) => error instanceof LanguageMasterApiError && error.kind === 'invalid_response',
  );
  await assert.rejects(
    fetchLanguageMaster({ apiBaseUrl: 'http://api.example.test', fetcher: async () => Response.json(payload()) }),
    (error) => error instanceof LanguageMasterApiError && error.kind === 'configuration',
  );
});

test('oversized Worker response is rejected before parsing', async () => {
  await assert.rejects(
    fetchLanguageMaster({
      apiBaseUrl: API_BASE,
      fetcher: async () => new Response(' '.repeat(17 * 1024), {
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (error) => error instanceof LanguageMasterApiError && error.kind === 'invalid_response',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStorageApi,
  getImageStorageBackend,
  getStorageBackend,
  StorageApiError,
} from './storage-api.ts';

const API_BASE = 'https://app.example.test';
const OWNER_ID = '5c5f9001-449c-4b7f-a01d-284302a71ea1';
const OBJECT_ID = '7f57cc22-9a0a-4ae7-bad2-4e81351cc1de';
const publicUrl = `${API_BASE}/api/storage/public/avatars/${OWNER_ID}/${OBJECT_ID}.png`;

test('storage selector defaults to Supabase and only accepts explicit supported values', () => {
  assert.equal(getStorageBackend(''), 'supabase');
  assert.equal(getStorageBackend(' supabase '), 'supabase');
  assert.equal(getStorageBackend('r2'), 'r2');
  assert.equal(getImageStorageBackend(false, 'supabase'), 'supabase');
  assert.equal(getImageStorageBackend(true, 'supabase'), 'supabase');
  assert.equal(getImageStorageBackend(true, 'r2'), 'r2');
  assert.throws(
    () => getImageStorageBackend(false, 'r2'),
    (error) => error instanceof StorageApiError && error.kind === 'configuration',
  );
  assert.throws(
    () => getStorageBackend('worker'),
    (error) => error instanceof StorageApiError && error.kind === 'configuration',
  );
});

test('R2 upload sends the image with cookie credentials and validates the server-owned object URL', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const api = createStorageApi({
    baseUrl: API_BASE,
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ path: `${OWNER_ID}/${OBJECT_ID}.png`, publicUrl }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await api.upload('avatars', OWNER_ID, new Blob(['png'], { type: 'image/png' }));
  assert.equal(requestUrl, `${API_BASE}/api/storage/object/avatars`);
  assert.equal(requestInit?.method, 'POST');
  assert.equal(requestInit?.credentials, 'include');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(new Headers(requestInit?.headers).get('content-type'), 'image/png');
  assert.equal(requestInit?.body instanceof Blob, true);
  assert.deepEqual(result, { path: `${OWNER_ID}/${OBJECT_ID}.png`, publicUrl });
});

test('R2 upload rejects unsupported files before making a request', async () => {
  let calls = 0;
  const api = createStorageApi({
    baseUrl: API_BASE,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 201 });
    },
  });
  await assert.rejects(
    api.upload('avatars', OWNER_ID, new Blob(['svg'], { type: 'image/svg+xml' })),
    (error) => error instanceof StorageApiError && error.kind === 'invalid_file',
  );
  assert.equal(calls, 0);
});

test('R2 upload refuses malformed, cross-origin, and oversized server responses', async () => {
  const payloads = [
    { path: `someone-else/${OBJECT_ID}.png`, publicUrl },
    { path: `${OWNER_ID}/${OBJECT_ID}.png`, publicUrl: `https://attacker.example/api/storage/public/avatars/${OWNER_ID}/${OBJECT_ID}.png` },
  ];
  for (const payload of payloads) {
    const api = createStorageApi({
      baseUrl: API_BASE,
      fetchImpl: async () => new Response(JSON.stringify(payload), { status: 201 }),
    });
    await assert.rejects(
      api.upload('avatars', OWNER_ID, new Blob(['png'], { type: 'image/png' })),
      (error) => error instanceof StorageApiError && error.kind === 'invalid_response',
    );
  }

  const oversized = createStorageApi({
    baseUrl: API_BASE,
    fetchImpl: async () => new Response('x'.repeat(9 * 1024), { status: 201 }),
  });
  await assert.rejects(
    oversized.upload('avatars', OWNER_ID, new Blob(['png'], { type: 'image/png' })),
    (error) => error instanceof StorageApiError && error.kind === 'invalid_response',
  );
});

test('R2 delete encodes owner object keys and never accepts another origin or owner', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const api = createStorageApi({
    baseUrl: API_BASE,
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(null, { status: 204 });
    },
  });
  await api.delete('avatars', OWNER_ID, publicUrl);
  assert.equal(requestUrl, `${API_BASE}/api/storage/object/avatars/${OWNER_ID}/${OBJECT_ID}.png`);
  assert.equal(requestInit?.method, 'DELETE');
  assert.equal(requestInit?.credentials, 'include');

  await assert.rejects(
    api.delete('avatars', OWNER_ID, `https://other.example/api/storage/public/avatars/${OWNER_ID}/${OBJECT_ID}.png`),
    (error) => error instanceof StorageApiError && error.kind === 'configuration',
  );
  await assert.rejects(
    api.delete('avatars', OWNER_ID, `${API_BASE}/api/storage/public/avatars/other/${OBJECT_ID}.png`),
    (error) => error instanceof StorageApiError && error.kind === 'configuration',
  );
});

test('an R2 backend error is surfaced and never falls back to Supabase', async () => {
  let calls = 0;
  const api = createStorageApi({
    baseUrl: API_BASE,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'storage_unavailable' }), { status: 503 });
    },
  });
  await assert.rejects(
    api.upload('avatars', OWNER_ID, new Blob(['png'], { type: 'image/png' })),
    (error) => error instanceof StorageApiError && error.kind === 'http' && error.status === 503,
  );
  assert.equal(calls, 1);
});

test('storage API rejects unsafe base URLs and invalid timeouts', () => {
  for (const baseUrl of [
    'http://api.example.test',
    'https://user:secret@app.example.test',
    'https://app.example.test/path',
    'https://app.example.test/?key=value',
  ]) {
    assert.throws(() => createStorageApi({ baseUrl }));
  }
  assert.throws(() => createStorageApi({ baseUrl: API_BASE, timeoutMs: 0 }));
});

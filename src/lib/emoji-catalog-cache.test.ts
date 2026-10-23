import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCatalogSnapshot, decodeCatalogSnapshot, loadReusableEmojiCatalog, type EmojiCatalogStore } from './emoji-catalog-cache.ts';
import { type EmojiCatalogApiRelease } from './emoji-catalog-worker.ts';

const origin = 'https://api.example.test', A = 'a'.repeat(64), B = 'b'.repeat(64);
const items = [0, 1].map(i => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  emoji: String.fromCodePoint(0x1f600 + i), shortName: 'face ' + i, keywords: ['face'], category: 'faces',
  subcategory: null, codepoints: [(0x1f600 + i).toString(16).toUpperCase()], sortOrder: i }));
const release: EmojiCatalogApiRelease = { version: A, items };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
function memoryStore(value?: unknown) {
  const state = { value, writes: 0 };
  const store: EmojiCatalogStore = { async read() { return state.value; }, async write(_origin, next) { state.value = next; state.writes++; } };
  return { store, state };
}
function network(version = A, entries = items) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    const selected = url.searchParams.get('version'); assert.ok(selected === null || selected === version);
    const limit = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset') || 0);
    return Response.json({ schemaVersion: 1, version, total: entries.length, offset, limit,
      nextOffset: offset + limit < entries.length ? offset + limit : null, items: entries.slice(offset, offset + limit) });
  };
  return { fetcher, calls };
}

test('first load uses the ordinary full HTTP path; next load confirms ready version with one item', async () => {
  const { store, state } = memoryStore(); const first = network();
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: first.fetcher }), release);
  assert.deepEqual(first.calls.map(u => u.searchParams.get('limit')), ['500']);
  for (let i = 0; i < 100 && !state.writes; i++) await pause(); assert.equal(state.writes, 1);
  const next = network(); assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: next.fetcher }), release);
  assert.deepEqual(next.calls.map(u => u.searchParams.get('limit')), ['1']);
});

test('changed ready version reloads every page pinned to the new version, never returns stale items', async () => {
  const { store } = memoryStore(await encodeCatalogSnapshot(origin, 'ready', release));
  const entries = items.map(x => ({ ...x, shortName: x.shortName + ' updated' })); const n = network(B, entries);
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: n.fetcher, pageSize: 1 }), { version: B, items: entries });
  assert.deepEqual(n.calls.map(u => [u.searchParams.get('version'), u.searchParams.get('offset')]), [[null, null], [B, null], [B, '1']]);
});

test('metadata outage or malformed response cannot silently use a stored old catalog', async () => {
  const { store } = memoryStore(await encodeCatalogSnapshot(origin, 'ready', release));
  for (const fetcher of [async () => Response.json({}, { status: 503 }), async () => Response.json({ schemaVersion: 1 })]) {
    await assert.rejects(loadReusableEmojiCatalog(origin, { store, fetcher }));
  }
});

test('valid JSON field corruption, truncation, wrong checksum and foreign origin are rejected and refetched', async () => {
  const good = await encodeCatalogSnapshot(origin, 'ready', release);
  for (const bad of [undefined, null, { ...good, payload: good.payload.slice(0, -3) },
    { ...good, payload: good.payload.replace('face 0', 'evil 0') }, { ...good, checksum: B },
    await encodeCatalogSnapshot('https://other.example.test', 'ready', release)]) {
    const { store } = memoryStore(bad); const n = network();
    assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: n.fetcher }), release);
    assert.equal(n.calls.length, 1); assert.equal(n.calls[0].searchParams.get('limit'), '500');
  }
});

test('even checksummed snapshots require full count, item shapes and unique IDs/emojis', async () => {
  for (const broken of [{ ...release, items: [items[0], items[0]] },
    { ...release, items: [{ ...items[0], id: 'invalid' }] }]) {
    const record = await encodeCatalogSnapshot(origin, 'ready', broken);
    await assert.rejects(decodeCatalogSnapshot(record, origin, 'ready'));
  }
  const good = await encodeCatalogSnapshot(origin, 'ready', release);
  const payload = JSON.parse(good.payload); payload.total++;
  const text = JSON.stringify(payload); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const checksum = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  await assert.rejects(decodeCatalogSnapshot({ ...good, payload: text, checksum }, origin, 'ready'));
});

test('storage read refusal, write rejection, or missing IndexedDB preserves a usable network catalog', async () => {
  const store: EmojiCatalogStore = { async read() { throw Error('blocked'); }, async write() { throw Error('quota'); } };
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: network().fetcher }), release);
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { fetcher: network().fetcher }), release);
  await pause(); // A rejected asynchronous save must not become unhandled.
});

test('a never-completing save does not block install or replace a prior valid snapshot', async () => {
  const previous = await encodeCatalogSnapshot(origin, 'ready', release);
  const store: EmojiCatalogStore = { async read() { return previous; }, write() { return new Promise(() => {}); } };
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: network(B).fetcher }), { version: B, items });
  assert.deepEqual(await decodeCatalogSnapshot(previous, origin, 'ready'), release);
});

test('configured pinned release is verified online and never shares the active or another pin snapshot', async () => {
  const { store } = memoryStore(await encodeCatalogSnapshot(origin, A, release)); const n = network();
  assert.deepEqual(await loadReusableEmojiCatalog(origin, { store, fetcher: n.fetcher, version: A }), release);
  assert.equal(n.calls[0].searchParams.get('version'), A); assert.equal(n.calls[0].searchParams.get('limit'), '1');
  const next = network(); await loadReusableEmojiCatalog(origin, { store, fetcher: next.fetcher });
  assert.equal(next.calls[0].searchParams.get('limit'), '500');
});

test('invalid origin or pinned version is rejected before any storage or HTTP access', async () => {
  const store: EmojiCatalogStore = { async read() { assert.fail(); }, async write() { assert.fail(); } };
  await assert.rejects(loadReusableEmojiCatalog('https://api.example.test/path', { store }));
  await assert.rejects(loadReusableEmojiCatalog(origin, { store, version: 'bad' }));
});

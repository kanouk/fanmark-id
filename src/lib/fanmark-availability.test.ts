import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFanmarkAvailability as load, parseFanmarkAvailability as parse } from './fanmark-availability.ts';
const id = '00000000-0000-4000-8000-000000000001';
const available = { available: true, tier_level: 4, tier_display_name: 'S', price: 1.99, license_days: 7 };
const base = 'https://api.example.test';
const response = (result: unknown) => new Response(JSON.stringify({ schemaVersion: 1, result }), { headers: { 'content-type': 'application/json' } });
test('unset endpoint uses only RPC fallback and preserves public result', async () => {
    let fallback = 0;
    assert.deepEqual(await load([id], { apiBaseUrl: ' ', fallback: async () => { fallback++; return available; }, fetcher: async () => { throw Error('must not fetch'); } }), available);
    assert.equal(fallback, 1);
});
test('selected Worker posts ordered IDs without credentials and never calls fallback', async () => {
    const result = await load([id, id], { apiBaseUrl: base, fallback: async () => { throw Error('must not fallback'); }, fetcher: async (url, init) => {
            assert.equal(String(url), base + '/api/fanmarks/availability');
            assert.equal(init?.method, 'POST');
            assert.equal(init?.credentials, 'omit');
            assert.equal(init?.cache, 'no-store');
            assert.equal(init?.redirect, 'error');
            assert.deepEqual(JSON.parse(init?.body as string), { emojiIds: [id, id] });
            assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
            return response({ ...available, privateField: 'discard' });
        } });
    assert.deepEqual(result, available);
});
test('Worker failure invalid configuration and malformed responses never fall back', async () => {
    let fallback = 0;
    const options = { apiBaseUrl: base, fallback: async () => { fallback++; return available; } };
    for (const fetcher of [async () => { throw Error('network'); }, async () => new Response('error', { status: 500 }), async () => response({ available: true }), async () => new Response(JSON.stringify({ schemaVersion: 2, result: available }), { headers: { 'content-type': 'application/json' } })])
        await assert.rejects(() => load([id], { ...options, fetcher }));
    await assert.rejects(() => load([id], { ...options, apiBaseUrl: 'https://user:pass@example.test' }));
    assert.equal(fallback, 0);
});
test('invalid availability stays false and blocked result preserves the timestamp text', () => {
    assert.deepEqual(parse({ available: false, reason: 'invalid_emoji_ids' }), { available: false, reason: 'invalid_emoji_ids' });
    const blocked = { available: false, fanmark_id: id, reason: 'grace_period', blocking_status: 'grace', available_at: '2026-09-21T00:00:00.123456Z' };
    assert.deepEqual(parse(blocked), blocked);
    for (const invalid of [{ available: true }, { available: false }, { ...available, reason: 'taken' }, { available: false, fanmark_id: id, reason: 'taken', blocking_status: 'grace', available_at: null }])
        assert.throws(() => parse(invalid));
});
test('oversized and stalled bodies are bounded even when stream cancellation hangs', async () => {
    const options = { apiBaseUrl: base, timeoutMs: 20, fallback: async () => { throw Error('no fallback'); } };
    await assert.rejects(() => load([id], { ...options, fetcher: async () => new Response('x'.repeat(16385), { headers: { 'content-type': 'application/json' } }) }));
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; return new Promise(() => { }); } });
    await assert.rejects(() => load([id], { ...options, fetcher: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) }));
    assert.equal(cancelled, true);
});
test('invalid ID counts and timeout settings reject before fetching', async () => {
    for (const ids of [[], Array(6).fill(id), ['invalid']])
        await assert.rejects(() => load(ids, { apiBaseUrl: base, fallback: async () => available }));
    for (const timeoutMs of [0, NaN, Infinity, 30001])
        await assert.rejects(() => load([id], { apiBaseUrl: base, timeoutMs, fallback: async () => available }));
});

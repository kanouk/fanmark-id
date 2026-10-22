import { test } from 'node:test';
import assert from 'node:assert/strict';
import { largestShiftWindow, summarizeRun, catalogPageCount, assertCompatibleSamples } from './slow-network-summary.mjs';

const metadata = { total: 3944, limit: 500, version: 'a'.repeat(64) };

test('CLS excludes recent input and uses the largest window, not lifetime sum', () => {
  assert.equal(largestShiftWindow([
    { at: 200, value: 0.1 }, { at: 400, value: 0.2 },
    { at: 500, value: 0.8, recentInput: true },
    { at: 2000, value: 0.4 },
  ]), 0.4);
});
test('a gap of exactly one second starts a new CLS window', () => {
  assert.equal(largestShiftWindow([{ at: 100, value: 0.1 }, { at: 1100, value: 0.2 }]), 0.2);
});
test('continuous shifts cannot extend a CLS window to five seconds', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ at: i * 800, value: 0.1 }));
  assert.ok(Math.abs(largestShiftWindow(rows) - 0.7) < 1e-10);
});
test('zero shifts and input-only shifts have CLS zero', () => {
  assert.equal(largestShiftWindow([]), 0);
  assert.equal(largestShiftWindow([{ at: 100, value: 0.5, recentInput: true }]), 0);
});
test('eight catalog headers are insufficient when the final response body is incomplete', () => {
  assert.throws(() => summarizeRun({
    catalogMetadata: metadata,
    probe: { marks: { readyPaint: 1 }, lcp: [{ at: 1 }], catalog: Array(8).fill({}), writes: [] },
    requests: [], resources: Array(7).fill({ path: '/api/emoji/catalog' }),
  }), { name: 'AssertionError' });
});
test('catalog page count follows metadata when the catalog grows or shrinks', () => {
  assert.equal(catalogPageCount(metadata), 8);
  assert.equal(catalogPageCount({ ...metadata, total: 4001 }), 9);
  assert.equal(catalogPageCount({ ...metadata, total: 500 }), 1);
  assert.equal(catalogPageCount({ ...metadata, total: 3500 }), 7);
});
test('aggregation refuses build, device, catalog and network mismatches', () => {
  const sample = { profile: 'slow-4g', entry: '/assets/a.js', browser: 'Chrome/155', origin: 'https://fanmark.id',
    viewport: { width: 390, height: 844 }, cpuSlowdown: 4, catalogMetadata: metadata,
    conditions: { latency: 150, downloadThroughput: 200000 } };
  assert.doesNotThrow(() => assertCompatibleSamples([sample, { ...sample }]));
  for (const change of [
    { entry: '/assets/b.js' }, { browser: 'Chrome/156' }, { viewport: { width: 430, height: 844 } },
    { cpuSlowdown: 1 }, { origin: 'https://other.example' },
    { catalogMetadata: { ...metadata, version: 'b'.repeat(64) } },
    { conditions: { latency: 400, downloadThroughput: 50000 } },
  ]) assert.throws(() => assertCompatibleSamples([sample, { ...sample, ...change }]), { name: 'AssertionError' });
  assert.doesNotThrow(() => assertCompatibleSamples([sample, { ...sample, profile: 'slow-3g', conditions: { latency: 400 } }]));
});

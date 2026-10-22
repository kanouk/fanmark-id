import { test } from 'node:test';
import assert from 'node:assert/strict';
import { largestShiftWindow, summarizeRun } from './slow-network-summary.mjs';

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
    probe: { marks: { readyPaint: 1 }, lcp: [{ at: 1 }], catalog: Array(8).fill({}), writes: [] },
    requests: [], resources: Array(7).fill({ path: '/api/emoji/catalog' }),
  }), { name: 'AssertionError' });
});

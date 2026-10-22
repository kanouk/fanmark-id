import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmojiCatalogResource } from './emoji-catalog-state.ts';

test('background loading is silent and concurrent controls share the same request', async () => {
  let complete: () => void = () => { throw new Error('Loader not started'); };
  let loads = 0;
  const resource = createEmojiCatalogResource(() => { loads++; return new Promise(resolve => { complete = resolve; }); });
  const background = resource.load();
  assert.deepEqual(resource.getSnapshot(), { phase: 'loading', demanded: false });
  const first = resource.load(true);
  assert.equal(first, background);
  assert.equal(resource.load(true), background);
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.deepEqual(resource.getSnapshot(), { phase: 'loading', demanded: true });
  complete();
  assert.equal(await first, true);
  assert.deepEqual(resource.getSnapshot(), { phase: 'ready', demanded: false });
  assert.equal(await resource.load(), true);
  assert.equal(loads, 1);
});

test('a failed background load remains silent; a demanded retry can recover without reloading the page', async () => {
  let loads = 0;
  const resource = createEmojiCatalogResource(async () => { if (++loads < 3) throw new Error('unavailable'); });
  assert.equal(await resource.load(), false);
  assert.deepEqual(resource.getSnapshot(), { phase: 'error', demanded: false });
  assert.equal(await resource.load(true), false);
  assert.deepEqual(resource.getSnapshot(), { phase: 'error', demanded: true });
  assert.equal(await resource.load(), true);
  assert.deepEqual(resource.getSnapshot(), { phase: 'ready', demanded: false });
});

test('snapshot is stable between transitions and unsubscribed controls are not notified', async () => {
  const resource = createEmojiCatalogResource(async () => {});
  let notices = 0;
  const initial = resource.getSnapshot();
  assert.equal(resource.getSnapshot(), initial);
  const unsubscribe = resource.subscribe(() => { notices++; });
  await resource.load();
  assert.equal(notices, 2);
  unsubscribe();
  await resource.load(true);
  assert.equal(notices, 2);
});

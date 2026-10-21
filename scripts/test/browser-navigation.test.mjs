import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateDocument } from './browser-navigation.mjs';

function fixture(navigate) {
  let listener; const events = [], sends = [];
  const emit = (loaderId, frameId = 'main') => {
    events.push(loaderId);
    listener?.({ name: 'DOMContentLoaded', frameId, loaderId });
  };
  const cdp = {
    on(method, fn) { assert.equal(method, 'Page.lifecycleEvent'); listener = fn; return () => { listener = null; }; },
    async send(method, params) { sends.push({ method, params }); if (method === 'Page.navigate') return navigate(emit); },
  };
  return { cdp, events, sends, unsubscribed: () => listener === null };
}
test('navigation accepts the new loader event even before the command returns', async () => {
  const x = fixture(emit => { emit('new'); return { frameId: 'main', loaderId: 'new' }; });
  await navigateDocument(x.cdp, 'https://127.0.0.1/'); assert.equal(x.unsubscribed(), true);
});
test('old document and child frame events cannot finish the new navigation', async () => {
  const x = fixture(emit => {
    emit('old'); emit('new', 'child');
    setTimeout(() => emit('new'), 50);
    return { frameId: 'main', loaderId: 'new' };
  });
  await navigateDocument(x.cdp, 'https://127.0.0.1/');
  assert.deepEqual(x.events, ['old', 'new', 'new']); assert.equal(x.unsubscribed(), true);
});
test('missing matching loader fails within the bounded timeout and removes the listener', async () => {
  const x = fixture(emit => { emit('old'); return { frameId: 'main', loaderId: 'new' }; });
  await assert.rejects(navigateDocument(x.cdp, 'https://127.0.0.1/', { timeoutMs: 30 }), /browser_document_navigation_timeout/);
  assert.equal(x.unsubscribed(), true);
});
test('navigation errors fail instead of reading the old page', async () => {
  const x = fixture(() => ({ frameId: 'main', errorText: 'synthetic network failure' }));
  await assert.rejects(navigateDocument(x.cdp, 'https://127.0.0.1/'), /browser_document_navigation_failed/);
  assert.equal(x.unsubscribed(), true);
});

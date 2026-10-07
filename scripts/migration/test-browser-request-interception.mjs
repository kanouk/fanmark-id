import assert from 'node:assert/strict';
import test from 'node:test';
import { continuePausedRequest, recordCanceledNetworkRequest } from './browser-request-interception.mjs';

const canceledError = () => new Error('browser_cdp_command_failed:Fetch.continueRequest:-32602:invalid_interception_id');
const event = { requestId: 'fetch-1', networkId: 'network-1' };
const rejecting = error => ({ send: async () => { throw error; } });

test('only explicit Chrome cancellation receipts are recorded', () => {
  const receipts = new Set();
  for (const candidate of [undefined, false, 'true', 1]) {
    recordCanceledNetworkRequest(receipts, { requestId: 'network-1', canceled: candidate });
  }
  recordCanceledNetworkRequest(receipts, { requestId: '', canceled: true });
  assert.equal(receipts.size, 0);
  recordCanceledNetworkRequest(receipts, { requestId: 'network-1', canceled: true });
  assert.deepEqual([...receipts], ['network-1']);
});

test('a normal continuation remains successful', async () => {
  const calls = [];
  const result = await continuePausedRequest({ send: async (...args) => calls.push(args) }, event, new Set());
  assert.deepEqual(calls, [['Fetch.continueRequest', { requestId: 'fetch-1' }]]);
  assert.equal(result.canceled, false);
});

test('invalid interception is accepted only with the matching cancellation receipt', async () => {
  assert.equal((await continuePausedRequest(rejecting(canceledError()), event, new Set(['network-1']))).canceled, true);
});

test('missing, unrelated, or uncorrelatable cancellation does not hide a protocol failure', async () => {
  for (const [request, receipts] of [[event, new Set()], [event, new Set(['network-2'])],
    [{ requestId: 'fetch-1' }, new Set(['network-1'])]]) {
    const error = canceledError();
    await assert.rejects(continuePausedRequest(rejecting(error), request, receipts, 0), failure => failure === error);
  }
});

test('different commands, codes, and error kinds remain failures even with a cancellation receipt', async () => {
  for (const message of ['browser_cdp_command_failed:Fetch.failRequest:-32602:invalid_interception_id',
    'browser_cdp_command_failed:Fetch.continueRequest:-32000:invalid_interception_id',
    'browser_cdp_command_failed:Fetch.continueRequest:-32602:other', 'browser_cdp_closed']) {
    const error = new Error(message);
    await assert.rejects(continuePausedRequest(rejecting(error), event, new Set(['network-1'])), failure => failure === error);
  }
});

test('receipt can arrive after the command rejection without widening the guard', async () => {
  const receipts = new Set();
  const timer = setTimeout(() => recordCanceledNetworkRequest(receipts, { requestId: 'network-1', canceled: true }), 10);
  try {
    assert.equal((await continuePausedRequest(rejecting(canceledError()), event, receipts, 100)).canceled, true);
  } finally { clearTimeout(timer); }
});

// Exercise event delivery later than the prior 250 ms budget. The guard must
// still correlate the exact Network ID after a late event and reject absence.
test('default receipt budget accepts a late matching receipt beyond 250 ms', async () => {
  const receipts = new Set();
  const timer = setTimeout(() => recordCanceledNetworkRequest(receipts, { requestId: 'network-1', canceled: true }), 350);
  try {
    assert.equal((await continuePausedRequest(rejecting(canceledError()), event, receipts)).canceled, true);
  } finally { clearTimeout(timer); }
});

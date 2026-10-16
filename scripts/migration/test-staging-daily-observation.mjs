import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyInvocationProof, tailJsonObjects } from './staging-daily-observation.mjs';

const event = () => ({ scriptName: 'fanmark-app-staging', outcome: 'ok', exceptions: [],
  event: { cron: '0 0 * * *', scheduledTime: Date.parse('2026-10-06T00:00:15Z') },
  logs: [{ message: [JSON.stringify({ job: 'license-expiry-lifecycle', status: 'completed',
    graceFinalizationStatus: 'completed', conflicts: 0, graceFinalizationConflicts: 0, processed: 0,
    runId: 'private-run-id', password: 'never-export' }), JSON.stringify({ job: 'notification-archive',
    status: 'completed', remaining: 0, conflicts: 0, archived: 0, token: 'never-export' })] }] });

test('accepts actual Cron second offset and redacts all identity/credential fields', () => {
  const proof = dailyInvocationProof(event(), '2026-10-06');
  assert.equal(proof.naturalDailyAccepted, true);
  assert.equal(proof.scheduledTime, '2026-10-06T00:00:15.000Z');
  assert.ok(!/private-run|password|token|never-export/u.test(JSON.stringify(proof)));
});
test('does not borrow success from another Cron, date, minute or Worker', () => {
  for (const alter of [e => e.event.cron = '* * * * *', e => e.event.scheduledTime += 60_000,
    e => e.event.scheduledTime += 86_400_000, e => e.scriptName = 'different-worker']) {
    const value = event(); alter(value); assert.equal(dailyInvocationProof(value, '2026-10-06'), null);
  }
  assert.equal(dailyInvocationProof({ ...event(), event: { cron: '0 0 * * *', scheduledTime: NaN } }, '2026-10-06'), null);
});
test('partial archive, exception, missing/conflicting lifecycle result cannot pass', () => {
  for (const alter of [e => e.outcome = 'exceededCpu', e => e.exceptions.push({ message: 'secret' }),
    e => e.logs[0].message.pop(), e => e.logs[0].message[1] = JSON.stringify({ job: 'notification-archive', status: 'partial', remaining: 1, conflicts: 0 }),
    e => e.logs[0].message.push(e.logs[0].message[0]), e => e.logs[0].message[0] = JSON.stringify({ job: 'license-expiry-lifecycle', status: 'completed', graceFinalizationStatus: 'completed' })]) {
    const value = event(); alter(value); assert.equal(dailyInvocationProof(value, '2026-10-06').naturalDailyAccepted, false);
  }
});
test('malformed messages and arbitrary status strings do not leak to evidence', () => {
  const value = event(); value.logs.unshift({ message: ['{', JSON.stringify({ job: 'notification-archive', status: 'secret', remaining: -1, token: 'secret' }), 'plain private context'] });
  const proof = dailyInvocationProof(value, '2026-10-06');
  assert.equal(proof.naturalDailyAccepted, false);
  assert.ok(!JSON.stringify(proof).includes('secret'));
});
test('frames split/concatenated events with braces and escaped quotes inside strings', () => {
  const found = [], consume = tailJsonObjects(value => found.push(value));
  const value = { ...event(), extra: 'brace } and quote " and slash \\' };
  const encoded = JSON.stringify(value);
  for (let i = 0; i < encoded.length; i += 7) consume(encoded.slice(i, i + 7));
  consume('cli notice\n' + encoded + JSON.stringify({ outcome: 'ok' }));
  assert.deepEqual(found, [value, value, { outcome: 'ok' }]);
});

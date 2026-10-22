import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateWorkerTestPlan } from './worker-test-plan.mjs';

const { scripts } = JSON.parse(await readFile(new URL('../workers/api/package.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(await readFile(new URL('./worker-test-baseline.json', import.meta.url), 'utf8'));

test('all pre-split Worker commands run exactly once, including recovery and syntax checks', () => {
  assert.deepEqual(validateWorkerTestPlan(scripts, baseline), { groups: 4, commands: 63 });
});
for (const [name, mutate] of [
  ['omitted group', copy => { copy.test = copy.test.replace(' && npm run test:ci:recovery', ''); }],
  ['omitted nested test', copy => { copy['test:auth:d1'] = 'vitest run --config vitest.auth-d1.config.mjs'; }],
  ['changed configuration', copy => { copy['test:verified-access:d1'] = 'vitest run --config vitest.config.mjs'; }],
  ['duplicate recovery', copy => { copy['test:ci:core'] += ' && npm run test:recovery-writer-drain'; }],
  ['cycle', copy => { copy['test:ci:recovery'] = 'npm run test:ci:recovery'; }],
  ['unknown command', copy => { copy['test:ci:core'] += ' && npm run test:missing'; }],
  ['ignored failure', copy => { copy['test:ci:core'] += ' || true'; }],
  ['shell execution', copy => { copy['test:ci:core'] += ' && curl https://example.invalid'; }],
]) test('test plan rejects ' + name, () => {
  const copy = { ...scripts };
  mutate(copy);
  assert.throws(() => validateWorkerTestPlan(copy, baseline));
});

test('required Worker result accepts only complete success', () => {
  const gate = fileURLToPath(new URL('./check-worker-test-result.mjs', import.meta.url));
  for (const value of ['success', 'failure', 'cancelled', 'skipped', '', undefined]) {
    const env = { ...process.env };
    delete env.WORKER_CONTRACTS_RESULT;
    if (value !== undefined) env.WORKER_CONTRACTS_RESULT = value;
    const result = spawnSync(process.execPath, [gate], { env, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.status, value === 'success' ? 0 : 1, result.stderr);
  }
});

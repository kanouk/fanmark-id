export const WORKER_TEST_GROUPS = ['core', 'business', 'billing-admin', 'recovery'];

// Only expand the existing, explicit npm chains. Never evaluate shell text.
export function expandTestCommands(command, scripts, stack = []) {
  if (typeof command !== 'string') throw new Error('Missing test command');
  return command.split(' && ').flatMap(part => {
    const reference = /^npm run (test:[\w:-]+)$/u.exec(part);
    if (!reference) {
      if (!/^(?:vitest run --config [\w.-]+\.mjs|node (?:--[\w-]+ )*[\w./-]+(?: [\w./-]+)*)$/u.test(part)) {
        throw new Error('Unsupported test command: ' + part);
      }
      return [part];
    }
    const name = reference[1];
    if (stack.includes(name)) throw new Error('Cyclic test command: ' + name);
    return expandTestCommands(scripts[name], scripts, [...stack, name]);
  });
}

export function validateWorkerTestPlan(scripts, baseline) {
  const expectedEntry = ['test:plan', ...WORKER_TEST_GROUPS.map(group => 'test:ci:' + group)]
    .map(name => 'npm run ' + name).join(' && ');
  if (scripts.test !== expectedEntry) throw new Error('npm test must run the plan check and every group');
  if (scripts['test:plan'] !== 'node --test ../../scripts/test-worker-test-plan.mjs') {
    throw new Error('Missing test plan regression check');
  }
  const commands = WORKER_TEST_GROUPS.flatMap(group =>
    expandTestCommands(scripts['test:ci:' + group], scripts));
  if (new Set(commands).size !== commands.length) throw new Error('Duplicate Worker test invocation');
  const actual = new Set(commands);
  const expected = new Set(baseline.commands);
  const missing = [...expected].filter(command => !actual.has(command));
  const extra = [...actual].filter(command => !expected.has(command));
  if (missing.length || extra.length) {
    throw new Error('Worker test coverage changed: ' + JSON.stringify({ missing, extra }));
  }
  return { groups: WORKER_TEST_GROUPS.length, commands: commands.length };
}

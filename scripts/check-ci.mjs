import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WORKER_TEST_GROUPS } from './worker-test-plan.mjs';

const COMMANDS = new Set([
  'npm ci --legacy-peer-deps', 'npm ci --prefix workers/api', 'npm ci',
  'npm run check:ci', 'npm run verify:app', 'npm run test:local', 'npm run build',
  'npm run build:cloudflare-production-live:dry-run',
  'npm run typecheck', 'npm test', 'npm run build:dry-run',
  'npm run test:combined-recovery', 'npm run test:business-runtime-import',
  'npm run test:staging-invitation-signup-local', 'npm run test:staging-profile-editor-local',
  'npm run build:cloudflare-staging', 'npm run test:staging-profile-editor-ui',
  'npm run test:plan', 'npm run test:ci:${{ matrix.suite }}',
  'node ../../scripts/check-worker-test-result.mjs',
  'node scripts/test/pwa-precache-browser.mjs',
]);

export function validateWorkflow(source) {
  if (!/^permissions:\s*\n\s+contents: read\s*$/mu.test(source)) throw new Error('CI must use read-only contents');
  if (/secrets\.|contents:\s*write|id-token:\s*write|--remote\b|\bgit\s+push\b|\bsupabase\b/iu.test(source)) {
    throw new Error('CI must not use secrets, remote writes or retired services');
  }
  if (!/^  pull_request:\s*$/mu.test(source) || !/^  push:\s*$/mu.test(source)) {
    throw new Error('CI must verify PR and main changes');
  }
  if (/^[ \t]+(?:-[ \t]+)?run:[ \t]*[|>]/mu.test(source)) throw new Error('CI commands must be explicit single entrypoints');
  if (/continue-on-error:|paths(?:-ignore)?:/u.test(source)) throw new Error('CI must not ignore failures or skip changed paths');
  const jobs = Object.fromEntries([...source.matchAll(/^  ([\w-]+):\n((?:^(?!  [\w-]+:).*(?:\n|$))*)/gmu)]
    .map(match => [match[1], match[2]]));
  const contracts = jobs['worker-contracts'] ?? '';
  const worker = jobs.worker ?? '';
  const matrix = '        suite: [' + WORKER_TEST_GROUPS.join(', ') + ']';
  if (!contracts.includes('      fail-fast: false\n      matrix:\n' + matrix + '\n    defaults:') ||
      !contracts.includes('        run: npm run test:plan\n') ||
      !contracts.includes('        run: npm run test:ci:${{ matrix.suite }}\n')) {
    throw new Error('CI must run every Worker contract group without cancelling peers');
  }
  if (!/^    name: Validate Cloudflare Worker API$/mu.test(worker) ||
      !/^    needs: worker-contracts$/mu.test(worker) || !/^    if: always\(\)$/mu.test(worker) ||
      !/^          WORKER_CONTRACTS_RESULT: \$\{\{ needs.worker-contracts.result \}\}$/mu.test(worker) ||
      !worker.includes('        run: node ../../scripts/check-worker-test-result.mjs\n') ||
      [...source.matchAll(/^[ \t]+(?:-[ \t]+)?if:/gmu)].length !== 1) {
    throw new Error('Required Worker check must reject unsuccessful or skipped groups');
  }
  const commands = [...source.matchAll(/^[ \t]+(?:-[ \t]+)?run:[ \t]*(.+)$/gmu)].map(match => match[1].trim());
  for (const command of commands) {
    if (!COMMANDS.has(command)) throw new Error('Unreviewed CI entrypoint: ' + command);
  }
  for (const command of ['npm run verify:app', 'npm run test:local', 'npm run build',
    'npm run typecheck', 'npm run build:cloudflare-production-live:dry-run', 'npm run test:combined-recovery',
    'npm run test:business-runtime-import', 'npm run build:dry-run',
    'npm run test:staging-invitation-signup-local', 'npm run test:staging-profile-editor-local',
    'npm run build:cloudflare-staging', 'npm run test:staging-profile-editor-ui', 'node scripts/test/pwa-precache-browser.mjs']) {
    if (!commands.includes(command)) throw new Error('Required CI check missing: ' + command);
  }
  return { secretFree: true, deployment: false, commands: commands.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
  for (const filename of await readdir(directory)) {
    if (/\.ya?ml$/u.test(filename)) {
      console.log(filename + ': ' + JSON.stringify(validateWorkflow(await readFile(path.join(directory, filename), 'utf8'))));
    }
  }
}

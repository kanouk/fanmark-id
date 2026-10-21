import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const COMMANDS = new Set([
  'npm ci --legacy-peer-deps', 'npm ci --prefix workers/api', 'npm ci',
  'npm run check:ci', 'npm run verify:app', 'npm run test:local', 'npm run build',
  'npm run build:cloudflare-production-live:dry-run',
  'npm run typecheck', 'npm test', 'npm run build:dry-run',
  'npm run test:combined-recovery', 'npm run test:business-runtime-import',
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
  const commands = [...source.matchAll(/^[ \t]+(?:-[ \t]+)?run:[ \t]*(.+)$/gmu)].map(match => match[1].trim());
  for (const command of commands) {
    if (!COMMANDS.has(command)) throw new Error('Unreviewed CI entrypoint: ' + command);
  }
  for (const command of ['npm run verify:app', 'npm run test:local', 'npm run build', 'npm test',
    'npm run typecheck', 'npm run build:cloudflare-production-live:dry-run', 'npm run test:combined-recovery']) {
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

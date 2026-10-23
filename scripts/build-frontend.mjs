/** Build only. Never reads credentials, deploys or mutates source. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { frontendEnvironment, isolatedBuildEnvironment } from './frontend-build-config.mjs';

export async function buildFrontend(target) {
  if (process.versions.node !== '22.6.0') throw Error('frontend_build_requires_node_22_6_0');
  if (process.argv.length !== 2) throw Error('frontend_build_accepts_no_overrides');
  const origin = target === 'production' ? 'https://fanmark.id' : 'https://fanmark-app-staging.fanmark-id.workers.dev';
  const selectors = frontendEnvironment(target, origin);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'fanmark-build-env-'));
  const mode = `cloudflare-${target}`;
  const outDir = target === 'production' ? 'dist-cloudflare-production' : 'dist-staging';
  try {
    const env = isolatedBuildEnvironment(process.env, target, origin, directory);
    const result = await promisify(execFile)(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', mode, '--outDir', outDir],
      { cwd: root, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    const pwa = await promisify(execFile)(process.execPath, [join(root, 'scripts/check-pwa-cache.mjs'), outDir],
      { cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024 });
    process.stdout.write(pwa.stdout); process.stderr.write(pwa.stderr);
    await writeFile(join(root, outDir, 'build-target.json'), JSON.stringify({
      mode, origin, authBackend: 'better-auth', legacySupabaseDisabled: true, selectors, node: process.versions.node, deployed: false,
    }, null, 2) + '\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

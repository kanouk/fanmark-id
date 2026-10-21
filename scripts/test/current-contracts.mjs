import { spawn } from 'node:child_process';

// Current runtime and operational contracts. Historical source fingerprints,
// source freeze/import rehearsals and remote smoke commands are not normal CI.
const files = [
  'scripts/test/owner-cache.mjs',
  'scripts/migration/test-staging-selector-coverage.mjs',
  'scripts/test-auth-login-mfa.mjs',
  'scripts/test-hook-effects.mjs',
  'scripts/test-account-readiness.mjs',
  'scripts/test-plan-projection-polling.mjs',
  'scripts/test-app-startup.mjs',
  'scripts/test-cloudflare-production-build.mjs',
  'scripts/test-frontend-architecture.mjs',
  'scripts/dev/local-config.test.mjs',
  'scripts/test-emoji-catalog.ts',
  'scripts/test-emoji-catalog-worker.ts',
  'scripts/test-emoji-conversion-runtime.ts',
  'scripts/migration/retain-staging-hashed-assets.test.mjs',
  'scripts/migration/test-safe-diagnostics.mjs',
  'scripts/migration/test-browser-request-interception.mjs',
  'scripts/migration/test-local-browser-egress-proxy.mjs',
  'scripts/migration/test-business-migration-ledger.mjs',
  'scripts/migration/test-scheduled-job-coverage.mjs',
  'scripts/migration/test-timestamp-writer-audit.mjs',
  'scripts/migration/test-production-live-config.mjs',
  'scripts/migration/test-production-domain-alias.mjs',
  'scripts/migration/test-production-emoji-operations.mjs',
  'scripts/migration/test-staging-emoji-master-export.mjs',
  'scripts/migration/test-emoji-release-payload.mjs',
];
if (process.argv.length !== 2) throw new Error('Current contract tests accept no remote or file overrides');
const child = spawn(process.execPath, ['--experimental-strip-types', '--test', ...files], { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });

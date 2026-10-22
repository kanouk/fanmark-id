import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateWorkflow } from './check-ci.mjs';

const source = await readFile(new URL('../.github/workflows/cloudflare-migration-validation.yml', import.meta.url), 'utf8');
test('current CI retains local browser, production build and recovery checks without deployment', () => {
  assert.equal(validateWorkflow(source).deployment, false);
});
for (const [name, mutate] of [
  ['secret access', text => text + '\n      - run: echo "${{ secrets.CLOUDFLARE_TOKEN }}"\n'],
  ['write permissions', text => text.replace('contents: read', 'contents: write')],
  ['remote smoke entrypoint', text => text + '\n      - run: npm run test:staging-fanmark-registration-smoke\n'],
  ['raw deployment', text => text + '\n      - run: wrangler deploy\n'],
  ['shell command suffix', text => text.replace('run: npm run build\n', 'run: npm run build && curl https://example.invalid\n')],
  ['removed recovery test', text => text.replace('run: npm run test:combined-recovery', 'run: npm run typecheck')],
  ['omitted Worker group', text => text.replace('core, business, billing-admin, recovery', 'core, business, billing-admin')],
  ['early cancellation', text => text.replace('fail-fast: false', 'fail-fast: true')],
  ['missing aggregate dependency', text => text.replace('needs: worker-contracts', 'needs: application')],
  ['skipped aggregate check', text => text.replace('if: always()', 'if: success()')],
  ['forged aggregate success', text => text.replace('${{ needs.worker-contracts.result }}', 'success')],
  ['missing result gate', text => text.replace('run: node ../../scripts/check-worker-test-result.mjs', 'run: npm run typecheck')],
  ['conditional contract step', text => text.replace('run: npm run test:ci:', 'if: false\n        run: npm run test:ci:')],
  ['ignored contract failure', text => text.replace('name: Verify Worker contract group', 'name: Verify Worker contract group\n        continue-on-error: true')],
  ['documentation path skip', text => text.replace('branches: [main]', 'branches: [main]\n    paths-ignore: ["docs/**"]')],
  ['removed runtime import', text => text.replace('run: npm run test:business-runtime-import', 'run: npm run typecheck')],
]) test('CI rejects ' + name, () => assert.throws(() => validateWorkflow(mutate(source))));

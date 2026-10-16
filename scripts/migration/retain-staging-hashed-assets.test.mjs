import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainStagingHashedAssets } from './retain-staging-hashed-assets.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fanmark-retained-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = join(root, 'previous'), current = join(root, 'current');
  for (const folder of [previous, current]) await mkdir(join(folder, 'assets'), { recursive: true });
  return { previous, current };
}

test('old bundle remains reachable without replacing current HTML, worker or bundle', async t => {
  const { previous, current } = await fixture(t);
  await writeFile(join(previous, 'assets/index-old00001.js'), 'previous public bundle');
  await writeFile(join(previous, 'index.html'), 'old HTML');
  await writeFile(join(previous, 'sw.js'), 'old worker');
  await writeFile(join(current, 'assets/index-new00001.js'), 'new public bundle');
  await writeFile(join(current, 'index.html'), 'new HTML');
  await writeFile(join(current, 'sw.js'), 'new worker');
  const result = await retainStagingHashedAssets(previous, current);
  assert.equal(result.copied.length, 1);
  assert.equal(await readFile(join(current, 'assets/index-old00001.js'), 'utf8'), 'previous public bundle');
  assert.equal(await readFile(join(current, 'assets/index-new00001.js'), 'utf8'), 'new public bundle');
  assert.equal(await readFile(join(current, 'index.html'), 'utf8'), 'new HTML');
  assert.equal(await readFile(join(current, 'sw.js'), 'utf8'), 'new worker');
  assert.deepEqual(await retainStagingHashedAssets(previous, current), { copied: [], alreadyPresent: 1 });
});

test('collision refuses the whole plan before copying an earlier asset', async t => {
  const { previous, current } = await fixture(t);
  await writeFile(join(previous, 'assets/a-aaaaaaaa.js'), 'would be copied');
  await writeFile(join(previous, 'assets/z-zzzzzzzz.js'), 'old');
  await writeFile(join(current, 'assets/z-zzzzzzzz.js'), 'different bytes');
  await assert.rejects(retainStagingHashedAssets(previous, current), /collision/);
  assert.deepEqual(await readdir(join(current, 'assets')), ['z-zzzzzzzz.js']);
});

test('unhashed files and symlinks are refused before writes', async t => {
  const { previous, current } = await fixture(t);
  await writeFile(join(previous, 'assets/private.json'), '{}');
  await assert.rejects(retainStagingHashedAssets(previous, current), /hashed public assets/);
  await rm(join(previous, 'assets/private.json'));
  await writeFile(join(previous, 'outside.txt'), 'not an asset');
  await symlink(join(previous, 'outside.txt'), join(previous, 'assets/a-aaaaaaaa.js'));
  await assert.rejects(retainStagingHashedAssets(previous, current), /Symlinks/);
  assert.deepEqual(await readdir(join(current, 'assets')), []);
});

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Keep the previous immutable bundle reachable while installed clients update.
// Entry documents, service workers and manifests are never copied.
export async function retainStagingHashedAssets(previousBuild, currentBuild) {
  const previous = await realpath(resolve(previousBuild, 'assets'));
  const current = await realpath(resolve(currentBuild, 'assets'));
  assert.notEqual(previous, current);
  const copied = [];
  const pending = [];
  let alreadyPresent = 0;
  for (const name of (await readdir(previous)).sort()) {
    assert.match(name, /^[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|png|svg|woff2?)$/u,
      'Only Vite hashed public assets may be retained');
    const source = join(previous, name), target = join(current, name);
    assert.equal((await lstat(source)).isFile(), true, 'Symlinks and directories are refused');
    const bytes = await readFile(source);
    try {
      assert.equal((await lstat(target)).isFile(), true);
      assert.equal((await readFile(target)).equals(bytes), true, 'A hash-named collision must not be overwritten');
      alreadyPresent++;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      pending.push({ name, target, bytes });
    }
  }
  for (const { name, target, bytes } of pending) {
    await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
    copied.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { copied, alreadyPresent };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 4, 'Provide previous and current build directories');
  console.log(JSON.stringify(await retainStagingHashedAssets(process.argv[2], process.argv[3])));
}

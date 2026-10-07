/** Host-side private files. No key storage, scheduler, off-host transport or overwrite. */
import {open, lstat, realpath, link, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openRecoverySet} from '../../workers/api/src/recovery-set.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BYTES = 256 * 1024 * 1024;
const fail = code => {throw new Error('recovery_set_file_' + code);};
async function filePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || !/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(path.basename(value))) fail('path_invalid');
  const directory = await realpath(path.dirname(value)), stat = await lstat(directory);
  if (!stat.isDirectory() || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid() ||
      directory === repo.slice(0, -1) || directory.startsWith(repo)) fail('private_directory_required');
  return {directory, filename: path.join(directory, path.basename(value))};
}
/** The final link is exclusive. A failure after commit never removes the final file. */
export async function saveRecoverySetFile(value, archive, context, key) {
  const {directory, filename} = await filePath(value), copy = structuredClone(archive);
  await openRecoverySet(copy, context, key);
  const bytes = Buffer.from(JSON.stringify(copy) + '\n');
  if (bytes.length > MAX_BYTES) {bytes.fill(0); fail('too_large');}
  const temporary = path.join(directory, '.recovery-set-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await link(temporary, filename); await unlink(temporary);
    const directoryHandle = await open(directory, 'r');
    try {await directoryHandle.sync();} finally {await directoryHandle.close();}
    return {bytes: bytes.length, committed: true};
  } catch {fail('commit_failed_inspect_destination');}
  finally {bytes.fill(0); if (handle) await handle.close().catch(() => {}); await unlink(temporary).catch(() => {});}
}

export async function readRecoverySetFile(value, context, key) {
  const {filename} = await filePath(value); let handle, bytes;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid() ||
        stat.size < 1 || stat.size > MAX_BYTES) fail('private_file_required');
    bytes = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break; offset += read.bytesRead;
    }
    if (offset !== stat.size || (await handle.stat()).size !== stat.size) fail('changed_during_read');
    let archive;
    try {archive = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, offset)));}
    catch {fail('json_invalid');}
    await openRecoverySet(archive, context, key); return archive;
  } finally {if (bytes) bytes.fill(0); if (handle) await handle.close();}
}

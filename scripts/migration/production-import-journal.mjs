/** A private, fsync'd intent log. Pending writes require independent inspection. */
import { open, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import pathModule from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const fail = code => { throw new Error(code); };
const journals = new WeakSet();
export const isProductionImportJournal = journal => journals.has(journal);

export async function openProductionImportJournal({ path, runId, targetId, targetIncarnation }) {
  if (!pathModule.isAbsolute(path ?? '') || ![runId,targetId,targetIncarnation].every(v => typeof v === 'string' && UUID.test(v))) fail('production_journal_identity_invalid');
  const parent = await lstat(pathModule.dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) fail('production_journal_parent_not_private');
  const identity = { format: 'fanmark-production-import-journal-v1', runId, targetId, targetIncarnation };
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify({ type: 'identity', ...identity }) + '\n');
    await handle.sync();
    await handle.close(); handle = null;
    const directory = await open(pathModule.dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle?.close();
    if (error.code !== 'EEXIST') throw error;
  }
  const inspect = async () => {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 16 * 1024 * 1024) fail('production_journal_file_not_private');
      const text = await file.readFile('utf8');
      if (!text.endsWith('\n')) fail('production_journal_incomplete');
      let rows;
      try { rows = text.trimEnd().split('\n').map(line => JSON.parse(line)); } catch { fail('production_journal_invalid'); }
      if (JSON.stringify(rows[0]) !== JSON.stringify({ type: 'identity', ...identity })) fail('production_journal_identity_mismatch');
      let pending = null;
      const seen = new Set();
      for (const row of rows.slice(1)) {
        if (row.type === 'intent' && !pending && UUID.test(row.operationId ?? '') && HASH.test(row.batchSha256 ?? '') && !seen.has(row.operationId)) {
          pending = row.operationId; seen.add(pending);
        } else if (row.type === 'acknowledged' && pending && row.operationId === pending) pending = null;
        else fail('production_journal_invalid');
      }
      return { pending, dev: stat.dev, ino: stat.ino };
    } finally { await file.close(); }
  };
  const original = await inspect();
  // A durable lock is intentionally not auto-reclaimed after a crash. Losing a
  // process is not proof that its remote write failed. Operators inspect the
  // journal and destination before a separately reviewed recovery operation.
  let active = null;
  async function append(row) {
    const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (stat.ino !== original.ino || stat.dev !== original.dev || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) fail('production_journal_replaced');
      await file.writeFile(JSON.stringify(row) + '\n');
      await file.sync();
    } finally { await file.close(); }
  }
  const journal = Object.freeze({
    targetId, targetIncarnation,
    async beforeWrite(batchSha256) {
      if (!HASH.test(batchSha256 ?? '') || active) fail('production_journal_write_conflict');
      // O_EXCL also serializes independent processes using this journal.
      const lock = await open(path + '.lock', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await lock.sync(); } finally { await lock.close(); }
      const current = await inspect();
      if (current.pending) fail('production_journal_unresolved_write');
      active = randomUUID();
      await append({ type: 'intent', operationId: active, batchSha256 });
      return active;
    },
    async afterWrite(operationId) {
      if (!active || operationId !== active) fail('production_journal_operation_mismatch');
      await append({ type: 'acknowledged', operationId });
      await unlink(path + '.lock');
      active = null;
    },
  });
  journals.add(journal);
  return journal;
}

/** Independent inspection and the narrow recovery of a lost local ACK.
 * Never sends a provider write or clears an unresolved remote operation.
 */
import { open, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { isProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { PRODUCTION_D1_TARGETS } from './production-d1-targets.mjs';
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u, HASH = /^[0-9a-f]{64}$/u;
const fail = () => { throw Error('production_import_inspection_unconfirmed'); };
const hash = value => createHash('sha256').update(value).digest('hex');
export const importJournalHostHash = () => hash(hostname());
async function privateParent(path) {
  if (!isAbsolute(path ?? '')) fail();
  const stat = await lstat(dirname(path));
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) fail();
}
async function readPrivate(path, maxBytes) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > maxBytes) fail();
    const text = await file.readFile('utf8');
    const after = await file.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail();
    return { text, dev: stat.dev, ino: stat.ino };
  } finally { await file.close(); }
}
function targetStore(identity, coordinator) {
  const store = PRODUCTION_D1_TARGETS.find(row => row.databaseId === identity.targetId)?.databaseName.replace('fanmark-production-', '') ??
    PRODUCTION_R2_TARGETS.find(row => row.bucketName === identity.targetId)?.store;
  if (!store || coordinator.owner !== identity.runId || coordinator.incarnations[store] !== identity.targetIncarnation) fail();
  return store;
}
export async function inspectProductionImportJournal(path) {
  try {
    await privateParent(path);
    const file = await readPrivate(path, 16 * 1024 * 1024);
    if (!file.text.endsWith('\n')) fail();
    const rows = file.text.trimEnd().split('\n').map(line => JSON.parse(line)), identity = rows.shift();
    if (!identity || Object.keys(identity).sort().join(',') !== 'format,runId,targetId,targetIncarnation,type' ||
        identity.type !== 'identity' || identity.format !== 'fanmark-production-import-journal-v1' ||
        !UUID.test(identity.runId) || !UUID.test(identity.targetIncarnation) ||
        !(UUID.test(identity.targetId) || PRODUCTION_R2_TARGETS.some(row => row.bucketName === identity.targetId))) fail();
    let pending = null;
    const operations = [], seen = new Set();
    for (const row of rows) {
      if (row?.type === 'intent' && Object.keys(row).sort().join(',') === 'batchSha256,operationId,type' &&
          !pending && UUID.test(row.operationId ?? '') && HASH.test(row.batchSha256 ?? '') && !seen.has(row.operationId)) {
        pending = { operationId: row.operationId, batchSha256: row.batchSha256 };
        seen.add(row.operationId);
      } else if (row?.type === 'acknowledged' && pending && row.operationId === pending.operationId &&
          (Object.keys(row).sort().join(',') === 'operationId,type' ||
           (Object.keys(row).sort().join(',') === 'operationId,recoveryProofSha256,type' && HASH.test(row.recoveryProofSha256 ?? '')))) {
        operations.push({ ...pending, acknowledged: true }); pending = null;
      } else fail();
    }
    let lock = null;
    try {
      const raw = await readPrivate(path + '.lock', 4096);
      // Pre-upgrade locks were empty: inspect them, but never auto-reclaim them.
      let owner = null;
      if (raw.text) {
        owner = JSON.parse(raw.text);
        if (Object.keys(owner).sort().join(',') !== 'format,hostHash,operationId,processId,runId,targetId,targetIncarnation' ||
            owner.format !== 'fanmark-production-import-lock-v1' || !UUID.test(owner.operationId ?? '') ||
            !Number.isSafeInteger(owner.processId) || owner.processId < 1 || !HASH.test(owner.hostHash ?? '') ||
            ['runId', 'targetId', 'targetIncarnation'].some(key => owner[key] !== identity[key])) fail();
      }
      lock = { dev: raw.dev, ino: raw.ino, owner };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { identity, pending, operations, lock, dev: file.dev, ino: file.ino, journalSha256: hash(file.text) };
  } catch { fail(); }
}

export async function inspectProductionImportAttempt({ journalPath, coordinator }) {
  if (!isProductionImportCoordinator(coordinator)) fail();
  const local = await inspectProductionImportJournal(journalPath), store = targetStore(local.identity, coordinator);
  if (!local.pending) return { classification: local.lock ? 'local-no-pending-lock-retained' : 'local-no-pending-operation',
    local, remote: null, store, replayAllowed: false, productionReady: false };
  const remote = await coordinator.inspectOperation(local.pending.operationId);
  const matches = row => row && row.operationId === local.pending.operationId && row.batchSha256 === local.pending.batchSha256 && row.store === store;
  if ((remote.pending && !matches(remote.pending)) || (remote.acknowledged && !matches(remote.acknowledged)) ||
      (remote.dispatched && !matches(remote.dispatched))) fail();
  const classification = remote.acknowledged ? 'remote-acknowledged-local-pending' : remote.dispatched ? 'remote-dispatched-unresolved' :
    remote.pending ? 'remote-pending-unresolved' : 'remote-not-observed-unresolved';
  return { classification, local, remote, store, replayAllowed: false, productionReady: false };
}

/** Only a confirmed remote ACK plus a provably exited same-host process permits
 * a local log repair. Pending/missing provider outcomes require other recovery.
 * A crash during this repair retains the recovery lock for independent review.
 */
export async function recoverAcknowledgedProductionImport({ journalPath, coordinator }) {
  const attempt = await inspectProductionImportAttempt({ journalPath, coordinator });
  const { local, remote } = attempt, owner = local.lock?.owner;
  if (attempt.classification !== 'remote-acknowledged-local-pending' || !owner ||
      owner.operationId !== local.pending.operationId || owner.hostHash !== importJournalHostHash() ||
      remote.active !== 0 || remote.fenceOwner !== local.identity.runId || remote.state?.pending !== null) fail();
  try { process.kill(owner.processId, 0); fail(); } catch (error) { if (error.code !== 'ESRCH') fail(); }
  const lockPath = journalPath + '.recovery.lock';
  const recovery = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let complete = false;
  async function syncDirectory() { const dir = await open(dirname(journalPath), constants.O_RDONLY); try { await dir.sync(); } finally { await dir.close(); } }
  try {
    await recovery.writeFile(JSON.stringify({ operationId: local.pending.operationId, processId: process.pid }) + '\n');
    await recovery.sync(); await syncDirectory();
    const again = await inspectProductionImportAttempt({ journalPath, coordinator });
    if (again.classification !== attempt.classification || again.local.journalSha256 !== local.journalSha256 ||
        again.local.dev !== local.dev || again.local.ino !== local.ino ||
        again.local.lock?.dev !== local.lock.dev || again.local.lock?.ino !== local.lock.ino ||
        again.remote.active !== 0 || again.remote.fenceOwner !== local.identity.runId || again.remote.state?.pending !== null) fail();
    const recoveryProofSha256 = hash(JSON.stringify({ identity: local.identity, operation: again.remote.acknowledged,
      manifestSha256: again.remote.state.manifestSha256, incarnationsSha256: again.remote.state.incarnationsSha256 }));
    const file = await open(journalPath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (stat.dev !== local.dev || stat.ino !== local.ino || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) fail();
      await file.writeFile(JSON.stringify({ type: 'acknowledged', operationId: local.pending.operationId, recoveryProofSha256 }) + '\n');
      await file.sync();
    } finally { await file.close(); }
    await unlink(journalPath + '.lock'); await syncDirectory();
    complete = true;
    return { localAcknowledgementRecovered: true, operationId: local.pending.operationId, recoveryProofSha256,
      providerWrites: 0, remoteJournalWrites: 0, replayAllowed: false, productionReady: false };
  } finally { await recovery.close(); if (complete) { await unlink(lockPath); await syncDirectory(); } }
}

/** Inspect every retained journal against the same remote epoch. A coherent
 * log is not proof of row/object contents, source freeze or stage completion.
 */
export async function inspectProductionImportSet({ journalPaths, coordinator }) {
  const stores = ['auth', 'avatars', 'business', 'covers', 'master'];
  if (!isProductionImportCoordinator(coordinator) || !journalPaths ||
      Object.keys(journalPaths).sort().join(',') !== stores.join(',') ||
      Object.values(journalPaths).some(path => typeof path !== 'string' || !isAbsolute(path)) ||
      new Set(Object.values(journalPaths)).size !== stores.length) fail();
  const paths = { ...journalPaths }, before = await coordinator.inspect(), seen = new Set();
  const snapshots = {}, reports = {};
  let acknowledged = 0, pendingCount = 0, lockCount = 0, globalPendingObserved = false;
  for (const store of stores) {
    const local = await inspectProductionImportJournal(paths[store]);
    if (targetStore(local.identity, coordinator) !== store) fail();
    snapshots[store] = local;
    for (const operation of [...local.operations, ...(local.pending ? [local.pending] : [])]) {
      if (seen.has(operation.operationId)) fail();
      seen.add(operation.operationId);
      const remote = await coordinator.inspectOperation(operation.operationId);
      const matches = row => row && row.operationId === operation.operationId &&
        row.batchSha256 === operation.batchSha256 && row.store === store;
      if ([remote.pending, remote.acknowledged, remote.dispatched].some(row => row && !matches(row)) ||
          (operation.acknowledged && !matches(remote.acknowledged))) fail();
      if (remote.acknowledged) acknowledged++;
      if (matches(remote.pending)) globalPendingObserved = true;
    }
    pendingCount += Number(local.pending !== null); lockCount += Number(local.lock !== null);
    reports[store] = { localAcknowledged: local.operations.length, localPending: local.pending !== null,
      lockRetained: local.lock !== null, journalSha256: local.journalSha256 };
  }
  const after = await coordinator.inspect();
  if (JSON.stringify(before) !== JSON.stringify(after) || acknowledged !== (after.state?.acknowledged ?? 0) ||
      (after.state?.pending != null && !globalPendingObserved)) fail();
  for (const store of stores) {
    const now = await inspectProductionImportJournal(paths[store]), previous = snapshots[store];
    if (now.dev !== previous.dev || now.ino !== previous.ino || now.journalSha256 !== previous.journalSha256 ||
        JSON.stringify(now.lock) !== JSON.stringify(previous.lock)) fail();
  }
  return { format: 'fanmark-production-import-set-inspection-v1', stores: reports,
    remoteStateSha256: hash(JSON.stringify(after)), remoteAcknowledged: acknowledged, localPendingCount: pendingCount, retainedLockCount: lockCount,
    journalsReconciled: !!after.state && after.active === 0 && after.fenceOwner === coordinator.owner &&
      after.state.pending === null && pendingCount === 0 && lockCount === 0,
    providerWrites: 0, remoteJournalWrites: 0, sourceFreezeVerified: false,
    fullMigrationReconciled: false, replayAllowed: false, productionReady: false };
}

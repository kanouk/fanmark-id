/** All-store readback, local rehearsal and explicit coordinated production
 * execution. Source freeze and public release remain separate operator steps.
 */
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { canonicalJson, sha256Hex } from './snapshot-format.mjs';
import { verifySnapshot } from './snapshot-verify.mjs';
import { projectMasterSnapshot, MASTER_SOURCE_TABLES } from './master-snapshot-projection.mjs';
import { prepareAuthImportProjection, verifyImportedAuthProjection } from './auth-import-readback.mjs';
import { verifyImportedMasterProjection } from './master-import-readback.mjs';
import { verifyImportedD1Snapshot, importInitialBusinessSnapshot } from './d1-import.mjs';
import { importAuthProjectionStage, prepareAtomicAuthImportBatch } from './auth-import-stage.mjs';
import { importMasterProjectionStage } from './master-import-stage.mjs';
import { importInitialSplitR2Export } from './split-r2-import-stage.mjs';
import { prepareStorageImportReadback,resolveStorageImportReportPath } from './storage-r2-import.mjs';
import { verifyImportedSplitR2Export } from './split-r2-import-stage.mjs';
import { verifyProductionSplitR2Export, importProductionSplitR2Export } from './production-r2-import-stage.mjs';
import { isProductionRemoteD1 } from './production-remote-d1.mjs';
import { isIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { isProductionRemoteR2 } from './production-remote-r2.mjs';
import { isProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { inspectProductionImportSet, inspectProductionImportAttempt, recoverAcknowledgedProductionImport, importJournalHostHash } from './production-import-inspection.mjs';
import { prepareStripeReceiptTransfer, importStripeReceiptTransfer, verifyStripeReceiptTransfer } from './stripe-receipt-transfer.mjs';
import {createImportExecutionLock,recoverExitedImportExecution} from './production-import-execution-lock.mjs';

const plans = new WeakMap(), UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const stores = ['auth', 'avatars', 'business', 'covers', 'master'];
const fail = code => { throw Error('initial_import_set_' + code); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Master is derived from the very same verified Business export, not supplied
 * independently. Auth ciphertext is captured once, never regenerated to compare.
 * The descriptor binds inputs/targets, but does not certify final-source custody.
 */
async function prepareSet({ manifestPath, storageExportDir, authProjection, approvedEmojiIdentity,
  runId, incarnations, activationIds, businessDestinationId, expectedTargetProfile, sourceEvidenceSha256 = null, stripeReceiptExport = null } = {}) {
  if (![manifestPath, storageExportDir].every(path => typeof path === 'string' && isAbsolute(path)) || !UUID.test(runId ?? '') ||
      !incarnations || Object.keys(incarnations).sort().join(',') !== stores.join(',') ||
      Object.values(incarnations).some(value => !UUID.test(value)) || new Set(Object.values(incarnations)).size !== 5 ||
      !activationIds || Object.keys(activationIds).sort().join(',') !== 'emoji,reference' ||
      Object.values(activationIds).some(value => !UUID.test(value)) || activationIds.emoji === activationIds.reference ||
      typeof businessDestinationId !== 'string' || !businessDestinationId || !expectedTargetProfile) fail('identity_invalid');
  if (sourceEvidenceSha256 !== null && !/^[a-f0-9]{64}$/u.test(sourceEvidenceSha256)) fail('source_evidence_hash_invalid');
  const receipts = stripeReceiptExport === null ? null : structuredClone(stripeReceiptExport);
  const receiptProjection = receipts === null ? null : await prepareStripeReceiptTransfer(receipts,{runId});
  const auth = prepareAuthImportProjection(authProjection).expected;
  const identity = structuredClone({ runId, incarnations, activationIds, businessDestinationId });
  const profile = structuredClone(expectedTargetProfile);
  const verified = await verifySnapshot(manifestPath), bytes = await readFile(manifestPath), manifest = JSON.parse(bytes);
  if (manifest.runId !== verified.runId) fail('source_changed');
  const base = dirname(manifestPath), catalog = JSON.parse(await readFile(join(base, 'catalog.json'), 'utf8'));
  const selected = [];
  for (const name of MASTER_SOURCE_TABLES) {
    const entry = manifest.tables.find(row => row.table === name);
    if (!entry) fail('master_source_missing');
    selected.push({ entry, stream: await readFile(join(base, entry.file)) });
  }
  const master = projectMasterSnapshot({ catalog, tables: selected, approvedEmojiIdentity, credentialDescriptor: manifest.credentialDescriptor });
  const users = new Set(auth.tables.user.map(row => row.id)), authNames = new Map(auth.tables.user.map(row => [row.id, row.name]));
  for (const name of ['user_settings', 'user_roles']) {
    const entry = manifest.tables.find(row => row.table === name);
    if (!entry) fail('auth_source_missing');
    const stream = await readFile(join(base, entry.file));
    if (sha256Hex(stream) !== entry.streamHash) fail('source_changed');
    const rows = stream.length ? stream.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line).envelope.values) : [];
    if (rows.some(row => !users.has(row.user_id))) fail('auth_source_orphan');
    if (name === 'user_settings' && (rows.some(row => authNames.get(row.user_id) !== (row.display_name?.trim() || '')) || !same(rows.map(row => row.user_id).sort(), [...users].sort()) ||
        !same(rows.filter(row => row.plan_type === 'admin').map(row => row.user_id).sort(), auth.tables.adminRole.map(row => row.userId).sort()))) fail('auth_settings_mismatch');
    if (name === 'user_roles' && !same(rows.filter(row => row.role === 'admin').map(row => row.user_id).sort(),
        auth.tables.adminRole.map(row => row.userId).sort())) fail('auth_roles_mismatch');
  }
  const storage = await prepareStorageImportReadback({ exportDir: storageExportDir });
  const descriptor = { format: 'fanmark-initial-import-set-v1', ...identity, sourceEvidenceSha256,
    stripeReceiptExportSha256:receiptProjection?.sourceSha256??null,
    businessManifestSha256: sha256Hex(bytes), authProjectionSha256: sha256Hex(auth),
    masterProjectionSha256: sha256Hex(master), storageManifestSha256: storage.manifestSHA256,
    expectedTargetProfileSha256: sha256Hex(profile) };
  const prepared = Object.freeze({ identitySha256: sha256Hex(descriptor), runId,
    sourceFreezeVerified: false, productionReady: false });
  plans.set(prepared, { descriptor, auth, master, profile, manifestPath, storageExportDir, receipts });
  return prepared;
}

function authResolver(database) {
  return async function resolveAuthUserIds(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) fail('auth_reference_invalid');
    const found = new Set();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const part = ids.slice(offset, offset + 100);
      const rows = await database.prepare(`SELECT id FROM "user" WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      if (rows?.success !== true || rows.meta?.rows_written !== 0 || !Array.isArray(rows.results) ||
          rows.results.some(row => Object.keys(row).join(',') !== 'id' || !part.includes(row.id) || found.has(row.id))) fail('auth_reference_unconfirmed');
      for (const row of rows.results) found.add(row.id);
    }
    return found;
  };
}

async function verifySet({ prepared, databases, buckets, mode = 'local', coordinator, journalPaths } = {}) {
  const plan = plans.get(prepared);
  if (!plan || !['local', 'production-stage'].includes(mode)) fail('plan_invalid');
  const db = Object.fromEntries(['auth', 'master', 'business'].map(store => [store, databases?.[store]]));
  const images = { avatars: buckets?.avatars, covers: buckets?.covers }, { descriptor } = plan;
  const pinnedJournalPaths = journalPaths === undefined ? undefined : { ...journalPaths };
  if (new Set(Object.values(db)).size !== 3 || Object.values(db).some(value => typeof value?.prepare !== 'function') ||
      !images.avatars || !images.covers || images.avatars === images.covers) fail('stores_invalid');
  const production = mode === 'production-stage';
  if (production) {
    if(!plan.receipts)fail('stripe_receipt_export_required');
    if (!isProductionImportCoordinator(coordinator) || coordinator.owner !== descriptor.runId ||
        coordinator.manifestSha256 !== prepared.identitySha256 || !same(coordinator.incarnations, descriptor.incarnations)) fail('coordinator_invalid');
    for (const [store, database] of Object.entries(db)) if (!isProductionRemoteD1(database) || database.access !== 'read-only' ||
        database.targetIdentity.store !== store ||
        database.targetIdentity.targetIncarnation !== descriptor.incarnations[store]) fail('transport_invalid');
    if (db.business.targetIdentity.databaseId !== descriptor.businessDestinationId) fail('target_invalid');
    for (const [store, bucket] of Object.entries(images)) if (!isProductionRemoteR2(bucket) || bucket.access !== 'read-only' ||
        bucket.targetIdentity.store !== store || bucket.targetIdentity.targetIncarnation !== descriptor.incarnations[store]) fail('transport_invalid');
  } else if (Object.values(db).some(value => isProductionRemoteD1(value) || isIsolatedRemoteD1(value)) ||
      Object.values(images).some(isProductionRemoteR2) || coordinator !== undefined || journalPaths !== undefined) fail('transport_invalid');
  async function source() {
    await verifySnapshot(plan.manifestPath);
    if (sha256Hex(await readFile(plan.manifestPath)) !== descriptor.businessManifestSha256 ||
        (await prepareStorageImportReadback({ exportDir: plan.storageExportDir })).manifestSHA256 !== descriptor.storageManifestSha256) fail('source_changed');
  }
  async function fence() {
    const result = await inspectProductionImportSet({ journalPaths: pinnedJournalPaths, coordinator });
    if (!result.journalsReconciled || result.remoteAcknowledged === 0) fail('journals_unresolved');
    return result;
  }
  await source();
  const before = production ? await fence() : null;
  const auth = await verifyImportedAuthProjection({ database: db.auth, projection: plan.auth, targetIncarnation: descriptor.incarnations.auth });
  const master = await verifyImportedMasterProjection({ database: db.master, projection: plan.master,
    targetIncarnation: descriptor.incarnations.master, activationIds: descriptor.activationIds });
  // Actual Auth readback resolves every referenced Business identity. Never
  // accept a caller's permissive resolver or email-based identity replacement.
  const resolveAuthUserIds = authResolver(db.auth);
  const business = await verifyImportedD1Snapshot({ manifestPath: plan.manifestPath, database: db.business,
    destinationId: descriptor.businessDestinationId, targetIncarnation: descriptor.incarnations.business,
    canonicalBusinessSchema: true, expectedTargetProfile: plan.profile, resolveAuthUserIds });
  const receipts = plan.receipts === null ? null : await verifyStripeReceiptTransfer({source:plan.receipts,
    database:db.business,runId:descriptor.runId,targetIncarnation:descriptor.incarnations.business});
  const storage = await (production ? verifyProductionSplitR2Export : verifyImportedSplitR2Export)({ exportDir: plan.storageExportDir, buckets: images });
  await source();
  // Auth/Master may be individually valid at different times: repeat their
  // comparison and retain the global production journal/fence around all reads.
  await verifyImportedAuthProjection({ database: db.auth, projection: plan.auth, targetIncarnation: descriptor.incarnations.auth });
  await verifyImportedMasterProjection({ database: db.master, projection: plan.master, targetIncarnation: descriptor.incarnations.master, activationIds: descriptor.activationIds });
  const after = production ? await fence() : null;
  if (!same(before, after)) fail('journals_changed');
  const report = { format: 'fanmark-initial-import-set-readback-v1', identitySha256: prepared.identitySha256,
    allExpectedStoreContentsMatched: true, auth, master, business, receipts, storage,
    journalInspectionSha256: before ? sha256Hex(before) : null,
    consistency: production ? 'held-import-fence-readback' : 'unfenced-local-readback',
    sourceFreezeVerified: false, fullMigrationReconciled: false, productionReady: false,
    providerWrites: 0, coordinatorCompleted: false };
  return { ...report, readbackSha256: sha256Hex(report) };
}

// Filesystem/JSON/provider exception text can contain private source material.
// Preserve only this module's bounded codes or known checker namespaces.
function safeError(error, fallback) {
  if (/^(?:initial_import_set|auth_import_readback|master_import_readback|split_r2_import|production_import_inspection|production_r2_transport|stripe_receipt_transfer)_[a-z0-9_]{1,90}$/u.test(error?.message ?? '')) throw error;
  fail(fallback);
}
export async function prepareInitialImportSet(options) {
  try { return await prepareSet(options); } catch (error) { safeError(error, 'preparation_unconfirmed'); }
}
export async function verifyInitialImportSet(options) {
  try { return await verifySet(options); } catch (error) { safeError(error, 'readback_unconfirmed'); }
}


// The rehearsal entry point remains local-only. Production execution is a
// separate explicit entry point with remote executor ownership and all journals.
const rehearsals = new WeakSet();
export async function rehearseInitialImportSet(options = {}) {
  try { return await rehearseSet(options); }
  catch (error) { safeError(error, 'rehearsal_unconfirmed'); }
}
async function rehearseSet({ prepared, databases, readDatabases, buckets, readBuckets,
  businessReportPath, storageReportPath, resumeAfter = null, stopAfter = 'storage', ...extra } = {}, execution = null) {
  const plan = plans.get(prepared), stages = ['auth', 'master', 'business', ...(plan?.receipts?['receipts']:[]), 'storage'];
  if (!plan || Object.keys(extra).length || (resumeAfter !== null && !stages.includes(resumeAfter)) ||
      !stages.includes(stopAfter) || stages.indexOf(resumeAfter) > stages.indexOf(stopAfter)) fail('rehearsal_options_invalid');
  const write = { ...databases }, read = { ...readDatabases }, images = { ...buckets }, imageRead = { ...readBuckets };
  if ([write, read].some(group => Object.keys(group).sort().join(',') !== 'auth,business,master' ||
      new Set(Object.values(group)).size !== 3 || Object.values(group).some(db =>
        typeof db?.prepare !== 'function' || typeof db?.batch !== 'function' || (!execution && (isProductionRemoteD1(db) || isIsolatedRemoteD1(db))))) ||
      [images, imageRead].some(group => Object.keys(group).sort().join(',') !== 'avatars,covers' ||
        !group.avatars || !group.covers || group.avatars === group.covers || (!execution && Object.values(group).some(isProductionRemoteR2))) ||
      ![businessReportPath, storageReportPath].every(path => typeof path === 'string' && isAbsolute(path)) ||
      businessReportPath === storageReportPath) fail('rehearsal_transport_or_paths_invalid');
  // Reject a wrong report destination before Auth/Master/Business can write.
  resolveStorageImportReportPath(plan.storageExportDir,storageReportPath);
  // One attempt per in-memory plan. Reconstructing a plan after interruption
  // still requires full content readback of every explicitly skipped stage.
  if (rehearsals.has(prepared)) fail('rehearsal_already_attempted');
  rehearsals.add(prepared);
  const { descriptor } = plan, resolveAuthUserIds = authResolver(read.auth);
  async function sourceUnchanged() {
    await execution?.verifyEvidence();
    await verifySnapshot(plan.manifestPath);
    if (sha256Hex(await readFile(plan.manifestPath)) !== descriptor.businessManifestSha256 ||
      (await prepareStorageImportReadback({ exportDir: plan.storageExportDir })).manifestSHA256 !== descriptor.storageManifestSha256) fail('source_changed');
  }
  const mode = execution ? 'production-stage' : 'local';
  const auth = { projection: plan.auth, targetIncarnation: descriptor.incarnations.auth };
  const master = { projection: plan.master, targetIncarnation: descriptor.incarnations.master, activationIds: descriptor.activationIds };
  const business = { manifestPath: plan.manifestPath, destinationId: descriptor.businessDestinationId,
    targetIncarnation: descriptor.incarnations.business, expectedTargetProfile: plan.profile, resolveAuthUserIds };
  const receiptOptions={source:plan.receipts,runId:descriptor.runId,targetIncarnation:descriptor.incarnations.business};
  const checks = {
    auth: () => verifyImportedAuthProjection({ ...auth, database: read.auth }),
    master: () => verifyImportedMasterProjection({ ...master, database: read.master }),
    business: () => verifyImportedD1Snapshot({ ...business, database: read.business, canonicalBusinessSchema: true }),
    receipts: () => verifyStripeReceiptTransfer({...receiptOptions,database:read.business}),
    storage: () => (execution ? verifyProductionSplitR2Export : verifyImportedSplitR2Export)({ exportDir: plan.storageExportDir, buckets: imageRead }),
  };
  const imports = {
    auth: () => importAuthProjectionStage({ ...auth, mode, database: write.auth, readDatabase: read.auth }),
    master: () => importMasterProjectionStage({ ...master, mode, database: write.master, readDatabase: read.master }),
    business: () => importInitialBusinessSnapshot({ ...business, mode, database: write.business, readDatabase: read.business,
      reportPath: businessReportPath, allowUnresolvedGates: true }),
    receipts: () => importStripeReceiptTransfer({...receiptOptions,mode,database:write.business,readDatabase:read.business}),
    storage: () => (execution ? importProductionSplitR2Export : importInitialSplitR2Export)({ exportDir: plan.storageExportDir, buckets: images, readBuckets: imageRead, reportPath: storageReportPath }),
  };
  const completed = [], resumed = [], reports = {};
  await sourceUnchanged();
  await execution?.verifyJournal();
  // Check the whole requested prefix before any new stage may write.
  for (const stage of stages.slice(0, stages.indexOf(resumeAfter) + 1)) {
    reports[stage] = await checks[stage](); resumed.push(stage); completed.push(stage);
  }
  for (const stage of stages.slice(completed.length, stages.indexOf(stopAfter) + 1)) {
    await sourceUnchanged();
    await execution?.verifyJournal();
    reports[stage] = await imports[stage](); completed.push(stage);
    await execution?.verifyJournal();
  }
  await sourceUnchanged();
  const readback = stopAfter === 'storage' ? await verifySet({ prepared, databases: read, buckets: imageRead, ...(execution ? { mode, coordinator: execution.coordinator, journalPaths: execution.journalPaths } : {}) }) : null;
  return { format: execution ? 'fanmark-initial-import-set-execution-v1' : 'fanmark-initial-import-set-rehearsal-v1', identitySha256: prepared.identitySha256,
    completedStages: completed, verifiedBeforeResume: resumed, reports, readback,
    consistency: execution ? 'held-import-fence-execution' : 'unfenced-local-rehearsal', sourceFreezeVerified: false, productionReady: false,
    coordinatorCompleted: false, remoteExecutionSupported: !!execution };
}


/** Explicit production entry. Source evidence is pinned, not certified by this
 * runner: the operator must verify all ingress stop/drain/Stripe handoff first.
 * No claim, public release, source resume, cleanup or unknown-outcome retry.
 */
export async function executeInitialImportSet(options = {}) {
  try { return await executeSet(options); }
  catch (error) { safeError(error, 'execution_unconfirmed'); }
}
async function executeSet({ coordinator, journalPaths, sourceEvidencePath, ...options } = {}) {
  const plan = plans.get(options.prepared), paths = { ...journalPaths };
  if(plan && !plan.receipts)fail('stripe_receipt_export_required');
  if (!plan || !plan.descriptor.sourceEvidenceSha256 || !isAbsolute(sourceEvidencePath ?? '') ||
      !isProductionImportCoordinator(coordinator) || coordinator.owner !== plan.descriptor.runId ||
      coordinator.manifestSha256 !== options.prepared.identitySha256 ||
      !same(coordinator.incarnations, plan.descriptor.incarnations) ||
      Object.keys(paths).sort().join(',') !== stores.join(',') ||
      new Set(Object.values(paths)).size !== 5 || Object.values(paths).some(path => !isAbsolute(path ?? '')) ||
      new Set(Object.values(paths).map(path => dirname(path))).size !== 1) fail('execution_identity_invalid');
  // Capture all connection references before awaiting. Every writer must use
  // THIS coordinator and exactly the journal inspected below, not another run.
  const captured = { ...options, databases: { ...options.databases }, readDatabases: { ...options.readDatabases },
    buckets: { ...options.buckets }, readBuckets: { ...options.readBuckets } };
  resolveStorageImportReportPath(plan.storageExportDir,captured.storageReportPath);
  for (const store of stores) {
    const image = ['avatars', 'covers'].includes(store), write = (image ? captured.buckets : captured.databases)[store];
    const read = (image ? captured.readBuckets : captured.readDatabases)[store];
    const branded = image ? isProductionRemoteR2 : isProductionRemoteD1;
    if (!branded(write) || !branded(read) || write.access !== 'import' || read.access !== 'read-only' ||
        write.credentialPolicy !== 'lease-v1' || read.credentialPolicy !== 'lease-v1' ||
        (store === 'master' && write.masterCommitPolicy !== 'atomic-receipt-v1') ||
        !same(write.targetIdentity, read.targetIdentity) || write.targetIdentity.targetIncarnation !== plan.descriptor.incarnations[store] ||
        write.targetIdentity.store !== store ||
        write.importContext?.coordinator !== coordinator || write.importContext.journalPath !== paths[store] ||
        write.importContext.runId !== plan.descriptor.runId) fail('execution_transport_invalid');
    if (store === 'business' && write.targetIdentity.databaseId !== plan.descriptor.businessDestinationId) fail('execution_target_invalid');
  }
  async function verifyEvidence() {
    const file = await open(sourceEvidencePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 4 * 1024 * 1024) fail('source_evidence_file_invalid');
      const bytes = await file.readFile(), after = await file.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || sha256Hex(bytes) !== plan.descriptor.sourceEvidenceSha256) fail('source_evidence_changed');
    } finally { await file.close(); }
  }
  async function verifyJournal() {
    const report = await inspectProductionImportSet({ journalPaths: paths, coordinator });
    if (!report.journalsReconciled) fail('journals_unresolved');
  }
  await verifyEvidence();
  await verifyJournal();
  for (const binding of [...Object.values(captured.databases), ...Object.values(captured.readDatabases),
    ...Object.values(captured.buckets), ...Object.values(captured.readBuckets)]) await binding.verifyProductionTarget();
  // Acquire exactly once. If its response is lost, remote ownership remains;
  // another client, even with the same run identity, cannot continue writing.
  const ownership = await createImportExecutionLock({directory:dirname(paths.auth),runId:plan.descriptor.runId,
    manifestSha256:options.prepared.identitySha256,sourceEvidenceSha256:plan.descriptor.sourceEvidenceSha256});
  const acquired = await coordinator.acquireExecution(ownership.executorId);
  const report = await rehearseSet(captured, { coordinator, journalPaths: paths, verifyEvidence, verifyJournal });
  await verifyEvidence(); await verifyJournal();
  // Persist the exact comparison before the remote completion/yield. A lost
  // completion response must leave enough evidence for independent inspection.
  const executionReportPath = join(dirname(paths.auth), 'initial-set-' + acquired.executorId + '.json');
  const file = await open(executionReportPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify({ format: 'fanmark-initial-import-attempt-v1', executorId: acquired.executorId,
      runId: plan.descriptor.runId, sourceEvidenceSha256: plan.descriptor.sourceEvidenceSha256, report }) + '\n');
    await file.sync();
  } finally { await file.close(); }
  const directory = await open(dirname(executionReportPath), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
  if (report.readback) {
    await coordinator.complete(report.readback.readbackSha256);
    await ownership.release();
    return { ...report, executionReportPath, coordinatorCompleted: true, sourceEvidenceSha256: plan.descriptor.sourceEvidenceSha256 };
  }
  await coordinator.yieldExecution(sha256Hex(report));
  await ownership.release();
  return { ...report, executionReportPath, executorYielded: true, sourceEvidenceSha256: plan.descriptor.sourceEvidenceSha256 };
}

/** Reclaim a dead same-host executor at a fully verified stage boundary.
 * This never resolves a pending write or resumes a partially imported stage.
 * Reconstruct the prepared plan and connections before the next execution.
 */
export async function recoverInitialImportExecution(options = {}) {
  return recoverImportExecution(options, false);
}

/** Resolve only the first atomic Auth write, after full content readback.
 * No replay, deletion, general partial-stage recovery or provider writes.
 */
export async function recoverInitialAuthImportExecution(options = {}) {
  return recoverImportExecution(options, true);
}
async function recoverImportExecution({prepared,coordinator,journalPaths,sourceEvidencePath,readDatabases,readBuckets,resumeAfter}={}, recoverAuth){
  try{
    const plan=plans.get(prepared),paths={...journalPaths},databases={...readDatabases},buckets={...readBuckets};
    const stages=['auth','master','business','receipts','storage'];
    if(!plan?.receipts||!plan.descriptor.sourceEvidenceSha256||!stages.includes(resumeAfter)||(recoverAuth&&resumeAfter!=='auth')||
      !isProductionImportCoordinator(coordinator)||coordinator.owner!==plan.descriptor.runId||
      coordinator.manifestSha256!==prepared.identitySha256||!same(coordinator.incarnations,plan.descriptor.incarnations)||
      Object.keys(paths).sort().join(',')!==stores.join(',')||new Set(Object.values(paths)).size!==5||
      Object.values(paths).some(path=>!isAbsolute(path??''))||new Set(Object.values(paths).map(dirname)).size!==1||
      !isAbsolute(sourceEvidencePath??''))fail('recovery_identity_invalid');
    for(const store of stores){
      const image=['avatars','covers'].includes(store),binding=(image?buckets:databases)[store];
      if(!(image?isProductionRemoteR2:isProductionRemoteD1)(binding)||binding.access!=='read-only'||
        binding.targetIdentity.targetIncarnation!==plan.descriptor.incarnations[store]||
        (image?binding.targetIdentity.store!==store:binding.targetIdentity.store !== store))fail('recovery_transport_invalid');
    }
    const directory=dirname(paths.auth);
    const verifyEvidence=async()=>{
      const file=await open(sourceEvidencePath,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const stat=await file.stat();
        if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size>4*1024*1024)fail('source_evidence_file_invalid');
        const bytes=await file.readFile(),after=await file.stat();
        if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||sha256Hex(bytes)!==plan.descriptor.sourceEvidenceSha256)fail('source_evidence_changed');
      }finally{await file.close();}
    };
    const verifyJournal=async()=>{const result=await inspectProductionImportSet({journalPaths:paths,coordinator});if(!result.journalsReconciled)fail('journals_unresolved');return result;};
    return await recoverExitedImportExecution({directory,runId:plan.descriptor.runId,manifestSha256:prepared.identitySha256,
      sourceEvidenceSha256:plan.descriptor.sourceEvidenceSha256,
      verify:async (executorId,executionOwner)=>{
        await verifyEvidence();const before=await coordinator.inspect();
        if(before.executorId!==executorId||(!recoverAuth&&before.state?.pending!==null)||before.state?.readbackSha256!==null||
          before.active!==0||before.fenceOwner!==coordinator.owner)fail('recovery_remote_state_invalid');
        if(recoverAuth){
          if(before.state?.pending?.store!=='auth'||before.state.acknowledged!==0)fail('recovery_auth_state_invalid');
          const journals=await inspectProductionImportSet({journalPaths:paths,coordinator});
          if(journals.remoteAcknowledged!==0||journals.localPendingCount!==1||journals.retainedLockCount!==1||
            Object.values(journals.stores).some(row=>row.localAcknowledged!==0))fail('recovery_auth_history_invalid');
          const attempt=await inspectProductionImportAttempt({journalPath:paths.auth,coordinator});
          const owner=attempt.local.lock?.owner;
          const checkExited=()=>{
            if(!owner||owner.hostHash!==importJournalHostHash()||owner.processId!==executionOwner.processId||
              owner.hostHash!==executionOwner.hostHash||owner.operationId!==attempt.local.pending?.operationId)fail('recovery_auth_owner_invalid');
            try{process.kill(owner.processId,0);fail('recovery_auth_owner_alive');}catch(error){if(error.code!=='ESRCH')throw error;}
          };
          checkExited();
          const batchSha256=sha256Hex(JSON.stringify(prepareAtomicAuthImportBatch(plan.auth).items));
          if(attempt.classification!=='remote-pending-unresolved'||attempt.local.pending.batchSha256!==batchSha256||
            !same(attempt.remote.state,before.state)||attempt.remote.executorId!==executorId)fail('recovery_auth_batch_invalid');
          for(const binding of [...Object.values(databases),...Object.values(buckets)])await binding.verifyProductionTarget();
          await verifySnapshot(plan.manifestPath);
          if(sha256Hex(await readFile(plan.manifestPath))!==plan.descriptor.businessManifestSha256||
            (await prepareStorageImportReadback({exportDir:plan.storageExportDir})).manifestSHA256!==plan.descriptor.storageManifestSha256)fail('source_changed');
          const auth=await verifyImportedAuthProjection({database:databases.auth,projection:plan.auth,targetIncarnation:plan.descriptor.incarnations.auth});
          await verifyEvidence();
          const again=await inspectProductionImportAttempt({journalPath:paths.auth,coordinator});
          if(!same(attempt,again)||!same(journals,await inspectProductionImportSet({journalPaths:paths,coordinator}))||
            !same(before,await coordinator.inspect()))fail('recovery_remote_state_changed');
          checkExited();
          const proof={executorId,acknowledged:1,resumeAfter:'auth',operation:before.state.pending,auth,journals,
            providerWrites:0,sourceFreezeVerified:false,productionReady:false};
          return {...proof,proofSha256:sha256Hex(proof)};
        }
        await verifyJournal();
        for(const binding of [...Object.values(databases),...Object.values(buckets)])await binding.verifyProductionTarget();
        const report=await rehearseSet({prepared,databases,readDatabases:databases,buckets,readBuckets:buckets,
          businessReportPath:join(directory,'recovery-business-unused.json'),storageReportPath:join(plan.storageExportDir,'recovery-storage-unused.json'),
          resumeAfter,stopAfter:resumeAfter},{coordinator,journalPaths:paths,verifyEvidence,verifyJournal});
        await verifyEvidence();const journals=await verifyJournal(),after=await coordinator.inspect();
        if(!same(before,after))fail('recovery_remote_state_changed');
        const proof={executorId,acknowledged:after.state.acknowledged,resumeAfter,report,journals};
        return {...proof,proofSha256:sha256Hex(proof)};
      },
      release:async(executorId,proof)=>{
        if(recoverAuth){
          await coordinator.recoverAuthAcknowledgement({executorId,...proof.operation,readbackSha256:proof.proofSha256});
          await recoverAcknowledgedProductionImport({journalPath:paths.auth,coordinator});
          await verifyEvidence();await verifyJournal();
          await verifyImportedAuthProjection({database:databases.auth,projection:plan.auth,targetIncarnation:plan.descriptor.incarnations.auth});
        }
        await coordinator.recoverExecution({executorId,acknowledged:proof.acknowledged,readbackSha256:proof.proofSha256});
        const after=await coordinator.inspect();
        if(after.executorId!==null||after.state?.pending!==null||after.state?.readbackSha256!==null||after.active!==0||
          after.state?.acknowledged!==proof.acknowledged||after.fenceOwner!==coordinator.owner)fail('recovery_release_unconfirmed');
      }});
  }catch(error){safeError(error,'recovery_unconfirmed');}
}

/** Independent all-store readback and local rehearsal bound to one immutable
 * input descriptor. Neither freezes a source nor admits a production import.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { canonicalJson, sha256Hex } from './snapshot-format.mjs';
import { verifySnapshot } from './snapshot-verify.mjs';
import { projectMasterSnapshot, MASTER_SOURCE_TABLES } from './master-snapshot-projection.mjs';
import { prepareAuthImportProjection, verifyImportedAuthProjection } from './auth-import-readback.mjs';
import { verifyImportedMasterProjection } from './master-import-readback.mjs';
import { verifyImportedD1Snapshot, importInitialBusinessSnapshot } from './d1-import.mjs';
import { importAuthProjectionStage } from './auth-import-stage.mjs';
import { importMasterProjectionStage } from './master-import-stage.mjs';
import { importInitialSplitR2Export } from './split-r2-import-stage.mjs';
import { prepareStorageImportReadback } from './storage-r2-import.mjs';
import { verifyImportedSplitR2Export } from './split-r2-import-stage.mjs';
import { verifyProductionSplitR2Export } from './production-r2-import-stage.mjs';
import { isProductionRemoteD1 } from './production-remote-d1.mjs';
import { isIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { isProductionRemoteR2 } from './production-remote-r2.mjs';
import { isProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { inspectProductionImportSet } from './production-import-inspection.mjs';

const plans = new WeakMap(), UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const stores = ['auth', 'avatars', 'business', 'covers', 'master'];
const fail = code => { throw Error('initial_import_set_' + code); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Master is derived from the very same verified Business export, not supplied
 * independently. Auth ciphertext is captured once, never regenerated to compare.
 * The descriptor binds inputs/targets, but does not certify final-source custody.
 */
async function prepareSet({ manifestPath, storageExportDir, authProjection, approvedEmojiIdentity,
  runId, incarnations, activationIds, businessDestinationId, expectedTargetProfile } = {}) {
  if (![manifestPath, storageExportDir].every(path => typeof path === 'string' && isAbsolute(path)) || !UUID.test(runId ?? '') ||
      !incarnations || Object.keys(incarnations).sort().join(',') !== stores.join(',') ||
      Object.values(incarnations).some(value => !UUID.test(value)) || new Set(Object.values(incarnations)).size !== 5 ||
      !activationIds || Object.keys(activationIds).sort().join(',') !== 'emoji,reference' ||
      Object.values(activationIds).some(value => !UUID.test(value)) || activationIds.emoji === activationIds.reference ||
      typeof businessDestinationId !== 'string' || !businessDestinationId || !expectedTargetProfile) fail('identity_invalid');
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
  const descriptor = { format: 'fanmark-initial-import-set-v1', ...identity,
    businessManifestSha256: sha256Hex(bytes), authProjectionSha256: sha256Hex(auth),
    masterProjectionSha256: sha256Hex(master), storageManifestSha256: storage.manifestSHA256,
    expectedTargetProfileSha256: sha256Hex(profile) };
  const prepared = Object.freeze({ identitySha256: sha256Hex(descriptor), runId,
    sourceFreezeVerified: false, productionReady: false });
  plans.set(prepared, { descriptor, auth, master, profile, manifestPath, storageExportDir });
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
    if (!isProductionImportCoordinator(coordinator) || coordinator.owner !== descriptor.runId ||
        coordinator.manifestSha256 !== prepared.identitySha256 || !same(coordinator.incarnations, descriptor.incarnations)) fail('coordinator_invalid');
    for (const [store, database] of Object.entries(db)) if (!isProductionRemoteD1(database) || database.access !== 'read-only' ||
        database.targetIdentity.databaseName !== 'fanmark-production-' + store ||
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
  const storage = await (production ? verifyProductionSplitR2Export : verifyImportedSplitR2Export)({ exportDir: plan.storageExportDir, buckets: images });
  await source();
  // Auth/Master may be individually valid at different times: repeat their
  // comparison and retain the global production journal/fence around all reads.
  await verifyImportedAuthProjection({ database: db.auth, projection: plan.auth, targetIncarnation: descriptor.incarnations.auth });
  await verifyImportedMasterProjection({ database: db.master, projection: plan.master, targetIncarnation: descriptor.incarnations.master, activationIds: descriptor.activationIds });
  const after = production ? await fence() : null;
  if (!same(before, after)) fail('journals_changed');
  const report = { format: 'fanmark-initial-import-set-readback-v1', identitySha256: prepared.identitySha256,
    allExpectedStoreContentsMatched: true, auth, master, business, storage,
    journalInspectionSha256: before ? sha256Hex(before) : null,
    consistency: production ? 'held-import-fence-readback' : 'unfenced-local-readback',
    sourceFreezeVerified: false, fullMigrationReconciled: false, productionReady: false,
    providerWrites: 0, coordinatorCompleted: false };
  return { ...report, readbackSha256: sha256Hex(report) };
}

// Filesystem/JSON/provider exception text can contain private source material.
// Preserve only this module's bounded codes or known checker namespaces.
function safeError(error, fallback) {
  if (/^(?:initial_import_set|auth_import_readback|master_import_readback|split_r2_import|production_import_inspection|production_r2_transport)_[a-z0-9_]{1,90}$/u.test(error?.message ?? '')) throw error;
  fail(fallback);
}
export async function prepareInitialImportSet(options) {
  try { return await prepareSet(options); } catch (error) { safeError(error, 'preparation_unconfirmed'); }
}
export async function verifyInitialImportSet(options) {
  try { return await verifySet(options); } catch (error) { safeError(error, 'readback_unconfirmed'); }
}


// This orchestration is deliberately local-only until source-stop custody and
// cross-process runner ownership are connected. Individual production stages
// remain separate; passing production transports here always rejects up front.
const rehearsals = new WeakSet();
export async function rehearseInitialImportSet(options = {}) {
  try { return await rehearseSet(options); }
  catch (error) { safeError(error, 'rehearsal_unconfirmed'); }
}
async function rehearseSet({ prepared, databases, readDatabases, buckets, readBuckets,
  businessReportPath, storageReportPath, resumeAfter = null, stopAfter = 'storage', ...extra } = {}) {
  const plan = plans.get(prepared), stages = ['auth', 'master', 'business', 'storage'];
  if (!plan || Object.keys(extra).length || (resumeAfter !== null && !stages.includes(resumeAfter)) ||
      !stages.includes(stopAfter) || stages.indexOf(resumeAfter) > stages.indexOf(stopAfter)) fail('rehearsal_options_invalid');
  const write = { ...databases }, read = { ...readDatabases }, images = { ...buckets }, imageRead = { ...readBuckets };
  if ([write, read].some(group => Object.keys(group).sort().join(',') !== 'auth,business,master' ||
      new Set(Object.values(group)).size !== 3 || Object.values(group).some(db =>
        typeof db?.prepare !== 'function' || typeof db?.batch !== 'function' || isProductionRemoteD1(db) || isIsolatedRemoteD1(db))) ||
      [images, imageRead].some(group => Object.keys(group).sort().join(',') !== 'avatars,covers' ||
        !group.avatars || !group.covers || group.avatars === group.covers || Object.values(group).some(isProductionRemoteR2)) ||
      ![businessReportPath, storageReportPath].every(path => typeof path === 'string' && isAbsolute(path)) ||
      businessReportPath === storageReportPath) fail('rehearsal_transport_or_paths_invalid');
  // One attempt per in-memory plan. Reconstructing a plan after interruption
  // still requires full content readback of every explicitly skipped stage.
  if (rehearsals.has(prepared)) fail('rehearsal_already_attempted');
  rehearsals.add(prepared);
  const { descriptor } = plan, resolveAuthUserIds = authResolver(read.auth);
  async function sourceUnchanged() {
    await verifySnapshot(plan.manifestPath);
    if (sha256Hex(await readFile(plan.manifestPath)) !== descriptor.businessManifestSha256 ||
      (await prepareStorageImportReadback({ exportDir: plan.storageExportDir })).manifestSHA256 !== descriptor.storageManifestSha256) fail('source_changed');
  }
  const auth = { projection: plan.auth, targetIncarnation: descriptor.incarnations.auth };
  const master = { projection: plan.master, targetIncarnation: descriptor.incarnations.master, activationIds: descriptor.activationIds };
  const business = { manifestPath: plan.manifestPath, destinationId: descriptor.businessDestinationId,
    targetIncarnation: descriptor.incarnations.business, expectedTargetProfile: plan.profile, resolveAuthUserIds };
  const checks = {
    auth: () => verifyImportedAuthProjection({ ...auth, database: read.auth }),
    master: () => verifyImportedMasterProjection({ ...master, database: read.master }),
    business: () => verifyImportedD1Snapshot({ ...business, database: read.business, canonicalBusinessSchema: true }),
    storage: () => verifyImportedSplitR2Export({ exportDir: plan.storageExportDir, buckets: imageRead }),
  };
  const imports = {
    auth: () => importAuthProjectionStage({ ...auth, database: write.auth, readDatabase: read.auth }),
    master: () => importMasterProjectionStage({ ...master, database: write.master, readDatabase: read.master }),
    business: () => importInitialBusinessSnapshot({ ...business, database: write.business, readDatabase: read.business,
      reportPath: businessReportPath, allowUnresolvedGates: true }),
    storage: () => importInitialSplitR2Export({ exportDir: plan.storageExportDir, buckets: images, readBuckets: imageRead, reportPath: storageReportPath }),
  };
  const completed = [], resumed = [], reports = {};
  await sourceUnchanged();
  // Check the whole requested prefix before any new stage may write.
  for (const stage of stages.slice(0, stages.indexOf(resumeAfter) + 1)) {
    reports[stage] = await checks[stage](); resumed.push(stage); completed.push(stage);
  }
  for (const stage of stages.slice(completed.length, stages.indexOf(stopAfter) + 1)) {
    await sourceUnchanged();
    reports[stage] = await imports[stage](); completed.push(stage);
  }
  await sourceUnchanged();
  const readback = stopAfter === 'storage' ? await verifySet({ prepared, databases: read, buckets: imageRead }) : null;
  return { format: 'fanmark-initial-import-set-rehearsal-v1', identitySha256: prepared.identitySha256,
    completedStages: completed, verifiedBeforeResume: resumed, reports, readback,
    consistency: 'unfenced-local-rehearsal', sourceFreezeVerified: false, productionReady: false,
    coordinatorCompleted: false, remoteExecutionSupported: false };
}

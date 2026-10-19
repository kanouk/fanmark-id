import { isProductionRemoteR2 } from './production-remote-r2.mjs';
import { prepareStorageImportReadback } from './storage-r2-import.mjs';
import { importInitialSplitR2Export, verifyImportedSplitR2Export } from './split-r2-import-stage.mjs';
import { MAX_IMPORT_OBJECT_BYTES } from '../../workers/api/src/production-r2-import-contract.ts';

const fail = () => { throw Error('production_r2_stage_unconfirmed'); };
async function verifyReaders(buckets) {
  for (const store of ['avatars', 'covers']) {
    const bucket = buckets?.[store];
    if (!isProductionRemoteR2(bucket) || bucket.access !== 'read-only' || bucket.targetIdentity.store !== store) fail();
    await bucket.verifyProductionTarget();
  }
  if (buckets.avatars.targetIdentity.runtimeVersion !== buckets.covers.targetIdentity.runtimeVersion) fail();
}
export async function verifyProductionSplitR2Export({ exportDir, buckets, ...options }) {
  await prepareStorageImportReadback({ exportDir, maxObjectBytes: MAX_IMPORT_OBJECT_BYTES });
  await verifyReaders(buckets);
  const report = await verifyImportedSplitR2Export({ ...options, exportDir, buckets });
  await verifyReaders(buckets);
  return { ...report, transportIdentityVerified: true, productionReady: false, sourceFreezeVerified: false, coordinatorCompleted: false };
}
export async function importProductionSplitR2Export({ exportDir, buckets, readBuckets, ...options }) {
  // Capacity is checked for EVERY source object before any remote write.
  await prepareStorageImportReadback({ exportDir, maxObjectBytes: MAX_IMPORT_OBJECT_BYTES });
  await verifyReaders(readBuckets);
  for (const store of ['avatars', 'covers']) {
    const bucket = buckets?.[store];
    if (!isProductionRemoteR2(bucket) || bucket.access !== 'import' ||
        JSON.stringify(bucket.targetIdentity) !== JSON.stringify(readBuckets[store].targetIdentity)) fail();
    await bucket.verifyProductionTarget();
  }
  const report = await importInitialSplitR2Export({ ...options, exportDir, buckets, readBuckets });
  await verifyReaders(readBuckets);
  return { ...report, transportIdentityVerified: true, productionReady: false };
}

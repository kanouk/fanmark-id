/** Initial split-bucket copy and independent readback. The caller supplies the
 * isolated bindings. This is not a production transport or a cross-store fence.
 * A failed initial copy is retained for inspection, never resumed or cleaned up.
 */
import { createHash } from 'node:crypto';
import { importStorageExport, prepareStorageImportReadback, verifyStorageImportReadback } from './storage-r2-import.mjs';
import { createSplitR2ImportTransport } from './split-r2-import-transport.mjs';
import { validateStorageKey } from './storage-export.mjs';

const fail = code => { throw Error('split_r2_import_' + code); };
const pairs = [['avatars', 'avatars'], ['covers', 'cover-images']];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key));

function readers(buckets) {
  if (!buckets || pairs.some(([store]) => !buckets[store] || typeof buckets[store].list !== 'function' ||
      typeof buckets[store].get !== 'function') || buckets.avatars === buckets.covers) fail('bindings_invalid');
  // Capture read capabilities before awaiting; verification cannot invoke put/delete.
  return Object.fromEntries(pairs.map(([store]) => [store, Object.freeze({
    get: buckets[store].get.bind(buckets[store]), list: buckets[store].list.bind(buckets[store]),
  })]));
}

async function inventory(buckets, pageSize, timeoutMs) {
  const all = {};
  for (const [store] of pairs) {
    const objects = [], keys = new Set(), cursors = new Set();
    let cursor;
    do {
      let page, timer;
      try {
        page = await Promise.race([buckets[store].list({ limit: pageSize, ...(cursor ? { cursor } : {}) }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), timeoutMs); })]);
      } catch { fail('inventory_unavailable'); } finally { clearTimeout(timer); }
      if (!page || !Array.isArray(page.objects) || page.objects.length > pageSize || typeof page.truncated !== 'boolean' ||
          (page.delimitedPrefixes?.length ?? 0) !== 0) fail('inventory_invalid');
      for (const object of page.objects) {
        try { validateStorageKey(object.key); } catch { fail('inventory_invalid'); }
        if (keys.has(object.key) || !Number.isSafeInteger(object.size) || object.size < 0 ||
            typeof object.etag !== 'string' || !object.etag || typeof object.version !== 'string' || !object.version) fail('inventory_invalid');
        keys.add(object.key);
        objects.push({ key: object.key, size: object.size, etag: object.etag, version: object.version });
        if (objects.length > 10000) fail('inventory_capacity_exceeded');
      }
      if (!page.truncated) break;
      if (typeof page.cursor !== 'string' || !page.cursor || cursors.has(page.cursor)) fail('inventory_cursor_invalid');
      cursors.add(page.cursor); cursor = page.cursor;
      if (cursors.size > 10000) fail('inventory_capacity_exceeded');
    } while (true);
    all[store] = objects.sort(compare);
  }
  return all;
}

function limits(pageSize, operationTimeoutMs) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
      !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 120000) fail('limits_invalid');
}

async function source(options) {
  const expected = await prepareStorageImportReadback(options);
  if ([...expected.buckets].sort().join(',') !== 'avatars,cover-images' || expected.objects.length > 10000) fail('source_buckets_or_capacity_invalid');
  return expected;
}

export async function verifyImportedSplitR2Export({ exportDir, buckets, pageSize = 1000, operationTimeoutMs = 120000 } = {}) {
  limits(pageSize, operationTimeoutMs);
  const read = readers(buckets);
  try {
    const expected = await source({ exportDir });
    const before = await inventory(read, pageSize, operationTimeoutMs);
    for (const [store, logical] of pairs) {
      const wanted = expected.objects.filter(object => object.bucket === logical).map(({ key, size }) => ({ key, size })).sort(compare);
      if (JSON.stringify(wanted) !== JSON.stringify(before[store].map(({ key, size }) => ({ key, size })))) fail('inventory_mismatch');
    }
    const report = await verifyStorageImportReadback({ exportDir, operationTimeoutMs, r2: {
      async get(logicalKey) {
        const expectedObject = expected.objects.find(object => object.targetKey === logicalKey);
        if (!expectedObject) fail('source_changed');
        const store = expectedObject.bucket === 'avatars' ? 'avatars' : 'covers';
        const object = await read[store].get(expectedObject.key);
        if (object === null) return null;
        const listed = before[store].find(row => row.key === expectedObject.key);
        if (object.key !== expectedObject.key || object.etag !== listed.etag || object.version !== listed.version ||
            Object.keys(object.customMetadata ?? {}).sort().join(',') !== Object.keys(expectedObject.customMetadata).sort().join(',') ||
            Object.keys(object.httpMetadata ?? {}).sort().join(',') !== (expectedObject.contentType === null ? '' : 'contentType')) {
          try { await object.body?.cancel(); } catch {}
          fail('object_identity_or_metadata_mismatch');
        }
        return { key: logicalKey, size: object.size, body: object.body,
          httpMetadata: object.httpMetadata, customMetadata: object.customMetadata };
      },
    } });
    if (report.manifestSHA256 !== expected.manifestSHA256) fail('source_changed');
    const after = await inventory(read, pageSize, operationTimeoutMs);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail('inventory_changed');
    return { ...report, format: 'fanmark-split-r2-readback-v1', inventorySha256: hash(before),
      consistency: 'unfenced-readback', transportIdentityVerified: false, deployable: false };
  } catch { fail('readback_failed'); }
}

export async function importInitialSplitR2Export({ exportDir, reportPath, buckets, readBuckets,
  pageSize = 1000, operationTimeoutMs = 120000 } = {}) {
  limits(pageSize, operationTimeoutMs);
  const read = readers(readBuckets);
  const writer = createSplitR2ImportTransport(buckets);
  let expected;
  try {
    expected = await source({ exportDir });
    const before = await inventory(read, pageSize, operationTimeoutMs);
    if (pairs.some(([store]) => before[store].length)) fail('target_not_empty');
  } catch { fail('preflight_failed'); }
  try {
    await importStorageExport({ exportDir, reportPath, r2: writer, freshOnly: true, operationTimeoutMs });
  } catch { fail('partial_or_unknown_write'); }
  const readback = await verifyImportedSplitR2Export({ exportDir, buckets: read, pageSize, operationTimeoutMs });
  if (readback.manifestSHA256 !== expected.manifestSHA256) fail('source_changed');
  return { ...readback, scope: 'initial-split-r2-import-stage', atomicWholeStore: false,
    sourceFreezeVerified: false, coordinatorCompleted: false };
}

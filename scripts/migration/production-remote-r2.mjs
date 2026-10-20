/** Fixed production R2 transport. Every operation rechecks control-plane
 * resource identities; mutations additionally require both durable journals.
 * The gateway is a short-lived authenticated binding proxy, never the app URL.
 */
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';
import { resolveProductionEmojiTarget } from './production-emoji-target.mjs';
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from '../../workers/api/src/production-runtime-identity.ts';
import { MAX_IMPORT_OBJECT_BYTES, validateImportKey, validateImportObject, importObjectDigest, importDigest, canonicalImportValue } from '../../workers/api/src/production-r2-import-contract.ts';
import { openProductionImportJournal, isProductionImportJournal } from './production-import-journal.mjs';
import { isProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import {isCloudflareCredentialLease,createLeaseBoundCloudflareFetch} from './cloudflare-credential-lease.mjs';

const branded = new WeakSet(), UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const fail = () => { throw Error('production_r2_transport_unconfirmed'); };
export const isProductionRemoteR2 = bucket => branded.has(bucket);
async function bytesOf(stream, max) {
  if (!stream?.getReader) fail();
  const reader = stream.getReader(), chunks = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength; if (length > max) { await reader.cancel(); fail(); } chunks.push(Buffer.from(part.value));
  } } catch { fail(); } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function createProductionRemoteR2({ target, runtimeVersion, gatewayOrigin, gatewayVersion, bearer, token, credentialLease = null,
  access = 'read-only', journal = null, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const expected = PRODUCTION_R2_TARGETS.find(row => row.bucketName === target?.bucketName);
  if (!expected || Object.entries(expected).some(([key, value]) => target[key] !== value) || !UUID.test(target.targetIncarnation ?? '') ||
      !UUID.test(runtimeVersion ?? '') || !UUID.test(gatewayVersion ?? '') || !['read-only', 'import'].includes(access) ||
      !/^https:\/\/fanmark-prod-import-[0-9a-f-]{36}\.fanmark-id\.workers\.dev$/u.test(gatewayOrigin ?? '') ||
      !/^[a-f0-9]{64}$/u.test(bearer ?? '') ||
      (credentialLease!==null&&(!isCloudflareCredentialLease(credentialLease)||credentialLease.accountId!==target.accountId)) ||
      (credentialLease===null&&(typeof token!=='string'||token.length<16||/\s/u.test(token))) ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail();
  if (access === 'import' && (!isProductionImportJournal(journal) || !journal.coordinated ||
      journal.targetId !== target.bucketName || journal.targetIncarnation !== target.targetIncarnation)) fail();
  if (access === 'import' && !isCloudflareCredentialLease(credentialLease)) fail();
  const identity = Object.freeze({ ...expected, targetIncarnation: target.targetIncarnation, runtimeVersion });
  const base = `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}`;
  const controlFetch = credentialLease ? createLeaseBoundCloudflareFetch({lease:credentialLease,fetchImpl}) : fetchImpl;
  const gatewayName = new URL(gatewayOrigin).hostname.split('.')[0];
  async function request(url, options) {
    try { return await (new URL(url).hostname==='api.cloudflare.com'?controlFetch:fetchImpl)(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch { fail(); }
  }
  async function json(response) {
    if (!response.ok) { await response.body?.cancel().catch(() => {}); fail(); }
    try { return JSON.parse((await bytesOf(response.body, 8 * 1024 * 1024)).toString('utf8')); } catch { fail(); }
  }
  async function api(path) {
    const envelope = await json(await request(base + path, { headers: { authorization: `Bearer ${token}` } }));
    if (envelope?.success !== true) fail(); return envelope.result;
  }
  const headers = { authorization: `Bearer ${bearer}`, 'x-fanmark-import-runtime': runtimeVersion };
  async function verify() {
    try {
      const [metadata, settings, deployment, gatewaySettings, gatewayDeployment] = await Promise.all([
        api('/r2/buckets/' + identity.bucketName), api('/workers/scripts/' + PRODUCTION_RUNTIME.worker + '/settings'),
        api('/workers/scripts/' + PRODUCTION_RUNTIME.worker + '/deployments'),
        api('/workers/scripts/' + gatewayName + '/settings'), api('/workers/scripts/' + gatewayName + '/deployments'),
      ]);
      if (metadata?.name !== identity.bucketName || metadata.creation_date !== identity.createdAt || metadata.storage_class !== 'Standard') fail();
      resolveProductionEmojiTarget(settings);
      if (settings.bindings.some(b => b.name === 'PRODUCTION_OWNER_ACCEPTANCE_BACKEND' && b.text !== 'disabled')) fail();
      const binding = name => settings.bindings.filter(row => row.name === name);
      for (const [name, value] of Object.entries({ CUTOVER_WRITE_FREEZE: 'receipt_only', STORAGE_BACKEND: 'r2', RECOVERY_DRAIN_BACKEND: 'durable-object' }))
        if (binding(name).length !== 1 || binding(name)[0].text !== value) fail();
      const versions = deployment?.deployments?.[0]?.versions;
      if (versions?.length !== 1 || versions[0].percentage !== 100 || versions[0].version_id !== runtimeVersion) fail();
      const gatewayBinding = name => gatewaySettings.bindings?.filter(row => row.name === name);
      const service = gatewayBinding('R2_IMPORT');
      if (service?.length !== 1 || service[0].type !== 'service' || service[0].service !== PRODUCTION_RUNTIME.worker ||
          service[0].entrypoint !== 'ProductionR2ImportService') fail();
      for (const [name, value] of Object.entries({ EXPECTED_RUNTIME: runtimeVersion, GATE_ACCESS: access }))
        if (gatewayBinding(name)?.length !== 1 || gatewayBinding(name)[0].text !== value) fail();
      const expires = gatewayBinding('EXPIRES_AT');
      if (expires?.length !== 1 || !Number.isSafeInteger(Number(expires[0].text)) || Number(expires[0].text) - Date.now() < (access==='import'?120000:0)) fail();
      const gatewayVersions = gatewayDeployment?.deployments?.[0]?.versions;
      if (gatewayVersions?.length !== 1 || gatewayVersions[0].percentage !== 100 || gatewayVersions[0].version_id !== gatewayVersion) fail();
      const remote = await json(await request(gatewayOrigin + '/r2/identity', { headers }));
      if (remote.runtimeVersion !== runtimeVersion || remote.scope !== PRODUCTION_RUNTIME.scope ||
          canonicalImportValue(remote.stores) !== canonicalImportValue(PRODUCTION_STORE_IDS)) fail();
      return identity;
    } catch { fail(); }
  }
  function metadata(object, key) {
    if (!object || object.key !== key || !Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_IMPORT_OBJECT_BYTES ||
        typeof object.etag !== 'string' || !object.etag || typeof object.version !== 'string' || !object.version ||
        !object.httpMetadata || typeof object.httpMetadata !== 'object' || Array.isArray(object.httpMetadata) ||
        !object.customMetadata || typeof object.customMetadata !== 'object' || Array.isArray(object.customMetadata)) fail();
    return object;
  }
  const resource = key => gatewayOrigin + '/r2/object?' + new URLSearchParams({ store: identity.store, key });
  const bucket = Object.freeze({ targetIdentity: identity, access, verifyProductionTarget: verify,
    credentialPolicy:credentialLease?'lease-v1':'static-token',
    importContext: access === "import" ? Object.freeze({ coordinator: journal.coordinator, journalPath: journal.path, runId: journal.runId }) : null,
    async get(key) {
      validateImportKey(key); await verify();
      const response = await request(resource(key), { headers });
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (response.status !== 200) { await response.body?.cancel(); fail(); }
      let object;
      try {
        const header = response.headers.get('x-fanmark-import-object'); if (!header || header.length > 16384) fail();
        object = metadata(JSON.parse(Buffer.from(header, 'base64').toString('utf8')), key);
        const declaredLength = response.headers.get('content-length');
        if (declaredLength !== null && declaredLength !== String(object.size)) fail();
      } catch { await response.body?.cancel().catch(() => {}); fail(); }
      const bytes = await bytesOf(response.body, object.size); if (bytes.length !== object.size) fail();
      return { ...object, body: new Response(bytes).body, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    },
    async list({ limit = 1000, cursor } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 4096))) fail();
      await verify();
      const page = await json(await request(gatewayOrigin + '/r2/list?' + new URLSearchParams({ store: identity.store, limit: String(limit), ...(cursor ? { cursor } : {}) }), { headers }));
      if (!Array.isArray(page?.objects) || page.objects.length > limit || typeof page.truncated !== 'boolean' ||
          (page.truncated && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 4096)) || (page.delimitedPrefixes?.length ?? 0) !== 0) fail();
      for (const object of page.objects) { validateImportKey(object.key); metadata(object, object.key); }
      return page;
    },
    async putWithSize(key, stream, options, size) {
      if (access !== 'import' || options?.onlyIf?.etagDoesNotMatch !== '*' || Object.keys(options.onlyIf).join(',') !== 'etagDoesNotMatch' ||
          Object.keys(options).sort().join(',') !== 'customMetadata,httpMetadata,onlyIf,sha256') fail();
      validateImportKey(key);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_IMPORT_OBJECT_BYTES) fail();
      const bytes = await bytesOf(stream, size); if (bytes.length !== size) fail();
      const object = validateImportObject({ store: identity.store, key, size, sha256: await importDigest(bytes),
        httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata });
      if (options.sha256 !== object.sha256) fail();
      await verify();
      if(credentialLease)await credentialLease.acquire();
      const digest = await importObjectDigest(object), operationId = await journal.beforeWrite(digest);
      const response = await request(resource(key), { method: 'PUT', headers: { ...headers, 'content-length': String(size),
        'x-fanmark-import-owner': journal.runId, 'x-fanmark-import-operation': operationId, 'x-fanmark-import-digest': digest,
        'x-fanmark-import-object': Buffer.from(JSON.stringify(object)).toString('base64') }, body: bytes });
      // Even a known collision is a stopped attempt. Neither journal is cleared.
      if (response.status !== 200) { await response.body?.cancel(); fail(); }
      const saved = metadata(await json(response), key);
      if (saved.size !== size || canonicalImportValue(saved.httpMetadata) !== canonicalImportValue(object.httpMetadata) ||
          canonicalImportValue(saved.customMetadata) !== canonicalImportValue(object.customMetadata)) fail();
      await journal.afterWrite(operationId); return saved;
    },
  });
  branded.add(bucket); return bucket;
}
export async function openProductionR2ImportTransport({ journalPath, runId, target, coordinator, ...options }) {
  if (!isProductionImportCoordinator(coordinator) || !PRODUCTION_R2_TARGETS.some(row => row.bucketName === target?.bucketName)) fail();
  const journal = await openProductionImportJournal({ path: journalPath, runId, targetId: target.bucketName, targetIncarnation: target.targetIncarnation, coordinator });
  return createProductionRemoteR2({ ...options, target, access: 'import', journal });
}

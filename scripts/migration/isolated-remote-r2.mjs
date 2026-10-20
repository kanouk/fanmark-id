/** Server-side adapter for the explicitly deployed recovery Worker only. */
const OWNER = '90000000-0000-4000-8000-00000000000d';
const MAX_BYTES = 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const refuse = (code, httpStatus, transportCode) => {
  const error = new Error(code);
  error.code = code;
  if (Number.isInteger(httpStatus)) error.httpStatus = httpStatus;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT',
    'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(transportCode)) error.transportCode = transportCode;
  throw error;
};
export function createIsolatedRemoteR2({ workerOrigin, token, targetIncarnation, expectedBuckets,
  fetchImpl = fetch, allowLoopback = false, timeoutMs = 30000 } = {}) {
  let origin;
  try { origin = new URL(workerOrigin); } catch { refuse('recovery_origin_invalid'); }
  const local = allowLoopback === true && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  const remote = origin.protocol === 'https:' && /^fanmark-recovery-[a-z0-9-]{8,48}\.fanmark-id\.workers\.dev$/u.test(origin.hostname);
  if ((!local && !remote) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      !/^[a-f0-9]{64}$/u.test(token ?? '') || !UUID.test(targetIncarnation ?? '') ||
      !/^fanmark-recovery-[a-z0-9-]{8,48}-avatars$/u.test(expectedBuckets?.avatars ?? '') ||
      !/^fanmark-recovery-[a-z0-9-]{8,48}-covers$/u.test(expectedBuckets?.covers ?? '') ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) refuse('recovery_transport_invalid');
  const receipt = Object.freeze({ targetIncarnation, buckets: Object.freeze({ avatars: expectedBuckets.avatars, covers: expectedBuckets.covers }) });
  async function request(path, method = 'GET', body, headers = {}) {
    try { return await fetchImpl(new URL(path, origin), { method, redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'x-recovery-incarnation': targetIncarnation, ...headers },
      body, ...(body ? { duplex: 'half' } : {}), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (cause) { refuse('recovery_request_acknowledgement_unknown', undefined, cause?.cause?.code ?? cause?.code); }
  }
  let verification;
  async function verify() {
    verification ??= (async () => {
      const response = await request('/_recovery/identity');
      if (!response.ok) {
        await response.body?.cancel();
        refuse('recovery_identity_unavailable', response.status);
      }
      let actual;
      try { actual = await response.json(); } catch { refuse('recovery_identity_invalid'); }
      if (actual?.targetIncarnation !== receipt.targetIncarnation ||
          actual?.buckets?.avatars !== receipt.buckets.avatars || actual?.buckets?.covers !== receipt.buckets.covers) refuse('recovery_identity_mismatch');
      return receipt;
    })().catch(error => { verification = null; throw error; });
    return verification;
  }
  function bucket(bucketName) {
    const physicalKey = `${OWNER}/${bucketName === 'avatars' ? 'avatar' : 'cover'}.png`;
    function path(key) {
      if (key !== physicalKey) refuse('recovery_key_invalid');
      return `/_recovery/objects/${bucketName}/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    return {
      async get(key) {
        const resource = path(key);
        await verify();
        const response = await request(resource);
        if (response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok) { await response.body?.cancel(); refuse('recovery_read_failed'); }
        let object;
        try {
          const header = response.headers.get('x-recovery-object');
          if (typeof header !== 'string' || header.length > 12288 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(header)) refuse('recovery_object_invalid');
          object = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
          const declaredLength = response.headers.get('content-length');
          if (object.key !== key || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_BYTES ||
              (declaredLength !== null && declaredLength !== String(object.size)) ||
              !object.httpMetadata || Array.isArray(object.httpMetadata) || !object.customMetadata || Array.isArray(object.customMetadata)) refuse('recovery_object_invalid');
        } catch { await response.body?.cancel(); refuse('recovery_object_invalid'); }
        return { ...object, body: response.body, arrayBuffer: () => response.arrayBuffer() };
      },
      async putWithSize(key, stream, options, size) {
        const resource = path(key);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || options.onlyIf?.etagDoesNotMatch !== '*') refuse('recovery_write_contract_invalid');
        await verify();
        const payload = Buffer.from(JSON.stringify({ ...options, size })).toString('base64');
        if (payload.length > 12288) refuse('recovery_metadata_too_large');
        const response = await request(resource, 'PUT', stream, { 'content-length': String(size), 'x-recovery-object': payload });
        if (response.status === 412) return null;
        if (!response.ok) { await response.body?.cancel(); refuse('recovery_write_failed'); }
        let object;
        try { object = await response.json(); } catch { refuse('recovery_write_result_invalid'); }
        if (object.key !== key || object.size !== size) refuse('recovery_write_result_invalid');
        return object;
      },
      async list() {
        await verify();
        const response = await request(`/_recovery/list/${bucketName}`);
        if (!response.ok) refuse('recovery_inventory_failed');
        let list;
        try { list = await response.json(); } catch { refuse('recovery_inventory_invalid'); }
        if (!Array.isArray(list.objects) || list.truncated !== false || list.objects.length > 1 ||
            list.objects.some(object => object.key !== physicalKey || !Number.isSafeInteger(object.size) || object.size < 1 || object.size > MAX_BYTES)) refuse('recovery_inventory_invalid');
        return list;
      },
      async deleteOwnedFixture(key) {
        const resource = path(key);
        await verify();
        const response = await request(resource, 'DELETE');
        if (response.status !== 204) { await response.body?.cancel(); refuse('recovery_cleanup_failed'); }
      },
    };
  }
  return Object.freeze({ avatars: bucket('avatars'), covers: bucket('cover-images'), verifyIsolatedTarget: verify, targetIdentity: receipt });
}

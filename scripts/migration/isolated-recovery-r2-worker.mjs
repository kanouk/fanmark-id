/** Temporary recovery Worker. Bind only newly owned recovery buckets. */
import { handleStorageRequest } from '../../workers/api/src/storage-r2.ts';

const OWNER = '90000000-0000-4000-8000-00000000000d';
const MAX_BYTES = 1024 * 1024;
const json = (value, status = 200, headers = {}) => Response.json(value, { status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
const keyFor = bucket => `${OWNER}/${bucket === 'avatars' ? 'avatar' : 'cover'}.png`;
const bindingFor = (env, bucket) => bucket === 'avatars' ? env.AVATARS_BUCKET : env.COVER_IMAGES_BUCKET;

function identity(env) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(env.RECOVERY_INCARNATION ?? '') ||
      !/^[a-f0-9]{64}$/u.test(env.RECOVERY_TOKEN ?? '') ||
      !/^fanmark-recovery-[a-z0-9-]{8,48}-avatars$/u.test(env.RECOVERY_AVATARS_NAME ?? '') ||
      !/^fanmark-recovery-[a-z0-9-]{8,48}-covers$/u.test(env.RECOVERY_COVERS_NAME ?? '') ||
      !env.AVATARS_BUCKET || !env.COVER_IMAGES_BUCKET) return null;
  return { targetIncarnation: env.RECOVERY_INCARNATION,
    buckets: { avatars: env.RECOVERY_AVATARS_NAME, covers: env.RECOVERY_COVERS_NAME } };
}
function metadata(object) {
  return { key: object.key, size: object.size, httpMetadata: object.httpMetadata ?? {},
    customMetadata: object.customMetadata ?? {} };
}
function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes));
}
function decode(value) {
  if (typeof value !== 'string' || value.length > 12288 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error('metadata_invalid');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), character => character.charCodeAt(0))));
}

export default {
  async fetch(request, env) {
    const receipt = identity(env);
    if (!receipt) return json({ error: 'recovery_unconfigured' }, 503);
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/storage/public/')) {
      return handleStorageRequest(request, env, async () => ({ available: true, userId: null }));
    }
    if (request.headers.get('authorization') !== `Bearer ${env.RECOVERY_TOKEN}`) return json({ error: 'unauthorized' }, 401);
    if (request.headers.get('x-recovery-incarnation') !== receipt.targetIncarnation) return json({ error: 'target_mismatch' }, 403);
    if (url.search) return json({ error: 'invalid_route' }, 400);
    if (url.pathname === '/_recovery/identity' && request.method === 'GET') return json(receipt);
    const route = /^\/_recovery\/(objects|list)\/(avatars|cover-images)(?:\/(.+))?$/u.exec(url.pathname);
    if (!route) return json({ error: 'route_unavailable' }, 404);
    const [, kind, bucketName, encodedKey] = route;
    const bucket = bindingFor(env, bucketName);
    if (kind === 'list' && encodedKey === undefined && request.method === 'GET') {
      const list = await bucket.list({ limit: 1000 });
      return json({ objects: list.objects.map(object => ({ key: object.key, size: object.size })), truncated: list.truncated });
    }
    let key;
    try { key = decodeURIComponent(encodedKey); } catch { return json({ error: 'invalid_key' }, 400); }
    if (kind !== 'objects' || key !== keyFor(bucketName)) return json({ error: 'invalid_key' }, 400);
    if (request.method === 'DELETE') {
      await bucket.delete(key);
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key);
      if (object === null) return json({ error: 'object_not_found' }, 404);
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
        'cache-control': 'no-store', 'content-length': String(object.size),
        'x-recovery-object': encode(metadata(object)),
      } });
    }
    if (request.method !== 'PUT') return json({ error: 'method_unavailable' }, 405);
    let payload;
    try {
      payload = decode(request.headers.get('x-recovery-object'));
      if (!Number.isSafeInteger(payload.size) || payload.size < 1 || payload.size > MAX_BYTES ||
          request.headers.get('content-length') !== String(payload.size) ||
          payload.onlyIf?.etagDoesNotMatch !== '*' || Object.keys(payload.onlyIf).length !== 1 ||
          !/^[a-f0-9]{64}$/u.test(payload.sha256 ?? '') || payload.httpMetadata?.contentType !== 'image/png' ||
          !payload.customMetadata || Array.isArray(payload.customMetadata) ||
          Object.values(payload.customMetadata).some(value => typeof value !== 'string') ||
          new TextEncoder().encode(JSON.stringify(payload.customMetadata)).length > 2048 || !request.body) {
        return json({ error: 'write_contract_invalid' }, 400);
      }
    } catch { return json({ error: 'write_contract_invalid' }, 400); }
    const { readable, writable } = new FixedLengthStream(payload.size);
    const abort = new AbortController();
    const pump = request.body.pipeTo(writable, { signal: abort.signal });
    void pump.catch(() => {});
    const stop = async () => {
      abort.abort();
      try { await writable.abort(); } catch {}
      await Promise.race([pump.catch(() => {}), new Promise(resolve => setTimeout(resolve, 100))]);
    };
    try {
      const object = await bucket.put(key, readable, { onlyIf: payload.onlyIf, sha256: payload.sha256,
        httpMetadata: { contentType: 'image/png' }, customMetadata: payload.customMetadata });
      if (object === null) { await stop(); return new Response(null, { status: 412, headers: { 'cache-control': 'no-store' } }); }
      await pump;
      return json({ key: object.key, size: object.size });
    } catch {
      await stop();
      return json({ error: 'write_failed' }, 500);
    }
  },
};

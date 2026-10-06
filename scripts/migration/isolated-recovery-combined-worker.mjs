/** Temporary full-bundle rehearsal only; bind newly owned D1s and buckets. */
import authRecovery from './isolated-recovery-auth-worker.mjs';
import storageRecovery from './isolated-recovery-r2-worker.mjs';
import { handleRequest } from '../../workers/api/src/index.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const json = (value, status = 200) => Response.json(value, { status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const reads = new Set(['/api/me/profile', '/api/me/fanmarks', '/api/emoji/catalog',
  '/api/reference-masters/fanmark_tiers', '/api/reference-masters/languages',
  '/api/reference-masters/reserved_emoji_patterns', '/api/reference-masters/fanmark_tier_extension_prices']);

function identity(env) {
  const resources = { business: env.RECOVERY_BUSINESS_NAME, auth: env.RECOVERY_AUTH_NAME,
    master: env.RECOVERY_MASTER_NAME, avatars: env.RECOVERY_AVATARS_NAME, covers: env.RECOVERY_COVERS_NAME };
  if (!UUID.test(env.RECOVERY_INCARNATION ?? '') || !/^[a-f0-9]{64}$/u.test(env.RECOVERY_TOKEN ?? '') ||
      env.D1_TOPOLOGY !== 'split' || env.AUTH_BACKEND !== 'better-auth' || env.STORAGE_BACKEND !== 'r2' ||
      !env.FANMARK_DB || !env.AUTH_DB || !env.MASTER_DB || !env.AVATARS_BUCKET || !env.COVER_IMAGES_BUCKET ||
      Object.entries(resources).some(([kind, name]) => !new RegExp(`^fanmark-recovery-[a-z0-9-]{8,48}-${kind}$`, 'u').test(name ?? ''))) return null;
  return { targetIncarnation: env.RECOVERY_INCARNATION,
    databases: { business: resources.business, auth: resources.auth, master: resources.master },
    buckets: { avatars: resources.avatars, covers: resources.covers } };
}

export default {
  async fetch(request, env) {
    const receipt = identity(env);
    if (!receipt) return json({ error: 'recovery_unconfigured' }, 503);
    if (request.headers.get('authorization') !== `Bearer ${env.RECOVERY_TOKEN}`) return json({ error: 'unauthorized' }, 401);
    if (request.headers.get('x-recovery-incarnation') !== receipt.targetIncarnation) return json({ error: 'target_mismatch' }, 403);
    const url = new URL(request.url);
    if (url.pathname === '/_recovery/identity' && request.method === 'GET' && !url.search) return json(receipt);
    if (url.pathname.startsWith('/_recovery/objects/') || url.pathname.startsWith('/_recovery/list/')) {
      return storageRecovery.fetch(request, env);
    }
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/admin/session') {
      return authRecovery.fetch(request, env);
    }
    const storageRead = url.pathname.startsWith('/api/storage/public/') && ['GET', 'HEAD'].includes(request.method) && !url.search;
    const applicationRead = request.method === 'GET' && reads.has(url.pathname) &&
      (url.pathname === '/api/emoji/catalog' || !url.search);
    if (!storageRead && !applicationRead) return json({ error: 'route_unavailable' }, 404);
    const headers = new Headers(request.headers);
    headers.delete('authorization'); headers.delete('x-recovery-incarnation');
    const response = await handleRequest(new Request(request, { headers }), env);
    response.headers.set('cache-control', 'no-store');
    return response;
  },
};

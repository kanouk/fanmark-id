/** Temporary synthetic recovery Worker; never bind an existing Auth database. */
import { handleRequest } from '../../workers/api/src/index.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const methods = new Map([
  ['/_recovery/identity', 'GET'], ['/api/auth/get-session', 'GET'],
  ['/api/admin/session', 'GET'], ['/api/auth/sign-in/email', 'POST'],
  ['/api/auth/two-factor/verify-totp', 'POST'],
  ['/api/auth/two-factor/verify-backup-code', 'POST'], ['/api/auth/sign-out', 'POST'],
]);
const json = (value, status = 200) => Response.json(value, { status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export default {
  async fetch(request, env) {
    if (!UUID.test(env.RECOVERY_INCARNATION ?? '') ||
        !/^[a-f0-9]{64}$/u.test(env.RECOVERY_TOKEN ?? '') ||
        !/^fanmark-recovery-[a-z0-9-]{8,48}-auth$/u.test(env.RECOVERY_AUTH_NAME ?? '') ||
        !env.AUTH_DB || env.D1_TOPOLOGY !== 'split' || env.AUTH_BACKEND !== 'better-auth') {
      return json({ error: 'recovery_unconfigured' }, 503);
    }
    if (request.headers.get('authorization') !== `Bearer ${env.RECOVERY_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (request.headers.get('x-recovery-incarnation') !== env.RECOVERY_INCARNATION) {
      return json({ error: 'target_mismatch' }, 403);
    }
    const url = new URL(request.url);
    if (url.search || methods.get(url.pathname) !== request.method) {
      return json({ error: 'route_unavailable' }, 404);
    }
    if (url.pathname === '/_recovery/identity') {
      return json({ targetIncarnation: env.RECOVERY_INCARNATION, authDatabaseName: env.RECOVERY_AUTH_NAME });
    }
    // Recovery transport authentication is not application authentication.
    const headers = new Headers(request.headers);
    headers.delete('authorization'); headers.delete('x-recovery-incarnation');
    const response = await handleRequest(new Request(request, { headers }), env);
    response.headers.set('cache-control', 'no-store');
    return response;
  },
};

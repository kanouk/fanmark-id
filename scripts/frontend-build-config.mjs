/** Only safety capabilities vary; every application API always uses Cloudflare. */
export function frontendEnvironment(target, origin) {
  if (!['local', 'staging', 'production'].includes(target)) throw new Error('unknown_frontend_target');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid_frontend_origin');
  }
  if (target === 'production' && url.origin !== 'https://fanmark.id') throw new Error('invalid_production_origin');
  if (target === 'local' && url.hostname !== '127.0.0.1') throw new Error('invalid_local_origin');
  return {
    VITE_FANMARK_API_BASE_URL: url.origin,
    VITE_AUTH_API_BASE_URL: url.origin,
    VITE_BROADCAST_SEND_BACKEND: target === 'production' ? 'worker' : 'disabled',
    VITE_BROADCAST_TEST_SEND_BACKEND: target === 'production' ? 'worker' : 'disabled',
    VITE_ADMIN_DATA_RESET_BACKEND: 'worker',
  };
}

export function isolatedBuildEnvironment(inherited, target, origin, envDirectory) {
  const clean = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('VITE_') && key !== 'FANMARK_VITE_ENV_DIR'));
  return { ...clean, ...frontendEnvironment(target, origin), FANMARK_VITE_ENV_DIR: envDirectory };
}

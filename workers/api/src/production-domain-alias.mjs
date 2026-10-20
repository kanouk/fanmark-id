// Separate, data-free Worker. Domain attachment and activation are cutover steps.
const aliases = new Set(['www.fanmark.id', 'admin.fanmark.id']);
const sensitiveQuery = /(?:token|secret|password|credential|assertion|session|signature|authorization)|^(?:code|state|ticket|key|otp|oobcode|samlresponse|samlrequest|relaystate)$/i;
const blockedPath = /^\/(?:api|auth|oauth|callback|reset-password|password-setup|functions|storage|rest)(?:\/|$)/i;
const headers = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-type': 'text/plain; charset=utf-8',
};
const reply = (request, status, text, extra = {}) => new Response(request.method === 'HEAD' ? null : text, {
  status, headers: { ...headers, ...extra },
});

export function handleProductionDomainAlias(request, env = {}) {
  const url = new URL(request.url);
  if (!aliases.has(url.hostname) || url.port || !['http:', 'https:'].includes(url.protocol)) {
    return reply(request, 421, 'Unknown host.');
  }
  if (env.PRODUCTION_ALIAS_REDIRECT !== 'enabled') {
    return reply(request, 503, 'Maintenance in progress.', { 'retry-after': '60' });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return reply(request, 405, 'Open https://fanmark.id/ to continue.', { allow: 'GET, HEAD' });
  }
  let path;
  try { path = decodeURIComponent(url.pathname); }
  catch { return reply(request, 400, 'Invalid path.'); }
  // Encoded separators, control characters and nested encoding are ambiguous.
  if (request.headers.has('authorization') || /[\\%\x00-\x20\x7f]/.test(path) || blockedPath.test(path) ||
      [...url.searchParams.keys()].some(key => sensitiveQuery.test(key))) {
    return reply(request, 409, 'Open https://fanmark.id/ and sign in again.');
  }
  if (url.hostname === 'admin.fanmark.id' && (path !== '/' || url.search)) {
    return reply(request, 404, 'Open https://fanmark.id/admin to continue.');
  }
  const target = new URL('https://fanmark.id');
  target.pathname = url.hostname === 'admin.fanmark.id' ? '/admin' : url.pathname;
  target.search = url.search;
  // An explicit empty fragment prevents inheritance of legacy OAuth hash tokens.
  return reply(request, 307, '', { location: `${target.href}#` });
}

export default { fetch: handleProductionDomainAlias };

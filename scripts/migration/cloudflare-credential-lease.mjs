/** Short-lived access credentials. Refresh happens before a request, never by
 * replaying a failed request. Neither exception text nor JSON exposes tokens. */
const leases = new WeakSet();
const ACCOUNT = /^[a-f0-9]{32}$/u;
const fail = code => { throw Error('cloudflare_credential_' + code); };
export const isCloudflareCredentialLease = value => leases.has(value);

export function createCloudflareCredentialLease({accountId, load, refresh, now = Date.now,
  minimumValidityMs = 120000} = {}) {
  if (!ACCOUNT.test(accountId ?? '') || typeof load !== 'function' || typeof refresh !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(minimumValidityMs) || minimumValidityMs < 60000 ||
      minimumValidityMs > 3600000) fail('configuration_invalid');
  let pending = null;
  function validate(value) {
    if (!value || value.accountId !== accountId || typeof value.token !== 'string' || value.token.length < 16 ||
        /\s/u.test(value.token) || !Number.isSafeInteger(value.expiresAt)) fail('identity_or_expiry_invalid');
    return value;
  }
  async function acquire() {
    let value;
    try { value = validate(await load()); } catch { fail('load_unconfirmed'); }
    if (value.expiresAt - now() < minimumValidityMs) {
      try { await refresh(); value = validate(await load()); } catch { fail('refresh_unconfirmed'); }
    }
    if (value.expiresAt - now() < minimumValidityMs) fail('insufficient_remaining_lifetime');
    // Do not retain the token between operations. The caller consumes this
    // capability immediately; it must not serialize it into an operation log.
    return Object.freeze({token:value.token, expiresAt:value.expiresAt, accountId,
      toJSON() { return {accountId, expiresAt:value.expiresAt, token:'[redacted]'}; }});
  }
  const lease = Object.freeze({accountId, minimumValidityMs,
    async acquire() {
      // Concurrent metadata reads share one refresh, including failure. A
      // subsequent deliberate request can re-inspect a refresh failure.
      pending ??= acquire().finally(() => { pending = null; });
      return pending;
    },
  });
  leases.add(lease); return lease;
}

export function createLeaseBoundCloudflareFetch({lease, fetchImpl = fetch} = {}) {
  if (!isCloudflareCredentialLease(lease) || typeof fetchImpl !== 'function') fail('fetch_configuration_invalid');
  return async (input, options = {}) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'api.cloudflare.com' || url.username || url.password ||
        !url.pathname.startsWith('/client/v4/accounts/' + lease.accountId + '/')) fail('request_target_invalid');
    const {token} = await lease.acquire();
    const headers = new Headers(options.headers);
    headers.set('authorization', 'Bearer ' + token);
    // No retry on 401, 429, 5xx, timeout or a missing response. Callers retain
    // their durable operation and independently reconcile the destination.
    return fetchImpl(input, {...options, headers, redirect:'error'});
  };
}

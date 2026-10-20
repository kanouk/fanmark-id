import assert from 'node:assert/strict';

/** Only a rejected read is repeated. Mutations keep their original ACK semantics. */
export function createApplicationRecoveryCloudflareApi({account, getToken, refreshToken, fetchImplementation = fetch}) {
  assert.match(account, /^[a-f0-9]{32}$/u);
  assert.equal(typeof getToken, 'function');
  assert.equal(typeof refreshToken, 'function');
  return async function api(resource, method = 'GET', payload, absent = false) {
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchImplementation(`https://api.cloudflare.com/client/v4/accounts/${account}/${resource}`, {
          method, redirect: 'error', headers: {authorization: `Bearer ${getToken()}`, 'content-type': 'application/json'},
          body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
        });
      } catch {throw new Error('proof_resource_ack_unknown');}
      if (method !== 'GET' || response.status !== 401 || attempt !== 0) break;
      await response.body?.cancel();
      try {await refreshToken();} catch {throw new Error('proof_credential_refresh_failed');}
    }
    if (absent && response.status === 404) return null;
    if (method === 'DELETE' && response.status === 204) return null;
    let envelope;
    try {envelope = await response.json();} catch {throw new Error('proof_resource_response_invalid');}
    if (!response.ok || envelope.success !== true) throw new Error('proof_resource_api_' + response.status);
    return envelope.result;
  };
}

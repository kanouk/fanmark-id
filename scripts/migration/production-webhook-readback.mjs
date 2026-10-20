/** Fixed-host GET transport for independently checking a newly registered
 * production endpoint. Resend GET may return a signing secret: pass the result
 * directly to the custody verifier, never to stdout or a plaintext file. */
const fail = code => { throw Error('production_webhook_readback_' + code); };
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const MAX_BYTES = 128 * 1024;

async function getJson(url, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {method: 'GET', headers: {authorization: 'Bearer ' + apiKey},
      redirect: 'error', signal: AbortSignal.timeout(30000)});
  } catch { fail('request_unconfirmed'); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); fail('request_rejected'); }
  if (!response.body) fail('body_missing');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); fail('body_too_large'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    try { return JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
  } catch { fail('body_unconfirmed'); }
  finally { for (const chunk of chunks) chunk.fill(0); reader.releaseLock(); }
}

export async function readProductionWebhookRegistration({provider, endpointId, apiKey, fetchImpl = fetch} = {}) {
  if (typeof apiKey !== 'string' || typeof fetchImpl !== 'function') fail('credentials_invalid');
  if (provider === 'stripe') {
    if (!/^(?:sk|rk)_live_[A-Za-z0-9]+$/u.test(apiKey) || !/^we_[A-Za-z0-9]+$/u.test(endpointId ?? '')) fail('identity_invalid');
    const account = await getJson('https://api.stripe.com/v1/account', apiKey, fetchImpl);
    if (account.id !== 'acct_1SFjhvJk0VCfiKUp') fail('account_mismatch');
    const endpoint = await getJson('https://api.stripe.com/v1/webhook_endpoints/' + endpointId, apiKey, fetchImpl);
    if (endpoint.id !== endpointId) fail('endpoint_mismatch');
    return {accountId: account.id, endpoint};
  }
  if (provider !== 'resend' || !/^re_[A-Za-z0-9_-]+$/u.test(apiKey) || !UUID.test(endpointId ?? '')) fail('identity_invalid');
  const seen = new Set(), matches = []; let after = null, complete = false;
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.resend.com/domains'); url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const result = await getJson(url.href, apiKey, fetchImpl);
    if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== 'boolean') fail('domain_inventory_invalid');
    for (const row of result.data) {
      if (!UUID.test(row?.id ?? '') || seen.has(row.id)) fail('domain_inventory_invalid');
      seen.add(row.id);
      if (row.name === 'fanmark.id') matches.push({name: row.name, status: row.status});
    }
    if (!result.has_more) { complete = true; break; }
    if (result.data.length === 0) fail('domain_inventory_invalid');
    after = result.data.at(-1).id;
  }
  if (!complete || matches.length !== 1 || matches[0].status !== 'verified') fail('sender_domain_unconfirmed');
  const endpoint = await getJson('https://api.resend.com/webhooks/' + endpointId, apiKey, fetchImpl);
  if (endpoint.id !== endpointId) fail('endpoint_mismatch');
  return {senderDomain: matches[0], endpoint};
}

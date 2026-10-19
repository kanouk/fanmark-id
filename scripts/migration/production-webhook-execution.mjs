/** One provider POST, after caller-owned G4 evidence and fresh fixed-host reads.
 * No CLI/main, retries, provider updates, runtime secret writes or release. */
import {sha256Hex} from './snapshot-format.mjs';
import {beginProductionWebhookRegistration, captureProductionWebhookResponse,
  verifyProductionWebhookRegistration, saveProductionWebhookExecutionRecord,
  readProductionWebhookAttempt, prepareProductionWebhookRegistration} from './production-webhook-custody.mjs';
import {readProductionWebhookRegistration} from './production-webhook-readback.mjs';

const fail = code => { throw Error('production_webhook_execution_' + code); };
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const accountId = 'acct_1SFjhvJk0VCfiKUp';

// Caller supplies independently checked, current G1/G3 and operator approval
// evidence. This is an input contract, not a source freeze implementation.
function validateGate(gate, now) {
  if (!gate || Object.keys(gate).sort().join(',') !== 'businessWritesStarted,externalEffectsReconciled,format,g3Reconciled,observedAt,operatorApproved,receiptHandoffReconciled,receiptHandoffSha256,reconciliationSha256,runId,runtimeVersion,settingsSha256,sourceBoundarySha256,sourceFrozen,sourceProject' ||
    gate.format !== 'fanmark-production-webhook-g4-evidence-v1' || !UUID.test(gate.runId ?? '') ||
    !UUID.test(gate.runtimeVersion ?? '') || !HASH.test(gate.settingsSha256 ?? '') ||
    !HASH.test(gate.sourceBoundarySha256 ?? '') || !HASH.test(gate.reconciliationSha256 ?? '') ||
    !HASH.test(gate.receiptHandoffSha256 ?? '') || gate.sourceProject !== 'ppqgtbjykitqtiaisyji' ||
    gate.sourceFrozen !== true || gate.externalEffectsReconciled !== true || gate.g3Reconciled !== true ||
    gate.receiptHandoffReconciled !== true || gate.businessWritesStarted !== false ||
    gate.operatorApproved !== true || !Number.isSafeInteger(gate.observedAt) ||
    gate.observedAt > now || now - gate.observedAt > 120000) fail('g4_evidence_required');
}

async function body(response, limit = 128 * 1024) {
  if (!response.body) fail('body_missing');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail('body_too_large'); }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    try { return bytes.toString('utf8'); } finally { bytes.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); reader.releaseLock(); }
}

async function get(url, token, fetchImpl, cloudflare = false) {
  let r;
  try { r = await fetchImpl(url, {method: 'GET', headers: {authorization: 'Bearer ' + token},
    redirect: 'error', signal: AbortSignal.timeout(30000)}); } catch { fail('read_unconfirmed'); }
  if (!r.ok) { await r.body?.cancel().catch(() => {}); fail('read_rejected'); }
  let json; try { json = JSON.parse(await body(r)); } catch { fail('read_invalid'); }
  if (cloudflare) { if (json.success !== true) fail('read_rejected'); return json.result; }
  return json;
}

function credentials(provider, apiKey, cloudflareToken) {
  if (!(provider === 'stripe' ? /^(?:sk|rk)_live_[A-Za-z0-9]+$/u :
    provider === 'resend' ? /^re_[A-Za-z0-9_-]+$/u : /a^/u).test(apiKey ?? '') ||
    typeof cloudflareToken !== 'string' || cloudflareToken.length < 16 || /\s/u.test(cloudflareToken)) fail('credentials_invalid');
}

/** GET-only inventory. Results can include private provider fields: do not log. */
export async function collectProductionWebhookInventory({provider, apiKey, fetchImpl = fetch} = {}) {
  credentials(provider, apiKey, 'inventory-read-only');
  const stripe = provider === 'stripe';
  if (stripe && (await get('https://api.stripe.com/v1/account', apiKey, fetchImpl)).id !== accountId) fail('account_mismatch');
  const rows = [], seen = new Set(); let after = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL(stripe ? 'https://api.stripe.com/v1/webhook_endpoints' : 'https://api.resend.com/webhooks');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set(stripe ? 'starting_after' : 'after', after);
    const result = await get(url.href, apiKey, fetchImpl);
    if (!Array.isArray(result.data) || result.data.length > 100 || typeof result.has_more !== 'boolean') fail('inventory_invalid');
    for (const row of result.data) {
      if (!(stripe ? /^we_[A-Za-z0-9]+$/u : UUID).test(row?.id ?? '') || seen.has(row.id)) fail('inventory_invalid');
      seen.add(row.id);
      // Keep no signing secret, description, email address or arbitrary metadata.
      const endpoint = stripe ? row.url : row.endpoint;
      if (typeof endpoint !== 'string' || endpoint.length > 4096) fail('inventory_invalid');
      const operationId = stripe ? row.metadata?.fanmark_migration_operation : null;
      rows.push({id: row.id, endpointSha256: sha256Hex(endpoint),
        productionEndpoint: endpoint === (stripe ? 'https://fanmark.id/api/stripe/webhook' :
          'https://fanmark.id/api/webhooks/resend/broadcast-delivery'),
        operationId: UUID.test(operationId ?? '') ? operationId : null});
    }
    if (!result.has_more) return rows;
    if (!result.data.length) fail('inventory_invalid');
    after = result.data.at(-1).id;
  }
  fail('inventory_incomplete');
}

/** Check current control plane AND public HTTPS without following redirects.
 * Cloudflare token goes only to its fixed API, never to the public host. */
async function admission({gate, cloudflareToken, fetchImpl, now}, request) {
  validateGate(gate, now());
  const base = 'https://api.cloudflare.com/client/v4/accounts/bfc2890741f0b3fb236e2d755b6c9adc/workers';
  const api = path => get(base + path, cloudflareToken, fetchImpl, true);
  const settings = await api('/scripts/fanmark-app-production/settings');
  if (sha256Hex(settings) !== gate.settingsSha256) fail('settings_changed');
  const binding = name => settings.bindings?.filter(b => b.name === name);
  if (binding('CUTOVER_WRITE_FREEZE')?.length !== 1 || binding('CUTOVER_WRITE_FREEZE')[0].text !== 'receipt_only' ||
    binding('RECOVERY_WRITE_FREEZE')?.some(b => b.text && b.text !== 'false') ||
    binding(request.binding)?.length || ['STRIPE_DISPATCH_BACKEND','LICENSE_EXPIRY_BACKEND','NOTIFICATION_ARCHIVE_BACKEND']
      .some(name => binding(name)?.length)) fail('target_not_closed');
  const deployments = await api('/scripts/fanmark-app-production/deployments');
  const versions = deployments?.deployments?.[0]?.versions;
  if (versions?.length !== 1 || versions[0].percentage !== 100 || versions[0].version_id !== gate.runtimeVersion) fail('runtime_changed');
  const domains = await api('/domains');
  const apex = domains?.filter(d => d.hostname === 'fanmark.id');
  if (apex?.length !== 1 || apex[0].service !== 'fanmark-app-production' ||
    apex[0].zone_id !== '6a2c39c92ba1c4106b7c19f87ada0a7e') fail('domain_not_attached');
  const schedules = await api('/scripts/fanmark-app-production/schedules');
  if (!Array.isArray(schedules.schedules) || schedules.schedules.length) fail('cron_open');
  const subdomain = await api('/scripts/fanmark-app-production/subdomain');
  if (subdomain.enabled !== false || subdomain.previews_enabled !== false) fail('preview_open');
  const checks = [['https://fanmark.id/', 'GET', null],
    ['https://fanmark.id/api/auth/get-session', 'GET', 'cutover_write_freeze'],
    [request.body.url ?? request.body.endpoint, 'POST', request.provider === 'stripe' ? 'stripe_ingress_unavailable' : 'cutover_write_freeze']];
  for (const [url, method, error] of checks) {
    let r;
    try { r = await fetchImpl(url, {method, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(30000), ...(method === 'POST' ? {body: '{}', headers: {'content-type':'application/json'}} : {})}); }
    catch { fail('public_route_unconfirmed'); }
    if (r.status !== 503 || r.headers.get('cache-control') !== 'no-store' || r.headers.has('location')) {
      await r.body?.cancel().catch(() => {}); fail('public_route_unconfirmed');
    }
    const text = await body(r, 8192);
    if (error ? (() => {try {return JSON.parse(text).error !== error;} catch {return true;}})() :
      !text.includes('<title>メンテナンス中 | fanmark.id</title>')) fail('public_route_unconfirmed');
  }
  validateGate(gate, now());
}

function form(body) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) for (const item of value) result.append(key + '[]', item);
    else if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) result.set(key + '[' + k + ']', v);
    else result.set(key, String(value));
  }
  return result.toString();
}

export async function executeProductionWebhookRegistration(options = {}) {
  options = {...options, gate: structuredClone(options.gate)};
  const {provider, apiKey, cloudflareToken, fetchImpl = fetch, now = () => Date.now()} = options;
  credentials(provider, apiKey, cloudflareToken);
  // The request is fixed by custody; no caller-controlled URL or body.
  const request = prepareProductionWebhookRegistration(options);
  await admission({...options, fetchImpl, now}, request);
  const inventory = await collectProductionWebhookInventory({provider, apiKey, fetchImpl});
  if (inventory.some(r => r.productionEndpoint || r.operationId === request.operationId)) fail('endpoint_already_present');
  const begun = await beginProductionWebhookRegistration(options);
  const attempt = {...options, expectedIntentSha256: begun.intentSha256};
  await saveProductionWebhookExecutionRecord({...attempt, kind:'admission', record:options.gate});
  const inventorySha256 = await saveProductionWebhookExecutionRecord({...attempt, kind:'inventory', record:inventory});
  // A changed gate after intent leaves a retained attempt, never a POST retry.
  await admission({...options, fetchImpl, now}, request);
  const dispatch = {format:'fanmark-production-webhook-dispatch-v1', intentSha256:begun.intentSha256,
    inventorySha256, gateSha256:sha256Hex(options.gate), requestSha256:sha256Hex(request), dispatchedAt:now()};
  const dispatchSha256 = await saveProductionWebhookExecutionRecord({...attempt, kind:'dispatch', record:dispatch});
  let response, raw;
  try {
    response = await fetchImpl(request.url, {method:'POST', headers:{authorization:'Bearer '+apiKey,
      'content-type':request.contentType, ...(request.idempotencyKey ? {'idempotency-key':request.idempotencyKey} : {})},
      body:provider === 'stripe' ? form(request.body) : JSON.stringify(request.body), redirect:'error', signal:AbortSignal.timeout(30000)});
    raw = await body(response, 65536);
  } catch { fail('post_outcome_unknown'); }
  const captured = await captureProductionWebhookResponse({...attempt, httpStatus:response.status, rawResponseBody:raw});
  if (!response.ok) fail('post_rejected_response_preserved');
  let json; try { json = JSON.parse(raw); } catch { fail('post_invalid_response_preserved'); }
  const readback = await readProductionWebhookRegistration({provider, endpointId:json?.id, apiKey, fetchImpl});
  const verified = await verifyProductionWebhookRegistration({...attempt, expectedResponseSha256:captured.responseSha256, readback});
  return {...verified, dispatchSha256, providerPostAttempts:1, cutoverAdmitted:false};
}

/** After unknown POST: inspect only. Matching URL alone cannot prove ownership.
 * Even Stripe metadata match cannot recover its one-time signing secret. */
export async function inspectProductionWebhookRegistrationExecution(options = {}) {
  const {request, dispatch} = await readProductionWebhookAttempt(options);
  if (dispatch?.format !== 'fanmark-production-webhook-dispatch-v1' ||
    dispatch.intentSha256 !== options.expectedIntentSha256 || dispatch.requestSha256 !== sha256Hex(request)) fail('dispatch_invalid');
  const inventory = await collectProductionWebhookInventory(options);
  const candidates = inventory.filter(r => r.productionEndpoint ||
    r.operationId === request.operationId);
  return {format:'fanmark-production-webhook-inspection-v1', provider:request.provider,
    candidates, ownershipVerified:false, signingKeyRecovered:false, retryAllowed:false,
    providerPostAttempts:0, runtimeSecretInstalled:false, productionReady:false};
}

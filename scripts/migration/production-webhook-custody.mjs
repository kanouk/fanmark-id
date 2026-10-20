/** Local custody for the one-shot provider registration in production-webhook-activation.md.
 * This module cannot call a provider, change routing, or admit a cutover. The
 * operator must establish those gates before sending the returned request.
 * Never print the result of openProductionWebhookSecret. */
import {open, lstat, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import {canonicalJson, sha256Hex} from './snapshot-format.mjs';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const KEY_ID = /^production-backup-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fail = code => { throw Error('production_webhook_custody_' + code); };
const specifications = {
  stripe: {
    accountId: 'acct_1SFjhvJk0VCfiKUp', binding: 'STRIPE_WEBHOOK_SECRET',
    endpoint: 'https://fanmark.id/api/stripe/webhook', apiVersion: '2025-08-27.basil',
    events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed', 'checkout.session.expired',
      'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
      'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.payment_succeeded'],
  },
  resend: {
    accountId: null, binding: 'BROADCAST_WEBHOOK_SIGNING_SECRET',
    endpoint: 'https://fanmark.id/api/webhooks/resend/broadcast-delivery',
    events: ['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'],
  },
};

export function prepareProductionWebhookRegistration({provider, operationId} = {}) {
  if (!Object.hasOwn(specifications, provider) || !UUID.test(operationId ?? '')) fail('identity_invalid');
  const s = specifications[provider];
  const body = provider === 'stripe'
    ? {url: s.endpoint, api_version: s.apiVersion, connect: false, enabled_events: [...s.events],
      metadata: {fanmark_migration_operation: operationId}}
    : {endpoint: s.endpoint, events: [...s.events]};
  return {format: 'fanmark-production-webhook-request-v1', provider, operationId,
    targetWorker: 'fanmark-app-production', accountId: s.accountId, binding: s.binding,
    method: 'POST', url: provider === 'stripe' ? 'https://api.stripe.com/v1/webhook_endpoints' : 'https://api.resend.com/webhooks',
    contentType: provider === 'stripe' ? 'application/x-www-form-urlencoded' : 'application/json',
    idempotencyKey: provider === 'stripe' ? 'fanmark-webhook-' + operationId : null, body};
}

async function privateDirectory(directory) {
  if (!isAbsolute(directory ?? '')) fail('directory_invalid');
  const path = await realpath(directory), stat = await lstat(directory), rel = relative(ROOT, path);
  if (path !== resolve(directory) || !stat.isDirectory() || stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 || !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) fail('directory_invalid');
  return path;
}

async function save(path, value) {
  const bytes = Buffer.from(canonicalJson(value) + '\n');
  const f = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); }
  const d = await open(dirname(path), constants.O_RDONLY);
  try { await d.sync(); } finally { await d.close(); }
  return sha256Hex(bytes);
}

async function read(path, expectedHash) {
  if (!HASH.test(expectedHash ?? '')) fail('hash_required');
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 1048576) fail('file_invalid');
    const bytes = await f.readFile();
    if (sha256Hex(bytes) !== expectedHash) fail('file_changed');
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('file_invalid'); }
  } finally { await f.close(); }
}

function seal(value, header, keyHex) {
  if (!HASH.test(keyHex ?? '')) fail('key_invalid');
  const nonce = randomBytes(12), key = Buffer.from(keyHex, 'hex');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  try {
    cipher.setAAD(Buffer.from(canonicalJson(header)));
    const bytes = Buffer.from(canonicalJson(value));
    try {
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return {header, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64')};
    } finally { bytes.fill(0); }
  } finally { key.fill(0); }
}

function unseal(envelope, header, keyHex) {
  try {
    if (!HASH.test(keyHex ?? '') || canonicalJson(envelope.header) !== canonicalJson(header)) fail('envelope_invalid');
    const key = Buffer.from(keyHex, 'hex');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
      decipher.setAAD(Buffer.from(canonicalJson(header)));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      try { return JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
    } finally { key.fill(0); }
  } catch { fail('envelope_invalid'); }
}

function header(request, archiveKeyId, kind) {
  return {format: 'fanmark-production-webhook-' + kind + '-v1', provider: request.provider,
    operationId: request.operationId, archiveKeyId, requestSha256: sha256Hex(request)};
}

/** One fixed filename per provider: changing operationId cannot retry an
 * unknown registration in the same attempt directory. Never erase this intent. */
export async function beginProductionWebhookRegistration({directory, provider, operationId, archiveKeyId, archiveKeyHex} = {}) {
  if (!KEY_ID.test(archiveKeyId ?? '')) fail('key_identity_invalid');
  const request = prepareProductionWebhookRegistration({provider, operationId});
  const path = await privateDirectory(directory);
  const keyCheck = seal({operationId}, header(request, archiveKeyId, 'key-check'), archiveKeyHex);
  const intent = {format: 'fanmark-production-webhook-intent-v1', request, archiveKeyId, keyCheck};
  const intentSha256 = await save(resolve(path, provider + '-registration-intent.json'), intent);
  return {request, intentSha256, providerRequestsMade: 0, cutoverAdmitted: false};
}

async function loadIntent({directory, provider, expectedIntentSha256, archiveKeyHex}) {
  if (!Object.hasOwn(specifications, provider)) fail('identity_invalid');
  const path = await privateDirectory(directory);
  const intent = await read(resolve(path, provider + '-registration-intent.json'), expectedIntentSha256);
  const request = prepareProductionWebhookRegistration({provider, operationId: intent.request?.operationId});
  if (intent.format !== 'fanmark-production-webhook-intent-v1' || !KEY_ID.test(intent.archiveKeyId ?? '') ||
    canonicalJson(request) !== canonicalJson(intent.request)) fail('intent_invalid');
  const check = unseal(intent.keyCheck, header(request, intent.archiveKeyId, 'key-check'), archiveKeyHex);
  if (check.operationId !== request.operationId) fail('key_invalid');
  return {path, intent, request};
}

// Payload-free, fixed-name execution records share the same verified attempt.
// These records never grant a retry or accept arbitrary paths.
const recordNames = new Set(['dispatch', 'admission', 'inventory', 'secret-install-intent', 'secret-install-verified']);
export async function saveProductionWebhookExecutionRecord(options = {}) {
  options = {...options, record: structuredClone(options.record)};
  const {path, request} = await loadIntent(options);
  if (!recordNames.has(options.kind)) fail('record_invalid');
  return save(resolve(path, request.provider + '-registration-' + options.kind + '.json'), options.record);
}
export async function readProductionWebhookExecutionRecord(options = {}) {
  const {path, request} = await loadIntent(options);
  if (!recordNames.has(options.kind)) fail('record_invalid');
  return read(resolve(path, request.provider + '-registration-' + options.kind + '.json'), options.expectedRecordSha256);
}

export async function readProductionWebhookAttempt(options = {}) {
  const {path, request} = await loadIntent(options);
  let dispatch = null;
  if (options.expectedDispatchSha256) dispatch = await read(
    resolve(path, request.provider + '-registration-dispatch.json'), options.expectedDispatchSha256);
  return {request, dispatch};
}

/** Encrypt the complete bounded provider JSON response BEFORE interpreting it.
 * Even an error/unexpected response may contain a successfully created key.
 * Returns no secret and never reports provider success by itself. */
export async function captureProductionWebhookResponse(options = {}) {
  options = {...options};
  let bytes;
  const raw = options.rawResponseBody;
  try { bytes = raw === undefined ? canonicalJson(options.response) : raw; } catch { fail('response_invalid'); }
  if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 65536 || !Number.isInteger(options.httpStatus) ||
    options.httpStatus < 100 || options.httpStatus > 599) fail('response_invalid');
  // Preserve non-JSON and escaping-heavy error bodies too. Decode only in memory
  // after the encrypted raw body is durable; success parsing is not custody.
  let response;
  if (raw === undefined) response = JSON.parse(bytes);
  const {path, intent, request} = await loadIntent(options);
  const envelope = seal(raw === undefined ? {httpStatus: options.httpStatus, response} :
    {httpStatus: options.httpStatus, rawResponseBody: raw},
    header(request, intent.archiveKeyId, 'response'), options.archiveKeyHex);
  const responseSha256 = await save(resolve(path, request.provider + '-registration-response.enc.json'), envelope);
  return {responseSha256, intentSha256: options.expectedIntentSha256, responsePreserved: true,
    registrationVerified: false, providerRequestsMade: 0, retryAllowed: false};
}

function decodeCaptured(captured) {
  if (typeof captured.rawResponseBody === 'string') {
    try { return {...captured, response: JSON.parse(captured.rawResponseBody)}; }
    catch { fail('readback_mismatch'); }
  }
  return captured;
}

function equalEvents(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === expected.length &&
    actual.every(e => expected.includes(e));
}

function validSecret(provider, secret) {
  if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/=_-]{16,240}$/u.test(secret)) return false;
  return provider !== 'resend' || Buffer.from(secret.slice(6), 'base64').length >= 16;
}

function endpointMatches(provider, endpoint, request) {
  if (!endpoint || typeof endpoint !== 'object' || endpoint.status !== 'enabled') return false;
  const s = specifications[provider];
  if (provider === 'stripe') return /^we_[A-Za-z0-9]+$/u.test(endpoint.id ?? '') &&
    endpoint.url === s.endpoint && endpoint.livemode === true && endpoint.application == null &&
    endpoint.api_version === s.apiVersion && equalEvents(endpoint.enabled_events, s.events) &&
    endpoint.metadata?.fanmark_migration_operation === request.operationId;
  return UUID.test(endpoint.id ?? '') && endpoint.endpoint === s.endpoint && equalEvents(endpoint.events, s.events);
}

/** Independent GET result is supplied by the operator's read-only transport.
 * Stripe must include GET /v1/account identity; Resend must include the verified
 * fanmark.id sender-domain readback. This verifies custody/registration ONLY. */
export async function verifyProductionWebhookRegistration(options = {}) {
  options = {...options};
  let observed;
  try { observed = structuredClone(options.readback); } catch { fail('readback_mismatch'); }
  const {path, intent, request} = await loadIntent(options);
  const envelope = await read(resolve(path, request.provider + '-registration-response.enc.json'), options.expectedResponseSha256);
  const captured = decodeCaptured(unseal(envelope, header(request, intent.archiveKeyId, 'response'), options.archiveKeyHex));
  const response = captured.response;
  if (captured.httpStatus < 200 || captured.httpStatus > 299 || !response || typeof response !== 'object' ||
    !endpointMatches(request.provider, observed?.endpoint, request) || observed.endpoint.id !== response.id) fail('readback_mismatch');
  if (request.provider === 'stripe') {
    if (observed.accountId !== request.accountId || !endpointMatches('stripe', response, request)) fail('readback_mismatch');
  } else if (observed.senderDomain?.name !== 'fanmark.id' || observed.senderDomain.status !== 'verified') fail('readback_mismatch');
  const secret = request.provider === 'stripe' ? response.secret : response.signing_secret;
  if (!validSecret(request.provider, secret)) fail('signing_secret_invalid');
  if (observed.endpoint.signing_secret !== undefined && observed.endpoint.signing_secret !== secret) fail('readback_mismatch');
  const report = {format: 'fanmark-production-webhook-custody-verified-v1', provider: request.provider,
    operationId: request.operationId, endpointId: response.id, binding: request.binding,
    intentSha256: options.expectedIntentSha256, responseSha256: options.expectedResponseSha256,
    readbackSha256: sha256Hex(observed), archiveKeyId: intent.archiveKeyId,
    encryptedResponseVerified: true, providerEndpointReadbackVerified: true,
    runtimeSecretInstalled: false, realDeliveryVerified: false, productionReady: false};
  const reportSha256 = await save(resolve(path, request.provider + '-registration-verified.json'), report);
  return {...report, reportSha256};
}

/** For a private operator process ONLY. Never log this return value. Runtime
 * installation and delivery verification are separate guarded operations. */
export async function openProductionWebhookSecret(options = {}) {
  options = {...options};
  const {path, intent, request} = await loadIntent(options);
  const report = await read(resolve(path, request.provider + '-registration-verified.json'), options.expectedReportSha256);
  if (report.format !== 'fanmark-production-webhook-custody-verified-v1' || report.intentSha256 !== options.expectedIntentSha256 ||
    report.responseSha256 !== options.expectedResponseSha256 || report.provider !== request.provider ||
    report.operationId !== request.operationId || report.archiveKeyId !== intent.archiveKeyId ||
    report.binding !== request.binding || report.encryptedResponseVerified !== true ||
    report.providerEndpointReadbackVerified !== true) fail('report_invalid');
  const envelope = await read(resolve(path, request.provider + '-registration-response.enc.json'), options.expectedResponseSha256);
  const captured = decodeCaptured(unseal(envelope, header(request, intent.archiveKeyId, 'response'), options.archiveKeyHex));
  const secret = request.provider === 'stripe' ? captured.response?.secret : captured.response?.signing_secret;
  if (captured.response?.id !== report.endpointId || !validSecret(request.provider, secret)) fail('report_invalid');
  return {binding: request.binding, secret};
}

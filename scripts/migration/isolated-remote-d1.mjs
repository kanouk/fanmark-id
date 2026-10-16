/** Prepared/batch transport for an explicitly created isolated recovery D1. */
const bindings = new WeakSet();
const statements = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class IsolatedRemoteD1Error extends Error {
  constructor(code) { super(code); this.name = 'IsolatedRemoteD1Error'; this.code = code; }
}
function refuse(code) { throw new IsolatedRemoteD1Error(code); }
function validateTarget(target) {
  if (!target || !/^[0-9a-f]{32}$/u.test(target.accountId ?? '') ||
      !UUID.test(target.databaseId ?? '') || !UUID.test(target.targetIncarnation ?? '') ||
      !/^fanmark-recovery-[a-z0-9-]{8,48}-(business|auth|master)$/u.test(target.databaseName ?? '') ||
      typeof target.createdAt !== 'string' || !Number.isFinite(Date.parse(target.createdAt))) {
    refuse('isolated_target_identity_invalid');
  }
}
function params(values) {
  if (values.length > 100 || values.some(value => value !== null &&
      typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) {
    refuse('remote_binding_value_invalid');
  }
  return [...values];
}

export function createIsolatedRemoteD1({ target, token, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  validateTarget(target);
  if (typeof token !== 'string' || token.length < 16 || /\s/u.test(token) ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    refuse('remote_transport_configuration_invalid');
  }
  const identity = Object.freeze({ accountId: target.accountId, databaseId: target.databaseId,
    databaseName: target.databaseName, createdAt: target.createdAt, targetIncarnation: target.targetIncarnation });
  const base = `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/d1/database/${identity.databaseId}`;
  let verification = null;

  async function request(suffix, payload) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body && Buffer.byteLength(body) > MAX_BODY_BYTES) refuse('remote_request_too_large');
    let response;
    try {
      response = await fetchImpl(base + suffix, {
        method: payload === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { refuse('remote_request_acknowledgement_unknown'); }
    // Never surface response bodies: provider diagnostics may contain SQL/data.
    if (!response.ok) { try { await response.body?.cancel(); } catch {} refuse('remote_api_request_failed'); }
    const reader = response.body?.getReader();
    if (!reader) refuse('remote_response_invalid');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); refuse('remote_response_too_large'); }
        chunks.push(Buffer.from(next.value));
      }
    } catch (error) {
      if (error instanceof IsolatedRemoteD1Error) throw error;
      refuse('remote_response_acknowledgement_unknown');
    } finally { reader.releaseLock(); }
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { refuse('remote_response_invalid'); }
    if (envelope?.success !== true) refuse('remote_api_request_failed');
    return envelope.result;
  }
  async function verify() {
    if (!verification) verification = request('', undefined).then(metadata => {
      if (metadata?.uuid !== identity.databaseId || metadata?.name !== identity.databaseName ||
          metadata?.created_at !== identity.createdAt) refuse('isolated_target_identity_mismatch');
      return identity;
    }).catch(error => { verification = null; throw error; });
    return verification;
  }
  async function execute(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) refuse('remote_batch_size_invalid');
    await verify();
    // One REST batch, never a loop over individual writes. No automatic retry:
    // an unknown ACK must be resolved by importer checkpoint/readback logic.
    const result = await request('/query', { batch: items });
    if (!Array.isArray(result) || result.length !== items.length || result.some(row =>
      row?.success !== true || !Array.isArray(row.results) || !row.meta || typeof row.meta !== 'object')) {
      refuse('remote_query_result_invalid');
    }
    return result;
  }
  function prepare(sql, values = []) {
    if (typeof sql !== 'string' || !sql.trim() || Buffer.byteLength(sql) > 100000) refuse('remote_statement_invalid');
    const bound = params(values);
    const statement = Object.freeze({
      bind(...next) { return prepare(sql, next); },
      async all() { return (await execute([{ sql, params: bound }]))[0]; },
      async run() { return this.all(); },
      async first(column) {
        const row = (await this.all()).results[0] ?? null;
        if (column === undefined) return row;
        if (typeof column !== 'string') refuse('remote_column_invalid');
        return row?.[column] ?? null;
      },
    });
    statements.set(statement, { owner: database, sql, params: bound });
    return statement;
  }
  const database = Object.freeze({
    prepare,
    async batch(items) {
      if (!Array.isArray(items) || items.some(item => statements.get(item)?.owner !== database)) {
        refuse('remote_batch_statement_target_mismatch');
      }
      return execute(items.map(item => {
        const { sql, params: bound } = statements.get(item);
        return { sql, params: bound };
      }));
    },
    verifyIsolatedTarget: verify,
    targetIdentity: identity,
  });
  bindings.add(database);
  return database;
}

export function isIsolatedRemoteD1(database) { return bindings.has(database); }
export async function assertIsolatedRemoteD1Target(database, targetIncarnation) {
  if (!isIsolatedRemoteD1(database) || database.targetIdentity.targetIncarnation !== targetIncarnation) {
    refuse('isolated_remote_binding_required');
  }
  return database.verifyIsolatedTarget();
}

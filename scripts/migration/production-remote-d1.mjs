/** Production-only D1 transport. Resource identity is pinned independently of caller input.
 * Every SQL batch rechecks metadata; writes require a durable intent journal.
 * No retries or automatic resolution of an unfinished write are permitted.
 */
import { createHash } from 'node:crypto';
import { openProductionImportJournal, isProductionImportJournal } from './production-import-journal.mjs';
import { isProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { registerProductionRemoteD1, isProductionRemoteD1 } from './production-d1-brand.mjs';
import {isCloudflareCredentialLease,createLeaseBoundCloudflareFetch} from './cloudflare-credential-lease.mjs';
import {validateMasterCommitStatements,masterCommitBatch,masterCommitRead,reconcileMasterCommit} from './master-atomic-commit.mjs';
export { isProductionRemoteD1 } from './production-d1-brand.mjs';
import { PRODUCTION_D1_TARGETS as targets } from './production-d1-targets.mjs';
export { PRODUCTION_D1_TARGETS } from './production-d1-targets.mjs';

const statements = new WeakMap();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ProductionRemoteD1Error extends Error {
  constructor(code, diagnostics = {}) {
    super(code); this.name = 'ProductionRemoteD1Error'; this.code = code;
    if (Number.isInteger(diagnostics.httpStatus)) this.httpStatus = diagnostics.httpStatus;
    this.providerCodes = Object.freeze((diagnostics.providerCodes ?? []).filter(Number.isSafeInteger).slice(0,8));
  }
}
function refuse(code, diagnostics) { throw new ProductionRemoteD1Error(code, diagnostics); }
function validateTarget(target) {
  const expected = targets.find(row => row.databaseId === target?.databaseId);
  if (!expected || Object.entries(expected).some(([key,value]) => target[key] !== value) ||
      !UUID.test(target.targetIncarnation ?? '')) refuse('production_target_identity_invalid');
}

// A deliberately narrow SQL classifier, not a general SQL parser. A read-only
// transport admits one SELECT or one named read-only PRAGMA. Comments and
// compound statements are refused; quote contents cannot hide another statement.
export function isReadOnlyProductionSql(sql) {
  if (typeof sql !== 'string') return false;
  const masked = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/gu, "''").trim();
  if (/;|--|\/\*|\*\//u.test(masked)) return false;
  return /^SELECT\s/iu.test(masked) ||
    /^PRAGMA\s+(?:foreign_key_check|foreign_keys|integrity_check|quick_check)$/iu.test(masked) ||
    /^PRAGMA\s+(?:table_info|table_xinfo|index_list|index_info|foreign_key_list)\s*\(\s*(?:[A-Za-z_][A-Za-z0-9_]*|'')\s*\)$/iu.test(masked);
}
function params(values) {
  if (values.length > 100 || values.some(value => value !== null &&
      typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))) {
    refuse('remote_binding_value_invalid');
  }
  return [...values];
}

export function createProductionRemoteD1({ target, token, credentialLease = null, access = 'read-only', atomicMasterCommits = access === 'import' && target?.store === 'master', fetchImpl = fetch, timeoutMs = 30000, journal = null } = {}) {
  validateTarget(target);
  if (!['read-only','import'].includes(access)) refuse('production_access_invalid');
  if (access === 'import' && (!isProductionImportJournal(journal) || typeof journal.beforeWrite !== 'function' ||
      typeof journal.afterWrite !== 'function' || journal.targetId !== target.databaseId ||
      journal.targetIncarnation !== target.targetIncarnation)) refuse('production_import_journal_required');
  if (access === 'import' && journal.coordinated !== true) refuse('production_import_coordinator_required');
  if (access === 'import' && !isCloudflareCredentialLease(credentialLease)) refuse('production_import_credential_lease_required');
  if (access === 'import' && target.store === 'master' && atomicMasterCommits !== true) refuse('production_master_atomic_commits_required');
  if (atomicMasterCommits && (target.databaseId !== targets[1].databaseId || access !== 'import' || !credentialLease)) refuse('production_master_commit_configuration_invalid');
  if ((credentialLease !== null && (!isCloudflareCredentialLease(credentialLease) || credentialLease.accountId !== target.accountId)) ||
      (credentialLease === null && (typeof token !== 'string' || token.length < 16 || /\s/u.test(token))) ||
      typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    refuse('remote_transport_configuration_invalid');
  }
  const identity = Object.freeze({ accountId: target.accountId, databaseId: target.databaseId,
    databaseName: target.databaseName, store: target.store, createdAt: target.createdAt, targetIncarnation: target.targetIncarnation });
  const base = `https://api.cloudflare.com/client/v4/accounts/${identity.accountId}/d1/database/${identity.databaseId}`;
  const send = credentialLease ? createLeaseBoundCloudflareFetch({lease:credentialLease,fetchImpl}) : fetchImpl;

  async function request(suffix, payload) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body && Buffer.byteLength(body) > MAX_BODY_BYTES) refuse('remote_request_too_large');
    let response;
    try {
      response = await send(base + suffix, {
        method: payload === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { refuse('remote_request_acknowledgement_unknown'); }
    // The bounded envelope is consumed below even on HTTP failure, so retain
    // numeric diagnostics without ever exposing provider messages or SQL/data.
    const reader = response.body?.getReader();
    if (!reader) refuse(response.ok?'remote_response_invalid':'remote_api_request_failed',{httpStatus:response.status});
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
      if (error instanceof ProductionRemoteD1Error) throw error;
      refuse('remote_response_acknowledgement_unknown');
    } finally { reader.releaseLock(); }
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { refuse(response.ok?'remote_response_invalid':'remote_api_request_failed',{httpStatus:response.status}); }
    if (!response.ok || envelope?.success !== true) refuse('remote_api_request_failed', {
      httpStatus:response.status, providerCodes:(Array.isArray(envelope?.errors)?envelope.errors:[]).map(row=>row?.code),
    });
    return envelope.result;
  }
  async function verify() {
    const metadata = await request('', undefined);
    if (metadata?.uuid !== identity.databaseId || metadata?.name !== identity.databaseName ||
        metadata?.created_at !== identity.createdAt) refuse('production_target_identity_mismatch');
    return identity;
  }
  async function execute(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) refuse('remote_batch_size_invalid');
    const writes = items.some(item => !isReadOnlyProductionSql(item.sql));
    if (writes && access !== 'import') refuse('production_read_only_violation');
    const batchSha256 = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    const commitIdentity = {runId:journal?.runId,batchSha256,targetId:target.databaseId,targetIncarnation:target.targetIncarnation};
    if (writes && atomicMasterCommits) {
      validateMasterCommitStatements(items);
      if(Buffer.byteLength(JSON.stringify({batch:masterCommitBatch(items,{...commitIdentity,operationId:'00000000-0000-4000-8000-000000000000'})}))>MAX_BODY_BYTES)refuse('remote_request_too_large');
    } else if(Buffer.byteLength(JSON.stringify({batch:items}))>MAX_BODY_BYTES)refuse('remote_request_too_large');
    if (writes && credentialLease) await credentialLease.acquire();
    await verify();
    // Metadata reads and local pacing can consume time; reacquire before a
    // durable intent or remote coordinator begin is allowed to exist.
    if (writes && credentialLease) await credentialLease.acquire();
    const operation = writes ? await journal.beforeWrite(batchSha256) : null;
    // The journal remains pending on every ambiguous outcome, including a
    // missing result or a failed durable completion write. Never resend here.
    let result;
    if (writes && atomicMasterCommits) {
      const identity={...commitIdentity,operationId:operation};
      const before=await journal.inspectActive(operation,batchSha256);
      try {
        const wrapped=await request('/query',{batch:masterCommitBatch(items,identity)});
        if(!Array.isArray(wrapped)||wrapped.length!==items.length*2+2||wrapped.some(row=>row?.success!==true||!Array.isArray(row.results)||!row.meta))refuse('remote_query_result_invalid');
        result=items.map((_,index)=>wrapped[index*2+1]);
      } catch(error) {
        // Separate read after the failed response. No SQL write or ACK replay.
        // Even a 401 or an absent receipt leaves the original operation pending.
        try {
          await verify();
          result=reconcileMasterCommit(await request('/query',{batch:[masterCommitRead(operation)]}),identity,items.length);
          const after=await journal.inspectActive(operation,batchSha256);
          if(after.executorId!==before.executorId)refuse('production_executor_changed');
        } catch { throw error; }
      }
    } else result = await request('/query', { batch: items });
    if (!Array.isArray(result) || result.length !== items.length || result.some(row =>
      row?.success !== true || !Array.isArray(row.results) || !row.meta || typeof row.meta !== 'object')) {
      refuse('remote_query_result_invalid');
    }
    if (writes) await journal.afterWrite(operation);
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
    verifyProductionTarget: verify,
    importContext: access === "import" ? Object.freeze({ coordinator: journal.coordinator, journalPath: journal.path, runId: journal.runId }) : null,
    targetIdentity: identity,
    credentialPolicy: credentialLease ? 'lease-v1' : 'static-token',
    masterCommitPolicy: atomicMasterCommits ? 'atomic-receipt-v1' : null,
    access,
  });
  registerProductionRemoteD1(database);
  return database;
}

export async function assertProductionRemoteD1Target(database, targetIncarnation) {
  if (!isProductionRemoteD1(database) || database.targetIdentity.targetIncarnation !== targetIncarnation) {
    refuse('production_remote_binding_required');
  }
  return database.verifyProductionTarget();
}

export async function openProductionD1ImportTransport({ journalPath, runId, target, coordinator = null, ...options }) {
  validateTarget(target);
  if (!isProductionImportCoordinator(coordinator)) refuse('production_import_coordinator_required');
  const journal = await openProductionImportJournal({ path: journalPath, runId,
    targetId: target.databaseId, targetIncarnation: target.targetIncarnation, coordinator });
  return createProductionRemoteD1({ ...options, target, access: 'import', journal });
}

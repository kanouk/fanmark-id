/** Short-lived operator capability. Creation changes only a new UUID-named
 * proxy Worker. It never claims the coordinator or writes application stores.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { PRODUCTION_RUNTIME } from '../../workers/api/src/production-runtime-identity.ts';
import { resolveProductionEmojiTarget } from './production-emoji-target.mjs';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const fail = () => { throw Error('production_import_gateway_unconfirmed'); };
export function productionImportGatewaySource() {
  return `export default {async fetch(r,e){
if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return new Response(null,{status:410});
if(r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return new Response(null,{status:401});
const u=new URL(r.url),write=e.GATE_ACCESS==='import';
try{
 if(u.pathname.startsWith('/r2/')&&((r.method==='GET'&&['/r2/identity','/r2/list','/r2/object'].includes(u.pathname))||(write&&r.method==='PUT'&&u.pathname==='/r2/object'))){
  const headers=new Headers(r.headers);headers.delete('authorization');headers.set('x-fanmark-import-runtime',e.EXPECTED_RUNTIME);
  return e.R2_IMPORT.fetch(new Request('https://production-import-r2.internal'+u.pathname.slice(3)+u.search,{method:r.method,headers,...(r.method==='PUT'?{body:r.body}:{})}));
 }
 if(r.method==='POST'&&!u.search&&u.pathname.startsWith('/coordinator/')){
  const action=u.pathname.slice(13);
  if(!['inspect',...(write?['claim','begin','acknowledge','complete']:[])].includes(action))return new Response(null,{status:404});
  if(Number(r.headers.get('content-length')??0)>1024)return new Response(null,{status:413});
  let text='';if(r.body){const reader=r.body.getReader(),decoder=new TextDecoder();let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024){await reader.cancel();return new Response(null,{status:413});}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
  return Response.json(await e.IMPORT_COORDINATOR.command(action,JSON.parse(text)),{headers:{'cache-control':'no-store'}});
 }
 return new Response(null,{status:404});
}catch{return Response.json({error:'production_import_gateway_refused'},{status:409});}
}};`;
}

/** Delete only the acknowledged gateway incarnation recorded by open().
 * Unknown upload outcomes are deliberately left for independent inspection.
 */
export async function closeProductionImportGateway({ journalPath, token, fetchImpl = fetch } = {}) {
  if (!path.isAbsolute(journalPath ?? '') || typeof token !== 'string' || token.length < 16 || /\s/u.test(token)) fail();
  const parent = await lstat(path.dirname(journalPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) fail();
  const file = await open(journalPath, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) fail();
    const contents = await file.readFile('utf8'); if (!contents.endsWith('\n')) fail();
    const states = contents.trim().split('\n').map(line => JSON.parse(line)), state = states.at(-1);
    if (!state || state.format !== 'fanmark-production-import-gateway-v1' || !UUID.test(state.id) ||
        state.name !== 'fanmark-prod-import-' + state.id || state.accountId !== PRODUCTION_RUNTIME.accountId ||
        !UUID.test(state.gatewayVersion ?? '') || !UUID.test(state.runtimeVersion ?? '') ||
        !['read-only', 'import'].includes(state.access) || !Number.isSafeInteger(state.expiresAt) ||
        states.some(row => ['id', 'name', 'accountId', 'runtimeVersion', 'access', 'expiresAt'].some(key => row[key] !== state[key]))) fail();
    const resource = `https://api.cloudflare.com/client/v4/accounts/${PRODUCTION_RUNTIME.accountId}/workers/scripts/${state.name}`;
    async function request(suffix = '', method = 'GET') {
      return fetchImpl(resource + suffix, { method, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    }
    async function api(suffix) {
      const response = await request(suffix); if (!response.ok) { await response.body?.cancel(); fail(); }
      const envelope = await response.json(); if (envelope.success !== true) fail(); return envelope.result;
    }
    // No automatic replay of an already requested deletion.
    if (['cleanup_requested', 'closed'].includes(state.state)) {
      const response = await request(); const absent = response.status === 404; await response.body?.cancel();
      if (!absent) fail(); return { name: state.name, removed: true };
    }
    const settings = await api('/settings'), deployment = await api('/deployments');
    const binding = name => settings.bindings?.filter(row => row.name === name);
    for (const [name, value] of Object.entries({ GATE_OWNER: state.id, EXPECTED_RUNTIME: state.runtimeVersion,
      GATE_ACCESS: state.access, EXPIRES_AT: String(state.expiresAt) })) if (binding(name)?.length !== 1 || binding(name)[0].text !== value) fail();
    for (const [name, entrypoint] of Object.entries({ R2_IMPORT: 'ProductionR2ImportService', IMPORT_COORDINATOR: 'ProductionImportCoordinatorService' })) {
      const rows = binding(name); if (rows?.length !== 1 || rows[0].type !== 'service' || rows[0].service !== PRODUCTION_RUNTIME.worker || rows[0].entrypoint !== entrypoint) fail();
    }
    const versions = deployment?.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100 || versions[0].version_id !== state.gatewayVersion) fail();
    const lock = await open(journalPath + '.cleanup.lock', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await lock.sync(); } finally { await lock.close(); }
    const directory = await open(path.dirname(journalPath), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    state.state = 'cleanup_requested'; await file.writeFile(JSON.stringify(state) + '\n'); await file.sync();
    try { const response = await request('', 'DELETE'); await response.body?.cancel(); } catch { /* Inspect once, never resend. */ }
    const response = await request(); const absent = response.status === 404; await response.body?.cancel(); if (!absent) fail();
    state.state = 'closed'; await file.writeFile(JSON.stringify(state) + '\n'); await file.sync();
    return { name: state.name, removed: true };
  } catch { fail(); } finally { await file.close(); }
}

export async function openProductionImportGateway({ journalPath, runtimeVersion, access = 'read-only', token, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!path.isAbsolute(journalPath ?? '') || !UUID.test(runtimeVersion ?? '') || !['read-only', 'import'].includes(access) ||
      typeof token !== 'string' || token.length < 16 || /\s/u.test(token) || typeof fetchImpl !== 'function') fail();
  const parent = await lstat(path.dirname(journalPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) fail();
  const id = randomUUID(), name = 'fanmark-prod-import-' + id, bearer = randomBytes(32).toString('hex');
  const expiresAt = now() + 2 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(expiresAt)) fail();
  const state = { format: 'fanmark-production-import-gateway-v1', id, name, bearer, runtimeVersion, access, expiresAt,
    accountId: PRODUCTION_RUNTIME.accountId, state: 'prepared', gatewayVersion: null };
  const file = await open(journalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  // Append-only stages preserve the last known control-plane outcome after a crash.
  async function save() { await file.writeFile(JSON.stringify(state) + '\n'); await file.sync(); }
  const base = `https://api.cloudflare.com/client/v4/accounts/${PRODUCTION_RUNTIME.accountId}`;
  async function request(resource, options = {}) {
    try { return await fetchImpl(base + resource, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, ...options.headers } }); } catch { fail(); }
  }
  async function api(resource, method = 'GET', body) {
    const response = await request(resource, { method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      headers: body instanceof FormData ? {} : { 'content-type': 'application/json',
        ...(resource.endsWith('/subdomain') && method === 'POST' ? { 'Cloudflare-Workers-Script-Api-Date': '2025-08-01' } : {}) } });
    let result; try { result = await response.json(); } catch { fail(); }
    if (!response.ok || result.success !== true) {
      // Keep only bounded numeric diagnostics, never provider messages or bodies.
      state.controlPlaneFailure = { stage: state.state, method, status: response.status,
        errorCodes: (Array.isArray(result.errors) ? result.errors : []).slice(0, 8)
          .map(row => row?.code).filter(code => Number.isSafeInteger(code) && code >= 0) };
      fail();
    }
    return result.result;
  }
  const versionOf = value => {
    const versions = value?.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100 || !UUID.test(versions[0].version_id)) fail();
    return versions[0].version_id;
  };
  try {
    await save();
    const directory = await open(path.dirname(journalPath), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    const settings = await api('/workers/scripts/' + PRODUCTION_RUNTIME.worker + '/settings');
    resolveProductionEmojiTarget(settings);
    for (const [name, value] of Object.entries({ CUTOVER_WRITE_FREEZE: 'receipt_only', STORAGE_BACKEND: 'r2', RECOVERY_DRAIN_BACKEND: 'durable-object' })) {
      const rows = settings.bindings.filter(row => row.name === name); if (rows.length !== 1 || rows[0].text !== value) fail();
    }
    if (versionOf(await api('/workers/scripts/' + PRODUCTION_RUNTIME.worker + '/deployments')) !== runtimeVersion) fail();
    const resource = '/workers/scripts/' + name;
    const absent = await request(resource); const missing = absent.status === 404; await absent.body?.cancel(); if (!missing) fail();
    const bindings = [
      { type: 'service', name: 'R2_IMPORT', service: PRODUCTION_RUNTIME.worker, entrypoint: 'ProductionR2ImportService' },
      { type: 'service', name: 'IMPORT_COORDINATOR', service: PRODUCTION_RUNTIME.worker, entrypoint: 'ProductionImportCoordinatorService' },
      { type: 'secret_text', name: 'GATE_TOKEN', text: bearer },
      ...Object.entries({ EXPECTED_RUNTIME: runtimeVersion, GATE_ACCESS: access, GATE_OWNER: id, EXPIRES_AT: String(expiresAt) }).map(([name, text]) => ({ type: 'plain_text', name, text })),
    ];
    const form = new FormData();
    form.set('metadata', JSON.stringify({ main_module: 'index.mjs', compatibility_date: '2026-09-18', bindings }));
    form.set('index.mjs', new Blob([productionImportGatewaySource()], { type: 'application/javascript+module' }), 'index.mjs');
    state.state = 'upload_requested'; await save();
    await api(resource, 'PUT', form);
    state.gatewayVersion = versionOf(await api(resource + '/deployments'));
    state.state = 'activation_requested'; await save();
    // Pin both switches, matching Wrangler's versioned API contract. In the
    // legacy API, enabling workers.dev can also enable preview hostnames.
    const enabled = await api(resource + '/subdomain', 'POST', { enabled: true, previews_enabled: false });
    if (enabled?.enabled !== true || enabled.previews_enabled !== false) fail();
    const readback = await api(resource + '/subdomain');
    if (readback?.enabled !== true || readback.previews_enabled !== false) fail();
    state.state = 'open'; await save();
    return { ...state, gatewayOrigin: `https://${name}.fanmark-id.workers.dev` };
  } catch {
    state.failure = 'requires_independent_control_plane_inspection'; await save().catch(() => {}); fail();
  } finally { await file.close(); }
}

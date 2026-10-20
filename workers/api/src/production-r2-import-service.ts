import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./repository";
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from "./production-runtime-identity";
import { MAX_IMPORT_OBJECT_BYTES, validateImportKey, validateImportObject, importDigest, importObjectDigest } from "./production-r2-import-contract";

type ImportEnv = Env & { STAGING_BACKUP_SOURCE_IDS?: string };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
function fail(): never { throw Error("production_r2_import_refused"); }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
function decode(value: string | null) {
  if (!value || value.length > 16384) fail();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
}
function runtime(env: ImportEnv, request: Request) {
  const ids = JSON.parse(env.STAGING_BACKUP_SOURCE_IDS ?? "null");
  if (!ids || Object.keys(ids).sort().join(",") !== Object.keys(PRODUCTION_STORE_IDS).sort().join(",") ||
      Object.entries(PRODUCTION_STORE_IDS).some(([key, value]) => ids[key] !== value) ||
      env.RECOVERY_DRAIN_SCOPE_DIGEST !== PRODUCTION_RUNTIME.scope || env.RECOVERY_DRAIN_BACKEND !== "durable-object" ||
      env.D1_TOPOLOGY !== "split" || env.STORAGE_BACKEND !== "r2" || env.CUTOVER_WRITE_FREEZE !== "receipt_only" ||
      !env.RECOVERY_DRAIN || !env.AVATARS_BUCKET || !env.COVER_IMAGES_BUCKET ||
      !UUID.test(env.CF_VERSION_METADATA?.id ?? "") || request.headers.get("x-fanmark-import-runtime") !== env.CF_VERSION_METADATA?.id) fail();
}
function metadata(object: R2Object) {
  return { key: object.key, size: object.size, etag: object.etag, version: object.version,
    httpMetadata: object.httpMetadata ?? {}, customMetadata: object.customMetadata ?? {} };
}
async function boundedBody(request: Request, expected: number) {
  if (request.headers.has("content-length") && request.headers.get("content-length") !== String(expected)) fail();
  if (!request.body) { if (expected === 0) return new Uint8Array(0); fail(); }
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const row = await reader.read(); if (row.done) break;
      size += row.value.byteLength;
      if (size > expected || size > MAX_IMPORT_OBJECT_BYTES) { await reader.cancel(); fail(); }
      chunks.push(row.value);
    }
  } finally { reader.releaseLock(); }
  if (size !== expected) fail();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Binding-only service: no public router dispatches here. The operator must
 * separately pin deployed binding IDs, bucket creation dates and this version.
 * Only conditional creation is exposed. No delete, overwrite or automatic ACK.
 */
export async function productionR2ImportFetch(request: Request, env: ImportEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== "https://production-import-r2.internal") return json(null, 404);
  let stage = "runtime", dispatchStatus: number | undefined;
  try {
    runtime(env, request);
    if (request.method !== "GET" && env.PRODUCTION_OWNER_ACCEPTANCE_BACKEND && env.PRODUCTION_OWNER_ACCEPTANCE_BACKEND !== "disabled") fail();
    if (request.method === "GET" && url.pathname === "/identity" && !url.search) return json({
      runtimeVersion: env.CF_VERSION_METADATA!.id, scope: PRODUCTION_RUNTIME.scope, stores: PRODUCTION_STORE_IDS,
    });
    const store = url.searchParams.get("store");
    if (!["avatars", "covers"].includes(store ?? "")) fail();
    const bucket = store === "avatars" ? env.AVATARS_BUCKET! : env.COVER_IMAGES_BUCKET!;
    const allowed = url.pathname === "/list" ? ["store", "limit", "cursor"] : ["store", "key"];
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) fail();
    if (request.method === "GET" && url.pathname === "/list") {
      const limit = Number(url.searchParams.get("limit")), cursor = url.searchParams.get("cursor");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (cursor !== null && (!cursor || cursor.length > 4096))) fail();
      const page = await bucket.list({ limit, ...(cursor ? { cursor } : {}) });
      return json({ objects: page.objects.map(metadata), truncated: page.truncated, ...(page.truncated ? { cursor: page.cursor } : {}), delimitedPrefixes: page.delimitedPrefixes });
    }
    if (url.pathname !== "/object" || !["GET", "PUT"].includes(request.method)) return json(null, 404);
    const key = url.searchParams.get("key"); validateImportKey(key);
    if (request.method === "GET") {
      const object = await bucket.get(key); if (!object) return json(null, 404);
      if (object.size > MAX_IMPORT_OBJECT_BYTES) { await object.body.cancel(); fail(); }
      return new Response(object.body, { headers: { "cache-control": "no-store", "content-length": String(object.size),
        "x-fanmark-import-object": encode(metadata(object)) } });
    }
    stage = "input-object";
    const owner = request.headers.get("x-fanmark-import-owner"), operationId = request.headers.get("x-fanmark-import-operation");
    if (!UUID.test(owner ?? "") || !UUID.test(operationId ?? "")) fail();
    const object = validateImportObject(decode(request.headers.get("x-fanmark-import-object")));
    if (object.store !== store || object.key !== key) fail();
    stage = "body";const bytes = await boundedBody(request, object.size);
    stage = "content-digest";
    if (await importDigest(bytes) !== object.sha256) fail();
    stage = "operation-digest";const batchSha256 = await importObjectDigest(object);
    if (request.headers.get("x-fanmark-import-digest") !== batchSha256) fail();
    const stub = env.RECOVERY_DRAIN!.get(env.RECOVERY_DRAIN!.idFromName("recovery-writers-v1"));
    // This durable dispatch marker precedes R2. Losing the response cannot
    // authorize the same request again, even from another gateway/process.
    stage = "dispatch";
    const dispatched = await stub.fetch("https://recovery-writer.internal/migration/dispatch", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, operationId, batchSha256, store }) });
    dispatchStatus = dispatched.status;
    if (dispatched.status !== 200) fail();
    await dispatched.body?.cancel();
    stage = "r2-put";
    const saved = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
    if (!saved) return json(null, 412);
    stage = "r2-response";return json(metadata(saved));
  } catch { return json({ error: "production_r2_import_refused", stage, ...(dispatchStatus === undefined ? {} : {dispatchStatus}) }, 409); }
}
export class ProductionR2ImportService extends WorkerEntrypoint<ImportEnv> {
  fetch(request: Request) { return productionR2ImportFetch(request, this.env); }
}

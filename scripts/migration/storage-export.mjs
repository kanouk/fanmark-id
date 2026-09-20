#!/usr/bin/env node

/**
 * Read-only, bounded Supabase Storage export preparation.
 *
 * The command talks only to the Supabase Storage REST API. It never creates,
 * updates, deletes, or uploads a remote object. The service key is accepted
 * only from the process environment and is never written to the output.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_BUCKETS = Object.freeze(["avatars", "cover-images"]);
export const MAX_ALLOWED_CONCURRENCY = 8;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_OBJECT_BYTES = 100 * 1024 * 1024;
export const LIST_PAGE_SIZE = 1_000;
export const MAX_LIST_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_PREFIX_DEPTH = 40;
export const MAX_INVENTORY_OBJECTS = 100_000;
export const MAX_LIST_PAGES_PER_PREFIX = Math.ceil(MAX_INVENTORY_OBJECTS / LIST_PAGE_SIZE) + 1;

const STATUS_FILE = "export.status.json";
const MANIFEST_FILE = "manifest.json";
const OBJECTS_DIRECTORY = "objects";

export class StorageExportError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "StorageExportError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new StorageExportError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw fail("invalid_metadata", error);
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function objectIdentityHash(bucket, key) {
  return sha256Hex(`${bucket}/${key}`);
}

export function validateStorageKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.includes("\0") || key.includes("\\")) {
    throw fail("invalid_object_key");
  }
  const parts = key.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw fail("unsafe_object_key");
  }
  return key;
}

export function validateBuckets(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) throw fail("invalid_buckets");
  const seen = new Set();
  for (const bucket of buckets) {
    if (!DEFAULT_BUCKETS.includes(bucket) || seen.has(bucket)) throw fail("invalid_buckets");
    seen.add(bucket);
  }
  return [...buckets];
}

export function normalizeSupabaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") throw fail("missing_supabase_url");
  let url;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw fail("invalid_supabase_url", error);
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !localHttp) throw fail("invalid_supabase_url");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) {
    throw fail("invalid_supabase_url");
  }
  return url.origin;
}

function positiveInteger(value, code, { max }) {
  if (!/^\d+$/.test(String(value))) throw fail(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw fail(code);
  return parsed;
}

export function parseBuckets(value) {
  if (value === undefined) return [...DEFAULT_BUCKETS];
  return validateBuckets(
    String(value)
      .split(",")
      .map((bucket) => bucket.trim())
      .filter(Boolean),
  );
}

export function parseArguments(argv) {
  const values = {
    buckets: [...DEFAULT_BUCKETS],
    concurrency: DEFAULT_CONCURRENCY,
    maxBytes: DEFAULT_MAX_BYTES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    const name = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    let value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : undefined;
    if (value === undefined) {
      value = argv[index + 1];
      index += 1;
    }
    if (name === "--output-dir") {
      if (!value || values.outputDir) throw fail("invalid_output_dir");
      values.outputDir = path.resolve(value);
    } else if (name === "--buckets") {
      values.buckets = parseBuckets(value);
    } else if (name === "--concurrency") {
      values.concurrency = positiveInteger(value, "invalid_concurrency", { max: MAX_ALLOWED_CONCURRENCY });
    } else if (name === "--max-bytes") {
      values.maxBytes = positiveInteger(value, "invalid_max_bytes", { max: MAX_OBJECT_BYTES });
    } else if (name === "--timeout-ms") {
      values.timeoutMs = positiveInteger(value, "invalid_timeout", { max: MAX_TIMEOUT_MS });
    } else if (!values.help) {
      throw fail("unknown_argument");
    }
  }

  if (!values.help && !values.outputDir) throw fail("missing_output_dir");
  return values;
}

function authHeaders(serviceKey, includeJson = false) {
  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };
  if (includeJson) headers["content-type"] = "application/json";
  return headers;
}

function endpoint(baseUrl, bucket) {
  return `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`;
}

function createTimedSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutId);
    },
  };
}

async function beginFetch(url, init, { fetchImpl, timeoutMs }) {
  const timed = createTimedSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: timed.signal,
    });
    if (response.status >= 300 && response.status < 400) throw fail("redirect_rejected");
    return { response, signal: timed.signal, clear: timed.clear };
  } catch (error) {
    timed.clear();
    if (error instanceof StorageExportError) throw error;
    if (timed.signal.aborted) throw fail("timeout", error);
    throw fail("request_failed", error);
  }
}

async function readResponseBuffer(response, signal, maxBytes) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let failed = false;
  try {
    while (true) {
      const result = await readWithAbort(reader, signal);
      if (result.done) break;
      const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
      total += chunk.byteLength;
      if (total > maxBytes) throw fail("response_too_large");
      chunks.push(chunk);
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) cancelReader(reader);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readWithAbort(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(fail("timeout"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, fail("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      reader.read().then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    } catch (error) {
      finish(reject, error);
    }
  });
}

function cancelReader(reader) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // The reader can already be detached after an abort; cleanup is best effort.
  }
}

async function readJsonResponse(response, signal) {
  const bytes = await readResponseBuffer(response, signal, MAX_LIST_RESPONSE_BYTES);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw fail("invalid_response", error);
  }
}

async function listPage({ baseUrl, serviceKey, bucket, prefix, offset, fetchImpl, timeoutMs }) {
  const request = beginFetch(
    endpoint(baseUrl, bucket),
    {
      method: "POST",
      headers: authHeaders(serviceKey, true),
      body: JSON.stringify({
        prefix,
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    },
    { fetchImpl, timeoutMs },
  );
  const { response, signal, clear } = await request;
  try {
    if (!response.ok) throw fail("list_failed");
    const data = await readJsonResponse(response, signal);
    if (!Array.isArray(data)) throw fail("invalid_list_response");
    return data;
  } catch (error) {
    if (error instanceof StorageExportError) throw error;
    if (signal.aborted) throw fail("timeout", error);
    throw fail("list_failed", error);
  } finally {
    clear();
  }
}

function normalizeInventoryEntry(bucket, key, entry) {
  if (!isPlainObject(entry) || typeof entry.id !== "string") throw fail("invalid_object_entry");
  return {
    bucket,
    key,
    id: entry.id,
    updatedAt: entry.updated_at ?? null,
    metadata: cloneJson(entry.metadata ?? null),
  };
}

async function listBucket({ baseUrl, serviceKey, bucket, fetchImpl, timeoutMs }) {
  const files = [];
  const seenKeys = new Set();
  const seenIds = new Set();
  const visitedPrefixes = new Set([""]);

  async function visit(prefix, depth) {
    if (depth > MAX_PREFIX_DEPTH) throw fail("prefix_depth_exceeded");
    let pageCount = 0;
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      pageCount += 1;
      if (pageCount > MAX_LIST_PAGES_PER_PREFIX) throw fail("inventory_page_limit_exceeded");
      const entries = await listPage({ baseUrl, serviceKey, bucket, prefix, offset, fetchImpl, timeoutMs });
      for (const entry of entries) {
        if (!isPlainObject(entry) || typeof entry.name !== "string") throw fail("invalid_object_entry");
        const key = validateStorageKey(prefix ? `${prefix}/${entry.name}` : entry.name);
        if (entry.id === null) {
          if (visitedPrefixes.has(key)) continue;
          visitedPrefixes.add(key);
          if (visitedPrefixes.size > MAX_INVENTORY_OBJECTS) throw fail("inventory_prefix_limit_exceeded");
          await visit(key, depth + 1);
          continue;
        }
        const identity = `${bucket}\0${key}`;
        if (seenKeys.has(identity) || seenIds.has(`${bucket}\0${entry.id}`)) throw fail("duplicate_identity");
        seenKeys.add(identity);
        seenIds.add(`${bucket}\0${entry.id}`);
        files.push(normalizeInventoryEntry(bucket, key, entry));
        if (files.length > MAX_INVENTORY_OBJECTS) throw fail("inventory_object_limit_exceeded");
      }
      if (entries.length < LIST_PAGE_SIZE) break;
    }
  }

  await visit("", 0);
  return files;
}

export async function listStorageInventory({
  supabaseUrl,
  serviceKey,
  buckets = DEFAULT_BUCKETS,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof serviceKey !== "string" || serviceKey.length === 0) throw fail("missing_service_key");
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  const selectedBuckets = validateBuckets(buckets);
  const inventory = [];
  for (const bucket of selectedBuckets) {
    inventory.push(...(await listBucket({ baseUrl, serviceKey, bucket, fetchImpl, timeoutMs })));
    if (inventory.length > MAX_INVENTORY_OBJECTS) throw fail("inventory_object_limit_exceeded");
  }
  return inventory.sort((left, right) => `${left.bucket}/${left.key}`.localeCompare(`${right.bucket}/${right.key}`));
}

export function inventoryFingerprint(inventory) {
  return canonicalJson(
    inventory.map(({ bucket, key, id, updatedAt, metadata }) => ({
      bucket,
      key,
      id,
      updatedAt,
      metadata,
    })),
  );
}

function metadataReportedSize(metadata) {
  if (!isPlainObject(metadata) || metadata.size === undefined || metadata.size === null) return null;
  const value = Number(metadata.size);
  if (!Number.isSafeInteger(value) || value < 0) throw fail("invalid_metadata_size");
  return value;
}

async function downloadObject({ object, objectsDirectory, serviceKey, baseUrl, fetchImpl, timeoutMs, maxBytes }) {
  const objectUrl = `${baseUrl}/storage/v1/object/${encodeURIComponent(object.bucket)}/${object.key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const { response, signal, clear } = await beginFetch(
    objectUrl,
    { method: "GET", headers: authHeaders(serviceKey) },
    { fetchImpl, timeoutMs },
  );
  const identity = objectIdentityHash(object.bucket, object.key);
  const destination = path.join(objectsDirectory, identity);
  const temporary = `${destination}.part-${process.pid}-${randomBytes(6).toString("hex")}`;
  let reader = null;
  let handle = null;
  let completed = false;
  try {
    if (!response.ok) throw fail("download_failed");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw fail("byte_cap_exceeded");
    handle = await fs.open(temporary, "wx", 0o600);
    if (response.body) reader = response.body.getReader();
    const hash = createHash("sha256");
    let size = 0;
    while (reader) {
      const result = await readWithAbort(reader, signal);
      if (result.done) break;
      const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
      size += chunk.byteLength;
      if (size > maxBytes) throw fail("byte_cap_exceeded");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.chmod(0o600);
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
    completed = true;
    return { size, contentSHA256: hash.digest("hex"), localFile: `${OBJECTS_DIRECTORY}/${identity}` };
  } catch (error) {
    if (error instanceof StorageExportError) throw error;
    if (signal.aborted) throw fail("timeout", error);
    throw fail("download_read_failed", error);
  } finally {
    clear();
    if (reader && !completed) {
      cancelReader(reader);
      reader.releaseLock();
    }
    if (handle) await handle.close().catch(() => {});
    if (!completed) await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function downloadConcurrently(objects, worker, concurrency) {
  const results = new Array(objects.length);
  let nextIndex = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(objects.length, 1)) }, async () => {
    while (firstError === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= objects.length) return;
      try {
        results[index] = await worker(objects[index]);
      } catch (error) {
        firstError = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function prepareOutputDirectory(outputDir) {
  let outputStat = null;
  try {
    outputStat = await fs.lstat(outputDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw fail("invalid_output_dir", error);
  }
  if (outputStat) {
    if (outputStat.isSymbolicLink()) throw fail("unsafe_output_dir");
    if (!outputStat.isDirectory()) throw fail("invalid_output_dir");
    const existing = await fs.readdir(outputDir);
    if (existing.length > 0) throw fail("output_dir_not_empty");
  } else {
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  }
  outputStat = await fs.lstat(outputDir);
  if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) throw fail("unsafe_output_dir");
  await fs.chmod(outputDir, 0o700);
  const objectsDirectory = path.join(outputDir, OBJECTS_DIRECTORY);
  await fs.mkdir(objectsDirectory, { mode: 0o700 });
  await fs.chmod(objectsDirectory, 0o700);
  return objectsDirectory;
}

function statusPayload(status, buckets, startedAt, extra = {}) {
  return {
    schemaVersion: 1,
    status,
    startedAt,
    buckets,
    ...extra,
  };
}

function errorCode(error) {
  return error instanceof StorageExportError ? error.code : "export_failed";
}

export async function exportStorage({
  supabaseUrl,
  serviceKey,
  buckets = DEFAULT_BUCKETS,
  outputDir,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  concurrency = DEFAULT_CONCURRENCY,
  now = () => new Date(),
}) {
  if (typeof serviceKey !== "string" || serviceKey.length === 0) throw fail("missing_service_key");
  if (!outputDir || typeof outputDir !== "string") throw fail("missing_output_dir");
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  const selectedBuckets = validateBuckets(buckets);
  const boundedTimeout = positiveInteger(timeoutMs, "invalid_timeout", { max: MAX_TIMEOUT_MS });
  const boundedMaxBytes = positiveInteger(maxBytes, "invalid_max_bytes", { max: MAX_OBJECT_BYTES });
  const boundedConcurrency = positiveInteger(concurrency, "invalid_concurrency", { max: MAX_ALLOWED_CONCURRENCY });
  const absoluteOutputDir = path.resolve(outputDir);
  const startedAt = now().toISOString();
  let statusPath = null;
  let statusWritten = false;
  let manifestWritten = false;
  const manifestPath = path.join(absoluteOutputDir, MANIFEST_FILE);

  try {
    const objectsDirectory = await prepareOutputDirectory(absoluteOutputDir);
    statusPath = path.join(absoluteOutputDir, STATUS_FILE);
    statusWritten = true;
    await writeJsonAtomic(
      statusPath,
      statusPayload("in_progress", selectedBuckets, startedAt, { discoveredObjects: 0 }),
    );

    const before = await listStorageInventory({
      supabaseUrl: baseUrl,
      serviceKey,
      buckets: selectedBuckets,
      fetchImpl,
      timeoutMs: boundedTimeout,
    });
    await writeJsonAtomic(
      statusPath,
      statusPayload("in_progress", selectedBuckets, startedAt, { discoveredObjects: before.length }),
    );

    const downloaded = await downloadConcurrently(
      before,
      async (object) => {
        const result = await downloadObject({
          object,
          objectsDirectory,
          serviceKey,
          baseUrl,
          fetchImpl,
          timeoutMs: boundedTimeout,
          maxBytes: boundedMaxBytes,
        });
        const reportedSize = metadataReportedSize(object.metadata);
        if (reportedSize !== null && reportedSize !== result.size) throw fail("metadata_size_mismatch");
        return result;
      },
      boundedConcurrency,
    );

    const after = await listStorageInventory({
      supabaseUrl: baseUrl,
      serviceKey,
      buckets: selectedBuckets,
      fetchImpl,
      timeoutMs: boundedTimeout,
    });
    if (inventoryFingerprint(before) !== inventoryFingerprint(after)) throw fail("inventory_changed");
    const beforeInventorySHA256 = sha256Hex(inventoryFingerprint(before));
    const afterInventorySHA256 = sha256Hex(inventoryFingerprint(after));

    const manifest = {
      schemaVersion: 1,
      complete: true,
      generatedAt: now().toISOString(),
      buckets: selectedBuckets,
      objectCount: before.length,
      inventory: {
        stable: true,
        beforeSHA256: beforeInventorySHA256,
        afterSHA256: afterInventorySHA256,
      },
      objects: before.map((object, index) => ({
        bucket: object.bucket,
        key: object.key,
        size: downloaded[index].size,
        contentSHA256: downloaded[index].contentSHA256,
        metadata: object.metadata,
        localFile: downloaded[index].localFile,
      })),
    };
    await writeJsonAtomic(manifestPath, manifest);
    manifestWritten = true;
    await writeJsonAtomic(
      statusPath,
      statusPayload("complete", selectedBuckets, startedAt, {
        completedAt: now().toISOString(),
        discoveredObjects: before.length,
        objectCount: before.length,
        inventory: {
          stable: true,
          beforeSHA256: beforeInventorySHA256,
          afterSHA256: afterInventorySHA256,
        },
      }),
    );
    return { outputDir: absoluteOutputDir, objectCount: before.length, manifest };
  } catch (error) {
    if (manifestWritten) await fs.rm(manifestPath, { force: true }).catch(() => {});
    if (statusWritten && statusPath) {
      await writeJsonAtomic(
        statusPath,
        statusPayload("failed", selectedBuckets, startedAt, {
          failedAt: now().toISOString(),
          error: errorCode(error),
        }),
      ).catch(() => {});
    }
    if (error instanceof StorageExportError) throw error;
    throw fail("export_failed", error);
  }
}

export const USAGE = `Usage: storage-export.mjs --output-dir PATH [options]

Required environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Options:
  --output-dir PATH       New private export directory (required)
  --buckets a,b           Allowlisted buckets (default: avatars,cover-images)
  --concurrency N         Concurrent downloads, 1..${MAX_ALLOWED_CONCURRENCY} (default: ${DEFAULT_CONCURRENCY})
  --max-bytes N           Per-object byte cap (default: ${DEFAULT_MAX_BYTES})
  --timeout-ms N          Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --help                  Show this help
`;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const result = await exportStorage({
    ...options,
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  console.log(`Storage export complete: ${result.objectCount} objects.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Storage export failed (${errorCode(error)}); incomplete status was preserved when possible.`);
    process.exitCode = 1;
  });
}

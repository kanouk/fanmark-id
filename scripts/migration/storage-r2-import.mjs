#!/usr/bin/env node

/**
 * Copy a completed, locally verified Supabase Storage export into an injected
 * Cloudflare R2 binding-compatible bucket.
 *
 * This module deliberately has no credentials, network client, or Wrangler
 * dependency. A later transport runner can provide the R2 binding and choose
 * when this offline, resumable operation is authorized to run.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validateBuckets, validateStorageKey } from "./storage-export.mjs";
import { StorageVerifyError, verifyManifest } from "./storage-verify.mjs";

export const IMPORT_SCHEMA_VERSION = 1;
export const MAPPING_VERSION = 1;
export const DEFAULT_REPORT_FILE = "r2-import.status.json";
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const MAX_CHUNK_SIZE = 1024 * 1024;
export const MAX_R2_KEY_BYTES = 1024;
export const MAX_R2_METADATA_BYTES = 8 * 1024;
export const DEFAULT_MAX_OBJECT_BYTES = 100 * 1024 * 1024;
export const MAX_SINGLE_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
export const MAX_OPERATION_TIMEOUT_MS = 15 * 60 * 1000;

const SOURCE_BUCKET_METADATA = "fanmark-source-bucket";
const SOURCE_KEY_METADATA = "fanmark-source-key";
const SOURCE_HASH_METADATA = "fanmark-source-sha256";
const SOURCE_SIZE_METADATA = "fanmark-source-size";
const SOURCE_CONTENT_TYPE_METADATA = "fanmark-source-content-type";
const REQUIRED_METADATA = Object.freeze([
  SOURCE_BUCKET_METADATA,
  SOURCE_KEY_METADATA,
  SOURCE_HASH_METADATA,
  SOURCE_SIZE_METADATA,
]);
const STREAM_CANCEL_TIMEOUT_MS = 100;

export class StorageR2ImportError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "StorageR2ImportError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new StorageR2ImportError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function nowIso(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw fail("invalid_clock");
  return date.toISOString();
}

function positiveInteger(value, code, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail(code);
  return value;
}

function insideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function targetKeyFor(entry) {
  try {
    validateBuckets([entry.bucket]);
    validateStorageKey(entry.key);
  } catch (error) {
    throw fail("invalid_source_identity", error);
  }
  const targetKey = `${entry.bucket}/${entry.key}`;
  if (byteLength(targetKey) > MAX_R2_KEY_BYTES) throw fail("target_key_too_long");
  return targetKey;
}

export function mapStorageTargetKey(bucket, key) {
  return targetKeyFor({ bucket, key });
}

function contentTypeFor(metadata) {
  if (metadata === null || metadata === undefined) return null;
  if (!isPlainObject(metadata)) throw fail("invalid_source_metadata");
  const values = [];
  for (const field of ["mimetype", "contentType"]) {
    if (!Object.hasOwn(metadata, field) || metadata[field] === null || metadata[field] === undefined) continue;
    if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
      throw fail("invalid_source_content_type");
    }
    const value = metadata[field].trim();
    if (byteLength(value) > 1024) throw fail("source_content_type_too_long");
    values.push(value);
  }
  if (values.length > 1 && values[0] !== values[1]) throw fail("source_content_type_conflict");
  return values[0] ?? null;
}

function expectedObject(entry, { maxObjectBytes }) {
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxObjectBytes) {
    throw fail("source_size_out_of_bounds");
  }
  if (typeof entry.contentSHA256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.contentSHA256)) {
    throw fail("invalid_source_hash");
  }
  const targetKey = targetKeyFor(entry);
  const contentType = contentTypeFor(entry.metadata);
  const customMetadata = {
    [SOURCE_BUCKET_METADATA]: entry.bucket,
    [SOURCE_KEY_METADATA]: entry.key,
    [SOURCE_HASH_METADATA]: entry.contentSHA256,
    [SOURCE_SIZE_METADATA]: String(entry.size),
  };
  if (contentType !== null) customMetadata[SOURCE_CONTENT_TYPE_METADATA] = contentType;
  if (byteLength(JSON.stringify(customMetadata)) > MAX_R2_METADATA_BYTES) {
    throw fail("target_metadata_too_large");
  }
  return Object.freeze({
    bucket: entry.bucket,
    key: entry.key,
    targetKey,
    size: entry.size,
    contentSHA256: entry.contentSHA256,
    contentType,
    customMetadata: Object.freeze(customMetadata),
  });
}

async function readVerifiedManifest(exportDir) {
  if (typeof exportDir !== "string" || exportDir.trim() === "") throw fail("missing_export_dir");
  const absoluteExportDir = path.resolve(exportDir);
  const manifestPath = path.join(absoluteExportDir, "manifest.json");
  const manifestStat = await fs.lstat(manifestPath).catch((error) => {
    throw fail("manifest_unreadable", error);
  });
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw fail("manifest_unreadable");
  if (manifestStat.size > 64 * 1024 * 1024) throw fail("manifest_too_large");
  let verified;
  try {
    verified = await verifyManifest(manifestPath);
  } catch (error) {
    const code = error instanceof StorageVerifyError ? error.code : "invalid_manifest";
    throw fail(`manifest_${code}`, error);
  }
  let bytes;
  let manifest;
  try {
    bytes = await fs.readFile(manifestPath);
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw fail("manifest_unreadable", error);
  }
  if (!isPlainObject(manifest) || manifest.objectCount !== verified.objectCount) {
    throw fail("manifest_unreadable");
  }
  return {
    exportDir: verified.outputDir,
    manifestPath: verified.manifestPath,
    manifest,
    manifestSHA256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function resolveReportPath(exportDir, reportPath) {
  const absoluteReport = path.resolve(reportPath ?? path.join(exportDir, DEFAULT_REPORT_FILE));
  if (path.dirname(absoluteReport) !== exportDir || !insideDirectory(exportDir, absoluteReport)) {
    throw fail("report_outside_export");
  }
  if (path.basename(absoluteReport) === "manifest.json" || path.basename(absoluteReport) === "export.status.json") {
    throw fail("report_reserved_path");
  }
  return absoluteReport;
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  let handle = null;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readReport(reportPath) {
  let stat;
  try {
    stat = await fs.lstat(reportPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw fail("invalid_report", error);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) throw fail("invalid_report");
  let report;
  try {
    report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch (error) {
    throw fail("invalid_report", error);
  }
  if (!isPlainObject(report)) throw fail("invalid_report");
  return report;
}

function initialReport({ manifest, manifestSHA256, expected, now }) {
  return {
    schemaVersion: IMPORT_SCHEMA_VERSION,
    mappingVersion: MAPPING_VERSION,
    complete: false,
    status: "in_progress",
    manifestSHA256,
    objectCount: expected.length,
    startedAt: nowIso(now),
    updatedAt: nowIso(now),
    objects: expected.map((object) => ({
      sourceBucket: object.bucket,
      sourceKey: object.key,
      targetKey: object.targetKey,
      status: "pending",
      attempts: 0,
    })),
    sourceBuckets: Array.isArray(manifest.buckets) ? [...manifest.buckets] : [],
  };
}

function assertReportShape(report, expected, manifestSHA256) {
  if (
    report.schemaVersion !== IMPORT_SCHEMA_VERSION ||
    report.mappingVersion !== MAPPING_VERSION ||
    report.manifestSHA256 !== manifestSHA256 ||
    report.objectCount !== expected.length ||
    !Array.isArray(report.objects) ||
    report.objects.length !== expected.length ||
    !["in_progress", "failed", "complete"].includes(report.status) ||
    report.complete !== (report.status === "complete")
  ) {
    throw fail("report_manifest_mismatch");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const state = report.objects[index];
    const object = expected[index];
    if (
      !isPlainObject(state) ||
      state.sourceBucket !== object.bucket ||
      state.sourceKey !== object.key ||
      state.targetKey !== object.targetKey ||
      !["pending", "in_progress", "failed", "verified"].includes(state.status) ||
      !Number.isSafeInteger(state.attempts) ||
      state.attempts < 0
    ) {
      throw fail("report_manifest_mismatch");
    }
  }
}

function reportCounts(report) {
  let verified = 0;
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const state of report.objects) {
    if (state.status === "verified") {
      verified += 1;
      if (state.operation === "copied") copied += 1;
      if (state.operation === "skipped") skipped += 1;
    }
    if (state.status === "failed") failed += 1;
  }
  return { verified, copied, skipped, failed };
}

function applyCounts(report) {
  const counts = reportCounts(report);
  report.verifiedCount = counts.verified;
  report.copiedCount = counts.copied;
  report.skippedCount = counts.skipped;
  report.failedCount = counts.failed;
  return counts;
}

async function consumeBody(body, { expectedSize, expectedHash, maxObjectBytes, errorCode, onReader }) {
  if (!body || typeof body.getReader !== "function") throw fail(errorCode);
  const reader = body.getReader();
  onReader?.(reader);
  const hash = createHash("sha256");
  let total = 0;
  let failed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value);
      total += chunk.byteLength;
      if (total > maxObjectBytes || total > expectedSize) throw fail(errorCode);
      hash.update(chunk);
    }
  } catch (error) {
    failed = true;
    if (error instanceof StorageR2ImportError) throw error;
    throw fail(errorCode, error);
  } finally {
    if (failed) {
      await cancelReaderBounded(reader);
    }
    try {
      reader.releaseLock();
    } catch {
      // A provider can release the reader while a read is unwinding.
    }
  }
  const actualHash = hash.digest("hex");
  if (total !== expectedSize) throw fail(errorCode);
  if (actualHash !== expectedHash) throw fail(errorCode);
  return { size: total, contentSHA256: actualHash };
}

async function cancelReaderBounded(reader) {
  let cancelPromise;
  try {
    cancelPromise = Promise.resolve(reader.cancel());
  } catch {
    return;
  }
  void cancelPromise.catch(() => {});
  await Promise.race([
    cancelPromise,
    new Promise((resolve) => setTimeout(resolve, STREAM_CANCEL_TIMEOUT_MS)),
  ]);
}

async function cancelBody(body) {
  if (!body || typeof body.getReader !== "function") return;
  let reader = null;
  try {
    reader = body.getReader();
    await cancelReaderBounded(reader);
  } catch {
    // Metadata validation remains authoritative even if a provider body cannot
    // be cancelled after an implementation-specific stream transition.
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // The provider may already have released the reader.
    }
  }
}

async function rejectTarget(target, code) {
  await cancelBody(target?.body);
  throw fail(code);
}

function remainingTimeout(deadline, code) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw fail(code);
  return remaining;
}

async function readTarget(r2, object, { maxObjectBytes, operationTimeoutMs }) {
  const deadline = Date.now() + operationTimeoutMs;
  let getPromise;
  let target;
  try {
    getPromise = Promise.resolve(r2.get(object.targetKey));
    void getPromise.catch(() => {});
    target = await withTimeout(
      getPromise,
      remainingTimeout(deadline, "target_read_timeout"),
      () => getPromise.then((lateTarget) => cancelBody(lateTarget?.body)).catch(() => {}),
      "target_read_timeout",
    );
  } catch (error) {
    if (error instanceof StorageR2ImportError) throw error;
    throw fail("target_read_failed", error);
  }
  if (target === null) return { exists: false };
  if (typeof target.key === "string" && target.key !== object.targetKey) {
    await rejectTarget(target, "target_key_mismatch");
  }
  if (!Number.isSafeInteger(target.size) || target.size !== object.size) {
    await rejectTarget(target, "target_metadata_mismatch");
  }
  const httpMetadata = isPlainObject(target.httpMetadata) ? target.httpMetadata : {};
  const actualContentType = httpMetadata.contentType ?? null;
  if (actualContentType !== object.contentType) {
    await rejectTarget(target, "target_content_type_mismatch");
  }
  const customMetadata = isPlainObject(target.customMetadata) ? target.customMetadata : {};
  for (const key of REQUIRED_METADATA) {
    if (typeof customMetadata[key] !== "string") {
      await rejectTarget(target, "target_metadata_missing");
    }
    if (customMetadata[key] !== object.customMetadata[key]) {
      await rejectTarget(target, "target_metadata_mismatch");
    }
  }
  if (object.contentType === null) {
    if (Object.hasOwn(customMetadata, SOURCE_CONTENT_TYPE_METADATA)) {
      await rejectTarget(target, "target_metadata_mismatch");
    }
  } else if (customMetadata[SOURCE_CONTENT_TYPE_METADATA] !== object.contentType) {
    await rejectTarget(target, "target_metadata_missing");
  }
  if (!("body" in target) || target.body === undefined) {
    await rejectTarget(target, "target_body_missing");
  }
  let bodyReader = null;
  const bodyRead = consumeBody(target.body, {
    expectedSize: object.size,
    expectedHash: object.contentSHA256,
    maxObjectBytes,
    errorCode: "target_readback_mismatch",
    onReader: (reader) => {
      bodyReader = reader;
    },
  });
  try {
    await withTimeout(
      bodyRead,
      remainingTimeout(deadline, "target_readback_timeout"),
      () => Promise.all([cancelReaderBounded(bodyReader), cancelBody(target.body)]),
      "target_readback_timeout",
    );
  } catch (error) {
    if (error instanceof StorageR2ImportError) throw error;
    throw fail("target_readback_mismatch", error);
  }
  return { exists: true };
}

function createSourceStream(filePath, object, { chunkSize }) {
  let fileHandle = null;
  let closed = false;
  let aborted = false;
  let abortReason = fail("source_cancelled");
  let offset = 0;
  let controllerRef = null;
  const hash = createHash("sha256");
  let settled = false;
  let resolveSummary;
  let rejectSummary;
  const summaryPromise = new Promise((resolve, reject) => {
    resolveSummary = resolve;
    rejectSummary = reject;
  });
  // A provider can reject before it has consumed the body. Keep the original
  // promise available for the later authoritative await while preventing an
  // unhandled rejection during cleanup/timeout handling.
  void summaryPromise.catch(() => {});

  async function ensureHandle() {
    if (aborted) throw abortReason;
    if (!fileHandle) {
      const opened = await fs.open(filePath, "r");
      if (aborted) {
        await opened.close().catch(() => {});
        throw abortReason;
      }
      fileHandle = opened;
    }
    return fileHandle;
  }

  async function closeHandle() {
    if (fileHandle && !closed) {
      closed = true;
      await fileHandle.close().catch(() => {});
    }
  }

  function finishFailure(error, controller) {
    aborted = true;
    abortReason = error;
    if (!settled) {
      settled = true;
      rejectSummary(error instanceof StorageR2ImportError ? error : fail("source_read_failed", error));
    }
    void closeHandle();
    try {
      controller.error(error);
    } catch {
      // The provider may have closed or errored the source while the file
      // read was unwinding.
    }
  }

  async function abort(reason = fail("source_cancelled")) {
    aborted = true;
    abortReason = reason;
    if (!settled) {
      settled = true;
      rejectSummary(reason);
    }
    try {
      controllerRef?.error(reason);
    } catch {
      // The stream may already be closed or errored.
    }
    await closeHandle();
  }

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
    },
    async pull(controller) {
      try {
        const handle = await ensureHandle();
        if (offset < object.size) {
          const length = Math.min(chunkSize, object.size - offset);
          const buffer = Buffer.allocUnsafe(length);
          const result = await handle.read(buffer, 0, length, offset);
          if (result.bytesRead <= 0) throw fail("source_size_changed");
          const chunk = buffer.subarray(0, result.bytesRead);
          offset += result.bytesRead;
          hash.update(chunk);
          controller.enqueue(new Uint8Array(chunk));
          return;
        }

        const probe = Buffer.alloc(1);
        const result = await handle.read(probe, 0, 1, offset);
        if (result.bytesRead !== 0) throw fail("source_size_changed");
        const contentSHA256 = hash.digest("hex");
        if (contentSHA256 !== object.contentSHA256) throw fail("source_hash_changed");
        if (!settled) {
          settled = true;
          resolveSummary({ size: offset, contentSHA256 });
        }
        await closeHandle();
        controller.close();
      } catch (error) {
        finishFailure(error, controller);
      }
    },
    async cancel(reason) {
      aborted = true;
      abortReason = fail("source_cancelled", reason);
      if (!settled) {
        settled = true;
        rejectSummary(abortReason);
      }
      await closeHandle();
    },
  });
  return { stream, summaryPromise, abort };
}

async function cancelSource(source) {
  await source.abort().catch(() => {});
  let cancelPromise;
  try {
    cancelPromise = Promise.resolve(source.stream.cancel());
  } catch {
    // A provider can retain the reader while a rejected put unwinds.
  }
  if (cancelPromise) {
    void cancelPromise.catch(() => {});
    await Promise.race([
      cancelPromise,
      new Promise((resolve) => setTimeout(resolve, STREAM_CANCEL_TIMEOUT_MS)),
    ]).catch(() => {});
  }
  await Promise.race([
    source.summaryPromise.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 100)),
  ]);
}

async function withTimeout(promise, timeoutMs, onTimeout, code) {
  let timer;
  const guarded = Promise.resolve(promise);
  // The timeout path may deliberately abandon a provider operation; attach a
  // rejection handler so a late provider failure cannot become unhandled.
  void guarded.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void Promise.resolve(onTimeout?.()).catch(() => {});
      reject(fail(code));
    }, timeoutMs);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function copyOrVerify(r2, entry, object, { maxObjectBytes, chunkSize, operationTimeoutMs }) {
  const existing = await readTarget(r2, object, { maxObjectBytes, operationTimeoutMs });
  if (existing.exists) return "skipped";

  const sourcePath = path.resolve(entry.localFilePath);
  const source = createSourceStream(sourcePath, object, { chunkSize });
  let putResult;
  try {
    const putOptions = {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: object.contentSHA256,
      httpMetadata: object.contentType === null ? undefined : { contentType: object.contentType },
      customMetadata: object.customMetadata,
    };
    const putPromise = typeof r2.putWithSize === "function"
      ? r2.putWithSize(object.targetKey, source.stream, putOptions, object.size)
      : r2.put(object.targetKey, source.stream, putOptions);
    putResult = await withTimeout(
      putPromise,
      operationTimeoutMs,
      () => cancelSource(source),
      "target_write_timeout",
    );
  } catch (error) {
    await cancelSource(source);
    if (error instanceof StorageR2ImportError) throw error;
    throw fail("target_write_failed", error);
  }

  if (putResult === null) {
    await cancelSource(source);
    const raced = await readTarget(r2, object, { maxObjectBytes, operationTimeoutMs });
    if (!raced.exists) throw fail("conditional_create_lost");
    return "skipped";
  }

  try {
    await withTimeout(source.summaryPromise, operationTimeoutMs, () => cancelSource(source), "source_read_timeout");
  } catch (error) {
    if (error instanceof StorageR2ImportError) throw error;
    throw fail("source_read_failed", error);
  }
  const verified = await readTarget(r2, object, { maxObjectBytes, operationTimeoutMs });
  if (!verified.exists) throw fail("post_write_missing");
  return "copied";
}

function validateR2(r2) {
  if (
    !r2 ||
    typeof r2.get !== "function" ||
    (typeof r2.put !== "function" && typeof r2.putWithSize !== "function")
  ) {
    throw fail("invalid_r2_binding");
  }
}

function validateReportAgainstManifest(report, expected, manifestSHA256) {
  assertReportShape(report, expected, manifestSHA256);
  applyCounts(report);
}

export async function importStorageExport({
  exportDir,
  reportPath,
  r2,
  maxObjectBytes = DEFAULT_MAX_OBJECT_BYTES,
  chunkSize = DEFAULT_CHUNK_SIZE,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  now = () => new Date(),
}) {
  validateR2(r2);
  positiveInteger(maxObjectBytes, "invalid_max_object_bytes", MAX_SINGLE_UPLOAD_BYTES);
  positiveInteger(chunkSize, "invalid_chunk_size", MAX_CHUNK_SIZE);
  positiveInteger(operationTimeoutMs, "invalid_operation_timeout", MAX_OPERATION_TIMEOUT_MS);
  if (typeof now !== "function") throw fail("invalid_clock");

  const verified = await readVerifiedManifest(exportDir);
  const absoluteReportPath = resolveReportPath(verified.exportDir, reportPath);
  const expected = verified.manifest.objects.map((entry) => {
    const object = expectedObject(entry, { maxObjectBytes });
    return { ...object, localFilePath: path.resolve(verified.exportDir, entry.localFile) };
  });
  const report = (await readReport(absoluteReportPath)) ?? initialReport({
    manifest: verified.manifest,
    manifestSHA256: verified.manifestSHA256,
    expected,
    now,
  });
  validateReportAgainstManifest(report, expected, verified.manifestSHA256);
  for (const state of report.objects) {
    // A completed report is progress bookkeeping, never proof that the
    // currently injected bucket still contains the bytes. Revalidate every
    // target on every invocation before allowing the report to complete.
    state.status = "pending";
    delete state.operation;
    delete state.errorCode;
  }
  report.complete = false;
  report.status = "in_progress";
  report.updatedAt = nowIso(now);
  applyCounts(report);
  await writeJsonAtomic(absoluteReportPath, report);

  for (let index = 0; index < expected.length; index += 1) {
    const state = report.objects[index];
    const object = expected[index];
    state.status = "in_progress";
    state.attempts += 1;
    report.updatedAt = nowIso(now);
    applyCounts(report);
    await writeJsonAtomic(absoluteReportPath, report);
    try {
      state.operation = await copyOrVerify(r2, object, object, {
        maxObjectBytes,
        chunkSize,
        operationTimeoutMs,
      });
      state.status = "verified";
      delete state.errorCode;
      state.verifiedAt = nowIso(now);
      report.status = "in_progress";
      report.complete = false;
      report.updatedAt = nowIso(now);
      applyCounts(report);
      await writeJsonAtomic(absoluteReportPath, report);
    } catch (error) {
      const importError = error instanceof StorageR2ImportError ? error : fail("import_failed", error);
      state.status = "failed";
      state.errorCode = importError.code;
      report.status = "failed";
      report.complete = false;
      report.lastError = importError.code;
      report.updatedAt = nowIso(now);
      applyCounts(report);
      await writeJsonAtomic(absoluteReportPath, report).catch(() => {});
      throw importError;
    }
  }

  const counts = applyCounts(report);
  if (counts.verified !== expected.length || counts.failed !== 0) throw fail("incomplete_import");
  report.status = "complete";
  report.complete = true;
  report.completedAt = nowIso(now);
  report.updatedAt = report.completedAt;
  delete report.lastError;
  await writeJsonAtomic(absoluteReportPath, report);
  return {
    reportPath: absoluteReportPath,
    objectCount: expected.length,
    copiedCount: counts.copied,
    skippedCount: counts.skipped,
    complete: true,
  };
}

export const USAGE = `Usage: storage-r2-import.mjs --help

The importer is a reusable offline core. It requires an explicitly injected
R2 binding-compatible object and therefore has no standalone credential or
network mode. A later authorized runner should call importStorageExport().
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  throw fail("no_standalone_transport");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof StorageR2ImportError ? error.code : "import_failed";
    console.error(`Storage R2 import unavailable (${code}); no remote operation was attempted.`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importStorageExport, mapStorageTargetKey, StorageR2ImportError } from "./storage-r2-import.mjs";
import { objectIdentityHash } from "./storage-export.mjs";

const textEncoder = new TextEncoder();

function bytes(value) {
  return value instanceof Uint8Array ? value : textEncoder.encode(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function privateJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function makeExport(objects) {
  const exportDir = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-r2-import-"));
  const objectsDir = path.join(exportDir, "objects");
  await fs.mkdir(objectsDir, { mode: 0o700 });
  await fs.chmod(exportDir, 0o700);
  const entries = [];
  const inventoryHash = "a".repeat(64);
  for (const source of objects) {
    const content = bytes(source.content);
    const contentSHA256 = hash(content);
    const localFile = `objects/${objectIdentityHash(source.bucket, source.key)}`;
    await fs.writeFile(path.join(exportDir, localFile), content, { mode: 0o600, flag: "wx" });
    entries.push({
      bucket: source.bucket,
      key: source.key,
      size: content.byteLength,
      contentSHA256,
      metadata: source.metadata ?? null,
      localFile,
    });
  }
  const buckets = [...new Set(objects.map((object) => object.bucket))];
  const inventory = { stable: true, beforeSHA256: inventoryHash, afterSHA256: inventoryHash };
  const manifest = {
    schemaVersion: 1,
    complete: true,
    generatedAt: "2026-09-21T00:00:00.000Z",
    buckets,
    objectCount: entries.length,
    inventory,
    objects: entries,
  };
  const status = {
    schemaVersion: 1,
    status: "complete",
    startedAt: "2026-09-21T00:00:00.000Z",
    buckets,
    objectCount: entries.length,
    inventory,
  };
  await fs.writeFile(path.join(exportDir, "manifest.json"), privateJson(manifest), { mode: 0o600 });
  await fs.writeFile(path.join(exportDir, "export.status.json"), privateJson(status), { mode: 0o600 });
  return { exportDir, entries, manifest };
}

async function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value instanceof Uint8Array ? result.value : new Uint8Array(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bodyStream(content) {
  return new ReadableStream({
    start(controller) {
      if (content.byteLength > 0) controller.enqueue(content);
      controller.close();
    },
  });
}

class MemoryR2 {
  constructor({ raceObjects = new Map(), failPut = false } = {}) {
    this.objects = new Map();
    this.raceObjects = raceObjects;
    this.failPut = failPut;
    this.putCalls = [];
    this.getCalls = [];
    this.deleteCalls = 0;
  }

  seed(key, { content, metadata = {}, httpMetadata = {}, size = undefined, bodyContent = undefined } = {}) {
    const value = bytes(content);
    this.objects.set(key, {
      key,
      content: value,
      bodyContent: bodyContent === undefined ? value : bytes(bodyContent),
      size: size ?? value.byteLength,
      customMetadata: { ...metadata },
      httpMetadata: { ...httpMetadata },
    });
  }

  objectFor(key) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      key,
      size: stored.size,
      httpMetadata: { ...stored.httpMetadata },
      customMetadata: { ...stored.customMetadata },
      body: bodyStream(stored.bodyContent),
    };
  }

  async get(key) {
    this.getCalls.push(key);
    return this.objectFor(key);
  }

  async put(key, value, options = {}) {
    this.putCalls.push({ key, options });
    if (this.failPut) throw new Error("synthetic write failure");
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    if (this.raceObjects.has(key)) {
      const raced = this.raceObjects.get(key);
      this.seed(key, raced);
      return null;
    }
    const content = await readStream(value);
    if (typeof options.sha256 === "string" && hash(content) !== options.sha256) {
      throw new Error("synthetic checksum failure");
    }
    const customMetadata = { ...(options.customMetadata ?? {}) };
    const httpMetadata = options.httpMetadata ? { ...options.httpMetadata } : {};
    this.seed(key, { content, metadata: customMetadata, httpMetadata });
    return this.objectFor(key);
  }

  async delete() {
    this.deleteCalls += 1;
    throw new Error("delete must not be called");
  }
}

function metadataFor(entry) {
  return {
    "fanmark-source-bucket": entry.bucket,
    "fanmark-source-key": entry.key,
    "fanmark-source-sha256": entry.contentSHA256,
    "fanmark-source-size": String(entry.size),
    ...(entry.contentType ? { "fanmark-source-content-type": entry.contentType } : {}),
  };
}

async function readReport(exportDir) {
  return JSON.parse(await fs.readFile(path.join(exportDir, "r2-import.status.json"), "utf8"));
}

async function assertCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof StorageR2ImportError && error.code === code);
}

test("copies empty, multichunk, and Unicode objects with deterministic source keys", async () => {
  const fixture = await makeExport([
    { bucket: "avatars", key: "empty.bin", content: "", metadata: { mimetype: "application/octet-stream", size: 0 } },
    { bucket: "avatars", key: "ユーザー/猫 🐈.txt", content: "unicode-content", metadata: { mimetype: "text/plain" } },
    { bucket: "cover-images", key: "nested/cover.webp", content: "cover-bytes", metadata: { contentType: "image/webp" } },
  ]);
  const r2 = new MemoryR2();
  const result = await importStorageExport({ exportDir: fixture.exportDir, r2, chunkSize: 3 });
  assert.equal(result.complete, true);
  assert.equal(result.objectCount, 3);
  assert.equal(result.copiedCount, 3);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual([...r2.objects.keys()].sort(), fixture.entries.map((entry) => mapStorageTargetKey(entry.bucket, entry.key)).sort());
  for (const entry of fixture.entries) {
    const object = r2.objects.get(mapStorageTargetKey(entry.bucket, entry.key));
    assert.equal(object.size, entry.size);
    assert.equal(object.customMetadata["fanmark-source-sha256"], entry.contentSHA256);
  }
  const report = await readReport(fixture.exportDir);
  assert.equal(report.complete, true);
  assert.equal(report.status, "complete");
  assert.equal(report.verifiedCount, 3);
  assert.equal((await fs.stat(path.join(fixture.exportDir, "r2-import.status.json"))).mode & 0o777, 0o600);
});

test("keeps bucket prefixes distinct and rejects UTF-8 key truncation", async () => {
  assert.notEqual(mapStorageTargetKey("avatars", "same.png"), mapStorageTargetKey("cover-images", "same.png"));
  const fixture = await makeExport([{ bucket: "avatars", key: `${"a".repeat(1020)}.bin`, content: "x" }]);
  const r2 = new MemoryR2();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2 }), "target_key_too_long");
  assert.equal(r2.putCalls.length, 0);
});

test("readback-verifies an existing match before skipping", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "match.txt", content: "same", metadata: { mimetype: "text/plain" } }]);
  const entry = fixture.entries[0];
  const key = mapStorageTargetKey(entry.bucket, entry.key);
  const r2 = new MemoryR2();
  r2.seed(key, {
    content: entry.content ?? "same",
    metadata: metadataFor({ ...entry, contentType: "text/plain" }),
    httpMetadata: { contentType: "text/plain" },
  });
  const result = await importStorageExport({ exportDir: fixture.exportDir, r2 });
  assert.equal(result.copiedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(r2.putCalls.length, 0);
  assert.equal(r2.getCalls.length >= 1, true);
});

test("revalidates verified report entries before completing a later run", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "recheck.txt", content: "recheck" }]);
  const r2 = new MemoryR2();
  await importStorageExport({ exportDir: fixture.exportDir, r2 });
  const key = mapStorageTargetKey("avatars", "recheck.txt");
  r2.objects.delete(key);
  const result = await importStorageExport({ exportDir: fixture.exportDir, r2 });
  assert.equal(result.complete, true);
  assert.equal(result.copiedCount, 1);
  assert.equal(result.skippedCount, 0);
});

test("does not trust a matching metadata hash when readback bytes are truncated", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "truncated.bin", content: "complete", metadata: { mimetype: "application/octet-stream" } }]);
  const entry = fixture.entries[0];
  const key = mapStorageTargetKey(entry.bucket, entry.key);
  const r2 = new MemoryR2();
  r2.seed(key, {
    content: "complete",
    bodyContent: "short",
    size: entry.size,
    metadata: metadataFor({ ...entry, contentType: "application/octet-stream" }),
    httpMetadata: { contentType: "application/octet-stream" },
  });
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2 }), "target_readback_mismatch");
  assert.equal(r2.putCalls.length, 0);
});

test("fails on a conflicting existing object without overwrite or delete", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "conflict.png", content: "expected", metadata: { mimetype: "image/png" } }]);
  const entry = fixture.entries[0];
  const key = mapStorageTargetKey(entry.bucket, entry.key);
  const r2 = new MemoryR2();
  r2.seed(key, { content: "different", metadata: {}, httpMetadata: { contentType: "image/png" } });
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2 }), "target_metadata_mismatch");
  assert.equal(r2.putCalls.length, 0);
  assert.equal(r2.deleteCalls, 0);
  assert.deepEqual([...r2.objects.get(key).content], [...bytes("different")]);
});

test("accepts a matching object created by a conditional-create race", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "race.txt", content: "race-content", metadata: { mimetype: "text/plain" } }]);
  const entry = fixture.entries[0];
  const key = mapStorageTargetKey(entry.bucket, entry.key);
  const r2 = new MemoryR2({
    raceObjects: new Map([
      [key, {
        content: "race-content",
        metadata: metadataFor({ ...entry, contentType: "text/plain" }),
        httpMetadata: { contentType: "text/plain" },
      }],
    ]),
  });
  const result = await importStorageExport({ exportDir: fixture.exportDir, r2 });
  assert.equal(result.copiedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(r2.putCalls[0].options.onlyIf.etagDoesNotMatch, "*");
});

test("persists an incomplete failure and resumes without claiming completion", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "retry.txt", content: "retry-content" }]);
  const r2 = new MemoryR2({ failPut: true });
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2 }), "target_write_failed");
  let report = await readReport(fixture.exportDir);
  assert.equal(report.complete, false);
  assert.equal(report.status, "failed");
  assert.equal(report.objects[0].status, "failed");
  r2.failPut = false;
  const resumed = await importStorageExport({ exportDir: fixture.exportDir, r2 });
  assert.equal(resumed.complete, true);
  report = await readReport(fixture.exportDir);
  assert.equal(report.objects[0].attempts, 2);
  assert.equal(report.objects[0].status, "verified");
});

test("refuses an existing object with missing source metadata", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "missing-metadata.txt", content: "bytes" }]);
  const entry = fixture.entries[0];
  const r2 = new MemoryR2();
  r2.seed(mapStorageTargetKey(entry.bucket, entry.key), { content: "bytes" });
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2 }), "target_metadata_missing");
});

test("rejects invalid stream and option boundaries before remote calls", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "options.txt", content: "bytes" }]);
  const r2 = new MemoryR2();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, maxObjectBytes: 0 }), "invalid_max_object_bytes");
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, chunkSize: Number.NaN }), "invalid_chunk_size");
  assert.equal(r2.putCalls.length, 0);
});

test("bounds a provider get timeout and cancels a late body", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "late-get.txt", content: "bytes" }]);
  let cancelled = false;
  const lateBody = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes("bytes"));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const r2 = {
    get: () => new Promise((resolve) => setTimeout(() => resolve({
      key: "avatars/late-get.txt",
      size: 5,
      httpMetadata: {},
      customMetadata: {},
      body: lateBody,
    }), 30)),
    put: async () => null,
  };
  const started = Date.now();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, operationTimeoutMs: 5 }), "target_read_timeout");
  assert.equal(Date.now() - started < 500, true);
  await delay(60);
  assert.equal(cancelled, true);
});

test("bounds a hanging readback body and does not wait on cancellation", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "hanging-body.txt", content: "bytes" }]);
  const entry = fixture.entries[0];
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  const r2 = {
    get: async () => ({
      key: "avatars/hanging-body.txt",
      size: 5,
      httpMetadata: {},
      customMetadata: metadataFor(entry),
      body,
    }),
    put: async () => null,
  };
  const started = Date.now();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, operationTimeoutMs: 5 }), "target_readback_timeout");
  assert.equal(Date.now() - started < 500, true);
});

test("aborts a provider put that retains a locked source reader", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "locked-put.txt", content: "bytes" }]);
  const r2 = {
    get: async () => null,
    put: (key, stream) => {
      stream.getReader();
      return Promise.reject(new Error("synthetic locked-reader failure"));
    },
  };
  const started = Date.now();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, operationTimeoutMs: 5 }), "target_write_failed");
  assert.equal(Date.now() - started < 500, true);
});

test("bounds an injected known-length put transport timeout", async () => {
  const fixture = await makeExport([{ bucket: "avatars", key: "known-length-timeout.txt", content: "bytes" }]);
  const r2 = {
    get: async () => null,
    putWithSize: async (key, stream, options, size) => {
      assert.equal(key, "avatars/known-length-timeout.txt");
      assert.equal(size, 5);
      assert.equal(options.onlyIf.etagDoesNotMatch, "*");
      // Keep the stream unconsumed to exercise importer cancellation when the
      // transport does not settle.
      void stream;
      return new Promise(() => {});
    },
  };
  const started = Date.now();
  await assertCode(importStorageExport({ exportDir: fixture.exportDir, r2, operationTimeoutMs: 5 }), "target_write_timeout");
  assert.equal(Date.now() - started < 500, true);
});

#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_BUCKETS,
  LIST_PAGE_SIZE,
  StorageExportError,
  exportStorage,
  listStorageInventory,
  objectIdentityHash,
} from "./storage-export.mjs";
import { StorageVerifyError, verifyManifest } from "./storage-verify.mjs";

const BASE_URL = "https://synthetic-storage.example.test";
const SERVICE_KEY = "synthetic-service-key-never-persisted";

function bytes(value) {
  return new TextEncoder().encode(value);
}

function objectRecord({ bucket, key, id, content, metadata = {}, updatedAt = "2026-09-21T00:00:00.000Z" }) {
  const contentBytes = typeof content === "string" ? bytes(content) : content;
  return {
    bucket,
    key,
    id,
    bytes: contentBytes,
    metadata: { size: contentBytes.byteLength, ...metadata },
    updated_at: updatedAt,
  };
}

function listEntries(records, prefix) {
  const entries = [];
  for (const record of records) {
    const relative = prefix ? (record.key.startsWith(`${prefix}/`) ? record.key.slice(prefix.length + 1) : null) : record.key;
    if (relative === null || relative.length === 0) continue;
    const [name, ...rest] = relative.split("/");
    if (rest.length > 0) {
      entries.push({ name, id: null, metadata: null });
    } else {
      entries.push({
        name,
        id: record.id,
        updated_at: record.updated_at,
        metadata: record.metadata,
      });
    }
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function makeStorageFetch({ rounds, bucketCount = DEFAULT_BUCKETS.length, onRequest, downloadMode } = {}) {
  let rootCalls = 0;
  const activeRound = new Map();
  const calls = [];
  const recordsByIdentity = new Map();
  for (const round of rounds ?? []) {
    for (const record of round) recordsByIdentity.set(`${record.bucket}/${record.key}`, record);
  }

  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    onRequest?.(url, init);
    assert.equal(init.redirect, "error", "remote requests must reject redirects");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${SERVICE_KEY}`);
    assert.equal(headers.get("apikey"), SERVICE_KEY);
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").slice(1);
    if (parts[0] !== "storage" || parts[1] !== "v1" || parts[2] !== "object") {
      throw new Error(`unexpected synthetic URL ${parsed.pathname}`);
    }

    if (parts[3] === "list") {
      const bucket = decodeURIComponent(parts[4]);
      const requestBody = JSON.parse(init.body);
      const prefix = requestBody.prefix;
      const offset = requestBody.offset;
      if (prefix === "" && offset === 0) {
        activeRound.set(bucket, Math.floor(rootCalls / bucketCount));
        rootCalls += 1;
      }
      const round = activeRound.get(bucket) ?? 0;
      const records = rounds?.[round]?.filter((record) => record.bucket === bucket) ?? [];
      const entries = listEntries(records, prefix).slice(offset, offset + requestBody.limit);
      return Response.json(entries);
    }

    const bucket = decodeURIComponent(parts[3]);
    const key = parts.slice(4).map(decodeURIComponent).join("/");
    const record = recordsByIdentity.get(`${bucket}/${key}`);
    if (!record) return new Response("missing", { status: 404 });
    if (downloadMode?.kind === "redirect") {
      return new Response(null, { status: 302, headers: { location: "https://other.example.test/object" } });
    }
    if (downloadMode?.kind === "timeout") {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
      });
    }
    if (downloadMode?.kind === "stalled-body") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(record.bytes.slice(0, 1));
          init.signal.addEventListener(
            "abort",
            () => controller.error(new Error("synthetic body timeout")),
            { once: true },
          );
        },
      });
      return new Response(stream, { headers: { "content-length": String(record.bytes.byteLength) } });
    }
    if (downloadMode?.kind === "status") return new Response("download failed", { status: downloadMode.status });
    if (downloadMode?.kind === "read-failure") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(record.bytes.slice(0, 1));
          queueMicrotask(() => controller.error(new Error("synthetic read failure")));
        },
      });
      return new Response(stream, { headers: { "content-length": String(record.bytes.byteLength) } });
    }
    return new Response(record.bytes, {
      headers: { "content-length": String(record.bytes.byteLength) },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), "fanmark-storage-test-"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof StorageExportError && error.code === code);
}

const fixture = [
  objectRecord({ bucket: "avatars", key: "user-a/profile.png", id: "avatar-a", content: "avatar-bytes", metadata: { mimetype: "image/png" } }),
  objectRecord({ bucket: "cover-images", key: "nested/path/cover.webp", id: "cover-a", content: "cover-bytes", metadata: { mimetype: "image/webp" } }),
];

async function runFixtureExport(fetchImpl, options = {}) {
  const outputDir = await temporaryDirectory();
  const result = await exportStorage({
    supabaseUrl: BASE_URL,
    serviceKey: SERVICE_KEY,
    outputDir,
    fetchImpl,
    ...options,
  });
  return { outputDir, result };
}

test("exports paginated nested objects with authenticated bounded downloads", async () => {
  const fetchImpl = makeStorageFetch({ rounds: [fixture, fixture] });
  const { outputDir, result } = await runFixtureExport(fetchImpl);
  assert.equal(result.objectCount, 2);
  assert.equal(await exists(path.join(outputDir, "manifest.json")), true);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.complete, true);
  assert.deepEqual(
    manifest.objects.map(({ bucket, key, size, contentSHA256, metadata }) => ({ bucket, key, size, contentSHA256, metadata })),
    fixture.map((record) => ({
      bucket: record.bucket,
      key: record.key,
      size: record.bytes.byteLength,
      contentSHA256: createHash("sha256").update(record.bytes).digest("hex"),
      metadata: record.metadata,
    })),
  );
  const outputMode = (await fs.stat(outputDir)).mode & 0o777;
  const objectsMode = (await fs.stat(path.join(outputDir, "objects"))).mode & 0o777;
  const fileMode = (await fs.stat(path.join(outputDir, manifest.objects[0].localFile))).mode & 0o777;
  const manifestMode = (await fs.stat(path.join(outputDir, "manifest.json"))).mode & 0o777;
  const statusPath = path.join(outputDir, "export.status.json");
  const statusMode = (await fs.stat(statusPath)).mode & 0o777;
  assert.equal(outputMode, 0o700);
  assert.equal(objectsMode, 0o700);
  assert.equal(fileMode, 0o600);
  assert.equal(manifestMode, 0o600);
  assert.equal(statusMode, 0o600);
  assert.equal(JSON.stringify(manifest).includes(SERVICE_KEY), false);
  const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
  assert.equal(status.status, "complete");
  assert.equal(status.objectCount, manifest.objectCount);
  assert.deepEqual(status.inventory, manifest.inventory);
  assert.equal(JSON.stringify(status).includes(SERVICE_KEY), false);
  assert.equal((await verifyManifest(path.join(outputDir, "manifest.json"))).objectCount, 2);
  assert.equal(fetchImpl.calls.some(({ init }) => init.method === "GET"), true);
});

test("paginates at the bounded page size and descends nested prefixes", async () => {
  const records = Array.from({ length: LIST_PAGE_SIZE + 1 }, (_, index) =>
    objectRecord({ bucket: "avatars", key: `user-${index}.png`, id: `id-${index}`, content: `byte-${index}` }),
  );
  records.push(objectRecord({ bucket: "avatars", key: "nested/avatar.png", id: "nested-id", content: "nested" }));
  const fetchImpl = makeStorageFetch({ rounds: [records], bucketCount: 1 });
  const inventory = await listStorageInventory({
    supabaseUrl: BASE_URL,
    serviceKey: SERVICE_KEY,
    buckets: ["avatars"],
    fetchImpl,
  });
  assert.equal(inventory.length, LIST_PAGE_SIZE + 2);
  const listBodies = fetchImpl.calls
    .filter(({ init }) => init.method === "POST")
    .map(({ init }) => JSON.parse(init.body));
  assert.equal(listBodies.some((body) => body.offset === LIST_PAGE_SIZE), true);
  assert.equal(listBodies.some((body) => body.prefix === "nested"), true);
});

test("rejects duplicate identities and preserves a failed status without a manifest", async () => {
  const duplicate = objectRecord({ bucket: "avatars", key: "duplicate.png", id: "duplicate-id", content: "same" });
  const fetchImpl = makeStorageFetch({ rounds: [[duplicate, duplicate], [duplicate, duplicate]], bucketCount: 1 });
  const outputDir = await temporaryDirectory();
  await assertCode(
    exportStorage({ supabaseUrl: BASE_URL, serviceKey: SERVICE_KEY, outputDir, buckets: ["avatars"], fetchImpl }),
    "duplicate_identity",
  );
  assert.equal(await exists(path.join(outputDir, "manifest.json")), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(outputDir, "export.status.json"), "utf8")).status, "failed");
});

test("rejects traversal-shaped source keys before writing outside the export", async () => {
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${SERVICE_KEY}`);
    assert.equal(init.redirect, "error");
    return Response.json([{ name: "../escape.txt", id: "bad-id", metadata: { size: 1 } }]);
  };
  const outputDir = await temporaryDirectory();
  await assertCode(
    exportStorage({ supabaseUrl: BASE_URL, serviceKey: SERVICE_KEY, outputDir, buckets: ["avatars"], fetchImpl }),
    "unsafe_object_key",
  );
  assert.equal(await exists(path.join(path.dirname(outputDir), "escape.txt")), false);
});

test("refuses a changed pre/post inventory", async () => {
  const changed = fixture.map((record) => ({ ...record, metadata: { ...record.metadata, revision: "changed" } }));
  const fetchImpl = makeStorageFetch({ rounds: [fixture, changed] });
  const outputDir = await temporaryDirectory();
  await assertCode(
    exportStorage({ supabaseUrl: BASE_URL, serviceKey: SERVICE_KEY, outputDir, fetchImpl }),
    "inventory_changed",
  );
  assert.equal(await exists(path.join(outputDir, "manifest.json")), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(outputDir, "export.status.json"), "utf8")).error, "inventory_changed");
});

test("refuses byte caps, read failures, timeouts, and redirects", async (t) => {
  const cases = [
    ["byte_cap_exceeded", { maxBytes: 1 }],
    ["download_read_failed", { downloadMode: { kind: "read-failure" } }],
    ["timeout", { timeoutMs: 20, downloadMode: { kind: "timeout" } }],
    ["timeout_after_headers", { timeoutMs: 20, downloadMode: { kind: "stalled-body" } }, "timeout"],
    ["redirect_rejected", { downloadMode: { kind: "redirect" } }],
  ];
  for (const [code, options, expectedCode = code] of cases) {
    await t.test(code, async () => {
      const fetchImpl = makeStorageFetch({ rounds: [[fixture[0]], [fixture[0]]], bucketCount: 1, downloadMode: options.downloadMode });
      const outputDir = await temporaryDirectory();
      await assertCode(
        exportStorage({
          supabaseUrl: BASE_URL,
          serviceKey: SERVICE_KEY,
          outputDir,
          buckets: ["avatars"],
          fetchImpl,
          maxBytes: options.maxBytes,
          timeoutMs: options.timeoutMs,
        }),
        expectedCode,
      );
      assert.equal(await exists(path.join(outputDir, "manifest.json")), false);
    });
  }
});

test("verifies manifest path containment, size, and content hash", async (t) => {
  const fetchImpl = makeStorageFetch({ rounds: [[fixture[0]], [fixture[0]]], bucketCount: 1 });
  const { outputDir } = await runFixtureExport(fetchImpl, { buckets: ["avatars"] });
  const manifestPath = path.join(outputDir, "manifest.json");
  const original = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const cases = [
    ["unsafe_manifest_path", (manifest) => { manifest.objects[0].localFile = "../escape"; }],
    ["size_mismatch", (manifest) => { manifest.objects[0].size += 1; manifest.objects[0].metadata.size += 1; }],
    ["metadata_size_mismatch", (manifest) => { manifest.objects[0].metadata.size += 1; }],
    ["hash_mismatch", (manifest) => { manifest.objects[0].contentSHA256 = "0".repeat(64); }],
    ["invalid_manifest_inventory", (manifest) => { manifest.inventory.afterSHA256 = "1".repeat(64); }],
  ];
  for (const [code, mutate] of cases) {
    await t.test(code, async () => {
      const changed = structuredClone(original);
      mutate(changed);
      await fs.writeFile(manifestPath, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
      await assert.rejects(verifyManifest(manifestPath), (error) => error instanceof StorageVerifyError && error.code === code);
      await fs.writeFile(manifestPath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    });
  }
  assert.equal((await verifyManifest(manifestPath)).objectCount, 1);
});

test("requires a complete status and rejects symlinked private roots", async (t) => {
  const fetchImpl = makeStorageFetch({ rounds: [[fixture[0]], [fixture[0]]], bucketCount: 1 });
  const { outputDir } = await runFixtureExport(fetchImpl, { buckets: ["avatars"] });
  const manifestPath = path.join(outputDir, "manifest.json");
  const statusPath = path.join(outputDir, "export.status.json");
  const completeStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
  await fs.writeFile(statusPath, `${JSON.stringify({ ...completeStatus, status: "in_progress" })}\n`, { mode: 0o600 });
  await assert.rejects(verifyManifest(manifestPath), (error) => error instanceof StorageVerifyError && error.code === "incomplete_status");
  await fs.writeFile(statusPath, `${JSON.stringify(completeStatus, null, 2)}\n`, { mode: 0o600 });
  assert.equal((await verifyManifest(manifestPath)).objectCount, 1);

  await t.test("manifest symlink", async () => {
    const linkedManifest = path.join(outputDir, "manifest-link.json");
    await fs.symlink(manifestPath, linkedManifest);
    await assert.rejects(verifyManifest(linkedManifest), (error) => error instanceof StorageVerifyError && error.code === "invalid_manifest");
  });

  await t.test("output directory symlink", async () => {
    const emptyFetch = makeStorageFetch({ rounds: [[], []], bucketCount: 1 });
    const empty = await runFixtureExport(emptyFetch, { buckets: ["avatars"] });
    const parent = path.dirname(empty.outputDir);
    const linkedOutput = path.join(parent, `${path.basename(empty.outputDir)}-link`);
    await fs.symlink(empty.outputDir, linkedOutput, "dir");
    await assert.rejects(
      verifyManifest(path.join(linkedOutput, "manifest.json")),
      (error) => error instanceof StorageVerifyError && error.code === "invalid_output_directory",
    );
  });

  await t.test("objects directory symlink with zero objects", async () => {
    const emptyFetch = makeStorageFetch({ rounds: [[], []], bucketCount: 1 });
    const empty = await runFixtureExport(emptyFetch, { buckets: ["avatars"] });
    const objectsPath = path.join(empty.outputDir, "objects");
    const objectsRealPath = path.join(empty.outputDir, "objects-real");
    const outsidePath = path.join(path.dirname(empty.outputDir), `${path.basename(empty.outputDir)}-objects-outside`);
    await fs.mkdir(outsidePath, { mode: 0o700 });
    await fs.rename(objectsPath, objectsRealPath);
    await fs.symlink(outsidePath, objectsPath, "dir");
    await assert.rejects(
      verifyManifest(path.join(empty.outputDir, "manifest.json")),
      (error) => error instanceof StorageVerifyError && error.code === "invalid_objects_directory",
    );
  });
});

test("validates the explicit bucket allowlist", async () => {
  const outputDir = await temporaryDirectory();
  await assertCode(
    exportStorage({ supabaseUrl: BASE_URL, serviceKey: SERVICE_KEY, outputDir, buckets: ["private-bucket"], fetchImpl: async () => Response.json([]) }),
    "invalid_buckets",
  );
});

test("does not chmod a non-empty output directory before refusing it", async () => {
  const outputDir = await temporaryDirectory();
  await fs.chmod(outputDir, 0o755);
  await fs.writeFile(path.join(outputDir, "operator-file"), "keep me", { mode: 0o644 });
  await assertCode(
    exportStorage({ supabaseUrl: BASE_URL, serviceKey: SERVICE_KEY, outputDir, buckets: ["avatars"], fetchImpl: async () => Response.json([]) }),
    "output_dir_not_empty",
  );
  assert.equal((await fs.stat(outputDir)).mode & 0o777, 0o755);
  assert.equal(await exists(path.join(outputDir, "operator-file")), true);
});

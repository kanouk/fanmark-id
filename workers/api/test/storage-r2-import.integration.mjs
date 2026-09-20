#!/usr/bin/env node

/**
 * Explicit local Miniflare proof for the R2 binding path. This file is not in
 * the default Vitest glob: run it with the project Node 22 binary when the
 * workers/api dependencies are installed.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { objectIdentityHash } from "../../../scripts/migration/storage-export.mjs";
import { importStorageExport, mapStorageTargetKey, StorageR2ImportError } from "../../../scripts/migration/storage-r2-import.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

async function fixture(objects) {
  const exportDir = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-r2-miniflare-"));
  const objectsDir = path.join(exportDir, "objects");
  await fs.mkdir(objectsDir, { mode: 0o700 });
  await fs.chmod(exportDir, 0o700);
  const entries = [];
  for (const object of objects) {
    const content = bytes(object.content);
    const contentSHA256 = hash(content);
    const localFile = `objects/${objectIdentityHash(object.bucket, object.key)}`;
    await fs.writeFile(path.join(exportDir, localFile), content, { mode: 0o600 });
    entries.push({
      bucket: object.bucket,
      key: object.key,
      size: content.byteLength,
      contentSHA256,
      metadata: object.metadata ?? null,
      localFile,
    });
  }
  const buckets = [...new Set(objects.map((object) => object.bucket))];
  const inventory = { stable: true, beforeSHA256: "b".repeat(64), afterSHA256: "b".repeat(64) };
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
  await fs.writeFile(path.join(exportDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(exportDir, "export.status.json"), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  return { exportDir, entries };
}

async function main() {
  const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
  let Miniflare;
  try {
    ({ Miniflare } = await import(pathToFileURL(miniflarePath).href));
  } catch (error) {
    throw new Error("local_miniflare_unavailable", { cause: error });
  }

  const first = await fixture([
    { bucket: "avatars", key: "empty.bin", content: "", metadata: { mimetype: "application/octet-stream" } },
    { bucket: "avatars", key: "ユーザー/猫 🐈.txt", content: "native-r2-stream-content", metadata: { mimetype: "text/plain" } },
  ]);
  const conflicting = await fixture([
    { bucket: "avatars", key: "ユーザー/猫 🐈.txt", content: "different-native-content", metadata: { mimetype: "text/plain" } },
  ]);
  let miniflare = null;
  try {
    const workerScript = `
      function decode(value) {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      export default {
        async fetch(request, env) {
          if (request.method !== "POST") return new Response("method", { status: 405 });
          const payload = decode(request.headers.get("x-r2-payload"));
          const length = Number(request.headers.get("content-length"));
          const { readable, writable } = new FixedLengthStream(length);
          const pumpAbort = new AbortController();
          const pump = request.body
            ? request.body.pipeTo(writable, { signal: pumpAbort.signal })
            : writable.close();
          // The provider may return null immediately for a failed conditional
          // create. Keep the pump rejection observed while we decide whether
          // to abort it, but do not wait for it before handling that result.
          void pump.catch(() => {});
          const stopPump = async () => {
            pumpAbort.abort("r2 write stopped");
            try {
              await writable.abort("r2 write stopped");
            } catch {}
            await Promise.race([
              pump.catch(() => {}),
              new Promise((resolve) => setTimeout(resolve, 100)),
            ]);
          };
          let result;
          try {
            result = await env.R2.put(payload.key, readable, {
              onlyIf: payload.onlyIf,
              sha256: payload.sha256,
              httpMetadata: payload.httpMetadata ?? undefined,
              customMetadata: payload.customMetadata,
            });
          } catch {
            await stopPump();
            return new Response("write", { status: 500 });
          }
          if (result === null) {
            await stopPump();
            return new Response(null, { status: 412 });
          }
          try {
            await pump;
          } catch {
            await stopPump();
            return new Response("write", { status: 500 });
          }
          return Response.json({ key: result.key, size: result.size });
        },
      };
    `;
    miniflare = new Miniflare({
      workers: [
        {
          config: {
            name: "storage-r2-import-test",
            type: "worker",
            compatibilityDate: "2026-09-18",
            env: { R2: { type: "r2", name: "storage-r2-import-test" } },
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: workerScript } },
            },
          },
        },
      ],
    });
    const bucket = await miniflare.getR2Bucket("R2");
    const loopbackBase = await miniflare.ready;
    const r2 = {
      get: bucket.get.bind(bucket),
      async putWithSize(key, stream, options, size) {
        const payload = Buffer.from(JSON.stringify({
          key,
          onlyIf: options.onlyIf,
          sha256: options.sha256,
          httpMetadata: options.httpMetadata ?? null,
          customMetadata: options.customMetadata ?? {},
        })).toString("base64");
        const response = await fetch(new URL("/put", loopbackBase), {
          method: "POST",
          headers: {
            "content-length": String(size),
            "x-r2-payload": payload,
          },
          body: stream,
          duplex: "half",
        });
        if (response.status === 412) return null;
        if (!response.ok) throw new Error(`local R2 worker write failed (${response.status})`);
        return response.json();
      },
    };
    const result = await importStorageExport({ exportDir: first.exportDir, r2, chunkSize: 3, operationTimeoutMs: 5000 });
    assert.equal(result.complete, true);
    assert.equal(result.copiedCount, 2);
    const nativeKey = mapStorageTargetKey("avatars", "ユーザー/猫 🐈.txt");
    const stored = await r2.get(nativeKey);
    assert.ok(stored);
    assert.equal(stored.size, "native-r2-stream-content".length);
    assert.equal(stored.httpMetadata.contentType, "text/plain");
    assert.equal(stored.customMetadata["fanmark-source-sha256"], hash(bytes("native-r2-stream-content")));
    assert.equal(new TextDecoder().decode(await stored.arrayBuffer()), "native-r2-stream-content");

    const conditionalFirst = await bucket.put("conditional-proof", bytes("first"), { onlyIf: { etagDoesNotMatch: "*" } });
    assert.ok(conditionalFirst);
    const conditionalSecond = await bucket.put("conditional-proof", bytes("second"), { onlyIf: { etagDoesNotMatch: "*" } });
    assert.equal(conditionalSecond, null);
    const conditionalRead = await r2.get("conditional-proof");
    assert.equal(new TextDecoder().decode(await conditionalRead.arrayBuffer()), "first");

    const raceSize = 16 * 1024 * 1024;
    let generatedBytes = 0;
    const largeRaceBody = new ReadableStream({
      pull(controller) {
        if (generatedBytes >= raceSize) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(Math.min(64 * 1024, raceSize - generatedBytes));
        chunk.fill(0x72);
        generatedBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const bridgedRace = await r2.putWithSize(
      nativeKey,
      largeRaceBody,
      { onlyIf: { etagDoesNotMatch: "*" }, customMetadata: {} },
      raceSize,
    );
    assert.equal(bridgedRace, null);
    // Miniflare's native R2 implementation consumes the request body before
    // returning a conditional null. This deliberately large body therefore
    // proves the loopback bridge settles after a fully consumed conflict; the
    // AbortController path still handles providers that return earlier.
    assert.equal(generatedBytes, raceSize);
    const unchangedAfterBridgeRace = await bucket.get(nativeKey);
    assert.equal(new TextDecoder().decode(await unchangedAfterBridgeRace.arrayBuffer()), "native-r2-stream-content");

    await assert.rejects(
      importStorageExport({ exportDir: conflicting.exportDir, r2, operationTimeoutMs: 5000 }),
      (error) => error instanceof StorageR2ImportError && error.code === "target_metadata_mismatch",
    );
    const unchanged = await r2.get(nativeKey);
    assert.equal(new TextDecoder().decode(await unchanged.arrayBuffer()), "native-r2-stream-content");
    console.log("Miniflare R2 integration passed: native stream, readback metadata/hash, and conditional no-overwrite.");
  } finally {
    if (miniflare) await miniflare.dispose();
    await fs.rm(first.exportDir, { recursive: true, force: true });
    await fs.rm(conflicting.exportDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Miniflare R2 integration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

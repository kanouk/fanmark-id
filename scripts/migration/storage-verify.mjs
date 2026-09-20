#!/usr/bin/env node

/**
 * Verify a completed local Storage export without contacting Supabase.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { objectIdentityHash, validateBuckets, validateStorageKey } from "./storage-export.mjs";

const MANIFEST_SCHEMA_VERSION = 1;

export class StorageVerifyError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "StorageVerifyError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new StorageVerifyError(code, cause);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const file = await fs.open(filePath, "r");
  try {
    // Own the handle lifecycle explicitly. Node 22.6 can abort the process
    // when readableWebStream completion races with an explicit close().
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await file.close().catch(() => {});
  }
}

function assertPrivateMode(stat, code, expectedMode) {
  const mode = stat.mode & 0o777;
  if (mode !== expectedMode) throw fail(code);
}

async function readPrivateJson(filePath, { kind, expectedStatus } = {}) {
  const stat = await fs.lstat(filePath).catch((error) => {
    throw fail(`missing_${kind ?? "file"}`, error);
  });
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail(`invalid_${kind ?? "file"}`);
  assertPrivateMode(stat, `insecure_${kind ?? "file"}`, 0o600);
  let value;
  try {
    value = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw fail(`invalid_${kind ?? "file"}`, error);
  }
  if (expectedStatus !== undefined && (!isPlainObject(value) || value.status !== expectedStatus)) {
    throw fail(`incomplete_${kind ?? "file"}`);
  }
  return value;
}

function assertStableInventory(inventory, code = "invalid_manifest_inventory") {
  if (
    !isPlainObject(inventory) ||
    inventory.stable !== true ||
    typeof inventory.beforeSHA256 !== "string" ||
    typeof inventory.afterSHA256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(inventory.beforeSHA256) ||
    !/^[0-9a-f]{64}$/.test(inventory.afterSHA256) ||
    inventory.beforeSHA256 !== inventory.afterSHA256
  ) {
    throw fail(code);
  }
}

export async function verifyManifest(manifestPath) {
  if (!manifestPath || typeof manifestPath !== "string") throw fail("missing_manifest");
  const absoluteManifest = path.resolve(manifestPath);
  const manifestStat = await fs.lstat(absoluteManifest).catch((error) => {
    throw fail("invalid_manifest", error);
  });
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw fail("invalid_manifest");
  assertPrivateMode(manifestStat, "insecure_manifest", 0o600);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8"));
  } catch (error) {
    throw fail("invalid_manifest", error);
  }
  if (!isPlainObject(manifest) || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.complete !== true) {
    throw fail("incomplete_manifest");
  }
  try {
    validateBuckets(manifest.buckets);
  } catch (error) {
    throw fail("invalid_manifest_buckets", error);
  }
  if (!Array.isArray(manifest.objects) || manifest.objectCount !== manifest.objects.length) {
    throw fail("invalid_manifest");
  }

  const outputDir = path.dirname(absoluteManifest);
  const objectsDir = path.resolve(outputDir, "objects");
  assertStableInventory(manifest.inventory);

  let outputStat;
  let objectsStat;
  try {
    outputStat = await fs.lstat(outputDir);
    objectsStat = await fs.lstat(objectsDir);
  } catch (error) {
    throw fail("missing_objects_directory", error);
  }
  if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) throw fail("invalid_output_directory");
  if (objectsStat.isSymbolicLink() || !objectsStat.isDirectory()) throw fail("invalid_objects_directory");
  assertPrivateMode(outputStat, "insecure_output_directory", 0o700);
  assertPrivateMode(objectsStat, "insecure_objects_directory", 0o700);

  const outputReal = await fs.realpath(outputDir);
  const objectsReal = await fs.realpath(objectsDir);
  if (!withinDirectory(outputReal, objectsReal)) throw fail("unsafe_objects_directory");

  const statusPath = path.join(outputDir, "export.status.json");
  const status = await readPrivateJson(statusPath, { kind: "status", expectedStatus: "complete" });
  if (
    status.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !Array.isArray(status.buckets) ||
    JSON.stringify(status.buckets) !== JSON.stringify(manifest.buckets) ||
    status.objectCount !== manifest.objectCount
  ) {
    throw fail("invalid_status");
  }
  assertStableInventory(status.inventory, "invalid_status_inventory");
  if (
    status.inventory.beforeSHA256 !== manifest.inventory.beforeSHA256 ||
    status.inventory.afterSHA256 !== manifest.inventory.afterSHA256
  ) {
    throw fail("invalid_status_inventory");
  }
  const identities = new Set();
  const localFiles = new Set();

  for (const entry of manifest.objects) {
    if (
      !isPlainObject(entry) ||
      typeof entry.bucket !== "string" ||
      typeof entry.key !== "string" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.contentSHA256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.contentSHA256) ||
      typeof entry.localFile !== "string" ||
      !Object.hasOwn(entry, "metadata")
    ) {
      throw fail("invalid_manifest_entry");
    }
    if (isPlainObject(entry.metadata) && entry.metadata.size !== undefined && entry.metadata.size !== null) {
      const metadataSize = Number(entry.metadata.size);
      if (!Number.isSafeInteger(metadataSize) || metadataSize < 0 || metadataSize !== entry.size) {
        throw fail("metadata_size_mismatch");
      }
    }
    if (!manifest.buckets.includes(entry.bucket)) throw fail("invalid_manifest_bucket");
    try {
      validateStorageKey(entry.key);
    } catch (error) {
      throw fail("unsafe_manifest_key", error);
    }
    const identity = `${entry.bucket}\0${entry.key}`;
    if (identities.has(identity)) throw fail("duplicate_identity");
    identities.add(identity);

    const expectedLocalFile = `objects/${objectIdentityHash(entry.bucket, entry.key)}`;
    if (entry.localFile !== expectedLocalFile || path.isAbsolute(entry.localFile)) {
      throw fail("unsafe_manifest_path");
    }
    const localFile = path.resolve(outputDir, entry.localFile);
    if (!withinDirectory(outputDir, localFile) || !withinDirectory(objectsDir, localFile)) {
      throw fail("unsafe_manifest_path");
    }
    const localReal = await fs.realpath(localFile).catch((error) => {
      throw fail("missing_object", error);
    });
    if (!withinDirectory(outputReal, localReal) || !withinDirectory(objectsReal, localReal)) {
      throw fail("unsafe_manifest_path");
    }
    if (localFiles.has(localReal)) throw fail("duplicate_local_file");
    localFiles.add(localReal);

    const stat = await fs.lstat(localFile).catch((error) => {
      throw fail("missing_object", error);
    });
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail("invalid_object_file");
    assertPrivateMode(stat, "insecure_object_file", 0o600);
    if (stat.size !== entry.size) throw fail("size_mismatch");
    if (await sha256File(localFile) !== entry.contentSHA256) throw fail("hash_mismatch");
  }

  return { manifestPath: absoluteManifest, outputDir, objectCount: manifest.objects.length };
}

export const USAGE = "Usage: storage-verify.mjs MANIFEST_PATH\n";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  if (args.length !== 1) throw fail("invalid_arguments");
  const result = await verifyManifest(args[0]);
  console.log(`Storage manifest verified: ${result.objectCount} objects.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof StorageVerifyError ? error.code : "verification_failed";
    console.error(`Storage verification failed (${code}).`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

/**
 * Encrypted, single-object snapshot bundles. Paths, file counts, and source
 * sizes are inside the authenticated ciphertext; the public header exposes
 * only the algorithm, key identifier, nonce/tag, and a 64 KiB-rounded size.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";

import {
  SNAPSHOT_CATALOG_FILE,
  SNAPSHOT_MANIFEST_FILE,
  SNAPSHOT_SCHEMA_REPORT_FILE,
  SNAPSHOT_STATUS_FILE,
  TABLE_DIRECTORY,
  assertPrivateRelativePath,
} from "./snapshot-format.mjs";
import { verifySnapshot } from "./snapshot-verify.mjs";

export const SNAPSHOT_BUNDLE_HEADER = "bundle.header.json";
export const SNAPSHOT_BUNDLE_CIPHERTEXT = "snapshot.aesgcm";
export const SNAPSHOT_BUNDLE_VERSION = 1;
export const SNAPSHOT_ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const SNAPSHOT_PADDING_BLOCK_BYTES = 64 * 1024;

const MAGIC = Buffer.from("FMSB1\n", "ascii");
const FRAME_HEADER_BYTES = 12;
const MAX_HEADER_BYTES = 4096;
const MAX_PATH_BYTES = 4096;
const MAX_ARCHIVE_FILES = 100_000;
const MAX_PADDING_BYTES = SNAPSHOT_PADDING_BLOCK_BYTES - 1;
const REQUIRED_SNAPSHOT_ROOT_FILES = [
  SNAPSHOT_STATUS_FILE,
  SNAPSHOT_MANIFEST_FILE,
  SNAPSHOT_CATALOG_FILE,
  SNAPSHOT_SCHEMA_REPORT_FILE,
];
const HEADER_KEYS = ["version", "algorithm", "keyId", "nonce", "tag", "ciphertextByteCount"];

export class SnapshotEncryptionError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SnapshotEncryptionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  return new SnapshotEncryptionError(code, cause);
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return isPathWithin(left, right) || isPathWithin(right, left);
}

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw fail("snapshot_encryption_key_invalid");
  return key;
}

export function readSnapshotEncryptionKey(env = process.env) {
  const encoded = env?.FANMARK_SNAPSHOT_KEY_B64;
  if (encoded === undefined || encoded === "") throw fail("snapshot_encryption_key_missing");
  if (typeof encoded !== "string" || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(encoded)) {
    throw fail("snapshot_encryption_key_invalid");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw fail("snapshot_encryption_key_invalid");
  return key;
}

export function snapshotEncryptionKeyId(key) {
  return createHash("sha256").update(requireKey(key)).digest("hex").slice(0, 24);
}

async function lstatPath(filePath, code) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    throw fail(code, error);
  }
  if (stat.isSymbolicLink()) throw fail("snapshot_bundle_symlink_rejected");
  return stat;
}

function requireDirectory(stat, code) {
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw fail(code);
}

function requirePrivateFile(stat, code) {
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw fail(code);
}

async function requirePrivateDirectory(directory, code) {
  const stat = await lstatPath(directory, code);
  requireDirectory(stat, code);
  return stat;
}

async function requireNewTarget(directory, parentCode = "snapshot_bundle_parent_invalid") {
  const parent = path.dirname(directory);
  const parentStat = await lstatPath(parent, parentCode);
  requireDirectory(parentStat, parentCode);
  try {
    await fs.lstat(directory);
    throw fail("snapshot_bundle_destination_exists");
  } catch (error) {
    if (error instanceof SnapshotEncryptionError) throw error;
    if (error?.code !== "ENOENT") throw fail("snapshot_bundle_destination_invalid", error);
  }
  return parent;
}

async function collectSnapshotFiles(sourceDir) {
  const manifestPath = path.join(sourceDir, SNAPSHOT_MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw fail("snapshot_source_invalid", error);
  }
  if (!Array.isArray(manifest?.tables) || manifest.tables.length > MAX_ARCHIVE_FILES - REQUIRED_SNAPSHOT_ROOT_FILES.length) {
    throw fail("snapshot_source_invalid");
  }
  const paths = [...REQUIRED_SNAPSHOT_ROOT_FILES, ...manifest.tables.map((entry) => entry?.file)];
  if (new Set(paths).size !== paths.length) throw fail("snapshot_source_invalid");
  for (const relative of paths) {
    try {
      assertPrivateRelativePath(relative);
    } catch (error) {
      throw fail("snapshot_source_invalid", error);
    }
    if (relative.startsWith(TABLE_DIRECTORY + "/")) {
      if (relative.split("/").length !== 2) throw fail("snapshot_source_invalid");
    } else if (!REQUIRED_SNAPSHOT_ROOT_FILES.includes(relative)) {
      throw fail("snapshot_source_invalid");
    }
  }
  return paths;
}

async function inspectSnapshotFiles(sourceDir, relativePaths) {
  const files = [];
  let unpaddedBytes = BigInt(MAGIC.length + FRAME_HEADER_BYTES);
  for (const relative of relativePaths) {
    const absolute = path.join(sourceDir, relative);
    const stat = await lstatPath(absolute, "snapshot_source_invalid");
    requirePrivateFile(stat, "snapshot_source_mode_invalid");
    const name = Buffer.from(relative, "utf8");
    if (name.length < 1 || name.length > MAX_PATH_BYTES || !Number.isSafeInteger(stat.size) || stat.size < 0) throw fail("snapshot_source_invalid");
    files.push({ relative, absolute, name, size: stat.size, stat });
    unpaddedBytes += BigInt(FRAME_HEADER_BYTES + name.length) + BigInt(stat.size);
  }
  const paddingBytes = Number((BigInt(SNAPSHOT_PADDING_BLOCK_BYTES) - (unpaddedBytes % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES))) % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES));
  return { files, paddingBytes, ciphertextByteCount: unpaddedBytes + BigInt(paddingBytes) };
}

function encodeFrameHeader(pathByteCount, fileByteCount) {
  const result = Buffer.alloc(FRAME_HEADER_BYTES);
  result.writeUInt32BE(pathByteCount, 0);
  result.writeBigUInt64BE(BigInt(fileByteCount), 4);
  return result;
}

async function* archiveChunks(inspected) {
  yield MAGIC;
  for (const entry of inspected.files) {
    yield encodeFrameHeader(entry.name.length, entry.size);
    yield entry.name;
    let bytesRead = 0;
    try {
      for await (const chunk of createReadStream(entry.absolute, { highWaterMark: 64 * 1024 })) {
        bytesRead += chunk.length;
        if (bytesRead > entry.size) throw fail("snapshot_source_changed");
        yield chunk;
      }
    } catch (error) {
      if (error instanceof SnapshotEncryptionError) throw error;
      throw fail("snapshot_source_read_failed", error);
    }
    const after = await lstatPath(entry.absolute, "snapshot_source_changed");
    if (bytesRead !== entry.size || after.dev !== entry.stat.dev || after.ino !== entry.stat.ino || after.size !== entry.stat.size || after.mtimeMs !== entry.stat.mtimeMs) {
      throw fail("snapshot_source_changed");
    }
  }
  yield Buffer.alloc(FRAME_HEADER_BYTES);
  let remaining = inspected.paddingBytes;
  while (remaining > 0) {
    const count = Math.min(remaining, 16 * 1024);
    yield randomBytes(count);
    remaining -= count;
  }
}

function parseHeader(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("snapshot_bundle_invalid");
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...HEADER_KEYS].sort())) throw fail("snapshot_bundle_invalid");
  if (value.version !== SNAPSHOT_BUNDLE_VERSION || value.algorithm !== SNAPSHOT_ENCRYPTION_ALGORITHM
    || typeof value.keyId !== "string" || !/^[0-9a-f]{24}$/.test(value.keyId)
    || typeof value.nonce !== "string" || !/^[0-9a-f]{24}$/.test(value.nonce)
    || typeof value.tag !== "string" || !/^[0-9a-f]{32}$/.test(value.tag)
    || typeof value.ciphertextByteCount !== "string" || !/^\d+$/.test(value.ciphertextByteCount)) {
    throw fail("snapshot_bundle_invalid");
  }
  const cipherBytes = BigInt(value.ciphertextByteCount);
  if (cipherBytes < BigInt(SNAPSHOT_PADDING_BLOCK_BYTES) || cipherBytes % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES) !== 0n) {
    throw fail("snapshot_bundle_invalid");
  }
  return value;
}

export async function sealSnapshotDirectory({ sourceDir, bundleDir, encryptionKey } = {}) {
  const key = requireKey(encryptionKey);
  if (typeof sourceDir !== "string" || typeof bundleDir !== "string") throw fail("snapshot_bundle_input_missing");
  const sourcePath = path.resolve(sourceDir);
  const bundlePath = path.resolve(bundleDir);
  if (pathsOverlap(sourcePath, bundlePath)) throw fail("snapshot_bundle_path_overlap");
  await requirePrivateDirectory(sourcePath, "snapshot_source_mode_invalid");
  await requireNewTarget(bundlePath);

  try {
    await verifySnapshot(path.join(sourcePath, SNAPSHOT_MANIFEST_FILE));
  } catch (error) {
    throw fail("snapshot_source_invalid", error);
  }
  const relativePaths = await collectSnapshotFiles(sourcePath);
  const inspected = await inspectSnapshotFiles(sourcePath, relativePaths);

  await fs.mkdir(bundlePath, { mode: 0o700 });
  await fs.chmod(bundlePath, 0o700);
  const ciphertextPath = path.join(bundlePath, SNAPSHOT_BUNDLE_CIPHERTEXT);
  const partialPath = ciphertextPath + ".part";
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(SNAPSHOT_ENCRYPTION_ALGORITHM, key, nonce);
    await pipeline(
      Readable.from(archiveChunks(inspected)),
      cipher,
      createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
    );
    const stat = await lstatPath(partialPath, "snapshot_ciphertext_missing");
    requirePrivateFile(stat, "snapshot_ciphertext_mode_invalid");
    if (BigInt(stat.size) !== inspected.ciphertextByteCount) throw fail("snapshot_ciphertext_size_mismatch");
    const tag = cipher.getAuthTag().toString("hex");
    await fs.rename(partialPath, ciphertextPath);
    const header = {
      version: SNAPSHOT_BUNDLE_VERSION,
      algorithm: SNAPSHOT_ENCRYPTION_ALGORITHM,
      keyId: snapshotEncryptionKeyId(key),
      nonce: nonce.toString("hex"),
      tag,
      ciphertextByteCount: inspected.ciphertextByteCount.toString(),
    };
    const headerPath = path.join(bundlePath, SNAPSHOT_BUNDLE_HEADER);
    await fs.writeFile(headerPath, JSON.stringify(header) + "\n", { flag: "wx", mode: 0o600 });
    await fs.chmod(headerPath, 0o600);
    return {
      bundleDir: bundlePath,
      headerPath,
      fileCount: inspected.files.length,
      encryptedFileCount: 1,
      keyId: header.keyId,
    };
  } catch (error) {
    await fs.rm(bundlePath, { recursive: true, force: true }).catch(() => {});
    if (error instanceof SnapshotEncryptionError) throw error;
    throw fail("snapshot_bundle_seal_failed", error);
  }
}

class AsyncByteReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.current = Buffer.alloc(0);
    this.offset = 0;
    this.finished = false;
    this.bytesRead = 0n;
  }

  async nextChunk(maxBytes = 64 * 1024) {
    while (this.offset >= this.current.length && !this.finished) {
      const next = await this.iterator.next();
      if (next.done) {
        this.finished = true;
        this.current = Buffer.alloc(0);
        this.offset = 0;
        return null;
      }
      this.current = Buffer.from(next.value);
      this.offset = 0;
    }
    if (this.offset >= this.current.length) return null;
    const end = Math.min(this.current.length, this.offset + maxBytes);
    const chunk = this.current.subarray(this.offset, end);
    this.offset = end;
    this.bytesRead += BigInt(chunk.length);
    return chunk;
  }

  async readExact(byteCount) {
    const chunks = [];
    let total = 0;
    while (total < byteCount) {
      const chunk = await this.nextChunk(byteCount - total);
      if (!chunk) throw fail("snapshot_bundle_truncated");
      chunks.push(chunk);
      total += chunk.length;
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
  }

  async copyExactTo(destination, byteCount) {
    let remaining = BigInt(byteCount);
    while (remaining > 0n) {
      const chunk = await this.nextChunk(Number(remaining > 64n * 1024n ? 64n * 1024n : remaining));
      if (!chunk) throw fail("snapshot_bundle_truncated");
      await new Promise((resolve, reject) => {
        destination.write(chunk, (error) => error ? reject(error) : resolve());
      });
      remaining -= BigInt(chunk.length);
    }
  }

  async drain(maxBytes = MAX_PADDING_BYTES) {
    let drained = 0;
    while (true) {
      const chunk = await this.nextChunk(64 * 1024);
      if (!chunk) return drained;
      drained += chunk.length;
      if (drained > maxBytes) throw fail("snapshot_bundle_padding_invalid");
    }
  }
}

async function readBundleHeader(bundlePath) {
  const headerPath = path.join(bundlePath, SNAPSHOT_BUNDLE_HEADER);
  const stat = await lstatPath(headerPath, "snapshot_bundle_header_missing");
  requirePrivateFile(stat, "snapshot_bundle_header_mode_invalid");
  if (stat.size > MAX_HEADER_BYTES) throw fail("snapshot_bundle_invalid");
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(headerPath, "utf8"));
  } catch (error) {
    throw fail("snapshot_bundle_invalid", error);
  }
  return parseHeader(parsed);
}

async function writeRestoredFile({ reader, outputDir, relative, length, seen }) {
  try {
    assertPrivateRelativePath(relative);
  } catch (error) {
    throw fail("snapshot_bundle_path_invalid", error);
  }
  if (seen.has(relative) || (relative.startsWith(TABLE_DIRECTORY + "/") && relative.split("/").length !== 2)) {
    throw fail("snapshot_bundle_path_invalid");
  }
  const isTableFile = relative.startsWith(TABLE_DIRECTORY + "/");
  if (!isTableFile && !REQUIRED_SNAPSHOT_ROOT_FILES.includes(relative)) throw fail("snapshot_bundle_path_invalid");
  if (isTableFile && relative.endsWith("/")) throw fail("snapshot_bundle_path_invalid");
  seen.add(relative);
  const destinationPath = path.join(outputDir, relative);
  const writer = createWriteStream(destinationPath, { flags: "wx", mode: 0o600 });
  try {
    await reader.copyExactTo(writer, length);
    writer.end();
    await finished(writer);
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

async function unpackArchive(decryptedStream, outputDir, expectedByteCount) {
  const reader = new AsyncByteReader(decryptedStream);
  const magic = await reader.readExact(MAGIC.length);
  if (!magic.equals(MAGIC)) throw fail("snapshot_bundle_format_invalid");
  const tableDirectory = path.join(outputDir, TABLE_DIRECTORY);
  await fs.mkdir(tableDirectory, { mode: 0o700 });
  await fs.chmod(tableDirectory, 0o700);
  const seen = new Set();
  let fileCount = 0;
  while (true) {
    const frameStart = reader.bytesRead;
    const frame = await reader.readExact(FRAME_HEADER_BYTES);
    const nameLength = frame.readUInt32BE(0);
    const contentLength = frame.readBigUInt64BE(4);
    if (nameLength === 0) {
      if (contentLength !== 0n) throw fail("snapshot_bundle_format_invalid");
      const expectedPadding = Number((BigInt(SNAPSHOT_PADDING_BLOCK_BYTES) - (reader.bytesRead % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES))) % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES));
      const actualPadding = await reader.drain();
      if (actualPadding !== expectedPadding || reader.bytesRead !== expectedByteCount || reader.bytesRead % BigInt(SNAPSHOT_PADDING_BLOCK_BYTES) !== 0n) {
        throw fail("snapshot_bundle_padding_invalid");
      }
      break;
    }
    if (nameLength > MAX_PATH_BYTES || contentLength > BigInt(Number.MAX_SAFE_INTEGER) || fileCount >= MAX_ARCHIVE_FILES) {
      throw fail("snapshot_bundle_format_invalid");
    }
    const nameBytes = await reader.readExact(nameLength);
    let relative;
    try {
      relative = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch (error) {
      throw fail("snapshot_bundle_path_invalid", error);
    }
    await writeRestoredFile({ reader, outputDir, relative, length: contentLength, seen });
    fileCount += 1;
    if (reader.bytesRead <= frameStart) throw fail("snapshot_bundle_format_invalid");
  }
  if (fileCount !== seen.size || REQUIRED_SNAPSHOT_ROOT_FILES.some((name) => !seen.has(name))) throw fail("snapshot_bundle_file_set_invalid");
  return fileCount;
}

export async function openSnapshotBundle({ bundleDir, outputDir, encryptionKey } = {}) {
  const key = requireKey(encryptionKey);
  if (typeof bundleDir !== "string" || typeof outputDir !== "string") throw fail("snapshot_bundle_input_missing");
  const bundlePath = path.resolve(bundleDir);
  const outputPath = path.resolve(outputDir);
  if (pathsOverlap(bundlePath, outputPath)) throw fail("snapshot_bundle_path_overlap");
  await requirePrivateDirectory(bundlePath, "snapshot_bundle_mode_invalid");
  const parent = await requireNewTarget(outputPath, "snapshot_restore_parent_invalid");
  const names = (await fs.readdir(bundlePath)).sort();
  if (JSON.stringify(names) !== JSON.stringify([SNAPSHOT_BUNDLE_CIPHERTEXT, SNAPSHOT_BUNDLE_HEADER].sort())) {
    throw fail("snapshot_bundle_file_set_invalid");
  }
  const header = await readBundleHeader(bundlePath);
  if (header.keyId !== snapshotEncryptionKeyId(key)) throw fail("snapshot_encryption_key_mismatch");
  const ciphertextPath = path.join(bundlePath, SNAPSHOT_BUNDLE_CIPHERTEXT);
  const ciphertextStat = await lstatPath(ciphertextPath, "snapshot_bundle_ciphertext_missing");
  requirePrivateFile(ciphertextStat, "snapshot_bundle_ciphertext_mode_invalid");
  if (BigInt(ciphertextStat.size) !== BigInt(header.ciphertextByteCount)) throw fail("snapshot_bundle_invalid");

  const temporaryRoot = path.join(parent, ".fanmark-snapshot-restore-" + randomBytes(16).toString("hex"));
  const temporaryDir = path.join(temporaryRoot, "snapshot");
  const plaintextArchive = path.join(temporaryRoot, "archive.partial");
  await fs.mkdir(temporaryRoot, { mode: 0o700 });
  await fs.chmod(temporaryRoot, 0o700);
  try {
    const decipher = createDecipheriv(SNAPSHOT_ENCRYPTION_ALGORITHM, key, Buffer.from(header.nonce, "hex"));
    decipher.setAuthTag(Buffer.from(header.tag, "hex"));
    await pipeline(
      createReadStream(ciphertextPath, { highWaterMark: 64 * 1024 }),
      decipher,
      createWriteStream(plaintextArchive, { flags: "wx", mode: 0o600 }),
    );
    await fs.mkdir(temporaryDir, { mode: 0o700 });
    await fs.chmod(temporaryDir, 0o700);
    const fileCount = await unpackArchive(createReadStream(plaintextArchive), temporaryDir, BigInt(header.ciphertextByteCount));
    const manifestPath = path.join(temporaryDir, SNAPSHOT_MANIFEST_FILE);
    try {
      await verifySnapshot(manifestPath);
    } catch (error) {
      throw fail("snapshot_bundle_snapshot_invalid", error);
    }
    await fs.rm(plaintextArchive, { force: true });
    await fs.rename(temporaryDir, outputPath);
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    return {
      bundleDir: bundlePath,
      outputDir: outputPath,
      manifestPath: path.join(outputPath, SNAPSHOT_MANIFEST_FILE),
      fileCount,
      keyId: header.keyId,
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    if (error instanceof SnapshotEncryptionError) throw error;
    if (error instanceof Error && /authenticate|unable to authenticate/i.test(error.message)) {
      throw fail("snapshot_bundle_authentication_failed", error);
    }
    throw fail("snapshot_bundle_authentication_failed", error);
  }
}

#!/usr/bin/env node

/** Export to a short-lived private directory, seal it, then remove plaintext. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exportSnapshot, SnapshotExportError } from "./snapshot-export.mjs";
import { readSnapshotEncryptionKey, sealSnapshotDirectory, SnapshotEncryptionError } from "./snapshot-encryption.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(code, cause) {
  const error = new Error(code, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function isInsideRepository(candidate) {
  const relative = path.relative(REPOSITORY_ROOT, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertExternalPath(candidate, { mustExist = false } = {}) {
  const absolute = path.resolve(candidate);
  const parent = await fs.realpath(path.dirname(absolute)).catch((error) => { throw fail("private_path_parent_invalid", error); });
  const actual = path.join(parent, path.basename(absolute));
  if (isInsideRepository(actual)) throw fail("snapshot_artifact_must_be_git_external");
  if (mustExist) {
    const stat = await fs.lstat(actual).catch((error) => { throw fail("private_input_invalid", error); });
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw fail("private_input_invalid");
    const parentStat = await fs.lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o777) !== 0o700) throw fail("private_input_parent_invalid");
  }
  return actual;
}

export async function exportEncryptedSnapshot({ catalog, bundleDir, encryptionKey, credentialDescriptor, ...options } = {}) {
  if (!catalog || typeof bundleDir !== "string") throw fail("missing_export_input");
  const bundlePath = await assertExternalPath(bundleDir);
  const scratchParent = await fs.realpath(os.tmpdir());
  const scratchCandidate = path.join(scratchParent, "fanmark-snapshot-plaintext-");
  if (isInsideRepository(scratchCandidate)) throw fail("snapshot_scratch_must_be_git_external");
  const scratchDir = await fs.mkdtemp(scratchCandidate);
  await fs.chmod(scratchDir, 0o700);
  try {
    const result = await exportSnapshot({ catalog, outputDir: scratchDir, credentialDescriptor, ...options });
    const sealed = await sealSnapshotDirectory({ sourceDir: scratchDir, bundleDir: bundlePath, encryptionKey });
    return {
      runId: result.runId,
      tableCount: result.tableCount,
      schemaDeployable: result.schemaDeployable,
      unresolvedGateCount: result.unresolvedGateCount,
      bundleDir: sealed.bundleDir,
      bundleHeaderPath: sealed.headerPath,
      encryptedFileCount: sealed.encryptedFileCount,
      keyId: sealed.keyId,
    };
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

export const USAGE = `Usage: snapshot-export-encrypted.mjs --catalog PATH --bundle PATH --role postgres [--credential-descriptor PATH] [--fetch-size N] [--timeout-ms N]

Requires FANMARK_SNAPSHOT_KEY_B64 in the process environment. Plaintext rows
are written only to a mode-0700 temporary directory outside the Git checkout,
then encrypted and removed. The bundle path must also be outside the checkout.
`;

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    const name = equals >= 0 ? arg.slice(0, equals) : arg;
    const value = equals >= 0 ? arg.slice(equals + 1) : args[++index];
    if (name === "--catalog") values.catalogPath = value;
    else if (name === "--bundle") values.bundleDir = value;
    else if (name === "--role") values.role = value;
    else if (name === "--credential-descriptor") values.credentialDescriptorPath = value;
    else if (name === "--fetch-size") values.fetchSize = Number(value);
    else if (name === "--timeout-ms") values.timeoutMs = Number(value);
    else if (name === "--psql") values.psqlPath = value;
    else throw fail("invalid_arguments");
  }
  return values;
}

async function readPrivateInput(filePath, code) {
  const absolute = await assertExternalPath(filePath, { mustExist: true });
  try {
    return JSON.parse(await fs.readFile(absolute, "utf8"));
  } catch (error) {
    throw fail(code, error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const values = parseArgs(args);
  if (!values.catalogPath || !values.bundleDir || values.role !== "postgres") throw fail("missing_or_invalid_argument");
  if (values.fetchSize !== undefined && (!Number.isSafeInteger(values.fetchSize) || values.fetchSize < 1 || values.fetchSize > 10_000)) throw fail("invalid_fetch_size");
  if (values.timeoutMs !== undefined && (!Number.isSafeInteger(values.timeoutMs) || values.timeoutMs < 1_000 || values.timeoutMs > 300_000)) throw fail("invalid_timeout");
  const catalog = await readPrivateInput(values.catalogPath, "invalid_catalog_file");
  if (values.credentialDescriptorPath) values.credentialDescriptor = await readPrivateInput(values.credentialDescriptorPath, "invalid_credential_descriptor_file");
  const schemaReadinessSql = await fs.readFile(new URL("./schema-readiness.sql", import.meta.url), "utf8");
  const result = await exportEncryptedSnapshot({ ...values, catalog, encryptionKey: readSnapshotEncryptionKey(), schemaReadinessSql });
  console.log(`Encrypted snapshot bundle prepared at ${result.bundleDir}.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof SnapshotExportError || error instanceof SnapshotEncryptionError || /^[a-z0-9_]+$/.test(error?.code ?? "")
      ? error.code
      : "snapshot_export_failed";
    console.error(`Encrypted snapshot export failed (${code}).`);
    process.exitCode = 1;
  });
}

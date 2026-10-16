#!/usr/bin/env node

/** Round-trip only a synthetic encrypted snapshot through a private R2 staging bucket. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { exportEncryptedSnapshot } from "./snapshot-export-encrypted.mjs";
import { openSnapshotBundle, SNAPSHOT_BUNDLE_CIPHERTEXT } from "./snapshot-encryption.mjs";
import { verifySnapshot as verifyManifest } from "./snapshot-verify.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bucketName = "fanmark-migration-backups-staging";
const expectedAccountId = "bfc2890741f0b3fb236e2d755b6c9adc";
const wranglerVersion = "4.139.0";
const syntheticMarker = "synthetic-r2-restore-marker-7b34";
const syntheticRowId = "00000000-0000-4000-8000-000000000001";

function requireExplicitStagingConsent() {
  const args = new Set(process.argv.slice(2));
  if (args.size !== 2 || !args.has("--run-live-staging-write") || !args.has(`--bucket=${bucketName}`)) {
    throw new Error(`Refusing remote R2 writes. Pass --run-live-staging-write --bucket=${bucketName}.`);
  }
}

function syntheticCatalog() {
  return {
    observed_at: "2026-09-27T00:00:00Z",
    columns: [
      { table_name: "vault_fixture", column_name: "id", ordinal: 1, postgres_type: "uuid", type_schema: "pg_catalog", type_name: "uuid", type_kind: "b", not_null: true, default_expression: null, identity: "", generated: "", collation: null },
      { table_name: "vault_fixture", column_name: "secret", ordinal: 2, postgres_type: "text", type_schema: "pg_catalog", type_name: "text", type_kind: "b", not_null: true, default_expression: null, identity: "", generated: "", collation: null },
    ],
    constraints: [{ table_name: "vault_fixture", name: "vault_fixture_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false }],
    indexes: [], enums: [], triggers: [], rls_policies: [], views: [], functions: [],
  };
}

function syntheticSession(catalog) {
  const rows = [{ schemaVersion: 1, table: "vault_fixture", columns: ["id", "secret"], values: { id: syntheticRowId, secret: syntheticMarker }, arrayMetadata: {} }];
  return {
    async begin() { return { currentUser: "postgres", isolation: "repeatable read", readOnly: true }; },
    async readCatalog() { return catalog; },
    async readSequenceStates() { return []; },
    async *streamTable() { yield* rows; },
    async countTable() { return "1"; },
    async commit() {},
    async rollback() {},
    async close() {},
  };
}

function childEnvironment() {
  const env = { ...process.env, CI: process.env.CI ?? "1" };
  delete env.FANMARK_SNAPSHOT_KEY_B64;
  for (const key of Object.keys(env)) {
    if (/^npm_config_/iu.test(key) || key === "npm_execpath" || /^npm_lifecycle_/iu.test(key)) delete env[key];
  }
  return env;
}

async function runWrangler(args) {
  try {
    return await execFileAsync("npx", ["--yes", `wrangler@${wranglerVersion}`, ...args], {
      cwd: repositoryRoot,
      env: childEnvironment(),
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      timeout: 90_000,
    });
  } catch (error) {
    const failure = new Error(`snapshot_r2_staging_${args.slice(0, 3).join("_")}_failed`);
    failure.diagnostics = `${typeof error?.stdout === "string" ? error.stdout : ""}\n${typeof error?.stderr === "string" ? error.stderr : ""}`;
    throw failure;
  }
}

function remoteObjectPath(key) {
  return `${bucketName}/${key}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureTargetBucket() {
  const identity = await runWrangler(["whoami"]);
  assert.ok(identity.stdout.includes(expectedAccountId), "Wrangler is authenticated to the wrong Cloudflare account");
  const buckets = await runWrangler(["r2", "bucket", "list"]);
  assert.match(buckets.stdout, new RegExp(`(?:^|\\n)name:\\s*${bucketName}\\s*(?:\\n|$)`, "u"));
  const info = JSON.parse((await runWrangler(["r2", "bucket", "info", bucketName, "--json"])).stdout);
  assert.equal(info.name, bucketName);
  assert.equal(info.location, "APAC");
  assert.equal(info.object_count, "0", "staging backup bucket is not empty before this canary");
  assert.equal(info.bucket_size, "0 B", "staging backup bucket has unexpected stored data");
  const devUrl = await runWrangler(["r2", "bucket", "dev-url", "get", bucketName]);
  assert.match(devUrl.stdout, /public access .* disabled/iu, "staging backup bucket exposes a public r2.dev URL");
  const domains = await runWrangler(["r2", "bucket", "domain", "list", bucketName]);
  assert.match(domains.stdout, /no custom domains connected/iu, "staging backup bucket has an unexpected custom domain");
}

async function verifyNoUserDataEndpointBinding() {
  const appConfigPath = path.join(repositoryRoot, "workers/api/wrangler.app-staging.jsonc");
  const config = JSON.parse(await fs.readFile(appConfigPath, "utf8"));
  assert.equal(config.r2_buckets?.some((bucket) => bucket.bucket_name === bucketName), false,
    "migration archive bucket must not be bound to the public staging Worker");
}

async function deleteAndVerifyObjects(keys, temporaryRoot) {
  const remaining = [];
  for (const key of keys) {
    try {
      await runWrangler(["r2", "object", "delete", remoteObjectPath(key), "--remote", "--force"]);
    } catch {
      remaining.push(key);
      continue;
    }
    try {
      await runWrangler(["r2", "object", "get", remoteObjectPath(key), "--remote", "--file", path.join(temporaryRoot, `should-not-exist-${randomUUID()}`)]);
      remaining.push(key);
    } catch (error) {
      assert.match(error.diagnostics, /(?:NoSuchKey|not found|does not exist|404)/iu,
        "R2 readback failed for a reason other than a missing object");
    }
  }
  assert.deepEqual(remaining, [], "failed to delete one or more synthetic R2 objects");
}

async function verifyBucketEmpty() {
  const info = JSON.parse((await runWrangler(["r2", "bucket", "info", bucketName, "--json"])).stdout);
  assert.equal(info.object_count, "0", "staging backup bucket retained an R2 object after cleanup");
  assert.equal(info.bucket_size, "0 B", "staging backup bucket retained data after cleanup");
}

async function main() {
  requireExplicitStagingConsent();
  await ensureTargetBucket();
  await verifyNoUserDataEndpointBinding();

  const runId = randomUUID();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-r2-snapshot-staging-"));
  await fs.chmod(root, 0o700);
  const bundleDir = path.join(root, "bundle");
  const downloadedBundleDir = path.join(root, "downloaded-bundle");
  const restoredDir = path.join(root, "restored");
  await fs.mkdir(downloadedBundleDir, { mode: 0o700 });
  const encryptionKey = createHash("sha256").update(randomUUID()).digest();
  const catalog = syntheticCatalog();
  const uploadedKeys = [];
  let operationError = null;

  try {
    const sealed = await exportEncryptedSnapshot({
      catalog,
      bundleDir,
      encryptionKey,
      session: syntheticSession(catalog),
    });
    const expectedFiles = [
      { name: "bundle.header.json", path: sealed.bundleHeaderPath },
      { name: SNAPSHOT_BUNDLE_CIPHERTEXT, path: path.join(bundleDir, SNAPSHOT_BUNDLE_CIPHERTEXT) },
    ];
    const localHashes = new Map();
    for (const file of expectedFiles) {
      const sourceBytes = await fs.readFile(file.path);
      assert.equal(sourceBytes.includes(Buffer.from(syntheticMarker)), false, "plaintext marker leaked into the R2 upload artifact");
      localHashes.set(file.name, sha256(sourceBytes));
      const key = `synthetic-restore/${runId}/${file.name}`;
      await runWrangler([
        "r2", "object", "put", remoteObjectPath(key), "--remote", "--force",
        "--file", file.path, "--content-type", "application/octet-stream",
      ]);
      uploadedKeys.push(key);
    }

    for (const file of expectedFiles) {
      const key = `synthetic-restore/${runId}/${file.name}`;
      const destination = path.join(downloadedBundleDir, file.name);
      await runWrangler(["r2", "object", "get", remoteObjectPath(key), "--remote", "--file", destination]);
      await fs.chmod(destination, 0o600);
      const downloadedBytes = await fs.readFile(destination);
      assert.equal(sha256(downloadedBytes), localHashes.get(file.name), `R2 object readback mismatch: ${file.name}`);
    }

    const opened = await openSnapshotBundle({ bundleDir: downloadedBundleDir, outputDir: restoredDir, encryptionKey });
    assert.equal((await verifyManifest(opened.manifestPath)).valid, true, "R2-restored snapshot did not verify");
    const manifest = JSON.parse(await fs.readFile(opened.manifestPath, "utf8"));
    const rowFile = manifest.tables.find((entry) => entry.file.startsWith("tables/"))?.file;
    assert.ok(rowFile, "R2-restored synthetic row file is missing");
    assert.equal((await fs.readFile(path.join(restoredDir, rowFile), "utf8")).includes(syntheticMarker), true);
    await fs.rm(restoredDir, { recursive: true, force: true });
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await deleteAndVerifyObjects(uploadedKeys, root);
      await verifyBucketEmpty();
    } catch (error) {
      if (!operationError) operationError = error;
    }
    await fs.rm(root, { recursive: true, force: true });
  }

  if (operationError) throw new Error(operationError.message === "failed to delete one or more synthetic R2 objects"
    ? "snapshot_r2_staging_cleanup_failed"
    : "snapshot_r2_staging_roundtrip_failed");
  console.log(JSON.stringify({
    bucket: bucketName,
    accountId: expectedAccountId,
    syntheticRows: 1,
    encryptedObjectsUploadedAndReadBack: 2,
    restoredSnapshotVerified: true,
    plaintextTempRemoved: true,
    remoteObjectsDeleted: true,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "snapshot R2 staging test failed");
  process.exitCode = 1;
});

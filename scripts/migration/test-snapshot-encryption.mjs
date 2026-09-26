#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { exportSnapshot } from "./snapshot-export.mjs";
import { openSnapshotBundle, readSnapshotEncryptionKey, sealSnapshotDirectory, SNAPSHOT_BUNDLE_CIPHERTEXT } from "./snapshot-encryption.mjs";
import { verifySnapshot } from "./snapshot-verify.mjs";
import { exportEncryptedSnapshot } from "./snapshot-export-encrypted.mjs";

const SYNTHETIC_SECRET = "synthetic-encryption-marker-8d1f";
const UUID = "00000000-0000-4000-8000-000000000001";

function testCatalog() {
  return {
    observed_at: "2026-09-26T00:00:00Z",
    columns: [
      { table_name: "vault_fixture", column_name: "id", ordinal: 1, postgres_type: "uuid", type_schema: "pg_catalog", type_name: "uuid", type_kind: "b", not_null: true, default_expression: null, identity: "", generated: "", collation: null },
      { table_name: "vault_fixture", column_name: "secret", ordinal: 2, postgres_type: "text", type_schema: "pg_catalog", type_name: "text", type_kind: "b", not_null: true, default_expression: null, identity: "", generated: "", collation: null },
    ],
    constraints: [{ table_name: "vault_fixture", name: "vault_fixture_pkey", kind: "p", definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false }],
    indexes: [], enums: [], triggers: [], rls_policies: [], views: [], functions: [],
  };
}

function testSession(catalog) {
  const rows = [{ schemaVersion: 1, table: "vault_fixture", columns: ["id", "secret"], values: { id: UUID, secret: SYNTHETIC_SECRET }, arrayMetadata: {} }];
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

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-snapshot-encryption-"));
  await fs.chmod(root, 0o700);
  return root;
}

async function allFiles(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else files.push(absolute);
    }
  }
  await visit(directory);
  return files;
}

async function plaintextScratchNames() {
  return (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("fanmark-snapshot-plaintext-")).sort();
}

test("seals every snapshot artifact and opens only after AES-GCM and snapshot verification", async () => {
  const root = await tempRoot();
  const bundleDir = path.join(root, "sealed");
  const restoredDir = path.join(root, "restored");
  const encryptionKey = Buffer.from("d56f13a922c31b0d8529ff18b17f984bb7af6290f34448d93099840976ac2a71", "hex");
  const catalog = testCatalog();
  try {
    const scratchBefore = await plaintextScratchNames();
    const sealed = await exportEncryptedSnapshot({ catalog, bundleDir, encryptionKey, session: testSession(catalog) });
    assert.deepEqual(await plaintextScratchNames(), scratchBefore);
    assert.equal(sealed.encryptedFileCount, 1);
    assert.equal((await fs.stat(bundleDir)).mode & 0o777, 0o700);
    const artifacts = await allFiles(bundleDir);
    assert.equal(artifacts.length, 2);
    for (const artifact of artifacts) {
      assert.equal((await fs.stat(artifact)).mode & 0o777, 0o600);
      assert.equal((await fs.readFile(artifact)).includes(Buffer.from(SYNTHETIC_SECRET)), false);
    }
    const header = JSON.parse(await fs.readFile(sealed.bundleHeaderPath, "utf8"));
    assert.equal(header.algorithm, "aes-256-gcm");
    assert.equal(header.keyId, sealed.keyId);
    assert.equal(BigInt(header.ciphertextByteCount) % 65536n, 0n);
    assert.equal(JSON.stringify(header).includes("vault_fixture"), false);
    assert.equal(Object.hasOwn(header, "files"), false);
    assert.equal(Object.hasOwn(header, "tableCount"), false);

    const opened = await openSnapshotBundle({ bundleDir, outputDir: restoredDir, encryptionKey });
    assert.equal(opened.fileCount, 5);
    assert.equal((await verifySnapshot(opened.manifestPath)).valid, true);
    const restoredManifest = JSON.parse(await fs.readFile(opened.manifestPath, "utf8"));
    const restoredRowFile = path.join(restoredDir, restoredManifest.tables.find((entry) => entry.file.startsWith("tables/")).file);
    assert.equal((await fs.readFile(restoredRowFile, "utf8")).includes(SYNTHETIC_SECRET), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects a wrong key and damaged ciphertext without publishing plaintext", async () => {
  const root = await tempRoot();
  const plaintextDir = path.join(root, "plain");
  const bundleDir = path.join(root, "sealed");
  const wrongOutput = path.join(root, "wrong-key-output");
  const damagedOutput = path.join(root, "damaged-output");
  const encryptionKey = Buffer.alloc(32, 5);
  const catalog = testCatalog();
  try {
    await exportSnapshot({ catalog, outputDir: plaintextDir, session: testSession(catalog) });
    await sealSnapshotDirectory({ sourceDir: plaintextDir, bundleDir, encryptionKey });
    await assert.rejects(
      openSnapshotBundle({ bundleDir, outputDir: wrongOutput, encryptionKey: Buffer.alloc(32, 6) }),
      (error) => error.code === "snapshot_encryption_key_mismatch",
    );
    await assert.rejects(fs.lstat(wrongOutput), (error) => error.code === "ENOENT");

    const artifactPath = path.join(bundleDir, SNAPSHOT_BUNDLE_CIPHERTEXT);
    const ciphertext = await fs.readFile(artifactPath);
    ciphertext[0] ^= 0x01;
    await fs.writeFile(artifactPath, ciphertext, { mode: 0o600 });
    await assert.rejects(
      openSnapshotBundle({ bundleDir, outputDir: damagedOutput, encryptionKey }),
      (error) => error.code === "snapshot_bundle_authentication_failed",
    );
    await assert.rejects(fs.lstat(damagedOutput), (error) => error.code === "ENOENT");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reads only canonical 32-byte base64 keys from the process environment", () => {
  const key = Buffer.alloc(32, 9);
  assert.deepEqual(readSnapshotEncryptionKey({ FANMARK_SNAPSHOT_KEY_B64: key.toString("base64") }), key);
  assert.throws(() => readSnapshotEncryptionKey({ FANMARK_SNAPSHOT_KEY_B64: "too-short" }), (error) => error.code === "snapshot_encryption_key_invalid");
  assert.throws(() => readSnapshotEncryptionKey({ FANMARK_SNAPSHOT_KEY_B64: "!".repeat(43) + "=" }), (error) => error.code === "snapshot_encryption_key_invalid");
});

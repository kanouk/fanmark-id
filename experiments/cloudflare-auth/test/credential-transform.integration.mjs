#!/usr/bin/env node

/**
 * Explicit local Miniflare D1 proof for the migration-only credential
 * transform. This .integration.mjs file is outside the default Vitest glob.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, before, beforeEach, after } from "node:test";
import { Miniflare } from "miniflare";
import bcrypt from "bcryptjs";
import {
  applyArtifact,
  BCRYPT_COST,
  CredentialTransformError,
  prepareArtifact,
  reconcileArtifact,
  reserveArtifact,
  transformCredential,
} from "../src/credential-transform.mjs";

const schemaSql = await readFile(new URL("./fixtures/credential-transform.sql", import.meta.url), "utf8");
const LICENSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_IDENTITY = "local-credential-transform";
const TARGET_INCARNATION = "synthetic-target-incarnation-1";
const SOURCE_RELATION = "fanmark_password_configs";
const TABLES = [
  "credential_transform_faults",
  "credential_transform_apply_guards",
  "credential_transform_artifacts",
  "fanmark_access_configs",
  "fanmark_access_versions",
  "fanmark_license_incarnations",
  "fanmark_licenses",
  "migration_targets",
];

let miniflare;
let db;
let currentTime = 1_000;
const testClock = () => currentTime;

function compareUtf8(left, right) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function source(overrides = {}) {
  const envelope = {
    targetIdentity: overrides.targetIdentity ?? TARGET_IDENTITY,
    targetIncarnation: overrides.targetIncarnation ?? TARGET_INCARNATION,
    sourceManifestDigest: overrides.sourceManifestDigest ?? "synthetic-manifest-v1",
    sourceRelation: overrides.sourceRelation ?? SOURCE_RELATION,
    sourcePrimaryKey: overrides.sourcePrimaryKey ?? "synthetic-source-row-1",
    sourceRevision: overrides.sourceRevision ?? "revision-1",
    destinationLicenseId: overrides.destinationLicenseId ?? LICENSE_ID,
    licenseIncarnation: overrides.licenseIncarnation ?? 1,
    enabled: overrides.enabled ?? true,
    credentialInput: overrides.enabled === false ? null : overrides.credentialInput ?? "2468",
  };
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(canonicalize(envelope)));
  return {
    targetIdentity: envelope.targetIdentity,
    targetIncarnation: envelope.targetIncarnation,
    sourceManifestDigest: envelope.sourceManifestDigest,
    sourceRelation: envelope.sourceRelation,
    sourcePrimaryKey: envelope.sourcePrimaryKey,
    sourceRevision: envelope.sourceRevision,
    destinationLicenseId: envelope.destinationLicenseId,
    licenseIncarnation: envelope.licenseIncarnation,
    sourceEnvelopeBytes: envelopeBytes,
  };
}

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const candidate = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/i.test(candidate) && !/\bend\s*$/i.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function resetDatabase() {
  await db.batch([
    db.prepare("PRAGMA foreign_keys = OFF"),
    ...TABLES.map((table) => db.prepare(`DROP TABLE IF EXISTS "${table}"`)),
    db.prepare("PRAGMA foreign_keys = ON"),
  ]);
  await db.batch(splitSqlStatements(schemaSql).map((statement) => db.prepare(statement)));
}

async function row(sql, ...values) {
  return db.prepare(sql).bind(...values).first();
}

async function count(table) {
  const result = await row(`SELECT count(*) AS count FROM "${table}"`);
  return Number(result?.count || 0);
}

function isTransformError(code) {
  return (error) => error instanceof CredentialTransformError && error.code === code;
}

function delayingDatabase(artifactId) {
  const state = { batchCalls: 0 };
  return {
    state,
    prepare: (...args) => db.prepare(...args),
    batch: async (statements) => {
      state.batchCalls += 1;
      const lease = await db.prepare(
        "SELECT lease_expires_at FROM credential_transform_artifacts WHERE artifact_id = ?",
      ).bind(artifactId).first();
      const remaining = Number(lease?.lease_expires_at || 0) - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(25, remaining + 25)));
      return db.batch(statements);
    },
  };
}

before(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: "credential-transform-proof",
          type: "worker",
          compatibilityDate: "2026-09-20",
          compatibilityFlags: ["nodejs_compat"],
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: 'export default { fetch() { return new Response("ok") } };',
              },
            },
          },
          env: {
            TRANSFORM_DB: { type: "d1", id: "credential-transform-proof" },
          },
        },
      },
    ],
  });
  db = await miniflare.getD1Database("TRANSFORM_DB");
});

after(async () => {
  await miniflare?.dispose();
});

beforeEach(async () => {
  currentTime = 1_000;
  await resetDatabase();
});

test("transforms one synthetic row, atomically applies it, and reuses the artifact on rerun", async () => {
  let hashCalls = 0;
  const first = await transformCredential({ db, source: source(), testClock, onHash: () => { hashCalls += 1; } });
  assert.equal(first.state, "reconciled");
  assert.equal(hashCalls, 1);
  assert.equal(Object.hasOwn(first, "destinationHash"), false);
  assert.equal(JSON.stringify(first).includes("2468"), false);

  const artifact = await row(
    "SELECT state, destination_hash, destination_transform_digest, source_binding_digest FROM credential_transform_artifacts",
  );
  const config = await row(
    "SELECT enabled, hash_scheme, password_hash, source_binding_digest, destination_transform_digest FROM fanmark_access_configs",
  );
  const version = await row("SELECT password_generation, lifecycle_generation FROM fanmark_access_versions WHERE license_id = ?", LICENSE_ID);
  assert.equal(artifact.state, "reconciled");
  assert.equal(config.enabled, 1);
  assert.equal(config.hash_scheme, "bcrypt");
  assert.equal(config.password_hash, artifact.destination_hash);
  assert.equal(config.source_binding_digest, artifact.source_binding_digest);
  assert.equal(config.destination_transform_digest, artifact.destination_transform_digest);
  assert.deepEqual(version, { password_generation: 1, lifecycle_generation: 0 });

  const second = await transformCredential({ db, source: source(), testClock, onHash: () => { hashCalls += 1; } });
  assert.equal(hashCalls, 1);
  assert.equal(second.artifactId, first.artifactId);
  assert.equal(second.destinationTransformDigest, first.destinationTransformDigest);
  assert.equal(await count("credential_transform_artifacts"), 1);
});

test("rejects invalid input and keeps a disabled row non-usable", async () => {
  await assert.rejects(
    transformCredential({ db, source: source({ credentialInput: "12x4" }), testClock }),
    isTransformError("invalid_input"),
  );
  assert.equal(await count("credential_transform_artifacts"), 0);

  let hashCalls = 0;
  const disabled = await transformCredential({
    db,
    source: source({ sourcePrimaryKey: "synthetic-disabled-row", enabled: false }),
    testClock,
    onHash: () => { hashCalls += 1; },
  });
  assert.equal(disabled.state, "reconciled");
  assert.equal(hashCalls, 0);
  const config = await row("SELECT enabled, hash_scheme, password_hash FROM fanmark_access_configs");
  assert.equal(config.enabled, 0);
  assert.equal(config.hash_scheme, "bcrypt");
  assert.equal(await bcrypt.compare("2468", config.password_hash), false);
});

test("preserves one binding across initialization crash and lease resume", async () => {
  await assert.rejects(
    transformCredential({ db, source: source(), testClock, leaseMs: 100, fault: "crash-after-reserve" }),
    isTransformError("simulated_crash"),
  );
  assert.equal(await count("credential_transform_artifacts"), 1);
  const reserved = await row("SELECT artifact_id, state, fencing_token FROM credential_transform_artifacts");
  assert.equal(reserved.state, "reserved");

  currentTime = 1_101;
  const resumed = await transformCredential({ db, source: source(), testClock, leaseMs: 100 });
  assert.equal(resumed.state, "reconciled");
  const final = await row("SELECT artifact_id, state, fencing_token FROM credential_transform_artifacts");
  assert.equal(final.artifact_id, reserved.artifact_id);
  assert.equal(final.state, "reconciled");
  assert.equal(Number(final.fencing_token), 2);
});

test("rejects a stale fence and replays a prepared hash without recomputation", async () => {
  const firstLease = await reserveArtifact({ db, source: source(), testClock, leaseMs: 100 });
  currentTime = 1_101;
  const secondLease = await reserveArtifact({ db, source: source(), testClock, leaseMs: 100 });
  await assert.rejects(
    prepareArtifact({ db, source: source(), handle: firstLease, testClock }),
    isTransformError("stale_fence"),
  );

  let hashCalls = 0;
  const prepared = await prepareArtifact({
    db,
    source: source(),
    handle: secondLease,
    testClock,
    onHash: () => { hashCalls += 1; },
  });
  assert.equal(prepared.state, "prepared");
  const stored = await row("SELECT destination_hash, destination_transform_digest FROM credential_transform_artifacts");
  const replay = await prepareArtifact({
    db,
    source: source(),
    handle: prepared,
    testClock,
    onHash: () => { hashCalls += 1; },
  });
  assert.equal(replay.state, "prepared");
  assert.equal(hashCalls, 1);
  const after = await row("SELECT destination_hash, destination_transform_digest FROM credential_transform_artifacts");
  assert.deepEqual(after, stored);
});

test("rejects target mutation during the prepared window and resumes the same hash after repair", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock, leaseMs: 5_000 });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  const before = await row("SELECT destination_hash, destination_transform_digest FROM credential_transform_artifacts");
  await db.prepare("UPDATE fanmark_licenses SET status = 'expired' WHERE id = ?").bind(LICENSE_ID).run();
  await assert.rejects(
    applyArtifact({ db, source: source(), handle: prepared, testClock }),
    isTransformError("target_ineligible"),
  );
  assert.deepEqual(
    await row("SELECT destination_hash, destination_transform_digest, state FROM credential_transform_artifacts"),
    { ...before, state: "prepared" },
  );
  assert.equal(await count("fanmark_access_configs"), 0);

  await db.prepare("UPDATE fanmark_licenses SET status = 'active' WHERE id = ?").bind(LICENSE_ID).run();
  const applied = await applyArtifact({ db, source: source(), handle: prepared, testClock });
  assert.equal(applied.state, "applied");
  assert.equal((await reconcileArtifact({ db, source: source(), artifactId: applied.artifactId, testClock })).state, "reconciled");
});

test("rolls back destination, generation, and ledger together when the apply batch fails", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  await assert.rejects(
    applyArtifact({ db, source: source(), handle: prepared, testClock, fault: "batch-abort" }),
    isTransformError("database_batch_failed"),
  );
  assert.equal(await count("fanmark_access_configs"), 0);
  assert.deepEqual(
    await row("SELECT password_generation, lifecycle_generation FROM fanmark_access_versions WHERE license_id = ?", LICENSE_ID),
    { password_generation: 0, lifecycle_generation: 0 },
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "prepared");

  const applied = await applyArtifact({ db, source: source(), handle: prepared, testClock });
  assert.equal(applied.state, "applied");
});

test("reconciles an acknowledged-unknown apply without generating another hash", async () => {
  let hashCalls = 0;
  await assert.rejects(
    transformCredential({
      db,
      source: source(),
      testClock,
      fault: "ack-unknown",
      onHash: () => { hashCalls += 1; },
    }),
    isTransformError("ack_unknown"),
  );
  assert.equal(hashCalls, 1);
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "applied");
  const resumed = await transformCredential({
    db,
    source: source(),
    testClock,
    onHash: () => { hashCalls += 1; },
  });
  assert.equal(resumed.state, "reconciled");
  assert.equal(hashCalls, 1);
});

test("rejects a changed source envelope and preserves the applied artifact", async () => {
  const original = source();
  const first = await transformCredential({ db, source: original, testClock });
  await assert.rejects(
    transformCredential({
      db,
      source: source({ sourceRevision: "revision-2", credentialInput: "8642" }),
      testClock,
    }),
    isTransformError("source_changed"),
  );
  assert.equal(await count("credential_transform_artifacts"), 1);
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "reconciled");
  assert.equal((await transformCredential({ db, source: original, testClock })).artifactId, first.artifactId);
});

test("rejects a missing incarnation authority before reservation", async () => {
  await db.prepare("DELETE FROM fanmark_license_incarnations WHERE license_id = ?").bind(LICENSE_ID).run();
  await assert.rejects(
    reserveArtifact({ db, source: source(), testClock }),
    isTransformError("target_not_found"),
  );
  assert.equal(await count("credential_transform_artifacts"), 0);
  assert.equal(await count("fanmark_access_configs"), 0);
});

test("rejects incarnation removal between reconciliation read and final SQL", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  const applied = await applyArtifact({ db, source: source(), handle: prepared, testClock });
  await assert.rejects(
    reconcileArtifact({
      db, source: source(), artifactId: applied.artifactId, testClock,
      testBeforeFinalize: async () => {
        await db.prepare("DELETE FROM fanmark_license_incarnations WHERE license_id = ?").bind(LICENSE_ID).run();
      },
    }),
    isTransformError("reconcile_mismatch"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "applied");
  await assert.rejects(
    reconcileArtifact({ db, source: source(), artifactId: applied.artifactId, testClock }),
    isTransformError("reconcile_mismatch"),
  );
});

test("rejects same-UUID license recreation through the retained incarnation", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock, leaseMs: 5_000 });
  await db.prepare("DELETE FROM fanmark_licenses WHERE id = ?").bind(LICENSE_ID).run();
  await db.prepare("INSERT INTO fanmark_licenses (id, fanmark_id, status, returned) VALUES (?, ?, 'active', 0)")
    .bind(LICENSE_ID, "fanmark-recreated")
    .run();
  await assert.rejects(
    prepareArtifact({ db, source: source(), handle: reserved, testClock }),
    isTransformError("target_changed"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "reserved");
});

test("rejects a lease that expires before the final prepare SQL reaches D1", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock: () => 1_000, leaseMs: 100 });
  let reads = 0;
  const delayedTestClock = () => {
    reads += 1;
    return reads === 1 ? 1_000 : 1_101;
  };
  await assert.rejects(
    prepareArtifact({ db, source: source(), handle: reserved, testClock: delayedTestClock }),
    isTransformError("stale_fence"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "reserved");
});

test("rejects a prepared hash mutation before applying the artifact", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  await db.prepare(
    "UPDATE credential_transform_artifacts SET destination_hash = ? WHERE artifact_id = ?",
  ).bind("tampered-hash", prepared.artifactId).run();
  await assert.rejects(
    applyArtifact({ db, source: source(), handle: prepared, testClock }),
    isTransformError("artifact_tampered"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "prepared");
  assert.equal(await count("fanmark_access_configs"), 0);
});

test("revalidates a reconciled target and rejects an enabled-state mutation", async () => {
  await transformCredential({ db, source: source(), testClock });
  await db.prepare("UPDATE fanmark_access_configs SET enabled = 0 WHERE license_id = ?")
    .bind(LICENSE_ID).run();
  await assert.rejects(
    reconcileArtifact({ db, source: source(), artifactId: (await row("SELECT artifact_id FROM credential_transform_artifacts")).artifact_id, testClock }),
    isTransformError("reconcile_mismatch"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "reconciled");
});

test("uses the final SQL guard when the target changes after reconciliation read", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  const applied = await applyArtifact({ db, source: source(), handle: prepared, testClock });
  await assert.rejects(
    reconcileArtifact({
      db,
      source: source(),
      artifactId: applied.artifactId,
      testClock,
      testBeforeFinalize: async () => {
        await db.prepare("UPDATE migration_targets SET target_incarnation = ? WHERE target_identity = ?")
          .bind("synthetic-target-incarnation-race", TARGET_IDENTITY).run();
      },
    }),
    isTransformError("reconcile_mismatch"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "applied");
  await db.prepare("UPDATE migration_targets SET target_incarnation = ? WHERE target_identity = ?")
    .bind(TARGET_INCARNATION, TARGET_IDENTITY).run();
  assert.equal(
    (await reconcileArtifact({ db, source: source(), artifactId: applied.artifactId, testClock })).state,
    "reconciled",
  );
});

test("rejects a target-incarnation change when rechecking an applied artifact", async () => {
  const reserved = await reserveArtifact({ db, source: source(), testClock });
  const prepared = await prepareArtifact({ db, source: source(), handle: reserved, testClock });
  const applied = await applyArtifact({ db, source: source(), handle: prepared, testClock });
  await db.prepare("UPDATE migration_targets SET target_incarnation = ? WHERE target_identity = ?")
    .bind("synthetic-target-incarnation-new", TARGET_IDENTITY).run();
  await assert.rejects(
    reconcileArtifact({ db, source: source(), artifactId: applied.artifactId, testClock }),
    isTransformError("reconcile_mismatch"),
  );
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "applied");
});

test("uses SQLite execution time to reject a delayed production prepare batch", async () => {
  const disabledSource = source({ enabled: false, sourcePrimaryKey: "delayed-prepare-row" });
  const reserved = await reserveArtifact({ db, source: disabledSource, leaseMs: 1_000 });
  const delayedDb = delayingDatabase(reserved.artifactId);
  await assert.rejects(
    prepareArtifact({ db: delayedDb, source: disabledSource, handle: reserved }),
    isTransformError("stale_fence"),
  );
  assert.equal(delayedDb.state.batchCalls, 1);
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "reserved");
});

test("uses SQLite execution time to reject a delayed production apply batch", async () => {
  const disabledSource = source({ enabled: false, sourcePrimaryKey: "delayed-apply-row" });
  const reserved = await reserveArtifact({ db, source: disabledSource, leaseMs: 1_000 });
  const prepared = await prepareArtifact({ db, source: disabledSource, handle: reserved });
  const delayedDb = delayingDatabase(prepared.artifactId);
  await assert.rejects(
    applyArtifact({ db: delayedDb, source: disabledSource, handle: prepared }),
    isTransformError("database_batch_failed"),
  );
  assert.equal(delayedDb.state.batchCalls, 1);
  assert.equal((await row("SELECT state FROM credential_transform_artifacts")).state, "prepared");
  assert.equal(await count("fanmark_access_configs"), 0);
});

test("keeps concurrent reservations on one source binding", async () => {
  const results = await Promise.allSettled([
    reserveArtifact({ db, source: source(), testClock, leaseMs: 5_000 }),
    reserveArtifact({ db, source: source(), testClock, leaseMs: 5_000 }),
  ]);
  assert.equal(await count("credential_transform_artifacts"), 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.reason?.code, "lease_busy");
});

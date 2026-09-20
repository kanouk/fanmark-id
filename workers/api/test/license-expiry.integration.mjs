#!/usr/bin/env node

/**
 * Explicit local Miniflare D1 proof for the active -> grace repository.
 * This file is intentionally outside the default Vitest glob. It uses only
 * synthetic rows and never reads or mutates a remote database.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CANDIDATE_PAGE_SIZE,
  createLicenseExpiryRepository,
  LicenseExpiryError,
  roundUpToNextUtcMidnight,
} from "../src/license-expiry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const fixturePath = path.join(repoRoot, "workers/api/test/fixtures/license-expiry.sql");
const NOW = "2026-09-21T12:00:00.000000Z";
const NEXT_DAY = "2026-09-22T00:00:00.000000Z";

function statementsFrom(sql) {
  const withoutLineComments = sql.replace(/^\s*--[^\n]*(?:\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < withoutLineComments.length; index += 1) {
    const character = withoutLineComments[index];
    if (character === "'") {
      if (quoted && withoutLineComments[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ";") {
      const statement = withoutLineComments.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = withoutLineComments.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

async function createLocalD1() {
  let Miniflare;
  try {
    ({ Miniflare } = await import(pathToFileURL(miniflarePath).href));
  } catch (error) {
    throw new Error("local_miniflare_unavailable", { cause: error });
  }

  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: "fanmark-license-expiry-test",
          type: "worker",
          compatibilityDate: "2026-09-18",
          env: { DB: { type: "d1", name: "fanmark-license-expiry-test" } },
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: "export default { fetch() { return new Response('ok'); } };",
              },
            },
          },
        },
      },
    ],
  });
  const database = await miniflare.getD1Database("DB");
  return { miniflare, database };
}

async function executeSchema(database) {
  const sql = await fs.readFile(fixturePath, "utf8");
  const results = await database.batch(
    statementsFrom(sql).map((statement) => database.prepare(statement)),
  );
  assert.equal(results.every((result) => result.success === true), true);
}

async function batch(database, statements) {
  const results = await database.batch(
    statements.map(({ sql, bindings = [] }) => database.prepare(sql).bind(...bindings)),
  );
  assert.equal(results.every((result) => result.success === true), true);
  return results;
}

async function reset(database, settingValue = "1") {
  await batch(database, [
    { sql: "DELETE FROM lifecycle_outbox" },
    { sql: "DELETE FROM audit_logs" },
    { sql: "DELETE FROM fanmark_licenses" },
    { sql: "DELETE FROM fanmarks" },
    { sql: "DELETE FROM system_settings" },
    { sql: "DELETE FROM license_expiry_run_items" },
    { sql: "DELETE FROM license_expiry_runs" },
    {
      sql: "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)",
      bindings: ["grace_period_days", settingValue],
    },
  ]);
}

async function insertFanmark(database, id, status = "active") {
  await database
    .prepare("INSERT INTO fanmarks (id, status) VALUES (?, ?)")
    .bind(id, status)
    .run();
}

async function insertLicense(
  database,
  { id, fanmarkId, userId = "user-a", status = "active", licenseEnd, graceExpiresAt = null, isReturned = 0, generation = 0 },
) {
  await database
    .prepare(`
      INSERT INTO fanmark_licenses
        (id, fanmark_id, user_id, status, license_end, grace_expires_at,
         is_returned, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, fanmarkId, userId, status, licenseEnd, graceExpiresAt, isReturned, generation)
    .run();
}

async function readLicense(database, id) {
  return database
    .prepare(`
      SELECT id, fanmark_id, user_id, status, license_end, grace_expires_at,
             is_returned, generation, lifecycle_claim_id
      FROM fanmark_licenses
      WHERE id = ?
    `)
    .bind(id)
    .first();
}

async function countRows(database, table, where = "1 = 1", bindings = []) {
  const row = await database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .bind(...bindings)
    .first();
  return Number(row?.count);
}

function repository(database, runId, capturedNow = NOW) {
  return createLicenseExpiryRepository({ database, runId, capturedNow });
}

function assertErrorCode(error, code) {
  return error instanceof LicenseExpiryError && error.code === code;
}

async function competingMutation(database, kind, licenseId, capturedNow = NOW) {
  const operationId = `${kind}-operation`;
  const generation = 0;
  const target = {
    extension: {
      status: "active",
      licenseEnd: "2099-01-01T00:00:00.000000Z",
      graceExpiresAt: null,
      isReturned: 0,
      userId: "user-a",
      action: "license_extended",
      event: "license_extended",
    },
    return: {
      status: "grace",
      licenseEnd: capturedNow,
      graceExpiresAt: NEXT_DAY,
      isReturned: 1,
      userId: "user-a",
      action: "return_fanmark",
      event: "fanmark_returned_owner",
    },
    transfer: {
      status: "expired",
      licenseEnd: capturedNow,
      graceExpiresAt: null,
      isReturned: 1,
      userId: "user-recipient",
      action: "LICENSE_TRANSFERRED",
      event: "transfer_approved",
    },
  }[kind];
  assert.ok(target, `unknown competing mutation ${kind}`);
  const payload = JSON.stringify({ schemaVersion: 1, kind, operationId, licenseId, capturedNow });
  const results = await batch(database, [
    {
      sql: `
        UPDATE fanmark_licenses
        SET status = ?, license_end = ?, grace_expires_at = ?, is_returned = ?,
            user_id = ?, generation = generation + 1, lifecycle_claim_id = ?
        WHERE id = ? AND status = 'active' AND generation = ?
          AND lifecycle_claim_id IS NULL
      `,
      bindings: [
        target.status,
        target.licenseEnd,
        target.graceExpiresAt,
        target.isReturned,
        target.userId,
        operationId,
        licenseId,
        generation,
      ],
    },
    {
      sql: `
        INSERT INTO audit_logs
          (id, action, license_id, fanmark_id, user_id, generation, run_id, metadata_json)
        SELECT ?, ?, l.id, l.fanmark_id, l.user_id, l.generation, ?, ?
        FROM fanmark_licenses AS l
        WHERE l.id = ? AND l.generation = ? AND l.lifecycle_claim_id = ?
      `,
      bindings: [
        `${operationId}:audit`,
        target.action,
        operationId,
        payload,
        licenseId,
        generation + 1,
        operationId,
      ],
    },
    {
      sql: `
        INSERT INTO lifecycle_outbox
          (id, event_type, dedupe_key, license_id, fanmark_id, user_id,
           generation, license_end, grace_expires_at, captured_now, run_id,
           payload_json)
        SELECT ?, ?, ?, l.id, l.fanmark_id, l.user_id, l.generation,
               l.license_end, l.grace_expires_at, ?, ?, ?
        FROM fanmark_licenses AS l
        WHERE l.id = ? AND l.generation = ? AND l.lifecycle_claim_id = ?
      `,
      bindings: [
        `${operationId}:outbox`,
        target.event,
        `${licenseId}:generation:1:${target.event}`,
        capturedNow,
        operationId,
        payload,
        licenseId,
        generation + 1,
        operationId,
      ],
    },
    {
      sql: "UPDATE fanmark_licenses SET lifecycle_claim_id = NULL WHERE id = ? AND generation = ? AND lifecycle_claim_id = ?",
      bindings: [licenseId, generation + 1, operationId],
    },
  ]);
  return results[0]?.meta?.changes === 1;
}

async function testCanonicalAndBasicTransition(database) {
  await reset(database);
  await insertFanmark(database, "fanmark-past");
  await insertFanmark(database, "fanmark-equal");
  await insertFanmark(database, "fanmark-future");
  await insertFanmark(database, "fanmark-null");
  await insertFanmark(database, "fanmark-inactive", "inactive");
  await insertFanmark(database, "fanmark-returned");

  await insertLicense(database, { id: "license-past", fanmarkId: "fanmark-past", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  await insertLicense(database, { id: "license-equal", fanmarkId: "fanmark-equal", licenseEnd: NOW });
  await insertLicense(database, { id: "license-future", fanmarkId: "fanmark-future", licenseEnd: "2026-09-22T00:00:00.000000Z" });
  await insertLicense(database, { id: "license-null", fanmarkId: "fanmark-null", licenseEnd: null });
  await insertLicense(database, { id: "license-inactive", fanmarkId: "fanmark-inactive", licenseEnd: "2026-09-20T00:00:00.000000Z" });
  await insertLicense(database, { id: "license-returned", fanmarkId: "fanmark-returned", licenseEnd: "2026-09-20T12:00:00.000000Z", isReturned: 1 });

  const result = await repository(database, "run-basic").runActiveToGrace();
  assert.equal(result.status, "completed");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.processed, 2);

  const past = await readLicense(database, "license-past");
  assert.deepEqual(
    {
      status: past.status,
      licenseEnd: past.license_end,
      graceExpiresAt: past.grace_expires_at,
      isReturned: past.is_returned,
      generation: past.generation,
      claim: past.lifecycle_claim_id,
    },
    {
      status: "grace",
      licenseEnd: "2026-09-20T12:00:00.000000Z",
      graceExpiresAt: "2026-09-22T00:00:00.000000Z",
      isReturned: 0,
      generation: 1,
      claim: null,
    },
  );
  const returned = await readLicense(database, "license-returned");
  assert.equal(returned.status, "grace");
  assert.equal(returned.is_returned, 0);
  assert.equal(returned.license_end, "2026-09-20T12:00:00.000000Z");
  assert.equal(returned.grace_expires_at, "2026-09-22T00:00:00.000000Z");
  for (const id of ["license-equal", "license-future", "license-null", "license-inactive"]) {
    const license = await readLicense(database, id);
    assert.equal(license.status, "active", id);
    assert.equal(license.generation, 0, id);
  }
  assert.equal(await countRows(database, "audit_logs", "action = 'license_grace_started'"), 2);
  assert.equal(await countRows(database, "lifecycle_outbox", "event_type = 'license_grace_started'"), 2);
}

async function testTimeBoundaries(database) {
  await reset(database);
  const cases = [
    ["license-exact-midnight", "2026-12-31T00:00:00.000000Z", "2027-01-01T00:00:00.000000Z", "2027-01-01T00:00:00.000000Z"],
    ["license-midnight-plus-us", "2026-12-31T00:00:00.000001Z", "2027-01-01T00:00:00.000000Z", "2027-01-02T00:00:00.000000Z"],
    ["license-month-boundary", "2026-01-31T12:00:00.000000Z", "2026-02-01T00:00:00.000000Z", "2026-02-02T00:00:00.000000Z"],
    ["license-leap-boundary", "2024-02-28T23:59:59.999999Z", "2024-03-01T00:00:00.000000Z", "2024-03-01T00:00:00.000000Z"],
    ["license-year-boundary", "2025-12-31T12:00:00.000000Z", "2026-01-01T00:00:00.000000Z", "2026-01-02T00:00:00.000000Z"],
  ];
  for (const [id, licenseEnd, capturedNow] of cases) {
    await insertFanmark(database, `fanmark-${id}`);
    await insertLicense(database, { id, fanmarkId: `fanmark-${id}`, licenseEnd });
    const result = await repository(database, `run-${id}`, capturedNow).runActiveToGrace();
    assert.equal(result.processed, 1, id);
    const license = await readLicense(database, id);
    assert.equal(license.grace_expires_at, cases.find((entry) => entry[0] === id)[3], id);
  }
  assert.equal(roundUpToNextUtcMidnight("2026-12-31T00:00:00.000001Z", 1), "2027-01-02T00:00:00.000000Z");
}

async function testSettingCompatibilityAndBindings(database) {
  await reset(database, "2days");
  await insertFanmark(database, "fanmark-setting");
  await insertLicense(database, { id: "license-setting", fanmarkId: "fanmark-setting", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  const prefixed = await repository(database, "run-setting").runActiveToGrace();
  assert.equal(prefixed.gracePeriodDays, 2);
  assert.equal((await readLicense(database, "license-setting")).grace_expires_at, "2026-09-23T00:00:00.000000Z");

  await reset(database, "0");
  await insertFanmark(database, "fanmark-fallback");
  await insertLicense(database, { id: "license-fallback", fanmarkId: "fanmark-fallback", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  const fallback = await repository(database, "run-fallback").runActiveToGrace();
  assert.equal(fallback.gracePeriodDays, 1);

  await reset(database);
  await database.prepare("DELETE FROM system_settings").run();
  await assert.rejects(repository(database, "run-missing-setting").runActiveToGrace(), (error) => assertErrorCode(error, "grace_period_query_failed"));

  await executeSchema(database);
  await reset(database);
  await database.prepare("DROP TABLE system_settings").run();
  await assert.rejects(repository(database, "run-query-failure").runActiveToGrace(), (error) => assertErrorCode(error, "grace_period_query_failed"));
  await executeSchema(database);
  await reset(database);

  assert.throws(
    () => repository(database, "run-invalid-time", "2026-09-21T12:00:00Z"),
    (error) => assertErrorCode(error, "invalid_captured_now"),
  );
  await insertFanmark(database, "fanmark-bound");
  await insertLicense(database, { id: "license-bound", fanmarkId: "fanmark-bound", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  await repository(database, "run-bound", NOW).runActiveToGrace();
  await assert.rejects(repository(database, "run-bound", "2026-09-21T12:00:00.000001Z").runActiveToGrace(), (error) => assertErrorCode(error, "run_binding_mismatch"));
  await database.prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = ?").bind("2", "grace_period_days").run();
  await assert.rejects(repository(database, "run-bound", NOW).runActiveToGrace(), (error) => assertErrorCode(error, "run_binding_mismatch"));
}

async function testRollbackAndUnknownAcknowledgement(database) {
  await reset(database);
  await insertFanmark(database, "fanmark-rollback");
  await insertLicense(database, { id: "license-rollback", fanmarkId: "fanmark-rollback", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  const failingDatabase = {
    prepare: database.prepare.bind(database),
    async batch(statements) {
      if (statements.length !== 5) return database.batch(statements);
      return database.batch([
        ...statements,
        database.prepare("SELECT * FROM missing_license_expiry_table"),
      ]);
    },
  };
  await assert.rejects(repository(failingDatabase, "run-rollback").runActiveToGrace(), (error) => assertErrorCode(error, "active_to_grace_batch_failed"));
  const rolledBack = await readLicense(database, "license-rollback");
  assert.equal(rolledBack.status, "active");
  assert.equal(rolledBack.generation, 0);
  assert.equal(await countRows(database, "audit_logs"), 0);
  assert.equal(await countRows(database, "lifecycle_outbox"), 0);

  await reset(database);
  await insertFanmark(database, "fanmark-ack");
  await insertLicense(database, { id: "license-ack", fanmarkId: "fanmark-ack", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  let loseAcknowledgement = true;
  const uncertainDatabase = {
    prepare: database.prepare.bind(database),
    async batch(statements) {
      const result = await database.batch(statements);
      if (loseAcknowledgement && statements.length === 5) {
        loseAcknowledgement = false;
        throw new Error("synthetic lost acknowledgement");
      }
      return result;
    },
  };
  const acknowledged = await repository(uncertainDatabase, "run-ack").runActiveToGrace();
  assert.equal(acknowledged.alreadyCommitted, 0);
  assert.equal(acknowledged.processed, 1);
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
  assert.equal((await database.prepare("SELECT outcome FROM license_expiry_run_items WHERE run_id = ?").bind("run-ack").first()).outcome, "processed");
  const retry = await repository(database, "run-ack").runActiveToGrace();
  assert.equal(retry.status, "completed");
  assert.equal(retry.processed, 1);
  assert.equal(retry.alreadyCommitted, 0);
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
}

async function testProgressCrashRecovery(database) {
  await reset(database);
  await insertFanmark(database, "fanmark-progress-crash");
  await insertLicense(database, {
    id: "license-progress-crash",
    fanmarkId: "fanmark-progress-crash",
    licenseEnd: "2026-09-20T12:00:00.000000Z",
  });

  let failProgress = true;
  const crashingDatabase = {
    batch: database.batch.bind(database),
    prepare(sql) {
      const prepared = database.prepare(sql);
      if (!failProgress || !sql.includes("UPDATE license_expiry_runs") || !sql.includes("SET last_license_id")) {
        return prepared;
      }
      return {
        bind(...bindings) {
          const bound = prepared.bind(...bindings);
          return {
            async run() {
              failProgress = false;
              throw new Error("synthetic progress crash after transition commit");
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    repository(crashingDatabase, "run-progress-crash").runActiveToGrace(),
    (error) => assertErrorCode(error, "run_progress_update_failed"),
  );
  assert.equal((await readLicense(database, "license-progress-crash")).status, "grace");
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
  const interruptedRun = await database
    .prepare("SELECT status, last_license_id, candidate_count, processed_count FROM license_expiry_runs WHERE run_id = ?")
    .bind("run-progress-crash")
    .first();
  assert.deepEqual(
    {
      status: interruptedRun.status,
      lastLicenseId: interruptedRun.last_license_id,
      candidateCount: interruptedRun.candidate_count,
      processedCount: interruptedRun.processed_count,
    },
    { status: "running", lastLicenseId: "", candidateCount: 0, processedCount: 0 },
  );

  const [first, second] = await Promise.all([
    repository(database, "run-progress-crash").runActiveToGrace(),
    repository(database, "run-progress-crash").runActiveToGrace(),
  ]);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(first.candidateCount, 1);
  assert.equal(second.candidateCount, 1);
  assert.equal(first.processed, 1);
  assert.equal(second.processed, 1);
  const recoveredRun = await database
    .prepare("SELECT status, last_license_id, candidate_count, processed_count, already_committed_count, conflict_count FROM license_expiry_runs WHERE run_id = ?")
    .bind("run-progress-crash")
    .first();
  assert.deepEqual(
    {
      status: recoveredRun.status,
      lastLicenseId: recoveredRun.last_license_id,
      candidateCount: recoveredRun.candidate_count,
      processedCount: recoveredRun.processed_count,
      alreadyCommittedCount: recoveredRun.already_committed_count,
      conflictCount: recoveredRun.conflict_count,
    },
    {
      status: "completed",
      lastLicenseId: "license-progress-crash",
      candidateCount: 1,
      processedCount: 1,
      alreadyCommittedCount: 0,
      conflictCount: 0,
    },
  );
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
  assert.equal((await database.prepare("SELECT outcome FROM license_expiry_run_items WHERE run_id = ?").bind("run-progress-crash").first()).outcome, "processed");
}

async function testConcurrentExpiry(database) {
  await reset(database);
  await insertFanmark(database, "fanmark-concurrent");
  await insertLicense(database, { id: "license-concurrent", fanmarkId: "fanmark-concurrent", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  const [first, second] = await Promise.all([
    repository(database, "run-concurrent-a").runActiveToGrace(),
    repository(database, "run-concurrent-b").runActiveToGrace(),
  ]);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
  assert.equal((await readLicense(database, "license-concurrent")).generation, 1);

  await reset(database);
  await insertFanmark(database, "fanmark-duplicate-run");
  await insertLicense(database, { id: "license-duplicate-run", fanmarkId: "fanmark-duplicate-run", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  const duplicateRun = await Promise.all([
    repository(database, "run-duplicate").runActiveToGrace(),
    repository(database, "run-duplicate").runActiveToGrace(),
  ]);
  assert.equal(duplicateRun.every((result) => result.status === "completed"), true);
  assert.equal(await countRows(database, "audit_logs"), 1);
  assert.equal(await countRows(database, "lifecycle_outbox"), 1);
}

async function testStaleCandidateGuard(database) {
  await reset(database);
  await insertFanmark(database, "fanmark-stale");
  await insertLicense(database, { id: "license-stale", fanmarkId: "fanmark-stale", licenseEnd: "2026-09-20T12:00:00.000000Z" });
  let mutateAfterCandidateRead = true;
  const staleDatabase = {
    batch: database.batch.bind(database),
    prepare(sql) {
      const prepared = database.prepare(sql);
      if (!mutateAfterCandidateRead || !sql.includes("ORDER BY l.id ASC") || !sql.includes("LIMIT ?")) return prepared;
      return {
        bind(...bindings) {
          const bound = prepared.bind(...bindings);
          return {
            async all() {
              const rows = await bound.all();
              if (mutateAfterCandidateRead) {
                mutateAfterCandidateRead = false;
                await database
                  .prepare("UPDATE fanmark_licenses SET user_id = ?, generation = generation + 1 WHERE id = ?")
                  .bind("user-replaced", "license-stale")
                  .run();
              }
              return rows;
            },
          };
        },
      };
    },
  };
  const result = await repository(staleDatabase, "run-stale").runActiveToGrace();
  assert.equal(result.conflicts, 1);
  const stale = await readLicense(database, "license-stale");
  assert.equal(stale.status, "active");
  assert.equal(stale.user_id, "user-replaced");
  assert.equal(stale.generation, 1);
  assert.equal(await countRows(database, "audit_logs"), 0);
  assert.equal(await countRows(database, "lifecycle_outbox"), 0);
}

async function testConcurrentExtensionReturnTransfer(database) {
  for (const kind of ["extension", "return", "transfer"]) {
    await reset(database);
    await insertFanmark(database, `fanmark-${kind}`);
    await insertLicense(database, { id: `license-${kind}`, fanmarkId: `fanmark-${kind}`, licenseEnd: "2026-09-20T12:00:00.000000Z" });
    const expiry = repository(database, `run-race-${kind}`);
    const [expiryResult, competingResult] = await Promise.all([
      expiry.runActiveToGrace(),
      competingMutation(database, kind, `license-${kind}`),
    ]);
    assert.equal(expiryResult.status, "completed");
    assert.equal(typeof competingResult, "boolean");
    const license = await readLicense(database, `license-${kind}`);
    assert.equal(license.generation, 1, kind);
    assert.equal(license.lifecycle_claim_id, null, kind);
    assert.equal(await countRows(database, "audit_logs"), 1, kind);
    assert.equal(await countRows(database, "lifecycle_outbox"), 1, kind);
    const event = await database.prepare("SELECT event_type FROM lifecycle_outbox").first();
    if (competingResult) {
      assert.notEqual(event.event_type, "license_grace_started", kind);
    } else {
      assert.equal(event.event_type, "license_grace_started", kind);
    }
  }
}

async function testBoundedKeysetPage(database) {
  await reset(database);
  assert.ok(CANDIDATE_PAGE_SIZE < 65);
  for (let index = 0; index < 65; index += 1) {
    const suffix = String(index).padStart(3, "0");
    await insertFanmark(database, `fanmark-bulk-${suffix}`);
    await insertLicense(database, {
      id: `license-bulk-${suffix}`,
      fanmarkId: `fanmark-bulk-${suffix}`,
      licenseEnd: "2026-09-20T12:00:00.000000Z",
    });
  }
  const result = await repository(database, "run-page").runActiveToGrace();
  assert.equal(result.candidateCount, 65);
  assert.equal(result.processed, 65);
  assert.ok(result.results.length <= 32);
  assert.equal(await countRows(database, "audit_logs"), 65);
  assert.equal(await countRows(database, "lifecycle_outbox"), 65);
}

async function main() {
  const { miniflare, database } = await createLocalD1();
  try {
    await executeSchema(database);
    await testCanonicalAndBasicTransition(database);
    await testTimeBoundaries(database);
    await testSettingCompatibilityAndBindings(database);
    await testRollbackAndUnknownAcknowledgement(database);
    await testProgressCrashRecovery(database);
    await testConcurrentExpiry(database);
    await testStaleCandidateGuard(database);
    await testConcurrentExtensionReturnTransfer(database);
    await testBoundedKeysetPage(database);
    console.log("Miniflare D1 license expiry proof passed: active->grace CAS, UTC precision, pagination, rollback, ACK retry, and competing operations.");
  } finally {
    await miniflare.dispose();
  }
}

main().catch((error) => {
  console.error(`Miniflare D1 license expiry proof failed: ${error instanceof Error ? `${error.code ?? "error"}: ${error.message}` : String(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
});

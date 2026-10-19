import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, chmod, rm, unlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { prepareCurrentCatalogSyntheticSnapshot } from './test-d1-import-current-schema.mjs';
import { applyBusinessRuntimeMigrations } from './business-runtime-import-schema.mjs';
import { importInitialBusinessSnapshot, importD1Snapshot, verifyImportedD1Snapshot } from './d1-import.mjs';
import { prepareInitialBusinessTarget, createStopOnFailureD1 } from './business-import-initial-target.mjs';
import { createProductionRemoteD1, openProductionD1ImportTransport, PRODUCTION_D1_TARGETS, isReadOnlyProductionSql } from './production-remote-d1.mjs';
import { createProductionImportCoordinator } from './production-import-coordinator-client.mjs';

const catalog = fileURLToPath(new URL('./fixtures/business-import-structure.json', import.meta.url));
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'fanmark-business-stage-'));
  await chmod(directory, 0o700);
  const mf = new Miniflare({ workers: [{ config: { name: 'business-stage', type: 'worker', compatibilityDate: '2026-09-18',
    env: { DB: { type: 'd1', name: 'business-stage' } }, manifest: { mainModule: 'index.js', modules: {
      'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response(null)}}' },
    } } } }] });
  try {
    const database = await mf.getD1Database('DB');
    await applyBusinessRuntimeMigrations(database);
    const snapshot = await prepareCurrentCatalogSyntheticSnapshot(catalog, { snapshotDirectory: join(directory, 'snapshot'), includeAuxiliary: false, fullTableCoverage: true });
    const options = { manifestPath: snapshot.manifestPath, database, readDatabase: database, destinationId: 'synthetic-business',
      targetIncarnation: randomUUID(), reportPath: join(directory, 'report.json'), expectedTargetProfile: snapshot.expectedTargetProfile,
      allowUnresolvedGates: true, resolveAuthUserIds: async ids => new Set(ids.filter(id => id === snapshot.syntheticAuthUserId)) };
    await run(database, options, directory);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
}

// Transport-level loss, after native COMMIT. Every later native call is counted.
function loseAcknowledgement(database, match, { malformed = false, before = null } = {}) {
  const statements = new WeakMap();
  let lost = false, laterCalls = 0;
  async function execute(sql, action) {
    if (lost) laterCalls++;
    if (before) { const fn = before; before = null; await fn(); }
    const result = await action();
    if (!lost && match(sql)) { lost = true; if (malformed) return []; throw Error('PRIVATE_PROVIDER_DIAGNOSTIC'); }
    return result;
  }
  function prepare(sql, values = []) {
    const native = database.prepare(sql).bind(...values);
    const item = { bind: (...next) => prepare(sql, next), all: () => execute(sql, () => native.all()), run: () => execute(sql, () => native.run()) };
    statements.set(item, { sql, native }); return item;
  }
  return { database: { prepare, batch: items => execute(items.map(item => statements.get(item).sql).join('\n'), () => database.batch(items.map(item => statements.get(item).native))) },
    result: () => ({ lost, laterCalls }) };
}

test('initial native Business stage imports all 40 source tables, rejects restart and independently verifies without report', async () => fixture(async (db, options) => {
  const result = await importInitialBusinessSnapshot(options);
  assert.equal(result.tables.length, 40);
  assert.equal(result.productionReady, false);
  assert.equal(result.fullMigrationReconciled, false);
  assert.equal(result.atomicWholeStore, false);
  assert.equal(result.coordinatorCompleted, false);
  await unlink(options.reportPath);
  await verifyImportedD1Snapshot({ ...options, canonicalBusinessSchema: true });
  await assert.rejects(importInitialBusinessSnapshot(options), /business_initial_target_unconfirmed/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM user_subscriptions').first()).n, 1);
  assert.deepEqual(await db.prepare('SELECT requested_generation, acknowledged_generation FROM notification_worker_wake_state').first(),
    { requested_generation: 1, acknowledged_generation: 0 });
}));

for (const [name, sql] of [
  ['changed seed', 'UPDATE fanmark_access_rate_policy SET max_attempts = 6'],
  ['missing seed', 'DELETE FROM fanmark_access_rate_policy'],
  ['advance sequence', "INSERT INTO sqlite_sequence(name, seq) VALUES ('audit_logs', 50)"],
  ['extra schema', 'CREATE TABLE unreviewed(id TEXT)'],
  ['missing trigger', 'DROP TRIGGER notification_worker_wake_state_monotonic'],
]) test(`initial Business rejects ${name} before ledger creation`, async () => fixture(async (db, options) => {
  await db.prepare(sql).run();
  await assert.rejects(importInitialBusinessSnapshot(options), /business_initial_target_unconfirmed/);
  assert.deepEqual((await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '__fanmark_d1_import_%'").all()).results, []);
}));

test('initial predicate is enforced inside first transaction and rolls back new ledger on a race', async () => fixture(async (db, options) => {
  const guard = await prepareInitialBusinessTarget(db);
  await db.prepare('UPDATE fanmark_access_rate_policy SET max_attempts = 6').run();
  await assert.rejects(db.batch([
    db.prepare('CREATE TABLE __fanmark_d1_import_guards(token TEXT PRIMARY KEY, must_be_one INTEGER CHECK(must_be_one = 1))'), db.prepare(guard),
  ]));
  assert.deepEqual((await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '__fanmark_d1_import_%'").all()).results, []);
}));

test('provider migration sequence is excluded but unknown sequence is refused', async () => fixture(async db => {
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)').run();
  await db.prepare("INSERT INTO d1_migrations(name) VALUES ('synthetic')").run();
  await prepareInitialBusinessTarget(db);
  await db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('unknown', 1)").run();
  await assert.rejects(prepareInitialBusinessTarget(db), /business_initial_target_unconfirmed/);
}));

for (const [name, match] of [
  ['ledger creation', sql => sql.startsWith('CREATE TABLE')],
  ['run insert', sql => sql.startsWith('INSERT INTO "__fanmark_d1_import_runs"')],
  ['checkpoint insert', sql => sql.startsWith('INSERT INTO "__fanmark_d1_import_checkpoints"')],
  ['credential reservation', sql => sql.includes('INSERT INTO "credential_transform_artifacts"')],
  ['credential commit', sql => sql.includes('INSERT INTO "fanmark_password_configs"')],
  ['completion', sql => sql.startsWith('UPDATE "__fanmark_d1_import_runs"') && sql.includes("'public_rows_reconciled'")],
]) test(`lost ${name} ACK stops all subsequent calls and cannot resume`, async () => fixture(async (db, options) => {
  const fault = loseAcknowledgement(db, match);
  await assert.rejects(importInitialBusinessSnapshot({ ...options, database: fault.database }), error => {
    assert.equal(error.message, 'business_stage_partial_or_unknown_import'); assert.equal(error.cause, undefined); return true;
  });
  assert.deepEqual(fault.result(), { lost: true, laterCalls: 0 });
  await assert.rejects(importInitialBusinessSnapshot(options), /business_initial_target_unconfirmed/);
  const runs = await db.prepare("SELECT name FROM sqlite_master WHERE name = '__fanmark_d1_import_runs'").all();
  assert.equal(runs.results.length, 1, 'committed target is retained');
}));

test('short batch ACK poisons further reads and writes', async () => fixture(async db => {
  const fault = loseAcknowledgement(db, () => true, { malformed: true });
  const guarded = createStopOnFailureD1(fault.database);
  await assert.rejects(guarded.batch([guarded.prepare('SELECT 1')]), /attempt_stopped/);
  assert.throws(() => guarded.prepare('SELECT 2'), /attempt_stopped/);
  assert.deepEqual(fault.result(), { lost: true, laterCalls: 0 });
}));

test('existing report, bypass mode and missing profile do not write', async () => fixture(async (db, options) => {
  await writeFile(options.reportPath, '{}\n', { mode: 0o600 });
  await assert.rejects(importInitialBusinessSnapshot(options), /business_stage_partial_or_unknown_import/);
  await assert.rejects(importInitialBusinessSnapshot({ ...options, mode: 'production-stage' }), /transport_invalid/);
  await assert.rejects(importInitialBusinessSnapshot({ ...options, expectedTargetProfile: null }), /profile_required/);
  await assert.rejects(importInitialBusinessSnapshot({ ...options, hooks: {} }), /profile_required/);
  await assert.rejects(importD1Snapshot({ ...options, mode: 'production-stage' }), /unsupported_import_mode/);
  await prepareInitialBusinessTarget(db);
}));

test('production stage uses branded fixed Business transports and journals every native write (synthetic HTTP only)', async () => fixture(async (db, options, directory) => {
  const target = { ...PRODUCTION_D1_TARGETS.find(t => t.databaseName === 'fanmark-production-business'), targetIncarnation: options.targetIncarnation };
  const incarnations = Object.fromEntries(['auth', 'business', 'master', 'avatars', 'covers'].map(name => [name, name === 'business' ? options.targetIncarnation : randomUUID()]));
  let state, writes = 0;
  const coordinator = createProductionImportCoordinator({ owner: randomUUID(), manifestSha256: 'a'.repeat(64), incarnations,
    command: async (action, input) => {
      if (action === 'claim') state = { ...input, acknowledged: 0, pending: null, readbackSha256: null };
      else if (action === 'begin') { assert.equal(state.pending, null); const { operationId, batchSha256, store } = input; state.pending = { operationId, batchSha256, store }; }
      else if (action === 'acknowledge') { assert.equal(input.operationId, state.pending.operationId); state.pending = null; state.acknowledged++; }
      else assert.fail('unexpected coordinator action');
      return structuredClone(state);
    } });
  await coordinator.claim();
  const fetchImpl = async (url, init) => {
    const base = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}`;
    if (init.method === 'GET') { assert.equal(url, base); return Response.json({ success: true, result: { uuid: target.databaseId, name: target.databaseName, created_at: target.createdAt } }); }
    assert.equal(url, base + '/query');
    const { batch } = JSON.parse(init.body);
    if (batch.some(item => !isReadOnlyProductionSql(item.sql))) { writes++; assert.equal(state.pending.store, 'business'); }
    return Response.json({ success: true, result: await db.batch(batch.map(item => db.prepare(item.sql).bind(...item.params))) });
  };
  const common = { target, token: 'synthetic_token_no_network', fetchImpl };
  const writer = await openProductionD1ImportTransport({ ...common, journalPath: join(directory, 'journal.jsonl'), runId: coordinator.owner, coordinator });
  const reader = createProductionRemoteD1(common);
  await assert.rejects(importD1Snapshot({ ...options, database: writer }), /production_import_runner_required/);
  await assert.rejects(importInitialBusinessSnapshot({ ...options, database: writer, readDatabase: writer, mode: 'production-stage' }), /transport_invalid/);
  const result = await importInitialBusinessSnapshot({ ...options, database: writer, readDatabase: reader, destinationId: target.databaseId, mode: 'production-stage' });
  assert.equal(result.productionReady, false);
  assert.ok(writes > 80);
  assert.equal(state.acknowledged, writes);
  assert.equal(state.pending, null);
  assert.equal(state.readbackSha256, null, 'stage cannot complete global coordinator');
  const journal = (await readFile(join(directory, 'journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.length, 1 + writes * 2);
}));

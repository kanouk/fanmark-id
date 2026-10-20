const credentialLease=syntheticProductionCredential('synthetic_token_never_logged');
import {syntheticProductionCredential} from './fixtures/synthetic-production-credential.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, chmod, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { PRODUCTION_D1_TARGETS, createProductionRemoteD1, openProductionD1ImportTransport } from './production-remote-d1.mjs';
import { openProductionImportJournal } from './production-import-journal.mjs';
import { createProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { createIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { importD1Snapshot } from './d1-import.mjs';

const token = 'synthetic_token_never_logged';
const target = { ...PRODUCTION_D1_TARGETS[2], targetIncarnation: randomUUID() };

test('production D1 validates identity and durable write boundaries against native D1', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'fanmark-production-transport-'));
  await chmod(directory, 0o700);
  const mf = new Miniflare({ workers: [{ config: {
    name: 'production-transport-test', type: 'worker', compatibilityDate: '2026-09-20',
    env: { DB: { type: 'd1', name: 'production-transport-test' } },
    manifest: { mainModule: 'index.js', modules: {
      'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("fixture")}}' },
    } },
  } }] });
  try {
    const native = await mf.getD1Database('DB');
    await native.prepare('CREATE TABLE probe(id INTEGER PRIMARY KEY,n INTEGER CHECK(n>=0),label TEXT,exact INTEGER)').run();
    let queries = 0, metadata = 0, loseAck = false, wrongIdentity = false, invalidResult = false;
    let journalPath = null;
    const fetchImpl = async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${token}`);
      const base = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}`;
      if (options.method === 'GET') {
        assert.equal(url, base); metadata++;
        return Response.json({ success: true, result: { uuid: target.databaseId,
          name: wrongIdentity ? 'wrong-target' : target.databaseName, created_at: target.createdAt } });
      }
      assert.equal(url, base + '/query'); queries++;
      const payload = JSON.parse(options.body);
      if (payload.batch.some(row => !row.sql.startsWith('SELECT')) && journalPath) {
        const rows = (await readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.equal(rows.at(-1).type, 'intent', 'intent must exist before sending a write');
        assert.ok(!JSON.stringify(rows).includes('日本語'), 'journal does not contain row data');
      }
      let result;
      try { result = await native.batch(payload.batch.map(item => native.prepare(item.sql).bind(...item.params))); }
      catch { return Response.json({ success: false, errors: [{ message: `private diagnostic ${token}` }] }, { status: 400 }); }
      if (loseAck) { loseAck = false; throw new Error('response lost after commit'); }
      return Response.json({ success: true, result: invalidResult ? [] : result });
    };
    const reader = createProductionRemoteD1({credentialLease, target, token, fetchImpl });
    let currentCoordinator;
    async function writer() {
      journalPath = join(directory, randomUUID() + '.jsonl');
      const runId = randomUUID();
      // Transport unit fixture. The separate coordination suite uses the real
      // production DO + RPC to test cross-process/cross-store exclusion.
      let state;
      currentCoordinator = createProductionImportCoordinator({ owner: runId, manifestSha256: 'a'.repeat(64),
        incarnations: { auth: randomUUID(), master: randomUUID(), business: target.targetIncarnation,
          avatars: randomUUID(), covers: randomUUID() },
        async command(action, input) {
          if (action === 'claim') return state = { ...input, pending: null, acknowledged: 0, readbackSha256: null };
          if (action === 'begin') { if (state.pending) throw Error('pending'); state.pending = {
            operationId: input.operationId, batchSha256: input.batchSha256, store: input.store }; }
          else if (action === 'acknowledge') { state.pending = null; state.acknowledged++; }
          return state;
        } });
      await currentCoordinator.claim();
      return openProductionD1ImportTransport({credentialLease, target, token, fetchImpl, journalPath, runId, coordinator: currentCoordinator });
    }
    await context.test('read-only denies writes, stacked statements and mutating PRAGMAs before network', async () => {
      const before = queries;
      for (const sql of ['DELETE FROM probe', 'SELECT 1; DELETE FROM probe', 'PRAGMA writable_schema=ON', 'PRAGMA foreign_keys=OFF',
        'WITH n AS (SELECT 1) DELETE FROM probe', 'SELECT 1 /* comment */']) {
        await assert.rejects(reader.prepare(sql).all(), error => error.code === 'production_read_only_violation');
      }
      assert.equal(queries, before);
      assert.equal(await reader.prepare('PRAGMA foreign_keys').first('foreign_keys'), 1);
      assert.equal(await reader.prepare('SELECT ? AS label').bind("literal '; DELETE FROM probe'").first('label'), "literal '; DELETE FROM probe'");
      assert.deepEqual((await reader.prepare('PRAGMA foreign_key_check').all()).results, []);
    });
    await context.test('fixed identity, per-batch metadata and separate isolated guard', async () => {
      for (const field of ['accountId','databaseId','databaseName','createdAt']) {
        assert.throws(() => createProductionRemoteD1({credentialLease, target: { ...target, [field]: 'wrong' }, token, fetchImpl }), /production_target_identity_invalid/);
      }
      assert.throws(() => createIsolatedRemoteD1({ target, token, fetchImpl }), /isolated_target_identity_invalid/);
      const before = metadata;
      await reader.prepare('SELECT 1').all(); await reader.prepare('SELECT 1').all();
      assert.equal(metadata, before + 2);
      wrongIdentity = true;
      const beforeQueries = queries;
      await assert.rejects(reader.prepare('SELECT 1').all(), /production_target_identity_mismatch/);
      assert.equal(queries, beforeQueries); wrongIdentity = false;
    });
    await context.test('journal is mandatory and generic importer cannot admit production as local', async () => {
      assert.throws(() => createProductionRemoteD1({credentialLease, target, token, fetchImpl, access: 'import', journal: {
        targetId: target.databaseId, targetIncarnation: target.targetIncarnation, beforeWrite() {}, afterWrite() {},
      } }), /production_import_journal_required/);
      await assert.rejects(importD1Snapshot({ database: reader, allowUnresolvedGates: true }), /production_import_runner_required/);
      const uncoordinated = await openProductionImportJournal({ path: join(directory, 'uncoordinated'), runId: randomUUID(),
        targetId: target.databaseId, targetIncarnation: target.targetIncarnation });
      assert.throws(() => createProductionRemoteD1({credentialLease, target, token, fetchImpl, access: 'import', journal: uncoordinated }),
        /production_import_coordinator_required/);
    });
    await context.test('atomic batch preserves NULL, unicode and exact int64; intent/ACK are durable', async () => {
      const remote = await writer();
      const result = await remote.batch([
        remote.prepare('INSERT INTO probe VALUES(?,?,?,CAST(? AS INTEGER))').bind(1, 2, '日本語', '9223372036854775807'),
        remote.prepare('INSERT INTO probe VALUES(?,?,?,?)').bind(2, 3, null, null),
        remote.prepare('SELECT label,CAST(exact AS TEXT) AS exactText FROM probe ORDER BY id'),
      ]);
      assert.deepEqual(result[2].results, [{ label: '日本語', exactText: '9223372036854775807' }, { label: null, exactText: null }]);
      const rows = (await readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(rows.map(row => row.type), ['identity','intent','acknowledged']);
      assert.equal(rows[1].operationId, rows[2].operationId);
    });
    await context.test('CHECK failure rolls back whole batch; no provider diagnostics or retry', async () => {
      const remote = await writer(), before = queries;
      await assert.rejects(remote.batch([
        remote.prepare('INSERT INTO probe(id,n) VALUES(?,?)').bind(3, 3),
        remote.prepare('INSERT INTO probe(id,n) VALUES(?,?)').bind(4, -1),
      ]), error => error.code === 'remote_api_request_failed' && !error.message.includes(token));
      assert.equal(queries, before + 1);
      assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM probe WHERE id IN (3,4)').first('n'), 0);
    });
    await context.test('lost ACK leaves one committed row and blocks another write across reopen', async () => {
      const remote = await writer(), savedPath = journalPath;
      const identity = JSON.parse((await readFile(savedPath, 'utf8')).split('\n')[0]);
      const before = queries; loseAck = true;
      await assert.rejects(remote.prepare('INSERT INTO probe(id,n) VALUES(5,5)').run(), /remote_request_acknowledgement_unknown/);
      assert.equal(queries, before + 1);
      assert.equal(await reader.prepare('SELECT COUNT(*) AS n FROM probe WHERE id=5').first('n'), 1);
      const reopened = await openProductionD1ImportTransport({credentialLease, target, token, fetchImpl, journalPath: savedPath, runId: identity.runId,
        coordinator: currentCoordinator });
      const afterRead = queries;
      await assert.rejects(reopened.prepare('INSERT INTO probe(id,n) VALUES(6,6)').run());
      assert.equal(queries, afterRead);
      assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM probe WHERE id=6').first('n'), 0);
    });
    await context.test('missing result after commit does not acknowledge the journal', async () => {
      const remote = await writer(); invalidResult = true;
      await assert.rejects(remote.prepare('INSERT INTO probe(id,n) VALUES(7,7)').run(), /remote_query_result_invalid/);
      invalidResult = false;
      assert.equal(JSON.parse((await readFile(journalPath, 'utf8')).trim().split('\n').at(-1)).type, 'intent');
      assert.equal(await native.prepare('SELECT COUNT(*) AS n FROM probe WHERE id=7').first('n'), 1);
    });
    await context.test('foreign statements are rejected', async () => {
      const remote = await writer(), before = queries;
      await assert.rejects(remote.batch([reader.prepare('SELECT 1')]), /remote_batch_statement_target_mismatch/);
      assert.equal(queries, before);
    });
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('journal rejects changed identity, partial files, public permissions and symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanmark-journal-test-'));
  await chmod(directory, 0o700);
  const options = { path: join(directory, 'journal'), runId: randomUUID(), targetId: target.databaseId, targetIncarnation: randomUUID() };
  try {
    await openProductionImportJournal(options);
    await assert.rejects(openProductionImportJournal({ ...options, runId: randomUUID() }), /identity_mismatch/);
    await writeFile(options.path, '{"partial":');
    await assert.rejects(openProductionImportJournal(options), /incomplete/);
    await chmod(options.path, 0o644);
    await assert.rejects(openProductionImportJournal(options), /not_private/);
    await symlink(options.path, join(directory, 'link'));
    await assert.rejects(openProductionImportJournal({ ...options, path: join(directory, 'link') }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

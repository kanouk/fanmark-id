import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIsolatedRemoteD1, assertIsolatedRemoteD1Target } from './isolated-remote-d1.mjs';
import { importD1Snapshot } from './d1-import.mjs';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';

const target = {
  accountId: 'bfc2890741f0b3fb236e2d755b6c9adc',
  databaseId: '91111111-1111-4111-8111-111111111111',
  databaseName: 'fanmark-recovery-synthetic-transport-business',
  createdAt: '2026-10-03T00:00:00.000Z',
  targetIncarnation: '92222222-2222-4222-8222-222222222222',
};
const token = 'synthetic_token_never_logged';

test('isolated remote D1 preserves prepared values, atomic batches and unknown-ACK boundaries', async context => {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'synthetic-remote-transport', type: 'worker', compatibilityDate: '2026-09-20',
    env: { DB: { type: 'd1', name: 'synthetic-remote-transport' } },
    manifest: { mainModule: 'index.js', modules: {
      'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("fixture")}}' },
    } },
  } }] });
  try {
    const native = await mf.getD1Database('DB');
    await native.prepare('CREATE TABLE probe(id INTEGER PRIMARY KEY, n INTEGER CHECK(n>=0), label TEXT, exact INTEGER)').run();
    let queryCalls = 0;
    let metadataCalls = 0;
    let loseNextAck = false;
    let invalidResult = false;
    const fetchImpl = async (url, options) => {
      assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/d1/database/${target.databaseId}`));
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      if (options.method === 'GET') {
        metadataCalls += 1;
        return Response.json({ success: true, result: { uuid: target.databaseId, name: target.databaseName, created_at: target.createdAt } });
      }
      queryCalls += 1;
      const payload = JSON.parse(options.body);
      assert.ok(Array.isArray(payload.batch));
      try {
        const result = await native.batch(payload.batch.map(item => native.prepare(item.sql).bind(...item.params)));
        if (loseNextAck) { loseNextAck = false; throw new TypeError('synthetic response lost after commit'); }
        return Response.json({ success: true, result: invalidResult ? [] : result });
      } catch (error) {
        if (error instanceof TypeError) throw error;
        return Response.json({ success: false, errors: [{ message: `private SQL diagnostics ${token}` }] }, { status: 400 });
      }
    };
    const remote = createIsolatedRemoteD1({ target, token, fetchImpl });

    await context.test('one native transaction retains unicode, NULL and int64 decimal binding/readback', async () => {
      const rows = await remote.batch([
        remote.prepare('INSERT INTO probe VALUES(?, ?, ?, CAST(? AS INTEGER))').bind(1, 2, "日本語 ' literal", '9223372036854775807'),
        remote.prepare('INSERT INTO probe VALUES(?, ?, ?, ?)').bind(2, 3, null, null),
        remote.prepare('SELECT id,label,CAST(exact AS TEXT) AS exactText,typeof(exact) AS exactType FROM probe ORDER BY id'),
      ]);
      assert.deepEqual(rows[2].results, [
        { id: 1, label: "日本語 ' literal", exactText: '9223372036854775807', exactType: 'integer' },
        { id: 2, label: null, exactText: null, exactType: 'null' },
      ]);
      assert.equal(await remote.prepare('SELECT label FROM probe WHERE id=?').bind(1).first('label'), "日本語 ' literal");
      assert.equal(metadataCalls, 1);
    });
    await context.test('a later CHECK failure rolls back the earlier insert; diagnostics stay private', async () => {
      await assert.rejects(remote.batch([
        remote.prepare('INSERT INTO probe(id,n) VALUES(?,?)').bind(3, 3),
        remote.prepare('INSERT INTO probe(id,n) VALUES(?,?)').bind(4, -1),
      ]), error => error.code === 'remote_api_request_failed' && !error.message.includes(token));
      assert.equal(await native.prepare('SELECT COUNT(*) AS count FROM probe WHERE id IN (3,4)').first('count'), 0);
    });
    await context.test('a response lost after commit is not automatically retried', async () => {
      const before = queryCalls;
      loseNextAck = true;
      await assert.rejects(remote.prepare('INSERT INTO probe(id,n) VALUES(?,?)').bind(5, 5).run(),
        error => error.code === 'remote_request_acknowledgement_unknown');
      assert.equal(queryCalls, before + 1);
      assert.equal(await native.prepare('SELECT COUNT(*) AS count FROM probe WHERE id=5').first('count'), 1);
    });
    await context.test('statements from a different target cannot enter the batch', async () => {
      const other = createIsolatedRemoteD1({ target: { ...target, databaseId: '93333333-3333-4333-8333-333333333333' }, token, fetchImpl });
      const before = queryCalls;
      await assert.rejects(remote.batch([other.prepare('DELETE FROM probe')]),
        error => error.code === 'remote_batch_statement_target_mismatch');
      assert.equal(queryCalls, before);
    });
    await context.test('target name/creation receipt mismatch and wrong incarnation refuse before SQL', async () => {
      const wrong = createIsolatedRemoteD1({ target: { ...target, createdAt: '2026-10-02T00:00:00.000Z' }, token, fetchImpl });
      const before = queryCalls;
      await assert.rejects(wrong.prepare('DELETE FROM probe').run(), error => error.code === 'isolated_target_identity_mismatch');
      await assert.rejects(assertIsolatedRemoteD1Target(remote, '94444444-4444-4444-8444-444444444444'),
        error => error.code === 'isolated_remote_binding_required');
      assert.equal(queryCalls, before);
      assert.throws(() => createIsolatedRemoteD1({ target: { ...target, databaseName: 'fanmark-business-staging' }, token, fetchImpl }),
        error => error.code === 'isolated_target_identity_invalid');
    });
    await context.test('importer requires explicit remote mode, canonical profile, resolver and recognized binding', async () => {
      const before = queryCalls;
      await assert.rejects(importD1Snapshot({ database: remote }), error => error.code === 'remote_binding_requires_remote_mode');
      await assert.rejects(importD1Snapshot({ database: remote, mode: 'isolated-remote' }),
        error => error.code === 'isolated_remote_runtime_profile_required');
      await assert.rejects(importD1Snapshot({ database: native, mode: 'isolated-remote', canonicalBusinessSchema: true,
        expectedTargetProfile: {}, resolveAuthUserIds: async () => [], targetIncarnation: target.targetIncarnation }),
        error => error.code === 'isolated_remote_binding_required');
      assert.equal(queryCalls, before);
    });
    await context.test('unsupported values and overlarge batches refuse before sending', async () => {
      const before = queryCalls;
      assert.throws(() => remote.prepare('SELECT ?').bind(Number.NaN), error => error.code === 'remote_binding_value_invalid');
      assert.throws(() => remote.prepare('SELECT ?').bind(new Uint8Array([1])), error => error.code === 'remote_binding_value_invalid');
      await assert.rejects(remote.batch(Array.from({ length: 101 }, () => remote.prepare('SELECT 1'))),
        error => error.code === 'remote_batch_size_invalid');
      assert.equal(queryCalls, before);
    });
    await context.test('missing query results are refused rather than treated as a committed batch', async () => {
      invalidResult = true;
      await assert.rejects(remote.prepare('SELECT 1').all(), error => error.code === 'remote_query_result_invalid');
    });
  } finally { await mf.dispose(); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { prepareD1RestTriggerDefinition } from './d1-rest-trigger-sql.mjs';

test('trigger preparation changes only the unquoted BEGIN body keyword', () => {
  for (const identifier of ['"begin"', '`begin`', '[begin]']) {
    const sql = `-- begin;\n/* begin end */\ncreate trigger ${identifier} after insert on probe
      when new.label <> 'it''s begin' begin
      insert into log(label) values ('begin end;');
      update probe set label=CASE WHEN label='begin' THEN 'end' ELSE label END;
      end; -- begin`;
    const expected = sql.replace("'it''s begin' begin", "'it''s begin' BEGIN");
    assert.equal(prepareD1RestTriggerDefinition(sql), expected);
    assert.equal(prepareD1RestTriggerDefinition(expected), expected);
  }
});

test('unsupported or ambiguous input refuses without being rewritten', () => {
  for (const sql of [null, '', 'SELECT 1', 'BEGIN; SELECT 1; END;',
    'CREATE TRIGGER x AFTER INSERT ON probe begin SELECT 1; end; SELECT 2;',
    'CREATE TRIGGER x AFTER INSERT ON probe begin SELECT "unterminated; end',
    'CREATE TRIGGER x AFTER INSERT ON probe /* unclosed begin',
    'CREATE TRIGGER x AFTER INSERT ON probe WHEN new.begin=1 begin SELECT 1; end']) {
    assert.throws(() => prepareD1RestTriggerDefinition(sql),
      error => error.message === 'remote_trigger_definition_unsupported');
  }
});

test('native SQLite trigger effects and literal bytes survive REST preparation', async () => {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'trigger-rest-preparation', type: 'worker', compatibilityDate: '2026-09-20',
    env: { SOURCE: { type: 'd1', name: 'source' }, TARGET: { type: 'd1', name: 'target' } },
    manifest: { mainModule: 'index.js', modules: {
      'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("fixture")}}' },
    } },
  } }] });
  try {
    const source = await mf.getD1Database('SOURCE');
    const target = await mf.getD1Database('TARGET');
    const trigger = `CREATE TRIGGER "begin" AFTER INSERT ON probe
      /* begin must remain in this comment */ begin
      INSERT INTO log(label) VALUES(CASE WHEN new.label='begin' THEN 'it''s begin; end' ELSE new.label END);
      end`;
    for (const db of [source, target]) {
      await db.batch([
        db.prepare('CREATE TABLE probe(label TEXT)'), db.prepare('CREATE TABLE log(label TEXT)'),
        db.prepare(db === source ? trigger : prepareD1RestTriggerDefinition(trigger)),
      ]);
      await db.prepare('INSERT INTO probe(label) VALUES(?)').bind('begin').run();
    }
    assert.deepEqual((await source.prepare('SELECT * FROM log').all()).results,
      [{ label: "it's begin; end" }]);
    assert.deepEqual((await target.prepare('SELECT * FROM log').all()).results,
      (await source.prepare('SELECT * FROM log').all()).results);
    assert.equal(await target.prepare("SELECT sql FROM sqlite_master WHERE type='trigger'").first('sql'),
      prepareD1RestTriggerDefinition(trigger));
    assert.deepEqual((await source.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.deepEqual((await target.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});

import { expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { convertPgText as convert } from '../../../scripts/migration/value-conversion.mjs';

it('D1 bindings and reads preserve converted values without millisecond or money rounding', async () => {
  await env.DB.prepare(`CREATE TABLE codec_roundtrip (
    id TEXT PRIMARY KEY, amount INTEGER, counter INTEGER, probability TEXT,
    observed_at TEXT, array_value TEXT, json_value TEXT, nullable_value TEXT
  )`).run();
  const timestamp='2026-09-21T00:00:00.123456Z';
  const probability='0.12345678901234567890123456789';
  const json='{"p":0.12345678901234567890123456789,"label":"x"}';
  const arrays='["a",null,"","a"]';
  await env.DB.prepare('INSERT INTO codec_roundtrip VALUES (?,?,?,?,?,?,?,?)').bind(
    'before',convert('numeric(10,2)','99999999.99'),convert('bigint','9007199254740991'),
    convert('numeric',probability),convert('timestamp with time zone',timestamp),
    convert('text[]',arrays),convert('jsonb',json),convert('text',null)
  ).run();
  await env.DB.prepare('INSERT INTO codec_roundtrip(id,observed_at) VALUES (?,?)').bind(
    'after',convert('timestamp with time zone','2026-09-21T00:00:00.123457Z')
  ).run();
  const row=await env.DB.prepare('SELECT * FROM codec_roundtrip WHERE id=?').bind('before').first();
  expect(row).toEqual({id:'before',amount:9999999999,counter:9007199254740991,
    probability,observed_at:timestamp,array_value:arrays,json_value:json,nullable_value:null});
  const ordered=await env.DB.prepare('SELECT id FROM codec_roundtrip ORDER BY observed_at DESC').all();
  expect(ordered.results.map(r=>r.id)).toEqual(['after','before']);
  const storage=await env.DB.prepare('SELECT typeof(amount) money_type, typeof(counter) counter_type, typeof(probability) probability_type FROM codec_roundtrip WHERE id=?').bind('before').first();
  expect(storage).toEqual({money_type:'integer',counter_type:'integer',probability_type:'text'});
});

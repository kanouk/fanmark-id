import assert from 'node:assert/strict';
import {test} from 'node:test';
import {convertPgText as convert,utcMicroseconds,moneyCents} from './value-conversion.mjs';

test('money uses exact cents and rejects rounding or non-text input',()=>{
 for(const [text,cents] of [['0',0],['0.01',1],['12.30',1230],['-0.29',-29],['99999999.99',9999999999]])assert.equal(moneyCents(text),cents);
 for(const input of ['0.001','100000000','NaN','Infinity','1e2',0.29])assert.throws(()=>moneyCents(input));
});
test('timestamps preserve all microseconds and reject invalid/unconverted calendar representations',()=>{
 for(const value of ['2026-09-21T00:00:00.123456Z','0001-01-01T00:00:00.000001Z','2024-02-29T23:59:59.999999Z','9999-12-31T23:59:59.999999Z'])assert.equal(utcMicroseconds(value),value);
 for(const value of ['2025-02-29T00:00:00.000000Z','2026-09-21T24:00:00.000000Z','0000-01-01T00:00:00.000000Z','2026-09-21T00:00:00.123Z','2026-09-21T00:00:00.123456+00:00','infinity'])assert.throws(()=>utcMicroseconds(value));
 assert.equal(convert('date','2024-02-29'),'2024-02-29');
 assert.throws(()=>convert('date','2025-02-29'));
});
test('integer boundaries fail rather than rounding source values',()=>{
 assert.equal(convert('bigint','9007199254740991'),Number.MAX_SAFE_INTEGER);
 assert.equal(convert('bigint','-9007199254740991'),Number.MIN_SAFE_INTEGER);
 for(const value of ['9007199254740992','9223372036854775807','1.5','1e3'])assert.throws(()=>convert('bigint',value));
 assert.throws(()=>convert('integer','2147483648'));
 assert.throws(()=>convert('smallint','32768'));
 assert.throws(()=>convert('bigint',9007199254740992));
});
test('arrays retain order duplicates NULL and empty elements, and reject nested arrays',()=>{
 assert.equal(convert('text[]','["a",null,"","a"]'),'["a",null,"","a"]');
 assert.equal(convert('smallint[]','[1,null,-32768,32767,1]'),'[1,null,-32768,32767,1]');
 assert.equal(convert('uuid[]','["AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",null]'),'["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",null]');
 assert.equal(convert('text[]','[]'),'[]');
 for(const value of ['[["a"]]','{"a":1}','[1]'])assert.throws(()=>convert('text[]',value));
 assert.throws(()=>convert('smallint[]','[32768]'));
});
test('SQL NULL, text, JSON null, and exact decimal strings stay distinct',()=>{
 assert.equal(convert('text',null),null);
 assert.equal(convert('text','null'),'null');
 assert.equal(convert('text',''),'');
 assert.equal(convert('jsonb','null'),'null');
 const json='{"p":0.12345678901234567890123456789,"a":null}';
 assert.equal(convert('jsonb',json),json);
 assert.equal(convert('numeric','0.12345678901234567890123456789'),'0.12345678901234567890123456789');
 for(const text of ['{"n":9007199254740993}','{"n":1e999}','{'])assert.throws(()=>convert('jsonb',text));
 assert.throws(()=>convert('numeric','NaN'));
 assert.throws(()=>convert('unknown','1'));
 assert.throws(()=>convert('unknown',null));
 assert.equal(convert('boolean','t'),1);
 assert.equal(convert('boolean','f'),0);
});

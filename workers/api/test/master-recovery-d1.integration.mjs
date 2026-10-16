import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { checkedInSqlStatements } from './schema-statements.ts';
import { MASTER_RECOVERY_TABLES, MASTER_RECOVERY_SCHEMA_SQL, masterRecoveryDigest,
  captureMasterRecoverySnapshot as capture, sealMasterRecoverySnapshot as seal,
  openMasterRecoverySnapshot as open, restoreMasterRecoverySnapshot as restore } from '../src/master-d1-recovery.ts';
const migrations = ['0000_emoji_master.sql','0001_emoji_master_release_staging.sql','0002_emoji_master_release_activation.sql',
  '0003_better_auth_core.sql','0004_reference_master_releases.sql','0005_emoji_master_admin_guards.sql',
  '0006_reference_master_extension_prices.sql','0007_release_audit_timestamps.sql','0008_emoji_master_change_audits.sql'];
const canonical = tables => Object.fromEntries(MASTER_RECOVERY_TABLES.map(name => [name,tables[name].map(row =>
  Object.fromEntries(Object.keys(row).sort().map(key => [key,row[key]]))).sort((a,b) => {
    const left=JSON.stringify(a),right=JSON.stringify(b); return left<right?-1:left>right?1:0;
  })]));
const changed = async (snapshot, change) => {const copy=structuredClone(snapshot);change(copy);
  copy.rowsHash=await masterRecoveryDigest(canonical(copy.tables));return copy;};
const schema = async db => (await db.prepare(MASTER_RECOVERY_SCHEMA_SQL).all()).results;
function wrapped(db, batch) {return new Proxy(db,{get(database,property){
  if(property==='batch')return batch;
  const value=Reflect.get(database,property);return typeof value==='function'?value.bind(database):value;
}});}

test('Master recovery on native local D1', {timeout:90_000}, async t => {
  const mf=new Miniflare({workers:[{config:{name:'master-recovery-local',type:'worker',compatibilityDate:'2026-09-18',
    env:Object.fromEntries(['SOURCE','TARGET','FAILED','ACK'].map(name=>[name,{type:'d1',name:'master-recovery-'+name}])),
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("local-only")}}'}}}
  }}]});
  try {
    const source=await mf.getD1Database('SOURCE'),target=await mf.getD1Database('TARGET');
    const failed=await mf.getD1Database('FAILED'),ack=await mf.getD1Database('ACK');
    for(const name of migrations) await source.batch(checkedInSqlStatements(
      await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).map(sql=>source.prepare(sql)));
    await source.batch([
      source.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'),
      ...migrations.map((name,i)=>source.prepare('INSERT INTO d1_migrations (id,name,applied_at) VALUES (?,?,?)')
        .bind(i+1,name,'2026-10-07 00:00:00')),
      source.prepare('UPDATE mfaGeneration SET generation=13 WHERE id=1'),
    ]);
    // More than 1,000 rows: restore must chunk below the D1 query budget.
    for(let offset=0;offset<1001;offset+=100) await source.batch(Array.from({length:Math.min(100,1001-offset)},(_,index)=>{
      const id=offset+index;
      return source.prepare('INSERT INTO emoji_master (id,emoji,short_name,keywords,category,codepoints,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind('synthetic-'+id,'🧪'+id,'日本語\n"literal $& '+id,'["香り","test"]',null,'["1F9EA"]',id,
          '2026-10-07T00:00:00.000000Z','2026-10-07T00:00:00.000000Z');
    }));
    const version='a'.repeat(64),inactive='b'.repeat(64);
    await source.batch([
      source.prepare('INSERT INTO fanmark_emoji_master_release_imports (release_version,manifest_json,row_count,status) VALUES (?,\'{}\',1001,\'loading\')').bind(version),
      source.prepare('INSERT INTO fanmark_emoji_master_release_staging (release_version,ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order) SELECT ?,sort_order+1,id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order FROM emoji_master').bind(version),
      source.prepare('UPDATE fanmark_emoji_master_release_imports SET status=\'ready\' WHERE release_version=?').bind(version),
      source.prepare('INSERT INTO fanmark_emoji_master_active_release (singleton_id,release_version,activation_id,action,generation) VALUES (1,?,\'synthetic-activation\',\'promotion\',1)').bind(version),
      source.prepare('INSERT INTO fanmark_emoji_master_release_imports (release_version,manifest_json,row_count,status) VALUES (?,\'{}\',1,\'loading\')').bind(inactive),
      source.prepare('INSERT INTO fanmark_emoji_master_release_staging (release_version,ordinal,id,emoji,short_name,keywords_json,codepoints_json) VALUES (?,1,\'inactive\',\'🧴\',\'inactive\',\'[]\',\'["1F9F4"]\')').bind(inactive),
      source.prepare('UPDATE fanmark_emoji_master_release_imports SET status=\'ready\' WHERE release_version=?').bind(inactive),
    ]);
    // Trusted migration schema pinned before reading any archive metadata.
    const trustedHash=await masterRecoveryDigest(await schema(source)),snapshot=await capture(source,trustedHash);
    assert.equal(snapshot.schema.length,98);assert.equal(Object.keys(snapshot.tables).length,25);
    assert.equal(snapshot.tables.emoji_master.length,1001);
    assert.equal(snapshot.tables.fanmark_emoji_master_change_audits.length,1001);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const archive=await seal(snapshot,key,trustedHash),reopened=await open(JSON.parse(JSON.stringify(archive)),key,trustedHash);
    assert.deepEqual(reopened,snapshot);assert.ok(!JSON.stringify(archive).includes('synthetic-activation'));
    await t.test('reject wrong keys, tamper and malformed archive',async()=>{
      const wrong=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      const weak=await crypto.subtle.generateKey({name:'AES-GCM',length:128},false,['encrypt','decrypt']);
      await assert.rejects(seal(snapshot,weak,trustedHash),/archive_key_invalid/);
      await assert.rejects(open(archive,wrong,trustedHash),/decryption_failed/);
      const bytes=Buffer.from(archive.ciphertext,'base64');bytes[10]^=1;
      await assert.rejects(open({...archive,ciphertext:bytes.toString('base64')},key,trustedHash),/decryption_failed/);
      await assert.rejects(open({...archive,rowsHash:'c'.repeat(64)},key,trustedHash),/decryption_failed/);
      await assert.rejects(open(archive,key,'d'.repeat(64)),/schema_mismatch/);
      await assert.rejects(open({...archive,nonce:'!'},key,trustedHash),/archive_invalid/);
      await assert.rejects(open({...archive,nonce:archive.nonce.slice(0,-1)},key,trustedHash),/archive_invalid/);
    });
    await t.test('reject malformed rows, legacy credentials and schema before writes',async()=>{
      const malformed=structuredClone(snapshot);malformed.tables.emoji_master[0].keywords=true;
      await assert.rejects(restore(target,malformed,trustedHash),/snapshot_invalid/);
      const legacy=await changed(snapshot,s=>s.tables.user.push({id:'synthetic'}));
      await assert.rejects(restore(target,legacy,trustedHash),/legacy_auth_not_empty/);
      const wrongSchema=structuredClone(snapshot);wrongSchema.schema[0].sql+=' ';
      await assert.rejects(restore(target,wrongSchema,trustedHash),/schema_mismatch/);
      const partial=structuredClone(snapshot);delete partial.tables.d1_migrations;
      await assert.rejects(restore(target,partial,trustedHash),/snapshot_invalid/);
      const oversizedRow=await changed(snapshot,s=>s.tables.emoji_master[0].short_name='香'.repeat(180_000));
      await assert.rejects(restore(target,oversizedRow,trustedHash),/row_too_large/);
      assert.deepEqual(await schema(target),[]);
    });
    await t.test('refuse oversized Unicode archive before encryption',async()=>{
      const large=await changed(snapshot,s=>s.tables.emoji_master[0].short_name='香'.repeat(12_000_000));
      await assert.rejects(seal(large,key,trustedHash),/archive_too_large/);
    });
    await t.test('bad columns/deferred FK roll back native batch including DDL',async()=>{
      const invalid=await changed(snapshot,s=>s.tables.emoji_master.forEach(row=>row.no_such_column='invalid'));
      await assert.rejects(restore(failed,invalid,trustedHash),/restore_failed/);assert.deepEqual(await schema(failed),[]);
      const badFk=await changed(snapshot,s=>s.tables.fanmark_emoji_master_release_staging[0].release_version='e'.repeat(64));
      await assert.rejects(restore(failed,badFk,trustedHash),/restore_failed/);assert.deepEqual(await schema(failed),[]);
    });
    await t.test('exact restore preserves inactive releases/history and functional guards',async()=>{
      const batchSizes=[];
      const measured=wrapped(target,async statements=>{batchSizes.push(statements.length);return target.batch(statements);});
      assert.deepEqual(await restore(measured,reopened,trustedHash),snapshot);assert.ok(batchSizes[0]<200 && batchSizes[0]>98);assert.equal(batchSizes[1],28);
      await assert.rejects(restore(target,reopened,trustedHash),/target_not_empty/);
      assert.deepEqual(await capture(target,trustedHash),snapshot);
      assert.equal(await target.prepare('SELECT generation FROM mfaGeneration WHERE id=1').first('generation'),13);
      await assert.rejects(target.prepare('DELETE FROM fanmark_emoji_master_release_staging WHERE release_version=?').bind(inactive).run(),/immutable/);
      await assert.rejects(target.prepare('UPDATE emoji_master SET emoji=\'changed\' WHERE id=\'synthetic-0\'').run(),/immutable/);
      await target.prepare('UPDATE emoji_master SET short_name=\'new label\' WHERE id=\'synthetic-0\'').run();
      assert.equal(await target.prepare('SELECT count(*) AS n FROM fanmark_emoji_master_change_audits').first('n'),1002);
    });
    await t.test('nonempty ledger and uncertain commit never trigger a wipe/replay',async()=>{
      await ack.prepare('CREATE TABLE d1_migrations (name TEXT)').run();
      await assert.rejects(restore(ack,reopened,trustedHash),/target_not_empty/);assert.equal((await schema(ack)).length,1);
      await ack.prepare('DROP TABLE d1_migrations').run();let commits=0;
      const lost=wrapped(ack,async statements=>{await ack.batch(statements);commits++;throw new Error('synthetic lost acknowledgement');});
      await assert.rejects(restore(lost,reopened,trustedHash),/restore_failed/);
      assert.equal(commits,1);assert.deepEqual(await capture(ack,trustedHash),snapshot);
      await assert.rejects(restore(ack,reopened,trustedHash),/target_not_empty/);
      assert.deepEqual(await capture(ack,trustedHash),snapshot);
    });
    assert.deepEqual(await capture(source,trustedHash),snapshot);
    console.info(JSON.stringify({proof:'master-recovery-shared-native-d1',tables:25,schemaObjects:98,
      syntheticEmojiRows:1001,historyAndLedgerExact:true,atomicRollback:true,uncertainCommitPreserved:true,
      inactiveReleaseGuardsPreserved:true,archiveRoundTrip:true,remoteWrites:0}));
  }finally{await mf.dispose();}
});

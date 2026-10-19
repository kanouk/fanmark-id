import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {applyBusinessRuntimeMigrations} from './business-runtime-import-schema.mjs';
import {prepareStripeReceiptTransfer,sealStripeReceiptExport,openStripeReceiptExport,importStripeReceiptTransfer,verifyStripeReceiptTransfer} from './stripe-receipt-transfer.mjs';
import {syntheticStripeReceiptExport} from './test-stripe-receipt-transfer-fixture.mjs';

test('receipt projection rejects altered identities, incomplete dispatches, payloads and processed effects',async()=>{
 const source=await syntheticStripeReceiptExport(randomUUID());
 const changes=[s=>{s.runId=randomUUID();},s=>{s.foundationSha256='b'.repeat(64);},s=>{s.receiptCount++;},s=>{s.deliveryCount++;},
  s=>{s.receipts.push(s.receipts[0]);s.receiptCount++;},s=>{s.dispatches.pop();},s=>{s.dispatches[0].receipt_id=randomUUID();},
  s=>{s.receipts[0].normalized_payload.event.id='evt_changed';},s=>{s.receipts[0].first_received_at='2026-02-30T00:00:00.123456Z';},
  s=>{s.receipts[0].status='applied';},s=>{s.receipts[0].delivery_count=2147483648;s.deliveryCount=2147483650;},
  s=>{s.dispatches[0].attempt_count=1;},s=>{s.dispatches[0].completed_at=s.sealedAt;}];
 for(const change of changes){const changed=structuredClone(source);change(changed);await assert.rejects(prepareStripeReceiptTransfer(changed,{runId:source.runId}),/stripe_receipt_transfer_/);}
 const p=await prepareStripeReceiptTransfer(source,{runId:source.runId});
 assert.equal(p.tables.stripe_webhook_receipts[0].first_received_at,'2026-10-19T00:00:00.123456Z');
 assert.equal(p.tables.stripe_webhook_dispatches[0].claim_generation,0);assert.equal(p.tables.stripe_webhook_dispatches[0].lease_until,null);
});

test('encrypted receipt stream authenticates run, all content and key without a plaintext envelope',async()=>{
 const source=await syntheticStripeReceiptExport(randomUUID()),key=randomBytes(32),archive=await sealStripeReceiptExport(source,key);
 assert.doesNotMatch(JSON.stringify(archive),/evt_transfer|cs_transfer|normalized_payload/);
 assert.deepEqual(await openStripeReceiptExport(archive,key,{runId:source.runId}),source);
 for(const [candidate,k,runId] of [[{...archive,sourceSha256:'b'.repeat(64)},key,source.runId],
  [{...archive,runId:randomUUID()},key,source.runId],[archive,randomBytes(32),source.runId],
  [{...archive,ciphertext:(archive.ciphertext[0]==='A'?'B':'A')+archive.ciphertext.slice(1)},key,source.runId],[archive,key,randomUUID()]]){
  await assert.rejects(openStripeReceiptExport(candidate,k,{runId}),/archive_invalid/);
 }
});

test('native D1 receipt transfer covers bounded batches, drift, competing writers and uncertain writes',{timeout:120000},async t=>{
 const mf=new Miniflare({workers:[{config:{name:'receipt-transfer',type:'worker',compatibilityDate:'2026-09-18',
  env:{DB:{type:'d1',name:'receipt-transfer'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}}}}]});
 try {
  const db=await mf.getD1Database('DB');await applyBusinessRuntimeMigrations(db);
  const source=await syntheticStripeReceiptExport(randomUUID(),85),args={source,database:db,readDatabase:db,runId:source.runId};
  const count=async table=>(await db.prepare(`SELECT count(*) AS n FROM "${table}"`).all()).results[0].n;
  const clear=async()=>{await db.prepare('DELETE FROM stripe_webhook_dispatches').run();await db.prepare('DELETE FROM stripe_webhook_receipts').run();};
  await t.test('all 85 pairs and exact microseconds survive multiple batches; replay and content drift are rejected',async()=>{
   const report=await importStripeReceiptTransfer(args);assert.equal(report.receiptCount,85);assert.equal(report.atomicWholeStream,false);assert.equal(report.writeBatches,3);
   assert.equal(await count('stripe_webhook_receipts'),85);assert.equal(await count('stripe_webhook_dispatches'),85);assert.equal(await count('fanmark_licenses'),0);
   assert.equal((await verifyStripeReceiptTransfer({...args,database:db})).contentSha256,report.contentSha256);
   await assert.rejects(importStripeReceiptTransfer(args),/target_not_empty/);
   const id=source.receipts[0].id;await db.prepare('UPDATE stripe_webhook_receipts SET delivery_count=99 WHERE id=?').bind(id).run();
   await assert.rejects(verifyStripeReceiptTransfer(args),/content_mismatch/);await clear();
  });
  await t.test('receipt-table trigger is rejected before any import or business effect',async()=>{
   await db.prepare('CREATE TRIGGER unexpected_receipt_effect AFTER INSERT ON stripe_webhook_receipts BEGIN DELETE FROM stripe_webhook_dispatches; END').run();
   await assert.rejects(importStripeReceiptTransfer(args),/schema_changed/);assert.equal(await count('stripe_webhook_receipts'),0);
   await db.prepare('DROP TRIGGER unexpected_receipt_effect').run();
  });
  await t.test('committed response loss stops later batches and retains the committed prefix',async()=>{
   let writes=0;
   const writer={prepare:sql=>db.prepare(sql),batch:async statements=>{const result=await db.batch(statements);if(++writes===2)throw Error('synthetic lost acknowledgement');return result;}};
   await assert.rejects(importStripeReceiptTransfer({...args,database:writer}),/write_acknowledgement_unknown/);
   assert.equal(writes,2);assert.equal(await count('stripe_webhook_receipts'),80);assert.equal(await count('stripe_webhook_dispatches'),80);
   await assert.rejects(verifyStripeReceiptTransfer(args),/content_mismatch/);
   await assert.rejects(importStripeReceiptTransfer({...args,database:writer}),/target_not_empty/);assert.equal(writes,2);await clear();
  });
  await t.test('a competing insert after preflight fails the atomic guard and is never deleted',async()=>{
   const row=(await prepareStripeReceiptTransfer(source,{runId:source.runId})).tables.stripe_webhook_receipts[0];
   const keys=Object.keys(row);let writes=0;
   const writer={prepare:sql=>db.prepare(sql),batch:async statements=>{
    writes++;await db.prepare(`INSERT INTO stripe_webhook_receipts (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>row[k])).run();return db.batch(statements);
   }};
   await assert.rejects(importStripeReceiptTransfer({...args,database:writer}),/write_acknowledgement_unknown/);
   assert.equal(writes,1);assert.equal(await count('stripe_webhook_receipts'),1);assert.equal(await count('stripe_webhook_dispatches'),0);await clear();
  });
  await t.test('an explicitly sealed empty stream is verified without writes',async()=>{
   const empty=await syntheticStripeReceiptExport(randomUUID(),0);let writes=0;
   const writer={prepare:sql=>db.prepare(sql),batch:()=>{writes++;throw Error('unexpected write');}};
   const result=await importStripeReceiptTransfer({source:empty,database:writer,readDatabase:db,runId:empty.runId});
   assert.equal(writes,0);assert.equal(result.receiptCount,0);
   await assert.rejects(importStripeReceiptTransfer({...args,mode:'production-stage'}),/transport_invalid/);
  });
 }finally{await mf.dispose();}
});

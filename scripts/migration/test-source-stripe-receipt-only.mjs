import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { renderSourceStripeReceiptOnly } from './source-stripe-receipt-only.mjs';
import { renderSourceDatabaseFreeze } from './source-database-freeze.mjs';
import { prepareStripeReceiptTransfer, collectSourceStripeReceipts, loadStripeReceiptExport, importStripeReceiptTransfer, prepareStripeReceiptReturn } from './stripe-receipt-transfer.mjs';
import { acceptStripeWebhookReceiptIntoD1 } from '../../workers/api/src/stripe-webhook-d1-ingress.ts';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { applyBusinessRuntimeMigrations } from './business-runtime-import-schema.mjs';
import { canonicalizeNormalizedPayload, createStripeReceiptIngress, createSupabaseReceiptPersister, buildReceiptPersistenceInput } from '../../supabase/functions/_shared/stripe-receipt-ingress/index.ts';

const require = createRequire(new URL('../../experiments/stripe-receipts/package.json',import.meta.url));
const Stripe = require('stripe');
const originalFunction = {slug:'handle-stripe-webhook',id:randomUUID(),version:1,verify_jwt:false,sourceTreeSha256:'a'.repeat(64)};
const candidate = overrides => renderSourceStripeReceiptOnly({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),originalFunction,...overrides});
const secret='whsec_synthetic_only';
const stripe=new Stripe('sk_test_synthetic_only',{apiVersion:'2025-08-27.basil'});
const literal = value => value === null ? 'NULL' : "'"+String(value).replaceAll("'","''")+"'";
const signature='text,boolean,text,text,text,text,integer,jsonb,text,text,uuid';

test('source Stripe candidate refuses another project, invalid source identity and JWT protected endpoints',async()=>{
 for(const change of [{projectRef:'foreign'},{runId:'bad'},
   {originalFunction:{...originalFunction,verify_jwt:true}},
   {originalFunction:{...originalFunction,sourceTreeSha256:'missing'}}]) {
  await assert.rejects(candidate(change),/source_stripe_candidate_identity_invalid/);
 }
});

test('receipt-only candidate uses native PostgreSQL transactions and real Stripe signature validation', {timeout:90000},async t=>{
 const name='fanmark-receipt-only-'+randomUUID(); let id,held;
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}).trim();
 try {
  id=docker(['run','--detach','--network','none','--name',name,'--label','fanmark.test=source-stripe-receipt-only',
   '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94']);
  const psql=['exec','-i',id,'psql','-h','127.0.0.1','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'];
  const sql=(input,failure=false)=>{
   try {const out=execFileSync('docker',psql,{input,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();
    assert.equal(failure,false,'unexpected SQL success');return out;}
   catch(error){if(!failure||!error.status)throw error;return String(error.stderr);}
  };
  const deadline=Date.now()+20000;
  for(;;){try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}
   catch{if(Date.now()>deadline)throw Error('local_postgres_not_ready');await new Promise(r=>setTimeout(r,100));}}
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE ROLE source_operator; GRANT CREATE ON DATABASE postgres TO source_operator;
   GRANT USAGE,CREATE ON SCHEMA public TO source_operator;
   CREATE SCHEMA auth; CREATE SCHEMA storage;
   GRANT USAGE ON SCHEMA auth TO source_operator;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
   CREATE TABLE public.items(id int PRIMARY KEY); CREATE TABLE auth.items(LIKE public.items INCLUDING ALL);
   CREATE TABLE storage.items(LIKE public.items INCLUDING ALL); INSERT INTO public.items VALUES(1);`);
  const plan=await candidate();sql('SET ROLE source_operator;\n'+plan.installSql);sql(plan.verifySql);
  const receiptSql = args => `SELECT row_to_json(r) FROM public.accept_stripe_webhook_receipt(
   ${literal(args.p_stripe_event_id)},${args.p_livemode},${literal(args.p_event_type)},
   ${literal(args.p_object_type)},${literal(args.p_object_id)},${literal(args.p_api_version)},
   ${args.p_normalized_schema_version},${literal(JSON.stringify(args.p_normalized_payload))}::jsonb,
   ${literal(args.p_normalized_payload_sha256)},${literal(args.p_raw_payload_sha256)},${literal(args.p_cutover_run_id)}::uuid) r;`;
  let rpcCalls=0,lastArgs;
  const rpc=async (name,args)=>{
   assert.equal(name,'accept_stripe_webhook_receipt');rpcCalls++;lastArgs=args;
   try {return {data:[JSON.parse(sql(`SET ROLE service_role; SET request.jwt.claim.role='service_role';\n${receiptSql(args)}`))],error:null};}
   catch{return {data:null,error:{message:'synthetic database refusal'}};}
  };
  let handler;
  // Run the actual generated entry with its pinned imports supplied locally.
  // Only the network adapter is substituted; its RPC is real PostgreSQL.
  vm.runInNewContext(plan.entrySource.replace(/^import .*;\n/gm,''),{
   Stripe,createStripeReceiptIngress,createSupabaseReceiptPersister,
   createClient:(url,key,options)=>{
    assert.equal(url,'https://ppqgtbjykitqtiaisyji.supabase.co');assert.equal(key,'synthetic-service');
    assert.equal(options.auth.persistSession,false);return {rpc};
   },Deno:{env:{get:key=>({SUPABASE_URL:'https://ppqgtbjykitqtiaisyji.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',STRIPE_WEBHOOK_SECRET:secret,STRIPE_SECRET_KEY:'sk_test_synthetic_only'})[key]},serve:fn=>{handler=fn;}},
  });
  const deliver=async (eventId,livemode=false,valid=true)=>{
   const body=JSON.stringify({id:eventId,type:'checkout.session.completed',object:'event',created:Math.floor(Date.now()/1000),
    api_version:'2025-08-27.basil',livemode,data:{object:{id:'cs_synthetic',object:'checkout.session',mode:'payment',
     status:'complete',payment_status:'paid',amount_total:1200,currency:'jpy',metadata:{type:'license_extension',months:'3'}}}});
   const signature=stripe.webhooks.generateTestHeaderString({payload:body,secret:valid?secret:'whsec_wrong'});
   return handler(new Request('https://example.test/webhook',{method:'POST',headers:{'stripe-signature':signature},body}));
  };
  await t.test('signature failures never call SQL; durable duplicate and live/test records remain separate',async()=>{
   assert.equal((await deliver('evt_bad',false,false)).status,400);assert.equal(rpcCalls,0);
   const first=await deliver('evt_same');assert.equal(first.status,200);assert.equal(first.headers.get('x-fanmark-cutover'),plan.runId);
   assert.equal((await deliver('evt_same')).status,200);assert.equal((await deliver('evt_same',true)).status,200);
   assert.equal(sql('SELECT count(*) FROM billing_ingress.stripe_webhook_receipts'),'2');
   assert.equal(sql('SELECT count(*) FROM billing_ingress.stripe_webhook_dispatches'),'2');
   assert.equal(sql('SELECT sum(delivery_count) FROM billing_ingress.stripe_webhook_receipts'),'3');sql(plan.verifySql);
   assert.match(sql(plan.exportSql,true),/source_stripe_export_requires_seal/);
  });
  await t.test('source business freeze still allows receipts, without license or payment effects',async()=>{
   const relations=['auth','public','storage'].map(schema=>({schema,name:'items',kind:'r',partition:false,owner_role_available:true,trigger_privilege:true}));
   const freeze=renderSourceDatabaseFreeze({projectRef:plan.projectRef,runId:plan.runId,relations});
   sql(freeze.freezeSql);assert.match(sql('INSERT INTO public.items VALUES(2)',true),/fanmark_source_write_frozen/);
   assert.equal((await deliver('evt_while_frozen')).status,200);assert.equal(sql('SELECT count(*) FROM public.items'),'1');
   sql(freeze.verifySql);sql(freeze.resumeSql);
  });
  await t.test('wrong run, untrusted role and direct-table access are rejected',async()=>{
   assert.match(sql(`SET ROLE service_role; SET request.jwt.claim.role='service_role';${receiptSql({...lastArgs,p_cutover_run_id:randomUUID()})}`,true),/source_stripe_intake_closed/);
   assert.match(sql(`SET ROLE anon; SET request.jwt.claim.role='service_role';${receiptSql(lastArgs)}`,true),/permission denied/);
   assert.match(sql('SET ROLE service_role; SELECT * FROM billing_ingress.stripe_webhook_receipts',true),/permission denied/);
   assert.match(sql((await candidate()).sealSql,true),/source_stripe_control_changed/);
   assert.match(sql(plan.installSql,true),/source_stripe_existing_ingress/);
  });
  await t.test('seal waits for an independent unfinished receipt transaction; timeout does not partially seal',async()=>{
   held=spawn('docker',psql,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
   held.stdout.on('data',chunk=>{stdout+=chunk;});held.stderr.on('data',chunk=>{stderr+=chunk;});
   const normalized=structuredClone(lastArgs.p_normalized_payload);normalized.event.id='evt_in_flight';
   const inFlight={...lastArgs,p_stripe_event_id:'evt_in_flight',p_normalized_payload:normalized,
    p_normalized_payload_sha256:createHash('sha256').update(canonicalizeNormalizedPayload(normalized)).digest('hex')};
   held.stdin.write(`BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';
    ${receiptSql(inFlight)} SELECT 'receipt_transaction_open';\n`);
   const deadline=Date.now()+10000;
   while(!stdout.includes('receipt_transaction_open')){
    if(Date.now()>deadline||held.exitCode!==null)throw Error('held_receipt_failed: '+stderr);
    await new Promise(r=>setTimeout(r,30));
   }
   assert.match(sql(plan.sealSql,true),/lock timeout/);
   assert.equal(sql('SELECT accepting FROM billing_ingress.cutover_control'),'t');
   const sealer=spawn('docker',psql,{stdio:['pipe','pipe','pipe']});const sealExit=once(sealer,'exit');
   sealer.stdout.resume();sealer.stderr.resume();
   sealer.stdin.end("SET ROLE source_operator; SET application_name='fanmark_receipt_seal_test';\n"+plan.sealSql);
   try {
    const lockDeadline=Date.now()+4000;
    while(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='fanmark_receipt_seal_test' AND wait_event_type='Lock'")!=='1'){
     if(Date.now()>lockDeadline||sealer.exitCode!==null)throw Error('seal_did_not_wait_for_receipt');
     await new Promise(r=>setTimeout(r,30));
    }
    const exit=once(held,'exit');held.stdin.end('COMMIT;\n');assert.equal((await exit)[0],0);held=null;
    assert.equal((await sealExit)[0],0);
   } finally {if(sealer.exitCode===null)sealer.kill();}
   sql(plan.verifySql);
   assert.equal(sql('SELECT sealed_receipts FROM billing_ingress.cutover_control'),'4');
   assert.equal((await deliver('evt_after_seal')).status,503);
   assert.equal(sql('SELECT count(*) FROM billing_ingress.stripe_webhook_receipts'),'4');
  });
  await t.test('sealed PostgreSQL stream survives encryption, native D1 receipt arrivals, and atomic prewrite return',async()=>{
   const source=JSON.parse(sql(plan.exportSql)),projection=await prepareStripeReceiptTransfer(source,{runId:plan.runId});
   assert.equal(projection.receiptCount,4);assert.equal(projection.deliveryCount,5);
   const key=randomBytes(32),directory=await mkdtemp(join(tmpdir(),'fanmark-receipt-capture-'));
   let restored;
   try{
    const options={projectRef:plan.projectRef,runId:plan.runId,originalFunction,query:async text=>JSON.parse(sql(text)),encryptionKey:key,archivePath:join(directory,'receipts.json')};
    const collected=await collectSourceStripeReceipts(options);
    assert.equal(collected.plaintextFiles,0);assert.deepEqual(await readdir(directory),['receipts.json']);
    assert.equal((await stat(options.archivePath)).mode&0o777,0o600);
    restored=await loadStripeReceiptExport({...options,expectedArchiveSha256:collected.archiveSha256});assert.deepEqual(restored,source);
    await assert.rejects(loadStripeReceiptExport({...options,expectedArchiveSha256:'f'.repeat(64)}),/archive_file_changed/);
    await assert.rejects(collectSourceStripeReceipts({...options,query:()=>{throw Error('must not query again');}}),/archive_already_exists/);
    await assert.rejects(collectSourceStripeReceipts({...options,archivePath:join(directory,'wrong-original.json'),query:async()=>({...source,originalFunctionSha256:'f'.repeat(64)})}),/source_original_mismatch/);
    assert.deepEqual(await readdir(directory),['receipts.json']);
   }finally{await rm(directory,{recursive:true,force:true});}
   const mf=new Miniflare({workers:[{config:{name:'sealed-stripe-transfer',type:'worker',compatibilityDate:'2026-09-18',
    env:{DB:{type:'d1',name:'sealed-stripe-transfer'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:"export default {fetch(){return new Response('ok')}}"}}}}}]});
   try {
    const database=await mf.getD1Database('DB');await applyBusinessRuntimeMigrations(database);
    const report=await importStripeReceiptTransfer({source:restored,database,readDatabase:database,runId:plan.runId});
    assert.equal(report.receiptCount,4);assert.equal(report.billingEffectsApplied,false);
    assert.equal((await database.prepare('SELECT count(*) AS n FROM fanmark_licenses').all()).results[0].n,0);
    const row=source.receipts[0],at=new Date(Date.now()+1000).toISOString();
    const originalInput={stripeEventId:row.stripe_event_id,livemode:row.livemode,eventType:row.event_type,
      objectType:row.object_type,objectId:row.object_id,apiVersion:row.api_version,normalizedSchemaVersion:1,
      normalizedPayload:row.normalized_payload,normalizedPayloadSha256:row.normalized_payload_sha256,rawPayloadSha256:row.raw_payload_sha256};
    await acceptStripeWebhookReceiptIntoD1({database,event:originalInput,now:at});
    const event={id:'evt_return_new',object:'event',created:Math.floor(Date.now()/1000),livemode:false,
      api_version:'2025-08-27.basil',type:'checkout.session.completed',data:{object:{id:'cs_return_new',object:'checkout.session',
        mode:'payment',status:'complete',payment_status:'paid',amount_total:1000,currency:'jpy',metadata:{type:'license_extension',months:'1'}}}};
    const input=await buildReceiptPersistenceInput(event,new TextEncoder().encode(JSON.stringify(event)));
    await acceptStripeWebhookReceiptIntoD1({database,event:input,now:at});
    const targetTables=Object.fromEntries(await Promise.all(['stripe_webhook_receipts','stripe_webhook_dispatches'].map(async table=>
      [table,(await database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results])));
    for(const rows of Object.values(targetTables))rows.reverse();
    const closedAt=new Date(Date.now()+2000).toISOString().replace(/\.(\d{3})Z$/u,'.$1000Z');
    const options={sourceBefore:source,targetTables,runId:plan.runId,originalFunction,closedAt};
    const returnPlan=await prepareStripeReceiptReturn(options);
    assert.equal(returnPlan.receiptCount,5);assert.equal(returnPlan.deliveryCount,7);
    assert.equal(returnPlan.targetDrainVerified,false);assert.equal(returnPlan.productionReady,false);
    for(const change of [t=>{t.stripe_webhook_dispatches[0].claim_generation=1;},
      t=>{t.stripe_webhook_receipts.find(r=>r.id===row.id).delivery_count=0;},
      t=>{t.stripe_webhook_receipts.find(r=>r.id===row.id).raw_payload_sha256='f'.repeat(64);},
      t=>{t.stripe_webhook_dispatches[0].attempt_count=1;},
      t=>{t.stripe_webhook_receipts.find(r=>r.id===row.id).first_received_at=closedAt;}]){
      const changed=structuredClone(targetTables);change(changed);
      await assert.rejects(prepareStripeReceiptReturn({...options,targetTables:changed}),/stripe_receipt_transfer_/);
    }
    const sourceBefore=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM billing_ingress.stripe_webhook_receipts r');
    sql(`CREATE FUNCTION public.return_test_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER return_test BEFORE INSERT ON billing_ingress.stripe_webhook_receipts FOR EACH ROW EXECUTE FUNCTION public.return_test_trigger()`);
    assert.match(sql(returnPlan.sql,true),/unexpected_trigger_or_rule/);
    assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM billing_ingress.stripe_webhook_receipts r'),sourceBefore);
    sql('DROP TRIGGER return_test ON billing_ingress.stripe_webhook_receipts; DROP FUNCTION public.return_test_trigger()');
    sql("ALTER TABLE billing_ingress.stripe_webhook_dispatches ADD CONSTRAINT return_test_failure CHECK(stripe_event_id <> 'evt_return_new')");
    assert.match(sql(returnPlan.sql,true),/return_test_failure/);
    assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM billing_ingress.stripe_webhook_receipts r'),sourceBefore);
    assert.equal(sql('SELECT sealed_receipts FROM billing_ingress.cutover_control'),'4');
    sql('ALTER TABLE billing_ingress.stripe_webhook_dispatches DROP CONSTRAINT return_test_failure');
    sql('SET ROLE source_operator;\n'+returnPlan.sql);
    const returned=JSON.parse(sql(plan.exportSql));
    assert.deepEqual(await prepareStripeReceiptTransfer(returned,{runId:plan.runId}),
      await prepareStripeReceiptTransfer(returnPlan.returnedSource,{runId:plan.runId}));
    assert.match(sql(returnPlan.sql,true),/source_not_sealed|content_changed/);
    assert.equal(sql('SELECT count(*) FROM public.items'),'1');
    assert.equal((await database.prepare('SELECT count(*) AS n FROM fanmark_licenses').all()).results[0].n,0);
   } finally {await mf.dispose();}
  });
  await t.test('verification rejects changed function or privilege; reopen retains every original receipt',async()=>{
   sql(`ALTER FUNCTION public.accept_stripe_webhook_receipt(${signature}) SET search_path=public`);
   assert.match(sql(plan.reopenSql,true),/source_stripe_control_changed/);
   sql(`ALTER FUNCTION public.accept_stripe_webhook_receipt(${signature}) SET search_path=pg_catalog,billing_ingress`);
   sql('GRANT SELECT ON billing_ingress.stripe_webhook_receipts TO service_role');
   assert.match(sql(plan.reopenSql,true),/source_stripe_privileges_changed/);
   sql('REVOKE SELECT ON billing_ingress.stripe_webhook_receipts FROM service_role');
   const before=sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM billing_ingress.stripe_webhook_receipts r');
   sql('SET ROLE source_operator;\n'+plan.reopenSql);assert.equal(sql('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM billing_ingress.stripe_webhook_receipts r'),before);
   assert.equal((await deliver('evt_after_reopen')).status,200);sql(plan.verifySql);
  });
 } finally {
  if(held){held.stdin.destroy();held.kill();}
  if(id){const info=JSON.parse(docker(['inspect',id]))[0];assert.equal(info.Name,'/'+name);
   assert.equal(info.Config.Labels['fanmark.test'],'source-stripe-receipt-only');docker(['rm','--force',id]);}
 }
});

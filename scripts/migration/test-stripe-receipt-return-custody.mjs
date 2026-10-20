const credentialLease=syntheticProductionCredential('synthetic_token_only');
import {syntheticProductionCredential} from './fixtures/synthetic-production-credential.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,chmod,readFile,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {createProductionRemoteD1,PRODUCTION_D1_TARGETS,isReadOnlyProductionSql} from './production-remote-d1.mjs';
import {applyBusinessRuntimeMigrations} from './business-runtime-import-schema.mjs';
import {syntheticStripeReceiptExport} from './test-stripe-receipt-transfer-fixture.mjs';
import {importStripeReceiptTransfer,collectStripeReceiptReturn,loadStripeReceiptReturn} from './stripe-receipt-transfer.mjs';
import {sha256Hex} from './snapshot-format.mjs';
import {execFileSync} from 'node:child_process';
import {renderSourceStripeReceiptOnly} from './source-stripe-receipt-only.mjs';
import {createSourceStripeReturnTransport} from './source-stripe-return-transport.mjs';
import {executeStripeReceiptReturn,inspectStripeReceiptReturnExecution} from './stripe-receipt-return-execution.mjs';

test('closed native coordinator and production readonly transport capture authenticated return custody',{timeout:60000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fanmark-return-custody-'));await chmod(directory,0o700);
 const scope='d70311e65d8f8205443e9230e4443d485a66c1e99831fe5c189d90fe81c121d3';
 const built=await build({stdin:{contents:`export {RecoveryWriterCoordinatorProductionV2} from './recovery-writer-drain';
 export default {async fetch(r,e){const u=new URL(r.url),stub=e.RECOVERY_DRAIN.get(e.RECOVERY_DRAIN.idFromName('recovery-writers-v1'));
 return stub.fetch('https://recovery-writer.internal'+u.pathname,{method:'POST',body:await r.text(),headers:{'content-type':'application/json'}})}};`,
 resolveDir:fileURLToPath(new URL('../../workers/api/src',import.meta.url)),loader:'ts'},bundle:true,write:false,
 format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const mf=new Miniflare({workers:[{config:{name:'return-custody',type:'worker',compatibilityDate:'2026-09-18',
 exports:{RecoveryWriterCoordinatorProductionV2:{type:'durable-object',storage:'sqlite'}},
 env:{RECOVERY_DRAIN:{type:'durable-object',worker:'return-custody',exportName:'RecoveryWriterCoordinatorProductionV2'},
 RECOVERY_DRAIN_SCOPE_DIGEST:{type:'text',value:scope},RECOVERY_DRAIN_BACKEND:{type:'text',value:'durable-object'},
 CUTOVER_WRITE_FREEZE:{type:'text',value:'receipt_only'},DB:{type:'d1',name:'return-custody'}},
 manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}},
 dev:{outboundService:{type:'fetcher',handler(){throw Error('external_network_forbidden');}}}}]});
 try{
  const native=await mf.getD1Database('DB');await applyBusinessRuntimeMigrations(native);
  const runId=randomUUID(),source=await syntheticStripeReceiptExport(runId),encryptionKey=randomBytes(32);
  source.receipts.sort((a,b)=>a.id.localeCompare(b.id,'en'));source.dispatches.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const originalFunction={slug:'handle-stripe-webhook',id:randomUUID(),version:172,verify_jwt:false,sourceTreeSha256:source.originalFunctionSha256};
  const incarnations=Object.fromEntries(['auth','business','master','avatars','covers'].map(k=>[k,randomUUID()]));
  let inspectCount=0,afterInspect=null,queries=0;
  async function raw(path,input){const r=await mf.dispatchFetch('https://fixture.local'+path,{method:'POST',body:JSON.stringify(input)});
   if(r.status!==200)throw Error('fixture_command_refused');return r.json();}
  const coordinator=createProductionImportCoordinator({owner:runId,manifestSha256:'a'.repeat(64),incarnations,
   command:async(action,input)=>{const result=await raw('/migration/'+action,input);if(action==='inspect'){inspectCount++;await afterInspect?.(inspectCount);}return result;}});
  const target={...PRODUCTION_D1_TARGETS.find(r=>r.store === 'business'),targetIncarnation:incarnations.business};
  const database=createProductionRemoteD1({credentialLease,target,token:'synthetic_readonly_token',fetchImpl:async(url,options)=>{
   assert.equal(options.redirect,'error');assert.ok(url.startsWith('https://api.cloudflare.com/'));
   if(options.method==='GET')return Response.json({success:true,result:{uuid:target.databaseId,name:target.databaseName,created_at:target.createdAt}});
   const batch=JSON.parse(options.body).batch;
   assert.ok(batch.every(r=>isReadOnlyProductionSql(r.sql)),'collector must not issue writes');queries++;
   return Response.json({success:true,result:await native.batch(batch.map(r=>native.prepare(r.sql).bind(...r.params)))});
  }});
  const options={sourceBefore:source,database,coordinator,originalFunction,runId,encryptionKey,archivePath:join(directory,'return.json')};
  await t.test('incomplete import cannot be captured, and the original owner completes its state first',async()=>{
   await coordinator.claim();
   await assert.rejects(collectStripeReceiptReturn(options),/return_target_not_drained/);
   assert.equal(queries,0);assert.deepEqual(await readdir(directory),[]);
   const operation={operationId:randomUUID(),batchSha256:'b'.repeat(64),store:'business'};
   await coordinator.beforeWrite(operation);
   await importStripeReceiptTransfer({source,database:native,readDatabase:native,runId});
   await coordinator.afterWrite(operation);await coordinator.complete('c'.repeat(64));
  });
  let report,bytes;
  await t.test('capture independently rereads data and encrypted file without changing D1 or exposing payloads',async()=>{
   report=await collectStripeReceiptReturn(options);bytes=await readFile(options.archivePath);
   assert.equal(report.receiptCount,2);assert.equal(report.deliveryCount,4);assert.equal(report.trackedWriterFenceVerified,true);
   assert.equal(report.plaintextFiles,0);assert.equal(report.productionReady,false);
   assert.equal((await stat(options.archivePath)).mode&0o777,0o600);
   assert.doesNotMatch(bytes.toString('utf8'),/evt_transfer|cs_transfer|normalized_payload|INSERT INTO/);
   const loaded=await loadStripeReceiptReturn({...options,expectedArchiveSha256:report.archiveSha256,
    manifestSha256:coordinator.manifestSha256,businessIncarnation:incarnations.business});
   assert.equal(loaded.plan.returnedSourceSha256,report.returnedSourceSha256);
   assert.match(loaded.plan.sql,/BEGIN;[\s\S]+COMMIT;/u);
   assert.equal(loaded.plan.targetDrainVerified,false); // Stored custody is not a live fence assertion.
   assert.equal((await native.prepare('SELECT count(*) AS n FROM fanmark_licenses').all()).results[0].n,0);
   const reads=queries;await assert.rejects(collectStripeReceiptReturn(options),/archive_already_exists/);assert.equal(queries,reads);
  });
  await t.test('wrong key, run manifest, incarnation, baseline, or authenticated header cannot open custody',async()=>{
   const loadOptions={...options,expectedArchiveSha256:report.archiveSha256,manifestSha256:coordinator.manifestSha256,businessIncarnation:incarnations.business};
   const changed=structuredClone(source);changed.originalFunctionSha256='f'.repeat(64);
   for(const change of [{encryptionKey:randomBytes(32)},{runId:randomUUID()},{manifestSha256:'e'.repeat(64)},
    {businessIncarnation:randomUUID()},{sourceBefore:changed}])await assert.rejects(loadStripeReceiptReturn({...loadOptions,...change}),/return_archive_invalid/);
   const archive=JSON.parse(bytes.toString('utf8'));archive.coordinatorStateSha256='d'.repeat(64);
   const tampered=Buffer.from(JSON.stringify(archive)),path=join(directory,'tampered.json');await writeFile(path,tampered,{mode:0o600,flag:'wx'});
   await assert.rejects(loadStripeReceiptReturn({...loadOptions,archivePath:path,expectedArchiveSha256:sha256Hex(tampered)}),/return_archive_invalid/);
  });
  await t.test('fixed source transport journals one native PostgreSQL transaction and independently resolves lost ACK without replay',async()=>{
   const name='fanmark-return-source-'+randomUUID();let id;
   const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}).trim();
   try{
    id=docker(['run','--detach','--network','none','--name',name,'--label','fanmark.test=stripe-return-custody',
     '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94']);
    const deadline=Date.now()+20000;
    for(;;){try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}
     catch{if(Date.now()>deadline)throw Error('local_postgres_not_ready');await new Promise(r=>setTimeout(r,100));}}
    const sql=input=>execFileSync('docker',['exec','-i',id,'psql','-h','127.0.0.1','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
     {input,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();
    sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;");
    const candidate=await renderSourceStripeReceiptOnly({projectRef:source.projectRef,runId,originalFunction});sql(candidate.installSql);
    const literal=s=>"'"+s.replaceAll("'","''")+"'";
    for(const [table,rows] of [['stripe_webhook_receipts',source.receipts],['stripe_webhook_dispatches',source.dispatches]])
     sql(`INSERT INTO billing_ingress.${table} SELECT * FROM jsonb_populate_recordset(NULL::billing_ingress.${table},${literal(JSON.stringify(rows))}::jsonb)`);
    const restoreBaseline=()=>sql(`UPDATE billing_ingress.cutover_control SET accepting=false,sealed_at=${literal(source.sealedAt)}::timestamptz,sealed_receipts=2,sealed_deliveries=4`);
    restoreBaseline();
    let sourceWrites=0,loseNextWrite=false;
    const fetchImpl=async(url,request)=>{
     assert.equal(url,'https://api.supabase.com/v1/projects/ppqgtbjykitqtiaisyji/database/query');
     assert.equal(request.method,'POST');assert.equal(request.redirect,'error');
     const body=JSON.parse(request.body);assert.equal(body.read_only,false);
     const writing=body.query.startsWith('BEGIN;\nSET LOCAL');
     if(!writing)assert.ok(body.query.startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'));
     const output=sql(body.query);
     if(writing){sourceWrites++;assert.equal(output,'t');if(loseNextWrite){loseNextWrite=false;throw Error('lost after source commit');}
      return Response.json([{singleton:true}],{status:201});}
     return Response.json([{jsonb_build_object:JSON.parse(output)}],{status:201});
    };
    const transportOptions={token:'synthetic_management_token',runId,originalFunction,fetchImpl};
    const sourceReader=await createSourceStripeReturnTransport(transportOptions);
    const sourceWriter=await createSourceStripeReturnTransport({...transportOptions,access:'return'});
    assert.deepEqual(await sourceReader.preflight(),{role:'postgres',transactionReadOnly:'on',receiptSchemaPresent:true,canCreateSchema:true});
    await assert.rejects(sourceReader.applyReturn({}),/write_access_required/);assert.equal(sourceWrites,0);
    const execution={...options,sourceReader,sourceWriter,expectedArchiveSha256:report.archiveSha256,journalPath:join(directory,'execution.json')};
    const verified=await executeStripeReceiptReturn(execution);
    assert.equal(verified.sourceReadbackVerified,true);assert.equal(verified.sourceReopened,false);assert.equal(sourceWrites,1);
    assert.doesNotMatch(await readFile(execution.journalPath,'utf8'),/evt_transfer|normalized_payload|INSERT INTO/);
    assert.equal((await stat(execution.journalPath)).mode&0o777,0o600);
    await assert.rejects(executeStripeReceiptReturn(execution),/attempt_already_exists/);assert.equal(sourceWrites,1);
    restoreBaseline(); // Test-only reset of the owned source fixture, never a production recovery action.
    const unknown={...execution,journalPath:join(directory,'unknown.json')};loseNextWrite=true;
    await assert.rejects(executeStripeReceiptReturn(unknown),/write_acknowledgement_unknown/);assert.equal(sourceWrites,2);
    assert.equal((await readdir(directory)).includes('unknown.json.verified.json'),false);
    const inspected=await inspectStripeReceiptReturnExecution({...unknown,expectedIntentSha256:sha256Hex(await readFile(unknown.journalPath))});
    assert.equal(inspected.state,'returned-content-observed');assert.equal(inspected.retryAllowed,false);assert.equal(sourceWrites,2);
    await assert.rejects(executeStripeReceiptReturn(unknown),/attempt_already_exists/);assert.equal(sourceWrites,2);
   }finally{if(id){const info=JSON.parse(docker(['inspect',id]))[0];assert.equal(info.Name,'/'+name);
     assert.equal(info.Config.Labels['fanmark.test'],'stripe-return-custody');docker(['rm','--force',id]);}}
  });
  await t.test('unfenced or in-flight native writers prevent capture; no fence is released by collector',async()=>{
   const alternate={...options,archivePath:join(directory,'refused.json')};
   await raw('/release',{id:runId,scope});await assert.rejects(collectStripeReceiptReturn(alternate),/return_target_not_drained/);
   const writer=randomUUID();await raw('/enter',{id:writer,scope});await raw('/claim',{id:runId,scope});
   await assert.rejects(collectStripeReceiptReturn(alternate),/return_target_not_drained/);
   await raw('/leave',{id:writer,scope});assert.equal((await coordinator.inspect()).fenceOwner,runId);
   assert.equal((await readdir(directory)).includes('refused.json'),false);
  });
  await t.test('untracked change after durable save refuses acceptance but retains the original encrypted archive',async()=>{
   inspectCount=0;
   afterInspect=async count=>{if(count===3)await native.prepare('UPDATE stripe_webhook_receipts SET delivery_count=delivery_count+1 WHERE id=?').bind(source.receipts[0].id).run();};
   const path=join(directory,'changed-during-capture.json');
   await assert.rejects(collectStripeReceiptReturn({...options,archivePath:path}),/return_content_changed/);afterInspect=null;
   assert.equal((await stat(path)).mode&0o777,0o600);
   assert.equal((await coordinator.inspect()).fenceOwner,runId);
   assert.doesNotMatch(await readFile(path,'utf8'),/evt_transfer/);
  });
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

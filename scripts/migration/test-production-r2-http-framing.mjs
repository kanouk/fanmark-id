import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {Agent,setGlobalDispatcher,getGlobalDispatcher} from '../../workers/api/node_modules/undici/index.js';
import {syntheticProductionCredential} from './fixtures/synthetic-production-credential.mjs';
import {createProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {openProductionR2ImportTransport} from './production-remote-r2.mjs';
import {inspectProductionImportJournal} from './production-import-inspection.mjs';
import {PRODUCTION_R2_TARGETS} from './production-r2-targets.mjs';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';

// Schema tooling can install Undici 7's dispatcher before Node 22.6 fetch is
// initialized. Exercise real HTTP, not a fetch mock, for the binary body path.
test('buffered R2 PUT uses correct HTTP framing with the schema tooling dispatcher',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fanmark-r2-framing-')),agent=new Agent(),previous=getGlobalDispatcher();
 const bytes=Buffer.alloc(18659,114),sha=value=>createHash('sha256').update(value).digest('hex'),key='owned/framing-image.jpg',version=randomUUID(),gateVersion=randomUUID(),owner=randomUUID();
 let received=0;const server=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);received++;
  assert.equal(req.method,'PUT');assert.equal(req.headers['content-length'],String(bytes.length));assert.deepEqual(body,bytes);
  const object=JSON.parse(Buffer.from(req.headers['x-fanmark-import-object'],'base64').toString());assert.equal(object.size,body.length);assert.equal(object.sha256,sha(body));
  assert.equal(req.headers['x-fanmark-import-operation'],state.pending.operationId);assert.equal(state.pending.store,'avatars');
  res.setHeader('content-type','application/json');res.end(JSON.stringify({key,size:body.length,etag:'owned-etag',version:randomUUID(),httpMetadata:object.httpMetadata,customMetadata:object.customMetadata}));
 }catch{res.writeHead(500);res.end('{}');}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port,origin='https://fanmark-prod-import-'+randomUUID()+'.fanmark-id.workers.dev',target=PRODUCTION_R2_TARGETS.find(t=>t.store==='avatars');
 const incarnations=Object.fromEntries(['auth','master','business','avatars','covers'].map(k=>[k,randomUUID()]));let state;
 const coordinator=createProductionImportCoordinator({owner,manifestSha256:'a'.repeat(64),incarnations,command:async(action,input)=>{
  if(action==='claim'){state={...input,pending:null,acknowledged:0,readbackSha256:null};return structuredClone(state);}
  if(action==='begin'){assert.equal(state.pending,null);state.pending={operationId:input.operationId,batchSha256:input.batchSha256,store:input.store};return structuredClone(state);}
  if(action==='acknowledge'){assert.equal(state.pending.operationId,input.operationId);state.pending=null;state.acknowledged++;return structuredClone(state);}throw Error('unreviewed_fixture_command');
 }});
 const runtimeBindings=[...Object.entries({AUTH_DB:PRODUCTION_STORE_IDS.auth,MASTER_DB:PRODUCTION_STORE_IDS.master,FANMARK_DB:PRODUCTION_STORE_IDS.business}).map(([name,id])=>({name,id,type:'d1'})),...Object.entries({AVATARS_BUCKET:PRODUCTION_STORE_IDS.avatars,COVER_IMAGES_BUCKET:PRODUCTION_STORE_IDS.covers}).map(([name,bucket_name])=>({name,bucket_name,type:'r2_bucket'})),...Object.entries({RECOVERY_DRAIN_SCOPE_DIGEST:PRODUCTION_RUNTIME.scope,D1_TOPOLOGY:'split',EMOJI_PUBLICATION_BACKEND:'production-service',CUTOVER_WRITE_FREEZE:'receipt_only',STORAGE_BACKEND:'r2',RECOVERY_DRAIN_BACKEND:'durable-object'}).map(([name,text])=>({name,text,type:'plain_text'}))];
 const fetchImpl=async(input,options)=>{
  const u=new URL(input);if(u.hostname==='api.cloudflare.com'){
   let result;if(u.pathname.endsWith('/r2/buckets/'+target.bucketName))result={name:target.bucketName,creation_date:target.createdAt,storage_class:'Standard'};
   else if(u.pathname.endsWith('/deployments'))result={deployments:[{versions:[{version_id:u.pathname.includes('/'+PRODUCTION_RUNTIME.worker+'/')?version:gateVersion,percentage:100}]}]};
   else if(u.pathname.endsWith('/settings'))result={bindings:u.pathname.includes('/'+PRODUCTION_RUNTIME.worker+'/')?runtimeBindings:[{name:'R2_IMPORT',type:'service',service:PRODUCTION_RUNTIME.worker,entrypoint:'ProductionR2ImportService'},...Object.entries({EXPECTED_RUNTIME:version,GATE_ACCESS:'import',EXPIRES_AT:String(Date.now()+3600000)}).map(([name,text])=>({name,text,type:'plain_text'}))]};
   else throw Error('unreviewed_control_fixture');return Response.json({success:true,result});
  }
  assert.equal(u.origin,origin);if(u.pathname==='/r2/identity')return Response.json({runtimeVersion:version,scope:PRODUCTION_RUNTIME.scope,stores:PRODUCTION_STORE_IDS});
  assert.equal(u.pathname,'/r2/object');return fetch(url,options);
 };
 try{
  await coordinator.claim();setGlobalDispatcher(agent);
  const journalPath=join(dir,'avatars.jsonl'),writer=await openProductionR2ImportTransport({target:{...target,targetIncarnation:incarnations.avatars},credentialLease:syntheticProductionCredential('synthetic_only_framing_credential'),runtimeVersion:version,gatewayOrigin:origin,gatewayVersion:gateVersion,bearer:'b'.repeat(64),runId:owner,coordinator,journalPath,fetchImpl});
  const contentType='image/jpeg',customMetadata={'fanmark-source-bucket':'avatars','fanmark-source-key':key,'fanmark-source-sha256':sha(bytes),'fanmark-source-size':String(bytes.length),'fanmark-source-content-type':contentType};
  await writer.putWithSize(key,new Response(bytes).body,{onlyIf:{etagDoesNotMatch:'*'},sha256:sha(bytes),httpMetadata:{contentType},customMetadata},bytes.length);
  assert.equal(received,1);assert.equal(state.acknowledged,1);const journal=await inspectProductionImportJournal(journalPath);assert.equal(journal.pending,null);assert.equal(journal.lock,null);assert.equal(journal.operations.length,1);
 }finally{setGlobalDispatcher(previous);await agent.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

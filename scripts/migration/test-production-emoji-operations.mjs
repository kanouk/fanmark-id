import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PRODUCTION_EMOJI_TARGET as target,resolveProductionEmojiTarget} from './production-emoji-target.mjs';
import {PRODUCTION_STORE_IDS as ids} from '../../workers/api/src/production-runtime-identity.ts';
import {readProductionEmojiMaster} from './staging-emoji-master-export.mjs';
import {runProductionEmojiPublication} from './production-emoji-publication.mjs';
import {buildRelease} from '../build-emoji-release.ts';
const active='a'.repeat(64),runtime='00000000-0000-4000-8000-000000000012',token='synthetic-token-never-for-production';
const records=[{id:'00000000-0000-4000-8000-000000000001',emoji:'😀',short_name:'face',keywords:['face'],category:'People',subcategory:null,codepoints:['1F600'],sort_order:1}];
const settings=()=>({bindings:[...Object.entries({AUTH_DB:ids.auth,FANMARK_DB:ids.business,MASTER_DB:ids.master}).map(([name,id])=>({type:'d1',name,id})),
 ...Object.entries({AVATARS_BUCKET:ids.avatars,COVER_IMAGES_BUCKET:ids.covers}).map(([name,bucket_name])=>({type:'r2_bucket',name,bucket_name})),
 ...Object.entries({D1_TOPOLOGY:'split',RECOVERY_DRAIN_SCOPE_DIGEST:target.scope,EMOJI_PUBLICATION_BACKEND:'production-service'}).map(([name,text])=>({type:'plain_text',name,text}))]});
const envelope=value=>Response.json({success:true,result:value});
test('production master requires every fixed binding and rejects duplicates or mixed cohorts',()=>{
 assert.equal(resolveProductionEmojiTarget(settings()).entrypoint,'ProductionEmojiMasterPublicationService');
 for(const row of settings().bindings){const changed=settings();const binding=changed.bindings.find(x=>x.name===row.name);binding.id='wrong';binding.bucket_name='wrong';binding.text='wrong';assert.throws(()=>resolveProductionEmojiTarget(changed),/target_mismatch/);}
 const duplicate=settings();duplicate.bindings.push(duplicate.bindings[0]);assert.throws(()=>resolveProductionEmojiTarget(duplicate),/target_mismatch/);
});
test('production export reads only master columns and verifies both binding snapshots and DB creation identity',async()=>{
 for(const fault of [null,'created-at','after-binding']){
  let queries=0,settingsReads=0;
  const fetchImpl=async(url,init)=>{const u=new URL(url);assert.equal(u.hostname,'api.cloudflare.com');assert.ok(u.pathname.includes('/'+target.account+'/'));
   if(u.pathname.endsWith('/settings')){assert.ok(u.pathname.endsWith('/'+target.worker+'/settings'));const s=settings();if(++settingsReads===2&&fault==='after-binding')s.bindings[0].id='other';return envelope(s);}
   assert.ok(u.pathname.includes('/d1/database/'+target.masterId));
   if(init.method==='GET')return envelope({uuid:target.masterId,name:target.masterName,created_at:fault==='created-at'?'changed':target.createdAt});
   queries++;assert.match(JSON.parse(init.body).sql,/^SELECT id, emoji/);
   return envelope([{success:true,meta:{rows_written:0,changed_db:false},results:records.map(row=>({...row,keywords:JSON.stringify(row.keywords),codepoints:JSON.stringify(row.codepoints),active_version:active,private_field:'never-export'}))}]);
  };
  if(fault){await assert.rejects(readProductionEmojiMaster({token,fetchImpl,expectedActive:active}));assert.equal(queries,fault==='created-at'?0:1);}
  else{const result=await readProductionEmojiMaster({token,fetchImpl,expectedActive:active});assert.equal(result.recordCount,1);assert.equal(result.rowsWritten,0);assert.equal(settingsReads,2);assert.ok(!result.recordsSource.includes('never-export'));}
 }
});
for(const fault of [null,'lost-ack','wrong-binding'])test('production publication fixed service, single request and cleanup: '+(fault??'success'),async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fanmark-prod-publish-'));
 let mutations=0,uploads=0,removed=false,staged=false;
 try{
  const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify(records));const artifact=await buildRelease(input,path.join(dir,'releases'));
  const fetcher=async(url,init={})=>{const u=new URL(url),method=init.method??'GET';assert.ok(!u.pathname.includes('/d1/'));
   if(u.hostname==='api.cloudflare.com'){
    if(u.pathname.endsWith('/settings')){assert.ok(u.pathname.endsWith('/'+target.worker+'/settings'));const s=settings();if(fault==='wrong-binding')s.bindings[0].id='other';return envelope(s);}
    if(u.pathname.endsWith('/deployments')){assert.ok(u.pathname.endsWith('/'+target.worker+'/deployments'));return envelope({deployments:[{versions:[{version_id:runtime,percentage:100}]}]});}
    if(method==='PUT'){uploads++;const metadata=JSON.parse(init.body.get('metadata'));const binding=metadata.bindings.find(x=>x.name==='PUBLICATION');assert.equal(binding.service,target.worker);assert.equal(binding.entrypoint,target.entrypoint);const expires=Number(metadata.bindings.find(x=>x.name==='EXPIRES_AT').text);assert.ok(expires>Date.now()&&expires<=Date.now()+600000);return envelope({});}
    if(method==='POST')return envelope({});
    if(method==='DELETE'){removed=true;return envelope({});}
    return new Response(null,{status:404});
   }
   assert.ok(u.hostname.startsWith('fanmark-prod-publish-'));
   if(u.pathname==='/status')return Response.json({runtimeVersion:runtime,active:{release_version:active,generation:1},publication:staged?{status:'ready',release_version:artifact.version,row_count:1}:null,event:null,writers:{active:0}});
   assert.equal(u.pathname,'/stage');assert.equal(method,'POST');mutations++;staged=true;if(fault==='lost-ack')throw Error('synthetic-lost-ack');return Response.json({runtimeVersion:runtime,version:artifact.version,status:'ready'});
  };
  const journal=path.join(dir,'operation.json'),options={action:'stage',releaseDirectory:artifact.directory,expectedActive:active,expectedGeneration:1,journal};
  const dependencies={identity:{email:'fanmark.id@gmail.com',accounts:[{id:target.account}]},token,fetch:fetcher,sleep:async()=>{}};
  if(fault)await assert.rejects(runProductionEmojiPublication(options,dependencies));else assert.equal((await runProductionEmojiPublication(options,dependencies)).state,'readback_verified');
  const saved=JSON.parse(await fs.readFile(journal,'utf8'));
  assert.equal(mutations,fault==='wrong-binding'?0:1);assert.equal(uploads,fault==='wrong-binding'?0:1);assert.equal(removed,fault!=='wrong-binding');
  if(fault==='lost-ack'){assert.equal(saved.failure,'acknowledgement_unknown');assert.equal(saved.gatewayRemoved,true);}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

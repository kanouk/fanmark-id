import {STAGING_EMOJI_PUBLICATION_TARGETS,resolveStagingEmojiTarget} from './staging-emoji-targets.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {buildRelease} from '../build-emoji-release.ts';
import {parsePublicationArguments,runStagingEmojiPublication} from './staging-emoji-publication.mjs';
const old='a'.repeat(64),runtime='00000000-0000-4000-8000-000000000012';
const records=[{id:'00000000-0000-4000-8000-000000000001',emoji:'😀',short_name:'face',keywords:['face'],category:'People',subcategory:null,codepoints:['1F600'],sort_order:1}];
const identity={email:'fanmark.id@gmail.com',accounts:[{id:'bfc2890741f0b3fb236e2d755b6c9adc'}]};
test('argument parsing refuses arbitrary targets, duplicate flags and invalid generation/action',()=>{
 const args=['--action','stage','--journal','/private/run.json','--release-directory','/private/artifact','--expected-active',old,'--expected-generation','1'];
 assert.equal(parsePublicationArguments(args).expectedGeneration,1);
 for(const extra of [['--database-id','other'],['--action','rollback']])assert.throws(()=>parsePublicationArguments([...args,...extra]));
 assert.throws(()=>parsePublicationArguments(args.map(v=>v==='1'?'0':v)));assert.throws(()=>parsePublicationArguments(['--action','execute-sql','--journal','x']));
});
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fanmark-publication-'));const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify(records));const release=await buildRelease(input,path.join(dir,'releases'));return {dir,releaseDirectory:release.directory,version:release.version};}
function transport(version,{wrongTarget=false,loseAck=false,profile=STAGING_EMOJI_PUBLICATION_TARGETS[0]}={}){
 let mutations=0,removed=false,staged=false;const j={};
 const response=(value,status=200)=>Response.json(value,{status});
 return {get mutations(){return mutations;},get removed(){return removed;},async fetch(url,options={}){
  const u=new URL(url),method=options.method??'GET';
  assert.ok(!u.pathname.includes('/d1/'),'publisher never writes D1 directly');
  if(u.hostname==='api.cloudflare.com'){
   if(u.pathname.endsWith('/deployments'))return response({success:true,result:{deployments:[{versions:[{version_id:runtime,percentage:100}]}]}});
   if(u.pathname.endsWith('fanmark-app-staging/settings'))return response({success:true,result:{bindings:[{name:'MASTER_DB',id:wrongTarget?'other':profile.masterId},{name:'D1_TOPOLOGY',text:'split'},{name:'RECOVERY_DRAIN_SCOPE_DIGEST',text:profile.scope},{name:'EMOJI_PUBLICATION_BACKEND',text:'staging-service'}]}});
   if(method==='PUT'){assert.ok(options.body instanceof FormData);return response({success:true,result:{}});}
   if(method==='POST')return response({success:true,result:{}});
   if(method==='DELETE'){removed=true;return response({success:true,result:{}});}
   return response({success:false},404);
  }
  if(u.pathname==='/status')return response({runtimeVersion:runtime,active:{release_version:old,generation:1},publication:staged?{status:'ready',release_version:version,row_count:1}:null,event:null,writers:{active:0}});
  assert.equal(u.pathname,'/stage');assert.equal(method,'POST');mutations++;const body=JSON.parse(options.body);j.operationId=body.activationId;staged=true;
  if(loseAck)throw new Error('synthetic transport acknowledgement loss');return response({runtimeVersion:runtime,version,status:'ready'});
 }};
}
test('stages once through the fixed service and reads back state; only its owned gateway is removed',async()=>{
 const f=await fixture(),t=transport(f.version);const journal=path.join(f.dir,'operation.json');
 try{const result=await runStagingEmojiPublication({action:'stage',releaseDirectory:f.releaseDirectory,expectedActive:old,expectedGeneration:1,journal},{identity,token:'synthetic-token-only-123456789',fetch:t.fetch,sleep:async()=>{}});
 assert.equal(result.state,'readback_verified');assert.equal(t.mutations,1);assert.equal(t.removed,true);assert.equal((await fs.stat(journal)).mode&0o777,0o600);
 await assert.rejects(runStagingEmojiPublication({action:'stage',releaseDirectory:f.releaseDirectory,expectedActive:old,expectedGeneration:1,journal},{identity,token:'synthetic-token-only-123456789',fetch:t.fetch}));assert.equal(t.mutations,1);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('lost mutation acknowledgement never replays, retains the journal, and removes the gateway',async()=>{
 const f=await fixture(),t=transport(f.version,{loseAck:true});const journal=path.join(f.dir,'operation.json');
 try{await assert.rejects(runStagingEmojiPublication({action:'stage',releaseDirectory:f.releaseDirectory,expectedActive:old,expectedGeneration:1,journal},{identity,token:'synthetic-token-only-123456789',fetch:t.fetch,sleep:async()=>{}}));
 const j=JSON.parse(await fs.readFile(journal,'utf8'));assert.equal(j.failure,'acknowledgement_unknown');assert.equal(j.gatewayRemoved,true);assert.equal(t.mutations,1);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('wrong Master target refuses before upload or mutation',async()=>{
 const f=await fixture(),t=transport(f.version,{wrongTarget:true});
 try{await assert.rejects(runStagingEmojiPublication({action:'stage',releaseDirectory:f.releaseDirectory,expectedActive:old,expectedGeneration:1,journal:path.join(f.dir,'operation.json')},{identity,token:'synthetic-token-only-123456789',fetch:t.fetch}));assert.equal(t.mutations,0);assert.equal(t.removed,false);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});

test('fixed profiles refuse mixed cohorts and unknown targets',()=>{
 const [oldTarget,fresh]=STAGING_EMOJI_PUBLICATION_TARGETS;
 assert.equal(resolveStagingEmojiTarget(fresh.masterId,fresh.scope).entrypoint,'EmojiMasterPublicationServiceV3');
 for(const [id,scope]of [[fresh.masterId,oldTarget.scope],[oldTarget.masterId,fresh.scope],['other',fresh.scope]])assert.throws(()=>resolveStagingEmojiTarget(id,scope),/target_mismatch/);
});
test('V3 live metadata selects the V3 service entrypoint with one mutation and owned cleanup',async()=>{
 const f=await fixture(),profile=STAGING_EMOJI_PUBLICATION_TARGETS[1],t=transport(f.version,{profile});let entrypoint;
 const fetcher=async(url,init)=>{if(init?.method==='PUT'&&init.body instanceof FormData)entrypoint=JSON.parse(init.body.get('metadata')).bindings.find(x=>x.name==='PUBLICATION').entrypoint;return t.fetch(url,init);};
 try {const journal=path.join(f.dir,'v3-operation.json');const result=await runStagingEmojiPublication({action:'stage',releaseDirectory:f.releaseDirectory,expectedActive:old,expectedGeneration:1,journal},{identity,token:'synthetic-token-only-123456789',fetch:fetcher,sleep:async()=>{}});
 assert.equal(result.state,'readback_verified');assert.equal(entrypoint,profile.entrypoint);assert.equal(t.mutations,1);assert.equal(t.removed,true);assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).masterId,profile.masterId);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});

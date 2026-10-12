#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRelease} from '../build-emoji-release.ts';
import {resolveStagingEmojiTarget} from './staging-emoji-targets.mjs';
import {verifyEmojiReleasePayload} from '../../workers/api/src/emoji-release-artifact.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const WORKERS=path.join(ROOT,'workers/api'),CONFIG=path.join(WORKERS,'wrangler.app-staging.jsonc');
const ACCOUNT='bfc2890741f0b3fb236e2d755b6c9adc';
const HASH=/^[a-f0-9]{64}$/u,VERSION=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
function check(condition,code){if(!condition)throw new Error(code);}
export function parsePublicationArguments(argv){
 const values={};for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];
  check(['--action','--release-directory','--expected-active','--expected-generation','--journal','--version','--activation-id'].includes(key)&&typeof value==='string'&&!value.startsWith('--')&&!Object.hasOwn(values,key),'arguments_invalid');values[key]=value;}
 check(['stage','promotion','rollback','status'].includes(values['--action'])&&values['--journal'],'arguments_invalid');
 if(values['--action']==='status')check(values['--release-directory']===undefined&&values['--expected-active']===undefined&&values['--expected-generation']===undefined,'arguments_invalid');
 if(values['--action']!=='status')check(values['--release-directory']&&HASH.test(values['--expected-active']??'')&&/^[1-9]\d*$/u.test(values['--expected-generation']??''),'arguments_invalid');
 const generation=Number(values['--expected-generation']);if(values['--action']!=='status')check(Number.isSafeInteger(generation),'arguments_invalid');
 if(values['--version'])check(values['--action']==='status'&&HASH.test(values['--version']),'arguments_invalid');
 if(values['--activation-id'])check(values['--action']==='status'&&VERSION.test(values['--activation-id']),'arguments_invalid');
 return {action:values['--action'],releaseDirectory:values['--release-directory'],expectedActive:values['--expected-active'],expectedGeneration:generation,journal:path.resolve(values['--journal']),inspectVersion:values['--version'],inspectActivationId:values['--activation-id']};
}
function cli(args){return JSON.parse(execFileSync('npx',['--yes','wrangler@4.139.0',...args,'--config',CONFIG],{cwd:WORKERS,encoding:'utf8',timeout:60000,maxBuffer:2e6,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'}}));}
export async function runStagingEmojiPublication(options,dependencies={}){
 check(process.versions.node==='22.6.0','node_version_mismatch');
 const fetcher=dependencies.fetch??fetch;
 let artifact,version=options.inspectVersion;
 if(options.action!=='status'){
  const verified=await verifyRelease(options.releaseDirectory);version=verified.version;
  artifact={recordsSource:await fs.readFile(path.join(options.releaseDirectory,'records.json'),'utf8'),moduleSource:await fs.readFile(path.join(options.releaseDirectory,'emojiCatalog.ts'),'utf8'),manifest:JSON.parse(await fs.readFile(path.join(options.releaseDirectory,'manifest.json'),'utf8'))};
  check(HASH.test(version),'release_invalid');
  await verifyEmojiReleasePayload(artifact);
 }
 const operationId=randomUUID(),name='fanmark-master-publish-'+operationId.slice(0,8),bearer=randomBytes(32).toString('hex');
 const journal={state:'prepared',action:options.action,operationId,name,bearer,targetVersion:version,accountId:ACCOUNT,expectedActive:options.expectedActive,expectedGeneration:options.expectedGeneration};
 await fs.writeFile(options.journal,JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600});
 const save=()=>fs.writeFile(options.journal,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
 const who=dependencies.identity??cli(['whoami','--json']);check(who.email==='fanmark.id@gmail.com'&&who.accounts?.some(a=>a.id===ACCOUNT),'account_mismatch');
 const token=dependencies.token??cli(['auth','token','--json']).token;check(typeof token==='string'&&token.length>20,'credential_unavailable');
 const base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
 const api=async(resource,method='GET',body)=>{const r=await fetcher(base+resource,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});const e=await r.json();check(e.success===true,'control_plane_request_failed');return e.result;};
 const currentVersion=async()=>{const d=await api('/workers/scripts/fanmark-app-staging/deployments');const versions=d.deployments[0]?.versions;check(versions?.length===1&&versions[0].percentage===100&&VERSION.test(versions[0].version_id),'deployment_mismatch');return versions[0].version_id;};
 const settings=await api('/workers/scripts/fanmark-app-staging/settings');const binding=n=>settings.bindings.find(b=>b.name===n);
 const target=resolveStagingEmojiTarget(binding('MASTER_DB')?.id,binding('RECOVERY_DRAIN_SCOPE_DIGEST')?.text);
 check(binding('D1_TOPOLOGY')?.text==='split'&&binding('EMOJI_PUBLICATION_BACKEND')?.text==='staging-service','target_mismatch');
 journal.masterId=target.masterId;journal.targetProfile=target.name;journal.scope=target.scope;
 journal.runtimeVersion=await currentVersion();
 const resource='/workers/scripts/'+name,headers={authorization:'Bearer '+token};
 const absent=await fetcher(base+resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});check(absent.status===404,'gateway_already_exists');await absent.body?.cancel();
 let uploaded=false;
 try{
  const allowed=options.action==='status'?null:'/'+options.action;
  const code=`export default {async fetch(r,e){if(r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return new Response(null,{status:401});const u=new URL(r.url);if(!(r.method==='GET'&&u.pathname==='/status')&&!(r.method==='POST'&&u.pathname===${JSON.stringify(allowed)}&&!u.search))return new Response(null,{status:404});try{return await e.PUBLICATION.fetch(new Request('https://emoji-publication.internal'+u.pathname+u.search,{method:r.method,headers:{'content-type':'application/json','x-fanmark-publication-runtime':e.EXPECTED_RUNTIME},...(r.method==='POST'?{body:r.body}:{})}));}catch{return Response.json({error:'gateway_unavailable'},{status:503});}}};`;
  const form=new FormData();form.set('metadata',JSON.stringify({main_module:'index.mjs',compatibility_date:'2026-09-18',bindings:[{type:'service',name:'PUBLICATION',service:'fanmark-app-staging',entrypoint:target.entrypoint},{type:'secret_text',name:'GATE_TOKEN',text:bearer},{type:'plain_text',name:'EXPECTED_RUNTIME',text:journal.runtimeVersion}]}));form.set('index.mjs',new Blob([code],{type:'application/javascript+module'}),'index.mjs');
  journal.state='gateway_upload_requested';await save();uploaded=true;await api(resource,'PUT',form);await api(resource+'/subdomain','POST',{enabled:true});
  const url=`https://${name}.fanmark-id.workers.dev`;
  const query=new URLSearchParams();if(version)query.set('version',version);if(options.inspectActivationId||version)query.set('activationId',options.inspectActivationId??operationId);
  const status=async()=>{const r=await fetcher(url+'/status'+(query.size?'?'+query.toString():''),{headers:{authorization:'Bearer '+bearer},redirect:'error',signal:AbortSignal.timeout(30000)});check(r.status===200,'publication_status_unavailable');const s=await r.json();check(s.runtimeVersion===journal.runtimeVersion,'runtime_mismatch');return s;};
  let before,lastError;for(let attempt=0;attempt<12;attempt++){try{before=await status();break;}catch(error){lastError=error;if(attempt<11)await (dependencies.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(3000);}}
  if(!before)throw lastError;journal.before=before;
  if(options.action==='status'){journal.state='readback_verified';journal.after=before;}
  else{
   check(before.active?.release_version===options.expectedActive&&before.active?.generation===options.expectedGeneration,'activation_precondition_failed');
   journal.state='mutation_requested';await save();
   const response=await fetcher(url+'/'+options.action,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:JSON.stringify({artifact,activationId:operationId,expectedActive:options.expectedActive,expectedGeneration:options.expectedGeneration}),redirect:'error',signal:AbortSignal.timeout(180000)});
   // Exactly one mutation request. An uncertain acknowledgement never replays it.
   journal.responseStatus=response.status;journal.state='response_received';await save();
   check(response.status===200,'publication_acknowledgement_unaccepted');journal.result=await response.json();check(journal.result.runtimeVersion===journal.runtimeVersion&&journal.result.version===version,'publication_result_mismatch');
   await save();const after=await status();journal.after=after;
   if(options.action==='stage')check(after.publication?.status==='ready'&&after.publication.release_version===version&&after.publication.row_count===artifact.manifest.entryCount&&after.active.release_version===options.expectedActive&&after.active.generation===options.expectedGeneration,'stage_readback_mismatch');
   else if(journal.result.changed===false)check(options.action==='promotion'&&after.active.release_version===version&&after.active.generation===options.expectedGeneration&&after.active.activation_id===before.active.activation_id&&after.event===null,'activation_readback_mismatch');
   else check(after.active.release_version===version&&after.event?.activation_id===operationId&&after.event.from_version===options.expectedActive&&after.event.to_version===version&&after.event.action===options.action&&after.event.generation===options.expectedGeneration+1,'activation_readback_mismatch');
   journal.state='readback_verified';
  }
  check(await currentVersion()===journal.runtimeVersion,'runtime_mismatch');const finalSettings=await api('/workers/scripts/fanmark-app-staging/settings');check(finalSettings.bindings.find(b=>b.name==='MASTER_DB')?.id===target.masterId&&finalSettings.bindings.find(b=>b.name==='RECOVERY_DRAIN_SCOPE_DIGEST')?.text===target.scope,'target_mismatch');await save();
 }catch(error){journal.failure=journal.state==='mutation_requested'?'acknowledgement_unknown':'requires_inspection';await save();throw error;}
 finally{
  if(uploaded){journal.cleanupRequested=true;await save();try{await api(resource,'DELETE');}catch{/* Read back once; never blindly re-delete an uncertain acknowledgement. */}
   const gone=await fetcher(base+resource,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});journal.gatewayRemoved=gone.status===404;await gone.body?.cancel();await save();check(journal.gatewayRemoved,'gateway_cleanup_requires_inspection');}
 }
 return {state:journal.state,action:journal.action,runtimeVersion:journal.runtimeVersion,operationId,targetVersion:version,gatewayRemoved:journal.gatewayRemoved,
  active:journal.after.active,publication:journal.after.publication,event:journal.after.event,sourceUserDataMigrated:false,domainChanged:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 process.umask(0o077);try{console.log(JSON.stringify(await runStagingEmojiPublication(parsePublicationArguments(process.argv.slice(2)))));}catch{console.error('staging_emoji_publication_failed; inspect the private operation journal before any retry');process.exitCode=1;}
}

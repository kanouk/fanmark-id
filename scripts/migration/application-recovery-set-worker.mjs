/** New owned rehearsal only: actual app + native coordinator and recovery primitives. */
import application, {RecoveryWriterCoordinator} from '../../workers/api/src/index.ts';
import {claimRecoveryWriterFence,assertRecoveryWriterFence,releaseRecoveryWriterFence} from '../../workers/api/src/recovery-writer-drain.ts';
import {collectRecoverySet,restoreRecoverySet,openRecoverySet,RECOVERY_SET_STORES as stores} from '../../workers/api/src/recovery-set.ts';
import {openMasterRecoverySnapshot,restoreMasterRecoverySnapshot} from '../../workers/api/src/master-d1-recovery.ts';
import {d1RecoveryDigest} from '../../workers/api/src/d1-store-recovery.ts';
import {databaseRoles,bucketRoles,fixturePassword} from './application-recovery-set-contract.mjs';

const account='bfc2890741f0b3fb236e2d755b6c9adc',MAX_BODY=8*1024*1024;
const check=(condition,code)=>{if(!condition)throw Error('proof_'+code);};
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const ids=(receipt,prefix)=>Object.fromEntries(stores.map(store=>[store,
  ['avatars','covers'].includes(store)?receipt.buckets[prefix+'_'+store.toUpperCase()]:receipt.databases[prefix+'_'+store.toUpperCase()].id]));
function identity(env){
  if(env.PROOF_ACCOUNT!==account||!/^https:\/\/[^/]+$/u.test(env.PROOF_ORIGIN??'')||
    !/^[a-f0-9]{16}$/u.test(env.PROOF_NONCE??'')||!/^[a-f0-9]{40}$/u.test(env.PROOF_HEAD??'')||
    ['PROOF_TOKEN','PROOF_ARCHIVE_KEY','PROOF_MASTER_KEY','PROOF_SOURCE_SCOPE','PROOF_TARGET_SCOPE',
      'PROOF_MASTER_ARCHIVE_HASH','PROOF_MASTER_ROWS_HASH'].some(name=>!/^[a-f0-9]{64}$/u.test(env[name]??''))||
    !env.SOURCE_DRAIN||!env.TARGET_DRAIN)return null;
  const databases=Object.fromEntries(databaseRoles.map(role=>[role,{id:env[role+'_ID'],name:env[role+'_NAME']}]));
  const buckets=Object.fromEntries(bucketRoles.map(role=>[role,env[role+'_NAME']]));
  if(databaseRoles.some(role=>!env[role]||!/^[a-f0-9-]{36}$/u.test(databases[role].id??'')||
    databases[role].name!==`fanmark-recovery-${env.PROOF_NONCE}-${role.toLowerCase().replaceAll('_','-')}`)||
    bucketRoles.some(role=>!env[role]||buckets[role]!==`fanmark-recovery-${env.PROOF_NONCE}-${role.toLowerCase().replaceAll('_','-')}`))return null;
  return {account,nonce:env.PROOF_NONCE,head:env.PROOF_HEAD,origin:env.PROOF_ORIGIN,databases,buckets,
    scopes:{S:env.PROOF_SOURCE_SCOPE,T:env.PROOF_TARGET_SCOPE}};
}
function bindings(env,prefix,counts){
  return Object.fromEntries(stores.map(store=>{
    const native=env[prefix+'_'+store.toUpperCase()];if(!counts||['avatars','covers'].includes(store))return [store,native];
    const role=prefix+'_'+store.toUpperCase(),statements=new WeakMap();
    const count=n=>{counts[role]=(counts[role]??0)+n;check(Object.values(counts).reduce((a,b)=>a+b,0)<=1000,'query_limit');};
    const wrap=raw=>{const statement={bind:(...values)=>wrap(raw.bind(...values)),
      all:(...args)=>{count(1);return raw.all(...args);},run:(...args)=>{count(1);return raw.run(...args);},
      first:(...args)=>{count(1);return raw.first(...args);},raw:(...args)=>{count(1);return raw.raw(...args);}};
      statements.set(statement,raw);return statement;};
    const overrides={prepare:sql=>wrap(native.prepare(sql)),batch:items=>{
      const raw=items.map(item=>statements.get(item));check(raw.every(Boolean),'statement_binding');count(items.length);return native.batch(raw);
    },exec(){throw Error('proof_untracked_exec_forbidden');},withSession(){throw Error('proof_untracked_session_forbidden');}};
    // Better Auth recognizes native D1 by its full shape. Keep its prototype
    // and other native properties; do not turn it into a prepare/batch object.
    return [store,new Proxy(native,{get(target,name){if(name in overrides)return overrides[name];
      const value=Reflect.get(target,name);return typeof value==='function'&&name!=='constructor'?value.bind(target):value;}})];
  }));
}
function appEnv(env,receipt,prefix,counts){
  const db=bindings(env,prefix,counts);
  return {D1_TOPOLOGY:'split',AUTH_BACKEND:'better-auth',AUTH_USER_STATUS_BACKEND:'d1',BETTER_AUTH_SECRET:env.PROOF_SDK_SECRET,
    BETTER_AUTH_URL:receipt.origin,CORS_ALLOWED_ORIGINS:receipt.origin,EMOJI_CATALOG_BACKEND:'d1',REFERENCE_MASTER_BACKEND:'d1',
    AUTH_DB:db.auth,FANMARK_DB:db.business,MASTER_DB:db.master,AVATARS:db.avatars,COVERS:db.covers,
    RECOVERY_DRAIN_BACKEND:'durable-object',RECOVERY_DRAIN:prefix==='S'?env.SOURCE_DRAIN:env.TARGET_DRAIN,
    RECOVERY_DRAIN_SCOPE_DIGEST:receipt.scopes[prefix]};
}
export class SourceWriterCoordinator extends RecoveryWriterCoordinator {
  constructor(ctx,env){super(ctx,{...env,RECOVERY_DRAIN_BACKEND:'durable-object',RECOVERY_DRAIN:env.SOURCE_DRAIN,RECOVERY_DRAIN_SCOPE_DIGEST:env.PROOF_SOURCE_SCOPE});}
}
export class TargetWriterCoordinator extends RecoveryWriterCoordinator {
  constructor(ctx,env){super(ctx,{...env,RECOVERY_DRAIN_BACKEND:'durable-object',RECOVERY_DRAIN:env.TARGET_DRAIN,RECOVERY_DRAIN_SCOPE_DIGEST:env.PROOF_TARGET_SCOPE});}
}
async function appFetch(env,receipt,prefix,counts,pathname,options={}){
  const tasks=[];
  const response=await application.fetch(new Request(receipt.origin+pathname,options),appEnv(env,receipt,prefix,counts),{
    waitUntil:task=>tasks.push(task),passThroughOnException(){throw Error('proof_pass_through_forbidden');}});
  const outcomes=await Promise.allSettled(tasks);check(outcomes.every(result=>result.status==='fulfilled'),'app_background_failure');
  return response;
}
const login=(env,receipt,prefix,counts)=>appFetch(env,receipt,prefix,counts,'/api/auth/sign-in/email',{
  method:'POST',headers:{Origin:receipt.origin,'content-type':'application/json'},
  body:JSON.stringify({email:'synthetic-recovery-set@example.invalid',password:fixturePassword})});
async function importKey(hex,usages=['encrypt','decrypt']){
  const raw=Uint8Array.from(hex.match(/../gu),byte=>parseInt(byte,16));
  try{return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,usages);}finally{raw.fill(0);}
}
async function contextKey(env,receipt){return {context:{sourceIds:ids(receipt,'S'),keyId:'isolated-'+receipt.nonce,
  runtimeRevision:receipt.head,schemaHashes:JSON.parse(env.PROOF_SCHEMA_HASHES),authSecret:env.PROOF_SDK_SECRET},
  key:await importKey(env.PROOF_ARCHIVE_KEY)};}
function guard(env,receipt,prefix,owner){return {id:'application-'+receipt.nonce+'-'+prefix,async assertHeld(expected){
  check(JSON.stringify(expected)===JSON.stringify(ids(receipt,prefix)),'guard_identity');
  check(await d1RecoveryDigest(expected)===receipt.scopes[prefix],'guard_scope');
  await assertRecoveryWriterFence(appEnv(env,receipt,prefix),owner);
}};}
async function readBytes(request){
  const reader=request.body?.getReader();if(!reader)throw Error('proof_body_required');
  const chunks=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
    if(size>MAX_BODY){await reader.cancel();throw Error('proof_body_too_large');}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function bodyJson(request){const bytes=await readBytes(request);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw Error('proof_body_invalid');}finally{bytes.fill(0);}}
const claim=(env,name,value)=>env.CONTROL.put(name+'-claim.json',JSON.stringify(value),{onlyIf:{etagDoesNotMatch:'*'}});
const report=(env,name,value)=>env.CONTROL.put(name+'-status.json',JSON.stringify(value));
async function status(env,name){const object=await env.CONTROL.get(name+'-status.json');return object?await object.json():null;}
const safeError=error=>/^(proof|recovery_set|recovery_writer|master_recovery|auth_recovery|business_recovery|r2_recovery)_[a-z_]{1,80}$/u.test(error?.message??'')?error.message:'proof_unclassified_failure';
async function cookieFile(env,receipt,key,cookie){
  const aad=new TextEncoder().encode('application-old-cookie:'+await d1RecoveryDigest(receipt));
  if(cookie!==undefined){const nonce=crypto.getRandomValues(new Uint8Array(12)),bytes=new TextEncoder().encode(cookie);
    try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad},key,bytes);
      check(await env.CONTROL.put('cookie.json',JSON.stringify({nonce:[...nonce],ciphertext:[...new Uint8Array(ciphertext)]}),{onlyIf:{etagDoesNotMatch:'*'}}),'cookie_claim');
    }finally{bytes.fill(0);}return;}
  const object=await env.CONTROL.get('cookie.json');check(object,'cookie_missing');const saved=await object.json();
  const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(saved.nonce),additionalData:aad},key,new Uint8Array(saved.ciphertext)));
  try{return new TextDecoder().decode(bytes);}finally{bytes.fill(0);}
}

export default {async fetch(request,env){
  const receipt=identity(env);if(!receipt)return json({error:'proof_unconfigured'},503);
  if(request.headers.get('authorization')!==`Bearer ${env.PROOF_TOKEN}`)return json({error:'unauthorized'},401);
  if(request.headers.get('x-proof-nonce')!==receipt.nonce)return json({error:'target_mismatch'},403);
  const url=new URL(request.url);if(url.search||url.origin!==receipt.origin)return json({error:'invalid_request'},400);
  if(url.pathname==='/_proof/identity'&&request.method==='GET')return json(receipt);
  if(url.pathname==='/_proof/status'&&request.method==='GET')return json({identity:receipt,phases:Object.fromEntries(await Promise.all(['initialize','collect','restore'].map(async phase=>[phase,await status(env,phase)])))});
  if(url.pathname==='/_proof/archive'&&request.method==='GET'){
    if((await status(env,'collect'))?.state!=='verified')return json({error:'archive_not_verified'},409);
    return json({identity:receipt,archive:await (await env.CONTROL.get('archive.json')).json()});
  }
  const phase={'/_proof/initialize':'initialize','/_proof/collect':'collect','/_proof/restore':'restore'}[url.pathname];
  if(phase&&request.method==='POST'){
    if(phase==='collect'&&(await status(env,'initialize'))?.state!=='verified'||phase==='restore'&&(await status(env,'collect'))?.state!=='verified')return json({error:'source_not_verified'},409);
    let input;
    try{
      if(phase==='initialize'){
        const bytes=await readBytes(request);try{
          const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
          check(hash===env.PROOF_MASTER_ARCHIVE_HASH,'master_archive_mismatch');input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        }finally{bytes.fill(0);}
      }else if(phase==='restore'){
        input=await bodyJson(request);const saved=await env.CONTROL.get('archive.json');
        check(saved&&await d1RecoveryDigest(input)===await d1RecoveryDigest(await saved.json()),'archive_mismatch');
      }else if(request.body){const reader=request.body.getReader();try{
        for(;;){const next=await reader.read();if(next.done)break;if(next.value.byteLength){await reader.cancel();throw Error('proof_body_invalid');}}
      }finally{reader.releaseLock();}}
    }catch(error){return json({error:safeError(error)},error.message==='proof_body_too_large'?413:400);}
    const owner=crypto.randomUUID();if(!await claim(env,phase,{identity:receipt,owner}))return json({error:'already_claimed'},409);
    let value={state:'in_progress',startedAt:new Date().toISOString(),d1Queries:{},progress:[]};await report(env,phase,value);
    try{
      if(phase==='initialize'){
        const pins=JSON.parse(env.PROOF_SCHEMA_HASHES),snapshot=await openMasterRecoverySnapshot(input,await importKey(env.PROOF_MASTER_KEY,['decrypt']),pins.master);
        check(snapshot.rowsHash===env.PROOF_MASTER_ROWS_HASH&&Object.values(snapshot.tables).reduce((n,rows)=>n+rows.length,0)===Number(env.PROOF_MASTER_ROWS),'master_rows_mismatch');
        await restoreMasterRecoverySnapshot(bindings(env,'S',value.d1Queries).master,snapshot,pins.master);
        value={...value,masterRows:Number(env.PROOF_MASTER_ROWS),masterSchemaHash:snapshot.schemaHash,masterRowsHash:snapshot.rowsHash};
      }else if(phase==='collect'){
        for(const role of bucketRoles.filter(role=>role!=='CONTROL')){const page=await env[role].list();check(!page.truncated&&!page.objects.length,'bucket_not_empty');}
        const signedIn=await login(env,receipt,'S',value.d1Queries);
        if(signedIn.status!==200){value.sourceLoginStatus=signedIn.status;const body=await signedIn.json();
          if(/^[a-z_]{1,80}$/u.test(body.error??''))value.sourceLoginError=body.error;throw Error('proof_source_login');}
        check((await signedIn.json()).user.id==='90000000-0000-4000-8000-000000000001','source_user');
        const cookies=typeof signedIn.headers.getSetCookie==='function'?signedIn.headers.getSetCookie():signedIn.headers.getAll('Set-Cookie');
        const cookie=cookies.map(value=>value.split(';')[0]).join('; ');check(cookie,'source_cookie');
        const {context,key}=await contextKey(env,receipt);await cookieFile(env,receipt,key,cookie);
        for(const prefix of ['S','T']){
          const state=await claimRecoveryWriterFence(appEnv(env,receipt,prefix),owner);check(state.drained,'not_drained');
          check((await login(env,receipt,prefix,value.d1Queries)).status===503,'held_login');
          let refused=false;try{await releaseRecoveryWriterFence(appEnv(env,receipt,prefix),crypto.randomUUID());}catch{refused=true;}check(refused,'wrong_owner');
        }
        const archive=await collectRecoverySet(bindings(env,'S',value.d1Queries),context,key,guard(env,receipt,'S',owner));
        const opened=await openRecoverySet(archive,context,key);check(opened.snapshots.auth.tables.session.length===2,'source_sessions');
        check(await env.CONTROL.put('archive.json',JSON.stringify(archive),{onlyIf:{etagDoesNotMatch:'*'}}),'archive_claim');
        value={...value,captureId:opened.manifest.captureId,parts:opened.manifest.parts,sourceAuthSessions:2,
          normalSdkSourceLogin:true,heldSourceAndTargetLoginRefused:true,wrongOwnerReleaseRefused:true};
      }else{
        const saved=await env.CONTROL.get('collect-claim.json');check(saved,'collect_claim_missing');const sourceOwner=(await saved.json()).owner;
        const {context,key}=await contextKey(env,receipt),opened=await openRecoverySet(input,context,key),targets=bindings(env,'T',value.d1Queries);
        const result=await restoreRecoverySet(targets,input,context,key,{mode:'new-empty',sessionPolicy:'revoke-local-sessions-and-challenges',
          targetIds:ids(receipt,'T'),targetGuard:guard(env,receipt,'T',sourceOwner),progress:async entry=>{value.progress.push(entry);await report(env,phase,value);}});
        check(await targets.auth.prepare('SELECT count(*) AS n FROM session').first('n')===0&&
          await targets.auth.prepare('SELECT count(*) AS n FROM verification').first('n')===0,'revocation');
        check(await targets.auth.prepare('SELECT password FROM account').first('password')===opened.snapshots.auth.tables.account[0].password,'credential');
        check((await login(env,receipt,'T',value.d1Queries)).status===503,'held_target_login');
        await releaseRecoveryWriterFence(appEnv(env,receipt,'T'),sourceOwner);
        const oldSession=await appFetch(env,receipt,'T',value.d1Queries,'/api/auth/get-session',{headers:{cookie:await cookieFile(env,receipt,key)}});
        check(oldSession.status===200&&await oldSession.json()===null,'old_session');
        const targetLogin=await login(env,receipt,'T',value.d1Queries);check(targetLogin.status===200,'target_login');
        check((await targetLogin.json()).user.id==='90000000-0000-4000-8000-000000000001','target_user');
        check(await targets.auth.prepare('SELECT count(*) AS n FROM session').first('n')===1,'target_session');
        const catalogCounts={};
        if(Number(env.PROOF_CATALOG_ROWS)>0){
          let offset=0,version;const catalogIds=new Set();
          do{const query=new URL('/api/emoji/catalog',receipt.origin);query.searchParams.set('offset',String(offset));if(version)query.searchParams.set('version',version);
            const response=await appFetch(env,receipt,'T',value.d1Queries,query.pathname+query.search);check(response.status===200,'catalog_read');
            const page=await response.json();check(page.total===Number(env.PROOF_CATALOG_ROWS)&&page.offset===offset&&(!version||page.version===version),'catalog_page');version=page.version;
            for(const item of page.items){check(!catalogIds.has(item.id),'catalog_duplicate');catalogIds.add(item.id);}
            check(catalogIds.size<=Number(env.PROOF_CATALOG_ROWS)&&(page.nextOffset===null||page.nextOffset>offset),'catalog_progress');offset=page.nextOffset;
          }while(offset!==null);
          check(catalogIds.size===Number(env.PROOF_CATALOG_ROWS),'catalog_count');catalogCounts.canonicalEmojiCount=catalogIds.size;
          catalogCounts.referenceViewCounts={};
          for(const [name,n] of Object.entries(JSON.parse(env.PROOF_REFERENCE_COUNTS))){const response=await appFetch(env,receipt,'T',value.d1Queries,'/api/reference-masters/'+name);
            check(response.status===200,'reference_read');const body=await response.json();check(body.items.length===n,'reference_count');catalogCounts.referenceViewCounts[name]=body.items.length;}
        }
        for(const store of ['auth','business','master']){const foreignKeys=await targets[store].prepare('PRAGMA foreign_key_check').all();check(foreignKeys.success===true&&foreignKeys.results.length===0,'foreign_key');}
        await releaseRecoveryWriterFence(appEnv(env,receipt,'S'),sourceOwner);
        let captureRefused=false;try{await collectRecoverySet(bindings(env,'S',value.d1Queries),context,key,guard(env,receipt,'S',sourceOwner));}
        catch(error){captureRefused=error.message==='recovery_set_guard_lost';}check(captureRefused,'released_guard');
        value={...value,result,...catalogCounts,credentialBytesRetained:true,sessionChallengesRevoked:true,oldSessionRejected:true,normalSdkTargetLogin:true,releasedGuardRefusesCapture:true,foreignKeyViolations:0};
      }
      value.state='verified';
    }catch(error){value={...value,state:'failed',error:safeError(error)};}
    value.finishedAt=new Date().toISOString();await report(env,phase,value);return json({identity:receipt,report:value});
  }
  if(url.pathname==='/_proof/inventory'&&request.method==='GET'){
    const objects={};for(const role of bucketRoles){const page=await env[role].list();objects[role]={keys:page.objects.map(o=>o.key),truncated:page.truncated};}return json({identity:receipt,objects});
  }
  if(url.pathname==='/_proof/objects'&&request.method==='DELETE'){
    for(const phase of ['initialize','collect','restore']){const state=await status(env,phase);if(await env.CONTROL.head(phase+'-claim.json')&&!state||state&&!['verified','failed'].includes(state.state))return json({error:'phase_not_terminal'},409);}
    const allowed=['initialize','collect','restore'].flatMap(phase=>[phase+'-claim.json',phase+'-status.json']).concat(['archive.json','cookie.json']);
    const listed=[];for(const role of bucketRoles){const page=await env[role].list();if(page.truncated||page.objects.some(o=>role!=='CONTROL'||!allowed.includes(o.key)))return json({error:'unowned_object'},409);listed.push([role,page.objects.map(o=>o.key)]);}
    for(const [role,keys] of listed)if(keys.length)await env[role].delete(keys);
    for(const role of bucketRoles){const page=await env[role].list();check(!page.truncated&&!page.objects.length,'cleanup_incomplete');}return json({identity:receipt,bucketsEmpty:true});
  }
  return json({error:'route_unavailable'},404);
}};

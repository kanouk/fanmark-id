import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {checkOwnUsernameAvailability,loadOwnProfile,resolveOwnProfileAuth,updateOwnProfile} from '../../src/lib/profile-api.ts';

// Explicit local integration harness. Never accepts an external Supabase URL,
// existing resource name or credential; all services/data/secrets are owned.
const run=promisify(execFile),nonce=randomUUID();
const label='dev.codex.fanmark-legacy-run',networkName='fanmark-legacy-'+nonce;
const images={postgres:'postgres:17.6-alpine',auth:'supabase/gotrue:v2.196.0',rest:'postgrest/postgrest:v14.17'};
const sourceOrigin='https://legacy-fixture.example.test',appOrigin='https://app.example.test';
const resultFile=process.argv[2];
assert.ok(resultFile && path.isAbsolute(resultFile),'An absolute result path is required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=await mkdtemp(path.join(os.tmpdir(),'fanmark-legacy-owned-'));
process.umask(0o077);
const secret=randomBytes(32).toString('hex'),dbPassword=randomBytes(32).toString('hex');
const password='Owned-fixture-'+randomBytes(16).toString('hex');
const names=Object.fromEntries(Object.keys(images).map(role=>[role,'fanmark-legacy-'+role+'-'+nonce]));
let mf,proofError;
const report={state:'started',startedAt:new Date().toISOString(),nonce,images,syntheticOnly:true,
  sourceUsersMoved:false,sourceProductionRequests:false,domainChanged:false,checks:[],cleanupVerified:false};
async function docker(args){return (await run('docker',args,{maxBuffer:4*1024*1024,timeout:180000})).stdout.trim();}
const before=(await docker(['ps','-aq','--no-trunc'])).split('\n').filter(Boolean).sort();
function jwt(role){const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const data=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,aud:'authenticated',iss:sourceOrigin+'/auth/v1',exp:Math.floor(Date.now()/1000)+3600});
  return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
const anon=jwt('anon'),service=jwt('service_role');
async function environment(role,entries){const f=path.join(directory,role+'.env');await writeFile(f,Object.entries(entries).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});return f;}
async function port(name,key){for(let attempt=0;attempt<30;attempt++){
  const info=JSON.parse(await docker(['inspect',name]))[0];assert.equal(info.Config.Labels[label],nonce);
  const p=info.NetworkSettings.Ports?.[key];
  if(p){assert.equal(p.length,1);assert.equal(p[0].HostIp,'127.0.0.1');return Number(p[0].HostPort);}
  if(info.State.Status==='exited'){
    const log=await run('docker',['logs','--tail','12',name],{maxBuffer:128*1024});
    let diagnostic=log.stdout+log.stderr;
    for(const value of [secret,dbPassword,password,anon,service])diagnostic=diagnostic.replaceAll(value,'[owned-fixture-secret]');
    report.serviceFailure={name,status:info.State.Status,exitCode:info.State.ExitCode,diagnostic:diagnostic.slice(-6000)};
    throw Error('owned_service_exited_'+info.State.ExitCode);
  }
  await new Promise(r=>setTimeout(r,500));
}throw Error('owned_service_port_not_ready');}
async function health(url){for(let i=0;i<120;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('owned_service_not_ready');}
async function sql(text){await new Promise((resolve,reject)=>{const child=execFile('docker',['exec','-i',names.postgres,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q'],{maxBuffer:1024*1024},error=>error?reject(error):resolve());child.stdin.end(text);});}
async function authRequest(base,route,body,token){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});if(!response.ok)report.authFailure={route,status:response.status,body:await response.text()};assert.ok(response.ok,'Owned Auth request rejected: '+response.status);return response.json();}
function check(name){report.checks.push(name);console.log('verified: '+name);}
try{
  console.log('Preparing isolated Auth/PostgREST images');
  for(const image of Object.values(images))await docker(['pull',image]);
  report.imageDigests=Object.fromEntries(await Promise.all(Object.entries(images).map(async([role,image])=>[role,JSON.parse(await docker(['image','inspect',image]))[0].RepoDigests])));
  await docker(['network','create','--label',label+'='+nonce,networkName]);
  const pgEnv=await environment('postgres',{POSTGRES_PASSWORD:dbPassword});
  await docker(['run','-d','--name',names.postgres,'--label',label+'='+nonce,'--network',networkName,'--network-alias','pg','--env-file',pgEnv,images.postgres]);
  // The image's temporary init server can pass a Unix-socket readiness check
  // immediately before shutting down. Require the final TCP listener instead.
  for(let i=0;i<120;i++){try{await docker(['exec',names.postgres,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{if(i===119)throw Error('postgres_not_ready');await new Promise(r=>setTimeout(r,500));}}
  // Match Auth's official init_postgres.sh role/search_path prerequisites.
  await sql(`CREATE ROLE supabase_auth_admin LOGIN PASSWORD '${dbPassword}'; GRANT ALL PRIVILEGES ON DATABASE postgres TO supabase_auth_admin; CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin; ALTER ROLE supabase_auth_admin SET search_path=auth; CREATE EXTENSION pgcrypto; CREATE EXTENSION "uuid-ossp"; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;`);
  const authEnv=await environment('auth',{GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:sourceOrigin+'/auth/v1',
    GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://supabase_auth_admin:'+dbPassword+'@pg:5432/postgres',
    GOTRUE_SITE_URL:appOrigin,GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_ISSUER:sourceOrigin+'/auth/v1',GOTRUE_JWT_AUD:'authenticated',
    GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'3600',
    GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_DISABLE_SIGNUP:'false'});
  await docker(['run','-d','--name',names.auth,'--label',label+'='+nonce,'--network',networkName,'--env-file',authEnv,'-p','127.0.0.1::9999',images.auth]);
  const authBase='http://127.0.0.1:'+await port(names.auth,'9999/tcp');await health(authBase+'/health');
  report.authHealth=await authRequest(authBase,'/health');
  const owner=await authRequest(authBase,'/signup',{email:'owned-profile-owner@example.invalid',password});
  const foreign=await authRequest(authBase,'/signup',{email:'owned-profile-foreign@example.invalid',password});
  assert.match(owner.user.id,/^[0-9a-f-]{36}$/);assert.match(foreign.user.id,/^[0-9a-f-]{36}$/);
  const ownerId=owner.user.id,foreignId=foreign.user.id;
  await sql(`CREATE TABLE public.user_settings(id uuid PRIMARY KEY,user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,username text NOT NULL,display_name text,avatar_url text,plan_type text NOT NULL DEFAULT 'free',preferred_language text NOT NULL DEFAULT 'ja',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),requires_password_setup boolean NOT NULL DEFAULT false,stripe_customer_id text,invited_by_code text);
    ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    GRANT SELECT,UPDATE ON public.user_settings TO service_role;
    INSERT INTO public.user_settings(id,user_id,username,display_name,stripe_customer_id,invited_by_code) VALUES
      ('${randomUUID()}','${ownerId}','owner','Owner','owned-private-customer','owned-private-invitation'),
      ('${randomUUID()}','${foreignId}','foreign','Foreign','foreign-private-customer','foreign-private-invitation');
    CREATE FUNCTION public.check_username_availability_secure(username_to_check text,current_user_id uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$ SELECT CASE WHEN username_to_check IS NULL OR username_to_check='' THEN false ELSE NOT EXISTS(SELECT 1 FROM public.user_settings WHERE username=lower(username_to_check) AND user_id<>COALESCE(current_user_id,'00000000-0000-0000-0000-000000000000'::uuid)) END $$;
    GRANT EXECUTE ON FUNCTION public.check_username_availability_secure(text,uuid) TO service_role;`);
  const restEnv=await environment('rest',{PGRST_DB_URI:'postgres://postgres:'+dbPassword+'@pg:5432/postgres',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:'authenticated',PGRST_SERVER_PORT:'3000'});
  await docker(['run','-d','--name',names.rest,'--label',label+'='+nonce,'--network',networkName,'--env-file',restEnv,'-p','127.0.0.1::3000',images.rest]);
  const restBase='http://127.0.0.1:'+await port(names.rest,'3000/tcp');await health(restBase+'/');
  const compiled=await build({entryPoints:[path.join(root,'workers/api/src/index.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
  const vars={AUTH_BACKEND:'supabase',PROFILE_BACKEND:'supabase',SUPABASE_URL:sourceOrigin,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,CORS_ALLOWED_ORIGINS:appOrigin};
  let elevated=0;const events=[];report.outboundEvents=events;
  mf=new Miniflare({workers:[{config:{name:'owned-legacy-profile',type:'worker',compatibilityDate:'2026-09-18',compatibilityFlags:['nodejs_compat'],
    env:Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,{type:'text',value}])),
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',handler:async request=>{
      const u=new URL(request.url);assert.equal(u.origin,sourceOrigin);
      const auth=u.pathname==='/auth/v1/user',rest=u.pathname==='/rest/v1/user_settings'||u.pathname==='/rest/v1/rpc/check_username_availability_secure';
      assert.ok(auth||rest,'unexpected_upstream_path');if(rest)elevated++;
      const headers=new Headers(request.headers);assert.equal(headers.get('cookie'),null);
      // Node fetch owns HTTP framing; workerd's chunked proxy framing must not
      // be forwarded as an application header to the loopback transport.
      for(const name of ['transfer-encoding','content-length','connection','keep-alive','te','trailer','upgrade'])headers.delete(name);
      const event={kind:auth?'auth':'data',method:request.method,hasPrefer:headers.get('prefer')};events.push(event);
      let response;
      try{response=await fetch((auth?authBase+'/user':restBase+u.pathname.slice('/rest/v1'.length))+u.search,{method:request.method,headers,redirect:'manual',...(request.method==='GET'?{}:{body:await request.arrayBuffer()}),signal:AbortSignal.timeout(10000)});}
      catch(error){event.failure={name:error.name,message:error.message,cause:error.cause?.code};throw error;}
      event.status=response.status;event.contentType=response.headers.get('content-type');
      if(rest && !response.ok){const error=await response.clone().json().catch(()=>({}));report.upstreamFailures??=[];report.upstreamFailures.push({method:request.method,status:response.status,code:error.code,message:error.message});}
      return new Response(response.body,{status:response.status,headers:response.headers});
    }}}}]});
  const request=(token,route='/api/me/profile',init={})=>mf.dispatchFetch('https://api.example.test'+route,{...init,headers:{origin:appOrigin,...(token?{authorization:'Bearer '+token}:{}),...init.headers}});
  const auth=await resolveOwnProfileAuth(ownerId,false,async()=>({data:{session:{access_token:owner.access_token,user:{id:ownerId}}},error:null}));
  const options={...auth,baseUrl:'https://api.example.test',authBaseUrl:'https://api.example.test',fetchImpl:async(input,init)=>{
    const h=new Headers(init.headers);h.set('origin',appOrigin);assert.equal(init.credentials,'omit');const response=await mf.dispatchFetch(String(input),{...init,headers:h});if(!response.ok)report.workerFailure={method:init.method,status:response.status,body:await response.clone().json()};return response;}};
  const profile=await loadOwnProfile(options);assert.equal(profile.user_id,ownerId);assert.equal(profile.plan_type,'free');check('real Auth signature and frontend own profile');
  const updated=await updateOwnProfile({display_name:'Real adapter saved',preferred_language:'ko'},options);assert.equal(updated.display_name,'Real adapter saved');assert.equal(updated.preferred_language,'ko');check('real PostgREST service-role owner update');
  assert.equal(await checkOwnUsernameAvailability('OWNER',options),true);assert.equal(await checkOwnUsernameAvailability('FOREIGN',options),false);check('source RPC excludes only verified owner');
  const foreignProfile=await (await request(foreign.access_token)).json();assert.equal(foreignProfile.profile.display_name,'Foreign');check('foreign row retained');
  const elevatedBefore=elevated;
  const forged=owner.access_token.slice(0,owner.access_token.lastIndexOf('.')+1)+'Zm9yZ2Vk';
  assert.equal((await request(forged)).status,401);assert.equal((await request(service)).status,401);assert.equal((await request(null)).status,401);
  assert.equal(elevated,elevatedBefore);check('real Auth rejects forged token before elevated access');
  assert.equal((await request(owner.access_token,'/api/me/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({plan_type:'admin'})})).status,400);
  assert.equal((await request(owner.access_token,'/api/me/profile?user_id='+foreignId)).status,400);assert.equal(elevated,elevatedBefore);check('privilege and owner input rejected before data');
  const ban=await fetch(authBase+'/admin/users/'+ownerId,{method:'PUT',headers:{authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify({ban_duration:'1h'}),signal:AbortSignal.timeout(10000)});assert.ok(ban.ok);await ban.body?.cancel();
  assert.equal((await request(owner.access_token)).status,401);assert.equal(elevated,elevatedBefore);check('real Auth ban rejects prior access token');
  report.state='local_real_auth_postgrest_profile_verified';report.outboundEvents=events;report.httpAliasToLoopback=true;
  report.limitations=['Owned Auth v2.196.0/PostgREST fixture only; not live Supabase source version or rows','HTTPS alias is mapped to local HTTP ports solely by Miniflare test outboundService; not remote TLS proof','Reduced synthetic profile schema/RPC; not full source policy/trigger/schema parity','No rendered browser or Cloudflare remote deployment acceptance'];
}catch(error){proofError=error;report.state='failed';report.failure=error.name+': '+error.message;}
finally{
  try{if(mf)await mf.dispose();
    for(const name of Object.values(names).reverse()){
      let entries;try{entries=JSON.parse(await docker(['inspect',name]));}catch{continue;}
      assert.equal(entries[0].Config.Labels[label],nonce);await docker(['rm','-f','-v',entries[0].Id]);
    }
    let networks;try{networks=JSON.parse(await docker(['network','inspect',networkName]));}catch{}
    if(networks){const n=networks[0];assert.equal(n.Labels[label],nonce);await docker(['network','rm',networkName]);}
    const after=(await docker(['ps','-aq','--no-trunc'])).split('\n').filter(Boolean).sort();assert.deepEqual(after,before);
    assert.equal(await docker(['ps','-aq','--filter','label='+label+'='+nonce]),'');report.cleanupVerified=true;
  }catch(error){report.cleanupFailure=error.name+': '+error.message;proofError??=error;}
  await rm(directory,{recursive:true,force:true});report.finishedAt=new Date().toISOString();
  await writeFile(resultFile,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
}
console.log(JSON.stringify({state:report.state,checks:report.checks.length,cleanupVerified:report.cleanupVerified,resultFile}));
if(proofError)throw proofError;

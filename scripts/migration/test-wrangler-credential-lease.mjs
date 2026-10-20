import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createWranglerCredentialLease} from './wrangler-credential-lease.mjs';
const accountId='a'.repeat(32), instant=Date.parse('2026-10-20T00:00:00Z');
function encode(record,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return JSON.stringify({v:1,alg:'AES-256-GCM',iv:iv.toString('base64'),ciphertext:Buffer.concat([c.update(Buffer.from(record)),c.final()]).toString('base64'),tag:c.getAuthTag().toString('base64')});}
function decode(text,key){const p=JSON.parse(text),d=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));d.setAuthTag(Buffer.from(p.tag,'base64'));return Buffer.concat([d.update(Buffer.from(p.ciphertext,'base64')),d.final()]).toString();}
const initial='oauth_token = "synthetic_initial_access"\nexpiration_time = "2026-10-19T23:59:00Z"\nrefresh_token = "synthetic_initial_refresh"\nscopes = ["account:read", "d1:write",]\n';
async function fixture(fn){const directory=await mkdtemp(join(tmpdir(),'fanmark-lease-'));await chmod(directory,0o700);const key=randomBytes(32),profilePath=join(directory,'fanmark-staging-inapp.enc'),wranglerPackagePath=join(directory,'package.json');await writeFile(profilePath,encode(initial,key),{mode:0o600});await writeFile(wranglerPackagePath,JSON.stringify({version:'4.135.0'}));try{await fn({directory,key,profilePath,wranglerPackagePath,options:{accountId,profilePath,wranglerPackagePath,refreshDirectory:directory,readKey:()=>key,now:()=>instant}});}finally{await rm(directory,{recursive:true,force:true});}}
test('Wrangler renewal preserves scopes and rotated refresh grant durably without plaintext files',()=>fixture(async({options,directory,profilePath,key})=>{
  let requests=0;const adapter=await createWranglerCredentialLease({...options,fetchImpl:async(url,request)=>{if(request.method==='GET'){assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+accountId);return Response.json({success:true,result:{id:accountId}});}requests++;assert.equal(url,'https://dash.cloudflare.com/oauth2/token');assert.equal(new URLSearchParams(request.body).get('refresh_token'),'synthetic_initial_refresh');return Response.json({access_token:'synthetic_rotated_access',refresh_token:'synthetic_rotated_refresh',expires_in:3600,scope:'d1:write account:read'});}});
  try{const capability=await adapter.lease.acquire();assert.equal(capability.token,'synthetic_rotated_access');assert.equal(requests,1);assert.equal((await adapter.inspect()).remainingMs,3600000);const encrypted=await readFile(profilePath,'utf8');assert.ok(!encrypted.includes('synthetic_'));assert.match(decode(encrypted,key),/synthetic_rotated_refresh/);const files=await readdir(directory);assert.equal(files.filter(x=>x.endsWith('.intent.json')).length,1);assert.equal(files.filter(x=>x.endsWith('.verified.json')).length,1);assert.ok(!files.some(x=>x.endsWith('.lock')));for(const file of files)assert.ok(!(await readFile(join(directory,file),'utf8')).includes('synthetic_'));}finally{adapter.dispose();}
}));
for(const failure of ['lost-response','scope-change','concurrent-profile-change','bad-response'])test('Wrangler '+failure+' retains a non-replayable inspection lock',()=>fixture(async({options,directory,profilePath,key})=>{
  let requests=0;const adapter=await createWranglerCredentialLease({...options,fetchImpl:async()=>{requests++;if(failure==='lost-response')throw Error('private credential detail');if(failure==='concurrent-profile-change')await writeFile(profilePath,encode(initial+'\n',key),{mode:0o600});return Response.json(failure==='bad-response'?{access_token:'too-short',expires_in:3600}:{access_token:'synthetic_rotated_access',refresh_token:'synthetic_rotated_refresh',expires_in:3600,scope:failure==='scope-change'?'account:read':'account:read d1:write'});}});
  try{await assert.rejects(adapter.lease.acquire(),error=>!error.message.includes('private')&&!error.message.includes('synthetic'));await assert.rejects(adapter.lease.acquire());assert.equal(requests,1);assert.ok((await readdir(directory)).some(x=>x.endsWith('.fanmark-refresh.lock')));assert.match(decode(await readFile(profilePath,'utf8'),key),/synthetic_initial_refresh/);}finally{adapter.dispose();}
}));

test('new OAuth grant waits for an authenticated fixed account GET before admission, never repeats refresh POST',()=>fixture(async({options,profilePath,key})=>{
 let posts=0,reads=0;const adapter=await createWranglerCredentialLease({...options,fetchImpl:async(url,request)=>{
  if(request.method==='POST'){posts++;return Response.json({access_token:'synthetic_rotated_access',refresh_token:'synthetic_rotated_refresh',expires_in:3600,scope:'account:read d1:write'});}
  reads++;assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+accountId);return reads===1?Response.json({success:false,errors:[{code:10000}]},{status:401}):Response.json({success:true,result:{id:accountId}});
 }});try{const capability=await adapter.lease.acquire();assert.equal(capability.token,'synthetic_rotated_access');assert.equal(posts,1);assert.equal(reads,2);await adapter.lease.acquire();assert.equal(reads,2);}finally{adapter.dispose();}
}));
test('wrong account after durable profile replacement retains the rotated grant and inspection lock',()=>fixture(async({options,directory,profilePath,key})=>{
 let posts=0;const adapter=await createWranglerCredentialLease({...options,fetchImpl:async(url,request)=>{
  if(request.method==='POST'){posts++;return Response.json({access_token:'synthetic_rotated_access',refresh_token:'synthetic_rotated_refresh',expires_in:3600,scope:'account:read d1:write'});}
  return Response.json({success:true,result:{id:'b'.repeat(32)}});
 }});try{await assert.rejects(adapter.lease.acquire());await assert.rejects(adapter.lease.acquire());assert.equal(posts,1);assert.match(decode(await readFile(profilePath,'utf8'),key),/synthetic_rotated_refresh/);const names=await readdir(directory);assert.ok(names.some(n=>n.endsWith('.persisted.json')));assert.ok(names.some(n=>n.endsWith('.lock')));assert.ok(!names.some(n=>n.endsWith('.verified.json')));}finally{adapter.dispose();}
}));

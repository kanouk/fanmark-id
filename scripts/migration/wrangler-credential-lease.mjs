/** macOS operator adapter for Wrangler 4.135.0 encrypted TOML profiles.
 * Uses the existing OS key and OAuth grant. No browser login, new key, scope
 * expansion, request replay, or plaintext credential file is involved. */
import {readFile,open,lstat,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,dirname,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {createCloudflareCredentialLease} from './cloudflare-credential-lease.mjs';
const fail=code=>{throw Error('wrangler_credential_'+code);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const PROFILE='fanmark-staging-inapp';
function decrypt(envelope,key){
  if(envelope.v!==1||envelope.alg!=='AES-256-GCM')fail('envelope_invalid');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
}
function encrypt(bytes,key){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return {v:1,alg:'AES-256-GCM',iv:iv.toString('base64'),
    ciphertext:Buffer.concat([cipher.update(bytes),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function parseProfile(text){
  const keys=[...text.matchAll(/^([a-z_]+)\s*=/gm)].map(x=>x[1]);
  if(keys.sort().join(',')!=='expiration_time,oauth_token,refresh_token,scopes')fail('profile_shape_changed');
  const value=name=>{const m=text.match(new RegExp('^'+name+'\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$','m'));if(!m)fail('profile_shape_changed');return JSON.parse(m[1]);};
  const scopes=text.match(/^scopes\s*=\s*(\[[\s\S]*?\])/m);
  const record={oauth_token:value('oauth_token'),refresh_token:value('refresh_token'),expiration_time:value('expiration_time'),scopes:JSON.parse(scopes?.[1].replace(/,\s*\]$/,']')??'null')};
  if(!Array.isArray(record.scopes)||record.scopes.some(x=>typeof x!=='string'||!x||/\s/.test(x))||new Set(record.scopes).size!==record.scopes.length||
    !Number.isFinite(Date.parse(record.expiration_time))||[record.oauth_token,record.refresh_token].some(x=>typeof x!=='string'||x.length<16||/\s/.test(x)))fail('profile_invalid');
  return record;
}
function serializeProfile(p){return ['oauth_token = '+JSON.stringify(p.oauth_token),'expiration_time = '+JSON.stringify(p.expiration_time),
  'refresh_token = '+JSON.stringify(p.refresh_token),'scopes = '+JSON.stringify(p.scopes),''].join('\n');}
async function syncDirectory(path){const d=await open(path,constants.O_RDONLY);try{await d.sync();}finally{await d.close();}}
async function save(path,value){const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(typeof value==='string'?value:JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}await syncDirectory(dirname(path));}
function macKey(){
  if(process.platform!=='darwin')fail('macos_required');
  try{const value=JSON.parse(execFileSync('/usr/bin/security',['find-generic-password','-s','wrangler','-a',PROFILE,'-w'],
    {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}));const key=Buffer.from(value.key,'base64');if(value.v!==1||key.length!==32)fail('os_key_invalid');return key;}
  catch{fail('os_key_unconfirmed');}
}

export async function createWranglerCredentialLease({accountId,profilePath,refreshDirectory,wranglerPackagePath,
  readKey=macKey,fetchImpl=fetch,now=Date.now,minimumValidityMs=120000}={}){
  if(!isAbsolute(profilePath??'')||basename(profilePath)!==PROFILE+'.enc'||!isAbsolute(refreshDirectory??'')||
    !isAbsolute(wranglerPackagePath??'')||typeof fetchImpl!=='function')fail('configuration_invalid');
  if(JSON.parse(await readFile(wranglerPackagePath,'utf8')).version!=='4.135.0')fail('review_installed_wrangler_version');
  const directory=await lstat(refreshDirectory);if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&511)!==448)fail('private_refresh_directory_required');
  const key=Buffer.from(await readKey());if(key.length!==32)fail('os_key_invalid');
  const lockPath=profilePath+'.fanmark-refresh.lock';
  let validatedProfileHash=null;
  async function validateAccountToken(token){
    // Newly issued OAuth tokens can initially return 401. Only this fixed,
    // read-only account probe may be repeated. Never repeat the refresh POST
    // or any D1/coordinator/R2 write, even when this probe ultimately fails.
    for(let attempt=0;attempt<5;attempt++){
      let response;
      try{response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+accountId,{method:'GET',redirect:'error',
        headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});}catch{fail('account_probe_unconfirmed');}
      if(response.status===401&&attempt<4){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500*2**attempt));continue;}
      // Bound this metadata probe independently of the OAuth response parser.
      const reader=response.body?.getReader(),chunks=[];let bytes=0;if(!reader)fail('account_probe_unconfirmed');
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
        if(bytes>65536){await reader.cancel();fail('account_probe_unconfirmed');}chunks.push(Buffer.from(part.value));}}
      finally{reader.releaseLock();}
      const text=Buffer.concat(chunks).toString('utf8');
      let envelope;try{envelope=JSON.parse(text);}catch{fail('account_probe_unconfirmed');}
      if(!response.ok||envelope?.success!==true||envelope.result?.id!==accountId)fail('account_probe_unconfirmed');
      return;
    }
    fail('account_probe_unconfirmed');
  }
  async function read(allowOwnLock=false){
    if(!allowOwnLock){try{await lstat(lockPath);fail('prior_refresh_requires_inspection');}catch(e){if(e.code!=='ENOENT')throw e;}}
    const file=await open(profilePath,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const s=await file.stat();if(!s.isFile()||s.nlink!==1||(s.mode&511)!==384||s.size>65536)fail('profile_not_private');
      const bytes=await file.readFile(),clear=decrypt(JSON.parse(bytes.toString()),key);
      try{return {record:parseProfile(clear.toString('utf8')),sha256:digest(bytes)};}finally{clear.fill(0);}
    }finally{await file.close();}
  }
  async function renew(){
    const before=await read(),id=randomUUID(),prefix=refreshDirectory+'/oauth-refresh-'+id;
    await save(lockPath,{id,profile:PROFILE,processId:process.pid,at:new Date(now()).toISOString()});
    await save(prefix+'.intent.json',{id,profile:PROFILE,accountId,originalProfileSha256:before.sha256,
      endpoint:'https://dash.cloudflare.com/oauth2/token',clientId:'54d11594-84e4-41aa-b438-e81b8fa78ee7',automaticReplayForbidden:true});
    let response;
    try{response=await fetchImpl('https://dash.cloudflare.com/oauth2/token',{method:'POST',redirect:'error',
      headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',
        refresh_token:before.record.refresh_token,client_id:'54d11594-84e4-41aa-b438-e81b8fa78ee7'}).toString(),signal:AbortSignal.timeout(30000)});}
    catch{fail('refresh_acknowledgement_unknown');}
    const reader=response.body?.getReader(),chunks=[];let size=0;if(!reader)fail('refresh_response_missing');
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();fail('refresh_response_too_large');}chunks.push(Buffer.from(part.value));}}
    finally{reader.releaseLock();}
    const body=Buffer.concat(chunks);await save(prefix+'.response.enc.json',encrypt(Buffer.from(JSON.stringify({status:response.status,body:body.toString('utf8')})),key));
    if(!response.ok){body.fill(0);fail('refresh_refused');}let result;try{result=JSON.parse(body);}catch{fail('refresh_response_invalid');}finally{body.fill(0);}
    if(typeof result.access_token!=='string'||!Number.isSafeInteger(result.expires_in)||result.expires_in>86400||result.expires_in*1000<minimumValidityMs)fail('refresh_response_invalid');
    const scopes=result.scope?result.scope.split(' '):before.record.scopes;
    if(JSON.stringify([...scopes].sort())!==JSON.stringify([...before.record.scopes].sort()))fail('refresh_scope_changed');
    const record={oauth_token:result.access_token,refresh_token:result.refresh_token??before.record.refresh_token,
      expiration_time:new Date(now()+result.expires_in*1000).toISOString(),scopes};
    parseProfile(serializeProfile(record));
    if((await read(true)).sha256!==before.sha256)fail('profile_changed_during_refresh');
    const temporary=profilePath+'.fanmark-'+id+'.tmp';await save(temporary,encrypt(Buffer.from(serializeProfile(record)),key));
    await rename(temporary,profilePath);await syncDirectory(dirname(profilePath));
    const after=await read(true);if(after.record.oauth_token!==record.oauth_token||after.record.refresh_token!==record.refresh_token||after.record.expiration_time!==record.expiration_time)fail('refresh_profile_readback_mismatch');
    await save(prefix+'.persisted.json',{id,accountId,profile:PROFILE,expiresAt:Date.parse(record.expiration_time),profileSha256:after.sha256});
    await validateAccountToken(after.record.oauth_token);validatedProfileHash=after.sha256;
    await save(prefix+'.verified.json',{id,accountId,profile:PROFILE,expiresAt:Date.parse(record.expiration_time),
      scopesPreserved:true,encryptedResponseRetained:true,profileReadbackVerified:true,accountReadbackVerified:true});
    await unlink(lockPath);await syncDirectory(dirname(lockPath));
  }
  const lease=createCloudflareCredentialLease({accountId,now,minimumValidityMs,
    load:async()=>{try{const {record,sha256}=await read();
      if(Date.parse(record.expiration_time)-now()>=minimumValidityMs&&validatedProfileHash!==sha256){await validateAccountToken(record.oauth_token);validatedProfileHash=sha256;}
      return {accountId,token:record.oauth_token,expiresAt:Date.parse(record.expiration_time)};}catch{fail('load_unconfirmed');}},refresh:renew});
  return Object.freeze({lease,renew,
    async inspect(){const {record}=await read();return {accountId,profile:PROFILE,expiresAt:Date.parse(record.expiration_time),remainingMs:Date.parse(record.expiration_time)-now(),scopesSha256:digest(JSON.stringify([...record.scopes].sort()))};},
    dispose(){key.fill(0);},
  });
}

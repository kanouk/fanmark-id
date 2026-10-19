/** Encrypted Markdown custody and a read-only Obsidian Sync download adapter.
 * No provider request, new key, Sync setting change, or runtime install. */
import {open,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {timingSafeEqual} from 'node:crypto';
import {sha256Hex} from './snapshot-format.mjs';
import {openProductionWebhookSecret} from './production-webhook-custody.mjs';
const PREFIX='10_sensitive/secret-keys/fanmark-cloudflare-production-backup/';
const VAULT='/Users/kanouk/Documents/Private',HASH=/^[a-f0-9]{64}$/u;
const fail=()=>{throw Error('production_webhook_remote_custody_unconfirmed');};
async function read(path,hash){
 if(!HASH.test(hash??''))fail();const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>1048576)fail();
 const bytes=await f.readFile();if(sha256Hex(bytes)!==hash)fail();return bytes;}finally{await f.close();}
}
async function save(path,bytes){const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}}
function names(o){if(!['stripe','resend'].includes(o.provider))fail();return [
 [o.provider+'-registration-intent.json',o.expectedIntentSha256],
 [o.provider+'-registration-response.enc.json',o.expectedResponseSha256],
 [o.provider+'-registration-verified.json',o.expectedReportSha256]];}
function render(bundle){return Buffer.from('# fanmark.id production Webhook encrypted custody\n\n```json\n'+JSON.stringify(bundle,null,2)+'\n```\n');}
/** macOS script supplies a PTY required by Sync commands. Remove only the
 * observed CLI framing and terminal CRLF; never trim note content. */
export function decodeObsidianSyncReadOutput(stdout,relativePath,version){
 let text=Buffer.isBuffer(stdout)?stdout.toString('utf8'):stdout;
 if(typeof text!=='string')fail();text=text.replace(/\r\n/gu,'\n');
 if(text.startsWith('^D\u0008\u0008'))text=text.slice(4);
 const lineEnd=text.indexOf('\n'),prefix=relativePath+' (version '+version+', ';
 if(!text.startsWith(prefix)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/u.test(text.slice(prefix.length,lineEnd))||text.slice(lineEnd,lineEnd+5)!=='\n---\n')fail();
 return Buffer.from(text.slice(lineEnd+5));
}
/** Writes one new encrypted note. Existing paths are never overwritten. */
export async function prepareProductionWebhookRemoteCustody(options={}){
 try{
  await openProductionWebhookSecret(options);
  const files=[];for(const [name,hash]of names(options)){const bytes=await read(resolve(options.directory,name),hash);files.push({name,sha256:hash,base64:bytes.toString('base64')});}
  const intent=JSON.parse(Buffer.from(files[0].base64,'base64'));
  const bundle={format:'fanmark-production-webhook-sync-custody-v1',provider:options.provider,operationId:intent.request.operationId,archiveKeyId:intent.archiveKeyId,files};
  const vaultRoot=options.vaultRoot??VAULT,parent=resolve(vaultRoot,PREFIX),stat=await lstat(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(parent)!==parent)fail();
  const relativePath=PREFIX+'webhook-'+options.provider+'-'+bundle.operationId+'.md',note=render(bundle);
  await save(resolve(vaultRoot,relativePath),note);
  return {format:'fanmark-production-webhook-sync-note-v1',provider:options.provider,relativePath,noteSha256:sha256Hex(note),encryptedResponseSha256:options.expectedResponseSha256,remoteVerified:false,plaintextSecretWritten:false};
 }catch{fail();}
}
/** A fixed read-only CLI operation. Empty/error output cannot count as Sync.
 * A separate machine restoration remains outside this local CLI proof. */
export function createObsidianSyncWebhookCustodyVerifier({options,note,remoteVersion,execute=promisify(execFile)}={}){
 return async function verifyRemoteCustody(challenge){
  let temp;
  try{
   if(!options||challenge?.provider!==options.provider||challenge.responseSha256!==options.expectedResponseSha256||
    !HASH.test(note?.noteSha256??'')||note.provider!==options.provider||note.encryptedResponseSha256!==options.expectedResponseSha256||
    !Number.isSafeInteger(remoteVersion)||remoteVersion<0)fail();
   const local=await openProductionWebhookSecret(options),intentBytes=await read(resolve(options.directory,names(options)[0][0]),options.expectedIntentSha256);
   const intent=JSON.parse(intentBytes),expectedPath=PREFIX+'webhook-'+options.provider+'-'+intent.request.operationId+'.md';
   if(note.relativePath!==expectedPath)fail();
   const {stdout}=await execute('/usr/bin/script',['-q','/dev/null','/Applications/Obsidian.app/Contents/MacOS/obsidian',
    'sync:read','vault=Private','path='+expectedPath,'version='+remoteVersion],{encoding:'utf8',maxBuffer:2097152,timeout:30000});
   const bytes=decodeObsidianSyncReadOutput(stdout,expectedPath,remoteVersion);if(sha256Hex(bytes)!==note.noteSha256)fail();
   const match=bytes.toString('utf8').match(/^# fanmark\.id production Webhook encrypted custody\n\n```json\n([\s\S]+)\n```\n$/u);
   if(!match)fail();const bundle=JSON.parse(match[1]);
   if(bundle.format!=='fanmark-production-webhook-sync-custody-v1'||bundle.provider!==options.provider||bundle.operationId!==intent.request.operationId||bundle.archiveKeyId!==intent.archiveKeyId||bundle.files?.length!==3)fail();
   temp=await mkdtemp(join(await realpath(tmpdir()),'fanmark-webhook-remote-'));
   for(const [i,[name,hash]]of names(options).entries()){
    const f=bundle.files[i];if(f.name!==name||f.sha256!==hash||typeof f.base64!=='string')fail();
    const raw=Buffer.from(f.base64,'base64');if(raw.toString('base64')!==f.base64||sha256Hex(raw)!==hash)fail();await save(join(temp,name),raw);
   }
   const remote=await openProductionWebhookSecret({...options,directory:temp}),a=Buffer.from(local.secret),b=Buffer.from(remote.secret);
   try{if(a.length!==b.length||!timingSafeEqual(a,b)||local.binding!==remote.binding)fail();}finally{a.fill(0);b.fill(0);}
   return {encryptedResponseSha256:options.expectedResponseSha256,remoteNoteSha256:sha256Hex(bytes),remoteVersion,remoteDownloaded:true,independentlyDecrypted:true,plaintextSecretWritten:false,separateDeviceRestoreVerified:false};
  }catch{fail();}finally{if(temp)await rm(temp,{recursive:true,force:true});}
 };
}

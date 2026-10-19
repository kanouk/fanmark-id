import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {beginProductionWebhookRegistration,captureProductionWebhookResponse,verifyProductionWebhookRegistration} from './production-webhook-custody.mjs';
import {prepareProductionWebhookRemoteCustody,createObsidianSyncWebhookCustodyVerifier,decodeObsidianSyncReadOutput} from './production-webhook-remote-custody.mjs';
const cli=(bytes,note)=>'^D\u0008\u0008'+note.relativePath+' (version 123, 2026-10-19 21:00:00)\r\n---\r\n'+bytes.toString().replace(/\n/g,'\r\n');
async function fixture(t,provider){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'fm-webhook-remote-test-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const vaultRoot=join(directory,'vault');await mkdir(join(vaultRoot,'10_sensitive/secret-keys/fanmark-cloudflare-production-backup'),{recursive:true,mode:0o700});
 const options={directory,provider,vaultRoot,operationId:randomUUID(),archiveKeyId:'production-backup-'+randomUUID(),archiveKeyHex:randomBytes(32).toString('hex')};
 const begun=await beginProductionWebhookRegistration(options);options.expectedIntentSha256=begun.intentSha256;
 const secret='whsec_'+randomBytes(32).toString('base64'),id=provider==='stripe'?'we_fixture123':randomUUID();
 const endpoint=provider==='stripe'?{id,object:'webhook_endpoint',status:'enabled',livemode:true,application:null,...begun.request.body}:{id,object:'webhook',status:'enabled',...begun.request.body};
 const response=provider==='stripe'?{...endpoint,secret}:{object:'webhook',id,signing_secret:secret};
 options.expectedResponseSha256=(await captureProductionWebhookResponse({...options,httpStatus:201,response})).responseSha256;
 const readback=provider==='stripe'?{accountId:begun.request.accountId,endpoint}:{senderDomain:{name:'fanmark.id',status:'verified'},endpoint};
 options.expectedReportSha256=(await verifyProductionWebhookRegistration({...options,readback})).reportSha256;
 return {options,secret};
}
for(const provider of ['stripe','resend'])test(provider+' remote note downloads, independently decrypts, and connects to installation callback contract',async t=>{
 const {options,secret}=await fixture(t,provider),note=await prepareProductionWebhookRemoteCustody(options),bytes=await readFile(join(options.vaultRoot,note.relativePath));
 assert.ok(!bytes.includes(secret));assert.ok(!bytes.includes(options.archiveKeyHex));assert.equal((await stat(join(options.vaultRoot,note.relativePath))).mode&0o777,0o600);
 await assert.rejects(prepareProductionWebhookRemoteCustody(options),/remote_custody_unconfirmed/);
 let calls=0;
 const verify=createObsidianSyncWebhookCustodyVerifier({options,note,remoteVersion:123,execute:async(file,args,config)=>{
  calls++;assert.equal(file,'/usr/bin/script');assert.deepEqual(args,['-q','/dev/null','/Applications/Obsidian.app/Contents/MacOS/obsidian','sync:read','vault=Private','path='+note.relativePath,'version=123']);assert.equal(config.timeout,30000);return {stdout:cli(bytes,note)};
 }});
 const result=await verify({provider,responseSha256:options.expectedResponseSha256});assert.equal(calls,1);
 assert.equal(result.remoteDownloaded,true);assert.equal(result.independentlyDecrypted,true);assert.equal(result.separateDeviceRestoreVerified,false);
 assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes(options.archiveKeyHex));
 assert.deepEqual((await readdir(options.directory)).sort(),[provider+'-registration-intent.json',provider+'-registration-response.enc.json',provider+'-registration-verified.json','vault'].sort());
});
test('empty CLI output, changed remote bytes, wrong key, and cross-operation note fail closed',async t=>{
 const {options}=await fixture(t,'stripe'),note=await prepareProductionWebhookRemoteCustody(options),bytes=await readFile(join(options.vaultRoot,note.relativePath));
 const challenge={provider:'stripe',responseSha256:options.expectedResponseSha256};
 for(const stdout of ['',Buffer.concat([bytes,Buffer.from('\n')]),bytes.subarray(1)]){
  await assert.rejects(createObsidianSyncWebhookCustodyVerifier({options,note,remoteVersion:123,execute:async()=>({stdout:stdout===''?'':cli(stdout,note)})})(challenge),/remote_custody_unconfirmed/);
 }
 for(const changed of [{...options,archiveKeyHex:'f'.repeat(64)},options]){
  const selected=changed===options?{...note,relativePath:note.relativePath.replace(options.operationId,randomUUID())}:note;
  let calls=0;await assert.rejects(createObsidianSyncWebhookCustodyVerifier({options:changed,note:selected,remoteVersion:123,execute:async()=>{calls++;return {stdout:cli(bytes,note)};}})(challenge));assert.equal(calls,0);
 }
});
test('CLI errors never expose provider credentials or authorize a retry',async t=>{
 const {options,secret}=await fixture(t,'resend'),note=await prepareProductionWebhookRemoteCustody(options);
 await assert.rejects(createObsidianSyncWebhookCustodyVerifier({options,note,remoteVersion:123,execute:async()=>{throw Error(secret);}})({provider:'resend',responseSha256:options.expectedResponseSha256}),e=>e.message==='production_webhook_remote_custody_unconfirmed');
});

test('PTY frame must pin the exact note path and version, with byte-exact note content',()=>{const note={relativePath:'safe-note.md'},bytes=Buffer.from('hello\n');assert.deepEqual(decodeObsidianSyncReadOutput(cli(bytes,note),note.relativePath,123),bytes);for(const [path,version] of [['other.md',123],['safe-note.md',0]])assert.throws(()=>decodeObsidianSyncReadOutput(cli(bytes,note),path,version));assert.throws(()=>decodeObsidianSyncReadOutput(bytes,note.relativePath,123));});

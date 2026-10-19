import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {sha256Hex} from './snapshot-format.mjs';
import {beginProductionWebhookRegistration,captureProductionWebhookResponse,verifyProductionWebhookRegistration} from './production-webhook-custody.mjs';
import {installProductionWebhookSecret,inspectProductionWebhookSecretInstallation} from './production-webhook-secret-install.mjs';

async function fixture(t,provider='stripe'){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'fanmark-webhook-install-'));await chmod(directory,0o700);
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const secret='whsec_'+randomBytes(32).toString('base64'),options={provider,directory,operationId:randomUUID(),archiveKeyId:'production-backup-'+randomUUID(),archiveKeyHex:randomBytes(32).toString('hex')};
 const begun=await beginProductionWebhookRegistration(options);options.expectedIntentSha256=begun.intentSha256;
 const endpoint=provider==='stripe'?{id:'we_fixture',url:begun.request.body.url,status:'enabled',livemode:true,application:null,
  api_version:begun.request.body.api_version,metadata:begun.request.body.metadata,enabled_events:begun.request.body.enabled_events}:
  {id:randomUUID(),endpoint:begun.request.body.endpoint,status:'enabled',events:begun.request.body.events,signing_secret:secret};
 const response=provider==='stripe'?{...endpoint,secret}:{id:endpoint.id,signing_secret:secret};
 options.expectedResponseSha256=(await captureProductionWebhookResponse({...options,httpStatus:201,response})).responseSha256;
 const readback=provider==='stripe'?{accountId:'acct_1SFjhvJk0VCfiKUp',endpoint}:{senderDomain:{name:'fanmark.id',status:'verified'},endpoint};
 options.expectedReportSha256=(await verifyProductionWebhookRegistration({...options,readback})).reportSha256;
 const state={version:randomUUID(),settings:{bindings:[{name:'CUTOVER_WRITE_FREEZE',type:'plain_text',text:'receipt_only'}]},puts:0,lost:false,proofWrong:false};
 Object.assign(options,{cloudflareToken:'cf_private_fixture',expectedRuntimeVersion:state.version,expectedSettingsSha256:sha256Hex(state.settings),
  verifyRemoteCustody:async()=>({encryptedResponseSha256:options.expectedResponseSha256,remoteNoteSha256:'d'.repeat(64),remoteDownloaded:true,independentlyDecrypted:true}),
  proveRuntime:async challenge=>{
   const key=state.proofWrong?Buffer.from('wrong-key'):provider==='stripe'?Buffer.from(secret):Buffer.from(secret.slice(6),'base64');
   return {format:'fanmark-production-webhook-key-proof-v1',provider,binding:begun.request.binding,...challenge,
    proofHex:createHmac('sha256',key).update(`fanmark-production-webhook-key-proof-v1\n${provider}\n${challenge.runtimeVersion}\n${challenge.nonce}`).digest('hex')};
  },fetchImpl:async(url,o)=>{
   assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/bfc2890741f0b3fb236e2d755b6c9adc/workers/scripts/fanmark-app-production/'));
   assert.equal(o.redirect,'error');assert.equal(o.headers.authorization,'Bearer cf_private_fixture');
   if(o.method==='PUT'){
    state.puts++;const parsed=JSON.parse(o.body);assert.deepEqual(parsed,{name:begun.request.binding,type:'secret_text',text:secret});
    state.settings.bindings.push({name:begun.request.binding,type:'secret_text'});state.version=randomUUID();
    if(state.lost)throw Error(secret);return Response.json({success:true});
   }
   assert.equal(o.method,'GET');return Response.json({success:true,result:url.endsWith('/settings')?state.settings:
    url.endsWith('/schedules')?{schedules:[]}:{deployments:[{versions:[{version_id:state.version,percentage:100}]}]}});
  }});
 return {options,state,secret};
}
for(const provider of ['stripe','resend'])test(provider+' installs once from encrypted remote custody and verifies the actual runtime bytes',async t=>{
 const f=await fixture(t,provider),result=await installProductionWebhookSecret(f.options);
 assert.equal(f.state.puts,1);assert.equal(result.runtimeSecretValueVerified,true);assert.equal(result.realProviderDeliveryVerified,false);
 assert.ok(!JSON.stringify(result).includes(f.secret));
 await assert.rejects(installProductionWebhookSecret(f.options));assert.equal(f.state.puts,1);
 for(const file of await readdir(f.options.directory))assert.ok(!(await readFile(join(f.options.directory,file),'utf8')).includes(f.secret));
});
test('local-only custody, changed baseline and absent proof cannot install or claim runtime success',async t=>{
 const f=await fixture(t);
 await assert.rejects(installProductionWebhookSecret({...f.options,verifyRemoteCustody:async()=>({})}),/remote_custody_unconfirmed/);
 await assert.rejects(installProductionWebhookSecret({...f.options,expectedSettingsSha256:'f'.repeat(64)}),/baseline_changed/);
 assert.equal(f.state.puts,0);
 f.state.proofWrong=true;await assert.rejects(installProductionWebhookSecret(f.options),/key_proof_invalid/);
 assert.equal(f.state.puts,1);assert.ok(!(await readdir(f.options.directory)).includes('stripe-registration-secret-install-verified.json'));
});
test('unknown secret PUT retains intent and can be independently reconciled without a second PUT',async t=>{
 const f=await fixture(t);f.state.lost=true;
 await assert.rejects(installProductionWebhookSecret(f.options),e=>e.message==='production_webhook_install_put_outcome_unknown'&&!e.message.includes(f.secret));
 const expectedInstallIntentSha256=sha256Hex(await readFile(join(f.options.directory,'stripe-registration-secret-install-intent.json')));
 const result=await inspectProductionWebhookSecretInstallation({...f.options,expectedInstallIntentSha256});
 assert.equal(result.runtimeSecretValueVerified,true);assert.equal(result.providerPutAcknowledged,false);
 assert.equal(result.putAttempts,0);assert.equal(result.retryAllowed,false);assert.equal(f.state.puts,1);
 f.state.proofWrong=true;await assert.rejects(inspectProductionWebhookSecretInstallation({...f.options,expectedInstallIntentSha256}));
 await assert.rejects(installProductionWebhookSecret(f.options));assert.equal(f.state.puts,1);
});

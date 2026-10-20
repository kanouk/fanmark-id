/** One fixed runtime secret PUT from verified encrypted custody.
 * Caller supplies remote-custody verification and a private, version-pinned
 * binding transport to ProductionWebhookKeyProofService. Never log options. */
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {sha256Hex} from './snapshot-format.mjs';
import {openProductionWebhookSecret,saveProductionWebhookExecutionRecord,readProductionWebhookExecutionRecord} from './production-webhook-custody.mjs';
const fail=code=>{throw Error('production_webhook_install_'+code);};
const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const root='https://api.cloudflare.com/client/v4/accounts/bfc2890741f0b3fb236e2d755b6c9adc/workers/scripts/fanmark-app-production';
/** Deploy only as an owned, short-lived operator, with PROOF bound to the
 * fixed production service. No datastore or installation capability. */
export function productionWebhookKeyProofProxySource(){
 return `export default {async fetch(r,e){
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return json(null,410);
if(!/^[a-f0-9]{64}$/.test(e.GATE_TOKEN??'')||r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return json(null,401);
const u=new URL(r.url);if(r.method!=='POST'||u.pathname!=='/proof'||u.search)return json(null,404);
let text='',length=0;if(!r.body)return json(null,400);const reader=r.body.getReader();
try{const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024){await reader.cancel();return json(null,413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
try{return json(await e.PROOF.prove(JSON.parse(text)));}catch{return json({error:'production_webhook_key_proof_refused'},409);}
}};`;
}
function secretless(settings,binding){
 const {bindings}=settings,other=Object.fromEntries(Object.entries(settings).filter(([k])=>!['annotations','bindings'].includes(k)));
 if(!Array.isArray(bindings))fail('settings_invalid');
 return {...other,bindings:bindings.filter(b=>b.name!==binding).sort((a,b)=>a.name.localeCompare(b.name,'en'))};
}
function version(deployments){const v=deployments?.deployments?.[0]?.versions;
 if(v?.length!==1||v[0].percentage!==100||!UUID.test(v[0].version_id??''))fail('runtime_unconfirmed');return v[0].version_id;}
function closed(settings){const bindings=settings.bindings;if(!Array.isArray(bindings)||
 bindings.filter(b=>b.name==='CUTOVER_WRITE_FREEZE'&&b.text==='receipt_only').length!==1||
 bindings.some(b=>b.name==='PRODUCTION_OWNER_ACCEPTANCE_BACKEND'&&b.text!=='disabled')||
 bindings.some(b=>['STRIPE_DISPATCH_BACKEND','LICENSE_EXPIRY_BACKEND','NOTIFICATION_ARCHIVE_BACKEND'].includes(b.name)))fail('target_open');}
function reader({cloudflareToken,fetchImpl=fetch}){
 if(typeof cloudflareToken!=='string'||cloudflareToken.length<16||/\s/u.test(cloudflareToken))fail('input_invalid');
 return async path=>{
  const r=await fetchImpl(root+path,{method:'GET',headers:{authorization:'Bearer '+cloudflareToken},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok){await r.body?.cancel().catch(()=>{});fail('read_rejected');}
  if(!r.body)fail('read_invalid');
  const stream=r.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await stream.read();if(done)break;size+=value.byteLength;
   if(size>262144){await stream.cancel();fail('read_invalid');}chunks.push(Buffer.from(value));}
   const bytes=Buffer.concat(chunks);let b;try{b=JSON.parse(bytes.toString('utf8'));}catch{fail('read_invalid');}finally{bytes.fill(0);}
   if(b.success!==true)fail('read_rejected');return b.result;
  }finally{for(const chunk of chunks)chunk.fill(0);stream.releaseLock();}
 };
}
export function verifyProductionWebhookKeyProof({provider,secret,challenge,result}={}){
 if(!Object.hasOwn({stripe:1,resend:1},provider)||!challenge||!UUID.test(challenge.nonce??'')||
   !UUID.test(challenge.runtimeVersion??'')||challenge.provider!==provider||
   result?.format!=='fanmark-production-webhook-key-proof-v1'||result.provider!==provider||
   result.nonce!==challenge.nonce||result.runtimeVersion!==challenge.runtimeVersion||
   result.binding!==(provider==='stripe'?'STRIPE_WEBHOOK_SECRET':'BROADCAST_WEBHOOK_SIGNING_SECRET')||!HASH.test(result.proofHex??''))fail('key_proof_invalid');
 const key=provider==='stripe'?Buffer.from(secret):Buffer.from(secret.slice(6),'base64');
 try{
  const message=`fanmark-production-webhook-key-proof-v1\n${provider}\n${challenge.runtimeVersion}\n${challenge.nonce}`;
  const expected=createHmac('sha256',key).update(message).digest();
  if(!timingSafeEqual(expected,Buffer.from(result.proofHex,'hex')))fail('key_proof_invalid');
 }finally{key.fill(0);}
 return true;
}
export async function installProductionWebhookSecret(options={}){
 try{return await install({...options});}catch(error){
  if(/^production_webhook_install_[a-z_]+$/u.test(error.message))throw error;
  fail('outcome_unconfirmed');
 }
}
async function install(options){
 const {provider,cloudflareToken,expectedRuntimeVersion,expectedSettingsSha256,
  verifyRemoteCustody,proveRuntime,fetchImpl=fetch}=options;
 if(!UUID.test(expectedRuntimeVersion??'')||!HASH.test(expectedSettingsSha256??'')||
  typeof cloudflareToken!=='string'||cloudflareToken.length<16||/\s/u.test(cloudflareToken)||
  typeof verifyRemoteCustody!=='function'||typeof proveRuntime!=='function')fail('input_invalid');
 const opened=await openProductionWebhookSecret(options);
 // This callback must independently download the remote note and return the
 // hash of its extracted encrypted response. A local file copy is insufficient.
 const remote=await verifyRemoteCustody({provider,responseSha256:options.expectedResponseSha256});
 if(remote?.encryptedResponseSha256!==options.expectedResponseSha256||!HASH.test(remote.remoteNoteSha256??'')||
  remote.remoteDownloaded!==true||remote.independentlyDecrypted!==true)fail('remote_custody_unconfirmed');
 const get=reader(options);
 const before=await get('/settings');closed(before);
 if(sha256Hex(before)!==expectedSettingsSha256||before.bindings.some(b=>b.name===opened.binding)||
  version(await get('/deployments'))!==expectedRuntimeVersion)fail('baseline_changed');
 const schedules=await get('/schedules');if(schedules.schedules?.length!==0)fail('target_open');
 const baselineSha256=sha256Hex(secretless(before,opened.binding));
 const intent={format:'fanmark-production-webhook-secret-install-intent-v1',provider,binding:opened.binding,
  custodyReportSha256:options.expectedReportSha256,responseSha256:options.expectedResponseSha256,
  previousRuntimeVersion:expectedRuntimeVersion,settingsSha256:expectedSettingsSha256,baselineSha256,
  remoteNoteSha256:remote.remoteNoteSha256};
 const intentSha256=await saveProductionWebhookExecutionRecord({...options,kind:'secret-install-intent',record:intent});
 // No automatic resend, even if PUT committed but its response was lost.
 let response;try{response=await fetchImpl(root+'/secrets',{method:'PUT',headers:{authorization:'Bearer '+cloudflareToken,'content-type':'application/json'},
  body:JSON.stringify({name:opened.binding,type:'secret_text',text:opened.secret}),redirect:'error',signal:AbortSignal.timeout(30000)});
  await response.body?.cancel();}catch{fail('put_outcome_unknown');}
 const observed=await verifyInstalled(options,intent,opened);
 const report={format:'fanmark-production-webhook-secret-install-verified-v1',provider,binding:opened.binding,
  intentSha256,...observed,remoteNoteSha256:remote.remoteNoteSha256,
  runtimeSecretValueVerified:true,providerPutAcknowledged:response.ok,realProviderDeliveryVerified:false,productionReady:false};
 const reportSha256=await saveProductionWebhookExecutionRecord({...options,kind:'secret-install-verified',record:report});
 return {...report,reportSha256};
}
async function verifyInstalled(options,intent,opened){
 const get=reader(options),after=await get('/settings');closed(after);
 const rows=after.bindings.filter(b=>b.name===opened.binding);
 if(rows.length!==1||rows[0].type!=='secret_text'||sha256Hex(secretless(after,opened.binding))!==intent.baselineSha256)fail('settings_changed');
 if((await get('/schedules')).schedules?.length!==0)fail('target_open');
 const runtimeVersion=version(await get('/deployments'));
 const challenge={provider:options.provider,nonce:randomUUID(),runtimeVersion};
 const result=await options.proveRuntime(challenge);
 verifyProductionWebhookKeyProof({provider:options.provider,secret:opened.secret,challenge,result});
 if(sha256Hex(await get('/settings'))!==sha256Hex(after)||version(await get('/deployments'))!==runtimeVersion)fail('runtime_changed');
 return {runtimeVersion,keyProofSha256:sha256Hex(result)};
}
/** After an unknown PUT, reconcile by GET and binding RPC only. No write,
 * retry, second install intent or success-ACK fabrication is performed. */
export async function inspectProductionWebhookSecretInstallation(options={}){
 try{
  options={...options};const opened=await openProductionWebhookSecret(options);
  const intent=await readProductionWebhookExecutionRecord({...options,kind:'secret-install-intent',expectedRecordSha256:options.expectedInstallIntentSha256});
  if(intent.format!=='fanmark-production-webhook-secret-install-intent-v1'||intent.provider!==options.provider||intent.binding!==opened.binding||
   intent.custodyReportSha256!==options.expectedReportSha256||intent.responseSha256!==options.expectedResponseSha256||
   !HASH.test(intent.baselineSha256??'')||!HASH.test(intent.remoteNoteSha256??''))fail('intent_invalid');
  const observed=await verifyInstalled(options,intent,opened);
  return {format:'fanmark-production-webhook-secret-install-inspected-v1',provider:options.provider,...observed,
   runtimeSecretValueVerified:true,providerPutAcknowledged:false,putAttempts:0,retryAllowed:false,
   realProviderDeliveryVerified:false,productionReady:false};
 }catch{fail('inspection_unconfirmed');}
}

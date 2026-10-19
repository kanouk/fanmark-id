import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {productionWebhookKeyProofProxySource} from './production-webhook-secret-install.mjs';
test('native binding-only proof uses actual Stripe/Svix bytes with no store, secret export or event signature oracle',async()=>{
 const source=fileURLToPath(new URL('../../workers/api/src',import.meta.url));
 const built=await build({stdin:{contents:`export {ProductionWebhookKeyProofService} from './production-webhook-key-proof';export default {fetch(){return new Response(null,{status:404})}};`,resolveDir:source,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const runtime=randomUUID(),stripe='whsec_'+randomBytes(32).toString('hex'),resend='whsec_'+randomBytes(32).toString('base64');
 const service=(name,changes={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:Object.fromEntries(Object.entries({CF_VERSION_METADATA:JSON.stringify({id:runtime}),
  STRIPE_WEBHOOK_SECRET:stripe,BROADCAST_WEBHOOK_SIGNING_SECRET:resend,CUTOVER_WRITE_FREEZE:'receipt_only',BETTER_AUTH_URL:'https://fanmark.id',
  RECOVERY_DRAIN_SCOPE_DIGEST:'6c6685377bca7b2e24d637b4a43888b77a16e280fdc587ce42623156cd615e9d',...changes}).map(([k,v])=>[k,k==='CF_VERSION_METADATA'?{type:'json',value:JSON.parse(v)}:{type:'text',value:v}])),
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}}});
 const token='a'.repeat(64);
 const proxy=(name,worker,expiry=String(Date.now()+60000))=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',
  env:{PROOF:{type:'worker',worker,exportName:'ProductionWebhookKeyProofService'},GATE_TOKEN:{type:'text',value:token},EXPIRES_AT:{type:'text',value:expiry}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:productionWebhookKeyProofProxySource()}}}}});
 const mf=new Miniflare({workers:[service('proof'),service('open',{CUTOVER_WRITE_FREEZE:'false'}),service('staging',{BETTER_AUTH_URL:'https://staging.invalid'}),
  proxy('caller','proof'),proxy('open-caller','open'),proxy('staging-caller','staging'),proxy('expired','proof','1')]});
 try{
  const call=async(input,worker='caller',path='/proof',headers={})=>(await mf.getWorker(worker)).fetch('https://fixture.local'+path,
    {method:'POST',body:JSON.stringify(input),headers:{authorization:'Bearer '+token,...headers}});
  for(const provider of ['stripe','resend']){
   const nonce=randomUUID(),input={provider,nonce,runtimeVersion:runtime},response=await call(input);assert.equal(response.status,200);
   const result=await response.json(),key=provider==='stripe'?Buffer.from(stripe):Buffer.from(resend.slice(6),'base64');
   const message=`fanmark-production-webhook-key-proof-v1\n${provider}\n${runtime}\n${nonce}`;
   assert.equal(result.proofHex,createHmac('sha256',key).update(message).digest('hex'));
   assert.ok(!JSON.stringify(result).includes(stripe));assert.ok(!JSON.stringify(result).includes(resend));
   assert.notEqual(result.proofHex,createHmac('sha256',key).update('123.{}').digest('hex'));
   for(const mutation of [{nonce:'123.{}'},{runtimeVersion:randomUUID()},{provider:'unknown'},{extra:true}])assert.equal((await call({...input,...mutation})).status,409);
   for(const worker of ['open-caller','staging-caller'])assert.equal((await call(input,worker)).status,409);
   assert.equal((await call(input,'expired')).status,410);
   assert.equal((await call(input,'caller','/proof',{authorization:'wrong'})).status,401);
   assert.equal((await call(input,'caller','/proof?extra=1')).status,404);
   assert.equal((await call({...input,extra:'x'.repeat(1025)})).status,413);
  }
  assert.equal((await (await mf.getWorker('proof')).fetch('https://fixture.local')).status,404);
 }finally{await mf.dispose();}
});

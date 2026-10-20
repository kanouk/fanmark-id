import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
import {productionOwnerAcceptanceProxySource} from './production-owner-acceptance.mjs';
test('native private issuer is version/expiry/bearer pinned, with no store access or Auth session',async()=>{
 const source=fileURLToPath(new URL('../../workers/api/src',import.meta.url));
 const built=await build({stdin:{contents:`export {ProductionOwnerAcceptanceService} from './production-owner-acceptance';export default {fetch(){return new Response(null,{status:404})}};`,resolveDir:source,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:*']});
 const runtime=randomUUID(),runId=randomUUID(),gate='a'.repeat(64),browserExpiry=String(Date.now()+120000);
 const service=(name,changes={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:{
  CF_VERSION_METADATA:{type:'json',value:{id:runtime}},RECOVERY_DRAIN:{type:'json',value:{fixtureOnly:true}},
  ...Object.fromEntries(Object.entries({PRODUCTION_OWNER_ACCEPTANCE_BACKEND:'owner-browser-v1',BETTER_AUTH_URL:'https://fanmark.id',
   CUTOVER_WRITE_FREEZE:'receipt_only',D1_TOPOLOGY:'split',RECOVERY_DRAIN_BACKEND:'durable-object',RECOVERY_DRAIN_SCOPE_DIGEST:PRODUCTION_RUNTIME.scope,
   STAGING_BACKUP_SOURCE_IDS:JSON.stringify(PRODUCTION_STORE_IDS),VERIFIED_ACCESS_SECRET:'b'.repeat(64),...changes}).map(([k,v])=>[k,{type:'text',value:v}]))},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:built.outputFiles[0].text}}}}});
 const proxy=(name,worker,changes={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:{OWNER:{type:'worker',worker,exportName:'ProductionOwnerAcceptanceService'},
  ...Object.fromEntries(Object.entries({GATE_TOKEN:gate,EXPIRES_AT:String(Date.now()+60000),RUN_ID:runId,BROWSER_EXPIRES_AT:browserExpiry,EXPECTED_RUNTIME:runtime,...changes}).map(([k,v])=>[k,{type:'text',value:v}]))},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:productionOwnerAcceptanceProxySource()}}}}});
 const mf=new Miniflare({workers:[service('target'),service('disabled',{PRODUCTION_OWNER_ACCEPTANCE_BACKEND:'disabled'}),proxy('caller','target'),proxy('disabled-caller','disabled'),proxy('wrong-version','target',{EXPECTED_RUNTIME:randomUUID()}),proxy('expired','target',{EXPIRES_AT:'1'})]});
 try{
  const call=async(worker='caller',init={},path='/issue')=>(await mf.getWorker(worker)).fetch('https://fixture.invalid'+path,{method:'POST',headers:{authorization:'Bearer '+gate},...init});
  const response=await call();assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.runtimeVersion,runtime);assert.equal(result.runId,runId);assert.equal(result.expiresAt,Number(browserExpiry));
  const url=new URL(result.browserUrl);assert.equal(url.origin,'https://fanmark.id');assert.equal(url.pathname,'/__migration/owner');assert.ok(url.hash.length>100);assert.equal(url.search,'');
  assert.equal((await call('caller',{headers:{}})).status,401);assert.equal((await call('caller',{body:'x'})).status,404);
  assert.equal((await call('caller',{},'/issue?x=1')).status,404);
  assert.equal((await call('disabled-caller')).status,409);assert.equal((await call('wrong-version')).status,409);assert.equal((await call('expired')).status,410);
  assert.ok(!JSON.stringify(result).includes('b'.repeat(64)));
 }finally{await mf.dispose();}
});

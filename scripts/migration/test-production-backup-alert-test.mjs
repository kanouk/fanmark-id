import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {productionBackupAlertTestSource} from './production-backup-alert-test.mjs';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
test('native alert operator admits only one fixed delivery-test call in the pinned, idle, closed runtime',async()=>{
 const runtime=randomUUID(),token='a'.repeat(64),keyId='production-backup-'+randomUUID(),slot=new Date().toISOString().slice(0,10),schemas={auth:'a'.repeat(64),business:'b'.repeat(64),master:'c'.repeat(64)},providerId=randomUUID();
 const status={runtimeRevision:runtime,keyId,sourceIds:PRODUCTION_STORE_IDS,schemaHashes:schemas,admission:false,writers:{active:0,owner:null}};
 const operator=(name,changes={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:{BACKUP:{type:'worker',worker:'service',exportName:'Probe'},
  ...Object.fromEntries(Object.entries({EXPECTED_RUNTIME:runtime,GATE_TOKEN:token,EXPIRES_AT:String(Date.now()+60000),SLOT:slot,KEY_ID:keyId,SCHEMA_HASHES:JSON.stringify(schemas),...changes}).map(([k,v])=>[k,{type:'text',value:v}]))},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:productionBackupAlertTestSource()}}}}});
 const mf=new Miniflare({workers:[operator('valid'),operator('expired',{EXPIRES_AT:'1'}),operator('drift',{EXPECTED_RUNTIME:randomUUID()}),operator('schema',{SCHEMA_HASHES:'{}'}),operator('day',{SLOT:'2026-01-01'}),
  {config:{name:'service',type:'worker',compatibilityDate:'2026-09-18',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:`import {WorkerEntrypoint} from 'cloudflare:workers';let sends=0;
  export class Probe extends WorkerEntrypoint{status(){return ${JSON.stringify(status)}}alert(input){if(JSON.stringify(input)!==JSON.stringify({slot:${JSON.stringify(slot)},scope:${JSON.stringify(PRODUCTION_RUNTIME.scope)},code:'delivery-test'}))throw Error('unexpected');sends++;return {state:'provider-accepted',providerId:${JSON.stringify(providerId)},duplicate:sends>1}}run(){throw Error('forbidden')}prune(){throw Error('forbidden')}}
  export default {fetch(){return Response.json({sends})}};`}}}}}]});
 try{
  const call=async(name,path='/delivery-test',o={})=>(await mf.getWorker(name)).fetch('https://fixture.invalid'+path,{method:'POST',...o,headers:{authorization:'Bearer '+token,...o.headers}});
  for(const [name,o]of [['valid',{headers:{authorization:'wrong'}}],['expired',{}],['drift',{}],['schema',{}],['day',{}]])assert.notEqual((await call(name,'/delivery-test',o)).status,200);
  for(const [path,o]of [['/run',{}],['/prune',{}],['/delivery-test?recipient=other',{}],['/delivery-test',{body:'{}'}],['/delivery-test',{method:'GET'}]])assert.equal((await call('valid',path,o)).status,404);
  assert.equal((await (await (await mf.getWorker('service')).fetch('https://fixture.invalid')).json()).sends,0);
  const result=await (await call('valid')).json();assert.equal(result.providerId,providerId);assert.equal(result.delivered,false);assert.equal(result.productionReady,false);
  assert.equal((await (await call('valid')).json()).duplicate,true);
 }finally{await mf.dispose();}
});

import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {productionBackupCaptureSource,productionManualBackupCaptureSource} from './production-backup-capture.mjs';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
for(const manual of [false,true]) {
test((manual?'manual operation: ':'daily slot: ')+'native capture uses the fixed slot once and preserves read-only status after an existing receipt',async()=>{
 const operationId=randomUUID();
 const version=randomUUID(),keyId='production-backup-'+randomUUID(),token='a'.repeat(64),slot=new Date().toISOString().slice(0,10);
 const schemas={auth:'b'.repeat(64),business:'c'.repeat(64),master:'d'.repeat(64)};
 const status={runtimeRevision:version,keyId,sourceIds:PRODUCTION_STORE_IDS,schemaHashes:schemas,admission:true,receipt:null,writers:{active:0,owner:null,scope:PRODUCTION_RUNTIME.scope,tickets:{complete:true,scanned:0}}};
 const worker=(name,changes={},service='service')=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:{BACKUP:{type:'worker',worker:service,exportName:'Probe'},...Object.fromEntries(Object.entries({GATE_TOKEN:token,EXPIRES_AT:String(Date.now()+60000),SCOPE:PRODUCTION_RUNTIME.scope,SLOT:slot,OPERATION_ID:operationId,EXPECTED_RUNTIME:version,KEY_ID:keyId,SCHEMA_HASHES:JSON.stringify(schemas),...changes}).map(([k,value])=>[k,{type:'text',value}]))},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:manual?productionManualBackupCaptureSource():productionBackupCaptureSource()}}}}});
 const service=(name,change={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:`import {WorkerEntrypoint} from 'cloudflare:workers';let receipt=null;export class Probe extends WorkerEntrypoint {status(){return {...${JSON.stringify({...status,...change})},receipt}}statusManual(){return this.status()}runManual(id){if(id!==${JSON.stringify(operationId)})throw Error('wrong-operation');return this.run(${JSON.stringify(slot)})}run(slot){if(receipt)throw Error('duplicate');receipt={state:'verified',fenceReleased:true,slot};return receipt;}prune(){throw Error('forbidden')}}export default{fetch(){return new Response(null,{status:404})}};`}}}}});
 const mf=new Miniflare({workers:[worker('valid'),worker('expired',{EXPIRES_AT:'1'}),worker('drift',{EXPECTED_RUNTIME:randomUUID()}),worker('wrongslot',{SLOT:'2000-01-01'}),worker('wrongoperation',{OPERATION_ID:'../arbitrary'}),worker('pending',{},'pendingservice'),worker('busy',{},'busyservice'),service('service'),service('pendingservice',{admission:false}),service('busyservice',{writers:{...status.writers,active:1}})]});
 try{
  const call=async(name,path,options={})=>(await mf.getWorker(name)).fetch('https://fixture.invalid'+path,{...options,headers:{authorization:'Bearer '+token,...options.headers}});
  assert.equal((await call('valid','/run',{method:'POST',headers:{authorization:'wrong'}})).status,401);
  assert.equal((await call('expired','/run',{method:'POST'})).status,410);
  for(const name of ['drift','wrongslot','pending','busy'])assert.equal((await call(name,'/run',{method:'POST'})).status,409);
  if(manual)assert.equal((await call('wrongoperation','/run',{method:'POST'})).status,409);
  for(const [path,options] of [['/run?slot='+slot,{method:'POST'}],['/prune',{method:'POST'}],['/escrow',{method:'POST'}],['/run',{method:'POST',body:'{}'}]])assert.equal((await call('valid',path,options)).status,404);
  assert.equal((await (await call('pending','/status')).json()).admission,false);
  assert.equal((await (await call('valid','/status')).json()).receipt,null);
  const result=await call('valid','/run',{method:'POST'});assert.equal(result.status,200);const receipt=await result.json();assert.equal(receipt.slot,slot);
  assert.equal((await call('valid','/run',{method:'POST'})).status,409);
  assert.deepEqual((await (await call('valid','/status')).json()).receipt,receipt);
 }finally{await mf.dispose();}
});

}

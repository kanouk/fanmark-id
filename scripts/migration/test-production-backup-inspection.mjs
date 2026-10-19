import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {productionBackupInspectionSource} from './production-backup-inspection.mjs';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';

test('native backup inspector exposes only pinned status and encrypted escrow to a live bearer',async()=>{
 const runtime=randomUUID(),keyId='production-backup-'+randomUUID(),token='a'.repeat(64),authId='b'.repeat(64);
 const schemas={auth:'c'.repeat(64),business:'d'.repeat(64),master:'e'.repeat(64)};
 const status={runtimeRevision:runtime,keyId,sourceIds:PRODUCTION_STORE_IDS,schemaHashes:schemas,admission:false,receipt:null,writers:{active:0,owner:null}};
 const escrow={format:'fanmark-production-auth-key-escrow-v1',keyId,authKeyId:authId,nonce:Array(12).fill(1),ciphertext:Array(80).fill(2)};
 const text=value=>({type:'text',value});
 const worker=(name,changes={})=>({config:{name,type:'worker',compatibilityDate:'2026-09-18',env:{BACKUP:{type:'worker',worker:'service',exportName:'Probe'},
  ...Object.fromEntries(Object.entries({GATE_TOKEN:token,EXPIRES_AT:String(Date.now()+60000),SCOPE:PRODUCTION_RUNTIME.scope,SLOT:'2026-10-19',EXPECTED_RUNTIME:runtime,KEY_ID:keyId,AUTH_KEY_ID:authId,SCHEMA_HASHES:JSON.stringify(schemas),...changes}).map(([k,v])=>[k,text(v)]))},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:productionBackupInspectionSource()}}}}});
 const mf=new Miniflare({workers:[worker('valid'),worker('expired',{EXPIRES_AT:'1'}),worker('drift',{EXPECTED_RUNTIME:randomUUID()}),worker('scope',{SCOPE:'f'.repeat(64)}),worker('key',{AUTH_KEY_ID:'f'.repeat(64)}),worker('schema',{SCHEMA_HASHES:'{}'}),
  {config:{name:'service',type:'worker',compatibilityDate:'2026-09-18',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:`import {WorkerEntrypoint} from 'cloudflare:workers';export class Probe extends WorkerEntrypoint {status(){return ${JSON.stringify(status)}}sealAuthKey(){return ${JSON.stringify(escrow)}}run(){throw Error('must never execute')}prune(){throw Error('must never execute')}} export default {fetch(){return new Response(null,{status:404})}};`}}}}}]});
 try{
  const call=async(name,path,options={})=>(await mf.getWorker(name)).fetch('https://fixture.invalid'+path,{...options,headers:{authorization:'Bearer '+token,...options.headers}});
  assert.deepEqual(await (await call('valid','/status')).json(),status);
  const sealed=await call('valid','/escrow',{method:'POST'});assert.equal(sealed.headers.get('cache-control'),'no-store');assert.deepEqual(await sealed.json(),escrow);
  assert.equal((await call('valid','/status',{headers:{authorization:'wrong'}})).status,401);
  assert.equal((await call('expired','/status')).status,410);
  for(const name of ['drift','scope','schema'])assert.equal((await call(name,'/status')).status,409);
  assert.equal((await call('key','/escrow',{method:'POST'})).status,409);
  for(const [path,options] of [['/run',{method:'POST'}],['/prune',{method:'POST'}],['/status?slot=other',{}],['/escrow',{}],['/escrow',{method:'POST',body:'{}'}]])assert.equal((await call('valid',path,options)).status,404);
 }finally{await mf.dispose();}
});

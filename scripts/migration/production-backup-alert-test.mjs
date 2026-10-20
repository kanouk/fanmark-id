import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
/** Explicitly invoked, one fixed delivery-test alert. No arbitrary message,
 * address, slot body, backup capture, prune, or freeze controls are exposed.
 * Provision only after approval for the fixed recipient/message in the runbook. */
export function productionBackupAlertTestSource(){
 return `const SOURCES=${JSON.stringify(PRODUCTION_STORE_IDS)},SCOPE=${JSON.stringify(PRODUCTION_RUNTIME.scope)};
export default {async fetch(r,e){
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return json(null,410);
if(!/^[a-f0-9]{64}$/.test(e.GATE_TOKEN??'')||r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return json(null,401);
const u=new URL(r.url);if(u.search||r.method!=='POST'||u.pathname!=='/delivery-test')return json(null,404);
if(r.body){const reader=r.body.getReader();try{const first=await reader.read();if(!first.done){await reader.cancel();return json(null,404);}}finally{reader.releaseLock();}}
try{
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(e.SLOT??'')||new Date().toISOString().slice(0,10)!==e.SLOT)throw Error();
 const status=await e.BACKUP.status(e.SLOT);
 if(status.runtimeRevision!==e.EXPECTED_RUNTIME||status.admission!==false||status.writers?.active!==0||status.writers?.owner!==null||
  Object.keys(status.sourceIds??{}).length!==5||Object.entries(SOURCES).some(([k,v])=>status.sourceIds[k]!==v)||
  JSON.stringify(status.schemaHashes)!==e.SCHEMA_HASHES||status.keyId!==e.KEY_ID)throw Error();
 const result=await e.BACKUP.alert({slot:e.SLOT,scope:SCOPE,code:'delivery-test'});
 if(result.state!=='provider-accepted'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(result.providerId??''))throw Error();
 return json({state:result.state,providerId:result.providerId,duplicate:result.duplicate,delivered:false,productionReady:false});
}catch{return json({error:'production_backup_alert_test_unconfirmed'},409);}
}};`;
}

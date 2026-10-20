import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';

/** Explicit one-slot capture operator, separate from the read-only inspector.
 * The service atomically owns the UTC slot and fences writers. No retry, prune,
 * release, arbitrary slot or direct application-store capability is exposed. */
export function productionBackupCaptureSource(){return captureSource(false);}
/** The operation ID is deployment configuration, never caller input. */
export function productionManualBackupCaptureSource(){return captureSource(true);}
function captureSource(manual){
 return `const SOURCES=${JSON.stringify(PRODUCTION_STORE_IDS)};
export default {async fetch(r,e,ctx){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return json(null,410);
 if(!/^[a-f0-9]{64}$/.test(e.GATE_TOKEN??'')||r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return json(null,401);
 const u=new URL(r.url);
 if(u.search||!((r.method==='GET'&&u.pathname==='/status')||(r.method==='POST'&&u.pathname==='/run')))return json(null,404);
 if(r.body){const reader=r.body.getReader();try{const first=await reader.read();if(!first.done){await reader.cancel();return json(null,404);}}finally{reader.releaseLock();}}
 try{
  if(e.SCOPE!==${JSON.stringify(PRODUCTION_RUNTIME.scope)})throw Error();
  ${manual ? "if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(e.OPERATION_ID??''))throw Error();" : ""}
  const status=await e.BACKUP.${manual ? 'statusManual(e.OPERATION_ID)' : 'status(e.SLOT)'};
  if(status.runtimeRevision!==e.EXPECTED_RUNTIME||status.keyId!==e.KEY_ID||
   Object.keys(status.sourceIds??{}).length!==5||Object.entries(SOURCES).some(([k,v])=>status.sourceIds[k]!==v)||
   JSON.stringify(status.schemaHashes)!==e.SCHEMA_HASHES)throw Error();
  if(u.pathname==='/status')return json(status);
  if(status.admission!==true||e.SLOT!==new Date().toISOString().slice(0,10)||status.receipt!==null||status.writers.active!==0||
   status.writers.owner!==null||status.writers.scope!==e.SCOPE||status.writers.tickets.complete!==true||
   status.writers.tickets.scanned!==0)throw Error();
  const task=e.BACKUP.${manual ? 'runManual(e.OPERATION_ID)' : 'run(e.SLOT)'};ctx.waitUntil(task.catch(()=>{}));
  const receipt=await task;
  return json(receipt,receipt.state==='verified'&&receipt.fenceReleased===true?200:409);
 }catch{return json({error:'production_backup_capture_refused_inspect_status'},409);}
}};`;
}

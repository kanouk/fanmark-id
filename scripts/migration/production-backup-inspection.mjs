import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';

/** Short-lived operator HTTP adapter. No run/prune/fence/release capabilities
 * are exposed. The service remains on the closed production Worker. */
export function productionBackupInspectionSource(){
 return `const SOURCES=${JSON.stringify(PRODUCTION_STORE_IDS)};
export default {async fetch(r,e){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return json(null,410);
 if(!/^[a-f0-9]{64}$/.test(e.GATE_TOKEN??'')||r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return json(null,401);
 const u=new URL(r.url);
 if(u.search||!((r.method==='GET'&&u.pathname==='/status')||(r.method==='POST'&&u.pathname==='/escrow')))return json(null,404);
 if(r.body){const reader=r.body.getReader();try{const first=await reader.read();if(!first.done){await reader.cancel();return json(null,404);}}finally{reader.releaseLock();}}
 try{
  if(e.SCOPE!==${JSON.stringify(PRODUCTION_RUNTIME.scope)})throw Error();
  const status=await e.BACKUP.status(e.SLOT);
  if(status.runtimeRevision!==e.EXPECTED_RUNTIME||status.keyId!==e.KEY_ID||
   Object.keys(status.sourceIds??{}).length!==5||Object.entries(SOURCES).some(([k,v])=>status.sourceIds[k]!==v)||
   JSON.stringify(status.schemaHashes)!==e.SCHEMA_HASHES||status.admission!==false)throw Error();
  if(u.pathname==='/status')return json(status);
  const escrow=await e.BACKUP.sealAuthKey();
  if(escrow.format!=='fanmark-production-auth-key-escrow-v1'||escrow.keyId!==e.KEY_ID||escrow.authKeyId!==e.AUTH_KEY_ID||
   Object.keys(escrow).sort().join(',')!=='authKeyId,ciphertext,format,keyId,nonce'||
   !Array.isArray(escrow.nonce)||escrow.nonce.length!==12||!Array.isArray(escrow.ciphertext)||escrow.ciphertext.length!==80||
   [...escrow.nonce,...escrow.ciphertext].some(b=>!Number.isInteger(b)||b<0||b>255))throw Error();
  return json(escrow);
 }catch{return json({error:'production_backup_inspection_refused'},409);}
}};`;
}

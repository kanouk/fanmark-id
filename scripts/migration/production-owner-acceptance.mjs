/** Binding-only issuer transport. Provision after the owner accepts the G5
 * forward-recovery boundary. Never print or persist the returned browser URL. */
export function productionOwnerAcceptanceProxySource(){
 return `export default {async fetch(r,e){
const json=(b,s=200)=>Response.json(b,{status:s,headers:{'cache-control':'no-store'}});
if(!Number.isSafeInteger(Number(e.EXPIRES_AT))||Date.now()>=Number(e.EXPIRES_AT))return json(null,410);
if(!/^[a-f0-9]{64}$/.test(e.GATE_TOKEN??'')||r.headers.get('authorization')!=='Bearer '+e.GATE_TOKEN)return json(null,401);
const u=new URL(r.url);if(r.method!=='POST'||u.pathname!=='/issue'||u.search)return json(null,404);
if(r.body){const reader=r.body.getReader();try{if(!(await reader.read()).done){await reader.cancel();return json(null,404);}}finally{reader.releaseLock();}}
try{const result=await e.OWNER.issue({runId:e.RUN_ID,expiresAt:Number(e.BROWSER_EXPIRES_AT)});
if(result.runtimeVersion!==e.EXPECTED_RUNTIME||result.runId!==e.RUN_ID||result.expiresAt!==Number(e.BROWSER_EXPIRES_AT)||typeof result.token!=='string'||result.token.length>1024||!/^[A-Za-z0-9_-]+\\.[a-f0-9]{64}$/.test(result.token))throw Error();
return json({runtimeVersion:result.runtimeVersion,expiresAt:result.expiresAt,runId:result.runId,browserUrl:'https://fanmark.id/__migration/owner#'+result.token});
}catch{return json({error:'production_owner_acceptance_unavailable'},409);}
}};`;
}

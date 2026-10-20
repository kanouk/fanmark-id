/** Fixed-project Management API adapter. Exposes only generated receipt SQL. */
import {renderSourceStripeReceiptOnly} from './source-stripe-receipt-only.mjs';
import {prepareStripeReceiptTransfer,prepareStripeReceiptReturn} from './stripe-receipt-transfer.mjs';
const PROJECT='ppqgtbjykitqtiaisyji';
const transports=new WeakSet();
const fail=code=>{throw Error('source_stripe_return_'+code);};
export const isSourceStripeReturnTransport=value=>transports.has(value);
const preflightSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object('role',current_user,'transactionReadOnly',current_setting('transaction_read_only'),
 'receiptSchemaPresent',to_regnamespace('billing_ingress') IS NOT NULL,
 'canCreateSchema',has_database_privilege(current_user,current_database(),'CREATE'));
COMMIT;`;

export async function createSourceStripeReturnTransport({token,runId,originalFunction,access='read-only',fetchImpl=fetch}={}) {
 if(typeof token!=='string'||token.length<16||/\s/u.test(token)||!['read-only','return'].includes(access)||typeof fetchImpl!=='function')fail('options_invalid');
 originalFunction=Object.freeze(structuredClone(originalFunction));
 const candidate=await renderSourceStripeReceiptOnly({projectRef:PROJECT,runId,originalFunction});
 async function query(sql){
  if(Buffer.byteLength(sql)>8*1024*1024)fail('query_too_large');
  let response;
  try{response=await fetchImpl(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
   method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
   // API read_only=true selects supabase_read_only_user, which cannot access
   // the private ingress schema. Read methods use an explicit READ ONLY SQL
   // transaction as postgres; caller-supplied SQL is never accepted here.
   body:JSON.stringify({query:sql,read_only:false}),signal:AbortSignal.timeout(45000)});
  }catch{fail('request_acknowledgement_unknown');}
  if(response.status!==201){try{await response.body?.cancel();}catch{}fail('request_refused');}
  const reader=response.body?.getReader();if(!reader)fail('response_invalid');
  const chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
   if(bytes>12*1024*1024){await reader.cancel();fail('response_too_large');}chunks.push(Buffer.from(part.value));}
  }catch{fail('response_unconfirmed');}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('response_invalid');}
  if(!Array.isArray(result))fail('response_invalid');return result;
 }
 function single(rows){
  if(rows.length!==1||!rows[0]||Object.keys(rows[0]).join(',')!=='jsonb_build_object'||!rows[0].jsonb_build_object)fail('response_invalid');
  return rows[0].jsonb_build_object;
 }
 const transport=Object.freeze({projectRef:PROJECT,runId,originalFunction,access,
  async preflight(){
   const value=single(await query(preflightSql));
   if(value.role!=='postgres'||value.transactionReadOnly!=='on'||typeof value.receiptSchemaPresent!=='boolean'||value.canCreateSchema!==true)fail('source_role_unconfirmed');
   return value;
  },
  async readSealedExport(){
   const value=single(await query(candidate.exportSql));
   await prepareStripeReceiptTransfer(value,{runId});
   if(value.originalFunctionSha256!==originalFunction.sourceTreeSha256)fail('original_function_mismatch');
   return value;
  },
  async applyReturn({sourceBefore,returnedSource}={}){
   if(access!=='return')fail('write_access_required');
   const target=await prepareStripeReceiptTransfer(returnedSource,{runId});
   const plan=await prepareStripeReceiptReturn({sourceBefore,targetTables:target.tables,runId,originalFunction,closedAt:returnedSource.sealedAt});
   const result=await query(plan.sql);
   // The generated script includes a SELECT of the locked control row. Rows
   // are deliberately not treated as proof that the transaction committed.
   if(result.some(row=>Object.keys(row).some(key=>key!=='singleton')))fail('write_response_unconfirmed');
   return {requestAcknowledged:true,sourceReadbackVerified:false,sqlSha256:plan.sqlSha256};
  },
 });
 transports.add(transport);return transport;
}

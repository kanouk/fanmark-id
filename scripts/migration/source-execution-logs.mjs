/** Fixed-project, metadata-only log evidence. Never a complete drain proof:
 * provider capture, retention and ingestion delay are outside this query. */
import {canonicalJson,sha256Hex} from './snapshot-format.mjs';
const PROJECT='ppqgtbjykitqtiaisyji';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const sources=['function_edge_logs','function_logs'];
const fields=['source','id','timestamp_us','function_id','deployment_id','execution_id','version','event_type','reason','status','execution_time_ms','project_ref'];
const fail=code=>{throw Error('source_execution_logs_'+code);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const instant=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/u.test(value))return false;
 const milliseconds=Date.parse(value);return Number.isFinite(milliseconds)&&new Date(milliseconds).toISOString()===value.replace('Z','.000Z');
};
const order=(a,b)=>BigInt(a.timestamp_us)<BigInt(b.timestamp_us)?-1:BigInt(a.timestamp_us)>BigInt(b.timestamp_us)?1:a.id<b.id?-1:a.id>b.id?1:0;

function validateRow(row,start,end){
 if(!exact(row,fields)||fields.some(k=>typeof row[k]!=='string'||row[k].length>256)||!sources.includes(row.source)||!UUID.test(row.id)||
  !/^\d{1,18}$/u.test(row.timestamp_us)||BigInt(row.timestamp_us)<start||BigInt(row.timestamp_us)>=end||
  (row.project_ref!==''&&row.project_ref!==PROJECT))fail('row_invalid');
 for(const key of ['function_id','execution_id'])if(row[key]&&!UUID.test(row[key]))fail('row_invalid');
 if(row.version&&!/^[1-9]\d{0,8}$/u.test(row.version))fail('row_invalid');
 if(row.deployment_id&&!new RegExp(`^${PROJECT}_[a-f0-9-]{36}_[1-9]\\d{0,8}$`,'u').test(row.deployment_id))fail('row_invalid');
 if(row.event_type&&!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(row.event_type))fail('row_invalid');
 if(row.reason&&!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(row.reason))fail('row_invalid');
 if(row.status&&!/^[1-5]\d{2}$/u.test(row.status))fail('row_invalid');
 if(row.execution_time_ms&&!/^\d{1,12}(?:\.\d{1,6})?$/u.test(row.execution_time_ms))fail('row_invalid');
 return row;
}

export function summarizeSourceExecutions(rows){
 const groups=new Map();let uncorrelatedRows=0;
 for(const row of rows){
  if(!row.execution_id||!row.function_id||!row.version||!row.deployment_id||!row.project_ref){uncorrelatedRows++;continue;}
  let group=groups.get(row.execution_id);
  if(!group){group={executionId:row.execution_id,functionId:row.function_id,version:row.version,deploymentId:row.deployment_id,
   firstTimestampUs:row.timestamp_us,lastTimestampUs:row.timestamp_us,boots:[],shutdowns:[],http:[],identityConflict:false};groups.set(row.execution_id,group);}
  if(group.functionId!==row.function_id||group.version!==row.version||group.deploymentId!==row.deployment_id||
   row.deployment_id!==`${PROJECT}_${row.function_id}_${row.version}`)group.identityConflict=true;
  if(BigInt(row.timestamp_us)<BigInt(group.firstTimestampUs))group.firstTimestampUs=row.timestamp_us;
  if(BigInt(row.timestamp_us)>BigInt(group.lastTimestampUs))group.lastTimestampUs=row.timestamp_us;
  if(row.source==='function_logs'&&row.event_type==='Boot')group.boots.push(row.timestamp_us);
  if(row.source==='function_logs'&&row.event_type==='Shutdown')group.shutdowns.push({timestampUs:row.timestamp_us,reason:row.reason});
  if(row.source==='function_edge_logs')group.http.push({timestampUs:row.timestamp_us,status:row.status});
 }
 const executions=[...groups.values()].map(group=>{
  const last=group.shutdowns.at(-1);
  const terminationObserved=!group.identityConflict&&group.boots.length<=1&&group.shutdowns.length===1&&
   last.timestampUs===group.lastTimestampUs;
  return {...group,terminationObserved,gracefulTerminationObserved:terminationObserved&&['EarlyDrop','EventLoopCompleted'].includes(last.reason),
   businessEffectsVerified:false};
 }).sort((a,b)=>a.executionId.localeCompare(b.executionId,'en'));
 return {executions,uncorrelatedRows,executionCount:executions.length,
  terminationObservedCount:executions.filter(g=>g.terminationObserved).length,
  unresolvedExecutionCount:executions.filter(g=>!g.terminationObserved).length,
  abnormalTerminationCount:executions.filter(g=>g.terminationObserved&&!g.gracefulTerminationObserved).length};
}

export async function collectSourceExecutionLogs({token,from,to,pageSize=500,maxRows=20000,fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length<16||/\s/u.test(token)||!instant(from)||!instant(to)||Date.parse(to)<=Date.parse(from)||
  Date.parse(to)-Date.parse(from)>86400000||!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||
  !Number.isInteger(maxRows)||maxRows<pageSize||maxRows>50000||typeof fetchImpl!=='function')fail('options_invalid');
 const start=BigInt(Date.parse(from))*1000n,end=BigInt(Date.parse(to))*1000n;
 const where=`source IN ('function_logs','function_edge_logs') AND timestamp >= fromUnixTimestamp64Micro(${start}) AND timestamp < fromUnixTimestamp64Micro(${end})`;
 const countSql=`SELECT source, count() AS events FROM logs WHERE ${where} GROUP BY source ORDER BY source LIMIT 3`;
 const projection=`source, id, toString(toUnixTimestamp64Micro(timestamp)) AS timestamp_us, ${fields.slice(3).map(k=>`log_attributes['${k==='status'?'response.status_code':k}'] AS ${k}`).join(', ')}`;
 async function query(sql){
  const url=new URL(`https://api.supabase.com/v1/projects/${PROJECT}/analytics/endpoints/logs`);
  url.search=new URLSearchParams({sql,iso_timestamp_start:from,iso_timestamp_end:to}).toString();
  let response;
  try{response=await fetchImpl(url.toString(),{method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)});}
  catch{fail('request_unconfirmed');}
  if(response.status!==200){try{await response.body?.cancel();}catch{}fail('request_refused');}
  const reader=response.body?.getReader();if(!reader)fail('response_invalid');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();fail('response_too_large');}chunks.push(Buffer.from(value));}}
  catch{fail('response_unconfirmed');}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('response_invalid');}
  if(!value||value.error||!Array.isArray(value.result))fail('query_failed');
  return value.result;
 }
 function counts(rows){
  const result=Object.fromEntries(sources.map(s=>[s,0])),seen=new Set();
  for(const row of rows){if(!exact(row,['source','events'])||!sources.includes(row.source)||seen.has(row.source)||
   !Number.isSafeInteger(row.events)||row.events<0||row.events>maxRows)fail('count_invalid');seen.add(row.source);result[row.source]=row.events;}
  if(Object.values(result).reduce((a,b)=>a+b,0)>maxRows)fail('row_limit');return result;
 }
 const before=counts(await query(countSql)),rows=[],seen=new Set();let cursor=null,pages=0;
 for(;;){
  // ClickHouse UUID ordering differs from the returned UUID string order.
  // Use the same explicit string comparison in ORDER BY and the cursor.
  const suffix=cursor?` AND (timestamp, toString(id)) > (fromUnixTimestamp64Micro(${cursor.timestamp_us}), '${cursor.id}')`:'';
  const page=await query(`SELECT ${projection} FROM logs WHERE ${where}${suffix} ORDER BY timestamp, toString(id) LIMIT ${pageSize}`);pages++;
  if(page.length>pageSize)fail('page_invalid');
  for(const raw of page){const row=validateRow(raw,start,end);if(seen.has(row.id)||(cursor&&order(cursor,row)>=0))fail('page_order_invalid');
   seen.add(row.id);rows.push(row);cursor=row;if(rows.length>maxRows)fail('row_limit');}
  if(page.length<pageSize)break;
 }
 const after=counts(await query(countSql)),actual=Object.fromEntries(sources.map(s=>[s,rows.filter(r=>r.source===s).length]));
 if(canonicalJson(before)!==canonicalJson(after)||canonicalJson(actual)!==canonicalJson(after))fail('window_changed_or_incomplete');
 return {format:'fanmark-source-execution-log-evidence-v1',projectRef:PROJECT,from,to,pages,counts:actual,
  rows,rowsSha256:sha256Hex(rows),...summarizeSourceExecutions(rows),queryRowsAccountedFor:true,
  providerCaptureComplete:false,sourceDrainVerified:false,externalEffectsVerified:false,productionReady:false,sourceWrites:0};
}

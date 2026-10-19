import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSourceExecutionLogs} from './source-execution-logs.mjs';
const project='ppqgtbjykitqtiaisyji',from='2026-10-19T01:00:00Z',to='2026-10-19T02:00:00Z';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function row(n,change={}){return {source:'function_logs',id:uuid(n),timestamp_us:String(BigInt(Date.parse(from))*1000n+BigInt(n)*1000n),
 function_id:uuid(100),deployment_id:`${project}_${uuid(100)}_172`,execution_id:uuid(200),version:'172',event_type:'Log',reason:'',status:'',execution_time_ms:'',project_ref:project,...change};}
function fixture(rows,change={}){
 const calls=[];let countCalls=0;
 const options={token:'secret_sentinel_never_print',from,to,pageSize:2,maxRows:20,fetchImpl:async(url,request)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://api.supabase.com');
  assert.equal(parsed.pathname,`/v1/projects/${project}/analytics/endpoints/logs`);
  assert.equal(request.method,'GET');assert.equal(request.redirect,'error');
  assert.equal(parsed.searchParams.get('iso_timestamp_start'),from);assert.equal(parsed.searchParams.get('iso_timestamp_end'),to);
  const sql=parsed.searchParams.get('sql');calls.push(sql);
  assert.doesNotMatch(sql,/event_message|request\.headers|request\.url|select\s+\*/iu);
  if(change.response)return change.response(sql);
  if(sql.includes('count()')){
   countCalls++;const counts=['function_logs','function_edge_logs'].map(source=>({source,events:rows.filter(r=>r.source===source).length}));
   return Response.json({result:change.counts?.(counts,countCalls)??counts});
  }
  assert.match(sql,/ORDER BY timestamp, toString\(id\)/u);
  const match=sql.match(/AND \(timestamp, toString\(id\)\) > \(fromUnixTimestamp64Micro\((\d+)\), '([a-f0-9-]+)'\)/u);
  const available=match?rows.filter(r=>BigInt(r.timestamp_us)>BigInt(match[1])||(r.timestamp_us===match[1]&&r.id>match[2])):rows;
  return Response.json({result:change.page?.(available,match)??available.slice(0,2)});
 }};return {options,calls};
}
test('metadata pagination joins actual execution identity and records termination separately from effects',async()=>{
 const rows=[row(1,{event_type:'Boot'}),row(2,{source:'function_edge_logs',event_type:'',status:'200',execution_time_ms:'5'}),row(3,{event_type:'Shutdown',reason:'EarlyDrop'})];
 // A tie in timestamps still advances by event UUID.
 rows[1].timestamp_us=rows[0].timestamp_us;
 const f=fixture(rows),result=await collectSourceExecutionLogs(f.options);
 assert.equal(result.pages,2);assert.equal(result.terminationObservedCount,1);
 assert.equal(result.executions[0].gracefulTerminationObserved,true);
 assert.equal(result.executions[0].businessEffectsVerified,false);assert.equal(result.queryRowsAccountedFor,true);
 for(const name of ['providerCaptureComplete','sourceDrainVerified','externalEffectsVerified','productionReady'])assert.equal(result[name],false);
 assert.equal(result.sourceWrites,0);assert.deepEqual(result.rows,rows);
 assert.equal(f.calls.length,4);assert.ok(!JSON.stringify(result).includes(f.options.token));
});
test('HTTP 200 alone, missing identity, conflicting deployment and a timed-out execution cannot prove safe completion',async()=>{
 for(const [rows,expected] of [
  [[row(1,{source:'function_edge_logs',event_type:'',status:'200'})],{unresolved:1,uncorrelated:0,abnormal:0}],
  [[row(1,{execution_id:''})],{unresolved:0,uncorrelated:1,abnormal:0}],
  [[row(1,{event_type:'Boot'}),row(2,{event_type:'Shutdown',reason:'EarlyDrop',version:'173'})],{unresolved:1,uncorrelated:0,abnormal:0}],
  [[row(1,{event_type:'Boot'}),row(2,{event_type:'Shutdown',reason:'WallClockTime'})],{unresolved:0,uncorrelated:0,abnormal:1}],
  [[row(1,{event_type:'Shutdown',reason:'EarlyDrop'}),row(2,{event_type:'Log'})],{unresolved:1,uncorrelated:0,abnormal:0}],
 ]){
  const result=await collectSourceExecutionLogs(fixture(rows).options);
  assert.equal(result.unresolvedExecutionCount,expected.unresolved);assert.equal(result.uncorrelatedRows,expected.uncorrelated);
  assert.equal(result.abnormalTerminationCount,expected.abnormal);assert.equal(result.sourceDrainVerified,false);
 }
});
test('empty recorded window is not a claim that the source stopped',async()=>{
 const result=await collectSourceExecutionLogs(fixture([]).options);
 assert.equal(result.executionCount,0);assert.equal(result.queryRowsAccountedFor,true);assert.equal(result.sourceDrainVerified,false);
});
test('late count changes, missing pages, duplicate order and unexpected fields refuse partial evidence',async()=>{
 const rows=[row(1),row(2),row(3)];
 for(const change of [
  {counts:(v,n)=>n===2?v.map(r=>({...r,events:r.events+1})):v},
  {page:available=>available.slice(0,1)},
  {page:()=>[rows[0],rows[0]]},
  {page:()=>[{...rows[0],event_message:'private sentinel'}]},
  {page:()=>[{...rows[0],project_ref:'otherproject'}]},
  {page:()=>[{...rows[0],timestamp_us:'1'}]},
 ])await assert.rejects(collectSourceExecutionLogs(fixture(rows,change).options),/^Error: source_execution_logs_[a-z_]+$/u);
});
test('provider errors, refusal and network secrets never appear in thrown diagnostics',async()=>{
 for(const response of [()=>Response.json({error:'secret_sentinel_never_print',result:[]}),
  ()=>new Response('secret_sentinel_never_print',{status:403}),()=>{throw Error('secret_sentinel_never_print');}]){
  await assert.rejects(collectSourceExecutionLogs(fixture([],{response}).options),e=>/^source_execution_logs_[a-z_]+$/u.test(e.message)&&!e.message.includes('sentinel'));
 }
});
test('invalid date ranges and limits are refused before network access',async()=>{
 for(const change of [{from:'2026-02-30T01:00:00Z'},{from:'2026-99-19T01:00:00Z'},{to:from},{to:'2026-10-21T00:00:00Z'},
  {from:'2026-10-19T01:00:01Z'},{from:'2026-10-19T01:00:00+00:00'},{pageSize:0},{pageSize:1001},{maxRows:1}]){
  const f=fixture([]);await assert.rejects(collectSourceExecutionLogs({...f.options,...change}),/options_invalid/);assert.equal(f.calls.length,0);
 }
});

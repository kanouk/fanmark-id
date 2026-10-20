/** Same-live-executor reconciliation only. An absent receipt never authorizes replay. */
const table='fanmark_import_operation_commits';
const fail=()=>{throw Error('master_atomic_commit_unconfirmed');};
export function validateMasterCommitStatements(items){
  for(const {sql} of items){
    const masked=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/gu,"''");
    // The reviewed import stage only uses non-returning DML. changes() is
    // observed immediately after each statement; wrappers must not affect SQL.
    if(!/^\s*(INSERT|UPDATE|DELETE)\s/iu.test(masked)||/;|--|\/\*|\*\/|\bRETURNING\b|\b(?:changes|total_changes|last_insert_rowid)\s*\(/iu.test(masked)||sql.includes(table))fail();
  }
}
export function masterCommitBatch(items,{operationId,runId,batchSha256,targetId,targetIncarnation}){
  validateMasterCommitStatements(items);
  const batch=[{sql:`INSERT INTO ${table} (operation_id,run_id,batch_sha256,target_id,target_incarnation,statement_count,phase) VALUES (?,?,?,?,?,?,'building')`,params:[operationId,runId,batchSha256,targetId,targetIncarnation,items.length]}];
  for(const item of items){batch.push(item,{sql:`UPDATE ${table} SET changes_json=json_insert(changes_json,'$[#]',changes()) WHERE operation_id=? AND phase='building'`,params:[operationId]});}
  batch.push({sql:`UPDATE ${table} SET phase='committed' WHERE operation_id=? AND phase='building'`,params:[operationId]});
  return batch;
}
export function masterCommitRead(operationId){return {sql:`SELECT operation_id,run_id,batch_sha256,target_id,target_incarnation,statement_count,changes_json,phase FROM ${table} WHERE operation_id=?`,params:[operationId]};}
export function reconcileMasterCommit(result,identity,count){
  if(!Array.isArray(result)||result.length!==1||result[0]?.success!==true||result[0]?.meta?.rows_written!==0||result[0]?.results?.length!==1)fail();
  const row=result[0].results[0],expected={operation_id:identity.operationId,run_id:identity.runId,batch_sha256:identity.batchSha256,target_id:identity.targetId,target_incarnation:identity.targetIncarnation,statement_count:count,phase:'committed'};
  if(Object.keys(row).sort().join(',')!==[...Object.keys(expected),'changes_json'].sort().join(',')||Object.entries(expected).some(([k,v])=>row[k]!==v))fail();
  let changes;try{changes=JSON.parse(row.changes_json);}catch{fail();}
  if(!Array.isArray(changes)||changes.length!==count||changes.some(n=>!Number.isSafeInteger(n)||n<0))fail();
  return changes.map(n=>({success:true,results:[],meta:{changes:n,reconciled_from_commit_receipt:true}}));
}

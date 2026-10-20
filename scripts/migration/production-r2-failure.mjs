/** Append no data to the import journal and never authorize a retry. */
import {open,lstat,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

export const R2_IMPORT_FAILURE_STAGES=Object.freeze(['runtime','route','input-object','body','content-digest','operation-digest','dispatch','r2-put','r2-response']);
const transportCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ABORT_ERR',
  'UND_ERR_INVALID_ARG','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH','UND_ERR_RES_CONTENT_LENGTH_MISMATCH']);
export function r2FailureDiagnostics(error){
  const out={};
  if(Number.isSafeInteger(error?.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599)out.httpStatus=error.httpStatus;
  if(R2_IMPORT_FAILURE_STAGES.includes(error?.serviceStage))out.serviceStage=error.serviceStage;
  if(Number.isSafeInteger(error?.dispatchStatus)&&error.dispatchStatus>=100&&error.dispatchStatus<=599)out.dispatchStatus=error.dispatchStatus;
  // Keep already-sanitized diagnostics through the transport error wrapper.
  // Bound nested AggregateError/cause traversal and never copy messages or URLs.
  const allowed=code=>transportCodes.has(code)||['AbortError','TimeoutError'].includes(code);
  const queue=[error],seen=new Set();
  for(let i=0;queue.length&&i<12;i++){
    const cause=queue.shift();if(!cause||typeof cause!=='object'||seen.has(cause))continue;seen.add(cause);
    const code=[cause.transportCode,cause.code,cause.name].find(allowed);
    if(code){out.transportCode=code;break;}
    if(cause.cause)queue.push(cause.cause);
    if(Array.isArray(cause.errors))queue.push(...cause.errors.slice(0,4));
  }
  return out;
}
export async function saveProductionR2Failure({journalPath,runId,operationId,batchSha256,phase,dataRequestAttempted,error}){
  const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
  if(!isAbsolute(journalPath??'')||!uuid.test(runId??'')||(operationId!==null&&!uuid.test(operationId??''))||
    !/^[0-9a-f]{64}$/u.test(batchSha256??'')||typeof dataRequestAttempted!=='boolean'||
    !['begin','http-put','http-response','response-metadata','acknowledge'].includes(phase))throw Error('production_r2_failure_record_invalid');
  const parent=dirname(journalPath),stat=await lstat(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700)throw Error('production_r2_failure_record_invalid');
  const record={format:'fanmark-production-r2-failure-v1',at:new Date().toISOString(),runId,operationId,
    batchSha256,phase,dataRequestAttempted,diagnostics:r2FailureDiagnostics(error),outcomeResolved:false,replayAllowed:false};
  let file;
  try{file=await open(journalPath+'.failure.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){
    if(error.code!=='EEXIST'||operationId===null)throw error;
    const path=journalPath+'.failure.json',stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size>16384)throw error;
    const prior=JSON.parse(await readFile(path,'utf8'));
    if(prior.format!==record.format||prior.runId!==runId||!uuid.test(prior.operationId??'')||prior.operationId===operationId)throw error;
    // Preserve the first failure verbatim. A later, newly admitted operation
    // receives its own immutable sidecar, never an overwrite or retry grant.
    file=await open(journalPath+'.failure-'+operationId+'.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  }
  try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
  const directory=await open(dirname(journalPath),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
}

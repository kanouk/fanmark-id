import {open, lstat, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {importJournalHostHash} from './production-import-inspection.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const fail=()=>{throw Error('initial_import_set_execution_lock_unconfirmed');};
const name='.initial-import-execution.lock';
async function sync(directory){const f=await open(directory,constants.O_RDONLY);try{await f.sync();}finally{await f.close();}}
async function parent(directory){
  if(!isAbsolute(directory??''))fail();
  const s=await lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700)fail();
}
async function read(path){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const s=await f.stat();if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||s.size>4096)fail();
    const text=await f.readFile('utf8'),after=await f.stat();
    if(s.size!==after.size||s.mtimeMs!==after.mtimeMs)fail();
    return {text,dev:s.dev,ino:s.ino,value:JSON.parse(text)};
  }finally{await f.close();}
}
async function write(path,value,directory){
  const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}
  await sync(directory);
}
function unchanged(a,b){if(a.text!==b.text||a.dev!==b.dev||a.ino!==b.ino)fail();}
function exited(owner){
  if(owner.hostHash!==importJournalHostHash()||!Number.isSafeInteger(owner.processId)||owner.processId<1)fail();
  try{process.kill(owner.processId,0);fail();}catch(e){if(e.code!=='ESRCH')fail();}
}
export async function createImportExecutionLock({directory,runId,manifestSha256,sourceEvidenceSha256}){
  await parent(directory);
  const path=join(directory,name),executorId=randomUUID();
  const value={format:'fanmark-import-execution-lock-v1',runId,manifestSha256,sourceEvidenceSha256,
    executorId,processId:process.pid,hostHash:importJournalHostHash()};
  await write(path,value,directory);const original=await read(path);
  return {executorId,async release(){unchanged(original,await read(path));await unlink(path);await sync(directory);}};
}

/** Internal filesystem wrapper. The all-store runner supplies independent
 * source/journal/data checks and the CAS remote release; this writes no data.
 * Unknown remote release retains both locks and the durable report.
 */
export async function recoverExitedImportExecution({directory,runId,manifestSha256,sourceEvidenceSha256,verify,release}){
  await parent(directory);
  const path=join(directory,name),original=await read(path),owner=original.value;
  if(Object.keys(owner).sort().join(',')!=='executorId,format,hostHash,manifestSha256,processId,runId,sourceEvidenceSha256'||
      owner.format!=='fanmark-import-execution-lock-v1'||!UUID.test(owner.executorId??'')||
      owner.runId!==runId||owner.manifestSha256!==manifestSha256||owner.sourceEvidenceSha256!==sourceEvidenceSha256)fail();
  exited(owner);
  const recoveryPath=path+'.recovery';
  await write(recoveryPath,{executorId:owner.executorId,processId:process.pid},directory);
  // Preserve the recovery lock on any failure: its partial proof cannot be
  // silently discarded by a subsequent process.
  unchanged(original,await read(path));exited(owner);
  const proof=await verify(owner.executorId);
  unchanged(original,await read(path));exited(owner);
  const reportPath=join(directory,'execution-recovery-'+owner.executorId+'.json');
  await write(reportPath,{format:'fanmark-import-execution-recovery-v1',owner,proof},directory);
  await release(owner.executorId,proof);
  unchanged(original,await read(path));
  await unlink(path);await sync(directory);await unlink(recoveryPath);await sync(directory);
  return {executionOwnershipRecovered:true,reportPath,providerWrites:0,sourceFreezeVerified:false,productionReady:false};
}

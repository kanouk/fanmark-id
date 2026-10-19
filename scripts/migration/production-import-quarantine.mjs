/** Terminally abandon a partial import, preserving all stores and unknown ACKs.
 * This does not reopen source, release a fence, resolve writes, or delete data. */
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve,isAbsolute} from 'node:path';
import {sha256Hex} from './snapshot-format.mjs';
import {isProductionImportCoordinator} from './production-import-coordinator-client.mjs';
import {inspectProductionImportSet} from './production-import-inspection.mjs';
import {inspectExitedImportExecution} from './production-import-execution-lock.mjs';
const fail=()=>{throw Error('production_import_quarantine_unconfirmed');};
const HASH=/^[0-9a-f]{64}$/u;
async function save(path,value){
 const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 const bytes=JSON.stringify(value)+'\n';
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 const d=await open(dirname(path),constants.O_RDONLY);try{await d.sync();}finally{await d.close();}
 return sha256Hex(bytes);
}
export async function quarantineProductionImportExecution(options={}){
 try{return await execute(options);}catch{fail();}
}
async function execute({coordinator,journalPaths,sourceEvidenceSha256}={}){
 if(!isProductionImportCoordinator(coordinator)||!HASH.test(sourceEvidenceSha256??'')||!journalPaths||
   Object.values(journalPaths).some(p=>!isAbsolute(p??'')))fail();
 const directory=dirname(journalPaths.auth),stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700||await realpath(directory)!==resolve(directory)||
   Object.values(journalPaths).some(p=>dirname(p)!==directory))fail();
 const owner=await inspectExitedImportExecution({directory,runId:coordinator.owner,
   manifestSha256:coordinator.manifestSha256,sourceEvidenceSha256});
 const path=resolve(directory,'import-quarantine-'+owner.owner.executorId+'.json');
 // The lock and evidence remain even after success or unknown quarantine ACK.
 await save(path+'.lock',{executorId:owner.owner.executorId,processId:process.pid});
 const before=await coordinator.inspect();
 if(before.quarantine||before.active!==0||before.fenceOwner!==coordinator.owner||
   before.executorId!==owner.owner.executorId||!before.state)fail();
 const journals=await inspectProductionImportSet({coordinator,journalPaths});
 await owner.unchanged();
 const after=await coordinator.inspect();
 if(JSON.stringify(before)!==JSON.stringify(after)||journals.remoteStateSha256!==sha256Hex(JSON.stringify(after)))fail();
 const proof={format:'fanmark-production-import-quarantine-proof-v1',owner:owner.owner,
   state:after,journals,providerWrites:0,unknownOutcomesResolved:false,sourceReopened:false,productionReady:false};
 const proofSha256=await save(path,proof),stateSha256=sha256Hex(JSON.stringify(after.state));
 await owner.unchanged();
 await coordinator.quarantineExecution({executorId:owner.owner.executorId,stateSha256,proofSha256});
 const readback=await coordinator.inspect();
 if(JSON.stringify(readback.state)!==JSON.stringify(after.state)||readback.active!==0||readback.fenceOwner!==coordinator.owner||
   readback.executorId!==after.executorId||readback.quarantine?.proofSha256!==proofSha256||
   readback.quarantine.stateSha256!==stateSha256)fail();
 await owner.unchanged();
 const report={format:'fanmark-production-import-quarantined-v1',proofSha256,stateSha256,
   importPermanentlyBlocked:true,fenceRetained:true,allJournalsRetained:true,unknownOutcomesResolved:false,
   providerWrites:0,sourceReopened:false,productionReady:false};
 await save(path+'.verified.json',report);
 return {...report,proofPath:path};
}

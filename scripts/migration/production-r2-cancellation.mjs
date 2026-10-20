/** Seal only an undispatched R2 intent. Never resends a data request. */
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectExitedImportExecution} from './production-import-execution-lock.mjs';
import {inspectProductionImportSet,inspectProductionImportAttempt,recoverCancelledProductionR2Import} from './production-import-inspection.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw Error('production_r2_cancellation_unconfirmed');};
export async function cancelUndispatchedProductionR2({directory,runId,manifestSha256,sourceEvidenceSha256,journalPaths,store,coordinator}){
  if(!['avatars','covers'].includes(store)||coordinator.owner!==runId||coordinator.manifestSha256!==manifestSha256)fail();
  const exited=await inspectExitedImportExecution({directory,runId,manifestSha256,sourceEvidenceSha256});
  const before=await inspectProductionImportSet({journalPaths,coordinator});
  const attempt=await inspectProductionImportAttempt({journalPath:journalPaths[store],coordinator});
  const {local,remote}=attempt;
  if(attempt.classification!=='remote-pending-unresolved'||remote.quarantine||remote.active!==0||remote.fenceOwner!==runId||
    remote.executorId!==exited.owner.executorId||remote.state.readbackSha256!==null||before.localPendingCount!==1||before.retainedLockCount!==1||
    !local.lock?.owner||local.lock.owner.operationId!==local.pending.operationId||local.lock.owner.processId!==exited.owner.processId||
    local.lock.owner.hostHash!==exited.owner.hostHash||remote.dispatched||remote.acknowledged||remote.cancelled)fail();
  const operationId=local.pending.operationId;
  const proof={format:'fanmark-r2-undispatched-cancellation-v1',runId,manifestSha256,sourceEvidenceSha256,
    executor:exited.owner,store,attempt,set:before,at:new Date().toISOString(),dataRequestReplayed:false};
  const proofSha256=hash(proof),stateSha256=hash(remote.state);
  // Immutable intent/proof stays after success, lost response, or local repair failure.
  const proofPath=join(directory,'r2-cancellation-'+operationId+'.json');
  const file=await open(proofPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(JSON.stringify(proof)+'\n');await file.sync();}finally{await file.close();}
  const sync=await open(directory,constants.O_RDONLY);try{await sync.sync();}finally{await sync.close();}
  await exited.unchanged();
  if(JSON.stringify(await inspectProductionImportSet({journalPaths,coordinator}))!==JSON.stringify(before)||
    JSON.stringify(await inspectProductionImportAttempt({journalPath:journalPaths[store],coordinator}))!==JSON.stringify(attempt))fail();
  // No retry, including a lost cancellation response. Inspect its tombstone instead.
  await coordinator.cancelUndispatchedR2({executorId:exited.owner.executorId,operationId,batchSha256:local.pending.batchSha256,
    store,stateSha256,proofSha256});
  await exited.unchanged();
  const sealed=await coordinator.inspectOperation(operationId);
  if(sealed.quarantine||sealed.active!==0||sealed.fenceOwner!==runId||sealed.executorId!==exited.owner.executorId||
    sealed.pending||sealed.acknowledged||sealed.dispatched||sealed.state.pending||sealed.state.acknowledged!==remote.state.acknowledged||
    sealed.cancelled?.proofSha256!==proofSha256||sealed.cancelled?.stateSha256!==stateSha256)fail();
  const repaired=await recoverCancelledProductionR2Import({journalPath:journalPaths[store],coordinator});
  return {...repaired,proofPath,proofSha256,stateSha256,remoteJournalWrites:1,providerWrites:0,originalRequestPermanentlyRejected:true};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {r2FailureDiagnostics,saveProductionR2Failure} from './production-r2-failure.mjs';

test('R2 failure records contain bounded diagnostics and cannot replace the first uncertain result',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fanmark-r2-failure-'));
  try{
    const error=Object.assign(Error('PRIVATE_PROVIDER_TEXT'),{httpStatus:409,serviceStage:'dispatch',dispatchStatus:409,
      cause:Object.assign(Error('PRIVATE_URL_AND_TOKEN'),{code:'UND_ERR_SOCKET'}),key:'PRIVATE_KEY',providerMessage:'PRIVATE_MESSAGE'});
    assert.deepEqual(r2FailureDiagnostics(error),{httpStatus:409,serviceStage:'dispatch',dispatchStatus:409,transportCode:'UND_ERR_SOCKET'});
    const input={journalPath:join(dir,'avatars.jsonl'),runId:randomUUID(),operationId:randomUUID(),batchSha256:'a'.repeat(64),phase:'http-response',dataRequestAttempted:true,error};
    await saveProductionR2Failure(input);const path=input.journalPath+'.failure.json',before=await readFile(path,'utf8'),record=JSON.parse(before);
    assert.equal(record.outcomeResolved,false);assert.equal(record.replayAllowed,false);assert.equal((await lstat(path)).mode&0o777,0o600);
    assert.equal(before.includes('PRIVATE_'),false);
    await assert.rejects(saveProductionR2Failure({...input,phase:'acknowledge'}),{code:'EEXIST'});
    assert.equal(await readFile(path,'utf8'),before);
    assert.deepEqual(r2FailureDiagnostics({httpStatus:999,serviceStage:'PRIVATE_MESSAGE',cause:{code:'PRIVATE_TOKEN'}}),{});
  }finally{await rm(dir,{recursive:true,force:true});}
});

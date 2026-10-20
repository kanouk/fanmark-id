/** Resume only an independently verified, fully ACKed image subset. */
import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isProductionRemoteR2} from './production-remote-r2.mjs';
import {inspectProductionImportSet,inspectProductionImportJournal} from './production-import-inspection.mjs';
import {prepareStorageImportReadback,importStorageExport} from './storage-r2-import.mjs';
import {createSplitR2ImportTransport} from './split-r2-import-transport.mjs';
import {verifyProductionSplitR2Export} from './production-r2-import-stage.mjs';
import {importObjectDigest,canonicalImportValue,MAX_IMPORT_OBJECT_BYTES} from '../../workers/api/src/production-r2-import-contract.ts';
const fail=()=>{throw Error('production_r2_partial_resume_unconfirmed');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>canonicalImportValue(a)===canonicalImportValue(b);
const stores=['avatars','covers'];
async function inventory(buckets){
 const result={};for(const store of stores){const rows=[],seen=new Set(),cursors=new Set();let cursor;
  do{const page=await buckets[store].list({limit:1000,...(cursor?{cursor}:{})});
   if(!Array.isArray(page.objects)||page.objects.length>1000||typeof page.truncated!=='boolean'||page.delimitedPrefixes?.length)fail();
   for(const row of page.objects){if(seen.has(row.key)||!Number.isSafeInteger(row.size)||row.size<0||!row.etag||!row.version)fail();seen.add(row.key);rows.push(row);}
   if(rows.length>10000)fail();if(!page.truncated)break;
   if(typeof page.cursor!=='string'||!page.cursor||cursors.has(page.cursor))fail();cursor=page.cursor;cursors.add(cursor);
  }while(true);result[store]=rows.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 }return result;
}
export async function verifyAcknowledgedProductionR2Subset({exportDir,buckets,coordinator,journalPaths}){
 for(const store of stores)if(!isProductionRemoteR2(buckets?.[store])||buckets[store].access!=='read-only'||
  buckets[store].targetIdentity.store!==store||buckets[store].targetIdentity.targetIncarnation!==coordinator.incarnations[store])fail();
 const source=await prepareStorageImportReadback({exportDir,maxObjectBytes:MAX_IMPORT_OBJECT_BYTES}),before=await coordinator.inspect();
 if(before.quarantine||before.active!==0||before.fenceOwner!==coordinator.owner||before.state?.pending!==null||before.state.readbackSha256!==null)fail();
 const journals=await inspectProductionImportSet({journalPaths,coordinator});if(!journals.journalsReconciled)fail();
 const listed=await inventory(buckets),matched=[];
 for(const store of stores){
  const local=await inspectProductionImportJournal(journalPaths[store]),wanted=new Map();
  for(const object of source.objects.filter(o=>(o.bucket==='avatars'?'avatars':'covers')===store)){
   const digest=await importObjectDigest({store,key:object.key,size:object.size,sha256:object.contentSHA256,
    httpMetadata:object.contentType===null?{}:{contentType:object.contentType},customMetadata:object.customMetadata});
   if(wanted.has(digest))fail();wanted.set(digest,object);
  }
  if(local.pending||local.lock||local.operations.length!==listed[store].length)fail();
  const seen=new Set();
  for(const op of local.operations){
   const expected=wanted.get(op.batchSha256),row=expected&&listed[store].find(r=>r.key===expected.key);
   if(!row||seen.has(row.key)||row.size!==expected.size)fail();seen.add(row.key);
   const remote=await coordinator.inspectOperation(op.operationId);
   if(remote.cancelled||remote.pending||!remote.dispatched||!remote.acknowledged||
    [remote.dispatched,remote.acknowledged].some(r=>r.operationId!==op.operationId||r.batchSha256!==op.batchSha256||r.store!==store))fail();
   const object=await buckets[store].get(row.key);
   if(!object||object.etag!==row.etag||object.version!==row.version||object.size!==expected.size||
    !same(object.httpMetadata,expected.contentType===null?{}:{contentType:expected.contentType})||!same(object.customMetadata,expected.customMetadata))fail();
   const bytes=Buffer.from(await object.arrayBuffer());if(bytes.length!==expected.size||sha(bytes)!==expected.contentSHA256)fail();
   matched.push({store,key:row.key,logicalKey:expected.targetKey,etag:row.etag,version:row.version,operationId:op.operationId,batchSha256:op.batchSha256});
  }
 }
 if(!same(listed,await inventory(buckets))||!same(before,await coordinator.inspect())||
  !same(journals,await inspectProductionImportSet({journalPaths,coordinator})))fail();
 const report={format:'fanmark-acknowledged-r2-subset-v1',manifestSha256:source.manifestSHA256,matched,
  existingImages:matched.length,missingImages:source.objects.length-matched.length,expectedImages:source.objects.length,
  remoteStateSha256:sha(JSON.stringify(before)),journalsSha256:sha(JSON.stringify(journals)),dataWrites:0};
 return {...report,proofSha256:sha(JSON.stringify(report))};
}
export async function resumeAcknowledgedProductionSplitR2Export({exportDir,buckets,readBuckets,reportPath,coordinator,journalPaths}){
 try{await lstat(reportPath);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const store of stores)if(!isProductionRemoteR2(buckets?.[store])||buckets[store].access!=='import'||
  buckets[store].importContext?.coordinator!==coordinator||buckets[store].importContext.journalPath!==journalPaths[store]||
  !same(buckets[store].targetIdentity,readBuckets?.[store]?.targetIdentity))fail();
 const proof=await verifyAcknowledgedProductionR2Subset({exportDir,buckets:readBuckets,coordinator,journalPaths});
 const expected=await prepareStorageImportReadback({exportDir,maxObjectBytes:MAX_IMPORT_OBJECT_BYTES});
 const retained=new Map(proof.matched.map(o=>[o.logicalKey,o])),allowed=new Set(expected.objects.map(o=>o.targetKey)),written=new Set();
 const entries=new Map(expected.objects.map(o=>[o.targetKey,o])),write=createSplitR2ImportTransport(buckets);
 await importStorageExport({exportDir,reportPath,freshOnly:false,r2:{
  async get(key){if(!allowed.has(key))fail();const entry=entries.get(key),raw=await readBuckets[entry.bucket==='avatars'?'avatars':'covers'].get(entry.key),object=raw?{...raw,key}:null,old=retained.get(key);
   if(old?(!object||object.etag!==old.etag||object.version!==old.version):(object&&!written.has(key)))fail();return object;},
  async putWithSize(key,...args){if(!allowed.has(key)||retained.has(key)||written.has(key))fail();
   const result=await write.putWithSize(key,...args);if(!result)fail();written.add(key);return result;},
 }});
 const readback=await verifyProductionSplitR2Export({exportDir,buckets:readBuckets});
 if(written.size!==proof.missingImages||retained.size+written.size!==proof.expectedImages)fail();
 return {...readback,scope:'acknowledged-subset-production-r2-resume-v1',retainedImages:retained.size,newImages:written.size,
  subsetProofSha256:proof.proofSha256,sourceFreezeVerified:false,coordinatorCompleted:false,productionReady:false};
}

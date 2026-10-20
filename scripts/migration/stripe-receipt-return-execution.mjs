/** One source return attempt with a durable, payload-free local intent. */
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,isAbsolute,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,sha256Hex} from './snapshot-format.mjs';
import {verifyStoredStripeReceiptReturn,prepareStripeReceiptTransfer} from './stripe-receipt-transfer.mjs';
import {isSourceStripeReturnTransport} from './source-stripe-return-transport.mjs';
const fail=code=>{throw Error('stripe_receipt_return_execution_'+code);};
const sha=/^[a-f0-9]{64}$/u;
async function journalPath(path){
 if(!isAbsolute(path??'')||!basename(path).endsWith('.json'))fail('path_invalid');
 const parent=await realpath(dirname(path)),stat=await lstat(dirname(path));
 const root=fileURLToPath(new URL('../../',import.meta.url)),rel=relative(root,parent);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))||!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700)fail('path_invalid');
 return resolve(parent,basename(path));
}
async function store(path,value){
 const bytes=Buffer.from(canonicalJson(value)+'\n');let file;
 try{file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await file.writeFile(bytes);await file.sync();}
 finally{await file?.close();}
 const directory=await open(dirname(path),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
 return sha256Hex(bytes);
}
function sourceTransports({sourceReader,sourceWriter,runId,originalFunction},write){
 if(!isSourceStripeReturnTransport(sourceReader)||sourceReader.access!=='read-only'||sourceReader.runId!==runId||
  canonicalJson(sourceReader.originalFunction)!==canonicalJson(originalFunction))fail('reader_invalid');
 if(write&&(!isSourceStripeReturnTransport(sourceWriter)||sourceWriter.access!=='return'||sourceWriter.runId!==runId||
  canonicalJson(sourceWriter.originalFunction)!==canonicalJson(originalFunction)))fail('writer_invalid');
}
function identity(options,loaded){return {format:'fanmark-stripe-return-execution-intent-v1',runId:options.runId,
 archiveSha256:options.expectedArchiveSha256,manifestSha256:loaded.header.manifestSha256,
 businessIncarnation:loaded.header.businessIncarnation,sourceBeforeSha256:loaded.plan.sourceBeforeSha256,
 returnedSourceSha256:loaded.plan.returnedSourceSha256,sqlSha256:loaded.plan.sqlSha256};}

export async function executeStripeReceiptReturn(options={}){
 options={...options,sourceBefore:structuredClone(options.sourceBefore),originalFunction:structuredClone(options.originalFunction)};
 sourceTransports(options,true);
 const path=await journalPath(options.journalPath),verifiedPath=await journalPath(path+'.verified.json');
 for(const name of [path,verifiedPath])try{await lstat(name);fail('attempt_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const loaded=await verifyStoredStripeReceiptReturn(options),intent=identity(options,loaded);
 const current=await options.sourceReader.readSealedExport();
 if((await prepareStripeReceiptTransfer(current,{runId:options.runId})).sourceSha256!==intent.sourceBeforeSha256)fail('source_baseline_changed');
 // No source write before the exclusive intent and its directory are durable.
 const intentSha256=await store(path,intent);
 await verifyStoredStripeReceiptReturn(options);
 try{const ack=await options.sourceWriter.applyReturn({sourceBefore:options.sourceBefore,returnedSource:loaded.plan.returnedSource});
  if(ack?.requestAcknowledged!==true||ack.sqlSha256!==intent.sqlSha256)fail('write_acknowledgement_unknown');}
 catch{fail('write_acknowledgement_unknown');}
 const observed=await options.sourceReader.readSealedExport();
 if((await prepareStripeReceiptTransfer(observed,{runId:options.runId})).sourceSha256!==intent.returnedSourceSha256)fail('source_readback_mismatch');
 await verifyStoredStripeReceiptReturn(options);
 const report={format:'fanmark-stripe-return-execution-verified-v1',runId:options.runId,intentSha256,
  returnedSourceSha256:intent.returnedSourceSha256,sourceReadbackVerified:true,targetFenceVerified:true,
  sourceWriteAttempts:1,targetWrites:0,billingEffectsApplied:false,sourceReopened:false,productionReady:false};
 const reportSha256=await store(verifiedPath,report);
 return {...report,journalPath:path,reportPath:verifiedPath,reportSha256};
}

/** Read-only reconciliation after unknown ACK. Even a baseline match does not
 * prove an earlier database transaction has ended, so this never retries. */
export async function inspectStripeReceiptReturnExecution(options={}){
 options={...options,sourceBefore:structuredClone(options.sourceBefore),originalFunction:structuredClone(options.originalFunction)};
 sourceTransports(options,false);
 const path=await journalPath(options.journalPath);let file;
 try{
  if(!sha.test(options.expectedIntentSha256??''))fail('intent_hash_required');
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.size>16384)fail('intent_invalid');
  const bytes=await file.readFile();if(sha256Hex(bytes)!==options.expectedIntentSha256)fail('intent_changed');
  let intent;try{intent=JSON.parse(bytes.toString('utf8'));}catch{fail('intent_invalid');}
  const loaded=await verifyStoredStripeReceiptReturn(options);
  if(canonicalJson(intent)!==canonicalJson(identity(options,loaded)))fail('intent_identity_mismatch');
  const observed=await options.sourceReader.readSealedExport();
  const actual=(await prepareStripeReceiptTransfer(observed,{runId:options.runId})).sourceSha256;
  await verifyStoredStripeReceiptReturn(options);
  return {format:'fanmark-stripe-return-execution-inspection-v1',runId:options.runId,
   state:actual===intent.returnedSourceSha256?'returned-content-observed':actual===intent.sourceBeforeSha256?'original-content-observed':'diverged',
   sourceSha256:actual,sourceWrites:0,targetWrites:0,retryAllowed:false,sourceReopened:false,productionReady:false};
 }finally{await file?.close();}
}

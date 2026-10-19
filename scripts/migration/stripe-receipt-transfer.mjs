/** Sealed source receipt transfer. No Stripe API calls or billing dispatch. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, open, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from './snapshot-format.mjs';
import { utcMicroseconds } from './value-conversion.mjs';
import { canonicalizeNormalizedPayload } from '../../supabase/functions/_shared/stripe-receipt-ingress/index.ts';
import { isProductionRemoteD1, assertProductionRemoteD1Target } from './production-remote-d1.mjs';
import { isIsolatedRemoteD1 } from './isolated-remote-d1.mjs';
import { readBusinessRuntimeImportSchema } from './business-runtime-import-schema.mjs';
import { renderSourceStripeReceiptOnly } from './source-stripe-receipt-only.mjs';

const fail = code => { throw Error('stripe_receipt_transfer_' + code); };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u, hash = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 8*1024*1024, MAX_RECEIPTS = 1000;
const receiptColumns = 'id stripe_event_id livemode event_type object_type object_id api_version normalized_schema_version normalized_payload normalized_payload_sha256 raw_payload_sha256 status delivery_count first_received_at last_received_at terminal_at last_error_code last_error_message created_at updated_at'.split(' ');
const sourceDispatchColumns = 'id receipt_id stripe_event_id livemode status attempt_count available_at claimed_at lease_token completed_at last_error_code last_error_message created_at updated_at'.split(' ');
const tables = ['stripe_webhook_receipts','stripe_webhook_dispatches'];
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const exactKeys = (row, keys) => row && same(Object.keys(row).sort(), [...keys].sort());
const text = (value, nullable=false) => nullable && value === null || typeof value === 'string' && value.trim() === value && value.length>0 && Buffer.byteLength(value)<=256;
const time = value => { try { return utcMicroseconds(value); } catch { fail('timestamp_invalid'); } };

export async function prepareStripeReceiptTransfer(source, {runId} = {}) {
 try {
  source=structuredClone(source);
  if (!uuid.test(runId??'') || !exactKeys(source,['format','projectRef','runId','foundationSha256','originalFunctionSha256','sealedAt','receiptCount','deliveryCount','receipts','dispatches']) ||
    source.format!=='fanmark-source-stripe-receipts-v1' || source.projectRef!=='ppqgtbjykitqtiaisyji' || source.runId!==runId ||
    !hash.test(source.originalFunctionSha256??'') || !Array.isArray(source.receipts) || !Array.isArray(source.dispatches) ||
    source.receipts.length>MAX_RECEIPTS || source.receiptCount!==source.receipts.length || source.dispatches.length!==source.receipts.length ||
    !Number.isSafeInteger(source.deliveryCount) || source.deliveryCount<0 || Buffer.byteLength(canonicalJson(source))>MAX_BYTES) fail('source_invalid');
  const foundation=await readFile(new URL('../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql',import.meta.url));
  if(source.foundationSha256!==sha256Hex(foundation))fail('foundation_changed');
  time(source.sealedAt);
  const receipts=source.receipts.map(row=>{
   if(!exactKeys(row,receiptColumns) || !uuid.test(row.id??'') || typeof row.livemode!=='boolean' ||
    !text(row.stripe_event_id) || !text(row.event_type) || !['object_type','object_id','api_version'].every(k=>text(row[k],true)) ||
    row.normalized_schema_version!==1 || row.status!=='received' || !Number.isSafeInteger(row.delivery_count) || row.delivery_count<1 || row.delivery_count>2147483647 ||
    !['terminal_at','last_error_code','last_error_message'].every(k=>row[k]===null) || !hash.test(row.raw_payload_sha256??'')) fail('receipt_invalid');
   const payload=canonicalizeNormalizedPayload(row.normalized_payload), event=row.normalized_payload?.event;
   if(Buffer.byteLength(payload)>64*1024 || sha256Hex(payload)!==row.normalized_payload_sha256 ||
    row.normalized_payload.schema_version!==1 || event?.id!==row.stripe_event_id || event?.type!==row.event_type ||
    event?.livemode!==row.livemode || event?.api_version!==row.api_version ||
    row.normalized_payload.object?.id!==row.object_id || row.normalized_payload.object?.type!==row.object_type) fail('payload_mismatch');
   for(const name of ['first_received_at','last_received_at','created_at','updated_at'])time(row[name]);
   return {...structuredClone(row),livemode:row.livemode?1:0,normalized_payload:payload};
  }).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const byId=new Map(receipts.map(row=>[row.id,row]));
  if(byId.size!==receipts.length || new Set(receipts.map(row=>row.livemode+':'+row.stripe_event_id)).size!==receipts.length ||
   receipts.reduce((sum,row)=>sum+row.delivery_count,0)!==source.deliveryCount)fail('receipt_identity_or_count_invalid');
  const dispatches=source.dispatches.map(row=>{
   const receipt=byId.get(row.receipt_id);
   if(!exactKeys(row,sourceDispatchColumns) || !uuid.test(row.id??'') || !receipt || typeof row.livemode!=='boolean' ||
    (row.livemode?1:0)!==receipt.livemode || row.stripe_event_id!==receipt.stripe_event_id || row.status!=='pending' || row.attempt_count!==0 ||
    !['claimed_at','lease_token','completed_at','last_error_code','last_error_message'].every(k=>row[k]===null))fail('dispatch_invalid');
   for(const name of ['available_at','created_at','updated_at'])time(row[name]);
   return {...structuredClone(row),livemode:row.livemode?1:0,lease_until:null,claim_generation:0};
  }).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  if(new Set(dispatches.map(row=>row.id)).size!==receipts.length || new Set(dispatches.map(row=>row.receipt_id)).size!==receipts.length)fail('dispatch_identity_invalid');
  return {format:'fanmark-stripe-receipt-transfer-v1',runId,sourceSha256:sha256Hex(source),sealedAt:source.sealedAt,
   receiptCount:receipts.length,deliveryCount:source.deliveryCount,tables:{stripe_webhook_receipts:receipts,stripe_webhook_dispatches:dispatches}};
 } catch(error) {if(/^stripe_receipt_transfer_[a-z_]+$/u.test(error?.message??''))throw error;fail('source_invalid');}
}

// The same authenticated encryption primitive used by the other private
// migration artifacts, with a distinct purpose and run bound as AAD.
export async function sealStripeReceiptExport(source,key) {
 await prepareStripeReceiptTransfer(source,{runId:source?.runId});
 if(!Buffer.isBuffer(key)||key.length!==32)fail('key_invalid');
 const header={format:'fanmark-encrypted-stripe-receipts-v1',runId:source.runId,sourceSha256:sha256Hex(source)};
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(canonicalJson(header)));
 const ciphertext=Buffer.concat([cipher.update(canonicalJson(source),'utf8'),cipher.final()]);
 return {...header,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export async function openStripeReceiptExport(archive,key,{runId}={}) {
 try {
  if(!exactKeys(archive,['format','runId','sourceSha256','iv','tag','ciphertext']) || archive.format!=='fanmark-encrypted-stripe-receipts-v1' ||
   archive.runId!==runId || !uuid.test(runId??'') || !hash.test(archive.sourceSha256??'') || !Buffer.isBuffer(key)||key.length!==32 ||
   typeof archive.ciphertext!=='string' || archive.ciphertext.length>Math.ceil(MAX_BYTES/3)*4)fail('archive_invalid');
  if(!/^[A-Za-z0-9+/]{16}$/u.test(archive.iv??'')||!/^[A-Za-z0-9+/]{22}==$/u.test(archive.tag??''))fail('archive_invalid');
  const iv=Buffer.from(archive.iv,'base64'),tag=Buffer.from(archive.tag,'base64');if(iv.length!==12||tag.length!==16)fail('archive_invalid');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(canonicalJson({format:archive.format,runId,sourceSha256:archive.sourceSha256})));decipher.setAuthTag(tag);
  const source=JSON.parse(Buffer.concat([decipher.update(Buffer.from(archive.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  await prepareStripeReceiptTransfer(source,{runId});if(sha256Hex(source)!==archive.sourceSha256)fail('archive_invalid');return source;
 } catch {fail('archive_invalid');}
}

async function privateArchivePath(path) {
 if(!isAbsolute(path??'')||!basename(path).endsWith('.json'))fail('archive_path_invalid');
 const parent=await realpath(dirname(path)),stat=await lstat(dirname(path));
 const root=fileURLToPath(new URL('../../',import.meta.url)),rel=relative(root,parent);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))||!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700)fail('archive_path_invalid');
 return resolve(parent,basename(path));
}
export async function loadStripeReceiptExport({archivePath,encryptionKey,runId,expectedArchiveSha256}={}) {
 let file;
 try{
  if(!hash.test(expectedArchiveSha256??''))fail('archive_hash_required');
  file=await open(await privateArchivePath(archivePath),constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||(before.mode&0o777)!==0o600||before.size>12*1024*1024)fail('archive_file_invalid');
  const bytes=await file.readFile(),after=await file.stat();
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||sha256Hex(bytes)!==expectedArchiveSha256)fail('archive_file_changed');
  return await openStripeReceiptExport(JSON.parse(bytes.toString('utf8')),encryptionKey,{runId});
 }catch(error){if(/^stripe_receipt_transfer_[a-z_]+$/u.test(error?.message??''))throw error;fail('archive_read_failed');}
 finally{await file?.close();}
}
/** query must use the fixed source project read-only connection. Only this
 * renderer's sealed export SQL is supplied; plaintext never reaches disk. */
export async function collectSourceStripeReceipts({projectRef,runId,originalFunction,query,encryptionKey,archivePath}={}) {
 let file;
 try{
  if(typeof query!=='function'||!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)fail('collector_options_invalid');
  const path=await privateArchivePath(archivePath);
  try{await lstat(path);fail('archive_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const candidate=await renderSourceStripeReceiptOnly({projectRef,runId,originalFunction});
  const source=structuredClone(await query(candidate.exportSql));
  if(source?.originalFunctionSha256!==candidate.originalFunction.sourceTreeSha256)fail('source_original_mismatch');
  const projection=await prepareStripeReceiptTransfer(source,{runId});
  const archive=await sealStripeReceiptExport(source,encryptionKey),bytes=Buffer.from(canonicalJson(archive)+'\n');
  file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  await file.writeFile(bytes);await file.sync();await file.close();file=null;
  const directory=await open(dirname(path),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
  const archiveSha256=sha256Hex(bytes);
  await loadStripeReceiptExport({archivePath:path,encryptionKey,runId,expectedArchiveSha256:archiveSha256});
  return {format:'fanmark-source-stripe-receipt-collection-v1',runId,archivePath:path,archiveSha256,
   sourceSha256:projection.sourceSha256,receiptCount:projection.receiptCount,deliveryCount:projection.deliveryCount,
   sourceWrites:0,plaintextFiles:0,productionReady:false};
 }catch(error){if(/^stripe_receipt_transfer_[a-z_]+$/u.test(error?.message??''))throw error;fail('collection_unconfirmed');}
 finally{await file?.close();}
}

async function rows(database,sql) {
 let result;try{result=await database.prepare(sql).all();}catch{fail('read_unconfirmed');}
 if(result?.success!==true||!Array.isArray(result.results)||result.meta?.rows_written!==0)fail('read_unconfirmed');return result.results;
}
async function schema(database) {
 const expected=(await readBusinessRuntimeImportSchema()).objects;
 // Require the two exact runtime tables plus their indices, and reject any
 // trigger on these tables that could turn insertion into business effects.
 const names="'stripe_webhook_receipts','stripe_webhook_dispatches'";
 const actual=await rows(database,`SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN (${names}) ORDER BY type,name`);
 const wanted=expected.filter(row=>tables.includes(row.name)||row.type==='index'&&/ON\s+"stripe_webhook_(receipts|dispatches)"/iu.test(row.sql??''));
 const filtered=actual.filter(row=>!row.name.startsWith('sqlite_autoindex_'));
 if(!same(filtered,wanted.sort((a,b)=>a.type.localeCompare(b.type,'en')||a.name.localeCompare(b.name,'en'))))fail('schema_changed');
 return sha256Hex(filtered);
}
function transport(database,readDatabase,mode,targetIncarnation) {
 const production=isProductionRemoteD1(database);
 if(!['local','production-stage'].includes(mode) || typeof database?.prepare!=='function' || typeof readDatabase?.prepare!=='function' ||
   mode==='local'&&(production||isProductionRemoteD1(readDatabase)||isIsolatedRemoteD1(database)||isIsolatedRemoteD1(readDatabase)) ||
   mode==='production-stage'&&(!production||!isProductionRemoteD1(readDatabase)||database.access!=='import'||readDatabase.access!=='read-only'||
    database.targetIdentity.databaseName!=='fanmark-production-business'||!same(database.targetIdentity,readDatabase.targetIdentity)||
    database.targetIdentity.targetIncarnation!==targetIncarnation))fail('transport_invalid');
}
export async function verifyStripeReceiptTransfer({source,database,runId,targetIncarnation}={}) {
 const expected=await prepareStripeReceiptTransfer(source,{runId});
 if(isProductionRemoteD1(database)){
  if(database.access!=='read-only'||database.targetIdentity.databaseName!=='fanmark-production-business')fail('transport_invalid');
  await assertProductionRemoteD1Target(database,targetIncarnation);
 }else if(isIsolatedRemoteD1(database))fail('transport_invalid');
 const before=await schema(database);
 let values;try{values=await database.batch(tables.map(table=>database.prepare(`SELECT * FROM "${table}" ORDER BY id`)));}catch{fail('read_unconfirmed');}
 if(!Array.isArray(values)||values.length!==2||values.some(row=>row?.success!==true||row.meta?.rows_written!==0))fail('read_unconfirmed');
 for(let i=0;i<2;i++)if(!same(values[i].results,expected.tables[tables[i]]))fail('content_mismatch');
 if(await schema(database)!==before)fail('schema_changed');
 if(isProductionRemoteD1(database))await assertProductionRemoteD1Target(database,targetIncarnation);
 return {format:'fanmark-stripe-receipt-readback-v1',runId,sourceSha256:expected.sourceSha256,
  receiptCount:expected.receiptCount,deliveryCount:expected.deliveryCount,contentSha256:sha256Hex(expected.tables),databaseWrites:0,billingEffectsApplied:false};
}
export async function importStripeReceiptTransfer({source,database,readDatabase,runId,targetIncarnation,mode='local'}={}) {
 transport(database,readDatabase,mode,targetIncarnation);
 const expected=await prepareStripeReceiptTransfer(source,{runId});
 if(mode==='production-stage'){await assertProductionRemoteD1Target(database,targetIncarnation);await assertProductionRemoteD1Target(readDatabase,targetIncarnation);}
 await schema(readDatabase);
 for(const table of tables)if((await rows(readDatabase,`SELECT count(*) AS n FROM "${table}"`))[0]?.n!==0)fail('target_not_empty');
 const byReceipt=new Map(expected.tables.stripe_webhook_dispatches.map(row=>[row.receipt_id,row]));
 let offset=0,batches=0;
 while(offset<expected.receiptCount){
  const statements=[],payload=[];let count=0;
  for(const receipt of expected.tables.stripe_webhook_receipts.slice(offset,offset+40)){
   const pair=[['stripe_webhook_receipts',receipt],['stripe_webhook_dispatches',byReceipt.get(receipt.id)]].map(([table,row])=>{
    const keys=Object.keys(row);return {sql:`INSERT INTO "${table}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,params:keys.map(k=>row[k])};
   });
   if(Buffer.byteLength(JSON.stringify([...payload,...pair]))>750000)break;
   payload.push(...pair);count++;
  }
  if(!count)fail('batch_too_large');
  const guard=`INSERT INTO "stripe_webhook_receipts" (id) SELECT NULL WHERE (SELECT count(*) FROM "stripe_webhook_receipts")<>${offset} OR (SELECT count(*) FROM "stripe_webhook_dispatches")<>${offset}`;
  statements.push(database.prepare(guard),...payload.map(row=>database.prepare(row.sql).bind(...row.params)));
  let result;try{result=await database.batch(statements);}catch{fail('write_acknowledgement_unknown');}
  if(!Array.isArray(result)||result.length!==statements.length||result.some(row=>row?.success!==true))fail('write_acknowledgement_unknown');
  offset+=count;batches++;
 }
 return {...await verifyStripeReceiptTransfer({source,database:readDatabase,runId,targetIncarnation}),scope:'initial-stripe-receipt-transfer',
  atomicWholeStream:batches<=1,writeBatches:batches,productionReady:false};
}

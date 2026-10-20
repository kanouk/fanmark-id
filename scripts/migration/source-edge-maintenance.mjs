/** Offline source-maintenance artifacts. No deploy, secret access or network.
 * A function backup is version-bound and each shared dependency is kept in its
 * original function's private directory (shared paths may contain different code).
 */
import {createHash} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH=/^[a-f0-9]{64}$/u,SLUG=/^[a-z0-9][a-z0-9-]{0,99}$/u;
const PROJECT='ppqgtbjykitqtiaisyji';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('source_edge_'+code);};

export function renderSourceEdgeMaintenance(runId) {
 if(!UUID.test(runId??''))fail('run_invalid');
 // No imports, environment reads, request-body parsing or outgoing requests.
 // The original platform verify_jwt setting must be preserved during deploy.
 return `Deno.serve(() => new Response(JSON.stringify({error:"maintenance",message:"現在メンテナンス中です。しばらくしてからお試しください。"}),{status:503,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","retry-after":"120","x-fanmark-cutover":${JSON.stringify(runId)}}}));\n`;
}

export async function verifySourceFunctionBackups({backupRoot,manifest,inventory}) {
 const root=await realpath(backupRoot);
 const stat=await lstat(backupRoot);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o700)fail('backup_not_private');
 if(manifest?.format!=='fanmark-source-function-code-backup-v1'||manifest.projectRef!==PROJECT||manifest.inventoryStable!==true||
   !Array.isArray(manifest.functions)||!Array.isArray(inventory)||inventory.length===0||inventory.length>100||
   manifest.functions.length!==inventory.length)fail('inventory_invalid');
 const seen=new Set(),summaries=[];
 for(const item of inventory) {
  if(!SLUG.test(item.slug??'')||!UUID.test(item.id??'')||!Number.isSafeInteger(item.version)||item.version<1||
    typeof item.verify_jwt!=='boolean'||item.status!=='ACTIVE'||seen.has(item.slug))fail('inventory_invalid');
  seen.add(item.slug);
  const saved=manifest.functions.filter(row=>row.slug===item.slug);
  if(saved.length!==1)fail('backup_missing');
  const row=saved[0];
  if(row.id!==item.id||row.version!==item.version||row.verify_jwt!==item.verify_jwt||
    (row.ezbr_sha256??null)!==(item.ezbr_sha256??null)||!HASH.test(row.sourceTreeSha256??'')||
    !SLUG.test(row.backupDirectory??'')||!Array.isArray(row.files)||row.files.length===0||row.files.length>100||
    sha(JSON.stringify(row.files))!==row.sourceTreeSha256)fail('backup_identity_changed');
  const files=new Set();
  for(const file of row.files) {
   if(typeof file.path!=='string'||!file.path||file.path.startsWith('/')||file.path.includes('\\')||
     file.path.split('/').some(part=>!part||part==='.'||part==='..')||files.has(file.path)||
     !HASH.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>10*1024*1024)fail('backup_file_invalid');
   files.add(file.path);
   const parts=[row.backupDirectory,'supabase','functions',...file.path.split('/')];
   let current=root;
   for(const [i,part] of parts.entries()) {
    current=path.join(current,part);const entry=await lstat(current);
    if(entry.isSymbolicLink()||(i===parts.length-1?(!entry.isFile()||entry.nlink!==1||(entry.mode&0o777)!==0o600):!entry.isDirectory()))fail('backup_file_unsafe');
   }
   const bytes=await readFile(current);
   if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)fail('backup_file_changed');
  }
  if(!files.has(item.slug+'/index.ts'))fail('entrypoint_missing');
  summaries.push({id:item.id,slug:item.slug,version:item.version,verify_jwt:item.verify_jwt,
   providerBundleSha256:item.ezbr_sha256??null,sourceTreeSha256:row.sourceTreeSha256,fileCount:files.size});
 }
 return summaries.sort((a,b)=>a.slug.localeCompare(b.slug,'en'));
}

export async function prepareSourceEdgeMaintenance({backupRoot,manifest,inventory,runId}) {
 const source=renderSourceEdgeMaintenance(runId);
 const originals=await verifySourceFunctionBackups({backupRoot,manifest,inventory});
 return {format:'fanmark-source-edge-maintenance-plan-v1',projectRef:PROJECT,runId,source,
  maintenanceSha256:sha(source),inventorySha256:sha(JSON.stringify(originals)),
  functions:originals.map(row=>({...row,action:row.slug==='handle-stripe-webhook'?'receipt-handoff-required':'maintenance-candidate'})),
  // Do not silently replace the deployed receiver with a 503-only stub. Its
  // durable receipt handoff has a separate, explicitly verified boundary.
  deployable:false,pending:['stripe-receipt-handoff','cron-stop-and-running-job-drain','edge-inflight-drain','source-db-freeze'],
  sourceChanged:false};
}

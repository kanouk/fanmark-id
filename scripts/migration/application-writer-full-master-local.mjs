/** Saved non-user Master only. Synthetic Auth/Business, no remote resources or providers. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openMasterRecoverySnapshot} from '../../workers/api/src/master-d1-recovery.ts';
import {exerciseApplicationWriterRecovery} from './test-application-writer-recovery.mjs';

const [directory,reportPath,...extra]=process.argv.slice(2);
assert.ok(directory&&reportPath&&!extra.length,
  'usage: node --experimental-strip-types scripts/migration/application-writer-full-master-local.mjs <private-master-directory> <new-private-report>');
assert.ok(path.isAbsolute(directory)&&path.isAbsolute(reportPath),'absolute_private_paths_required');
const pins=JSON.parse(await readFile(new URL('../../docs/migration/evidence/master-recovery-shared-full-local-2026-10-07.json',import.meta.url),'utf8'));
const archivePath=path.join(directory,'archive.json'),keyPath=path.join(directory,'key.bin');
for(const filename of [archivePath,keyPath]){
  const metadata=await stat(filename);assert.ok(metadata.isFile());
  assert.equal(metadata.mode&0o077,0,'private_file_permissions_required');
}
const archiveBytes=await readFile(archivePath);
assert.equal(archiveBytes.length,pins.archiveBytes);
assert.equal(createHash('sha256').update(archiveBytes).digest('hex'),pins.archiveSha256,'independent_saved_archive_pin_mismatch');
const archive=JSON.parse(archiveBytes.toString('utf8'));archiveBytes.fill(0);
const keyBytes=await readFile(keyPath);let key;
try{assert.equal(keyBytes.length,32);key=await crypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['decrypt']);}
finally{keyBytes.fill(0);}
const snapshot=await openMasterRecoverySnapshot(archive,key,pins.schemaHash);
assert.equal(snapshot.rowsHash,pins.rowsHash);assert.equal(snapshot.schema.length,pins.schemaObjects);
assert.equal(Object.values(snapshot.tables).reduce((n,rows)=>n+rows.length,0),pins.rows);
// openMaster enforces all seven legacy Auth tables empty before fixture creation.
const result=await exerciseApplicationWriterRecovery({masterSnapshot:snapshot,masterPins:pins});
await writeFile(reportPath,JSON.stringify({observedAt:new Date().toISOString(),
  scope:'Native local actual application, writer fences and file recovery with saved non-user Master12254 rows',
  independentMasterArchiveSha256:pins.archiveSha256,result,
  temporaryRuntimeAndRecoveryFileCleaned:true,sourceArchiveUnchanged:true,
  sourceUserDataImported:false,remoteAcceptance:false,operationalBackupAccepted:false,
  productionRtoAccepted:false,fullMigrationAccepted:false},null,2)+'\n',{flag:'wx',mode:0o600});

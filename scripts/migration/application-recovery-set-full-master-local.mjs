/** The new remote transport, rehearsed with the independently pinned non-user Master. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {exerciseApplicationRecoveryWorker} from './test-application-recovery-set-worker.mjs';

const [directory,reportPath,...extra]=process.argv.slice(2);
assert.ok(directory&&reportPath&&!extra.length&&path.isAbsolute(directory)&&path.isAbsolute(reportPath),'absolute_private_directory_and_new_report_required');
const pins=JSON.parse(await readFile(new URL('../../docs/migration/evidence/master-recovery-shared-full-local-2026-10-07.json',import.meta.url),'utf8'));
const archivePath=path.join(directory,'archive.json'),keyPath=path.join(directory,'key.bin');
for(const filename of [archivePath,keyPath]){const file=await stat(filename);assert.ok(file.isFile());assert.equal(file.mode&0o077,0);}
const archiveBytes=await readFile(archivePath);assert.equal(archiveBytes.length,pins.archiveBytes);
assert.equal(createHash('sha256').update(archiveBytes).digest('hex'),pins.archiveSha256);
const keyBytes=await readFile(keyPath);let keyHex;
try{assert.equal(keyBytes.length,32);keyHex=keyBytes.toString('hex');}finally{keyBytes.fill(0);}
try{
  const result=await exerciseApplicationRecoveryWorker({savedMaster:{pins,archiveBytes,keyHex}});
  await writeFile(reportPath,JSON.stringify({observedAt:new Date().toISOString(),
    scope:'New isolated native Worker transport, actual application and distinct DO fences with saved non-user Master',
    independentMasterArchiveSha256:pins.archiveSha256,result,runtimeDisposed:true,sourceUserDataImported:false,
    remoteAcceptance:false,productionRtoAccepted:false,operationalBackupAccepted:false,fullMigrationAccepted:false},null,2)+'\n',{flag:'wx',mode:0o600});
}finally{archiveBytes.fill(0);keyHex=undefined;}

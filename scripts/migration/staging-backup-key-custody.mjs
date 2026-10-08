/** Mac operator tool: keep archive keys off R2 and outside the checkout. Never emit a secret. */
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const archiveKeyService='fanmark-app-staging-backup-archive-key';
export const authEscrowService='fanmark-app-staging-backup-auth-escrow';
const digest=value=>createHash('sha256').update(value).digest('hex');
const security=args=>{
  try{return execFileSync('/usr/bin/security',args,{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15_000}).trim();}
  catch{throw Error('backup_keychain_operation_failed_inspect_owned_item');}
};
function identity(keyId,directory){
  if(process.platform!=='darwin'||!/^staging-backup-[a-f0-9-]{36}$/u.test(keyId)||!path.isAbsolute(directory)||
    !directory.split(path.sep).includes('10_sensitive'))throw Error('backup_key_custody_identity_invalid');
}
export async function createStagingBackupKey({keyId,vaultDirectory}){
  identity(keyId,vaultDirectory);process.umask(0o077);await mkdir(vaultDirectory,{recursive:true,mode:0o700});
  const filename=path.join(vaultDirectory,keyId+'.json');
  // Preserve the generated key on disk before the Keychain call, whose outcome might be unknown.
  const keyHex=randomBytes(32).toString('hex');
  const record={format:'fanmark-staging-backup-key-custody-v1',keyId,createdAt:new Date().toISOString(),
    archiveKeyHex:keyHex,authKeyEscrow:null};
  const handle=await open(filename,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(record,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  // No -U: never overwrite an existing Keychain item. The UUID identifies this newly owned key.
  security(['add-generic-password','-s',archiveKeyService,'-a',keyId,'-w',keyHex]);
  const saved=security(['find-generic-password','-s',archiveKeyService,'-a',keyId,'-w']);
  if(saved!==keyHex||(await stat(filename)).mode%512!==0o600)throw Error('backup_key_custody_readback_failed');
  return {keyId,vaultFilename:filename,archiveKeyService,archiveKeySha256:digest(saved),verified:true,authEscrow:'pending'};
}
export async function saveStagingBackupAuthEscrow({keyId,vaultDirectory,escrow}){
  identity(keyId,vaultDirectory);
  const filename=path.join(vaultDirectory,keyId+'.json');const record=JSON.parse(await readFile(filename,'utf8'));
  if(record.format!=='fanmark-staging-backup-key-custody-v1'||record.keyId!==keyId||record.authKeyEscrow!==null||
    escrow?.format!=='fanmark-staging-auth-key-escrow-v1'||escrow.keyId!==keyId||!/^[a-f0-9]{64}$/u.test(escrow.authKeyId)||
    !Array.isArray(escrow.nonce)||escrow.nonce.length!==12||!Array.isArray(escrow.ciphertext)||escrow.ciphertext.length<48||
    escrow.ciphertext.length>4096||[...escrow.nonce,...escrow.ciphertext].some(x=>!Number.isInteger(x)||x<0||x>255))
    throw Error('backup_auth_escrow_invalid');
  const keyHex=security(['find-generic-password','-s',archiveKeyService,'-a',keyId,'-w']);
  if(keyHex!==record.archiveKeyHex)throw Error('backup_archive_key_custody_mismatch');
  const key=await crypto.subtle.importKey('raw',Buffer.from(keyHex,'hex'),'AES-GCM',false,['decrypt']);
  const header={format:escrow.format,keyId:escrow.keyId,authKeyId:escrow.authKeyId};
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(escrow.nonce),additionalData:new TextEncoder().encode(JSON.stringify(header))},key,new Uint8Array(escrow.ciphertext));
  try{
    const secret=new TextDecoder('utf-8',{fatal:true}).decode(clear);
    if(secret.length<32||digest(JSON.stringify(['better-auth-recovery-key-v1',secret]))!==escrow.authKeyId)
      throw Error('backup_auth_escrow_key_mismatch');
  }finally{new Uint8Array(clear).fill(0);}
  const value=JSON.stringify(escrow);
  security(['add-generic-password','-s',authEscrowService,'-a',keyId,'-w',value]);
  if(security(['find-generic-password','-s',authEscrowService,'-a',keyId,'-w'])!==value)
    throw Error('backup_auth_escrow_keychain_readback_failed');
  // An exclusive temporary file makes an interrupted write recoverable without truncating the key record.
  const temporary=filename+'.escrow-pending';const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({...record,authKeyEscrow:escrow},null,2)+'\n');await handle.sync();}finally{await handle.close();}
  const {rename}=await import('node:fs/promises');await rename(temporary,filename);
  const saved=JSON.parse(await readFile(filename,'utf8'));
  if(JSON.stringify(saved.authKeyEscrow)!==value||(await stat(filename)).mode%512!==0o600)
    throw Error('backup_auth_escrow_vault_readback_failed');
  return {keyId,authKeyId:escrow.authKeyId,encrypted:true,keychainVerified:true,vaultVerified:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]!=='create')throw Error('usage_create_keyId_vaultDirectory');
    console.log(JSON.stringify(await createStagingBackupKey({keyId:process.argv[3],vaultDirectory:process.argv[4]})));
  }catch{console.error(JSON.stringify({error:'backup_key_custody_failed_inspect_owned_vault_and_keychain'}));process.exitCode=1;}
}

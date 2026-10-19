/** Local production custody. Secrets are never returned by the creation tool,
 * passed as process arguments, or sent to Cloudflare. Sync verification is separate. */
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,lstat,realpath,readFile} from 'node:fs/promises';
import {isAbsolute,resolve,join,basename,dirname} from 'node:path';
const SCOPE='6c6685377bca7b2e24d637b4a43888b77a16e280fdc587ce42623156cd615e9d';
const ID=/^production-backup-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const HEX=/^[a-f0-9]{64}$/u;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('production_key_custody_'+code);};
export const productionKeyServices=Object.freeze({archive:'fanmark-app-production-backup-archive-key',
 auth:'fanmark-app-production-better-auth-secret',escrow:'fanmark-app-production-backup-auth-escrow'});

export function prepareProductionKeyCustody({keyId,archiveKeyHex,authSecret,createdAt=new Date().toISOString()}){
 if(!ID.test(keyId??'')||!HEX.test(archiveKeyHex??'')||!HEX.test(authSecret??'')||archiveKeyHex===authSecret||
  !Number.isFinite(Date.parse(createdAt)))fail('identity_invalid');
 const authKeyId=digest(JSON.stringify(['better-auth-recovery-key-v1',authSecret]));
 const header={format:'fanmark-production-auth-key-escrow-v1',keyId,authKeyId};
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(archiveKeyHex,'hex'),nonce);
 cipher.setAAD(Buffer.from(JSON.stringify(header)));
 const ciphertext=Buffer.concat([cipher.update(authSecret,'utf8'),cipher.final(),cipher.getAuthTag()]);
 return {format:'fanmark-production-key-custody-v1',keyId,scopeDigest:SCOPE,createdAt,archiveKeyHex,
  authKeyEscrow:{...header,nonce:[...nonce],ciphertext:[...ciphertext]}};
}

/** For private operator use only. Caller must never log the returned keys. */
export function openProductionKeyCustody(record){
 try{
  if(!record||Object.keys(record).sort().join(',')!==['format','keyId','scopeDigest','createdAt','archiveKeyHex','authKeyEscrow'].sort().join(',')||
   record.format!=='fanmark-production-key-custody-v1'||record.scopeDigest!==SCOPE||!ID.test(record.keyId??'')||
   !HEX.test(record.archiveKeyHex??'')||!Number.isFinite(Date.parse(record.createdAt)))fail('record_invalid');
  const e=record.authKeyEscrow;
  if(!e||Object.keys(e).sort().join(',')!==['format','keyId','authKeyId','nonce','ciphertext'].sort().join(',')||
   e.format!=='fanmark-production-auth-key-escrow-v1'||e.keyId!==record.keyId||!HEX.test(e.authKeyId??'')||
   !Array.isArray(e.nonce)||e.nonce.length!==12||!Array.isArray(e.ciphertext)||e.ciphertext.length!==80||
   [...e.nonce,...e.ciphertext].some(b=>!Number.isInteger(b)||b<0||b>255))fail('record_invalid');
  const header={format:e.format,keyId:e.keyId,authKeyId:e.authKeyId},bytes=Buffer.from(e.ciphertext);
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(record.archiveKeyHex,'hex'),Buffer.from(e.nonce));
  decipher.setAAD(Buffer.from(JSON.stringify(header)));decipher.setAuthTag(bytes.subarray(-16));
  const clear=Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]);
  try{
   const authSecret=clear.toString('utf8');
   if(!HEX.test(authSecret)||authSecret===record.archiveKeyHex||digest(JSON.stringify(['better-auth-recovery-key-v1',authSecret]))!==e.authKeyId)fail('record_invalid');
   return {archiveKeyHex:record.archiveKeyHex,authSecret};
  }finally{clear.fill(0);}
 }catch{fail('record_invalid');}
}

function security(args,input){
 try{return execFileSync('/usr/bin/security',args,{input,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();}
 catch{fail('keychain_unconfirmed_inspect_saved_record');}
}
export async function createProductionKeyCustody({keyId,vaultDirectory}){
 if(process.platform!=='darwin'||!ID.test(keyId??'')||!isAbsolute(vaultDirectory??'')||
  basename(vaultDirectory)!=='fanmark-cloudflare-production-backup'||basename(dirname(vaultDirectory))!=='secret-keys'||
  basename(dirname(dirname(vaultDirectory)))!=='10_sensitive')fail('destination_invalid');
 // A different production key may already exist; do not silently rotate it.
 for(const service of Object.values(productionKeyServices)){
  try{execFileSync('/usr/bin/security',['find-generic-password','-s',service],{stdio:['ignore','pipe','pipe'],timeout:15000});}
  catch(error){if(error.status===44)continue;fail('keychain_inventory_unconfirmed');}
  fail('existing_production_key_requires_inspection');
 }
 // Exclusive directory creation also excludes another simultaneous creator.
 // A failed attempt may contain durable recovery material: never reuse it here.
 await mkdir(vaultDirectory,{mode:0o700}).catch(()=>fail('destination_not_new_requires_inspection'));
 const parent=await realpath(vaultDirectory),info=await lstat(vaultDirectory);
 if(parent!==resolve(vaultDirectory)||!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o777)!==0o700)fail('destination_invalid');
 const record=prepareProductionKeyCustody({keyId,archiveKeyHex:randomBytes(32).toString('hex'),authSecret:randomBytes(32).toString('hex')});
 const keys=openProductionKeyCustody(record),day=record.createdAt.slice(0,10);
 const note=`---\ntype: sensitive\ncreated: ${day}\nupdated: ${day}\nsource: fanmark-production-migration\n---\n# fanmark.id 本番用の鍵保管\n\n秘密情報。公開・リポジトリ追加は禁止。本番専用。バックアップ本体とは別に保管する。\n\n認証用秘密鍵は下記のarchiveKeyHexで復号するauthKeyEscrowに保存。Macキーチェーンにも同じ鍵を保管する。Cloudflareへの設定と本番移行は別工程。\n\n\`\`\`json\n${JSON.stringify(record,null,2)}\n\`\`\`\n`;
 const filename=join(parent,keyId+'.md'),file=await open(filename,'wx',0o600);
 try{await file.writeFile(note);await file.sync();}finally{await file.close();}
 const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
 for(const [kind,value] of [['archive',keys.archiveKeyHex],['auth',keys.authSecret],['escrow',JSON.stringify(record.authKeyEscrow)]]){
  // security -i reads commands from stdin; values never appear in argv. The
  // generated values are hex or fixed-format JSON, quoted for its parser.
  const quoted=value.replaceAll('\\','\\\\').replaceAll('"','\\"');
  security(['-i'],`add-generic-password -s ${productionKeyServices[kind]} -a ${keyId} -w "${quoted}"\n`);
  if(security(['find-generic-password','-s',productionKeyServices[kind],'-a',keyId,'-w'])!==value)fail('keychain_readback_mismatch');
 }
 if(await readFile(filename,'utf8')!==note||(await lstat(filename)).mode%512!==0o600)fail('vault_readback_mismatch');
 return {format:'fanmark-production-key-custody-report-v1',keyId,scopeDigest:SCOPE,vaultFilename:filename,
  noteSha256:digest(note),archiveKeySha256:digest(keys.archiveKeyHex),authKeyId:record.authKeyEscrow.authKeyId,
  keychainVerified:true,localVaultVerified:true,remoteSyncVerified:false,cloudflareSecretsConfigured:false};
}

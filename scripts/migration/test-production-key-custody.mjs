import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,webcrypto} from 'node:crypto';
import {prepareProductionKeyCustody,openProductionKeyCustody} from './production-key-custody.mjs';
const fixture=()=>({keyId:'production-backup-'+randomUUID(),archiveKeyHex:randomBytes(32).toString('hex'),authSecret:randomBytes(32).toString('hex')});
test('production custody recovers the same independent keys and interoperates with Worker WebCrypto escrow',async()=>{
 const input=fixture(),record=prepareProductionKeyCustody(input),opened=openProductionKeyCustody(record);
 assert.equal(opened.authSecret,input.authSecret);assert.equal(opened.archiveKeyHex,input.archiveKeyHex);
 assert.ok(!JSON.stringify(record).includes(input.authSecret));
 const e=record.authKeyEscrow,header={format:e.format,keyId:e.keyId,authKeyId:e.authKeyId};
 const key=await webcrypto.subtle.importKey('raw',Buffer.from(input.archiveKeyHex,'hex'),'AES-GCM',false,['decrypt']);
 const clear=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(e.nonce),additionalData:new TextEncoder().encode(JSON.stringify(header))},key,new Uint8Array(e.ciphertext));
 assert.equal(new TextDecoder().decode(clear),input.authSecret);new Uint8Array(clear).fill(0);
});
test('staging identities, reused keys and malformed material cannot create a production record',()=>{
 const input=fixture();
 for(const change of [{keyId:'staging-backup-'+randomUUID()},{keyId:'production-backup-bad'},{archiveKeyHex:'bad'},
  {authSecret:input.archiveKeyHex},{createdAt:'bad'}])assert.throws(()=>prepareProductionKeyCustody({...input,...change}),/production_key_custody_identity_invalid/);
});
test('tampered scope, header, encryption key, ciphertext and plaintext additions are refused without leaking keys',()=>{
 const input=fixture(),original=prepareProductionKeyCustody(input);
 for(const alter of [r=>{r.scopeDigest='a'.repeat(64);},r=>{r.keyId='production-backup-'+randomUUID();},
  r=>{r.authKeyEscrow.format='fanmark-staging-auth-key-escrow-v1';},r=>{r.archiveKeyHex='b'.repeat(64);},
  r=>{r.authKeyEscrow.ciphertext[0]^=1;},r=>{r.authKeyEscrow.authKeyId='c'.repeat(64);},r=>{r.authSecret=input.authSecret;}]){
  const record=structuredClone(original);alter(record);
  assert.throws(()=>openProductionKeyCustody(record),e=>e.message==='production_key_custody_record_invalid');
 }
});

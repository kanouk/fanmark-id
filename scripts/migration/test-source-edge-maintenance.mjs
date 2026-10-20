import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {mkdtemp,mkdir,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {renderSourceEdgeMaintenance,prepareSourceEdgeMaintenance,verifySourceFunctionBackups} from './source-edge-maintenance.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('maintenance responds to every method without reading input, credentials or calling providers',async()=>{
 let handler;const runId=randomUUID();
 vm.runInNewContext(renderSourceEdgeMaintenance(runId),{Deno:{serve(fn){handler=fn;}},Response,JSON});
 for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) {
  const response=await handler(new Proxy({method},{get(){throw Error('must_not_read_request');}}));
  assert.equal(response.status,503);assert.equal(response.headers.get('x-fanmark-cutover'),runId);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('retry-after'),'120');
  assert.equal((await response.json()).error,'maintenance');
 }
 assert.throws(()=>renderSourceEdgeMaintenance('bad'),/run_invalid/);
});
test('version-bound private backups reject drift, tampering, duplicate paths and symlinks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fanmark-source-code-proof-'));await chmod(root,0o700);
 const inventory=[],functions=[];
 for(const slug of ['send-auth-email','handle-stripe-webhook']){
  const directory=join(root,slug,'supabase/functions',slug);await mkdir(directory,{recursive:true,mode:0o700});
  const source='// synthetic source '+slug+'\n';await writeFile(join(directory,'index.ts'),source,{mode:0o600});
  const item={slug,id:randomUUID(),version:2,status:'ACTIVE',verify_jwt:slug==='send-auth-email',ezbr_sha256:'a'.repeat(64)};
  inventory.push(item);const files=[{path:slug+'/index.ts',bytes:Buffer.byteLength(source),sha256:sha(source)}];
  functions.push({...item,backupDirectory:slug,files,sourceTreeSha256:sha(JSON.stringify(files))});
 }
 const manifest={format:'fanmark-source-function-code-backup-v1',projectRef:'ppqgtbjykitqtiaisyji',inventoryStable:true,functions};
 const options={backupRoot:root,manifest,inventory,runId:randomUUID()};
 try {
  await t.test('keeps platform JWT settings and leaves receipt handoff unresolved',async()=>{
   const result=await prepareSourceEdgeMaintenance(options);
   assert.equal(result.functions.find(row=>row.slug==='handle-stripe-webhook').action,'receipt-handoff-required');
   assert.equal(result.functions.find(row=>row.slug==='send-auth-email').verify_jwt,true);
   assert.equal(result.deployable,false);assert.equal(result.sourceChanged,false);
  });
  await t.test('changed version, missing backup and altered content are refused',async()=>{
   await assert.rejects(prepareSourceEdgeMaintenance({...options,inventory:inventory.map(row=>({...row,version:3}))}),/identity_changed/);
   await assert.rejects(prepareSourceEdgeMaintenance({...options,manifest:{...manifest,functions:[]}}),/inventory_invalid/);
   const p=join(root,functions[0].slug,'supabase/functions',functions[0].slug,'index.ts');
   await writeFile(p,'changed');await assert.rejects(verifySourceFunctionBackups(options),/file_changed/);
   await writeFile(p,'// synthetic source '+functions[0].slug+'\n');
  });
  await t.test('duplicate and escaping file paths are rejected before file access',async()=>{
   for(const paths of [[functions[0].files[0],functions[0].files[0]],[{...functions[0].files[0],path:'../escape'}]]) {
    const changed={...functions[0],files:paths,sourceTreeSha256:sha(JSON.stringify(paths))};
    await assert.rejects(verifySourceFunctionBackups({...options,manifest:{...manifest,functions:[changed,functions[1]]}}),/file_invalid/);
   }
  });
  await t.test('linked files and public source permissions are refused',async()=>{
   const p=join(root,functions[0].slug,'supabase/functions',functions[0].slug,'index.ts');
   await chmod(p,0o644);await assert.rejects(verifySourceFunctionBackups(options),/file_unsafe/);await chmod(p,0o600);
   await rm(p);await symlink(join(root,functions[1].slug,'supabase/functions',functions[1].slug,'index.ts'),p);
   await assert.rejects(verifySourceFunctionBackups(options),/file_unsafe/);
  });
 }finally{await rm(root,{recursive:true,force:true});}
});

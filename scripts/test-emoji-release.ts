import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildRelease,verifyRelease,assertIdentityContinuity} from './build-emoji-release.ts';
const base={id:'00000000-0000-4000-8000-000000000001',emoji:'👋',short_name:'wave',keywords:['wave'],category:null,subcategory:null,codepoints:['1F44B'],sort_order:1};
const next={...base,id:'00000000-0000-4000-8000-000000000002',emoji:'👋🏽',codepoints:['1F44B','1F3FD'],sort_order:2};

test('immutable versions preserve old release and detect mixed or modified files',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fanmark-emoji-release-'));
 try {
  const input=path.join(dir,'input.json'), releases=path.join(dir,'releases');
  await writeFile(input,JSON.stringify([base]));
  const first=await buildRelease(input,releases);
  const original=await readFile(path.join(first.directory,'emojiCatalog.ts'),'utf8');
  assert.deepEqual(await buildRelease(input,releases),first);
  await writeFile(input,JSON.stringify([next,base]));
  const second=await buildRelease(input,releases,first.directory);
  assert.notEqual(first.version,second.version);
  await writeFile(input,JSON.stringify([base,next]));
  assert.deepEqual(await buildRelease(input,releases,first.directory),second);
  assert.equal((await verifyRelease(first.directory)).records.length,1);
  assert.equal(await readFile(path.join(first.directory,'emojiCatalog.ts'),'utf8'),original);
  assert.equal((await readdir(releases)).some(name=>name.startsWith('.staging-')),false);
  await writeFile(path.join(second.directory,'emojiCatalog.ts'),original);
  await assert.rejects(()=>verifyRelease(second.directory),/integrity or version mismatch/);
  await assert.rejects(()=>buildRelease(input,releases,first.directory),/integrity or version mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('releases cannot remove or reassign old IDs; metadata updates and additions are permitted',()=>{
 assertIdentityContinuity([base],[{...base,short_name:'new_name'},next]);
 for(const records of [[next],[{...base,emoji:'😀'}],[{...base,codepoints:['1F600']}]]){
  assert.throws(()=>assertIdentityContinuity([base],records),/removes or reassigns/);
 }
});

test('failed identity review leaves existing version untouched and no new version directory',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'fanmark-emoji-release-'));
 try{
  const input=path.join(dir,'input.json'), releases=path.join(dir,'releases');
  await writeFile(input,JSON.stringify([base]));
  const first=await buildRelease(input,releases);
  await writeFile(input,JSON.stringify([next]));
  await assert.rejects(()=>buildRelease(input,releases,first.directory),/removes or reassigns/);
  assert.deepEqual(await readdir(releases),[first.version]);
  assert.equal((await verifyRelease(first.directory)).version,first.version);
 }finally{await rm(dir,{recursive:true,force:true});}
});

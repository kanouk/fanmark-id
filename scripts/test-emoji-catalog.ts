import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateCatalog, validateRecords, parseArguments} from './generate-emoji-catalog.ts';

const base = {id:'00000000-0000-4000-8000-000000000001',emoji:'👋',short_name:'waving_hand',keywords:['wave'],category:'People',subcategory:null,codepoints:['1F44B'],sort_order:1};
const toned = {...base,id:'00000000-0000-4000-8000-000000000002',emoji:'👋🏽',codepoints:['1F44B','1F3FD'],sort_order:2};

test('catalog preserves database IDs and tone sequences with stable sort order', () => {
  const catalog = generateCatalog([toned,base]);
  assert.deepEqual(catalog.entries.map(r=>r.id),[base.id,toned.id]);
  assert.equal(catalog.emojiToId['👋🏽'],toned.id);
  assert.equal(catalog.idToEmoji[base.id],'👋');
  assert.deepEqual(catalog.entries[1].codepoints,['1F44B','1F3FD']);
  assert.deepEqual(generateCatalog([base,toned]),catalog);
});

test('rejects identity loss, duplicate identities, lookup ambiguity and malformed arrays', () => {
  for (const records of [[],[{...base,id:undefined}],[base,{...toned,id:base.id}],[base,{...toned,emoji:base.emoji}],[{...base,keywords:null}],[{...base,codepoints:'1F44B'}]]) {
    assert.throws(()=>validateRecords(records));
  }
});

test('explicit JSON generation ignores ambient Supabase credentials and leaves output intact on invalid input', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'fanmark-catalog-test-'));
  try {
    const input=path.join(dir,'input.json'), output=path.join(dir,'output.ts');
    await writeFile(input,JSON.stringify([toned,base]));
    const run=()=>spawnSync(process.execPath,['--experimental-strip-types','scripts/generate-emoji-catalog.ts','--input',input,'--output',output],{
      encoding:'utf8',timeout:10000,env:{...process.env,SUPABASE_URL:'invalid-url-must-not-be-used',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'}
    });
    const success=run();
    assert.equal(success.status,0,success.stderr);
    const contents=await readFile(output,'utf8');
    assert.match(contents,new RegExp(base.id));
    assert.match(contents,/👋🏽/);
    await writeFile(input,JSON.stringify([{...base,id:undefined}]));
    assert.notEqual(run().status,0);
    assert.equal(await readFile(output,'utf8'),contents);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('CLI refuses ambiguous flags and direct input overwrite',()=>{
  for (const args of [['--input'],['--unknown','x'],['--input','x','--input','y'],['--input','x','--output','x']]) assert.throws(()=>parseArguments(args));
});

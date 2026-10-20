import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),script=fileURLToPath(new URL('./check-supabase-workflow.mjs',import.meta.url));
const production=await readFile(new URL('../.github/workflows/supabase-deploy.yml',import.meta.url),'utf8');
const cloudflare=await readFile(new URL('../.github/workflows/cloudflare-migration-validation.yml',import.meta.url),'utf8');
const command='node --experimental-strip-types scripts/migration/test-legacy-profile-supabase-local.mjs "$RUNNER_TEMP/legacy-profile-supabase-local.json"';
async function verify(text,legacy=production){const directory=await mkdtemp(path.join(os.tmpdir(),'fanmark-ci-isolation-'));
  try{const workflows=path.join(directory,'.github/workflows');await mkdir(workflows,{recursive:true});
    await writeFile(path.join(workflows,'supabase-deploy.yml'),legacy);
    await writeFile(path.join(workflows,'cloudflare-migration-validation.yml'),text);
    return await run(process.execPath,[script],{cwd:directory});
  }finally{await rm(directory,{recursive:true,force:true});}}

test('the one fixed local container proof retains workflow isolation',async()=>{const result=await verify(cloudflare);assert.match(result.stdout,/isolation checks passed/);});
for(const [name,mutate] of [
  ['external arguments',text=>text.replace(command,command+' --remote')],
  ['project URL arguments',text=>text.replace(command,command+' https://project.supabase.co')],
  ['extra project CLI step',text=>text+'\n      - run: supabase db push\n'],
  ['secret access',text=>text+'\n      - run: echo "${{ secrets.SUPABASE_ACCESS_TOKEN }}"\n'],
  ['duplicate proof command',text=>text+'\n        run: '+command+'\n'],
])test('local Auth allowance rejects '+name,async()=>{await assert.rejects(verify(mutate(cloudflare)),error=>{assert.notEqual(error.code,0);assert.match(error.stderr,/must not access secrets|exactly one fixed local Auth/);return true;});});

const imageLine='          docker pull supabase/storage-api:v1.80.2@sha256:95b217a9c59e0ac06c6dcb539df3189a1668a2445fb43dbf29660d6968ffd7d2\n';
for(const [name,mutate] of [
  ['unpinned image',text=>text.replace(imageLine,'          docker pull supabase/storage-api:latest\n')],
  ['appended project write',text=>text.replace(imageLine,imageLine.trimEnd()+' && supabase db push\n')],
  ['duplicate image pull',text=>text+imageLine],
])test('local Storage image allowance rejects '+name,async()=>{
  await assert.rejects(verify(mutate(cloudflare)),error=>{assert.notEqual(error.code,0);assert.match(error.stderr,/exactly one pinned local Storage/);return true;});
});

for(const [name,job] of [
  ['restored deploy job','  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: supabase db push\n'],
  ['renamed remote job','  production-release:\n    steps:\n      - run: supabase db push\n'],
  ['restored secret access','  remote:\n    env:\n      TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}\n'],
  ['restored write permission','  remote:\n    permissions:\n      contents: write\n'],
])test('retired legacy workflow rejects '+name,async()=>{
  await assert.rejects(verify(cloudflare,production+'\n'+job),error=>error.code!==0);
});

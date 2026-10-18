/** Build only. No remote credentials, deployment or source changes. */
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

if (process.versions.node !== '22.6.0') throw Error('production_build_requires_node_22_6_0');
if (process.argv.length !== 2) throw Error('production_build_accepts_no_overrides');
const root=fileURLToPath(new URL('../',import.meta.url));
const configuration=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
// Reuse the complete, tested Worker selector set. An unexpected shell token or
// new value stops the build instead of silently loading a legacy backend.
const baseline=configuration.scripts['build:cloudflare-staging'];
const separator=' vite build --mode cloudflare-staging --outDir dist-staging';
if(typeof baseline!=='string'||!baseline.endsWith(separator))throw Error('production_build_baseline_changed');
const selectors={};
for(const assignment of baseline.slice(0,-separator.length).split(' ')) {
  const match=/^(VITE_[A-Z0-9_]+)=(worker|d1|r2|disabled)$/.exec(assignment);
  if(!match||Object.hasOwn(selectors,match[1]))throw Error('production_build_selector_invalid');
  selectors[match[1]]=match[2];
}
selectors.VITE_BROADCAST_SEND_BACKEND='worker';
selectors.VITE_BROADCAST_TEST_SEND_BACKEND='worker';
const directory=await mkdtemp(join(tmpdir(),'fanmark-production-build-env-'));
try {
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('VITE_')&&key!=='FANMARK_VITE_ENV_DIR'));
  const env={...inherited,...selectors,FANMARK_VITE_ENV_DIR:directory,
    VITE_FANMARK_API_BASE_URL:'https://fanmark.id',VITE_AUTH_API_BASE_URL:'https://fanmark.id'};
  const result=await promisify(execFile)(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--mode','cloudflare-production','--outDir','dist-cloudflare-production'],
    {cwd:root,env,timeout:180000,maxBuffer:4*1024*1024});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  await writeFile(join(root,'dist-cloudflare-production/build-target.json'),JSON.stringify({
    mode:'cloudflare-production',origin:'https://fanmark.id',authBackend:'better-auth',legacySupabaseDisabled:true,
    selectors,node:process.versions.node,deployed:false,
  },null,2)+'\n');
} finally {await rm(directory,{recursive:true,force:true});}

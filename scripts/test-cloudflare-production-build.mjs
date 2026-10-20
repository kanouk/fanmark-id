import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from '../workers/api/node_modules/esbuild/lib/main.js';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
async function clients(mode) {
  const result=await build({stdin:{contents:`import {supabase} from './src/integrations/supabase/client';
import {isBetterAuthEnabled,betterAuthClient} from './src/lib/auth-backend';
export {supabase,isBetterAuthEnabled,betterAuthClient};`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',
    define:{'import.meta.env.MODE':JSON.stringify(mode),
      'import.meta.env.VITE_SUPABASE_URL':'"https://old-source.example.test"',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'"old-source-fixture-key"',
      'import.meta.env.VITE_AUTH_API_BASE_URL':'"https://fanmark.id"',
      localStorage:'{"fixture":true}'},
    plugins:[{name:'observe-client-boundary',setup(api){
      api.onResolve({filter:/^(@supabase\/supabase-js|@\/lib\/better-auth-client)$/},args=>({path:args.path,namespace:'fixture'}));
      api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='@supabase/supabase-js'?
        'export function createClient(url,key,options){return {url,key,options}}':
        'export function createBetterAuthClient(options){return options}'}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('Cloudflare production chooses Better Auth and refuses legacy Supabase HTTP despite environment credentials',async()=>{
  const result=await clients('cloudflare-production');
  assert.equal(result.isBetterAuthEnabled(),true);assert.equal(result.betterAuthClient.baseUrl,'https://fanmark.id');
  assert.equal(result.supabase.url,'https://supabase-disabled.invalid');
  assert.equal(result.supabase.options.auth.persistSession,false);
  assert.equal(result.supabase.options.auth.autoRefreshToken,false);
  assert.equal(result.supabase.options.auth.detectSessionInUrl,false);
  assert.equal(result.supabase.options.auth.storage,undefined);
  await assert.rejects(result.supabase.options.global.fetch('https://old-source.example.test'),/legacy_supabase_disabled/);
});
test('legacy production and existing staging retain their auth choices',async()=>{
  for(const [mode,enabled] of [['production',false],['cloudflare-staging',true]]){
    const result=await clients(mode);assert.equal(result.isBetterAuthEnabled(),enabled);
    assert.equal(result.supabase.url,'https://old-source.example.test');
    assert.equal(result.supabase.options.auth.persistSession,true);
    assert.equal(result.supabase.options.global,undefined);
  }
});

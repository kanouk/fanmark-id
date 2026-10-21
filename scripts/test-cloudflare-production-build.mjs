import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from '../workers/api/node_modules/esbuild/lib/main.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for (const mode of ['cloudflare-production','cloudflare-staging','development']) {
  test(mode+' bundles only Better Auth and sends session requests to the selected app origin', async()=>{
    const result=await build({stdin:{contents:"export {betterAuthClient} from './src/lib/auth-backend';",resolveDir:root,loader:'ts'},
      bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',
      define:{'import.meta.env.MODE':JSON.stringify(mode),'import.meta.env.VITE_AUTH_API_BASE_URL':'"https://fanmark.id"',
        'import.meta.env.VITE_SUPABASE_URL':'"https://old-source.example.invalid"'},
      plugins:[{name:'local-alias',setup(api){api.onResolve({filter:/^@\//},args=>({path:fileURLToPath(new URL('./src/'+args.path.slice(2)+'.ts',new URL('../',import.meta.url)))}));}}]});
    assert.equal(Object.keys(result.metafile.inputs).some(file=>/supabase/iu.test(file)),false);
    const previous=globalThis.fetch;const calls=[];
    try {
      globalThis.fetch=async(url,init)=>{calls.push({url:String(url),credentials:init.credentials,cache:init.cache});return Response.json(null);};
      const compiled=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n// '+mode).toString('base64'));
      assert.equal(await compiled.betterAuthClient.getSession(),null);
      assert.deepEqual(calls,[{url:'https://fanmark.id/api/auth/get-session',credentials:'include',cache:'no-store'}]);
    } finally {globalThis.fetch=previous;}
  });
}

test('production environment discards inherited API origins, retired flags and env directories', async () => {
  const { isolatedBuildEnvironment, frontendEnvironment } = await import('./frontend-build-config.mjs');
  const env = isolatedBuildEnvironment({ PATH: '/bin', VITE_AUTH_API_BASE_URL: 'https://old.invalid',
    VITE_SUPABASE_URL: 'https://old.invalid', VITE_PROFILE_BACKEND: 'supabase', FANMARK_VITE_ENV_DIR: '/old' },
    'production', 'https://fanmark.id', '/isolated');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.VITE_SUPABASE_URL, undefined);
  assert.equal(env.VITE_PROFILE_BACKEND, undefined);
  assert.equal(env.VITE_AUTH_API_BASE_URL, 'https://fanmark.id');
  assert.equal(env.FANMARK_VITE_ENV_DIR, '/isolated');
  assert.equal(env.VITE_BROADCAST_SEND_BACKEND, 'worker');
  assert.equal(frontendEnvironment('local', 'https://127.0.0.1:8080').VITE_BROADCAST_SEND_BACKEND, 'disabled');
  assert.throws(() => frontendEnvironment('production', 'https://other.invalid'));
  assert.throws(() => frontendEnvironment('local', 'https://fanmark.id'));
  assert.throws(() => frontendEnvironment('unknown', 'https://fanmark.id'));
});

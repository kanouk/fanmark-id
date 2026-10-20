import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('closed production candidate blocks public/Auth HTTP before stores or external providers are touched', async()=>{
 const config=JSON.parse(await readFile(new URL('../wrangler.app-production-closed.jsonc',import.meta.url),'utf8'));
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/index.ts',import.meta.url))],bundle:true,write:false,
  format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
 let external=0;
 // Every binding here is created by local Miniflare. Never consume Wrangler's remote:true bindings.
 const bindings=Object.fromEntries(Object.entries(config.vars).map(([name,value])=>[name,{type:'text',value}]));
 for(const row of config.d1_databases)bindings[row.binding]={type:'d1',name:'closed-fixture-'+row.binding};
 for(const row of config.r2_buckets)bindings[row.binding]={type:'r2',name:'closed-fixture-'+row.binding};
 bindings.CF_VERSION_METADATA={type:'json',value:{id:'00000000-0000-4000-8000-000000000012'}};
 const exports={};
 for(const row of config.durable_objects.bindings){exports[row.class_name]={type:'durable-object',storage:'sqlite'};
  bindings[row.name]={type:'durable-object',worker:'closed-local-proof',exportName:row.class_name};}
 const mf=new Miniflare({workers:[{config:{name:'closed-local-proof',type:'worker',compatibilityDate:config.compatibility_date,
  compatibilityFlags:config.compatibility_flags ?? [],exports,env:bindings,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle.outputFiles[0].text}}}},
  dev:{outboundService:{type:'fetcher',handler(){external++;throw Error('external_provider_forbidden');}}}}]});
 try {
  for(const [method,path] of [['GET','/'],['GET','/assets/private.js'],['GET','/api/auth/get-session'],
    ['POST','/api/auth/sign-in/email'],['POST','/api/auth/two-factor/verify-totp'],['GET','/api/profile'],['POST','/api/admin/broadcast-emails'],['POST','/migration/claim'],['POST','/migration/begin']]) {
   const response=await mf.dispatchFetch('https://fanmark.id'+path,{method,redirect:'manual'});
   assert.equal(response.status,503,path);assert.ok((response.headers.get('cache-control')??'').includes('no-store'));
  }
  const rejectedReceipt=await mf.dispatchFetch('https://fanmark.id/api/stripe/webhook',{method:'POST',body:'fixture'});
  assert.ok(rejectedReceipt.status>=400);assert.equal(external,0);
  for(const row of config.d1_databases){const db=await mf.getD1Database(row.binding);
   assert.equal((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").all()).results.length,0);}
  for(const row of config.r2_buckets)assert.equal((await (await mf.getR2Bucket(row.binding)).list()).objects.length,0);
 } finally {await mf.dispose();}
});

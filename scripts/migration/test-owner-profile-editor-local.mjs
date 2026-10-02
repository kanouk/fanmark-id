import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {createServer,createConnection} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const api=path.join(root,'workers/api');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const require=createRequire(path.join(api,'package.json'));
const bcrypt=require('bcryptjs');
const {BUSINESS_MIGRATION_SEQUENCE}=await import(path.join(root,'scripts/migration/business-migration-ledger.mjs'));
const temp=await mkdtemp(path.join(os.tmpdir(),'fanmark-local-editor-compose-'));
await chmod(temp,0o700);
const state=path.join(temp,'state');
const configPath=path.join(temp,'wrangler.local.json');
const logPath=path.join(temp,'runtime.log');
const journalPath=path.join(temp,'report.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const privateWrite=async(file,data)=>{await writeFile(file,data,{mode:0o600});await chmod(file,0o600);};
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value));});});
const origin=`https://127.0.0.1:${port}`;
const config=JSON.parse(await readFile(path.join(api,'wrangler.app-staging.jsonc'),'utf8'));
delete config.account_id;delete config.triggers;
config.name='fanmark-local-editor-compose';
config.main=path.join(api,'src/index.ts');
config.assets.directory=path.join(temp,'assets');
config.d1_databases=config.d1_databases.map((binding,index)=>({binding:binding.binding,database_name:`fanmark-local-editor-${binding.binding.toLowerCase()}`,database_id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,remote:false}));
config.r2_buckets=config.r2_buckets.map(binding=>({binding:binding.binding,bucket_name:`fanmark-local-editor-${binding.binding.toLowerCase().replaceAll('_','-')}`,remote:false}));
config.vars={...config.vars,BETTER_AUTH_URL:origin,CORS_ALLOWED_ORIGINS:origin,BETTER_AUTH_SECRET:'local-editor-compose-secret-only-never-a-live-secret-'+randomUUID(),VERIFIED_ACCESS_SECRET:'local-editor-proof-only-'+randomUUID(),REFERENCE_MASTER_SERVICE_SECRET:'local-editor-reference-only-'+randomUUID()};
assert.ok(!config.account_id && !config.services && !config.routes);
assert.ok(config.d1_databases.every(binding=>binding.remote===false&&!binding.database_id.includes('d4bb0c48')));
assert.ok(config.r2_buckets.every(binding=>binding.remote===false));
for(const key of ['AUTH_SOCIAL_BACKEND','AUTH_EMAIL_BACKEND','STRIPE_WEBHOOK_BACKEND','STRIPE_DISPATCH_BACKEND','BROADCAST_SEND_BACKEND','LICENSE_EXPIRY_BACKEND','NOTIFICATION_ARCHIVE_BACKEND'])assert.ok(!config.vars[key]);
await privateWrite(configPath,JSON.stringify(config,null,2));
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const selectors=Object.fromEntries([...manifest.scripts['build:cloudflare-staging'].matchAll(/\b(VITE_[A-Z_]+)=([a-z0-9-]+)\s/gu)].map(match=>[match[1],match[2]]));
assert.equal(Object.keys(selectors).length,45);
const emptyEnv=path.join(temp,'empty-env');await mkdir(emptyEnv);
const buildEnv={...process.env};for(const key of Object.keys(buildEnv))if(key.startsWith('VITE_'))delete buildEnv[key];
Object.assign(buildEnv,selectors,{FANMARK_VITE_ENV_DIR:emptyEnv,VITE_FANMARK_API_BASE_URL:origin,VITE_AUTH_API_BASE_URL:origin,VITE_SUPABASE_URL:'https://synthetic-db.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',WRANGLER_SEND_METRICS:'false'});
async function child(args,cwd=api,env={...process.env,WRANGLER_SEND_METRICS:'false',CI:'1'}){
  return new Promise((resolve,reject)=>{const proc=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='';proc.stdout.on('data',chunk=>out+=chunk);proc.stderr.on('data',chunk=>err+=chunk);proc.on('error',()=>reject(new Error('local_child_start_failed')));proc.on('close',async code=>{await privateWrite(path.join(temp,`command-${randomUUID()}.log`),out+'\n'+err);if(code!==0)reject(new Error('local_child_failed:'+code));else resolve(out);});});
}
const wrangler=path.join(api,'node_modules/wrangler/bin/wrangler.js');
async function execute(binding,sql){
 const entry=config.d1_databases.find(item=>item.binding===binding);assert.ok(entry);
 const sqlPath=path.join(temp,`${binding}-${randomUUID()}.sql`);await privateWrite(sqlPath,sql);
 const result=JSON.parse(await child([wrangler,'d1','execute',entry.database_name,'--local','--persist-to',state,'--config',configPath,'--file',sqlPath,'--json']));
 assert.ok(result.every(part=>part.success===true));return result;
}
const users=[0,1].map(index=>({id:randomUUID(),accountId:randomUUID(),settingsId:randomUUID(),fanmarkId:randomUUID(),licenseId:randomUUID(),profileId:randomUUID(),basicId:randomUUID(),email:`local-editor-${index}@example.invalid`,username:`local-editor-${index}`,shortId:`local-editor-${index}`,password:'Synthetic-local-editor-only!2026',name:index===0?' Local perpetual owner ':'Other local owner'}));
const emoji=['🌸','🚀','💡','🌙','🌹','🌻','🪻','🌷'].map((emoji,index)=>({id:randomUUID(),emoji,index}));
const version=createHash('sha256').update(JSON.stringify(emoji)).digest('hex');
const sql=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const now=new Date().toISOString().replace(/\.(\d{3})Z$/u,(_match,fraction)=>`.${fraction}000Z`);
let server;
let serverLog='';
let report={state:'preparing',head,temp,origin,remoteBindings:false,remoteD1Calls:0,sourceRowsRead:false,providerCalls:0,sourceOwnedDataMigrated:false,fullBusinessMigrations:BUSINESS_MIGRATION_SEQUENCE.length,authMigrations:3,masterMigrations:8};
async function checkpoint(){await privateWrite(journalPath,JSON.stringify(report,null,2)+'\n');}
await checkpoint();
try{
 await child([path.join(root,'node_modules/vite/bin/vite.js'),'build','--mode','cloudflare-staging','--outDir',config.assets.directory],root,buildEnv);
 const authSql=(await Promise.all(['0003_better_auth_core.sql','0007_auth_signup_command.sql','0008_auth_user_suspension.sql'].map(name=>readFile(path.join(api,'migrations',name),'utf8')))).join('\n');
 const masterSql=(await Promise.all(['0000_emoji_master.sql','0001_emoji_master_release_staging.sql','0002_emoji_master_release_activation.sql','0004_reference_master_releases.sql','0005_emoji_master_admin_guards.sql','0006_reference_master_extension_prices.sql','0007_release_audit_timestamps.sql','0008_emoji_master_change_audits.sql'].map(name=>readFile(path.join(api,'migrations',name),'utf8')))).join('\n');
 for(const name of BUSINESS_MIGRATION_SEQUENCE)await execute('FANMARK_DB',await readFile(path.join(api,'migrations-business',name),'utf8'));
 await execute('AUTH_DB',authSql);await execute('MASTER_DB',masterSql);
 await execute('AUTH_DB',users.map(user=>`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${[user.id,user.name,user.email,1,now,now].map(sql).join(',')});\nINSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(${[user.accountId,user.id,'credential',user.id,bcrypt.hashSync(user.password,10),now,now].map(sql).join(',')});`).join('\n'));
 await execute('FANMARK_DB',users.map((user,index)=>{const items=emoji.slice(index*4,index*4+4);const displayed=items.map(item=>item.emoji).join('');const ids=JSON.stringify(items.map(item=>item.id));return [
 `INSERT INTO user_settings(id,user_id,username,display_name,preferred_language,created_at,updated_at) VALUES(${[user.settingsId,user.id,user.username,user.name,'ja',now,now].map(sql).join(',')});`,
 `INSERT INTO fanmarks(id,short_id,user_input_fanmark,normalized_emoji,emoji_ids,normalized_emoji_ids,status,tier_level,created_at,updated_at) VALUES(${[user.fanmarkId,user.shortId,displayed,displayed,ids,ids,'active',4,now,now].map(sql).join(',')});`,
 `INSERT INTO fanmark_licenses(id,fanmark_id,user_id,status,license_start,license_end,display_fanmark,created_at,updated_at) VALUES(${[user.licenseId,user.fanmarkId,user.id,'active',now,null,displayed,now,now].map(sql).join(',')});`,
 `INSERT INTO fanmark_basic_configs(id,license_id,fanmark_name,access_type,created_at,updated_at) VALUES(${[user.basicId,user.licenseId,user.name,'profile',now,now].map(sql).join(',')});`,
 `INSERT INTO fanmark_profiles(id,license_id,display_name,bio,social_links,theme_settings,is_public,created_at,updated_at) VALUES(${[user.profileId,user.licenseId,user.name,'Stored local biography','{}','{}',1,now,now].map(sql).join(',')});`,
 ].join('\n');}).join('\n'));
 await execute('MASTER_DB',`INSERT INTO fanmark_emoji_master_release_imports(release_version,manifest_json,row_count,status) VALUES(${sql(version)},${sql(JSON.stringify({version}))},8,'loading');\n`+emoji.map(item=>`INSERT INTO fanmark_emoji_master_release_staging(release_version,ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order) VALUES(${[version,item.index+1,item.id,item.emoji,`local synthetic ${item.index}`,'[]',null,null,JSON.stringify([...item.emoji].map(char=>char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'))),item.index+1].map(sql).join(',')});`).join('\n')+`\nUPDATE fanmark_emoji_master_release_imports SET status='ready' WHERE release_version=${sql(version)};\nINSERT INTO fanmark_emoji_master_active_release(singleton_id,release_version,previous_release_version,activation_id,action,generation) VALUES(1,${sql(version)},NULL,${sql(randomUUID())},'promotion',1);`);
 report.state='seeded';await checkpoint();
 server=spawn(process.execPath,[wrangler,'dev','--local','--local-protocol','https','--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--persist-to',state,'--config',configPath,'--log-level','error'],{cwd:temp,env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'1'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',chunk=>serverLog+=chunk);server.stderr.on('data',chunk=>serverLog+=chunk);
 const http=(pathname,init={})=>new Promise((resolve,reject)=>{assert.ok(pathname.startsWith('/')&&!pathname.startsWith('//'));const req=httpsRequest(origin+pathname,{...init,rejectUnauthorized:false,headers:{Origin:origin,...init.headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.setTimeout(8000,()=>req.destroy(new Error('local_https_timeout')));if(init.body)req.write(init.body);req.end();});
 let ready=false;for(let i=0;i<200;i++){assert.equal(server.exitCode,null,'local_worker_exited');try{if((await http('/')).status===200){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'local_worker_not_ready');
 const catalog=await http('/api/emoji/catalog?limit=500');assert.equal(catalog.status,200);assert.equal(JSON.parse(catalog.body).total,8);
 const auth=await http('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:users[0].email,password:users[0].password})});assert.equal(auth.status,200,'real_local_signin_failed');const cookie=auth.headers['set-cookie']?.find(value=>value.includes('session_token='))?.split(';')[0];assert.ok(cookie);
 const profile=await http(`/api/me/fanmarks/${users[0].fanmarkId}/profile`,{headers:{Cookie:cookie}});assert.equal(profile.status,200);assert.equal(JSON.parse(profile.body).profile.display_name,users[0].name);
 report.state='http-verified';report.httpsOrigin=origin;report.actualAuthCookie=true;report.catalogItems=8;await checkpoint();
 const source=await readFile(path.join(root,'scripts/migration/test-owner-profile-editor-browser.mjs'),'utf8');
 const helper=source.slice(source.indexOf('function cdpConnection('),source.indexOf('\nasync function value('));assert.ok(helper.startsWith('function cdpConnection('));
 await privateWrite(path.join(temp,'cdp-helper.mjs'),helper+'\nexport {cdpConnection};\n');
 const {runBrowser}=await import('./owner-profile-editor-local-browser.mjs');
 report.browser=await runBrowser({temp,root,origin,users,http,execute,sql});
 report.state='verified';await checkpoint();
 console.log(JSON.stringify({...report,temp:undefined,origin:undefined,httpsOrigin:undefined,reportPath:journalPath}));
}catch(error){report.state='failed';report.error=error instanceof Error?error.message:'local_failure';await checkpoint();console.log(JSON.stringify({state:report.state,error:report.error,journalPath}));process.exitCode=1;}
finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');for(let i=0;i<20&&server.exitCode===null;i++)await delay(100);if(server.exitCode===null){server.kill('SIGKILL');for(let i=0;i<20&&server.exitCode===null;i++)await delay(100);}}
 await privateWrite(logPath,serverLog);
 report.serverStopped=!server||server.exitCode!==null||server.signalCode!==null;
 report.loopbackPortClosed=await new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port});
  socket.once('connect',()=>{socket.destroy();resolve(false);});
  socket.once('error',()=>{socket.destroy();resolve(true);});
  socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});
 });
 if(report.serverStopped&&report.loopbackPortClosed){await rm(state,{recursive:true,force:true,maxRetries:5,retryDelay:100});report.localDatabaseStateRemoved=true;}
 else{report.state='failed';report.error='local_worker_cleanup_incomplete';process.exitCode=1;}
 await checkpoint();
}

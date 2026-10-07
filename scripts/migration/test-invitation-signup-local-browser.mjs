// Actual built UI + application Worker + isolated split D1. Only the upstream
// Resend API is synthetic; all other Worker egress and browser egress is denied.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createServer} from 'node:https';
import {createServer as netServer} from 'node:net';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';import os from 'node:os';
import {build} from '../../workers/api/node_modules/esbuild/lib/main.js';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {BUSINESS_MIGRATION_SEQUENCE} from './business-migration-ledger.mjs';
import {SYSTEM_SETTINGS_STAGE_KEYS} from './system-settings-stage.mjs';
import {businessMigrationStatements} from './business-runtime-import-schema.mjs';
import {stageReferenceMasterRelease,activateReferenceMasterRelease,verifyStagedReferenceMasterRelease} from './reference-master-release.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),api=path.join(root,'workers/api');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const temp=await mkdtemp(path.join(os.tmpdir(),'fanmark-invitation-local-'));await chmod(temp,0o700);
const privateWrite=async(name,data)=>{await writeFile(path.join(temp,name),data,{mode:0o600});await chmod(path.join(temp,name),0o600);};
const port=await new Promise((resolve,reject)=>{const s=netServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{
  const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
const origin=`https://127.0.0.1:${port}`,assets=path.join(temp,'assets'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const email='synthetic-invited-owner@example.invalid',password='Synthetic-Invite-only!2026',code='LOCALINVITE';
const inviteId=randomUUID(),version=createHash('sha256').update('local-invitation-catalog').digest('hex');
let mf,server,chrome,cdp;const mails=[],outboundDenied=[],browserDenied=[],apiRequests=[],apiResponses=[];
let report={state:'preparing',head,temp,origin,actualApplicationWorker:true,actualBrowser:true,
  businessMigrations:BUSINESS_MIGRATION_SEQUENCE.length,authMigrations:4,masterMigrations:8,
  remoteResources:false,remoteWrites:0,realProviderCalls:0,realEmailsSent:0,sourceRowsRead:false};
const checkpoint=()=>privateWrite('report.json',JSON.stringify(report,null,2)+'\n');
async function child(args,cwd=root,env=process.env){return new Promise((resolve,reject)=>{
  const proc=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});let output='';
  proc.stdout.on('data',chunk=>output+=chunk);proc.stderr.on('data',chunk=>output+=chunk);
  proc.on('error',reject);proc.on('close',async status=>{await privateWrite('build-'+randomUUID()+'.log',output);
    status===0?resolve():reject(new Error('local_build_failed'));});
});}
async function value(expression){const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  assert.ok(!result.exceptionDetails,'browser_evaluation_failed');return result.result?.value;}
async function wait(expression,predicate,timeout=20_000){const deadline=Date.now()+timeout;while(Date.now()<deadline){
  const result=await value(expression);if(predicate(result))return result;await delay(100);
}throw new Error('browser_wait_timeout:'+expression);}
async function fill(selector,text){await value(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});
  if(!input)throw Error('missing_input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});
  input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function click(selector){const point=await value(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error('button_unavailable');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});} 
try{
  await checkpoint();
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'tls.key'),
    '-out',path.join(temp,'tls.cert'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  await chmod(path.join(temp,'tls.key'),0o600);await chmod(path.join(temp,'tls.cert'),0o600);
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const selectors=Object.fromEntries([...manifest.scripts['build:cloudflare-staging'].matchAll(/\b(VITE_[A-Z_]+)=([a-z0-9-]+)\s/gu)].map(m=>[m[1],m[2]]));
  assert.equal(Object.keys(selectors).length,45);const emptyEnv=path.join(temp,'empty-env');await mkdir(emptyEnv);
  const buildEnv={...process.env};for(const key of Object.keys(buildEnv))if(key.startsWith('VITE_'))delete buildEnv[key];
  Object.assign(buildEnv,selectors,{FANMARK_VITE_ENV_DIR:emptyEnv,VITE_FANMARK_API_BASE_URL:origin,VITE_AUTH_API_BASE_URL:origin,
    VITE_SUPABASE_URL:'https://synthetic-db.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only'});
  await child([path.join(root,'node_modules/vite/bin/vite.js'),'build','--mode','cloudflare-staging','--outDir',assets],root,buildEnv);
  const compiled=await build({entryPoints:[path.join(api,'src/index.ts')],bundle:true,write:false,format:'esm',platform:'browser',
    target:'es2022',conditions:['workerd'],external:['cloudflare:*','node:*']});
  assert.ok(compiled.outputFiles[0].text.includes('node:async_hooks'));assert.ok(!compiled.outputFiles[0].text.includes('AsyncLocalStoragePolyfill'));
  const staging=JSON.parse(await readFile(path.join(api,'wrangler.app-staging.jsonc'),'utf8'));
  const vars={...staging.vars,BETTER_AUTH_URL:origin,CORS_ALLOWED_ORIGINS:origin,BETTER_AUTH_SECRET:'local-invitation-only-secret-'+randomUUID(),
    AUTH_EMAIL_BACKEND:'resend',AUTH_EMAIL_TEMPLATE_BACKEND:'d1',RESEND_API_KEY:'local-synthetic-resend-key-'+randomUUID(),
    RESEND_FROM_EMAIL:'no-reply@example.invalid',AUTH_SOCIAL_BACKEND:'better-auth',GOOGLE_OAUTH_CLIENT_ID:'local-google-id',
    GOOGLE_OAUTH_CLIENT_SECRET:'local-google-secret-only'};
  for(const key of ['STRIPE_WEBHOOK_BACKEND','STRIPE_DISPATCH_BACKEND','STRIPE_PLAN_CHECKOUT_BACKEND','STRIPE_PLAN_CHANGE_BACKEND',
    'STRIPE_CUSTOMER_PORTAL_BACKEND','STRIPE_EXTENSION_CHECKOUT_BACKEND','LICENSE_EXPIRY_BACKEND','NOTIFICATION_ARCHIVE_BACKEND',
    'BROADCAST_SEND_BACKEND'])delete vars[key];
  const env={...Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,{type:'text',value}])),
    ...Object.fromEntries(['AUTH_DB','FANMARK_DB','MASTER_DB'].map(name=>[name,{type:'d1',name:'invitation-local-'+name}])),
    NOTIFICATION_WAKE:{type:'durable-object',worker:'fanmark-invitation-ui-local',exportName:'NotificationWakeCoordinator'},
    ASSETS:{type:'fetcher',handler:async request=>{
      const pathname=decodeURIComponent(new URL(request.url).pathname),filename=path.resolve(assets,'.'+pathname);
      if(!filename.startsWith(assets+path.sep))return new Response('missing',{status:404});
      try{const bytes=await readFile(filename);const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css',
        '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(filename)]||'application/octet-stream';
        return new Response(bytes,{headers:{'content-type':mime}});}catch{return new Response('missing',{status:404});}
    }}};
  mf=new Miniflare({workers:[{config:{name:'fanmark-invitation-ui-local',type:'worker',compatibilityDate:'2026-09-18',
    compatibilityFlags:['nodejs_compat'],exports:{NotificationWakeCoordinator:{type:'durable-object',storage:'sqlite'}},env,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',handler:async request=>{
      const url=new URL(request.url);
      if(url.href==='https://api.resend.com/emails'&&request.method==='POST'){
        const mail=await request.json();assert.deepEqual(mail.to,[email]);mails.push(mail);
        return new Response(JSON.stringify({id:'synthetic-mail-'+mails.length}),{headers:{'content-type':'application/json'}});
      }
      outboundDenied.push({host:url.hostname,path:url.pathname});return new Response('external network denied',{status:503});
    }}}}]});
  const auth=await mf.getD1Database('AUTH_DB'),business=await mf.getD1Database('FANMARK_DB'),master=await mf.getD1Database('MASTER_DB');
  async function apply(db,directory,names){for(const name of names)await db.batch(businessMigrationStatements(
    await readFile(path.join(api,directory,name),'utf8')).map(sql=>db.prepare(sql)));}
  await apply(business,'migrations-business',BUSINESS_MIGRATION_SEQUENCE);
  await apply(auth,'migrations',['0003_better_auth_core.sql','0007_auth_signup_command.sql','0008_auth_user_suspension.sql','0009_auth_oauth_signup.sql']);
  await apply(master,'migrations',['0000_emoji_master.sql','0001_emoji_master_release_staging.sql','0002_emoji_master_release_activation.sql',
    '0004_reference_master_releases.sql','0005_emoji_master_admin_guards.sql','0006_reference_master_extension_prices.sql',
    '0007_release_audit_timestamps.sql','0008_emoji_master_change_audits.sql']);
  const now=new Date().toISOString();
  await business.batch([
    business.prepare('INSERT INTO system_settings (id,setting_key,setting_value,is_public,created_at,updated_at) VALUES (?,\'invitation_mode\',\'false\',1,?,?)').bind(randomUUID(),now,now),
    business.prepare('INSERT INTO system_settings (id,setting_key,setting_value,is_public,created_at,updated_at) VALUES (?,\'social_login_enabled\',\'true\',1,?,?)').bind(randomUUID(),now,now),
    business.prepare('INSERT INTO invitation_codes (id,code,max_uses,used_count,is_active,created_at,updated_at) VALUES (?,?,1,0,1,?,?)').bind(inviteId,code,now,now),
  ]);
  const settingKeys=[...SYSTEM_SETTINGS_STAGE_KEYS.filter(k=>!['invitation_mode','social_login_enabled'].includes(k)),
    'max_emoji_characters','grace_period_days'];
  await business.batch(settingKeys.map(key=>{
    const value=key==='stripe_mode'?'test':key.includes('stripe_price_id')?'price_syntheticInvitation':key==='free_fanmarks_limit'?'3':'5';
    const isPublic=['enterprise_fanmarks_limit','enterprise_pricing'].includes(key)?0:1;
    return business.prepare('INSERT INTO system_settings (id,setting_key,setting_value,is_public,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(randomUUID(),key,value,isPublic,now,now);
  }));
  for(const language of ['ja','en','ko','id'])await business.prepare('INSERT INTO email_templates (id,email_type,language,subject,body_text,button_text,is_active,created_at,updated_at) VALUES (?,\'signup\',?,?,?,?,1,?,?)')
    .bind(randomUUID(),language,'Synthetic confirmation','Synthetic verification only','Verify',now,now).run();
  const emojiId=randomUUID();await master.batch([
    master.prepare('INSERT INTO fanmark_emoji_master_release_imports (release_version,manifest_json,row_count,status) VALUES (?,\'{}\',1,\'loading\')').bind(version),
    master.prepare('INSERT INTO fanmark_emoji_master_release_staging (release_version,ordinal,id,emoji,short_name,keywords_json,codepoints_json,sort_order) VALUES (?,1,?,\'🧪\',\'test\',\'[]\',\'["1F9EA"]\',1)').bind(version,emojiId),
    master.prepare('UPDATE fanmark_emoji_master_release_imports SET status=\'ready\' WHERE release_version=?').bind(version),
    master.prepare('INSERT INTO fanmark_emoji_master_active_release (singleton_id,release_version,activation_id,action,generation) VALUES (1,?,?,\'promotion\',1)').bind(version,randomUUID()),
  ]);
  const timestamp=now.replace(/\.(\d{3})Z$/u,(_m,f)=>`.${f}000Z`);
  const entries={
    fanmark_tiers:[[1,'C',4,5,null],[2,'B',3,3,30],[3,'A',2,5,14],[4,'S',1,1,7]].map(([tier_level,display_name,emoji_count_min,emoji_count_max,initial_license_days])=>({
      id:randomUUID(),tier_level,display_name,emoji_count_min,emoji_count_max,initial_license_days,is_active:true,
      description:'Synthetic invitation fixture',monthly_price_usd:'0.00',created_at:timestamp,updated_at:timestamp})),
    languages:[['ja','Japanese','日本語'],['en','English','English'],['ko','Korean','한국어'],['id','Indonesian','Bahasa Indonesia']].map(([code,label,native_label],sort_order)=>({
      id:randomUUID(),code,label,native_label,sort_order,is_active:true,created_at:timestamp,updated_at:timestamp})),
    reserved_emoji_patterns:[],
    fanmark_tier_extension_prices:[{id:randomUUID(),tier_level:4,months:1,price_yen:100,stripe_price_id:'price_syntheticInvitation',stripe_price_id_live:null,
      is_active:true,created_at:timestamp,updated_at:timestamp}],
  };
  const referenceSnapshot=Object.entries(entries).map(([table_name,records])=>({table_name,records,row_count:records.length,
    source_sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex')}));
  const referenceVersion=createHash('sha256').update(JSON.stringify(referenceSnapshot)).digest('hex');
  await stageReferenceMasterRelease({database:master,snapshot:referenceSnapshot,snapshotSha256:referenceVersion});
  await activateReferenceMasterRelease({database:master,releaseVersion:referenceVersion,expectedActiveVersion:null});
  assert.equal(await verifyStagedReferenceMasterRelease({database:master,snapshot:referenceSnapshot,snapshotSha256:referenceVersion}),true);
  const request=(pathname,options={})=>mf.dispatchFetch(origin+pathname,{redirect:'manual',headers:{Origin:origin},...options});
  const openCapabilities=await (await request('/api/auth/capabilities')).json();assert.equal(openCapabilities.invitationRequired,false);
  assert.deepEqual(openCapabilities.socialProviders,['google']);
  await business.prepare('UPDATE system_settings SET setting_value=\'true\' WHERE setting_key=\'invitation_mode\'').run();
  const capabilities=await (await request('/api/auth/capabilities')).json();assert.equal(capabilities.signUp,true);
  assert.equal(capabilities.invitationRequired,true);assert.deepEqual(capabilities.socialProviders,[]);
  server=createServer({key:await readFile(path.join(temp,'tls.key')),cert:await readFile(path.join(temp,'tls.cert'))},async(req,res)=>{
    try{const pathname=new URL(req.url,origin).pathname;if(pathname.startsWith('/api/'))apiRequests.push({method:req.method,path:pathname});
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
      const headers=new Headers();for(const[name,value]of Object.entries(req.headers))if(value!==undefined&&name!=='host')headers.set(name,Array.isArray(value)?value.join(','):value);
      const response=await mf.dispatchFetch(origin+req.url,{method:req.method,headers,redirect:'manual',...(body.length?{body}: {})});
      if(pathname.startsWith('/api/'))apiResponses.push({method:req.method,path:pathname,status:response.status});
      res.statusCode=response.status;for(const[name,value]of response.headers)if(name!=='set-cookie'&&name!=='transfer-encoding')res.setHeader(name,value);
      const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.statusCode=500;res.end('local worker failure');}
  });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const helperSource=await readFile(path.join(root,'scripts/migration/test-owner-profile-editor-browser.mjs'),'utf8');
  const helper=helperSource.slice(helperSource.indexOf('function cdpConnection('),helperSource.indexOf('\nasync function value('));
  assert.ok(helper.startsWith('function cdpConnection('));await privateWrite('cdp-helper.mjs',helper+'\nexport {cdpConnection};\n');
  const {cdpConnection}=await import(path.join(temp,'cdp-helper.mjs'));
  const chromePath=[process.env.FANMARK_STAGING_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);assert.ok(chromePath);
  const profile=path.join(temp,'chrome-profile');await mkdir(profile,{mode:0o700});
  chrome=spawn(chromePath,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update',
    '--disable-default-apps','--no-first-run','--no-default-browser-check','--ignore-certificate-errors',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  let debugPort;for(let i=0;i<200;i++){assert.equal(chrome.exitCode,null);try{debugPort=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];if(/^\d+$/u.test(debugPort))break;}catch{}await delay(100);}
  assert.ok(debugPort);const pages=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  cdp=cdpConnection(pages.find(page=>page.type==='page').webSocketDebuggerUrl);await cdp.opened;
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Emulation.setUserAgentOverride',{userAgent:await value('navigator.userAgent'),acceptLanguage:'ja-JP,ja'});
  cdp.on('Fetch.requestPaused',async params=>{try{
    const url=new URL(params.request.url);
    if(url.origin===origin)await cdp.send('Fetch.continueRequest',{requestId:params.requestId});
    else{browserDenied.push(url.hostname);await cdp.send('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'});}
  }catch{/* Closing the owned test browser ends outstanding interceptions. */}});
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await cdp.send('Page.navigate',{url:origin+'/auth'});
  await wait('[...document.querySelectorAll("[role=tab]")].map(el=>el.getAttribute("data-state"))',v=>v.length===2);
  await click('[role=tab][id$="trigger-signup"]');
  await wait('Boolean(document.querySelector("input[placeholder=ABC123]"))',Boolean);
  assert.equal(await value('Boolean(document.querySelector("#signup-email"))'),false);
  await fill('input[placeholder=ABC123]','WRONG');await value('document.querySelector("input[placeholder=ABC123]").closest("div.space-y-4").querySelector("button").click()');
  await wait('document.body.innerText',v=>v.includes('無効')||v.includes('使用済')||v.includes('使用されています'));
  assert.equal(await auth.prepare('SELECT count(*) AS n FROM user').first('n'),0);
  assert.equal(await business.prepare('SELECT used_count FROM invitation_codes WHERE id=?').bind(inviteId).first('used_count'),0);
  await fill('input[placeholder=ABC123]',code);await value('document.querySelector("input[placeholder=ABC123]").closest("div.space-y-4").querySelector("button").click()');
  await wait('Boolean(document.querySelector("#signup-email"))',Boolean);
  await fill('#signup-email',email);await fill('#signup-password',password);await fill('#signup-confirm',password);
  await click('button[type=submit]');
  await wait('Boolean(document.querySelector("#signup-email"))',v=>v===false);
  assert.equal(mails.length,1);
  const user=await auth.prepare('SELECT id,emailVerified,signupCommandId FROM user WHERE email=?').bind(email).first();assert.ok(user);assert.equal(user.emailVerified,0);
  const settings=await business.prepare('SELECT user_id,invited_by_code,plan_type,preferred_language,requires_password_setup FROM user_settings WHERE user_id=?').bind(user.id).first();
  assert.equal(settings.invited_by_code,code);assert.equal(settings.plan_type,'free');assert.equal(settings.preferred_language,'ja');assert.equal(settings.requires_password_setup,0);
  const attempt=await business.prepare('SELECT attempt_id,state,auth_user_id FROM invitation_signup_attempts WHERE auth_user_id=?').bind(user.id).first();
  assert.equal(attempt.state,'completed');assert.equal(user.signupCommandId,attempt.attempt_id);
  assert.equal(await business.prepare('SELECT used_count FROM invitation_codes WHERE id=?').bind(inviteId).first('used_count'),1);
  assert.equal(await auth.prepare('SELECT count(*) AS n FROM session').first('n'),0);
  const verification=mails[0].text.match(/https:\/\/\S+/u)?.[0];assert.ok(verification);assert.equal(new URL(verification).origin,origin);
  const before=await request('/api/auth/sign-in/email',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(before.status,403);
  await cdp.send('Page.navigate',{url:verification});await wait('location.pathname',v=>v==='/');
  assert.equal(await auth.prepare('SELECT emailVerified FROM user WHERE id=?').bind(user.id).first('emailVerified'),1);
  assert.equal(await auth.prepare('SELECT count(*) AS n FROM session').first('n'),0);
  await cdp.send('Page.navigate',{url:origin+'/auth'});await wait('Boolean(document.querySelector("#auth-email"))',Boolean);
  await fill('#auth-email',email);await fill('#auth-password',password);await click('button[type=submit]');
  await wait('location.pathname',v=>v==='/dashboard');
  assert.equal(await auth.prepare('SELECT count(*) AS n FROM session WHERE userId=?').bind(user.id).first('n'),1);
  for(const route of ['/api/me/profile','/api/me/fanmarks','/api/me/subscription','/api/me/analytics/summary']){
    const status=await value(`fetch(${JSON.stringify(route)}).then(r=>r.status)`);assert.equal(status,200,'invited_owner_api_unavailable:'+route);
  }
  assert.ok(!browserDenied.includes('synthetic-db.example.invalid'),'supabase_fallback_attempted');
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});await privateWrite('invited-dashboard.png',Buffer.from(screenshot.data,'base64'));
  const signout=await value(`fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)`);assert.equal(signout,200);
  assert.equal(await auth.prepare('SELECT count(*) AS n FROM session').first('n'),0);
  await cdp.send('Page.navigate',{url:origin+'/auth'});await wait('Boolean(document.querySelector("[role=tab][id$=trigger-signup]"))',Boolean);await click('[role=tab][id$="trigger-signup"]');
  await wait('Boolean(document.querySelector("input[placeholder=ABC123]"))',Boolean);await fill('input[placeholder=ABC123]',code);
  await value('document.querySelector("input[placeholder=ABC123]").closest("div.space-y-4").querySelector("button").click()');
  await wait('document.body.innerText',v=>v.includes('使用')||v.includes('上限'));
  assert.equal(await value('Boolean(document.querySelector("#signup-email"))'),false);
  assert.equal(mails.length,1);assert.equal(await auth.prepare('SELECT count(*) AS n FROM user').first('n'),1);
  assert.equal(await business.prepare('SELECT used_count FROM invitation_codes WHERE id=?').bind(inviteId).first('used_count'),1);
  for(const db of [auth,business,master])assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.deepEqual(outboundDenied,[]);
  assert.deepEqual(apiResponses.filter(r=>r.status>=500),[],'unexpected_application_api_failure');
  Object.assign(report,{state:'verified',invitationModeRequired:true,googleBeforeInvitationMode:true,googleSuppressedWhenRequired:true,
    invalidCodeLeavesSignupHidden:true,validatedCodeRevealsSignup:true,signupCompletesOneCommand:true,invitationUses:1,
    exactProfileAttribution:true,unverifiedLoginRefused:true,noSessionBeforeOrAfterVerification:true,
    verificationLinkFromSyntheticProvider:true,realBrowserPasswordLogin:true,logoutRevokesSession:true,
    usedCodeRefusedInBrowser:true,syntheticMailRequests:1,foreignKeyViolations:0,workerOutboundDenied:outboundDenied.length,
    browserExternalHostsDenied:[...new Set(browserDenied)],apiRequests:apiRequests.map(r=>({method:r.method,path:r.path})),
    requiredOwnerApisAvailable:true,workerUsesNativeAsyncLocalStorage:true,apiResponses,
    screenshot:path.join(temp,'invited-dashboard.png'),wholeStagingAcceptance:false});
}catch(error){if(cdp){try{const shot=await cdp.send('Page.captureScreenshot',{format:'png'});await privateWrite('failure.png',Buffer.from(shot.data,'base64'));
  report.failurePageText=await value('document.body.innerText');}catch{}}report.state='failed';report.error=String(error.message).replace(/https?:\/\/\S+/gu,'[url]');process.exitCode=1;}
finally{
  if(cdp)cdp.close();
  if(chrome&&chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGTERM');for(let i=0;i<20&&chrome.exitCode===null&&chrome.signalCode===null;i++)await delay(100);
    if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGKILL');await delay(500);}}
  if(server)await new Promise(resolve=>server.close(resolve));if(mf)await mf.dispose();
  await rm(path.join(temp,'chrome-profile'),{recursive:true,force:true,maxRetries:5,retryDelay:100});
  report.ownedBrowserStopped=!chrome||chrome.exitCode!==null||chrome.signalCode!==null;
  report.localServerStopped=!server||!server.listening;report.localRuntimeDisposed=Boolean(mf);report.syntheticCredentialsIsolated=true;
  await checkpoint();console.log(JSON.stringify({state:report.state,error:report.error,journalPath:path.join(temp,'report.json'),
    ownedBrowserStopped:report.ownedBrowserStopped,localServerStopped:report.localServerStopped}));
}

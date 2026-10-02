import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Runs the built staging UI against local synthetic responses. Fetch interception
// fulfills or blocks every browser request; it never contacts a live API.
const root=fileURLToPath(new URL('../../',import.meta.url));
const chromePath=[process.env.FANMARK_STAGING_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
assert.ok(chromePath,'Chrome is required; set FANMARK_STAGING_CHROME if needed');
await readFile(path.join(root,'dist-staging/index.html'));
const origin='https://fanmark-app-staging.fanmark-id.workers.dev';
const userId='35111111-1111-4111-8111-111111111111',fanmarkId='45111111-1111-4111-8111-111111111111',licenseId='55111111-1111-4111-8111-111111111111';
const editor=`/fanmarks/${fanmarkId}/profile/edit`,profileRoute=`/api/me/fanmarks/${fanmarkId}/profile`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const cases=process.argv.length===2?['cold','anonymous','empty','denied','network','retry','login']:process.argv.slice(2);assert.ok(cases.every(c=>['cold','anonymous','empty','denied','network','retry','login'].includes(c)));
function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser_cdp_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("browser_cdp_connect_failed"));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (Number.isInteger(message.id)) {
      const operation = pending.get(message.id);
      if (!operation) return;
      pending.delete(message.id);
      clearTimeout(operation.timeout);
      if (message.error) operation.reject(new Error("browser_cdp_command_failed"));
      else operation.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timeout);
      operation.reject(new Error("browser_cdp_closed"));
    }
    pending.clear();
  });

  return {
    opened,
    on(method, listener) {
      const entries = listeners.get(method) ?? new Set();
      entries.add(listener);
      listeners.set(method, entries);
      return () => entries.delete(listener);
    },
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error("browser_cdp_timeout"));
        }, 15_000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

async function value(cdp,expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,'evaluation failed');return r.result?.value;}
async function wait(cdp,expression,predicate,timeout=10000){const deadline=Date.now()+timeout;let v;while(Date.now()<deadline){v=await value(cdp,expression);if(predicate(v))return v;await delay(100);}throw Error('wait expired: '+JSON.stringify(v));}
async function run(mode){
 const temp=await mkdtemp(path.join(os.tmpdir(),'fanmark-editor-offline-'));
 const chrome=spawn(chromePath,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--no-first-run','--no-default-browser-check',`--user-data-dir=${temp}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
 let cdp;let debug;const exited=new Promise(resolve=>{chrome.once('exit',resolve);chrome.once('error',resolve);});
 try{
  let port;for(let i=0;i<150;i++){try{port=(await readFile(path.join(temp,'DevToolsActivePort'),'utf8')).split('\n')[0];if(port)break;}catch{}await delay(100);}assert.ok(port);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();cdp=cdpConnection(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.opened;
  await cdp.send('Page.enable');await cdp.send('Network.enable');
  const blocked=[],requests=[],failures=[];debug={blocked,requests,failures};let sessionReleased=false,sessionStarted=false,recovered=false,ownerReads=0,signedIn=!['anonymous','login'].includes(mode);
  const timestamp='2026-10-03T00:00:00.000Z';
  const user={id:userId,email:'offline-profile@example.invalid',emailVerified:true,name:'Offline synthetic owner'};
  const own={schemaVersion:1,profile:{id:userId,user_id:userId,username:'offline-profile',display_name:'Offline synthetic owner',avatar_url:null,plan_type:'free',preferred_language:'ja',created_at:timestamp,updated_at:timestamp,requires_password_setup:false}};
  const context={schemaVersion:1,licenseId,fanmark:{id:fanmarkId,user_input_fanmark:'🌸🚀💡🌙',fanmark:'🌸🚀💡🌙',emoji_ids:[],short_id:'offline-perpetual',fanmark_name:'Offline perpetual'},profile:{id:'65111111-1111-4111-8111-111111111111',license_id:licenseId,display_name:' Offline perpetual ',bio:'Offline stored biography',social_links:{},theme_settings:{},is_public:true,created_at:timestamp,updated_at:timestamp}};
  async function fulfill(id,status,body,type='application/json'){
   await cdp.send('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:type},{name:'Cache-Control',value:'no-store'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'}],body:Buffer.from(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)).toString('base64')});
  }
  cdp.on('Fetch.requestPaused',event=>{void (async()=>{
   const u=new URL(event.request.url);requests.push({path:u.pathname,method:event.request.method});
   if(u.origin!==origin){blocked.push(u.origin);await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
   if(u.pathname.startsWith('/api/')){
    if(u.pathname==='/api/emoji/catalog')return fulfill(event.requestId,200,{schemaVersion:1,version:u.searchParams.get('version')??'a'.repeat(64),total:1,offset:0,limit:Number(u.searchParams.get('limit')),nextOffset:null,items:[{id:'75111111-1111-4111-8111-111111111111',emoji:'🌸',shortName:'cherry blossom',keywords:[],category:null,subcategory:null,codepoints:['1F338'],sortOrder:1}]});
    if(u.pathname==='/api/auth/get-session'){sessionStarted=true;await delay(mode==='cold'?1600:400);sessionReleased=true;return fulfill(event.requestId,200,signedIn?{user,session:{id:'offline-session'}}:null);}
    if(u.pathname==='/api/auth/sign-in/email'){signedIn=true;return fulfill(event.requestId,200,{user,session:{id:'offline-session'}});}
    if(u.pathname==='/api/me/profile')return fulfill(event.requestId,200,own);
    if(u.pathname==='/api/system/maintenance')return fulfill(event.requestId,200,{schemaVersion:1,settings:{maintenance_mode:false,maintenance_message:'',maintenance_end_time:null}});
    if(u.pathname==='/api/auth/capabilities')return fulfill(event.requestId,200,{signUp:false,socialProviders:[],passwordReset:false,invitationRequired:false});
    if(u.pathname===profileRoute){
     ownerReads++;
     if(mode==='denied'||(mode==='retry'&&!recovered))return fulfill(event.requestId,404,{error:'not_found'});
     if(mode==='network')return cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'ConnectionFailed'});
     return fulfill(event.requestId,200,mode==='empty'?{...context,profile:null}:context);
    }
    return fulfill(event.requestId,503,{error:'offline_unconfigured_route'});
   }
   if(u.pathname.startsWith('/assets/')){
    const relative=u.pathname.slice(1);assert.ok(!relative.includes('..'));
    try{const body=await readFile(path.join(root,'dist-staging',relative));const ext=path.extname(relative);const type=({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[ext]??'application/octet-stream';return fulfill(event.requestId,200,body,type);}catch{return fulfill(event.requestId,404,'missing','text/plain');}
   }
   if(u.pathname==='/sw.js'||u.pathname.endsWith('.webmanifest'))return fulfill(event.requestId,404,'offline','text/plain');
   const html=await readFile(path.join(root,'dist-staging/index.html'),'utf8');return fulfill(event.requestId,200,html,'text/html');
  })().catch(e=>failures.push(e.message));});
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.send('Page.navigate',{url:origin+editor});
  if(mode==='cold'){
   // Fast maintenance response, deliberately delayed persisted-session response.
   for(let i=0;i<100&&!sessionStarted;i++)await delay(100);assert.equal(sessionStarted,true,'auth request did not start');
   await delay(600);assert.equal(sessionReleased,false);assert.equal(await value(cdp,'location.pathname'),editor,'redirected before auth restoration');
   await wait(cdp,'!!document.querySelector(\'input[name="display_name"]\')',Boolean);
   assert.equal(await value(cdp,'location.pathname'),editor);
   assert.equal(await value(cdp,'document.querySelector(\'input[name="display_name"]\').value'),' Offline perpetual ');
   const size=await value(cdp,'({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.ok(size.scroll<=size.width,`overflow ${JSON.stringify(size)}`);
  }else if(mode==='anonymous'||mode==='login'){
   await wait(cdp,'location.pathname',v=>v==='/auth');
   const from=await value(cdp,'history.state?.usr?.from');assert.equal(from,editor,'login return target must be a string');
   assert.equal(requests.some(r=>r.path===profileRoute),false,'anonymous owner API read');
   if(mode==='login'){
    await wait(cdp,`!!document.querySelector('#auth-email')`,Boolean);
    for(const [selector,text] of [['#auth-email','offline-profile@example.invalid'],['#auth-password','Synthetic-local-password!123']]){
     await value(cdp,`document.querySelector(${JSON.stringify(selector)}).focus()`);await cdp.send('Input.insertText',{text});
    }
    await value(cdp,`document.querySelector('#auth-email').closest('form').querySelector('button[type="submit"]').click()`);
    await wait(cdp,`({path:location.pathname,editor:!!document.querySelector('input[name="display_name"]')})`,v=>v.editor&&v.path===editor);
   }
  }else if(mode==='empty'){
   await wait(cdp,`!!document.querySelector('input[name="display_name"]')`,Boolean);
   assert.equal(await value(cdp,`document.querySelector('input[name="display_name"]').value`),'','authorized missing profile should allow creation');
  }else{
   for(let i=0;i<100&&ownerReads===0;i++)await delay(100);assert.ok(ownerReads>0,'owner profile was not requested');
   await wait(cdp,`({editor:!!document.querySelector('input[name="display_name"]'),alert:!!document.querySelector('[role="alert"]')})`,v=>v.editor||v.alert);
   assert.equal(await value(cdp,`!!document.querySelector('input[name="display_name"]')`),false,'denied/failed owner read rendered editable form');
   assert.equal(requests.some(r=>r.path===profileRoute&&r.method==='PATCH'),false);
   if(mode==='retry'){
    recovered=true;await value(cdp,`Array.from(document.querySelectorAll('[role="alert"] button')).find(b=>b.textContent==='再試行').click()`);
    await wait(cdp,`!!document.querySelector('input[name="display_name"]')`,Boolean);
    assert.equal(await value(cdp,`document.querySelector('input[name="display_name"]').value`),' Offline perpetual ');
    assert.equal(await value(cdp,`!!document.querySelector('[role="alert"]')`),false);
   }
  }
  assert.deepEqual(blocked.filter(o=>o!=='https://fonts.googleapis.com'&&o!=='https://fonts.gstatic.com'),[],'frontend contacted unapproved origin');assert.deepEqual(failures,[],'interception errors');
  console.log(JSON.stringify({case:mode,passed:true,apiRequests:requests.filter(r=>r.path.startsWith('/api/')).length,blockedFontRequests:blocked.length}));
 }catch(error){console.error(JSON.stringify({mode,debug,state:cdp?await value(cdp,'({path:location.pathname,title:document.title,text:document.body?.innerText?.slice(0,300),html:document.documentElement.outerHTML.slice(0,150)})').catch(()=>null):null}));throw error;}finally{cdp?.close();chrome.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGKILL');await Promise.race([exited,delay(2000)]);}await rm(temp,{recursive:true,force:true});}
}
for(const mode of cases){try{await run(mode);}catch(error){console.error(JSON.stringify({case:mode,passed:false,error:error.message}));process.exitCode=1;}}

// Read-only, anonymous production lab measurement. No dependency installation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { catalogPageCount } from './slow-network-summary.mjs';

const profiles = {
  'slow-4g': { latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 },
  'slow-3g': { latency: 400, downloadThroughput: 400_000 / 8, uploadThroughput: 400_000 / 8 },
};
const profile = process.argv[2] || 'slow-4g';
assert.ok(profiles[profile], 'Expected slow-4g or slow-3g');
const route = process.argv[3] || '/';
assert.ok(['/', '/auth', '/admin', '/about'].includes(route), 'Only anonymous read-only routes are allowed');
const output = process.argv[4] || await mkdtemp(path.join(os.tmpdir(), 'fanmark-network-audit-'));
await mkdir(output, { recursive: true, mode: 0o700 });
const chromeProfile = await mkdtemp(path.join(os.tmpdir(), 'fanmark-audit-chrome-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = `(() => {
  const p=window.__audit={marks:{},lcp:[],shifts:[],longtasks:[],catalog:[],writes:[]};
  const element=node=>{const e=node?.nodeType===3?node.parentElement:node;return e?.tagName ? [e.tagName.toLowerCase(),e.id?'#'+e.id:'',...Array.from(e.classList||[]).slice(0,3).map(c=>'.'+c)].join('') : null;};
  new PerformanceObserver(list=>{for(const e of list.getEntries())p.lcp.push({at:e.startTime,size:e.size,element:element(e.element),url:e.url?new URL(e.url).pathname:null});}).observe({type:'largest-contentful-paint',buffered:true});
  new PerformanceObserver(list=>{for(const e of list.getEntries())p.shifts.push({at:e.startTime,value:e.value,recentInput:e.hadRecentInput,sources:(e.sources||[]).map(s=>({element:element(s.node),previous:s.previousRect.toJSON(),current:s.currentRect.toJSON()}))});}).observe({type:'layout-shift',buffered:true});
  new PerformanceObserver(list=>{for(const e of list.getEntries())p.longtasks.push({at:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  const originalFetch=fetch.bind(window);
  window.fetch=async(input,init)=>{
    const u=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(!['GET','HEAD','OPTIONS'].includes(method)){p.writes.push({method,path:u.pathname});throw Error('audit_refuses_mutation');}
    const start=performance.now(); const r=await originalFetch(input,init);
    if(u.pathname==='/api/emoji/catalog')p.catalog.push({start,headers:performance.now(),status:r.status});
    return r;
  };
  function mark(){
    if(document.querySelector('[data-app-startup]')&&!p.marks.skeleton)p.marks.skeleton=performance.now();
    const selector=location.pathname==='/auth'?'#auth-email':location.pathname==='/admin'?'#cloudflare-admin-email':location.pathname==='/about'?'main h1, h1':'#search button[aria-label="直接入力"]';
    if(document.querySelector(selector)&&!document.querySelector('[data-app-startup]')&&!p.marks.ready){p.marks.ready=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>p.marks.readyPaint=performance.now()));}
    requestAnimationFrame(mark);
  } requestAnimationFrame(mark);
})();`;

// The page transport supports flattened child sessions so SW precache traffic
// receives the same throttle and is recorded separately from cached responses.
function transport(url) {
  const ws = new WebSocket(url); let id = 0;
  const pending = new Map(), listeners = new Map();
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const e = JSON.parse(String(event.data));
    if(e.id){const item=pending.get(e.id);if(!item)return;pending.delete(e.id);clearTimeout(item.timer);e.error?item.reject(Error(item.method+': '+e.error.message)):item.resolve(e.result||{});}
    else for(const f of listeners.get(e.method)||[])f(e.params||{},e.sessionId||'page');
  });
  return { opened, on(method,f){const list=listeners.get(method)||[];list.push(f);listeners.set(method,list);},
    send(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},15000);pending.set(n,{resolve,reject,timer,method});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});},close(){ws.close();} };
}
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-extensions',
  '--user-data-dir='+chromeProfile,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
let cdp;
try {
  let port;
  for(let n=0;n<150&&!port;n++){assert.equal(chrome.exitCode,null);try{port=(await readFile(chromeProfile+'/DevToolsActivePort','utf8')).split('\n')[0];}catch{}if(!port)await pause(100);}
  assert.ok(port,'Chrome did not start');
  const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  cdp=transport(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.opened;
  const conditions={offline:false,...profiles[profile],connectionType:'cellular4g'};
  const errors=[], requests=new Map(), childTasks=[], catalogMetadata=new Map();
  let label='setup';
  async function throttle(session){await cdp.send('Network.enable',{},session);await cdp.send('Network.emulateNetworkConditions',conditions,session);}
  cdp.on('Target.attachedToTarget',(e)=>{
    childTasks.push((async()=>{await cdp.send('Runtime.runIfWaitingForDebugger',{},e.sessionId);await throttle(e.sessionId);})().catch(error=>errors.push(error.message)));
  });
  cdp.on('Runtime.exceptionThrown',(e,session)=>errors.push({state:label,session,text:e.exceptionDetails?.text,description:e.exceptionDetails?.exception?.description?.slice(0,1200),url:e.exceptionDetails?.url}));
  cdp.on('Network.requestWillBeSent',(e,session)=>{
    const u=new URL(e.request.url);if(!['http:','https:'].includes(u.protocol))return;
    requests.set(session+':'+e.requestId,{label,session,host:u.hostname,path:u.pathname,query:u.pathname==='/api/emoji/catalog'?u.search:undefined,method:e.request.method,type:e.type,start:e.timestamp,initiator:e.initiator.type,priority:e.request.initialPriority});
  });
  cdp.on('Network.responseReceived',(e,session)=>{const r=requests.get(session+':'+e.requestId);if(r)Object.assign(r,{status:e.response.status,headersAt:e.timestamp,fromSW:e.response.fromServiceWorker||false,fromDisk:e.response.fromDiskCache||false,protocol:e.response.protocol,encoding:e.response.headers['content-encoding'],cacheControl:e.response.headers['cache-control'],timing:e.response.timing});});
  cdp.on('Network.requestServedFromCache',(e,session)=>{const r=requests.get(session+':'+e.requestId);if(r)r.fromCache=true;});
  cdp.on('Network.loadingFinished',(e,session)=>{
    const r=requests.get(session+':'+e.requestId);if(!r)return;
    Object.assign(r,{end:e.timestamp,wireBytes:e.encodedDataLength});
    if(session==='page'&&r.path==='/api/emoji/catalog'&&Number(new URLSearchParams(r.query).get('offset')||0)===0){
      // Read metadata over CDP after the body finishes. Do not clone or delay
      // application fetches, or infer completeness from headers alone.
      childTasks.push((async()=>{
        const response=await cdp.send('Network.getResponseBody',{requestId:e.requestId});
        const body=JSON.parse(response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body);
        assert.equal(body.schemaVersion,1);assert.equal(body.offset,0);
        const metadata={version:body.version,total:body.total,limit:body.limit};
        catalogPageCount(metadata);catalogMetadata.set(r.label,metadata);
      })().catch(error=>errors.push(error.message)));
    }
  });
  cdp.on('Network.loadingFailed',(e,session)=>{const r=requests.get(session+':'+e.requestId);if(r)Object.assign(r,{failure:e.errorText});});
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await throttle();
  await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:probe});
  const value=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,'Browser evaluation failed: '+expression.slice(0,80));return r.result?.value;};
  const report={observedAt:new Date().toISOString(),origin:'https://fanmark.id',route,profile,conditions,cpuSlowdown:4,viewport:{width:390,height:844},browser:version.Browser,userAgent:version['User-Agent'],runs:[]};
  for(const state of ['cold','warm']){
    label=state;
    await cdp.send('Page.navigate',{url:'https://fanmark.id'+route});
    const began=Date.now();let ready;
    while(Date.now()-began<90_000){
      const p=await value('window.__audit && ({ready:window.__audit.marks.ready,catalog:window.__audit.catalog.length,bodies:performance.getEntriesByType("resource").filter(e=>new URL(e.name).pathname==="/api/emoji/catalog").length,now:performance.now(),controlled:!!navigator.serviceWorker.controller})');
      const metadata=catalogMetadata.get(state);
      const expected=metadata&&catalogPageCount(metadata);
      if(p?.ready&&expected&&p.catalog===expected&&p.bodies===expected&&p.now-p.ready>5000&&p.controlled){ready=p;break;}
      assert.deepEqual(errors,[], 'Audit instrumentation failed');
      await pause(200);
    }
    assert.ok(ready,'Timed out before ready + catalog + service worker control');
    await Promise.all(childTasks);
    const snapshot=await value(`(async()=>({probe:window.__audit,paints:performance.getEntriesByType('paint').map(e=>({name:e.name,at:e.startTime})),navigation:performance.getEntriesByType('navigation').map(e=>({ttfb:e.responseStart,domInteractive:e.domInteractive,domContentLoaded:e.domContentLoadedEventEnd,load:e.loadEventEnd,transferSize:e.transferSize})),resources:performance.getEntriesByType('resource').map(e=>({host:new URL(e.name).hostname,path:new URL(e.name).pathname,start:e.startTime,end:e.responseEnd,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize,initiator:e.initiatorType})),entry:document.querySelector('script[type=module]').getAttribute('src'),cacheKeys:await caches.keys(),cacheEntries:await Promise.all((await caches.keys()).map(async key=>({key,paths:(await(await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)}))),controlled:!!navigator.serviceWorker.controller,fontsStatus:document.fonts.status,observedMs:performance.now()}))()`);
    assert.deepEqual(snapshot.probe.writes,[]);
    await writeFile(path.join(output,state+'.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'),{mode:0o600});
    if(route==='/'){
      await value('document.querySelector("#search button[aria-label=直接入力]").scrollIntoView({block:"center"})');
      const bounds=await value('(()=>{const r=document.querySelector("#search button[aria-label=直接入力]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,start:performance.now()};})()');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x,y:bounds.y,button:'left',clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x,y:bounds.y,button:'left',clickCount:1});
      snapshot.dialogClick=await value(`new Promise(resolve=>{const check=()=>{if(document.querySelector('[role=dialog] input'))requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({afterMs:performance.now()-${bounds.start},appeared:true})));else requestAnimationFrame(check);};check();})`);
    }
    const sample={state,catalogMetadata:catalogMetadata.get(state),...snapshot,requests:[...requests.values()].filter(r=>r.label===state)};
    assert.ok(sample.requests.every(r=>['GET','HEAD','OPTIONS'].includes(r.method)), 'Unexpected network mutation');
    report.runs.push(sample);
    await writeFile(path.join(output,'report.json'),JSON.stringify({...report,errors},null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({profile,route,state,readyMs:snapshot.probe.marks.readyPaint,lcpMs:snapshot.probe.lcp.at(-1)?.at,clsShifts:snapshot.probe.shifts.length,requests:sample.requests.length,entry:snapshot.entry,output}));
    // Leave the document before reloading, avoiding stale DOM/paint observations.
    await cdp.send('Page.navigate',{url:'about:blank'});await pause(500);
  }
  assert.deepEqual(errors,[], 'Runtime errors invalidate this audit run; inspect report.json');
} finally {
  cdp?.close();if(chrome.exitCode===null){const ended=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await Promise.race([ended,pause(3000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await ended;}}
  await rm(chromeProfile,{recursive:true,force:true});
}

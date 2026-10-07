import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import { continuePausedRequest, recordCanceledNetworkRequest } from './browser-request-interception.mjs';
import { createLocalBrowserEgressProxy } from './local-browser-egress-proxy.mjs';

export async function runBrowser({temp,origin,users,http,execute,sql,importedImages}){
 const {cdpConnection}=await import(path.join(temp,'cdp-helper.mjs'));
 const chromePath=[process.env.FANMARK_STAGING_CHROME,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
 assert.ok(chromePath,'Chrome is required; set FANMARK_STAGING_CHROME if needed');
 const chromeProfile=path.join(temp,'chrome-profile');await mkdir(chromeProfile,{mode:0o700});
 const proxyBlocked=[];const egressProxy=await createLocalBrowserEgressProxy(origin,receipt=>proxyBlocked.push({origin:'https://'+receipt.hostname+(receipt.port?':'+receipt.port:''),path:'[proxy]'}));
 const chrome=spawn(chromePath,[...egressProxy.chromeArguments,'--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-default-apps','--no-first-run','--no-default-browser-check','--ignore-certificate-errors',`--user-data-dir=${chromeProfile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let cdp;const errors=[],blocked=[],requests=[],canceledRequests=new Set();
 let canceledInterceptions=0,cancellationFixture;
 const cancellationPath='/__local_browser_cancellation_fixture';
 async function value(expression){const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!result.exceptionDetails,'local_browser_eval_failed');return result.result?.value;}
 async function wait(expression,predicate,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){const result=await value(expression);if(predicate(result))return result;await delay(100);}throw Error('local_browser_wait_timeout:'+expression);}
 const owner=users[0],other=users[1];
 const editor=`/fanmarks/${owner.fanmarkId}/profile/edit`,profilePath=`/api/me/fanmarks/${owner.fanmarkId}/profile`;
 const textName=' Local editor exact spaces ';
 const textBio='Local real Worker save after draft recovery';
 const draftKey='emoji_profile_draft_'+owner.fanmarkId;
 let failNextPatch=false,failedPatches=0;
 try{
  let port;for(let i=0;i<150;i++){assert.equal(chrome.exitCode,null,'local_chrome_exited');try{port=(await readFile(path.join(chromeProfile,'DevToolsActivePort'),'utf8')).split('\n')[0];if(port)break;}catch{}await delay(100);}assert.ok(port);
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();cdp=cdpConnection(targets.find(target=>target.type==='page').webSocketDebuggerUrl);await cdp.opened;
  await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Runtime.enable');
  cdp.on('Network.loadingFailed',event=>recordCanceledNetworkRequest(canceledRequests,event));
  cdp.on('Network.requestWillBeSent',event=>{const url=new URL(event.request.url);if(url.origin===origin)requests.push({path:url.pathname,method:event.request.method});});
  cdp.on('Fetch.requestPaused',event=>{void(async()=>{
   const url=new URL(event.request.url);
   if(url.origin!==origin){blocked.push({origin:url.origin,path:url.pathname});await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
   if(url.pathname===cancellationPath){cancellationFixture=event;return;}

   if(failNextPatch&&url.pathname===profilePath&&event.request.method==='PATCH'){failNextPatch=false;failedPatches++;await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'ConnectionFailed'});return;}
   if((await continuePausedRequest(cdp,event,canceledRequests)).canceled)canceledInterceptions++;
  })().catch(error=>errors.push(error.message));});
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:origin+cancellationPath}]});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp.send('Page.navigate',{url:origin+editor});
  await wait('location.pathname',pathname=>pathname==='/auth');
  assert.equal(await value('history.state?.usr?.from'),editor);
  assert.equal(requests.some(req=>req.path===profilePath),false,'anonymous_owner_read');
  await wait("!!document.querySelector('#auth-email')",Boolean);
  // Reproduce the exact Chrome protocol response deterministically. This GET
  // stays paused and is aborted in the browser; no API response is substituted.
  await value(`(()=>{window.__cancelFixture=new AbortController();void fetch(${JSON.stringify(cancellationPath)},{signal:window.__cancelFixture.signal}).catch(()=>null);})()`);
  for(let i=0;i<100&&!cancellationFixture;i++)await delay(10);
  assert.ok(cancellationFixture?.networkId,'cancellation_fixture_not_paused');
  await value('window.__cancelFixture.abort()');
  for(let i=0;i<100&&!canceledRequests.has(cancellationFixture.networkId);i++)await delay(10);
  assert.ok(canceledRequests.has(cancellationFixture.networkId),'missing_chrome_cancellation_receipt');
  assert.equal((await continuePausedRequest(cdp,cancellationFixture,canceledRequests)).canceled,true);
  canceledInterceptions++;
  await cdp.send('Fetch.disable');
  for(const [selector,text] of [['#auth-email',owner.email],['#auth-password',owner.password]]){await value(`document.querySelector(${JSON.stringify(selector)}).focus()`);await cdp.send('Input.insertText',{text});}
  await value("document.querySelector('#auth-email').closest('form').querySelector('button[type=\"submit\"]').click()");
  await wait("document.querySelector('input[name=\"display_name\"]')?.value",result=>result===owner.name);
  assert.equal(await value('location.pathname'),editor);
  const decodedImages="Array.from(document.querySelectorAll('img')).filter(image=>image.src.includes('/api/storage/public/')).map(image=>({src:image.src,complete:image.complete,width:image.naturalWidth}))";
  await wait(decodedImages,images=>images.length===2&&images.every(image=>image.complete&&image.width===1));
  const editorScreenshot=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(temp,'imported-images-editor.png'),Buffer.from(editorScreenshot.data,'base64'),{mode:0o600});
  const width=await value('({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');
  assert.equal(width.client,390);assert.equal(width.width,390,'mobile layout viewport expanded');assert.ok(width.scroll<=390);
  const snapshot=async()=>{const result=await execute('FANMARK_DB',`SELECT id,display_name,bio,is_public,theme_settings FROM fanmark_profiles WHERE license_id=${sql(owner.licenseId)};`);return result.flatMap(part=>part.results);};
  const before=await snapshot();
  for(const [selector,text] of [['input[name="display_name"]',textName],['textarea[name="bio"]',textBio]]){await value(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});field.focus();field.select();})()`);await cdp.send('Input.insertText',{text});}
  await wait(`sessionStorage.getItem(${JSON.stringify(draftKey)})`,result=>result&&JSON.parse(result).form.bio===textBio);
  const save="Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='保存する')";
  failNextPatch=true;await cdp.send('Fetch.enable',{patterns:[{urlPattern:origin+profilePath}]});await value(`${save}.click()`);
  try{
   await wait("document.body.innerText.includes('更新に失敗しました')",Boolean);
  }catch(error){
   // A timeout alone cannot distinguish a missing PATCH from a rendered error.
   // Keep only fixture state and request methods; never record form values or cookies.
   const state=await value(`({editorPresent:!!document.querySelector('input[name="display_name"]'),saveEnabled:!!(${save})&&!(${save}).disabled,formValid:document.querySelector('form')?.checkValidity()??null,settingsPage:location.pathname.endsWith('/settings'),failureTextPresent:document.body.textContent.includes('更新に失敗しました'),visibleFailureTextPresent:document.body.innerText.includes('更新に失敗しました'),alertCount:document.querySelectorAll('[role="alert"]').length})`);
   const receipt={stage:'failed-save',failedPatches,failNextPatch,interceptionErrors:errors.length,profileRequests:requests.filter(req=>req.path===profilePath).map(req=>req.method),state};
   await writeFile(path.join(temp,'failed-save-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
   throw new Error('local_editor_failed_save_timeout:'+JSON.stringify(receipt),{cause:error});
  }
  await cdp.send('Fetch.disable');
  assert.equal(failedPatches,1);assert.deepEqual(await snapshot(),before);
  assert.equal(await value('location.pathname'),editor);
  assert.equal(JSON.parse(await value(`sessionStorage.getItem(${JSON.stringify(draftKey)})`)).form.bio,textBio);
  await value('window.__localEditorBeforeReload=true');await cdp.send('Page.reload');
  await wait('window.__localEditorBeforeReload===undefined',Boolean);
  await wait("document.querySelector('textarea[name=\"bio\"]')?.value",result=>result===textBio);
  assert.equal(await value("document.querySelector('input[name=\"display_name\"]').value"),textName);
  await value(`${save}.click()`);await wait('location.pathname',pathname=>pathname===`/fanmarks/${owner.fanmarkId}/settings`);
  assert.equal(await value(`sessionStorage.getItem(${JSON.stringify(draftKey)})`),null);
  const saved=await snapshot();assert.equal(saved.length,1);assert.equal(saved[0].display_name,textName);assert.equal(saved[0].bio,textBio);
  const storedTheme=JSON.parse(saved[0].theme_settings);
  for(const [field,url] of Object.entries(importedImages))assert.equal(storedTheme[field],url,'unchanged source image reference was rewritten');
  await cdp.send('Page.navigate',{url:origin+editor});
  await wait("document.querySelector('input[name=\"display_name\"]')?.value",result=>result===textName);
  assert.equal(await value("document.querySelector('textarea[name=\"bio\"]').value"),textBio);
  const patch=async body=>value(`(async()=>{const response=await fetch(${JSON.stringify(profilePath)},{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}});return {status:response.status,body:await response.json()};})()`);
  assert.equal((await patch({is_public:false})).status,200);
  const privateProfile=await http(`/api/fanmarks/public-profile/${owner.licenseId}`);
  assert.equal(privateProfile.status,404);
  assert.equal((await patch({is_public:true})).status,200);
  const publicProfile=await http(`/api/fanmarks/public-profile/${owner.licenseId}`);
  assert.equal(publicProfile.status,200);assert.equal(JSON.parse(publicProfile.body).displayName,textName);
  await cdp.send('Page.navigate',{url:origin+'/a/'+owner.shortId});
  await wait(decodedImages,images=>images.length===2&&images.every(image=>image.complete&&image.width===1));
  const publicScreenshot=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(temp,'imported-images-public.png'),Buffer.from(publicScreenshot.data,'base64'),{mode:0o600});
  assert.equal([...blocked,...proxyBlocked].some(entry=>entry.origin==='https://synthetic-source.example.invalid'),false,'browser attempted source Storage access');
  for(const [field,url] of Object.entries(importedImages)){
   const logical=new URL(url).pathname.split('/storage/v1/object/public/')[1];
   const result=await value(`(async()=>{const response=await fetch(${JSON.stringify('/api/storage/object/'+logical)},{method:'DELETE',credentials:'include'});return response.status;})()`);
   assert.equal(result,204,'owner legacy object delete failed');
  }
  assert.equal((await patch({theme_settings:{cover_image_url:'',profile_image_url:''}})).status,200);
  await cdp.send('Page.navigate',{url:origin+`/fanmarks/${other.fanmarkId}/profile/edit`});
  await wait("!!document.querySelector('[role=\"alert\"]')",Boolean);
  assert.equal(await value("!!document.querySelector('input[name=\"display_name\"]')"),false);
  const rowsBeforeBan=await snapshot();
  await execute('AUTH_DB',`UPDATE user SET banned=1,banExpires=NULL WHERE id=${sql(owner.id)};DELETE FROM session WHERE userId=${sql(owner.id)};`);
  await cdp.send('Page.navigate',{url:origin+editor});
  await wait('location.pathname',pathname=>pathname==='/auth');
  assert.equal(await value("!!document.querySelector('input[name=\"display_name\"]')"),false);
  assert.deepEqual(await snapshot(),rowsBeforeBan);
  const violations=await execute('FANMARK_DB','PRAGMA foreign_key_check;');assert.deepEqual(violations.flatMap(part=>part.results),[]);
  assert.deepEqual(errors,[]);assert.ok(egressProxy.stats.allowedConnections>0,'local_requests_bypassed_proxy');
  assert.ok(requests.some(req=>req.path==='/api/auth/sign-in/email'&&req.method==='POST'));
  assert.ok(requests.some(req=>req.path===profilePath&&req.method==='PATCH'));
  return {actualApiResponses:true,fulfilledApiResponses:0,canceledInterceptionFixture:true,canceledInterceptions,importedImagesDecodedInEditor:true,importedImagesDecodedInPublicPage:true,unchangedSourceImageReferencesPreserved:true,legacyOwnerDelete:true,externalRequestsBlocked:blocked.length+proxyBlocked.length,localProxyConnections:egressProxy.stats.allowedConnections,anonymousReturn:true,actualFormSignin:true,viewport390Overflow:false,failedSaveRequests:failedPatches,failedSavePreservesRows:true,reloadRestoresDraft:true,retryPersistsInD1:true,successfulSaveClearsDraft:true,coldReopen:true,publicPrivateToggling:true,crossOwnerEditorRefused:true,suspensionRedirect:true,foreignKeyViolations:0,realPhone:false};
 }finally{
  cdp?.close();if(chrome.exitCode===null){chrome.kill('SIGTERM');for(let i=0;i<20&&chrome.exitCode===null;i++)await delay(100);if(chrome.exitCode===null){chrome.kill('SIGKILL');for(let i=0;i<20&&chrome.exitCode===null;i++)await delay(100);}}
  await egressProxy.close();
  await rm(chromeProfile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}

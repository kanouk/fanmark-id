import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Delay/fail only catalog and anonymous session reads. All successful responses
// still come from the actual synthetic local Worker/D1, not a replacement catalog.
function probeScript(mode, holdAuth) {
  return `(() => {
    const probe = window.__catalogProbe = { mode: ${JSON.stringify(mode)}, holdAuth: ${holdAuth}, requested: 0, completed: 0, maintenanceCompleted: false };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (url.pathname === '/api/auth/get-session' && probe.holdAuth) {
        probe.holdAuth = false;
        await new Promise(resolve => { window.__releaseAuth = resolve; });
      }
      if (url.pathname === '/api/emoji/catalog') {
        probe.requested++;
        if (probe.mode === 'hold') {
          probe.mode = 'pass';
          await new Promise(resolve => { window.__releaseCatalog = resolve; });
        }
        if (probe.mode === 'fail') return new Response('{}', {status: 503, headers: {'content-type': 'application/json'}});
      }
      const response = await originalFetch(input, init);
      if (url.pathname === '/api/system/maintenance') probe.maintenanceCompleted = true;
      if (url.pathname === '/api/emoji/catalog') probe.completed++;
      return response;
    };
  })();`;
}

export async function verifyCatalogStartup({ cdp, value, wait, navigate, fill, clickText, artifactDirectory, owner }) {
  const report = {};
  let injected;
  try {
    injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeScript('hold', true) });
    await navigate('/');
    await wait('!!window.__releaseAuth && !!window.__releaseCatalog && window.__catalogProbe.maintenanceCompleted');
    assert.equal(await value('!!document.querySelector("[data-app-startup]")'), true);
    assert.equal(await value('!!document.querySelector("#search")'), false, 'Unverified session must not mount route content');
    report.maintenanceReadOverlapsSessionRead = true;
    await value('window.__releaseAuth()');
    await wait('!!document.querySelector("button[aria-label=直接入力]")');
    assert.equal(await value('window.__catalogProbe.completed'), 0, 'Home must be usable before any catalog response');
    assert.equal(await value('!!document.querySelector("[data-emoji-catalog-notice]")'), false);
    report.homeReadyBeforeCatalog = true;
    report.homeReadyMilliseconds = await value('performance.now()');
    await writeFile(path.join(artifactDirectory, 'home-before-catalog.png'),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
    await value('document.querySelector("#search button[aria-haspopup=dialog]").click()');
    await wait('!!document.querySelector("[data-radix-popper-content-wrapper]")');
    assert.equal(await value('window.__catalogProbe.completed'), 0);
    assert.equal(await value('!!document.querySelector("[data-emoji-catalog-notice]")'), false);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait('!document.querySelector("[data-radix-popper-content-wrapper]")');
    report.pickerOpensBeforeCatalog = true;
    await value('document.querySelector("button[aria-label=直接入力]").click()');
    await wait('!!document.querySelector("[role=dialog] input")');
    await fill('[role=dialog] input', '😀🧪🚀🌙🍀');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('!!document.querySelector("[data-emoji-catalog-notice]")');
    assert.equal(await value('document.querySelector("[role=dialog] input").value'), '😀🧪🚀🌙🍀');
    assert.equal(await value('getComputedStyle(document.querySelector("[data-emoji-catalog-notice]")).display'), 'none', 'Modal must show one inline waiting message, not a duplicate toast');
    await writeFile(path.join(artifactDirectory, 'catalog-input-waiting.png'),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
    await clickText('閉じる', 'document.querySelector("[role=dialog]")');
    await wait('!document.querySelector("[role=dialog]")');
    await value('window.__releaseCatalog()');
    await wait('!document.querySelector("[data-emoji-catalog-notice]")');
    assert.equal(await value('document.querySelector("#search").innerText.includes("😀")'), false, 'Cancelling while waiting must discard the pending submit');
    report.cancelledInputNotReplayed = true;
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeScript('fail', false) });
    await navigate('/');
    await wait('!!document.querySelector("button[aria-label=直接入力]")');
    assert.equal(await value('!!document.querySelector("[data-emoji-catalog-notice]")'), false, 'Background failure must not replace the home page');
    await value('document.querySelector("button[aria-label=直接入力]").click()');
    await wait('!!document.querySelector("[role=dialog] input")');
    await fill('[role=dialog] input', '😀🧪🚀🌙🍀');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('!!document.querySelector("[role=dialog] [role=alert]")');
    assert.equal(await value('document.querySelector("[role=dialog] input").value'), '😀🧪🚀🌙🍀');
    await value('window.__catalogProbe.mode="pass"');
    await clickText('もう一度試す', 'document.querySelector("[role=dialog]")');
    await wait('!document.querySelector("[data-emoji-catalog-notice]")');
    assert.equal(await value('document.querySelector("[role=dialog] input").value'), '😀🧪🚀🌙🍀');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('!document.querySelector("[role=dialog]")');
    await wait('document.querySelector("#search").innerText.includes("😀")');
    report.failedCatalogRetryPreservesInput = true;
    const emojiPath = '/' + encodeURIComponent(owner.displayFanmark);
    await navigate(emojiPath);
    await wait('!!document.querySelector("[role=alert]")');
    assert.equal(await value('decodeURIComponent(location.pathname)'), '/' + owner.displayFanmark,
      'A missing catalog must not redirect a valid emoji URL as not found');
    await value('window.__catalogProbe.mode="pass"');
    await clickText('もう一度試す');
    await wait('document.body.innerText.includes(' + JSON.stringify(owner.displayFanmark) + ') && !document.querySelector("[role=alert]")');
    report.emojiUrlWaitsWithoutFalseNotFound = true;
    return report;
  } finally {
    if (injected) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  }
}

export async function verifyDeferredRoutes({ cdp, value, wait, navigate, expectModuleFailure }) {
  const refused = [];
  const failures = [];
  const unsubscribe = cdp.on('Fetch.requestPaused', event => {
    refused.push(event.request.url);
    void cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }).catch(error => failures.push(error.message));
  });
  try {
    expectModuleFailure(true);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/src/components/AdminApp.tsx*', requestStage: 'Request' }] });
    await navigate('/admin');
    await wait('!!document.querySelector("[role=alert]") && document.body.innerText.includes("画面を読み込めませんでした")');
    assert.ok(refused.length > 0, 'The deferred admin module must actually be requested and refused');
    assert.equal(await value('Array.from(document.querySelectorAll("button")).some(button=>button.textContent==="再読み込み")'), true);
    await cdp.send('Fetch.disable');
    await navigate('/admin');
    await wait('!!document.querySelector("#cloudflare-admin-email")');
    assert.equal(await value('document.body.innerText.includes("ユーザー管理")'), false, 'Anonymous retry must show admin login, never admin data');
    expectModuleFailure(false);
    expectModuleFailure(true);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/src/pages/Profile.tsx*', requestStage: 'Request' }] });
    const beforeProfileFailure = refused.length;
    await navigate('/profile');
    await wait('!!document.querySelector("[role=alert]") && document.body.innerText.includes("画面を読み込めませんでした")');
    assert.ok(refused.length > beforeProfileFailure, 'The newly deferred owner module must be requested and refused');
    await cdp.send('Fetch.disable');
    expectModuleFailure(false);
    await navigate('/profile');
    await wait('location.pathname==="/auth" && !!document.querySelector("#auth-email")');

    let dashboardCodeLoaded = false;
    const stopResponses = cdp.on('Network.responseReceived', event => {
      if (new URL(event.response.url).pathname.endsWith('/src/pages/Dashboard.tsx')) dashboardCodeLoaded = true;
    });
    const heldSession = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__routePrivateReads=0;
      const original=fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
        if(url.pathname==='/api/auth/get-session')await new Promise(resolve=>window.__routeReleaseAuth=resolve);
        if(url.pathname.startsWith('/api/me/'))window.__routePrivateReads++;
        return original(input,init);
      };
    })();` });
    try {
      await navigate('/dashboard');
      for (let attempt = 0; attempt < 200 && !dashboardCodeLoaded; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(dashboardCodeLoaded, true, 'Direct-route code should load alongside readiness, not wait for another round trip');
      await wait('!!window.__routeReleaseAuth && !!document.querySelector("[data-app-startup]")');
      assert.equal(await value('window.__routePrivateReads'), 0, 'Preloading must not mount owner effects before session verification');
      await value('window.__routeReleaseAuth()');
      await wait('location.pathname==="/auth" && !!document.querySelector("#auth-email")');
    } finally {
      stopResponses();
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: heldSession.identifier });
    }

    for (const pathname of ['/analytics', '/plans', '/favorites', '/notifications']) {
      await navigate(pathname);
      await wait('location.pathname==="/auth" && !!document.querySelector("#auth-email")');
    }
    assert.deepEqual(failures, []);
    return { deferredModuleFailureOffersReload: true, ownerModuleFailureOffersReload: true,
      directRouteCodeOverlapsReadiness: true, preloadingDoesNotReadPrivateData: true,
      adminRetryKeepsMfaGate: true, protectedDeferredRoutesRequireLogin: true };
  } finally {
    expectModuleFailure(false);
    unsubscribe();
    await cdp.send('Fetch.disable');
  }
}

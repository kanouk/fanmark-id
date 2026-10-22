import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cdpConnection } from './browser-cdp.mjs';
import { navigateDocument } from './browser-navigation.mjs';
import { verifyCatalogStartup, verifyDeferredRoutes } from './catalog-startup-browser.mjs';
import { createLocalBrowserEgressProxy } from '../migration/local-browser-egress-proxy.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function verifyLocalBrowser(stack) {
  const chromePath = [process.env.FANMARK_STAGING_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
  assert.ok(chromePath, 'Set FANMARK_STAGING_CHROME to an installed Chrome/Chromium executable');
  const profile = path.join(stack.directory, 'chrome-profile');
  await mkdir(profile, { mode: 0o700 });
  const blocked = [];
  const proxy = await createLocalBrowserEgressProxy(stack.origin, event => blocked.push({ hostname: event.hostname }));
  const chrome = spawn(chromePath, [...proxy.chromeArguments,
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--no-first-run', '--no-default-browser-check',
    '--ignore-certificate-errors', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp, startupError = '';
  chrome.stderr.on('data', bytes => startupError = (startupError + bytes.toString()).slice(-1500));
  const artifactDirectory = process.env.FANMARK_TEST_ARTIFACT_DIR ||
    await mkdtemp(path.join(tmpdir(), 'fanmark-local-browser-'));
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const exceptions = [], requests = [];
  let expectedModuleFailure = false;
  let hmrConnections = 0;
  try {
    let debugPort;
    for (let index = 0; index < 300; index++) {
      assert.equal(chrome.exitCode, null, 'Chrome exited before startup: ' + startupError);
      try { debugPort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { /* Startup. */ }
      if (debugPort) break;
      await delay(100);
    }
    assert.ok(debugPort, 'Chrome debugging port unavailable');
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
    cdp = cdpConnection(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketHandshakeResponseReceived', event => {
      if (event.response.status === 101) hmrConnections++;
    });
    cdp.on('Runtime.exceptionThrown', event => {
      const description = event.exceptionDetails?.exception?.description ?? '';
      if (expectedModuleFailure && /Failed to fetch dynamically imported module.*\/src\/(?:components\/AdminApp|pages\/Profile)\.tsx/u.test(description)) return;
      exceptions.push(event.exceptionDetails?.text || 'uncaught exception');
    });
    cdp.on('Network.requestWillBeSent', event => {
      const url = new URL(event.request.url);
      if (url.origin === stack.origin && url.pathname.startsWith('/api/')) {
        requests.push({ method: event.request.method, path: url.pathname });
      }
    });
    async function value(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails, 'Browser evaluation failed: ' + expression);
      return result.result?.value;
    }
    async function wait(expression, predicate = Boolean) {
      const deadline = Date.now() + 40_000;
      let last;
      while (Date.now() < deadline) {
        last = await value(expression);
        if (predicate(last)) return last;
        await delay(100);
      }
      throw new Error('Browser wait failed: ' + expression + ' value=' + JSON.stringify(last));
    }
    async function navigate(pathname) {
      await navigateDocument(cdp, stack.origin + pathname);
    }
    async function fill(selector, text) {
      await value('document.querySelector(' + JSON.stringify(selector) + ').focus()');
      await cdp.send('Input.insertText', { text });
    }
    async function clickText(text, within = 'document') {
      await value('Array.from(' + within + '.querySelectorAll("button")).find(button => button.textContent.trim()===' +
        JSON.stringify(text) + '&&!button.disabled).click()');
    }
    const catalogStartup = await verifyCatalogStartup({ cdp, value, wait, navigate, fill, clickText, artifactDirectory, owner: stack.fixtures.users[0] });
    const deferredRoutes = await verifyDeferredRoutes({ cdp, value, wait, navigate, expectModuleFailure: value => { expectedModuleFailure = value; } });
    console.log('[local browser] background catalog, retained input, retries and parallel readiness verified');
    const mobileLayouts = [];
    async function assertViewport(width, label) {
      const dimensions = await value('({width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');
      assert.equal(dimensions.width, width, label + ': layout viewport must not expand');
      assert.equal(dimensions.client, width, label + ': CSS viewport must match configured width');
      assert.ok(dimensions.scroll <= width, label + ': page must not scroll sideways: ' + JSON.stringify(dimensions));
      mobileLayouts.push({ label, ...dimensions });
    }
    // Anonymous root was wider than the configured viewport even with no input.
    await navigate('/');
    await wait('!!document.querySelector("button[aria-label=直接入力]")');
    for (const language of ['ja', 'en', 'ko', 'id']) {
      for (const width of [320, 375, 390, 430]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
        await value('localStorage.setItem("fanmark-language",' + JSON.stringify(language) + ')');
        await navigate('/');
        await wait('document.documentElement.lang===' + JSON.stringify(language) + ' && !!document.querySelector("#search button")');
        await assertViewport(width, 'anonymous root ' + language);
        const hiddenActions = await value('Array.from(document.querySelectorAll("#search button")).filter(button=>{const r=button.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>'+width+');}).map(button=>button.getAttribute("aria-label")||button.textContent.trim())');
        assert.deepEqual(hiddenActions, [], 'Search controls must remain inside the viewport: ' + language + '/' + width);
      }
    }
    await value('localStorage.setItem("fanmark-language","ja")');
    await navigate('/');
    await wait('!!document.querySelector("button[aria-label=直接入力]")');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    await value('document.querySelector("button[aria-label=直接入力]").click()');
    await wait('!!document.querySelector("[role=dialog] input")');
    await assertViewport(320, 'direct input dialog');
    await fill('[role=dialog] input', '😀🧪🚀🌙🍀');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('!document.querySelector("[role=dialog]")');
    await assertViewport(320, 'five emoji input');
    await value('document.querySelector("#search").scrollIntoView({block:"start"})');
    await writeFile(path.join(artifactDirectory, 'search-mobile-320.png'),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
    await value('document.querySelector("#search button[aria-haspopup=dialog]").click()');
    await wait('!!document.querySelector("[data-radix-popper-content-wrapper]")');
    await assertViewport(320, 'emoji picker');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    console.log('[local browser] mobile root, five emoji and dialogs fit 320–430px in four languages');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('/auth');
    await wait('!!document.querySelector("#auth-email")');
    const owner = stack.fixtures.users[0];
    await fill('#auth-email', owner.email);
    await fill('#auth-password', owner.password);
    await value('document.querySelector("#auth-email").closest("form").querySelector("button[type=submit]").click()');
    await wait('!document.querySelector("#auth-email") && location.pathname!=="/auth"');
    await navigate('/dashboard');
    await wait('document.body.innerText.includes(' + JSON.stringify(owner.displayFanmark) + ')');
    await writeFile(path.join(artifactDirectory, 'dashboard-desktop.png'),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate('/');
    await wait('!!document.querySelector("button[aria-label=直接入力]")');
    await value('document.querySelector("button[aria-label=直接入力]").click()');
    await wait('!!document.querySelector("[role=dialog] input")');
    await fill('[role=dialog] input', '😀🧪🚀🌙');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('Array.from(document.querySelectorAll("button")).some(button=>button.textContent.trim()==="取得する"&&!button.disabled)');
    await assertViewport(390, 'signed-in search result');
    await clickText('取得する');
    await wait('!!document.querySelector("[role=alertdialog]")');
    await clickText('取得する', 'document.querySelector("[role=alertdialog]")');
    await wait('location.pathname.includes("/settings")');
    await wait('document.body.innerText.includes("😀🧪🚀🌙")');
    const acquired = await (await stack.runtime.getD1Database('FANMARK_DB'))
      .prepare('SELECT id FROM fanmarks WHERE user_input_fanmark=?').bind('😀🧪🚀🌙').first();
    assert.ok(acquired?.id, 'Browser acquisition must persist in local D1');
    console.log('[local browser] search and acquisition persisted');
    await navigate('/fanmarks/' + owner.fanmarkId + '/profile/edit');
    await wait('!!document.querySelector("input[name=display_name]")');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await writeFile(path.join(artifactDirectory, 'profile-mobile.png'),
      Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
    const width = await value('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
    assert.equal(width.width, 390);
    assert.ok(width.scroll <= 390, 'Profile editor must fit the mobile viewport');
    await value('document.querySelector("input[name=display_name]").select()');
    await cdp.send('Input.insertText', { text: 'Local browser saved profile' });
    await value('window.__routeDraftField=document.querySelector("input[name=display_name]");true');
    for (const [language, label] of [['en', 'English'], ['ko', '한국어'], ['id', 'Bahasa Indonesia'], ['ja', '日本語']]) {
      await value('document.querySelector("button:has(svg.lucide-globe)").click()');
      await wait('!!document.querySelector("[role=menuitem]")');
      await value('Array.from(document.querySelectorAll("[role=menuitem]")).find(item=>item.textContent.trim()===' + JSON.stringify(label) + ').click()');
      await wait('document.documentElement.lang===' + JSON.stringify(language));
      assert.equal(await value('document.querySelector("input[name=display_name]")===window.__routeDraftField'), true,
        'Language switching must not remount the deferred editor');
      assert.equal(await value('window.__routeDraftField.value'), 'Local browser saved profile');
      assert.equal(await value('!!document.querySelector("[data-app-startup]")'), false);
    }
    await clickText('保存する');
    await wait('document.body.innerText.includes("更新しました") || document.body.innerText.includes("保存しました") || location.pathname.endsWith("/settings")');
    const saved = await (await stack.runtime.getD1Database('FANMARK_DB'))
      .prepare('SELECT display_name FROM fanmark_profiles WHERE license_id=?').bind(owner.licenseId).first();
    assert.equal(saved.display_name, 'Local browser saved profile');
    await navigate('/a/' + owner.shortId);
    await wait('document.body.innerText.includes("Local browser saved profile")');
    // Stay within this app instance across logout/login to exercise private cache isolation.
    const profileReadStart = requests.filter(r => r.method === 'GET' && r.path === '/api/me/profile').length;
    await navigate('/profile');
    await wait('!!document.querySelector("#display_name")');
    assert.equal(requests.filter(r => r.method === 'GET' && r.path === '/api/me/profile').length - profileReadStart, 1,
      'Auth gate and multiple profile consumers must share the verified profile');
    await value('document.querySelector("#display_name").select()');
    await cdp.send('Input.insertText', { text: 'Local account saved' });
    await value('document.querySelector("#display_name").closest("form").querySelector("button[type=submit]").click()');
    await wait('document.body.innerText.includes("ユーザー設定が正常に更新されました")');
    const savedAccount = await (await stack.runtime.getD1Database('FANMARK_DB'))
      .prepare('SELECT display_name FROM user_settings WHERE user_id=?').bind(owner.id).first();
    assert.equal(savedAccount.display_name, 'Local account saved');
    await clickText('サインアウト');
    await wait('location.pathname==="/" && Array.from(document.querySelectorAll("a")).some(a=>a.getAttribute("href")==="/auth")');
    await value('Array.from(document.querySelectorAll("a")).find(a=>a.getAttribute("href")==="/auth").click()');
    await wait('!!document.querySelector("#auth-email")');
    const other = stack.fixtures.users[1];
    await fill('#auth-email', other.email);
    await fill('#auth-password', other.password);
    await value('document.querySelector("#auth-email").closest("form").querySelector("button[type=submit]").click()');
    await wait('location.pathname==="/dashboard" && document.body.innerText.includes('+JSON.stringify(other.displayFanmark)+')');
    assert.equal(await value('document.body.innerText.includes('+JSON.stringify(owner.displayFanmark)+')'), false,
      'The previous owner must never remain in a new owner dashboard');
    console.log('[local browser] shared profile save and same-app owner switch verified');
    assert.deepEqual(exceptions, []);
    assert.ok(hmrConnections > 0, 'Vite hot reload must connect over local HTTPS');
    assert.deepEqual(stack.deniedOutbound, []);
    assert.ok(requests.some(request => request.path === '/api/fanmarks/register' && request.method === 'POST'));
    const report = { catalogStartup, deferredRoutes, mobileLayouts, state: 'verified', actualBrowser: true, actualWorker: true, mobileWidth: 390,
      searchAcquisitionPersisted: true, profileSavePersisted: true, publicProfileVerified: true, accountSavePersisted: true, ownerSwitchIsolated: true,
      languageSwitchRetainsEditorAndDraft: true,
      externalApplicationRequests: stack.deniedOutbound.length, browserProxyRefusals: blocked.length, requests };
    await writeFile(path.join(artifactDirectory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log('[local browser] verified; artifacts: ' + artifactDirectory);
    return report;
  } catch (error) {
    if (cdp) {
      try {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(artifactDirectory, 'failure.png'), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
      } catch { /* Preserve primary failure. */ }
    }
    console.error('[local browser] failed; artifacts: ' + artifactDirectory);
    throw error;
  } finally {
    cdp?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill('SIGTERM');
      for (let index = 0; index < 30 && chrome.exitCode === null && chrome.signalCode === null; index++) await delay(100);
      if (chrome.exitCode === null && chrome.signalCode === null) {
        chrome.kill('SIGKILL');
        await new Promise(resolve => chrome.once('exit', resolve));
      }
    }
    await proxy.close();
  }
}

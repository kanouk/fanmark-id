// Real generated SW, isolated loopback HTTPS, no live API or credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdtemp, rm, chmod, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cdpConnection } from './browser-cdp.mjs';
import { createLocalBrowserEgressProxy } from '../migration/local-browser-egress-proxy.mjs';

assert.equal(process.argv.length, 2, 'Run after the ordinary production build; no remote overrides');
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'fanmark-pwa-cache-'));
const assets = new Map();
async function collect(relative = '') {
  for (const item of await readdir(path.join(root, 'dist-cloudflare-production', relative), { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink());
    const name = path.posix.join(relative, item.name);
    if (item.isDirectory()) await collect(name);
    else assets.set('/' + name, await readFile(path.join(root, 'dist-cloudflare-production', name)));
  }
}
await collect();
const currentWorker = assets.get('/sw.js').toString();
assert.ok(!currentWorker.includes('"og-image.png"'));
const ogRevision = createHash('md5').update(assets.get('/og-image.png')).digest('hex');
// Recreate the previous policy with the same shell/chunks and namespace. The
// public release also checks the actual pre-deploy installed PWA independently.
const legacyWorker = currentWorker.replace('workbox.precacheAndRoute([',
  'workbox.precacheAndRoute([' + JSON.stringify({ url: 'og-image.png', revision: ogRevision }) + ',');
assert.notEqual(legacyWorker, currentWorker);
const staticPaths = [...assets.keys()].filter(name => /\.(?:js|css)$/.test(name) && name.startsWith('/assets/'));
staticPaths.push('/index.html', '/manifest.webmanifest', '/pwa-192x192.png', '/pwa-512x512.png');
const mime = name => name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' :
  name.endsWith('.html') ? 'text/html' : name.endsWith('.png') ? 'image/png' :
    name.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
let stage = 'legacy', offline = false;
const requests = [];
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', directory + '/tls.key',
  '-out', directory + '/tls.crt', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
await chmod(directory + '/tls.key', 0o600);
const server = createServer({ key: await readFile(directory + '/tls.key'), cert: await readFile(directory + '/tls.crt') }, (req, res) => {
  const name = new URL(req.url, 'https://127.0.0.1').pathname;
  requests.push({ stage, name, offline, method: req.method });
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (offline) { res.writeHead(503); res.end('offline'); return; }
  if (name === '/__pwa-harness') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><input id="draft" value="unsaved">'); return; }
  if (name.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
  const body = name === '/sw.js' ? Buffer.from(stage === 'legacy' ? legacyWorker : currentWorker) : assets.get(name);
  if (!body) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', mime(name)); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'https://127.0.0.1:' + server.address().port;
const proxy = await createLocalBrowserEgressProxy(origin);
const chromePath = [process.env.FANMARK_STAGING_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
assert.ok(chromePath, 'Chrome/Chromium required');
const chrome = spawn(chromePath, [...proxy.chromeArguments, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-first-run',
  '--ignore-certificate-errors', '--user-data-dir=' + directory + '/chrome', '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let cdp;
try {
  let port;
  for (let n = 0; n < 300 && !port; n++) {
    assert.equal(chrome.exitCode, null);
    try { port = (await readFile(directory + '/chrome/DevToolsActivePort', 'utf8')).split('\n')[0]; } catch { /* Bootstrap only. */ }
    if (!port) await pause(100);
  }
  assert.ok(port);
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  cdp = cdpConnection(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await cdp.opened;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const value = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, 'PWA browser evaluation failed: ' + expression.slice(0, 100)); return result.result?.value;
  };
  const wait = async expression => {
    for (let n = 0; n < 300; n++) { if (await value(expression)) return; await pause(100); }
    throw Error('PWA wait expired: ' + expression);
  };
  const pathsExpression = `(async()=>{const names=await caches.keys();return(await Promise.all(names.map(async n=>(await(await caches.open(n)).keys()).map(r=>new URL(r.url).pathname)))).flat();})()`;
  await cdp.send('Page.navigate', { url: origin + '/__pwa-harness' });
  await wait('!!document.querySelector("#draft")');
  await value('navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready).then(()=>true)');
  await wait('!!navigator.serviceWorker.controller');
  assert.ok((await value(pathsExpression)).includes('/og-image.png'));
  await value('localStorage.setItem("pwa-test","retained");sessionStorage.setItem("pwa-draft","unsaved");window.__controllerChanged=false;navigator.serviceWorker.addEventListener("controllerchange",()=>window.__controllerChanged=true);true');
  stage = 'current';
  await value('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)');
  await wait('window.__controllerChanged');
  await wait(`(${pathsExpression}).then(paths=>!paths.includes('/og-image.png'))`);
  assert.equal(await value('document.querySelector("#draft").value'), 'unsaved');
  assert.equal(await value('localStorage.getItem("pwa-test")'), 'retained');
  assert.equal(await value('sessionStorage.getItem("pwa-draft")'), 'unsaved');
  assert.equal(requests.filter(r => r.stage === 'current' && r.name === '/og-image.png').length, 0);
  assert.equal(await value('fetch("/api/me/profile").then(r=>r.status)'), 401);
  for (const name of staticPaths) assert.ok((await value(pathsExpression)).includes(name), 'Cached after update: ' + name);
  offline = true;
  for (const name of staticPaths) {
    assert.equal(await value(`fetch(${JSON.stringify(name)}).then(r=>r.ok?r.arrayBuffer():Promise.reject()).then(b=>b.byteLength)`), assets.get(name).length);
  }
  assert.equal(await value('fetch("/api/me/profile").then(r=>r.status)'), 503, 'API cannot replay a cached response');
  await cdp.send('Page.navigate', { url: origin + '/pwa/search' });
  await wait('!!document.querySelector("script[type=module]")');
  const entry = assets.get('/index.html').toString().match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)[1];
  assert.equal(await value('document.querySelector("script[type=module]").getAttribute("src")'), entry);
  assert.ok(!(await value(pathsExpression)).some(name => /^\/(?:api|__migration)(?:\/|$)/.test(name)));
  // New install, using a clean cache/profile state in the same isolated origin.
  offline = false;
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  await cdp.send('Page.navigate', { url: origin + '/__pwa-harness' }); await wait('!!document.querySelector("#draft")');
  const freshStart = requests.length;
  await value('navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready).then(()=>true)');
  await wait('!!navigator.serviceWorker.controller');
  const fresh = await value(pathsExpression);
  assert.ok(!fresh.includes('/og-image.png'));
  for (const name of staticPaths) assert.ok(fresh.includes(name));
  assert.equal(requests.slice(freshStart).filter(r => r.name === '/og-image.png').length, 0);
  assert.ok(requests.every(r => r.method === 'GET'));
  const report = { legacyUpdate: true, freshInstall: true, excludedImageNotRequested: true, obsoleteImageRemoved: true,
    draftAndStorageRetained: true, offlineShellAndCode: true, cachedStaticCount: staticPaths.length, apiNotCached: true, remoteApiCalls: 0 };
  if (process.env.FANMARK_PWA_TEST_REPORT) await writeFile(process.env.FANMARK_PWA_TEST_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  cdp?.close();
  if (chrome.exitCode === null) { const ended = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill('SIGTERM'); await Promise.race([ended, pause(3000)]); if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await ended; } }
  await proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

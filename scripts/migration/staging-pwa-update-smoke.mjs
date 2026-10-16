#!/usr/bin/env node

/** Verify a deployed staging service-worker update and return staging to its ordinary build. */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerDirectory = path.join(repositoryRoot, "workers/api");
const configRelativePath = "wrangler.app-staging.jsonc";
const configPath = path.join(workerDirectory, configRelativePath);
const wrangler = path.join(workerDirectory, "node_modules/.bin/wrangler");
const accountId = "bfc2890741f0b3fb236e2d755b6c9adc";
const workerName = "fanmark-app-staging";
const origin = "https://fanmark-app-staging.fanmark-id.workers.dev";
const canaryId = randomUUID();
const markerName = `__pwa-update-canary-${canaryId}.svg`;
const markerPath = path.join(repositoryRoot, "public", markerName);
const markerInDist = path.join(repositoryRoot, "dist-staging", markerName);
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "fanmark-pwa-update-"));
const storageKey = `fanmark-pwa-update-${canaryId}`;
const phaseKey = `${storageKey}-phase`;
const textareaId = `${storageKey}-unsaved`;

let chrome;
let cdp;
let chromeExited;
let markerCreated = false;
let stagingNeedsRestore = false;
let canaryVersion = null;
let restoredVersion = null;

function fail(code) {
  throw new Error(code);
}

function requireExplicitStagingWrite() {
  const expected = [
    "--run-live-staging-write",
    "--worker=fanmark-app-staging",
    `--account-id=${accountId}`,
  ];
  const args = new Set(process.argv.slice(2));
  if (args.size !== expected.length || expected.some((arg) => !args.has(arg))) {
    fail(`refusing_remote_staging_write; pass ${expected.join(" ")}`);
  }
}

function run(command, args, cwd, timeout = 240_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("staging_pwa_command_failed");
  return result.stdout ?? "";
}

function inspectTarget() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.name !== workerName || config.account_id !== accountId || config.workers_dev !== true ||
      (config.routes?.length ?? 0) !== 0 || config.assets?.directory !== "../../dist-staging" ||
      config.vars?.STAGING_NO_INDEX !== "true") {
    fail("staging_worker_config_mismatch");
  }
  const identity = JSON.parse(run(wrangler, ["whoami", "--json", "--config", configRelativePath], workerDirectory));
  if (identity.loggedIn !== true || identity.accounts?.some((account) => account.id === accountId) !== true) {
    fail("staging_account_identity_mismatch");
  }
  return config;
}

function buildStaging() {
  run("npm", ["run", "build:cloudflare-staging"], repositoryRoot);
}

function deployStaging(message) {
  const output = run(wrangler, [
    "deploy", "--config", configRelativePath, "--message", message,
  ], workerDirectory);
  const version = output.match(/Current Version ID:\s*([0-9a-f-]{36})/iu)?.[1];
  if (!version) fail("staging_deploy_version_missing");
  return version;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readCurrentServiceWorker() {
  const response = await fetch(`${origin}/sw.js?migration_pwa_update=${randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) fail("staging_service_worker_unavailable");
  const body = await response.text();
  if (!body.includes("workbox")) fail("staging_service_worker_body_invalid");
  return { body, digest: sha256(body) };
}

async function waitForServiceWorkerChange(previousDigest, markerExpected) {
  const deadline = Date.now() + 90_000;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await readCurrentServiceWorker();
      const markerInWorker = latest.body.includes(markerName);
      const markerResponse = await fetch(`${origin}/${markerName}?v=${randomUUID()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (latest.digest !== previousDigest && markerInWorker === markerExpected &&
          markerResponse.status === (markerExpected ? 200 : 404)) return latest;
    } catch {
      // Workers.dev traffic may still be converging after the deploy command returns.
    }
    await delay(1_000);
  }
  fail("staging_service_worker_deploy_not_visible");
}

async function startBrowser() {
  const candidates = [
    process.env.FANMARK_STAGING_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  let chromePath = null;
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      chromePath = candidate;
      break;
    }
  }
  if (!chromePath) fail("headless_chrome_required");

  chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--metrics-recording-only", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profileDirectory}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });
  chromeExited = new Promise((resolve) => chrome.once("exit", resolve));
  const activePortPath = path.join(profileDirectory, "DevToolsActivePort");
  const startupDeadline = Date.now() + 20_000;
  let port = null;
  while (Date.now() < startupDeadline && !port) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) fail("headless_chrome_exited");
    try {
      const [value] = (await readFile(activePortPath, "utf8")).split(/\r?\n/u);
      if (/^\d+$/u.test(value ?? "")) port = value;
    } catch {
      // Chrome writes the DevTools endpoint once its isolated profile is ready.
    }
    if (!port) await delay(100);
  }
  if (!port) fail("chrome_devtools_start_timeout");
  const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!targetsResponse.ok) fail("chrome_target_list_unavailable");
  const targets = await targetsResponse.json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) fail("chrome_page_target_unavailable");
  cdp = createCdpConnection(page.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send("Page.navigate", { url: `${origin}/pwa?update_canary=${canaryId}` });
  await waitForBrowserState((state) => state?.path === "/pwa" && state.controlled, "staging_pwa_not_controlled");
}

function createCdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("chrome_cdp_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("chrome_cdp_connect_failed"));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!Number.isInteger(message.id)) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timeout);
    if (message.error) operation.reject(new Error("chrome_cdp_command_failed"));
    else operation.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timeout);
      operation.reject(new Error("chrome_cdp_connection_closed"));
    }
    pending.clear();
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error("chrome_cdp_command_timeout"));
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

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) fail("browser_expression_failed");
  return response.result?.value ?? null;
}

async function readBrowserState() {
  return await evaluate(`(async () => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      path: location.pathname,
      ready: document.readyState,
      controlled: Boolean(navigator.serviceWorker?.controller),
      navigationType: nav?.type ?? null,
      storage: localStorage.getItem(${JSON.stringify(storageKey)}),
      phase: sessionStorage.getItem(${JSON.stringify(phaseKey)}),
      textareaPresent: Boolean(document.getElementById(${JSON.stringify(textareaId)})),
      cacheNames: await caches.keys(),
      precacheUrls: await (async () => {
        const cacheName = (await caches.keys()).find((name) => name.startsWith("workbox-precache-v2-"));
        if (!cacheName) return [];
        const cache = await caches.open(cacheName);
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      })(),
    };
  })()`);
}

async function waitForBrowserState(predicate, code, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  while (Date.now() < deadline) {
    try {
      current = await readBrowserState();
      if (predicate(current)) return current;
    } catch {
      // Runtime.evaluate may briefly lose its execution context during auto-reload.
    }
    await delay(400);
  }
  fail(`${code}:${JSON.stringify(current)}`);
}

async function installUnsavedState(phase) {
  const result = await evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(storageKey)}, "persisted synthetic preference");
    sessionStorage.setItem(${JSON.stringify(phaseKey)}, ${JSON.stringify(phase)});
    document.getElementById(${JSON.stringify(textareaId)})?.remove();
    const textarea = document.createElement("textarea");
    textarea.id = ${JSON.stringify(textareaId)};
    textarea.value = ${JSON.stringify(`unsaved-${phase}`)};
    document.body.append(textarea);
    return true;
  })()`);
  assert.equal(result, true);
}

async function updateBrowserAndVerify(phase, markerExpected) {
  await evaluate(`navigator.serviceWorker.ready.then((registration) => registration.update())`);
  const state = await waitForBrowserState((current) =>
    current?.path === "/pwa" && current.ready === "complete" && current.controlled &&
    current.navigationType === "reload" && current.storage === "persisted synthetic preference" &&
    current.phase === phase && !current.textareaPresent &&
    Array.isArray(current.precacheUrls) && current.precacheUrls.includes(`/${markerName}`) === markerExpected,
  `service_worker_${phase}_transition_not_rendered`);
  return state;
}

async function delay(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function restoreStaging() {
  if (markerCreated) {
    await rm(markerPath, { force: true });
    markerCreated = false;
  }
  await buildStaging();
  restoredVersion = deployStaging("restore staging after PWA update canary");
  stagingNeedsRestore = false;
}

async function main() {
  requireExplicitStagingWrite();
  inspectTarget();
  assert.equal(await fileExists(markerPath), false, "PWA canary marker already exists");

  const baseline = await readCurrentServiceWorker();
  await startBrowser();
  const beforeCanary = await readBrowserState();
  assert.equal(beforeCanary.path, "/pwa");
  assert.equal(beforeCanary.controlled, true);
  assert.ok(Array.isArray(beforeCanary.cacheNames) && beforeCanary.cacheNames.length > 0);
  await installUnsavedState("canary-installed");

  stagingNeedsRestore = true;
  await writeFile(markerPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n', { flag: "wx" });
  markerCreated = true;
  await buildStaging();
  assert.equal(await fileExists(markerInDist), true, "temporary PWA asset was not included in the staging build");
  canaryVersion = deployStaging("synthetic staging PWA update canary");
  const canaryWorker = await waitForServiceWorkerChange(baseline.digest, true);
  assert.notEqual(canaryWorker.digest, baseline.digest);
  const afterCanary = await updateBrowserAndVerify("canary-installed", true);
  assert.ok(afterCanary.precacheUrls.includes(`/${markerName}`));

  await installUnsavedState("restored-build");
  const beforeRestore = await readCurrentServiceWorker();
  await restoreStaging();
  const stableWorker = await waitForServiceWorkerChange(beforeRestore.digest, false);
  assert.ok(!stableWorker.body.includes(markerName));
  const markerResponse = await fetch(`${origin}/${markerName}?v=${randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  assert.equal(markerResponse.status, 404, "temporary PWA asset remained public after restoration");
  const afterRestore = await updateBrowserAndVerify("restored-build", false);
  assert.ok(!afterRestore.precacheUrls.includes(`/${markerName}`));
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), "persisted synthetic preference");
  await evaluate(`localStorage.removeItem(${JSON.stringify(storageKey)}); sessionStorage.removeItem(${JSON.stringify(phaseKey)});`);
  console.log(`Staging PWA updated across Worker versions ${canaryVersion} and ${restoredVersion}; both service-worker activations reloaded /pwa, preserved localStorage, discarded an unsaved DOM field, and updated the Workbox precache contents. Temporary asset returned 404.`);
}

let testError = null;
try {
  await main();
} catch (error) {
  testError = error instanceof Error ? error : new Error("staging_pwa_update_failed");
} finally {
  if (stagingNeedsRestore) {
    try {
      await restoreStaging();
    } catch {
      testError = testError
        ? new Error(`${testError.message}; staging_pwa_restore_failed`)
        : new Error("staging_pwa_restore_failed");
    }
  }
  cdp?.close();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([chromeExited, delay(2_000)]);
  }
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGKILL");
    await Promise.race([chromeExited, delay(2_000)]);
  }
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(markerPath, { force: true });
}

if (testError) {
  console.error(testError.message);
  process.exitCode = 1;
}

import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dirname, "..");
const wranglerBinary = resolve(packageDirectory, "node_modules/wrangler/bin/wrangler.js");
const STARTUP_TIMEOUT_MS = 1_000;
const ASSERTION_TIMEOUT_MS = 5_000;

function fetchBounded(url, init, timeoutMs) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not determine a local test port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

function hasExited(processHandle) {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

async function waitForExit(processHandle, timeoutMs) {
  if (hasExited(processHandle)) return true;
  return Promise.race([
    once(processHandle, "close").then(() => true),
    new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), timeoutMs)),
  ]);
}

function tryKill(processHandle, signal) {
  try {
    return processHandle.kill(signal);
  } catch {
    return false;
  }
}

async function stopProcess(processHandle) {
  if (hasExited(processHandle)) return;

  if (!tryKill(processHandle, "SIGTERM")) return;
  if (await waitForExit(processHandle, 1_000)) return;
  if (hasExited(processHandle)) return;

  if (!tryKill(processHandle, "SIGKILL")) return;
  await waitForExit(processHandle, 1_000);
}

async function waitForServer(baseUrl, processHandle, output, spawnState) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnState.error) {
      throw new Error(`wrangler failed to start: ${spawnState.error}\n${output.join("")}`);
    }
    if (hasExited(processHandle)) {
      throw new Error(`wrangler exited before serving HTTP:\n${output.join("")}`);
    }
    try {
      const response = await fetchBounded(`${baseUrl}/`, undefined, STARTUP_TIMEOUT_MS);
      await response.arrayBuffer();
      if (response.status === 200) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`timed out waiting for wrangler:\n${output.join("")}`);
}

async function assertHtmlNavigation(baseUrl, path) {
  const response = await fetchBounded(
    `${baseUrl}${path}`,
    {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Mode": "navigate",
      },
    },
    ASSERTION_TIMEOUT_MS,
  );
  const body = await response.text();
  assert.equal(response.status, 200, `${path} should serve the SPA shell`);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
  assert.match(body, /<div id="root"><\/div>/);
}

async function assertJsonApi404(baseUrl, path) {
  const response = await fetchBounded(
    `${baseUrl}${path}`,
    {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Mode": "navigate",
      },
    },
    ASSERTION_TIMEOUT_MS,
  );
  const body = await response.text();
  assert.equal(response.status, 404, `${path} should remain a Worker API 404`);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.equal(body, JSON.stringify({ error: "not_found" }));
  assert.doesNotMatch(body, /<html/i);
}

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
const spawnState = { error: null };
const processHandle = spawn(
  process.execPath,
  [
    wranglerBinary,
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--config",
    "wrangler.static-assets.jsonc",
  ],
  {
    cwd: packageDirectory,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
processHandle.once("error", (error) => {
  spawnState.error = error;
  output.push(`wrangler spawn error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
});

for (const stream of [processHandle.stdout, processHandle.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => output.push(chunk));
}

try {
  await waitForServer(baseUrl, processHandle, output, spawnState);

  for (const path of ["/", "/a/example-short-id", "/pwa", "/auth"]) {
    await assertHtmlNavigation(baseUrl, path);
  }

  const missingAsset = await fetchBounded(
    `${baseUrl}/assets/does-not-exist.js`,
    undefined,
    ASSERTION_TIMEOUT_MS,
  );
  const missingAssetBody = await missingAsset.text();
  assert.equal(missingAsset.status, 404);
  assert.doesNotMatch(missingAsset.headers.get("content-type") ?? "", /text\/html/i);
  assert.doesNotMatch(missingAssetBody, /<html/i);

  const favicon = await fetchBounded(`${baseUrl}/favicon.ico`, undefined, ASSERTION_TIMEOUT_MS);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type") ?? "", /image\/(?:x-icon|vnd\.microsoft\.icon)/i);

  for (const path of ["/api", "/api?x=1", "/api/unknown", "/api/auth/session"]) {
    await assertJsonApi404(baseUrl, path);
  }
} finally {
  await stopProcess(processHandle);
}

console.log("Static Assets Wrangler HTTP smoke passed");

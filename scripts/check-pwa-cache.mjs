#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Inspect the shipped worker, not only Vite configuration. Run after build.
const worker = await readFile("dist/sw.js", "utf8");
const cleanup = await readFile("dist/clear-legacy-api-cache.js", "utf8");
assert.match(worker, /importScripts\(["']clear-legacy-api-cache\.js["']\)/);
assert.doesNotMatch(worker, /supabase-cache|new workbox\.(?:NetworkFirst|CacheFirst|StaleWhileRevalidate)/);
assert.match(worker, /denylist:/);
assert.match(worker, /\/\^\\\/api\(\?:\\\/\|\$\)\//);

const existing = new Set(["supabase-cache", "workbox-precache-v2", "unrelated-cache"]);
let activate;
runInNewContext(cleanup, {
  self: { addEventListener(event, handler) {
    assert.equal(event, "activate");
    activate = handler;
  } },
  caches: { async delete(name) { return existing.delete(name); } },
});
for (let retry = 0; retry < 2; retry++) {
  let pending;
  activate({ waitUntil(promise) { pending = promise; } });
  assert.ok(pending instanceof Promise);
  await pending;
  assert.deepEqual([...existing], ["workbox-precache-v2", "unrelated-cache"]);
}
console.log("Built PWA worker excludes API runtime caching; legacy cache retirement is targeted and repeatable");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Inspect the shipped worker, not only Vite configuration. Run after build.
const buildDir = process.argv[2] ?? "dist";
const worker = await readFile(`${buildDir}/sw.js`, "utf8");
const cleanup = await readFile(`${buildDir}/clear-legacy-api-cache.js`, "utf8");
const manifest = JSON.parse(await readFile(`${buildDir}/manifest.webmanifest`, "utf8"));
assert.match(worker, /importScripts\(["']clear-legacy-api-cache\.js["']\)/);
assert.doesNotMatch(worker, /supabase-cache|new workbox\.(?:NetworkFirst|CacheFirst|StaleWhileRevalidate)/);
assert.equal(manifest.start_url, "/pwa");
assert.equal(manifest.display, "standalone");
assert.ok(Array.isArray(manifest.icons));

for (const [size, dimension] of [["192x192", 192], ["512x512", 512]]) {
  const icon = manifest.icons.find((entry) => entry.sizes?.split(/\s+/).includes(size));
  assert.ok(icon, `manifest must provide a ${size} PWA icon`);
  assert.ok(icon.purpose?.split(/\s+/).includes("any"), `${size} icon must have the any purpose`);
  assert.ok(icon.purpose?.split(/\s+/).includes("maskable"), `${size} icon must have the maskable purpose`);
  assert.match(icon.src, /^\/[A-Za-z0-9._/-]+$/);
  assert.ok(!icon.src.split("/").includes(".."), `${size} icon path must stay inside dist`);
  const iconPath = `${buildDir}/${icon.src.slice(1)}`;
  const bytes = await readFile(iconPath);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${size} icon must be PNG`);
  assert.equal(bytes.readUInt32BE(16), dimension, `${size} icon width must match its manifest size`);
  assert.equal(bytes.readUInt32BE(20), dimension, `${size} icon height must match its manifest size`);
  assert.ok(worker.includes(icon.src.slice(1)), `${size} icon must be present in the static precache`);
}

const denylistSource = worker.match(/denylist: (\[[^\n]+\])/);
assert.ok(denylistSource, "generated worker must deny API navigation fallback");
const denylist = runInNewContext(denylistSource[1]);
for (const pathname of ["/api", "/api?limit=2", "/api/fanmarks/recent?limit=2"]) {
  assert.ok(denylist.some((rule) => rule.test(pathname)), `${pathname} must not receive cached SPA HTML`);
}
for (const pathname of ["/pwa", "/dashboard", "/apiary"]) {
  assert.ok(!denylist.some((rule) => rule.test(pathname)), `${pathname} keeps SPA routing`);
}

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

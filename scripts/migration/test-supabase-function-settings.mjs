#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configPath = path.join(repositoryRoot, "supabase/config.toml");
const observationsPath = path.join(repositoryRoot, "docs/migration/live-observations.md");
const functionsPath = path.join(repositoryRoot, "supabase/functions");

const config = readFileSync(configPath, "utf8");
const observations = readFileSync(observationsPath, "utf8");
const tableHeader = "| Function | State | Live version | Live `verify_jwt` | Local setting |";
const tableStart = observations.indexOf(tableHeader);
assert.notEqual(tableStart, -1, "live Edge Function settings table must be present");

const table = observations.slice(tableStart + tableHeader.length).split(/\n\s*\n/u, 1)[0];
const liveRows = [...table.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*([A-Z]+)\s*\|\s*\d+\s*\|\s*`(true|false)`\s*\|\s*(true|false|prepared|live-only)\s*\|$/gmu)];
assert.equal(liveRows.length, 35, "the reviewed live inventory contains 35 functions");

const expectedLocal = new Map();
const liveOnly = [];
const prepared = [];
for (const [, name, state, liveVerifyJwt, localSetting] of liveRows) {
  assert.equal(state, "ACTIVE", `${name} must remain part of the active observed inventory`);
  if (localSetting === "live-only") {
    liveOnly.push(name);
    continue;
  }
  if (localSetting === "prepared") prepared.push(name);
  const localVerifyJwt = localSetting === "prepared" ? liveVerifyJwt : localSetting;
  assert.equal(localVerifyJwt, liveVerifyJwt, `${name} local setting must mirror the observed gateway setting`);
  assert.ok(!expectedLocal.has(name), `${name} must appear only once in the observation table`);
  expectedLocal.set(name, localVerifyJwt === "true");
}

assert.deepEqual(liveOnly, []);
assert.deepEqual(prepared, ["manual-expire-grace-licenses"]);

const localEntrypoints = readdirSync(functionsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .filter((entry) => ["index.ts", "index.tsx", "index.js", "index.mjs"].some((file) =>
    existsSync(path.join(functionsPath, entry.name, file))))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(localEntrypoints, [...expectedLocal.keys()].sort(), "local function entrypoints must match the reviewed live inventory");

const configured = new Map();
for (const section of config.split(/(?=^\[)/mu)) {
  const header = section.match(/^\[functions\.([a-z0-9-]+)\]\s*$/mu);
  if (!header) continue;
  const [, name] = header;
  const values = [...section.matchAll(/^verify_jwt\s*=\s*(true|false)\s*$/gmu)];
  assert.equal(values.length, 1, `${name} must declare exactly one explicit verify_jwt boolean`);
  assert.ok(!configured.has(name), `${name} must have only one function config section`);
  configured.set(name, values[0][1] === "true");
}

assert.deepEqual(configured, expectedLocal, "every local function config must match its read-only live observation");
const preparedSource = readFileSync(path.join(functionsPath, "manual-expire-grace-licenses/index.ts"), "utf8");
assert.match(preparedSource, /requireAdminContext\(req,\s*\{\s*requireMfa:\s*true\s*\}\)/u);
const adminAuthSource = readFileSync(path.join(functionsPath, "_shared/admin-auth.ts"), "utf8");
assert.match(adminAuthSource, /options\.requireMfa\s*&&\s*!\(await hasCurrentAal2\(supabase\.auth\.mfa, accessToken\)\)/u);
console.log(`Supabase Edge Function config matches ${expectedLocal.size} deployed functions; ${prepared.length} guarded local replacement is prepared but not deployed.`);

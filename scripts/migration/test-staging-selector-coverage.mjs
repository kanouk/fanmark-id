import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const envTypes = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const stagingBuild = packageJson.scripts["build:cloudflare-staging"];
const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

test("Cloudflare staging build explicitly selects every typed backend", () => {
  assert.equal(typeof stagingBuild, "string");

  const declaredSelectors = [...envTypes.matchAll(/readonly\s+(VITE_[A-Z0-9_]+_BACKEND)\??\s*:/gu)]
    .map((match) => match[1]);
  const assignments = new Map(
    [...stagingBuild.matchAll(/\b(VITE_[A-Z0-9_]+_BACKEND)=([A-Za-z0-9_-]+)/gu)]
      .map((match) => [match[1], match[2]]),
  );

  const missing = declaredSelectors.filter((selector) => !assignments.has(selector));
  assert.deepEqual(missing, [], "staging must not silently use a selector's Supabase default");
  assert.ok(declaredSelectors.length > 0, "the frontend backend contract must remain discoverable");
  assert.ok([...assignments.values()].every((value) => ["worker", "supabase", "d1", "r2", "disabled"].includes(value)));

  const supabaseSelected = [...assignments.entries()].filter(([, value]) => value === "supabase").map(([name]) => name);
  assert.deepEqual(supabaseSelected, [], "Cloudflare staging must not route a typed backend back to Supabase");

  const nonWorker = [...assignments.entries()]
    .filter(([, value]) => value !== "worker")
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(nonWorker, [
    ["VITE_ADMIN_DATA_RESET_BACKEND", "disabled"],
    ["VITE_REFERENCE_MASTER_ADMIN_BACKEND", "d1"],
    ["VITE_STORAGE_BACKEND", "r2"],
  ], "only the explicitly disabled destructive reset and the D1/R2 native adapters may differ from Worker");
});

test("every typed frontend backend selector has an implementation reference", () => {
  const sourceFiles = listTypeScriptFiles(sourceRoot).filter((filePath) => path.basename(filePath) !== "vite-env.d.ts");
  const sourceText = sourceFiles.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
  const declaredSelectors = [...envTypes.matchAll(/readonly\s+(VITE_[A-Z0-9_]+_BACKEND)\??\s*:/gu)]
    .map((match) => match[1]);
  const unused = declaredSelectors.filter((selector) => !sourceText.includes(selector));

  assert.deepEqual(unused, [], "declared selectors must be consumed by frontend source, not just named in the build");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const envTypes = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const stagingBuild = packageJson.scripts["build:cloudflare-staging"];

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
  assert.ok([...assignments.values()].every((value) => ["worker", "supabase", "d1", "r2"].includes(value)));
});

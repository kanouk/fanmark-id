import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildInventory, renderMarkdown } from "./inventory.mjs";

const inventory = await readFile(new URL("../../docs/migration/repository-inventory.md", import.meta.url), "utf8");
const remainingMap = await readFile(new URL("../../docs/migration/frontend-callsite-map.md", import.meta.url), "utf8");

function expandLocations(text) {
  const locations = [];
  for (const match of text.matchAll(/(src\/[A-Za-z0-9_./-]+\.(?:ts|tsx)):(\d+(?:,\d+)*)/g)) {
    const [, path, lineNumbers] = match;
    for (const line of lineNumbers.split(",")) locations.push(`${path}:${line}`);
  }
  return locations;
}

const sourceTable = inventory
  .split("## Frontend Supabase callsites\n", 2)[1]
  .split("\n## ", 1)[0];
const inventoryLocations = sourceTable
  .split("\n")
  .filter((line) => line.startsWith("| `src/"))
  .flatMap(expandLocations);
const semanticHeading = inventory.indexOf("## Semantic mapping");
const semanticSection = semanticHeading === -1 ? "" : inventory.slice(semanticHeading);
const existingMappings = expandLocations(semanticSection);
const remainingMappings = expandLocations(remainingMap);

test("the mapped inventory matches current source call locations, targets and operations", () => {
  const current = renderMarkdown(buildInventory(fileURLToPath(new URL("../../", import.meta.url))))
    .split("## Frontend Supabase callsites\n", 2)[1]
    .split("\n## ", 1)[0];
  const rows = section => section.split("\n").filter(line => line.startsWith("| `src/"));
  assert.deepEqual(rows(sourceTable), rows(current),
    "regenerate the frontend call table and review its semantic mappings when source calls change; two stale documents must not pass as current coverage");
});

test("all static frontend Supabase callsites have exactly one semantic map entry", () => {
  const inventorySet = new Set(inventoryLocations);
  const mappedLocations = [...existingMappings, ...remainingMappings];
  const mappedSet = new Set(mappedLocations);
  const duplicateMappings = mappedLocations.filter((location, index) => mappedLocations.indexOf(location) !== index);
  const unmappedLocations = [...inventorySet].filter((location) => !mappedSet.has(location));
  const unexpectedMappings = [...mappedSet].filter((location) => !inventorySet.has(location));

  assert.equal(inventoryLocations.length, 211, "update this expected count when regenerating the static inventory");
  assert.equal(existingMappings.length, 143, "update prior semantic sections and this expected count together");
  assert.equal(remainingMappings.length, 68, "update the remaining-callsite map and this expected count together");
  assert.deepEqual(duplicateMappings, []);
  assert.deepEqual(unmappedLocations, []);
  assert.deepEqual(unexpectedMappings, []);
});

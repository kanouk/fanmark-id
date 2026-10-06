import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildIdentityReadinessOracle } from "./identity-readiness-oracle.mjs";

const sql = await readFile(new URL("./identity-readiness.sql", import.meta.url), "utf8");
const evidence = JSON.parse(await readFile(new URL("./fixtures/identity-readiness-oracle-2026-10-06.json", import.meta.url), "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const table = (scenario, relation) => evidence.scenarios[scenario].tables.find(row => row.relation === relation);

test("both literal-only PostgreSQL observations match the current production query and oracle SQL", () => {
  assert.equal(hash(sql), evidence.sourceSqlSha256, "changed policy requires a fresh literal-only PostgreSQL rehearsal");
  assert.equal(evidence.actualSourceRowsRead, false);
  assert.equal(evidence.storedApplicationFunctionsInvoked, false);
  assert.equal(evidence.sourceOrCloudflareStateChanged, false);
  for (const scenario of ["valid", "blocked"]) {
    const generated = buildIdentityReadinessOracle(sql, scenario);
    assert.equal(hash(generated), evidence.scenarios[scenario].oracleSqlSha256);
    assert.doesNotMatch(generated, /\bpublic\s*\./iu);
    assert.equal(evidence.scenarios[scenario].tables.length, 4);
  }
});

test("valid historical repetition/length/order and repeated events are admitted without losing owner isolation", () => {
  assert.equal(evidence.scenarios.valid.readyForIdentityImport, true);
  for (const row of evidence.scenarios.valid.tables) {
    assert.equal(row.total_rows, 2);
    assert.equal(row.admitted_rows, 2);
    assert.equal(row.canonical_duplicate_groups, 0);
    assert.equal(row.display_duplicate_groups, 0);
  }
});

test("shape, same-owner canonical identity and display collisions stop import while event repetition stays valid", () => {
  assert.equal(evidence.scenarios.blocked.readyForIdentityImport, false);
  const discoveries = table("blocked", "fanmark_discoveries");
  for (const reason of ["empty_arrays", "null_element_arrays", "unsupported_dimensions", "unsupported_lower_bounds"]) {
    assert.equal(discoveries[reason], 1);
  }
  assert.equal(discoveries.admitted_rows, 2);
  const favorites = table("blocked", "fanmark_favorites");
  assert.equal(favorites.canonical_duplicate_groups, 1);
  assert.equal(favorites.canonical_duplicate_rows, 2);
  assert.equal(favorites.total_rows, 3);
  const fanmarks = table("blocked", "fanmarks");
  assert.equal(fanmarks.null_arrays, 1);
  assert.equal(fanmarks.display_duplicate_groups, 1);
  assert.equal(fanmarks.display_duplicate_rows, 2);
  const events = table("blocked", "fanmark_events");
  assert.equal(events.admitted_rows, 2);
  assert.equal(events.empty_arrays, 1);
  assert.equal(events.null_element_arrays, 1);
  assert.equal(events.canonical_duplicate_groups, 0);
});

test("oracle refuses ambiguous substitution, source reads and loss of the read-only transaction", () => {
  assert.throws(() => buildIdentityReadinessOracle(sql, "unknown"), /scenario_invalid/u);
  assert.throws(() => buildIdentityReadinessOracle(sql + sql, "valid"), /source_marker_invalid/u);
  assert.throws(() => buildIdentityReadinessOracle(sql.replace("-- BEGIN SOURCE ROWS", "-- missing"), "valid"), /source_marker_invalid/u);
  assert.throws(() => buildIdentityReadinessOracle(sql + "\nSELECT * FROM public.fanmarks;", "valid"), /source_read_remaining/u);
  assert.throws(() => buildIdentityReadinessOracle(sql.replace("BEGIN READ ONLY;", "BEGIN;"), "valid"), /read_only_required/u);
  assert.throws(() => buildIdentityReadinessOracle(sql + "\nDELETE FROM synthetic;", "valid"), /read_only_required/u);
});

#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  activateReferenceMasterRelease,
  moneyUsdTextToCents,
  referenceMasterRowsEqual,
  renderReferenceMasterReleaseSql,
  stageReferenceMasterRelease,
  verifyStagedReferenceMasterRelease,
} from "../../../scripts/migration/reference-master-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const migrationPaths = [
  path.join(repoRoot, "workers/api/migrations/0004_reference_master_releases.sql"),
  path.join(repoRoot, "workers/api/migrations/0006_reference_master_extension_prices.sql"),
];

const sourceSnapshot = [
  {
    table_name: "fanmark_tiers",
    row_count: 1,
    source_sha256: "1".repeat(64),
    records: [{
      id: "00000000-0000-4000-8000-000000000001",
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: "Synthetic tier",
      display_name: "Synthetic",
      emoji_count_max: 5,
      emoji_count_min: 1,
      initial_license_days: 30,
      is_active: true,
      monthly_price_usd: "300.00",
      tier_level: 4,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "languages",
    row_count: 1,
    source_sha256: "2".repeat(64),
    records: [{
      code: "ja",
      created_at: "2026-09-23T01:02:03.123456+00:00",
      id: "00000000-0000-4000-8000-000000000002",
      is_active: true,
      label: "Japanese",
      native_label: "日本語",
      sort_order: 1,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "reserved_emoji_patterns",
    row_count: 1,
    source_sha256: "3".repeat(64),
    records: [{
      created_at: "2026-09-23T01:02:03.123456+00:00",
      description: null,
      id: "00000000-0000-4000-8000-000000000003",
      is_active: false,
      pattern: "🧪",
      price_yen: 1200,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
  {
    table_name: "fanmark_tier_extension_prices",
    row_count: 1,
    source_sha256: "4".repeat(64),
    records: [{
      created_at: "2026-09-23T01:02:03.123456+00:00",
      id: "00000000-0000-4000-8000-000000000004",
      is_active: true,
      months: 3,
      price_yen: 1200,
      stripe_price_id: "price_syntheticTest1",
      stripe_price_id_live: null,
      tier_level: 2,
      updated_at: "2026-09-23T01:02:03.123456+00:00",
    }],
  },
];
const snapshotSha256 = "a".repeat(64);

function splitSqlStatements(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gm, "");
  const statements = [];
  let current = "";
  let parentheses = 0;
  let trigger = false;
  for (const line of source.split(/\r?\n/)) {
    current += line + "\n";
    if (!trigger && /^\s*CREATE\s+TRIGGER\b/i.test(current)) trigger = true;
    if (!trigger) {
      for (const character of line) {
        if (character === "(") parentheses += 1;
        if (character === ")") parentheses -= 1;
      }
      if (line.trimEnd().endsWith(";") && parentheses === 0) {
        statements.push(current.trim());
        current = "";
      }
    } else if (/^\s*END;\s*$/.test(line)) {
      statements.push(current.trim());
      current = "";
      trigger = false;
      parentheses = 0;
    }
  }
  if (current.trim()) throw new Error("incomplete_sql_migration_statement");
  return statements;
}

async function createDatabase() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-reference-master-release-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-reference-master-release-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("DB");
  for (const migrationPath of migrationPaths) {
    const sql = await fs.readFile(migrationPath, "utf8");
    for (const statement of splitSqlStatements(sql)) {
      const result = await database.prepare(statement).run();
      assert.equal(result.success, true, statement.slice(0, 100));
    }
  }
  return { miniflare, database };
}

async function one(database, sql, values = []) {
  return database.prepare(sql).bind(...values).first();
}

test("reference masters stage as an immutable release and expose only after atomic activation", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const staged = await stageReferenceMasterRelease({ database, snapshot: sourceSnapshot, snapshotSha256, maxRowsPerBatch: 2 });
    assert.equal(staged.status, "ready");
    assert.equal(staged.reused, false);
    assert.equal(await one(database, "SELECT count(*) AS count FROM fanmark_tiers").then((row) => row.count), 0);
    assert.equal(await verifyStagedReferenceMasterRelease({ database, snapshot: sourceSnapshot, snapshotSha256 }), true);

    const activation = await activateReferenceMasterRelease({ database, releaseVersion: snapshotSha256, expectedActiveVersion: null });
    assert.equal(activation.generation, 1);
    assert.equal(activation.reused, false);
    assert.deepEqual(await one(database,
      "SELECT id, created_at, monthly_price_usd, tier_level FROM fanmark_tiers"), {
      id: sourceSnapshot[0].records[0].id,
      created_at: sourceSnapshot[0].records[0].created_at,
      monthly_price_usd: 30000,
      tier_level: 4,
    });
    assert.deepEqual(await one(database, "SELECT code, label, native_label FROM languages"), {
      code: "ja", label: "Japanese", native_label: "日本語",
    });
    assert.deepEqual(await one(database, "SELECT pattern, price_yen, is_active FROM reserved_emoji_patterns"), {
      pattern: "🧪", price_yen: 1200, is_active: 0,
    });
    await assert.rejects(
      () => database.prepare("UPDATE fanmark_tier_release_rows SET display_name = 'Changed' WHERE release_version = ?")
        .bind(snapshotSha256).run(),
      /reference_release_rows_immutable/,
    );
    assert.equal((await stageReferenceMasterRelease({ database, snapshot: sourceSnapshot, snapshotSha256 })).reused, true);
  } finally {
    await miniflare.dispose();
  }
});

test("interrupted staging remains loading, and retry replaces partial rows before readiness", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    await assert.rejects(
      () => stageReferenceMasterRelease({
        database,
        snapshot: sourceSnapshot,
        snapshotSha256,
        maxRowsPerBatch: 1,
        hooks: { afterBatch: async ({ batchNumber }) => { if (batchNumber === 1) throw new Error("synthetic_interruption"); } },
      }),
      /synthetic_interruption/,
    );
    assert.equal((await one(database,
      "SELECT status FROM fanmark_reference_master_releases WHERE release_version = ?", [snapshotSha256])).status, "loading");
    await assert.rejects(
      () => activateReferenceMasterRelease({ database, releaseVersion: snapshotSha256 }),
      (error) => error.code === "reference_master_release_not_ready",
    );
    const retried = await stageReferenceMasterRelease({ database, snapshot: sourceSnapshot, snapshotSha256, maxRowsPerBatch: 1 });
    assert.equal(retried.status, "ready");
    assert.equal(await one(database,
      "SELECT count(*) AS count FROM fanmark_tier_release_rows WHERE release_version = ?", [snapshotSha256]).then((row) => row.count), 1);
  } finally {
    await miniflare.dispose();
  }
});

test("money conversion preserves cents without floating point and rejects imprecise values", () => {
  assert.equal(moneyUsdTextToCents("300.00"), 30000);
  assert.equal(moneyUsdTextToCents("-0.01"), -1);
  assert.throws(() => moneyUsdTextToCents("300"), /reference_master_money_format_invalid/);
  assert.throws(() => moneyUsdTextToCents("0.001"), /reference_master_money_format_invalid/);
});

test("row comparison ignores object key order and still compares every value", () => {
  assert.equal(referenceMasterRowsEqual(
    [{ code: "ja", label: "Japanese", is_active: 1 }],
    [{ is_active: 1, label: "Japanese", code: "ja" }],
  ), true);
  assert.equal(referenceMasterRowsEqual(
    [{ code: "ja", label: "Japanese", is_active: 1 }],
    [{ is_active: 1, label: "Japanese", code: "en" }],
  ), false);
});

test("rendered SQL artifact activates the same exact release through one statement per execution", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const rendered = renderReferenceMasterReleaseSql({
      snapshot: sourceSnapshot,
      snapshotSha256,
      activationId: "00000000-0000-4000-8000-000000000099",
    });
    assert.equal(rendered.releaseVersion, snapshotSha256);
    assert.ok(rendered.statements.length > sourceSnapshot.reduce((total, entry) => total + entry.row_count, 0));
    let finalRows;
    for (const statement of rendered.statements) {
      const result = statement.startsWith("SELECT ")
        ? await database.prepare(statement).all()
        : await database.prepare(statement).run();
      assert.equal(result.success, true, statement.slice(0, 120));
      if (statement.startsWith("SELECT ")) finalRows = result.results;
    }
    assert.deepEqual(finalRows, [{
      release_version: snapshotSha256,
      generation: 1,
      fanmark_tiers_rows: 1,
      languages_rows: 1,
      reserved_emoji_patterns_rows: 1,
      fanmark_tier_extension_prices_rows: 1,
    }]);
    assert.equal((await one(database,
      "SELECT monthly_price_usd FROM fanmark_tiers WHERE tier_level = 4")).monthly_price_usd, 30000);
  } finally {
    await miniflare.dispose();
  }
});

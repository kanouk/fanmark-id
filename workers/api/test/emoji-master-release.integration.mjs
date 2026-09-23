#!/usr/bin/env node

/**
 * Local-only staging proof for versioned, public emoji master data.
 * Synthetic records are used; canonical emoji_master rows are never modified.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { buildRelease, verifyRelease } from "../../../scripts/build-emoji-release.ts";
import {
  activateEmojiMasterRelease,
  readEmojiMasterActiveRelease,
} from "../../../scripts/migration/emoji-master-release-activate.mjs";
import { stageEmojiMasterRelease } from "../../../scripts/migration/emoji-master-release-stage.mjs";
import {
  createEmojiMasterD1Repository,
  parseEmojiCatalogPageRequest,
} from "../src/emoji-master-d1-repository.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const ddlPath = path.join(repoRoot, "workers/api/migrations/0001_emoji_master_release_staging.sql");
const activationDdlPath = path.join(repoRoot, "workers/api/migrations/0002_emoji_master_release_activation.sql");
const source = {
  id: "00000000-0000-4000-8000-000000000001",
  emoji: "👋",
  short_name: "wave",
  keywords: ["wave", "hello"],
  category: "People & Body",
  subcategory: "hand-fingers-open",
  codepoints: ["1F44B"],
  sort_order: 1,
};
const added = {
  id: "00000000-0000-4000-8000-000000000002",
  emoji: "🎵",
  short_name: "musical_note",
  keywords: ["music", "note"],
  category: "Objects",
  subcategory: "music",
  codepoints: ["1F3B5"],
  sort_order: 2,
};
const addedAgain = {
  id: "00000000-0000-4000-8000-000000000003",
  emoji: "🌿",
  short_name: "herb",
  keywords: ["plant", "herb"],
  category: "Nature",
  subcategory: "plant-other",
  codepoints: ["1F33F"],
  sort_order: 3,
};

const sourceDdl = [
  "CREATE TABLE emoji_master (",
  "id TEXT PRIMARY KEY NOT NULL,",
  "emoji TEXT NOT NULL UNIQUE,",
  "short_name TEXT NOT NULL,",
  "keywords TEXT NOT NULL CHECK (json_valid(keywords)),",
  "category TEXT,",
  "subcategory TEXT,",
  "codepoints TEXT NOT NULL CHECK (json_valid(codepoints)),",
  "sort_order INTEGER,",
  "created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),",
  "updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)",
  ");",
].join("\n");

async function createLocalD1() {
  let Miniflare;
  try {
    ({ Miniflare } = await import(pathToFileURL(miniflarePath).href));
  } catch (error) {
    throw new Error("local_miniflare_unavailable", { cause: error });
  }
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-emoji-master-stage-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-emoji-master-stage-test" } },
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": {
              type: "esm",
              contents: "export default { fetch() { return new Response('ok'); } };",
            },
          },
        },
      },
    }],
  });
  return { miniflare, database: await miniflare.getD1Database("DB") };
}

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

async function applySql(database, sql) {
  for (const statement of splitSqlStatements(sql)) {
    const result = await database.prepare(statement).run();
    assert.equal(result.success, true, statement);
  }
}

async function createDatabase({ seedSource = true } = {}) {
  const local = await createLocalD1();
  try {
    await applySql(local.database, sourceDdl);
    await applySql(local.database, await fs.readFile(ddlPath, "utf8"));
    await applySql(local.database, await fs.readFile(activationDdlPath, "utf8"));
    if (seedSource) {
      await local.database.prepare(
        "INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        source.id,
        source.emoji,
        "old_wave_label",
        JSON.stringify(source.keywords),
        source.category,
        source.subcategory,
        JSON.stringify(source.codepoints),
        source.sort_order,
      ).run();
    }
    return local;
  } catch (error) {
    await local.miniflare.dispose();
    throw error;
  }
}

async function createRelease(directory, records, previousDirectory) {
  const input = path.join(directory, "records-" + String(records.length) + ".json");
  const releases = path.join(directory, "releases");
  await fs.writeFile(input, JSON.stringify(records));
  return buildRelease(input, releases, previousDirectory);
}

async function readSingle(database, sql, bindings = []) {
  return database.prepare(sql).bind(...bindings).first();
}

test("verified release is staged, read back, and kept separate from canonical master rows", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-stage-"));
  const local = await createDatabase();
  try {
    const release = await createRelease(directory, [added, source]);
    const result = await stageEmojiMasterRelease({
      database: local.database,
      releaseDirectory: release.directory,
      maxRowsPerBatch: 1,
    });
    assert.deepEqual(result, {
      version: release.version,
      recordCount: 2,
      status: "ready",
      reused: false,
    });

    const staged = await local.database.prepare(
      "SELECT id, emoji, short_name, keywords_json, codepoints_json, ordinal FROM fanmark_emoji_master_release_staging WHERE release_version = ? ORDER BY ordinal",
    ).bind(release.version).all();
    assert.equal(staged.results.length, 2);
    assert.deepEqual(JSON.parse(staged.results[0].keywords_json), ["wave", "hello"]);
    assert.deepEqual(JSON.parse(staged.results[0].codepoints_json), ["1F44B"]);
    assert.equal(staged.results[0].ordinal, 1);

    const canonical = await local.database.prepare(
      "SELECT id, emoji, short_name FROM emoji_master ORDER BY id",
    ).all();
    assert.deepEqual(canonical.results, [{
      id: source.id,
      emoji: source.emoji,
      short_name: "old_wave_label",
    }]);

    const reused = await stageEmojiMasterRelease({
      database: local.database,
      releaseDirectory: release.directory,
    });
    assert.equal(reused.reused, true);

    await assert.rejects(
      () => local.database.prepare(
        "UPDATE fanmark_emoji_master_release_staging SET short_name = ? WHERE release_version = ? AND id = ?",
      ).bind("tampered", release.version, source.id).run(),
      /emoji_release_ready_immutable/,
    );
    const reusedAgain = await stageEmojiMasterRelease({ database: local.database, releaseDirectory: release.directory });
    assert.equal(reusedAgain.reused, true);
    const importState = await readSingle(
      local.database,
      "SELECT status FROM fanmark_emoji_master_release_imports WHERE release_version = ?",
      [release.version],
    );
    assert.equal(importState.status, "ready");
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("an interrupted chunk stays non-ready and a retry replaces partial staging safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-interrupt-"));
  const local = await createDatabase();
  try {
    const release = await createRelease(directory, [source, added, addedAgain]);
    await assert.rejects(
      () => stageEmojiMasterRelease({
        database: local.database,
        releaseDirectory: release.directory,
        maxRowsPerBatch: 1,
        hooks: {
          afterBatch: async ({ batchNumber }) => {
            if (batchNumber === 1) throw new Error("synthetic_interruption");
          },
        },
      }),
      /synthetic_interruption/,
    );
    const partial = await readSingle(
      local.database,
      "SELECT status, row_count FROM fanmark_emoji_master_release_imports WHERE release_version = ?",
      [release.version],
    );
    assert.equal(partial.status, "loading");
    assert.equal(partial.row_count, 3);
    await assert.rejects(
      () => activateEmojiMasterRelease({ database: local.database, releaseDirectory: release.directory }),
      (error) => error.code === "release_not_ready",
    );
    const partialRows = await readSingle(
      local.database,
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_staging WHERE release_version = ?",
      [release.version],
    );
    assert.equal(partialRows.count, 1);

    const result = await stageEmojiMasterRelease({
      database: local.database,
      releaseDirectory: release.directory,
      maxRowsPerBatch: 2,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.recordCount, 3);
    const staged = await local.database.prepare(
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_staging WHERE release_version = ?",
    ).bind(release.version).first();
    assert.equal(staged.count, 3);
    const canonical = await local.database.prepare("SELECT count(*) AS count FROM emoji_master").first();
    assert.equal(canonical.count, 1);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("target identity conflicts fail before any release state or staging row is written", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-conflict-"));
  const local = await createDatabase({ seedSource: false });
  try {
    await local.database.prepare(
      "INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      source.id,
      "😀",
      source.short_name,
      JSON.stringify(source.keywords),
      source.category,
      source.subcategory,
      JSON.stringify(["1F600"]),
      source.sort_order,
    ).run();
    const release = await createRelease(directory, [source, added]);
    await assert.rejects(
      () => stageEmojiMasterRelease({ database: local.database, releaseDirectory: release.directory }),
      (error) => error.code === "target_identity_conflict",
    );
    const imports = await local.database.prepare(
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_imports",
    ).first();
    const rows = await local.database.prepare(
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_staging",
    ).first();
    assert.equal(imports.count, 0);
    assert.equal(rows.count, 0);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("two verified release versions remain independently staged", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-versions-"));
  const local = await createDatabase();
  try {
    const first = await createRelease(directory, [source, added]);
    const second = await createRelease(directory, [source, added, addedAgain], first.directory);
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });

    const versions = await local.database.prepare(
      "SELECT release_version, row_count, status FROM fanmark_emoji_master_release_imports ORDER BY release_version",
    ).all();
    assert.equal(versions.results.length, 2);
    assert.deepEqual(versions.results.map((row) => row.row_count).sort(), [2, 3]);
    assert.equal(versions.results.every((row) => row.status === "ready"), true);
    const oldRows = await local.database.prepare(
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_staging WHERE release_version = ?",
    ).bind(first.version).first();
    assert.equal(oldRows.count, 2);
    const canonical = await local.database.prepare("SELECT count(*) AS count FROM emoji_master").first();
    assert.equal(canonical.count, 1);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("verified versions promote and roll back through an immutable, generation-checked pointer", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-activation-"));
  const local = await createDatabase();
  try {
    const first = await createRelease(directory, [source, added]);
    const changedSource = { ...source, short_name: "wave_updated", keywords: ["wave", "greeting"] };
    const second = await createRelease(directory, [changedSource, added], first.directory);
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });

    assert.equal(await readEmojiMasterActiveRelease(local.database), null);
    const initial = await activateEmojiMasterRelease({
      database: local.database,
      releaseDirectory: first.directory,
    });
    assert.deepEqual(initial, {
      version: first.version,
      previousVersion: null,
      generation: 1,
      changed: true,
    });
    const repeated = await activateEmojiMasterRelease({
      database: local.database,
      releaseDirectory: first.directory,
    });
    assert.deepEqual(repeated, {
      version: first.version,
      previousVersion: null,
      generation: 1,
      changed: false,
    });

    const promoted = await activateEmojiMasterRelease({
      database: local.database,
      releaseDirectory: second.directory,
    });
    assert.deepEqual(promoted, {
      version: second.version,
      previousVersion: first.version,
      generation: 2,
      changed: true,
    });

    const rollback = await activateEmojiMasterRelease({
      database: local.database,
      releaseDirectory: first.directory,
      action: "rollback",
    });
    assert.deepEqual(rollback, {
      version: first.version,
      previousVersion: second.version,
      generation: 3,
      changed: true,
    });
    const active = await readEmojiMasterActiveRelease(local.database);
    assert.equal(active.version, first.version);
    assert.equal(active.generation, 3);
    assert.deepEqual(active.records, (await verifyRelease(first.directory)).records);

    const activations = await local.database.prepare(
      "SELECT generation, action, from_version, to_version FROM fanmark_emoji_master_release_activations ORDER BY generation",
    ).all();
    assert.deepEqual(activations.results, [
      { generation: 1, action: "promotion", from_version: null, to_version: first.version },
      { generation: 2, action: "promotion", from_version: first.version, to_version: second.version },
      { generation: 3, action: "rollback", from_version: second.version, to_version: first.version },
    ]);
    await assert.rejects(
      () => local.database.prepare(
        "UPDATE fanmark_emoji_master_release_staging SET short_name = ? WHERE release_version = ? AND id = ?",
      ).bind("tampered", first.version, source.id).run(),
      /emoji_release_active_data_immutable/,
    );
    const canonical = await local.database.prepare("SELECT count(*) AS count FROM emoji_master").first();
    assert.equal(canonical.count, 1);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("ready releases are immutable and rollback refuses to lose a released identity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-rollback-guard-"));
  const local = await createDatabase();
  try {
    const first = await createRelease(directory, [source]);
    const second = await createRelease(directory, [source, added], first.directory);
    const third = await createRelease(directory, [source, added, addedAgain], second.directory);
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: third.directory });
    await activateEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });
    await activateEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });

    await assert.rejects(
      () => activateEmojiMasterRelease({
        database: local.database,
        releaseDirectory: first.directory,
        action: "rollback",
      }),
      (error) => error.code === "release_identity_break",
    );
    const activeAfterUnsafeRollback = await readEmojiMasterActiveRelease(local.database);
    assert.equal(activeAfterUnsafeRollback.version, second.version);
    assert.equal(activeAfterUnsafeRollback.generation, 2);

    await assert.rejects(
      () => local.database.prepare(
        "UPDATE fanmark_emoji_master_release_staging SET short_name = ? WHERE release_version = ? AND id = ?",
      ).bind("tampered", third.version, source.id).run(),
      /emoji_release_ready_immutable/,
    );
    await assert.rejects(
      () => local.database.prepare(
        "UPDATE fanmark_emoji_master_release_imports SET manifest_json = ? WHERE release_version = ?",
      ).bind("{}", third.version).run(),
      /emoji_release_ready_immutable/,
    );
    const promoted = await activateEmojiMasterRelease({ database: local.database, releaseDirectory: third.directory });
    assert.equal(promoted.version, third.version);
    assert.equal(promoted.generation, 3);
    const activeAfterPromotion = await readEmojiMasterActiveRelease(local.database);
    assert.equal(activeAfterPromotion.version, third.version);
    assert.equal(activeAfterPromotion.generation, 3);
    const eventCount = await local.database.prepare(
      "SELECT count(*) AS count FROM fanmark_emoji_master_release_activations",
    ).first();
    assert.equal(eventCount.count, 3);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("read-only D1 catalog pages pin a version across an active-version switch", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fanmark-emoji-master-api-"));
  const local = await createDatabase();
  const env = {
    FANMARK_DB: local.database,
    EMOJI_CATALOG_BACKEND: "d1",
    CORS_ALLOWED_ORIGINS: "https://app.example.test",
  };
  try {
    const first = await createRelease(directory, [source, added]);
    const second = await createRelease(directory, [source, added, addedAgain], first.directory);
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });
    await stageEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });
    await activateEmojiMasterRelease({ database: local.database, releaseDirectory: first.directory });

    const repository = createEmojiMasterD1Repository(env);
    const firstRequest = parseEmojiCatalogPageRequest(new URL("https://api.example.test/api/emoji/catalog?limit=1"));
    assert.ok(firstRequest);
    const firstPage = await repository.readPage(firstRequest);
    assert.deepEqual(firstPage, {
      version: first.version,
      total: 2,
      offset: 0,
      limit: 1,
      nextOffset: 1,
      items: [{
        id: source.id,
        emoji: source.emoji,
        shortName: source.short_name,
        keywords: source.keywords,
        category: source.category,
        subcategory: source.subcategory,
        codepoints: source.codepoints,
        sortOrder: source.sort_order,
      }],
    });

    await activateEmojiMasterRelease({ database: local.database, releaseDirectory: second.directory });
    const secondRequest = parseEmojiCatalogPageRequest(new URL(
      `https://api.example.test/api/emoji/catalog?version=${first.version}&offset=1&limit=1`,
    ));
    assert.ok(secondRequest);
    const secondPage = await repository.readPage(secondRequest);
    assert.equal(secondPage.version, first.version);
    assert.equal(secondPage.total, 2);
    assert.equal(secondPage.nextOffset, null);
    assert.deepEqual(secondPage.items.map((item) => item.id), [added.id]);

    assert.equal(parseEmojiCatalogPageRequest(new URL(
      `https://api.example.test/api/emoji/catalog?version=${first.version}&version=${second.version}`,
    )), null);
  } finally {
    await local.miniflare.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

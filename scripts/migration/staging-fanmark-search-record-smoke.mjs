#!/usr/bin/env node

/** Record one anonymous synthetic search through staging and remove its exact D1 projection. */

import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ACCOUNT_ID = "bfc2890741f0b3fb236e2d755b6c9adc";
const ACCOUNT_EMAIL = "fanmark.id@gmail.com";
const APP_ORIGIN = "https://fanmark-app-staging.fanmark-id.workers.dev";
const BUSINESS_DATABASE = "fanmark-business-staging";
const BUSINESS_DATABASE_ID = "d4bb0c48-f24a-491f-8693-fa393ab0b873";
const MASTER_DATABASE = "fanmark-emoji-master-staging";
const MASTER_DATABASE_ID = "160376b0-bde6-4d5f-8969-96deb5ae1183";
const APP_CONFIG = "workers/api/wrangler.app-staging.jsonc";
const WRANGLER_CLI = fileURLToPath(new URL("../../workers/api/node_modules/wrangler/bin/wrangler.js", import.meta.url));
const REQUIRED_FLAGS = [
  "--run-live-staging-write",
  `--database=${BUSINESS_DATABASE}`,
  `--account-id=${ACCOUNT_ID}`,
];
let canary;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail("wrangler_failed");
  return result;
}

function runJson(args) {
  try {
    return JSON.parse(runWrangler(args).stdout.trim());
  } catch (error) {
    if (error?.code) throw error;
    fail("wrangler_json_invalid");
  }
}

function rows(result) {
  const resultRows = result[0]?.results;
  if (!Array.isArray(resultRows)) fail("staging_d1_readback_failed");
  return resultRows;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function execute(database, statement) {
  const result = runJson([
    "d1", "execute", database, "--remote", "--json", "--command", statement, "--config", APP_CONFIG,
  ]);
  if (!Array.isArray(result) || result.some((entry) => entry?.success !== true)) fail("staging_d1_command_failed");
  return result;
}

function business(statement) {
  return execute(BUSINESS_DATABASE, statement);
}

function searchState(normalizedEmojiIds) {
  return rows(business(`
    SELECT
      (SELECT COUNT(*) FROM fanmark_discoveries WHERE normalized_emoji_ids = ${sql(normalizedEmojiIds)}) AS discoveries,
      (SELECT COUNT(*) FROM fanmark_events WHERE normalized_emoji_ids = ${sql(normalizedEmojiIds)}) AS events,
      (SELECT COALESCE(MAX(seq), 0) FROM sqlite_sequence WHERE name = 'fanmark_events') AS event_sequence;
  `))[0];
}

function assertTarget() {
  if (REQUIRED_FLAGS.some((flag) => !process.argv.includes(flag))) fail("explicit_staging_write_flags_required");
  const config = JSON.parse(readFileSync(APP_CONFIG, "utf8"));
  const databases = [
    ["FANMARK_DB", BUSINESS_DATABASE, BUSINESS_DATABASE_ID],
    ["MASTER_DB", MASTER_DATABASE, MASTER_DATABASE_ID],
  ];
  const limiter = config.ratelimits?.find((entry) => entry.name === "FANMARK_SEARCH_LIMITER");
  if (config.name !== "fanmark-app-staging" || config.workers_dev !== true || config.routes?.length ||
      config.custom_domains?.length || config.vars?.D1_TOPOLOGY !== "split" ||
      config.vars?.FANMARK_SEARCH_BACKEND !== "d1" ||
      !config.vars?.CORS_ALLOWED_ORIGINS?.split(",").includes(APP_ORIGIN) ||
      limiter?.simple?.limit !== 120 || limiter.simple.period !== 60) fail("staging_target_mismatch");
  for (const [binding, name, id] of databases) {
    const actual = config.d1_databases?.find((entry) => entry.binding === binding);
    if (actual?.database_name !== name || actual.database_id !== id) fail("staging_database_config_mismatch");
  }

  const identity = runJson(["whoami", "--json"]);
  if (!identity.loggedIn || identity.email !== ACCOUNT_EMAIL ||
      !identity.accounts?.some((account) => account.id === ACCOUNT_ID)) fail("cloudflare_account_mismatch");
  const listed = runJson(["d1", "list", "--json"]);
  for (const [, name, id] of databases) {
    if (!listed.some((database) =>
      (database.uuid ?? database.database_id ?? database.id) === id &&
      (database.name ?? database.database_name) === name)) fail("cloudflare_database_mismatch");
  }
}

function hasSkinTone(codepointsJson) {
  let codepoints;
  try {
    codepoints = JSON.parse(codepointsJson);
  } catch {
    fail("staging_master_codepoints_invalid");
  }
  if (!Array.isArray(codepoints) || codepoints.some((point) => typeof point !== "string")) {
    fail("staging_master_codepoints_invalid");
  }
  return codepoints.some((point) => {
    const codepoint = Number.parseInt(point, 16);
    return codepoint >= 0x1f3fb && codepoint <= 0x1f3ff;
  });
}

function chooseUnusedEmoji() {
  const candidates = rows(execute(MASTER_DATABASE, `
    SELECT record.id, record.codepoints_json AS codepoints_json
    FROM fanmark_emoji_master_active_release AS active
    JOIN fanmark_emoji_master_release_staging AS record ON record.release_version = active.release_version
    WHERE active.singleton_id = 1
    ORDER BY RANDOM()
    LIMIT 64;
  `)).filter((row) => typeof row.id === "string" && !hasSkinTone(row.codepoints_json));
  const distinctCandidates = [...new Map(candidates.map((candidate) => [candidate.id.toLowerCase(), candidate])).values()];
  if (distinctCandidates.length < 3) fail("insufficient_staging_master_search_candidates");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const pool = [...distinctCandidates];
    const emojiIds = [];
    while (emojiIds.length < 3) {
      const [candidate] = pool.splice(randomInt(pool.length), 1);
      emojiIds.push(candidate.id.toLowerCase());
    }
    const rawJson = JSON.stringify(emojiIds);
    // All selected records omit skin tones, so normalization preserves these exact IDs.
    const normalizedJson = JSON.stringify(emojiIds);
    const state = searchState(normalizedJson);
    if (Number(state.discoveries) === 0 && Number(state.events) === 0) {
      return { emojiIds, rawJson, normalizedJson, sequenceBefore: Number(state.event_sequence) };
    }
  }
  fail("no_unused_staging_emoji_search_candidate");
}

async function request(path, init = {}) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { Origin: APP_ORIGIN, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

function readCanaryRows() {
  if (!canary) return { discoveries: [], events: [] };
  const discoveries = rows(business(`
    SELECT id, emoji_ids, normalized_emoji_ids, search_count, favorite_count, fanmark_id
    FROM fanmark_discoveries WHERE normalized_emoji_ids = ${sql(canary.normalizedJson)} LIMIT 2;
  `));
  const events = discoveries.length === 1
    ? rows(business(`
        SELECT id, event_type, user_id, discovery_id, normalized_emoji_ids
        FROM fanmark_events WHERE discovery_id = ${sql(discoveries[0].id)} LIMIT 3;
      `))
    : rows(business(`
        SELECT id, event_type, user_id, discovery_id, normalized_emoji_ids
        FROM fanmark_events WHERE normalized_emoji_ids = ${sql(canary.normalizedJson)} LIMIT 3;
      `));
  return { discoveries, events };
}

async function cleanup() {
  if (!canary) return;
  const { discoveries, events } = readCanaryRows();
  if (discoveries.length > 1 || events.length > 1) fail("synthetic_search_cleanup_collision");
  if (discoveries.length === 1) {
    const discovery = discoveries[0];
    if (discovery.emoji_ids !== canary.rawJson || discovery.normalized_emoji_ids !== canary.normalizedJson ||
        Number(discovery.search_count) !== 1 || Number(discovery.favorite_count) !== 0 || discovery.fanmark_id !== null) {
      fail("synthetic_search_cleanup_identity_mismatch");
    }
    const favorites = rows(business(`
      SELECT COUNT(*) AS count FROM fanmark_favorites WHERE discovery_id = ${sql(discovery.id)};
    `));
    if (Number(favorites[0]?.count) !== 0) fail("synthetic_search_cleanup_has_favorite");
    if (events.length === 1) {
      const event = events[0];
      if (Number(event.id) < 1 || event.event_type !== "search" || event.user_id !== null ||
          event.discovery_id !== discovery.id || event.normalized_emoji_ids !== canary.normalizedJson) {
        fail("synthetic_search_event_cleanup_identity_mismatch");
      }
      const deleteEvent = business(`
        DELETE FROM fanmark_events
        WHERE id = ${Number(event.id)} AND event_type = 'search' AND user_id IS NULL
          AND discovery_id = ${sql(discovery.id)} AND normalized_emoji_ids = ${sql(canary.normalizedJson)};
      `);
      if (Number(deleteEvent[0]?.meta?.changes) !== 1) fail("synthetic_search_event_cleanup_failed");
    }
    const deleteDiscovery = business(`
      DELETE FROM fanmark_discoveries
      WHERE id = ${sql(discovery.id)} AND emoji_ids = ${sql(canary.rawJson)}
        AND normalized_emoji_ids = ${sql(canary.normalizedJson)} AND search_count = 1
        AND favorite_count = 0 AND fanmark_id IS NULL;
    `);
    if (Number(deleteDiscovery[0]?.meta?.changes) !== 1) fail("synthetic_search_discovery_cleanup_failed");
  } else if (events.length !== 0) {
    fail("synthetic_search_orphan_event_detected");
  }

  const after = searchState(canary.normalizedJson);
  if (Number(after.discoveries) !== 0 || Number(after.events) !== 0) fail("synthetic_search_cleanup_readback_failed");
  canary.sequenceAfter = Number(after.event_sequence);
  if (canary.sequenceAfter < canary.sequenceBefore) fail("staging_event_sequence_regressed");
}

async function main() {
  assertTarget();
  canary = chooseUnusedEmoji();

  const options = await request("/api/fanmarks/search/record", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), APP_ORIGIN);

  const rejectedOrigin = await fetch(`${APP_ORIGIN}/api/fanmarks/search/record`, {
    method: "POST",
    headers: { Origin: "https://invalid-origin.example", "content-type": "application/json" },
    body: JSON.stringify({ input_emoji_ids: canary.emojiIds }),
  });
  assert.equal(rejectedOrigin.status, 403);
  if (Number(searchState(canary.normalizedJson).discoveries) !== 0) fail("untrusted_origin_wrote_search");

  const malformed = await request("/api/fanmarks/search/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input_emoji_ids: ["not-a-uuid"] }),
  });
  assert.equal(malformed.status, 400);

  const response = await request("/api/fanmarks/search/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input_emoji_ids: canary.emojiIds }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { schemaVersion: 1, recorded: true });

  const { discoveries, events } = readCanaryRows();
  if (discoveries.length !== 1 || events.length !== 1) fail("synthetic_search_readback_count_mismatch");
  assert.equal(discoveries[0].emoji_ids, canary.rawJson);
  assert.equal(discoveries[0].normalized_emoji_ids, canary.normalizedJson);
  assert.equal(Number(discoveries[0].search_count), 1);
  assert.equal(Number(discoveries[0].favorite_count), 0);
  assert.equal(discoveries[0].fanmark_id, null);
  assert.equal(events[0].event_type, "search");
  assert.equal(events[0].user_id, null);
  assert.equal(events[0].discovery_id, discoveries[0].id);
  assert.equal(events[0].normalized_emoji_ids, canary.normalizedJson);
}

let primaryError;
try {
  await main();
} catch (error) {
  primaryError = error;
}

try {
  await cleanup();
} catch (error) {
  if (primaryError) {
    process.stderr.write("synthetic_search_cleanup_failed_after_test_error\n");
  } else {
    primaryError = error;
  }
}

if (primaryError) {
  process.stderr.write(`${primaryError.code ?? "search_record_staging_smoke_failed"}\n`);
  process.exitCode = 1;
} else {
  const sequenceNote = canary.sequenceAfter > canary.sequenceBefore ? " staging_event_sequence_advanced=true" : "";
  process.stdout.write(`fanmark_search_record_staging_smoke=passed discoveries_after_cleanup=0 events_after_cleanup=0${sequenceNote}\n`);
}

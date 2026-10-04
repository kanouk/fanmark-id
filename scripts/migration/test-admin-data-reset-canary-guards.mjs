import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { assertResetCanaryEmptyCounts, buildResetCanaryDeleteGuards, RESET_TABLES } from "./admin-data-reset-canary-guards.mjs";

test("a reset canary requires the exact eight-table scope, valid generated IDs and a bounded namespace", () => {
  const ids = Object.fromEntries(RESET_TABLES.map(table => [table, randomUUID()]));
  const guards = buildResetCanaryDeleteGuards(randomUUID(), ids);
  assert.equal(guards.triggerNames.length, 8);
  assert.equal(new Set(guards.triggerNames).size, 8);
  for (const table of RESET_TABLES) assert.ok(guards.createSql.includes(`ON ${table} WHEN OLD.id <> '${ids[table]}'`));
  assert.throws(() => buildResetCanaryDeleteGuards("unsafe'nonce", ids));
  assert.throws(() => buildResetCanaryDeleteGuards(randomUUID(), { ...ids, fanmarks: "unsafe'id" }));
  assert.throws(() => buildResetCanaryDeleteGuards(randomUUID(), { ...ids, user_settings: randomUUID() }));
});

test("a reset canary refuses existing rows, unknown tables, string counts and missing counts", () => {
  const counts = Object.fromEntries(RESET_TABLES.map(table => [table, 0]));
  assertResetCanaryEmptyCounts(counts);
  for (const table of RESET_TABLES) assert.throws(() => assertResetCanaryEmptyCounts({ ...counts, [table]: 1 }));
  assert.throws(() => assertResetCanaryEmptyCounts({ ...counts, fanmarks: "0" }));
  assert.throws(() => assertResetCanaryEmptyCounts({ ...counts, user_settings: 0 }));
  const missing = { ...counts }; delete missing.fanmarks;
  assert.throws(() => assertResetCanaryEmptyCounts(missing));
});

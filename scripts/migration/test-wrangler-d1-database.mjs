import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createWranglerD1Database,
  renderWranglerD1Sql,
} from "./wrangler-d1-database.mjs";

test("renders only supported D1 literals and preserves text safely", () => {
  assert.equal(
    renderWranglerD1Sql("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", ["a' OR 1=1 --", null, 42]),
    "INSERT INTO t (a, b, c) VALUES ('a'' OR 1=1 --', NULL, 42)",
  );
  assert.throws(() => renderWranglerD1Sql("SELECT 1; DROP TABLE t"), /d1_sql_statement_invalid/);
  assert.throws(() => renderWranglerD1Sql("SELECT ?", []), /d1_sql_binding_count_mismatch/);
  assert.throws(() => renderWranglerD1Sql("SELECT ?", [NaN]), /d1_sql_unsupported_value/);
});

test("adapts Wrangler JSON read, write, and batch results to the D1 binding shape", async () => {
  const calls = [];
  const responses = [
    [{ results: [{ id: "a" }], success: true, meta: {} }],
    [
      { results: [], success: true, meta: {} },
      { results: [{ change_count: 1 }], success: true, meta: {} },
    ],
    [
      { results: [], success: true, meta: {} },
      { results: [], success: true, meta: {} },
    ],
  ];
  const database = createWranglerD1Database({
    wranglerPath: "/unused/wrangler",
    configPath: "/unused/wrangler.jsonc",
    execute(sql) {
      calls.push(sql);
      return responses.shift();
    },
  });

  assert.deepEqual(await database.prepare("SELECT id FROM t WHERE id = ?").bind("a").all(), {
    results: [{ id: "a" }], success: true, meta: {},
  });
  assert.deepEqual(await database.prepare("UPDATE t SET value = ? WHERE id = ?").bind("b", "a").run(), {
    success: true,
    meta: { changes: 1 },
  });
  const batch = await database.batch([
    database.prepare("DELETE FROM t WHERE id = ?").bind("a"),
    database.prepare("INSERT INTO t (id) VALUES (?)").bind("b"),
  ]);
  assert.equal(batch.length, 2);
  assert.equal(calls[1], "UPDATE t SET value = 'b' WHERE id = 'a'; SELECT changes() AS change_count");
  assert.equal(calls[2], "DELETE FROM t WHERE id = 'a'; INSERT INTO t (id) VALUES ('b')");
});

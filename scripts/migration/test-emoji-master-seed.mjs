import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanonicalEmojiMasterInsert, utcMicrosecondTimestamp } from "./emoji-master-seed.mjs";

test("generates one fixed-width UTC microsecond timestamp for a canonical seed row", () => {
  assert.equal(
    utcMicrosecondTimestamp(new Date("2026-10-02T04:30:12.345Z")),
    "2026-10-02T04:30:12.345000Z",
  );
});

test("binds both master timestamps explicitly after the canonical catalog fields", () => {
  const importedAt = "2026-10-02T04:30:12.345000Z";
  const statement = buildCanonicalEmojiMasterInsert({
    id: "synthetic-emoji-id",
    emoji: "🧪",
    short_name: "test tube",
    keywords: ["science", "lab"],
    category: "objects",
    subcategory: "science",
    codepoints: ["1f9ea"],
    sort_order: 1,
  }, importedAt);

  assert.match(statement.sql, /^INSERT INTO emoji_master\s*\(/u);
  assert.match(statement.sql, /created_at, updated_at\)\s+VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/u);
  assert.deepEqual(statement.bindings, [
    "synthetic-emoji-id", "🧪", "test tube", '["science","lab"]', "objects", "science",
    '["1f9ea"]', 1, importedAt, importedAt,
  ]);
  assert.ok(Object.isFrozen(statement));
  assert.ok(Object.isFrozen(statement.bindings));
});

test("rejects invalid timestamp precision and malformed release rows", () => {
  const row = { keywords: [], codepoints: [] };
  assert.throws(() => buildCanonicalEmojiMasterInsert(row, "2026-10-02T04:30:12.345Z"),
    (error) => error.message === "canonical_catalog_timestamp_invalid");
  assert.throws(() => buildCanonicalEmojiMasterInsert(row, "2026-02-31T04:30:12.345000Z"),
    (error) => error.message === "canonical_catalog_timestamp_invalid");
  assert.throws(() => buildCanonicalEmojiMasterInsert({ keywords: "not-array", codepoints: [] },
    "2026-10-02T04:30:12.345000Z"),
    (error) => error.message === "canonical_catalog_record_invalid");
  assert.throws(() => utcMicrosecondTimestamp("2026-10-02T04:30:12.345Z"),
    (error) => error.message === "canonical_catalog_clock_invalid");
});

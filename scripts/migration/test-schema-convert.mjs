#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { convertSchema, validateDistinctPaths } from "./schema-convert.mjs";

function column(table_name, column_name, ordinal, postgres_type, options = {}) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: options.type_schema ?? "pg_catalog",
    type_name: options.type_name ?? postgres_type,
    type_kind: options.type_kind ?? "b",
    not_null: options.not_null ?? false,
    default_expression: options.default_expression ?? null,
    identity: options.identity ?? "",
    generated: options.generated ?? "",
    collation: options.collation ?? null,
  };
}

function constraint(table_name, name, kind, definition, options = {}) {
  return {
    table_name,
    name,
    kind,
    definition,
    validated: options.validated ?? true,
    deferrable: options.deferrable ?? false,
    initially_deferred: options.initially_deferred ?? false,
  };
}

function index(table_name, name, definition, options = {}) {
  return {
    table_name,
    name,
    definition,
    valid: options.valid ?? true,
    unique: options.unique ?? false,
    primary: options.primary ?? false,
  };
}

function fixture() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("child", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("child", "parent_id", 2, "uuid", { not_null: true }),
      column("child", "note", 3, "text"),
      column("fanmark_lottery_entries", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("fanmark_lottery_entries", "lottery_probability", 2, "numeric", { default_expression: "1.0" }),
      column("fanmark_tiers", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("fanmark_tiers", "monthly_price_usd", 2, "numeric(10,2)", { default_expression: "0" }),
      column("parent", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("parent", "enabled", 2, "boolean", { default_expression: "true" }),
      column("parent", "metadata", 3, "jsonb", { default_expression: "'{}'::jsonb" }),
      column("parent", "tags", 4, "text[]", { default_expression: "'{}'::text[]" }),
      column("parent", "optional_smallint", 5, "smallint"),
      column("parent", "optional_integer", 6, "integer"),
      column("parent", "optional_bigint", 7, "bigint"),
    ],
    constraints: [
      constraint("child", "child_pkey", "p", "PRIMARY KEY (id)"),
      constraint("child", "child_parent_fkey", "f", "FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE"),
      constraint("child", "child_auth_fkey", "f", "FOREIGN KEY (parent_id) REFERENCES auth.users(id) ON DELETE CASCADE"),
      constraint("child", "child_note_check", "c", "CHECK (note = 'x::text ANY (ARRAY[x]) char_length('::text OR note IS NULL)"),
      constraint("child", "child_numeric_cast_check", "c", "CHECK (note = 1.5::numeric)"),
      constraint("child", "child_parent_key", "u", "UNIQUE (parent_id) NULLS NOT DISTINCT"),
      constraint("fanmark_lottery_entries", "fanmark_lottery_entries_pkey", "p", "PRIMARY KEY (id)"),
      constraint("fanmark_lottery_entries", "positive_probability", "c", "CHECK (lottery_probability > 0::numeric)"),
      constraint("fanmark_tiers", "fanmark_tiers_pkey", "p", "PRIMARY KEY (id)"),
      constraint("parent", "parent_enabled_check", "c", "CHECK (enabled = true)"),
      constraint("parent", "parent_numeric_cast_check", "c", "CHECK (enabled = 1.5::integer)"),
      constraint("parent", "parent_metadata_check", "c", "CHECK (lower(metadata) = '{}')"),
      constraint("parent", "parent_pkey", "p", "PRIMARY KEY (id)"),
    ],
    indexes: [
      index("child", "child_note_idx", "CREATE INDEX child_note_idx ON public.child USING btree (note)"),
      index("parent", "parent_enabled_idx", "CREATE INDEX parent_enabled_idx ON public.parent USING btree (enabled) WHERE (enabled = true)"),
      index("parent", "parent_tags_gin", "CREATE INDEX parent_tags_gin ON public.parent USING gin (tags)"),
      index("parent", "parent_tags_expr", "CREATE UNIQUE INDEX parent_tags_expr ON public.parent USING btree (seq_key(tags))"),
    ],
    enums: [
      { type_name: "app_role", value: "admin", sort_order: 1 },
      { type_name: "app_role", value: "user", sort_order: 2 },
    ],
    triggers: [],
    rls_policies: [],
    views: [],
    functions: [],
  };
}

function gateCodes(report) {
  return new Set(report.gates.map((gate) => gate.code));
}

test("conversion is deterministic and exposes exact target codecs", () => {
  const input = fixture();
  const first = convertSchema(input);
  const second = convertSchema(input);
  assert.equal(first.sql, second.sql);
  assert.deepEqual(first.report, second.report);

  assert.equal(first.report.target.tableCount, 4);
  assert.equal(first.report.target.columnCount, 14);
  assert.deepEqual(first.report.target.translatedConstraints, { p: 4, u: 0, f: 1, c: 2 });
  assert.equal(first.report.target.translatedIndexCount, 2);
  assert.deepEqual(
    first.report.target.columnCodecs.find((entry) => entry.table === "fanmark_tiers" && entry.column === "monthly_price_usd"),
    {
      table: "fanmark_tiers",
      column: "monthly_price_usd",
      sourceType: "numeric(10,2)",
      targetType: "INTEGER",
      codec: "money-cents-int64",
    },
  );
  assert.deepEqual(
    first.report.target.columnCodecs.find((entry) => entry.table === "fanmark_lottery_entries" && entry.column === "lottery_probability"),
    {
      table: "fanmark_lottery_entries",
      column: "lottery_probability",
      sourceType: "numeric",
      targetType: "TEXT",
      codec: "decimal-canonical-text",
    },
  );
  assert.match(first.sql, /"monthly_price_usd" INTEGER DEFAULT 0/);
  assert.match(first.sql, /"enabled" IS NULL OR \(typeof\("enabled"\) = 'integer'/);
  assert.match(first.sql, /FOREIGN KEY \("parent_id"\) REFERENCES "parent" \("id"\) ON DELETE CASCADE/);
  assert.match(first.sql, /CREATE INDEX "parent_enabled_idx" ON "parent" \("enabled"\) WHERE \(enabled = true\);/);
  assert.match(first.sql, /CHECK \(note = 'x::text ANY \(ARRAY\[x\]\) char_length\(' OR note IS NULL\)/);
  assert.doesNotMatch(first.sql, /lottery_probability > 0/);
  assert.doesNotMatch(first.sql, /1\.5/);

  const codes = gateCodes(first.report);
  for (const expected of [
    "external_foreign_key",
    "money_cents_import",
    "decimal_import_validation",
    "representation_sensitive_check",
    "unsupported_check_constraint",
    "unsupported_constraint",
    "unsupported_index_method",
    "unsupported_index_expression",
    "uuid_default_requires_operation",
  ]) {
    assert.ok(codes.has(expected), `missing gate ${expected}`);
  }
  assert.equal(first.report.deployable, false);
});

test("generated synthetic SQL is accepted by SQLite while retaining blocking gates", () => {
  const result = convertSchema(fixture());
  execFileSync("sqlite3", [":memory:"], { input: result.sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO parent (id, enabled, optional_smallint, optional_integer, optional_bigint) VALUES ('id', NULL, NULL, NULL, NULL);\nINSERT INTO parent (id, enabled, optional_smallint, optional_integer, optional_bigint) VALUES ('id-valid', 1, 2, 3, 4);\nINSERT INTO fanmark_tiers (id, monthly_price_usd) VALUES ('tier-null', NULL);\nINSERT INTO fanmark_tiers (id, monthly_price_usd) VALUES ('tier-valid', 123);`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.throws(() => {
    execFileSync("sqlite3", [":memory:"], {
      input: `${result.sql}\nINSERT INTO parent (id, enabled, optional_smallint, optional_integer, optional_bigint) VALUES ('id-real', 1.5, 2, 3, 4);`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
  assert.throws(() => {
    execFileSync("sqlite3", [":memory:"], {
      input: `${result.sql}\nINSERT INTO parent (id, optional_smallint) VALUES ('id', 1.5);`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
  assert.throws(() => {
    execFileSync("sqlite3", [":memory:"], {
      input: `${result.sql}\nINSERT INTO parent (id, optional_integer) VALUES ('id', 1.5);`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
  assert.throws(() => {
    execFileSync("sqlite3", [":memory:"], {
      input: `${result.sql}\nINSERT INTO parent (id, optional_bigint) VALUES ('id', 1.5);`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
  assert.throws(() => {
    execFileSync("sqlite3", [":memory:"], {
      input: `${result.sql}\nINSERT INTO fanmark_tiers (id, monthly_price_usd) VALUES ('id', 1.5);`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });
});

test("missing scope and malformed catalog details remain explicit", () => {
  const input = fixture();
  delete input.triggers;
  const result = convertSchema(input);
  assert.ok(gateCodes(result.report).has("missing_catalog_scope"));

  const unsafe = fixture();
  unsafe.columns[0].column_name = "id;DROP";
  assert.throws(() => convertSchema(unsafe), (error) => error.code === "unsafe_catalog_column_name");

  const orphan = fixture();
  orphan.constraints.push(constraint("missing_table", "missing_pkey", "p", "PRIMARY KEY (id)"));
  orphan.indexes.push(index("missing_table", "missing_idx", "CREATE INDEX missing_idx ON public.missing_table USING btree (id)"));
  const orphanReport = convertSchema(orphan).report;
  assert.ok(gateCodes(orphanReport).has("orphan_catalog_constraint"));
  assert.ok(gateCodes(orphanReport).has("orphan_catalog_index"));

  const duplicateOrdinal = fixture();
  duplicateOrdinal.columns.push(column("parent", "another", 1, "text"));
  assert.throws(() => convertSchema(duplicateOrdinal), (error) => error.code === "duplicate_catalog_ordinal");

  const duplicateConstraint = fixture();
  duplicateConstraint.constraints.push(constraint("parent", "parent_pkey", "u", "UNIQUE (enabled)"));
  assert.throws(() => convertSchema(duplicateConstraint), (error) => error.code === "duplicate_catalog_constraint_name");

  const duplicateIndex = fixture();
  duplicateIndex.indexes.push(index("parent", "parent_enabled_idx", "CREATE INDEX parent_enabled_idx_2 ON public.parent USING btree (tags)"));
  assert.throws(() => convertSchema(duplicateIndex), (error) => error.code === "duplicate_catalog_index_name");

  assert.throws(() => validateDistinctPaths("./catalog.json", "./catalog.json", "./report.json"), (error) => error.code === "output_paths_must_differ");
});

test("present catalog scopes and parenthesized enum comparisons cannot imply parity", () => {
  const input = fixture();
  input.columns.push(column("parent", "role", 8, "app_role", { type_kind: "e", type_schema: "public", type_name: "app_role" }));
  input.constraints.push(constraint("parent", "role_order", "c", "CHECK ((role) > 'admin'::app_role)"));
  input.triggers = [{ name: "untranslated_trigger" }];
  const result = convertSchema(input);
  assert.equal(result.report.deployable, false);
  assert.ok(result.report.gates.some(gate => gate.code === "unsupported_catalog_scope" && gate.locations.some(location => location.name === "triggers")));
  assert.ok(result.report.gates.some(gate => gate.code === "representation_sensitive_check" && gate.locations.some(location => location.name === "role_order")));
  assert.doesNotMatch(result.sql, /CONSTRAINT "role_order"/);
  assert.match(result.sql, /"role" IN \('admin', 'user'\)/);
});

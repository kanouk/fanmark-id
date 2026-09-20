#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { buildRowPlan, compileRowConverter, convertRowEnvelope } from "./row-conversion.mjs";

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
    identity: "",
    generated: "",
    collation: null,
  };
}

function catalog() {
  const table = "fanmark_tiers";
  const definitions = [
    ["id", "uuid"],
    ["label", "text"],
    ["nullable_text", "text"],
    ["enabled", "boolean"],
    ["small_value", "smallint"],
    ["integer_value", "integer"],
    ["bigint_value", "bigint"],
    ["monthly_price_usd", "numeric(10,2)"],
    ["lottery_probability", "numeric"],
    ["happened_at", "timestamp with time zone"],
    ["calendar_day", "date"],
    ["payload", "jsonb"],
    ["text_values", "text[]"],
    ["uuid_values", "uuid[]"],
    ["small_values", "smallint[]"],
  ];
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      ...definitions.map(([name, type], index) => column(table, name, index + 1, type, { not_null: name === "id" })),
      column(table, "role", definitions.length + 1, "app_role", { type_schema: "public", type_name: "app_role", type_kind: "e" }),
    ],
    constraints: [],
    indexes: [],
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

function envelope() {
  return {
    schemaVersion: 1,
    table: "fanmark_tiers",
    columns: [
      "id",
      "label",
      "nullable_text",
      "enabled",
      "small_value",
      "integer_value",
      "bigint_value",
      "monthly_price_usd",
      "lottery_probability",
      "happened_at",
      "calendar_day",
      "payload",
      "text_values",
      "uuid_values",
      "small_values",
      "role",
    ],
    values: {
      id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
      label: "null",
      nullable_text: null,
      enabled: "t",
      small_value: "-32768",
      integer_value: "2147483647",
      bigint_value: "9007199254740991",
      monthly_price_usd: "12.30",
      lottery_probability: "0.12345678901234567890123456789",
      happened_at: "2026-09-21T00:00:00.123456Z",
      calendar_day: "2024-02-29",
      payload: "null",
      text_values: "[]",
      uuid_values: null,
      small_values: "[1,null,-32768,32767]",
      role: "admin",
    },
    arrayMetadata: {
      text_values: { isNull: false, ndims: 0, lowerBound: null },
      uuid_values: { isNull: true, ndims: null, lowerBound: null },
      small_values: { isNull: false, ndims: 1, lowerBound: 1 },
    },
  };
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

test("projection is catalog ordered and uses exact PostgreSQL text expressions", () => {
  const plan = buildRowPlan(catalog(), "fanmark_tiers");
  assert.equal(plan.schemaVersion, 1);
  assert.deepEqual(plan.arrayColumns, ["text_values", "uuid_values", "small_values"]);
  assert.match(plan.sql, /to_char\("happened_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\)/);
  assert.match(plan.sql, /"happened_at" >= TIMESTAMPTZ '0001-01-01 00:00:00\+00'/);
  assert.match(plan.sql, /"happened_at" < TIMESTAMPTZ '10000-01-01 00:00:00\+00'/);
  assert.match(plan.sql, /to_char\("calendar_day", 'YYYY-MM-DD'\)/);
  assert.match(plan.sql, /"calendar_day" >= DATE '0001-01-01'/);
  assert.match(plan.sql, /"calendar_day" < DATE '10000-01-01'/);
  assert.match(plan.sql, /array_to_json\("text_values"\)::text/);
  assert.match(plan.sql, /jsonb_object_agg\(row_values\.column_name, row_values\.column_text\)/);
  assert.match(plan.sql, /'arrayMetadata'/);
  assert.match(plan.sql, /FROM "public"\."fanmark_tiers";/);
  assert.match(plan.sql, /AS "__fanmark_row_envelope"/);
  assert.doesNotMatch(plan.sql, /new Date|JSON\.parse/);
});

test("all supported values convert to ordered bindings and survive real SQLite readback", () => {
  const source = catalog();
  const compiled = compileRowConverter(source, "fanmark_tiers");
  assert.equal(compiled.plan.table, "fanmark_tiers");
  const converted = compiled(envelope());
  assert.deepEqual(converted.columns, envelope().columns);
  assert.deepEqual(converted.bindings, [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "null",
    null,
    1,
    -32768,
    2147483647,
    9007199254740991,
    1230,
    "0.12345678901234567890123456789",
    "2026-09-21T00:00:00.123456Z",
    "2024-02-29",
    "null",
    "[]",
    null,
    "[1,null,-32768,32767]",
    "admin",
  ]);

  const names = converted.columns.map((name) => `"${name}"`).join(", ");
  const schema = [
    'CREATE TABLE "fanmark_tiers" (',
    '"id" TEXT, "label" TEXT, "nullable_text" TEXT, "enabled" INTEGER,',
    '"small_value" INTEGER, "integer_value" INTEGER, "bigint_value" INTEGER,',
    '"monthly_price_usd" INTEGER, "lottery_probability" TEXT, "happened_at" TEXT,',
    '"calendar_day" TEXT, "payload" TEXT, "text_values" TEXT, "uuid_values" TEXT,',
    '"small_values" TEXT, "role" TEXT);',
  ].join("\n");
  const insert = `INSERT INTO "fanmark_tiers" (${names}) VALUES (${converted.bindings.map(sqlLiteral).join(", ")});`;
  const output = execFileSync("sqlite3", ["-json", ":memory:"], {
    input: `${schema}\n${insert}\nSELECT * FROM "fanmark_tiers";`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const [row] = JSON.parse(output);
  assert.equal(row.id, converted.bindings[0]);
  assert.equal(row.label, "null");
  assert.equal(row.nullable_text, null);
  assert.equal(row.enabled, 1);
  assert.equal(row.monthly_price_usd, 1230);
  assert.equal(row.lottery_probability, "0.12345678901234567890123456789");
  assert.equal(row.payload, "null");
  assert.equal(row.text_values, "[]");
  assert.equal(row.uuid_values, null);
  assert.equal(row.small_values, "[1,null,-32768,32767]");
});

test("extra or missing fields, enum values, bigint range, and array shape fail closed", () => {
  const source = catalog();
  const missing = structuredClone(envelope());
  delete missing.values.label;
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", missing), (error) => error.code === "row_values_columns_mismatch");

  const extra = structuredClone(envelope());
  extra.values.extra = "unexpected";
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", extra), (error) => error.code === "row_values_columns_mismatch");

  const reordered = structuredClone(envelope());
  reordered.columns.reverse();
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", reordered), (error) => error.code === "row_column_order_mismatch");

  const invalidEnum = structuredClone(envelope());
  invalidEnum.values.role = "owner";
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", invalidEnum), (error) => error.code === "invalid_enum_label");

  const unsafeBigint = structuredClone(envelope());
  unsafeBigint.values.bigint_value = "9007199254740992";
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", unsafeBigint), (error) => error.code === "invalid_column_value");

  const multidimensional = structuredClone(envelope());
  multidimensional.values.small_values = "[[1],[2]]";
  multidimensional.arrayMetadata.small_values = { isNull: false, ndims: 2, lowerBound: 1 };
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", multidimensional), (error) => error.code === "invalid_column_value");

  const badLowerBound = structuredClone(envelope());
  badLowerBound.arrayMetadata.small_values.lowerBound = 2;
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", badLowerBound), (error) => error.code === "array_shape_unsupported");

  const badNullMetadata = structuredClone(envelope());
  badNullMetadata.arrayMetadata.uuid_values.isNull = false;
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", badNullMetadata), (error) => error.code === "array_null_metadata_mismatch");

  const forbiddenNull = structuredClone(envelope());
  forbiddenNull.values.id = null;
  forbiddenNull.arrayMetadata = structuredClone(envelope().arrayMetadata);
  assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", forbiddenNull), (error) => error.code === "null_forbidden");

  for (const invalidTimestamp of [
    "0000-01-01T00:00:00.000000Z",
    "infinity",
    "0001-01-01 00:00:00+00 BC",
    "10000-01-01T00:00:00.000000Z",
  ]) {
    const candidate = structuredClone(envelope());
    candidate.values.happened_at = invalidTimestamp;
    assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", candidate), (error) => error.code === "invalid_column_value");
  }

  for (const invalidDate of ["0000-01-01", "infinity", "0001-01-01 BC", "10000-01-01"]) {
    const candidate = structuredClone(envelope());
    candidate.values.calendar_day = invalidDate;
    assert.throws(() => convertRowEnvelope(source, "fanmark_tiers", candidate), (error) => error.code === "invalid_column_value");
  }
});

test("unknown catalog codecs fail before a partial row plan is emitted", () => {
  const source = catalog();
  source.columns.push(column("unsupported", "raw", 1, "bytea"));
  assert.throws(() => buildRowPlan(source, "fanmark_tiers"), (error) => error.code === "unsupported_codec");
});

test("a non-money numeric(10,2) codec cannot reuse the cents converter", () => {
  const source = catalog();
  source.columns.push(column("fanmark_tiers", "non_money_scale", 17, "numeric(10,2)"));
  assert.throws(() => buildRowPlan(source, "fanmark_tiers"), (error) => error.code === "unsupported_type");
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  buildRowPlan,
  compileRowConverter,
} from "../../../scripts/migration/row-conversion.mjs";

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
    default_expression: null,
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
      column(table, "role", definitions.length + 1, "app_role", {
        type_schema: "public",
        type_name: "app_role",
        type_kind: "e",
      }),
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

const setupSql = `
  create type public.app_role as enum ('admin', 'user');
  create table public.fanmark_tiers (
    id uuid not null,
    label text,
    nullable_text text,
    enabled boolean,
    small_value smallint,
    integer_value integer,
    bigint_value bigint,
    monthly_price_usd numeric(10,2),
    lottery_probability numeric,
    happened_at timestamptz,
    calendar_day date,
    payload jsonb,
    text_values text[],
    uuid_values uuid[],
    small_values smallint[],
    role public.app_role
  );
  insert into public.fanmark_tiers (
    id, label, enabled, small_value, integer_value, bigint_value,
    monthly_price_usd, lottery_probability, happened_at, calendar_day,
    payload, text_values, uuid_values, small_values, role
  ) values
    (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'normal', true, -32768,
      2147483647, 9007199254740991, 12.30, 0.12345678901234567890123456789,
      '2024-02-29 12:34:56.123456+09', '2024-02-29',
      '{"price":123.4500,"value":null}', ARRAY['x', null]::text[],
      ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], ARRAY[1, null, -2]::smallint[], 'admin'
    ),
    (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'null-values', null, null,
      null, null, null, null, null, null, null, null, null, null, null
    ),
    (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'empty-arrays', false, 0,
      0, 0, 0.00, 0, '2024-02-29 00:00:00+00', '2024-02-29',
      'null', '{}'::text[], '{}'::uuid[], '{}'::smallint[], 'user'
    );
  insert into public.fanmark_tiers (id, label, happened_at, calendar_day)
  values
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bc-timestamp', '0001-01-01 00:00:00+00 BC', '2024-02-29'),
    ('11111111-2222-4333-8444-555555555555', 'bc-date', '2024-02-29 00:00:00+00', '0001-01-01 BC'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'infinity-timestamp', 'infinity', '2024-02-29'),
    ('66666666-7777-4888-8999-aaaaaaaaaaaa', 'infinity-date', '2024-02-29 00:00:00+00', 'infinity'),
    ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'year-10000-timestamp', '10000-01-01 00:00:00+00', '2024-02-29'),
    ('77777777-8888-4999-8aaa-bbbbbbbbbbbb', 'year-10000-date', '2024-02-29 00:00:00+00', '10000-01-01');
  insert into public.fanmark_tiers
    (id, label, happened_at, calendar_day, text_values, uuid_values, small_values)
  values
    (
      '22222222-3333-4444-8555-666666666666', 'lower-bound-zero',
      '2024-02-29 00:00:00+00', '2024-02-29',
      '[0:1]={zero,one}'::text[], ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], ARRAY[1]::smallint[]
    ),
    (
      '33333333-4444-4555-8666-777777777777', 'multidimensional',
      '2024-02-29 00:00:00+00', '2024-02-29',
      ARRAY[['a', 'b'], ['c', 'd']]::text[], ARRAY['11111111-1111-4111-8111-111111111111']::uuid[], ARRAY[1]::smallint[]
    );
  insert into public.fanmark_tiers (id, label, bigint_value, happened_at, calendar_day)
  values ('44444444-5555-4666-8777-888888888888', 'unsafe-bigint', 9007199254740992, '2024-02-29 00:00:00+00', '2024-02-29');
  insert into public.fanmark_tiers (id, label, happened_at, calendar_day, payload)
  values ('55555555-6666-4777-8888-999999999999', 'unsafe-json', '2024-02-29 00:00:00+00', '2024-02-29', '{"unsafe":9007199254740992}'::jsonb)
`;

let db;

before(async () => {
  db = new PGlite();
  await db.exec(setupSql);
});

after(async () => {
  await db.close();
});

test("PGlite executes the generated projection and preserves row envelope semantics", async () => {
  const plan = buildRowPlan(catalog(), "fanmark_tiers");
  const result = await db.query(plan.sql);
  assert.equal(result.rows.length, 13);

  const envelopes = result.rows.map(({ __fanmark_row_envelope: value }) => JSON.parse(value));
  const byLabel = new Map(envelopes.map((row) => [row.values.label, row]));
  const normal = byLabel.get("normal");
  const nullValues = byLabel.get("null-values");
  const emptyArrays = byLabel.get("empty-arrays");
  assert.ok(normal);
  assert.ok(nullValues);
  assert.ok(emptyArrays);

  assert.equal(normal.values.happened_at, "2024-02-29T03:34:56.123456Z");
  assert.equal(normal.values.calendar_day, "2024-02-29");
  assert.equal(normal.values.payload, '{"price": 123.4500, "value": null}');
  assert.deepEqual(normal.arrayMetadata, {
    text_values: { isNull: false, ndims: 1, lowerBound: 1 },
    uuid_values: { isNull: false, ndims: 1, lowerBound: 1 },
    small_values: { isNull: false, ndims: 1, lowerBound: 1 },
  });
  assert.equal(normal.values.text_values, '["x",null]');
  assert.equal(normal.values.small_values, "[1,null,-2]");

  assert.equal(nullValues.values.happened_at, null);
  assert.equal(nullValues.values.calendar_day, null);
  assert.equal(nullValues.values.payload, null);
  assert.deepEqual(nullValues.arrayMetadata, {
    text_values: { isNull: true, ndims: null, lowerBound: null },
    uuid_values: { isNull: true, ndims: null, lowerBound: null },
    small_values: { isNull: true, ndims: null, lowerBound: null },
  });

  assert.deepEqual(emptyArrays.arrayMetadata, {
    text_values: { isNull: false, ndims: 0, lowerBound: null },
    uuid_values: { isNull: false, ndims: 0, lowerBound: null },
    small_values: { isNull: false, ndims: 0, lowerBound: null },
  });
  assert.equal(emptyArrays.values.text_values, "[]");
  assert.equal(emptyArrays.values.uuid_values, "[]");
  assert.equal(emptyArrays.values.small_values, "[]");

  assert.match(byLabel.get("bc-timestamp").values.happened_at, /BC$/);
  assert.equal(byLabel.get("bc-timestamp").values.calendar_day, "2024-02-29");
  assert.equal(byLabel.get("bc-date").values.happened_at, "2024-02-29T00:00:00.000000Z");
  assert.match(byLabel.get("bc-date").values.calendar_day, /BC$/);
  assert.deepEqual(byLabel.get("lower-bound-zero").arrayMetadata.text_values, {
    isNull: false,
    ndims: 1,
    lowerBound: 0,
  });
  assert.deepEqual(byLabel.get("multidimensional").arrayMetadata.text_values, {
    isNull: false,
    ndims: 2,
    lowerBound: 1,
  });
  assert.equal(byLabel.get("unsafe-bigint").values.bigint_value, "9007199254740992");
  assert.equal(byLabel.get("unsafe-json").values.payload, '{"unsafe": 9007199254740992}');

  const convert = compileRowConverter(catalog(), "fanmark_tiers");
  const normalBindings = convert(normal);
  assert.equal(normalBindings.bindings[9], "2024-02-29T03:34:56.123456Z");
  assert.equal(normalBindings.bindings[10], "2024-02-29");
  assert.equal(normalBindings.bindings[11], '{"price": 123.4500, "value": null}');
  assert.equal(convert(nullValues).bindings[12], null);
  assert.equal(convert(emptyArrays).bindings[12], "[]");
  assert.equal(convert(emptyArrays).bindings[13], "[]");
  assert.equal(convert(emptyArrays).bindings[14], "[]");

  for (const label of ["bc-timestamp", "infinity-timestamp", "year-10000-timestamp", "bc-date", "infinity-date", "year-10000-date"]) {
    const row = byLabel.get(label);
    assert.ok(row);
    assert.throws(() => convert(row), (error) => error.code === "invalid_column_value");
  }
  assert.throws(() => convert(byLabel.get("bc-date")), (error) => error.code === "invalid_column_value");
  assert.throws(() => convert(byLabel.get("lower-bound-zero")), (error) => error.code === "array_shape_unsupported");
  assert.throws(() => convert(byLabel.get("multidimensional")), (error) => error.code === "invalid_column_value");
  assert.throws(() => convert(byLabel.get("unsafe-bigint")), (error) => error.code === "invalid_column_value");
  assert.throws(() => convert(byLabel.get("unsafe-json")), (error) => error.code === "invalid_column_value");
});

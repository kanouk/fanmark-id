#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { convertSchema, validateDistinctPaths } from "./schema-convert.mjs";
import { CREDENTIAL_CODEC_COST, CREDENTIAL_CODEC_ID } from "./credential-descriptor.mjs";
import { MAX_LOTTERY_WEIGHT_TEXT_LENGTH } from "../../workers/api/src/license-lottery-weight-contract.mjs";

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

function regexSchemaFixture() {
  const input = fixture();
  const patterns = [
    ["invitation_codes", "code", "invitation_codes_code_format", "~", "^[A-Z0-9]{6,12}$"],
    ["system_settings", "setting_key", "system_settings_key_format", "~", "^[a-z_]+$"],
    ["waitlist", "email", "waitlist_email_format", "~*", "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"],
  ];
  for (const [table, name, constraintName, operator, pattern] of patterns) {
    input.columns.push(column(table, name, 1, "text", { not_null: true }));
    input.constraints.push(constraint(
      table,
      constraintName,
      "c",
      `CHECK (("${name}" ${operator} '${pattern}'::"text"))`,
    ));
  }
  return input;
}

function reviewedEnUsRegexProbe() {
  return {
    collate: "en_US.UTF-8",
    ctype: "en_US.UTF-8",
    unicode_scalar_count: 1_112_063,
    invitation_extra_matches: 0,
    setting_extra_matches: 0,
    email_local_extra_matches: 0,
    email_domain_extra_matches: 0,
    email_tld_extra_matches: 0,
  };
}

function sqliteInsertPasses(sql, table, columnName, value) {
  const sqlValue = `'${value.replaceAll("'", "''")}'`;
  try {
    execFileSync("sqlite3", [":memory:"], {
      input: `${sql}\nINSERT INTO "${table}" ("${columnName}") VALUES (${sqlValue});`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function fixture() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    database_locale: { collate: "C", ctype: "C" },
    columns: [
      column("child", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("child", "parent_id", 2, "uuid", { not_null: true }),
      column("child", "note", 3, "text"),
      column("fanmark_lottery_entries", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("fanmark_lottery_entries", "lottery_probability", 2, "numeric", { not_null: true, default_expression: "1.0" }),
      column("fanmark_tiers", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("fanmark_tiers", "monthly_price_usd", 2, "numeric(10,2)", { default_expression: "0" }),
      column("parent", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column("parent", "enabled", 2, "boolean", { default_expression: "true" }),
      column("parent", "metadata", 3, "jsonb", { default_expression: "'{}'::jsonb" }),
      column("parent", "tags", 4, "text[]", { default_expression: "'{}'::text[]" }),
      column("parent", "optional_smallint", 5, "smallint"),
      column("parent", "optional_integer", 6, "integer"),
      column("parent", "optional_bigint", 7, "bigint"),
      column("parent", "sequence_ids", 8, "uuid[]"),
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
      index("parent", "parent_sequence_ids_unique", "CREATE UNIQUE INDEX parent_sequence_ids_unique ON public.parent USING btree (seq_key(sequence_ids))"),
      index("parent", "parent_owner_sequence_unique", "CREATE UNIQUE INDEX parent_owner_sequence_unique ON public.parent USING btree (id, seq_key(sequence_ids))"),
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

function credentialPolicy() {
  return {
    version: 1,
    sourceRelation: "fanmark_password_configs",
    sourceColumn: "access_password",
    sourcePrimaryKeyColumns: ["id"],
    enabledColumn: "is_enabled",
    licenseColumn: "license_id",
    destinationRelation: "fanmark_password_configs",
    destinationColumn: "access_password",
    transformKind: "credential_to_bcrypt",
    codecId: CREDENTIAL_CODEC_ID,
    codecCost: CREDENTIAL_CODEC_COST,
    transformContractVersion: 1,
    policyVersion: 1,
    inactiveLicensePolicy: "migration_gate",
  };
}

function credentialFixture() {
  const catalog = fixture();
  catalog.columns.push(
    column("fanmark_password_configs", "id", 1, "uuid", { not_null: true }),
    column("fanmark_password_configs", "license_id", 2, "uuid", { not_null: true }),
    column("fanmark_password_configs", "access_password", 3, "text", { not_null: true }),
    column("fanmark_password_configs", "is_enabled", 4, "boolean", { not_null: true }),
    column("fanmark_password_configs", "created_at", 5, "timestamp with time zone", { not_null: true }),
    column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone", { not_null: true }),
  );
  catalog.constraints.push(
    constraint("fanmark_password_configs", "fanmark_password_configs_pkey", "p", "PRIMARY KEY (id)"),
    constraint("fanmark_password_configs", "fanmark_password_configs_license_id_key", "u", "UNIQUE (license_id)"),
    constraint("fanmark_password_configs", "fanmark_password_configs_license_id_fkey", "f", "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE"),
  );
  catalog.indexes.push(
    index("fanmark_password_configs", "fanmark_password_configs_pkey", "CREATE UNIQUE INDEX fanmark_password_configs_pkey ON public.fanmark_password_configs USING btree (id)", { unique: true, primary: true }),
    index("fanmark_password_configs", "fanmark_password_configs_license_id_key", "CREATE UNIQUE INDEX fanmark_password_configs_license_id_key ON public.fanmark_password_configs USING btree (license_id)", { unique: true }),
  );
  return catalog;
}

function calendarDateFixture() {
  const catalog = fixture();
  catalog.columns.push(
    column("fanmark_access_daily_stats", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
    column("fanmark_access_daily_stats", "stat_date", 2, "date", { not_null: true }),
  );
  catalog.constraints.push(constraint(
    "fanmark_access_daily_stats",
    "fanmark_access_daily_stats_pkey",
    "p",
    "PRIMARY KEY (id)",
  ));
  return catalog;
}

function timestampFixture() {
  const catalog = fixture();
  catalog.columns.push(
    column("unreviewed_runtime_table", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
    column("unreviewed_runtime_table", "created_at", 2, "timestamp with time zone", { not_null: true, default_expression: "now()" }),
  );
  catalog.constraints.push(constraint(
    "unreviewed_runtime_table",
    "unreviewed_runtime_table_pkey",
    "p",
    "PRIMARY KEY (id)",
  ));
  return catalog;
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
  assert.equal(first.report.target.columnCount, 15);
  assert.equal(first.report.schemaVersion, 40);
  assert.deepEqual(first.report.target.translatedConstraints, { p: 4, u: 0, f: 1, c: 3 });
  assert.equal(first.report.target.translatedIndexCount, 4);
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
      codec: "lottery-weight-positive-decimal-text",
      maxTextLength: MAX_LOTTERY_WEIGHT_TEXT_LENGTH,
    },
  );
  assert.match(first.sql, /"monthly_price_usd" INTEGER DEFAULT 0/);
  assert.match(first.sql, /"enabled" IS NULL OR \(typeof\("enabled"\) = 'integer'/);
  assert.match(first.sql, /FOREIGN KEY \("parent_id"\) REFERENCES "parent" \("id"\) ON DELETE CASCADE/);
  assert.match(first.sql, /CREATE INDEX "parent_enabled_idx" ON "parent" \("enabled"\) WHERE \(enabled = true\);/);
  assert.match(first.sql, /CREATE UNIQUE INDEX "parent_sequence_ids_unique" ON "parent" \("sequence_ids"\);/);
  assert.match(first.sql, /CREATE UNIQUE INDEX "parent_owner_sequence_unique" ON "parent" \("id", "sequence_ids"\);/);
  assert.match(first.sql, /CHECK \(note = 'x::text ANY \(ARRAY\[x\]\) char_length\(' OR note IS NULL\)/);
  assert.match(first.sql, /CONSTRAINT "positive_probability" CHECK \(typeof\("lottery_probability"\) = 'text'/);
  assert.doesNotMatch(first.sql, /"lottery_probability" > 0/);
  assert.doesNotMatch(first.sql, /1\.5/);

  const codes = gateCodes(first.report);
  for (const expected of [
    "external_foreign_key",
    "representation_sensitive_check",
    "unsupported_check_constraint",
    "unsupported_constraint",
    "unsupported_index_method",
    "unsupported_index_expression",
  ]) {
    assert.ok(codes.has(expected), `missing gate ${expected}`);
  }
  assert.equal(codes.has("money_cents_import"), false);
  assert.equal(codes.has("array_import_validation"), false);
  assert.equal(codes.has("uuid_import_validation"), false);
  assert.ok(first.report.target.columnCodecs.some((entry) => entry.codec === "uuid-text"));
  assert.ok(!codes.has("uuid_default_requires_operation"));
  assert.match(first.sql, /"id" TEXT NOT NULL DEFAULT \(lower\([\s\S]*randomblob\(6\)[\s\S]*\)\)/);
  assert.equal(first.report.deployable, false);
  assert.equal(
    first.report.stageReadiness.rowConversion.gateGroupCount + first.report.stageReadiness.schemaAndOperations.gateGroupCount,
    first.report.unresolvedGateCount,
  );
  assert.equal(first.report.stageReadiness.rowConversion.ready, false);
  assert.equal(first.report.stageReadiness.schemaAndOperations.ready, false);
  assert.ok(first.report.stageReadiness.schemaAndOperations.gateCodes.includes("unsupported_index_method"));
});

test("the exact reviewed Auth foreign keys become explicit non-DDL dispositions", () => {
  const references = [
    { table: "broadcast_emails", name: "broadcast_emails_created_by_fkey", column: "created_by", onDelete: null, deletion: "reject_before_effects" },
    { table: "fanmark_availability_rules", name: "fanmark_availability_rules_created_by_fkey", column: "created_by", onDelete: "SET NULL", deletion: "set_null" },
    { table: "fanmark_favorites", name: "fanmark_favorites_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
    { table: "fanmark_licenses", name: "fanmark_licenses_user_id_fkey", column: "user_id", onDelete: "SET NULL", deletion: "set_null" },
    { table: "notification_preferences", name: "notification_preferences_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
    { table: "notification_rules", name: "notification_rules_created_by_fkey", column: "created_by", onDelete: "SET NULL", deletion: "set_null" },
    { table: "notifications", name: "notifications_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
    { table: "user_roles", name: "user_roles_created_by_fkey", column: "created_by", onDelete: "SET NULL", deletion: "set_null" },
    { table: "user_roles", name: "user_roles_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
    { table: "user_settings", name: "user_settings_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
    { table: "user_subscriptions", name: "user_subscriptions_user_id_fkey", column: "user_id", onDelete: "CASCADE", deletion: "delete_rows" },
  ];
  const input = fixture();
  input.constraints = input.constraints.filter((entry) => entry.name !== "child_auth_fkey");
  const nextOrdinalByTable = new Map();
  for (const reference of references) {
    const ordinal = (nextOrdinalByTable.get(reference.table) ?? 0) + 1;
    nextOrdinalByTable.set(reference.table, ordinal);
    input.columns.push(column(reference.table, reference.column, ordinal, "uuid"));
    const action = reference.onDelete ? ` ON DELETE ${reference.onDelete}` : "";
    input.constraints.push(constraint(
      reference.table,
      reference.name,
      "f",
      `FOREIGN KEY (${reference.column}) REFERENCES auth.users(id)${action}`,
    ));
  }

  const result = convertSchema(input);
  const dispositions = result.report.target.reviewedAuthForeignKeys;
  assert.equal(dispositions.length, references.length);
  assert.deepEqual(dispositions.map(({ table, name, column, sourceOnDelete, accountDeletion }) => ({
    table, name, column, sourceOnDelete, accountDeletion,
  })), references.map((reference) => ({
    table: reference.table,
    name: reference.name,
    column: reference.column,
    sourceOnDelete: reference.onDelete ?? "NO ACTION (default)",
    accountDeletion: reference.deletion,
  })).sort((left, right) => left.table.localeCompare(right.table) || left.name.localeCompare(right.name)));
  assert.equal(gateCodes(result.report).has("external_foreign_key"), false);
  assert.equal(result.report.target.translatedConstraints.f, 1);
  assert.doesNotMatch(result.sql, /auth\.users|REFERENCES "users"/i);

  const sourceSchema = readFileSync(new URL("../../supabase/remote_schema.sql", import.meta.url), "utf8");
  for (const reference of references) {
    const action = reference.onDelete ? ` ON DELETE ${reference.onDelete}` : "";
    const definition = new RegExp(
      `ADD CONSTRAINT "${reference.name}" FOREIGN KEY \\("${reference.column}"\\) REFERENCES "auth"\\."users"\\("id"\\)${action};`,
    );
    assert.match(sourceSchema, definition, `missing exact source definition ${reference.name}`);
  }
});

test("an exact Auth reference still gates when its source constraint changes", () => {
  const input = fixture();
  input.constraints = input.constraints.filter((entry) => entry.name !== "child_auth_fkey");
  input.columns.push(column("fanmark_favorites", "user_id", 1, "uuid"));
  input.constraints.push(constraint(
    "fanmark_favorites",
    "fanmark_favorites_user_id_fkey",
    "f",
    "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL",
  ));

  const result = convertSchema(input);
  const gate = result.report.gates.find((entry) => entry.code === "external_foreign_key");
  assert.ok(gate?.locations.some((location) => (
    location.table === "fanmark_favorites" && location.name === "fanmark_favorites_user_id_fkey"
  )));
  assert.deepEqual(result.report.target.reviewedAuthForeignKeys, []);
});

test("only array element types covered by the snapshot row contract avoid the array gate", () => {
  const input = fixture();
  input.columns.push(
    column("array_contract", "text_values", 1, "text[]"),
    column("array_contract", "uuid_values", 2, "uuid[]"),
    column("array_contract", "smallint_values", 3, "smallint[]"),
  );
  const result = convertSchema(input);
  assert.equal(gateCodes(result.report).has("array_import_validation"), false);

  const unsupported = fixture();
  unsupported.columns.push(column("array_contract", "binary_values", 1, "bytea[]"));
  const unsupportedResult = convertSchema(unsupported);
  const unsupportedGate = unsupportedResult.report.gates.find((gate) => gate.code === "unsupported_postgres_type");
  assert.ok(unsupportedGate);
  assert.ok(unsupportedGate.locations.some((location) => location.table === "array_contract" && location.column === "binary_values"));
});

test("money cents DDL accepts only the exact source numeric(10,2) range", () => {
  const catalog = fixture();
  catalog.columns.push(column("fanmark_availability_rules", "price_usd", 1, "numeric(10,2)"));
  const result = convertSchema(catalog);
  for (const [table, moneyColumn] of [
    ["fanmark_tiers", "monthly_price_usd"],
    ["fanmark_availability_rules", "price_usd"],
  ]) {
    for (const cents of ["0", "1", "-1", "9999999999", "-9999999999"]) {
      assert.equal(sqliteInsertPasses(result.sql, table, moneyColumn, cents), true, `expected ${table}.${moneyColumn}=${cents} cents to pass`);
    }
    for (const invalid of ["10000000000", "-10000000000", "1.25", "not-cents"]) {
      assert.equal(sqliteInsertPasses(result.sql, table, moneyColumn, invalid), false, `expected ${table}.${moneyColumn}=${invalid} to fail`);
    }
  }
});

test("DATE schema checks preserve canonical calendar days for imports and later writes", () => {
  const result = convertSchema(calendarDateFixture());
  assert.equal(result.report.schemaVersion, 40);
  assert.equal(gateCodes(result.report).has("date_import_validation"), false);
  assert.match(result.sql, /"stat_date" IS NULL OR \([\s\S]*length\("stat_date"\) = 10[\s\S]*GLOB '\[0-9\].*-[0-9\].*-[0-9\].*'[\s\S]*substr\("stat_date", 1, 4\) BETWEEN '0001' AND '9999'[\s\S]*date\("stat_date", '\+0 days'\) IS "stat_date"/);

  for (const value of ["0001-01-01", "2024-02-29", "9999-12-31"]) {
    assert.equal(sqliteInsertPasses(result.sql, "fanmark_access_daily_stats", "stat_date", value), true, `expected ${value} to pass`);
  }
  for (const value of [
    "0000-01-01",
    "2025-02-29",
    "2024-04-31",
    "2024-13-01",
    "2024-01-00",
    "2024-2-03",
    "infinity",
  ]) {
    assert.equal(sqliteInsertPasses(result.sql, "fanmark_access_daily_stats", "stat_date", value), false, `expected ${value} to fail`);
  }
  assert.throws(() => execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO fanmark_access_daily_stats (stat_date) VALUES (NULL);`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }), "the source stat_date column is NOT NULL");
});

test("TIMESTAMPTZ schema checks preserve canonical UTC microsecond text", () => {
  const result = convertSchema(timestampFixture());
  assert.equal(result.report.schemaVersion, 40);
  assert.ok(!gateCodes(result.report).has("timestamp_import_precision"));
  assert.ok(gateCodes(result.report).has("timestamp_default_requires_operation"));
  assert.match(result.sql, /"created_at" TEXT NOT NULL,/);
  assert.doesNotMatch(result.sql, /"created_at" TEXT NOT NULL DEFAULT/);
  for (const fragment of [
    `length("created_at") = 27`,
    `substr("created_at", 5, 1) = '-'`,
    `substr("created_at", 27, 1) = 'Z'`,
    `substr("created_at", 21, 6) NOT GLOB '*[^0-9]*'`,
    `substr("created_at", 1, 4) BETWEEN '0001' AND '9999'`,
    `date(substr("created_at", 1, 10), '+0 days') IS substr("created_at", 1, 10)`,
    `substr("created_at", 12, 2) BETWEEN '00' AND '23'`,
    `datetime(substr("created_at", 1, 19), '+0 seconds') IS replace(substr("created_at", 1, 19), 'T', ' ')`,
  ]) {
    assert.ok(result.sql.includes(fragment), `missing timestamp check fragment: ${fragment}`);
  }

  for (const value of [
    "0001-01-01T00:00:00.000000Z",
    "2024-02-29T23:59:59.999999Z",
    "2026-09-28T12:34:56.123456Z",
    "9999-12-31T23:59:59.999999Z",
  ]) {
    assert.equal(sqliteInsertPasses(result.sql, "unreviewed_runtime_table", "created_at", value), true, `expected ${value} to pass`);
  }
  for (const value of [
    "0000-01-01T00:00:00.000000Z",
    "2025-02-29T00:00:00.000000Z",
    "2024-04-31T00:00:00.000000Z",
    "2026-09-28T24:00:00.000000Z",
    "2026-09-28T12:60:00.000000Z",
    "2026-09-28T12:34:60.000000Z",
    "2026-09-28T12:34:56.123Z",
    "2026-09-28T12:34:56.1234567Z",
    "2026-09-28T12:34:56.123456+00:00",
    "infinity",
  ]) {
    assert.equal(sqliteInsertPasses(result.sql, "unreviewed_runtime_table", "created_at", value), false, `expected ${value} to fail`);
  }
  assert.throws(() => execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO unreviewed_runtime_table DEFAULT VALUES;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }), "target writes must provide the timestamp explicitly");
  assert.throws(() => execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO unreviewed_runtime_table (created_at) VALUES (NULL);`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }), "the source created_at column is NOT NULL");
});

test("only the exact versioned reference-master timestamp defaults use the reviewed replacement disposition", () => {
  const tables = [
    "fanmark_tier_extension_prices",
    "fanmark_tiers",
    "languages",
    "reserved_emoji_patterns",
  ];
  const input = fixture();
  for (const table of tables) {
    input.columns.push(
      column(table, "created_at", 20, "timestamp with time zone", {
        not_null: true, default_expression: "now()",
      }),
      column(table, "updated_at", 21, "timestamp with time zone", {
        not_null: true, default_expression: "now()",
      }),
    );
  }

  const result = convertSchema(input);
  const timestampGates = result.report.gates.filter((gate) => gate.code === "timestamp_default_requires_operation");
  assert.deepEqual(timestampGates, []);
  assert.equal(result.report.deployable, false, "the narrow timestamp disposition does not clear unrelated schema gates");
  const dispositions = result.report.target.reviewedDefaultDispositions;
  assert.equal(dispositions.length, 8);
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`), [
    "fanmark_tier_extension_prices.created_at",
    "fanmark_tier_extension_prices.updated_at",
    "fanmark_tiers.created_at",
    "fanmark_tiers.updated_at",
    "languages.created_at",
    "languages.updated_at",
    "reserved_emoji_patterns.created_at",
    "reserved_emoji_patterns.updated_at",
  ]);
  assert.ok(dispositions.every((entry) => (
    entry.code === "versioned_reference_master_replacement" &&
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/src/reference-master-admin-d1-repository.ts")
  )));

  for (const table of tables) {
    const start = result.sql.indexOf(`CREATE TABLE "${table}"`);
    assert.notEqual(start, -1, `missing converted table ${table}`);
    const end = result.sql.indexOf("\n);", start);
    const definition = result.sql.slice(start, end);
    for (const columnName of ["created_at", "updated_at"]) {
      assert.match(definition, new RegExp(`"${columnName}" TEXT NOT NULL,`));
      assert.doesNotMatch(definition, new RegExp(`"${columnName}" TEXT NOT NULL DEFAULT`));
    }
  }

  const unrelated = structuredClone(input);
  unrelated.columns.push(column("unreviewed_runtime_table", "created_at", 1, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));
  const unrelatedResult = convertSchema(unrelated);
  const remainingTimestampGate = unrelatedResult.report.gates.find((gate) => (
    gate.code === "timestamp_default_requires_operation"
  ));
  assert.deepEqual(remainingTimestampGate?.locations, [
    { kind: "default", table: "unreviewed_runtime_table", column: "created_at" },
  ]);
});

test("user timestamps omit defaults only when an importer or reviewed runtime writer supplies them", () => {
  const input = fixture();
  input.columns.push(
    column("notification_preferences", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notification_preferences", "updated_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("user_roles", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notifications_history", "archived_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  const timestampGates = result.report.gates.filter((gate) => gate.code === "timestamp_default_requires_operation");
  assert.deepEqual(timestampGates, []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "snapshot_import_only_no_timestamp_writer");
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`), [
    "notification_preferences.created_at",
    "notification_preferences.updated_at",
    "user_roles.created_at",
  ]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("scripts/migration/d1-import.mjs") &&
    entry.evidence.includes("scripts/migration/test-d1-import-current-schema.mjs")
  )));
  const archiveDisposition = result.report.target.reviewedDefaultDispositions.find((entry) => (
    entry.table === "notifications_history" && entry.column === "archived_at"
  ));
  assert.equal(archiveDisposition?.code, "scheduled_worker_explicit_timestamp");
  assert.ok(archiveDisposition?.evidence.includes("workers/api/test/notifications-d1.test.ts"));
  assert.equal(result.report.deployable, false, "the narrow import disposition does not clear unrelated timestamp or catalog gates");

  for (const [table, columns] of [
    ["notification_preferences", ["created_at", "updated_at"]],
    ["user_roles", ["created_at"]],
  ]) {
    const start = result.sql.indexOf(`CREATE TABLE "${table}"`);
    assert.notEqual(start, -1, `missing converted table ${table}`);
    const end = result.sql.indexOf("\n);", start);
    const definition = result.sql.slice(start, end);
    for (const columnName of columns) {
      assert.match(definition, new RegExp(`"${columnName}" TEXT NOT NULL,`));
      assert.doesNotMatch(definition, new RegExp(`"${columnName}" TEXT NOT NULL DEFAULT`));
    }
  }
});

test("the waitlist signup timestamp uses its reviewed operation-owned write", () => {
  const input = fixture();
  input.columns.push(column("waitlist", "created_at", 1, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));

  const result = convertSchema(input);
  const timestampGates = result.report.gates.filter((gate) => gate.code === "timestamp_default_requires_operation");
  assert.deepEqual(timestampGates, []);
  const disposition = result.report.target.reviewedDefaultDispositions.find((entry) => (
    entry.table === "waitlist" && entry.column === "created_at"
  ));
  assert.equal(disposition?.code, "worker_operation_explicit_timestamp");
  assert.equal(disposition?.targetDefault, null);
  assert.ok(disposition?.evidence.includes("workers/api/src/waitlist-signup-d1-api.ts"));
  assert.ok(disposition?.evidence.includes("workers/api/test/waitlist-signup-d1.test.ts"));
  assert.equal(result.report.schemaVersion, 40);

  const start = result.sql.indexOf('CREATE TABLE "waitlist"');
  assert.notEqual(start, -1);
  const end = result.sql.indexOf("\n);", start);
  const definition = result.sql.slice(start, end);
  assert.match(definition, /"created_at" TEXT NOT NULL,/u);
  assert.doesNotMatch(definition, /"created_at" TEXT NOT NULL DEFAULT/u);
});

test("search and favorite operation timestamps are reviewed per exact column", () => {
  const input = fixture();
  input.columns.push(
    column("fanmark_discoveries", "first_seen_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_discoveries", "last_seen_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_events", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_favorites", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  const timestampGates = result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  ));
  assert.deepEqual(timestampGates, []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp");
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`).sort(), [
    "fanmark_discoveries.first_seen_at",
    "fanmark_discoveries.last_seen_at",
    "fanmark_events.created_at",
    "fanmark_favorites.created_at",
  ]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/test/favorites-d1.test.ts")
  )));
});

test("public access analytics timestamps are reviewed on insert and aggregate update", () => {
  const input = fixture();
  input.columns.push(
    column("fanmark_access_logs", "accessed_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_access_daily_stats", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_access_daily_stats", "updated_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp");
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`).sort(), [
    "fanmark_access_daily_stats.created_at",
    "fanmark_access_daily_stats.updated_at",
    "fanmark_access_logs.accessed_at",
  ]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/test/fanmark-access-analytics-d1.test.ts")
  )));
  assert.equal(result.report.schemaVersion, 40);
});

test("fanmark profile timestamps are reviewed for explicit creation and updates", () => {
  const input = fixture();
  input.columns.push(
    column("fanmark_profiles", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
    column("fanmark_profiles", "created_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmark_profiles", "updated_at", 3, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );
  input.constraints.push(constraint("fanmark_profiles", "fanmark_profiles_pkey", "p", "PRIMARY KEY (id)"));

  const result = convertSchema(input);
  const timestampGates = result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )).map(({ table, column: columnName }) => `${table}.${columnName}`);
  assert.ok(!timestampGates.includes("fanmark_profiles.created_at"));
  assert.ok(!timestampGates.includes("fanmark_profiles.updated_at"));
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp" && entry.table === "fanmark_profiles");
  assert.deepEqual(dispositions.map(({ column: columnName }) => columnName).sort(), ["created_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/test/fanmark-profile-d1.test.ts") &&
    entry.evidence.includes("workers/api/test/fanmark-registration-d1.test.ts")
  )));
  assert.equal(result.report.schemaVersion, 40);
});

test("emoji master timestamps require exact explicit Worker and seed writers", () => {
  const input = fixture();
  input.columns.push(
    column("emoji_master", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
    column("emoji_master", "created_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("emoji_master", "updated_at", 3, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );
  input.constraints.push(constraint("emoji_master", "emoji_master_pkey", "p", "PRIMARY KEY (id)"));

  const result = convertSchema(input);
  const timestampGates = result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )).map(({ table, column: columnName }) => `${table}.${columnName}`);
  assert.deepEqual(timestampGates, []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp" && entry.table === "emoji_master");
  assert.deepEqual(dispositions.map(({ column: columnName }) => columnName).sort(), ["created_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/src/emoji-master-admin-d1-repository.ts") &&
    entry.evidence.includes("workers/api/test/auth-d1.test.ts") &&
    entry.evidence.includes("scripts/migration/emoji-master-seed.mjs")
  )));
  const start = result.sql.indexOf('CREATE TABLE "emoji_master"');
  assert.notEqual(start, -1);
  const definition = result.sql.slice(start, result.sql.indexOf("\n);", start));
  for (const columnName of ["created_at", "updated_at"]) {
    assert.match(definition, new RegExp(`"${columnName}" TEXT NOT NULL,`));
    assert.doesNotMatch(definition, new RegExp(`"${columnName}" TEXT NOT NULL DEFAULT`));
  }

  const changed = structuredClone(input);
  changed.columns.push(column("emoji_master", "reviewed_at", 4, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));
  const changedResult = convertSchema(changed);
  assert.ok(changedResult.report.gates.some((gate) => (
    gate.code === "timestamp_default_requires_operation" &&
    gate.locations.some((location) => location.table === "emoji_master" && location.column === "reviewed_at")
  )));
  assert.equal(result.report.schemaVersion, 40);
});

test("invitation code timestamps require exact admin operation writers", () => {
  const input = fixture();
  input.columns.push(
    column("invitation_codes", "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
    column("invitation_codes", "created_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("invitation_codes", "updated_at", 3, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );
  input.constraints.push(constraint("invitation_codes", "invitation_codes_pkey", "p", "PRIMARY KEY (id)"));

  const result = convertSchema(input);
  const timestampGates = result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )).map(({ table, column: columnName }) => `${table}.${columnName}`);
  assert.deepEqual(timestampGates, []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp" && entry.table === "invitation_codes");
  assert.deepEqual(dispositions.map(({ column: columnName }) => columnName).sort(), ["created_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null &&
    entry.evidence.includes("workers/api/src/invitation-admin-d1-api.ts") &&
    entry.evidence.includes("workers/api/test/invitation-admin-d1.test.ts")
  )));

  const changed = structuredClone(input);
  changed.columns.push(column("invitation_codes", "reviewed_at", 4, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));
  const changedResult = convertSchema(changed);
  assert.ok(changedResult.report.gates.some((gate) => (
    gate.code === "timestamp_default_requires_operation" &&
    gate.locations.some((location) => location.table === "invitation_codes" && location.column === "reviewed_at")
  )));
  assert.equal(result.report.schemaVersion, 40);
});

test("transfer and lottery timestamps require reviewed operation writers", () => {
  const input = fixture();
  const reviewed = [
    ["fanmark_transfer_codes", "created_at"],
    ["fanmark_transfer_codes", "disclaimer_agreed_at"],
    ["fanmark_transfer_codes", "updated_at"],
    ["fanmark_transfer_requests", "applied_at"],
    ["fanmark_transfer_requests", "created_at"],
    ["fanmark_transfer_requests", "disclaimer_agreed_at"],
    ["fanmark_transfer_requests", "updated_at"],
    ["fanmark_lottery_entries", "applied_at"],
    ["fanmark_lottery_entries", "created_at"],
    ["fanmark_lottery_entries", "updated_at"],
    ["fanmark_lottery_history", "created_at"],
    ["fanmark_lottery_history", "executed_at"],
  ];
  for (const [table, columnName] of reviewed) {
    input.columns.push(column(table, columnName, input.columns.length + 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }));
  }

  const result = convertSchema(input);
  const timestampGates = result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  ));
  assert.deepEqual(timestampGates, []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp");
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`).sort(),
    reviewed.map(([table, columnName]) => `${table}.${columnName}`).sort());
  assert.ok(dispositions.every((entry) => (
    entry.sourceDefault === "now()" && entry.targetDefault === null && entry.reason.length > 0 &&
    entry.evidence.some((path) => path.startsWith("workers/api/"))
  )));
  assert.ok(dispositions.filter((entry) => entry.table.startsWith("fanmark_transfer_")).every((entry) => (
    entry.evidence.includes("workers/api/test/fanmark-transfer-d1.test.ts")
  )));
  assert.ok(dispositions.filter((entry) => entry.table === "fanmark_lottery_entries").every((entry) => (
    entry.evidence.includes("workers/api/test/fanmark-lottery-d1.test.ts")
  )));
  assert.ok(dispositions.filter((entry) => entry.table === "fanmark_lottery_history").every((entry) => (
    entry.evidence.includes("workers/api/test/license-expiry-source.integration.mjs")
  )));

  const changed = structuredClone(input);
  changed.columns.push(column("fanmark_transfer_codes", "reviewed_at", 99, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));
  const changedResult = convertSchema(changed);
  const remaining = changedResult.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  ));
  assert.deepEqual(remaining, [{ kind: "default", table: "fanmark_transfer_codes", column: "reviewed_at" }]);
  assert.equal(result.report.schemaVersion, 40);
});

test("admin, notification master, and template timestamps distinguish imports from runtime edits", () => {
  const input = fixture();
  const tables = ["email_templates", "notification_templates", "notification_rules", "fanmark_availability_rules"];
  for (const table of tables) {
    input.columns.push(
      column(table, "created_at", 1, "timestamp with time zone", {
        not_null: true, default_expression: "now()",
      }),
      column(table, "updated_at", 2, "timestamp with time zone", {
        not_null: true, default_expression: "now()",
      }),
    );
  }

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => tables.includes(entry.table));
  assert.deepEqual(dispositions.map((entry) => `${entry.table}.${entry.column}`).sort(), [
    "email_templates.created_at",
    "email_templates.updated_at",
    "fanmark_availability_rules.created_at",
    "fanmark_availability_rules.updated_at",
    "notification_rules.created_at",
    "notification_rules.updated_at",
    "notification_templates.created_at",
    "notification_templates.updated_at",
  ]);
  for (const table of tables) {
    const createdAt = dispositions.find((entry) => entry.table === table && entry.column === "created_at");
    assert.equal(createdAt?.code, "snapshot_import_only_no_timestamp_writer");
    assert.ok(createdAt?.evidence.includes("scripts/migration/d1-import.mjs"));
    const updatedAt = dispositions.find((entry) => entry.table === table && entry.column === "updated_at");
    assert.equal(updatedAt?.code, "worker_operation_explicit_timestamp");
    assert.ok(updatedAt?.evidence.some((path) => path.startsWith("workers/api/test/")));
  }
  const emailSeed = dispositions.find((entry) => entry.table === "email_templates" && entry.column === "created_at");
  assert.ok(emailSeed?.evidence.includes("scripts/migration/stage-staging-broadcast-email-templates.mjs"));
  const notificationSeed = dispositions.find((entry) => entry.table === "notification_templates" && entry.column === "created_at");
  assert.ok(notificationSeed?.evidence.includes("scripts/migration/staging-notification-master-seed.sql"));
  const ruleSeed = dispositions.find((entry) => entry.table === "notification_rules" && entry.column === "created_at");
  assert.ok(ruleSeed?.evidence.includes("scripts/migration/staging-notification-master-seed.sql"));
  const availabilitySeed = dispositions.find((entry) => entry.table === "fanmark_availability_rules" && entry.column === "created_at");
  assert.ok(availabilitySeed?.evidence.includes("scripts/migration/staging-availability-rules-seed.sql"));
  const availabilityUpdated = dispositions.find((entry) => entry.table === "fanmark_availability_rules" && entry.column === "updated_at");
  assert.ok(availabilityUpdated?.evidence.includes("workers/api/test/account-deletion-d1.test.ts"));
  assert.ok(availabilityUpdated?.evidence.includes("workers/api/test/availability-rules-admin-d1.test.ts"));

  const changed = structuredClone(input);
  changed.columns.push(column("notification_templates", "reviewed_at", 3, "timestamp with time zone", {
    not_null: true, default_expression: "now()",
  }));
  const changedResult = convertSchema(changed);
  assert.deepEqual(changedResult.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), [{ kind: "default", table: "notification_templates", column: "reviewed_at" }]);
  assert.equal(result.report.schemaVersion, 40);
});

test("notification event timestamps use explicit producer and scheduled operation values", () => {
  const input = fixture();
  input.columns.push(
    column("notification_events", "trigger_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notification_events", "created_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notification_events", "updated_at", 3, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.table === "notification_events");
  assert.deepEqual(dispositions.map((entry) => entry.column).sort(), ["created_at", "trigger_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => entry.code === "worker_operation_explicit_timestamp"));
  for (const evidence of [
    "scripts/migration/d1-import.mjs",
    "scripts/migration/test-d1-import.mjs",
    "workers/api/src/fanmark-return-d1-api.ts",
    "workers/api/src/fanmark-transfer-d1-api.ts",
    "workers/api/src/license-grace-finalization-source.mjs",
    "workers/api/src/notifications-scheduled.ts",
    "workers/api/src/stripe-subscription-reconciliation-d1.ts",
    "workers/api/migrations-business/0015_extension_coupon_application.sql",
    "workers/api/test/fanmark-settings-d1.test.ts",
    "workers/api/test/notifications-d1.test.ts",
    "workers/api/test/stripe-subscription-reconciliation-d1.integration.mjs",
  ]) {
    assert.ok(dispositions.every((entry) => entry.evidence.includes(evidence)), evidence);
  }
  assert.equal(result.report.schemaVersion, 40);
});

test("notification row timestamps use explicit processor and read-operation values", () => {
  const input = fixture();
  input.columns.push(
    column("notifications", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notifications", "triggered_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("notifications", "updated_at", 3, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.table === "notifications");
  assert.deepEqual(dispositions.map((entry) => entry.column).sort(), ["created_at", "triggered_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => entry.code === "worker_operation_explicit_timestamp"));
  for (const evidence of [
    "scripts/migration/d1-import.mjs",
    "scripts/migration/test-d1-import.mjs",
    "workers/api/src/notifications-d1-api.ts",
    "workers/api/src/notifications-scheduled.ts",
    "workers/api/test/notifications-d1.test.ts",
  ]) {
    assert.ok(dispositions.every((entry) => entry.evidence.includes(evidence)), evidence);
  }
  assert.equal(result.report.schemaVersion, 40);
});

test("system setting timestamps use only the bounded source stage and explicit runtime operations", () => {
  const input = fixture();
  input.columns.push(
    column("system_settings", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("system_settings", "updated_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.table === "system_settings");
  assert.deepEqual(dispositions.map((entry) => entry.column).sort(), ["created_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => entry.code === "worker_operation_explicit_timestamp"));
  for (const evidence of [
    "scripts/migration/system-settings-stage.mjs",
    "scripts/migration/stage-staging-system-settings.mjs",
    "scripts/migration/test-system-settings-stage.mjs",
    "workers/api/src/lifecycle-settings-d1-api.ts",
    "workers/api/src/system-settings-d1-api.ts",
    "workers/api/test/lifecycle-settings-d1.test.ts",
    "workers/api/test/system-settings-d1.test.ts",
    "workers/api/vitest.system-settings.config.mjs",
  ]) {
    assert.ok(dispositions.every((entry) => entry.evidence.includes(evidence)), evidence);
  }
  assert.equal(result.report.schemaVersion, 40);
});

test("fanmark registration timestamps are explicit on creation and preserve created_at on reuse", () => {
  const input = fixture();
  input.columns.push(
    column("fanmarks", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("fanmarks", "updated_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.table === "fanmarks");
  assert.deepEqual(dispositions.map((entry) => entry.column).sort(), ["created_at", "updated_at"]);
  assert.ok(dispositions.every((entry) => entry.code === "worker_operation_explicit_timestamp"));
  for (const evidence of [
    "scripts/migration/d1-import.mjs",
    "scripts/migration/test-d1-import.mjs",
    "workers/api/src/fanmark-registration-d1-api.ts",
    "workers/api/test/fanmark-registration-d1.test.ts",
  ]) {
    assert.ok(dispositions.every((entry) => entry.evidence.includes(evidence)), evidence);
  }
  assert.equal(result.report.schemaVersion, 40);
});

test("extension coupon timestamps use exact admin and redemption operation writers", () => {
  const input = fixture();
  input.columns.push(
    column("extension_coupons", "created_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("extension_coupons", "updated_at", 2, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
    column("extension_coupon_usages", "used_at", 1, "timestamp with time zone", {
      not_null: true, default_expression: "now()",
    }),
  );

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => ["extension_coupons", "extension_coupon_usages"].includes(entry.table));
  assert.deepEqual(dispositions.map((entry) => `${entry.table}.${entry.column}`).sort(), [
    "extension_coupon_usages.used_at",
    "extension_coupons.created_at",
    "extension_coupons.updated_at",
  ].sort());
  assert.ok(dispositions.every((entry) => entry.code === "worker_operation_explicit_timestamp"));
  const couponCreated = dispositions.find((entry) => entry.table === "extension_coupons" && entry.column === "created_at");
  assert.ok(couponCreated?.evidence.includes("scripts/migration/stage-staging-extension-coupons.mjs"));
  const couponUpdated = dispositions.find((entry) => entry.table === "extension_coupons" && entry.column === "updated_at");
  assert.ok(couponUpdated?.evidence.includes("workers/api/migrations-business/0015_extension_coupon_application.sql"));
  const usageTime = dispositions.find((entry) => entry.table === "extension_coupon_usages");
  assert.ok(usageTime?.evidence.includes("workers/api/test/extension-coupon-application-d1.integration.mjs"));
  assert.equal(result.report.schemaVersion, 40);
});

test("fanmark settings configuration timestamps require exact operation reviews", () => {
  const input = fixture();
  const tables = [
    "fanmark_basic_configs",
    "fanmark_messageboard_configs",
    "fanmark_password_configs",
    "fanmark_redirect_configs",
  ];
  for (const table of tables) {
    input.columns.push(
      column(table, "id", 1, "uuid", { not_null: true, default_expression: "gen_random_uuid()" }),
      column(table, "created_at", 2, "timestamp with time zone", { not_null: true, default_expression: "now()" }),
      column(table, "updated_at", 3, "timestamp with time zone", { not_null: true, default_expression: "now()" }),
    );
    input.constraints.push(constraint(table, `${table}_pkey`, "p", "PRIMARY KEY (id)"));
  }

  const result = convertSchema(input);
  assert.deepEqual(result.report.gates.flatMap((gate) => (
    gate.code === "timestamp_default_requires_operation" ? gate.locations : []
  )), []);
  const dispositions = result.report.target.reviewedDefaultDispositions
    .filter((entry) => entry.code === "worker_operation_explicit_timestamp" && tables.includes(entry.table));
  assert.deepEqual(dispositions.map(({ table, column: columnName }) => `${table}.${columnName}`).sort(), tables.flatMap((table) => [
    `${table}.created_at`, `${table}.updated_at`,
  ]).sort());
  const evidenceByTable = new Map(dispositions.map((entry) => [entry.table, new Set(entry.evidence)]));
  for (const table of tables) {
    assert.ok(evidenceByTable.get(table)?.has("workers/api/src/fanmark-settings-d1-api.ts"));
    assert.ok(evidenceByTable.get(table)?.has("workers/api/test/fanmark-settings-d1.test.ts"));
  }
  assert.ok(evidenceByTable.get("fanmark_basic_configs")?.has("workers/api/test/fanmark-transfer-d1.test.ts"));
  assert.ok(evidenceByTable.get("fanmark_basic_configs")?.has("workers/api/test/fanmark-registration-d1.test.ts"));
  assert.equal(result.report.schemaVersion, 40);
});

test("JSONB text validation and target constraints preserve JSON null, SQL NULL, and exact text", () => {
  const result = convertSchema(fixture());
  assert.equal(result.report.schemaVersion, 40);
  assert.equal(gateCodes(result.report).has("json_import_validation"), false);
  assert.match(result.sql, /"metadata" IS NULL OR json_valid\("metadata"\)/);

  assert.equal(sqliteInsertPasses(result.sql, "parent", "metadata", "null"), true);
  assert.equal(sqliteInsertPasses(result.sql, "parent", "metadata", '{"n":0.12345678901234567890123456789}'), true);
  for (const invalid of ["", "{", "undefined", "NaN"]) {
    assert.equal(sqliteInsertPasses(result.sql, "parent", "metadata", invalid), false);
  }

  const exactJson = '{"n":0.12345678901234567890123456789,"nested":{"value":"null"}}';
  const output = execFileSync("sqlite3", ["-json", ":memory:"], {
    input: [
      result.sql,
      "INSERT INTO parent (id, metadata) VALUES",
      "('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL),",
      "('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'null'),",
      `('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${exactJson}');`,
      "SELECT metadata FROM parent ORDER BY id;",
    ].join("\n"),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  assert.deepEqual(JSON.parse(output), [
    { metadata: null },
    { metadata: "null" },
    { metadata: exactJson },
  ]);
});

test("now() defaults on non-timestamptz columns stay omitted and gated", () => {
  const input = fixture();
  input.columns.find((entry) => entry.table_name === "child" && entry.column_name === "note")
    .default_expression = "now()";
  const result = convertSchema(input);
  const gates = result.report.gates.filter((gate) => gate.code === "timestamp_default_requires_operation");
  assert.equal(gates.length, 1);
  assert.deepEqual(gates[0].locations, [{ kind: "default", table: "child", column: "note" }]);
  assert.doesNotMatch(result.sql, /"note" TEXT DEFAULT/);
});

test("PostgreSQL UUID defaults generate distinct canonical RFC 4122 v4 IDs in SQLite", () => {
  const result = convertSchema(fixture());
  const rows = execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\n${"INSERT INTO parent DEFAULT VALUES;\n".repeat(256)}SELECT id FROM parent;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim().split(/\r?\n/);

  assert.equal(rows.length, 256);
  assert.equal(new Set(rows).size, rows.length);
  for (const id of rows) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test("the reviewed event sequence uses AUTOINCREMENT and the exact snapshot sequence-state path", () => {
  const input = fixture();
  input.columns.push(column("fanmark_events", "id", 1, "bigint", {
    not_null: true,
    default_expression: "nextval('public.fanmark_events_id_seq'::regclass)",
  }));
  input.constraints.push(constraint("fanmark_events", "fanmark_events_pkey", "p", "PRIMARY KEY (id)"));
  const result = convertSchema(input);

  assert.match(result.sql, /CREATE TABLE "fanmark_events" \(\s*"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,/);
  assert.doesNotMatch(result.sql, /CONSTRAINT "fanmark_events_pkey" PRIMARY KEY/);
  assert.ok(!gateCodes(result.report).has("sequence_state_import_required"));
  const supportedBigintGate = result.report.gates.find((gate) => gate.code === "bigint_import_range_validation");
  assert.ok(supportedBigintGate);
  assert.ok(supportedBigintGate.locations.some((location) => location.table === "parent" && location.column === "optional_bigint"));
  assert.ok(!supportedBigintGate.locations.some((location) => location.table === "fanmark_events" && location.column === "id"),
    "the exact event sequence ID is not projected to application-facing JavaScript reads");
  assert.ok(!gateCodes(result.report).has("sequence_default_requires_operation"));

  const rows = execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO fanmark_events DEFAULT VALUES;\nINSERT INTO fanmark_events DEFAULT VALUES;\nINSERT INTO fanmark_events (id) VALUES (50);\nINSERT INTO fanmark_events DEFAULT VALUES;\nDELETE FROM fanmark_events WHERE id = 51;\nINSERT INTO fanmark_events DEFAULT VALUES;\nSELECT id FROM fanmark_events ORDER BY id;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim().split(/\r?\n/);
  assert.deepEqual(rows, ["1", "2", "50", "52"]);

  const unrecognized = fixture();
  unrecognized.columns.push(column("custom_events", "id", 1, "bigint", {
    not_null: true,
    default_expression: "nextval('public.unrelated_sequence'::regclass)",
  }));
  unrecognized.constraints.push(constraint("custom_events", "custom_events_pkey", "p", "PRIMARY KEY (id)"));
  const unsafeResult = convertSchema(unrecognized);
  const sequenceGate = unsafeResult.report.gates.find((gate) => gate.code === "sequence_state_import_required");
  assert.ok(sequenceGate);
  assert.ok(sequenceGate.locations.some((location) => location.table === "custom_events" && location.column === "id"));
  const bigintGate = unsafeResult.report.gates.find((gate) => gate.code === "bigint_import_range_validation");
  assert.ok(bigintGate);
  assert.ok(bigintGate.locations.some((location) => location.table === "custom_events" && location.column === "id"));
});

test("discovery bigint counters are exempt only through the reviewed exact-text API projection", () => {
  const input = fixture();
  input.columns.push(
    column("fanmark_discoveries", "search_count", 1, "bigint", { not_null: true, default_expression: "0" }),
    column("fanmark_discoveries", "favorite_count", 2, "bigint", { not_null: true, default_expression: "0" }),
  );
  const result = convertSchema(input);
  const gate = result.report.gates.find((entry) => entry.code === "bigint_import_range_validation");
  assert.ok(gate, "unreviewed bigint columns remain blocked");
  assert.deepEqual(gate.locations, [{ kind: "column", table: "parent", column: "optional_bigint" }]);
  for (const [columnName, responseField] of [
    ["search_count", "search_count"],
    ["favorite_count", "favorite_count"],
  ]) {
    assert.deepEqual(
      result.report.target.columnCodecs.find((entry) => entry.table === "fanmark_discoveries" && entry.column === columnName),
      {
        table: "fanmark_discoveries",
        column: columnName,
        sourceType: "bigint",
        targetType: "INTEGER",
        codec: "bigint-int64-exact",
        applicationReadDisposition: {
          route: "GET /api/me/favorites",
          responseField,
          encoding: "nonnegative-int64-decimal-text",
          evidence: ["workers/api/src/favorites-d1-api.ts", "workers/api/test/favorites-d1.test.ts", "src/lib/favorites-api.ts"],
        },
      },
    );
  }
});

test("credential source never receives the ordinary text codec and needs its exact policy descriptor", () => {
  const catalog = credentialFixture();
  const unbound = convertSchema(catalog);
  const codec = unbound.report.target.columnCodecs.find((entry) => entry.table === "fanmark_password_configs" && entry.column === "access_password");
  assert.equal(codec.codec, "credential-descriptor-required");
  assert.equal(codec.targetType, "TEXT");
  assert.equal(unbound.report.gates.some((gate) => gate.code === "credential_descriptor_required"), true);

  const planned = convertSchema(catalog, { credentialDescriptor: credentialPolicy() });
  const plannedCodec = planned.report.target.columnCodecs.find((entry) => entry.table === "fanmark_password_configs" && entry.column === "access_password");
  assert.equal(plannedCodec.codec, "credential-to-bcrypt");
  assert.equal(plannedCodec.targetType, "TEXT");
  assert.equal(planned.report.gates.some((gate) => gate.code === "credential_transform_import_required"), false);
  assert.throws(
    () => convertSchema(catalog, { credentialDescriptor: { ...credentialPolicy(), sourceColumn: "wrong_column" } }),
    (error) => error.code === "unsupported_credential_source_column",
  );
});

test("database locale metadata must include both source locale settings", () => {
  const input = fixture();
  input.database_locale = { collate: "C" };
  assert.throws(() => convertSchema(input), (error) => error.code === "invalid_catalog_database_locale");
});

test("the four reviewed live GIN indexes have explicit D1 query-contract dispositions", () => {
  const input = fixture();
  input.columns.push(
    column("emoji_master", "id", 1, "uuid", { not_null: true }),
    column("emoji_master", "short_name", 2, "text", { not_null: true }),
    column("emoji_master", "keywords", 3, "text[]", { not_null: true }),
    column("fanmarks", "id", 1, "uuid", { not_null: true }),
    column("fanmarks", "emoji_ids", 2, "uuid[]", { not_null: true }),
    column("fanmarks", "normalized_emoji_ids", 3, "uuid[]", { not_null: true }),
  );
  input.constraints.push(
    constraint("emoji_master", "emoji_master_pkey", "p", "PRIMARY KEY (id)"),
    constraint("fanmarks", "fanmarks_pkey", "p", "PRIMARY KEY (id)"),
    constraint("fanmarks", "fanmarks_normalized_emoji_ids_unique", "u", "UNIQUE (normalized_emoji_ids)"),
  );
  input.indexes.push(
    index("emoji_master", "idx_emoji_master_keywords", "CREATE INDEX idx_emoji_master_keywords ON public.emoji_master USING gin (keywords)"),
    index("emoji_master", "idx_emoji_master_short_name", "CREATE INDEX idx_emoji_master_short_name ON public.emoji_master USING gin (to_tsvector('simple'::regconfig, short_name))"),
    index("fanmarks", "idx_fanmarks_emoji_ids", "CREATE INDEX idx_fanmarks_emoji_ids ON public.fanmarks USING gin (emoji_ids)"),
    index("fanmarks", "idx_fanmarks_normalized_emoji_ids", "CREATE INDEX idx_fanmarks_normalized_emoji_ids ON public.fanmarks USING gin (normalized_emoji_ids)"),
  );

  const result = convertSchema(input);
  assert.equal(result.report.schemaVersion, 40);
  assert.deepEqual(result.report.target.indexAdaptations.map((entry) => entry.sourceIndex), [
    "idx_emoji_master_keywords",
    "idx_emoji_master_short_name",
    "idx_fanmarks_emoji_ids",
    "idx_fanmarks_normalized_emoji_ids",
  ]);
  assert.ok(result.report.target.indexAdaptations.every((entry) => entry.disposition === "omitted_after_query_contract_review"));
  assert.match(result.report.target.indexAdaptations[3].replacement, /UNIQUE constraint fanmarks_normalized_emoji_ids_unique/);
  assert.match(result.sql, /CONSTRAINT "fanmarks_normalized_emoji_ids_unique" UNIQUE \("normalized_emoji_ids"\)/);
  assert.doesNotMatch(result.sql, /USING gin|idx_emoji_master_keywords|idx_emoji_master_short_name|idx_fanmarks_emoji_ids|idx_fanmarks_normalized_emoji_ids/);

  const unknown = structuredClone(input);
  unknown.indexes.push(index("emoji_master", "idx_emoji_master_unknown", "CREATE INDEX idx_emoji_master_unknown ON public.emoji_master USING gin (category)"));
  const unknownResult = convertSchema(unknown);
  assert.ok(unknownResult.report.gates.some((gate) => (
    gate.code === "unsupported_index_method" &&
    gate.locations.some((location) => location.name === "idx_emoji_master_unknown")
  )));

  const changed = structuredClone(input);
  changed.indexes.find((entry) => entry.name === "idx_emoji_master_keywords").definition =
    "CREATE INDEX idx_emoji_master_keywords ON public.emoji_master USING gin (keywords, category)";
  const changedResult = convertSchema(changed);
  assert.ok(changedResult.report.gates.some((gate) => (
    gate.code === "unsupported_index_method" &&
    gate.locations.some((location) => location.name === "idx_emoji_master_keywords")
  )));
  assert.ok(!changedResult.report.target.indexAdaptations.some((entry) => entry.sourceIndex === "idx_emoji_master_keywords"));
});

test("known ASCII PostgreSQL regex checks require a reviewed locale proof", () => {
  const input = regexSchemaFixture();
  const result = convertSchema(input);
  const sourceCheckNames = new Set([
    "invitation_codes_code_format",
    "system_settings_key_format",
    "waitlist_email_format",
  ]);
  const untranslatedSourceChecks = result.report.gates
    .filter((gate) => gate.code === "unsupported_check_constraint")
    .flatMap((gate) => gate.locations)
    .filter((location) => sourceCheckNames.has(location.name));
  assert.deepEqual(untranslatedSourceChecks, []);
  assert.equal(result.report.schemaVersion, 40);

  const cases = [
    ["invitation_codes", "code", "ABC123", true],
    ["invitation_codes", "code", "A23456789012", true],
    ["invitation_codes", "code", "abc123", false],
    ["invitation_codes", "code", "ABC12", false],
    ["invitation_codes", "code", "ABC1234567890", false],
    ["invitation_codes", "code", "ABC-12", false],
    ["system_settings", "setting_key", "a", true],
    ["system_settings", "setting_key", "system_key_", true],
    ["system_settings", "setting_key", "", false],
    ["system_settings", "setting_key", "Upper", false],
    ["system_settings", "setting_key", "key1", false],
    ["waitlist", "email", "a@example.com", true],
    ["waitlist", "email", "First.Last+tag@sub-domain.example.jp", true],
    ["waitlist", "email", "x@y.co", true],
    ["waitlist", "email", "@example.com", false],
    ["waitlist", "email", "x@@example.com", false],
    ["waitlist", "email", "x@example.c", false],
    ["waitlist", "email", "x@.com", false],
    ["waitlist", "email", "x@y.co1", false],
    ["waitlist", "email", "x@y.co_", false],
    ["waitlist", "email", "x@y.c9", false],
    ["waitlist", "email", "x@..com", true],
    ["waitlist", "email", "x@domain.com\n", false],
    ["waitlist", "email", "a b@domain.com", false],
  ];
  for (const [table, columnName, value, expected] of cases) {
    assert.equal(
      sqliteInsertPasses(result.sql, table, columnName, value),
      expected,
      `${table}.${columnName} should ${expected ? "accept" : "reject"} ${JSON.stringify(value)}`,
    );
  }

  const enUsLocale = regexSchemaFixture();
  enUsLocale.database_locale = { collate: "en_US.UTF-8", ctype: "en_US.UTF-8" };
  enUsLocale.regex_range_probe = reviewedEnUsRegexProbe();
  const enUsResult = convertSchema(enUsLocale);
  const enUsUntranslated = enUsResult.report.gates
    .filter((gate) => gate.code === "unsupported_check_constraint")
    .flatMap((gate) => gate.locations)
    .filter((location) => sourceCheckNames.has(location.name));
  assert.deepEqual(enUsUntranslated, []);

  const unprobedLocale = structuredClone(enUsLocale);
  delete unprobedLocale.regex_range_probe;
  const conservative = convertSchema(unprobedLocale);
  const remaining = conservative.report.gates
    .filter((gate) => gate.code === "unsupported_check_constraint")
    .flatMap((gate) => gate.locations)
    .filter((location) => sourceCheckNames.has(location.name));
  assert.deepEqual(new Set(remaining.map((location) => location.name)), sourceCheckNames);
  assert.doesNotMatch(conservative.sql, /invitation_codes_code_format" CHECK \(length\(/);

  assert.equal(enUsResult.report.source.regexRangeProbe.unicode_scalar_count, 1_112_063);
  assert.equal(sqliteInsertPasses(enUsResult.sql, "waitlist", "email", "x@y.co1"), false);
  assert.equal(sqliteInsertPasses(enUsResult.sql, "waitlist", "email", "First.Last+tag@sub-domain.example.jp"), true);

  const unknownProbeField = structuredClone(enUsLocale);
  unknownProbeField.regex_range_probe.unreviewed = 0;
  assert.throws(() => convertSchema(unknownProbeField), (error) => error.code === "invalid_catalog_regex_range_probe");

  const changedProbe = structuredClone(enUsLocale);
  changedProbe.regex_range_probe.email_tld_extra_matches = 1;
  const changedProbeResult = convertSchema(changedProbe);
  const changedProbeGates = changedProbeResult.report.gates
    .filter((gate) => gate.code === "unsupported_check_constraint")
    .flatMap((gate) => gate.locations)
    .filter((location) => sourceCheckNames.has(location.name));
  assert.deepEqual(new Set(changedProbeGates.map((location) => location.name)), sourceCheckNames);
});

test("positive unconstrained numeric checks use exact canonical decimal text", () => {
  const result = convertSchema(fixture());
  assert.match(result.sql, /"lottery_probability" NOT GLOB '\*\[\^0-9\.\]\*'/);
  assert.equal(gateCodes(result.report).has("decimal_import_validation"), false);

  const insert = (valueSql) => execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO fanmark_lottery_entries (id, lottery_probability) VALUES ('synthetic', ${valueSql});`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (const value of ["'1'", "'1.00'", "'0.0000000000000000000000000001'", "'999999999999999999999999999999.99'"]) {
    assert.doesNotThrow(() => insert(value), `expected ${value} to satisfy PostgreSQL numeric > 0`);
  }
  assert.doesNotThrow(() => execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO fanmark_lottery_entries (id) VALUES ('synthetic-default');`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }), "the source default 1.0 must remain a valid positive value");

  for (const value of ["'0'", "'0.000'", "'-0.1'", "'-1'", "'01'", "'1.'", "'.1'", "'1..0'", "'1e-4000'", "'+1'", "' 1'"]) {
    assert.throws(() => insert(value), `expected ${value} to fail the positive canonical decimal check`);
  }
  assert.throws(() => insert("'1' || char(0) || '2'"), "embedded NUL must be rejected like PostgreSQL text");
  assert.throws(() => insert("NULL"), "source lottery_probability is NOT NULL");

  const unrelatedNumeric = fixture();
  unrelatedNumeric.columns.push(column("parent", "custom_weight", 9, "numeric", { not_null: true }));
  const unrelatedResult = convertSchema(unrelatedNumeric);
  assert.ok(unrelatedResult.report.gates.some((gate) =>
    gate.code === "decimal_import_validation" &&
    gate.locations.some((location) => location.table === "parent" && location.column === "custom_weight"),
  ), "unreviewed unconstrained numerics must remain gated");

  const missingCheck = fixture();
  missingCheck.constraints = missingCheck.constraints.filter((entry) => entry.name !== "positive_probability");
  const missingCheckResult = convertSchema(missingCheck);
  assert.ok(missingCheckResult.report.gates.some((gate) =>
    gate.code === "decimal_import_validation" &&
    gate.locations.some((location) => location.table === "fanmark_lottery_entries" && location.column === "lottery_probability"),
  ), "the exact codec requires the reviewed validated source check");

  const nullableInput = fixture();
  nullableInput.columns.find((entry) => entry.table_name === "fanmark_lottery_entries" && entry.column_name === "lottery_probability").not_null = false;
  const nullableResult = convertSchema(nullableInput);
  assert.ok(nullableResult.report.gates.some((gate) =>
    gate.code === "representation_sensitive_check" &&
    gate.locations.some((location) => location.name === "positive_probability"),
  ));
  assert.doesNotMatch(nullableResult.sql, /CONSTRAINT "positive_probability"/);
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

test("descriptor path cannot collide with catalog or generated outputs", () => {
  assert.throws(
    () => validateDistinctPaths("catalog.json", "schema.sql", "report.json", "./catalog.json"),
    (error) => error.code === "output_paths_must_differ",
  );
  assert.throws(
    () => validateDistinctPaths("catalog.json", "schema.sql", "report.json", "./report.json"),
    (error) => error.code === "output_paths_must_differ",
  );
});

test("present catalog scopes and parenthesized enum comparisons cannot imply parity", () => {
  const input = fixture();
  input.columns.push(column("parent", "role", 9, "app_role", { type_kind: "e", type_schema: "public", type_name: "app_role" }));
  input.constraints.push(constraint("parent", "role_order", "c", "CHECK ((role) > 'admin'::app_role)"));
  input.triggers = [{ name: "untranslated_trigger" }];
  const result = convertSchema(input);
  assert.equal(result.report.deployable, false);
  assert.ok(result.report.gates.some(gate => gate.code === "unsupported_catalog_scope" && gate.locations.some(location => location.name === "triggers")));
  assert.ok(result.report.gates.some(gate => gate.code === "representation_sensitive_check" && gate.locations.some(location => location.name === "role_order")));
  assert.doesNotMatch(result.sql, /CONSTRAINT "role_order"/);
  assert.match(result.sql, /"role" IN \('admin', 'user'\)/);
});

test("the exact recent-active view is adapted only to the reviewed D1 query", () => {
  const definition = " SELECT fl.id AS license_id,\n    fl.fanmark_id,\n    f.short_id AS fanmark_short_id,\n    fl.display_fanmark AS display_emoji,\n    fl.created_at AS license_created_at\n   FROM fanmark_licenses fl\n     JOIN fanmarks f ON f.id = fl.fanmark_id\n  WHERE fl.status = 'active'::text;";
  const input = fixture();
  input.views = [{ kind: "view", name: "recent_active_fanmarks", definition }];

  const result = convertSchema(input);
  assert.equal(result.report.schemaVersion, 40);
  assert.equal(result.report.deployable, false);
  assert.deepEqual(result.report.target.catalogScopeAdaptations, [{
    scope: "views",
    sourceObject: "recent_active_fanmarks",
    sourceDefinitionSha256: "edb14241ebabddc6167bf07eee51ad24843f564e0a925bac4eedb1d44bdb3a3c",
    disposition: "replaced_by_d1_worker_query",
    replacement: "GET /api/fanmarks/recent via D1_RECENT_FANMARKS_SQL",
    evidence: [
      "workers/api/src/d1-repository.ts",
      "workers/api/test/d1-repository.test.ts",
      "docs/migration/d1-recent-contract.md",
    ],
  }]);
  assert.equal(result.report.gates.some((gate) => (
    gate.code === "unsupported_catalog_scope" && gate.locations.some((location) => location.name === "views")
  )), false);
  for (const scope of ["triggers", "rls_policies", "functions"]) {
    assert.ok(result.report.gates.some((gate) => (
      gate.code === "unsupported_catalog_scope" && gate.locations.some((location) => location.name === scope)
    )));
  }

  const changedDefinition = convertSchema({
    ...input,
    views: [{ ...input.views[0], definition: `${definition}\n` }],
  });
  assert.deepEqual(changedDefinition.report.target.catalogScopeAdaptations, []);
  assert.ok(changedDefinition.report.gates.some((gate) => (
    gate.code === "unsupported_catalog_scope" && gate.locations.some((location) => location.name === "views")
  )));

  const additionalView = convertSchema({
    ...input,
    views: [...input.views, { kind: "view", name: "unreviewed_view", definition }],
  });
  assert.deepEqual(additionalView.report.target.catalogScopeAdaptations, []);
  assert.ok(additionalView.report.gates.some((gate) => (
    gate.code === "unsupported_catalog_scope" && gate.locations.some((location) => location.name === "views")
  )));
});

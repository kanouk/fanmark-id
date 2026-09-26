#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { convertSchema, validateDistinctPaths } from "./schema-convert.mjs";
import { CREDENTIAL_CODEC_COST, CREDENTIAL_CODEC_ID } from "./credential-descriptor.mjs";

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
  assert.equal(first.report.schemaVersion, 4);
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
      codec: "decimal-canonical-text",
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
    "money_cents_import",
    "decimal_import_validation",
    "representation_sensitive_check",
    "unsupported_check_constraint",
    "unsupported_constraint",
    "unsupported_index_method",
    "unsupported_index_expression",
  ]) {
    assert.ok(codes.has(expected), `missing gate ${expected}`);
  }
  assert.ok(!codes.has("uuid_default_requires_operation"));
  assert.match(first.sql, /"id" TEXT NOT NULL DEFAULT \(lower\([\s\S]*randomblob\(6\)[\s\S]*\)\)/);
  assert.equal(first.report.deployable, false);
  assert.equal(
    first.report.stageReadiness.rowConversion.gateGroupCount + first.report.stageReadiness.schemaAndOperations.gateGroupCount,
    first.report.unresolvedGateCount,
  );
  assert.equal(first.report.stageReadiness.rowConversion.ready, false);
  assert.equal(first.report.stageReadiness.schemaAndOperations.ready, false);
  assert.ok(first.report.stageReadiness.rowConversion.gateCodes.includes("money_cents_import"));
  assert.ok(first.report.stageReadiness.schemaAndOperations.gateCodes.includes("unsupported_index_method"));
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

test("sequence-backed bigint primary keys use AUTOINCREMENT and preserve the import gate", () => {
  const input = fixture();
  input.columns.push(column("fanmark_events", "id", 1, "bigint", {
    not_null: true,
    default_expression: "nextval('public.fanmark_events_id_seq'::regclass)",
  }));
  input.constraints.push(constraint("fanmark_events", "fanmark_events_pkey", "p", "PRIMARY KEY (id)"));
  const result = convertSchema(input);

  assert.match(result.sql, /CREATE TABLE "fanmark_events" \(\s*"id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,/);
  assert.doesNotMatch(result.sql, /CONSTRAINT "fanmark_events_pkey" PRIMARY KEY/);
  assert.ok(result.report.stageReadiness.rowConversion.gateCodes.includes("sequence_state_import_required"));
  assert.ok(!gateCodes(result.report).has("sequence_default_requires_operation"));

  const rows = execFileSync("sqlite3", [":memory:"], {
    input: `${result.sql}\nINSERT INTO fanmark_events DEFAULT VALUES;\nINSERT INTO fanmark_events DEFAULT VALUES;\nINSERT INTO fanmark_events (id) VALUES (50);\nINSERT INTO fanmark_events DEFAULT VALUES;\nDELETE FROM fanmark_events WHERE id = 51;\nINSERT INTO fanmark_events DEFAULT VALUES;\nSELECT id FROM fanmark_events ORDER BY id;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim().split(/\r?\n/);
  assert.deepEqual(rows, ["1", "2", "50", "52"]);

  const unrecognized = fixture();
  unrecognized.columns.push(column("child", "sequence_value", 4, "bigint", {
    default_expression: "nextval('public.unrelated_sequence'::regclass)",
  }));
  const unsafeResult = convertSchema(unrecognized);
  assert.ok(gateCodes(unsafeResult.report).has("sequence_default_requires_operation"));
  assert.doesNotMatch(unsafeResult.sql, /sequence_value.*AUTOINCREMENT/);
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
  assert.equal(planned.report.gates.some((gate) => gate.code === "credential_transform_import_required"), true);
  assert.ok(planned.report.stageReadiness.rowConversion.gateCodes.includes("credential_transform_import_required"));
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

test("known ASCII PostgreSQL regex checks translate only with the source C locale", () => {
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
  assert.equal(result.report.schemaVersion, 4);

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

  const nonCLocale = regexSchemaFixture();
  nonCLocale.database_locale = { collate: "en_US.UTF-8", ctype: "en_US.UTF-8" };
  const conservative = convertSchema(nonCLocale);
  const remaining = conservative.report.gates
    .filter((gate) => gate.code === "unsupported_check_constraint")
    .flatMap((gate) => gate.locations)
    .filter((location) => sourceCheckNames.has(location.name));
  assert.deepEqual(new Set(remaining.map((location) => location.name)), sourceCheckNames);
  assert.doesNotMatch(conservative.sql, /invitation_codes_code_format" CHECK \(length\(/);
});

test("positive unconstrained numeric checks use exact canonical decimal text", () => {
  const result = convertSchema(fixture());
  assert.match(result.sql, /"lottery_probability" NOT GLOB '\*\[\^0-9\.\]\*'/);
  assert.ok(gateCodes(result.report).has("decimal_import_validation"));

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

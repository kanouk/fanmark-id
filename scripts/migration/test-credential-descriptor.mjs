#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalJson } from "./snapshot-format.mjs";
import {
  CREDENTIAL_CODEC_COST,
  CREDENTIAL_CODEC_ID,
  CREDENTIAL_COLUMN,
  CREDENTIAL_NONCREDENTIAL_COLUMNS,
  CREDENTIAL_SOURCE_COLUMNS,
  compileCredentialDescriptor,
  compileCredentialDescriptorSet,
} from "./credential-descriptor.mjs";

function column(table_name, column_name, ordinal, postgres_type, not_null = true) {
  return {
    table_name,
    column_name,
    ordinal,
    postgres_type,
    type_schema: "pg_catalog",
    type_name: postgres_type,
    type_kind: "b",
    not_null,
    default_expression: null,
    identity: "",
    generated: "",
    collation: null,
  };
}

function constraint(table_name, name, kind, definition) {
  return {
    table_name,
    name,
    kind,
    definition,
    validated: true,
    deferrable: false,
    initially_deferred: false,
  };
}

function index(table_name, name, definition, unique = false, primary = false) {
  return { table_name, name, definition, valid: true, unique, primary };
}

function catalog() {
  return {
    observed_at: "2026-09-21T00:00:00Z",
    columns: [
      column("fanmark_password_configs", "id", 1, "uuid"),
      column("fanmark_password_configs", "license_id", 2, "uuid"),
      column("fanmark_password_configs", "access_password", 3, "text"),
      column("fanmark_password_configs", "is_enabled", 4, "boolean"),
      column("fanmark_password_configs", "created_at", 5, "timestamp with time zone"),
      column("fanmark_password_configs", "updated_at", 6, "timestamp with time zone"),
    ],
    constraints: [
      constraint("fanmark_password_configs", "fanmark_password_configs_pkey", "p", "PRIMARY KEY (id)"),
      constraint("fanmark_password_configs", "fanmark_password_configs_license_id_key", "u", "UNIQUE (license_id)"),
      constraint(
        "fanmark_password_configs",
        "fanmark_password_configs_license_id_fkey",
        "f",
        "FOREIGN KEY (license_id) REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE",
      ),
    ],
    indexes: [
      index("fanmark_password_configs", "fanmark_password_configs_pkey", "CREATE UNIQUE INDEX fanmark_password_configs_pkey ON public.fanmark_password_configs USING btree (id)", true, true),
      index("fanmark_password_configs", "fanmark_password_configs_license_id_key", "CREATE UNIQUE INDEX fanmark_password_configs_license_id_key ON public.fanmark_password_configs USING btree (license_id)", true),
    ],
    enums: [],
  };
}

function descriptor() {
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

function compile(overrides = {}, options = {}) {
  return compileCredentialDescriptor({
    catalog: options.catalog ?? catalog(),
    destinationCatalog: options.destinationCatalog,
    descriptor: { ...descriptor(), ...overrides },
  });
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code, code);
}

test("descriptor and mapping plan are deterministic, canonical, and immutable", () => {
  const first = compile();
  const second = compile();
  assert.equal(first.descriptorDigest, second.descriptorDigest);
  assert.equal(first.canonicalDescriptorJson, canonicalJson(descriptor()));
  assert.deepEqual(first.descriptor, second.descriptor);
  assert.deepEqual(first.columnMapping, second.columnMapping);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.descriptor), true);
  assert.equal(Object.isFrozen(first.columnMapping), true);
  assert.equal(Object.isFrozen(first.columnMapping[0]), true);
  assert.throws(() => { first.descriptor.codecCost = 12; }, TypeError);
  assert.throws(() => { first.columnMapping.push({}); }, TypeError);
});

test("mapping keeps the six source columns and isolates only the credential input", () => {
  const plan = compile();
  assert.deepEqual(plan.source.columns.map((column) => column.name), CREDENTIAL_SOURCE_COLUMNS);
  assert.deepEqual(plan.ordinarySourceColumns, CREDENTIAL_NONCREDENTIAL_COLUMNS);
  assert.deepEqual(plan.credentialSourceColumns, [CREDENTIAL_COLUMN]);
  assert.deepEqual(plan.ordinaryDestinationColumns, CREDENTIAL_NONCREDENTIAL_COLUMNS);
  assert.deepEqual(plan.credentialDestinationColumns, [CREDENTIAL_COLUMN]);
  assert.deepEqual(plan.columnMapping.map((entry) => entry.mode), [
    "ordinary_source_binding",
    "ordinary_source_binding",
    "credential_transform",
    "ordinary_source_binding",
    "ordinary_source_binding",
    "ordinary_source_binding",
  ]);
  assert.deepEqual(plan.primaryKeyMapping, [{ sourceColumn: "id", destinationColumn: "id" }]);
  assert.deepEqual(plan.licenseMapping, { sourceColumn: "license_id", destinationColumn: "license_id" });
  assert.equal(plan.transform.codecId, CREDENTIAL_CODEC_ID);
  assert.equal(plan.transform.codecCost, CREDENTIAL_CODEC_COST);
});

test("descriptor is explicit and raw-value-shaped options fail closed", () => {
  assertCode(() => compileCredentialDescriptor({ catalog: catalog() }), "credential_descriptor_missing");
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: { ...descriptor(), rawPassword: "secret" } }), "credential_descriptor_fields");
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: descriptor(), sourceRow: { access_password: "secret" } }), "credential_descriptor_options");
  const oddPrototype = descriptor();
  Object.setPrototypeOf(oddPrototype, { injected: true });
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: oddPrototype }), "credential_descriptor_fields");
  const accessor = descriptor();
  Object.defineProperty(accessor, "codecId", {
    enumerable: true,
    get() {
      throw new Error("accessor must not execute");
    },
  });
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: accessor }), "credential_descriptor_fields");
  const symbolField = descriptor();
  symbolField[Symbol("unexpected")] = true;
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: symbolField }), "credential_descriptor_fields");
  const hiddenField = descriptor();
  Object.defineProperty(hiddenField, "rawPassword", { value: "secret", enumerable: false });
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: hiddenField }), "credential_descriptor_fields");
  const hiddenPolicy = descriptor();
  Object.defineProperty(hiddenPolicy, "codecCost", { value: CREDENTIAL_CODEC_COST, enumerable: false });
  assertCode(() => compileCredentialDescriptor({ catalog: catalog(), descriptor: hiddenPolicy }), "credential_descriptor_fields");
  assertCode(() => compile({ codecCost: Number.POSITIVE_INFINITY }), "credential_descriptor_codec_cost");
  assertCode(() => compile({ policyVersion: Number.NaN }), "credential_descriptor_policy_version");
});

test("wrong transform policy, source identity, and destination mapping are rejected", () => {
  assertCode(() => compile({ codecId: "bcryptjs@3.0.2" }), "unsupported_credential_codec");
  assertCode(() => compile({ codecCost: 12 }), "unsupported_credential_cost");
  assertCode(() => compile({ sourceRelation: "fanmarks" }), "unsupported_credential_source_relation");
  assertCode(() => compile({ sourceColumn: "password" }), "unsupported_credential_source_column");
  assertCode(() => compile({ destinationColumn: "password_hash" }), "credential_destination_collision");
  assertCode(() => compile({ inactiveLicensePolicy: "dummy_hash" }), "unsupported_inactive_license_policy");
});

test("duplicate descriptors and destination collisions are rejected", () => {
  const one = descriptor();
  assertCode(() => compileCredentialDescriptorSet({ catalog: catalog(), descriptors: [one, structuredClone(one)] }), "credential_descriptor_duplicate");
  const collision = { ...one, sourceColumn: "other", destinationColumn: "access_password" };
  assertCode(() => compileCredentialDescriptorSet({ catalog: catalog(), descriptors: [one, collision] }), "credential_destination_collision");
  assertCode(() => compileCredentialDescriptorSet({ catalog: catalog(), descriptors: [] }), "credential_descriptor_missing");
  assertCode(() => compileCredentialDescriptorSet({ catalog: catalog(), descriptors: [one, { ...one, sourceColumn: "other" }] }), "credential_destination_collision");
});

test("source and destination catalog shape, PK, uniqueness, and types are verified", () => {
  const missing = catalog();
  missing.columns = missing.columns.filter((column) => column.column_name !== "access_password");
  assertCode(() => compile({ }, { catalog: missing }), "credential_source_columns_mismatch");

  const duplicate = catalog();
  duplicate.columns.push({ ...duplicate.columns[0], ordinal: 7 });
  assertCode(() => compile({}, { catalog: duplicate }), "duplicate_credential_catalog_column");

  const wrongSourceType = catalog();
  wrongSourceType.columns[2].postgres_type = "bytea";
  assertCode(() => compile({}, { catalog: wrongSourceType }), "credential_source_column_type_mismatch");

  const wrongDestinationType = catalog();
  wrongDestinationType.columns[2].postgres_type = "varchar";
  assertCode(() => compile({}, { destinationCatalog: wrongDestinationType }), "credential_destination_column_type_mismatch");

  const noPrimary = catalog();
  noPrimary.constraints = noPrimary.constraints.filter((entry) => entry.kind !== "p");
  assertCode(() => compile({}, { catalog: noPrimary }), "credential_source_primary_key");

  const noLicenseUnique = catalog();
  noLicenseUnique.constraints = noLicenseUnique.constraints.filter((entry) => entry.kind !== "u");
  noLicenseUnique.indexes = noLicenseUnique.indexes.filter((entry) => !entry.name.endsWith("license_id_key"));
  assertCode(() => compile({}, { catalog: noLicenseUnique }), "credential_source_license_uniqueness");

  const wrongLicenseForeignKey = catalog();
  wrongLicenseForeignKey.constraints = wrongLicenseForeignKey.constraints.map((entry) => entry.kind === "f"
    ? { ...entry, definition: "FOREIGN KEY (license_id) REFERENCES public.other(id) ON DELETE CASCADE" }
    : entry);
  assertCode(() => compile({}, { catalog: wrongLicenseForeignKey }), "credential_source_license_foreign_key");
});

test("catalog metadata rejects unknown fields and non-finite values", () => {
  const extra = catalog();
  extra.columns[0].rawValue = "secret";
  assertCode(() => compile({}, { catalog: extra }), "credential_catalog_column");

  const extraTopLevel = catalog();
  extraTopLevel.rows = [];
  assertCode(() => compile({}, { catalog: extraTopLevel }), "credential_catalog_fields");

  const badEnum = catalog();
  badEnum.enums = [{ type_name: "x", value: "x", sort_order: Number.POSITIVE_INFINITY }];
  assertCode(() => compile({}, { catalog: badEnum }), "credential_catalog_enum");
});

#!/usr/bin/env node

/**
 * Validate the explicit credential policy used by the future D1 importer.
 *
 * This module accepts schema metadata only. It never accepts source rows,
 * password values, hashes, or a destination database binding. The returned
 * descriptor and mapping plan are immutable metadata and can be bound to a
 * verified snapshot by the later importer slice.
 */

import { canonicalJson, sha256Hex } from "./snapshot-format.mjs";

export const CREDENTIAL_DESCRIPTOR_VERSION = 1;
export const CREDENTIAL_SOURCE_RELATION = "fanmark_password_configs";
export const CREDENTIAL_SOURCE_COLUMNS = Object.freeze([
  "id",
  "license_id",
  "access_password",
  "is_enabled",
  "created_at",
  "updated_at",
]);
export const CREDENTIAL_NONCREDENTIAL_COLUMNS = Object.freeze([
  "id",
  "license_id",
  "is_enabled",
  "created_at",
  "updated_at",
]);
export const CREDENTIAL_COLUMN = "access_password";
export const CREDENTIAL_CODEC_ID = "bcryptjs@3.0.3";
export const CREDENTIAL_CODEC_COST = 10;
export const CREDENTIAL_TRANSFORM_KIND = "credential_to_bcrypt";
export const CREDENTIAL_TRANSFORM_CONTRACT_VERSION = 1;
export const CREDENTIAL_POLICY_VERSION = 1;
export const CREDENTIAL_INACTIVE_LICENSE_POLICY = "migration_gate";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DESCRIPTOR_KEYS = Object.freeze([
  "version",
  "sourceRelation",
  "sourceColumn",
  "sourcePrimaryKeyColumns",
  "enabledColumn",
  "licenseColumn",
  "destinationRelation",
  "destinationColumn",
  "transformKind",
  "codecId",
  "codecCost",
  "transformContractVersion",
  "policyVersion",
  "inactiveLicensePolicy",
]);
const OPTION_KEYS = new Set(["catalog", "destinationCatalog", "descriptor"]);
const SET_OPTION_KEYS = new Set(["catalog", "destinationCatalog", "descriptors"]);
const CATALOG_KEYS = new Set([
  "columns",
  "constraints",
  "enums",
  "indexes",
  "observed_at",
  "triggers",
  "rls_policies",
  "views",
  "functions",
]);
const COLUMN_KEYS = new Set([
  "table_name",
  "column_name",
  "ordinal",
  "postgres_type",
  "type_schema",
  "type_name",
  "type_kind",
  "not_null",
  "default_expression",
  "identity",
  "generated",
  "collation",
]);
const CONSTRAINT_KEYS = new Set([
  "table_name",
  "name",
  "kind",
  "definition",
  "validated",
  "deferrable",
  "initially_deferred",
]);
const INDEX_KEYS = new Set(["table_name", "name", "definition", "valid", "unique", "primary"]);
const ENUM_KEYS = new Set(["type_name", "value", "sort_order"]);
const EXPECTED_TYPES = Object.freeze({
  id: { postgresType: "uuid", notNull: true },
  license_id: { postgresType: "uuid", notNull: true },
  access_password: { postgresType: "text", notNull: true },
  is_enabled: { postgresType: "boolean", notNull: true },
  created_at: { postgresType: "timestamp with time zone", notNull: true },
  updated_at: { postgresType: "timestamp with time zone", notNull: true },
});

export class CredentialDescriptorError extends Error {
  constructor(code) {
    super(code);
    this.name = "CredentialDescriptorError";
    this.code = code;
  }
}

function fail(code) {
  throw new CredentialDescriptorError(code);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function assertPlainRecord(value, code) {
  if (!isPlainRecord(value)) fail(code);
  return value;
}

function assertAllowedKeys(value, allowed, code) {
  assertPlainRecord(value, code);
  for (const key of ownDataKeys(value, code)) {
    if (!allowed.has(key)) fail(code);
  }
}

function assertExactKeys(value, expected, code) {
  assertPlainRecord(value, code);
  const actual = ownDataKeys(value, code).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function ownDataKeys(value, code) {
  const keys = Reflect.ownKeys(value);
  const strings = [];
  for (const key of keys) {
    if (typeof key !== "string") fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
    strings.push(key);
  }
  return strings;
}

function assertIdentifier(value, code) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) fail(code);
  return value;
}

function assertNonEmptyString(value, code) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function assertSafeInteger(value, code) {
  if (!Number.isSafeInteger(value)) fail(code);
  return value;
}

function assertBoolean(value, code) {
  if (typeof value !== "boolean") fail(code);
  return value;
}

function parseColumnList(definition, prefix) {
  if (typeof definition !== "string") return null;
  const match = definition.trim().match(new RegExp(`^${prefix}\\s*\\(([^)]*)\\)$`, "iu"));
  if (!match) return null;
  const columns = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  if (columns.length === 0 || columns.some((value) => !IDENTIFIER_RE.test(value))) return null;
  return columns;
}

function isLicenseForeignKey(constraint) {
  if (constraint.kind !== "f" || constraint.validated !== true || constraint.deferrable || constraint.initially_deferred) return false;
  const match = constraint.definition.trim().match(
    /^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(.*)$/iu,
  );
  if (!match) return false;
  const sourceColumns = match[1].split(",").map((value) => value.trim());
  const referenceColumns = match[3].split(",").map((value) => value.trim());
  const referenceParts = match[2].split(".");
  const referenceSchema = referenceParts.length === 2 ? referenceParts[0] : "public";
  const referenceTable = referenceParts.at(-1);
  const actions = match[4].trim().replace(/\s+/gu, " ").toUpperCase();
  return sourceColumns.length === 1 && sourceColumns[0] === "license_id"
    && referenceSchema === "public" && referenceTable === "fanmark_licenses"
    && referenceColumns.length === 1 && referenceColumns[0] === "id"
    && actions === "ON DELETE CASCADE";
}

function validateDescriptorShape(descriptor) {
  assertExactKeys(descriptor, DESCRIPTOR_KEYS, "credential_descriptor_fields");
  assertSafeInteger(descriptor.version, "credential_descriptor_version");
  assertIdentifier(descriptor.sourceRelation, "credential_descriptor_source_relation");
  assertIdentifier(descriptor.sourceColumn, "credential_descriptor_source_column");
  if (!Array.isArray(descriptor.sourcePrimaryKeyColumns) || descriptor.sourcePrimaryKeyColumns.length === 0) fail("credential_descriptor_primary_key");
  if (descriptor.sourcePrimaryKeyColumns.some((column) => typeof column !== "string" || !IDENTIFIER_RE.test(column))) fail("credential_descriptor_primary_key");
  if (new Set(descriptor.sourcePrimaryKeyColumns).size !== descriptor.sourcePrimaryKeyColumns.length) fail("credential_descriptor_primary_key");
  assertIdentifier(descriptor.enabledColumn, "credential_descriptor_enabled_column");
  assertIdentifier(descriptor.licenseColumn, "credential_descriptor_license_column");
  assertIdentifier(descriptor.destinationRelation, "credential_descriptor_destination_relation");
  assertIdentifier(descriptor.destinationColumn, "credential_descriptor_destination_column");
  assertNonEmptyString(descriptor.transformKind, "credential_descriptor_transform_kind");
  assertNonEmptyString(descriptor.codecId, "credential_descriptor_codec_id");
  assertSafeInteger(descriptor.codecCost, "credential_descriptor_codec_cost");
  assertSafeInteger(descriptor.transformContractVersion, "credential_descriptor_transform_contract_version");
  assertSafeInteger(descriptor.policyVersion, "credential_descriptor_policy_version");
  assertNonEmptyString(descriptor.inactiveLicensePolicy, "credential_descriptor_inactive_policy");
  return descriptor;
}

function validateDescriptorPolicy(descriptor) {
  if (descriptor.version !== CREDENTIAL_DESCRIPTOR_VERSION) fail("unsupported_credential_descriptor_version");
  if (descriptor.sourceRelation !== CREDENTIAL_SOURCE_RELATION) fail("unsupported_credential_source_relation");
  if (descriptor.sourceColumn !== CREDENTIAL_COLUMN) fail("unsupported_credential_source_column");
  if (JSON.stringify(descriptor.sourcePrimaryKeyColumns) !== JSON.stringify(["id"])) fail("unsupported_credential_primary_key");
  if (descriptor.enabledColumn !== "is_enabled") fail("credential_enabled_column_mismatch");
  if (descriptor.licenseColumn !== "license_id") fail("credential_license_column_mismatch");
  if (descriptor.destinationRelation !== CREDENTIAL_SOURCE_RELATION || descriptor.destinationColumn !== CREDENTIAL_COLUMN) fail("credential_destination_collision");
  if (descriptor.transformKind !== CREDENTIAL_TRANSFORM_KIND) fail("unsupported_credential_transform");
  if (descriptor.codecId !== CREDENTIAL_CODEC_ID) fail("unsupported_credential_codec");
  if (descriptor.codecCost !== CREDENTIAL_CODEC_COST) fail("unsupported_credential_cost");
  if (descriptor.transformContractVersion !== CREDENTIAL_TRANSFORM_CONTRACT_VERSION) fail("unsupported_credential_transform_contract");
  if (descriptor.policyVersion !== CREDENTIAL_POLICY_VERSION) fail("unsupported_credential_policy_version");
  if (descriptor.inactiveLicensePolicy !== CREDENTIAL_INACTIVE_LICENSE_POLICY) fail("unsupported_inactive_license_policy");
}

function validateCatalogShape(catalog) {
  assertAllowedKeys(catalog, CATALOG_KEYS, "credential_catalog_fields");
  for (const key of ["columns", "constraints", "enums", "indexes"]) {
    if (!Array.isArray(catalog[key])) fail("credential_catalog_scope");
  }
  for (const key of ["triggers", "rls_policies", "views", "functions"]) {
    if (catalog[key] !== undefined && !Array.isArray(catalog[key])) fail("credential_catalog_scope");
  }
  if (catalog.observed_at !== undefined && catalog.observed_at !== null && typeof catalog.observed_at !== "string") fail("credential_catalog_observed_at");

  const columns = [];
  const seenColumns = new Set();
  const seenOrdinals = new Set();
  for (const column of catalog.columns) {
    assertAllowedKeys(column, COLUMN_KEYS, "credential_catalog_column");
    for (const key of ["table_name", "column_name", "postgres_type", "type_schema", "type_name", "type_kind"]) assertNonEmptyString(column[key], "credential_catalog_column");
    assertIdentifier(column.table_name, "credential_catalog_identifier");
    assertIdentifier(column.column_name, "credential_catalog_identifier");
    assertSafeInteger(column.ordinal, "credential_catalog_ordinal");
    if (column.ordinal < 1) fail("credential_catalog_ordinal");
    assertBoolean(column.not_null, "credential_catalog_not_null");
    if (column.default_expression !== undefined && column.default_expression !== null && typeof column.default_expression !== "string") fail("credential_catalog_column");
    if (column.identity !== undefined && column.identity !== null && typeof column.identity !== "string") fail("credential_catalog_column");
    if (column.generated !== undefined && column.generated !== null && typeof column.generated !== "string") fail("credential_catalog_column");
    if (column.collation !== undefined && column.collation !== null && typeof column.collation !== "string") fail("credential_catalog_column");
    const columnKey = `${column.table_name}\0${column.column_name}`;
    const ordinalKey = `${column.table_name}\0${column.ordinal}`;
    if (seenColumns.has(columnKey)) fail("duplicate_credential_catalog_column");
    if (seenOrdinals.has(ordinalKey)) fail("duplicate_credential_catalog_ordinal");
    seenColumns.add(columnKey);
    seenOrdinals.add(ordinalKey);
    columns.push(column);
  }

  for (const constraint of catalog.constraints) {
    assertAllowedKeys(constraint, CONSTRAINT_KEYS, "credential_catalog_constraint");
    assertIdentifier(constraint.table_name, "credential_catalog_identifier");
    assertIdentifier(constraint.name, "credential_catalog_identifier");
    assertNonEmptyString(constraint.kind, "credential_catalog_constraint");
    assertNonEmptyString(constraint.definition, "credential_catalog_constraint");
    assertBoolean(constraint.validated, "credential_catalog_constraint");
    assertBoolean(constraint.deferrable, "credential_catalog_constraint");
    assertBoolean(constraint.initially_deferred, "credential_catalog_constraint");
  }
  for (const index of catalog.indexes) {
    assertAllowedKeys(index, INDEX_KEYS, "credential_catalog_index");
    assertIdentifier(index.table_name, "credential_catalog_identifier");
    assertIdentifier(index.name, "credential_catalog_identifier");
    assertNonEmptyString(index.definition, "credential_catalog_index");
    assertBoolean(index.valid, "credential_catalog_index");
    assertBoolean(index.unique, "credential_catalog_index");
    assertBoolean(index.primary, "credential_catalog_index");
  }
  for (const entry of catalog.enums) {
    assertAllowedKeys(entry, ENUM_KEYS, "credential_catalog_enum");
    assertNonEmptyString(entry.type_name, "credential_catalog_enum");
    assertNonEmptyString(entry.value, "credential_catalog_enum");
    if (typeof entry.sort_order !== "number" || !Number.isFinite(entry.sort_order)) fail("credential_catalog_enum");
  }
  return { ...catalog, columns };
}

function relationColumns(catalog, relation, role) {
  const columns = catalog.columns.filter((column) => column.table_name === relation).sort((left, right) => left.ordinal - right.ordinal);
  if (columns.length === 0) fail(role === "source" ? "credential_source_relation_missing" : "credential_destination_relation_missing");
  return columns;
}

function assertExpectedColumns(columns, role) {
  const names = columns.map((column) => column.column_name);
  if (JSON.stringify(names) !== JSON.stringify(CREDENTIAL_SOURCE_COLUMNS)) fail(role === "source" ? "credential_source_columns_mismatch" : "credential_destination_columns_mismatch");
  for (const column of columns) {
    const expected = EXPECTED_TYPES[column.column_name];
    if (!expected || column.postgres_type !== expected.postgresType || column.not_null !== expected.notNull) {
      fail(role === "source" ? "credential_source_column_type_mismatch" : "credential_destination_column_type_mismatch");
    }
  }
}

function assertRelationConstraints(catalog, relation, role) {
  const constraints = catalog.constraints.filter((constraint) => constraint.table_name === relation);
  const primary = constraints.filter((constraint) => constraint.kind === "p");
  if (primary.length !== 1 || JSON.stringify(parseColumnList(primary[0].definition, "PRIMARY KEY")) !== JSON.stringify(["id"]) || primary[0].validated !== true || primary[0].deferrable || primary[0].initially_deferred) {
    fail(role === "source" ? "credential_source_primary_key" : "credential_destination_primary_key");
  }
  const uniqueLicense = constraints.some((constraint) => constraint.kind === "u" && JSON.stringify(parseColumnList(constraint.definition, "UNIQUE")) === JSON.stringify(["license_id"]) && constraint.validated === true && !constraint.deferrable && !constraint.initially_deferred);
  if (!uniqueLicense) fail(role === "source" ? "credential_source_license_uniqueness" : "credential_destination_license_uniqueness");
  if (!constraints.some(isLicenseForeignKey)) fail(role === "source" ? "credential_source_license_foreign_key" : "credential_destination_license_foreign_key");
}

function relationMetadata(catalog, relation, role) {
  const columns = relationColumns(catalog, relation, role);
  assertExpectedColumns(columns, role);
  assertRelationConstraints(catalog, relation, role);
  return columns;
}

function canonicalDescriptor(descriptor) {
  let json;
  try {
    json = canonicalJson(descriptor);
  } catch {
    fail("credential_descriptor_not_canonicalizable");
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    fail("credential_descriptor_not_canonicalizable");
  }
  return { value, json, digest: sha256Hex(json) };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function copyColumn(column) {
  return {
    name: column.column_name,
    ordinal: column.ordinal,
    postgresType: column.postgres_type,
    notNull: column.not_null,
  };
}

function compileSingleCredentialDescriptor({ catalog, descriptor, destinationCatalog }) {
  assertPlainRecord(catalog, "credential_catalog");
  if (descriptor === undefined) fail("credential_descriptor_missing");
  validateDescriptorShape(descriptor);
  validateDescriptorPolicy(descriptor);
  const sourceCatalog = validateCatalogShape(catalog);
  const targetCatalog = validateCatalogShape(destinationCatalog ?? catalog);
  const sourceColumns = relationMetadata(sourceCatalog, CREDENTIAL_SOURCE_RELATION, "source");
  const destinationColumns = relationMetadata(targetCatalog, CREDENTIAL_SOURCE_RELATION, "destination");
  const sourceByName = new Map(sourceColumns.map((column) => [column.column_name, column]));
  const destinationByName = new Map(destinationColumns.map((column) => [column.column_name, column]));
  for (const primaryKeyColumn of descriptor.sourcePrimaryKeyColumns) {
    if (!sourceByName.has(primaryKeyColumn) || !destinationByName.has(primaryKeyColumn)) fail("credential_primary_key_column_missing");
  }
  const columnMapping = CREDENTIAL_SOURCE_COLUMNS.map((name) => {
    const source = sourceByName.get(name);
    const destination = destinationByName.get(name);
    if (!source || !destination) fail("credential_column_mapping_missing");
    return {
      sourceColumn: name,
      destinationColumn: name,
      sourceType: source.postgres_type,
      destinationType: destination.postgres_type,
      sourceNotNull: source.not_null,
      destinationNotNull: destination.not_null,
      mode: name === CREDENTIAL_COLUMN ? "credential_transform" : "ordinary_source_binding",
    };
  });
  const { value: immutableDescriptor, json: canonicalDescriptorJson, digest: descriptorDigest } = canonicalDescriptor(descriptor);
  const plan = {
    descriptorVersion: CREDENTIAL_DESCRIPTOR_VERSION,
    descriptor: immutableDescriptor,
    canonicalDescriptorJson,
    descriptorDigest,
    source: {
      relation: CREDENTIAL_SOURCE_RELATION,
      columns: sourceColumns.map(copyColumn),
      primaryKeyColumns: [...descriptor.sourcePrimaryKeyColumns],
      licenseColumn: descriptor.licenseColumn,
      enabledColumn: descriptor.enabledColumn,
    },
    destination: {
      relation: CREDENTIAL_SOURCE_RELATION,
      columns: destinationColumns.map(copyColumn),
      primaryKeyColumns: [...descriptor.sourcePrimaryKeyColumns],
      licenseColumn: descriptor.licenseColumn,
      credentialColumn: descriptor.destinationColumn,
    },
    columnMapping,
    ordinarySourceColumns: [...CREDENTIAL_NONCREDENTIAL_COLUMNS],
    credentialSourceColumns: [CREDENTIAL_COLUMN],
    ordinaryDestinationColumns: [...CREDENTIAL_NONCREDENTIAL_COLUMNS],
    credentialDestinationColumns: [CREDENTIAL_COLUMN],
    primaryKeyMapping: descriptor.sourcePrimaryKeyColumns.map((name) => ({ sourceColumn: name, destinationColumn: name })),
    licenseMapping: { sourceColumn: descriptor.licenseColumn, destinationColumn: descriptor.licenseColumn },
    transform: {
      kind: descriptor.transformKind,
      codecId: descriptor.codecId,
      codecCost: descriptor.codecCost,
      transformContractVersion: descriptor.transformContractVersion,
      policyVersion: descriptor.policyVersion,
      inactiveLicensePolicy: descriptor.inactiveLicensePolicy,
    },
  };
  return deepFreeze(plan);
}

function validateOptions(options, allowed, code) {
  assertAllowedKeys(options, allowed, code);
  if (!Object.hasOwn(options, "catalog")) fail("credential_catalog_missing");
}

export function compileCredentialDescriptor(options = {}) {
  validateOptions(options, OPTION_KEYS, "credential_descriptor_options");
  if (Array.isArray(options.descriptor)) {
    return compileCredentialDescriptorSet({
      catalog: options.catalog,
      destinationCatalog: options.destinationCatalog,
      descriptors: options.descriptor,
    });
  }
  return compileSingleCredentialDescriptor(options);
}

export function compileCredentialDescriptorSet(options = {}) {
  validateOptions(options, SET_OPTION_KEYS, "credential_descriptor_options");
  if (!Array.isArray(options.descriptors) || options.descriptors.length === 0) fail("credential_descriptor_missing");
  const descriptors = options.descriptors.map((descriptor) => {
    validateDescriptorShape(descriptor);
    return descriptor;
  });
  const sourceKeys = new Set();
  const destinationKeys = new Set();
  for (const descriptor of descriptors) {
    const sourceKey = `${descriptor.sourceRelation}\0${descriptor.sourceColumn}`;
    const destinationKey = `${descriptor.destinationRelation}\0${descriptor.destinationColumn}`;
    if (sourceKeys.has(sourceKey)) fail("credential_descriptor_duplicate");
    if (destinationKeys.has(destinationKey)) fail("credential_destination_collision");
    sourceKeys.add(sourceKey);
    destinationKeys.add(destinationKey);
  }
  if (descriptors.length !== 1) fail("unsupported_credential_descriptor_set");
  return compileSingleCredentialDescriptor({
    catalog: options.catalog,
    destinationCatalog: options.destinationCatalog,
    descriptor: descriptors[0],
  });
}

export const USAGE = "credential-descriptor.mjs exposes compileCredentialDescriptor({ catalog, descriptor, destinationCatalog? }) and compileCredentialDescriptorSet({ catalog, descriptors, destinationCatalog? }).";

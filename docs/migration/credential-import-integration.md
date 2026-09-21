# Credential transform integration with the full D1 importer

This document is the implementation contract for adding the credential
transform to the verified-snapshot importer. Descriptor validation and a
separate import projection implement parts of this contract; the transactional
writer, coverage, and full importer integration remain unimplemented. These
local components do not create D1 resources or complete the 40-table migration.

The existing local transform proof is deliberately narrower: it proves one
synthetic source binding and writes a synthetic `fanmark_access_configs`
projection. That table is a proof target, not a replacement for the source
row in the full import. The full import must retain every
`fanmark_password_configs` row and its UUID relationships.

## Source and destination boundary

The verified source catalog has the following six columns in
`fanmark_password_configs`:

```text
id, license_id, access_password, is_enabled, created_at, updated_at
```

The snapshot exporter continues to write the exact canonical row envelope,
including the source `access_password` value, to the private immutable
snapshot. The envelope is source evidence; it is never a D1 binding. The
existing snapshot verifier and row converter already bind the row ordinal,
primary key, row hash, table name, column order, and canonical envelope bytes.
The credential adapter must use those exact bytes and must not trim, rewrite,
or add fields to them.

In particular, a transform adapter must not call a target-augmented object a
source envelope. `targetIdentity`, `targetIncarnation`, destination license
incarnation, codec policy, and destination column are transform metadata. They
are stored and hashed separately from the immutable source envelope. The
current credential proof mirrors some of those fields inside its synthetic
fixture envelope for a small isolated API; the production integration must
split that API into:

```text
immutableSource = {
  sourceEnvelopeBytes,
  sourceRelation: "fanmark_password_configs",
  sourcePrimaryKey: { id },
  sourceRevision,
  sourceEnvelopeDigest,
  sourceRowIdentityDigest
}

destinationBinding = {
  targetIdentity,
  targetIncarnation,
  destinationRelation: "fanmark_password_configs",
  destinationColumn: "access_password",
  destinationLicenseId: license_id,
  licenseIncarnation,
  credentialPolicyDigest
}
```

The source row's `id` and `license_id` remain unchanged. The destination
mapping must resolve the same license UUID in D1 and read its retained
incarnation; it must not infer an owner, create a Better Auth user, or replace
the UUID. A missing, duplicated, or conflicting mapping is a hard import
failure.

The integrated target keeps `fanmark_password_configs.access_password` as
TEXT and writes only the transformed bcrypt value through the reviewed
credential descriptor. The other five columns retain their source values and
UUID relationships. Runtime public access will read the catalog-shaped
basic/text/profile/password tables through an adapter. The synthetic proof's
`fanmark_access_configs.password_hash` is not an additional runtime authority
and must not replace the source row or remove it from the 40-table import.
Codec metadata and the descriptor identify transformed values; there is no
fallback that interprets this column as an untransformed credential.

## Descriptor and identity contract

The source catalog and generated schema report continue to describe all 40
application tables. Credential handling is an explicit descriptor layer, not
inference from a column name or SQLite affinity. A descriptor is private
migration metadata and contains no credential value:

```json
{
  "version": 1,
  "sourceRelation": "fanmark_password_configs",
  "sourceColumn": "access_password",
  "sourcePrimaryKeyColumns": ["id"],
  "enabledColumn": "is_enabled",
  "licenseColumn": "license_id",
  "destinationRelation": "fanmark_password_configs",
  "destinationColumn": "access_password",
  "transformKind": "credential_to_bcrypt",
  "codecId": "bcryptjs@3.0.3",
  "codecCost": 10,
  "transformContractVersion": 1,
  "policyVersion": 1,
  "inactiveLicensePolicy": "migration_gate"
}
```

The descriptor digest is computed from canonical metadata and is bound to the
snapshot manifest, import run, checkpoint, transform artifact, and private
report. A source row's identity digest is computed from the exact relation and
primary-key tuple; its envelope digest is computed from the canonical source
envelope bytes. The destination transform digest is separate and includes the
source binding, destination UUID/incarnation, enabled state, codec, and exact
transformed result. None of these digests is a substitute for another.

`schema-convert.mjs` must accept the descriptor as an explicit policy input
and emit a `credential-to-bcrypt` column-codec entry for the exact source
column. It must fail before any target write when:

- `fanmark_password_configs.access_password` has no descriptor;
- a descriptor names a missing, duplicate, or non-text source column;
- a descriptor maps two source rows to one destination identity without an
  explicit one-to-one mapping rule; or
- the destination relation/column is absent from the reviewed target schema.

The ordinary `text` codec must never be selected for `access_password`.
`schema-convert` still emits and fingerprints the existing 40 application
tables and their constraints. Credential ledger DDL is a separate reviewed
extension, and its exact SQL must be included in the destination schema
fingerprint before import.

The manifest needs a `credentialDescriptorVersion` and
`credentialDescriptorDigest` (or an equivalently signed sidecar digest bound
into the manifest). A sidecar that is not digest-bound to the manifest is
replaceable and is not sufficient. `d1-import.mjs` adds the descriptor digest
to `__fanmark_d1_import_runs`, every table checkpoint, the private report, and
the transform coverage ledger. A changed descriptor, codec/cost, destination
mapping, source schema fingerprint, generated DDL fingerprint, or policy
version cannot resume an old run; it requires a new isolated target
incarnation or an explicitly reviewed repair.

## Row-conversion changes

`row-conversion.mjs` must retain its current source-envelope contract for
snapshot export. Add an import mode or a separate compiled import projection
with these properties:

1. Validate every source value, including `access_password`, against the
   immutable envelope and the catalog. Validation happens in memory inside the
   restricted importer process.
2. Return ordinary bindings only for non-credential columns. The converted
   binding list used by `INSERT` must contain `id`, `license_id`,
   `is_enabled`, `created_at`, and `updated_at`, in catalog order, and must
   contain no `access_password` binding.
3. Return a private transform input handle containing the exact source
   envelope bytes and the descriptor metadata. The handle is consumed by the
   credential transformer and is never serialized into a report or error.
4. Preserve the source row hash and primary-key tuple for checkpoint and
   coverage accounting. A source row hash may be retained as a digest; the
   source value itself must not be copied to D1.

The default snapshot-export mode must continue to validate the complete
envelope and must not accidentally use the import-mode filtered bindings. The
two modes need distinct tests so a future refactor cannot make source export
omit a column or make D1 import bind it.

`d1-import.mjs` must derive the `INSERT` column list from the filtered import
plan, not from the catalog columns. Before creating a batch it asserts that
the set of bound source columns is disjoint from the descriptor's credential
inputs and that every destination credential write is represented by a
transform statement. A value equal to the source `access_password` appearing
in a generic `INSERT` is a hard `raw_credential_binding` failure. This guard
must run before the first public row write.

## Import sequence and atomicity

The existing parent-first order, bounded source stream, row limits, and
checkpoint protocol remain authoritative. Credential rows add one protected
transactional unit:

1. Validate the source record and derive the source identity/envelope digest.
2. Resolve `license_id` and its retained license incarnation in the target.
3. Reserve or resume the transform artifact. An expired unprepared lease may
   be recomputed; a prepared artifact always reuses its stored bcrypt result.
4. Prepare the transformed result without writing the target row. The raw
   input is discarded after the prepared artifact batch succeeds.
5. Compose one D1 `batch()` containing the stale-checkpoint guard, a single
   source-shaped row INSERT assembled from the five ordinary bindings and the
   prepared credential artifact, the artifact `applied` transition, the
   coverage-ledger insert, the checkpoint update, and guard cleanup. The
   password INSERT trigger owns the password/access generation increment;
   read its resulting generations instead of incrementing them again.
6. Read back the artifact, destination row, coverage entry, and checkpoint.
   Mark the artifact `reconciled` only after all predicates agree.

The credential column is NOT NULL. Do not insert only the five ordinary
columns and fill the credential in a later UPDATE: the first statement would
fail its constraint, and two mutations would also invalidate generations
twice. The ordinary projection is an input to the specialized row writer,
not an independently insertable row. The final INSERT must obtain its
credential from the prepared artifact under the same binding/fence checks;
it must never fall back to the immutable source credential.

The transform core therefore needs a statement-builder or transaction hook;
calling its existing `applyArtifact()` as a nested `db.batch()` from
`commitChunk()` would split the credential write from the source-row insert
and checkpoint. Nested batches cannot establish the required cross-operation
atomicity. Credential-bearing rows should be isolated to one bounded chunk
while the lease covers bcrypt plus the final batch. If the lease expires,
the batch fails closed and the checkpoint does not advance.

The coverage entry and checkpoint advance in the same batch as the target
write. An ACK-unknown result is resolved by reading all four durable states;
the importer never retries bcrypt or uses `INSERT OR IGNORE` to hide a
conflict. A prepared artifact with an unchanged source/destination binding is
the replay point. A source envelope, descriptor, license incarnation, target
incarnation, or schema fingerprint change rejects the resume.

## Coverage and lifecycle dispositions

The existing per-table checkpoint proves the source stream prefix, but it does
not classify a credential column. Add an importer-owned coverage table with a
shape equivalent to:

```text
run_id
table_name
source_primary_key_json
source_row_identity_digest
source_envelope_digest
descriptor_digest
destination_relation
destination_primary_key_json
destination_license_id
license_incarnation
artifact_id
coverage_state       transformed | disabled | deferred_disabled |
                     deferred_inactive | rejected
destination_digest
reason_code
```

The table has a unique key on `(run_id, table_name,
source_row_identity_digest)` and a unique destination binding. It contains no
raw input, hash string, user ID beyond the already required row UUID mapping,
or caller token. Every source `fanmark_password_configs` row must have exactly
one coverage entry before the table can be complete.

`is_enabled = true` uses the pinned bcrypt transform and ends in
`transformed` only after protected destination readback. `is_enabled = false`
is not a completed `disabled` disposition until the source writer semantics
have been verified. If a later source re-enable is expected to restore the
same credential, the disabled row must retain a protected transformed value
while its enabled flag remains false. If the source semantics permit a
non-recoverable disabled row, a reviewed non-usable destination representation
may be used instead. A fixed dummy value is never the default completion
policy, and `is_enabled = 0` remains authoritative even when such a reviewed
representation is required. Until that writer-semantics gate passes, record
`deferred_disabled`, retain the immutable private source artifact, and keep
the run incomplete; never discard the source credential or place it in D1 as
ordinary text.

Rows whose `license_id` points to a non-active, returned, expired, or otherwise
ineligible license remain in the immutable source snapshot and must not
disappear from coverage. They must not be inserted as ordinary six-column
rows containing an untransformed credential. The migration policy must choose
one of two explicit outcomes before `fullMigrationReconciled` can become true:

- **Preserve for later reactivation:** transform the credential into the
  protected destination column while retaining the source enabled flag, under
  an importer-only lifecycle mode that verifies the exact license UUID and
  incarnation but does not grant public access. Public access continues to
  require the active/lifecycle predicates owned by the lifecycle slice.
- **Defer safely:** write neither a partial target row nor a source credential
  value, record `deferred_inactive`, retain the complete immutable private
  source row, and keep the run incomplete until a reviewed reactivation
  transform or non-usable destination representation is applied. The NOT NULL
  constraint remains intact. The same row-preservation rule applies to
  `deferred_disabled`.

The current synthetic core requires an active target, so it does not yet prove
the first policy. Until a lifecycle-compatible transform mode is implemented
and tested, the importer must use the second disposition and leave
`fullMigrationReconciled=false`; it must not silently mark a non-active row
complete. In either policy, the ordinary source row, UUIDs, status, dates, and
relationships remain covered by the 40-table import.

Invalid input, missing license mapping, duplicate destination mapping, or
descriptor mismatch is `rejected` and stops the run. It is not converted into
`disabled` or counted as successful coverage.

## Typed target readback

`reconcileTable()` currently selects every target column and compares every
converted binding. Credential integration must split that path:

- select and compare all non-credential columns exactly as today, including
  SQLite `typeof()`, UUID text, NULL state, timestamps, arrays, JSON, and
  primary-key order;
- select only the credential destination column's storage type and explicit
  metadata in the generic scan, never its value as a source binding;
- join the coverage ledger by source identity and destination UUID;
- invoke a credential readback that checks target hash scheme, enabled state,
  target license/incarnation, artifact state, password generation, and the
  destination transform digest; and
- reject missing, duplicate, extra, stale, or conflicting coverage rows.

The credential readback may read the protected hash inside the restricted
process to recompute the destination digest and perform a positive/negative
verification, but it must never place that value in a report, exception,
ordinary log, or generic row mismatch. The target row's `typeof` must still
be checked as `text` (or the exact reviewed target type). A target containing
an untransformed source credential, a source sentinel, or a generic text
binding is a hard failure. The final table count/PK scan includes inactive and
disabled rows, so omission cannot be hidden by filtering to currently public
licenses.

The final run status remains `public_rows_reconciled` only when all ordinary
rows and all credential coverage states are accounted for. It remains
`fullMigrationReconciled=false` while external Auth identities, lifecycle
writers, descriptor gates, source compatibility, or inactive-license policy
remain unresolved.

## 40-table schema and lifecycle coordination

The schema converter's current 40-table DDL, translated constraints/indexes,
and unresolved gates remain the source of truth. The credential integration
must not drop `fanmark_password_configs`, replace its row with a synthetic
`fanmark_access_configs` row, or weaken its UUID/FK relationship to
`fanmark_licenses`. Importer-owned artifact and coverage tables use reserved
names and exact DDL checked by `assertTargetSchema`; they are included in the
schema identity and are not mixed into the application table count.

The lifecycle/schema slice owns license status, returned state, expiry/grace
timestamps, and the generation rules for license/config changes. Credential
import consumes those values and never resets or invents them. A license
incarnation must be backed by a monotonic target registry/tombstone, not just
the license UUID: deleting and recreating the same UUID advances the registry
incarnation and invalidates an in-flight artifact. Snapshot import cannot
delete that tombstone or restore an older incarnation by replaying an older
row.

Keep two authorities distinct. `fanmark_licenses.lifecycle_generation` covers
status, return, expiry, grace, and other license-state mutations. The
`fanmark_access_versions.access_generation` covers password configuration,
profile/selector invalidation, and the protected projection selected by public
access. Neither is the importer checkpoint generation. Each authority
advances in its own guarded D1 mutation, while a mutation that affects both
writes both values and revokes affected proofs in one batch. The importer
records the authoritative baseline and refuses to overwrite a newer state or
access generation; it never uses a snapshot replay to roll back profile or
selector invalidation. Any lifecycle writer that can change a license,
password configuration, profile, selector, or protected projection must be
assigned to one of these authorities before cutover.

If the generated 40-table schema, incarnation registry, lifecycle-generation
policy, or access-generation policy changes, the credential descriptor and
importer run must be revalidated together; there is no resume across that
boundary.

## Required implementation tests

The next implementation should extend the existing D1 importer and transform
proof with synthetic rows only:

- a complete `fanmark_password_configs` row with all six columns preserves
  `id`, `license_id`, timestamps, and `is_enabled`, while only the credential
  column is transformed;
- a raw `access_password` value cannot appear in a generic INSERT, target
  row, error, report, or checkpoint;
- enabled, disabled, active, and each non-active license disposition are
  counted in coverage; no status filter silently drops a source row;
- prepared/applied/reconciled restart and ACK-unknown paths reuse one
  artifact and one destination digest without a second bcrypt result;
- a mixed source-row batch rolls back the source row, transformed target,
  artifact, coverage entry, generation, and checkpoint together on failure;
- changed descriptor/schema/manifest fingerprints, UUID mapping, license
  incarnation, target value, or target storage type reject resume/readback;
- missing, duplicate, extra, and deferred coverage are detected by an
  independent target scan; and
- the synthetic nonzero 40-table rehearsal still passes for every ordinary
  table while credential rows remain subject to this separate proof.

Until these tests and a private source compatibility rehearsal pass, this
document does not authorize remote D1 writes, source export of real credential
values, frontend cutover, or a claim of complete credential migration.

## Implemented descriptor validation

`scripts/migration/credential-descriptor.mjs` compiles explicit schema metadata
and a versioned descriptor into an immutable six-column mapping plan. It checks
the primary key, validated license uniqueness and cascading license foreign
key, column types, and the pinned bcrypt codec/cost. The canonical descriptor
digest binds those settings; accessors, symbols, hidden properties and unknown
fields are rejected so validation and canonical serialization agree.

The module accepts no source rows or database binding. It does not transform or
import credentials, and the generic importer's `credential_transform_required`
guard remains in force. `npm run test:migration-data` includes seven descriptor
test groups; the parent review ran all 70 migration-data tests on Node 22.6.0
with no failures or skips.


## Implemented import projection

`scripts/migration/credential-import-projection.mjs` exposes
`compileCredentialImportProjection({ catalog, descriptor, destinationCatalog? })`.
The compiled function accepts a single canonical snapshot record string without
its NDJSON newline. It validates all six source values through the existing row
converter, checks the existing row hash/primary-key/ordinal record contract,
and returns only the five ordinary columns and bindings, plus source identity
metadata and an opaque transform-input handle. It emits no INSERT statement.
The compiled catalog and descriptor cannot be changed by later caller edits.

`consumeCredentialTransformInput(handle)` consumes that handle once and returns
the exact canonical source envelope bytes and immutable descriptor metadata to
the trusted transform consumer. Serializing or inspecting the unconsumed handle
does not expose source values; forged, copied and consumed handles are rejected.
The consumed payload is private and must never be logged. This is accidental
serialization protection, not a sandbox or guaranteed JavaScript memory erasure.
Parser and converter causes are not attached to outward-facing errors.

This validates one row's internal consistency, not the snapshot's authenticity,
manifest binding, stream order, target identity or license eligibility. The
caller must still verify those and integrate the prepared artifact, coverage,
checkpoint and trigger-owned generations into the single transaction described
above. Disabled input remains present in the private handle and is not marked
complete by this projection. Snapshot export and the generic importer's
`credential_transform_required` guard are unchanged.

The Node 22.6 migration-data suite passed all 74 tests (four new projection
cases), with no skips. A separate check compiled the actual 40-table metadata
catalog and projected one synthetic row successfully; no real source values,
remote DB, credential hashing or destination writes were used.

# Local D1 importer

This slice implements a local, synthetic D1 rehearsal for the verified
PostgreSQL snapshot format. It does not connect to Cloudflare, Wrangler, a
remote database, or production storage. The importer accepts an explicitly
injected D1-compatible binding and a snapshot manifest that has already passed
the private snapshot verifier.

## Contract

The entry point is `importD1Snapshot({ manifestPath, database,
destinationId, targetIncarnation, reportPath, mode: "local", ... })` in
`scripts/migration/d1-import.mjs`. `database` must expose the D1 `prepare()`
and `batch()` methods. A standalone command intentionally refuses to choose a
remote or Wrangler binding.

`destinationId` identifies the logical destination. A newly created isolated
target must receive a fresh cryptographic incarnation from
`createTargetIncarnation()`. The caller persists that token with the target
metadata and reuses it only for the same target database. The token is written
into the private report and importer ledger. If a previous report exists but
the target ledger is absent, the importer returns `target_incarnation_unbound`
and refuses to treat a recreated empty database as a resumable target.

The report is outside the snapshot directory and is created with mode `0600`
under an existing `0700` directory. It binds the run ID, manifest digest,
catalog fingerprint, generated schema digest, codec version, destination, and
target incarnation. A report or target with any changed identity is rejected.

## Import and reconciliation

The importer derives a parent-first order from supported, validated internal
foreign keys. Cycles, malformed definitions, unsupported internal actions, and
non-Auth external references are rejected. `auth.*` references are recorded as
unresolved identity gates and may be admitted only when `mode: "local"` and
`allowUnresolvedGates: true` are explicit. No placeholder Auth rows are
created. The resulting report remains `deployable: false` and
`fullMigrationReconciled: false`.

Before the first public row write it verifies the generated application schema
against `sqlite_master`, including tables, explicit indexes, views, and
triggers; exact table definitions preserve CHECK predicates and foreign-key
clauses. It also checks column order/types/nullability/primary-key positions and
that `PRAGMA foreign_keys` is enabled. The only ignored local provider object
is the exact Miniflare `_cf_METADATA` table; importer ledger objects are
checked against their own exact DDL. A trigger, view, extra index, changed
CHECK literal, or weakened ledger CHECK fails closed.

Each bounded data batch is a D1 `batch()` containing, in order, a CHECK-backed
stale-checkpoint guard, converted row inserts, a checkpoint update, and guard
cleanup. The guard requires the expected run/table generation and next ordinal;
a stale runner therefore aborts the whole batch. A checkpoint records the
manifest/target binding, generation, next ordinal, last primary key, prefix
digest, row/byte counts, and chunk digest. Committed prefixes are read back
against the source conversion before a retry skips them. An uncertain client
acknowledgement can therefore be retried without `INSERT OR IGNORE` or an
unconditional upsert. A late duplicate in the same batch leaves its earlier
row uncommitted.

After all checkpoints complete, reconciliation independently scans actual D1
rows by primary-key order. It compares every converted value, SQLite storage
type (`typeof`), primary-key tuple, source count/bytes/hash, and target count;
extra, missing, or changed rows fail. `PRAGMA foreign_key_check` is run before
the final status. A successful local run reports
`public_rows_reconciled`; this is a scoped row result, not a full migration or
production-readiness claim.

## Credential fail-closed boundary

The generic importer does not yet own the credential descriptor, protected
codec, or transform ledger. After the manifest has passed the private snapshot
verifier, it inspects the verified catalog. If the catalog contains
`fanmark_password_configs.access_password`, it raises
`credential_transform_required` before report-parent creation,
importer-ledger creation, checkpoints, or any target row mutation. By default
this rejection happens before target-schema inspection. A caller may pass
`expectedTargetProfile` with the generated lifecycle, generation, and
credential schema plans plus the descriptor; in that mode the importer first
performs a read-only exact profile/schema check bound to the verified snapshot
and then rejects the generic credential import. The profile preflight does not
enable credential transformation or row import.

`allowUnresolvedGates: true` and `mode: "local"` cannot bypass this boundary;
that option only admits explicitly reviewed external identity gates. The
snapshot exporter, verifier, and row converter continue to retain and verify
the complete source envelope, including the credential column, so this guard
does not authorize dropping source evidence. It only prevents the current
generic text codec from copying an untransformed credential into D1.

The existing 40-table synthetic rehearsal therefore intentionally stops when
the catalog includes this source table until the descriptor-integrated
transform path is implemented and independently reconciled. A five-table
source-shaped Miniflare test now verifies the composed lifecycle, generation,
and credential DDL, checks the profile through the importer preflight, and
confirms that the rejection still leaves report and ledger state untouched.
The next slice must bind the descriptor and codec before generating generic
bindings, then write the transformed value and source-row coverage in one
reviewed D1 transaction.

The implementation bounds defaults at 50 rows and 512 KiB of source envelope
bytes per batch. Source envelope lines have a separate 16 MiB local input cap;
each converted target row is capped at 1,900,000 encoded value bytes, each
generated INSERT is capped at 100,000 UTF-8 SQL bytes, and each INSERT is
limited to 100 bindings. The aggregate batch ceiling is 1,900,000 source
bytes and 1,000 bindings, with a hard ceiling of 1,000 rows. The local fixture
uses one row per batch to exercise checkpoint transitions. Cloudflare documents
a 2,000,000-byte maximum string/BLOB/row, 100 bound parameters per individual
query, 100,000-byte SQL statement length, and a 30-second batch duration limit;
the importer keeps its target row and SQL limits below those service limits.
See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and the
[D1 `batch()` contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Reproducible local validation

The repository’s installed Miniflare dependency provides the D1 binding. Use
the pinned project Node runtime:

```sh
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node --test scripts/migration/test-d1-import.mjs
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node workers/api/test/d1-import.integration.mjs
```

The first command runs the synthetic suite, including the parent/child import
and the failure/restart/concurrency/schema identity cases. The second command
is an explicit local Miniflare integration entry point and is outside the
default Vitest glob. Fixtures contain no application rows, credentials, or
remote calls; each temporary D1 and report directory is removed in `finally`.

## Remaining gates

This is a local importer and readback core. It does not create a production D1,
run a remote schema migration, bind Auth identities, copy encrypted/private
data, migrate Storage/cron settings, or switch application traffic. The
snapshot catalog currently records unsupported views/functions/triggers/RLS
scopes as gates; local public-row rehearsal can record those gates only with
the explicit local option. A later reviewed runner must provide a fresh target
incarnation, a complete target schema rehearsal, external Auth mapping, full
constraint/index semantics, encrypted data handling, independent production
readback, and a separate cutover/rollback decision.

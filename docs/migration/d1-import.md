# Local D1 importer

This slice implements a local, synthetic D1 rehearsal for the verified
PostgreSQL snapshot format. It does not connect to Cloudflare, Wrangler, a
remote database, or production storage. The importer accepts an explicitly
injected D1-compatible binding and a snapshot manifest that has already passed
the private snapshot verifier.

For encrypted backups, `importEncryptedD1Snapshot()` first authenticates and
opens the bundle under a fresh mode-0700 OS temporary directory, verifies the
normal snapshot contract, runs this same importer, and removes the plaintext
restore directory on success or failure. It accepts only an explicitly
injected local D1 binding; no remote transport is added.

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

Before row reconciliation, the importer seeds the reviewed
`fanmark_events.id` AUTOINCREMENT state from the manifest's PostgreSQL
`lastValue` and `isCalled`, then independently reads `sqlite_sequence` back as
exact decimal text. It preserves the greater of the imported maximum ID, the
source sequence watermark, and any existing target watermark, so retries never
move allocation backward. The report records those source and target values.
For `isCalled: false`, the next D1-generated event ID remains the sequence
start value. Final production capture still requires the PostgreSQL event
writer to be frozen because sequence advancement is not part of an MVCC
snapshot.

## Credential transform boundary

Credential-bearing snapshots use the specialized writer only when the caller
provides the exact `expectedTargetProfile` composed from the verified source
catalog, descriptor, lifecycle schema, generation schema, and credential
schema. The importer first checks that complete target profile read-only. A
call without the profile still fails closed with
`credential_transform_required`; `mode: "local"` and
`allowUnresolvedGates: true` do not bypass the guard.

The specialized path keeps the complete source envelope bound to the verified
manifest, projects the five ordinary columns separately, and passes the
credential to the dedicated preparation path rather than a generic INSERT.
For an enabled credential on an active, non-returned license, the prepared
bcrypt hash, target row, artifact transition, transformed-coverage row,
checkpoint advance, and stale-state guards commit in one D1 batch. Typed
readback checks the target row, artifact, coverage, license incarnation and
generations, and checkpoint before the artifact is marked `reconciled`. An
acknowledgement-unknown retry reuses the prepared artifact and converges on the
same row.

Disabled credentials and credentials tied to inactive/returned licenses still
fail with explicit deferred-row errors. Durable deferred-coverage records are
not implemented, so these cases cannot be skipped or declared reconciled. The
current source-shaped proof also remains local and synthetic: the fresh
40-table catalog rehearsal imported three synthetic rows, completed all 40
checkpoints, resumed after an injected acknowledgement-unknown result, read
back all tables, and rejected tampered credential coverage. Its final status
was `public_rows_reconciled`, with `deployable` and
`fullMigrationReconciled` false. The catalog still has 18 blocking schema
gates. No real Auth, business, Storage, or credential rows were read or
migrated.

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

The first command runs the synthetic suite, including parent/child and
sequence-state imports plus failure/restart/concurrency/schema identity cases.
It is also part of `npm run test:migration-data`, which CI runs. The second
command is an explicit local Miniflare integration entry point and is outside
the default Vitest glob. Fixtures contain no application rows, credentials,
or remote calls; each temporary D1 and report directory is removed in
`finally`.

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

# D1 importer and isolated recovery transport

The importer accepts an explicitly injected D1-compatible binding and a
verified PostgreSQL snapshot. Local synthetic rehearsal is the accepted
snapshot-import proof. The isolated remote transport has passed a bounded
real Cloudflare REST probe; complete remote snapshot/R2 recovery is not yet
accepted. The probe created and deleted one owned empty database. No real
source rows or existing staging database contents were read or changed.

For encrypted backups, `importEncryptedD1Snapshot()` first authenticates and
opens the bundle under a fresh mode-0700 OS temporary directory, verifies the
normal snapshot contract, runs this same importer, and removes the plaintext
restore directory on success or failure. Destination bindings are explicit;
the isolated-remote restrictions below apply equally to encrypted restore.

## Contract

The entry point is `importD1Snapshot({ manifestPath, database,
destinationId, targetIncarnation, reportPath, mode: "local", ... })` in
`scripts/migration/d1-import.mjs`. `database` must expose the D1 `prepare()`
and `batch()` methods. A standalone command intentionally refuses to choose a
remote or Wrangler binding.

### Isolated remote mode (remote primitive accepted, full restore pending)

`isolated-remote-d1.mjs` uses the [Cloudflare D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
with parameter binding and one REST batch per transaction. The caller supplies
an exact account/database UUID, creation timestamp, fresh incarnation and
`fanmark-recovery-...-{business,auth,master}` name from its creation receipt.
A metadata GET must match before SQL. Ordinary staging/production names,
foreign statements, unsupported values and oversized requests are refused.
Errors contain no provider SQL/data/token diagnostics. The transport never
retries writes automatically; the importer resolves unknown ACKs by its
existing checkpoint and typed readback.

Explicit `mode: "isolated-remote"` requires the recognized pinned transport,
matching incarnation, canonical Business schema, complete credential/lifecycle/
generation profile and Auth resolver. Remote bindings cannot claim local mode.
Exact DDL, source/hash/type reconciliation and transactional guards remain;
`deployable` and `fullMigrationReconciled` stay false.

`npm run --prefix workers/api test:isolated-remote-d1` passes nine local native
tests: values/NULL/int64, CHECK rollback, lost-ACK/no-retry, target/profile/
statement refusal and malformed results. The HTTP envelope is simulated over
real Miniflare D1, not a Cloudflare REST acceptance. Importer20 also passes.
The real REST probe passed at 2026-10-03T08:18:42Z on candidate1d3085f
(CI37108741104, both jobs successful). One newly created database preserved
unicode/NULL/int64 TEXT readback, rolled back the first INSERT when a later
CHECK failed (retained rows0), and committed exactly one row when the client
intentionally discarded the successful write response without retrying.
Deletion was preceded by an exact UUID/name/creation-time receipt check;
final API inventory matched the original three databases. This tests real
REST semantics, not a natural network outage or whole snapshot import.

[`probe-isolated-remote-d1.mjs`](../../scripts/migration/probe-isolated-remote-d1.mjs)
is the resource-owning conductor. Supply the exact tested commit and successful
CI run from this repository; it verifies both jobs and the combined-recovery
step, the dedicated Wrangler identity, and available D1 capacity before creating
one unique probe. Tokens stay in memory, errors omit provider diagnostics, and
a private journal records the receipt and identity-checked cleanup. It never
deletes an older database to make space. A failed/unknown creation or cleanup
must be resolved from that journal before starting a new run. Invocation:

```sh
node scripts/migration/probe-isolated-remote-d1.mjs <tested-40-character-head> <successful-CI-run>
```

The [complete resource-owning conductor](isolated-combined-recovery.md) is
now prepared with the shared synthetic fixture and explicit HTTP R2 transport.
Local HTTP R2/native6 and shared combined regression pass. Its exact candidate
CI and live execution are still required; no full remote snapshot result is
accepted yet. That execution must cover all25 Business/4 Auth and8 Master migrations, same-bundle
restore/replay into a second incarnation, R2/API delivery and independent
reconciliation/cleanup. Chunked schema initialization on a newly owned target
must finish before the importer verifies its full DDL and writes snapshot rows.

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
`allowUnresolvedGates: true` are explicit. The supported external edge is a
single UUID column referencing `auth.users(id)`. Before creating the D1 ledger
or writing business rows, the importer scans and verifies each referencing
snapshot table, then calls the read-only `resolveAuthUserIds(userIds)` option
with batches of at most 100 distinct non-null IDs. The resolver must return an
array or `Set` containing every ID found in the already-imported Auth D1; a
missing ID or missing resolver fails before any target write. Null optional
references need no lookup. No placeholder Auth rows are created. Because the
Auth and business databases are separate, this is a preflight read rather than
a cross-database transaction; the Auth target must remain stable through the
business import. The resulting report remains `deployable: false` and
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

For `bigint`, the row converter retains canonical signed 64-bit decimal text.
The INSERT casts its bound text with `CAST(? AS INTEGER)`; independent readback
selects `CAST(column AS TEXT)` and verifies `typeof(column) = 'integer'`. The
bounded target scan keeps the snapshot's canonical text-key order, including
bigint keys, so pagination and source reconciliation use the same ordering.
This proves exact synthetic import/readback on local Miniflare D1. It does not
prove application-facing reads safe from JavaScript `Number` precision loss.

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

Disabled credentials on active licenses are bcrypt-transformed with the
disabled flag preserved. Credentials attached to inactive/returned licenses
are recorded as `deferred_inactive`: the importer writes no target credential
row or destination hash. A metadata-only terminal artifact is first
conditionally inserted against the observed inactive license state; its
existence, matching coverage, and unchanged license incarnation/generations
are then checked in the atomic coverage/checkpoint batch. Readback verifies the
explicit reason and absence of a target row.
Reconciliation counts these source rows as covered and reports target and
deferred counts separately; `fullMigrationReconciled` remains false.

The source-shaped proof remains local and synthetic: the fresh 40-table
catalog rehearsal imported three synthetic rows, completed all 40 checkpoints,
resumed after an injected acknowledgement-unknown result, read back all
tables, and rejected tampered credential coverage. A separate inactive-license
full-import fixture verifies durable deferral and ACK-unknown resume. The
catalog still has 18 blocking schema gates. No real Auth, business, Storage,
or credential rows were read or migrated.

### Current catalog and staging structure rerun (2026-09-27)

The read-only `schema-readiness.sql` query was run again against the linked
Supabase project and stored outside the repository with mode `0600`. It read
catalog definitions only: 40 tables, 406 columns, 144 constraints, 139
indexes, one view, 58 functions, 36 triggers, and 77 RLS policies. The fresh
schema-conversion report still has 18 unresolved gate groups and
`deployable: false`.

`node scripts/migration/test-d1-import-current-schema.mjs
/private/path/schema-readiness.json` then exercised that exact catalog against
a disposable local Miniflare D1 with three synthetic rows. All 40 table
checkpoints completed; the injected unknown acknowledgement resumed, all rows
and foreign keys read back, and altered credential coverage was rejected. The
result was `public_rows_reconciled`; `deployable` and
`fullMigrationReconciled` remained false. The source query read no application
rows, and the rehearsal made no Cloudflare, production, user-data, or domain
changes.

The same catalog's generated target profile was then compared with the remote
`fanmark-business-staging` schema using only `sqlite_master` and per-table
`pragma_table_info` metadata. All 40 source tables and all 406 source columns
are present. All 406 SQLite target types match the converter's target profile,
and no source `NOT NULL` definition is weakened or strengthened. Three
additional columns are the reviewed lifecycle and coupon-extension staging
extensions. All 66 source-converter indexes are present; 32 additional indexes
belong to the staging application schema. Every remote query reported
`changed_db: false` and zero rows written. These are schema-only checks: they do
not close the 18 constraint, behavior, policy, or row-conversion gates and do
not establish full migration readiness.

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

### Current checked-in Business/Auth schema rehearsal (2026-10-03)

The importer now has an explicit local `canonicalBusinessSchema: true` profile.
It derives the expected complete SQLite object inventory in an independent,
disposable Miniflare D1 by applying the checked-in Business migration sequence.
It never derives expected DDL from the destination under inspection. Every
table/index/view/trigger must match that inventory; only the exact provider
metadata and separately verified importer-ledger objects are excluded. Missing
or extra triggers fail before the importer creates its ledger.

The profile remains distinct from the original generated-schema profile.
The current generator adds timestamp CHECKs absent from the historical 0000
bootstrap and target-only tables, while 0017 replaces the original generation
trigger timestamps. The canonical profile checks the actual reviewed runtime
DDL rather than claiming the freshly generated DDL was deployed. Source
column order/type/nullability/PK checks, row conversion, credential descriptor
and plan validation, typed readback and source-parity gates remain in place.
The default generated-schema guard is unchanged. This is a local rehearsal,
not permission to use the profile as a remote/production importer.

Migration file digests plus the independent final object inventory produce a
runtime fingerprint. The ledger/report `schemaDigest` binds both that fingerprint
and the source-generated schema digest; the report also records and checks the
runtime fingerprint. A different migration profile cannot resume the same run
by reusing its destination/incarnation/report.

`npm run test:business-runtime-import` in `workers/api` exercises all 25 Business
and four Auth migrations with a schema-only structural fixture and 13 synthetic
source rows across 40 source-table checkpoints. Real Auth D1 lookups verify
synthetic owner references. It verifies credential ACK-unknown resume, enabled
and disabled bcrypt transformation, inactive-license deferral, source timestamp
and exact int64 readback, missing/extra-trigger refusal, fingerprint tamper
refusal and credential-coverage corruption refusal. Importing one pending
notification event advances the durable wake marker exactly once; replaying
the completed import keeps it at requested 1 / acknowledged 0.

The same snapshot restores into a second fresh Business/Auth target with a
different incarnation. All 40 source-table stream hashes/counts reconcile,
both stores pass FK checks, and the restored wake marker is again 1/0.
Fresh credential hashes may differ because bcrypt salts are regenerated;
credential conversion and independent reconciliation still run on that target.
The structural fixture deliberately omits source function/trigger/policy/view
definitions and all real application rows; it is not a complete source audit.
The separate private full-catalog synthetic rehearsal also passed the current
profile. CI runs the structural rehearsal as a dedicated step.

This closes the Business/Auth portion of the final-schema local synthetic
import/restart/fresh-target recovery gap. Combined Master/R2 recovery, recovery
time acceptance, remote importer custody and the final application integration
remain open. `deployable` and `fullMigrationReconciled` remain false.

```sh
cd workers/api
npm run test:business-runtime-import
```

For a separately captured private schema-only source catalog:

```sh
node scripts/migration/test-d1-import-current-schema.mjs /private/path/catalog.json --canonical-business
```

### Combined Master and split-R2 recovery

`npm run test:combined-recovery` uses the same 40-table structural catalog and
a 15-row synthetic snapshot including an owner avatar reference and a license
profile with a cover reference. The private bundle binds the Business manifest,
emoji release, reference-master snapshot and Storage manifest by SHA-256.
The fresh target uses all 25 Business/four Auth migrations, eight Master
migrations with its retained historical Auth core, and independent avatar and
cover R2 bindings. It activates the saved emoji/reference releases, reads the
catalog through the actual repository, verifies all imported emoji/tier IDs,
and checks each saved image reference against the native R2 bytes and MIME.
R2 replay keeps one object in each bucket. Expected bundle hashes are checked
again from saved files before the second target restores them.

Including the real profile/config generation triggers reproduced a failure:
source-FK ordering alone imported credentials before sibling profiles, so a
later profile INSERT changed access_generation and broke credential readback.
Importer codec version 5 adds the known access-generation writers as
prerequisites of the credential table. It preserves source FK dependencies
and captures the final generation without relaxing readback. Version-4 runs
cannot resume through the new order; use a new isolated target/rehearsal.
The combined fixture confirms profile generation plus password generation
remain reconciled across ACK-unknown retry and fresh-target restoration.

The test reports the measured local fresh-target recovery duration, including
schema creation, D1 import, Master activation and R2 copy/readback. It is not a
production RTO measurement or an approved recovery-time target. Source images
are synthetic PNG fixtures; no production Storage objects or user rows are
read. The image references use a synthetic source URL and are checked at the
bucket/key level; browser delivery and production URL rewriting are separate
final-integration/data gates. Public Master scaling, remote recovery/custody,
provider connectivity and the final candidate application rehearsal remain open.

```sh
cd workers/api
npm run test:combined-recovery
```

This is a local importer and readback core. It does not create a production D1,
run a remote schema migration, bind Auth identities, copy encrypted/private
data, migrate Storage/cron settings, or switch application traffic. The
snapshot catalog currently records unsupported views/functions/triggers/RLS
scopes as gates; local public-row rehearsal can record those gates only with
the explicit local option. A later reviewed runner must provide a fresh target
incarnation, a complete target schema rehearsal, external Auth mapping, full
constraint/index semantics, encrypted data handling, independent production
readback, and a separate cutover/rollback decision.

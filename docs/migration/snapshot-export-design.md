# Consistent PostgreSQL source snapshot design

This document defines the next read-only export unit for issue [#35](https://github.com/kanouk/fanmark-id/issues/35).
It is a design for a complete public-table snapshot, not an export that has
been run. The existing row bridge exports one table projection at a time and
the Storage tool exports objects with a before/after inventory check. Neither
one proves a database-wide snapshot or consistency between PostgreSQL,
Supabase Auth, and Storage.

The implementation must keep the source connection in one PostgreSQL
`REPEATABLE READ, READ ONLY` transaction from catalog validation through the
last table read. It must use the installed libpq client (`psql`/`COPY TO
STDOUT` or an equivalent libpq stream) rather than adding a second database
connection for parallel table reads. A new transaction is required after a
process failure; PostgreSQL's transaction snapshot cannot be resumed after
the connection is gone.

## Inputs and source boundary

The command should require the standard libpq environment (or a private
`PGSERVICEFILE` selected through the environment) and these arguments:

```text
PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD=<process environment only>
--catalog /private/schema-readiness.json
--output-dir /private/fanmark-snapshot-<run-id>
--role postgres
```

The values are process-only and never placed in argv, logs, status JSON,
manifests, or error messages. A connection URL, if supported for libpq
compatibility, must also arrive through the environment and never through an
argv value. `--role postgres` is required for this source; the tool must reject
another role rather than guessing. The existing Supabase CLI uses the
authorized `postgres` role for the catalog read.

Before reading rows, the session must execute and verify the equivalent of:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL ROLE postgres;
SET LOCAL statement_timeout = '...';
SET LOCAL lock_timeout = '...';
SELECT current_user, session_user,
       current_setting('transaction_isolation'),
       current_setting('transaction_read_only');
```

The run fails before creating row files unless `current_user` is exactly
`postgres`, the transaction is read-only, and the isolation level is
`repeatable read`. The design reserves `txid_current_snapshot()` as an
optional private evidence field, but the current exporter does not request or
store that identifier; it binds consistency through the one live transaction
and must not claim snapshot-ID evidence. The tool must issue `ROLLBACK` on
every failure path and must not execute DDL, DML, `SET ROLE` to an
operator-selected arbitrary role, or remote Storage/R2 requests.

The preferred transport is one persistent `psql -X -q -A -t
-v ON_ERROR_STOP=1` process backed by libpq, with separate stdout and stderr
pipes. The generated transaction-boundary, partition/inheritance scope,
catalog, and row queries are the only SQL sent to that process. A direct libpq
wrapper may use `PQgetResult`; this is preferable when
available because result status is separate from row data. The initial
implementation may use normal `SELECT`/`FETCH` output of the envelope text:
PostgreSQL JSON text escapes newlines and tabs inside values, so the reader can
decode one complete line as one JSON frame without COPY escaping. Every
`DECLARE`/`FETCH`/`CLOSE` command is followed by a typed JSON acknowledgement
containing a cryptographically random run/table/batch nonce. The reader must
reject an unknown frame, unexpected raw stderr, nonce mismatch, or EOF before
the expected acknowledgement; EOF on data alone is not success. No bytes
received on stdout are interpreted as SQL or control commands.

## Catalog binding

The supplied catalog is the private output of `schema-readiness.sql`. The
exporter must also read the catalog relations inside the active transaction,
using the same public base-table scope (`pg_class.relkind IN ('r', 'p')`) and
ordered metadata fields. It computes a stable catalog fingerprint from the
canonical JSON with the observation timestamp removed. For the current
readiness query, the fingerprint covers `columns`, `constraints`, `indexes`,
and `enums`, plus source database `datcollate` and `datctype` when present.
The input does not contain trigger, RLS, view, or function definitions, so the
exporter must not claim those scopes are bound by the fingerprint. The
fingerprint in the input catalog must equal the
fingerprint read inside the snapshot. A mismatch, missing catalog scope,
duplicate table/column/constraint, or schema other than `public` aborts before
any row is accepted.

The manifest records:

```json
{
  "catalogFingerprint": "sha256",
  "schemaConversionVersion": 4,
  "rowEnvelopeVersion": 1,
  "schemaReportFingerprint": "sha256",
  "schemaDeployable": false,
  "unresolvedGateCount": 18
}
```

Snapshot format version 2 added credential-transform policy metadata:
`credentialDescriptorVersion`, `credentialDescriptorDigest`, and the complete
`credentialDescriptor`. The descriptor contains policy only, never a source
credential. All three fields are `null` only when the catalog does not contain
`fanmark_password_configs`; if that relation is present, export requires a
valid explicit descriptor and the offline verifier recomputes its canonical
digest. This binds policy to the private snapshot but does not implement or
authorize credential writes to D1.

Snapshot format version 3 retains that descriptor contract and adds trigger,
RLS policy, view, and function definitions to the required private source
catalog and its fingerprint. A change to any of those definitions now changes
the schema fingerprint. The D1 converter still blocks these untranslated
behavior/security scopes; recording them does not claim parity.

Snapshot format version 4 adds `sequenceStates` to the manifest. The exporter
currently supports only the reviewed `public.fanmark_events_id_seq`, owned by
`public.fanmark_events.id`, with the catalogued start/increment/min/max/cache
settings. It captures the exact decimal `lastValue` and `isCalled` flag through
the same read-only PostgreSQL connection. The offline verifier binds the state
to that catalog target and rejects missing, extra, malformed, or changed
sequence definitions. PostgreSQL sequence advancement is not MVCC-snapshotted;
the source must be frozen against event inserts while a final cutover snapshot
is captured. This metadata preparation and its synthetic rehearsal do not read
or authorize a live user-data export.

## Encrypted export and restore

Use `scripts/migration/snapshot-export-encrypted.mjs` for any source export.
The older `snapshot-export.mjs` command is disabled; its exported function is
retained for synthetic tests only. The encrypted command requires a canonical
32-byte base64 key in `FANMARK_SNAPSHOT_KEY_B64`, a mode-0600 catalog and
optional descriptor under a mode-0700 directory, and a bundle destination
outside the Git checkout under a mode-0700 directory. The encryption key is
not written to the bundle, argv, status, or logs; the `psql` child explicitly
does not inherit the key variable.

The command exports into a unique mode-0700 OS temporary directory, seals the
snapshot into one AES-256-GCM ciphertext object, and removes that plaintext
directory in `finally`. The Git-external bundle contains only a mode-0600
`bundle.header.json` and `snapshot.aesgcm`; the header reveals the algorithm, a
short key identifier, nonce/tag, and total ciphertext size rounded to 64 KiB.
File names, counts, exact sizes, the plaintext manifest, catalog, schema report,
status, and row files are inside the authenticated ciphertext. A normal
stop/failure cleans the scratch directory; forced process or machine failure
can leave private temporary plaintext behind and requires cleanup before a
real export is authorized.

`openSnapshotBundle()` first authenticates the complete ciphertext in a fresh
mode-0700 temporary area, then unpacks and verifies the normal snapshot before
publishing the restored directory. `importEncryptedD1Snapshot()` composes that
restore with the existing local-only D1 importer and removes the plaintext
restore tree after the import attempt. The migration-data suite tests key
mismatch, ciphertext tampering, private file modes, hidden bundle metadata,
restored snapshot verification, and a synthetic encrypted-snapshot D1 import.
This is backup/restore mechanism evidence only; no live source row was read or
moved.

The same canonical descriptor is passed into schema conversion and row
validation. The schema report labels only `fanmark_password_configs.access_password`
as `credential-to-bcrypt`; missing policy is a blocking codec, never ordinary
text. The importer still rejects credential-bearing snapshots before target
writes until the transformed INSERT and its checkpoint/coverage transaction
are integrated.

The exact gate values come from `schema-convert.mjs`; they are not suppressed
by a successful source export. A source snapshot may be complete while
`schemaDeployable` remains false, but an importer must refuse to call the
migration deployable until the report gates are resolved. Unsupported column
codecs still fail the export because no lossless row binding exists.

Every catalog table must have one validated primary-key definition. The
current catalog has 40 public tables and 40 primary keys: 39 single UUID keys
and one single bigint key, with no composite or unparsed PK definition. The
first implementation should support those known UUID and safe-bigint keys and
synthetic composites made only from those codecs. Other PK representations
must be an explicit gate rather than receiving generic text ordering. The
implementation must fail closed for a table without a primary key, a duplicate
PK ordinal, or a PK column absent from the table. If the source scope contains
any public partitioned relation, partition child, or inherited relation with a
public parent or child, the exporter must reject that scope until an explicit
partition/inheritance policy is reviewed. PK columns are used for deterministic
ordering and later duplicate/reference checks; they are not inferred from an
application ID convention.

## Row stream and deterministic ordering

For each catalog table, the exporter reuses the SQL projection generated by
`row-conversion.mjs`. It must add a catalog-derived order expression for every
PK column in PK definition order. The order expression is the exact canonical
envelope text for that component with `COLLATE "C"`, and the session encoding
must be verified as UTF-8. A composite key orders by the bytewise UTF-8 tuple
of those components. This gives the exporter and verifier one deterministic
order for integer text such as `9`/`10`, enum labels, Unicode text, and UUID
text; it deliberately does not pretend that local JavaScript collation is
PostgreSQL collation.

The source PK codec must be injective for source equality before it can be
used for this order/equality boundary. Order keys are only an ordering
mechanism: duplicate PK, unique, and foreign-key checks use codec-aware source
equality and PostgreSQL NULL semantics. They must not treat bytewise text
order as numeric or enum equality. Expression and partial indexes remain
schema gates.

The query must not use `OFFSET` pagination: a server-side cursor or `FETCH
FORWARD` over the ordered query keeps the same transaction snapshot and avoids
skipping rows when a table is large. The verifier compares adjacent order keys
with bytewise UTF-8 tuple comparison, never `localeCompare`.

The existing row envelope remains the value boundary:

```json
{
  "schemaVersion": 1,
  "table": "fanmark_tiers",
  "columns": ["..."],
  "values": {"...": "string or null"},
  "arrayMetadata": {"...": {"isNull": false, "ndims": 1, "lowerBound": 1}}
}
```

All source values are emitted as PostgreSQL text or SQL `null`; no JavaScript
`Date`, floating-point conversion, source default, or omitted field is allowed.
The compiled converter from `row-conversion.mjs` validates every envelope
before it is written to the snapshot. A conversion error records only a
sanitized code, table, and row ordinal in private status; it must not log a
primary-key value, row body, connection string, or response text.

Each stored row is a wrapper around that exact envelope:

```json
{
  "recordVersion": 1,
  "ordinal": 0,
  "primaryKey": ["exact source-text value", "..."],
  "rowHash": "sha256(canonical envelope)",
  "envelope": {"schemaVersion": 1, "table": "...", "columns": [], "values": {}, "arrayMetadata": {}}
}
```

`primaryKey` follows catalog order and uses the envelope's text values. A PK
cannot be SQL `null`; this is checked before writing. `rowHash` is SHA-256 of
a canonical, compact JSON encoding of the envelope. Canonicalization sorts
object keys recursively but never parses or reformats scalar source strings,
JSONB text, timestamps, decimal text, or array JSON text. The line written to
the table stream is canonical compact JSON followed by one newline.

The table stream hash is SHA-256 of the exact canonical record lines, including
their newline bytes, in PK order. Its manifest entry records the column order,
PK column order, row count, byte count, stream hash, and a digest over those
claims. Counts and hashes are private evidence; they are not printed in public
reports.

## Private artifact layout

The output directory must be new or empty, created as mode `0700`; files are
mode `0600`, and symlinks are rejected. A failed or interrupted directory is
never accepted as a snapshot. The proposed layout is:

```text
snapshot.status.json       # in_progress, failed, or complete
snapshot.manifest.prepared.json # private pre-commit verifier input
snapshot.manifest.json     # state=complete only after commit and verification
catalog.json               # catalog captured/bound to this transaction
schema-report.json         # matching conversion gates
tables/
  <table-name-hash>.rows.ndjson
```

Table filenames use a hash of `public\0<table>` so path construction cannot be
redirected by a catalog identifier. The private manifest maps the filename to
the validated table name. A table is first written to a same-directory
`.part` file, flushed, closed, and atomically renamed only after its stream
hash and row count are known. A single table is streamed at a time to keep
memory bounded; local hashing may operate on chunks but must not open another
source transaction.

The status file is written atomically throughout the run and contains no row
data:

```json
{
  "schemaVersion": 1,
  "status": "in_progress",
  "runId": "opaque-local-id",
  "catalogFingerprint": "sha256",
  "sourceRole": "postgres",
  "isolation": "repeatable read",
  "readOnly": true,
  "tableCount": 40,
  "completedTables": 3
}
```

The final manifest is written only after all table streams pass the internal
prepared-artifact checks and the source transaction commits. The complete
status is written last and repeats the manifest's run ID, catalog fingerprint,
and table count; the verifier reads the manifest table list and digests before
accepting the directory. A crash after `COMMIT` but before the complete
manifest or status leaves the run incomplete and therefore unusable; a new run
is required.

## Completion and failure protocol

The intended sequence is:

1. Refuse a nonempty or symlinked output directory and create private status.
2. Open one libpq session, begin the verified read-only repeatable-read
   transaction, and bind the live catalog fingerprint.
3. For every catalog table in deterministic name order, stream the PK-ordered
   projection, validate and hash each row, and atomically finish its table
   file. Compare the streamed row count with `COUNT(*)` executed in the same
   transaction; both values are private manifest evidence.
4. Confirm exactly one completed file exists for every catalog table and no
   extra file is listed. Run the internal prepared-artifact verifier while the
   transaction is still open. This verifier accepts only the private prepared
   state and is not the public complete-snapshot verifier.
5. Write a private prepared manifest, `COMMIT`, then atomically write the
   complete manifest and complete status. Close the source session. The
   standalone verifier is run only after this complete state exists and
   accepts no incomplete-state override; a failed verification invalidates the
   artifact and the exporter must demote/remove it before returning failure.
6. Return success only after the complete artifact is structurally written and
   the standalone complete-only verifier succeeds. Do not print counts, keys,
   hashes, row values, or credentials.

Any source, cursor, conversion, count, local-write, hash, timeout, or commit
failure causes a best-effort rollback. The exporter removes the manifest and
partial table files, writes `status: "failed"` with a bounded error code, and
returns nonzero. If status cannot be written, the process still fails and the
directory is considered untrusted. There is no resume claim: a later run must
use a fresh directory and a new transaction snapshot. Re-running is safe
because completed directories are immutable and never appended to.

The implementation may retain a failed status directory for diagnosis, but
the verifier must reject every status other than `complete`, every `.part`
file, and every manifest with a missing table. Partial row files must not be
published or used as an import input.

## Independent local verification

The verifier must make no network or database call. The exporter first uses an
internal `verifyPreparedArtifacts` routine that accepts only a private
prepared manifest and checks stream structure before commit. The public
`snapshot-verify` command accepts only a manifest with `state: "complete"` and a
matching `status: "complete"`; it has no flag or user-controlled mode that
weakens this requirement. Given the private catalog, schema report, manifest,
and table streams, it checks:

- private modes, non-symlink paths, exact path containment, manifest/status
  agreement, and absence of partial files;
- exact table set, column order, PK order, row envelope schema, and matching
  catalog/schema fingerprints;
- contiguous ordinals, strictly increasing PK tuples, no duplicate PK, exact
  per-row hash, table stream hash, byte count, and row count;
- every row through the compiled row converter, including enum, temporal,
  bigint, JSON, array, SQL-NULL, and money/decimal boundaries; and
- primary-key tuples using the bytewise source order. The current
  implementation records explicit `uniqueConstraints: "not_checked"` and
  `foreignKeys: "not_checked"` reconciliation gates; it does not claim that a
  complete artifact has passed a temporary SQLite unique/FK index until that
  later bounded checker is implemented.

The FK checker must distinguish an internal public reference from the 11
catalog references to Supabase Auth's `auth.users`. Those external references
require a separately frozen source identity artifact and a separately reviewed
destination adapter mapping, each with its own fingerprint. In their absence,
the verifier records an explicit external-identity gate and does not claim
full reference reconciliation. It must never create placeholder users merely
to make a check pass. Source CHECK expressions, triggers, RLS,
views, functions, GIN indexes, and sequence behavior remain the explicit
schema-conversion gates documented by `schema-convert.mjs`; row validation
cannot prove their operational parity.

Comparison between two complete snapshot directories is a future extension,
not an implemented verifier command. It must require matching catalog
fingerprints, compare table row counts and stream hashes, and then use PK-keyed
records to report added, removed, or changed rows. A difference would indicate
source change between runs, not prove that either snapshot is corrupt.

## Auth and Storage boundary

The PostgreSQL transaction covers the public database tables only. It does not
cover Supabase Auth's `auth.users`, Supabase Storage objects, Cloudflare R2, or
frontend caches. The destination authentication adapter is a separate
identity-migration boundary. The existing Storage export's before/after
inventory and private manifest may be recorded as a separate artifact
fingerprint, but it cannot be called transactionally consistent with this
database snapshot.

A full cutover rehearsal therefore requires an explicit application freeze or
other coordinated quiescence procedure, a separately verified Supabase Auth
identity export, and a separately verified Storage export. Until those are
bound to a reviewed operational freeze, the snapshot is a complete public-table
database artifact only and must not be described as a complete system backup.

The encrypted archive and synthetic restore mechanism now exist. A regression
test persists a synthetic encrypted bundle to disk, restores and verifies it
in a fresh Node process, checks the synthetic row marker, and removes the
plaintext restore tree. A separate opt-in canary round-tripped the ciphertext
through a dedicated APAC Standard staging R2 bucket, verified exact object
hashes after download, restored the snapshot, then deleted both objects and
read the bucket back as empty. That bucket is not bound to the app Worker and
has neither r2.dev public access nor custom domains. These checks do not prove
independent key custody, least-privilege destination credentials, retention or
deletion policy, or a production backup destination. No live export, real-user
backup, Auth identity artifact, Storage artifact, or production restore is
claimed.

## Implementation and acceptance scope

This implementation adds a read-only exporter and local verifier around the
existing row/schema modules, with no application integration or remote
mutation. Its offline tests use PGlite synthetic tables and local
filesystem fixtures to cover composite PK order, duplicate/missing rows,
nullable and array values, temporal/JSON precision, cursor failure, interrupted
table writes, catalog drift, manifest tampering, and explicit internal/external
relationship reconciliation gates. The current preparatory tests verify PK
ordering and preserve those unique/FK gates in the manifest; they do not claim
the later relationship checker. A private rehearsal may then run the tool
against the authorized source role, but no output containing rows, keys, or
credentials belongs in Git or a public issue. Routine local/read-only
implementation and its offline tests are already authorized in this session.
Production cutover remains deferred;
production import, D1 writes, Storage upload, Auth migration, cutover, and
deletion are outside this design and require their own evidence and review.

The opt-in transport regression at
`experiments/stripe-receipts/test/snapshot-postgres.mjs` starts a private,
ephemeral PostgreSQL 17 cluster and uses the checked-in libpq `psql` client;
it is enabled only when `FANMARK_PG17_RUNTIME_ROOT` points to the pinned local
runtime. Without that environment variable the test is skipped, so the
ordinary offline suite does not claim a PostgreSQL server is available. The
test uses synthetic rows only and does not export the Supabase source.

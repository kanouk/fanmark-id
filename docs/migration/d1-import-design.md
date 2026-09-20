# D1 import and reconciliation design

This is the next implementation contract for issue #35. It does not implement
an importer, authorize remote writes, or remove the schema converter's blocking
gates. A successful public-table import is one component of the migration;
Auth, Storage, business operations, freeze, restore, and cutover remain separate
requirements.

## Input and destination identity

Accept only an independently verified complete snapshot. Bind the run to its
manifest digest, catalog fingerprint, codec version, generated schema digest,
and an explicit destination identity. Reject a changed source or destination
when resuming; a local status file is not proof that destination rows exist.
Source artifacts containing real rows must follow the encrypted, outside-Git
backup requirement of issue #35. Private file modes alone are not encryption.
The first implementation and runtime proof use synthetic data only.

Use an empty, isolated local D1 database for the first rehearsal. A future
remote runner must explicitly select and verify the account/database and the
approved schema. Never infer the target from ambient Wrangler authentication.
Read back the actual table/column/index definitions before inserting data;
matching a saved schema file is insufficient. Do not attach the application or
allow application writers to this destination during import/reconciliation.

Preserve every imported UUID, timestamp, and source relationship. Do not make
placeholder Auth users, regenerate IDs, invoke application registration flows,
or let destination defaults replace source values.

## Dependency plan and constraints

Derive the public-table foreign-key graph from the verified catalog using the
same strict constraint parsing as the schema converter. The private catalog
already inspected has 40 tables, 30 internal FK edges, and four acyclic import
layers. This is metadata evidence only; it does not prove row integrity.
Recompute the graph for every input instead of hardcoding today's order.

Import parent tables before their children with foreign keys enabled. A future
cycle, unsupported relationship, or mismatched constraint is an explicit gate;
there is no automatic `foreign_keys=OFF` fallback. External references to
Supabase `auth.users` require the separately frozen identity artifact and the
reviewed destination Auth mapping. Preserve the existing unresolved external
identity gate until those references are actually checked.

Retain translated UNIQUE and CHECK constraints during loading. Separately
record source constraints/index expressions that were not translated; a
successful target INSERT cannot prove a source rule that the target lacks.

## Atomic chunks and interruption

Stream verified envelopes through the compiled row converter. Bound batches
by statement count, total binding count, serialized bytes, and individual row
size using limits verified against the chosen D1 runtime. Do not read an entire
table into memory or silently split one row. A row beyond supported limits is
a recorded gate, not a truncated row.

Store an import-run ledger and one checkpoint per table inside the destination.
Each data chunk and its checkpoint must commit in the same D1 atomic batch.
Guard the previous checkpoint/generation in SQL so concurrent runners cannot
advance the same table independently. The guard must abort the complete batch
on a stale checkpoint; an UPDATE affecting zero rows by itself does not roll
back preceding INSERTs. Run-ledger tables must be separate from the imported
source table set.

A checkpoint binds the exact source digest, table, next ordinal, last canonical
PK, and converted-row digest for the committed prefix. Source order is the
snapshot's bytewise canonical PK tuple order, including bigint text ordering;
do not reinterpret it as numeric or locale order.

After an uncertain commit, read the destination checkpoint and compare the
corresponding rows before retrying. A successful retry cannot be implemented
with `INSERT OR IGNORE` or unconditional UPSERT: either can hide conflicting
rows. If the batch did not commit, retry it against the same expected checkpoint.
If it committed, verify the committed chunk and continue. Conflicting content,
extra rows, or another source/run identity stops the import without overwriting
or deleting data. A fresh run requires a fresh isolated destination unless an
explicit repair procedure has been reviewed.

## Independent readback and completion

A complete import requires an independent target scan after all chunks finish.
Do not trust import-ledger counts or the values submitted to `bind()` as proof
of target contents. Enumerate every source table, reject extra application rows,
and compare PK sets, counts, SQLite storage types, and every converted value.
Compare target values with the converter's output, rather than hashing target
rows with the source-envelope hash: PostgreSQL money, boolean, array, and UUID
representations intentionally change. Preserve SQL NULL versus JSON/text null,
empty arrays, duplicate array items, UTC microseconds, exact cents and decimals.

Read target rows with explicit column lists and a bounded keyset scan whose
ordering matches the canonical snapshot keys. Prove ordering on the actual
D1 runtime, particularly the bigint-text and composite-key cases. Compute
incremental canonical digests and retain only bounded mismatch detail in the
private report. Public logs contain stable error codes, never row values,
credentials, user identifiers, private counts, or hashes.

Check internal foreign keys and translated uniqueness independently after the
scan. Add domain reconciliation for holdings, license expiry, Stripe customer /
subscription relationships, and the separately verified Storage size/hash map.
Do not label unexplained differences as tolerances. Any difference or missing
scope keeps `reconciled` false. Only a guarded final ledger transition after all
readbacks can record a completed local import; `deployable` remains false while
schema, Auth, operation, or remote rehearsal gates remain.

## Required synthetic evidence

The next bounded implementation must prove on local D1:

- multi-table parent/child import with constraints enabled and exact value
  readback, including nullable, money, JSON, array, and microsecond cases;
- atomic rollback when a later row in a chunk violates a constraint;
- restart before commit, after an acknowledged commit, and after a commit
  whose acknowledgement is lost, without duplicates or hidden conflicts;
- two concurrent runners cannot both advance the same checkpoint;
- changed manifest, schema, destination, corrupt checkpoint, missing/extra rows,
  and post-import value changes are rejected;
- independent count/PK/value/FK reconciliation and incomplete-state refusal;
- bounded memory and explicit refusal of unsupported row/batch limits.

These are local acceptance criteria. Production downtime, full backup restore,
remote limits, application writers, and the final cutover remain unproven.

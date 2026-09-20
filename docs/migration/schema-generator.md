# Full schema conversion generator

`schema-convert.mjs` is a private, catalog-only preparation tool. It converts
the JSON emitted by `scripts/migration/schema-readiness.sql` into deterministic
SQLite/D1 table and index SQL plus a machine-readable report of unresolved
parity gates. It does not read application rows, contact Supabase, apply SQL,
or declare a production migration ready.

## Run locally

Keep the catalog and generated files in a private directory. The CLI writes
the two outputs atomically with mode `0600`; it does not print catalog values.

```sh
node scripts/migration/schema-convert.mjs \
  --catalog /private/path/schema-readiness.json \
  --sql-out /private/path/schema-d1.generated.sql \
  --report-out /private/path/schema-d1.gates.json
```

The generated SQL is safe to inspect or load into an empty local SQLite
database. It is not a migration file for a live D1 database. The report's
`deployable` field remains `false` whenever any blocking gate exists; a
successful SQL parse does not change that status.

## Representation contract

The report includes `target.columnCodecs`, one entry for every source column,
so the row importer can use the same mapping rather than inferring from the
SQLite affinity. The codec names are stable within `schemaVersion: 1`.

| PostgreSQL source | D1 column | Report codec | Import boundary |
| --- | --- | --- | --- |
| `uuid` | `TEXT` | `uuid-text` | Validate UUID syntax and canonicalize to the reviewed lowercase form; never generate a replacement for an imported value. |
| `boolean` | `INTEGER` | `boolean-int01` | Bind only `0` or `1`; generated checks also require SQLite integer storage. |
| `smallint` / `integer` | `INTEGER` | `smallint-int16` / `integer-int32` | Validate source range and SQLite integer storage. |
| `bigint` | `INTEGER` | `bigint-int64-exact` | Read exact integer text and reject values outside the currently approved JavaScript safe range until a D1 `BigInt` binding is proven; never round through `Number`. |
| `timestamptz` | `TEXT` | `timestamptz-utc-microsecond-text` | Convert to fixed-width UTC text while retaining six fractional digits. |
| `date` | `TEXT` | `date-ymd-text` | Validate the calendar `YYYY-MM-DD` value without timezone conversion. |
| `jsonb` | `TEXT` | `json-text` | Validate JSON text while preserving SQL `NULL` versus JSON `null`; do not silently reserialize source bytes. |
| PostgreSQL arrays | `TEXT` | `postgres-array-json-text` | Encode validated one-dimensional arrays as JSON text, preserving order, duplicates, element `NULL`s, and empty versus SQL `NULL`. |
| enum | `TEXT` | `enum-text-check` | Preserve observed labels through a generated `CHECK`; reject unknown labels during import. |
| `numeric(10,2)` at `fanmark_availability_rules.price_usd` or `fanmark_tiers.monthly_price_usd` | `INTEGER` | `money-cents-int64` | Store exact integer cents in the existing column name and convert at the API boundary. |
| unconstrained `numeric` | `TEXT` | `decimal-canonical-text` | Preserve an exact canonical decimal string; binary floating point is not a valid import path. |

The money column names are deliberately explicit. A different numeric column is
not silently treated as cents. Array dimensions/lower bounds, JSON numeric
precision, and bigint range checks remain importer gates even when the target
SQLite type is syntactically accepted.

## What the current catalog run produces

The private 2026-09-20 catalog contains 40 tables, 406 columns, 144
constraints, 139 indexes, and 15 enum labels. The generator translated all 40
primary keys, 29 unique constraints, 30 internal public-table foreign keys,
and 30 checks. The 11 foreign keys to `auth.users` stay as explicit external
identity gates; no placeholder identity table is emitted. Of the indexes, 63
safe B-tree indexes are emitted. Four GIN indexes and three `seq_key(...)`
expression indexes stay gated.

The current report has 20 unresolved gate groups and `deployable: false`. They
include missing catalog scopes for triggers, RLS policies, views, and
functions; those scopes remain blocking even if a future input includes an
empty placeholder array because this converter does not verify or translate
them. The remaining gates cover UUID/timestamp/default and exact-value import rules; three
PostgreSQL regex checks; one numeric predicate (`lottery_probability > 0`) that
cannot be applied to D1 decimal text without a reviewed rewrite; external
identity foreign keys; and the unsupported index classes above. These are
intentional blockers, not ignored source objects.

Defaults that call `gen_random_uuid()`, `now()`, or `nextval(...)` are omitted
from generated column definitions and named in the report. The operation layer
must supply collision-safe IDs and UTC microsecond timestamps. Safe scalar,
JSON, and empty-array literals are emitted only when their representation is
unambiguous.

## Validation boundary

The focused synthetic regression tests cover deterministic output, exact cents
and decimal codecs, internal versus external foreign keys, partial B-tree
predicates, regex/function/index gates, casts inside string literals, parenthesized enum comparisons, unimplemented catalog scopes, trailing
constraint syntax, SQLite integer storage checks, and malformed catalog names:

```sh
node --test scripts/migration/test-schema-convert.mjs
```

For a private full-catalog rehearsal, generate the outputs and load the SQL
into a fresh local SQLite file, then inspect the report before any import:

```sh
node scripts/migration/schema-convert.mjs \
  --catalog /private/path/schema-readiness.json \
  --sql-out /private/path/schema-d1.generated.sql \
  --report-out /private/path/schema-d1.gates.json
sqlite3 /private/path/schema-d1.sqlite < /private/path/schema-d1.generated.sql
```

The same generated file was also executed against a fresh local Wrangler D1
database with `wrangler d1 execute --local --file`. Wrangler reported every
statement successful; a follow-up query saw the 40 generated source tables and
131 indexes (the local runtime also adds its `_cf_METADATA` table). The SQL has
no explicit `BEGIN`/`COMMIT` because the D1 SQL API rejects those statements;
this does not make the unreviewed output an atomic production migration. D1's
local SQL API rejects direct `PRAGMA integrity_check` with `SQLITE_AUTH`; the
ordinary SQLite rehearsal above returned `ok` for that check.

These rehearsals validate SQL syntax and table/index construction only. They do not
validate D1 limits, Worker bindings, source rows, triggers/RLS behavior,
operation invariants, Supabase consistency, or remote-account authentication.
Those require a later empty-D1 rehearsal and an independently frozen source
snapshot.

The root `npm run test:migration-data` includes these schema tests alongside
Storage and value-codec checks. Local runs require the `sqlite3` CLI; CI installs
it explicitly. Enum membership checks are generated from the catalog labels,
but source predicates over enum columns remain gated because PostgreSQL
declaration order is not SQLite text ordering.

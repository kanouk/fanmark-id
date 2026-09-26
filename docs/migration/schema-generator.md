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
  --report-out /private/path/schema-d1.gates.json \
  --credential-descriptor /private/path/credential-descriptor.json
```

The raw generated SQL is safe to inspect or load into an empty local SQLite
database. It remains structural preparation, and its `deployable` field stays
`false` whenever any blocking gate exists; a successful SQL parse does not
change that status. A separate, explicitly staging-only copy of the v4 output
is tracked as `workers/api/migrations-business/0000_business_schema_v4_staging.sql`.
It was applied only to the previously empty business staging D1. That baseline
does not close parity gates or authorize production/data migration. A bounded
set of selectors is active on the workers.dev staging app only after synthetic
validation; see `HANDOFF.md` for the current selector inventory.

The report also includes `stageReadiness.rowConversion` and
`stageReadiness.schemaAndOperations`. These divide row-codec/credential gates
from the remaining DDL and behavior gates so app/infrastructure work can
proceed before user-data import. They are sequencing diagnostics only:
`deployable` remains the strict all-gates-closed result. Timestamp precision,
exact decimals/money, arrays, and credentials can also require runtime support
for the affected feature even when their row-conversion gates are assigned to
the later import stage.

## Representation contract

The report includes `target.columnCodecs`, one entry for every source column,
so the row importer can use the same mapping rather than inferring from the
SQLite affinity. Treat the current report's codec values as the import contract.

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
| `fanmark_password_configs.access_password` | `TEXT` | `credential-to-bcrypt` with descriptor; `credential-descriptor-required` without it | Validate the source snapshot as text, then admit only the dedicated transformed-row importer. A generic text binding is forbidden. |

The money column names are deliberately explicit. A different numeric column is
not silently treated as cents. Array dimensions/lower bounds, JSON numeric
precision, and bigint range checks remain importer gates even when the target
SQLite type is syntactically accepted.

The converter recognizes `seq_key(uuid[])` as an index over the target column's
canonical JSON text representation. It rejects the translation for any other
source type. This keeps order-sensitive sequence lookups indexable without
recreating PostgreSQL's MD5 helper in SQLite; the theoretical MD5-collision
boundary differs and is documented in `schema-conversion.md`.

## What the latest catalog run produces

The private catalog was refreshed on 2026-09-26 from a read-only Supabase
catalog query and contains 40 tables, 406 columns, 144
constraints, 139 indexes, and 15 enum labels. The source schema also contains
one view, 58 functions, 36 triggers, and 77 RLS policies; those behavior and
security objects are not yet translated into the D1/Worker implementation.
The generator translated all 40
primary keys, 29 unique constraints, 30 internal public-table foreign keys,
and 31 checks. The 11 foreign keys to `auth.users` stay as explicit external
identity gates; no placeholder identity table is emitted. Of the indexes, 66
are emitted, including the reviewed `seq_key(uuid[])` replacements. Four GIN
indexes stay gated.

The refreshed schema conversion version 4 report generated all 40 tables and
66 indexes, with 18 unresolved gate groups and `deployable: false`. The staged
readiness summary classifies ten groups as row-conversion gates and eight as
schema/operation gates. Snapshot format
version 3 now requires and fingerprints the direct catalog definitions for the
one view, 58 functions, 36 triggers, and 77 RLS policies, as well as the source
locale (`datcollate` and `datctype`). The converter reports these four scopes
as `unsupported_catalog_scope`; their definitions are captured but still need
Worker operation replacements. The schema dump artifact did not contain
trigger DDL, so the direct PostgreSQL catalog query remains the trigger
inventory source of truth. Remaining gates cover external Auth identities,
credential transformation and other exact-value import checks,
timestamp defaults, exact source sequence state, three PostgreSQL
regular-expression checks, and four GIN indexes. PostgreSQL character ranges
depend on collation; the catalog fingerprint
binds the source locale so changes cannot be missed
([PostgreSQL pattern-matching rules](https://www.postgresql.org/docs/current/functions-matching.html)).
These are intentional blockers, not ignored source objects.

The 2026-09-26 refresh used `npx supabase@2.118.0 db query --linked` through
the Supabase Management API; it needed no local Docker daemon and read catalog
metadata only. The `information_schema.columns` total is 411 because it
includes 406 base-table columns and five columns in the single view. The
converter's 406-column count is table-only, with the view definition captured
in its own catalog scope. A fresh v4 conversion still produces 40 tables, 66
indexes, 18 blocking gate groups, and `deployable: false`. Its table and column
names match the checked-in staging baseline exactly. The catalog, generated SQL,
and report remain private files with mode `0600`.

## Readiness by migration stage (2026-09-25 JST)

The fresh private report has 18 blocking gate groups. Ten groups concern row
conversion (UUID, bigint, date, timestamp precision, JSONB, arrays, money,
decimal, credential transform, and exact source sequence state); together they
cover 227 locations. The other eight groups concern schema/operation parity:
four untranslated catalog scopes, eleven references to external `auth.users`,
timestamp defaults that operations must supply, three untranslated checks, and
four GIN indexes. The exact `deployable` field remains false until every gate
is closed.

This grouping supports sequencing only. Timestamp precision, decimal handling,
and credential transformation also have runtime consequences for their
respective features; a row-conversion label does not authorize enabling those
features before their operation paths are verified. A fresh read-only D1
catalog query on 2026-09-25 found no business tables in the staging database
(only Cloudflare's internal `_cf_KV` table); this was the pre-bootstrap state.

## Schema converter version 4 refresh (2026-09-25 JST)

The converter now translates the three known ASCII regex CHECK expressions
only when both source `datcollate` and `datctype` are `C`; unknown patterns,
changed columns/operators, explicit non-default collations, and other source
locales retain the blocking gate. Reprocessing the latest private catalog found
`en_US.UTF-8`, so all three source regex checks correctly remain gated. The
report remains at 18 unresolved gate groups and `deployable: false`. Before
the staging-only bootstrap below, the generated SQL parsed in isolated SQLite
with 40 tables and 66 indexes, no foreign-key violations, and
`integrity_check=ok`.
The checked-in migration-data suite passed 90 tests and the D1 importer suite
passed 13 tests. The private catalog and v4 outputs remain outside the
repository with mode `0600`.

`gen_random_uuid()` on source UUID columns is translated to a D1 SQLite
expression that generates canonical RFC 4122 version-4 UUID text; the importer
still binds each original source UUID explicitly. The `fanmark_events.id`
sequence default becomes `INTEGER PRIMARY KEY AUTOINCREMENT`; the frozen data
snapshot must still capture and seed PostgreSQL's exact next sequence value.
Defaults that call `now()` remain omitted and named in the report, so the
operation layer must supply UTC microsecond timestamps. Safe scalar, JSON, and
empty-array literals are emitted only when their representation is
unambiguous.

The source `fanmark_lottery_entries.lottery_probability > 0` constraint now has
a narrow D1 translation for its non-null, unconstrained `numeric` column. The
target CHECK validates the canonical decimal-text shape and rejects zero or
negative values using text operations only; it does not cast through REAL or
round arbitrary precision. The generic `decimal_import_validation` gate stays
blocking until the complete importer and weighted-selection operation use this
encoding. The translation declines nullable columns and other numeric
expressions.

## Empty business-staging schema bootstrap (2026-09-25 JST)

The source-shaped DDL was copied into a dedicated business migration directory
and applied to `fanmark-business-staging` only. Before applying, a remote
read-only catalog query found only `_cf_KV`. Wrangler local migration rehearsal
executed all 108 statements; SQLite readback found 40 application tables and
66 indexes, no foreign-key violations, and `integrity_check=ok`. The remote
migration then completed all 108 statements. Readback found the same 40
application tables and 66 indexes (42 total tables including `_cf_KV` and
`d1_migrations`), no pending migration, and no foreign-key violations.

The migration contains structural DDL only and no row-copy statements. The
strict report remains at 18 unresolved gates and `deployable: false`; the
schema-only staging baseline does not implement functions, RLS, triggers,
views, external Auth references, timestamp defaults, the three locale-sensitive
checks, four GIN indexes, or the row-import/sequence requirements. Runtime
selectors remain disabled and the Worker was not redeployed. No Supabase rows,
Auth data, R2 objects, production state, or domain/DNS settings were changed.

The 2026-09-24 schema-only source DDL was obtained in a private temporary
directory and was not committed. It contains no top-level `COPY` or `INSERT`
statements. After the positive-decimal translation, regenerated D1 SQL parsed
in in-memory SQLite with 40 tables and 63 explicit indexes; foreign-key check
returned no rows and `PRAGMA integrity_check` returned `ok`. At that checkpoint,
this checked generated structure only and no business DDL had been applied to
remote staging; the later empty-schema bootstrap is recorded above. The latest
source refresh found three Stripe schema migrations
in the repository that have no corresponding remote migration IDs, so they
are not included in the current-source D1 profile.

## Validation boundary

The focused synthetic regression tests cover deterministic output, exact cents
and decimal codecs, positive arbitrary-precision decimal constraints, internal
versus external foreign keys, partial B-tree predicates, regex/function/index
gates, casts inside string literals, parenthesized enum comparisons,
unimplemented catalog scopes, trailing constraint syntax, SQLite integer
storage checks, and malformed catalog names:

```sh
node --test scripts/migration/test-schema-convert.mjs
```

For a private full-catalog rehearsal, generate the outputs and load the SQL
into a fresh local SQLite file, then inspect the report before any import:

```sh
node scripts/migration/schema-convert.mjs \
  --catalog /private/path/schema-readiness.json \
  --sql-out /private/path/schema-d1.generated.sql \
  --report-out /private/path/schema-d1.gates.json \
  --credential-descriptor /private/path/credential-descriptor.json
sqlite3 /private/path/schema-d1.sqlite < /private/path/schema-d1.generated.sql
```

The earlier 2026-09-20 generated file was also executed against a fresh local
Wrangler D1 database with `wrangler d1 execute --local --file`. Wrangler reported every
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

## Current converter re-run (2026-09-25 JST)

The latest private 2026-09-25 catalog and its credential descriptor were
reprocessed after the `seq_key(uuid[])` index translation. The report still
contains 18 blocking gate groups: 10 row-conversion groups across 227
locations and 8 schema/operation groups across 101 locations. The strict
`deployable` field remains `false`. The generated SQL contains 40 tables and
66 indexes; an in-memory SQLite execution returned zero foreign-key
violations and `integrity_check=ok`. This regenerated private report does not
contact Supabase, read application rows, modify Cloudflare, or change the
existing staged DDL. Its 18 groups remain the import/operation boundary for
the final stages.

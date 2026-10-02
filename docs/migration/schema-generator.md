# Full schema conversion generator

`schema-convert.mjs` v33 is a private, catalog-only preparation tool. It
converts the JSON emitted by `scripts/migration/schema-readiness.sql` into deterministic
SQLite/D1 table and index SQL plus a machine-readable report of unresolved
parity gates. It does not read application rows, contact Supabase, apply SQL,
or declare a production migration ready.

The private catalog also carries `regex_range_probe`. It tests the three exact
ASCII-format CHECK expressions against every valid Unicode scalar value using
the linked PostgreSQL locale and records only mismatch counts. Converter v8
retains the v7 locale proof and uses `en_US.UTF-8` only when this same catalog records all 1,112,063
scalar values and zero extra matches; a missing, changed, or nonzero probe
keeps those constraints gated. The query reads no application rows. PostgreSQL
documents that regex ranges depend on the active collating sequence, so this
probe is required instead of assuming ASCII equivalence:
[PostgreSQL pattern matching](https://www.postgresql.org/docs/current/functions-matching.html).

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
| `uuid` | `TEXT` | `uuid-text` | Validate exact UUID syntax and canonicalize to lowercase before binding; never generate a replacement for an imported value. Malformed values fail the row converter. |
| `boolean` | `INTEGER` | `boolean-int01` | Bind only `0` or `1`; generated checks also require SQLite integer storage. |
| `smallint` / `integer` | `INTEGER` | `smallint-int16` / `integer-int32` | Validate source range and SQLite integer storage. |
| `bigint` | `INTEGER` | `bigint-int64-exact` | Validate and retain canonical signed 64-bit decimal text; bind with `CAST(? AS INTEGER)` and verify exact text readback plus SQLite integer storage. Application-facing Number precision remains a separate gate. |
| `timestamptz` | `TEXT` | `timestamptz-utc-microsecond-text` | Convert to fixed-width UTC text while retaining six fractional digits. |
| `date` | `TEXT` | `date-ymd-text` | Validate the calendar `YYYY-MM-DD` value without timezone conversion. |
| `jsonb` | `TEXT` | `json-text` | Validate JSON text while preserving SQL `NULL` versus JSON `null`; do not silently reserialize source bytes. |
| PostgreSQL arrays | `TEXT` | `postgres-array-json-text` | Encode validated one-dimensional arrays as JSON text, preserving order, duplicates, element `NULL`s, and empty versus SQL `NULL`. |
| enum | `TEXT` | `enum-text-check` | Preserve observed labels through a generated `CHECK`; reject unknown labels during import. |
| `numeric(10,2)` at `fanmark_availability_rules.price_usd` or `fanmark_tiers.monthly_price_usd` | `INTEGER` | `money-cents-int64` | Store exact integer cents in the existing column name and convert at the API boundary. |
| `fanmark_lottery_entries.lottery_probability` with the reviewed positive CHECK | `TEXT` | `lottery-weight-positive-decimal-text` | Preserve exact positive decimal text up to the shared 256-character selector limit; never convert through binary floating point. |
| other unconstrained `numeric` | `TEXT` | `decimal-canonical-text` | Preserve an exact canonical decimal string; binary floating point is not a valid import path, and the generic conversion gate remains blocking. |
| `fanmark_password_configs.access_password` | `TEXT` | `credential-to-bcrypt` with descriptor; `credential-descriptor-required` without it | Validate the source snapshot as text, then admit only the dedicated transformed-row importer. A generic text binding is forbidden. |

The money column names are deliberately explicit. A different numeric column is
not silently treated as cents. The snapshot row envelope carries each array's
NULL state, dimension count, and lower bound; the importer rejects unsupported
shapes before binding. JSON numeric precision and bigint application-read
precision remain gates even when the target SQLite type is syntactically
accepted. The importer validates the full signed 64-bit range without Number
conversion; application reads still need safe bounds or an exact text
projection.

The two listed money columns use exact integer-cent import and checked reversible
API boundaries. Their previous `money_cents_import` readiness gate was removed
after row-conversion, D1 range-check, and API projection tests covered the full
`numeric(10,2)` range. The reviewed lottery-weight column has a separate
exact-text codec; all other unbounded decimal profiles remain gated.

With the explicit credential descriptor, the completed profile-bound
transformed-row importer likewise satisfies the `credential_transform_import_required`
capability. The generic importer remains blocked without the exact composed
target profile, and a missing descriptor remains a blocking gate.

UUID syntax validation is enforced by the shared row converter used by snapshot
verification and D1 import, including credential-bearing rows' non-credential
columns. It requires exactly 36 characters, rejects malformed strings before a
binding is produced, and lowercases valid IDs without replacing them. A codec
version change prevents an older partially imported run from resuming under
the updated validation contract.

The converter recognizes `seq_key(uuid[])` as an index over the target column's
canonical JSON text representation. It rejects the translation for any other
source type. This keeps order-sensitive sequence lookups indexable without
recreating PostgreSQL's MD5 helper in SQLite; the theoretical MD5-collision
boundary differs and is documented in `schema-conversion.md`.

## What the latest catalog run produces

The private catalog was refreshed on 2026-09-27 from a read-only Supabase
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

The 2026-09-27 refresh used `npx supabase@2.118.0 db query --linked` through
the Supabase Management API; it needed no local Docker daemon and read catalog
metadata only. The `information_schema.columns` total is 411 because it
includes 406 base-table columns and five columns in the single view. The
converter's 406-column count is table-only, with the view definition captured
in its own catalog scope. A fresh v4 conversion still produces 40 tables, 66
indexes, 18 blocking gate groups, and `deployable: false`. Its table and column
names match the checked-in staging baseline exactly. The current-catalog
synthetic importer test also completed all 40 table checkpoints and returned
`public_rows_reconciled`, while the strict deployment and full-migration flags
remained false. The catalog, generated SQL, and report remain private files
with mode `0600`.

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

The source `fanmark_lottery_entries.lottery_probability > 0` constraint has a
narrow D1 translation for its non-null, unconstrained `numeric` column. The
target CHECK validates the canonical decimal-text shape and rejects zero or
negative values using text operations only; it does not cast through REAL or
round arbitrary precision. Version 14 removes the decimal import gate only
when that exact validated source check is present: the row converter validates
positive canonical text and enforces the same 256-character bound used by the
weighted-selection operation. Other unconstrained numerics, nullable lottery
weights, and changed/missing constraints retain the generic blocking gate.

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

## Schema converter version 5: reviewed GIN query adaptations (2026-09-28 JST)

The linked catalog was refreshed again through the reviewed read-only query at
`2026-09-27T16:02:02Z`. It still contains 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
non-internal triggers, and 77 RLS policies. No application rows were read.

Converter v5 records four exact-definition GIN adaptations in
`target.indexAdaptations`. The emoji keyword array and both fanmark ID arrays
have no containment/overlap query in the checked-in application or Worker
paths; normalized fanmark IDs use exact equality and are covered by the D1
`fanmarks_normalized_emoji_ids_unique` constraint. Emoji admin search is
substring matching (`ILIKE '%…%'` in the source and `instr(lower(...))` in the
Worker), not full-text search. These four GIN indexes are therefore omitted as
query-contract adaptations, not silently translated to a different SQLite
index. Each decision is pinned to the exact live definition. An unknown GIN
index or a changed definition remains blocked by `unsupported_index_method`.

The fresh report now has 17 gate groups (10 row-conversion and 7
schema/operation) and remains `deployable: false`. This invocation omitted the
private credential descriptor, so the credential column remains blocked as
`credential_descriptor_required`; no generic text import is permitted. The
mode-0600 catalog, generated SQL, and report remain outside Git. Converter v5
does not alter the already-applied v4 staging schema, and no remote D1 schema
or data was changed. The focused converter suite passes 12/12 under Node
22.6.0.

## Schema converter version 6: exact recent-view replacement (2026-09-28 JST)

Converter v6 records `recent_active_fanmarks` as replaced by the D1 recent-list
Worker query only when the private catalog contains exactly one view with the
reviewed kind/name and definition SHA-256. The converter records that fingerprint,
replacement, and test/document evidence under `target.catalogScopeAdaptations`.
Changed definitions, additional views, and malformed view metadata remain
blocking. The 1..50 public API limit is now shared by Supabase and D1; the
landing-page caller still requests 20.

The fresh private report has 16 groups (10 row-conversion and 6
schema/operation) and remains `deployable: false`. Its generated base profile
still contains 40 tables and 406 columns. The function, trigger, RLS, and other
operation/import gates remain explicit. Converter tests pass 13/13; recent API
tests pass 15/15; D1 recent tests pass 6/6; Worker typecheck passes. The private
catalog, generated SQL, and report remain mode 0600 outside Git, and no remote
D1 schema or data was changed. The full migration-data suite passed 163/163;
the complete Worker `npm test` chain, app typecheck, Cloudflare staging build,
Worker deploy dry-run, workflow-isolation check, and `git diff --check` passed.

## Schema converter version 11: canonical-shaped `now()` defaults

For source `timestamp with time zone` columns, PostgreSQL `now()` defaults now
generate the D1 expression
`strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')`. The result has the same fixed-width
UTC text shape required by the generated timestamp `CHECK`, so a D1 insert that
omits this column does not immediately violate that constraint. D1 follows
SQLite SQL semantics, and SQLite permits a parenthesized expression as a
column default ([D1 SQL compatibility](https://developers.cloudflare.com/d1/sql-api/sql-statements/),
[SQLite `CREATE TABLE`](https://www.sqlite.org/lang_createtable.html)).

This fallback has millisecond clock resolution padded with three zeroes; it
does not preserve PostgreSQL microsecond clock resolution or transaction-start
time semantics. `timestamp_default_requires_operation` therefore remains a
blocking gate at each source default. Non-timestamptz `now()` defaults remain
omitted and gated because this timestamp representation is not valid for them.
The converter version is now 11, so snapshot manifests made with v10 must be
re-exported before verification/import. Synthetic SQLite and Miniflare D1 tests
assert both the stored 27-character value and the retained parity gates.

The 2026-09-28 read-only catalog refresh contains 79 `now()` defaults, all on
timestamptz columns; v11 emits the expression at all 79 locations. The report
was run without the private credential descriptor and therefore retains
`credential_descriptor_required`; it has 13 unresolved groups / 226 locations
and remains `deployable: false`. The generated full-catalog DDL loaded 40
tables in SQLite with `integrity_check=ok` and no foreign-key violations. The
full migration-data suite passes 170/170 under Node 22.6.0. This local schema
replay did not read application rows or apply the output to remote D1.

A subsequent v11 run with the value-free credential descriptor retained 13
groups / 226 locations, now reported as 8 row-conversion groups / 133
locations and 5 schema/operation groups / 93 locations. The explicit
descriptor-aware importer exercised the credential path using synthetic rows;
`deployable` remains false pending the listed parity and operation gates.

## Version 14 exact lottery-weight profile (2026-09-28 JST)

The v14 descriptor-aware catalog report at that checkpoint had 10 unresolved
gate groups / 222 locations and remained `deployable: false`: five
row-conversion groups / 129 locations and five schema/operation groups / 93.
The exact lottery-weight column no longer contributes a decimal gate. A linked read-only aggregate
checked that current source values fit the shared codec contract without
retaining row IDs or decimal values. The column-specific codec and its
fail-closed catalog-shape checks are covered by schema, row-conversion, snapshot
and exact weighted-selector tests. No source rows were migrated or remote D1
was changed.

## Version 15 exact event sequence import profile (2026-09-28 JST)

The converter no longer emits `sequence_state_import_required` for the one
source profile covered end to end: `fanmark_events.id` is a bigint primary key
with the exact `public.fanmark_events_id_seq` default. Snapshot format 4 requires
the source sequence state, validates its owner and definition, and the D1
importer applies and reads back the monotonic target watermark. `is_called=false`
is preserved as well. Any missing, extra, or unsupported source sequence still
fails snapshot validation or retains a conversion gate. The source sequence
must still be captured during the final writer freeze because PostgreSQL
sequence advancement is outside MVCC; that operational rehearsal remains open
under issues #37/#38.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:25 UTC
reports 9 unresolved groups / 221 locations (4 row-conversion / 128, 5
schema/operation / 93) and remains `deployable: false`. The query returned no
application rows. No live sequence values were read or imported for this change.


## Version 16 internal bigint event key (2026-09-28 JST)

The converter suppresses `bigint_import_range_validation` for
`fanmark_events.id` only when it is the exact supported sequence-backed primary
key. The current Worker code inserts these events but does not select or return
the generated key; imported key text and its sequence watermark are both
verified exactly. The two bigint discovery counters remain gated because their
values are projected to application-facing JavaScript numbers. Unsupported
sequence shapes and every other bigint stay gated.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:30 UTC
reports 9 unresolved groups / 220 locations (4 row-conversion / 127, 5
schema/operation / 93) and remains `deployable: false`. The query read no
application rows.

## Schema converter v21: require operation-owned timestamps (2026-09-29 JST)

The current converter no longer emits SQLite `strftime(..., 'now')` defaults
for PostgreSQL `now()` columns. That expression only provides millisecond
resolution and does not match PostgreSQL transaction-time semantics. D1 now
requires inserts to provide the canonical UTC microsecond timestamp explicitly;
the schema report retains all 79 operation gates until their complete runtime
coverage is verified.

## Schema converter v22: versioned reference-master timestamp replacement (2026-10-02 JST)

The four non-user reference masters (`fanmark_tiers`, `languages`,
`reserved_emoji_patterns`, and `fanmark_tier_extension_prices`) have a reviewed
replacement path in split D1. Their source-shaped copies are imported with
explicit canonical source timestamps and have no direct Worker or migration
SQL `INSERT` writer. Cloudflare runtime reads the active versioned Master D1
release; administrative edits write separate `*_release_rows` tables with
explicit timestamps. Converter v22 records eight exact `now()` defaults as
`versioned_reference_master_replacement` dispositions and continues to omit
those defaults from D1 DDL. Any other `now()` default remains a blocking
operation gate.

The repository source audit has a regression test over Worker source, D1 SQL
migrations, and the reference-release importer. A synthetic catalog case
verifies the exact eight locations, absence of a generated D1 default, and
that an unrelated `notification_preferences.created_at` default remains
gated. The change reduces the current-catalog timestamp operation count from
79 to 71; external Auth references and unsupported functions/RLS/triggers
remain blocking, so the schema stays non-deployable. No source rows, remote D1,
production route, or domain/DNS state was changed.

## 2026-10-02 generated master-writer audit follow-up

The audit now resolves static generated column arrays for the extension-coupon
and broadcast-email master seed builders, and the emoji release bootstrap uses
an explicit ten-column statement. It binds one UTC microsecond timestamp to
both `created_at` and `updated_at` for new catalog rows and checks those values
on readback. A fresh read-only catalog audit observed at `2026-10-02T04:34:34Z`
parsed 143 literal or statically generated INSERT column lists and reported no
unparsed target INSERTs. Twelve timestamp columns still lack a direct literal
writer; this is separate from proving their source/import path and transaction-
time semantics. Focused writer tests pass 6/6; the converter remains
non-deployable.

## Schema converter v23: source-shaped import-only user timestamps (2026-10-02 JST)

Converter v23 records exactly three additional `now()` defaults as
`snapshot_import_only_no_timestamp_writer`: `notification_preferences.created_at`,
`notification_preferences.updated_at`, and `user_roles.created_at`. The
generic source-shaped importer binds the original source values. A repository
audit confirms there is no Worker INSERT writer for preferences or roles and no
Worker UPDATE for notification preferences. Target defaults stay omitted, so a
future application writer must bind a canonical UTC microsecond timestamp.

A fresh synthetic import used the current 40-table catalog and read back the
exact timestamp values for one synthetic preference and one synthetic role.
The report now has five blocking gate groups / 82 locations (11 external Auth
references, 68 timestamp operations, and three unsupported functions/RLS/
trigger scopes). `notifications_history.archived_at` remains gated until its
archive operation and retention contract are resolved. `deployable` and full
data reconciliation remain false; no real rows or remote state were changed.

## Schema converter v24: notification archive timestamp writer

The D1 Worker archive operation now binds `notifications_history.archived_at`
explicitly and is covered by synthetic D1 integration tests and the static
timestamp-writer audit. Converter v24 omits the source `now()` default under a
narrow `scheduled_worker_explicit_timestamp` disposition. The operation uses a
single JS `Date` per invocation rendered as six-digit UTC text; exact
PostgreSQL transaction-time microsecond identity is not claimed. The schedule
requires `NOTIFICATION_ARCHIVE_BACKEND=d1`, absent from staging. Source
invocation and history retention remain unresolved; the converter is still
non-deployable.

## Schema converter v25: reviewed cross-database Auth references

Converter v25 recognizes only the 11 current business-schema foreign keys to
`auth.users(id)` when each constraint name, source table and column, UUID type,
and delete action exactly match the reviewed catalog. It records their
identity/deletion dispositions in `reviewedAuthForeignKeys` and omits these
cross-database constraints from generated D1 SQL. Any changed or unknown
constraint remains a blocking gate. The importer separately performs a
read-only Auth D1 identity lookup for every non-null reference before business
writes; account deletion remains owned by the existing Worker operation.

A schema-only catalog refreshed at `2026-10-02T12:03:07Z` again contained 40
tables, 406 columns, 58 functions, 36 triggers, and 77 RLS policies. With the
value-free credential descriptor, v25 reports all 11 Auth references as
reviewed and remains `deployable: false` with four blocking groups / 70
locations: 67 operation-owned timestamp defaults and the functions, RLS, and
trigger scopes. The timestamp-writer audit found 79 defaults and 99 explicit
column-list INSERTs, with 11 defaults lacking a direct literal writer and no
unparsed INSERTs. These counts cover different scopes; static column coverage
does not prove runtime timestamp semantics. No source rows were queried.

## Schema converter v26: reviewed D1 operation timestamps

Using the same explicit `worker_operation_explicit_timestamp` disposition,
v26 reviews exactly five current columns: `waitlist.created_at`,
`fanmark_discoveries.first_seen_at`, `fanmark_discoveries.last_seen_at`,
`fanmark_events.created_at`, and `fanmark_favorites.created_at`. The Worker writers bind an explicit canonical
six-digit UTC operation timestamp; integration tests read back the waitlist,
search, favorite-add, and favorite-remove paths. This accepts D1 operation time
as the target contract and does not claim PostgreSQL transaction-time or
sub-millisecond clock equivalence.

The latest schema-only catalog was observed at `2026-10-02T12:10:27Z` and
again contained 40 tables, 406 columns, 144 constraints, 139 indexes, 36
triggers, 77 RLS policies, 58 functions, and one view. Converter v26 reviews
all 11 exact Auth references and the five timestamp columns, while remaining
`deployable: false` with 62 timestamp-operation locations and the three
functions/RLS/trigger catalog scopes. Synthetic D1 readback covers both
new-discovery insert paths. No source rows were queried.

## Schema converter v27: reviewed access-analytics timestamps

Converter v27 adds exactly three Worker-owned columns to the
`worker_operation_explicit_timestamp` disposition:
`fanmark_access_logs.accessed_at`,
`fanmark_access_daily_stats.created_at`, and
`fanmark_access_daily_stats.updated_at`. The fixed-clock D1 integration test
checks an initial access, then a repeat visit 5 minutes and 1 millisecond
later. It reads back the new access-log time, confirms the daily aggregate's
`created_at` is unchanged, and confirms `updated_at` advances. This defines the
target as explicit D1 operation time; it does not claim PostgreSQL transaction-
time or sub-millisecond clock equivalence.

The schema-only catalog observed at `2026-10-02T12:25:35.315086Z` contains 40
tables, 406 columns, 144 constraints, 139 indexes, 36 triggers, 77 RLS
policies, 58 functions, and one view. With a value-free credential descriptor,
v27 reviews all 11 exact Auth references and eight Worker operation timestamps
(the five v26 columns plus these three), but remains `deployable: false` with
59 timestamp-operation locations and the three functions/RLS/trigger scopes
(62 blocking locations total). Converter tests pass 27/27, the migration-data
suite 223/223, and access-analytics D1 tests 11/11. No source rows were queried.

## Schema converter v28: reviewed fanmark-profile timestamps

Converter v28 adds `fanmark_profiles.created_at` and
`fanmark_profiles.updated_at` to the exact
`worker_operation_explicit_timestamp` disposition. The profile, settings, and
registration Worker operations bind canonical UTC operation timestamps
explicitly. Fixed-clock profile D1 readback verifies both values on creation,
then verifies a later update preserves `created_at` and advances only
`updated_at`; settings and registration integration tests cover their separate
creation paths. Imported source timestamps remain explicit.

Using the same schema-only catalog observed at `2026-10-02T12:25:35.315086Z`,
converter v28 reviews ten Worker operation timestamps and all 11 exact Auth
references. It remains `deployable: false` with 57 timestamp-operation
locations and the three functions/RLS/trigger catalog scopes (60 blocking
locations total). Converter tests pass 28/28, the migration-data suite 224/224,
profile D1 tests 5/5, settings D1 tests 18/18, and registration D1 tests 10/10.
No source rows were queried.

## Schema converter v29: reviewed fanmark settings timestamps

Converter v29 reviews `created_at` and `updated_at` for
`fanmark_basic_configs`, `fanmark_messageboard_configs`,
`fanmark_password_configs`, and `fanmark_redirect_configs` under the exact
`worker_operation_explicit_timestamp` disposition. Fixed-clock settings D1
readback covers initial writes and later upserts for all four tables. Separate
registration D1 cases verify initial basic, redirect, and messageboard rows;
the transfer D1 case verifies the new license's basic configuration. Source
imports continue to supply their original timestamps.

The same schema-only catalog observed at `2026-10-02T12:25:35.315086Z` yields
18 reviewed Worker operation timestamps and all 11 exact Auth-reference
dispositions. Converter v29 remains `deployable: false` with 49 timestamp-
operation locations and the three functions/RLS/trigger catalog scopes (52
blocking locations total). Converter tests pass 29/29, the migration-data
suite 225/225, settings D1 tests 18/18, registration D1 tests 11/11, and
transfer D1 tests 9/9. No source rows were queried.

## Schema converter v30: reviewed emoji-master timestamps

Converter v30 adds `emoji_master.created_at` and `emoji_master.updated_at` to
the exact `worker_operation_explicit_timestamp` disposition. The admin D1
repository binds canonical UTC timestamps for create, update, import insert,
and import upsert; fixed-clock D1 readback verifies the exact values and that
updates preserve `created_at`. The canonical catalog seed binds its import
timestamp explicitly, while snapshot imports retain the source values.

The read-only catalog observed at `2026-10-02T12:49:06.519034Z` still contains
40 tables, 406 columns, 144 constraints, 139 indexes, 36 triggers, 77 RLS
policies, 58 functions, and one view. Converter v30 reviews 20 Worker-owned
timestamps and all 11 exact Auth references. It remains `deployable: false`
with 47 timestamp-operation locations and the three functions/RLS/trigger
catalog scopes (50 blocking locations total). Converter tests pass 30/30,
the migration-data suite 226/226, and auth D1 tests 27/27. No source rows were
queried.

## Schema converter v31: reviewed invitation-code timestamps

Converter v31 adds `invitation_codes.created_at` and
`invitation_codes.updated_at` to the exact
`worker_operation_explicit_timestamp` disposition. The admin create and patch
operations bind canonical UTC timestamps. Fixed-clock D1 readback verifies
both creation values and confirms patch preserves `created_at` while advancing
`updated_at`; snapshot imports continue to bind source values.

The latest read-only catalog observed at `2026-10-02T12:57:00.005354Z` contains
40 tables, 406 columns, 144 constraints, 139 indexes, 36 triggers, 77 RLS
policies, 58 functions, and one view. Converter v31 reviews 22 Worker-owned
timestamps and all 11 exact Auth references. It remains `deployable: false`
with 45 timestamp-operation locations and the three functions/RLS/trigger
catalog scopes (48 blocking locations total). Converter tests pass 31/31,
the migration-data suite 227/227, and invitation admin D1 tests 5/5. No source
rows were queried.

## Schema converter v32: transfer and lottery operation timestamps

Converter v32 reviews the seven timestamps on transfer codes and requests,
the three timestamps on lottery entries, and `created_at` / `executed_at` on
lottery history. The D1 transfer and lottery tests verify insert values,
timestamp preservation, and later operation times. The license-expiry
integration test verifies both lottery-history timestamps from the same
captured finalization clock. Snapshot import still binds the exact source
timestamps.

The latest read-only catalog observed at `2026-10-02T13:03:01.839723Z` contains
40 tables, 406 columns, 144 constraints, 139 indexes, 36 triggers, 77 RLS
policies, 58 functions, and one view; no source table rows were read. Converter
v32 reviews 34 Worker-operation timestamps and all 11 exact Auth references.
It remains `deployable: false` with 33 timestamp-operation locations and the
three functions/RLS/trigger catalog scopes (36 blocking locations total).
Converter tests pass 32/32 and the migration-data suite 228/228. Transfer D1
tests pass 9/9, lottery D1 tests 12/12, and the license-expiry integration
suite 25/25.

## Schema converter v33: notification and email template timestamps

Converter v33 reviews `created_at` and `updated_at` for both email and
notification templates. Source imports and the bounded staging seeds bind the
original creation values; runtime edits preserve `created_at` and explicitly
advance `updated_at`. Fixed-clock D1 tests read back both behaviors.

The latest read-only catalog observed at `2026-10-02T13:17:06.595505Z` contains
40 tables, 406 columns, 144 constraints, 139 indexes, 36 triggers, 77 RLS
policies, 58 functions, and one view; no source table rows were read. Converter
v33 reviews 36 Worker-operation timestamps, five snapshot-import-only
timestamps, and all 11 exact Auth references. It remains `deployable: false`
with 29 timestamp-operation locations and the three functions/RLS/trigger
catalog scopes (32 blocking locations total). Converter tests pass 33/33 and
the migration-data suite 229/229. Notification-master D1 tests pass 6/6 and
email-template D1 tests pass 4/4.

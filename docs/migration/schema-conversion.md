# PostgreSQL to D1 schema conversion boundary

Parent issues: [#34](https://github.com/kanouk/fanmark-id/issues/34) and
[#35](https://github.com/kanouk/fanmark-id/issues/35).

## Live schema evidence

On 2026-09-21, `scripts/migration/schema-readiness.sql` ran successfully in a
read-only PostgreSQL transaction. It reads catalogs only, with no application
rows. The private output contains ordered column definitions, nullability,
default expressions, constraint definitions, indexes, and enum labels. It is
not checked in because expressions may include deployment-specific constants.

The result covers 40 public tables and 406 columns, 144 constraints (40 primary
keys, 41 foreign keys, 34 checks, 29 unique constraints), and 139 indexes (135
B-tree, 4 GIN). There are 15 enum labels across the three used enum types. No
identity or generated column, unvalidated constraint, or deferrable constraint
was observed. These are schema counts, not user-data counts. Catalog defaults
use `gen_random_uuid`, `now`, and `nextval`; checks include `char_length`.

The earlier object inventory did not include this column/index evidence.
This readback is the input to conversion, not a generated or applied D1 schema.
A final frozen export must re-read and fingerprint this metadata to detect
schema drift as well as data changes.

On 2026-09-25 JST, the schema-only DDL and read-only catalog query were refreshed
from the linked Supabase project. The catalog counts are unchanged: 40 tables,
406 columns, 144 constraints, 139 indexes, and 15 enum labels. Snapshot format
version 3 fingerprints these scopes plus definitions for 1 view, 58 functions,
36 non-internal triggers, and 77 RLS policies. Schema conversion version 3
generated 40 tables and 18 unresolved gate groups, so the output remains
`deployable: false`; all four behavior scopes are now named
`unsupported_catalog_scope` instead of missing. The DDL artifact did not
contain trigger definitions, so the `pg_trigger` catalog query is the source
of truth for the trigger inventory. No business DDL was applied to D1.

On 2026-09-26 JST, the detailed catalog was queried again through
`npx supabase@2.118.0 db query --linked`, which uses the Supabase Management API
and does not require a local Docker daemon. The read-only result again contains
40 base tables and 406 base-table columns, plus one view with five columns;
this reconciles the separate 411-column `information_schema` total. Constraints,
indexes, enum labels, triggers, policies, views, and functions match the prior
catalog counts. A fresh version-4 conversion still reports 18 unresolved gates
and `deployable: false`. Its 40 table names and 406 column names match the
checked-in staging baseline exactly. Catalog and generated artifacts were
written outside the repository with mode `0600`; no application rows were read.

On 2026-09-27 JST, the same read-only query completed at
`2026-09-27T00:27:21Z` against the linked `fanmark.id` project. The current
catalog still has 40 public tables, 406 table columns, 144 constraints, 139
indexes, 15 enum labels, one view, 58 functions, 36 non-internal triggers, and
77 RLS policies. It records the same `en_US.UTF-8` locale. The explicit
credential descriptor compiled for this catalog with digest
`c187430387bdc5208457a1d24a82cebc8b4de17487c7f1c77c7dd18cbeb3c41d`; a fresh
schema-conversion v4 report still has 18 blocking groups (10 row-conversion, 8
schema/operation) and `deployable: false`. The private catalog, generated SQL,
descriptor, and report each have mode `0600` outside the repository. Running
`test-d1-import-current-schema.mjs` on this fresh catalog completed all 40
synthetic source-table checkpoints with `public_rows_reconciled`, but left
`fullMigrationReconciled: false`. No application rows were queried, no Cloudflare
D1 was written, and no schema/import readiness is inferred from that rehearsal.

A separate read-only comparison against `fanmark-business-staging` used the
same fresh catalog. All 40 source tables and all 406 source columns exist in
business D1; their SQLite types match the current converter profile and all
source nullability agrees. The target has three additional reviewed staging
extension columns and 32 additional operational indexes; all 66 indexes
emitted by the source converter are present. D1 reported zero rows written and
`changed_db: false`. This does not verify constraints beyond the checked
metadata, triggers, RLS/function behavior, or any source business rows.

The same private catalog was reprocessed with schema converter version 4 on
2026-09-25. The source locale is `en_US.UTF-8`, so the three PostgreSQL regex
CHECKs remain unresolved: the converter's exact ASCII/GLOB equivalents are
enabled only for a `C`/`C` locale, where character ranges and case behavior are
bounded. Applying those equivalents to this source locale would be unsafe
without a source-compatible character-range implementation. The report still
has 18 unresolved gate groups and `deployable: false`. Version-4 SQL again
parsed in isolated SQLite with 40 tables and 66 indexes, zero foreign-key
violations, and `integrity_check=ok`; it was not applied to Cloudflare business
D1. Snapshot format remains version 3; `schemaConversionVersion` is now 4, so
older conversion state cannot resume under changed rules.

## Representation decisions for implementation

These are implementation requirements; their importers and full target
constraints remain to be implemented and tested. D1 uses SQLite conventions
and supports JSON functions, but PostgreSQL DDL cannot be copied verbatim.
See [D1 SQL support](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
and [the Workers binding API](https://developers.cloudflare.com/d1/worker-api/).

| Source representation | Target rule and required evidence |
| --- | --- |
| UUID | TEXT, preserving every existing ID and relationship; reject malformed import values rather than generating replacements. New IDs use a D1-native RFC 4122 version-4 default. |
| Text | Preserve Unicode exactly, including emoji variation selectors, skin tones, and joiners. Normalization applies only to explicitly normalized domain fields. |
| Boolean | INTEGER restricted to 0/1, preserving SQL NULL where allowed. Bind integers explicitly rather than relying on JavaScript boolean coercion. |
| Integer/smallint | INTEGER with source range and domain checks. Preserve nullable values. |
| Bigint | Exact integer import; reject any path through an unsafe JavaScript Number. Inspect range before deciding the API encoding. IDs and counters must not be silently rounded. |
| Timestamptz | Fixed-width UTC text preserving source microsecond precision for application tables. Do not import through JavaScript Date if that would discard precision. Reject unsupported infinity or out-of-range values with a recorded conversion failure. Better Auth's own adapter-managed dates have a separate tested contract. |
| Date | Validated calendar `YYYY-MM-DD`, without timezone conversion. |
| JSONB | Validated JSON text. Preserve JSON null versus SQL NULL. Do not claim raw-byte equality after PostgreSQL JSONB normalization; compare canonical values under an explicit numeric policy. |
| PostgreSQL arrays | Validated JSON arrays preserving order, duplicates, element values/nulls, and SQL NULL versus empty arrays. Source dimensions/lower bounds need validation before flattening. Array-query behavior and indexes require explicit replacements. |
| Enum | TEXT with a reviewed CHECK over the observed label set. Existing labels are the import authority; reject unknown labels instead of assigning a default. |
| Exact decimal | Do not silently convert to binary floating point. The specific columns below require exact encodings and operation tests. |
| `fanmark_password_configs.access_password` | Remains target `TEXT`, but schema conversion requires the explicit credential descriptor and labels it `credential-to-bcrypt`; without that descriptor it uses the blocking `credential-descriptor-required` codec. Generic text INSERTs remain prohibited. |

Sensitive values, source rows, and actual extrema used for range validation
must stay in private migration artifacts. Public reports should identify the
conversion rule and pass/fail outcome without publishing user records.

## Columns needing explicit handling

- `fanmark_availability_rules.price_usd` and `fanmark_tiers.monthly_price_usd`
  are `numeric(10,2)`: use exact integer cents in the target operation model,
  with reversible conversion at the API boundary. Existing USD display/API
  semantics must remain unchanged; this is not permission to change prices.
- `fanmark_lottery_entries.lottery_probability` is unconstrained `numeric`:
  preserve an exact decimal-text representation until the weighted-selection
  operation has a reviewed precision/range contract. Its source `> 0` CHECK is
  translated using canonical-text validation and digit inspection, without a
  REAL cast. An approximate REAL conversion is not an accepted migration.
- `fanmark_discoveries.search_count`, `favorite_count`, and `fanmark_events.id`
  are bigint. The event ID default maps to D1 `INTEGER PRIMARY KEY
  AUTOINCREMENT`. The frozen import must still capture and seed PostgreSQL's
  exact next sequence value; retaining existing IDs alone does not preserve
  that operational state.
- Array columns occur in `emoji_master` (keywords/codepoints),
  `extension_coupons` (allowed tier levels), `fanmark_discoveries`,
  `fanmark_events`, `fanmark_favorites`, and `fanmarks` (emoji UUID arrays).
  Array containment and equality must be matched at the operation level.
- The converter now handles `seq_key(uuid[])` indexes by indexing the target
  column's canonical JSON text, but only when the catalog confirms the argument
  column is exactly `uuid[]`. The row projection uses compact
  `array_to_json(... )::text`, preserving element order. The row importer now
  rejects empty or NULL-containing `normalized_emoji_ids` in discovery, event,
  favorite, and fanmark rows, which are the source helper's input invariants.
  The source MD5 key still has a theoretical collision boundary that the
  target representation does not share; non-UUID-array expressions remain
  blocking. A fresh private schema-converter-v4 report confirms that the
  catalog-approved UUID-array indexes parse and the complete 40-table DDL
  loads with valid foreign keys. The report still has 18 unresolved gate
  groups and `deployable: false`.

The latest private catalog was reprocessed after this converter change on
2026-09-25. It emits 40 tables and 66 indexes, with zero foreign-key
violations and `integrity_check=ok` in an in-memory SQLite rehearsal. The
same 18 gate groups remain, so the generated schema is still not deployable.
- `fanmark_access_daily_stats.stat_date` remains a calendar date.
- `user_roles.role`, `user_settings.plan_type`, and
  `user_settings.preferred_language` use enums. Role migration is inseparable
  from the Worker authorization boundary.

## Constraints, indexes, and defaults

Every source constraint needs a target counterpart or a named operation that
enforces it atomically. In particular, `auth.users` foreign keys require the
preserved Better Auth user UUID relation, not a disconnected set of identity
strings. Do not create placeholder users to make an import pass.

PostgreSQL `char_length` and SQLite length behavior must be checked against
emoji fixtures. Source GIN indexes require a deliberate relational/JSON query
strategy; omitting them and testing only a tiny synthetic dataset is not a
performance proof. Preserve unique keys, nullable uniqueness, partial-index
predicates, and delete/update behavior. Read the actual index expression
before choosing an equivalent target.

Translate UUID/time/sequence defaults explicitly. Seed rows retain their
source values. Future inserts obtain operation timestamps consistently and
allocate IDs without collisions; `nextval` is not available as a copied
PostgreSQL default in D1. Defaults do not replace the 36 source triggers or
RLS policies, which remain part of the operation and authorization migration.

Before a full schema/import is accepted, apply the complete D1 migration chain
to an empty local database, import a synthetic edge-case dataset and a private
rehearsal snapshot, verify row/key/relationship/value reconciliation, exercise
all mutating operation invariants, and repeat on the authorized target account.
Passing one recent-list query is not evidence for the full schema migration.

## Read-only value preflight

The catalog-reading CLI role could not SELECT `fanmark_discoveries`, so the
initial `scripts/migration/value-readiness.sql` invocation failed on permissions
and produced no result. No grants or roles were changed. Equivalent aggregate
predicates subsequently ran successfully in the already-authorized Supabase
SQL Editor, wrapped in `BEGIN READ ONLY` / `COMMIT`.

At that observation, the inspected bigint columns fit JavaScript's safe integer
range, the two USD columns could be converted to exact integer cents, the nine
array columns had no nonempty multidimensional/non-1-based arrays, and lottery
probabilities had no negative or nonfinite values. This does not authorize
future coercion: the importer must enforce the same rules on its actual snapshot.

**License creation timestamps do contain sub-millisecond precision.** A
JavaScript Date round trip would discard real source information. The D1
recent repository and importer must preserve the timestamp string at full
precision. The inspected creation timestamps were finite and within the
four-digit AD year range. The affected count stays in the private observation
artifact and is not published here.

This preflight does not cover all timestamp columns, JSONB numeric precision,
array elements, source export consistency, foreign-key reconciliation, or any
write path. Those remain required import/rehearsal checks. `value-readiness.sql`
records the reviewed predicates for a future run with authorized SELECT access.

## 2026-09-26 current-catalog rehearsal

The schema-only catalog was queried again through the linked Supabase CLI and
kept outside the repository with mode `0600`. The snapshot contains 40 tables,
406 columns, 144 constraints, 139 indexes, one view, 58 functions, 36 triggers,
and 77 RLS policies; no application rows were read. Version-4 conversion
continues to report 18 unresolved gate groups and `deployable: false`.

The exact catalog then passed
`node scripts/migration/test-d1-import-current-schema.mjs` using three
synthetic rows in disposable local Miniflare D1: all 40 table checkpoints
completed, an unknown acknowledgement resumed safely, typed readback and the
foreign-key check passed, and tampered credential coverage was rejected. The
final state is `public_rows_reconciled`, while `deployable` and
`fullMigrationReconciled` remain false. This proves the current catalog can
drive the synthetic importer rehearsal; it does not resolve the catalog gates,
establish production readiness, or migrate user data.

## Source-text codec implementation

The exact source-text conversion helpers and D1 binding evidence are documented
in [value-codecs.md](value-codecs.md). The importer must use reviewed per-column
codecs and preserve text before JSON parsing; these helpers do not replace the
full schema, array-dimension preflight, or row reconciliation.

## Later read-only refresh (2026-09-27T03:51:59Z)

The linked `schema-readiness.sql` catalog was refreshed in a read-only
transaction. It still contains 40 tables, 406 table columns, 144 constraints,
139 indexes, one view, 58 functions, 36 non-internal triggers, and 77 RLS
policies. The query read no application rows and changed no source or target
data.

A private version-4 conversion emitted 18 gate groups and `deployable: false`:
10 row-conversion groups affecting 227 locations and 8 schema/operation groups
affecting 101 locations. The row categories are array shape, bigint range,
credential transform, date, exact decimal, JSON, cents conversion, sequence
state, timestamp precision, and UUID validation. The schema/operation
categories are external Auth references, timestamp defaults, four untranslated
catalog scopes (functions, RLS policies, triggers, and views), CHECK
translations, and unsupported index methods. This refresh passed no data-value
checks and does not close the import gates.

The generated report was produced without supplying the private credential
descriptor, so this particular report names `credential_descriptor_required`.
The descriptor-aware path instead reaches the dedicated transformed-row
import requirement; neither report permits generic text insertion of
`access_password`. The report, catalog, and generated SQL were written with
mode `0600` outside Git. The fresh metadata does not change the current D1
schema or any application table data.

## Latest read-only refresh (2026-09-27T12:13:53Z)

The linked catalog query completed without an interactive prompt and again
reported 406 columns, 144 constraints, 139 indexes, 15 enums, one view, 58
functions, 36 triggers, and 77 RLS policies. With the value-free credential
descriptor, the fresh v4 report still has 18 blocking groups: 10 import-stage
row-conversion groups (227 locations) and 8 in-scope schema/operation groups
(101 locations). The latter are external Auth references, timestamp defaults,
untranslated function/view/trigger/RLS scopes, three locale-sensitive CHECKs,
and four GIN indexes. The database locale remains `en_US.UTF-8`; the converter
continues to leave the three PostgreSQL regex CHECKs blocked rather than assume
ASCII range equivalence. The fresh report stays `deployable: false`.

The exact refreshed catalog passed the synthetic current-catalog D1 rehearsal:
four generated rows, 40 completed table checkpoints, exact public-row
reconciliation, and conflicting replay rejection. This proves the synthetic
import path against the current schema shape, not production deployability or
real-data migration readiness.

## Version 6 recent-view query adaptation (2026-09-28 JST)

A read-only schema refresh completed at `2026-09-27T16:14:11Z`; its catalog
still contains one view, `recent_active_fanmarks`. Converter v6 adapts that
scope only when the input has exactly that single view, its catalog kind and
name match, and its exact definition SHA-256 is
`edb14241ebabddc6167bf07eee51ad24843f564e0a925bac4eedb1d44bdb3a3c`. The
replacement is the already-tested D1 recent-list query and its documented API
contract. A changed definition, extra view, or changed catalog shape retains
the blocking `unsupported_catalog_scope` gate.

The private v6 conversion generated the same 40-table/406-column profile and
now has 16 gate groups: 10 row-conversion groups and 6 schema/operation groups
across 96 locations. `deployable` remains `false`; the private credential
descriptor was not supplied, and the remaining function, trigger, and RLS
scopes remain blocking. The public recent API and D1 repository now accept the
source RPC's full 1..50 limit; the landing-page client still requests 20. The
converter suite passed 13/13, recent Worker API tests 15/15, D1 repository
tests 6/6, and Worker typecheck passed under Node 22.6.0. The catalog, DDL, and
report are mode `0600` outside Git. No user rows, production state, remote D1
schema/data, or domain/DNS settings changed.

## Version 5 GIN index query-contract review (2026-09-28 JST)

A new read-only refresh at `2026-09-27T16:02:02Z` confirmed the same 40-table
source catalog: 406 columns, 144 constraints, and 139 indexes. It read
catalogs only. Converter v5 recognizes four GIN indexes only when each live
definition exactly matches its reviewed table/index definition. The checked-in
source and Worker queries contain no array containment/overlap predicates or
full-text `tsvector` query. Normalized fanmark-ID equality remains backed by a
D1 UNIQUE constraint; emoji admin substring search continues through the
Worker's `instr(lower(...))` predicate. The report records each omission and
its query replacement/reason under `target.indexAdaptations`. Any unreviewed or
changed GIN index remains a blocking `unsupported_index_method` gate.

This removes the four index-method locations from the schema/operation gates:
the fresh v5 report has 17 groups (10 row-conversion, 7 schema/operation), and
`deployable` correctly remains `false`. The conversion used no private
credential descriptor, so it retains `credential_descriptor_required`; it
does not permit generic credential copying. Catalog, generated SQL, and report
are mode `0600` and outside Git. No target D1 migration or data write occurred.

## Version 7 locale-proven regex checks (2026-09-28 JST)

The refreshed schema-only catalog now includes a private `regex_range_probe`
alongside its `en_US.UTF-8` locale. The probe tested the exact invitation-code,
settings-key, and waitlist-email regex character ranges over all 1,112,063
valid Unicode scalar values; all five extra-match counts were zero. This proves
that those source expressions accept only the ASCII characters mirrored by
the D1 checks under the observed source collation. PostgreSQL documents that
regex ranges depend on collating sequence; v7 therefore requires the matching,
complete proof in the same catalog, and retains the gate for a missing or
changed proof or any other locale.

The waitlist D1 check now validates the terminal top-level domain precisely;
synthetic SQLite cases and a read-only PostgreSQL sample confirm it rejects
values such as `x@y.co1` that the prior glob accepted, while retaining
source-valid dotted subdomains. The fresh v7 report has 15 groups: 10
row-conversion groups and 5 schema/operation
groups across 93 locations. `deployable` remains `false`. The schema converter
tests pass 13/13, snapshot-export tests pass 19/19, and the generated 40-table
DDL loads in local SQLite with 66 indexes, a clean `foreign_key_check`, and
`integrity_check=ok`. Catalog, SQL, and report remain mode `0600` outside Git;
the read-only refresh and probe read no application rows, and no remote D1,
user data, production route, or domain/DNS setting changed.

## Version 7 current-catalog synthetic import (2026-09-28 JST)

The fresh private v7 catalog adds `regex_range_probe` to the schema metadata.
The first current-catalog import attempt exposed that the credential descriptor
validator still rejected this new top-level field; it stopped during schema
preflight before creating the temporary local D1. The validator now accepts the
optional probe only with its exact reviewed keys, nonempty locale names, a
positive safe Unicode-scalar count, and nonnegative safe mismatch counts.
Unknown, missing, negative, or unsafe fields still fail closed.

After the fix, `test-d1-import-current-schema.mjs` completed the v7 synthetic
rehearsal: 10 synthetic source rows, 2 transformed credentials, 1 deferred
inactive credential, all 40 table checkpoints, and conflict rejection. The
result is `public_rows_reconciled`; `deployable` and
`fullMigrationReconciled` remain false. This used no application rows, remote
D1, production route, or domain/DNS setting and does not close the remaining
schema/import or operational-equivalence gates.

## Version 8 current-catalog replay (2026-09-28 JST)

A fresh linked-project run of `schema-readiness.sql` completed at
`2026-09-27T19:52:51Z`. It read PostgreSQL catalogs only and returned 40
tables, 406 columns, 144 constraints, 139 indexes, 58 functions, 36
non-internal triggers, and 77 RLS policies. Under Node 22.6.0, the exact
result passed `test-d1-import-current-schema.mjs` after the UUID row-codec v8
change: 10 synthetic source rows, 2 transformed credentials, 1
`deferred_inactive` credential, and all 40 table checkpoints reconciled.
The injected acknowledgement-unknown retry converged, and a conflicting
coverage replay was rejected. The result remains `public_rows_reconciled`,
with `deployable: false` and `fullMigrationReconciled: false`.

The catalog was held in a mode-0600 temporary file outside Git and removed
after the rehearsal. No application rows were queried; no remote D1, R2,
production route, or domain/DNS setting was changed. This refresh verifies the
current synthetic import path, not source-row parity or production readiness.

## Version 8 descriptor-aware fresh-catalog replay (2026-09-28 JST)

A second read-only linked-project catalog query completed at
`2026-09-27T20:56:46.804464Z` from a separate private work directory, leaving
the repository's CLI state untouched. It returned the same 40 tables, 406
columns, 144 constraints, 139 indexes, 15 enum labels, 58 functions, 36
non-internal triggers, and 77 RLS policies. Converter v8 still reports 14
unresolved gates: nine row-conversion groups and five schema/operation groups.
The value-free credential descriptor now resolves the generic missing-descriptor
gate into the explicit `credential_transform_import_required` gate; it does not
make the catalog deployable.

The current-catalog synthetic D1 rehearsal passed with 10 synthetic rows, two
transformed active credentials, one explicitly deferred inactive credential,
all 40 table checkpoints, and rejection of conflicting coverage. Its status is
`public_rows_reconciled`; `deployable` and `fullMigrationReconciled` remain
false. The mode-0600 catalog, descriptor, generated SQL, and reports were held
outside Git and removed after the rehearsal. No source application rows or
remote D1/R2 were written, and no production route or domain/DNS setting was
changed.

## Version 9 calendar-date DDL validation (2026-09-28 JST)

Schema conversion v9 moves PostgreSQL `date` validation from an import-only
gate into generated D1 DDL. The `TEXT` column check requires ten ASCII digits
in `YYYY-MM-DD` form, years 0001–9999, and an unchanged SQLite calendar-date
normalization. This enforces the same canonical calendar range as the row
codec on later D1 writes as well as imported values. The source-shaped
`fanmark_access_daily_stats.stat_date` remains `NOT NULL`.

SQLite accepted year 0001, leap day 2024-02-29, and year 9999, while rejecting
year 0000, impossible month/day combinations, non-padded values, and
`infinity`; NULL remained rejected by the source `NOT NULL` constraint. The
fresh schema-only catalog now reports 13 unresolved groups across 226
locations (nine row-conversion and four schema/operation); `deployable` remains
false. Only this table's generated DDL changed relative to v8. Catalog and
generated SQL were kept outside Git, and no remote D1 was modified.

## Version 10 UTC microsecond timestamp DDL validation (2026-09-28 JST)

Schema conversion v10 adds a `CHECK` for PostgreSQL `timestamp with time zone`
columns. It accepts only fixed-width UTC text in `YYYY-MM-DDTHH:mm:ss.ffffffZ`
form, four-digit years 0001–9999, real calendar days, and valid hour/minute/
second fields. It protects imported values and later D1 writes. SQLite and
Miniflare D1 tests accept canonical values and reject malformed dates, offsets,
precision, and time fields in the SQLite fixture. Miniflare D1 directly
confirms that an impossible leap-date update and a millisecond-only timestamp
update are rejected while preserving the old value.

The latest schema-only catalog has 103 timestamptz columns across 40 tables.
Because each table has at least one such column, generated DDL changes for all
40 table blocks. The readiness report remains at 13 unresolved groups across
226 locations, including `timestamp_import_precision`: the DDL constraint
cannot prove that every application operation preserves the intended source
timestamp. Core registration, return, transfer, lottery, settings, favorites,
access analytics, and notification read-state Worker writes now use a shared
fixed-width UTC microsecond formatter; their focused D1 tests pass 72/72.
Their corresponding frontend API contract tests pass 44/44. Other Worker D1
writers and all `now()` default locations still need the same operation-level
audit. No user rows were read and no remote D1 was written.

Additional operation paths now use that formatter for account deletion,
profile/password setup, administrator user actions, lifecycle/maintenance/
system settings, waitlist administration/signup, invitation administration/
signup, and extension-coupon administration/application. Their focused D1
suites pass 84/84, bringing the combined focused Worker D1 total to 156/156.
The coupon administration's SQL-generated monotonic revision timestamp also
now retains six fractional digits. These tests confirm the stored operation
values use fixed-width UTC microsecond text. This is additional path coverage
only: the schema readiness report still has 13 unresolved groups across 226
locations, and `timestamp_import_precision` remains open until the complete
writer/default inventory is reconciled. No user rows were read and no remote
D1 was written.

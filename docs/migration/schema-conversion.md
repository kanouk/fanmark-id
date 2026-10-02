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
  favorite, and fanmark rows. This is a target import policy, not a source
  helper invariant: PostgreSQL omits NULL elements in array_to_string and the
  empty-array length condition is NULL, so the reviewed helper hashes empty
  arrays instead of rejecting them. The converter now retains the explicit
  seq_key_input_contract_requires_review gate for the three candidate indexes.
  Writer/import disposition and source definition review are required; see
  [source sequence-key review](source-sequence-key-review.md).
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
signup, extension-coupon administration/application, and admin email-template
updates, and broadcast email administration, delivery leases/retries, and
Resend webhook event persistence. Their focused D1 suites pass 107/107,
bringing the combined focused Worker D1 total to 179/179. Coupon and
email-template administration's SQL/application-generated monotonic revision
timestamps also retain six fractional digits. Tests read back the stored
operation values as fixed-width UTC microsecond text. This is additional path
coverage only: Stripe webhook receipt/dispatch, invoice projection, and
subscription reconciliation writes now use the same format, with their
synthetic D1 integration suite passing 59/59. Emoji master admin, reference
master release creation/verification/activation, and scheduled notification
writes use the format too; their respective suites pass 21/21, 6/6, and 12/12. The schema readiness
report still has 13 unresolved groups across 226 locations, and
`timestamp_import_precision` remains open until the complete writer/default
inventory is reconciled. No user rows were read and no remote D1 was written.

The local emoji/reference release suites now assert fixed-width metadata and
activation-audit readback (7/7 and 5/5). Migration
`0007_release_audit_timestamps.sql` makes each audit timestamp equal its
canonical active-pointer `updated_at`; staging configs and remote guards include
the exact filename and exclude the Auth-only `0007` migration. Wrangler's
read-only remote list showed only this migration pending. After Actions run
`36368026109` passed, Wrangler applied it to staging Master D1; readback found
no migrations pending and confirmed all four audit triggers use
`NEW.updated_at`. The read query reported `changed_db=false` and zero rows
written. D1-writing synthetic
staging smoke scripts also use six-digit UTC values. Lifecycle/schema tests
pass 16/16 and Worker typecheck passes; the complete writer/default inventory
remains open. The full Worker test chain, staging Vite build, and Wrangler
deployment dry-run pass; no Worker deployment was performed.

## Version 11 `now()` default representation (2026-09-28 JST)

The converter now emits a D1 SQLite default for `now()` on source
`timestamp with time zone` columns:
`strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')`. This produces a fixed-width UTC
value accepted by the v10 timestamp `CHECK`, including when a target insert
omits the timestamp. A synthetic Miniflare D1 integration test applies the
generated DDL and reads back a 27-character value ending in `Z` with three
clock digits and three padded zeroes; the SQLite unit test checks the same
contract.

The default remains a fallback representation only. Its clock has millisecond
resolution and SQLite evaluation does not preserve PostgreSQL transaction-time
semantics, so `timestamp_default_requires_operation` stays blocking and
parity-sensitive Worker operations must supply their own timestamp. Defaults
on non-timestamptz columns are still omitted and gated. The generator version
is 11; a v10 snapshot manifest fails the current verifier and must be freshly
exported. The 2026-09-28 read-only schema refresh was reprocessed without the
private credential descriptor, so the v11 report retains
`credential_descriptor_required`. It has 13 unresolved groups across 226
locations (8 row-conversion, 5 schema/operation) and remains
`deployable: false`. All 79 source `now()` defaults are timestamptz and emit
the fallback expression. The generated DDL loaded all 40 tables in SQLite;
`integrity_check=ok` and `foreign_key_check` returned no violations. No source
rows were queried, and no remote D1, production routing, user data, or
domain/DNS state was changed.

## Version 11 descriptor-aware fresh-catalog replay (2026-09-28 JST)

The linked Supabase catalog was refreshed with the reviewed read-only
`schema-readiness.sql` query. The credential descriptor was supplied only as
value-free policy metadata (`bcryptjs@3.0.3`, cost 10); no password or hash was
read. Under Node 22.6.0, schema conversion generated all 40 tables and kept
`deployable: false`. The report has 8 row-conversion gate groups across 133
locations and 5 schema/operation groups across 93 locations (13 groups / 226
locations total). The groups still include array, exact bigint, decimal, JSON,
money, sequence, timestamp-import, credential-transform, external-foreign-key,
timestamp-default-operation, and unsupported-catalog-scope requirements.

The fresh-catalog synthetic Miniflare D1 replay completed 40/40 checkpoints
with 10 synthetic rows. It transformed two synthetic credentials, durably
deferred one inactive-license credential, verified typed/hash readback, and
rejected conflicting coverage. Its result is `public_rows_reconciled` only;
`deployable` and `fullMigrationReconciled` remain false. The read-only source
query read catalog metadata only. No Supabase application rows or remote D1/R2
rows were read or written, and no production route or domain/DNS state changed.

## Current schema-only source refresh (2026-09-28 05:07 UTC)

Re-ran the reviewed `schema-readiness.sql` through Supabase CLI 2.118.0 with an
isolated temporary project-link directory so the checkout's existing CLI
state was not changed. The read-only catalog query returned 40 tables, 406
columns, 144 constraints, 139 indexes, 15 enum labels, one view, 58 functions,
36 non-internal triggers, and 77 RLS policies. The locale remained
`en_US.UTF-8`; all five exhaustive Unicode regex-range probes found zero extra
matches.

The value-free `bcryptjs@3.0.3` / cost-10 credential descriptor was passed to
schema-converter v11; no password or hash was read. The fresh report remains
`deployable: false` with 13 groups / 226 locations: 8 row-conversion groups /
133 locations and 5 schema/operation groups / 93 locations. Exact location
counts by gate are recorded in the current report summary in `EXECUTION.md`.
The generated DDL loaded into an ephemeral in-memory SQLite database with all
40 tables, `integrity_check=ok`, and zero foreign-key violations. The private
catalog, descriptor, generated DDL, and report were held in a mode-0700
temporary directory and removed on exit. This refresh queried PostgreSQL
catalogs only; no source rows or Cloudflare D1/R2 state were read or changed.

## Shared D1 operation timestamp formatter (2026-09-28 JST)

The canonical fixed-width UTC microsecond formatter in
`workers/api/src/utc-timestamp.ts` now also backs availability timestamps,
Stripe plan and extension checkout, availability-rule edits, notification
admin event/master timestamps, and owner fanmark-profile timestamps. Local
contract coverage passes 48/48 across the affected API suites and the shared
formatter test; Worker typecheck passes. This aligns these operation paths on
one formatter without changing their timestamp source or transaction
boundaries. The complete writer/default inventory is still open, so the
`timestamp_import_precision` and `timestamp_default_requires_operation` gates
remain, along with the other v11 gates; no Supabase rows or remote D1 were read
or written.

Stripe plan-checkout, Stripe customer-creation, and plan-change idempotency
deadlines also use the shared formatter now. Their integration suites pass
17/17 after the change; this is operation-path coverage, not completion of the
full timestamp inventory.
The same formatter also supplies the default clock for public-access logging
and Stripe webhook application; their suites pass 13/13 and 59/59,
respectively. Full source-column writer/default reconciliation remains open.
Its JavaScript implementation is also shared by verified-access and scheduled
license-expiry timestamp creation (tests 10/10 and 8/8); typecheck and Worker
dry-run pass with the typed TypeScript re-export.

## Current schema-only source refresh (2026-09-28 12:07 UTC)

The reviewed `schema-readiness.sql` was rerun with Supabase CLI 2.118.0 using
`--linked --yes` and a private temporary project-link directory. Its explicit
`BEGIN READ ONLY` transaction returned catalog metadata only. The snapshot
observed at `2026-09-28T12:07:48Z` still has 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enum labels, 1 view, 58 functions, 36
non-internal triggers, and 77 RLS policies.

The value-free bcrypt descriptor was applied in memory to schema-converter
v11. The current report remains `deployable: false` with 13 groups / 226
locations: row conversion 8 / 133, schema and operations 5 / 93. The gate
distribution is array 9, bigint range 3, credential transform 1, decimal 1,
external Auth reference 11, JSON 13, money cents 2, sequence state 1,
timestamp default operation 79, timestamp import precision 103, and three
unsupported catalog scopes. No source rows, credential values, remote D1/R2,
production route, or domain/DNS state was read or changed. The catalog response
and generated report stayed in memory and the temporary link directory was
removed.

## Verified money-cents and credential-transform import (2026-09-28 JST)

The two explicitly mapped `numeric(10,2)` columns now retain their reviewed
`money-cents-int64` codec without a blocking schema-conversion gate. The
PostgreSQL text codec uses integer arithmetic, accepts the full source range
`-99999999.99` through `99999999.99`, and produces safe integer-cent bindings.
Generated D1 checks accept only integer cents in the matching range. The
availability-rule Worker reads cents as canonical two-decimal USD text, while
the reference-master importer and admin API convert between canonical USD text
and integer cents with checked bounds. Existing API integration tests verify
the read/write projections; new row-conversion and generated-DDL tests cover
both extrema, one-cent values, SQL NULL, non-cent precision, and overflow.

The descriptor-aware credential codec also uses the completed profile-bound
transformed-row importer, so `credential_transform_import_required` is no longer
reported as unresolved when the valid value-free descriptor is supplied. The
importer still requires the exact target profile and rejects the generic path
before any report, ledger, or target write; synthetic current-catalog tests
cover transformed rows, inactive-row deferral, ACK-loss resume, and typed
readback. Without a descriptor, `credential_descriptor_required` remains.

Unconstrained `numeric` and the other type/parity gates remain, and the full
v13 report remains `deployable: false`. The schema-conversion version is now 13,
so older snapshot manifests are rejected and must be freshly exported before
verification/import. Removing the two money locations and one completed
credential-transform location from the latest descriptor-aware catalog shape
reduces readiness from 13/226 to 11/223 (6 row-conversion groups / 130
locations; 5 schema/operation groups / 93 locations). No source rows or remote
D1 state were read or changed by this codec update.

## Exact lottery-weight conversion and v14 schema refresh (2026-09-28 JST)

The exact decimal gate for `fanmark_lottery_entries.lottery_probability` is
closed only for the current reviewed source shape: PostgreSQL `numeric`,
`NOT NULL`, and the validated `positive_probability` CHECK. Schema-converter
v14 emits a dedicated `lottery-weight-positive-decimal-text` codec with a
256-character maximum shared with the D1 BigInt weighted-selection engine.
The row converter now rejects nonpositive, noncanonical, and over-limit text
before D1 bindings are produced. Missing/changed checks or other numeric
columns keep the generic `decimal_import_validation` gate.

A fresh linked catalog-only refresh confirmed the same 40 tables, 406 columns,
144 constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
non-internal triggers, and 77 RLS policies. A separate linked `BEGIN READ ONLY`
aggregate over only the lottery probability column found no noncanonical,
nonpositive, or over-limit values; it returned no IDs or values and was not
saved. The descriptor-aware v14 report has 10 unresolved gates / 222 locations
(5 row-conversion / 129, 5 schema/operation / 93), and remains
`deployable: false`. Schema conversion advanced to v14 and D1 importer codec to
v4 so an older snapshot or checkpoint cannot reuse the previous codec contract.
No user rows were exported/imported and no remote D1, production route, or
domain/DNS state changed.

## Exact event sequence import path and v15 report (2026-09-28 JST)

Schema converter v15 recognizes only the exact `fanmark_events.id` bigint
primary-key default for `public.fanmark_events_id_seq` as covered by the current
snapshot contract. Snapshot verification requires the complete sequence state
and definition; D1 import seeds `sqlite_sequence` to the maximum of the source
watermark and imported IDs and verifies its readback. Unsupported nextval
profiles remain gated. This closes the schema report's stale sequence-import
capability gate, not the coordinated writer freeze needed to obtain a final
consistent source sequence state.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:25 UTC
reports 9 unresolved groups / 221 locations (4 row-conversion / 128, 5
schema/operation / 93) and remains `deployable: false`. The query returned no
application rows or live sequence values.


## Internal bigint event key and v16 report (2026-09-28 JST)

The source schema has two bigint discovery counters that reach the Worker API,
so `bigint_import_range_validation` remains for those columns. The other bigint
column, `fanmark_events.id`, is an internal sequence-backed key: application
code only inserts into that table and does not select or return the generated
ID. Snapshot import binds exact decimal text, then restores and verifies the
sequence watermark. Converter v16 suppresses the read-precision gate only for
that exact sequence profile; other bigint and sequence shapes remain blocked.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:30 UTC
reports 9 groups / 220 locations (4 row-conversion / 127, 5 schema/operation /
93) and remains `deployable: false`. No application rows were read.

## Snapshot-validated arrays and v17 report (2026-09-28 JST)

The row envelope's array contract records `isNull`, `ndims`, and `lowerBound`
for every supported array column. Row conversion accepts only one-dimensional
arrays with lower bound 1 or an empty array, validates `text[]`, `uuid[]`, and
`smallint[]` elements, and preserves order, duplicates, element NULLs, and SQL
NULL versus empty. The schema converter now shares that exact supported-type
list with both row conversion and scalar/array codecs, so it removes
`array_import_validation` only for these codecs. Other PostgreSQL array types
remain blocked as unsupported.

A fresh linked, read-only catalog query at 2026-09-28 14:43 UTC returned 40
tables and 406 columns; all nine arrays use the three supported element types.
The v17 report removes the array gate's nine locations: 8 unresolved groups /
211 locations (3 row-conversion / 118, 5 schema/operation / 93), still
`deployable: false`. Focused schema/row tests pass 27/27 and the complete
migration-data suite passes 185/185 with no skips. No application rows or live
sequence values were read.

## Fresh schema-only catalog and v17 synthetic replay (2026-09-29 00:42 JST)

The reviewed `schema-readiness.sql` completed through Supabase CLI 2.118.0 in a
private temporary project-link directory. The catalog-only, read-only query
again returned 40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum
labels, one view, 58 functions, 36 non-internal triggers, and 77 RLS policies.
No application rows or live sequence values were queried.

Schema converter v17 with the value-free `bcryptjs@3.0.3` / cost-10 descriptor
still reports 8 unresolved groups across 211 locations (3 row-conversion / 118
and 5 schema/operation / 93) and remains `deployable: false`. The current
catalog synthetic Miniflare replay completed 40/40 table checkpoints with 10
synthetic rows, transformed two credentials, deferred one inactive credential,
and rejected conflicting coverage. Its result is `public_rows_reconciled`, not
full migration reconciliation. No source application rows or remote D1/R2 were
read or written.

## Exact bigint API reads and schema converter v18 (2026-09-29 JST)

`fanmark_discoveries.search_count` and `favorite_count` are PostgreSQL `bigint`
values exposed by the favorites list API. The D1 query now casts both values to
text before the Worker runtime can represent them as JavaScript numbers. The
version-2 DTO accepts only canonical nonnegative signed-int64 decimal strings;
the browser keeps those strings intact. The Supabase default adapter converts
safe integers to the same form and rejects unsafe number values rather than
passing through a rounded count. A Miniflare D1 integration case reads back
`9007199254740993` and `9223372036854775807` exactly through the API.

The schema converter records this exact read disposition for only those two
catalog columns and removes their bigint application-read gate. Other bigint
columns remain gated unless their exact sequence or read contract is reviewed.
Schema conversion version is now 18 so old manifests cannot claim the newly
reviewed projection. A fresh linked, read-only `schema-readiness.sql` query at
`2026-09-28T16:40:24Z` observed the existing 40-table / 406-column catalog and
read no application rows. The descriptor-aware v18 report has 7 unresolved
gate groups / 209 locations (2 row-conversion / 116; 5 schema/operation / 93)
and remains `deployable: false`. Remaining gates are JSON import validation,
timestamp import precision, external Auth references, timestamp-default
operation semantics, and unsupported catalog scopes. Focused validation passed:
favorites client 5/5, favorites D1 6/6, schema converter 19/19, and both app
and Worker typechecks. No user rows, remote D1 writes, Worker deployment, or
domain/DNS state changed.

## JSONB text import contract and schema converter v19 (2026-09-29 JST)

The snapshot projection exports each `jsonb` value as PostgreSQL text inside a
JSON string field, so JSON numbers never pass through the outer JSON numeric
representation. The row codec parses that text to reject invalid JSON,
non-finite values, and unsafe integer values, then binds the original text
unchanged. Generated D1 columns enforce `json_valid()` while allowing SQL
`NULL`. The source projection preserves the distinction between SQL `NULL` and
the JSON value `null`; exact D1 readback also retains high-precision decimal
text.

Schema converter v19 removes the redundant `json_import_validation` gate only
because these projection, codec, DDL, and readback checks are now covered
together. Tests verify SQL `NULL`, JSON `null`, nested JSON, a high-precision
decimal, and rejection of invalid text through real SQLite. Applying this one
rule change to the last recorded v18 catalog report removes its 13 JSONB
locations, leaving 6 groups / 196 locations (1 row-conversion / 103; 5
schema/operation / 93). That is a calculation from the recorded schema shape,
not a fresh Supabase catalog query. The converter remains `deployable: false`;
no source application rows, remote D1, production route, or domain/DNS state
were changed.

## Exact timestamptz import codec and schema converter v20 (2026-09-29 JST)

Schema converter v20 removes `timestamp_import_precision` because the complete
snapshot/import path has an exact, validated representation. The PostgreSQL
projection converts timestamptz values to fixed-width UTC text with six
fractional digits. `utcMicroseconds()` validates calendar/clock fields without
round-tripping those digits through JavaScript `Date` and returns the original
text. Generated D1 CHECKs require that same canonical shape, and the Miniflare
importer test independently reads `.123456Z` back unchanged. Invalid dates,
millisecond-only values, offsets, and infinity are rejected before binding.

The separate `timestamp_default_requires_operation` gate remains: proving exact
snapshot import does not prove the runtime clock behavior of every future
write. Applying v20 to the last recorded v18 catalog shape removes the
timestamp gate's 103 locations, leaving 5 schema/operation groups / 93
locations and `deployable: false`. This is a derived report, not a fresh source
catalog query. No source rows, remote D1, or production state was accessed.

## Fresh v21 catalog and full synthetic replay (2026-09-29 JST)

The reviewed read-only `schema-readiness.sql` query completed through Supabase
CLI 2.118.0 at `2026-09-28T18:27:23Z` in a private temporary project-link
directory. It returned 40 tables / 406 columns, 144 constraints, 139 indexes,
15 enum labels, one view, 58 functions, 36 non-internal triggers, and 77 RLS
policies; no application rows or live sequence values were queried.

The value-free credential descriptor and current converter v21 produce five
schema/operation gate groups / 93 locations: 11 external Auth references, 79
timestamp-default operations, and the functions, RLS policies, and trigger
catalog scopes. The report remains `deployable: false`. Unlike the preceding
v20 count, this result is based on the fresh catalog. V21 omits the
millisecond-resolution D1 `now()` fallback at every timestamp column; all 79
operation gates remain until exact runtime clock ownership is established.

The exact catalog passed `scripts/migration/test-d1-import-current-schema.mjs`
under Node 22.6.0: 10 synthetic rows, 40/40 checkpoints, two bcrypt
transformations, one durable inactive-license deferral, typed/hash readback,
and rejection of conflicting credential coverage. The scoped result is
`public_rows_reconciled`, not `fullMigrationReconciled`; no live source rows or
remote D1/R2 state was read or changed.

With converter v21, the same exact-catalog rehearsal again completed all 40
checkpoints with 10 synthetic rows, two bcrypt transformations, one inactive
credential deferral, typed/hash readback, and conflicting-coverage rejection.
The generated schema contains no approximate D1 timestamp defaults and still
reports five blocking schema/operation gate groups / 93 locations. The
SQL/report artifacts were written outside the repository with mode `0600`.
No source rows or remote state were accessed.

## Fresh Supabase catalog and v21 replay (2026-10-02 JST)

Re-ran the reviewed catalog-only `schema-readiness.sql` through Supabase CLI
2.118.0 with `CI=1`, `--linked`, and the explicit project ref. The read-only
query completed at `2026-10-01T22:10:49Z` and returned the same 40 tables,
406 columns, 144 constraints, 139 indexes, 15 enum labels, one view, 58
functions, 36 non-internal triggers, and 77 RLS policies. No application rows
or live sequence values were read. The catalog and intermediate CLI response
were kept in a mode-0700 temporary directory and removed after validation.

Converter v21 with the value-free credential descriptor reports no row
conversion gates and five schema/operation groups / 93 locations:
11 external Auth references, 79 timestamp-default operations, and 3
unsupported catalog scopes (functions, RLS policies, and triggers).
`deployable` remains false because runtime clock ownership and those external
operations/scopes are not fully established.

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs`
completed all 40 checkpoints with 10 synthetic rows, transformed two active
credentials, durably deferred one inactive credential, and verified typed/hash
readback and conflicting-coverage rejection. The result is
`public_rows_reconciled`; `deployable` and `fullMigrationReconciled` remain
false. No source application rows or remote D1/R2 state was read or changed.

## Fresh Supabase catalog and v22 reviewed reference-master defaults (2026-10-02 JST)

Converter v22 records the exact `created_at` and `updated_at` `now()` defaults
on the four versioned reference masters as a nonblocking replacement
disposition. The source-shaped import binds the validated source timestamps;
Cloudflare runtime reads active release views and administrative edits write
versioned release-row tables with explicit timestamps. A source audit regression
test confirms there are no direct Worker or migration SQL `INSERT` writers to
those source-shaped base tables. The converter still omits all eight D1
defaults rather than emitting SQLite's millisecond `now()` behavior.

Using the catalog observed at `2026-10-01T23:36:56Z`, the timestamp-default
operation group falls from 79 to 71 locations. The report still has five
blocking schema/operation groups / 85 locations: 11 external Auth references,
71 remaining timestamp operations, and three unsupported catalog scopes
(functions, RLS policies, and triggers). It remains `deployable: false`.
Focused schema-converter and source-audit tests pass 25/25; this disposition
does not authorize user-data import, a remote schema write, or production
cutover. The v22 current-catalog synthetic importer replay completed 40/40
checkpoints with 10 synthetic rows, two transformed credentials, and one
deferred inactive credential. It rejected conflicting coverage and remained
`public_rows_reconciled`, with `deployable` and `fullMigrationReconciled` false.

A separate static writer audit over the catalog observed at
`2026-10-01T23:41:40Z` scanned Worker TypeScript, Worker D1 migrations, and
migration scripts/SQL. It found 79 defaults across 40 tables and 140 supported
literal `INSERT` column lists. Twelve timestamp columns have no supported
literal writer: the eight versioned reference-master columns above and four
user-scoped columns (`notification_preferences` created/updated,
`notifications_history.archived_at`, and `user_roles.created_at`). Three
generated `INSERT` statements for `emoji_master`, `extension_coupons`, and
`email_templates` remain unparsed. Column coverage remains incomplete, and
this audit does not prove the timestamp values or transaction-time semantics.

### 2026-10-02 generated-writer follow-up

The audit now resolves the three generated master-seed paths and reports zero
unparsed target `INSERT` statements. `emoji_master` bootstrap rows now bind an
explicit UTC microsecond `created_at`/`updated_at` value and read it back. A
fresh catalog observed at `2026-10-02T04:34:34Z` yields 143 literal or
statically generated column lists across 40 tables. Twelve timestamp columns
still have no direct literal writer: eight are covered by the reviewed
versioned-reference replacement contract, while four user-scoped timestamps
need separate operation-level verification. This inventory does not prove
bound-value or PostgreSQL transaction-time semantics; `deployable` remains
false.

## Fresh Supabase catalog and v23 import-only timestamps (2026-10-02 JST)

The catalog-only query completed at `2026-10-02T07:02:17Z` under
`BEGIN READ ONLY`; it returned 40 tables and 406 columns. Converter v23 adds a
narrow disposition for `notification_preferences.created_at/updated_at` and
`user_roles.created_at`. These user-scoped rows are copied source-shaped by the
generic importer, which binds the original six-digit UTC timestamps. Current
Worker code has no direct INSERT writer for either table and no UPDATE writer
for notification preferences. The target DDL therefore omits these defaults;
a future runtime writer must provide its timestamp explicitly. Regression
coverage rejects new unreviewed writers and a fresh-catalog synthetic import
reads back both timestamp pairs exactly.

The checked-in source definition for `archive_old_notifications(integer)` has
a 90-day default. It atomically moves only `delivered` and `failed`
notifications whose `created_at` is older than the cutoff into
`notifications_history`, preserving the listed notification fields in
`original_data`; `archived_at` is supplied by the history table's `now()`
default. A later checked-in hardening migration revokes execution from
`PUBLIC`, `anon`, and `authenticated`. No invocation or schedule for this
function was found in the checked-in Worker, Edge Function, or migration
sources. This establishes the repository-defined archive operation, but not
whether or how often production invokes it. The source also does not define a
history purge; the target's long-term store and archive schedule therefore
remain unresolved. `notifications_history.archived_at` stays gated until the
Worker operation and target storage/scheduling contract are implemented and
tested. This is source-history evidence, not a fresh live function-body or
`pg_cron` readback.

With the catalog observed at `2026-10-02T07:02:17Z`, converter v23 reports five
blocking schema/operation groups / 82 locations: 11 external Auth references,
68 timestamp-default operations, and three unsupported catalog scopes
(functions, RLS policies, and triggers). It remains `deployable: false`.

The current-catalog synthetic import completed 40/40 checkpoints with 12
synthetic rows, two transformed credentials, one durably deferred inactive
credential, six calls to the synthetic Auth identity resolver, exact timestamp
readback for preferences and roles, and conflicting-coverage rejection. The
result remains `public_rows_reconciled`; `fullMigrationReconciled` remains
false. No source rows or remote D1/R2 state was read or changed.

## Converter v24: explicit D1 notification archive timestamp writer

The Worker now implements a bounded D1 archive operation for the checked-in
90-day `delivered`/`failed` notification move. It binds one invocation-time
value to `notifications_history.archived_at`, writes canonical six-digit UTC
text, and keeps the source row when a preexisting history record conflicts.
The `notifications_history.archived_at` default is therefore omitted by the
converter under the narrow `scheduled_worker_explicit_timestamp` disposition,
backed by the D1 integration test and timestamp-writer audit. The D1 timestamp
has millisecond clock resolution; PostgreSQL transaction-time microsecond
identity is not claimed. Staging has no `NOTIFICATION_ARCHIVE_BACKEND` selector,
so the archiver remains disabled there. This does not define a history purge or
resolve source production invocation. Converter v24 still reports
`deployable: false`; no user rows or remote D1/R2 state were read or changed.

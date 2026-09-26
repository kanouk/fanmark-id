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

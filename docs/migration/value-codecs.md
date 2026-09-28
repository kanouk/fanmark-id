# Exact source-text value conversion

`scripts/migration/value-conversion.mjs` supplies the scalar/array conversion
boundary for the future full importer. It does not query or import rows. The
schema generator must select a codec for every column; unsupported types fail,
even if their observed values are all SQL NULL. Nullable/enum/domain/check/FK
validation belongs to the schema/import layer and is not implied by a codec.

`convertPgText(type, value)` accepts a string or SQL NULL (`null`). Do not pass
JSON numeric fields or already-rounded JavaScript numbers. Export each scalar
as PostgreSQL text before it reaches JSON parsing, preserving exact source
precision. For example, numeric/bigint source columns use `column::text` in the
export projection. Use bound/quoted identifiers from the reviewed catalog.

| PostgreSQL source | D1 binding/output |
| --- | --- |
| `text` | Unmodified string, including empty and literal `null` |
| `uuid` | Validated lowercase UUID string |
| `boolean` | Integer 0 or 1 |
| `smallint`, `integer` | Number after exact BigInt range validation |
| `bigint` | Canonical signed 64-bit decimal text; the D1 importer binds it as text with `CAST(? AS INTEGER)` and verifies `CAST(column AS TEXT)` plus SQLite `typeof(...) = 'integer'` |
| `numeric(10,2)` | Exact integer cents; no float multiplication or rounding |
| `fanmark_lottery_entries.lottery_probability` with the reviewed positive CHECK | Exact positive plain decimal text, bounded to the shared lottery-selector maximum of 256 characters |
| other unbounded `numeric` | Exact finite plain decimal text, not REAL; remains a blocking generic schema gate |
| `timestamp with time zone` | Fixed-width UTC text with six fractional digits |
| `date` | Validated `YYYY-MM-DD` text |
| `jsonb` | Validated original JSON text; no parse/stringify round trip |
| `text[]`, `uuid[]`, `smallint[]` | JSON array text, preserving order, repetitions, null elements, and empty arrays |

Timestamps must be projected in UTC with all six digits, for example
`to_char(column AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
The preflight must separately reject BC, infinity, and years outside 1..9999;
formatting alone is not a proof of source range. The codec validates the
calendar at whole-second precision and returns the six fractional digits
untouched. Offsets or millisecond-only strings are rejected rather than guessed.

Array export uses `array_to_json(column)::text`; retain SQL NULL separately.
Before conversion, validate every source array's dimensionality and lower bound
(one dimension with lower bound 1, or empty). JSON cannot reveal a non-default
PostgreSQL lower bound. Nested arrays are rejected locally. This requirement
is not satisfied by a historical aggregate preflight alone.

JSONB validation rejects malformed JSON, nonfinite numeric interpretation,
and unsafe integer magnitudes. Decimal tokens are stored as original text,
including digits beyond JavaScript precision. This is exact storage evidence,
not proof that D1 JSON extraction/arithmetic preserves arbitrary precision.
Queries using such fields require their own explicit representation and tests.
Unbounded numeric text likewise must not be numerically compared using plain
lexical string order.

The lottery-weight codec is column-specific. It is emitted only for a
non-null `numeric` source column with the validated `positive_probability`
constraint. Snapshot verification and D1 import reject nonpositive,
noncanonical, or over-256-character text before binding it. The same shared
limit is enforced by the D1 weighted-selection engine, which parses exact
integer coefficients and never uses IEEE-754 arithmetic for the draw. The
current source preflight checked only an aggregate of this column; it did not
retain row identities or values. A changed catalog shape or a future source
value outside the supported bound fails closed.

The importer keeps bigint values as decimal text through D1 binding and
readback, so values across the signed 64-bit range do not pass through
JavaScript `Number`. The internal `fanmark_events.id` key is excluded from the
read-precision gate because Worker code does not select or return it and the
exact sequence import path is verified. Application-facing D1 reads of the two
`fanmark_discoveries` counters still use JavaScript `Number`; their call sites
must prove safe bounds or select exact text before those remaining bigint gates
can close.

Run `npm run test:migration-data`. Value tests cover numeric limits, exact
cents, positive/negative bigint boundaries, leap dates, microseconds and years
1/9999, array order/duplicates/NULLs, JSON numeric rejection, and SQL NULL versus
JSON/text null. They run alongside the Storage export tests in CI. The companion `experiments/cloudflare-d1-concurrency/test/value-codecs.test.mjs`
binds converted values into a real local D1 runtime and reads them back. It
checks INTEGER storage for cents and full-range bigint, exact decimal/JSON/array TEXT,
SQL NULL, and microsecond timestamp ordering. That package passes 9 tests
including its existing concurrency cases. Full export/import, row
reconciliation, and production schema constraints remain separate work; these
helpers alone do not establish migration parity.

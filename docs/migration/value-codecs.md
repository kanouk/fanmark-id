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
| `bigint` | Number only within JavaScript's exact safe-integer range; larger values stop import |
| `numeric(10,2)` | Exact integer cents; no float multiplication or rounding |
| unbounded `numeric` | Exact finite plain decimal text, not REAL |
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

Run `npm run test:migration-data`. Value tests cover numeric limits, exact
cents, positive/negative bigint boundaries, leap dates, microseconds and years
1/9999, array order/duplicates/NULLs, JSON numeric rejection, and SQL NULL versus
JSON/text null. They run alongside the Storage export tests in CI. The companion `experiments/cloudflare-d1-concurrency/test/value-codecs.test.mjs`
binds converted values into a real local D1 runtime and reads them back. It
checks INTEGER storage for cents/safe bigint, exact decimal/JSON/array TEXT,
SQL NULL, and microsecond timestamp ordering. That package passes 9 tests
including its existing concurrency cases. Full export/import, row
reconciliation, and production schema constraints remain separate work; these
helpers alone do not establish migration parity.

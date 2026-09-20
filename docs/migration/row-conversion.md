# Catalog-driven row conversion

`scripts/migration/row-conversion.mjs` is the row-level bridge between the
read-only PostgreSQL catalog and a later D1 importer. It generates a source
`SELECT` for one catalog table and converts the returned JSON envelope into
ordered D1 binding values. It does not connect to PostgreSQL, read source rows,
write a snapshot, or apply D1 SQL. A caller must execute the projection inside
a separately reviewed consistent source snapshot and must reconcile the source
inventory before treating any import as complete.

## Envelope contract

Every projected row has exactly these keys:

```json
{
  "schemaVersion": 1,
  "table": "fanmark_tiers",
  "columns": ["id", "payload"],
  "values": {"id": "uuid-text", "payload": "null"},
  "arrayMetadata": {}
}
```

`columns` is the catalog ordinal order. `values` has exactly one string or SQL
`null` for every column. The string `"null"` remains a string; it is distinct
from SQL `null` and from the JSON null represented by the JSONB text `"null"`.
Unknown, missing, reordered, or extra fields are rejected before bindings are
returned. Catalog `NOT NULL` columns also reject an envelope containing SQL
`null`; the source projection should never produce such a row.

Array columns have a matching entry in `arrayMetadata`:

```json
{"isNull": false, "ndims": 1, "lowerBound": 1}
```

SQL `NULL` is `{ "isNull": true, "ndims": null, "lowerBound": null }`.
An empty PostgreSQL array is `{ "isNull": false, "ndims": 0,
"lowerBound": null }`. Non-empty arrays must prove one dimension with lower
bound 1. The current reviewed array codecs are `text[]`, `uuid[]`, and
`smallint[]`; all other array types fail closed.

## Source projection

The generator quotes catalog identifiers and emits every column in ordinal
order. Scalar values use `column::text`. Timestamptz values are converted to
UTC with six fractional digits using `to_char`, and dates use `YYYY-MM-DD`.
Both expressions guard the supported PostgreSQL AD range
`0001-01-01 <= value < 10000-01-01`; BC, infinity, and out-of-range values are
returned in PostgreSQL text form so the strict value codec rejects them rather
than silently turning them into an incorrect four-digit date. PostgreSQL JSONB
text is retained as source text, and arrays use `array_to_json(column)::text`.
The independent metadata projection records SQL NULL, dimensions, and the
first lower bound so JSON cannot conceal an unsupported PostgreSQL shape.

`buildRowPlan(catalog, table, options)` returns the generated SQL and its
column/codec plan. `compileRowConverter(catalog, table, options)` validates the
catalog once and returns a reusable function for envelopes from that table;
the function also exposes its plan as `.plan`. `convertRowEnvelope(...)` is a
convenience call for one envelope and should not be used in a per-row loop when
a compiled converter can be retained.

The converter delegates scalar conversion to
[`value-conversion.mjs`](../../scripts/migration/value-conversion.mjs) and
requires the codec mapping emitted by
[`schema-convert.mjs`](../../scripts/migration/schema-convert.mjs). In
particular, only the two reviewed `numeric(10,2)` money columns may use the
integer-cents codec. A non-money fixed-scale decimal, unknown type, unknown
enum label, unsafe bigint, invalid JSON, malformed UUID, or unsupported array
shape fails closed. Bigints outside JavaScript's safe integer range remain a
blocking gate until an exact D1 binding has been proven.

## CLI and verification

The CLI only reads catalog JSON and writes a private SQL file atomically:

```sh
node scripts/migration/row-conversion.mjs \
  --catalog /private/catalog.json \
  --table fanmark_tiers \
  --sql-out /private/fanmark_tiers-row.sql
```

It rejects unsafe identifiers and an output path equal to the catalog path.
The generated SQL is preparation material and does not claim source snapshot
consistency or deployment readiness.

The focused root test covers exact ordering, all currently supported scalar,
money, decimal, enum, JSON, timestamp, date, and array representations, real
SQLite binding/readback, SQL NULL versus JSON/text null and empty arrays,
nullability, malformed/out-of-range temporal text, enum and bigint rejection,
array-dimension/lower-bound rejection, and codec/type mismatches. The
`experiments/stripe-receipts` fixture also has an isolated PGlite test. It
creates only synthetic PostgreSQL rows, executes the generated projection,
checks UTC microseconds and array metadata, and passes the resulting envelopes
through the converter, including BC, infinity, and year-10000 rejection. It
does not connect to the source database or imply source-data verification.

Run it with the repository's pinned Node runtime:

```sh
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --test scripts/migration/test-row-conversion.mjs

cd experiments/stripe-receipts
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --import tsx --test test/row-conversion.test.mjs
```

A separate read-only, repeatable-read aggregate preflight checked the current
source temporal/date and JSONB columns against the supported temporal range and
JSON numeric magnitude boundary. No failing columns were observed. This is a
point-in-time domain observation, not a frozen export, complete JSON semantic
proof, or source-to-target reconciliation. Raw results remain private.

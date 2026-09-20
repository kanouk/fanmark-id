# Lifecycle target schema extension

`scripts/migration/lifecycle-target-schema.mjs` builds the reviewed local D1
extension needed by the active-to-grace proof. It consumes the catalog and the
canonical output of `scripts/migration/schema-convert.mjs`; it does not inspect
Supabase, apply the source schema, connect to a remote database, or change a
Worker route.

The returned plan binds three separate identities:

- `sourceCatalogFingerprint` identifies the catalog fields used by the source
  converter.
- `sourceReportFingerprint` identifies the complete converter report, including
  its unresolved gates.
- `sourceFingerprint` binds those values to the generated source SQL. The
  extension's `extensionDigest` is independent and covers only the extension
  object inventory and statements.

The plan also carries the exact generated source object inventory. Applying the
plan is allowed only when the injected D1 binding already contains that source
schema. The checker compares every generated source table and index against
`sqlite_master`, and enumerates tables, indexes, views, and triggers so an
unreviewed object cannot be hidden by a partial schema. Cloudflare's provider
`_cf_METADATA` table is the only permitted extra object, and only with type
`table`.

Both inspection and application recompute the source fingerprint from its
catalog/report fingerprints and SQL, and rebuild the inventory from that SQL.
A stale or edited inventory cannot retain the original source identity. These
checks establish internal consistency, not authenticity of a caller-supplied
plan; application additionally regenerates the plan from the supplied catalog.

The inventory is ordered with tables before indexes so a local source-schema
batch can create referenced tables before their indexes. This ordering is part
of the deterministic plan; object comparisons still bind both object type and
name.

The extension adds `lifecycle_generation` and `lifecycle_claim_id` to
`fanmark_licenses`, then creates the retained
`fanmark_license_incarnations`, `fanmark_access_versions`,
`license_expiry_runs`, `license_expiry_run_items`, and
`license_expiry_effect_guards` tables. It also creates four lifecycle indexes.
The retained incarnation registry intentionally has no foreign key to the
license row, so delete/recreate handling can preserve its ABA fence. The access
version's `access_generation` remains a separate protected-access fence; it is
not copied from `lifecycle_generation`.

All lifecycle counters use SQLite integer type and safe-integer bounds. The
DDL does not use `IF NOT EXISTS`. A fresh exact source schema is extended in a
single D1 batch and read back against the exact target inventory. An identical
complete extension is a read-only `already_applied` result. A changed plan,
changed existing object, partial extension, source DDL mismatch, or unknown
table/index/view/trigger fails closed before extension writes. Inspection applies
the same exact target inventory check when it would otherwise report complete,
so column presence alone cannot produce a false complete result. SQLite's
canonical `sqlite_master.sql` form may omit a terminal semicolon or move an
ALTER-added column before table constraints; the comparator accounts for those
storage details while retaining quoted identifiers and literal bytes.

This generator is a structural target-schema prerequisite. It does not import
rows, wire the expiry job, implement generation mutators, or perform the
credential transform. In particular, the source
`fanmark_password_configs.access_password` boundary remains governed by the
credential descriptor: ordinary row import must never bind source plaintext.
The source converter's unresolved trigger, RLS, view, function, and other
semantic gates remain unresolved; this extension does not make the full
production schema deployable.

The synthetic local proof is run with the repository's pinned Node 22 runtime:

```sh
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --test workers/api/test/lifecycle-target-schema.integration.mjs
```

The test applies a source-shaped synthetic catalog in Miniflare D1, preserves
an extra source column and row, verifies the exact no-op rerun and integer
guards, and rejects mutated plan/source checks, changed objects, partial
extensions, and separate unexpected index/view/trigger objects. It is a local
fixture proof only; it does not establish production D1 compatibility,
credential integration, source-row completeness, or deployment readiness.

The parent independently ran the final two test groups on Node 22.6.0 with
no failures or skips and identical source/test hashes before and after the run.
A separate private rehearsal used the read-only catalog of all 40 source tables
to build an empty local Miniflare D1, then applied the five extension tables and
four indexes, repeated the operation as a no-op, and verified the complete
target inventory. Runtime disposal succeeded. This checked actual source
structure without reading source rows or writing to a remote database. It
identified and corrected four nullable-column assumptions in the initial
synthetic fixture; source types and nullability remain strictly validated.

# Lifecycle generation-authority schema

`scripts/migration/lifecycle-generation-schema.mjs` is the local D1 trigger
extension that follows the target objects produced by
`lifecycle-target-schema.mjs`. It consumes an already verified lifecycle target
plan and the source catalog; it does not change the existing target-schema
module, read Supabase, run a remote migration, or wire a Worker route.

The source contract for this extension is the six-column
`fanmark_password_configs` relation:

`id`, `license_id`, `access_password`, `is_enabled`, `created_at`, and
`updated_at`. The generator requires their source types, nullability, primary
key, unique `license_id`, and `ON DELETE CASCADE` foreign key to
`fanmark_licenses` to match the catalog and its converted codecs. A different
shape fails before any DDL is produced. The access-password value is not
inspected or copied by these triggers; the credential descriptor remains the
only approved source-to-destination transform boundary.

The generated plan is bound to the lifecycle target's source fingerprint and
extension digest. It contains seven exact trigger objects:

- `fanmark_licenses_lifecycle_pk_guard` rejects a changed license primary key.
- `fanmark_licenses_lifecycle_insert` initializes a missing retained
  incarnation at zero and creates a missing access-version row. Existing
  incarnation and generation values are preserved; no reset or replacement is
  allowed. The resulting access row must match the retained incarnation.
- `fanmark_licenses_lifecycle_delete` requires the retained registry and
  matching access version, deletes the access row, and increments the retained
  incarnation in the same statement transaction. The safe-integer upper bound
  is checked before incrementing.
- The four password-config triggers cover insert, same-license update,
  license reassignment, and delete. A normal password-config mutation
  increments `password_generation` and the independent `access_generation`
  exactly once. Reassigning `license_id` invalidates both the old and new
  license access rows once; keeping the same ID updates one row once. A
  cascade delete after its parent license has removed the access row is an
  allowed no-op. A direct delete or mutation with a live parent and no matching
  access version fails closed.

Every increment checks the safe-integer boundary before the update. SQLite
trigger `RAISE(ABORT, ...)` causes the outer D1 statement to roll back, so an
overflow, missing version, stale incarnation, failed primary-key guard, or
missing mutation authority cannot leave a partial generation update. The
license delete trigger runs before the parent row disappears; the password
foreign-key cascade then removes its child config and the child delete trigger
recognizes the already-removed parent/access pair. Foreign-key and cascade
ordering are exercised against the actual local D1 binding.

Applying the plan requires the complete exact source plus lifecycle target
inventory. Source tables and indexes, lifecycle tables and indexes, and all
seven trigger definitions are compared by `(type, name)` and canonical SQL.
Unknown tables, indexes, views, or triggers are rejected. An exact existing
trigger family returns `already_applied`; a changed trigger or partial family
fails before writes. The SQL has no `IF NOT EXISTS` clauses.

The local proof uses only synthetic rows and a destination-shaped test hash. It
covers initial and retained incarnations, ABA delete/recreate, existing
incarnation preservation, one-time same-value password invalidation,
old/new-license reassignment, normal and cascade deletion, missing access
version rollback, safe-integer overflow rollback, primary-key immutability,
and changed-trigger rejection. It does not claim integration with the expiry
repository, credential-transform apply, existing production writers, or
protected-access runtime. Before production connection, credential-transform
apply must remove its explicit password-generation increment and read back the
trigger-owned value; the trigger family must also be reconciled with every
other writer under the single-authority policy in
[lifecycle schema integration](lifecycle-schema-integration.md).

Run the isolated proof with the repository's pinned Node 22 runtime:

```sh
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --test workers/api/test/lifecycle-generation.integration.mjs
```

This is a local preparatory proof. It performs no deployment or external
schema change.

Parent review also bound read-only inspection to the validated lifecycle plan
and its source inventory, rejecting mismatched plan identities. The combined
target-schema and generation suites passed all four test groups on Node 22.6.0
without skips. An independent private empty-D1 rehearsal using all 40 source
table definitions applied the seven triggers, repeated application as a no-op,
and verified the exact combined inventory; runtime disposal succeeded. No
source rows or remote database were used.

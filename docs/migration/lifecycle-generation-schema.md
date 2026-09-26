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

Schema version 4 also validates the source columns needed to select and guard
protected content: the fanmark identity/status/emoji selector fields and the
license/name/access-type/redirect/message/profile fields used by the four
access configuration relations. Their PostgreSQL source types must match the
current catalog before trigger SQL is emitted.

The generated plan is bound to the lifecycle target's source fingerprint and
extension digest. Schema version 4 contains 24 exact trigger objects and emits
guards as `SELECT RAISE(...) WHERE ...` statements, which Cloudflare D1 accepts;
`CASE ... THEN RAISE(...)` is rejected by D1's SQL parser. The triggers are the
original seven license/password triggers, one fanmark selector/state trigger,
and four triggers for each of the four source access-configuration tables.

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
- `fanmarks_access_generation_update` watches `status`, `short_id`,
  `user_input_fanmark`, `normalized_emoji`, `emoji_ids`, and
  `normalized_emoji_ids`. It checks every attached license's retained
  incarnation/version and overflow boundary before advancing the access
  generation for those licenses.
- The four triggers each for `fanmark_basic_configs`,
  `fanmark_redirect_configs`, `fanmark_messageboard_configs`, and
  `fanmark_profiles` cover insert, semantic same-license update, license
  reassignment, and delete. They advance the affected license's access
  generation; no-op updates to the observed content columns do not advance it.
  The observed columns are respectively fanmark name/access type, target URL,
  message content, and published profile name, bio, social links, theme
  settings, and public flag. Deletes caused by a license cascade after the
  parent removed its version row remain allowed no-ops.

For expiry-owned cleanup, those four config trigger families recognize the
claimed `expired` license and skip per-row access-generation increments. The
grace finalizer advances `access_generation` once in its guarded transaction,
so deleting all four projections invalidates existing proofs exactly once.
Ordinary config mutations retain the trigger behavior above.

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
24 trigger definitions are compared by `(type, name)` and canonical SQL.
Cloudflare D1's `_cf_KV`, `_cf_METADATA`, and `d1_migrations` tables are
recognized as provider-owned inventory entries; other unknown tables,
indexes, views, or triggers are rejected. An exact existing trigger family
returns `already_applied`; a changed trigger or partial family fails before
writes. The SQL has no `IF NOT EXISTS` clauses.

The local proof uses only synthetic rows and a destination-shaped test hash. It
covers initial and retained incarnations, ABA delete/recreate, existing
incarnation preservation, password generation, access-content and selector
invalidation, old/new-license reassignment, normal and cascade deletion,
missing access-version rollback, safe-integer overflow rollback,
primary-key immutability, and changed-trigger rejection. The 2026-09-24
source-profile rehearsal applied these triggers alongside the refreshed 40
source tables, lifecycle extension, and credential artifact/coverage schema;
it exercised synthetic mutations of every watched access table and selector.
`test:lifecycle-schema` passed 9/9 and the full-source
`test:license-expiry-source` passed 12/12 checks on Node 22.6.0. This remains a
local schema and lifecycle proof, not verification that every production
writer has been ported or that the protected-access verifier is connected.
Before enabling protected routes, credential-transform apply must remove its
explicit password-generation increment and read back the trigger-owned value;
the trigger family must also be reconciled with every other writer under the
single-authority policy in
[lifecycle schema integration](lifecycle-schema-integration.md).

Run the isolated proof with the repository's pinned Node 22 runtime:

```sh
/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/node \
  --test workers/api/test/lifecycle-generation.integration.mjs
```

This is a local preparatory proof. It performs no deployment or external
schema change.

To repeat the full source-profile rehearsal, supply the private, mode-0600
readiness catalog outside the repository:

```sh
FANMARK_PRIVATE_SCHEMA_READINESS_CATALOG=/private/path/schema-readiness.json \
  /Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin/npm \
  --prefix workers/api run test:license-expiry-source
```

Parent review also bound read-only inspection to the validated lifecycle plan
and its source inventory, rejecting mismatched plan identities. The 2026-09-24
full-source rehearsal used only schema metadata and synthetic rows in a
disposable local D1. It made no Supabase row read and no remote database
change.

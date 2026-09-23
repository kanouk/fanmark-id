# Lifecycle schema integration plan

This document records the integration boundary between the isolated
active-to-grace proof and the catalog-converted fanmark.id schema. A new local
repository and Miniflare proof now use the source table names and reviewed
target extensions described here. That proof applies only to a small synthetic
catalog, has no production rows, and is not wired to a cron or Worker route.
The earlier reduced proof remains available as a separate focused suite.

## Implemented source-shaped local proof (2026-09-23)

`workers/api/src/license-expiry-source.mjs` now implements a local-only
active-to-grace repository against catalog-shaped `fanmark_licenses`,
`fanmarks`, `audit_logs`, `notification_events`, and
`fanmark_password_configs` tables plus the lifecycle and generation
extensions. It keeps nullable `user_id`, `is_returned`, retained license
incarnation, `lifecycle_generation`, and `access_generation` separate. The
shared `workers/api/src/protected-access-generation.mjs` builder increments
only `access_generation`; it leaves password bytes and `password_generation`
untouched. The version 2 durable run item also captures `fanmarks.short_id`
and `normalized_emoji`, which the notification event uses for `fanmark_name`,
the short-ID field, and `/f/:shortId` link.

The same local database now receives the descriptor-bound credential
transform schema after the source, lifecycle, and generation schemas. Its
independent readback verifies that all expected source and extension objects
are present together. The expiry run stores that integrated extension digest,
and the test reads it back to prove that a resumed run cannot silently switch
to a different schema profile.

The repository uses durable per-run IDs for the operation, audit, and
notification event; a single guarded batch for the license state, access
generation, source-shaped audit/event effects, run item, and claim cleanup; and
an exact readback after an uncertain acknowledgement. Eleven Miniflare checks
cover nullable-owner success, generation separation, lost-ACK recovery,
rollback and resume when audit, notification, access-version, run-item, or
guard-cleanup effects are suppressed, stale fanmark conflict, and the strict
expiry boundary. Run with
`npm --prefix workers/api run test:license-expiry-source`.

This is still a five-source-table synthetic subset rather than the complete
40-table profile or the full target importer. It does not import source rows
through the generic importer, transform credentials, implement
grace-to-expired, lottery, notification delivery, cron/Worker wiring, or
remote D1 operation. Those remain separate #34 and #37 acceptance work.

## Evidence and current mismatch

The catalog converter translates the source `public.fanmark_licenses`,
`public.audit_logs`, and `public.notification_events` tables as ordinary source
tables. The checked-in source schema has these lifecycle columns on
`fanmark_licenses`: `id`, `fanmark_id`, nullable `user_id`, `status`,
`license_end`, `grace_expires_at`, and non-null `is_returned`. It has no
lifecycle generation or claim column.

The reduced expiry fixture differs in ways that are deliberate for a local
proof and must not be copied into the integrated schema:

| Concern | Reduced proof | Catalog-converted target | Integration decision |
| --- | --- | --- | --- |
| License identity | Text test IDs | UUID source values represented as `TEXT` | Keep `fanmark_licenses.id` as the logical license row identity, and add a retained `fanmark_license_incarnations` registry. The registry, not the UUID alone, detects delete/recreate ABA. A transfer still creates a new license ID. |
| License-state CAS | `generation` | No source column | Add `lifecycle_generation INTEGER NOT NULL DEFAULT 0`, and use this name everywhere outside the old fixture. It is the per-license state fence, separate from access invalidation `access_generation`, import checkpoint `generation`, Stripe fence generations, and D1 target `target_incarnation`. |
| Protected-access CAS | Fixture `fanmark_access_versions.lifecycle_generation` | No source column | Rename the integrated target field to `access_generation`. It is a separate monotonic protected-access fence for profile/selector/visibility/config changes. Never overwrite it from the license-state generation. |
| Return flag | Fixture `is_returned` integer | Source `is_returned boolean NOT NULL` | Keep the source name `is_returned`; the converter binds it as SQLite `INTEGER` with `CHECK (is_returned IN (0, 1))`. The auth fixtures' `returned` alias is test-only and is not an integration column. |
| Claim | Fixture `lifecycle_claim_id` | No source column | Add a nullable target-only `lifecycle_claim_id TEXT`. Every lifecycle writer must compare and set it in its guarded batch. |
| Credential column | No source credential | `fanmark_password_configs.access_password TEXT NOT NULL` | Classify `access_password` before row import. Preserve the source row and target column, but bind only the descriptor-produced bcrypt hash (or reviewed disabled hash); the raw source value is never an ordinary D1 binding. |
| Run effects | Fixture `audit_logs` plus `lifecycle_outbox` | Existing `audit_logs` plus `notification_events` | Reuse the converted source tables. Do not create a second `lifecycle_outbox` table for the integrated active-to-grace path. |
| Run journal | Fixture `license_expiry_runs` and `license_expiry_run_items` | No source tables | Create the reviewed target-only objects before row import and bind their exact DDL to the importer target profile; the current exact-schema checker must be extended explicitly, never bypassed. |

`user_id` must remain nullable at the integrated boundary because the source
schema retains historical licenses after an account is deleted. The expiry
candidate adapter must either support a null owner in audit/event payloads or
make a reviewed, explicit decision to exclude such rows. It must not make the
target column `NOT NULL` merely because ordinary active rows usually have an
owner.

## Canonical lifecycle fields

The integrated target uses the following meanings:

- `fanmark_licenses.id` is the logical UUID-text license row key. It is bound
  into audits and lifecycle operations, but it is not by itself an incarnation
  proof: a restored database or an unsafe delete/recreate could otherwise
  produce an ABA with the same UUID.
- `fanmark_license_incarnations` is a retained tombstone registry keyed by
  `license_id`, without a foreign key that would delete its history. A new ID
  is seeded at `incarnation = 0`. Deleting a license increments its registry
  value in the same guarded transaction; recreating the same ID retains that
  increment. Access proofs and credential-transform artifacts bind both
  `license_id` and the registry value. Import/backfill uses `INSERT ... ON
  CONFLICT DO NOTHING` and never resets an existing value. Direct license
  insert/delete paths that bypass this registry are a migration stop condition.
- `fanmark_licenses.lifecycle_generation` starts at zero for an imported
  license and increases by exactly one for each accepted license-state
  mutation. Active-to-grace, return, extension, transfer, expiry, and any
  mutation that changes the selected license relationship must use this fence.
  It is not the importer checkpoint generation, the access-auth generation,
  Stripe fence generations, or D1 target incarnation, and must not be called
  simply `generation` in new production-facing code.
- `fanmark_licenses.is_returned` is the source return state. `0` means false
  and `1` means true in D1. Active expiry sets it to `0` while preserving
  `license_end`; a manual return sets it to `1` and changes `license_end` as
  specified by the return contract.
- `fanmark_access_versions.access_generation` is the monotonic protected
  access fence. It changes when license relationship, profile, selector,
  visibility, or other protected projection state changes. The proof compares
  this value, the independent `password_generation`, and the license
  incarnation. It is not a copy of `fanmark_licenses.lifecycle_generation`;
  a profile change may advance it without changing license state, and a
  license transition advances both values independently.
- `fanmark_access_versions.license_incarnation` must equal the retained
  registry value. A delete/recreate therefore invalidates an old proof even
  when the UUID, password bytes, and numeric generations happen to match.
- `target_incarnation` remains the identity of a recreated D1 database in the
  snapshot importer. It must never be copied into a license row or accepted as
  a license lifecycle value.

A freshly imported license starts with `lifecycle_generation = 0` and
`lifecycle_claim_id = NULL`, with source `is_returned` preserved as `0/1`.
Its retained incarnation and access-version row must exist before any dependent
credential row is imported. A newly created access-version row starts with
zero generations; inserting the credential config then advances the password
generation through its single trigger authority. Reconciliation checks that
result rather than resetting it to zero. Import retries must preserve existing
registry and generation values. A restored target with a different target
incarnation is a new import destination even for the same source UUID.

## Credential-bearing schema boundary

`public.fanmark_password_configs.access_password` is a source credential
column. It cannot be treated as an ordinary `text` value by the snapshot row
converter, and it cannot be copied into a same-named D1 column with a dummy
value: either action would make the raw credential a destination datum and
would break the credential transform contract.

Credential classification and the transform descriptor must therefore exist
before the first source row is imported. The target schema profile is explicit:

1. Retain the source-compatible `fanmark_password_configs` relation and its
   `id`, `license_id`, `is_enabled`, timestamps, and `access_password` column
   so source row identity and ordinary projections remain reconcilable. The
   destination value in `access_password` is a bcrypt hash (or a reviewed
   non-usable disabled hash), never the source plaintext and never a copied
   source sentinel.
2. Require one validated descriptor for every source password row. The normal
   converter copies the non-credential fields, omits the source value from
   ordinary scalar binding, and supplies the descriptor's transformed bcrypt
   value for the same target column. A missing, duplicate, or mismatched
   descriptor fails closed before that row is written.
3. Keep the source envelope, transform artifact, codec metadata, and binding
   digests in the restricted credential-transform channel. The public D1 row
   contains only the destination bcrypt hash and enabled state; no ordinary
   report or runtime response contains the source password or transform
   artifact hash.
4. The synthetic `fanmark_access_configs` relation in the verified-access
   fixture is not a second integrated password table. The integrated protected
   access adapter reads the transformed `fanmark_password_configs` row. Any
   future protected artifact store must be an explicitly reviewed internal
   table and cannot make the source row disappear.

The catalog-generated source DDL may describe the target relation shape, but
the row importer must use a credential-aware binding profile for this column
and bind only the transformed destination hash. Treating the raw source table
as an ordinary scalar table is an explicit migration stop condition. The
descriptor fields and transform artifact state are defined by [Credential
transform design](credential-transform-design.md); this document fixes the
ordering and the no-raw-credential boundary.

## Target-only schema extensions

The following extension family is part of the reviewed destination schema
profile and must exist before credential-bearing row import. Names are fixed
so the repository, protected access adapter, credential transform, and importer
share one protocol. Source catalog identity remains separate from the target
extension digest. The exact migrations must use quoted identifiers and verified
SQLite/D1 syntax; this SQL is structural policy, not an applied migration.

The retained registry deliberately has no foreign key to `fanmark_licenses`.
It must survive deletion of the row whose UUID it keys. A future integrated
delete/recreate primitive must insert a missing registry entry at zero, delete
the license, increment the retained entry, remove the old access-version and
proof rows, and recreate the license only with the current registry value, all
under one guarded transaction. A source import seeds missing entries only and
must never replace an existing value.

```sql
ALTER TABLE fanmark_licenses
  ADD COLUMN lifecycle_generation INTEGER NOT NULL DEFAULT 0
  CHECK (lifecycle_generation >= 0);

ALTER TABLE fanmark_licenses
  ADD COLUMN lifecycle_claim_id TEXT;

CREATE TABLE fanmark_license_incarnations (
  license_id TEXT PRIMARY KEY NOT NULL,
  incarnation INTEGER NOT NULL DEFAULT 0 CHECK (incarnation >= 0)
);

CREATE TABLE fanmark_access_versions (
  license_id TEXT PRIMARY KEY NOT NULL REFERENCES fanmark_licenses(id),
  license_incarnation INTEGER NOT NULL CHECK (license_incarnation >= 0),
  password_generation INTEGER NOT NULL DEFAULT 0
    CHECK (password_generation >= 0),
  access_generation INTEGER NOT NULL DEFAULT 0
    CHECK (access_generation >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX fanmark_licenses_lifecycle_scan
  ON fanmark_licenses(status, license_end, lifecycle_generation);

CREATE INDEX fanmark_licenses_lifecycle_claim
  ON fanmark_licenses(lifecycle_claim_id);

CREATE INDEX fanmark_license_incarnations_scan
  ON fanmark_license_incarnations(license_id, incarnation);

CREATE TABLE license_expiry_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  target_incarnation TEXT NOT NULL,
  schema_extension_digest TEXT NOT NULL,
  captured_now TEXT NOT NULL,
  grace_period_days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed')),
  last_license_id TEXT NOT NULL DEFAULT '',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE TABLE license_expiry_run_items (
  run_id TEXT NOT NULL REFERENCES license_expiry_runs(run_id),
  license_id TEXT NOT NULL REFERENCES fanmark_licenses(id),
  fanmark_id TEXT NOT NULL REFERENCES fanmarks(id),
  fanmark_short_id TEXT NOT NULL,
  fanmark_name TEXT NOT NULL,
  user_id TEXT,
  license_end TEXT NOT NULL,
  license_incarnation INTEGER NOT NULL CHECK (license_incarnation >= 0),
  license_lifecycle_generation INTEGER NOT NULL
    CHECK (license_lifecycle_generation >= 0),
  access_generation INTEGER NOT NULL CHECK (access_generation >= 0),
  operation_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  notification_event_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'processed', 'conflict')),
  grace_expires_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (run_id, license_id),
  UNIQUE (run_id, operation_id),
  UNIQUE (run_id, audit_id),
  UNIQUE (run_id, notification_event_id)
);

CREATE INDEX license_expiry_run_items_cursor
  ON license_expiry_run_items(run_id, license_id);
```

The run item stores UUID-shaped `audit_id` and `notification_event_id` values
generated once by the server core when the work item is seeded. The current
reduced proof can use deterministic text IDs; the integrated patch must use
valid UUID text because `audit_logs.id` and `notification_events.id` are source
UUIDs represented as D1 text. Retry reads these stored IDs and never generates
a second audit/event identity.

The run ledger binds each run to the target database incarnation and the exact
extension digest. It does not use the importer's checkpoint `generation`, and
it does not persist a separate `already_committed` logical outcome. An
ambiguous acknowledgement is a readback/recovery condition for the same
`processed` item; if an implementation retains an `already_committed_count`
for diagnostics, it must not be used as a second outcome or overwrite the
durable item result. Candidate, processed, and conflict counts are derived from
the bounded workset and reconciled against its items before completion.

The target-only tables are internal migration/runtime objects. They are not
part of the 40 source tables, must not receive source snapshot rows, and must
be included in the target schema fingerprint after the extension is applied.
Their definitions must be read back from `sqlite_master` before enabling the
job. The lifecycle ledger is intentionally specialized to the first
active-to-grace implementation; later return, extension, transfer, and
grace-expiry work must either use these same claim/version columns or introduce
a reviewed successor without running two claim protocols concurrently.

## Existing audit and outbox mapping

The synthetic `audit_logs` and `lifecycle_outbox` shapes cannot be inserted into
the converted source tables directly. The real batch maps them as follows:

| Effect | Existing target table and fields | Binding rule |
| --- | --- | --- |
| Lifecycle audit | `audit_logs.id`, `user_id`, `action`, `resource_type`, `resource_id`, `request_id`, `metadata`, `created_at` | `id` is the run item's stored `audit_id`; `action = 'license_grace_started'`; `resource_type = 'fanmark_license'`; `resource_id = license_id`; `request_id = operation_id`; `metadata` is JSON text containing schema version, run ID, license/fanmark IDs, license incarnation, license lifecycle generation, access generation, captured time, end, grace deadline, and authoritative short ID; `created_at = captured_now`. `user_id` remains nullable. |
| Notification outbox | `notification_events.id`, `event_type`, `event_version`, `source`, `payload`, `payload_schema`, `trigger_at`, `dedupe_key`, `status`, `retry_count`, `created_at`, `updated_at` | `id` is the run item's stored `notification_event_id`; `event_type = 'license_grace_started'`; `event_version = 1`; `source = 'cron_job'`; `payload_schema` is a fixed v1 identifier; `payload` contains the same bounded event data plus `user_id`, license incarnation, both generations, and authoritative short ID; `trigger_at`, `created_at`, and `updated_at` use `captured_now`; `status = 'pending'`, `retry_count = 0`; `dedupe_key = license_grace_started:<license_id>:<license_incarnation>:<next_license_lifecycle_generation>`. |

The existing unique `(event_type, dedupe_key)` constraint is the outbox
dedupe boundary. Delivery changes `status`, retry, and delivery fields only; it
never repeats the license transition. The active-to-grace transaction must not
call the old `create_notification_event` RPC because a separate request would
break the D1 atomic boundary. Existing historical notification rows are
retained; the new target dedupe key is generation-based so microsecond or
millisecond conversion cannot create a collision.

The event and audit payloads must read `fanmarks.short_id` and other display
fields from the authoritative joined row inside the batch. They must not copy a
stale short ID or invent a fallback from an emoji. A null owner is retained in
the audit/event JSON; any user-specific delivery decision is a later outbox
consumer concern.

## API and protected-access boundary

The current Worker repositories already define the application-facing meaning
of the source columns. `availability-d1-repository` treats an active license as
blocking through `license_end` and a grace license as blocking through
`COALESCE(grace_expires_at, license_end)`. `public-access-d1-repository`
requires an active license, `is_returned = 0`, and an unexpired end for public
access/profile projections. The lifecycle extension must preserve those
queries' source names and UTC boundary semantics; it must not expose either
generation or incarnation through the public API.

The protected-access adapter needs one reviewed integration change: read the
transformed bcrypt value from the canonical
`fanmark_password_configs.access_password` row, join
`fanmark_access_versions`, and bind target identity, license incarnation,
`access_generation`, and `password_generation` into its proof lookup. The
synthetic proof's `fanmark_access_configs`, `returned`, `expires_at`, and
`lifecycle_generation` names are fixture aliases, not additional application
tables or columns. Public projection queries continue to return only their
existing booleans and display fields, and the recent/availability API remains
read-only with respect to the lifecycle ledger. No Worker route or current
frontend adapter is changed by this design document.

The credential-transform artifact should consequently call its integrated
fence field `expected_access_generation`; the current fixture's
`expected_lifecycle_generation` is a compatibility name to be removed or
translated at the integration boundary. Applying a prepared hash must compare
both expected generations and the retained incarnation, then let the canonical
password-config/access-generation authorities produce the new values. It must
not increment a generation merely because an artifact is retried.

## Required active-to-grace integration patch

After the extension exists, the reduced repository must be adapted in one
reviewed patch:

1. Rename fixture-facing `generation` references to
   `license_lifecycle_generation`, make the run item owner nullable, and
   replace the synthetic outbox table with the existing notification-event
   shape. Add the retained license incarnation and expected
   `access_generation` to the work item; never use one generation column for
   both fences.
2. Seed the run item with the expected license/fanmark/owner/end values,
   license incarnation, both expected generations, and server-generated UUID
   audit/event IDs. Bind the run ID to one canonical UTC microsecond
   `captured_now` and the parsed grace setting as the current proof already
   does.
3. Use one D1 batch whose first statement compares license ID, fanmark ID,
   owner (including SQL NULL semantics), the retained license incarnation,
   status, license lifecycle generation, expected access generation,
   `license_end`, empty claim, strict end-time boundary, and active fanmark.
   The state update sets `status = 'grace'`, the rounded deadline,
   `is_returned = 0`, `lifecycle_claim_id`, and license generation `old + 1`;
   it does not clear `excluded_at` or `excluded_from_plan` unless a reviewed
   product rule adds that behavior.
4. In that same batch invoke the single access-generation mutator exactly
   once for the claimed license, so `access_generation` becomes its expected
   value plus one. The batch then inserts the mapped audit row, inserts the
   pending notification event, marks the run item `processed`, and clears the
   claim. The access row must retain the independent password generation and
   current license incarnation; it must never be assigned the license-state
   generation. Every dependent statement must select from the claimed current
   license and require the same operation.

   The access update, audit insert, outbox insert, and processed-item update
   each need an operation-bound, CHECK-backed effect guard in the same batch.
   A guard must evaluate against the claimed post-transition row and fail the
   batch when any required effect has zero rows or the wrong operation,
   generation, incarnation, payload, or dedupe key. The guard is deleted only
   after all required effects are present. Thus a missing access row, audit,
   outbox, or run-item effect rolls back the license transition before the
   caller sees a result; a JavaScript count after `batch()` is recovery
   evidence, not the atomicity mechanism. A zero-row claim or effect is a
   conflict, never a successful transition.
5. On an uncertain acknowledgement, read back the current license, run item,
   audit row, notification event, dedupe key, payload, both generations,
   incarnation, and access version. Accept only the exact stored operation;
   another runner's equivalent state is not this operation's acknowledgement.
   Keep `processed` as the logical item outcome.
6. Keep the bounded keyset cursor and durable workset. A crash after the state
   batch and before cursor progress must resume the processed item and advance
   counts once. A concurrent runner must not rewrite a processed item as a
   second outcome. The run is completed only after no pending work item
   remains and its counts reconcile to durable item outcomes.

The real patch must not add a new public HTTP endpoint or make the current
`workers/api/src/index.ts` choose this repository. It should first run as an
explicit local integration entrypoint against the complete schema-shaped D1
fixture. Cron wiring and production environment changes are later work.

## Generation authority and protected access

The integrated target has three different fences. They must not be collapsed
because the auth proof and the license CAS happen to use the word
"generation":

- The lifecycle repository is the sole authority for
  `fanmark_licenses.lifecycle_generation`. Its guarded state update advances
  this license-state fence once. No trigger or second direct increment may run
  for that same license mutation.
- The shared protected-access mutation layer is the sole authority for
  `fanmark_access_versions.access_generation`. For this integration it is
  invoked by the expiry repository inside the same guarded batch and advances
  the value once from the recorded expected value. The integrated target must
  remove or replace the synthetic auth fixture's direct lifecycle-version
  trigger for `fanmark_licenses`; composing that trigger with the repository
  update would double-increment. Profile, selector, visibility, transfer, and
  other protected-projection writers must use the same layer. They advance
  `access_generation` without changing license state generation. The layer
  always increments, never assigns the license-state generation, so an older
  value cannot be restored by a later write.
- The canonical password-config mutation trigger is the sole authority for
  `password_generation`. It must be adapted to the transformed
  `fanmark_password_configs` row. Credential-transform apply must remove its
  explicit `password_generation = password_generation + 1` statement and read
  back the trigger result. If the same password mutation affects the
  protected projection, the shared access-generation layer must also run once;
  the two columns remain independent and neither update may be duplicated.
- The incarnation registry transaction is the sole authority for the retained
  license incarnation. It is never reset by import, license insert, or a
  credential transform.

Every direct writer, Better Auth adapter path, credential transform, return,
extension, transfer, expiry, profile visibility, and password-config change
must be assigned to these authorities before cutover. A writer with no
authority, or a writer that mixes a repository increment with a trigger for
the same column and event, is a migration stop condition.

The existing source and auth proof use `is_returned` and `returned` in
different synthetic fixtures. Only `is_returned` is valid for the converted
fanmark license table. A protected proof binds the target identity, license
incarnation, `access_generation`, and `password_generation`; active-to-grace
invalidates the old access generation but must not mutate password bytes or
password generation.

## Ordering with the converter and importer

The catalog generator remains the source-schema authority. Its output is
composed with a versioned, reviewed target extension rather than silently
changing the source catalog. The integrated order is:

1. Verify the immutable source snapshot and credential descriptor. Keep the
   source catalog/envelope fingerprints distinct from destination metadata.
2. Generate source-shaped DDL and the target extension, including the retained
   incarnation registry, access versions, credential artifact/coverage ledger,
   generation triggers, and lifecycle journal. Bind every object's exact DDL
   and extension version to the target profile and import run.
3. Create and read back this complete schema on an empty local D1. Extend the
   importer's schema validator to require the exact reviewed objects and their
   definitions; an unrestricted name-prefix exception is forbidden. The
   current generic importer cannot perform this integrated phase yet.
4. Import parent-first. A license insertion initializes a missing registry and
   access-version row before its credential rows. Retained registry values and
   newer generations are never reset by replay. Credential preparation binds
   the actual destination incarnation and versions.
5. Import each credential-bearing row through its descriptor. Non-credential
   fields, prepared hash, coverage, resulting trigger-owned password generation,
   and checkpoint commit in one guarded batch. No raw credential is bound.
6. Reconcile all source row identities and ordinary values, transformed values,
   coverage, target schema/extension identity, and expected version changes.
   Deferred or rejected credentials prevent complete reconciliation; no later
   backfill may erase the versions established during import.
7. Exercise active-to-grace against the full target profile, then protected
   access invalidation, concurrent lifecycle operations, and notification
   readback. Remote execution still requires the reviewed source freeze/drain
   and single-writer boundary.

These phases require descriptor integration and a target-profile-aware schema
checker. Removing the current credential guard or ignoring schema differences
is not an implementation of this plan.

## Acceptance conditions and remaining gates

The integration patch is ready for parent review only when a local D1 run proves
all of the following against the catalog-shaped tables:

- source UUID IDs and nullable owner history survive conversion;
- `is_returned` is the only license return column and remains integer `0/1`;
- a new license starts with registry incarnation zero, a delete/recreate keeps a
  higher retained incarnation, and an old proof cannot cross that boundary;
- initial license-state and access generations are zero, a successful
  active-to-grace transition increments each appropriate fence exactly once,
  and a profile/visibility mutation advances only access generation;
- audit and notification rows use the existing schemas, valid UUID IDs, one
  operation/request binding, an incarnation-and-state-generation dedupe key,
  and no duplicate effects after retry or lost acknowledgement;
- protected access reads reject the old access generation after grace starts,
  while password generation and protected bcrypt bytes remain unchanged;
- no D1 row contains a source plaintext credential, every source credential is
  covered by one transform descriptor, and a transform retry increments
  password generation once through its configured authority;
- deleting an audit, outbox, access-version, or run-item effect during a
  synthetic batch causes the CHECK-backed guard to roll back the license state
  and all effects together;
- progress crash/restart, same-run concurrency, different-run concurrency,
  stale owner/end/generation, null owner, inactive fanmark, exact boundary,
  and page-boundary cases are covered; and
- independent readback confirms claims are cleared, run items are complete,
  outbox state is pending for delivery, and the source schema/import report
  remains bound to the target extension digest.

This still does not prove grace-to-expired/lottery, notification delivery,
source/Auth/Storage consistency, remote D1 limits, cron scheduling, or
production cutover. Those remain separate gates with their own read-only or
synthetic evidence.

## References

- [Schema conversion boundary](schema-conversion.md)
- [Full schema conversion generator](schema-generator.md)
- [Catalog-driven row conversion](row-conversion.md)
- [Local D1 importer](d1-import.md)
- [Verified public access design](verified-access-design.md)
- [Credential transform design](credential-transform-design.md)
- [License expiry design](license-expiry-design.md)
- [Local active-to-grace proof](license-expiry-proof.md)
- [`fanmark_licenses` and lifecycle source schema](../../supabase/remote_schema.sql)

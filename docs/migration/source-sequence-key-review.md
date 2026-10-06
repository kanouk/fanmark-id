# Source sequence-key equality review

The reviewed ordinary immutable/strict `seq_key(uuid[])` definition hash is
`fbe91b15cd36716684ec05918433dc0c0606962b5c5396bfbba4c994415dba09`.
It hashes `array_to_string(ids, ',')` as MD5 and casts the hash to UUID.
The actual helper's IF checks `ids IS NULL OR array_length(ids, 1) = 0`.
These semantics differ from arbitrary JSON-array equality.

`scripts/migration/source-sequence-key-oracle.sql` evaluates literal expressions
only in a read-only PostgreSQL transaction. It selects no application/Auth rows
and invokes no stored application function/trigger. Observation
`2026-10-02T23:43:00.787582+00:00` produced seven synthetic cases, recorded in
`scripts/migration/fixtures/source-sequence-key.json`. SQL SHA-256:
`b71a4dd0baba6ee9e15a047ac9b55f831b7403ddeba3ca60ef60cbe43e62de67`.
This proves the PostgreSQL expressions used in the reviewed helper, not direct
execution of that helper or any actual-row invariant.

| Input relationship | Source result |
| --- | --- |
| UUID case changes | Same canonical UUID text and key |
| Ordered IDs versus reversed IDs | Different keys |
| `[A, NULL, B]` versus `[A, B]` | Same key; NULL elements are omitted by array_to_string |
| Empty array versus `[NULL]` | Same MD5-empty-string UUID |
| Empty array guard | array_length(empty, 1) is NULL; the IF condition is NULL/false, so it does not raise |
| SQL NULL array | STRICT skips the body and returns NULL |

The importer rejects empty and NULL-containing normalized identity arrays.
That is a target import policy; it is not an invariant enforced by the source
helper. Current validated product writers use non-empty NULL-free sequences,
but their behavior and the later historical-row disposition must be reviewed
separately. Do not silently remove NULLs or rewrite imported identity arrays.
MD5 collision behavior, array dimensions/lower bounds and arbitrary external
callers also remain separate concerns.

The schema converter continues emitting the canonical JSON index as a staging
candidate, and now retains `seq_key_input_contract_requires_review` for each
UUID-array expression index. This prevents syntactically valid DDL from implying
whole-source equality. The private full source catalog records three affected
indexes: fanmarks_seq_key_idx, fanmark_discoveries_seq_key_idx and the compound
fanmark_favorites_user_seq_idx. No deployed
schema/index was altered. Converter42/42 includes a regression demonstrating
that the candidate SQLite index accepts all four arrays from two source-key
equivalence classes, and therefore cannot be marked deployable from that DDL.
Actual source rows remain unread; their migration is deferred by user scope.

## Current application and import disposition (2026-10-03 JST)

The three source indexes above are valid, unique, non-primary indexes in the
unchanged catalog. Business0000 indexes the JSON identity column and retains
the favorites user_id prefix. Current counterparts:

| Table | Current writer | Admitted identity domain |
| --- | --- | --- |
| fanmarks | fanmark-registration-d1-api.ts insert and unlicensed-row reacquisition | Lowercased UUIDs resolved against active Master, then ordered JSON.stringify; repeats remain repeated. |
| fanmark_discoveries | discovery-mutations.ts via search/favorites APIs | Both callers validate non-empty 1–5-ID lists and lowercase UUIDs; the shared upsert uses the same serialized key. |
| fanmark_favorites | discovery-mutations.ts via authenticated favorites API | The same key plus actual session owner; registration linkage preserves every owner's favorite display/time. |
| All three imports | row-conversion.mjs / value-conversion.mjs | Canonical UUID case, preserved order/repeats; reject empty/NULL-element identities and unsupported dimensions/lower bounds before writing. Historical lengths are not rewritten to the UI maximum five. |

For this admitted domain, canonical ordered JSON implements the intended
sequence identity. The target deliberately does not reproduce MD5 collisions.
The0022 linkage trigger separately tolerates case/formatting/NULL omission,
refuses ambiguous matches, and does not make NULL arrays importable. This
review covers current validated application writers, not arbitrary console
writes, all PostgreSQL arrays or external RPC consumers.

The final user-data stage must check the three source identity columns for
empty/NULL-containing arrays, unsupported shapes/lower bounds, canonical
duplicates and conflicts with the additional target normalized-emoji identity.
If found, record an explicit disposition before import. Do not drop NULLs,
merge favorites, regenerate UUIDs or silently skip rejected rows. External
consumers depending on source MD5-key behavior need their own decision.
No source user row was read for this review.

Existing value/row/converter tests pass57/57, including all three tables'
NULL/empty rejection and the converter's deliberately retained mismatch gate.
[Registration](fanmark-registration-api.md) passes26/26 locally, including5
new full-schema/real-session cases. The generic converter gate and
deployable=false remain; this does not waive historical import prerequisites.

## Deferred import identity preflight (2026-10-06 JST)

`scripts/migration/identity-readiness.sql` now makes the later data gate
executable. It is a read-only aggregate check for fanmarks, discoveries,
favorites and events. The fourth table has the same strict array importer even
though it has no sequence-identity unique index. The check reports only counts
of NULL/empty/NULL-element arrays, unsupported dimensions/lower bounds,
canonical duplicates for the three unique identities, and duplicate
fanmarks.normalized_emoji values required by the additional target constraint.
Favorite duplicate groups include the source owner; identical identities for
different owners are preserved. Event repetition is never classified as a
uniqueness conflict. Categories select the first shape blocker for each row.

Both positive8-row and blocked16-row literal fixtures ran on PostgreSQL using
the exact same classifier/aggregation SQL. No source table or stored application
function was read/invoked: the oracle generator replaced only the source CTE
with typed synthetic VALUES, refused remaining public-schema references and
required BEGIN READ ONLY. Repetitions, reversed order and historical six-ID
sequences are admitted; invalid shape, same-owner canonical identity duplicates
and display conflicts stop import. The existing importer tests now explicitly
confirm NULL/lower-bound/dimension rejection and preserved repetition/order/
length on all four tables. Focused oracle/importer13 tests pass.
[Literal observations and SQL hashes](../../scripts/migration/fixtures/identity-readiness-oracle-2026-10-06.json).

Reproduce only synthetic proof before the user-data stage:

```sh
node scripts/migration/identity-readiness-oracle.mjs --scenario valid > "$TASK_PRIVATE_VALID_SQL"
node scripts/migration/identity-readiness-oracle.mjs --scenario blocked > "$TASK_PRIVATE_BLOCKED_SQL"
CI=1 npx --yes supabase@2.118.0 db query --linked --file "$TASK_PRIVATE_VALID_SQL" --workdir "$TASK_PRIVATE_LINK_DIRECTORY" --output-format json --yes > "$TASK_PRIVATE_VALID_RESULT"
CI=1 npx --yes supabase@2.118.0 db query --linked --file "$TASK_PRIVATE_BLOCKED_SQL" --workdir "$TASK_PRIVATE_LINK_DIRECTORY" --output-format json --yes > "$TASK_PRIVATE_BLOCKED_RESULT"
node --test scripts/migration/test-identity-readiness.mjs scripts/migration/test-row-conversion.mjs
```

Use a verified project link, umask077 and a0700 private directory. CI pins the
observations to the current query/oracle SQL hashes; changed SQL requires fresh
literal observations. The real-table identity-readiness.sql is prepared for
the final user-data stage and has not been executed. A true identity result
would cover only these checks, not row parity, Auth/role mapping, foreign keys,
image references, generic converter acceptance or external consumers. No
identity is trimmed/repaired/merged or skipped. The generic converter's four
blocking groups remain; source functions/RLS/triggers need their separate
Worker correspondence.

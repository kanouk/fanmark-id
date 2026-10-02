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

# Favorites API migration preparation

The local Worker implementation moves the signed-in user's favorite list and
favorite add/remove operations behind `GET/POST/DELETE /api/me/favorites`.
`src/lib/favorites-api.ts` keeps Supabase as the default and selects the Worker
only when `VITE_FAVORITES_BACKEND=worker`; Worker-side D1 operations separately
require `FAVORITES_BACKEND=d1`. Errors never switch the request to another
backend. The list response is capped at 500 rows and 1 MiB; larger accounts fail
closed rather than returning a partial list.

The list DTO is schema version 2. PostgreSQL `bigint` discovery counters are
returned as canonical nonnegative decimal strings, and the Worker reads them
with `CAST(... AS TEXT)` so D1 never exposes them as imprecise JavaScript
numbers. The browser validates the signed 64-bit upper bound and retains the
strings; the existing UI does not perform arithmetic on these aggregate
counters. The Supabase default adapter normalizes safe integer responses to
the same string form and rejects unsafe numeric responses that may already
have lost precision during JSON parsing.

The Worker derives ownership only from the Better Auth session. Writes require
an allowed `Origin`, JSON input is bounded, responses are `no-store`, and the
browser checks that the favorites API and Better Auth use the same origin. The
request cannot supply a user ID.

## Protected content boundary

For an enabled password configuration, the list query projects `fanmark_name`,
`target_url`, and `text_content` as SQL NULL before they reach the Worker response.
The stored configurations are unchanged. Emoji spelling, public identity,
owner display metadata, lifecycle information and `is_password_protected`
remain available. An authenticated favorite owner, including the license owner,
does not receive protected content through this list; proof cookies also do not
unlock it. Protected reads use the dedicated [verified access routes](verified-access-design.md).
The separate owner configuration API retains its existing owner checks.

These nullable fields fit DTO schema version 2. The Worker browser parser rejects
any protected row containing a non-NULL name, target or text, and does not fall
back to Supabase. Disabled or absent password configurations retain the existing
unprotected DTO. The default Supabase adapter and production RPC are unchanged.

The fresh source `get_favorite_fanmarks` body selects those three fields without
redaction. Replicating that response would contradict the existing verified-access
decision that login does not bypass fanmark password verification. The target
therefore intentionally corrects that authorization behavior; this is not a
claim of byte-for-byte source RPC parity or a change to source production.

## Source authorization review and local regression evidence

The 2026-10-02T21:03:48.240925+00:00 catalog-only readback includes these ordinary
functions. Their bodies were reviewed privately without invoking a real user's
RPC or reading source business rows. Body hashes retain the evidence identity:

| Function | Definition SHA-256 |
| --- | --- |
| `add_fanmark_favorite` | `c1390f691aed08442425db34ac96f5c0cb84b5f7934a62cb7ea58e30867fa83d` |
| `remove_fanmark_favorite` | `9b401a970606f6c465a44386179e39de7bf219f112f57518cc15249bbf5e6167` |
| `get_favorite_fanmarks` | `bace00baac2634b29e8d5fecfb1bc9aa423cd5535213b13b3c28d7a6d39864ac` |
| `record_fanmark_search` | `57b6480d94b5164498c0bd2e0c53d27044c20f12000684ecb0e89acd30d1880e` |
| `upsert_fanmark_discovery` | `c836771937eb89d7e276e2c60cd64eab354ea5544e107e4b618aeedf0ad0dfa0` |
| `search_fanmarks_with_lottery` | `5f7ca109288d480b48905257b99a21d1e8c77083f7f270454250adc8e8dc9f89` |
| `toggle_fanmark_favorite` | `cc0841079ff9240e299c40c2bc8b459a1ca7799c5b298f907696a108fc66b28f` |

Source add/remove use `auth.uid()` for ownership, preserve ordered normalized
identity, and handle duplicate/count/event effects. The list restricts saved
rows to the caller, but this alone does not authorize fanmark content. Discovery
upsert is an internal helper; the target does not add a generic public upsert
route. Anonymous target search aggregation and attribution remain the documented
target contract. Lottery search lifecycle/body parity and possible external
callers of the legacy fanmark-ID toggle remain open.

The discovery public SELECT policy has expression hash
`d1405b66718869464a5e5521d9d8c222b03178347ff0dbd20d0af91b93b09cec`;
the favorites owner ALL policy has USING/CHECK expression hash
`1d781dd5da6b201e0975fc6fc619b176fed320ab5f968754dedbaffc7be33028`.
Full RLS/ACL reconciliation remains open; see [source authorization review](source-authorization-review.md).

The corrected native D1 reproduction returned protected name/URL/text before
the fix. The first attempt failed because a test fixture constant was missing;
that helper error is not evidence of the application bug. After repair, native
favorites pass 11/11 and client contracts 6/6. Redirect and text cases cover both
the license owner and another user, a proof-looking cookie, an active perpetual
license, and unchanged stored configurations. Disabled/absent protection retains
ordinary responses. Application/Worker typechecks, changed-file lint, normal
staging build, pinned Wrangler dry-run, workflow isolation, and eight offline
profile-editor browser cases pass. Native favorites now run in normal Worker CI.
Remote acceptance is pending D1 quota recovery and the new exact-head CI.

## Identity and transactional mutations

Emoji IDs are resolved against the active, versioned Master D1 release. The
Worker removes the five skin-tone code points and resolves each resulting
codepoint sequence back to its canonical release ID while preserving order
and duplicates. Missing or ambiguous mappings fail closed. Add, duplicate
add, remove, favorite-count reconciliation, and event insertion run in one D1
batch. `discovery-mutations.ts` fences the captured discovery and owner favorite,
then checks the complete expected row state and exact inserted event before
commit. Suppressed or changed required writes abort the whole batch. Duplicate
add preserves the existing favorite spelling/time and does not create an event
or increment counts; remove decrements with a zero floor. Confirmed SQLite
rollback caused by a changed preflight state can retry twice; unknown commit
acknowledgments are never retried internally. Integer arithmetic explicitly
casts bound deltas to INTEGER, retaining exact signed 64-bit counter values.

The schema converter now has a narrow `seq_key(uuid[])` translation to a
unique index over the target's canonical JSON array text. This supports the
discovery/favorite uniqueness keys; the row importer rejects empty or
NULL-containing normalized ID arrays for all four source tables that use them.
The latest private report was regenerated after this change: the UUID-array
indexes are included in the 66 emitted indexes, while other expression indexes
remain gated. D1 event-ID sequence state and the full source-operation
inventory remain part of the broader schema and user-data rehearsal; this
route is not deployable while those gates remain open.

Verification uses only synthetic accounts, emoji release rows, and business
rows:

```sh
npm run test:favorites-api
npm run --prefix workers/api test:favorites-d1
```

These local tests do not establish production Auth/RLS parity or prove a full
business-data import. The source-shaped application schema is now applied to
the isolated business staging D1. `FAVORITES_BACKEND=d1` and
`VITE_FAVORITES_BACKEND=worker` are enabled on the workers.dev app only. A live
synthetic account completed add/list/remove against the separate Master D1 and
business D1; the favorite, event, and newly-created discovery rows were
removed and composite readback returned zero. No historical favorite rows
were imported. Production and domain/DNS migration remain deferred.


## Search/favorite transaction repair — 2026-10-03 JST

The native suite now applies all 25 canonical Business migrations instead of a
reduced fixture. Four faults reproduced committed partial effects: ignored
favorite event/count and removal event returned200; ignored search event
returned503 after committing its discovery count/spelling/time. The shared
transaction guard repairs those cases. Failed operations preserve discoveries,
favorites, events and SQLite sequence exactly; removal of each synthetic fault
permits retry200. These are regression cases for a reproduced bug, not a new
whole-database fault acceptance requirement.

Native17/17 includes the existing concurrent duplicate add (true/false), other
owner preservation, protected projections, new discovery timestamps, exact
9007199254740993+ arithmetic and int64-overflow rollback. Client12/12 covers
favorites/search contracts. The schema converter's three sequence-key index
gates remain open: these canonical product writes do not prove historical
NULL/empty-array or arbitrary external-writer parity. The source bodies and
policy hashes above are unchanged. CI and deployed acceptance of this new
candidate are recorded below; the deployed account/other scopes retain their
own evidence and are not reclassified by these tests.

bce8993/CI37094750732 passed both jobs and deployed Workerc09ece05 at100% on
2026-10-03T04:05:27Z. Four actual staging HTTP cases verify ignored add event,
favorite-count update, search event and remove event:503/no-store with exact
row/sequence rollback, then200 retry, control-owner favorite preservation and
duplicate add/remove=false without another event/count change. The two synthetic
Auth users, four discoveries and related favorites/events/profiles/trigger were
removed; journal discovery-repair-KeQ2x4 ends verified-and-cleaned, both-store
FK0, triggers restored and cookie invalidated. Successful event IDs legitimately
advance; cleanup does not reset them. Independent04:07:49.929Z readback verifies
owned Business/Auth0, retained Master inventory, MFA236/wake17:17 and secret
names. Static bytes match; real providers/email/signup remain closed. This is
the four reproduced-failure scope, not all source/index/caller/provider or phone
acceptance; int64 boundaries are local only. See HANDOFF/COMPLETION for remaining
requirements. Private proof:/tmp/fanmark-discovery-bce8993-staging-acceptance.json.

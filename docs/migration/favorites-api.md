# Favorites API migration preparation

The local Worker implementation moves the signed-in user's favorite list and
favorite add/remove operations behind `GET/POST/DELETE /api/me/favorites`.
`src/lib/favorites-api.ts` keeps Supabase as the default and selects the Worker
only when `VITE_FAVORITES_BACKEND=worker`; Worker-side D1 operations separately
require `FAVORITES_BACKEND=d1`. Errors never switch the request to another
backend. The list response is capped at 500 rows and 1 MiB; larger accounts fail
closed rather than returning a partial list.

The Worker derives ownership only from the Better Auth session. Writes require
an allowed `Origin`, JSON input is bounded, responses are `no-store`, and the
browser checks that the favorites API and Better Auth use the same origin. The
request cannot supply a user ID.

Emoji IDs are resolved against the active, versioned Master D1 release. The
Worker removes the five skin-tone code points and resolves each resulting
codepoint sequence back to its canonical release ID while preserving order
and duplicates. Missing or ambiguous mappings fail closed. Add, duplicate
add, remove, favorite-count reconciliation, and event insertion run in one D1
batch. `changes()` guards ensure duplicate requests do not create extra events
or increment counts; a new favorite increments by one and removal decrements by
one with a zero floor, matching the source RPC.

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

# Fanmark details Worker API

`/f/:shortId` whois details use an explicit staged selector:
`VITE_FANMARK_DETAILS_BACKEND=worker` selects the Worker; an unset selector
continues to use the existing Supabase RPC. A selected Worker failure does not
fall back to Supabase. The staging Worker requires
`FANMARK_DETAILS_BACKEND=d1`, Better Auth, and the business `FANMARK_DB`.

The client calls `POST /api/fanmarks/details` with exactly
`{"shortId":"rose-owned"}`. Requests are same-origin credentialed, bounded,
and returned with `Cache-Control: no-store`. The anonymous query requires an
active fanmark and follows the documented short-ID selection rule for its
latest active license. Short IDs accept up to 256 UTF-8 bytes and reject
control characters and path separators, matching the public short-ID bound.

Anonymous queries select only the public fanmark fields and current active
license fields required by the existing whois view. They return no owner names,
ownership history, favorite state, or lottery state. The page labels history as
login-only rather than suggesting that no history exists.

Authenticated queries resolve identity from the Better Auth session cookie.
They return a maximum of 100 history rows, display names/usernames from
`user_settings`, and only the caller's derived owner/favorite/lottery booleans.
The response never includes user IDs, account emails, roles, password metadata,
license IDs, protected content, or access configuration. A caller-supplied user
ID is not accepted. Rows over the history bound fail closed rather than returning
a misleading partial history.

The frontend validates an exact versioned DTO and a response size limit. The
staging selector, anonymous/authenticated field boundary, ordering, and
synthetic D1 fixture are covered by `npm run test:fanmark-details-api` and
`npm --prefix workers/api run test:fanmark-details-d1`.

This implementation does not migrate users or production fanmark rows, modify
the Supabase RPC, deploy a production Worker, or change DNS. Staging activation
does not by itself prove browser acceptance, parity against non-empty imported
rows, or production readiness.

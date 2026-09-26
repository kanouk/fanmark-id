# Fanmark search details Worker API

This read-only slice moves the `get_fanmark_complete_data` lookup used by
`useFanmarkSearch` to business D1 when the staging frontend explicitly selects
`VITE_FANMARK_SEARCH_BACKEND=worker`. Supabase remains the default in regular
builds. A selected Worker failure is returned to the caller and never retries
the Supabase RPC.

## Contract

```text
POST /api/fanmarks/search/details
Content-Type: application/json
{ "fanmarkId": "<UUID>" }
```

The Worker reads the fanmark, its latest license under the source RPC ordering,
and pending lottery entries from one business D1 binding. A Better Auth session
resolves the current user ID on the server; the request body cannot choose a
user. Anonymous reads return public fanmark fields and a false/null user-entry
projection. Responses are versioned, bounded, `Cache-Control: no-store`, and
allowlisted to the fields consumed by the search screen. Redirect URLs,
message content, password configuration, and other fanmark settings are never
selected or returned.

`has_active_license`, `is_blocked_for_registration`, and `next_available_at`
follow the source RPC's active/grace rules at the Worker request time. The
lottery count includes pending entries only; the current user's pending entry
is resolved from the Better Auth identity. Cross-origin requests require an
exact configured origin and include credentials for the same-origin staging
session.

The search hook preserves fresh Supabase identity lookup in Supabase builds. In
Cloudflare mode it reads the current Better Auth user from app auth state and
fetches the session during the initial auth-context load, so owner status is
not inferred from a Supabase session that does not exist in that mode.

The search history write `record_fanmark_search` remains on Supabase. It is
user-derived data and belongs to the deferred user-data migration stage; moving
the read projection does not imply that write or its records have migrated.

## Verification and deployment boundary

The frontend contract tests validate explicit selection, the narrow DTO, URL
and auth-origin checks, cookie inclusion, and no fallback after Worker failure.
The Worker contract tests validate user ID binding, anonymous behavior, pending
entry projection, protected-field omission, origin/method/input rejection, and
fail-closed auth/configuration behavior. These synthetic tests do not establish
that historical fanmark/license/lottery rows have been imported or that
search-history writes have moved.

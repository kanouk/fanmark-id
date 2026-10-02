# Fanmark search Worker APIs

This slice moves the `get_fanmark_complete_data` lookup and anonymous search
aggregate write used by `useFanmarkSearch` to business D1 when the staging
frontend explicitly selects `VITE_FANMARK_SEARCH_BACKEND=worker`. Supabase
remains the default in regular builds. A selected Worker failure is returned
to the caller and never retries the Supabase RPC.

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

## Anonymous search aggregate write

```text
POST /api/fanmarks/search/record
Content-Type: application/json
{ "input_emoji_ids": ["<UUID>", ...] }
```

The D1 route accepts one to five IDs from the active emoji release, applies the
same skin-tone normalization as favorites, and batches the discovery
`search_count`/`last_seen_at` upsert with a `search` event. It always writes
`user_id = NULL`; the request does not identify or record a signed-in user. A
Cloudflare Rate Limiting binding caps this public endpoint at 120 requests per
minute per key, with the key derived from a SHA-256 digest of the connecting IP.
The route requires the explicit D1 selector, split-D1 topology, and the limiter
binding; missing configuration fails closed. Requests with an `Origin` must
match the configured allowlist.

In Supabase/default builds the existing RPC remains in use and continues to
associate the event with `auth.uid()` when available. Only the new anonymous
aggregate path is enabled in the isolated staging build. Historical Supabase
search events and their user attribution have not been copied; that remains
part of the deferred real user-data migration.

The hook treats recording as best-effort after search completion: a failed
selected Worker request is logged and is not retried against Supabase. This
prevents a staging failure from silently creating mixed-backend writes.

## Verification and deployment boundary

### Fresh source review and full-schema native D1 evidence, 2026-10-03

The catalog-only source observation at `2026-10-02T21:03:48.240925+00:00`
contains the privately reviewed definitions below. No real user's RPC was
invoked and no source application/Auth rows were read.

| Function | Definition SHA-256 |
| --- | --- |
| `get_fanmark_complete_data` | `bceaa1e6b4c2378d08d057a27193b0d4f6e5a523bf7a855af2ba0ae2f38de4e0` |
| `check_fanmark_availability` | `80d1bfeaf110d139f7b8911234f5e97eddf9733e6f0de21b6d5ac72ef9f5df63` |
| `check_fanmark_availability_secure` | `5d1e6f3fe52dff2549a00115bf4c88c8d613d9275e6cd1ce29fd6c5279b5038e` |
| `search_fanmarks_with_lottery` | `5f7ca109288d480b48905257b99a21d1e8c77083f7f270454250adc8e8dc9f89` |

`get_fanmark_complete_data` derives pending entry state from `auth.uid()` and
selects one latest license by NULL-first end ordering. It also selects raw config
content, which the narrower target search endpoint deliberately never queries.
Its latest-license selection differs from availability/secure availability and
the combined lottery helper: those choose the earliest currently blocking
active/grace license with NULL last. The target preserves these separate
contracts. The combined lottery RPC has no literal frontend/Edge invocation in
the current repository (only its generated type declaration was found). Its
external/dynamic consumers,
ties between NULL-end historical licenses, full policy reconciliation and
imported-data parity remain open; this review does not classify them as inactive.

`test/fanmark-search-d1.test.ts` now runs through `handleRequest`, real Better Auth
sign-in/cookies, and native local D1 queries. Its config supplies every canonical
Business migration from `business-migration-ledger.mjs` (25 at this checkpoint),
including lifecycle/config generations, constraints and current triggers; it
does not substitute a reduced business schema. Auth uses the core Better Auth
schema. The fixture tokenizer retains quoted literals, comments and complete
trigger BEGIN/CASE/END blocks when applying the checked-in SQL.

Twelve cases cover each signed-in user's own pending entry, anonymous false/null
state, pending-only count with cancelled history, caller-selected owner rejection,
unchanged lottery rows, active perpetual/future-by-1us/exact/past deadlines, grace
fallback/override/exact deadlines, expired perpetual rows, NULL-first selection
over a finite license, and omitted protected config content for anonymous/owner/
other-user sessions. The first run failed on a missing required `tier_level`
fixture field; that is not an application defect. The corrected full-schema
suite passes. `npm run test:fanmark-search-d1` is part of normal Worker CI's
`test:api-contracts-d1`, separately from the existing mocked contract tests.
This closes the local SQL/session evidence gap for these cases, not deployed
acceptance, all source functions/RLS, or real user-data migration.

The frontend contract tests validate explicit selection, the narrow DTO, URL
and auth-origin checks, cookie inclusion, and no fallback after Worker failure.
The Worker contract tests validate search aggregate normalization, atomic
event/discovery writes, anonymous event attribution, rate limiting, input and
origin rejection, as well as the details endpoint's user binding and
protected-field omission. These synthetic tests do not establish that
historical fanmark/license/lottery rows or user-attributed search events have
been imported. The live synthetic POST/readback canary passed on version
`34779025-2fdd-47f2-8ac4-37e2dde02b8b`; both exact synthetic rows were deleted
and absence was confirmed. The current staging app is version
`47dd045f-ae0c-4b46-8138-bdd59037f7ab`; its served bundle contains the route
and omits session credentials for the anonymous write. Production and normal
builds remain on Supabase.

# Availability API validation

This document records the local proof for the public
`POST /api/fanmarks/availability` adapter. The route is an opt-in migration
boundary; the default Worker configuration selects Supabase for both API routes
and does not bind D1.

## Contract implemented

The route accepts a JSON object with exactly one property,
`emojiIds`. The value must contain one to five canonical UUID strings. The
request body is capped at 4 KiB and has a finite read deadline. UUID order and
repetition are preserved; UUID casing is canonicalized only for the upstream
lookup. Requests with another content type, malformed JSON, unknown properties,
missing IDs, invalid UUIDs, or too many IDs receive a sanitized `400`.

The response is `{ "schemaVersion": 1, "result": ... }` with `Cache-Control:
no-store`. Domain decisions are HTTP `200` results. The result variants
are validated before they cross the public boundary: tier metadata for a new
fanmark, an existing unblocked fanmark, a `taken` active license, or a
`grace_period` license. Invalid UUID resolution and an unavailable tier are
returned as `invalid_emoji_ids` and `invalid_length` respectively. Private
upstream fields are removed. Upstream HTTP, malformed, oversized, and stalled
responses are reduced to `502`/`504` error codes without upstream details.

The source semantics follow `docs/migration/availability-contract.md`:

- resolve IDs in caller order through the active, ready,
  `fanmark_emoji_master_release_staging` release in Master D1; the mutable
  canonical `emoji_master` mirror is not used for request-time lookup;
- concatenate the resolved emoji strings and remove only U+1F3FB through
  U+1F3FF skin-tone code points;
- preserve variation selectors and zero-width joiners when looking up
  `fanmarks.normalized_emoji`;
- classify one ID as tier 4, two to five identical IDs as tier 3, four or five
  non-identical IDs as tier 1, three as tier 2, and two as tier 3;
- consider `active` licenses with a NULL end or an end strictly later than
  the operation time, and `grace` licenses with an effective end strictly later; use `grace_expires_at` with
  `license_end` fallback for grace rows and select the earliest blocking end.

## Source selection

`AVAILABILITY_BACKEND` is independent from the recent-fanmarks cutover flag.
Unset or blank selects the Supabase public RPC
`check_fanmark_availability`; `d1` selects the local D1 repository; any other
nonblank value fails closed with `server_misconfigured`. The Supabase adapter
sends only the public `apikey`, JSON content type, and the RPC body
`{ "input_emoji_ids": [...] }`. Incoming cookies and authorization headers are
not forwarded. It rejects redirects, bounds the response body to 16 KiB, and
uses a bounded timeout.

The D1 adapter first resolves the singleton active-release pointer and its
ready metadata, then looks up every requested ID within that immutable version.
An absent active release fails closed as an upstream error; an ID that exists
only in the canonical mirror or an older release is returned as
`invalid_emoji_ids`. Exact integer cents in the imported
`fanmark_tiers.monthly_price_usd` target column, then divides by 100 at the
public response boundary. It keeps imported timestamptz values as fixed-width
UTC text, including microseconds, and compares them with a fixed-width UTC
operation timestamp. The local fixture contains only the columns needed for
this contract; it is not a production schema or an import rehearsal.

## Local proof

Run from `workers/api`:

```sh
npm run typecheck
npm test -- --run test/availability-api.test.ts
npm run test:availability:d1
```

The first test file exercises the Worker HTTP route, CORS, strict input
validation, credential omission, source selection, malformed/oversized/stalled
upstream handling, and sanitized errors through MSW. The dedicated D1 suite
uses the local D1 binding and fixture SQL to exercise tier classification,
skin-tone-only normalization, ZWJ/variation-selector preservation, inactive
tiers, exact expiry boundaries, grace fallback, earliest blockers, timestamp
precision, and a real SQL failure.

This proof does not create or deploy a remote D1 database, run the full schema
or data import, measure Cloudflare CPU limits, invoke the live Supabase RPC,
or provide OAuth credentials. Those remain migration gates. The Supabase
adapter contract is validated with synthetic MSW responses; only the D1 path
has a local database execution proof.

An additional local proof applies the checked-in emoji-release activation and
versioned reference-master migrations, stages synthetic emoji/reference
releases, and then calls the availability Worker against both active views.
It verifies that lookup follows the same emoji version used by registration,
ignores a stale canonical mirror, rejects a mirror-only retired ID, and keeps
the exact-cent tier conversion. The focused fixture retains boundary and
fail-closed cases.
Run it with `npm run test:availability:reference-master` from `workers/api`.

## Frontend integration

`src/lib/fanmark-availability.ts` selects the Worker when
`VITE_FANMARK_API_BASE_URL` is nonblank; an unset value keeps the existing RPC.
`useFanmarkSearch` uses this path for its two availability checks. Worker
failure never invokes the RPC fallback. The client sends no session credentials,
validates schemaVersion and public result fields, limits the body to 16 KiB,
and enforces a five-second overall deadline, including stalled streams whose
cancellation never resolves. Invalid-ID/tier decisions remain unavailable in
the search result instead of being mistaken for a new acquirable fanmark.

Six client tests and the application type check pass. Existing user lookup,
search recording, detailed fanmark retrieval, and registration still use
Supabase; this change does not claim a completely migrated search workflow.

Parent read-only verification also called the live public RPC for five bounded
ID combinations and confirmed both Worker and frontend validators accepted
the returned shapes. No user fields or API keys were logged. This checks the
observed response contract, not complete source/D1 row parity.


## Staging D1 integration (2026-09-25 JST)

The app staging Worker now sets `AVAILABILITY_BACKEND=d1`, and its SPA bundle
uses the same-origin Worker base URL. A read-only live request resolved one
canonical emoji from the active Master D1 release, queried the empty synthetic
business D1, and returned HTTP 200 with `no-store`, the exact allowed CORS
origin, and a valid available tier-4 DTO. The response contained no user data.
Local verification passed the six frontend contracts, eight focused D1 cases,
and three split reference-master cases. This only proves the staging contract
against synthetic empty business data; search history, existing ownership,
registration, user lookup, and full production parity remain on Supabase.

## Registration staging boundary (2026-09-26 JST)

The separate D1 registration API is now selected in the Cloudflare staging
build. It reads the exact allowlisted public `max_emoji_characters=5` setting
from business D1 and validates the count against that value; its test also
sets a local fixture limit of one and verifies rejection. Registration and
its user-owned rows remain synthetic staging behavior; production/default
builds retain their existing Supabase path. See
[fanmark registration API](fanmark-registration-api.md).

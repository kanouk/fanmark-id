# Public fanmark access and OGP contract

This document records the public fanmark access slice under migration issues
#33 and #34. The read-only Worker/D1 routes and explicit frontend selector are
implemented and locally tested. On 2026-09-25 the selector was enabled on the
workers.dev staging app and its short-ID, emoji, and published-profile reads
were verified with a temporary synthetic business record. The record was
deleted and all four involved business tables read back zero. This did not
copy production rows, change production traffic, or modify the existing
Supabase RPCs.

## Implemented read routes

One shared, read-only public projection is exposed through these routes:

| Route | Input | Result |
| --- | --- | --- |
| `GET /api/fanmarks/access/short/:shortId` | One bounded path segment | One public fanmark projection or `404 not_found` |
| `POST /api/fanmarks/access/emoji` | JSON `{ "emojiIds": [uuid, ...] }` | The same projection or `404 not_found` |
| `GET /api/fanmarks/public-profile/:licenseId` | One UUID path segment | Published profile projection or `404 not_found` |

The emoji request accepts one through five UUIDs, preserves their order and
repetition until the canonical normalization step, and rejects malformed or
oversized JSON. The short-id input is decoded once, bounded, and rejected when
empty or containing controls, a slash, or a backslash. The route currently
enforces a 256-byte input bound. The maximum length in the authoritative source
column still needs reconciliation before remote business data or production
traffic is switched; checked-in migration history proves a minimum length of
six but not a maximum. The profile route accepts only a canonical UUID.

## Frontend read selection

`VITE_PUBLIC_ACCESS_READ_BACKEND=worker` selects these public read routes for
short-ID access, emoji-path lookup, the public QR lookup, and published-profile
reads. The base origin comes from `VITE_FANMARK_API_BASE_URL`. An unset or
explicit `supabase` value preserves the current Supabase path. An invalid
backend value, HTTP failure, timeout, malformed response, or network error
does not fall back to Supabase. Worker requests omit cookies and authorization,
use `Cache-Control: no-store`, and have a five-second client timeout and a
64-KiB response bound.

This selector covers anonymous reads only. Worker responses mark protected
records as locked and redact their contents. Until a guarded Worker verifier
and post-verification content read exist, the Worker-selected `/a/:shortId`
flow fails closed on locked records; it does not call the legacy Supabase
password RPC or render empty content. The default Supabase path retains the
existing protected flow. Production/default access analytics still call the
Supabase `record-fanmark-access` function; workers.dev staging selects the
paired D1 write and owner-read APIs described below. The `/f/:shortId` details
view has a separate staging selector: `VITE_FANMARK_DETAILS_BACKEND=worker`
calls `/api/fanmarks/details`, and the Worker requires
`FANMARK_DETAILS_BACKEND=d1`. Anonymous details redact ownership/history and
authenticated details derive owner, favorite, lottery, and history fields
from the Better Auth session. The staging frontend sets the public-read
selector and its Worker sets `PUBLIC_ACCESS_BACKEND=d1`. Fanmark/license/config
and profile projections use the business `FANMARK_DB`; emoji ID and codepoint
normalization uses the separate `MASTER_DB`. The live synthetic canary
returned 200/no-store for all three public routes while the business D1 had
zero emoji-master rows, proving the lookup uses the split master binding. A
separate synthetic details canary verified the authenticated projection and
cleanup. Business staging contains no imported user rows. Production remains
on Supabase; this staging proof is not evidence of real-data parity or a
production cutover.

The access routes return a strict versioned object so both lookup methods use
one mapper:

```json
{
  "schemaVersion": 1,
  "id": "fanmark UUID",
  "shortId": "public short id",
  "userInputFanmark": "original emoji spelling",
  "displayFanmark": "license display spelling or null",
  "emojiIds": ["canonical emoji UUID"],
  "accessState": "open | locked | unavailable",
  "fanmarkName": "public name or null; null when locked",
  "accessType": "profile | redirect | text | inactive",
  "targetUrl": "public redirect target or null; always null when locked",
  "textContent": "public message content or null; always null when locked",
  "status": "active",
  "isPasswordProtected": false,
  "licenseId": "license UUID or null",
  "licenseStatus": "active | grace | expired or null",
  "licenseEnd": "stored UTC timestamp or null",
  "graceExpiresAt": "stored UTC timestamp or null",
  "isReturned": false
}
```

`displayFanmark` is nullable because the source RPC returns the selected
license's `display_fanmark` without a fallback. A client may choose its existing
display fallback for rendering, but the Worker must not silently replace the
stored display value with normalized emoji. `targetUrl` and `textContent` are
returned only when the selected license has no enabled password configuration;
they are not a credential or an authorization result. When a password is
enabled, the anonymous response is a minimal locked projection: it keeps the
fanmark identity, display spelling, emoji IDs, license state, access type, and
`isPasswordProtected: true`, sets `accessState` to `locked`, and sets
`fanmarkName`, `targetUrl`, and `textContent` to `null`. It never includes
profile content. A later verified-access operation must prove the password for
the exact current license before returning those fields. The response uses
`Cache-Control: no-store` until the license selection, password, and redirect
caching policy is settled. Upstream failures return a sanitized error code and
no SQL, row, or credential details.

The profile response is also versioned and contains only:

```json
{
  "schemaVersion": 1,
  "licenseId": "license UUID",
  "displayName": "public display name or null",
  "bio": "public bio or null",
  "socialLinks": {},
  "themeSettings": {},
  "createdAt": "stored UTC timestamp",
  "updatedAt": "stored UTC timestamp"
}
```

It is returned only for a published profile (`is_public = true`) linked to the
requested license whose password configuration is not enabled. The profile
route must check that gate itself; it cannot rely on the caller having first
read the access projection. A password-protected, private, or missing profile
is indistinguishable from a missing public profile until a future verified
access operation is specified. The profile row's internal `id`, `user_id`,
username, email, role, subscription, and private settings never cross this
boundary.

The initial D1 proof should implement the short-id and profile projections
first. Emoji lookup should call the same short-id-safe mapper after canonical
ID normalization. The frontend can continue using its current Supabase RPC
until the Worker validators and D1 proof are accepted.

## Projection and license invariants

The D1 query may read these source columns only:

| Source | Allowed fields | Boundary rule |
| --- | --- | --- |
| `fanmarks` | `id`, `short_id`, `user_input_fanmark`, `emoji_ids`, `normalized_emoji_ids`, `status` | Require `status = 'active'`; normalized IDs are lookup-only and are never returned |
| `fanmark_licenses` | `id`, `fanmark_id`, `display_fanmark`, `status`, `license_end`, `grace_expires_at`, `is_returned` | Select one explicitly defined current public license; never select or return `user_id` |
| `fanmark_basic_configs` | `license_id`, `fanmark_name`, `access_type` | Join only through the selected license |
| `fanmark_redirect_configs` | `license_id`, `target_url` | Join only through the selected license; validate URL policy before redirect use |
| `fanmark_messageboard_configs` | `license_id`, `content` | Join only through the selected license and apply response bounds |
| `fanmark_password_configs` | `license_id`, `is_enabled` | Project only `isPasswordProtected`; never read or copy `access_password` |
| `fanmark_profiles` | `license_id`, `display_name`, `bio`, `social_links`, `theme_settings`, `created_at`, `updated_at`, `is_public` | Require `is_public = true`; do not expose the profile row ID or account identity |

The live catalog fingerprint completed on 2026-09-21 resolves the checked-in
snapshot drift. The two current lookup functions have different
license selection behavior:

- `get_fanmark_by_emoji(uuid[])` normalizes the UUID array, requires an active
  fanmark, and left-joins an `active` license only when
  `license_end > now()`. It therefore excludes grace, expired, and indefinite
  active licenses from the joined configuration, while still returning the
  active fanmark as a base row when no license qualifies. It returns
  `display_fanmark` from that joined license.
- `get_fanmark_by_short_id(text)` requires an active fanmark and left-lateral
  selects one `active` license ordered by `license_end DESC NULLS LAST`; it does
  not compare `license_end` with the current time. It therefore preserves an
  active row with an expired or indefinite selected license, excludes grace and
  expired-status rows, and returns a base row when no active license exists.

The first D1 parity proof should preserve those source selection semantics
explicitly, with the locked-field redaction above. It must not silently merge
the two rules or substitute a new grace/expiry policy. The difference is a
known product/security gate for later cleanup. The existing short-id UI expects
an unlicensed active fanmark to remain addressable so it can offer acquisition;
that behavior is present in the live function and should be covered by the
fixture. `is_returned` is selected and returned by the live short-id function
but is not a selection predicate; the D1 mapper should preserve that fact until
a lifecycle decision changes it.

If a later product decision changes the active/expiry policy, it must update
both the Supabase function and the D1 mapper together. Until then, expired or
private fanmark rows must not become reachable merely by selecting a latest
historical license, and protected content must remain locked.

All timestamps retain the imported canonical UTC representation, including
subsecond precision. The repository must not parse, round, or localize stored
timestamps while constructing this response.

## Permission and data-classification boundary

These routes are anonymous public reads. They must not accept a caller-supplied
user ID, role, license owner, lottery entry, favorite flag, session assurance,
or authorization header as a substitute for server-side authorization. If the
Supabase adapter is used during the cutover, it sends only the public API key
and the exact public RPC payload; browser cookies and incoming `Authorization`
headers are not forwarded.

The following data is deliberately outside this slice:

- `user_id`, username, display name from `user_settings`, email, roles,
  subscription state, and any Auth provider identity;
- license history, current owner IDs, first owner data, transfer state, and
  audit records;
- `lottery_entry_count`, `has_user_lottery_entry`,
  `user_lottery_entry_id`, favorite state, and search/access analytics;
- `access_password`, password hashes, reset metadata, and password verification
  attempts;
- `get_fanmark_complete_data` and `get_fanmark_details_by_short_id` as
  anonymous replacements. Those functions combine public preview with
  user-aware or owner/history fields and require a separate authorization
  contract. The separate whois contract now lives in
  [`fanmark-details-api.md`](fanmark-details-api.md): its anonymous query uses
  only the public overview fields, while Better Auth session presence gates
  history, account names, and caller-derived favorite/lottery state.

`isPasswordProtected` is a hint for the password gate, not proof that the
caller is authorized. The separate guarded Worker verification and protected
read routes are implemented behind `VERIFIED_ACCESS_BACKEND=d1`; the frontend
has a matching opt-in client behind `VITE_VERIFIED_ACCESS_BACKEND=worker`.
Both selectors are now active on the workers.dev staging app after the live
synthetic verification/read canary passed. Real source-hash compatibility,
rate-limit abuse behavior, failure auditing, Cloudflare CPU fit, and broader
browser/security checks remain open; production stays on Supabase. The D1
public projection must not make password configuration rows readable merely
because the flag is needed by the UI.

The guarded path is a separate, short-lived proof operation bound to the exact
selector, selected `fanmark_id`, `license_id`, and lifecycle/configuration
generations. A successful check authorizes a bounded read of the protected
redirect, message, or published profile projection. It accepts no
client-supplied `isPasswordProtected` value, user ID, role, or permanent bearer
flag, and invalidates proof when the license, password configuration, or
protected content changes. Its current implementation and remaining source
compatibility gates are documented in
[`verified-access-design.md`](verified-access-design.md); this public read
contract does not change those gates or enable the route.

Private profiles remain owner/authenticated data. A future owner route must
derive the owner from the server-side session and enforce the license relation;
it must not turn `is_public = false` into an anonymous lookup by license UUID.
Likewise, a future details route must authenticate before returning owner,
history, favorites, or lottery fields. These routes are separate from the
anonymous projection and cannot be implemented by forwarding the current
details RPC.

## OGP boundary

The current production `fanmark-ogp` function is public and uses a service-role
client. The workers.dev staging Cloudflare implementation handles crawler
requests at the canonical `/a/:shortId` route and the legacy `/:emojiPath`
route, using the same D1 public projection above. The emoji route resolves an
exact active `user_input_fanmark` to one short ID before reading the public
projection; if the lookup is ambiguous it returns generic metadata. The
crawler's canonical URL always uses `/a/:shortId`. Non-crawlers continue to
Static Assets and the SPA for either route. URLs use the incoming host; a
workers.dev preview therefore does not point at the production domain.
Production OGP remains on Supabase until a later application cutover.

The Worker validates the single bounded short-ID segment, serves crawler HTML
from public fanmark/profile fields only, escapes HTML and URL attributes, and
returns a generic bounded fallback for misses. It does not log query values or
user-agent details. Because browser and crawler representations share the same
URL, HTML is `no-store` with `Vary: user-agent`; the independent SVG image route
uses bounded parameters, XML escaping, and its own cache policy.

For a password-protected license, OGP may use only safe metadata such as the
emoji spelling, canonical short ID, and a generic locked/access description. It
must not call the public profile RPC to obtain a display name, include a target
URL or message text, or imply that a password-protected profile is public. OGP
does not perform password verification; a verified-access operation is required
before protected content can be rendered.

The current production emoji branch reads `fanmarks` directly and does not
filter `status = 'active'`; the staging route must not repeat that behavior.
The current short-id branch calls `get_fanmark_by_short_id` and then
`get_public_emoji_profile`, so OGP reuses the staging public-access mapper
rather than constructing a second projection. `generate-ogp-image` remains a
separate production public surface. The Worker SVG route bounds emoji and
display-name inputs and escapes XML. Details are in
[fanmark OGP API](fanmark-ogp-api.md).

The workers.dev OGP slice now has local projection, privacy, escaping,
ambiguity, and browser/crawler tests. This does not authorize switching the
existing production edge function to D1. `record-fanmark-access` is a separate
public-ingress/internal write operation and must not be coupled to an
anonymous read request. The paired synthetic D1 implementation exposes
`POST /api/fanmarks/access` plus session-scoped owner reads under
`/api/me/analytics/*`; both selectors are active on workers.dev staging and a
synthetic end-to-end canary passed with cleanup. Historical analytics remain
in Supabase. See [fanmark access analytics API](fanmark-access-analytics-api.md).

## Evidence and unresolved source drift

### Live public-read catalog fingerprint (2026-09-21)

The existing read-only catalog helper ran with `default_transaction_read_only`
and a 25-second statement timeout. Its private output is mode `0600`; no live
rows, profile values, password material, or function bodies were copied into
the repository. The following SHA-256 digests cover the four live public-read
function definitions and are only change detectors, not a substitute for review:

| Identity | Return shape summary | Language/security | Definition SHA-256 |
| --- | --- | --- | --- |
| `public.get_fanmark_by_emoji(input_emoji_ids uuid[])` | `id`, input/display emoji, emoji IDs, access config, status, password flag, short ID | `plpgsql`, `SECURITY DEFINER`, `search_path=public` | `c98679a9e059a20f5824e008fcd4012e6f5af10965f3d087c545040c33bbcdef` |
| `public.get_fanmark_by_short_id(shortid_param text)` | short ID, input/display emoji, emoji IDs, access config, status, password flag, license state | `plpgsql`, `SECURITY DEFINER`, `search_path=public` | `d461f24f2513724556c080bb1ffc3035c265ee7a9ffbe47e315648514a43fabd` |
| `public.get_fanmark_details_by_short_id(shortid_param text)` | owner, history, favorite, lottery, current-user, and public fields | `plpgsql`, `SECURITY DEFINER`, `search_path=public` | `071eb66e0647166682a179e5956b08713f39ef321cb34f240d9713020c58a5ba` |
| `public.get_public_emoji_profile(profile_license_id uuid)` | published profile fields only | `sql`, `STABLE SECURITY DEFINER`, `search_path=public` | `f0486111074007df437fe0cae78b8c88e4f471e03d2e4a22b1ca153e86c884c6` |

The read-function fingerprints are evidence for source projection and lookup
semantics only. They do not establish a safe password or authenticated-details
boundary. The Worker public route must use a new allowlist and must not mirror
owner, history, favorite, lottery, or current-user fields. Password
compatibility, rate limiting, failure auditing, and profile gating remain
explicit cutover gates; the private read-only handoff retains the detailed
catalog observations needed for that follow-up.

The checked-in evidence establishes the following current callers and shapes:

- `FanmarkAccess.tsx` resolves an emoji path to canonical emoji IDs and calls
  `get_fanmark_by_emoji`; it needs the access fields, password flag, short ID,
  input spelling, and emoji IDs.
- `FanmarkAccessByShortId.tsx` calls `get_fanmark_by_short_id`; it needs the
  license status fields, display spelling, access configuration, and short ID.
- `FanmarkProfile.tsx` calls `get_public_emoji_profile` and renders only the
  published profile fields listed above.
- The generated Supabase types include `display_fanmark` for the short-id
  function but the checked-in `remote_schema.sql` emoji definition omits it;
  `20260104025602_remote_schema.sql` includes it. This is a projection drift,
  not evidence that either snapshot is live.
- The latest short-id snapshot and `20260104120000_update_public_access_grace.sql`
  use an active-only lateral license selection; older history uses active plus
  grace. The emoji snapshot filters active licenses by a finite future
  `license_end`, which also conflicts with the product's indefinite tier.
- `get_public_emoji_profile` is a published `fanmark_profiles` projection with
  `is_public = true`, ordered by `updated_at DESC LIMIT 1`; it contains no user
  identity fields.
- `get_fanmark_details_by_short_id` includes owner, history, favorites, and
  lottery fields and cannot be treated as the public access projection.

The live fingerprint covers these public-read signatures and return columns:

```text
public.get_fanmark_by_emoji(uuid[])
public.get_fanmark_by_short_id(text)
public.get_public_emoji_profile(uuid)
public.get_fanmark_details_by_short_id(text)
```

Do not export function bodies, password-path internals, password rows, user
rows, or live profile data into this repository. The local snapshots and
generated types remain inputs to review only; the public-read digests and
selection summary above are the only live evidence recorded here.

## Required local proof before cutover

The future D1 fixture must be synthetic and isolated from deployable Wrangler
configuration. It should contain only the columns needed for the reviewed
projection and exercise:

- active, grace, expired, indefinite, returned, unlicensed, and multiple
  license rows under the approved selection policy;
- display spelling that differs from input and normalized emoji values;
- duplicate and reordered emoji IDs, malformed IDs, missing short IDs, and
  short-id bounds;
- profile rows where `is_public` is true and false, bounded JSON fields, and a
  missing profile;
- enabled and disabled password configs while asserting that no password
  material appears in SQL results or HTTP bodies, and that a protected
  redirect, message, or profile produces only the minimal locked response;
- a public-profile lookup with an enabled password must be
  `404`-equivalent/locked without profile content; the unprotected published
  profile must still return its allowlisted fields;
- inactive and unknown access types, null config values, invalid redirect
  protocols, and oversized text/JSON values;
- real D1 execution for both lookup routes, sanitized SQL errors, strict
  `no-store` headers, and the no-fallback behavior when D1 is explicitly
  selected.

The OGP stage additionally needs crawler and non-crawler cases, canonical URL
construction, HTML attribute escaping, generic miss behavior, bounded
responses, and cache-header assertions. A separate negative test must prove
that owner/history/lottery fields cannot appear in either public response.

These tests prove the local projection and authorization boundary only. They do
not prove remote D1 provisioning, complete schema/data import, Cloudflare CPU
or concurrency limits, password-hash migration, OAuth behavior, MFA, or
production cache invalidation.

## Gates and recommendation

The next implementation is ready only after:

1. the live function signatures and return columns are fingerprinted without
   exporting rows;
2. each lookup preserves the live selection rules documented above and uses
   the shared output mapper; a later policy change is a separate decision;
3. the full D1 schema conversion identifies UUID, array, JSON, and timestamp
   representations for every selected column;
4. URL, text, profile JSON, and cache limits are approved;
5. public password verification and any authenticated details route have their
   own rate-limit and authorization design.

Until those gates pass, keep Supabase as the default and keep the public access
Worker opt-in. Implement short-id plus published-profile read projections
first, then route emoji lookup and OGP through that shared projection. Keep
password verification, anonymous details, access analytics, and user-specific
lottery/favorite data on their existing boundaries.

### Response-size preflight

[`public-access-readiness.sql`](../../scripts/migration/public-access-readiness.sql)
checks the proposed byte bounds with aggregate booleans in a read-only,
repeatable-read transaction. It requires an already-authorized source role;
it does not grant privileges. The current read-only observation found no
violations of the checked name, message, redirect, short-ID, social JSON, or
theme JSON bounds. Raw output remains private. This does not prove that future
UI writes fit those bounds, that the combined serialized response fits its
budget, or that all profile values satisfy the target mapper. Re-run during
rehearsal and resolve any failing condition before switching the frontend.
Character limits from the UI must be measured as JavaScript string length,
separately from UTF-8 response-byte limits; Japanese text is not one byte per
character.

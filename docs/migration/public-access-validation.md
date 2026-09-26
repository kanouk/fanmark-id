# Public-access validation

This note records the bounded local and workers.dev proof for the opt-in D1
public-read slice. It is not a claim that production business rows or the full
application have been migrated.

## Implementation boundary

`PUBLIC_ACCESS_BACKEND=d1` is required for the route to use D1. An unset flag
returns `503 public_access_unavailable`; an unknown flag or a missing required
business/master binding fails closed. The staging Worker explicitly selects
this backend; other environments must opt in separately.

Short-ID and emoji lookups use one business-D1 projection statement after
emoji-master normalization through the selected master D1 role. The projection
selects only the active public columns. CTE
counts reject duplicate base/config rows and license ties; the emoji path
rejects more than one eligible finite license, while the short-ID path keeps
the observed latest-active selection and its indefinite-license behavior.
Config CTEs are restricted to the selected license. `CASE` expressions redact
password-protected name, redirect, and message content, and project redirect
or message content only when that access mode is active. This keeps a stale
config row left by an existing mode switch from changing the public response.

Published-profile eligibility, password state, `is_public`, profile selection,
and profile content are resolved in one D1 statement. Inactive, grace,
expired, returned, private, and password-protected profiles produce the same
not-found result. A duplicate profile or duplicate password configuration is a
sanitized upstream failure rather than an arbitrary selection.

The mapper validates canonical UTC timestamps with six fractional digits while
returning the stored string unchanged. Profile display names and bios use the
frontend's UTF-16 character limits; JSON, URL, fanmark-name, message, and
response byte caps remain Worker safety bounds. Empty social-link values are
omitted, and empty image URL placeholders accepted by the profile form are
omitted from the public object.

## Fixture and checks

The fixture is `workers/api/test/fixtures/d1-public-access-contract.sql` and
contains only the columns needed by these projections. The local suite now
binds distinct business and master D1 databases. It covers active,
grace, expired, indefinite, returned/unlicensed, multiple and tied licenses;
display spelling; tone normalization; repeated and long ZWJ emoji input;
protected redirect/text/profile rows; private and expired profiles; stale
inactive-mode config; malformed URL/text/master/config data; CORS and source
selection errors; and uppercase UUID paths.

The atomicity test inserts a password row at the D1 query barrier and asserts
that the short-ID repository performs one projection prepare and returns only
the locked redacted result. The profile repository likewise performs one
projection prepare. The proof uses the real local D1 binding and the Worker
request handler; it does not monkeypatch Better Auth, create a remote D1
database, use OAuth credentials, or forward cookies and authorization headers.

The frontend adapter is separately selected with
`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`. Its seven tests cover origin
validation, short-ID/emoji/profile mappings, credential omission, response
bounds, fail-closed HTTP/invalid-response handling, and timeout behavior. The
the staging build selects this flag, so these client tests remain separate
from the live route proof. The default production Supabase path retains
password verification and access analytics; Worker-selected protected
records fail closed while the separate verification selector remains off.

Run from `workers/api` with the declared Node 22.6 runtime:

```text
PATH="/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin:$PATH" npm run typecheck
PATH="/Users/kanouk/.anyenv/envs/nodenv/versions/22.6.0/bin:$PATH" npm run test:public-access:d1
```

The focused run currently passes 11 tests. Existing recent, availability,
default API, and static-asset suites remain separate checks. This slice does
not prove remote D1 provisioning, full schema/data conversion, Cloudflare CPU
or concurrency limits, password verification/hash migration, OAuth behavior,
MFA, authenticated details, OGP, or production cache invalidation. Keep the
Supabase path as the default until those gates have independent evidence.

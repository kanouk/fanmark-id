# Verified public fanmark access design

This is the target design for password-protected public fanmarks before the
frontend moves away from the existing Supabase password path. It does not add
routes, migrate password values, create remote D1 resources, or change the
anonymous public projection. The design keeps the existing four-digit user
experience while requiring a separate compatibility decision for every source
password format.

## Decision

Password verification is an anonymous, fanmark-scoped operation. It does not
create a Better Auth user session and a logged-in user does not bypass it. A
successful verification creates one opaque, short-lived proof in D1 and an
HttpOnly cookie. The proof is usable only for the exact selector, selected
license, password-config generation, and current license/profile lifecycle.
The selector is part of the proof's authorization identity; a proof issued for
a short ID or emoji selector is never accepted by an arbitrary profile-license
URL.

The anonymous access and profile routes continue to return the locked or
not-found projection. Credentialed protected reads use separate routes so the
existing public CORS and cache behavior cannot accidentally start accepting
cookies:

| Operation | Route | Request | Result |
| --- | --- | --- | --- |
| Verify short-ID access | `POST /api/fanmarks/access/short/:shortId/verify-password` | JSON `{ "password": "...." }` | `204` plus a proof cookie, or one neutral denial response |
| Verify emoji access | `POST /api/fanmarks/access/emoji/verify-password` | JSON `{ "emojiIds": [uuid, ...], "password": "...." }` | Same proof behavior; the server canonicalizes the emoji selector |
| Verify profile access | `POST /api/fanmarks/public-profile/:licenseId/verify-password` | JSON `{ "password": "...." }` | Same proof behavior after current license/profile checks |
| Read protected short ID | `GET /api/fanmarks/access/short/:shortId/protected` | Proof cookie only | Validated redirect, text, or profile projection; a selected profile is nested in this response |
| Read protected emoji | `POST /api/fanmarks/access/emoji/protected` | JSON `{ "emojiIds": [uuid, ...] }` plus proof cookie | Same protected projection; a selected profile is nested in this response |
| Read protected profile | `GET /api/fanmarks/public-profile/:licenseId/protected` | Proof cookie only from the profile verification route | Published profile projection after the password gate |

The proof cookie is named `__Host-fanmark_access`, is host-only, and has
`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and a five-minute maximum age.
Its value is random and is never returned in JSON, local storage, analytics, or
logs. The D1 table stores only a hash of the value. A new successful
verification replaces the browser's one active proof; it does not create a
reusable account credential.

Protected routes return `Cache-Control: no-store`. They accept no
`Authorization` header, user ID, role, `unlocked`, `verified`, or session
claim from the caller. The server derives every authorization decision from
the selector, current D1 rows, and the proof cookie.

The target flow keeps profile reads selector-safe by returning an allowlisted
nested profile projection from a protected short-ID or emoji response. A
short-ID or emoji proof is therefore consumed only by its corresponding
protected access route. The standalone protected profile route is for a proof
created by the profile verification route, whose selector is the requested
license ID. If a later product flow needs to fetch a profile separately after
short-ID or emoji verification, it must add a route that re-resolves the
proof's stored canonical selector and selected license in the same atomic
query; accepting an arbitrary `licenseId` with an access proof is not a valid
fallback.

## D1 state and invalidation

The production schema needs explicit version rows before importing protected
content:

```text
fanmark_access_versions
  license_id              TEXT PRIMARY KEY REFERENCES fanmark_licenses(id)
  password_generation     INTEGER NOT NULL
  lifecycle_generation    INTEGER NOT NULL
  updated_at              TEXT NOT NULL

fanmark_access_proofs
  id                      TEXT PRIMARY KEY
  token_hash              TEXT UNIQUE NOT NULL
  selector_kind           TEXT NOT NULL
  selector_hash           TEXT NOT NULL
  fanmark_id              TEXT NOT NULL
  license_id              TEXT NOT NULL REFERENCES fanmark_licenses(id)
  password_generation     INTEGER NOT NULL
  lifecycle_generation    INTEGER NOT NULL
  created_at               TEXT NOT NULL
  expires_at               TEXT NOT NULL

fanmark_access_rate_limits
  bucket_kind             TEXT NOT NULL -- requester or resource
  bucket_hash              TEXT NOT NULL
  window_started_at        TEXT NOT NULL
  attempt_count            INTEGER NOT NULL
  failure_count            INTEGER NOT NULL
  cooldown_until           TEXT
  updated_at               TEXT NOT NULL
  PRIMARY KEY (bucket_kind, bucket_hash)

fanmark_access_attempt_reservations
  reservation_id          TEXT PRIMARY KEY
  requester_bucket_hash   TEXT NOT NULL
  resource_bucket_hash    TEXT NOT NULL
  license_id              TEXT
  selector_hash           TEXT NOT NULL
  reserved_at             TEXT NOT NULL
  outcome                 TEXT NOT NULL
  completed_at            TEXT

fanmark_access_attempt_audit
  id                      TEXT PRIMARY KEY
  reservation_id          TEXT NOT NULL
  license_id              TEXT
  selector_hash           TEXT
  requester_hash          TEXT NOT NULL
  outcome                 TEXT NOT NULL
  occurred_at             TEXT NOT NULL
  password_generation     INTEGER
  lifecycle_generation    INTEGER
```

The actual migration must use the repository's UUID, timestamp, foreign-key,
and index conventions. The table sketch intentionally contains no password,
password hash, raw IP address, user-agent, or browser token. A reservation ID
is an internal single-attempt reference and is never accepted from a caller or
exposed as a proof.

`password_generation` increments when a password hash, enabled flag, or
password-config identity changes. `lifecycle_generation` increments when the
selected license or parent fanmark becomes inactive, returned, expired, or
otherwise no longer eligible, and when published profile visibility or the
license relationship changes. D1 triggers or the only authorized mutation
repository must cover every writer. A version change may delete proofs for
the affected license, but deletion is cleanup; the equality checks below are
the immediate invalidation mechanism.

The protected projection must check, in one D1 statement, all of the
following before selecting content:

1. the proof token hash and selector hash match;
2. the proof license and fanmark match the currently selected rows;
3. proof expiry is in the future;
4. both stored generations equal the current version row;
5. the license/fanmark status, return flag, and expiry are currently eligible;
6. the password configuration is still enabled and belongs to that license;
7. the requested access mode or profile is still the selected public object.

The statement must use `CASE` or equivalent projection so a failed check
cannot fetch protected redirect, message, or profile content for later
application-side filtering. It must not perform a guard query followed by an
independent content query. A password reset racing the proof insert therefore
either prevents the proof or makes the next protected read fail the generation
check.

## Hash compatibility and verification

The local proof established that `bcryptjs 3.0.3` can verify synthetic bcrypt
`$2a$10$` and `$2b$10$` values in the Workers runtime. It is the candidate
implementation for a fanmark verifier because the same pinned library was
exercised in the isolated account-password proof, but those synthetic tests do
not establish the format of any fanmark source value or that the production
CPU plan can afford the work. The Better Auth account-password verifier is a
separate use of the same library; Better Auth's default account hash is
scrypt, and its custom `emailAndPassword.password.verify` hook does not itself
authorize fanmark content.

The migration preflight must classify source password-config values without
exporting their contents. For each enabled row it records only the scheme
class, cost/prefix class, UUID relation, and import outcome. Existing password
behavior and license/config UUIDs are preserved; asking an owner to choose a
new password is not the default migration strategy. A recognized bcrypt row
is imported as a hash with an explicit `hash_scheme = 'bcrypt'`. An unknown,
plaintext, malformed, or unsupported scheme is never compared by a public
Worker: it needs a private one-time conversion/import rehearsal that proves
equivalent verification, or an explicit owner decision if safe conversion is
impossible. There is no runtime plaintext fallback, and the source-format
mapping remains unresolved until that private preflight is complete.

The verifier accepts the current four-digit input contract without trimming or
rewriting the value. It validates the bounded JSON body, reads the current
selected license and version, and then calls the pinned bcrypt verifier. Any
unknown selector, inactive/expired license, disabled config, unsupported
scheme, wrong password, or stale generation follows the same denial path. A
fixed synthetic bcrypt comparison is used when no real hash is available so
the obvious existence cases do not skip all password work. Passwords and hash
values are never placed in errors, audit rows, response bodies, or logs.

On a successful comparison, one finalization batch transitions the server-held
reservation to `success`, writes its audit row, and inserts the proof with a
guarded `INSERT ... SELECT`. The proof insert requires that reservation,
rechecks the current version, license, config, and expiry, and binds the exact
selector and selected license. If it affects zero rows, the operation returns
the neutral denial and the client retries against current state. Lazy
rehashing is a later decision; if enabled, the compare, generation-guarded hash
replacement, and proof creation must not allow a proof to outlive the
replacement.

## Rate limiting and failure audit

Rate limiting is persistent D1 state, not an in-memory Worker counter. Every
verification that could reach bcrypt reserves two independent buckets before
the hash call:

- a **requester** bucket keyed by an HMAC of the trusted Cloudflare request
  address only, independent of the selector; and
- a **resource** bucket keyed by the selected license UUID, or by a bounded
  canonical selector digest when resolution fails.

Only HMAC digests are stored. If the platform supplies no trusted address, the
request uses a conservative shared requester bucket. Forwarded-address headers
supplied by the caller are ignored. A selector-independent requester bucket is
required so an attacker cannot rotate short IDs or emoji selectors to obtain a
fresh bcrypt budget on every request.

Reservation is an atomic admission operation, not a failure-counter update.
The Worker generates a fresh `reservation_id`. It first advances an older
bucket window in a monotonic D1 operation; this rollover is separate so a
blocked admission cannot roll back a carried cooldown. It then submits one
admission `batch()` that seeds both rows and inserts the reservation. A D1
trigger or equivalent single SQL guard on that insert must verify that
**both** bucket rows are below the attempt limit and outside cooldown; the
guard raises an abort result if either row is blocked. Its insert trigger
increments `attempt_count` in both rows. Because the admission batch is atomic,
a blocked resource cannot consume the requester row (or vice versa), and no
proof path can accept an attempt without a reservation. A delayed request may
advance only an older window; it cannot roll a newer window backward. The
reservation ID remains server-side; no caller can supply one to unlock a route.

The reservation is consumed before bcrypt, so in-flight attempts count against
the budget. A starting policy is five attempts per five-minute window, then a
one-minute cooldown with bounded exponential backoff up to fifteen minutes.
The exact values need staging load evidence. A wrong-password finalization
transitions the reservation once and increments `failure_count` plus cooldown
state in both buckets. A successful comparison never resets another reserved
or failed attempt. The transition and its audit insert are one guarded batch;
duplicate finalization is rejected. The local proof binds finalization to a
reservation window and expiry, uses a single finalization ID, and writes a
proof only through a guarded `INSERT ... SELECT`. Duplicate finalization cannot
create another proof or audit; a stale or expired finalization is recorded as
denial and cannot mint a proof. If finalization cannot complete, the
already-reserved attempt remains consumed until the window rolls.

Each admitted denial and success writes an audit record through the reservation
transition. A blocked admission writes a bounded `blocked` audit event with a
fresh internal event ID after the atomic guard rejects it; it never runs
bcrypt. The record contains the reservation/event ID, outcome code,
selector/resource digests, license UUID when already resolved, both generation
values, and timestamp. It contains no password, hash, raw IP, user-agent,
cookie, or request body. Retention and aggregate reporting are administrative
operations; no anonymous read endpoint exposes this table.

All verification failures use the same JSON error code and status for wrong
password, missing/disabled/expired access, unsupported hash, and stale proof.
Malformed JSON or an over-bound request may be a generic `400`; a D1 failure
may be a generic `503`. A cooldown response does not include a precise retry
time. This keeps password validity and resource existence from becoming an
oracle while still allowing operational monitoring through the private audit.

## CORS, CSRF, and proof use

The anonymous routes remain credential-free and keep their existing public CORS
policy. Verification and protected routes are a separate credentialed surface:

- same-origin Static Assets is the preferred deployment shape;
- if the app and Worker origins differ, only the exact configured origins may
  receive `Access-Control-Allow-Credentials: true`;
- `Origin` is checked against that allowlist on every verification POST, and a
  wildcard origin is invalid;
- a protected GET without an `Origin` must include the reviewed
  `Sec-Fetch-Site: same-origin` signal; missing or cross-site metadata is
  denied;
- `Vary: Origin`, `no-store`, bounded JSON, and the host-only cookie are
  required; caller `Authorization` and arbitrary cookies are ignored;
- the frontend uses `credentials: "include"` only for these routes and never
  stores or sends the proof as a JavaScript bearer token.

The protected short-ID and emoji operations return only the same allowlisted
fields as the anonymous projection, adding content only after the proof
checks. When the selected content includes a public profile, its allowlisted
profile projection is nested in that same response and guarded by the same
selector/license statement. A protected redirect returns a validated `http`,
`https`, or approved `tel` target in JSON; the frontend performs the navigation
after the response. A protected text operation returns message content only
after the proof. A direct protected profile operation returns the published
profile allowlist and never owner, identity, history, lottery, favorite, or
account fields; it accepts only a profile-origin proof. OGP remains locked
metadata and does not possess a password proof.

## Frontend migration and rollback

The existing `PasswordProtection` component currently calls the Supabase
`verify_fanmark_password` RPC and then treats local React state as the unlock
signal. The target client flow is:

1. keep the anonymous access response as the source of the selected selector,
   license, access type, and locked state;
2. post the password to the selector-specific Worker verification route;
3. on `204`, refetch the selector-specific protected route with credentials;
4. render redirect, text, or profile only from that server response;
5. clear local content when the selector changes and rely on cookie expiry or
   a future revoke route for proof removal.

The UI must not set an unlocked flag that can authorize a read by itself, send
the password to both Supabase and Worker, or fall back from a protected Worker
failure to anonymous protected content. Keep the existing Supabase verifier
until the Worker path passes the gates below. A feature flag can enable the
Worker verification for a synthetic/staging cohort and disable it without
changing the anonymous read routes or deleting source password configuration.

## Required gates

Before a frontend switch or old-password-path shutdown, the following evidence
is required:

1. **Source mapping:** read-only classification of all password-config schemes,
   duplicate/orphan/license relationships, and UUID preservation. Existing
   password behavior is preserved; every non-bcrypt class has an approved
   private conversion/import rehearsal or an explicit owner decision when
   conversion is impossible. Re-enrollment is not the default shortcut.
2. **Local Worker/D1 proof:** correct and wrong `$2a$10$`/`$2b$10$` checks;
   neutral unknown/missing behavior; no proof after a failed check; proof
   selector/license binding; profile nested for short/emoji proofs and direct
   profile proof isolation; protected text, redirect, and profile reads;
   generation invalidation on password change, disable, license return/expiry,
   and profile visibility change; no secret/hash/IP in responses or audit.
3. **Atomic abuse controls:** selector rotation still hits the same persistent
   requester bucket; concurrent attempts from multiple Worker instances cannot
   consume only one bucket; in-flight reservations consume capacity before
   bcrypt; cooldown survives instance restart; successes do not erase another
   in-flight failure; old proofs fail after version changes.
4. **CPU and D1 staging:** synthetic load measures actual Cloudflare CPU for the
   chosen bcrypt cost, request parsing, D1 writes, and concurrency on the
   target plan. The local wall-clock result is not a CPU measurement and must
   not justify lowering the legacy cost.
5. **Protected-route security:** exact-origin CSRF checks, cookie flags, no-store
   behavior, selector mismatch, malformed proof, replay after expiry, and
   anonymous-route credential isolation pass against the deployed staging
   Worker.
6. **Frontend canary:** one staging fanmark per access type and profile, with
   rollback to the existing path, confirms no redirect/text/profile content is
   rendered before the protected response arrives.

Until these gates pass, keep the Worker password surface disabled and retain
the existing Supabase path. Do not treat Better Auth's email/password or MFA
proof as evidence for this separate anonymous fanmark authorization.

## Implemented local proof slice

The implementation is isolated under `experiments/cloudflare-auth/`. It does
not register routes in `workers/api`, the frontend, production Wrangler
bindings, or the root migration. Files and ownership are:

- `src/verified-access-proof.mjs` owns canonical selector hashing, requester
  and resource bucket derivation, reservation/finalization helpers, bcrypt
  comparison, proof-cookie issuance, and the single-statement protected-read
  guard. It accepts no caller-supplied reservation or unlocked flag.
- `test/fixtures/verified-access.sql` owns only synthetic D1 tables, indexes,
  triggers, and rows for the proof. The reservation insert trigger must reject
  when either bucket is blocked and increment both `attempt_count` values only
  after both pass. The finalization trigger increments both failure counters
  only on a reserved-to-failure transition. Tests must execute complete SQL
  statements (including trigger bodies), not split migration text naively on
  semicolons.
- `test/verified-access.test.mjs` owns local HTTP proof tests for the
  short/emoji/profile selector matrix, nested-profile behavior, wrong and
  correct `$2a$10$`/`$2b$10$` hashes, generation invalidation, reservation
  races, selector rotation against the requester bucket, no partial bucket
  consumption, success-without-reset, cooldown persistence, and audit
  redaction.
- `wrangler.verified-access.jsonc` and
  `vitest.verified-access.config.mjs` own the test-only D1 binding and entry
  point. The default Worker entry point must not import or register these
  routes. Existing pinned dependencies remain in `package.json`; no production
  password or OAuth secret is added.

This proof can establish local ordering and authorization invariants. It cannot
establish the source password-format mapping or the target Cloudflare CPU
budget; those remain private preflight and staging gates.

## Local validation evidence

Node 22.6.0 independently passed all 17 dedicated proof tests and all six
existing account-auth tests. The dedicated suite runs sequentially against
its separate synthetic D1 binding and is excluded from the default auth
suite. CI invokes both commands explicitly. Tests include delayed old-window
requests, cooldown across a window boundary, once-only finalization, stale
proof insertion, selector/profile reassignment, and license delete/recreate
invalidation. Test-only address overrides are confined to hooks. Originless
same-origin GET requests use Fetch Metadata while verify POST requests
require the configured Origin.

This is synthetic local evidence. Existing-password conversion, production
writers and invalidation, full source behavior parity, remote CPU, browser
integration, deployment, and cutover remain unverified.

## References

- [Better Auth email and password](https://better-auth.com/docs/authentication/email-password) — default scrypt and the custom `password.hash`/`password.verify` hooks.
- [Better Auth Cloudflare D1 support](https://better-auth.com/blog/1-5) — direct D1 binding and the D1 `batch()` limitation on interactive transactions.
- [Better Auth two-factor plugin](https://better-auth.com/docs/plugins/2fa) — TOTP/session behavior kept separate from this fanmark proof.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU and request limits for the staging measurement gate.
- [Local auth feasibility record](auth-feasibility.md) — pinned Better Auth `1.7.5`, `bcryptjs 3.0.3`, synthetic bcrypt/UUID/session proof, and unresolved production gates.
- [Local bcrypt verifier configuration](../../experiments/cloudflare-auth/src/index.mjs) and [tests](../../experiments/cloudflare-auth/test/auth.test.mjs) — implementation evidence only; they contain synthetic data and no production credentials.

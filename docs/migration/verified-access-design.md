# Verified public fanmark access design

The Worker implementation for password-protected public fanmarks is connected
to the source-shaped D1 profile and enabled on the workers.dev staging app only.
The frontend uses the matching Worker selector there; production continues to
use the Supabase path. A live synthetic four-digit password verification and
protected read passed and all canary rows were removed. No real password values
or user rows have been moved. Compatibility for each imported source hash
format and Cloudflare CPU/plan fit remain separate gates.

`workers/api/src/verified-access.mjs` implements the gated routes.
`scripts/migration/verified-access-schema.mjs` generates, applies, and reads
back the proof/rate-limit extension against the exact source, lifecycle,
generation, and credential-transform plans. Local Miniflare tests exercise
the route both on a focused fixture and on a synthetic row in the latest
40-table profile. The live canary verifies the selected staging route with a
new synthetic hash; it is not a live password-format preflight for migrated
users or Cloudflare CPU-fit evidence.

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

The current migration target already generates the lifecycle tables below.
The verifier must reuse their exact names and columns; it must not introduce a
second lifecycle counter:

```text
fanmark_license_incarnations
  license_id              TEXT PRIMARY KEY
  incarnation             INTEGER NOT NULL

fanmark_access_versions
  license_id              TEXT PRIMARY KEY REFERENCES fanmark_licenses(id)
  license_incarnation     INTEGER NOT NULL
  password_generation     INTEGER NOT NULL
  access_generation       INTEGER NOT NULL
  updated_at              TEXT NOT NULL

fanmark_access_proofs
  id                      TEXT PRIMARY KEY
  token_hash              TEXT UNIQUE NOT NULL -- SHA-256 only
  finalization_id         TEXT UNIQUE NOT NULL
  selector_kind           TEXT NOT NULL
  selector_hash           TEXT NOT NULL -- SHA-256 only
  fanmark_id              TEXT NOT NULL REFERENCES fanmarks(id)
  license_id              TEXT NOT NULL REFERENCES fanmark_licenses(id)
  password_generation     INTEGER NOT NULL
  access_generation       INTEGER NOT NULL
  license_incarnation     INTEGER NOT NULL
  created_at              TEXT NOT NULL
  expires_at               TEXT NOT NULL

fanmark_access_rate_policy
  id                      INTEGER PRIMARY KEY CHECK (id = 1)
  window_ms               INTEGER NOT NULL
  max_attempts            INTEGER NOT NULL
  reservation_ms          INTEGER NOT NULL

fanmark_access_rate_limits
  bucket_kind             TEXT NOT NULL -- requester or resource
  bucket_hash             TEXT NOT NULL -- HMAC-SHA256 only
  window_id               INTEGER NOT NULL
  window_started_at       INTEGER NOT NULL -- Unix milliseconds
  window_expires_at       INTEGER NOT NULL
  attempt_count            INTEGER NOT NULL
  failure_count            INTEGER NOT NULL
  cooldown_until           INTEGER -- Unix milliseconds
  updated_at              INTEGER NOT NULL
  PRIMARY KEY (bucket_kind, bucket_hash)

fanmark_access_attempt_reservations
  reservation_id          TEXT PRIMARY KEY
  requester_bucket_hash   TEXT NOT NULL
  resource_bucket_hash    TEXT NOT NULL
  license_id              TEXT REFERENCES fanmark_licenses(id)
  selector_hash           TEXT NOT NULL
  window_id               INTEGER NOT NULL
  reserved_at             INTEGER NOT NULL -- Unix milliseconds
  reservation_expires_at  INTEGER NOT NULL
  outcome                 TEXT NOT NULL
  finalization_id         TEXT UNIQUE
  completed_at            INTEGER

fanmark_access_attempt_audit
  id                      TEXT PRIMARY KEY
  reservation_id          TEXT NOT NULL
  license_id              TEXT
  selector_hash           TEXT
  requester_hash          TEXT NOT NULL
  outcome                 TEXT NOT NULL
  occurred_at             INTEGER NOT NULL -- Unix milliseconds
  password_generation     INTEGER
  access_generation       INTEGER
  license_incarnation     INTEGER
```

The generated extension adds lookup/expiry indexes and four reservation
triggers for dual-bucket admission, attempt counting, expiry checks, and
failure cooldown updates. Its singleton policy row starts at five attempts per
five-minute window, a 30-second reservation, and a one-minute cooldown after
the limit. The table definitions contain no password/hash value, raw IP
address, user-agent, or browser token; only token and requester/resource
digests are stored. A reservation ID is an internal single-attempt reference
and is never accepted from a caller or exposed as a proof.

`password_generation` increments when a password value, enabled flag, or
password-config identity changes. `access_generation` increments when the
parent fanmark selector/status or selected basic, redirect, messageboard, or
profile configuration changes. `license_incarnation` is copied from the
retained `fanmark_license_incarnations` registry and changes when a license is
deleted and recreated. These are the current generated target fields; the
separate `fanmark_licenses.lifecycle_generation` used by lifecycle jobs is not
a verifier generation. The credential-transform artifact's expected
generations are checked when reconciling that import; they are not live proof
generations and need not equal current versions after later authorized writes.
D1 triggers or the only authorized mutation repository must cover every
writer. A version change may delete proofs for the affected license, but
deletion is cleanup; the equality checks below are the immediate invalidation
mechanism.

For a short-ID selector, the Worker chooses the latest eligible active license
using the same expiry ordering as the public read and rejects a tie on the
selected expiry. Emoji access requires exactly one eligible finite license.
The final proof write rechecks that selection after bcrypt so a renewal racing
the comparison cannot mint a proof for the former license.

The protected projection must check, in one D1 statement, all of the
following before selecting content:

1. the proof token hash and selector hash match;
2. the proof license and fanmark match the currently selected rows;
3. proof expiry is in the future;
4. `password_generation`, `access_generation`, and `license_incarnation` match
   the current version and retained incarnation rows;
5. `fanmarks.status` and `fanmark_licenses.status` are active,
   `fanmark_licenses.is_returned` is false, and `license_end` is null or in the
   future;
6. the `fanmark_password_configs` row is still enabled and belongs to that
   license, with exactly one matching credential-evidence row. For an imported
   credential this is a reconciled credential-transform artifact proving that
   the current `access_password` is its exact bcrypt destination hash. For a
   password set later through the Worker owner-settings API, it is a
   hash-free `fanmark_password_runtime_evidence` row matching the current
   license incarnation, password generation, enabled state, and pinned codec;
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

The current source-shaped target has no `hash_scheme` column and no aggregate
`fanmark_access_configs` table. Password values remain in
`fanmark_password_configs.access_password`; access mode/name are in
`fanmark_basic_configs`; redirect and text values are in
`fanmark_redirect_configs` and `fanmark_messageboard_configs`; profile fields
are in `fanmark_profiles`. Short-ID and emoji lookup use `fanmarks.short_id`
and `fanmarks.normalized_emoji_ids`; there is no `fanmark_emoji_selectors`
table.

The migration preflight must classify source password-config values without
exporting their contents. For each enabled row it records only the scheme
class, cost/prefix class, UUID relation, and import outcome. Existing password
behavior and license/config UUIDs are preserved; asking an owner to choose a
new password is not the default migration strategy. Runtime bcrypt eligibility
must be proven by exactly one `credential_transform_artifacts` row in
`reconciled` state whose pinned `codec_id` is `bcryptjs@3.0.3`, whose
`destination_hash` equals the current `access_password`, and whose destination
license and incarnation match the current license identity. Its expected
password/access/lifecycle generations must have passed import-time
reconciliation, but do not need to equal live generations after later
authorized writes. The live proof instead binds to the current
`fanmark_access_versions` generations. A string prefix by itself is not proof
of scheme or import provenance. An unknown, plaintext, malformed, unsupported,
or unreconciled value is never compared as a real password by a public Worker.
There is no runtime plaintext fallback, and the source-format mapping remains
unresolved until that private preflight is complete.

An authorized Worker password change is a distinct post-import operation: it
must not fabricate or rewrite the immutable import ledger. In the same D1
batch as the owner-checked password-config write, the settings API records only
the license ID, current incarnation, current password generation, enabled
flag, pinned `bcryptjs@3.0.3` codec, and timestamps in
`fanmark_password_runtime_evidence`. The table deliberately has no password or
hash column. A trigger-driven generation change, license deletion/recreation,
or changed enabled state makes the row stop matching. The verifier unions
import-artifact and runtime evidence, then still requires exactly one matching
row and the pinned codec; absent, duplicate, stale, or mismatched evidence
fails closed.

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
the budget. The local policy row uses five attempts per five-minute window and
a one-minute cooldown. This is a staging rehearsal value, not tuned from
production load. A wrong-password finalization transitions the reservation
once and increments `failure_count` plus cooldown state in both buckets. A
successful comparison never resets another reserved or failed attempt. The
transition and its audit insert are one guarded batch;
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

## Connected local source-shaped proof

`workers/api/src/verified-access.mjs` implements the password routes and is
registered by `workers/api/src/index.ts` only when
`VERIFIED_ACCESS_BACKEND=d1`, the business D1 binding, and the verification
secret are present. The staging flag remains unset and the frontend continues
to use Supabase for password verification. The Worker reads current source
tables and generation state from the same synthetic 40-table D1 profile used
by the lifecycle rehearsal; it also checks credential-transform provenance
before accepting a password hash. This is local integration evidence, not a
staging deployment or approval to switch the frontend.

`scripts/migration/verified-access-schema.mjs` generates and applies the
version-2 rate-limit/proof extension against exact source, lifecycle,
generation, and credential-transform plan digests, then verifies the exact
installed object set and idempotent reapplication. Its guarded v1-to-v2 path
accepts only an exact v1 inventory missing the new runtime-evidence table,
creates that table, and verifies exact readback; partial, changed, and
unexpected objects are rejected. Local integration covers fresh apply,
idempotent apply, and the v1-to-v2 upgrade. The extension is present only in
disposable local tests; the remote business D1 has only the structural v4
baseline and no imported rows.

The current focused checks are:

- `workers/api/test/verified-access-d1.test.ts`: 10 Miniflare D1 tests covering
  selector binding, license ordering/ties, changed state during bcrypt,
  imported/runtime credential evidence, stale generation rejection, rate
  controls, and protected projections.
- `workers/api/test/license-expiry-source.integration.mjs`: 20 passing checks
  against the latest synthetic 40-table profile, including a synthetic
  credential-transform artifact, exact extension readback, the v1-to-v2
  extension upgrade, and a protected-text verification/read.
- `workers/api/test/fanmark-settings-d1.test.ts`: 6 tests for owner-only
  settings reads, redaction, atomic writes, runtime evidence, and rollback.
- Worker and frontend TypeScript typechecks pass on Node 22.6.0.

`src/lib/verified-access-api.ts` supports an explicit
`VITE_VERIFIED_ACCESS_BACKEND=worker` choice. The short-ID and emoji pages use
the same backend for anonymous lookup and password verification; they reject
mixed selection. The client posts the password once, then reads the protected
projection with the HttpOnly proof cookie, credentials included, `no-store`,
bounded response parsing, and no fallback. Protected profile data is passed
directly to the profile renderer so it does not make a second anonymous
profile request. Seven client contract tests and the frontend typecheck pass.
The selector remains unset in staging, and no browser canary has been run.

The earlier `experiments/cloudflare-auth/` proof remains a separate account
auth/MFA experiment; it is not the route implementation. Remaining gates are
the source password-format inventory and approved credential transform/import
path, Cloudflare plan/CPU measurement, multi-instance staging abuse-control
checks, deployed-origin CSRF/cookie checks, and a frontend canary. Keep the
Worker feature flag off and the existing Supabase path active until those gates
pass. No real passwords, user rows, production DDL, or domain settings were
changed by these local proofs.

## References

The protected-access route stores and checks retained license incarnation
independently of password/access generations. A delete/recreate with the same
UUID and equal generation values cannot finalize an older password
verification. Target lookup, proof creation, and protected projection require
the incarnation authority. The source-shaped route test verifies synthetic
protected text only; it does not establish compatibility with real stored
passwords or Cloudflare CPU fit.

- [Better Auth email and password](https://better-auth.com/docs/authentication/email-password) — default scrypt and the custom `password.hash`/`password.verify` hooks.
- [Better Auth Cloudflare D1 support](https://better-auth.com/blog/1-5) — direct D1 binding and the D1 `batch()` limitation on interactive transactions.
- [Better Auth two-factor plugin](https://better-auth.com/docs/plugins/2fa) — TOTP/session behavior kept separate from this fanmark proof.
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU and request limits for the staging measurement gate.
- [Local auth feasibility record](auth-feasibility.md) — pinned Better Auth `1.7.5`, `bcryptjs 3.0.3`, synthetic bcrypt/UUID/session proof, and unresolved production gates.
- [Local bcrypt verifier configuration](../../experiments/cloudflare-auth/src/index.mjs) and [tests](../../experiments/cloudflare-auth/test/auth.test.mjs) — implementation evidence only; they contain synthetic data and no production credentials.

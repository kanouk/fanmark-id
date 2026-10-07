# Invitation-gated Better Auth signup on D1

## Scope and current state

This slice moves invitation validation, signup identity creation, email verification, and the matching business profile onto the Cloudflare path. The implementation and integration tests are in draft PR #41. The 2026-10-06 staging checkpoint on Worker `471faabe-3aff-4312-ba22-cd326dc821e1` selected `INVITATION_SIGNUP_BACKEND=d1`, `AUTH_EMAIL_BACKEND=resend` and D1 email templates, with the Resend secret binding present. The 2026-10-06 read-only capability GET returns `signUp`, `emailVerification` and `passwordReset` true, and `invitationRequired` false. A fresh read-only capability GET on 2026-10-07 still returns signup/verification/reset enabled, invitationRequired=false and the four social providers. Registration remains open without a required invitation. [Current configuration and capability evidence](evidence/staging-invitation-capabilities-current-2026-10-06.json).

Earlier actual email signup/verification and password recovery/login have separate bounded evidence: [verification delivery](evidence/resend-staging-verification-delivery-2026-10-05.json), [reset completion](evidence/staging-email-password-reset-completion-2026-10-05.json), and [password login](evidence/staging-email-password-login-2026-10-05.json). The new GET does not repeat or extend those tests, and does not accept invitation-required signup/consumption or provider signup.

## Public contract

- `GET /api/auth/capabilities` advertises signup only when the explicit `INVITATION_SIGNUP_BACKEND=d1` selector, both signup schema migrations, a readable `system_settings.invitation_mode`, and Resend email delivery are all ready. It separately reports whether an invitation code is required.
- `POST /api/auth/invitations/validate` returns only validity, remaining available uses after active reservations, and the public perks object. It is bounded, same-origin/CORS protected, and `no-store`.
- `POST /api/auth/sign-up/email` accepts an email, password, UUID command ID, optional invitation code, and supported language. It never falls through to Supabase. The Worker reserves a slot before calling Better Auth, sends verification through the configured Resend callback, and creates the source-shaped `user_settings` profile before marking the command complete.

The Cloudflare signup UI appears only when the capability response enables it. In Worker mode the invitation input uses the Worker API and the Supabase waitlist form is hidden. Production's existing Supabase signup path is unchanged.

## Cross-D1 recovery and data boundary

Auth D1 and business D1 cannot share one transaction. Business D1 therefore stores a durable command ledger with an HMAC-SHA-256 email fingerprint, invitation-code ID, supported language, state, lease, and Auth user ID. It never stores raw email or password. Auth D1 adds a nullable, unique, client-hidden `signupCommandId` to the Better Auth user row so a lost Worker acknowledgement can be recovered without matching by email or creating a second identity.

The command progresses through `reserved` → `auth_created` → `completed`; known requests that create no Auth identity release the reservation. If Auth committed but the response was lost, a retry finds the internal marker. A retry after browser reload can also recover the open command by the keyed email fingerprint. A failed verification-email call leaves the command in `auth_created`; retry sends the message and then resumes profile finalization. Completed retries do not consume another invitation use. An Auth-created attempt keeps its invitation slot until finalization, and the D1 trigger consumes the slot only when the profile and command complete in one business-D1 batch.

The generated profile uses the source signup defaults: `user_<first eight ID characters>`, the same initial display name, free plan, preferred language, invitation attribution, and password-setup flag `false`. Better Auth does not issue a session before email verification.

## Schema and verification

- `workers/api/migrations/0007_auth_signup_command.sql`: private Auth D1 recovery marker.
- `workers/api/migrations-business/0014_invitation_signup_attempts.sql`: business-D1 reservation ledger, capacity guards, and transactional invitation consumption.
- `npm --prefix workers/api run test:invitation-signup-d1`: 15 synthetic split-D1 cases against all 25 Business migrations and Auth core/0007/0008, including depleted invites, last-slot contention, duplicate-email privacy, email failure/retry, browser-reload recovery, lost-ack recovery, four language/source privacy defaults and forged provisioning metadata. Both databases are checked for foreign-key violations after each case. See [source signup provisioning](source-signup-provisioning.md) for the PostgreSQL literal oracle and remaining OAuth boundary.
- `npm run test:better-auth-client`: Worker client request/response contract.

The local test intercepts the Resend API with a synthetic handler. It does not establish delivery-domain readiness, real-message deliverability, OAuth, or live signup acceptance. The initial schema/deployment checkpoint confirmed the reservation table and four triggers with zero attempt rows, the Auth recovery marker column and no pending migrations. At that historical checkpoint `signUp` was false and Resend/signup configuration was absent. The current configuration and subsequent actual email-flow evidence are recorded above; do not treat the old closed gate as current state.

## Staging gate

The initial staging enablement gate required review of the invitation-mode row, invitation records, Resend delivery configuration and the explicit D1 signup selector. That selector is now enabled. Any later change to require invitations still needs its own configuration review and actual signup/consumption acceptance; the current capability GET is read-only and changes no mode or code. User/profile/Auth data import remains part of the final data migration, and the public domain cutover remains last.

## Actual local browser flow (2026-10-07)

Run `npm run test:staging-invitation-signup-local`. The test builds the real application with all
45 staging frontend selectors, bundles the application Worker with `conditions: ["workerd"]`,
and applies all 27 Business, 4 Auth and 8 Master migrations to isolated native local D1.
It seeds synthetic settings, ready emoji/reference releases and a one-use invitation. A loopback
HTTPS bridge forwards each browser API request to the real Worker; it does not replace responses.
Only the upstream Resend API returns a synthetic receipt and exposes its generated verification link
to this owned fixture. No real email is sent. All other Worker egress and non-loopback browser egress
are denied. Real provider secrets, source rows, staging settings and retained accounts are not used.

A real headless Chrome switches the signup tab, rejects an invalid invitation, applies the valid
code, submits registration, follows the verification link, signs in with the submitted password,
reaches the rendered dashboard, signs out and rejects the fully-used code. D1 readback requires:

- one UUID command/user/profile with exact invite attribution, free plan and Japanese language;
- invitation consumption exactly once, completed command marker and no extra user after code reuse;
- unverified password login denied, no session before/after verification, one after login, zero after logout;
- actual profile/owned-fanmarks/subscription/analytics APIs return 200 for the browser session;
- all three stores have zero FK violations and no observed application API has a 5xx response.

Google capability is available before requiring invitations, then suppressed by the actual policy.
This checks the local Google gate, not a real OAuth callback. The build must contain native
`node:async_hooks` and must not contain the browser AsyncLocalStorage polyfill: that polyfill lost
request state under the concurrent dashboard reads in an earlier rejected test bundle. Missing
synthetic settings and wrong harness selectors were also corrected before accepting the final flow.
The application backend needed no code change. The dashboard screenshot was inspected at 1280×960
with no error toast. Owned Chrome profile/server/runtime are stopped/disposed on completion.

Unexpected CDP interception errors fail acceptance. Page-canceled local requests use the shared
receipt helper and require the matching Chrome Network cancellation receipt; unknown failures are
not silently ignored. The test is included in application CI. [Bounded evidence](evidence/invitation-signup-local-browser-2026-10-07.json).
Actual staging invitation-required signup/consumption and real verification delivery for a new
invited identity still need their own acceptance. The previous staging mail account is retained and
already registered; a separate unregistered test recipient has been requested. Physical mobile,
other full language flows and final integrated-candidate acceptance remain separate.

# Invitation-gated Better Auth signup on D1

## Scope and current state

This slice moves invitation validation, signup identity creation, email verification, and the matching business profile onto the Cloudflare path. The implementation and integration tests are in draft PR #41. Both additive D1 migrations are applied to staging and the updated app Worker is deployed, but the signup selector and Resend credentials are absent, so signup remains closed. No invitation-code records were seeded and no message was sent to Resend.

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
- `npm --prefix workers/api run test:invitation-signup-d1`: 9 synthetic split-D1 cases, including depleted invites, last-slot contention, duplicate-email privacy, email failure/retry, browser-reload recovery, lost-ack recovery, and exact profile/usage readback.
- `npm run test:better-auth-client`: Worker client request/response contract.

The local test intercepts the Resend API with a synthetic handler. It does not establish delivery-domain readiness, real-message deliverability, OAuth, or live signup acceptance. After the schema was applied and the Worker deployed, readback confirmed the reservation table and four triggers exist with zero attempt rows, the Auth recovery marker column exists, and neither database has pending migrations. The staging Worker returns `signUp: false`; Resend secrets and `INVITATION_SIGNUP_BACKEND` are absent.

## Staging gate

Before enabling signup on staging, verify the intended invitation-mode row and invitation records, configure the Resend secret/from address, then explicitly set `INVITATION_SIGNUP_BACKEND=d1`. Keep the selector unset until that review is complete. User/profile/Auth data import remains part of the final data migration, and the public domain cutover remains last.

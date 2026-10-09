# Source signup provisioning review

The source runtime snapshot records enabled
`auth.users.on_auth_user_created -> public.handle_new_user()`. It is an Auth
provisioning dependency, despite not belonging to a public table. Reviewed
definition SHA-256:
`09d55e8ddc314623b0fb0ac876d0e5c57ff8f444d8d39493a3c27a80690007a9`.
The v41 observation and all-schema hash comparison are described in
[source runtime review](source-runtime-review.md). No existing Auth or Business
user rows were read or migrated by this review.

## Credential signup counterpart

The actual frontend `src/hooks/useAuthForm.tsx` sends email/password and browser
language to Supabase signup; it does not send username, display name or plan.
Optional invitation attribution is updated through a separate source operation.
Cloudflare instead commits attribution and invitation consumption with profile
creation in one Business D1 batch.

| Source trigger behavior | Credential Worker counterpart |
| --- | --- |
| Default username is `user_` plus the first eight Auth ID characters | Server derives the same value from the returned Auth identity |
| Default display name equals username, protecting the email prefix | Server uses that username, never the email prefix |
| Missing plan defaults to Free | SQL inserts literal `free`; browser metadata cannot choose a plan |
| Missing language defaults to Japanese; source enum accepts en/ja/ko/id | Coordinator captures a supported language in its durable command |
| Credential password-setup default is false | SQL inserts integer 0; the profile DTO separately decodes it as boolean |
| `invited_by_code` is raw-metadata-dependent | Command uses the validated reservation's actual code, consuming it once |

The target deliberately does not expose all source raw-metadata options.
Custom source username/display name/plan/setup metadata and invalid enum casts
are not an accepted target browser signup contract. Forged user IDs,
verification flags, plan, roles and nested metadata are not forwarded to Auth
or Business D1. Unsupported-language fallback is a target input rule; arbitrary
source metadata is not claimed to behave identically.

New target Auth IDs explicitly use Better Auth's UUID generator. The SDK's
default32-character IDs were reproduced as incompatible with UUID actor
validators in billing APIs; preserving imported UUID fixtures had not covered
new creation. This setting does not rewrite existing IDs.

The native signup suite uses all 25 canonical Business migrations, Auth
core/0007/0008 and `AUTH_USER_STATUS_BACKEND=d1`. Its 15 cases include reservation,
capacity/concurrency/lost-ack/email-failure/replay paths, four languages, exact
private username/display defaults, unverified/unbanned Auth fields and forged
metadata. Foreign-key checks run after every case. Resend is intercepted by a
synthetic handler; this is not live email or signup acceptance.

## Literal PostgreSQL evidence

`scripts/migration/source-signup-provisioning-oracle.sql` evaluates only literal
expressions from the reviewed definitions inside `BEGIN READ ONLY`. It reads
no application/Auth rows and invokes no stored application function or trigger.
Source enum types participate in casts. Observation
`2026-10-02T23:37:22.267767+00:00` contains six provisioning and four helper
cases. SQL SHA-256:
`4a23202c63888fbcecdd19172d53b404d04b8a85301a505f3474ca1f9f69ce42`.
Synthetic results are checked in at
`workers/api/test/fixtures/source-signup-provisioning.json`; credential tests
compare plan/language/setup values to those PostgreSQL results. This proves
those expressions, not execution of the actual source trigger.

## Separate ordinary helper and OAuth work

`generate_safe_display_name(text,uuid)` is an ordinary stable/security-definer
function, SHA-256
`1f7d9d417a3b37d4b8260e093d3ec8b37ac2b8d615fbe202c9d22374ca970852`.
It extracts text before the first `@`, including an empty prefix, or uses the
UUID-derived fallback for an email lacking `@` or NULL. It performs no collision
or localization handling. `handle_new_user` does not call it. No executable
frontend/Edge reference was found outside generated types; the only other
captured function-body reference is the currently unbound `validate_display_name`
trigger definition. External/direct RPC callers remain unknown. Do not classify
this ordinary helper as inactive or add email-derived display-name rewriting.

Source OAuth provisioning identifies non-email providers and certain raw
metadata keys, then sets `requires_password_setup=true`. The literal Google
case demonstrates that source branch; it does not prove a target counterpart.
Target social providers default to `disableSignUp:true`. The gateway now rereads Business D1
`social_login_enabled` and `invitation_mode` for capabilities/start/callback;
Auth47/47 covers policy refusal, settings changes and existing-user linking under
all25 Business migrations. This policy change does not create new users. Synthetic Auth tests already
cover callbacks and linking to an existing UUID; the initial-password API and
gate are implemented with synthetic coverage in
[password setup](password-setup-api.md). A new OAuth user's Business profile
provisioning counterpart now has a native synthetic implementation selected by
`AUTH_SOCIAL_PROVISIONING_BACKEND=d1`, with Auth migration0009, server-only
provider-subject markers and recoverable split-D1 writes. The54 native cases
include all four new-user callbacks and first password setup, account/profile/
completion pre-commit and lost-ACK faults, identity conflicts, suspension,
state replay and schema readiness. See [OAuth registration](oauth-signup-provisioning.md).
Code47b69c5, Auth0009 and its backend selection are deployed in staging. A seeded
marked-user session guard canary5 and the real browser editor/favorites canary
pass, with owned Auth/Business0 after cleanup and independent baseline readback.
This does not prove remote SDK new-user/new-OAuth-credential creation; the complete real-provider callback,
provisioning and initial-setup flow still needs integration acceptance. Provider
credentials remain absent. Credential or synthetic proof cannot clear this Auth binding
for the complete migration. The function/RLS/trigger gate and real provider,
mobile and remote acceptance remain open.

## Native invitation-required acceptance (2026-10-08 JST)

The Japanese native signup now accepts invalid/valid invitation interaction,
one-time capacity consumption, server-derived Free/JA defaults and invitation
attribution, followed by verification/login/logout and independent exact-owned
cleanup. See [native proof](evidence/staging-invitation-signup-native-2026-10-08.json)
and [source counterpart linkage](evidence/source-invitation-counterpart-acceptance-2026-10-08.json).
This replaces the prior invitation-consumption evidence gap. It does not accept
new Apple/Discord identity provisioning, Apple relay, arbitrary external callers
or the final integrated candidate.

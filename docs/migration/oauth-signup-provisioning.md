# Recoverable new OAuth registration

The Worker implementation is a **local synthetic acceptance candidate**.
`AUTH_SOCIAL_PROVISIONING_BACKEND=d1` explicitly selects it; an absent selector
keeps provider `disableSignUp=true`. Staging has not applied Auth migration
`0009_auth_oauth_signup.sql` or selected this new backend. Real provider keys,
remote new-user acceptance and the complete migration remain open.

## Creation and identity

`workers/api/src/oauth-signup-provisioning.mjs` integrates through Better Auth's
public provider factories, request state and database hooks. Before redirect,
the server assigns command/profile UUIDs, provider and supported language using
`addOAuthServerContext`. Better Auth overwrites client-supplied
`additionalData.serverContext`; provider profile fields cannot assign these
markers. The existing UI supplies no OAuth language, so the default is Japanese.
The supported optional language values are `ja`, `en`, `ko` and `id`.

On a validated callback, the original factory retrieves provider information
and resolves the same account namespace used by Better Auth: Google/Apple
claims `sub`, GitHub/Discord profile `id`. Email, public name and avatar do not
establish identity. A WeakMap binds that proof to the current parsed request
state, rather than storing a last-user value in the cached Auth instance.
Database hooks receive `/callback/:id`, with the provider in `params.id`.
Apple's POST callback follows the SDK's same-origin GET redirect.

A new Auth user stores six private recovery fields: command UUID, preassigned
profile UUID, provider, subject, language and pending/completed state. They are
server-only and omitted from returned session/user data. Auth migration0009
adds unique command/profile/provider-subject indexes and an unconditional
unique provider/account key index. The gateway requires the marker/status
columns, Business profile columns and exact unique-index definitions before
opening OAuth when the new backend is selected. Missing schema, partial
migration, altered uniqueness or read errors close capabilities/start/callback.
The existing social-login/invitation policy is reread independently as well.

## Cross-D1 recovery

D1 lacks interactive transactions for the SDK's separate user/account writes.
Auth and Business databases also do not form one transaction. No failure path
deletes Auth or Business rows to simulate rollback.

Before a first session, the pending user's original provider key must have
exactly one matching account owner. Business provisioning inserts the assigned
profile UUID with `user_<first8 Auth UUID>` as username/display name, literal
Free plan, the captured language and `requires_password_setup=1`. Email prefixes
and provider public names are not used for the public default. The profile's ID
and owner are independently read back before the Auth marker becomes completed.
Suspension is checked before account repair and before profile writes; the core
session guard still runs. Disabling signup cannot bypass a pending marker.

If account creation failed, a later validated callback for the exact durable
provider/subject can repair a missing account before SDK email lookup. Its
conditional insert and unique key prevent another owner or duplicate repair.
The repair stores no new provider token itself; the SDK processes the callback.
An unverified email is never used as recovery ownership proof. Another subject
or provider with the same email cannot claim a pending identity.

A committed profile whose acknowledgement was lost is recognized by the
original assigned ID. A completion acknowledgement lost after Auth commit is
recognized on the next callback. Conflicting IDs/owners or usernames refuse
login without overwriting the conflicting profile or inventing a fallback name.
A completed user's edited profile is preserved; a missing completed profile is
not recreated. Initial password setup uses the existing owner-only API and
changes the profile flag only after its credential proof.

## Verification and activation boundaries

`npm --prefix workers/api run test:oauth-signup-d1` runs the real Worker gateway
and Better Auth against native split local D1: all25 Business migrations and
Auth core/0007/0008/0009. It is also part of the Worker CI `npm test` command.
External provider HTTP is intercepted with synthetic credentials and responses;
this is not real Google/GitHub/Discord/Apple acceptance.

The 54 cases cover all four providers through new UUID/session creation,
private profile defaults, forged metadata, initial password setup and repeat
login; pre-commit and lost-ack faults at account/profile/completion writes for
all four providers; conflicting profiles/usernames/account owners; different
subjects/providers sharing email; suspension, feature disablement, incomplete
markers, credential-login refusal with a missing OAuth account; edited/deleted
completed profiles; tampered/replayed state, concurrent callbacks; the native
pre-0009 schema, missing/non-unique indexes, schema-read failure and invitation
policy changes. Both databases' FK checks run after every case. Faults wrap
actual native writes; after-commit faults execute the write before throwing.

Before remote activation: both CI jobs must succeed for the exact candidate
commit, the dedicated Cloudflare account and staging version must be checked,
Auth migration0009 must be guarded/applied/read back, and the backend must be
explicitly selected. Duplicate provider account keys are a separate rejection/
reconciliation gate before any eventual existing-identity import. These tests
do not authorize or prove live user-data migration, provider configuration,
email delivery, real billing, mobile acceptance or domain/DNS cutover.

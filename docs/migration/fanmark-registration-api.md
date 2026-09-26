# Fanmark registration Worker API

## Route and selection

`POST /api/fanmarks/register` implements the existing `register-fanmark` Edge
Function operation against the business D1 database. Better Auth provides the
owner ID; the request never accepts a user ID. The route reads emoji identity
and tier data from Master D1, and writes the fanmark, initial license,
license-scoped settings/profile, and audit row in one business-D1 batch. Emoji
rows are read from the ready active catalog release (not the mutable draft
table), and tiers are read from the active reference-master view.

The normal frontend defaults to the Supabase Edge Function. An explicit
`VITE_FANMARK_REGISTRATION_BACKEND=worker` build selects the Worker client;
the matching Worker switch is `FANMARK_REGISTRATION_BACKEND=d1`. A failed
Worker request never falls back to Supabase. The Cloudflare staging build and
Worker config select the new path; production builds retain the Supabase
default.

## Input and identity rules

The JSON body accepts `user_input_fanmark`, one to five ordered `emoji_ids`, an
optional matching `normalized_emoji_ids`, `accessType`, display/default names,
redirect URL, text content, and `createProfile`. Request bodies are capped at
24 KiB. IDs are resolved against the active Master D1 catalog. The server
verifies that the submitted emoji string matches the ordered catalog values,
removes skin-tone code points only when deriving canonical identity IDs, and
rejects a client-supplied normalized-ID list that differs from that derivation.
Tier classification preserves the source rules and reads the active tier row.

An existing fanmark can be reused only while active and without an active
license, an unexpired grace license, or a pending lottery entry tied to an
expired grace license. Active license status blocks acquisition even if its
end timestamp has passed, matching the existing registration function. The
final D1 mutation repeats these checks so competing requests cannot both issue
an active license. A unique identity/short-ID failure or any dependent-write
failure rolls the whole batch back.

The product limit remains one to five emoji IDs. A valid over-five list
returns `invalid_emoji_count`; the public `system_settings.max_emoji_characters`
value can lower that limit, and a missing row defaults to five. Other private
settings are never read by this registration path.

The first license end uses the tier's `initial_license_days` and rounds up to
UTC midnight, matching `roundUpToNextUtcMidnight`. The response retains the
existing success/fanmark shape, including canonical and display URLs.

## Boundaries and proof

This operation does not call Stripe or send email. It preserves the current
Edge Function behavior for pattern pricing: the source registration function
does not reject `requiresPayment` results, so this adapter does not introduce a
new payment policy. Availability remains an advisory API and is not treated as
authorization for registration.

The local D1 integration suite uses synthetic identity/catalog rows and covers
first registration, skin-tone identity, reuse, stale normalized IDs, grace and
lottery conflicts, competing requests, dependent-write rollback, CORS, and
authentication result handling. The frontend client has separate selector,
cookie, no-store, error, and no-fallback tests. These tests do not prove source
data parity or production behavior. The staging canary must use a disposable
Better Auth identity, verify business D1 readback, and delete every synthetic
row before the route is considered staging-verified.

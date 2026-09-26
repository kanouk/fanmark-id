# Owner fanmark profile API

The Worker can read and update one fanmark owner's profile through
`GET/PATCH /api/me/fanmarks/{fanmarkId}/profile`. The route resolves the
Better Auth session on the server, then finds exactly one active license owned
by that session with `license_end > now()`. The caller cannot supply a user or
license ID. This matches the current profile editor's license lookup and the
source INSERT policy. Ambiguous ownership and unavailable D1 fail closed.

The response contains the resolved `licenseId`, the minimal fanmark context
needed by the edit/preview screens, and either the owner profile or `null`.
It omits owner IDs and unrelated fanmark/license columns. PATCH accepts only
`display_name`, `bio`, `social_links`, `theme_settings`, and `is_public`. Text
lengths, social URL schemes, theme keys, color/position/dimension values, and
serialized JSON size are bounded. New profiles receive runtime UUID and
timestamp values because the converted D1 schema does not supply Postgres
defaults. Existing-row edits are owner-scoped and preserve fields omitted from
the patch; the profile generation trigger remains responsible for access
generation increments on changed existing rows.

When a theme image URL points back to this same Worker's `/api/storage/` path,
the Worker also checks that a cover URL names the `cover-images` bucket and the
session owner's key prefix, and that a profile image names the `avatars` bucket
and that same owner. Object URLs for another owner, the wrong image bucket,
or a non-public storage route are rejected before the D1 write. External URLs,
including existing Supabase Storage URLs, remain accepted for migration
compatibility.

The frontend defaults to Supabase. A build may select the Worker with
`VITE_FANMARK_PROFILE_BACKEND=worker`; it then uses Better Auth cookies with
`credentials: include`, same-origin Auth/API validation, no-store responses,
bounded response parsing, and no alternate-database fallback after selection.
The profile edit and preview routes use the owner API in that mode. Public
profile reads remain under the separate `VITE_PUBLIC_ACCESS_READ_BACKEND`
selector. The settings page still reads the fanmark and access configuration
from Supabase, and its overall save operation remains Supabase-backed.

## Verification and activation boundary

Dedicated local synthetic split-D1 tests cover owner reads, profile creation
and updates, profile generation changes, another owner's fanmark, an expired
license, invalid fields, same-owner image paths, cross-owner and wrong-bucket
R2 image paths, CORS, methods, and backend selection. Frontend
contract tests cover URL validation, cookie behavior, response shape, and
fail-closed errors. These fixtures contain synthetic identities and records.

The source-shaped business schema is applied to the isolated staging D1, and
`FANMARK_PROFILE_BACKEND=d1` plus
`VITE_FANMARK_PROFILE_BACKEND=worker` are selected on the workers.dev app only.
A live synthetic Better Auth account completed owner-profile GET/PATCH and its
profile, license, fanmark, and Auth rows were removed and read back as zero.
The overall fanmark settings save and access-configuration flow remain on
Supabase; no real user data was read or written. Production and domain/DNS
remain unchanged.

Staging version `a6b0a110-9169-4921-9cdc-60e51a521714` also passed an integrated
cover-image canary: upload to the R2 cover bucket, public byte readback, save
the exact same-owner URL through this API, reject another owner's URL and the
avatar bucket used as a cover, then owner-delete and read back 404. Synthetic
Auth and source business rows were cleaned. Existing Supabase objects remain
for the final user-data phase.

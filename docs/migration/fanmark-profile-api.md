# Owner fanmark profile API

The Worker can read and update one fanmark owner's profile through
`GET/PATCH /api/me/fanmarks/{fanmarkId}/profile`. The route resolves the
Better Auth session on the server, then finds exactly one active license owned
by that session with `license_end IS NULL OR license_end > now()`. This supports
perpetual Tier C as specified in PRODUCT.md and already supported by the
Worker settings/public-profile routes. The caller cannot supply a user or
license ID. Both the context read and the INSERT/UPSERT selector enforce the
same eligibility. Ambiguous ownership and unavailable D1 fail closed.

This intentionally corrects the finite-only legacy Supabase profile editor
and INSERT policy on the Worker path. The Supabase default and live source
policies are unchanged. It does not change the separate emoji-vs-short-ID
public lookup selection contract; see
[`public-profile-runtime-review.md`](public-profile-runtime-review.md).

The response contains the resolved `licenseId`, the minimal fanmark context
needed by the edit/preview screens, and either the owner profile or `null`.
It omits owner IDs and unrelated fanmark/license columns. PATCH accepts only
`display_name`, `bio`, `social_links`, `theme_settings`, and `is_public`. Text
lengths, social URL schemes, theme keys, color/position/dimension values, and
serialized JSON size are bounded. New profiles receive runtime UUID and
timestamp values because the converted D1 schema does not supply Postgres
defaults. Existing-row edits are owner-scoped and preserve fields omitted from
the patch; the canonical profile triggers increment access generation on
creation and updates. Tests compare the generation before and after a write;
the preceding basic-config/profile seed also advances that generation.

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
selector. The fanmark settings page has a separate
`VITE_FANMARK_SETTINGS_BACKEND=worker` route for access configuration and
profile visibility; that API is documented in
[`fanmark-settings-api.md`](fanmark-settings-api.md). Profile content editing
and access-mode configuration stay in separate owner-scoped API contracts.
Both routes preserve the Supabase default for production.

The editor waits for AuthProvider restoration before redirecting or fetching
the owner context. Anonymous requests preserve the internal edit URL as a
string return target, which the Better Auth email sign-in follows. Denied,
malformed or failed reads render a retry/back error screen, never the blank
creation form. A successful authorized context with `profile: null` still
allows creation. Read generations invalidate obsolete/unmounted requests.

`npm run build:cloudflare-staging && npm run test:staging-profile-editor-ui`
uses headless Chrome with every browser request fulfilled or blocked locally.
Eight synthetic cases cover delayed session restoration, anonymous return
state, actual form sign-in returning to the editor, authorized missing profile,
404 refusal, network failure, recovery by retry and a failed-save draft. The
failed-save case proves that a 503 keeps the editor and draft, reload restores
unsaved content, and only a successful retry removes the draft. The page
rethrows a save failure after its toast so the form can distinguish success
from failure. The restored-owner case
checks exact entered spaces and no horizontal overflow at 390px. Font requests
are blocked; no Supabase or real API calls are permitted. Set
`FANMARK_STAGING_CHROME` when Chrome is outside the discovered standard paths.
This rendered regression runs after the staging build in the application CI
job. It is not proof of deployed saves, provider integration or a real phone.
The CI build points Vite at an empty environment directory and explicitly
supplies the staging API origin and synthetic Supabase client initialization
values. The browser fixture honors any pinned catalog version requested by the
bundle and does not read ignored workstation `.env` files.

## Verification and activation boundary

`npm run test:staging-profile-editor-local` separately builds the actual staging
frontend for a temporary HTTPS loopback origin and serves it through Wrangler's
local Worker, with every D1/R2 binding explicitly remote:false and no account,
route or service binding. It applies all25 Business migrations in order, Auth
core/0007/0008 and the eight Master migrations to private disposable local D1.
The isolated build reads an empty environment directory and all45 staging
selectors; only synthetic users and a synthetic eight-emoji release are seeded.

Chrome continues every allowed request to the actual loopback app/API; it never
fulfills an API response. All other browser origins are blocked. One PATCH is
deliberately failed at the network layer to test that the stored row stays
unchanged and the draft survives reload; its retry saves through the actual
Worker into D1 and clears the draft. Actual form sign-in preserves the anonymous
return URL, cold reopening preserves exact spaces, public/private HTTP reads
follow the saved flag, another owner's editor refuses the form and revocation
returns the editor to sign-in. At390px there is no horizontal overflow; this is
not a real-phone check. It verifies zero Business foreign-key violations and
stops both local server/browser, removing local database state. A private report
and diagnostic logs remain in the temporary directory; no remote D1/provider
calls or workstation secret values are needed. The application CI includes this
composed test in addition to the eight-case offline rendered regression.

The first private composed run exceeded SQLite statement length because it
concatenated all Business SQL into one CLI call; applying each migration in the
canonical sequence fixed the harness. No runtime schema or API was changed.
The private successful report is
`fanmark-local-editor-compose-LH5JH6/report.json`. The checked-in command also
passed locally (`fanmark-local-editor-compose-nvmT6c/report.json`), with server
stopped and local DB state removed. Its CI is a separate acceptance boundary.
The final cleanup also checks that the loopback listening port is closed before
removing state; a still-serving process fails the test.

Dedicated local synthetic split-D1 tests apply the entire canonical sequence
of 25 Business migrations and Auth core/0007/0008, using the staging
`AUTH_USER_STATUS_BACKEND=d1` selector. The reduced profile SQL fixture has
been removed. They cover owner reads, profile creation
and updates, profile generation changes, another owner's fanmark, an expired
license, invalid fields, same-owner image paths, cross-owner and wrong-bucket
R2 image paths, CORS, methods, and backend selection. Frontend
contract tests cover URL validation, cookie behavior, response shape, and
fail-closed errors. These fixtures contain synthetic identities and records.
The full-schema native suite passes 9/9. A warmed actual sign-in/session is
revoked after the synthetic committed suspension state: GET/PATCH return 401,
all profile/access-version rows are unchanged, another owner's context still
works, and a new sign-in returns 403/BANNED_USER without issuing a session.
This consumer check does not replace the separate admin MFA/audit/atomicity
suite and is not evidence of a deployed suspension flow.

The perpetual-owner regression reproduced 404 before the predicate repair.
Additional tests cover NULL-end profile read/update/recreation, preservation
of entered spaces, access-generation changes, another perpetual owner, grace
and expired refusal, finite-plus-perpetual ambiguity, and a native transition
to grace at the write barrier that leaves the profile/generation unchanged.
The earlier reduced-schema suite passed 8/8. The perpetual owner API also passed journaled
synthetic acceptance on Worker `010a4d7a-9cd2-4683-b38f-ff6ad0dd82ec` after both
CI jobs passed for code head `f4bd1aa`. Two actual sign-ins prove NULL-end
read/create/update, exact stored/public display-name spaces, private/public
toggling, other-owner refusal and native grace transition refusal. Cleanup
proved zero source-owned Business/Auth, invalidated sessions, retained license
incarnation tombstones and equal retained baselines. This proves the deployed
API path; perpetual editor rendering/mobile and real imported rows remain open.
See `EXECUTION.md` for the private journal and independent readback evidence.

The source-shaped business schema is applied to the isolated staging D1, and
`FANMARK_PROFILE_BACKEND=d1` plus
`VITE_FANMARK_PROFILE_BACKEND=worker` are selected on the workers.dev app only.
A live synthetic Better Auth account completed owner-profile GET/PATCH and its
profile, license, fanmark, and Auth rows were removed and read back as zero.
The separate fanmark settings API also passed a synthetic staging GET/PATCH
canary as recorded in [`fanmark-settings-api.md`](fanmark-settings-api.md).
No real user data was read or written. Production and domain/DNS remain
unchanged.

Staging version `a6b0a110-9169-4921-9cdc-60e51a521714` also passed an integrated
cover-image canary: upload to the R2 cover bucket, public byte readback, save
the exact same-owner URL through this API, reject another owner's URL and the
avatar bucket used as a cover, then owner-delete and read back 404. Synthetic
Auth and source business rows were cleaned. Existing Supabase objects remain
for the final user-data phase.

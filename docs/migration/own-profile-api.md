# Own-profile Worker API

The staging profile client uses Better Auth and business D1 for the signed-in
user's profile. `GET/PATCH /api/me/profile` reads the session owner's row and
only permits display name, avatar URL, and preferred language updates. The
DTO includes the current plan and a read-only `requires_password_setup` flag,
but omits Stripe customer IDs and invitation codes.

`GET /api/me/username-availability?username=...` preserves the profile
availability check on the same Worker backend. The Worker derives the excluded
user ID from the Better Auth session, compares the lower-cased candidate with
other `user_settings.username` values in business D1, and returns only
`{schemaVersion: 1, available: boolean}`. The caller cannot supply an owner ID;
unknown/duplicate query parameters, oversized candidates, unsupported methods,
disallowed origins, and unauthenticated requests are rejected. Responses are
`no-store`. The endpoint is read-only and does not reserve or write usernames.

The frontend selects this route only when `VITE_PROFILE_BACKEND=worker` is
explicitly set. It sends the Better Auth cookie with same-origin validation,
bounded response parsing, and no-store caching. It does not retry against
Supabase when the Worker fails. The default/production selector remains
Supabase. User profile rows and existing Auth credentials remain outside this
staging change and the final user-data migration phase.

Synthetic split-D1 coverage is in `workers/api/test/profile-d1.test.ts` and
client contract coverage is in `src/lib/profile-api.test.ts`. Run them with:

```sh
npm run --prefix workers/api test:profile-d1
npm run test:profile-api
```

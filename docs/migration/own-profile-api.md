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

Successful Worker profile updates publish the validated profile to other
profile hooks in the same tab, including updates initiated by language
preferences. Worker-backed hooks quietly reload when the browser tab/window
becomes visible or focused, replacing the old Supabase Realtime refresh without
periodic D1 polling. Cross-tab changes are picked up when the tab returns to the
foreground.

Synthetic split-D1 coverage is in `workers/api/test/profile-d1.test.ts` and
client contract coverage is in `src/lib/profile-api.test.ts`. Run them with:

```sh
npm run --prefix workers/api test:profile-d1
npm run test:profile-api
```

## Source privilege guards and complete-schema CI (2026-10-03)

The current source INSERT/UPDATE/SELECT settings policies bind auth.uid() to
user_id. Its two plan-escalation triggers allow the service role/administrator
and reject unauthorized admin-plan inserts or plan changes. Target own-profile
PATCH accepts only display_name/avatar_url/preferred_language and uses the
Better Auth owner. Server signup selects free; privileged plan writes are named
MFA administrator or verified billing operations. Exact source definition
hashes and the full37-binding index are in
[source-trigger-counterparts.md](source-trigger-counterparts.md).

The existing10 native cases now use all25 canonical Business migrations and
Auth0003/0007/0008/0009, with staging suspension/OAuth-provisioning selection.
The invitation is seeded to satisfy its real FK, profile IDs are UUIDs, and
both stores' FK checks run after each case. The reduced fixture and its custom
privilege trigger are removed. Own/foreign row preservation, rejected identity/
privilege/billing fields, R2 upload/update/delete/readback and first-password
setup/retry pass10/10; Worker typecheck and focused lint pass. The existing
test:profile-d1 command now runs through test:api-contracts-d1 and normal
Worker CI. This changes verification, not runtime/profile/provider/data/DNS.
7a603bd CI37096588121 passed both jobs; the accepted runtime is stillbce8993/c09.
Exact source username-check behavior, owner exclusion and administrator
authority differences are in [source access helpers](source-access-helpers-review.md).

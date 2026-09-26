# Lifecycle settings Worker API

## Scope

`GET /api/system/lifecycle` and `PATCH /api/admin/system-settings/lifecycle`
move the single `system_settings.grace_period_days` value behind the staging
Worker. The public GET is required by the dashboard and returns only the
integer day count. The PATCH requires a Better Auth administrator session with
current session-bound MFA assurance; it never returns another system setting.

The Worker uses the split business D1 binding and requires exactly one public
setting row. PATCH accepts only `{ "grace_period_days": integer }`, between 1
and 365, and verifies the saved value by reading it back. The request body is
limited to 1 KiB. Responses are `no-store`. Origin checks use the app staging
origin. Missing, private, duplicated, malformed, or unavailable settings fail
closed; the frontend does not fall back to Supabase after selecting Worker.

The ordinary application build still defaults to Supabase. The Cloudflare
staging build sets `VITE_LIFECYCLE_SETTINGS_BACKEND=worker`; the staging Worker
sets `LIFECYCLE_SETTINGS_BACKEND=d1`. Both `AdminSettings` and the dashboard's
license timing display use the same dedicated hook so they do not read two
different copies of the setting.

## Staging state and proof

On 2026-09-25, a read-only query of the linked Supabase project's public
`grace_period_days` row returned exactly one row with value `1`. Cloudflare
business staging D1 had no license rows and no expiry/finalization journal
rows. The same single public value `1` was inserted into staging D1; no user
data or other system setting was copied. A readback confirmed the key, value,
and public status.

The staging frontend and API were deployed as app Worker version
`bf951bd0-4aee-42f2-a9a7-997beffe06de` at the existing workers.dev URL. Live
read-only checks returned root 200/noindex, Better Auth health 200, and public
lifecycle GET 200/no-store with only `{grace_period_days:1}`. The admin PATCH
returned 401 `unauthenticated` without a session. Authenticated admin updates
and browser MFA have not yet been tested. The staged
`LICENSE_EXPIRY_BACKEND` selector and Cron trigger remain disabled pending the
bounded scheduled-event smoke.

## Local validation

The frontend client tests cover backend selection, payload validation,
same-origin/cookie handling, and failure without fallback (4/4). The Worker
D1 tests cover exact public-key reads, missing-setting failure, authorization
before writes, readback, private-key collision, invalid and oversized patches,
CORS, and method/backend guards. The dedicated settings suite passes 9/9;
Worker standard and verified-access suites pass 30/30 and 10/10. Frontend and
Worker typechecks, focused ESLint, Cloudflare staging build, and Wrangler
dry-run pass. Full-file lint of `FanmarkDashboard.tsx` also reports existing
unrelated `any` and hook-dependency findings.

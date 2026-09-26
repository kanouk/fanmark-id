# Extension coupon D1 API

Cloudflare staging routes the existing extension-coupon UI to D1 when its
explicit frontend and Worker selectors are enabled. Production/default builds
continue to use Supabase. This is runtime/API migration only; no coupon, usage,
license, or user rows are copied by the staging code or structural migration.

## User redemption

`POST /api/me/licenses/extend-with-coupon` requires the current Better Auth
session and accepts exactly:

```json
{
  "license_id": "uuid",
  "coupon_code": "UPPERCASE-CODE",
  "request_id": "uuid"
}
```

The Worker rechecks active coupon, expiry, remaining capacity, allowed tier,
per-user/fanmark duplication, current license ownership/status, transfer state,
perpetual status, and the Grace plan limit in D1. The request's date result is
computed from `max(now, license_end)`, with month-end clamping and UTC-midnight
rounding.

One `extension_coupon_application_commands` INSERT runs database triggers in
the same D1 write transaction. It claims one coupon use, inserts its usage row,
updates the license, cancels pending lottery entries using the valid
`license_extended` reason, emits one deduplicated notification event per
cancelled applicant, writes audit entries, and records the response snapshot.
A unique `(user_id, request_id)` key makes sequential or concurrent retries
return the original result; a conflicting payload receives 409. Grace-state
commands snapshot the plan type and configured/fallback limit, then the trigger
rejects a configuration change before applying the command. A second unique
index prevents another request from applying the same coupon to the same user's
fanmark.

The route keeps the error codes used by `ExtendLicenseDialog`, including
`coupon_not_found`, `coupon_expired`, `coupon_usage_exceeded`,
`tier_not_allowed`, `coupon_already_used_on_fanmark`,
`fanmark_limit_exceeded`, `perpetual_license`, and `transfer_in_progress`.

## Admin management

`/api/admin/extension-coupons` requires Better Auth administrator role and a
recent MFA assurance bound to the session/factor. It supports list/create,
active-state PATCH with an `expected_updated_at` compare-and-swap, deletion of
unused coupons only, and `GET /:couponId/usages`. Usage display names and
fanmark labels are returned only to the authorized admin route. All responses
are `no-store`; origins are checked against the Worker allowlist.

Staging configuration selects the user route with `EXTENSION_COUPON_BACKEND=d1`
and the admin route with `EXTENSION_COUPON_ADMIN_BACKEND=d1`. The browser uses
`VITE_EXTENSION_COUPON_BACKEND=worker` and
`VITE_EXTENSION_COUPON_ADMIN_BACKEND=worker`. An explicit Worker failure never
falls back to Supabase. Existing coupon definitions, owner-linked usage rows,
license rows, and their redemption counts require a separate reviewed data
reconciliation/import; they are not implied by schema readiness or synthetic
tests.

## Verification boundary

Dedicated Miniflare tests use synthetic users, coupons, licenses, and lottery
entries to check atomic success, response replay, coupon-cap competition,
duplicate use, transfer and tier rejection, Grace limits, notification/audit
creation, admin MFA-gated route wiring, and safe coupon deletion. These tests do
not establish live Supabase parity, imported-record readiness, a successful
authenticated staging redemption, or production behavior.

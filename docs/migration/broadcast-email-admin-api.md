# Broadcast email admin API migration

## Current boundary

The local Cloudflare staging path now supports listing recent broadcast drafts,
reading active broadcast templates, estimating a recipient count from D1, and
creating a draft. It is guarded by the Better Auth administrator session/MFA
check and a second `plan_type = 'admin'` check in business D1. The route is
selected by `BROADCAST_EMAIL_BACKEND=d1` and the staging frontend by
`VITE_BROADCAST_EMAIL_BACKEND=worker`; production/default builds still use
Supabase.

Cloudflare mode is draft-only. The Worker has no send or test-send route, and
the staging UI disables both actions. It does not call the Supabase Edge
Function as a fallback. No email is sent by these routes. The draft write and
its minimized `BROADCAST_DRAFT_CREATE` audit record are one D1 batch; the audit
contains the type and whether filters were present, not recipient addresses or
filter values.

The authenticated list DTO omits `created_by` and `error_details`, returns at
most 50 rows, and includes only active templates for the three supported
broadcast types. The estimate endpoint returns only a count after applying
allowlisted plan, language, and date filters; it never returns user IDs or
addresses. In current staging, user-owned tables contain synthetic or zero
rows. This work did not copy or change user data.

## Current-source broadcast template seed (2026-09-27 JST)

The exact three supported template types were read in a Supabase
`BEGIN READ ONLY` transaction using
[`broadcast-email-templates-readonly.sql`](../../scripts/migration/broadcast-email-templates-readonly.sql).
The source contains 12 active rows: three types across `en`, `id`, `ja`, and
`ko`. Their normalized full-row SHA-256 is
`770459e45e66f1c81ba58ea507b518f00c67004d289f5919d8c16c0f2c279f14`.

[`stage-staging-broadcast-email-templates.mjs`](../../scripts/migration/stage-staging-broadcast-email-templates.mjs)
seeds only those rows into `fanmark-business-staging`. It requires the private
Supabase result file to have restrictive permissions, verifies the pinned
source digest and exact staging D1 ID, and fails on a partial or changed
target. It never overwrites a row. Remote readback matched all fields and the
same digest; the existing 16 authentication templates remained unchanged. A
second run was a no-op and passed exact readback. No broadcast drafts, user
rows, or recipient addresses were read or copied, and no email was sent. The
template body values remain in the private CLI artifact and staging D1 rather
than being checked into the repository.

An authenticated browser canary for the broadcast screen and draft create/
cleanup remains open. The existing API and frontend contract tests are not a
substitute for that acceptance.

## Delivery work still open

Bulk and test delivery remain on the existing Supabase Edge Function in the
standard build. Moving delivery needs a separate queue/retry decision, recipient
snapshot semantics, opt-out and bounce handling, sender configuration, bounded
provider errors, and HTML-safe rendering. Do not enable delivery against
real-user data in staging. The explicit real Auth/business/object import and
public DNS cutover remain in the final phases tracked by #38.

## Validation

The isolated Worker suite covers the MFA/admin gate, D1 list projection,
template allowlist, recipient filters, server-derived creator ID, draft-only
write/audit batch, invalid Origin, request validation, and disabled dispatch
routes. The frontend contract tests cover same-origin credentialed requests,
bounded DTO parsing, count estimation, and draft creation. The staging Worker
and current-source template comparison are in place; authenticated browser
acceptance and all delivery/provider work remain open.

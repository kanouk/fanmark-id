# Broadcast email admin API migration

## Current boundary

The local Cloudflare staging path now supports listing recent broadcast drafts,
reading active broadcast templates, estimating a recipient count from D1, and
creating a draft. It is guarded by the Better Auth administrator session/MFA
check and a second `plan_type = 'admin'` check in business D1. The route is
selected by `BROADCAST_EMAIL_BACKEND=d1` and the staging frontend by
`VITE_BROADCAST_EMAIL_BACKEND=worker`; production/default builds still use
Supabase.

Bulk delivery stays disabled in Cloudflare mode. A separate, default-off test
send route is implemented for drafts: it requires the explicit
`BROADCAST_TEST_SEND_BACKEND=resend` selector, a server-configured single
`BROADCAST_TEST_RECIPIENT`, and the Resend key/from settings. The caller cannot
choose a recipient. It requires the same Better Auth administrator session/MFA
and D1 admin-plan checks, accepts only a draft, and escapes the subject/body
before constructing HTML. Provider errors are bounded and redacted; a
successful send writes an audit record containing the language, broadcast
type, and provider message ID, but no recipient address. Test delivery also
has a separate frontend selector, `VITE_BROADCAST_TEST_SEND_BACKEND=worker`,
which defaults off. Neither test nor bulk delivery falls back to the Supabase
Edge Function from Worker mode.

The UI keeps the same provider idempotency key while a failed test-send dialog
remains open, so retrying after an uncertain provider response reuses the same
request identity.

The test-send code has only been checked with an injected provider mock. The
Worker route has been deployed with its selector off; the frontend selector,
allowlisted recipient, Resend key, and sender are not configured, and no email
was sent. An authenticated staging API canary on the deployed Worker verified
the 12-template list, a zero-result future-date estimate, synthetic draft
create/readback, test-send 503, and bulk-send 404. It removed its synthetic
Auth/profile/draft/audit rows and direct D1 readback returned the canary tables
to zero. Authenticated browser review remains open. Bulk delivery still needs a
separate queue/retry design, recipient snapshot semantics, opt-out and bounce
handling, and delivery-state reconciliation. The draft write and its minimized
`BROADCAST_DRAFT_CREATE` audit record are one D1 batch; the audit contains the
type and whether filters were present, not recipient addresses or filter
values.

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

## Authenticated browser canary (2026-09-27 JST)

On active staging Worker version
`21f0be9e-2099-49d8-b975-a3a61604c12e`, a short-lived synthetic administrator
signed in through the deployed Better Auth form, enrolled and verified TOTP,
and opened the `/admin` broadcast screen. The UI loaded in D1 mode and showed
the staging-only draft banner with zero initial drafts. A synthetic draft was
created through the form, appeared in history as `draft`, and its preview
displayed the exact synthetic subject and body. The test-send and send-start
buttons remained disabled; neither route was invoked and no email was sent.

After logout, exact D1 readback found zero canary user/account/session/factor/
admin-role/MFA-assurance rows and zero profile/draft/audit rows. The test used
an `example.invalid` identity and synthetic text only; its local password/TOTP
state was removed. No real user data, production routing, or domain/DNS changed.
This proves the authenticated screen and draft path only. Recipient estimate
was previously covered by the API canary; real-provider delivery, bulk queue
and retry semantics, recipient snapshots, opt-out/bounce handling, and
delivery-state reconciliation remain open.

## Delivery work still open

The standard build continues to use the existing Supabase Edge Function for
bulk and user-addressed test delivery. Do not enable bulk delivery against
real-user data in staging. The explicit real Auth/business/object import and
public DNS cutover remain in the final phases tracked by #38.

## Validation

The isolated Worker suite covers the MFA/admin gate, D1 list projection,
template allowlist, recipient filters, server-derived creator ID, draft-only
write/audit batch, invalid Origin, request validation, disabled bulk dispatch,
and the mock-only fixed-recipient test-send route. The frontend contract tests
cover same-origin credentialed requests, bounded DTO parsing, count estimation,
draft creation, and the test-send request contract. The staging Worker,
current-source template comparison, and authenticated draft-screen browser
canary are in place; real-provider delivery validation remains open.

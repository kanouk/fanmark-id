# Broadcast email admin API migration

## Current boundary

The local Cloudflare staging path now supports listing recent broadcast drafts,
reading active broadcast templates, estimating a recipient count from D1, and
creating a draft. It is guarded by the Better Auth administrator session/MFA
check and a second `plan_type = 'admin'` check in business D1. The route is
selected by `BROADCAST_EMAIL_BACKEND=d1` and the staging frontend by
`VITE_BROADCAST_EMAIL_BACKEND=worker`; production/default builds still use
Supabase.

The 2026-10-06 JST download confirmed the actual source sender version36 matches
the checkout entrypoint, but its shared administrator helper is older. The
source validates the bearer user and `user_roles.role=admin` without current
MFA; the Worker requires Auth adminRole/exact-session verified MFA and Business
admin plan. Its server-fixed test recipient also replaces the source's caller-
selected `testEmail`. These are explicit authorization/recipient changes rather
than identical source behavior. [Source and helper proof](source-edge-bodies-review.md).

The browser bulk-send control is default-off in Cloudflare mode and requires
`VITE_BROADCAST_SEND_BACKEND=worker` in `cloudflare-staging` mode. The migration
worktree adds a separate send-start endpoint,
`POST /api/admin/broadcast-emails/send`, guarded by the same administrator
session/MFA and D1 admin-plan checks. It accepts a draft ID and UUID request ID,
freezes the broadcast filter and active per-language template selection,
creates one durable run per broadcast, and marks the draft scheduled. Replays
with the same administrator/request ID return aggregate run status without
creating another run; reusing that key for another broadcast is a conflict.
The route itself does not call Resend.

The minute Cron snapshots up to 50 Auth D1 user IDs at a time and stores only
the ID and effective language in Business D1. It excludes Auth users created
after the send command, applies the existing plan/language/registration-date
filters through `user_settings`, defaults missing language settings to
Japanese for an unfiltered audience, and will fail the run if the audience
exceeds 10,000. A short D1 lease and cursor compare-and-swap allow another
invocation to resume after a crash. The queue has no recipient-address column.
Snapshot selectors are default-off and require split D1 plus both explicit D1
backend selectors.

Resend delivery and the signed webhook route are implemented in the migration
worktree and included in the deployed staging Worker bundle. The staging
bulk/test-send selectors, fixed test recipient, and broadcast signing secret
remain unset after cleanup. On 2026-10-06, one explicitly approved fixed-recipient
API test was Delivered by Resend and matched to its minimized D1 audit. The
native fixed-recipient test-send UI was subsequently accepted on2026-10-07,
with Delivered, exact audit and canonical restore/cleanup; [native proof](evidence/staging-main-auth-mfa-admin-mail-native-2026-10-07.json).
Bulk dispatch and actual signed provider delivery remain separate acceptance items. See [bounded delivery evidence](evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json). The shared Resend key/from are configured for the separately accepted
Auth verification/reset mails. The dispatcher uses bounded batches,
leases and retries, a stable provider idempotency key, and a keyed payload fingerprint; a changed Auth email or
payload after an uncertain attempt pauses the recipient for review. Signed
webhook events are deduplicated and retain only message ID, event type, bounce
class, and time. Permanent bounces and complaints suppress the matching Auth
ID; transient bounces do not. These paths have synthetic Miniflare tests. Keep
their send selectors off until the bounded provider rehearsal is prepared and
authorized. A separate, default-off test-send route is
implemented for drafts: it requires the explicit
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

## Earlier deployment checkpoint (2026-09-28 JST)

The following records the earlier configuration before the accepted
2026-10-06 fixed-recipient API delivery. Its missing credentials and unsent
message describe that checkpoint, not the current Auth mail configuration.

At that checkpoint, test-send had only an injected provider mock. The
send-start API canary ran on Worker version
`4cf9657f-bee3-42bb-aa89-802e9ed0aa89`; after the temporary write-freeze
and Stripe receipt-continuity rehearsals, the ordinary staging config was
restored as version `4c23f796-fa12-419d-85fb-9a905a5f7ceb`. The frontend/backend send selectors,
allowlisted recipient, Resend key, and webhook secret are not configured, and no
email was sent. The earlier authenticated staging API canary on Worker version
`21f0be9e-2099-49d8-b975-a3a61604c12e` verified the list, estimate, and draft
routes; the bulk-send route did not yet exist then. The current deployed
send-start route has now passed a separate selector-disabled API canary, which
confirmed a 503 response and no delivery queue rows; details are below.

The send-start, Auth-ID snapshot, dispatch, and webhook flows are also covered
locally with a synthetic Miniflare D1/Auth pair: schema creation, idempotent
start, frozen templates/filtering, bounded page continuation, fixed-payload
retries, changed-email pause, competing lease exclusion, event
signature/deduplication, and permanent-bounce/complaint suppression pass.
Completion audit is idempotent. No real audience snapshot or provider request
occurred. Authenticated browser review of the updated send control remains open.
The current queue design preserves the service-notice/no-unsubscribe contract
and leaves queue-record retention and post-window reconciliation for operator
policy decisions.
The draft write and its minimized
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
was previously covered by the API canary. The current local UI now has a
default-off bulk-send selector and idempotent request identity, but this updated
send-start UI has not had authenticated browser review. Deployed schema/Worker
acceptance, real-provider delivery, and operational policy remain open.

## Selector-disabled send-start staging canary (2026-09-28 JST)

On deployed Worker version `4cf9657f-bee3-42bb-aa89-802e9ed0aa89`, an
authenticated synthetic administrator passed sign-in, TOTP enrollment, and the
MFA/admin-plan checks. The canary verified template list, zero-result estimate,
draft creation/readback, and selector-disabled test-send response. It then sent
a valid synthetic request ID to the new bulk-send route and received exactly
HTTP 503 `{ "error": "broadcast_send_unavailable" }`. Direct D1 readback found
no delivery run or recipient row for the draft/request.

Cleanup removed the synthetic identity, session, TOTP factor, business profile,
draft, and audit rows; all user-owned Auth tables and the broadcast/profile
tables returned to zero. The monotonic MFA generation counter was preserved.
No real audience snapshot, provider request, email, public route, or domain/DNS
change occurred. The test-send, bulk-send, and provider selectors remain off;
the authenticated browser review of the updated send control is still open.

## Updated send-control browser review (2026-09-28 JST)

Added the opt-in `npm run test:migration:staging-broadcast-email-ui` check to
the guarded staging administrator canary. In a temporary headless Chrome
profile, a synthetic MFA administrator opened `/admin`, selected 一括メール,
and saw the exact synthetic draft created by the API canary. The test-send and
send-start buttons were both disabled and the Cloudflare-mode disabled-send
notice was visible. The browser did not click either send control; a same-origin
read confirmed the synthetic draft was returned by the authenticated API.

The canary then completed the selector-disabled API checks and synthetic
`needs_review` projection. Cleanup removed the synthetic Auth identities,
profile, draft, audit records, delivery run, and recipient; follow-up remote D1
readbacks found zero rows in the covered Auth and broadcast tables. No provider
request, email, real user data, production route, or domain/DNS setting was
used. This closes the authenticated browser-review gap for disabled controls;
provider-backed delivery and its operator policy remain open.

## Delivery work still open

The standard build continues to use the existing Supabase Edge Function for
bulk and user-addressed test delivery. Do not enable the audience snapshot or
provider selectors against real-user data in staging. The explicit real
Auth/business/object import and public DNS cutover remain in the final phases
tracked by #38.

The Cloudflare bulk-send implementation and synthetic replay tests do not
authorize a real recipient snapshot, provider call, or email. Before any
provider-backed acceptance, record queue retention and the operator workflow
for uncertain sends, then verify the Resend webhook and test recipient in an
isolated synthetic staging environment. Production activation remains a
separate final-cutover decision.

## Validation

The isolated Worker suite covers the MFA/admin gate, D1 list projection,
template allowlist, recipient filters, server-derived creator ID, draft-only
write/audit batch, invalid Origin, request validation, send-start, idempotency
conflicts, and the mock-only fixed-recipient test-send route. The Miniflare
integration applies `0016_broadcast_email_delivery.sql` and checks address-free
queue schema, send-command replay, snapshot paging, template/filter freezing,
same-payload idempotent retry, changed-email pause, competing-send exclusion,
signed webhook validation/deduplication, suppression, and idempotent completion
audit. Frontend API tests cover same-origin credentialed requests, bounded DTO
parsing, estimates, draft creation, fixed-recipient test-send, and aggregate-only
bulk send-start (6/6). The focused delivery integration passes 8/8, the Worker
admin API passes 10/10, scheduled routing passes 4/4, and both Worker and app
typechecks pass. Lost acknowledgement after a committed page resumes at its D1
cursor without duplicates, and retry past Resend's 24-hour idempotency boundary
pauses without a provider call. Authenticated browser review of the updated
disabled controls now passes; production release, queue-retention/operator
policy, and provider-backed acceptance remain open.

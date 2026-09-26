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

The source Supabase CLI currently has no access token in this checkout, so the
latest live broadcast-template rows could not be read or pinned. The 12 static
templates in the original Supabase migration are not treated as proof of the
current source content. Before staging acceptance, read and digest the exact
allowlisted `broadcast_%` template rows, seed/read them back in D1, and run an
MFA-authenticated UI canary that creates and removes only its own synthetic
draft.

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
bounded DTO parsing, count estimation, and draft creation. Live staging
deployment, current-source template comparison, and browser acceptance have
not yet been performed.

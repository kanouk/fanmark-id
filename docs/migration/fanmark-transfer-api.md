# Fanmark transfer D1 API

The transfer UI remains on Supabase unless `VITE_FANMARK_TRANSFER_BACKEND=worker` is explicitly set. The Worker requires `FANMARK_TRANSFER_BACKEND=d1`, Better Auth session cookies, split business/auth/master D1 bindings, and the configured CORS origin. Worker errors never cause the UI to switch back to Supabase.

The authenticated routes are `GET /api/me/transfers` and `POST /api/me/transfers/{issue,apply,cancel,approve,reject}`. Issued codes are visible only to their issuer; pending requests are scoped to either the issuer's active/applied codes or the authenticated requester. Transfer codes are generated from 60 random bits and are never written to logs.

Issue, apply, reject, cancel, and approval state changes use D1 batches. Approval retires the old license, creates a fresh recipient license from the active master-tier duration, sets the 30-day transfer lock, deletes the old access/profile/password configuration, creates an inactive basic config, cancels pending lottery entries, and writes the audit/outbox records. It does not copy the old configuration. The UI may provide the new basic-config display name.

The current Supabase schema constrains `fanmark_lottery_entries.cancellation_reason` to `user_request`, `license_extended`, or `system`, while `approve-transfer-request` attempts to write `license_transferred`. The D1 implementation records this transfer-triggered cancellation as `system`, which satisfies the current source DDL and keeps approval atomic. Aligning the source check and event vocabulary remains a separate source-schema correction.

Local proof is provided by `workers/api/test/fanmark-transfer-d1.test.ts` and `src/lib/fanmark-transfer-api.test.ts`. The staging smoke uses only short-lived synthetic Better Auth users and synthetic business rows, then verifies cleanup. It does not import existing Auth/users or touch domain/DNS state.

## Staging lifecycle canary (2026-09-25 JST)

Worker version `929280ae-3285-4936-af67-a6f146aae03e` is active at 100% on
`fanmark-app-staging`. The live synthetic issue/apply/approve flow passed. Its
first run exposed a D1 batch metadata mismatch: the database had committed the
complete transfer, while the handler returned `409` because the reported
change count did not match. Approval now reads back the request, code, old
license, and recipient license and returns success only when those exact rows
show a completed transfer.

The successful staging rerun verified the retired owner license, active
recipient license, configuration reset, 30-day lock, lottery cancellation,
audit/outbox rows, and clean recipient inbox. Cleanup returned all 40 source
business tables and all user-owned Auth tables to zero; the global MFA
generation counter matched its pre-canary value. The Worker remains on the
workers.dev staging hostname. No source users, production routes, or domain/DNS
settings changed.

# Fanmark return API on Cloudflare staging

`POST /api/me/fanmarks/return` implements the single-fanmark `return-fanmark`
flow against business D1. Better Auth supplies the caller identity; the Worker
selects exactly one active, unexpired license owned by that identity. A transfer
code in `active` or `applied` state blocks return, matching the latest live
`has_active_transfer` function.

The transition writes `status = grace`, `license_end = now`,
`grace_expires_at = roundUpToNextUtcMidnight(now + grace_period_days)`,
`is_returned = true`, and clears `excluded_at`. A missing or invalid grace
setting keeps the source helper's one-day fallback. Audit and notification
events are best effort, as in the checked-in Supabase return helper; favorite
notifications are enqueued for other users who saved the fanmark. Event
generation is implemented here, but notification delivery is still handled by
the Supabase worker/Cron flow.

The frontend keeps the existing Supabase default and selects these APIs only
with `VITE_FANMARK_RETURN_BACKEND=worker`. The Cloudflare staging build sets
that selector, and the staging Worker config uses `FANMARK_RETURN_BACKEND=d1`.
Production builds do not set either selector.

`POST /api/me/fanmarks/bulk-return` handles plan-downgrade returns. It accepts
1–50 distinct `license_ids`, checks Better Auth ownership, active/unexpired
state, and active/applied transfer-code status for each item, and transitions
each successful license to grace. Each item is independent: HTTP 207 reports
partial success with `results` and `failed`; full success returns HTTP 200.
Audit and owner/favorite notification-event inserts remain best effort.

Local verification covers owner resolution, expiry, transfer blocking,
grace-period calculation, best-effort effects, request/CORS validation,
Better Auth routing, and frontend session-cookie behavior. The existing
single-return live synthetic canary verified its guard and successful return.
The bulk-return local D1 suite passes 17/17 with the existing settings tests;
the client suite passes 7/7. Live staging verified HTTP 207 for one successful
and one transfer-blocked license, then HTTP 200 when the second license was
returned after its synthetic transfer code was removed. Cleanup read back zero
rows in the 40 source business tables and user-owned Auth tables; lifecycle
access-version state and the singleton MFA generation were unchanged. License
incarnation tombstones are deliberately retained to prevent identifier reuse.
Production and real user data were not used.

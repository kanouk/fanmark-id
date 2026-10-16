# Fanmark access analytics write API

Checkpoint: 2026-09-28. The public write path and owner-facing read APIs are
enabled together on the workers.dev staging Worker and SPA. A synthetic live
canary verified the paired flow and cleaned up its test rows. Historical
analytics data remains in Supabase; no historical records were copied.

`POST /api/fanmarks/access` accepts the existing short-id page event shape. The
Worker requires an explicit `FANMARK_ACCESS_ANALYTICS_BACKEND=d1`, verifies
that the supplied fanmark ID and short ID identify the same active D1 fanmark,
then resolves the latest active or grace license. Missing or mismatched public
records return `{ success: true, recorded: false }` without exposing whether a
fanmark ID exists.

The staging Worker configuration attaches a separate Cloudflare Rate Limiting
binding that allows 120 requests per client-IP key per 60 seconds. The Worker
hashes the IP for the limiter key and does not write it to D1. The public
ingress also bounds the JSON body to 8 KiB, rejects unknown fields, and bounds
stored referrer, user-agent, and UTM values. It keeps the source behavior of
hashing the user-agent, fanmark ID, and UTC date for visitor deduplication. A
D1 batch atomically suppresses a repeated visitor hash for five minutes,
inserts the raw event, and upserts its daily aggregate. The write is serialized
by D1, so simultaneous duplicate calls create only one log and one aggregate
increment. The test suite covers limiter denial/failure, concurrent requests,
the five-minute boundary, unique visitor counting, origin rejection, invalid
IDs, and aggregate classification.

The paired owner-facing reads are `GET /api/me/analytics/fanmarks`,
`GET /api/me/analytics`, and `GET /api/me/analytics/summary`. Better Auth
session identity scopes each query to the caller's D1 licenses; the analytics
page and dashboard use these endpoints in the staging build. Worker tests
verify owner scoping, plan gates, and anonymous denial. The staging canary
verified an event write, four duplicate suppressions, owner projections and
summary, anonymous 401, and exact cleanup. The optional
`npm run test:staging-fanmark-analytics-ui` canary opens the authenticated
`/analytics` page in an isolated headless Chrome profile, verifies that the
rendered access and visitor totals both show `1`, and confirms the page read
the Worker analytics APIs. The canary then removes the synthetic rows and
reads all owned business/Auth row counts back as zero. The selectors remain
explicit and the normal/production build still uses Supabase.

This proves only a synthetic staging flow. Historical data is not migrated;
raw referrer/user-agent retention policy, populated-user authorization, and
production CPU/plan fit remain open. Owner history details also remain on
Supabase.


## Current analytics screen correspondence — 2026-10-03

`src/pages/Analytics.tsx` obtains only the caller's `status=active` licenses,
then limits aggregate queries to those fanmark IDs (or a selection from that
list). Its creator/business/enterprise/admin plan gate matches
`fanmark-analytics-d1-api.ts`. The Worker derives the caller from the Auth
session, keeps the active-license list and repeats its scope in every aggregate
query; it additionally refuses a foreign selected ID. The source RLS permits
any historical license owner, but that broader row permission is not the
current Analytics screen's requested dataset.

`FanmarkDashboard.tsx` uses deriveLicenseTiming to select active licenses,
then sums access_count for those fanmark IDs for the preceding 30 days. The
Worker summary uses the corresponding active finite/perpetual predicate and
excludes grace/expired states. Existing analytics native tests verify another
owner's aggregates are absent, invalid/foreign filters are refused, grace
counts are absent from dashboard totals, and the one-microsecond license-end
boundary is retained. Those tests use the reduced analytics fixture and an
injected owner resolver; the earlier staged rendered canary is the separate
real-session/UI proof. The current full Worker CI includes this unchanged
suite. No new fault campaign or broader historical-owner endpoint is needed
for this screen correspondence.

Current application scope is therefore explained. Retained historical rows,
legacy direct-row/RPC access, raw-log retention and final populated-user
integration remain explicit data/operations/cutover requirements. No real
analytics row was read, imported or changed in this review.

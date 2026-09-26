# Fanmark access analytics write API

Checkpoint: 2026-09-26. The public write path and owner-facing read APIs are
enabled together on the workers.dev staging Worker and SPA. A synthetic live
canary verified the paired flow and cleaned up its test rows. Historical
analytics data remains in Supabase; no historical records were copied.

`POST /api/fanmarks/access` accepts the existing short-id page event shape. The
Worker requires an explicit `FANMARK_ACCESS_ANALYTICS_BACKEND=d1`, verifies
that the supplied fanmark ID and short ID identify the same active D1 fanmark,
then resolves the latest active or grace license. Missing or mismatched public
records return `{ success: true, recorded: false }` without exposing whether a
fanmark ID exists.

The public ingress bounds the JSON body to 8 KiB, rejects unknown fields, and
bounds stored referrer, user-agent, and UTM values. It keeps the source behavior
of hashing the user-agent, fanmark ID, and UTC date; it does not use an IP
address. A D1 batch atomically suppresses a repeated visitor hash for five
minutes, inserts the raw event, and upserts its daily aggregate. The write is
serialized by D1, so simultaneous duplicate calls create only one log and one
aggregate increment. The test suite covers concurrent requests, the five-minute
boundary, unique visitor counting, origin rejection, invalid IDs, and aggregate
classification.

The paired owner-facing reads are `GET /api/me/analytics/fanmarks`,
`GET /api/me/analytics`, and `GET /api/me/analytics/summary`. Better Auth
session identity scopes each query to the caller's D1 licenses; the analytics
page and dashboard use these endpoints in the staging build. Worker tests
verify owner scoping, plan gates, and anonymous denial. The staging canary
verified an event write, four duplicate suppressions, owner projections and
summary, anonymous 401, and exact cleanup. The selectors remain explicit and
the normal/production build still uses Supabase.

This proves only a synthetic staging flow. Historical data is not migrated;
public-ingress abuse controls, raw referrer/user-agent retention policy,
populated-user authorization, and production CPU/plan fit remain open. Owner
history details also remain on Supabase.

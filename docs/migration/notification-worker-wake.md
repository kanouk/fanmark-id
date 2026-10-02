# Notification worker wake/sleep migration

The source v41 catalog observed `2026-10-02T14:21:25.605664+00:00` contains:

| Source definition | SHA-256 |
| --- | --- |
| `activate_notification_worker` | `165d1495b7bd7d1c3f7da09727aceb16f71cfa7a44e8030470408c61351ed950` |
| `activate_notification_worker_on_pending_event` | `fbf33c2e5a1836d85b7cd3e39ce425dd547cc081a98866ccf4756fbcbfbcec59` |
| `deactivate_notification_worker_if_idle` | `d973f8937fbbf22d095eae23f18255ce71d2cf6209bb967cce426666a0933701` |

The trigger runs after INSERT or UPDATE OF status/trigger_at with NEW pending.
Wake and sleep use one transaction advisory lock; future pending events keep
Cron active. Scheduler failures warn instead of failing the business operation.
Cloudflare staging uses a SQLite Durable Object alarm instead of minute Cron.
The repaired manual-event API passed the pinned synthetic wake/delivery/stop
and interrupted-bridge recovery rehearsal. Broad migration acceptance remains open.

## Prepared implementation

Additive Business `0024_notification_worker_wake.sql` records a monotonic
requested generation in the event's own D1 transaction. Suppressed marker
updates or missing schema abort the event rather than claim a durable wake.
This is a schema-integrity failure; an unavailable external scheduler does not
roll back an otherwise committed user operation.

`workers/api/src/notification-wake.ts` exports one SQLite-backed
`NotificationWakeCoordinator`. With both `NOTIFICATION_PROCESSOR_BACKEND=d1`
and `NOTIFICATION_WAKE_BACKEND=durable-object` plus its namespace binding,
HTTP mutations flush the native outbox through the request's waitUntil lifetime.
Scheduled producer jobs flush in their own finally path, including failures
with committed effects. User cookies, headers, IDs and payload are not forwarded
to or stored in the coordinator. Logs contain only bounded job/status/counts.

The coordinator serializes short wake/sleep reconciliation, arms before
acknowledging a committed generation, and compares that generation again in SQL.
A raced D1 writer keeps a durable wake; later calls cannot postpone an earlier
alarm. Alarm processing occurs outside the short concurrency block and retains
an alarm before D1 work. Pending/future events and unexpired processing leases
keep a wake; stale processing is reclaimed by the existing processor. An empty
queue clears the alarm. Failures retain the next attempt beyond the platform's
finite automatic retries. Cutover freeze retains work without processing it.

This change schedules notification **events**. The existing source-shaped
processor still leaves delayed in-app delivery rows pending and has no separate
due-delivery sender. That inherited behavior needs its own source/specification
review; event wake/sleep tests do not establish delayed delivery acceptance.

A failed post-commit bridge leaves an unacknowledged D1 generation. A later
mutation replays it. The registered daily `0 0 * * *` entrypoint also replays
it through the selected expiry job's finally path, even while
`LICENSE_EXPIRY_BACKEND` is unset and that job returns disabled. Native tests
prove recovery after a missing-namespace bridge, then show that a later daily
invocation leaves the drained queue without an alarm. This is conditional on
the daily invocation reaching that finally path and D1/DO being available;
it is not a one-minute recovery guarantee. A hard interruption in the
commit-to-bridge gap still needs one of those replays or operator recovery;
D1 and Durable Object storage are not one transaction. Do not describe the
bridge as an exactly-once external commit.
`POST /api/admin/notifications/wake` replays queued work and `GET` reads the real
alarm time, generations and pending/processing counts. Both require explicit
allowed Origin and the existing administrator/current-session MFA gate. Neither
returns payload, recipients or error internals. The endpoint also repairs a
missing alarm even if an earlier generation was acknowledged. Trusted CLI
writers/importers must invoke the repair path after committing pending events.
The operator route is excluded from the generic fetch-finally bridge: rejected
Origin/MFA requests cannot replay the outbox as a side effect of that bridge.

Cloudflare's [alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)
supports direct durable scheduling and retries. SQLite-backed objects are
[available on Workers Free](https://developers.cloudflare.com/durable-objects/platform/pricing/).
This design does not authorize a paid-plan change.

## Current validation and remaining scope

Remote Business 0024 and its four exact schema objects are applied; canonical
ledger is 25. Repair code head `41cefc3` passed both CI jobs in `37053995420`.
Worker `ea309178-690c-4cc3-b72e-b3619cd5b444` is 100% on workers.dev only, with
SQLite namespace `2c27a340fd6c4248bfdbbb8d8bfb457c`, alarm selectors and daily-only
Cron. Fresh dedicated-account/empty source/Auth/secret-name/version guards ran
before deployment. Public build hashes, noindex, catalog 3,944, anonymous operator
401, missing-Origin 403 and disabled Stripe 404 pass.

The initial `49d22f73` manual-event smoke returned 503 but its private journal
proved full cleanup and NULL alarm 1/1. A guarded native probe then returned one
inserted ID with `meta.changes=2`: the event INSERT and marker UPDATE both contribute
to remote D1 aggregate metadata. That probe was journaled and removed by exact
ID/source/nonce. The repair checks exactly one matching `INSERT ... RETURNING id`
receipt, not aggregate changes. Full-schema workerd regression reproduced the
old 503 and passes 20/20 after repair, covering actual delivery/idle stop with
remote-style metadata, suppressed inserts and missing-marker rollback. Master
suite 6/6, typecheck/lint, build and pinned dry-run pass. Other direct event producers
do not require one aggregate change for their event INSERT; processing/terminal
transitions do not fire the pending-only marker trigger. Native SQL `changes()`
guards remain unchanged.

The pinned real TOTP alarm smoke on `ea309178` exited 0. Manual creation returns
201 and the real status exposes an active alarm, one pending event and generation
3/3. Exact Japanese in-app delivery drains to NULL alarm/empty 3/3. A native future
event leaves NULL alarm, one pending and generation 4/3; GET preserves that gap.
MFA repair arms the alarm and acknowledges 4/4 while retaining the future timestamp.
A native due-time update plus MFA repair delivers exactly once and stops at 5/5.
The final journal `fanmark-notification-alarm-canary-Hwogoy/canary.json` is
`verified-and-cleaned`, authRows 0, with two fixtures. Cleanup confirms NULL alarm,
zero pending/processing and generation 5/5 before Auth removal, then eight Auth
tables/source-owned Business empty, session null and retained Master/config/
catalog/Auth fingerprints unchanged. No live user data or real email was used.

Evidence: `/tmp/fanmark-notification-returning-{ci,preflight,deploy,http,staging-smoke}.log`,
matching deployments/version/http-readback JSON, the failed initial smoke log,
native metadata probe log and full-schema regression-before/wake/master logs.
Do not reapply 0024. Rehearsals use a pinned current version:

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-100-percent-version> node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-alarm-roundtrip
```

Configuration/isolation checks passed 17/17 and migration-data 248/248 before
activation. Guards require complete daily-only alarm mode and closed billing/
email/expiry/archive selectors. Local scheduled rehearsals disable wake; disposable
recovery Workers keep their own bindings/vars. Atomic journal updates preserve
pre-write nonces/IDs through cleanup, including the follow-up terminal state update.
The script-only terminal improvement has syntax/lint checks; the remote rehearsal
above ran the repair head before that follow-up.

The proven recovery path closes this event scheduler rehearsal, not the full
source catalog gate. D1/DO commits remain separate; hard missed bridges require
later mutation/daily replay or MFA repair. The daily failed-bridge/empty-queue
path is local evidence, not a new remote recovery rehearsal. Delayed in-app delivery and other channels still need their
own source/specification/provider review. Broader functions/policies/triggers,
CPU, operational/mobile gates and provider acceptance stay open. Real user data
and domain/DNS remain deferred.

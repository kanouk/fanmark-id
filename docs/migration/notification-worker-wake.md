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
The current Cloudflare staging replacement polls every minute even when empty,
so runtime wake/sleep parity is not yet established.

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
mutation replays it. A hard interruption in the commit-to-bridge gap still
requires replay or operator recovery; D1 and Durable Object storage are not one
transaction. Do not describe the bridge as an exactly-once external commit.
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

## Evidence and next gate

The dedicated local suite passes 17/17, applies all 25 Business migrations and uses the real
workerd SQLite Durable Object/D1 runtimes. It checks idle stop, actual in-app
delivery, coalescing, future events, stale leases, concurrent enqueue/sleep,
binding outages beyond six attempts, monotonic/suppressed generations, freeze,
protected recovery/status and both HTTP/scheduled entrypoint bridges. No remote
0024, namespace or selectors have been applied. Current staging still uses its
existing minute Cron. Do not clear the broad source catalog gate from this
three-function/one-trigger review.

Existing notification D1 15/15, general API 56/56, reset regression 15/15,
migration-data 246/246, Worker typecheck, targeted ESLint and local-alarm plus
current-staging dry-runs pass. The new TOTP smoke flag
`--notification-alarm-roundtrip` requires the fixed alarm target configuration,
account/version/ledger/trigger gates and a private pre-write Auth/fixture journal.
It verifies API-created wake and drain, native future-event interrupted-bridge
recovery through MFA, due-time update/delivery, retained fingerprints and scoped
cleanup. Its target guard passes 2/2, and script syntax/lint pass. The live alarm
smoke remains unexecuted; the present minute-Cron config was refused before any
remote operation. Fresh Wrangler identity readback confirmed the dedicated
staging account. Journal updates use private temporary files and atomic rename;
an interrupted update does not truncate the previous recovery checkpoint.

Prepared command, only after configuration/deployment/readback gates:

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-100-percent-version> node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-alarm-roundtrip
```

The journal stores each unique payload nonce before event creation and the
returned event ID immediately after a successful response. Cleanup does not
depend on receiving that response: it matches the journaled synthetic recipient,
event type/source and payload nonce, deletes notification children first, and
checks the deployed alarm is NULL before removing MFA/Auth identities. Monotonic
MFA and notification wake generations are retained. A failed cleanup retains the
journal for scoped recovery and is not an accepted rehearsal.

Before enabling: require green CI, fixed staging account/bindings/version,
empty source/Auth rows and private recovery journal, apply/read back 0024 and
its ledger/triggers, add the SQLite namespace/class migration, and replace
notification polling with the alarm mode. Keep billing/email selectors closed.
The synthetic acceptance must prove a real API-created event wakes delivery,
protected status reads a real alarm then NULL after drain, post-commit recovery
works, master baselines remain intact and exact Auth/business/guard cleanup
completes. Mobile, external provider delivery and production remain separate.

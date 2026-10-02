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
Runtime acceptance remains pending after a live manual-event API failure.

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

## Current validation and next gate

Activation head `7ec0c00` passed both CI jobs in `37051952726`. Dedicated-account,
empty source/Auth, ledger and old-version guards preceded remote 0024 apply.
Four schema objects match checked-in SQL; Business ledger is 25. Worker
`49d22f73-3684-4f66-b457-17f63c07ca52` is 100% on workers.dev only, with SQLite
namespace `2c27a340fd6c4248bfdbbb8d8bfb457c`, alarm selectors and daily-only Cron.
Public build hashes, noindex, catalog 3,944, anonymous operator 401,
missing-Origin 403 and disabled Stripe 404 pass.

The first pinned alarm smoke reached real sign-in/TOTP/MFA but manual creation
returned 503. Its pre-write journal ended `failed-and-cleaned`, proving removal
of Auth/source fixtures, NULL alarm and wake generation 1/1. A guarded native
probe returned one inserted ID with `meta.changes=2`: the event INSERT and wake
trigger marker UPDATE both contribute to remote D1 metadata. The exact probe
event was removed and source rows verified zero; its requested generation stays
for replay without rewinding the marker. Both runs have private recovery journals;
neither is accepted notification delivery evidence.

Manual creation now requires exactly one matching ID from `INSERT ... RETURNING
id`. It does not compare aggregate changes to 1. Suppressed inserts have no receipt;
missing-marker ABORT still rolls back the event. Full-schema workerd regression
reproduced 503 before repair and now passes 20/20, proving delivery and idle stop
with remote-style metadata, suppressed insert refusal and missing-marker rollback.
Notification master 6/6 and Worker typecheck pass. Other direct event producers do
not compare event INSERT metadata to 1; processor processing/terminal transitions
do not fire the pending-only trigger. Native SQL `changes()` guards remain unchanged.

Configuration/isolation checks passed 17/17 and migration-data 248/248 before
activation. Complete alarm target guards require daily-only Cron and closed
billing/email/expiry/archive selectors. Local scheduled rehearsals disable wake
so local DOs cannot acknowledge the remote outbox; disposable recovery Workers
retain their independent binding/vars allowlist.

Next: green repair CI, fresh account/version/empty-data guard, workers.dev redeploy
and pinned TOTP smoke. Do not reapply 0024. Acceptance requires real API 201, alarm
wake, exact Japanese delivery, NULL alarm after drain, native future-event bridge
recovery via MFA, due-time rescheduling, retained Master/config/catalog fingerprints
and scoped cleanup. A prepared test or failed-cleaned run does not satisfy it.

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-100-percent-version> node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-alarm-roundtrip
```

Private journal updates use atomic rename. Payload nonces are saved before each
write and returned IDs immediately after 201; cleanup matches synthetic recipient,
type/source/nonce even after response loss, deletes children before events, and
requires actual NULL alarm before Auth removal. Monotonic MFA/wake generations
are retained. Broad source/provider/delayed delivery/CPU/operational/mobile gates
remain open; real user data and domain/DNS stay deferred.

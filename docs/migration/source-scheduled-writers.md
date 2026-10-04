# Source scheduled-writer metadata

## Current source scheduler refresh (2026-10-05 JST)

Observation2026-10-04T23:39:28.09197+00:00 retains the two rows below:
notification polling inactive, daily expiry active, UTC/GMT schedules and both
command hashes unchanged. See [fresh source metadata](evidence/source-current-readonly-refresh-2026-10-05.json). No raw command, credential or application/
Auth row was read into the report; command mentions still do not prove successful
invocation or exclude external/indirect callers. Source writer freeze remains
a separately authorized final cutover step.


`scripts/migration/source-scheduled-writers.sql` runs one read-only transaction
with a ten-second timeout against the verified linked source project. It reads
`cron.job` operational metadata, no application/Auth rows. It excludes raw
commands, URLs, job names and credentials. Commands become PostgreSQL SHA-256
digests plus fixed literal operation mentions using `strpos` (no LIKE wildcard matching); an empty mention list is an
unclassified job. Keep query output private.

## 2026-10-03 observation

Observed at `2026-10-02T21:44:12.512016+00:00`, private evidence
`fanmark-source-scheduled-writers-AdGAl7/{query,metadata}.json`. Session timezone
UTC, cron timezone GMT. The metadata scope, boolean state, distinct numeric IDs
and valid SHA-256 digests were checked.

| Command mention | Schedule | Active | Command SHA-256 |
| --- | --- | --- | --- |
| `process-notification-events` | `* * * * *` | false | `4a91f5efe8e2b06eb9dce1797cb016ed9116c2e2478a50d1a39d055d42f2d806` |
| `check-expired-licenses` | `0 0 * * *` | true | `1a89b98b2d351ccb187f3fad2477aa728cddb6896f62139d41edffeaa38bcf14` |

No command literally mentions `manual-expire-grace-licenses` or
`archive_old_notifications`. This does not rule out indirect functions, dynamic
commands, external callers/schedulers or jobs added after this observation.
Active state and a string match do not prove a successful invocation. Earlier
function catalogs and this query are separate observations.

At the observation above, the staging daily lifecycle selector was unset;
notifications use D1 wake state and Durable Object alarms. Recorded synthetic
lifecycle/alarm acceptance does not close recurring activation, CPU/plan fit,
archive invocation/retention, external-caller or full freeze/recovery gates.
No schedule, function, deployment or user data changed. Real user-data migration
and domain cutover remain deferred. Re-read metadata immediately before a
separately authorized final source-writer freeze.

## Current staging configuration (2026-10-05 JST)

This is separate from the source metadata observation above. The current
`wrangler.app-staging.jsonc` enables `LICENSE_EXPIRY_BACKEND=d1` and
`NOTIFICATION_ARCHIVE_BACKEND=d1` on the daily `0 0 * * *` trigger.
Runtime12fa13f/Workercc6d9da7 is deployed with these settings. The isolated
archive and one-shot lifecycle proofs remain bounded acceptance; the main
09:00 JST natural invocation has not yet been observed. See
[completion conditions](COMPLETION.md) and [operations](OPERATIONS.md).
No source writer was disabled or changed.

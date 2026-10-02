# Emoji master change audit

## Contract

The schema-only source review found `log_emoji_master_changes` records each
canonical `emoji_master` INSERT/UPDATE/DELETE in `audit_logs`. Its actor is
`auth.uid()`, resource type is `emoji_master`, resource ID is the stable UUID,
and metadata contains only `emoji` and `short_name`. UPDATE/INSERT use NEW
values; DELETE uses OLD values. Public release activation is a separate audit.

Cloudflare keeps these change audits beside the mutable draft in Master D1,
using `fanmark_emoji_master_change_audits`. Business D1 cannot participate in
the same transaction. Master migration `0008_emoji_master_change_audits.sql`
is additive; applied migrations remain unchanged. It is unrelated to Auth D1's
separately selected `0008_auth_user_suspension.sql`.

The Worker passes the authorized administrator UUID to the repository after
the existing role/same-session MFA gate. Browser JSON cannot supply an actor.
A D1 batch inserts one temporary singleton context, mutates the canonical
draft, then removes the context. Native triggers store the source action,
actor, resource, exact metadata, captured UTC microsecond operation timestamp
and per-request UUID. Each changed import row gets an audit with that same
request ID. Audit insertion errors, suppressed inserts and corrupted values
abort the entire mutation; context rolls back too. Concurrent batches retain
their own actors. Trusted direct seed/maintenance writes have a NULL actor and
request ID, matching service-role `auth.uid()` semantics. Deletion history
has no canonical-row foreign key and survives trusted draft deletion.

Import still accepts up to 100 validated records. One bound JSON array is
expanded through `json_each` into one INSERT/upsert, alongside two context
statements, avoiding one API SQL statement per row. Existing UUIDs and creation
times survive upsert. Row update times advance monotonically even under a
fixed clock. D1 `meta.changes` may include trigger effects; successful writes
therefore require positive changes rather than exactly one. Stale edits,
duplicate creates, released-identity edits and API deletion remain rejected.
Draft operations never activate or modify the immutable public release.

## Verification and staging boundary

Local Auth/Worker/Master D1 suite passes 34/34, including:

- Server actor and source-shaped audit fields; spoofed actor rejection;
  reads and rejected writes add no audits.
- Missing/corrupted required audits roll back draft/context; retry commits once.
- A mixed import rolls back both its existing-row update and new-row insertion
  when either required audit is missing; successful retry shares one request.
- 100-row import and repeated upsert produce 100 exact per-row audits each,
  retain UUIDs/creation times and advance update times.
- Simultaneous actors remain separate; actorless repository writes fail closed.
- Trusted insert/update/delete preserve NULL actors and deletion history.

Migration-data tests pass 237/237; emoji/reference release integrations pass
7/7 and 6/6. CI `37031840989` on `ff7bcb8` passed both jobs. Master migration
0008/ledger and all three exact triggers are readback-verified, with no pending
Master migration. Worker `10f62b09-8592-449e-9040-4e396a395175` is deployed at
100% on workers.dev after fresh build/dry-run. HTTP/anonymous gates/noindex and
local/public JS hash match. Remote canary completed all checks below and cleanup.

The initial canary completed its functional checks and Master cleanup, but the
shared smoke's target-cleanup flag list omitted this mode. A target synthetic
Auth user/profile remained. Exact private-journal recovery removed those rows;
all modes now clean their always-provisioned target, and the fresh full run
completed `verified-and-cleaned`. MFA generation remains monotonic.

This establishes the mutation/audit storage contract. Administrator user-detail
history now combines Business/Auth/Master audit stores with an exact target-actor
filter and latest-20 UTC-microsecond ordering. Missing bindings or failed Master
queries fail closed, rather than returning incomplete history. The local user
management suite passes 14/14, including submillisecond ordering, other/NULL
actor exclusion and credential/PII redaction. The extended TOTP staging smoke
compares the latest 20 exact Master audit DTOs; deployment/readback is pending.

The guarded synthetic staging command is:

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-current-version> \
  npm --prefix workers/api run test:staging-admin-totp -- \
  --run-live-staging-write --database=fanmark-auth-staging \
  --emoji-master-audit-roundtrip
```

Before writes it pins the Cloudflare account, workers.dev Worker/version,
split D1 bindings, applied migration and exact three audit triggers. Auth must
be empty. Private recovery journals contain synthetic IDs and planned emoji;
credentials, TOTP secrets and cookies are never logged. The synthetic-only
flow signs in and verifies real TOTP against staging, creates/edits one private
draft and imports 100 private emoji sequences. It checks 102 exact actor/row
audits, shared import request/time, no context leak, and the unchanged public
3,944-row catalog digest. Cleanup removes only planned synthetic draft IDs and
their scoped audits, then restores the Master count/pointer/audit baseline and
verifies Auth cleanup. MFA generation remains monotonic during factor changes.

This does not migrate real users or old source audit rows, send email, connect
an external payment/OAuth provider, or change public DNS. It does not clear the
broad function/RLS/trigger catalog gate.

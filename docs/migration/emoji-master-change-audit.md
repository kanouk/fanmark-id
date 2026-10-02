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

Migration-data tests pass 237/237. Release integration, CI and remote evidence
are recorded in EXECUTION/HANDOFF as they complete. The new migration and
Worker changes are currently local; remote application is still pending.

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

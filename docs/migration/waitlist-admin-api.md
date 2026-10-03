# Waitlist admin API migration

`SecureWaitlistAdmin` reads the waitlist through a restricted Cloudflare Worker
when `VITE_WAITLIST_ADMIN_BACKEND=worker` is selected. The Worker requires
`WAITLIST_ADMIN_BACKEND=d1`, split business D1, Better Auth, the existing
same-session admin MFA check, and a `user_settings.plan_type='admin'` row for
the caller. The plan check retains the source's elevated-admin requirement;
the current-session MFA check is stricter than the local Supabase schema's
four-hour recent-session check. The source `is_super_admin` attempts an admin-
plan lookup, but its non-STRICT SELECT/IF NOT branch can continue with NULL when
no matching admin row exists. The target explicitly refuses missing/non-admin
rows; the source definition and literal five-case PostgreSQL evidence are in
[source access helpers](source-access-helpers-review.md). Source denial helpers write
the rejected action and email resource ID/risk. Target role/MFA and imported
user mapping still need production acceptance before moving real users.

`GET /api/admin/waitlist` returns at most 100 rows, with email addresses
replaced by their lowercase SHA-256 digest. It also returns at most 50 audit
rows containing only ID, action, resource type, and timestamp. The existing
CSV export therefore continues to contain hashes only. `GET
/api/admin/waitlist/:id/email` reveals one address after the UI confirmation;
the Worker persists an `EMAIL_ACCESS` audit row before returning the address
and fails closed if that write fails. Audit metadata records purpose and row
identity, never the email itself. Qualified administrators without the elevated
plan get `403 super_admin_required` after a durable denial audit. Email denials
retain the requested waitlist ID, `CRITICAL_RISK` and `email_address`; list
denials retain `HIGH_RISK` without a resource ID. The source's
`notify_security_breach` AFTER-audit trigger only emits a database NOTICE and
does not send an external alert. The Worker replaces that with a bounded
`console.warn` JSON containing event/action/audit ID/UTC operation time after
the denial audit commits. Actor/resource lookup stays in D1, so diagnostics
do not repeat user IDs, raw email, IP, authorization or cookies. Missing audit
writes fail closed with 503 and do not report a persisted-audit alert. Routes
rejected by the earlier MFA/origin/method gate do not create these D1 audits.
Local route tests pass 9/9; denial diagnostics are staging-verified on Worker
`4199fd09-8080-4944-8c09-6932e94913b2`. Both routes are same-origin, credentialed,
and `no-store`; API errors never fall back to Supabase after Worker selection.

The D1 waitlist table is structurally present, but real waitlist rows have not
been imported. Public staging submissions now use the separate
`POST /api/waitlist` contract documented in
[`waitlist-signup-api.md`](waitlist-signup-api.md); the regular frontend build
continues to use Supabase. Admin API canaries must remove the exact address,
synthetic admin profile, and audit rows; public-signup canaries remove their
single marked entry. No production selector, user data, or domain/DNS setting
is changed by this work.

Email retention, deletion, and export policy remain open decisions. The
current CSV intentionally includes hashes only. Local route tests are
`npm --prefix workers/api run test:waitlist-admin-d1`; frontend response and
selector tests are included in `npm run test:migration-data`. On 2026-09-27,
the live synthetic staging canary passed list/reveal authorization and data
minimization checks on Worker version
`676be6eb-f0fb-4741-8f84-4880fbb9052f`; it read back zero synthetic waitlist,
profile, audit, and user-owned Auth rows after cleanup. The first harness run
found that a null-resource-ID list audit and the standalone action's synthetic
target user were omitted from shared cleanup; both harness predicates were
fixed and a repeat run passed. See the detailed result and scope boundaries in
`docs/migration/HANDOFF.md`.


The guarded denial staging command is:

```sh
FANMARK_EXPECTED_STAGING_VERSION=<verified-current-version> \
 npm --prefix workers/api run test:staging-admin-totp -- \
 --run-live-staging-write --database=fanmark-auth-staging \
 --waitlist-security-roundtrip
```

It requires empty user-owned Auth tables, pins account/Worker version/split D1
bindings and the applied Master audit triggers, and journals synthetic IDs
before Auth and waitlist writes. It checks authorized hash-list/reveal, removes
only the synthetic caller's elevated plan, checks two 403 denials and exact
D1 risk/resource/time fields, then removes scoped source/Auth rows. On 2026-10-03 the pinned canary passed and its private journal ended
`verified-and-cleaned` with user-owned Auth rows zero. A live version-pinned
operator tail captured two sanitized warning events; action/audit ID/time
exactly matched both D1 denial audits. The tail was then stopped (exit 0).
No email was sent.

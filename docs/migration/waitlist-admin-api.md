# Waitlist admin API migration

`SecureWaitlistAdmin` reads the waitlist through a restricted Cloudflare Worker
when `VITE_WAITLIST_ADMIN_BACKEND=worker` is selected. The Worker requires
`WAITLIST_ADMIN_BACKEND=d1`, split business D1, Better Auth, the existing
same-session admin MFA check, and a `user_settings.plan_type='admin'` row for
the caller. The plan check retains the source's elevated-admin requirement;
the current-session MFA check is stricter than the local Supabase schema's
four-hour recent-session check. Recheck the live Supabase function and role
mapping before claiming production authorization parity or moving real users.

`GET /api/admin/waitlist` returns at most 100 rows, with email addresses
replaced by their lowercase SHA-256 digest. It also returns at most 50 audit
rows containing only ID, action, resource type, and timestamp. The existing
CSV export therefore continues to contain hashes only. `GET
/api/admin/waitlist/:id/email` reveals one address after the UI confirmation;
the Worker persists an `EMAIL_ACCESS` audit row before returning the address
and fails closed if that write fails. Audit metadata records purpose and row
identity, never the email itself. Both routes are same-origin, credentialed,
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

# Admin user suspension API

The staging admin user-management selector uses `POST /api/admin/users/:userId/status`
for account suspension and restoration. The route is available only when
`AUTH_BACKEND=better-auth`, `ADMIN_USER_MANAGEMENT_BACKEND=d1`, and
`AUTH_USER_STATUS_BACKEND=d1` are selected. The last selector enables the
matching Better Auth fields and session-create guard only after the Auth D1
migration is present; other local Auth fixtures stay on their unchanged schema.
It uses the same administrator-role, current-session TOTP assurance, allowed
origin, and no-store checks as the user list/detail and plan routes.

The request body is `{ userId, suspend, reason?, bannedUntil? }`. The path and
body user IDs must match. Reasons are limited to 2,000 characters. Suspension
defaults to five years; a supplied expiry must be a valid future timestamp.
Restoration clears the ban fields. An administrator cannot suspend their own
account.

Auth D1 migration `0008_auth_user_suspension.sql` adds Better Auth-compatible
`banned`, `banReason`, and `banExpires` columns. Better Auth's session-create
hook blocks a currently suspended user and clears an expired suspension before
issuing a new session. An Auth D1 trigger independently rejects session inserts
for suspended users, closing the race between the sign-in check and a concurrent
admin suspension. Suspending an account updates its state, removes its sessions,
and inserts the immutable Auth-side admin audit record in one D1 batch. If the
audit insert fails, the whole state/session mutation rolls back. Restoration is
also audited in Auth D1. User list filters and detail DTOs read the effective
suspension state from Auth D1; status audit rows are included in the detail
history.

Local validation covers session revocation, login denial, expiry recovery,
session-insert race protection, audit rollback, and admin authorization. The
staging TOTP smoke accepts
`--admin-user-status-readback`; it creates only a synthetic target/session,
verifies suspend/list/detail/restore and anonymous denial, then removes the
synthetic identity, session, and audit records. Password-reset delivery and
immediate fanmark expiry remain separate routes and are not enabled by this
change. No production route, source user row, email, Stripe request, or
domain/DNS state is changed.

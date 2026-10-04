# Admin password reset API

Worker mode exposes `POST /api/admin/users/:userId/password-reset` for an
administrator who passes the same-origin, role, session, and same-session MFA
checks used by the other admin user-management routes. The request body is
`{ userId, reason? }`; the body ID must match the path and the reason is limited
to 2,000 characters.

The Worker loads the target address from Auth D1 and calls Better Auth's
password-reset API. Better Auth creates and retains the reset token, and its
configured Resend callback sends the email. The callback URL is pinned to the
configured Better Auth origin and `/reset-password`; the browser response
contains only `{ success, userId, requestedAt }`. It never returns the email,
reset token, or reset link.

The route returns 503 before reading the target or writing an audit row unless
`AUTH_EMAIL_BACKEND=resend`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and the
Better Auth configuration are present. A provider failure returns 502. The
business audit row records an `attempted` action before the provider call so a
failed delivery attempt remains reviewable; it contains the admin actor,
target ID, reason, and timestamp, but no email or reset credential.

Local tests inject a synthetic delivery callback and verify authorization,
payload validation, successful request projection, missing-provider behavior,
and retained audit evidence after a provider failure. They do not send email.
The staging control is available only when the staging selectors are enabled;
actual delivery remains closed until Resend secrets are set through Cloudflare
Worker secrets. Production/default routing remains on Supabase.

# Auth email templates on Cloudflare staging

The migration moves only the 16 rows for the existing `signup`, `recovery`,
`magiclink`, and `email_change` templates in `en`, `ja`, `ko`, and `id`. The
source query is allowlisted to those fields and types; it reads no accounts,
preferences, email delivery records, or other user-owned rows. The staging seed
is `scripts/migration/staging-auth-email-template-seed.sql` and leaves any
existing matching template ID unchanged.

`AdminEmailTemplates.tsx` can select the same-origin Worker client with
`VITE_EMAIL_TEMPLATES_BACKEND=worker`. `GET /api/admin/email-templates` returns
the 16-row allowlist. `PATCH /api/admin/email-templates/:id` changes only
subject, body, and button label, requires a fresh `updated_at` compare-and-swap,
and writes its MFA-authorized admin audit entry in the same D1 batch. The
Supabase path remains the default when the selector is absent.

Better Auth passes the user ID to its verification and password-reset email
callbacks. With `AUTH_EMAIL_TEMPLATE_BACKEND=d1`, the Worker resolves the
user's `preferred_language` from business D1, defaults missing/unsupported
preferences to Japanese, then selects the active `signup` or `recovery` row.
Stored body text and button text are HTML-escaped before rendering. A missing
binding, locale template, or active template fails closed; it never silently
switches to the static Worker copy. With the selector unset, the existing static
Worker copy remains available. `magiclink` and `email_change` rows remain
managed as catalog data, but the current Better Auth callbacks only send
verification and password-reset email.

The checked-in seed is verified against a source snapshot and remote D1 with:

```sh
node scripts/migration/verify-staging-auth-email-template-seed.mjs /path/to/private-auth-email-templates.json
```

The verifier requires exactly 16 unique allowlisted rows, checks a pinned
content digest and the seed SQL digest, compares every selected field after
remote readback, and confirms the principal user-owned business tables remain
empty. It prints row counts and hashes, never template text.

Local Worker/client tests and typechecks pass. On 2026-09-26, the checked-in
seed rows were reconstructed in an isolated SQLite database and their
normalized content matched the pinned source digest. After Wrangler identity
matched the intended Cloudflare account and a remote baseline confirmed zero
allowlisted template rows and zero core user-owned rows, the 16-row seed was
applied to `fanmark-business-staging`. The verifier confirmed exact field
readback, the source-content digest, the seed SQL digest, and zero user-owned
rows. Staging Worker version `9b1f777e-76e1-4721-8408-1fd44145b4b0` now selects
the D1 editor/template reader; root, robots, Auth health, and Auth capabilities
return 200, while anonymous admin-session/template requests return 401. Signup,
OAuth, and email delivery remain disabled. A synthetic TOTP admin read all 16
rows from the protected editor API; each field matched the D1 readback and the
GET left D1 unchanged. The canary removed its synthetic Auth rows. No message
was sent and no real user data, production route, or domain/DNS state changed.

On 2026-09-27, an explicit live edit canary used the MFA-protected Worker API to
append a temporary marker to the Japanese signup subject, rejected anonymous
and stale writes with 401 and 409, then restored the original subject, body, and
button text. A final readback confirmed all 16 rows' content and non-editable
fields matched baseline; only that row's `updated_at` advanced through the two
audited writes. The canary removed its two synthetic audit rows and temporary
Auth identity. The first attempt exposed a missing test-harness cleanup guard;
its exact synthetic Auth/profile rows were removed and verified zero before the
corrected smoke was rerun successfully. The staging secret-name inventory has
no Resend key or sender identity, and the admin edit path sends no email. No
message was sent.

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

Local Worker/client tests and typechecks pass. As of this checkpoint, the
staging D1 seed and Worker deployment have not been applied: Wrangler rejected
its saved credential with Cloudflare authentication error 10000, and the
available browser consent session belonged to a different Cloudflare account.
No email was sent. The next live step is to authenticate Wrangler as the
Cloudflare account `bfc2890741f0b3fb236e2d755b6c9adc`, re-check the target D1
baseline, apply the master seed, verify exact readback, and deploy the staging
Worker/SPA.

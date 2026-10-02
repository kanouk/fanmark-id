# Staging provider integration readiness

This checklist covers the remaining provider rehearsal in #31/#32/#34/#37.
It does not authorize real billing, real email delivery, production provider
configuration changes or the deferred user-data/domain cutover. Local SDK
tests and present secret names do not prove a working provider connection.

## Observed boundary

Read-only inventory at `2026-10-02T22:50:13.212Z` verified the dedicated Wrangler
identity `fanmark.id@gmail.com`, account `bfc2890741f0b3fb236e2d755b6c9adc` and
100% deployment `010a4d7a-9cd2-4683-b38f-ff6ad0dd82ec` before listing secrets.
The Worker had only `BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`
and `VERIFIED_ACCESS_SECRET`. No secret values, source users or D1 rows were
read and no provider API was called. The private report is
`/tmp/fanmark-staging-provider-inventory.json`.

The selectors below were absent in the checked-in app staging vars. This is
a checked-in configuration observation, not a remote plaintext-var inventory.
Required names were absent from both that configuration and the remote
secret-name list; this does not establish whether credentials exist elsewhere.

| Integration | Required credential names | Activation selector |
| --- | --- | --- |
| Google | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `AUTH_SOCIAL_BACKEND=better-auth` |
| GitHub | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Same |
| Discord | `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET` | Same |
| Apple | `APPLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_CLIENT_SECRET` | Same |
| Auth email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | `AUTH_EMAIL_BACKEND=resend` |
| Stripe sandbox | `STRIPE_SECRET_KEY_TEST`, `STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_BACKEND=d1`, `STRIPE_DISPATCH_BACKEND=d1` |

Auth email already selects the D1 template backend. Stripe mode policy is
`test_only`; its dispatcher requires the minute cron in addition to selectors
and credentials. The app currently registers only the daily cron. Changing
cron must retain Durable Object notification scheduling and run the existing
scheduled-job/configuration checks. Broadcast sending is a separate feature;
enabling Auth email does not establish broadcast sender/webhook acceptance.
Checkout/portal/plan-change APIs additionally use `STRIPE_SECRET_KEY`; under
`test_only` it must equal `STRIPE_SECRET_KEY_TEST` and no live key may be
present. The ingress/dispatcher credential names alone cannot enable billing
API rehearsal. Each billing API also requires its own existing selector.

## Prepare credentials and provider callbacks

Use the migration worktree's `workers/api` directory and the explicit app
staging config for every Wrangler call. Recheck `whoami --json` and the latest
100% deployment before any setup; the ordinary default Wrangler profile can
belong to another project. Do not copy keys into frontend Vite variables,
checked-in files, logs or this document. Values belong in the provider console
and Wrangler's interactive secret input for the identified staging Worker.
The current integration work has not performed those writes.

The installed Better Auth SDK uses base path `/api/auth` and callback route
`/callback/:id`; the checked-in app base URL is
`https://fanmark-app-staging.fanmark-id.workers.dev`. The corresponding URLs are:

| Provider | Staging callback |
| --- | --- |
| Google | `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/google` |
| GitHub | `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/github` |
| Discord | `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/discord` |
| Apple | `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/apple` |

These are routes derived from the installed code, not evidence that each
provider accepts the workers.dev callback or that its console is configured.
Preserve the existing production Supabase callback. Provider client/subject
identity must be reviewed before choosing a different OAuth application,
particularly for Apple; matching email is not identity-migration proof.
`configuredSocialProviders()` currently sets `disableSignUp: true`. A console
setup and successful authorization screen alone do not prove first-login
creation or safe account linking.

## Evidence needed to close rehearsal

- OAuth: the actual staging return reaches Better Auth, establishes the intended
  subject/account mapping and session, preserves sign-up/invitation restrictions,
  and passes first-password setup and revoked-session checks. Synthetic local
  identities do not stand in for the provider's subject identifier.
- Auth email: an approved controlled recipient receives the rendered D1
  template; verification/reset links return to the permitted app origin and
  succeed once, with expiry/reuse and suspended-user refusal checked. Missing
  templates/credentials must refuse the send. Preserve the existing production
  email behavior until final cutover.
- Stripe sandbox: signed test-mode ingress persists its receipt; retry/replay
  and the dispatcher produce the expected customer/subscription/projection with
  idempotent receipts. Checkout/plan change/cancellation must use test keys,
  synthetic test objects and exact cleanup. Live receipts/keys remain refused.
- For each: pin the code HEAD and both successful CI jobs, record target
  account/version and pre-write fixture IDs, preserve Master/config baselines,
  remove only created fixtures and prove cleanup. Never record raw OAuth tokens,
  email link tokens, passwords or Stripe/Resend secrets in the evidence.

The credential and provider-console work, approved recipient/test-account
selection, actual integration rehearsal and relevant CPU/plan verification
remain incomplete. User/Auth/business/Storage migration and public DNS changes
remain deferred, as recorded in `HANDOFF.md`.

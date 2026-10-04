# Plan and general system settings on D1

## Scope and selectors

The staging SPA selects the Worker adapter with
`VITE_SYSTEM_SETTINGS_BACKEND=worker`; the staging Worker selects business D1
with `SYSTEM_SETTINGS_BACKEND=d1` and `D1_TOPOLOGY=split`. Production/default
builds keep the existing Supabase adapter. A Worker selection never falls back
to Supabase after an error.

The source export is an explicit 18-key projection for plan limits, plan prices,
Stripe Price ID configuration, `stripe_mode`, `invitation_mode`, and
`social_login_enabled`. It excludes user-owned data, Auth data, Storage, and
unclassified settings. Existing allowlisted `grace_period_days` and
`max_emoji_characters` rows remain separate, making the staging baseline 20
settings rows in total. The two Enterprise values are marked private. The
private source export is kept outside the repository with owner-only file
permissions; the selected source projection and staged D1 readback match the
pinned canonical SHA-256
`d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f`.

## API behavior

- `GET /api/system/settings` returns the exact 11-key public projection: plan
  display prices/limits, invitation/social-login flags, maximum emoji count, and
  Stripe mode. It never includes any of the six test/live Stripe Price IDs.
- `GET /api/admin/system-settings` returns those public keys plus the two
  private Enterprise values and six test/live Stripe Price IDs (19 keys total),
  after Better Auth admin-role and current-session
  MFA authorization.
- `PATCH /api/admin/system-settings` accepts one editable key, a new value,
  and its expected current value. It rejects stale edits, validates value
  formats, updates D1 with an audit row in one batch, and verifies the changed
  value. The audit stores the key, not old/new values.

All responses are `no-store`; API errors fail closed. Public access does not
include the two private Enterprise values or Stripe Price IDs. The plan UI waits for settings and
shows an error/retry instead of presenting fallback pricing when the Worker
cannot load them.

`AdminSettings` also edits the allowlisted `max_emoji_characters` value through
the same audited administrator API. Its input is limited to integers from 1 to
1,000,000 and is disabled when the setting projection cannot be loaded.
Invitation mode already has its editor in `AdminInvitationManager`.

The original 2026-09-27 settings slice treated Price IDs as public configuration.
The 2026-10-04 test-only provider setup made test IDs private, which exposed a
visibility mismatch and caused the actual `/plans` page to fail with HTTP 503.
The fixed public projection does not query Price IDs; missing or invalid private
configuration cannot hide valid public prices/limits. Admin reads still validate
the full projection and require MFA. Historical Price ID rows may carry either
visibility flag; neither flag can expose them through this API. Audited Price ID
updates normalize the changed row to `is_public=0`. Enterprise visibility checks
remain strict. No source or Master history is rewritten.

`stripe_mode` and Price IDs are configuration only. The original settings slice did not enable
Stripe checkout, subscription mutation, webhook processing, or a live payment.
Current test-only provider acceptance is documented separately in
`stripe-invoice-provider-validation.md` and `HANDOFF.md`. No production selector
or route was changed.

## Staging AdminSettings editor (2026-10-02)

The D1 admin API's editable-key allowlist now includes the already-projected
`max_emoji_characters` setting. `AdminSettings` exposes a bounded integer field
and disables saving if the settings projection cannot be read. Invitation mode
continues to be edited in `AdminInvitationManager`.

The Worker was deployed to `fanmark-app-staging` at 100% as version
`3293bea8-7929-4d6f-8786-886abd39348d`. A same-session synthetic administrator
canary verified TOTP/MFA, admin settings readback, stale-write rejection,
temporary maximum-emoji update and restoration, plus the existing lifecycle
settings form. D1 readback returned to `max_emoji_characters=5`; cleanup left
no synthetic Auth users, admin profiles, or setting audit rows. The monotonic
MFA generation counter may advance during factor enrollment and removal.

Local checks: system-settings client tests 4/4, Worker D1 settings tests 6/6,
root and Worker typechecks, targeted ESLint, Cloudflare staging build, Worker
deploy dry-run, and CI run `36897394913` on code head `7f66c5e` all passed. The
follow-up staging-canary harness update passed both jobs in CI run `36899737450`
on head `c5bf7a3`.
The browser canary used synthetic identities and configuration only. No
production route, user-owned data, Stripe provider, email, or domain/DNS was
changed.

## Staging evidence (2026-09-27 JST)

The exact 18-row projection was read back from
`fanmark-business-staging` and its canonical digest matched the private source.
The staging script now recognizes an already-applied exact projection and
verifies it without repeating the insert. The new Worker and SPA were deployed
to `fanmark-app-staging` at 100% as version
`3310b139-f639-4cf2-8a15-ad2b63f9fbd6`.

Live read-only smoke results: `/` returned 200; the public settings route
returned 200/no-store with exactly 17 expected keys and no Enterprise keys; an
anonymous admin settings request returned 401/no-store. The public response
values were not printed. Migration-data tests pass 124/124, Worker settings D1
tests 5/5, client contract tests 4/4, root/Worker typechecks pass, and the
Cloudflare staging build and Wrangler dry-run pass.

A synthetic Better Auth administrator completed first-time TOTP enrollment and
same-session MFA authorization, read the full admin projection, and updated
`free_fanmarks_limit` through the API. The canary verified the exact D1
readback, rejected an anonymous read and a stale-value update, restored the
original value, checked that both audit rows contain only the setting key, and
deleted those synthetic audit rows. Cleanup read back zero user-owned Auth
rows. The monotonic `mfaGeneration` singleton read back at 60 and is retained
by design. The admin API canary did not exercise the UI in a browser.

The browser-level lifecycle and maximum-emoji settings forms are verified with
a synthetic authenticated administrator. Populated-user behavior, Stripe
sandbox acceptance, full integrated #37 acceptance, production routing, real
user-data import, and final domain/DNS cutover remain open.

## 2026-10-04 fixed staging API checkpoint

`12fa13f` passed client 4/4, Worker/lifecycle 13/13, application/Worker
typechecks, targeted ESLint, and both jobs in CI37208535583. It was deployed at
100% as `cc6d9da7-b81b-45fe-b0be-6c0978570232`. Independent monitoring confirmed
public settings HTTP200/no-store with exactly 11 keys and no Price IDs;
anonymous admin reads returned HTTP401. Original Auth 2 users/6 accounts/1
session, owned business counts, Master history, MFA/wake, bindings/secrets,
and schedules were preserved. No schema or production change occurred.

The original actual browser fixture had reached Free dashboard and failed on
`/plans` before any Customer/Checkout/payment was created. It was removed and
independently verified. Post-deploy native UI confirmation remains pending:
the Mac is locked and requires a human unlock. API recovery is accepted; the
repaired screen and same-user whole billing UI are not yet accepted. See
`evidence/plan-settings-public-projection-2026-10-04.json`.

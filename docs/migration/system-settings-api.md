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

- `GET /api/system/settings` returns the exact 17-key public projection.
- `GET /api/admin/system-settings` returns those public keys plus the two
  private Enterprise values, after Better Auth admin-role and current-session
  MFA authorization.
- `PATCH /api/admin/system-settings` accepts one editable key, a new value,
  and its expected current value. It rejects stale edits, validates value
  formats, updates D1 with an audit row in one batch, and verifies the changed
  value. The audit stores the key, not old/new values.

All responses are `no-store`; API errors fail closed. Public access does not
include the two private Enterprise values. The plan UI waits for settings and
shows an error/retry instead of presenting fallback pricing when the Worker
cannot load them.

`stripe_mode` and Price IDs are configuration only. This slice does not enable
Stripe checkout, subscription mutation, webhook processing, or a live payment.
No production selector or route was changed.

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

Authenticated admin settings reads/updates, populated-user behavior, Stripe
sandbox acceptance, full integrated #37 acceptance, production routing, real
user-data import, and final domain/DNS cutover remain open.

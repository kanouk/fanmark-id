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
`configuredSocialProviders()` supplies the default `disableSignUp: true`, but
this is not the final staging sign-up configuration. The checked-in staging
selector `AUTH_SOCIAL_PROVISIONING_BACKEND=d1` makes
`createOAuthSignupIntegration()` override configured providers with
`disableSignUp: false` and attach the verified-identity provisioning hooks.
`index.ts` checks the business sign-in policy and required Auth/Business schema
before exposing social start/callback. This processing is deployed and accepted
with synthetic identities; without actual credentials, no configured provider
is exposed. A console setup or authorization screen alone does not prove a
real provider's first-login creation or safe account linking. See
[OAuth provisioning](oauth-signup-provisioning.md).

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

## 次の実接続に必要な入力

2026-10-03、元checkoutと移行worktreeのroot/Workerの`.env*`について、上表の
credential名があるかだけを確認した。値は表示・保存せず、該当名は見つからなかった。
これは他の管理画面・秘密管理先に存在しないという証拠ではない。
必要なのは以下の設定場所とテスト条件。秘密値はチャットやリポジトリに貼らない。

- Stripe sandbox、Resend、Google/GitHub/Discord/Appleの設定を参照できる管理画面、
  または秘密値を保管したローカルファイルの場所。
- Resendの検証済み送信元と、認証メールのテスト宛先、その宛先への送信許可。
- 各OAuth管理画面で上記staging callbackを設定できるアカウント。
- WorkersのCPU測定と現行契約を照合して、必要ならPaidへ変更する判断。
  これはR2有効化とは別で、この作業では購入・プラン変更をしていない。

実接続以外の残件はCOMPLETION.mdで進める。設定待ちをローカルfixtureで代替して
完了にせず、同じ受け入れ済み試験を繰り返して待ち時間を埋めない。

## Workersプラン判断の根拠

2026-10-04、ログイン中の対象accountのWorkersプラン画面で、Freeの「現在のプラン」を
確認した。現Wrangler OAuthのsubscriptions APIは403/10000、account settingsは
200でdefault_usage_model=standardだった。後者だけでは契約を判定できない。
Paidへの変更許可は入力待ちで、購入・変更はしていない。
[運用手順と観測](OPERATIONS.md)に、停止中のselector、監視・再開・秘密管理の残件を記録した。

2026-10-03に公式資料を確認した。Workers Paidはアカウントごと月額最低$5、
含まれるWorkerリクエスト/CPU枠を超えれば従量課金となる。他製品を含む総額を
$5と保証するものではない。[公式料金](https://developers.cloudflare.com/workers/platform/pricing/)。
FreeのHTTP/Cron CPU上限は10ms。ネットワークやDB応答の待ち時間とは別で、
一時的な上振れが成功しても継続的な適合の証拠にならない。
PaidのHTTP既定は30秒で、Cronの上限は実行間隔に依存する。
[公式CPU制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)。
認証等の実測をこの上限と照合し、現行契約と必要な制限を確認してから判断する。
Paid購入・変更の許可は未取得で、R2有効化からWorkers Paid契約を推定しない。

## 2026-10-04 access and plan update

The human signed in to the source Supabase dashboard. The authenticated provider
overview confirms Google/GitHub/Discord/Apple enabled; no source users or secret
values were copied. Edge Functions secret-name inventory also found Stripe and
Resend names. The names do not expose key values or establish sandbox/live mode.
Actual callback, provider-console setup and controlled email delivery remain open.

The human enabled Workers Paid; its current-plan selection was verified in the
account dashboard ([evidence](evidence/workers-paid-plan-2026-10-04.json)). The
previous Free observation and pending approval above are historical. No purchase
was performed by the agent. Daily job activation is being prepared independently
of provider setup, retaining notification alarms and keeping provider dispatch off.

GitHub OAuth apps now support up to 10 callback URLs. Inspect the existing app
before deciding whether to add the exact staging URL; preserve its Supabase URL.
Do not require a separate app solely based on the former one-URL restriction.
[GitHub current documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
This capability is not evidence that the account settings have been changed.

The authenticated GitHub provider form displays the existing callback as
`https://auth.fanmark.id/auth/v1/callback`. Preserve this exact custom Auth
domain callback during staging setup; do not replace it with an assumed
project-ref URL. The form was read only; its Save button remained disabled.

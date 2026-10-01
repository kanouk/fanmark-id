# Cloudflare移行の実行・再開手順

## 2026-10-02 disposable Cron API readback: 登録済み・実行未確認（15:06–15:24 UTC）

新規Worker Cronの登録readbackが曖昧だったため、15:06:14 UTCにD1/R2 bindingのない最小Workerを
`fanmark-staging-inapp` profileで配備。最初にprofileを指定せず実行したdeployは、作業tree外の一時
configが別の保存済みprofileを選び、API authentication error 10000で作成前に失敗した。正しいprofileを
明示した再試験は成功し、Cloudflare Cron Schedules APIのGETは200、`* * * * *`を返した。

Workerへの合成GETは200で、Worker固有tailにもfetchが表示されてtail接続を確認した。一方、Cron markerは
15:23:15 UTCまでの約17分間表示されず、Cloudflareの最大15分propagation後にもscheduled invocationを
観測しなかった。[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)の
伝播時間上限を越えている。Worker削除後のSchedules API readbackは404/code 10007、D1一覧は既存の3 staging DBのまま。
一時Workerとローカルdirectoryは削除済み。よってscheduleのcontrol-plane登録とfetch/tail経路は確認したが、
新規WorkerのCron deliveryは未確認。原因を特定するまでフルrecoveryを再実行しない。Issue #34/#37と
recovery gateは未完了。実ユーザーデータ、既存staging D1、R2、production route、domain/DNSは変更していない。

Cloudflare API仕様: [Get Worker Script Schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)。

15:32 UTC、削除済み診断WorkerのCron Events画面には15:22:21から15:31:21までの成功行が表示された。
新しく開いた既存`fanmark-app-staging`のCron Events画面にも、時刻とCPU時間が一致する同じ10行があり、
そのうち複数は診断Workerの削除readback後の時刻だった。よってこのDashboard履歴はWorker単位に帰属できず、
実行証拠にしない。Cloudflare側の古い/共有/誤帰属データかは特定できていない。Worker固有tailには
fetch記録が届いた一方、scheduled markerは届かなかったため、Cron deliveryは引き続き未確認。

## 2026-10-01 disposable recovery再試験: 新規Worker Cron起動未確認（14:33 UTC）

13:49:57 UTCに始めた試験は14:02:52 UTC、D1 readbackのAPI error 7403で停止した。最終Worker配備
から約11分で、Cloudflareが案内する最大15分のtrigger propagation前だったため、Cronの成否は判定
できない。停止直後の既存`fanmark-business-staging`に対するread-only `SELECT 1`は成功し、継続的な
認証失敗は再現しなかった。PR #41 commit `ab21efb`で、read-only dispatch監視に限って7403を再試行
するよう修正した。Actions run `36873650354`はapplicationとWorker APIの両jobが成功。

再試験は14:11:58.740 UTC開始、最終配備readbackは14:13:22.092 UTC。Worker固有の`wrangler tail`
は接続し、合成avatar fetchのログを受信したが、scheduled invocation/diagnostic logは一度も観測
しなかった。最終配備から15分後を過ぎてもreceiptは`received/pending`、dispatch attempt 0のまま
だった。20分監視は14:33:51.345 UTCに`synthetic_stripe_extension_dispatch_timeout`で終了し、
Time Travelと暗号化backup/R2 replayには進んでいない。7403再発回数は0。

cleanup readbackではWorker、使い捨てbusiness/Auth D1、temporary config、合成avatar objectの削除が
すべて成功し、D1一覧は既存の`fanmark-auth-staging`、`fanmark-business-staging`、
`fanmark-emoji-master-staging`のみ。backup bundleは作成されず、recovery R2 objectも0件。次は
同じrecoveryを繰り返さず、Cloudflare上の新規Worker Cron実行/可視化経路を調べる。Issue #34/#37と
recovery gateは未完了。実ユーザーデータ、production route、domain/DNSは変更していない。

登録と実行を分けるため、14:42:19.836 UTCにD1/R2 bindingのない最小の使い捨てWorkerを配備し、
`* * * * *`を登録した。`wrangler init --from-dash`でCloudflareから構成を読み戻すと、
`triggers.crons`は同じ毎分scheduleだった。Worker固有tailは15分後まで接続を保ったが、scheduled
markerは届かなかった。Cron Events画面も履歴なしと表示したが、新規Workerでは履歴表示に最大30分
かかる旨を示しており、この画面は補助情報とする。Cloudflareの[real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
はinvocation/custom logを含み、`wrangler tail`で確認できる。今回、scheduleの登録は確認済みだが、
新規Workerのscheduled invocation/ログは未確認のまま。Cron設定資料ではtrigger変更の伝播に最大15分、
新しいWorkerのCron Events履歴に最大30分を案内しているため、tailの欠落と履歴画面は別の証拠として扱う。
15分観測後にWorkerを削除し、APIのdeployment readbackが「Worker does not exist」を返すことを確認した。
local temporary projectも削除済み。Cloudflare Statusにactive incidentは掲載されていなかった。
schedule登録は読み戻しで確認できたため、次はruntime delivery/ログ可視化をCloudflareの観測APIや
サポート情報と照合し、同一recoveryを再実行する前に原因を絞る。

2026-10-02 00:02 JST、ログイン中のWrangler OAuth profileを確認し、Cloudflare APIの
read-only `GET /accounts/{account}/workers/scripts/{script}/schedules`で既存`fanmark-app-staging`の
scheduleを読み戻した。`* * * * *`と`0 0 * * *`が登録済みで、両方の`modified_on`は
`2026-10-01T10:21:15.10331Z`。これは既存staging appのcontrol-plane登録の証拠で、新規Workerの
runtime deliveryを説明しない。[Get Worker Script Schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)。

## 2026-10-01 新規Worker Cron未確認・dispatcher未処理（13:17 UTC）

既存の`fanmark-app-staging`では12:54:21 UTCに毎分Cronのscheduled invocationを確認した。
Stripe dispatcherは`disabled`・claim 0件、notification processorは処理対象0件で完了している。

一方、使い捨てpost-write recovery Workerは`* * * * *`を登録してdeployし、署名済みの合成
license-extension receiptを受け付けたが、receiptは`received/pending`、`attempt_count=0`のまま
20分待機がtimeoutし、Time Travelと暗号化R2 replayの前で停止した。Workerのdeploy時刻は
2026-10-01 12:56:38 UTC、timeoutは13:17:53 UTC。

約30分後にCloudflare Cron Events履歴を再読込すると、使い捨てWorkerのURLに
13:16:21〜13:32:21 UTCの成功イベントが表示された。しかし同じ行・CPU時間が既存
`fanmark-app-staging`のCron Eventsにも表示され、使い捨てWorkerの履歴には作成開始
12:55:54 UTCより前の12:43〜12:52 UTCの行もあった。Cronなしのemoji master Workerには
イベントがなかった。よって、この画面のデータをWorker単位の実行証拠として帰属できない。
`wrangler tail`でも使い捨てWorkerのscheduled job summaryは取得できておらず、Cron triggerが
発火したか、発火後にhandlerがどのjobを選択したかは未確認。D1 readbackではreceiptが未処理
だった。

Cron Events画面は新規Workerの履歴表示に最大30分かかる場合があると案内していた。
[CloudflareのCron設定資料](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
はtrigger変更の反映に最大15分を見込むよう案内している。イベント履歴にはtimeout後の行もあるが、
Worker単位に帰属できない。削除完了の厳密な時刻は記録していないものの、新しく開いた設定画面
ではWorkerが削除済みと確認した。cleanup後のDashboard一覧には既存Workerが2つだけ表示され、
Cron定義はapp stagingの2つだけだった。Freeプランの
上限はアカウントあたり5 Cron Triggerであり、今回の事象は上限到達では説明できない。
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

cleanup summaryと独立readbackで使い捨てWorker、Business/Auth D1、config、合成avatarの削除を
確認した。既存staging D1は3つだけで、backup/avatar staging R2は両方object count 0、0 B。
バックアップbundleは開始前の段階で止まっており、R2 backup objectは作られていない。実ユーザー
データ、Supabase行、実Stripe API、メール、production route、domain/DNSは使っていない。

既存WorkerのCronは確認済みだが、使い捨てWorkerのCron起動とStripe dispatcherによるreceipt claimは
未確認。追跡用の`SCHEDULED_DISPATCH_DIAGNOSTICS`ログを追加し、使い捨てrecovery configだけで
有効化する準備をした。Issue #34/#37とpost-write recovery gateは未完了のままにし、この診断を
Cloudflare上で確認するまで同じフル復旧手順を再実行しない。

## 2026-10-01 staging migration selector guard

`wrangler.emoji-api-staging.jsonc` にMASTER_DBのmigration selectorがなく、
`wrangler d1 migrations list` がmaster D1に対してAuth専用の
`0007_auth_signup_command.sql` / `0008_auth_user_suspension.sql`を未適用と誤表示していた。
この確認はread-onlyで、migrationは適用していない。WorkerのMASTER_DBにもmaster用と同じ
selectorを明示し、CLIは`No migrations to apply`を返す。migration selector testはapp、
migration-only、master APIの3設定を照合し、Auth signup/suspension SQLがmaster側に
混入しないことを確認する。

Node 22.6.0の`npm run test:migration-data`は194/194、絵文字master APIのWrangler
deploy dry-runは成功。business/Auth/masterのstaging D1は全てmigration pendingなし。
read-only GETはSPA、Auth health、emoji catalogが200、Stripe webhookはselectorとsecretが
未設定のため404。avatar/cover/backupのstaging R2 bucketは全て存在し、object countは0。
Stripe・Resend・OAuthのstaging credentialsは未設定で、実providerの統合canaryは未完了。
実ユーザーデータ、Supabase application rows、production route、domain/DNSは変更していない。

read-only `GET /api/auth/capabilities`はsignup、password reset、email verification、
social providerが全て無効を返した。Auth機能の管理者向けstaging browser canaryは、
合成ユーザーのsign-in、初回TOTP登録、session rotation、MFA管理者認可、ユーザー一覧/詳細、
Enterprise/Max/Freeの変更、suspend/restore、即時license expiry、session revokeを確認。
未認証の一覧アクセスは拒否され、画面状態とAuth/business D1のreadbackが一致した。
cleanup後、Auth user-owned table、profile、license、audit、notificationのcanary行は0件。
メール/provider連携は実行しておらず、MFA generation counterはfactor lifecycleで進む場合がある。

PR #41 head `61d662f`のActions run `36860303037`再実行はapplicationとWorker APIの両jobが
成功。Stripe receipt/billing/invoice suite、typecheck、migration data boundary、staging buildも
passした。最初の同runでは`subscription-application.test.mjs`が3回120秒timeoutしたが、再実行は
成功し、Node 22.6.0の直接実行も8/8。原因は特定できていないため、まれなPGlite起動停止は
CI上で引き続き監視する。

Cron伝播確認用の使い捨てWorker `fanmark-cron-probe-20261001-2110`は2026-10-01
12:10:29 UTCに1分scheduleでdeployされ、version `7478077e-7928-4c9d-a0a9-87b3f69e9ca5`
が100%だった。20分間のlive `wrangler tail`でscheduled markerは記録されず、probe Workerを
削除し、専用config/sourceもcleanupした。D1/R2/secret bindingはなく、既存staging appのCronは
scheduled invocation済み。新規WorkerのCron trigger登録/伝播経路は未解決で、復旧canaryは
引き続き未完了。実ユーザーデータ、production route、domain/DNSは変更していない。

## 2026-10-01 staging再開確認と管理ユーザーUI修正

再開時に`fanmark-staging-inapp` profileの`wrangler whoami --json`が
`fanmark.id@gmail.com`とstaging設定に固定されたCloudflare account IDを返し、
PR #41の当時のhead `58ba192`はdraft/open/clean、必要なCI 2件がpassだった。
business D1は`0018`/`0019`を含めmigration pendingなし。read-only HTTPはSPA、
Better Auth health/session、emoji catalog、参照マスター価格が200、未認証管理
sessionが401、Stripe webhookが404だった。Authのuser/account/session/verification/
factor/role/assurance/auditとbusinessのprofile/license/audit/notification eventは
0件、emoji masterは3,944件。読み取り時のD1 writesは0件。

合成管理ユーザーのブラウザcanaryで、停止APIとAuth D1更新は成功する一方、確認
ダイアログを閉じるとユーザー詳細Sheetも閉じ、画面上の停止状態を読めない問題を
再現した。`src/components/AdminUserManagement.tsx`で停止確認AlertDialogを詳細Sheet
の子に移し、停止/復旧後も同じ管理画面で詳細が更新されるよう修正した。

対象ESLint、root typecheck、管理ユーザーclient契約7/7、Worker D1 12/12とtypecheck、
staging build（3,723 modules）、Wrangler deploy dry-runが成功。staging Worker
`7a7e2597-fc05-4fcb-b117-ba331dfa54e1`を100%配信後、`--admin-user-management-browser`
canaryがBetter Auth sign-in/TOTP、Free→Max→Free、停止/復旧、即時失効とブラウザ表示を
確認して成功した。Authのuser-owned全表、businessのprofile/license/audit/通知行は
cleanup後0件。MFA generation counterはfactor作成/削除に伴い進む場合がある。

このcanaryは実ユーザー行、Supabase行、メール送信、Stripe API、production route、
domain/DNSを使っていない。Stripe・Resend・OAuthのsecretsは未設定のまま。

## 2026-10-01 Stripe staging test-only isolation

ステージングでStripe test-modeだけを使えるよう、`STRIPE_MODE_POLICY=test_only`
を追加した。staging configにはこのポリシーだけを設定し、Webhook/dispatch/Checkout等の
Stripe selectorsと実secretは引き続き未設定なので、現時点のStripe routeは無効のまま。
本番や未指定環境は従来のtest/live両モード動作を維持する。

このポリシーでは、請求APIはgeneric keyとtest keyが完全一致し、live keyが無い場合だけ
テストStripe clientを作る。延長Checkoutもlive generic keyを拒否する。署名済みlive
WebhookはD1保存前に拒否し、scheduled dispatcherはlive keyを構築せず、既存live receipt
またはdispatchが1件でもあれば処理を停止する。アカウント削除もtest clientのみでcustomer
を探し、live key設定を拒否する。未知のポリシー値はfail closed。

合成D1/fake Stripe検証はWebhook・receipt・dispatch・invoice・subscription suite 68/68、
Plan Checkout 9/9、Plan Change 9/9、Customer Portal 6/6、延長Checkout 6/6、
Stripe account deletion 5/5。Worker typecheck、CI isolation check、staging Wrangler
deploy dry-runもpass。外部Stripe APIは呼んでいない。test-only credentialsをstagingに
設定後、Stripe test-mode Webhookと合成購入のend-to-end canaryが次のゲート。
必要secret名は`STRIPE_SECRET_KEY_TEST`、同値の`STRIPE_SECRET_KEY`、test-mode endpointの
`STRIPE_WEBHOOK_SECRET`。`STRIPE_SECRET_KEY_LIVE`は設定しない。これらの値をチャットに
貼り付けずCloudflare staging secretとして登録する。

CI run `36847883045`（PR #41、head `41b1fd2`）はstaging applicationとWorker APIの
両jobが成功した。既存PGliteテストがCIで60秒を超えたため、そのテストrunnerの外側
timeoutを120秒にし、Node 22.6.0で単体・Stripe receipt suiteが通ることも確認した。
staging build後、2026-10-01 19:21 JSTにWorker version
`59deb036-3aa7-442f-9eba-11875715c43a`を100%配信した。read-only GETは`/`、
`/api/auth/ok`、`/api/emoji/catalog`が200、Stripe selector未設定の
`/api/stripe/webhook`が404。staging secret名のreadbackにもStripe/Resend/OAuthはない。
この反映でStripe API、メール、D1 migration/write、実ユーザーデータ、production route、
domain/DNSは使っていない。

後続のCI run `36848783232`ではWorker API jobは成功したが、application jobの
`subscription-application.test.mjs`が120秒で2回タイムアウトした。そこで同一テストだけ
最大3回の独立プロセス試行に変更した。Node 22.6.0のローカル単体・全suiteが成功し、
CI run `36849762646`もapplication（3m55s）とWorker API（5m37s）の両jobが成功した。
PGliteテストは1回目が120秒で止まった後、2回目の新規プロセスで成功した。

## 2026-09-29 Supabase Stripe non-extension Checkout receipts

The Supabase webhook now persists all supported Checkout Session events before
acknowledging them. Non-extension sessions claim their exact dispatch and are
marked `ignored` / `completed` through a service-role-only RPC fenced by the
current lease token, generation, event type, and normalized Checkout snapshot.
This path does not change subscription entitlement or grant a license; plan
state remains sourced from subscription events. Extension Checkout handling is
unchanged.

The new forward migration is
`20260929200000_terminalize_stripe_noop_checkout_receipts.sql`. Focused PGlite
tests pass 13/13, including the new state, extension-rejection, stale-lease,
and ACL cases; shared TypeScript tests pass 5/5 and the receipt package
typecheck passes. The full Stripe receipt suite passed, and the final dispatch
suite rerun after adding lease-expiry coverage passed 13/13. Root app typecheck,
`deno check` for the webhook, targeted ESLint, CI workflow isolation, and the
191-test migration-data boundary suite all passed. No Supabase migration,
webhook invocation, remote write, Stripe API call, or production change was
made.

## 2026-09-29 scheduled Stripe timestamp regression closure

Stripe invoice/subscription scheduled dispatch now accepts the canonical
six-digit UTC timestamp supplied by the Worker scheduler and preserves its
microseconds through application and fence-lease arithmetic. Before the fix,
both paths returned `retryable` on that input. The focused regressions, shared
timestamp tests (6/6), full Stripe webhook/D1 chain (63/63), Worker typecheck,
and PR validation run `36482153913` all pass. This remains code/test evidence;
no Stripe API call or remote deployment/migration was made.

## 2026-09-29 Stripe plan Checkout event handling

The D1 scheduled Stripe dispatcher previously sent every supported Checkout
Session event into the license-extension application. That diverged from the
Supabase webhook, which only persists/applies extension sessions and otherwise
acknowledges plan Checkout events without granting entitlement. The dispatcher
now atomically terminates Checkout receipts without
`metadata.type = license_extension` as `ignored` / `completed`; subscription
created/updated/deleted events remain responsible for plan state. The focused
webhook/application integration suite passes 13/13 under Node 22.6.0, including
stale-lease rejection. No Stripe selectors or secrets were enabled, and no
remote state changed.

## Fresh Supabase v21 catalog and current-schema synthetic replay (2026-09-29 JST)

Ran the reviewed `schema-readiness.sql` through Supabase CLI 2.118.0 with
`CI=1`, `--yes`, and a private temporary project-link directory. The read-only
query completed at `2026-09-28T18:27:23Z` and returned schema metadata only:
40 tables / 406 columns, 144 constraints, 139 indexes, 15 enum labels, one
view, 58 functions, 36 non-internal triggers, and 77 RLS policies. No
application rows or live sequence values were read.

Descriptor-aware schema converter v21 on this fresh catalog reports five
schema/operation gate groups / 93 locations and remains `deployable: false`:
11 external Auth references, 79 timestamp defaults requiring operation-owned
clock values, and the untranslated function, RLS policy, and trigger scopes.
V21 deliberately omits approximate millisecond D1 clock defaults; all 79
per-column operation gates remain. This report is based on the current
schema-only catalog.

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs` passed
against this exact catalog. It reconciled 10 synthetic rows across all 40
tables and checkpoints, bcrypt-transformed two active credentials, durably
deferred one inactive-license credential, read back typed/hash state, and
rejected conflicting credential coverage. The result is
`public_rows_reconciled`; `deployable` and `fullMigrationReconciled` remain
false. The v21 DDL contains no D1 millisecond `strftime(..., 'now')` timestamp
defaults and its private SQL/report files are mode `0600`. No source
application rows, remote D1/R2, production route, or domain/DNS state was
accessed or changed.

## 2026-09-29 D1 license expiry microsecond comparisons

The D1 analytics summary, fanmark details, coupon application, Stripe
extension checkout, and invitation signup used millisecond-rounded date
comparisons for values stored at microsecond precision. These paths now use
fixed-width UTC text ordering. A new forward migration, `0018`, replaces the
invitation-capacity trigger from already-applied migration `0014`; its clock
expression emits the same canonical width. Regression tests cover license,
transfer-lock, invitation, and reservation deadlines one microsecond after the
injected clock. Five focused D1 suites pass 37/37 and Worker typecheck passes.
No remote migration or Worker deploy was made; there are no user-data or
domain/DNS changes.

## 2026-09-28 Auth D1 migration selector collision

Read-only `wrangler d1 migrations list AUTH_DB --remote` against both the app
and Auth staging configs found that the Auth selector
`migrations/000[378]_*.sql` also selected the Master-only
`0007_release_audit_timestamps.sql`, which appeared as pending on Auth D1. It
was not applied. Both Auth configs now use an explicit allowlist containing
only `0003_better_auth_core.sql`, `0007_auth_signup_command.sql`, and
`0008_auth_user_suspension.sql`. A static selector test checks those exact
files and is part of `npm run test:migration-data`; the guarded Auth admin
smoke checks the same allowlist. Re-running `d1 migrations list` for both
configs reports no migrations to apply. The selector test passes 2/2 and
`npm run check:ci` passes. No remote migration was applied, no application
rows were read, and no D1 rows were written.

## 2026-09-27 Workerサブスクリプション表示の前景更新をstaging反映

Worker版の`useSubscription`を、フォーカス/可視化復帰に加えて30秒ごとに
表示中だけ再検証するようにした。間隔更新は既存表示を保ち、読込スピナーを
出さず、フォーカス・可視化イベントとの同時要求をhook内で1つにまとめる。
Supabase版は既存のRealtime更新を維持する。D1 APIは引き続き読み取り専用。

PR #41の`2ecbb25`でstaging Worker version
`c8fce1a1-1c46-4764-b3d9-6042c5930774`を100%配信した。公開GETはSPAとAuth
healthが200、未認証`/api/me/subscription`が401。配信JSのSHA-256
`73d52d0a641ece74d21ebb9763b3d000441e662d8c7cfc16883d04492a02adf3`は
ローカル`dist-staging`と一致する。

ローカルでfrontend typecheck、対象hookのESLint、subscription client/API契約
4/4、Cloudflare staging build（3,722 modules）、Wrangler dry-runが成功した。
PR CI run `36298845071`はstaging applicationとWorker APIの両方が成功。
この確認では認証済みブラウザでの30秒反映やStripe sandboxは試していない。
D1への書込み、Stripe/email送信、実ユーザーデータ、本番route、ドメイン/DNS
変更はない。

## 2026-09-27 staging公開GETとローカル再検証（先行時点の記録）

以下は今回のstaging deploymentより前のスナップショットであり、push/deployと
Cloudflare認証についての記述は現在の状態を表さない。

現在の移行worktreeでNode 22.6.0を使い、frontend typecheck、Cloudflare
staging build、`src/App.tsx`のESLint、Workerの全`npm test`チェーンを再実行し、
すべて成功した。npm 11.8.0はNode 22.6.0をサポート対象外として警告したが、
各検査は終了コード0だった。staging buildは3,719 modulesを変換した。

workers.devへの読み取り専用GETは`/`、`/api/auth/ok`、
`/api/emoji/catalog`、`/api/fanmarks/recent?limit=1`が全て200だった。
応答本文は取得・記録していない。詳細は
[`live-observations.md`](live-observations.md)を参照。これは公開routeの疎通であり、
ブラウザ認証、実データ同等性、Stripe sandbox、本番切替の証拠ではない。

ローカルのplan-selection route guard commitは引き続きPR #41より1 commit先行し、
作業ツリーには無関係な`supabase/.temp/cli-latest`の変更があるため触れていない。
GitHub CLIの認証tokenは無効で、WranglerはmacOS Keychain読み出しexit 51で失敗した。
したがってpush/deployはこの確認では実施していない。

## Stripe extension receipt effect on D1 (2026-09-26 JST)

Added a staging-only D1 schema for Checkout intents, one application per
Session, effect evidence, and per-entry lottery cancellation, plus a local
application function guarded by the active receipt lease and immutable intent
terms. The positive paid path applies license extension, lottery cancellation,
notifications, audits, application state, receipt state, and dispatch state in
one D1 batch. Unpaid sessions wait for asynchronous settlement; expired or
failed sessions grant no time; amount/owner/transfer mismatches dead-letter.

The local Miniflare suite uses the generated 40-table D1 schema and synthetic
records. It covers same-Session retries, competing receipts, async success,
expired/failed no-grant, stale-owner/transfer/amount rejection, and full
rollback after an injected audit failure. The D1 Checkout intent endpoint and
scheduled extension dispatcher are now implemented locally; the default-off
frontend selector is also available. The later staging readback recorded below
supersedes this initial setup snapshot: business migrations `0006` and `0007`
have since been applied, and the shared Worker Cron is active for notifications.
Stripe checkout/webhook/dispatch selectors and Stripe secrets remain unset,
and subscription/invoice event handling is incomplete. No real Stripe call,
user data, production routing, or DNS change was made.

親イシュー: [#28](https://github.com/kanouk/fanmark-id/issues/28)。親の移行仕様・受け入れ条件を正とする。#26と#27の試作はこの移行へ一括マージしない。

## 役割と実装体制

Astraが設計確定、作業分解、差分レビュー、検証結果の確認を行い、GPT-5.6 Luna（max）が範囲を区切った実装を担当する。設計不明点、認可/課金/ID/原子性に関わる変更はAstraが判断する。

ユーザーは2026-09-23に残量確保を停止条件にしないよう指示した。使用量の割合を理由に作業を止めない。実装は段階ごとに保存・検証し、実際のツール制限や未解決のデータ整合性・セキュリティ条件を停止理由として扱う。

## 段階

- [0A: CIと環境境界を分離する](https://github.com/kanouk/fanmark-id/issues/29)
- [0B: 本番棚卸しと移行対応表を確定する](https://github.com/kanouk/fanmark-id/issues/30)
- [0C: Workers・D1上で認証と競合制御を検証する](https://github.com/kanouk/fanmark-id/issues/31)
- [0D: 現行Stripe Webhookの重複適用を防ぐ](https://github.com/kanouk/fanmark-id/issues/32)
- [1: Worker API契約とフロント配信を導入する](https://github.com/kanouk/fanmark-id/issues/33)
- [2A: D1・認証・R2・ジョブを実装する](https://github.com/kanouk/fanmark-id/issues/34)
- [2B: 再実行可能なデータ移行・照合を実装する](https://github.com/kanouk/fanmark-id/issues/35)
- [2C: 絵文字マスターの更新経路を移植する](https://github.com/kanouk/fanmark-id/issues/36)
- [3: 統合試験と切り替え・復旧をリハーサルする](https://github.com/kanouk/fanmark-id/issues/37)
- [4: 本番切り替えと監視・旧基盤終了を実施する](https://github.com/kanouk/fanmark-id/issues/38)

## 作業を渡すとき

対象ファイル、入力/出力、権限、保持するID/制約、変更範囲、依存、検証コマンドと期待結果を指定する。実装者の完了報告だけで段階を閉じず、Astraが差分と検証の証拠を確認する。ローカル実装、staging適用、本番適用、運用確認を分けて記録する。

## 今回の開始状態

- origin/mainから隔離したworktreeで開始。ヒーロー試作側のcheckoutは変更しない。
- #29のCI分離はPR #39でmainへ反映済み（b307dd4）。ローカル型検査・ビルド・workflow否定検査は成功。GitHub workflowはdisabled_manuallyのまま。#30のオフライン棚卸しと#31の初期local proofはPR #40でmainへ反映済み（e5a553c）。棚卸しは構文解析テストと再現性検査まで完了。全体の本番対応表・設定照合は未完了。
- #31は合成ユーザーの認証3テスト、D1同時操作/再試行/rollbackの8テストがlocal runtimeで成功。実OAuth、管理者MFA、既存hash、remote CPU/負荷、実業務全体の受け入れは未完了。
- 本番のread-only観測は [live-observations.md](live-observations.md) を参照。
- 本番データ更新、DNS変更、Cloudflare本番配備、課金操作は未実施。

## 再開時の確認

1. Git状態、親/子イシュー、PRの状態と、利用する実行環境の状態を読む。
2. 未コミット作業を確認し、作業ツリーと実装者の担当範囲を復元する。
3. 前回の成功した検証と未確認条件を区別し、変更/失敗/未解決の理由がある範囲を検証する。
4. 次の未完了の実装単位を指定して再開する。本番切り替えは確認・監視・復旧までの余裕を確保してから開始する。

## 継続中の作業（2026-09-21）

PR #41は棚卸し・本番設定のread-only確認とWorker API境界を保存するdraft。対応案と再現用集計SQL、公開recent APIはコミット済み。以下の未コミット部分を完成済みと扱わない。

- `workers/api/`: 最近取得一覧の公開APIを6ebdf36で保存。応答列の制限、キー種別、Origin、タイムアウト、redirect、件数上限、実entrypointを含む14テスト、型検査、配備用dry-runがAstraの独立実行でも成功。remote未配備。フロントの明示的な接続先切り替えは394a9d0で保存し、9テスト・型検査をAstraも独立実行して成功。設定したWorkerが失敗してもSupabaseへ戻らない。合成Worker originを指定したViteビルドも成功し、値が生成物へ反映されることを確認。Workers Static Assetsの一体配信構成を80a56feで保存。新規Viteビルドに対する13件のlocalテスト・実HTTP smoke・配備用dry-runを確認し、CIへ組み込んだ。API/欠落アセットの404とSPA navigationの境界を維持する。OGP/Auth/admin/PWAの実環境確認とWorker起動コストは未検証。
- live recent-listのview/RPC定義をread-onlyで取得し、active licenseのみ・created_at降順・同時刻の順序未指定などの現行条件を記録（43f5e12）。再現SQLも実行済み。D1版の公開recent repositoryをe8ffc0eで保存。明示切り替え、microsecond保持、実D1 entrypointを含む4テストと既存API14件・静的配信13件・実HTTP smoke・型検査・dry-runが成功。取得可能判定APIとフロントの2箇所の判定を43f7207で接続。API21件・D1 availability7件・recent D1 4件・フロント6件、型検査、未設定/Worker指定build、静的配信13件+実HTTP smoke、dry-runが成功。本番公開RPC5ケースの応答も両validatorを通過。詳細取得/登録/Auth等は既存経路。全体の本番D1 schema/importは未完了。
- `workers/api/` にBetter Authの `/api/auth/*` を接続。Better Auth実装を共有moduleへ移し、signup/OAuth/password-reset/verification-email経路を閉じた状態で、synthetic verified userのログイン、session読戻し、誤password・未verified email拒否、4並列sign-in、credentialed CORSを5件のMiniflareテストで確認。認証schema migrationはuser/account/hash/factor/sessionの行を含めない。`experiments/cloudflare-auth/` の既存MFA/admin-assurance suiteも6件成功。アプリ側のadmin/business authorization、招待・メール配信、OAuth、remote CPU、実因子移送は未完了。詳細は[auth feasibility](auth-feasibility.md)。
- Node 22.6.0のclean installでVitestが解決したVite 8/Rolldownのnative bindingが欠落する問題を確認。Workers/API・Auth・D1 concurrencyのテストpackageをVite 6.4.3へoverrideし、3 packageの`npm ci`を成功させた。Auth/concurrency testもclean install後に再実行して成功。これはテストtoolchainの互換性修正であり、GitHub hosted workflowは引き続きdisabled。
- `experiments/cloudflare-auth/`: bcrypt/TOTPと管理者APIのセッション/factor-bound MFA proofを7a11d4dで保存。7e37827でsingleton MFA generationとguard付き保存を追加。同じ因子のsecret変更、無関係な因子変更、generation欠落、置換・sign-outをlocal D1のbarrierで検証。既存proofは今回共有moduleへ移し、6件のlocal runtimeテストが成功。remote multi-Worker raceは未確認。実OAuth/既存因子移送/remote CPUは未完了。
- `docs/migration/stripe-ledger-design.md`: 現行Webhookの全分岐を受信・適用台帳とoutboxへ写す設計をf0b3a05で保存。BasilのInvoice.parentとD1 batchの境界もレビュー済み。receipt+dispatch保存のPostgreSQL基盤をe63152dで保存し、PGliteによる14テストをAstraも再実行して成功。署名付き受信factoryと正規化adapterを78d51e2で保存。実Stripe SDKの署名、サイズ/時間制限、重複/不正保存結果、PGlite保存経路を含む29テストとSDK型互換性をAstraも実行して成功。受信後のdispatch claim/renew/retryのlease制御を1f4246dで保存。古いtoken/generationの拒否、SQL時刻による期限、途中失敗のrollback、実SQL roleのACLを含む39件がAstraの独立実行でも成功。独立接続のPostgres競合・業務適用/最終化は未完了。現行Webhookへの接続・本番適用は未実施。
- 移行用4パッケージのlocalテストを秘密情報なしのCIへ追加し、deployの依存条件にした（361d5b9）。workflow設定の構文検査・否定検査は成功、GitHub workflow自体はdisabled_manuallyを維持。
- PWAのAPI runtime cacheを廃止し、新Service Workerのactivate時に旧supabase-cacheのみ削除する。APIへのnavigationにはSPA fallbackを返さない（53072a2 / adef0c8）。アプリビルドと生成物検査が成功。本番配備・既存端末の更新確認は未実施。

CloudflareのCLI認証先はfanmark対象アカウントと異なり、対象を明示したread-only呼び出しも認証エラー。対象側はWorkers Free（10 ms/request）。remote配備権限とbcrypt CPU/プラン判断は未解決。ブラウザではSupabase SQL Editorによる秘密値を返さない集計、既存Google/Apple callback、Resendドメインを確認できた。詳細はlive-observationsを参照。

Storageの2 bucketについて、認証付きAPIによる元ファイルの読出し・metadata size照合・SHA-256作成・ローカルファイルの再検証を完了。取得前後の一覧も一致。非公開の一時baselineであり、確定snapshotやR2コピーとは扱わない。詳細は[storage-baseline.md](storage-baseline.md)。

Storage exporter/verifierの再利用可能な実装を追加。23件のオフライン検証に加え、新実装による両bucketのread-only取得と独立verifierの検証が成功。詳細は[storage-export.md](storage-export.md)。非公開一時保存であり、R2転送は未実施。

本番の列・制約・index定義をread-only catalogから取得した（a567ab1）。40表・406列・144制約・139indexの変換条件を[変換境界](schema-conversion.md)へ記録。実測結果は非公開。これをD1 schema適用済みと扱わない。

絵文字カタログ生成はUUID付きJSONの明示入力を追加。Supabase環境変数が存在しても明示入力時はネットワークを使わず、ID・肌色sequenceを保持する。Unicode更新・D1へのmaster書込み・公開配信は未完了。

絵文字の版付きlocal artifact builderを追加。旧UUIDの削除/再割当て、manifest/moduleの混在を拒否し、検証完了後に版別directoryへ保存する。生成系7テスト・型検査が成功。本番emoji_masterをread-onlyで新規取得し、生成版との全UUID/emoji/codepoints照合と取得前後一致を確認。成果物は非公開一時保存。D1 import・APIの版切替・公開rollbackは未実装。

値変換codecを追加。PostgreSQL text入力から正確なcents、安全範囲bigint、UTC microsecond、decimal/JSON text、順序付き配列へ変換する。Storageと合わせ28テスト成功。実D1 bind/readbackで型・値・microsecond順序を検証し、既存競合試験と合わせ9件成功。全表importは未完了。

catalogから全表DDLと列codec対応・未解決条件を生成する[schema converter](schema-generator.md)を追加。NULL許可、整数型/範囲、文字列内のSQL構文、変換できない式/列型/外部Auth参照を検証。Astraの独立実行でStorage・値codecを含む32テストとCI境界検査が成功。実catalogから生成した同一SQLの104文がローカルD1で成功し、40表・131indexを読み戻した。20群の未解決条件があり、`deployable: false`を維持。全表のデータ移送、RLS/trigger/関数相当の業務実装、本番適用は未完了。

指定Node 22.6.0でStorage verifierの`readableWebStream()`完了と明示closeによるnative abortを再現し、64 KiBずつの明示read/closeへ修正。空ファイル・複数buffer・末尾改変の検証を加え、指定版で移行データ33テストが成功。保存済み非公開Storage baselineも新verifierで再検証済み。シェルの既定Nodeは25.5.0だったため、以後は指定版を明示して検証する。

Stripeの請求状態同期を追加。API版をBasilへ固定し、現在のInvoicePayment・顧客・subscription・最新invoiceを検証する。customer fence取得後に読出し、payment fields・台帳・receipt/dispatch完了を同一SQL transactionで更新する。古いイベントから現在状態を推測せず、不明/voidは60秒後の再試行へ戻す。Astraの指定Node 22.6.0による独立実行でStripe全63テスト・型互換性が成功。SQL内の遅延でleaseが失効するケースも、業務更新/台帳がrollbackされることを確認。詳細は[stripe-invoice-projection-validation.md](stripe-invoice-projection-validation.md)。既存Webhook接続・本番migration・独立Postgres接続の競合検証・他の課金効果は未完了。

全表catalogに従う行変換bridgeを追加。PostgreSQLの値を文字列/SQL NULLとして取り出し、列順・enum・NOT NULL・配列次元を検証してD1 bindingへ変換する。UTC microsecondとJSONB textを保持し、BC/infinity/範囲外日付を拒否する。指定Nodeで行変換5テストと合成PostgreSQL投影が成功。consistent snapshotの保存・再実行可能なimport・全行照合は未実装。詳細は[row-conversion.md](row-conversion.md)。

公開アクセスAPIのD1実装を追加。short ID・絵文字・公開profileの読み取りを明示設定で有効にする。公開可否と本文は同一SQLで取得し、password保護時と非選択の表示方式の本文を返さない。既存画面の空画像URL、日本語の文字数、長いZWJ絵文字、表示方式変更後に残る設定を検証。Astraの指定Node 22.6.0による独立実行でD1 entrypoint 11テストと型検査が成功。既存API21件、recent D1 4件、availability D1 7件、静的配信13件・実HTTP smoke・配備dry-runも独立実行で成功。CI項目も追加し、workflow隔離検査が成功。未設定時は503で、frontend接続・password検証経路・本番配備は未実施。

独立接続のPostgreSQL 17.10でStripe競合5テストを追加。未commitの重複受信とcustomer fenceで実際のlock待ちを観測し、SKIP LOCKEDは先行transactionを開いたまま別接続が異なる行を取得することを検証した。期限切れの最終適用拒否と業務更新失敗時のrollbackも成功。AstraのNode22独立実行でも5件成功・skipなし、終了後のpostgresプロセスと一時clusterは0件。管理対象の17.6環境・本番設定の検証とは区別する。詳細は[postgres-concurrency.md](postgres-concurrency.md)。

パスワード付き公開アクセスの[移行設計](verified-access-design.md)を5aca0e4で保存。short ID・絵文字・profileのselectorに結び付けた短期proof、同一SQLでの本文保護、D1による試行予約と世代番号の検証を定義した。アカウント認証とは別の認可経路として扱う。隔離したlocal proofは実装中で、既存password値の互換性・全writerの失効処理・remote CPU・frontend切り替えは未検証。

Storage exportからR2へ移す[再実行可能なimport core](storage-r2-import.md)を追加。既存/新規objectを本文hash・size・metadataで読み戻し、再開時にも全対象を再検証する。条件付き作成により競合objectを上書きせず、応答停止や途中失敗を未完了として保存する。AstraのNode22独立実行で移行データ52テストとloopback Miniflareの実R2検証が成功。16 MiBの競合転送でも上書きなし・停止を確認した。local R2は条件不一致でも本文を全消費するため、早期キャンセルやremoteのmemory/CPUは証明していない。CIへ追加し隔離検査が成功。remote runner・bucket設定・本番upload・URL切り替えは未実施。

DB動作定義のread-only棚卸しを追加。40表のRLS設定、77 policy、36 user trigger、1 view、58 function/procedureの定義・権限情報を非公開artifactへ保存した。収集できたことはD1への変換・認可同等性を証明しない。schema converterの未対応scopeと業務移植の条件は維持する。既存password設定も値を返さない形式/参照関係の初期集計を実施し、UUID/ライセンス対応の異常は観測されなかった。形式変換・本人の既存入力による動作同等性・最終snapshotは別途検証が必要。

public全表を同一read-only repeatable-read transactionから保存する[snapshot exporter/verifier](snapshot-export-design.md)を追加。列・制約・index・enumのcatalog fingerprint、行順序・hash・件数・値codecを検証し、途中失敗を完了として扱わない。partition/inheritanceを明示拒否する。AstraのNode22独立実行で移行データ63件、CIと同じStripe npm test 65件、実psqlとPostgreSQL 17のtransport検証2件が成功（いずれもskipなし）。一度の全体実行停止は単独実行と全体再実行で再現せず、原因は未確定。テストの失敗時cleanupとtimeoutも追加した。sourceの実データexport、暗号化backup、Auth/Storageを含むfreeze、unique/FKの全体照合、二つのsnapshot間比較は未完了。

パスワード付き公開アクセスの隔離local proofを追加。selector/licence/世代に結び付けた短期cookie、D1による二重の試行制限、世代変更・削除再作成時の失効、同一SQLによる本文保護を検証する。AstraのNode22独立実行で専用17件と既存認証6件が成功。遅延要求による期間巻き戻し、finalization再実行、失敗時の部分カウント、Originなし同一site GETも検証し、専用suiteをCIへ追加した。実password変換・全production writer・remote CPU・frontend接続・本番配備は未完了。詳細は[verified access design](verified-access-design.md)。

DB動作の非公開gap inventoryを作成し、元catalogの77 policy・36 trigger・1 view・58 functionの全名称が対応表に含まれることと0600権限をAstraも確認した。暫定分類はpolicyがlocal対応済み0/部分4/未対応73、triggerが0/0/36、viewが0/1/0、functionが3/11/44。対応済みも限定的なlocal実装の証拠であり、本番parityやRLS全体移植を意味しない。次は期限ジョブの状態遷移・競合・付随効果を整理する。

verified snapshotからの[D1 import core](d1-import.md)を追加。parent-first順、全batchのcheckpoint guard、同時実行/ACK不明後の再開、移送先incarnation、application/ledger双方のDDL検証、全値・SQLite保存型・PK・件数・hash・FKの読み戻しを行う。AstraのNode22独立実行でCIと同じコマンドの12件と明示Miniflare integrationが成功し、CI隔離検査も成功。初回report書込失敗からの復旧、改変検知、query/SQL/変換後row上限も含む。結果はpublic_rows_reconciledに限定し、deployable/fullMigrationReconciledはfalse。実40表の行移送、credential変換、外部Auth参照、業務動作の同等性、remote適用、backup/restoreは未完了。

[credential transform設計](credential-transform-design.md)を追加。immutableな非公開sourceと変換後digestを分け、prepared時点でbcrypt結果を固定し、lease/fence付きの再開と全行カバレッジを定義した。Supabase/D1の二重writerは許容せず、freeze後に単一authorityへ切り替える。通常row importerへの変換descriptor統合、変換実装、暗号化sourceによるrehearsalは未完了。[期限ジョブ設計](license-expiry-design.md)も保存し、active→graceのlocal proofに着手。grace→expired/lottery等のparity gateは未解決。

実catalogの40表構造で、各表0行のsynthetic snapshotを新規Miniflare D1へ移すprivate rehearsalが成功。40表/40checkpoint・source/targetとも0行、20群のschema gateを維持したpublic_rows_reconciledを確認し、runtime/temp cleanupの記録も確認した。これはschema接続の検証であり、実データや業務parityではない。既存Supabase CLI権限でlive-only期限処理と定期期限処理のsourceをread-only取得し、非公開0600/0700領域に保存した。body未取得の条件は解消したが、実装差分・呼出運用・認可の同等性は別途確認中。

実catalogの40表に各1行のsyntheticデータを用意したnonzero rehearsalも成功。40 source行→40 D1行、40 checkpoint・complete・readback、内部FK/CHECK/enum/NOT NULL/uniqueと各値型を検証したprivate結果を確認。外部Authはsynthetic UUIDと未解決条件のまま、20群のschema gate、deployable/fullMigrationReconciled=falseを維持する。これは実source行のparityではない。取得した定期期限処理と共有helper計3ファイルがrepoとbyte-for-byte一致することも、Astraがhash付き非公開記録に保存した。

Astraが復元済みのsynthetic generatorを確認し、Node 22.6.0で40表・各1行のnonzero rehearsalを独立再実行した。40行の移送、40表のcomplete/readback、public_rows_reconciledを再確認。cleanup失敗を成功扱いしていたprivate helperの記録を修正し、runtime dispose成功と一時directoryの不存在も確認した。20群の未解決schema条件、deployable/fullMigrationReconciled=falseは維持し、実source行・credential変換・業務parityの証拠とは扱わない。

active→graceの[期限処理local proof](license-expiry-proof.md)を追加。UTC microsecondの期限境界、元設定のparseInt/fallback、owner/end/generation付きCAS、audit/outboxとの同時commit、durable run-itemによる停止後の再開を検証する。ACK再確認でprocessedを変更せず、同runの並行再開でも件数を保持する。AstraがNode22.6の専用npm scriptを独立実行して成功し、CI隔離検査も成功。65行のkeyset traversalと最大32件の返却sampleを確認した。fixtureは縮小したsynthetic schemaで、全schema統合、grace→expired、lottery、cron接続、本番動作の同等性は未完了。

credential変換の[隔離local proof](credential-transform-proof.md)を追加。source envelopeの入力/identity結合、prepared bcrypt結果の再利用、lease/fence、config・generation・台帳の同時適用、ACK不明後の復旧、移送先incarnationと値の再照合を実装した。実clockでD1 batch送信を期限後まで遅らせるprepare/apply拒否も確認。AstraのNode22.6独立実行で17件成功・skipなし、前後のcore/fixture/test hash一致、CI隔離検査成功。合成データ1行単位のproofであり、全行descriptor/importer統合、実credential移送、remote CPU、全writer、本番切替は未完了。

期限処理の必須effect確認を同一D1 batch内のCHECK-backed guardへ補強。audit/outbox/run-itemが0行で成功しても状態変更をrollbackし、guard cleanup欠落も最終SQLでabortする。Node22専用suiteで4種類の欠落と正常再開、ACK/競合後のclaim・guard cleanupを検証して成功。初版7文の補強は独立静的reviewでblocking指摘なし、その指摘を受けcleanup保証を追加した。全schema統合は引き続き未完了。

generic D1 importerはverified catalogにcredential列があれば、report/ledger/target mutation前にcredential_transform_requiredで停止するよう変更。local/allowUnresolvedGatesでも迂回不可。AstraのNode22独立実行で13件成功・skipなし。従来40表synthetic rehearsalも今後はdescriptor統合まで意図的に停止する。認証変換と[lifecycle schema統合設計](lifecycle-schema-integration.md)を揃え、同じsource行へのhash保存、retained incarnation、独立したstate/access/password世代、import前の厳密target profile作成を定義した。設計であり全schema統合は未実装。

disabled credentialの既存UI/RPC/read/delete経路を、repoと取得済みlive catalogで静的調査し、非公開0600文書へ記録した。調査範囲では再有効化は新入力方式だが、全operator/service-role writerとruntime同等性は未証明。disabled行を自動的にdiscard/dummyで完了とせず、未確認範囲が解消するまでdeferred_disabledを維持する。実source credential値の取得やremote変更は行っていない。

credential descriptorのmetadata compilerを追加。6列の対応、PK・validated UNIQUE・license FK、型、bcryptの版/costを検証し、immutable mappingとcanonical digestを生成する。親レビューでnon-enumerableな既知設定がdigestから欠落するケースを拒否し、回帰検証を追加した。Node22.6の親独立実行で移行データ70件が成功・skipなし。source行やDB bindingは受け取らず、変換/importer統合は未完了。credential_transform_requiredの停止条件は維持する。

[lifecycle target schema](lifecycle-target-schema.md)の生成・適用・厳密readbackを追加。全source DDLとextensionを照合し、部分適用、quoted literal/制約変更、未知index/view/triggerを拒否する。親の実catalog検証で4列のNULL条件の誤りを検出・修正し、40表構造の空local D1へ5表・4索引を追加、再適用no-opとreadback、runtime disposeを確認した。Node22.6の親独立実行で2 test group成功・skipなし、実行前後hash一致、CI隔離検査成功。source row import、credential/generation mutator統合、expiry実行接続、本番適用は未完了。

追加reviewでread-only schema inspectionにもsource fingerprintとSQL/inventoryの整合性検証を追加。catalog/report fingerprint・SQL・inventoryの個別改変を拒否し、専用2 test groupと実40表構造rehearsalの再実行が成功。これは入力plan内部の整合性確認であり、外部由来planの真正性やsourceデータ移送完了を保証しない。

世代管理の接続reviewでcredential proofのincarnation台帳欠落を0とみなすfallbackを除去。target read・prepare/apply/finalizeのSQLで台帳の存在を必須にした。予約前の欠落とreconcile read後の削除を検証し、Node22.6のcredential suiteは19件成功・skipなし。source-shaped世代triggerとの接続自体は未完了。

[世代管理trigger](lifecycle-generation-schema.md)を追加し、同日にsourceアクセス内容の失効対象を拡張。license作成時の初期化、削除時のretained incarnation更新、PK変更拒否、password変更、fanmark selector/status、基本設定、redirect URL、messageboard本文、公開profile変更で世代を進める。計24 triggerがlicense incarnationとaccess-versionの整合性、overflow、cascade削除を検査し、失敗時は同じD1 statementをrollbackする。親reviewでinspectionのbase plan結合も追加。Node22.6のschema/generation suite 9/9と、最新40表source catalogを含むexpiry統合12/12が成功。credential applyの二重increment除去、すべての業務writerとの接続、protected runtime、remote適用は未完了。

protected-access proofにもlicense incarnationを独立して保存・照合する境界を追加。同じUUIDの削除/再作成でpassword/access世代が同値になっても古いverificationを拒否する。全体実行の停止を調査し、追加列を反映していなかったreplayテストINSERTを修正、診断ログを除去した。親のNode22.6独立実行で17件成功（4.33秒）、実行前後の3ファイルhash一致。source-shaped runtimeとの接続や本番移行は未完了。当時の20%/22%停止ルールによる保留は、2026-09-23のユーザー指示で撤回された。


ユーザーの「もう少し進めていいです」を受けた当時の1単位。credential import projectionはcanonical snapshot recordの6列とrow hash/PK/ordinalを検証し、通常5列と一度だけ消費できる非公開入力handleへ分離する。parserの秘密値がerror causeへ出ないよう拒否時は固定codeとし、設定変更・handle偽造/複製/再利用も検証。Luna Maxへ委任したが成果物が戻らず中断し、親Astraが実装・検証した。Node22.6のmigration-dataは74件成功・skipなし、実40表catalogと合成1行でも成功、CI隔離検査成功。統合設計の「5列INSERT後にhash UPDATE」を、NOT NULLとtrigger二重更新を避ける単一INSERTへ訂正。実source値取得・hash生成・D1書き込み・importer接続・本番変更は未実施。以後の作業に残量の下限は適用しない。

2026-09-23の順序変更: ユーザー指示により、旧20%/22%停止ルールを解除。基本アプリ・Workers/D1/R2/Auth（合成ユーザー）と許可済みマスターを先行し、#37 synthetic rehearsal後、#38で実ユーザーデータを最後に移送・照合し、公開DNS/ホスト名を最終操作とする。ユーザー数が少ないため計画メンテナンスと個別サポートは許容するが、アカウント/権利/課金の誤紐付け、秘密漏えい、復元不能な欠損は許容範囲に含めない。Supabase本番は最終切替まで唯一の業務書き込み先とする。

認証移行の最新確認: `docs/migration/auth-feasibility.md` に記録済みのlocal workerd + D1 proofでは、Better Auth 1.7.5とbcryptjs 3.0.3を用い、synthetic `$2a$10$`/`$2b$10$` password、UUID維持、誤password拒否、並行sign-in、TOTP challengeを検証済み。Supabaseのread-only observationはhash形式が`$2a$10$`であることのみを確認し、hash本体・user対応・MFA secretは取得していない。実sessionはBetter Auth移行時に失効し、実OAuth callbackとMFA factor移送は未確認。

絵文字マスター先行準備: `workers/api/migrations/0001_emoji_master_release_staging.sql` と `scripts/migration/emoji-master-release-stage.mjs` でverified releaseを既存D1 masterとidentity照合し、別version stagingへbounded batch投入、独立readback後だけ`ready`にする。`0002_emoji_master_release_activation.sql` と `emoji-master-release-activate.mjs` はrelease hash/readbackを再検証してprivate pointerを世代管理で切り替え、履歴とactive行をimmutableにする。metadata-only rollbackは通り、追加されたUUIDを落とすrollbackと改変stagingは拒否する。live public master 3,944件も別途local D1へstaging/readback一致。詳細なAPI/frontend接続と検証結果は[emoji release記録](emoji-releases.md)。hosted CIは未実行。canonical `emoji_master`、remote D1、公開/運用rollbackは未実施。

続けて2026-09-23、Supabase SQL Editorから公開マスターの明示8列だけを2回独立にread-only取得。3,944行の正規化SHA-256は両方とも`84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、UUIDと絵文字はそれぞれ全件一意。版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をsource-shaped canonical fixture付きの一時Miniflare D1へstagingし、canonical 3,944行・staging 3,944行をreadback。全staging行がverified releaseと一致して`ready`になった。Node 22.6.0で実カタログ検証と関連suiteを再実行し成功。Supabaseへの書込み、remote D1、ユーザー/Authデータ、公開版切替はなし。成果物は非公開一時領域に保持し、リポジトリへ含めていない。詳細は[emoji release記録](emoji-releases.md)。

2026-09-23、#34の`active → grace`をsource-shaped D1へ接続するローカル統合コアを追加。source名の`is_returned`、nullable `user_id`、retained incarnation、別々の`lifecycle_generation`/`access_generation`、既存`audit_logs`/`notification_events`を使い、access世代更新は同じoperation claimに結び付いた共有SQL builder経由で一度だけ行う。Node 22.6.0 + Miniflareの10チェックで成功、nullable owner、password/access世代の分離、ACK不明後の完全readback、audit/notification/access-version/run-item/guard-cleanup欠落時のstate/effects全rollbackと再開、競合記録、厳密な期限境界を確認した。通知は`normalized_emoji`、stable `short_id`、`/f/:shortId` linkをdurable run itemから再現する。fixtureは5つのsource-shaped tableとtarget extensionからなる合成subsetで、全40表へのimport接続、他のlifecycle操作、route/cron接続、本番同等性は未完了。workflowにsuiteを登録したがGitHub hosted CIはdisabledのまま。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

同日、期限処理統合テストを拡張し、同一synthetic D1へsource DDL・lifecycle extension・generation triggers・descriptor-bound credential artifact/coverage schemaを順に適用した。credential schema inspectorでprofile全体のreadbackを確認し、期限runにも当該profileのextension digestが保存されることを読戻した。さらにgeneric importerのpreflightをこのprofileへ接続し、余分なviewは拒否、完全一致profileではreport/ledgerを作らずcredential importを拒否することを確認した。Node 22.6.0 + Miniflareで11チェック成功、skipなし。これは5 source tableのsubsetであり、実40表profile・credential row変換との統合や本番データ移行の証拠ではない。Cloudflare remote、Supabase本番、user data、domainへの変更なし。

2026-09-23、Wrangler login後に`fanmark-emoji-master-staging`をAPACへ作成し、`0000`〜`0002`の絵文字用schemaだけをremote適用。remote `0002`でWrangler SQL splitterがnested `CASE ... END`を誤分割する問題を条件付き`RAISE ... WHERE`へ修正し、7 Miniflare release testsを再通過。`0003_better_auth_core.sql`はremote適用で`incomplete input`となったため今回のmigration patternから除外し、Auth schemaを適用していない。Node 22.6.0で検証したrelease `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をcanonical D1へ3,944件、private stagingへ3,944件投入。別プロセスのremote readbackがcanonical/staging双方の全行一致、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`、status=`ready`、active pointer/activation history/Auth table各0件を確認。初回Node 25生成版はNode 22.6.0の`verifyRelease`に失敗したためfailedへ隔離し、そのstaging rowsを削除、failure metadataのみ保持。D1はWorker未接続で、deployment、Supabase write、user/Auth data、public activation、domain/DNS変更なし。

続けて、公開絵文字APIだけを持つ`fanmark-emoji-master-staging-api` Workerを`https://fanmark-emoji-master-staging-api.fanmark-id.workers.dev`へ配備。remote D1を通じて版固定ページを全取得し、3,944件の内容、`recordsSHA256`、`identitySHA256`を独立成果物と照合して一致。CORS拒否、versionless時のinactive応答、GET以外の拒否、Auth pathの非公開を確認した。active pointerは引き続き未設定で、SPAは未接続。本番ドメイン、Auth/user data、Supabase書込みは未変更。`wrangler r2 bucket list`はCloudflare error 10042（DashboardでR2有効化が必要）となったためbucketやobjectの移行は未実施。

続けて同日、`0003_better_auth_core.sql`を`fanmark-app-staging`用のmigration patternへ追加。通常のremote `d1 migrations apply` query経路は`incomplete input`で失敗したが、同じSQLはisolated local D1でWranglerのsplitter経由でも25 query成功。通常の`d1_migrations` rowを含むSQLをWranglerのremote `--file` importでtransactionalに適用し、remote readbackでAuth table 8件、MFA generation trigger 6件、generation singleton 1件/generation=0、migration ledger row 1件を確認。user/account/session/verification/twoFactor/adminRole/mfaAssuranceは全て0行。

`fanmark-app-staging` Worker version `b69bdc6b-7faa-4dca-b994-53251eca3fbe`を`https://fanmark-app-staging.fanmark-id.workers.dev`へdeployし、staging専用ランダムBetter Auth secretをCloudflare Secret Storeへ登録（secret値は読み戻さず、出力もrepo保存もしていない）。許可originからのAPI ok/session、許可外origin 403、signup 403を確認。synthetic `example.invalid` userのsign-in 200、session read 200、logout 200、誤password 401を確認後に削除し、全Auth user-owned rowsが0であることを再readback。UI authはまだSupabase context、signup/email/OAuth、業務・管理API認可も未接続。アプリSPAのnoindex/robots/sitemap設定、版固定catalog全3,944件のremote fetchと両artifact hash一致を確認。production app/DB、Supabase write、public domain/DNSは未変更。R2はerror 10042で引き続き未有効。

2026-09-23、絵文字マスターremote staging scriptをBetter Auth schema適用後も安全に再実行できるよう更新。8つのAuth表すべてが存在し、user-owned行が全て0、MFA generationが0であることを確認し、release stagingの前後でactive pointer/activation historyが不変であることを検査する。再実行はcanonical 3,944行、ready release 3,944行を一致確認し、既存releaseを再利用、active/history各0のまま完了。D1のcompound SELECT上限に合わせてAuth count検査はscalar subqueryへ変更。専用テストを加え、migration-data suite 79件成功。

同日、既存Supabase `avatars` / `cover-images` を置き換えるWorker-side R2 APIを追加。Better Auth sessionを確認してからowner UUID配下の新規keyをサーバー生成し、avatar 1 MiB / cover 2 MiB、画像signature、許可Origin、owner-only deleteを検証する。公開GET/HEADには1時間cacheと`nosniff`を付ける。Miniflare D1/R2で5統合テストと既存Better Auth 5テスト、API typecheckが成功。テスト用合成画像/アカウントのみで、R2アカウント有効化・remote bucket・frontend切替・実object移行は未実施。frontendは依然Supabase Auth/Storageを使用中。詳細は[Storage API準備](storage-r2-app-api.md)。

続けて`fanmark-app-staging` Workerをversion `c45c7085-387b-44e6-9038-b1d52382dc7f`へ更新。remote D1にpending migrationなしを確認してから配備し、Better Auth health 200、版固定emoji catalog 200、root `X-Robots-Tag: noindex, nofollow`を確認した。Storage upload/public readはいずれも503 `storage_unavailable`でfail closed。配備bindingsにR2はなく、Cloudflare R2は引き続きerror 10042、remote bucket/objectは未作成。Supabase production、user data、public domain/DNSは変更なし。

2026-09-27、オフラインrepository inventoryをHEAD `497626c0ca035066843244128f60e6758677de9c`基準で再生成した。現checkoutのfrontend scanは211 callsites（36 Edge invoke、37 RPC、4 Realtime channelを含む）。`node scripts/migration/test-inventory.mjs`が成功。これは静的checkout inventoryであり、live schema/production inventoryの代わりではない。

続けてremote activation CLIを追加。現在版の明示指定を必須にし、今回は`none`をpreconditionとして初回promote。coreに楽観的な版一致guardを追加し、7件のrelease integration testsが全て成功。隔離APAC D1で版`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をgeneration 1として有効化、activation historyは1行。専用`workers.dev` catalog APIは版なしGETが503から200へ遷移し、全8ページ・3,944行のreadbackでversion、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`が成果物と一致。再実行時はchanged=falseで履歴を増やさない。Better Auth user-owned行は引き続き0。production app/DB、Supabase write、R2、user data、custom domain/DNSは変更していない。

## 非ユーザー参照マスターの移行（2026-09-23）

`fanmark_tiers`、`languages`、`reserved_emoji_patterns`を明示allowlistとし、Supabase SQL Editorからread-only exportを作成した。型付きsnapshotは非公開一時領域にあり、各4・4・5行、USD decimal text、UUID、microsecond timestampsを保持する。system settings、Auth、user rows、Storageは取得していない。

`workers/api/migrations/0004_reference_master_releases.sql`でimmutable staging release、3つのactive views、atomic pointerとappend-only activation historyを追加。USD値はdecimal textから正確なinteger centsに変換し、既存availability repositoryの境界と合わせる。stage/retry/readback、immutability、promotion、money codec、JSON object key順に依存しない照合、生成SQLのMiniflare integration 5件、API typecheck、build dry-runがNode 22.6.0で成功。手順は[参照マスターの移行](reference-master-data.md)。

Wrangler local D1へ`0000`–`0004`をすべて適用し、実snapshotから生成した20文を実行。stage表・active viewの計13行、3つのsource hash/count、generation 1、migration ledgerを独立read-only comparisonし全件一致。これはlocal persistent D1の証拠でありremote適用ではない。

その後、対象APAC staging D1へのWrangler query/writeが回復し、`0004_reference_master_releases.sql`を適用した。非公開snapshotから3参照表13行をstageしてsource hash・全列・件数を照合し、release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`をgeneration 1へ有効化した。active viewsの再照合は成功し、Auth user-owned行は0、既存絵文字releaseは不変。app-staging Workerもversion `caebcf9a-236a-4e1d-a89d-8940ad461c44`へ更新し、noindex、Better Auth health、3,944件の絵文字catalog hash一致、R2未設定時の503を確認。詳細は[live observations](live-observations.md)。

## Better Auth staging UI接続（2026-09-23 JST）

staging modeの認証画面を、同一workers.dev origin上のBetter Authへcookie付きHTTP接続した。ログイン後に`/api/auth/get-session`を再取得し、logoutは`/api/auth/sign-out`へ送る。セッション取得/更新では`credentials: include`と`cache: no-store`を指定し、SupabaseのBearer tokenや擬似Supabase sessionは作らない。stagingではsignup、social OAuth、forgot/reset-password、password-setupを非表示またはauth画面へredirectし、これらからSupabase Authへ誤接続しない。

Node 22.6.0でfrontend client 5テスト、TypeScript typecheck、staging buildが成功。Wrangler deploy dry-run後、`fanmark-app-staging`をworkers.dev限定のversion `36183ffc-bfa4-4d64-b2ff-42ea9a7392dc`へdeploy。read-only HTTP確認はroot 200 + noindex、robots全体Disallow、`/api/auth/ok` 200、cookieなし`/api/auth/get-session` 200/null、固定絵文字catalog 200、R2 public read 503 `storage_unavailable`。bundle scanはBetter Auth endpointsを含み、production Supabase URLは含まず、synthetic Supabase fixture URLのみを確認。remote Auth user/account/session/verification/twoFactor/adminRole/mfaAssurance rowsは全て0。

この確認ではブラウザからの成功ログインを実施していない。frontend helperのrequest/error/session契約とWorkerの未認証経路は確認済みだが、credentialを使ったend-to-end UI、業務API認可、プロフィール/Storage接続は未完了。production Worker/DB、OAuth provider、billing設定、R2 subscription、public domain/DNS、実ユーザーデータには変更なし。R2開始手順はsubscription checkoutを要求するが、Standard monthly allowanceは10 GB-month storage、Class A 1M、Class B 10M、egress freeで、超過usageが従量課金となる。詳細は[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)と[setup](https://developers.cloudflare.com/r2/get-started/)。

## Recent fanmarks Worker API integration (2026-09-23 JST)

/api/fanmarks/recent now retains the public fanmark_short_id as shortId and the existing fanmark_id as fanmarkId, while keeping the previous license-first id contract. RecentFanmarksScroll and useFanmarkSearch use the shared Worker loader; the search view still uses fanmarkId for its existing operation and shortId for the public page URL. Supabase remains the legacy fallback only when the frontend Worker origin is unset. Both call sites cancel requests on unmount.

Node 22.6.0 validation passed: frontend recent contract 9 tests, Worker Supabase contract 14 tests, local D1 contract 4 tests, frontend and Worker TypeScript typechecks, Cloudflare staging build, and app Worker Wrangler dry-run. Targeted ESLint reported no errors and one pre-existing missing dependency warning in the search-query effect. The dry-run showed the staging config still has no explicit recent backend; the remote D1 contains no business tables. The change was not deployed, and no user data or production service was read or written.

## Public fanmark read frontend adapter (2026-09-23 JST)

`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`を明示した場合に、短縮IDアクセス、絵文字パスの照会、QRページ、公開プロフィール照会が既存Workerのversioned public projectionを使うよう接続した。既定はSupabaseのまま。選択後のHTTP/timeout/JSON/network失敗は別データソースへフォールバックしない。HTTP(S) origin検査、credentials omit、no-store、5秒timeout、64KiB応答上限、DTO検証を持たせた。公開プロフィールDTOは具体型にし、既存Hookの条件付きuseMemoと型エラーも解消した。

Node 22.6.0でfrontend API契約7件、TypeScript typecheck、変更ファイルESLint、Cloudflare staging buildが成功。Worker public-access/D1 integration 11件も成功。staging buildはselectorを未設定のままで、Worker stagingも`PUBLIC_ACCESS_BACKEND=d1`未設定、business D1 schemaなしのため、デプロイやlive-route確認はしていない。Worker選択時はpassword-protected recordのredacted内容をfail closedし、Supabase検証へ混在させない。password検証、アクセス解析、`/f/:shortId` owner/history detailsのWorker移行、source short-id最大長と既存値の再照合が残る。実ユーザーデータ、本番DB、ドメイン/DNS、R2 checkoutは変更なし。

## R2 frontend storage client (2026-09-23 JST)

`src/lib/storage-api.ts`でR2 image API clientを追加し、`useAvatarUpload` / `useCoverImageUpload` の書込み・削除先を`VITE_STORAGE_BACKEND=r2`で選べるようにした。既定はSupabaseで、R2選択はBetter Auth mode以外では拒否。Workerへのcookie credentials、no-store、15秒request timeout、8 KiB JSON上限、responseのowner UUID/key/same-origin URL照合を実装し、R2 HTTP失敗時にSupabaseへ戻らない。Storageはpublic image dataのため、パスワードやBearer tokenは送らない。

Node 22.6.0でfrontend contract 7件、Better Auth client 5件、frontend TypeScript、変更ファイルESLint、Cloudflare staging buildが成功。Worker Miniflare D1/R2 API 5件、Worker TypeScriptも成功。buildでは`VITE_STORAGE_BACKEND=supabase`を明示し、R2 selectorはstagingに設定していない。プロフィールmetadataはSupabase経由のまま、R2 subscription/bucketsは未設定で、この変更はadapter準備に限る。remote deploy、R2 object、ユーザーデータ、production service、domain/DNSに変更なし。

## 参照マスターWorker API接続（2026-09-23 JST）

`GET /api/reference-masters/{fanmark_tiers|languages|reserved_emoji_patterns}`を追加した。D1 active pointer、ready release、table manifest、release-bound rowsを一つの問合せで読み、release version・row count・UUID・domain fieldを検査して最小DTOだけを`no-store`で返す。3マスターを一つのactive release versionに固定し、tier priceはinteger centsで返す。`useLanguages`には明示selector `VITE_LANGUAGE_READ_BACKEND=worker`を追加し、既定Supabaseを維持。Worker障害時にSupabaseへ戻らない。

Node 22.6.0でfrontend contract 5件、Miniflare Worker/D1統合3件、frontend/Worker TypeScript、変更ファイルESLint、staging build、Wrangler deploy dry-runが成功。APAC `fanmark-emoji-master-staging`を読むWorkers.dev app Workerをversion `3f597b51-f8b5-490c-bd0f-b2a0929de03e`へdeploy。read-only HTTPはtier 4、language 4、reserved-pattern 5行すべてでactive release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`を返し、`no-store`を確認。app root noindex、Better Auth health、CORS拒否、未知route 404も確認。production app/DB、ユーザー行、Storage、R2、domain/DNSには変更なし。tier / reserved patternのフロント管理画面は引き続きSupabaseのため、アプリ全体のマスター切替ではない。

2026-09-24、`AdminExtensionCoupons`に版付きtier read clientを接続した。`VITE_REFERENCE_MASTER_READ_BACKEND=worker`の明示時のみ4つのtier optionをactive Worker releaseから読む。release digest、4段階の一意性、UUID・項目型、`no-store`、16 KiB上限を検証し、Workerが利用できない場合は新規クーポン作成を止める。クーポン書込みと`AdminTierExtensionPrices`の編集はSupabaseに残る。専用client 5件、既存language client 5件、Miniflare API/D1 3件、root typecheck、変更ファイルESLint、Cloudflare buildが成功。selectorを明示したstaging buildとdry-runの後、app Worker version `82ce7520-1977-470a-89fd-c875c5ef116c`を配備し、root noindex、bundle、active tier API levels 1–4とno-storeをread-onlyで確認した。D1/R2書込み、実ユーザーデータ、production、DNS変更なし。`AdminTierExtensionPrices`のtier日数更新経路とreserved-pattern画面接続は未完了。

## App Workerのadmin session gate（2026-09-24 JST）

`GET /api/admin/session`を追加し、現在のBetter Auth session、admin role、現在verifiedのfactor、同じuser/session/factorにひもづく未期限切れMFA assuranceを確認する。結果は`{"authorized":true}`だけで、admin CRUDや業務データAPIはまだ実装していない。認証テーブルにread-onlyで、route以外の`/api/admin/*`は404を維持する。合成D1テスト8件、Worker typecheck、Wrangler staging dry-runが成功。staging Worker `73b2724e-4abd-4ab6-a0bd-8e3a66cb7760`へ配備し、live unauthenticated GETは401、許可origin OPTIONSは204/credentialed CORS。ユーザー行・業務データ・D1 schemaに変更なし。remote authorized-admin sessionとadmin CRUDの確認は未実施。

## D1 role分離準備（2026-09-24 JST）

`D1_TOPOLOGY=split`では業務`FANMARK_DB`、Better Auth`AUTH_DB`、emoji/reference master`MASTER_DB`を個別に選び、必要bindingの欠落時にfallbackしないselectorを追加した。legacy modeは既存single-D1 local/staging configを維持する。可用性repositoryはemoji masterとtierを`MASTER_DB`、fanmark/licenseを`FANMARK_DB`から読む。catalogとreference-master repositoriesもmaster roleを使う。local fixturesは別D1へ分割し、availabilityのmissing-binding fail-closedを追加。

read-only remote schema inspectionで既存staging D1上の`emoji_master`、`fanmark_tiers`、`languages`、`reserved_emoji_patterns`名のmaster object、およびBetter Auth schemaを確認した。source-shaped 40-table business target/importerはexact object-setを要求するため同DBへ適用しない。Node 22.6.0でWorker typecheck、availability 8件、catalog 3件、reference-master API 3件、Better Auth 8件、emoji master release integration 7件が成功した。その時点ではremote Worker/D1 binding、schema、R2、user data、domain/DNSは変更していなかった。

## Split D1 and R2 staging deployment (2026-09-24 JST)

Created APAC `fanmark-business-staging` and `fanmark-auth-staging`. The business DB remains empty; the Auth DB has only the `0003` Better Auth/MFA schema and migration ledger. Wrangler's regular remote `migrations apply` path returned `incomplete input` for the trigger-bearing migration; read-only verification showed rollback/no application tables, then the previously validated remote file-import path applied 25 statements. Readback confirmed 8 Auth tables, 6 MFA generation triggers, generation 0, one migration record, and zero user-owned rows. No rows were copied from the original master/Auth staging DB.

After the user enabled R2, created empty APAC Standard avatar and cover-image buckets. `fanmark-app-staging` version `2dd73277-d1db-4b4a-a7da-0a82815791de` now has split D1 roles and both R2 bindings with `STORAGE_BACKEND=r2`. Local typecheck and focused availability (8), catalog (3), reference-master API (3), Auth (8), Storage/R2 (5), and emoji release (7) tests passed. Live smoke checks passed for noindex, Auth health/session, anonymous admin denial, master APIs, R2 missing-object 404, and unauthenticated upload 401. A temporary synthetic Auth account exercised live sign-in, 16-byte PNG upload/read/delete and was removed; final Auth row counts were zero and the object returned 404 after deletion. Frontend storage selector remains Supabase; no actual Supabase Storage inventory or objects, real Auth/business data, production service, or domain/DNS were touched. R2 usage from the synthetic test is within included Standard free allowances; the invoice dashboard was not inspected.

## Password-protected public access connected to the source-shaped profile (2026-09-24 JST)

Connected `workers/api/src/verified-access.mjs` to the application Worker behind the explicit `VERIFIED_ACCESS_BACKEND=d1` flag. The route resolves business D1 through the split topology and fails closed when the flag, binding, or secret is absent. Added `scripts/migration/verified-access-schema.mjs` to produce and verify the proof/rate-limit extension against exact source, lifecycle, access-generation, and credential-transform descriptors. This extension is used only in disposable local D1 tests; the remote business D1 remains empty and staging keeps the route flag unset.

Node 22.6.0 verification passed: 9 focused protected-access Miniflare tests, 14 full source-profile checks (including synthetic credential-artifact provenance, protected-text verification/read, and old-proof denial after active-to-grace), Worker TypeScript, and frontend TypeScript. The latest real-password format inventory, credential transform/import flow, Cloudflare CPU/plan and multi-instance abuse checks, deployed-origin CSRF/cookie checks, and frontend canary remain open. No real password/user row, remote business DDL, production service, or domain/DNS was changed.

## Protected-access frontend connection (2026-09-24 JST)

Added `src/lib/verified-access-api.ts` behind `VITE_VERIFIED_ACCESS_BACKEND=worker` and connected the existing password prompt on short-ID and emoji access pages. The client verifies once, reads protected text/redirect/profile content with the proof cookie, validates the exact DTO, bounds response size/time, and never falls back. Public-read and protected-verification selectors must match; otherwise the page fails closed. Protected profiles use the nested authorized projection rather than a second anonymous profile lookup. Supabase remains the default and both staging selectors remain unset.

Seven client contract tests, frontend typecheck, targeted ESLint, Worker typecheck, and Cloudflare staging build pass. No password values, real user data, staging selector, remote business schema, production service, or domain/DNS was changed.

## Cloudflare staging admin authentication connection (2026-09-24 JST)

The `cloudflare-staging` frontend mode now uses Better Auth for the admin sign-in path and `GET /api/admin/session` for the authoritative role/MFA decision. The screen handles Better Auth's TOTP sign-in challenge and first-time enrollment, including its returned recovery codes. The Worker distinguishes missing/unverified TOTP setup (`mfa_enrollment_required`) from a verified factor without valid same-session assurance (`mfa_required`). Supabase-mode admin login and MFA remain unchanged; admin CRUD and business-data authorization are still separate work.

Node 22.6.0 verification passed: 9 Better Auth client tests, 9 Worker Auth/D1 tests, frontend and Worker typechecks, targeted ESLint, CI-isolation check, Cloudflare staging build, and Wrangler deploy dry-run. `fanmark-app-staging` was deployed to version `161de18f-44ea-4016-9267-39688619df9b`. Read-only HTTP smoke returned root 200/noindex, JS 200 containing the new admin-auth flow, anonymous `/api/admin/session` 401, and no-cookie `/api/auth/get-session` 200/null. A Wrangler read-only D1 migration-history query returned Cloudflare API 7403; deployment itself succeeded. The deployment uploaded Worker/assets only and made no D1/R2 writes. Remote synthetic-admin login/TOTP completion is unverified; no real Auth/user data, production service, or domain/DNS changed.

## Availability against the versioned reference-master release (2026-09-24 JST)

Added a separate local Miniflare integration that applies the checked-in
`0004_reference_master_releases.sql`, stages and activates a synthetic
release, then calls the availability Worker through the real `fanmark_tiers`
active view. It verifies the integer-cent view value and USD response, another
tier selection, and the inactive-tier result. This closes a fixture gap: the
older focused availability suite still covers request and lifecycle cases,
but it uses a simplified tier table. The new suite is registered in the local
package script and isolated CI job.

Node 22.6.0 verification passed: three new release-backed cases, eight
existing focused availability cases, three reference-master API cases, Worker
typecheck, targeted ESLint, CI isolation, and `git diff --check`. No remote
D1/R2 write, real user data, deployment, production service, or domain/DNS
change occurred.

## Owner-scoped dashboard list API (2026-09-24 JST)

Added `GET /api/me/fanmarks` backed by split business D1 and authenticated with
the existing Better Auth session resolver. The SQL uses only the resolved
session user ID for ownership, includes active/grace/expired dashboard rows,
and returns the minimum view model without email or user ID. Duplicate basic
configs and malformed target values fail closed. Credentialed CORS is
origin-allowlisted; the route is no-store and has no Supabase fallback.
`VITE_OWNED_FANMARKS_BACKEND=worker` is opt-in. The staging-mode build forced
this selector to `supabase`, and no deployment was performed because business
D1 has no application schema or rows. Wrangler staging dry-run successfully
bundled the updated Worker with the split D1 and both active R2 bindings.

The separate Miniflare suite applied Better Auth and a source-shaped synthetic
business fixture. It proved that two synthetic sessions see only their own
rows, a supplied `userId` query parameter cannot select another user, and
ambiguous duplicate configs, malformed projections, anonymous, forbidden-origin,
unsupported-method, and disabled-backend requests are rejected. Four Worker
cases and four frontend contract cases pass. Worker
and frontend typechecks, the Worker base plus verified-access suites (30
tests), the Storage/R2 suite (5), CI workflow-isolation checks, and `git diff
--check` pass. Existing lint errors in `FanmarkDashboard.tsx` are on unrelated
existing `any` expressions; new API files pass targeted ESLint. The staging R2
bucket list still contains both enabled buckets. No remote D1/R2 writes,
deployment, real user data, production changes, or DNS/domain changes occurred.

## R2 staging deployment and extension-price schema (2026-09-25 JST)

Cloudflare confirmed both APAC staging buckets already exist. Applied Master D1
migration `0006_reference_master_extension_prices.sql`; migration readback now
contains `0000`–`0006`. The active reference release remains generation 1 at
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`. The
extension-price active view has zero rows until a fresh explicit-column source
snapshot is staged and promoted.

Deployed `fanmark-app-staging` version
`1d1bae79-5793-4341-9b1f-540a55376695` with `STORAGE_BACKEND=r2` and both
staging bucket bindings. Live smoke returned Auth health 200, root 200/noindex,
missing public object 404, and no-session upload 401. No upload or user object
transfer occurred; production and domain/DNS remain unchanged. The
R2/extension-master notes in [live observations](live-observations.md) record
full response and migration evidence.

## Reference master refresh and schema inventory (2026-09-25 JST)

Using Supabase CLI `db query --linked`, a read-only catalog query refreshed the
private 40-table schema metadata: 406 columns, 144 constraints, 139 indexes,
15 enum labels, 36 public triggers, 77 policies, 58 functions, and one view.
Snapshot format version 3 now fingerprints all eight catalog scopes, including
the behavior/security definitions. The version-2 D1 converter generated 40
tables with 20 unresolved gate groups, so business DDL remains unapplied; the
four behavior scopes are explicitly `unsupported_catalog_scope`. The
schema-only DDL artifact lacked trigger DDL, so the catalog query is the
trigger inventory source. Query outputs and generated reports remain under
`/private/tmp` with mode `0600`.

A separate explicit-column read-only query refreshed only the four approved
reference masters. The private snapshot contained 29 rows: 4 tiers, 4
languages, 5 reserved patterns, and 16 extension prices. The exact snapshot
was staged and promoted to active reference generation 2 in the APAC master
D1. Remote row/view comparison passed; all user-owned Auth tables remained
empty and the prior emoji release remained unchanged. The live Worker returned
all four master routes with HTTP 200 and `no-store`; the extension-price DTO
contains no Stripe IDs. The AdminTierExtensionPrices editor and checkout
consumer remain on Supabase until their read/write migration can be completed
together. No user rows, Storage objects, production service, or domain/DNS
settings were changed.

## Better Auth own-profile API (2026-09-25 JST)

Added `GET/PATCH /api/me/profile` behind explicit `PROFILE_BACKEND=d1`.
The Better Auth session supplies the only profile-row identity. Response fields
omit billing and invitation data; PATCH accepts only display name, preferred
language, and a same-owner R2 avatar URL. Plan, password-setup, and billing
fields are not writable. The frontend adapter is opt-in through
`VITE_PROFILE_BACKEND=worker`; `useProfile` and language preference updates
select it only when explicitly enabled, with no Supabase fallback. Existing
R2 upload client remains independently opt-in.

Local synthetic Better Auth/D1 verification passed five Worker integration
tests and four frontend client tests, covering owner scoping, privileged-field
rejection, avatar ownership, CORS, no-store, and fail-closed behavior. Worker
TypeScript checking passed. Business staging D1 remains empty, so this selector
was not enabled or deployed. No real profile rows, R2 objects, production
service, or domain/DNS state changed.

## Notifications inbox API (2026-09-25 JST)

Added a Better Auth session-scoped Worker/D1 path for listing a user's
notifications, unread count, individual read, and eligible bulk read. The
response is limited to the UI DTO, 50 rows, 16 KiB per payload, and 256 KiB per
page. The frontend can explicitly select it with
`VITE_NOTIFICATIONS_BACKEND=worker`; Supabase remains the default and there is
no fallback between backends. Synthetic D1 integration and frontend client
tests pass (six Worker cases and four client cases). Worker/type checks,
targeted ESLint, `npm run check:ci`, and `npm run build:cloudflare-staging`
passed for this change. The build reports the existing large application
chunk warning; it does not fail. The selector remains off because business
staging D1 has no application schema.
Notification generation/delivery and Cron remain on Supabase; no deployment,
user-row import, production change, or domain/DNS change occurred. See
[notifications API migration](notifications-api.md).

## App Worker/Static Assets staging redeployment (2026-09-25 JST)

Rebuilt and deployed the current Worker and staging SPA to the isolated
workers.dev service as version
`77668344-429b-43f4-81e5-0d2f8b3c74ef`. Wrangler dry-run showed split business,
Auth, and master D1 bindings plus the two enabled R2 buckets. The deployment
uploaded Worker/assets only; no D1 migration or R2 object operation ran.

Node 22.6.0 verification passed: root and Worker TypeScript checks, CI
isolation, Cloudflare staging build, 86 migration-data tests, 37 focused Worker
integration tests across Auth/profile/owned-fanmarks/R2/notifications/reference
masters/availability, and 69 frontend client tests across their corresponding
adapters and recent/public/verified access. Wrangler deploy dry-run also
passed. The SPA build retains the existing >500 KiB main-chunk warning.

Read-only live smoke confirmed root 200 with `noindex`, robots disallow, Auth
health 200, null unauthenticated session 200, anonymous admin session 401, and
four versioned reference-master APIs returning 4/4/5/16 rows with `no-store`
at release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`.
Disallowed-origin master access returned 403. Profile, owned-fanmark, and
notification routes are deployed but return their expected fail-closed 503
codes while their D1 backend selectors remain unset and business D1 is empty.
The SPA route fallback returned 200 for `/plans` and a synthetic short-ID URL;
the PWA manifest and service worker returned 200, the worker script excludes
`/api/*` from navigation fallback, missing JS stayed 404, and unknown API
routes stayed JSON 404. Both referenced favicon files returned 200.
A fresh remote catalog query found only Cloudflare's internal `_cf_KV` table;
all seven user-owned Auth tables read back zero rows. No real data, production
service, or public domain/DNS was touched.

## D1 UUID and event-sequence defaults (2026-09-25 JST)

The schema converter is now version 3. PostgreSQL `gen_random_uuid()` defaults
on source UUID columns compile to a D1-native expression that returns canonical
RFC 4122 version-4 UUID text. Source/imported IDs remain explicitly bound and
are never regenerated. This closes the UUID-default gate without weakening the
row-import UUID validator. The `fanmark_events.id` `nextval()` default now
compiles to `INTEGER PRIMARY KEY AUTOINCREMENT`, with the exact PostgreSQL
sequence value retained as a final-snapshot import gate. The conversion
contract and snapshot example were updated.

Node 22.6.0 verification passed: migration-data tests 89/89, schema-converter
tests 10/10, lifecycle/credential-schema tests 9/9, D1 importer tests 13/13,
Worker D1 runtime tests 6/6, and Worker TypeScript. The D1 runtime created 256
UUIDs through the generated default and verified canonical version/variant
bits and uniqueness. A sequence test verified monotonic allocation after an
explicit imported ID and deletion. A fresh private conversion of the
2026-09-25 catalog parsed all 40 tables and 66 indexes in isolated SQLite;
foreign-key check returned no errors and `integrity_check` returned `ok`. The
report has 18 blocking groups (10 import, 8 schema/operation) and remains
`deployable: false`. The source database locale is `en_US.UTF-8`; the three
regex-based format checks remain gated until equivalent locale behavior is
proven. No business D1 DDL, user data, production service, or domain/DNS state
was changed.

## Locale-guarded regex CHECK conversion (2026-09-25 JST)

Schema converter v4 now has narrowly allowlisted SQLite equivalents for the
three known ASCII regex checks, but emits them only when the catalog says both
source locale settings are `C`, the column has no explicit non-default
collation, and the table/column/operator/pattern all match exactly. The current
source locale is `en_US.UTF-8`, so all three checks stay gated and the v4 report
remains at 18 unresolved groups with `deployable: false`. Reprocessing the
current private catalog produced 40 tables and 66 indexes; isolated SQLite
reported zero foreign-key violations and `integrity_check=ok`. No generated
DDL was applied to business staging. On Node 22.6.0, `npm run test:migration-data`
passed 90/90 and `npm --prefix workers/api run test:d1-import` passed 13/13.

## Tier/extension-price admin path preparation (2026-09-25 JST)

Added a fail-closed Worker admin route for reading and editing only
`fanmark_tiers.initial_license_days` and extension-price fields. It reuses the
current Better Auth admin-role and same-session TOTP-assurance gate. Every
single-field edit stages a new four-master release, verifies exact D1 row
readback, then compare-and-sets the active pointer against the screen's
expected release version. Public price responses continue to exclude Stripe
IDs. The frontend adapter uses credentialed `no-store` requests and has no
Supabase fallback after an explicit Worker selection.

Synthetic verification passed: reference-master Miniflare/D1 API suite 5/5,
frontend admin API contracts 6/6, Better Auth role/MFA route checks 12/12,
Worker and app TypeScript, targeted ESLint, CI isolation, Cloudflare staging
build, Worker deploy dry-run, and `git diff --check`. The five R2
Miniflare/D1 API tests also pass. No remote D1 edit was
performed. The staging selector remains explicitly disabled because checkout
still reads these settings from Supabase; enabling only the admin writer would
split the source of truth. R2 remains enabled and bound to the existing staging
Worker, with its separate synthetic upload/read/delete smoke already recorded
in [R2 Storage API](storage-r2-app-api.md). No production, user data, or
domain/DNS change was made.

## Paired extension-pricing read path (2026-09-25 JST)

Added a separate HMAC-protected Worker service endpoint for a single extension
price, plus strict Supabase Edge client validation. It selects the test/live
Stripe ID only for the checkout caller; the coupon-based direct extension asks
for price and active state without any Stripe ID. The public extension-price
API remains Stripe-ID-free. The checkout and direct-extension Edge Functions
now support `REFERENCE_MASTER_PRICING_BACKEND=cloudflare` while retaining
Supabase user/license reads and writes, and they fail closed after selecting
Cloudflare. `ExtendLicenseDialog` also has its own disabled D1 pricing selector.
The checkout path no longer writes full pricing rows, Stripe Price IDs, user
IDs, or checkout URLs to function logs.

Validation passed: HMAC helper-to-Worker integration 4/4, private service
endpoint suite 5/5, reference-master D1/API suite 6/6, frontend reference
master contracts 7/7, Worker typecheck, and Deno checks for both Edge Functions.
The app Worker was deployed to staging as version
`763c798c-8e37-456b-a720-54f75be1270b`; a separate staging-only HMAC secret is
stored in Cloudflare and in a mode-0600 local file outside the repository. A
live signed read verified the current release and active tier-2/one-month
record through both checkout and price-only projections. The backend selectors
and Supabase Edge Function secret remain unset, so checkout and license
mutations still use Supabase. No Stripe call, D1 schema/row write, user-data
change, production change, or domain/DNS change occurred.

## Local migration-suite isolation and distribution verification (2026-09-25 JST)

The default Workers Vitest config was also discovering the profile, notification,
and favorites integration files that require their own split-D1 Wrangler
bindings. Those three files are now excluded from the generic config and remain
run by their dedicated CI commands. The static-assets integration expectation
was updated to include the already-reviewed `fanmarkId` and `shortId` fields in
the recent-fanmarks DTO.

On Node 22.6.0, the frontend/Edge contract suite passed 88 tests and migration
data passed 90. The default Worker suite passed 26 plus 9 verified-access tests;
the split-D1 API suites passed: auth 12, storage 5, owned-fanmarks 4, profile 5,
notifications 6, favorites 4, recent D1 6, availability 8, versioned-master
availability 3, public access 11, reference-master API 6, and private reference
service 5. Versioned emoji/reference master integrations passed 7 and 5 cases;
lifecycle/credential schema passed 9; generic D1 importer passed 13; source
license-expiry integration passed 20, scheduler contracts 8, and local R2 import
smoke passed. Static Assets passed 14 cases and its Wrangler HTTP smoke.

The application and Worker type checks, normal and Cloudflare-staging Vite
builds, PWA cache-boundary check, and Worker/Static Assets Wrangler dry-runs
passed. Builds report existing large-chunk and stale browser-data advisories.
The Cloudflare business D1 remains without application DDL; no remote data,
production, or DNS/domain state was changed by these local checks.

## Owner fanmark profile API (2026-09-25 JST)

Added an authenticated Worker/D1 owner profile endpoint and wired the profile
edit/preview screens behind `VITE_FANMARK_PROFILE_BACKEND=worker`. The route
resolves ownership from Better Auth session identity, accepts only profile
fields, applies bounded URL/theme/JSON validation, and supplies UUID/timestamps
at write time. Its active finite-license predicate matches the current edit
screen and source profile INSERT policy. Frontend selection remains disabled
while staging business D1 has no application schema or user rows; the overall
fanmark settings page and its access configuration are still Supabase-backed.

Local validation: dedicated synthetic split-D1 Worker integration 5/5,
frontend API contract 5/5, Worker TypeScript and application TypeScript pass.
No remote database/schema writes, user-data migration, production change, or
domain/DNS change occurred. Contract details are in
[`fanmark-profile-api.md`](fanmark-profile-api.md).

## Empty business-staging schema bootstrap (2026-09-25 JST)

The generated v4 DDL now has its own `workers/api/migrations-business`
directory, configured only for the staging `FANMARK_DB` binding. Cloudflare's
[D1 migration configuration](https://developers.cloudflare.com/d1/reference/migrations/)
supports a per-binding `migrations_dir`, keeping this schema history separate
from Better Auth and master-data migrations.

Before writing, a read-only query confirmed `fanmark-business-staging` held
only Cloudflare's `_cf_KV` table. Wrangler local rehearsal applied all 108
statements; SQLite readback found 40 application tables, 66 indexes, no
foreign-key violations, and `integrity_check=ok`. Wrangler then applied
`0000_business_schema_v4_staging.sql` to the remote APAC business database. A
read-only follow-up confirmed 40 application tables, 66 indexes, the migration
ledger entry, no pending migrations, and an empty `PRAGMA foreign_key_check`.

This applied DDL only: the migration has no row-insert/update/delete/copy
statements. The schema report remains `deployable: false` with 18 unresolved
gates; selectors remain disabled, and the Worker was not redeployed. No
Supabase rows or Auth records, R2 objects, production service, or domain/DNS
state changed. Full details are in [`live-observations.md`](live-observations.md)
and [`schema-generator.md`](schema-generator.md).


## Recent and availability read paths on staging D1 (2026-09-25 JST)

The workers.dev staging Worker now explicitly selects D1 for recent-fanmark
reads and availability; the staging SPA's shared Worker base URL selects the
matching clients. The app code was redeployed as version
`c9d51d92-3b7a-49e9-b152-b210d24a36f1` after a Wrangler dry-run. A temporary
remote synthetic fixture exercised active ordering, grace exclusion, limits,
DTO mapping, exact CORS, no-store, and invalid input; all inserted rows were
removed and remote total counts are zero. Availability resolved a canonical
emoji from Master D1 and returned a valid tier-4 result against empty business
D1. No real rows, Supabase writes, production resources, or DNS were involved.
Tests and evidence are in `recent-api-contract.md`,
`availability-validation.md`, and `live-observations.md`.


## Public access reads on split staging D1 (2026-09-25 JST)

The staging SPA was built with `VITE_PUBLIC_ACCESS_READ_BACKEND=worker`, and
the app Worker config sets `PUBLIC_ACCESS_BACKEND=d1`. A local test using
distinct business and master databases found that emoji normalization was
incorrectly querying the business D1. The repository now selects
`MASTER_DB` for canonical emoji lookup and `FANMARK_DB` for fanmark and
license projections. The split-D1 Worker suite passes 11/11; Worker typecheck,
targeted ESLint, staging build, Wrangler dry-run, and `git diff --check` pass.

Worker version `3733c771-2903-40cd-8bdc-5a0f94412c82` returned HTTP 200 and
`Cache-Control: no-store` for synthetic short-ID, emoji-ID, and published-
profile reads. The input used a canonical emoji present in Master D1 while the
business D1's `emoji_master` remained empty. Four temporary synthetic rows
were deleted and exact-ID readback found zero in each table. No real rows,
Supabase writes, production routes, R2 objects, or domain/DNS settings changed.
The public-read selector is staging-only; protected-password verification,
access analytics, owner/history detail, and complete business API parity
remain outside this slice.

## Authenticated owner APIs on staging (2026-09-25 JST)

The staging Worker config now selects D1 for own profile, owned fanmarks,
owner fanmark profile, favorites, and notifications. The
`build:cloudflare-staging` script sets the matching five
`VITE_*_BACKEND=worker` selectors so a normal staging build reproduces the
deployed frontend. The staging SPA build and Wrangler dry-run passed; deployment
updated `fanmark-app-staging` to version
`70cb8111-2a25-4e43-8662-e59dfd8add8d` with split business/Auth/master D1
and both R2 bindings.

A temporary Better Auth user created only in staging exercised profile
GET/PATCH, owned-fanmark listing, owner fanmark profile GET/PATCH, favorite
add/list/remove, and notification list/unread-count/read. An unauthenticated
profile request returned 401. The initial synthetic credential fixture used
the email for Better Auth `accountId`, which returned 401; cleanup ran and
readback showed zero rows. Using the existing test convention, with the user
ID as `accountId`, passed sign-in and all owner API checks. The Auth
user/account/session and business profile/license/fanmark/config/notification/
favorite/event/discovery rows were deleted; exact-ID/composite remote readback
showed zero. No real user rows were present in the canary and no source writes
were made.

Seven focused local suites passed 31/31: Worker favorites 4, Worker
notifications 6, and frontend profile 4, owned-fanmarks 4, fanmark-profile 5,
favorites 4, and notifications 4. The staging build emits existing stale
browser-data and large-chunk advisories. The canary proves these API routes and
session ownership against the current staging schema; it does not cover the
complete browser acceptance flow, notification generation/delivery, all
business operation/security parity, production data, or DNS/domain cutover.
Those remain outside this stage.

## R2 image uploads on staging (2026-09-25 JST)

The staging build now sets `VITE_STORAGE_BACKEND=r2` along with the five
owner API selectors. Server `STORAGE_BACKEND=r2` and both APAC Standard
buckets were already bound. The new SPA build and Wrangler dry-run passed;
deploying updated the app Worker to `3246cbf2-642f-47f2-a107-0a8a116a8f8a`.

A synthetic Better Auth account uploaded a valid 1×1 PNG to the avatar route,
read identical bytes through its public URL, deleted it through the
owner-checked route, and confirmed the URL returned 404. The synthetic account
and session were removed; D1 readback found no associated canary rows. Local
storage client tests pass 7/7, Worker D1/R2 API tests pass 5/5, Worker
typecheck passes, and staging build/deploy dry-run pass. The bucket object was
deleted; no existing Supabase objects were copied. Production builds continue
to default to Supabase. Profile metadata and overall settings saves are still
split, so this is a staging upload-path check rather than complete profile
cutover.

## Remote emoji release rollback command (2026-09-25 JST)

The remote emoji release activation runner now accepts `--action promotion`
(default) or `--action rollback`. Both require the exact current active version;
rollback also requires a verified immutable artifact for a previously active
release. After activation, readback checks the pointer, generation, action, and
new immutable history entry. A stale `--expected-active` is rejected even if
the candidate is already active, so an uncertain retry must first use the
observed current version. Three synthetic argument/readback tests pass,
`npm run test:migration-data` passes 93/93, and the local Miniflare release
suite passes 7/7. The remote rollback command was not invoked and no Cloudflare
state changed in this step.

## Owner fanmark settings API and runtime password evidence (2026-09-25 JST)

Added local `GET/PATCH /api/me/fanmarks/:fanmarkId/settings` with Better Auth
session ownership, latest-license resolution, active/unexpired write guards,
bounded allowlisted input, and D1 batch writes. The client selector remains
unset. Raw access passwords are not stored in session drafts or returned by the
API; new four-digit passwords are bcrypt-hashed in the Worker. To keep
protected public reads verifiable after a later owner password change without
rewriting the immutable import ledger, the v2 verified-access extension adds
`fanmark_password_runtime_evidence`, which stores only the current license
incarnation, password generation, enabled flag, pinned codec, and timestamps.
The verifier accepts exactly one matching import artifact or runtime evidence
row and rejects stale generations.

The settings Worker suite passed 6/6, the client API suite 5/5, the protected
access D1 suite 10/10, and the full source-profile integration 20/20. The latter
now exercises fresh apply, idempotent apply, and exact v1-to-v2 extension
upgrade/readback. Worker and frontend TypeScript checks pass, as does
`git diff --check`. No staging settings schema or Worker deployment was made:
the remote extension still requires the exact plan-bound base inventory
readback before applying v2, and the feature selectors remain off. A live
check confirmed the account is `fanmark.id@gmail.com` with D1 write permission;
`wrangler d1 list` sees the business D1 and a read-only query succeeds on the
master D1, but querying `fanmark-business-staging` returns Cloudflare error
7403. The logged-in D1 Studio opens that business database and lists its base
application schema, but not the verified-access extension tables. This
CLI-vs-dashboard discrepancy remains unresolved; no DDL was attempted. No user
data, production, or domain/DNS state changed. Details are in
[`fanmark-settings-api.md`](fanmark-settings-api.md) and
[`verified-access-design.md`](verified-access-design.md).

## Live schema refresh and single-return staging canary (2026-09-25 JST)

Linked the migration worktree to the authenticated `fanmark.id` Supabase
project and retrieved the current public schema only. The CLI wrote no row
data. The resulting public schema contains 40 tables, one view, 58 functions,
77 policies, 36 triggers, and 70 indexes. The checked-in business D1 base
migration has matching table and column names; types, defaults, constraints,
indexes, policies, triggers, and function semantics still need separate parity
review.

Added `POST /api/me/fanmarks/return` with Better Auth ownership and D1
transition, audit, and notification-event behavior. Local Worker tests pass
12/12, client tests 4/4, Worker typecheck and staging build pass, and Wrangler
dry-run passes. Deployment `83629969-f48f-4f68-beeb-7b2ef47724c6` is active on
`fanmark-app-staging` at 100%. Live unauthenticated POST returned 401 and GET
returned 405. A synthetic Better Auth owner was blocked by an active transfer
code, then returned successfully after that synthetic code was removed. The
license transition, audit, owner event, and favorite event payload were read
back; exact cleanup returned zero synthetic business and Auth rows. Bulk return and
notification delivery are still on Supabase. No Supabase rows, production
routes, or domain/DNS settings were changed.

## Fanmark registration D1 transaction on staging (2026-09-25 JST)

Implemented and selected the registration API for the Cloudflare staging SPA
and Worker. The Worker validates the submitted ordered IDs against the ready
active emoji release in Master D1, derives normalized IDs from the release's
codepoints, reads the active tier row, and uses one D1 batch for the fanmark,
initial license, requested license-scoped configuration/profile, and audit
record. Reuse checks and the final mutation reject active licenses, unexpired
grace, or pending lottery entries on an expired grace license. Competing
registrations cannot both issue a license. The client sends Better Auth cookies,
uses `no-store`, and does not fall back to Supabase after a selected Worker
failure. Supabase remains the default outside the explicit staging selector.

Verification on Node 22.6.0: `npm run test:fanmark-registration-api` passed
6/6; `npm --prefix workers/api run test:fanmark-registration-d1` passed 8/8;
frontend and Worker typechecks, `npm run check:ci`, the Cloudflare staging
build, Wrangler 4.139.0 deploy dry-run, and `git diff --check` passed. The
staging bundle contains the registration selector and the route config binds
only the existing staging D1/R2 resources. Deployment
`29dd848d-604c-4405-9bf5-58aff04a00f2` is active at 100%.

Live staging rehearsal used a disposable Better Auth identity and the active
catalog's rose emoji. Registration returned 201 and readback verified tier 4,
an active initial license, basic configuration, profile, and audit row. A
duplicate returned 409; unauthenticated access returned 401. Cleanup removed
the Auth user/account/session and all related D1 rows. Exact readback returned
zero for the fanmark, license, config, profile, and audit tables, and the sum
of all 40 business-table row counts was zero. This synthetic staging proof
does not establish Supabase-user behavior, source-row parity, or production
operation parity. The current source function calculates pattern pricing but
does not enforce its `requiresPayment` flag; no new payment policy was added
and no Stripe call was made. No source rows, production service, or domain/DNS
were modified. Contract: [`fanmark-registration-api.md`](fanmark-registration-api.md).

## Fanmark lottery application/cancellation D1 routes (2026-09-25 JST)

Added `POST /api/fanmarks/lottery/apply` and `/cancel`, selected through
`VITE_FANMARK_LOTTERY_BACKEND` only in the Cloudflare staging build. The D1
routes resolve the Better Auth session user server-side, preserve the source
grace/license-plan checks, and guard entry uniqueness and current capacity in
the mutation batch. Apply/reapply/cancel audit rows are written atomically
with their state change, matching the source `log_lottery_entry_changes`
trigger; notification creation is best effort after the saved application.
The default plan capacity remains three when the corresponding setting is
missing, and `admin` remains unlimited. Perpetual active licenses remain
excluded from this lottery query because the source uses a strict `license_end
> now` filter.

Local verification: Worker D1 suite 11/11, frontend Worker-client suite 6/6,
frontend and Worker typechecks, CI isolation check, staging build, and Wrangler
deploy dry-run passed. The local cases cover configured/default limits,
existing and concurrent applications, cancelled-entry reuse, owner-only
cancellation, audit rollback, and notification enqueue failure.

Deployed `513d9cba-2424-4528-814a-3b1d83425b73` to
`fanmark-app-staging` at 100% on workers.dev. A disposable Better Auth user
completed the registration+lottery HTTP rehearsal: register 201, apply 200,
duplicate application 400, cancel 200, unauthenticated application 401. D1
readback verified the lottery row and cleanup verified zero Auth user/account/
session, user settings, fanmark/license/entry/audit/event rows, and zero rows
across all 40 business tables. The first canary exposed missing cleanup for
trigger-equivalent lottery audit rows; cleanup now removes and checks those
exact entry-scoped rows, and the complete rerun passed. This does not cover
winner selection, active-license issuance, imported users, notification
delivery, production routing, or domain cutover. Contract:
[`fanmark-lottery-api.md`](fanmark-lottery-api.md).

## Grace-expiry lottery finalization journal (2026-09-25 JST)

The isolated business-staging D1 now has `0005_lottery_plan_journal_staging.sql`
with exact schema and ledger readback; both lifecycle journal tables remain
empty and the 40 business tables still contain zero rows. The local expiry
finalizer now stores and replays the exact lottery seed, input snapshot, and
selection plan, then applies winner/loser effects with expiration and cleanup in
one guarded D1 batch. Source integration passes 25/25, lottery selection 10/10,
scheduled expiry 8/8, Worker typecheck, and `git diff --check`. A one-shot
synthetic staging canary and transfer canary are recorded below. The deployed
scheduled backend and Cron remain disabled. Real user-data migration and
domain/DNS cutover remain last.

## Transfer lifecycle canary on staging (2026-09-25 JST)

Deployed Worker version `929280ae-3285-4936-af67-a6f146aae03e` to
`fanmark-app-staging` at 100%. The first live approval returned `409` even
though its D1 batch had committed all transfer rows. The handler previously
trusted per-statement change metadata; approval now performs an exact terminal
state readback before returning success. The rerun passed issue, apply, and
approve, including owner/requester scoping, config reset, transfer lock,
pending lottery cancellation, audit/outbox creation, and cleanup.

`npm run test:staging-fanmark-transfer-smoke` passed. Its `finally` cleanup
returned all 40 source business tables and every user-owned Auth table to zero;
the pre-existing global `mfaGeneration` counter was unchanged. The test used
only disposable synthetic identities and rows. It copied no Supabase users,
did not touch production, and did not alter domain/DNS.

## One-shot grace-expiry lottery canary on staging (2026-09-25 JST)

`scripts/migration/staging-license-expiry-lottery-smoke.mjs` invoked Wrangler's
`--test-scheduled` event from the local Worker runtime with the explicitly
remote `FANMARK_DB` binding. Before seeding it checked that all 40 business
tables, user-owned Auth tables, and lifecycle run/item/effect journals were
empty. A single synthetic pending applicant won. Readback confirmed the
old license expired, the winner received an active license, the weighted
history and durable seed/input/plan were saved, audit and both notification
events were written, and there were no conflicts. The four source access
configuration projections were removed; the profile row remained as in the
source function.

The cleanup returned all 40 business tables and lifecycle run/item/effect
journals to zero and matched both retained lifecycle tables to their exact
pre-canary snapshot (including the existing 16-row incarnation registry).
The deployed app still has no `LICENSE_EXPIRY_BACKEND` selector or Cron
trigger, so this was a one-time staging proof, not scheduled activation. No
Auth identities, Supabase rows, production routes, or domain/DNS settings
changed.

## Bulk plan-downgrade return on staging (2026-09-25 JST)

The Cloudflare Worker now implements `POST /api/me/fanmarks/bulk-return` and
the two plan-selection screens route to it under the existing
`VITE_FANMARK_RETURN_BACKEND=worker` selector. The route accepts 1–50 distinct
license IDs, resolves the owner from Better Auth, blocks inactive/expired or
transfer-locked licenses, and processes each item independently. It preserves
the existing 207 partial-result contract and best-effort audit/notification
event behavior. Production still selects Supabase.

The Worker D1 integration suite passes 17/17 and the frontend client suite
passes 7/7; both typechecks, targeted ESLint, staging SPA build, Wrangler
deploy dry-run, and `git diff --check` pass. Staging version
`186255d9-c8ec-47bf-a8e0-32b3296a6ab3` is active at 100%. The live canary
returned HTTP 207 for one successful return plus one transfer-locked license,
then HTTP 200 after the synthetic transfer code was removed. Cleanup confirmed
zero rows in all 40 source business tables and all user-owned Auth tables,
unchanged access-version state and `mfaGeneration`, plus two newly retained
synthetic license-incarnation tombstones. The registry has 21 rows total: 16
pre-existing tombstones and five from the current return-canary attempts. The
one earlier setup attempt hit a duplicate normalized-emoji key and was cleaned
up; it left only the expected non-user anti-reuse tombstone. No Supabase rows,
production route, Cron trigger, or domain/DNS state changed.

## Earlier checkpoint: Stripe extension payment settlement guard (2026-09-25 JST)

The extension Checkout Session now carries the server-selected expected JPY
total and explicitly disables zero-total Stripe fulfillment, consistent with
the Admin free-extension path bypassing Stripe. The webhook processes a paid
completed Session or the async-payment-success event, leaves an unpaid
completion without a grant, and treats async failure/expiry as no-grant events.
Amount/currency changes fail closed for newly created Sessions. Seven new
settlement tests cover positive pricing metadata and paid, unpaid, asynchronous,
zero-total, and mismatch states. Billing tests pass 70/70 under Node 22.6; Deno
checks, Stripe module typecheck, and `git diff --check` also pass.

At this checkpoint the Checkout Session effect was not yet deduplicated or
atomic. The later transaction and webhook integration are recorded below.

## Stripe extension receipt-to-effect transaction (#32, 2026-09-25 JST)

Connected only the paid-license-extension checkout events to the durable
receipt path. The webhook now verifies the raw request bytes under a 256 KiB
streaming cap, stores the redacted normalized receipt, and invokes a
service-only PostgreSQL function. That function keys the effect by live/test
mode plus Checkout Session ID and commits license extension, pending lottery
cancellation, LICENSE_EXTENDED audit, effect-ledger state, receipt status, and
dispatch status in one transaction. It also creates the product-required
lottery cancellation audit and one notification event per canceled applicant.
It rechecks current owner, finite active or grace license state, fanmark tier,
and transfer locks. Unpaid completion is
stored as awaiting payment; a later async success can apply once. Expired or
failed sessions cannot grant time, conflicting metadata or amount/currency
mismatches fail closed, and a repeated event/session cannot extend twice.

Validation: the focused Stripe receipt, payment-settlement, effect-transaction,
and RPC-result suites pass 35/35 under Node v25.5.0. PGlite executes the new
SQL against an isolated source-shaped fixture, including duplicate Session
IDs, DST-boundary UTC rounding, terminal-state rejection,
rollback after synthetic audit and notification failures, per-applicant
notification payloads, and client-role ACLs. Deno checks
pass for both changed Edge Functions and the shared modules; the Stripe
experiment typecheck, CI workflow-isolation check, and `git diff --check` pass.
This migration is local and was applied only in PGlite: it is not applied to
Supabase or D1, and neither Edge Function is deployed. Stripe endpoint/event
settings, production, user/Auth/object data, and domain/DNS were not changed.

Open work remains: Checkout intent creation and Stripe idempotency keys,
non-extension webhook receipt/application paths, independent Postgres
concurrency checks, and Cloudflare D1 porting are outside this slice. A
payment reported after a failed/expired Checkout is dead-lettered without a
license grant; there is no automatic refund or operator alert yet, so add a
monitored reconciliation path before enabling this in production.

## Stripe Checkout intent and idempotency (#32, 2026-09-25 JST)

Added the local Checkout command boundary. The browser supplies a UUID request
ID persisted in `sessionStorage`; a service-only Postgres RPC validates the
current owner and stores the license, tier, months, selected Stripe Price ID,
positive JPY total, and live/test mode before the API call. The Edge Function
reuses an existing intent and its pinned terms, sends an intent-derived
Stripe idempotency key, stores the returned Checkout Session ID, and retrieves
an already bound open Session on retry. The signed webhook associates the
Session with that exact intent and verifies all immutable metadata before
applying the extension.

The local retry window is 20 hours. Stripe says keys may be pruned after they
are at least 24 hours old; an unbound intent past the local window returns a
reconciliation-required result and cannot create another Session. This
retention boundary is documented in the [Stripe API reference](https://docs.stripe.com/api/idempotent_requests).

Validation: the full Stripe receipt experiment passes 90/90, including the
PGlite intent transaction tests; root TypeScript, Deno checks, Stripe experiment typecheck,
CI workflow-isolation check, and `git diff --check` pass. ESLint passes on the
changed files when existing unrelated `any` and hook-dependency findings in
`FanmarkDashboard.tsx` are suppressed. The SQL ran only in PGlite; it is not
applied to Supabase or D1, no Edge Function was deployed, and Stripe or
production state was not changed. User-enabled R2 was not needed for this
Stripe slice.

Remaining: monitored manual reconciliation when Stripe created a Session but
the response and webhook were both lost beyond the local key window;
non-extension webhook and outbound billing commands; independent Postgres
concurrency testing; and the D1 port.

## Fanmark search details read API (#33/#34, 2026-09-25 JST)

Moved the search screen's `get_fanmark_complete_data` detail read behind
`POST /api/fanmarks/search/details` for the Cloudflare staging build. The Worker
reads business D1 and derives the optional lottery-entry projection from the
Better Auth session; caller-supplied user IDs are not accepted. Its versioned
allowlist omits protected redirect/message/password configuration. Frontend
Worker errors do not fall back to Supabase. Search-history writes remain on the
Supabase RPC for the deferred user-data stage.

Frontend contract tests pass 5/5, Worker default suites 30/30, and
verified-access suites 10/10. Root and Worker typechecks, the Cloudflare staging
build, Worker dry-run, and staging-config dry-run pass. Staging deployment
`e3d47df4-eb20-4ade-8857-398cde3aab0d` returned anonymous search details as
`{schemaVersion:1,result:null}` while business D1 remains empty; Better Auth
health returned 200 and unauthenticated admin returned 401. Business D1 has no
pending migrations. User-specific live details against imported rows, history
write migration, real data import, production routing, and domain/DNS are not
proven by this slice.

The related messageboard-preview screen had one remaining direct call to this
RPC. It now selects `getOwnerFanmarkSettings()` under the existing
`VITE_FANMARK_SETTINGS_BACKEND=worker` staging selector and keeps the RPC only
for regular Supabase builds. The settings frontend suite passes 5/5; app
typecheck and staging build pass. Deployment `e3d47df4-eb20-4ade-8857-398cde3aab0d`
returned 401 for the owner-settings GET without a Better Auth session. A
populated-row browser preview remains unverified because staging D1 is empty.

## Lifecycle settings Worker path (#34, 2026-09-25 JST)

Split the grace-period setting from the generic settings hook. The dashboard
and admin page now use one lifecycle hook; the staging frontend reads the
single public D1 value through `GET /api/system/lifecycle`, while
`PATCH /api/admin/system-settings/lifecycle` requires the existing Better Auth
administrator and session-bound MFA check. The patch accepts only an integer
from 1 through 365, uses a 1 KiB body limit, refuses a private-key collision,
and verifies the saved value by readback. Production builds remain on
Supabase. Product and architecture docs record the configured range and the
dedicated API contract.

A direct read-only Supabase query returned one public
`grace_period_days=1` value. After confirming staging D1 had no licenses or
lifecycle journals, inserted only that one public config row. No user rows or
other settings were copied. The current staging Worker is
`bf951bd0-4aee-42f2-a9a7-997beffe06de`; live public GET returned 200/no-store
with the exact value, anonymous admin PATCH returned 401, root returned
200/noindex, and Better Auth health returned 200.

Frontend client tests pass 4/4; combined settings D1 tests 9/9; Worker standard
and verified-access suites 30/30 and 10/10. Both TypeScript checks, focused
ESLint, staging build, Wrangler dry-run, and `git diff --check` pass. Full-file
lint of `FanmarkDashboard.tsx` continues to report existing `any` and hook
dependency findings. A rerun of the scheduled canary with safe setting
preservation failed at the local Wrangler test-scheduled transport
(`ECONNRESET`); cleanup restored the setting, zeroed canary license/journal
rows, and preserved 22 retained incarnation records. No Cron was enabled.
Authenticated admin browser use and the scheduler Cron remain unverified.
# 2026-09-25: 空き状況APIをactive emoji releaseへ統一

空き状況D1 repositoryがmutableな`emoji_master` mirrorを参照していたため、登録・お気に入りと同じversioned active releaseを参照するよう変更した。ready metadataのないpointerはupstream errorでfail closedし、mirrorにだけ残る旧IDは`invalid_emoji_ids`となる。canonical値がactive releaseと異なる場合もactive releaseのemoji identityを使う回帰テストを追加した。

Node 22.6.0でfocused D1 tests 10/10、versioned emoji/reference-master integration 4/4、Worker default suite 30/30、Worker/Frontend TypeScript、staging build、変更ファイルESLint、Wrangler staging dry-runが成功。Staging app Worker `b381e0b3-7e03-41c2-a217-aeb1d5c5cf68`を100%配備。GET-only live smokeでroot/auth health、3,944件のactive catalog version、同catalogから得たIDによるavailability 200を確認。remote D1、R2、Supabase、production、user data、domain/DNSへの書込み・切替なし。詳細は`docs/migration/availability-validation.md`。

## Maintenance settings Worker path (#34, 2026-09-25 JST)

`maintenance_mode`、`maintenance_message`、`maintenance_end_time`だけを扱う公開GETと管理者PATCHを追加した。staging buildは`VITE_MAINTENANCE_SETTINGS_BACKEND=worker`を選び、Workerは`MAINTENANCE_SETTINGS_BACKEND=d1`とsplit business D1を使う。admin PATCHは既存のBetter Auth管理者・session-bound MFA検証へ接続した。未取得やWorkerエラーをSupabaseへフォールバックせず、一般ユーザーの画面を閉じる。管理画面のメンテナンス項目は1回のPATCHにまとめ、猶予日数設定だけは従来のSupabase経路に残した。

Node 22.6.0でフロント契約テスト4/4、専用Worker D1テスト5/5、Worker標準suite 30/30、verified-access suite 10/10、root/Worker型チェック、対象ESLint、staging build、Wrangler dry-run、`git diff --check`が成功。Worker version `b7b208c7-68f8-4918-bfd9-b785ef66003d`をstagingへ配備し、公開GETがmaintenance offの既定値を`no-store`で返すこと、未認証PATCHが401となること、後続GETで値が変わらないことを確認した。認証済みPATCH、設定行の作成、maintenance modeの切替は実施していない。Supabaseや本番、ユーザーデータ、ドメイン/DNSにも変更なし。

## Deployed grace-expiry lottery Cron canary (2026-09-26 JST)

Ran `scripts/migration/staging-license-expiry-lottery-smoke.mjs` with
`FANMARK_STAGING_CRON_CANARY=1` against the APAC `fanmark-business-staging`
D1. Preflight verified the 40-table business profile had only its public
`grace_period_days=1` row, the user-owned Auth tables and lifecycle journals
were empty, and retained lifecycle rows could be snapshotted. The script seeded
only synthetic IDs, temporarily changed that public setting to `14`, and
deployed the workers.dev Worker with `LICENSE_EXPIRY_BACKEND=d1`, a unique
target-incarnation/schema digest, a four-page bound, and `* * * * *`.

The deployed scheduled event completed the expiry and lottery finalization.
Exact D1 readback confirmed the old license expired, the single pending entry
won, one active winner license was issued, history and durable seed/input/plan
were stored, the four old access-config rows were removed while the profile
remained, both notification events and an audit row were written, and there
were no conflicts. An initial short wait had no journal; Cloudflare documents
Cron changes can take up to 15 minutes to propagate, so that attempt was
inconclusive. The rerun used a 17-minute bound and succeeded.

The script redeployed immediately from the staging config, whose
`triggers.crons` is now explicitly `[]`, and removed the temporary backend
selector before detailed readback and cleanup. The final exact checks restored
`grace_period_days=1`, all non-settings business tables and lifecycle journals
to empty, the retained lifecycle state to its pre-canary snapshot, and all
Auth user tables to empty. Independent remote readback confirmed zero
fanmarks, settings users, licenses, notifications, audits, expiry/finalizer
runs/items, and effect guards. Cloudflare Settings now reports no Cron trigger;
the current app version `507c5143-0bd5-476a-b29f-22c646db1652` serves `/` with
HTTP 200. This proves one synthetic scheduled execution on staging only; no
Supabase user rows, production resource, or domain/DNS setting changed. It does
not enable recurring Cron or prove populated-user behavior/production CPU fit.

## Supabase schema refresh and notification master seed preparation (2026-09-26 JST)

The earlier “latest Supabase schema waiting for terminal input” status was
incorrect: it described an earlier `db dump` attempt that needed a local Docker
daemon. The current `npx supabase@2.118.0 db query --linked` path uses the
Management API and reads catalog metadata without Docker. The fresh private
catalog contains 40 base tables/406 table columns, 144 constraints, 139
indexes, 15 enum labels, 36 triggers, 77 RLS policies, one view, and 58
functions. The separate 411-column information-schema total includes five view
columns. Converter v4 still has 18 blocking groups; its table and column names
match the checked-in 40-table staging baseline. No application rows were read.

Exported the global notification masters into a private source snapshot and
prepared `scripts/migration/staging-notification-master-seed.sql`: 10 in-app
rules and 40 active in-app templates (10 per locale for en/id/ja/ko). Auth-owned
`created_by` was excluded. Local SQLite rehearsal matched every projected
source field exactly, confirmed repeat safety and a clean FK check, and left
preferences/events/notifications empty. The remote staging D1 still has zero
rows in the master tables. Wrangler remote D1 query/list-migrations returned
Cloudflare API 7403 even though `whoami` confirms the configured account and
`d1:write`; a read-only query in Dashboard D1 Studio succeeded. At this
checkpoint the seed was not applied. The D1 write-path blocker was resolved
later the same day; see the successful application and exact readback below.

## D1 notification event processor local slice (2026-09-26 JST)

Added `workers/api/src/notifications-scheduled.ts` and connected it to the
existing Worker scheduled entrypoint. With the explicit
`NOTIFICATION_PROCESSOR_BACKEND=d1` selector, it claims due events, applies
enabled rules, user preferences, segment filters, cooldown and per-user limits,
renders locale templates with the source function's date-placeholder behavior,
and atomically writes notifications plus the processed event state. Immediate
in-app items are marked delivered; delayed and other channels remain pending
for their channel delivery path. A stale processing claim is bounded to a
10-minute lease before recovery.

The notification D1 suite passes 12/12 and the Worker TypeScript check passes.
Local synthetic tests cover rendered in-app content, immediate/delayed status,
repeat polling, and the disabled selector. At this checkpoint the processor had
not run against remote D1; a later one-shot staging canary is recorded below.
The staging selector remains unset and no Cron trigger is configured. Email and
Web Push delivery, event creation parity, notification archival, and populated-
user CPU/authorization review remain open.

## Remote notification-master seed and exact readback (2026-09-26 JST)

The earlier Wrangler D1 7403 failure was retried from the authorized account;
read-only queries and the staging-only write both succeeded on the exact
`fanmark-business-staging` database ID
`d4bb0c48-f24a-491f-8693-fa393ab0b873`. Before the write, the migration ledger
was confirmed at `0000`–`0005`, and rules, templates, preferences, events,
notifications, user settings, fanmarks, and licenses were all empty. Applied
the two-statement staging seed, which only inserts global templates and rules;
Wrangler reported two executed statements.

`scripts/migration/verify-staging-notification-master-seed.mjs` then compared
all projected rows against the private Supabase master snapshot with source
SHA-256 `900f9f3a00bd5d0e68de541a0ad2a10a47c24def6613b89be69739b34584b3fb`.
Readback matched all 10 rules and 40 templates exactly, with `created_by` NULL.
Preferences/events/notifications, user settings, fanmarks, and licenses remain
zero, and the singleton public `grace_period_days=1` setting was preserved.
The remote notification master-data stage is complete. The processor has also
passed a one-shot scheduled-handler canary against remote staging D1, but no
deployed selector or recurring Cron is enabled; channel delivery and full app
verification remain separate.

A wider table-count audit found the expected six migration-ledger rows, the
50 notification masters, and one public settings row. The access-security
extension also has its singleton policy plus one failed synthetic audit, one
finished reservation, and one resource rate-limit bucket dated 2026-09-25.
These are the documented protected-access canary's digest/counter state, not
source user rows; they were preserved rather than cleared.

## Remote D1 notification processor canary (2026-09-26 JST)

`npm run test:staging-notification-processor-smoke` inserted one random
synthetic user-settings row and one due `favorite_fanmark_available` event in
the exact business staging database, then invoked the Worker `scheduled`
handler locally with `NOTIFICATION_PROCESSOR_BACKEND=d1`. Remote readback
confirmed the event reached `processed`, generated exactly one delivered
Japanese in-app notification with the synthetic fanmark name, and did not
increment retries. Cleanup removed the notification, event, and user-settings
row. All notification event/notification/preference/user-settings counts
returned to zero; the 10 rules, 40 templates, public grace-period setting, and
protected-access state matched their pre-run baselines. Worker tests passed
12/12, Worker typecheck, targeted ESLint, staging SPA build, smoke-script syntax,
and `git diff --check` passed. This exercised a local Worker against remote
staging D1; it did not deploy code, change Cron configuration, or process real
user data. The reusable script is
`scripts/migration/staging-notification-processor-smoke.mjs`.

## Staging Better Auth TOTP and emoji-admin integration (2026-09-26 JST)

Ran `workers/api/test/staging-admin-totp-smoke.mjs` with its explicit staging
write/database/master-roundtrip flags. Against the currently deployed
workers.dev app it provisioned a random synthetic administrator, signed in,
enrolled and verified a first TOTP factor, verified session rotation and
session-bound MFA assurance, then edited a release-protected emoji draft. The
deletion guard returned 409 as required; the script restored the original
draft and read back an unchanged active public catalog/version. It deleted the
synthetic account, factor, assurance, and session; all seven user-owned Auth
tables read back zero. A separate read-only Auth D1 query found the singleton
`mfaGeneration` row intact at generation 6. No actual user credential or factor
was used.

Read-only requests to the same deployed app returned 200 for `/`,
`/manifest.webmanifest`, `/sw.js`, and `/robots.txt`; the manifest identifies
`fanmark.id` with standalone display, and robots disallows indexing. This
verifies deployed asset and PWA-shell routes only; browser installation, offline
operation, signup/email/OAuth, and broad admin workflows remain unverified.
The staging SPA build, Worker typecheck, and targeted ESLint passed. No Worker
deployment, production route, real user data, or domain/DNS setting changed.

## Initial Stripe ingress schema port to local D1 (2026-09-26 JST)

Added a local-only business-D1 migration for Stripe webhook receipts and their
one-to-one durable dispatch rows, a signature-verifying `POST
/api/stripe/webhook` route behind an unset backend selector and signing secret,
and D1 claim/renew/retry lease primitives. It carries over live/test event
uniqueness, redacted normalized JSON, raw-body hashes without raw-body storage,
composite receipt binding, terminal-state rules, and lease/fencing constraints.
A fresh Miniflare D1 integration passes 20/20 cases, including concurrent
duplicate delivery and claim convergence, terminal-state repair, immutable
event conflict handling, valid SDK-signed request handling, stale/invalid
signature rejection, expired-lease fencing, retry transitions, and atomic
rollback on dispatch/receipt write failures. Worker API typecheck, targeted
ESLint, Node 22.6.0 tests, and Wrangler staging dry-run pass.

The D1 migration was not applied remotely; the route was not deployed or
enabled. No processing worker, Stripe API call, Stripe Dashboard change, or
billing effect was added. This is local schema, ingress, and lease evidence only, not
completion of issue #32. Details: [Stripe D1 ingress validation](stripe-d1-ingress-validation.md).
The read-only staging Worker secret inventory contains no Stripe webhook
secret. A read-only remote D1 migration-list call returned error 7403; the
remote ledger therefore remains unrefreshed for this checkpoint.

## Local Stripe Checkout dispatcher and notification-master admin slices (2026-09-26 JST)

Added a D1 extension Checkout endpoint and frontend client behind independent
selectors. It pins the active versioned Master D1 price, derives the caller
from Better Auth, checks license ownership/transfer/grace limits, persists an
intent before calling Stripe, and reuses an open Session with a stable key.
The D1 scheduled dispatcher claims test/live receipts sequentially, applies
extension events, retries transient errors with bounded backoff, and
dead-letters unported subscription/invoice events for review. Four synthetic
Checkout integration cases, five existing/new D1 receipt/application/scheduler
cases groups totaling 30, and five client contracts pass; fake Stripe clients
were used, with no real Stripe request.

Added an MFA-gated admin API/client for listing and editing only global
notification rules and translated templates. DTOs omit `created_by` and
template payload schema; updates compare `updated_at` to prevent stale
overwrites. The initial master-only screen change passed five D1 API tests,
four client contracts, and 13 Better Auth admin authorization tests. This
worktree now also routes manual event creation and event/delivery logs to the
same MFA-gated D1 API; the expanded suites pass six Worker tests and five
client tests. That new route/client slice has not been deployed or remotely
exercised. Details: [Stripe D1 validation](stripe-d1-ingress-validation.md)
and [notification API](notifications-api.md).

The initial R2 inventory confirmed the avatar and cover staging buckets. Since
that read-only inventory, later dated sections document the D1/R2 selectors,
notification Cron, applied business migrations `0006`/`0007`, and synthetic
staging canaries. Those staging changes did not touch Stripe APIs, real user or
Auth rows, production routes, or domain/DNS state. Historical test counts in
the earlier local-only snapshot above describe that earlier checkpoint, not
the current suite.

## Local invitation-code admin API slice (2026-09-26 JST)

Added a separate MFA-gated D1 admin API and frontend selector for invitation
code list/create/update/active-state/delete operations. The Worker creates
random codes when the admin leaves code generation automatic, owns initial
usage fields and creator attribution, returns a DTO without creator IDs, and
uses `updated_at` compare-and-set for edits. Existing user-settings references
prevent deleting a code.

The D1 integration suite passes 5/5; frontend client contracts pass 4/4.
Root/Worker typechecks and focused ESLint pass. `VITE_INVITATION_ADMIN_BACKEND`
and `INVITATION_ADMIN_BACKEND` remain unset for staging because invitation
codes have not been imported. The invitation-mode toggle, signup validation
and consumption, Better Auth signup, and email verification are still on the
existing Supabase path or closed. No remote D1 write, Worker deployment,
production, real user/Auth data, or domain/DNS state changed. Details:
[invitation admin API](invitation-admin-api.md).

## Remote Stripe schema preparation on staging (2026-09-26 JST)

Following successful local Worker/client/migration-data suites, Wrangler
read-only checks showed that only business migrations `0006` and `0007` were
pending on the intended APAC `fanmark-business-staging` database. The existing
lottery table required by the DDL was present. Both additive schema migrations
applied successfully. Remote readback found the six Stripe receipt,
dispatch, intent, application, effect, and lottery-entry tables empty;
`fanmarks`, `fanmark_licenses`, and `user_settings` also remained empty. The
next migration-list query returned no pending work.

The staging Worker was not redeployed, and the Stripe secrets, selectors, and
Cron remain absent. No Stripe API call, production state, real user data, or
DNS/domain setting changed. The empty schema is staging preparation only;
subscription/invoice parity and sandbox transaction rehearsal remain open.

## Transfer-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-transfer-smoke.mjs` on the
current workers.dev staging app. The synthetic owner issued a code, a second
user applied, the owner rejected the request, and the code was reapplied and
approved. The deployed one-minute Cron processed `transfer_rejected`,
`transfer_requested`, and `transfer_approved`, producing exactly one Japanese
in-app notification in `delivered` state for each intended recipient.
The smoke waits up to 90 seconds and fails on failed events, duplicate
notifications, wrong recipients, missing Japanese text, or timeout.

Cleanup removed notifications before events and deleted all synthetic transfer,
fanmark, license, audit, settings, and Better Auth rows. Exact post-run readback
reported zero synthetic business and Auth rows and left the MFA generation
baseline unchanged. Only Cloudflare staging and synthetic users were used;
real user data, production, and domain/DNS state were untouched.

## Return-generated notification events through the deployed Cron (2026-09-26 JST)

Extended and ran `scripts/migration/staging-fanmark-return-smoke.mjs` against
the current workers.dev app. The synthetic account first confirmed an active
transfer code blocks return, then returned its fanmark successfully; D1
contained exactly one `fanmark_returned_owner` event and one
`favorite_fanmark_available` event from the two event-producing paths.

The deployed one-minute Cron processed both events. Each generated exactly one
delivered in-app notification with a Japanese-rendered body and the expected
synthetic fanmark metadata/link. The test waited up to 90 seconds for Cron and
failed if an event became failed or delivery was missing. Cleanup removed the
notification children before events and then removed all associated synthetic
business/Auth rows; exact readback returned zero notifications, events, audit,
fanmark, license, transfer, favorite, discovery, user, account, and session
rows. Read-only master inspection before the run confirmed enabled rules and
active translated templates for both event types. No user data, production
resource, or DNS/domain setting changed.

## All migrated in-app notification rules through deployed Cron (2026-09-26 JST)

Extended `scripts/migration/staging-notification-processor-smoke.mjs` to submit
one synthetic payload for each of the 10 active in-app rules. The staging Cron
processed all events and produced exactly one delivered Japanese notification
per rule, with expected title, recipient, fanmark ID, and zero retries. The
canary cleaned notification/event/settings rows and read back zero; global
notification masters, public settings, and protected-access state were
unchanged. No worker config change or deployment was needed; the Cron remains
enabled for staging.

## Authenticated whois details and R2 staging verification (2026-09-26 JST)

Implemented `POST /api/fanmarks/details` on the integrated Worker. Anonymous
requests use a separate SQL projection that does not select owner identities,
history, favorite rows, or lottery entries. Authenticated requests resolve the
caller from Better Auth and return bounded ownership history plus derived
caller state without user IDs, emails, or license IDs. The staging frontend
selects this route explicitly; the normal build keeps the existing Supabase
RPC and Worker errors do not fall back.

Worker D1 tests passed 3/3; client DTO/fetch tests passed 4/4; frontend and
Worker typechecks and Cloudflare staging build passed. The full Worker package
suite passed 84 tests. Wrangler dry-run showed the split D1 bindings and both
R2 buckets, and remote Business/Auth/Master D1 checks found no pending
migrations. Staging deployed as version
`44d56b91-dbcf-46ce-ac9a-900431b143f9`; readback returned SPA 200, Auth health
200, and a no-store null result for an absent short ID.

The staging registration smoke confirmed the anonymous whois projection
omits history and personal state while a synthetic Better Auth owner receives
one history row and their pending lottery state. Cleanup read back zero
business/Auth rows. The staging R2 profile smoke uploaded, read, and deleted
one synthetic image in each bucket and confirmed both public object URLs
returned 404 after cleanup. These are workers.dev synthetic checks only; no
user-data import, production route, or domain/DNS change occurred.

## Availability rules and registration configuration on staging (2026-09-26)

Seeded four read-only-verified Supabase availability rules into staging D1;
all remained disabled and the source admin UUIDs were omitted. The staging
frontend now uses the Worker admin API guarded by current-session admin MFA;
its live TOTP canary listed the rules, performed a CAS update, rejected a stale
revision, restored the original value, and confirmed all four remain disabled.

Copied only the public `max_emoji_characters=5` system setting after confirming
the key was absent in staging. Readback shows that setting and the existing
`grace_period_days=1`; `system_settings` remains an explicit allowlist rather
than a table-wide copy. The deployed registration Worker reads the configured
maximum from D1. A synthetic staging registration/lottery/details and R2
cover-profile canary passed and cleaned its Auth, business, and object rows.
The registration route also rejects six distinct emoji IDs with
`invalid_emoji_count`. The Worker is version
`00ebddee-9f63-4840-abc8-f00dfe847ff5` at 100% on
workers.dev.

The full Worker package suite passes 88/88; registration D1 tests pass 10/10
and migration-data tests pass 93/93. Frontend/Worker typechecks, rule-admin
client tests 5/5, baseline validation 2/2, CI workflow isolation, targeted
lint, staging build, and Wrangler dry-run pass. Production, real user/Auth
data, Stripe, and domain/DNS remain untouched.

## Public OGP routes on workers.dev staging (2026-09-26 JST)

Added `/a/:shortId` crawler HTML and `/api/ogp-image` SVG generation to
`workers/api/src/ogp.ts`. Metadata uses the shared public D1 access/profile
projection. Published profile names are included only for an eligible,
unprotected profile; protected profile data is not queried. The existing
browser route still serves the SPA. Crawler HTML is `no-store` with
`Vary: user-agent`, and the staging response carries `X-Robots-Tag`.

Deployed Worker version `767ff630-81c2-4b01-bf89-012fc43e8a29` to the existing
workers.dev app. Read-only live checks returned crawler fallback 200, browser
SPA 200, SVG 200, six-character image input 400, root 200, and Auth health
200. The crawler fallback URL used the workers.dev host. No business row or R2
object was written. Local D1 public-access tests passed 13/13, the full Worker
suite 88/88, Worker/frontend typechecks, targeted lint, staging build, and
Wrangler staging dry-run passed. Remote staging has no public profile row, so
live profile-name/protected-profile rendering remains locally verified only.
The production Supabase OGP functions and public domain remain unchanged.

## Emoji-path OGP parity on workers.dev staging (2026-09-26 JST)

Extended crawler metadata to the legacy `/:emojiPath` URL. The Worker resolves
one exact active spelling to its short ID and then reuses the shared public D1
projection; duplicate active spellings fail closed to generic metadata. The
canonical crawler URL uses `/a/:shortId`, while non-crawler browser navigation
continues through Static Assets to the SPA.

Deployed `fanmark-app-staging` version
`4988be1e-5f1b-4839-8f3f-511d0a4238f6`. Live empty-D1 crawler fallback for an
emoji path returned 200 with `no-store`, `Vary: user-agent`, and staging
no-index. A browser-style navigation request for the same path returned the SPA
with 200. Local synthetic D1 verifies canonicalization, duplicate rejection,
protected-profile redaction, HTML/XML escaping, and navigation fallback. The
focused public-access suite passed 13/13; the full Worker suite passed 88/88;
Worker/frontend typechecks, staging build, targeted ESLint, CI isolation,
Wrangler dry-run, and `git diff --check` passed. Staging has no public fanmark
rows, so only generic remote OGP fallback is claimed. No D1 or R2 row/object,
user data, production routing, or domain/DNS setting was changed.

## Snapshot sequence-state rehearsal (2026-09-26 JST)

Snapshot format 4 now records the reviewed `fanmark_events.id` PostgreSQL
sequence definition, exact decimal watermark, and `isCalled` state. Export and
offline verification reject unsupported, missing, extra, or changed sequence
metadata. The local D1 importer seeds and reads back `sqlite_sequence` after
row import; Miniflare confirms the next generated ID for both called and
unused source sequences. The import report records exact source and target
watermarks. The migration-data suite, now including the D1 importer, passes
111/111 with no skips. A final source snapshot still requires event writers to
be frozen because sequence advancement is outside PostgreSQL MVCC. No source
event rows or live sequence values were read and no remote D1/R2 write was
performed; the schema remains `deployable: false` with 18 blocking gates.

## Encrypted snapshot archive rehearsal (2026-09-26 JST)

Added a Git-external backup bundle containing one AES-256-GCM ciphertext and a
small private-mode header. Source paths, table/file counts, and exact file
sizes remain inside the authenticated archive; only total ciphertext size
rounded to 64 KiB is exposed. Restore authenticates the complete ciphertext
before unpacking into a private temporary directory, verifies the snapshot,
and publishes it only after verification. The local D1 importer composes this
restore path and removes its plaintext scratch tree after the import attempt.
Key mismatch, ciphertext tampering, private modes, bundle metadata exposure,
snapshot verification, and synthetic D1 import all pass. The migration-data
suite passes 115/115 with no skips. No live source rows or sequence values
were read, no remote D1/R2 write was made, and the schema remains
`deployable: false` with 18 blocking gates. Operational backup destination,
separate key custody, retention/deletion policy, and restore from a persisted
artifact remain open; a real snapshot remains in the final user-data stage.

## Public access analytics D1 write path (2026-09-26 JST)

Added a Worker `POST /api/fanmarks/access` endpoint and an opt-in frontend
adapter for the existing public short-id access event. The endpoint bounds and
validates input, confirms the active fanmark ID/short-ID pair, resolves the
current active/grace license, and preserves the source's daily user-agent hash
without collecting IP addresses. A single D1 batch gates the five-minute
duplicate window, inserts the raw event, and updates daily device/referrer/type
counts and unique-visitor count atomically. Six concurrent identical synthetic
requests produced one log and one aggregate increment. Worker D1 tests pass
5/5; frontend adapter tests pass 3/3; frontend and Worker typechecks, staging
build, Worker deploy dry-run, CI workflow isolation, and `git diff --check`
pass. The staging selectors remain off because `/analytics` and dashboard
aggregate reads still use Supabase; no staging analytics rows or production
data were written. The raw referral and user-agent retention contract, public
ingress abuse controls, and owner-authorized read API remain open.

## Paired access-analytics staging enablement (2026-09-26 JST)

Follow-up to the local-only writer checkpoint above: added session-scoped D1
read APIs for the analytics page and dashboard, connected both frontend
surfaces, and enabled the writer and readers together in the workers.dev
staging build. The deployed Worker selects `FANMARK_ACCESS_ANALYTICS_BACKEND=d1`
and `FANMARK_ANALYTICS_BACKEND=d1`; the SPA selects the corresponding
`VITE_*_BACKEND=worker` adapters. Production/default selectors remain Supabase.

The synthetic staging smoke wrote one event, suppressed four repeats, checked
owner fanmark/metrics/summary responses and anonymous 401, then deleted its
temporary Auth and business rows. Readback found zero business rows after
cleanup and the baseline masters/settings unchanged. Worker integration tests
passed 8/8; both frontend client suites passed 3/3; frontend/Worker typechecks,
Cloudflare staging build, and `npm run check:ci` passed. App Worker version
`2d23439f-359a-4e0b-8ed2-c91c523dd44f` is active at 100% on workers.dev.
Historical analytics were not copied; abuse controls, retention policy,
populated-user authorization, and production CPU/plan fit remain open. No
production route or domain/DNS setting changed.

## Access-analytics ingress limiter on staging (2026-09-28 JST)

Added a dedicated Cloudflare Rate Limiting binding to the app-staging Worker:
120 requests per client key per 60 seconds. The Worker hashes
`cf-connecting-ip` into a versioned limiter key and never stores the raw IP.
Missing, failing, or malformed limiter responses fail closed before D1 writes;
local tests also verify the 429 path. The staging config remains workers.dev
only and keeps its existing split D1 and R2 bindings.

Worker full suite passed, including the 10 access-analytics tests;
`npm run test:migration-data` passed 172/172; typecheck, staging build,
Wrangler dry-run, ESLint, and CI workflow isolation passed. Deployed staging
version `82413f00-f60e-4a01-aeb0-2a071e01178a` and read back 100% traffic.
The rendered `/analytics` synthetic canary recorded one event, suppressed
four concurrent duplicates, showed total access `1` and unique visitors `1`,
verified both Worker reads and anonymous 401, then independently read zero
synthetic business/Auth rows after cleanup. No historical analytics, real
user data, production routing, or domain/DNS were changed. Raw referrer and
user-agent retention policy, populated-user authorization, and production
CPU/plan fit remain open.

## Rendered WhoIs owner/history staging canary (2026-09-28 JST)

Added `npm run test:staging-fanmark-details-ui` to verify the deployed
`/f/:shortId` details page with the same tightly scoped synthetic fixture used
by the analytics canary. Against staging version
`82413f00-f60e-4a01-aeb0-2a071e01178a`, the authenticated owner page fetched
`/api/fanmarks/details` and rendered the synthetic fanmark plus one history
row. The isolated browser then cleared its session cookie, reloaded the page,
and showed the login prompt with no history rows or owner name. Independent
cleanup readback found zero synthetic business and Auth user/account/session
rows; the temporary Chrome profile was removed. Local details Worker tests
passed 3/3 and the canary script passed syntax and ESLint checks. No real user
data, production route, or domain/DNS state was used or changed. Imported-row
parity and production routing remain open.

## Reference-master editor paired-cutover gate (2026-09-26 JST)

The existing versioned D1 editor is tested, but its writer selector must move
with the Supabase Edge checkout reader because both depend on the same tier
amounts and Stripe IDs. The Edge Function secret and checkout selectors remain
unset. An interim staging deployment briefly included the editor selectors;
no authenticated request or edit was sent. It was immediately replaced by
version `7a2a780d-3fed-476b-a84e-905fc6d29aad` with both editor selectors
unset, leaving the final staging editor on its Supabase path and preserving the
active reference release unchanged.

Admin client tests pass 6/6, reference-master Worker/D1 tests pass 6/6, and the
same-session admin authorization suite passes 13/13. Frontend typecheck, CI
workflow isolation, staging build, and Wrangler dry-run passed. After redeploy,
public masters returned 4 tiers, 4 languages, 5 reserved patterns, and 16
extension prices with `no-store`; the gated admin API returned 503. The
authenticated editor and paired checkout cutover remain open. No user data,
Stripe object, production route, or domain/DNS setting changed.

## Notification admin logs moved to staging Worker (2026-09-26 JST)

`AdminNotificationManager` now selects D1 for manual event creation and the
event/delivery logs when `VITE_NOTIFICATION_MASTER_BACKEND=worker`. The
MFA-gated Worker endpoint accepts only the three event types offered by the
screen, caps JSON input at 16 KiB, returns bounded 100-row logs, excludes
payloads, and returns only an eight-character user ID preview. Six Worker D1
tests and five frontend API contract tests pass; Worker/frontend typechecks,
the full Worker package test command, staging build, Wrangler dry-run, focused
lint, and `git diff --check` pass.

Deployed workers.dev staging version
`938f880d-f3db-46d5-9634-60612e4e2814`. Anonymous reads of both new log routes
returned 401; `/api/auth/ok` and the SPA returned 200. The synthetic
administrator sign-in/TOTP/MFA canary then read 10 rules, 40 templates, and
both logs; before/after notification counts were unchanged and synthetic Auth
rows were removed. Manual event POST passed only the synthetic local D1 test;
it was not called remotely because the staging Cron can process pending events.
No real user data, production route, or domain/DNS state changed.

## Worker Cron schedule separation (2026-09-26 JST)

The Worker now dispatches by `ScheduledController.cron`: `0 0 * * *` selects
the source-compatible daily UTC license-expiry job, while `* * * * *` selects
notification processing and Stripe receipt dispatch. The staging config
contains both triggers and sets `LICENSE_EXPIRY_CRON=0 0 * * *`; it deliberately
does not set `LICENSE_EXPIRY_BACKEND`, so daily lifecycle invocations exit
before opening D1. The expiry canary overrides the lifecycle cron only for its
temporary synthetic run. Unit tests cover default routing, custom test routing,
and unrelated triggers.

Deployed workers.dev version `1413b726-0930-45f4-b779-67865fffa24d`. The
staging TOTP/MFA canary passed on that version, and read-only probes returned
Auth health 200, anonymous admin/log routes 401, and SPA 200. Remote aggregate
readback showed zero licenses, lifecycle runs, notifications, notification
events, and invitation rows. The Worker package test command passes all 152
tests; Worker/frontend typechecks and Wrangler dry-run pass. The new daily
trigger is configured but has not yet fired in production-like operation; the
existing synthetic lifecycle Cron canary remains the runtime evidence. No
license/user row, production route, or domain/DNS state changed.

## Conditional Better Auth email and social-provider wiring (2026-09-26 JST)

The current worktree adds Resend verification and password-reset callbacks,
same-origin HTTPS URL validation, and a capability endpoint that returns only
configured provider names/booleans. Google, GitHub, Discord, and Apple OAuth
are wired behind a separate selector and complete credential pairs. New-user
signup and Better Auth social signup remain disabled; this only supports
pre-existing Better Auth identities. Frontend reset/social actions are shown
only when the Worker reports the corresponding capability.

Local verification passed for auth-email 3/3, auth-social 3/3, auth D1 15/15,
and Better Auth client 13/13. The full Worker suite, both TypeScript checks,
CI isolation check, and Cloudflare staging build passed on Node 22.6.0. No
Resend or OAuth credentials are configured and no mail or provider callback
was executed. Version `bc5ad53e-5f08-492b-81fb-8046c9be9600` is deployed at
100% to workers.dev staging. Live capability readback returned all email and
signup flags false with no social providers; synthetic signup, reset,
social-sign-in, and callback requests returned 403. Auth health returned 200,
anonymous admin session 401, and browser navigations to `/auth`,
`/forgot-password`, and `/reset-password` served the SPA with 200. No real
users, production routes, or domain/DNS settings were changed. See
[auth feasibility](auth-feasibility.md).

## Stripe invoice payment-state projection on D1 (2026-09-26)

Added the additive staging migration `0008_stripe_invoice_projection_staging.sql`
and a D1 runtime for the existing pinned-Basil invoice reconciler. The Worker
re-fetches the source invoice and current subscription/latest invoice from
Stripe under a customer-generation fence. It requires the exact D1 customer
and subscription mapping and never joins by email. One D1 batch updates only
payment-failure fields plus the application ledger, fence, receipt, and
dispatch terminal state. It does not change plan, subscription entitlement,
license, or notification data. Runtime lease checks use the current clock after
provider reads; Stripe requests are limited to 10 seconds with no SDK retries.

Nine Miniflare cases pass for paid/failure/action-required projection, both
stale-event directions, missing mapping, fence contention/recovery, database
rollback followed by retry, scheduled dispatch, a provider call that outlasts
the dispatch lease, and the disabled-by-default scheduled path. The full Stripe
ingress/application/projection suite passes 39/39, Worker typecheck passes, and
the Wrangler dry-run bundles the new runtime. Migration `0008` is applied to the
empty APAC `fanmark-business-staging` database, and Worker version
`68a2e0bf-3236-444c-9c7a-a46294037855` is deployed at 100% to workers.dev
staging. Stripe selectors/API secrets remain unset, so the feature stays
disabled. No Stripe call, user data, production route, or domain/DNS change was
made.

## 2026-09-26 subscription reconciliation staging deployment

PR #41 commit `0ed264a` added subscription deleted handling and guarded Free-plan license returns. Worker typecheck, Stripe integration tests (54/54), staging frontend build, Wrangler deploy dry-run, and `git diff --check` passed. Business D1 migration `0011_stripe_subscription_free_return.sql` was applied and read back before deploy; Wrangler reports no pending migrations.

Workers.dev staging now runs version `cec31381-d388-492d-906c-879b70d03cf3` at 100%. The staging config retains the existing `* * * * *` notification/Stripe-dispatch trigger and `0 0 * * *` expiry trigger. Notification processing remains selected; expiry is disabled because `LICENSE_EXPIRY_BACKEND` is unset. Stripe selectors and Stripe secrets are absent, so webhook GET returns 404 and dispatch stays disabled.

Read-only canaries after deploy returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for `/api/stripe/webhook`. Remote business-D1 readback found zero users, fanmarks, licenses, return batches/items, and notification events. No Stripe API call, real user data, production route, or DNS/domain setting was changed.


## 2026-09-26 Customer Portal D1 API staging rollout

Added an authenticated Worker endpoint for opening Stripe Customer Portal from the profile page. It reads only the signed-in owner’s exact D1 stripe_customer_id, refuses email-based customer search, pins return_url to the allowlisted Better Auth origin at /plans, and validates Stripe’s HTTPS response URL. The client is enabled for the staging build and does not fall back to Supabase on Worker errors.

The endpoint requires STRIPE_CUSTOMER_PORTAL_BACKEND=d1, the D1 webhook/dispatch selectors and signing secret, a matching STRIPE_SECRET_KEY plus test/live dispatcher keys, and a Better Auth session. Those Stripe selectors and secrets remain unset, so POST /api/billing/customer-portal returns 404. Stripe webhook remains 404.

Worker version d895ec75-76fb-457e-a74d-fd8102ff7110 is active at 100% on workers.dev. Post-deploy read-only checks returned 200 for / and /api/auth/ok, 404 for both billing routes. No Stripe call or D1 write occurred. Local verification passed the Stripe Worker suite 59/59, Customer Portal client tests 5/5, both TypeScript checks, staging build, and Wrangler deploy dry-run.


## 2026-09-26 Free-to-paid plan Checkout D1 rollout

Added a Better Auth-owned `POST /api/billing/plan-checkout` path for the
Free-to-paid subscription flow and connected `/plans` to its Worker client in
the Cloudflare staging build. The request is limited to an allowlisted HTTPS
origin and `creator`/`max`/`business` plans. The Worker reads the exact owner's
email from Auth D1, requires one matching free-plan row in business D1, selects
the mode-specific plan Price, and verifies that Stripe returns an active
monthly JPY Price in the same mode. It never searches Customers by email and
does not grant a plan; subscription reconciliation remains authoritative.

Business migration `0012_stripe_plan_checkout_commands.sql` adds a durable
Customer creation fence and owner/plan/Price/mode-bound Checkout command ledger.
An unknown Stripe Customer response is retried with the same provider key; if
the local result remains unresolved past the provider idempotency window, the
route stops for reconciliation instead of blindly creating another Customer.
Repeated requests return the same open Checkout Session, and request UUID reuse
with changed terms fails closed.

The migration was applied only to APAC `fanmark-business-staging` and read back:
both command tables, `user_settings`, and `user_subscriptions` each contain zero
rows; Wrangler reports no pending migrations. Worker version
`a67b6abe-0080-4784-bcf2-87efed59f83a` is active at 100% on workers.dev staging.
Read-only checks returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and
404 for Stripe webhook, Customer Portal, and plan Checkout routes. Wrangler's
secret-name list contains no Stripe secret, and no Stripe selector is present
in the staging Worker config, so these billing paths remain closed.

The full Worker package suite, the 116-case migration-data suite, the 8-case
plan Checkout D1 suite, the 6-case frontend client suite, both TypeScript
checks, CI workflow isolation check, targeted ESLint, staging build, Wrangler
deploy dry-run, and `git diff --check` passed. No Stripe API transaction, user
data migration, production route, or DNS/domain change occurred. Paid-to-paid
plan changes and Stripe sandbox acceptance remain incomplete; see the
[D1 plan Checkout contract](stripe-plan-checkout-api.md).


## 2026-09-26 current Supabase catalog / local D1 import rerun

Re-ran the read-only schema catalog query against the linked Supabase project;
the private catalog contains 40 tables, 406 columns, 144 constraints, 139
indexes, one view, 58 functions, 36 triggers, and 77 RLS policies. It was
written outside the repository with mode `0600`; no application rows were
queried. Version-4 conversion still reports 18 unresolved gate groups and
`deployable: false`.

`node scripts/migration/test-d1-import-current-schema.mjs` passed against that
exact catalog using a disposable local D1 and three synthetic rows. All 40
checkpoints completed after injected acknowledgement loss; exact readback,
foreign-key check, transformed synthetic credential, and tampered-coverage
rejection passed. The result remains `public_rows_reconciled`, with
`deployable` and `fullMigrationReconciled` false. No Cloudflare D1, production,
user data, or DNS/domain state changed.


## 2026-09-26 staging lifecycle Cron revalidation

Fixed the opt-in canary's stale baseline checks. It now permits only the
checked-in `* * * * *` notification and `0 0 * * *` lifecycle Cron schedules,
requires the lifecycle execution selector and run bindings to remain unset,
and includes all approved system settings, availability rules, and
notification-master rows in its baseline count. The five configuration tests
and all 121 migration-data tests passed; targeted ESLint and `git diff --check`
passed.

The deployed workers.dev Cron canary completed the synthetic lottery path with
`winner_finalized`, restored the normal staging deployment, and read back the
original grace-period setting and retained lifecycle state. Post-cleanup
business baseline counts matched, lifecycle journals and Auth user tables were
empty, and additional D1 readback found zero plan Checkout command, user,
license, and fanmark rows. Worker version
`a358996e-ce86-4410-be53-40e6f355ee9e` is active at 100%. Read-only HTTP checks
returned 200 for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for
`/api/stripe/webhook`. The lifecycle backend remains disabled in the restored
configuration; no real user, production, or domain data changed.


## 2026-09-26 paid-plan change command

Added `POST /api/billing/plan-change` and its PlanSelection Worker client for
existing paid subscriptions. The request omits client-supplied current plan,
Customer, Subscription, and Price identifiers. The Worker requires the
Better Auth owner, business profile/customer mapping, one active D1 subscription,
current Stripe subscription/customer/Price, and mode-specific Price settings to
agree. It persists an immutable owner-bound command before Stripe mutation and
uses a unique per-owner open-command slot plus a stable 23-hour idempotency key.
It follows PRODUCT's immediate prorated upgrade, no-proration paid downgrade,
and immediate Free cancellation behavior. A server-side target-limit check
blocks the command until selected license returns are reflected. An SCA/payment
action returns the user to the existing Customer Portal; the PlanSelection
screen resumes profile polling when the user returns. Entitlements are updated
only by the existing signed webhook reconciliation.

Nine Miniflare D1 tests and five frontend client tests passed, covering request
ownership and mode binding, limits before mutation, no direct entitlement
write, upgrade/downgrade/cancel parameters, payment-action fencing, lost
acknowledgement recovery, and competing commands. Frontend/Worker typechecks,
targeted ESLint, CI workflow isolation, staging build, Wrangler dry-run, and
`git diff --check` passed.

Business migration `0013_stripe_plan_change_commands.sql` was the only pending
remote migration. It was applied to the APAC staging business D1; readback
confirmed the command table exists, contains zero rows, and no migrations are
pending. The staging frontend and Worker were deployed with the browser client
selected but with `STRIPE_PLAN_CHANGE_BACKEND` absent and no Stripe secrets.
Worker version `785e5754-21dd-4feb-8903-b0a797821ffb` is active at 100%.
Read-only checks returned 200 for app root, robots, and Better Auth health, and
404 for the disabled plan-change route. No Stripe transaction, user data,
production route, or domain/DNS state changed. Stripe sandbox/integrated
acceptance and other billing commands remain open.

### Staging redeployment and readback

After the portal-return polling fix and command-recovery race check, the full
Worker suite passed, including nine plan-change D1 cases; the five frontend
client cases, both TypeScript checks, targeted ESLint, staging build, and
Wrangler dry-run also passed. The latest app Worker is
`1b8c2bbe-c95d-4037-846a-9a7d67ba932b` at 100%. Read-only probes returned 200
for `/`, `/robots.txt`, and `/api/auth/ok`, and 404 for the plan-change route.
The remote command table remains empty and Wrangler reports no pending business
migrations. Stripe secrets/selectors remain absent; no Stripe call, user data,
production routing, or domain/DNS change occurred.

## Invitation-gated signup staging schema and Worker slice (2026-09-26 JST)

Added a split-D1 signup coordinator for the invitation-required Better Auth
flow. It reserves invitation capacity in business D1, creates the Better Auth
identity in auth D1 with a recoverable command marker, then atomically writes
the required profile and consumes the invitation. Business D1 keeps an HMAC
email fingerprint and command state, never the submitted email or password.
The Worker exposes invitation validation and signup capability only when the
explicit backend selector, Resend configuration, and both schema capabilities
are ready. The staging selector remains absent, so signup stays closed there;
the waitlist form is hidden in Worker mode to avoid new Supabase writes.

Nine dedicated synthetic split-D1 tests passed, including last-slot
competition, email-send retry, lost acknowledgement recovery after auth-D1
commit, and duplicate-email privacy. The full Worker suite passed, including
the 15-test Better Auth D1 suite; the frontend client suite passed 14/14.
Frontend and Worker typechecks, CI workflow isolation, Cloudflare staging
build, targeted ESLint, and `git diff --check` passed. Wrangler 4.135.0 does
not support `--dry-run` on `d1 migrations apply`; the migration SQL was
executed by the local synthetic split-D1 suite, and remote `migrations list`
identified only these two pending files before application.

Applied `0007_auth_signup_command.sql` to `fanmark-auth-staging` and
`0014_invitation_signup_attempts.sql` to `fanmark-business-staging`. Remote
readback confirmed the Auth `user.signupCommandId` column, the business
attempts table plus its two indexes and four guards/consumption triggers, zero
signup-attempt rows, and no pending migrations. Deployed app Worker version
`bd78ddce-b8c4-4a77-ac00-1609bd5f0b04` to
`https://fanmark-app-staging.fanmark-id.workers.dev`; `/`, `/robots.txt`,
`/api/auth/ok`, and `/api/auth/capabilities` returned 200, with capabilities
reporting `signUp: false`. Wrangler secret inventory contains only
`BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`, and
`VERIFIED_ACCESS_SECRET`; no Resend secret or signup selector is configured.
No invitation records were seeded, no real email was sent, and no user data,
production, or domain/DNS state changed.


## Paired D1 extension pricing UI on workers.dev staging (2026-09-26 JST)

The Cloudflare staging build now selects the public extension-price reader, MFA-protected D1 price editor, and extension-checkout client together. The Worker selects `REFERENCE_MASTER_ADMIN_BACKEND=d1`; the browser checkout client sends requests to the Worker and never falls back to the Supabase Edge Function. Production/default builds are unchanged.

Deployed `fanmark-app-staging` version `691ce686-17fc-4ff3-a96b-371e3f2f5ee5` to workers.dev. Live read-only checks returned 200 for the SPA/auth health and all four public masters. Extension prices returned 16 rows from release `49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`, `Cache-Control: no-store`, and no Stripe IDs. The unauthenticated admin API returned 401. The extension Checkout endpoint returned 404 because the Worker-side Stripe Checkout, webhook, and dispatch selectors/secrets are deliberately absent; the staging checkout client therefore fails closed without calling Supabase or Stripe. No authenticated price edit was sent.

Node 22.6 verification passed: frontend reference-master/admin/extension-checkout contract tests 18/18, Worker reference-master D1 6/6, signed price service 5/5, D1 extension-checkout integration 4/4, Better Auth D1 15/15, root/Worker typechecks, CI workflow isolation, Cloudflare staging build, and Wrangler deploy dry-run. Wrangler deployment succeeded. The existing staging Stripe secret inventory contains no Stripe keys. No D1 price record, user data, Stripe object, production route, or domain/DNS state was changed. At this checkpoint legacy coupon and direct-license-extension paths were still on Supabase; the coupon API moved to staging in the later checkpoint below, while direct license extension remains open.

## Extension coupon application and administration on workers.dev staging (2026-09-26 JST)

Added the Better Auth owner route for coupon redemption and a separate administrator/MFA-protected D1 management route. The redemption is one guarded D1 command insert whose triggers atomically claim coupon capacity, record usage, extend the owned license, cancel pending lottery entries, enqueue notifications, write audit records, and preserve the response for retries. A grace-plan command snapshots the plan setting and rejects stale configuration at insert time; concurrent identical request IDs converge on the same stored result. The admin API lists/creates coupons, uses compare-and-swap for active state, deletes only unused coupons, and returns usage details only after MFA authorization. Default/production frontend selectors remain Supabase; the Cloudflare staging build and Worker select D1 with no fallback.

Business migration `0015_extension_coupon_application.sql` was the only pending migration. It applied to `fanmark-business-staging` (`d4bb0c48-f24a-491f-8693-fa393ab0b873`); remote readback found both triggers, both indexes, the command table, and no pending migrations. Read-only counts after deployment are zero for extension coupons, coupon usages, and application commands. No redemption or coupon seed was performed.

The final Worker version `09cb56d8-e0c2-4a4e-af40-d6506922e9a6` is active at 100% on workers.dev. Read-only probes returned 200 for `/` and `/api/auth/ok`; anonymous coupon application and coupon administration returned 401. No authenticated coupon use/admin mutation, user-data import, production route, or domain/DNS change occurred.


## Admin user directory read APIs (2026-09-26 JST)

Added MFA-gated `POST /api/admin/users` and `POST /api/admin/users/:userId`
read routes. The list joins bounded business-profile candidates to Better Auth
users, session-derived last-sign-in time, license counts, and Enterprise
settings across split D1 bindings. Search includes Auth email as well as
username/display name; candidate overflow fails closed instead of silently
truncating. Detail returns recent licenses, TOTP presence, and recent audit
rows. Audit metadata removes keys that can contain credentials or contact
details, and responses are `no-store`.

The frontend uses credentialed same-origin requests with no cache or redirect,
validates the response contract, and never falls back to Supabase after Worker
selection. Cloudflare staging screen mode is read-only; plan, suspension,
reset-link, and immediate-expiry mutations remain disabled pending their D1/Auth
implementations. Synthetic split-D1 API tests pass 3/3, frontend contract tests
pass 3/3, and both root/Worker typechecks pass. The complete Worker `npm test`
suite and Worker typecheck pass with the API included.

Deployed `fanmark-app-staging` version
`54c932cf-9589-4dc6-9409-7651ba0648a5` to
`https://fanmark-app-staging.fanmark-id.workers.dev`. Read-only smoke checks
returned 200 for `/` and `/api/auth/ok`; an anonymous `POST /api/admin/users`
returned 401 with `no-store`. No authenticated admin session or user-row
mutation was used, and no production route or domain/DNS setting changed.
Plan mutation, suspension, password-reset, and immediate-license-expiry
controls remain disabled in Worker mode; migrate those routes and run an
authenticated staging canary before calling user management complete.

## Auth email-template D1 seed and staging rollout (2026-09-26 JST)

Added the same-origin SPA adapter and MFA-gated D1 list/CAS editor for the four
auth template types, plus Better Auth D1 lookup for verification and password
reset. The runtime selects the user locale from `user_settings`, escapes D1
copy for HTML, and fails closed when the selected D1 template is missing or
inactive. The checked-in staging seed contains 16 allowlisted source master
rows; the readback verifier compares every field with a private row manifest
and confirms core user-owned business tables are empty.

Auth email tests pass 7/7, email-admin D1 tests 4/4 including a concurrent CAS
race, frontend contracts 3/3, and root/Worker typechecks pass. Wrangler identity
matched the intended Cloudflare account. The remote baseline had zero rows in
the four allowlisted template types and zero rows in the checked user-owned
tables. Reconstructing the seed in isolated SQLite reproduced the pinned source
content digest; the seed SQL digest also matched. Applying the seed wrote 16
templates, and the remote verifier confirmed every selected field, all four
types across four locales, and zero user-owned rows.

The Cloudflare staging SPA build and Wrangler dry-run passed. Worker version
`9b1f777e-76e1-4721-8408-1fd44145b4b0` is active at 100%. Read-only probes
returned 200 for `/`, `/robots.txt`, `/api/auth/ok`, and
`/api/auth/capabilities`; anonymous `/api/admin/session` and
`/api/admin/email-templates` returned 401. A synthetic admin completed the
deployed TOTP/MFA flow, read all 16 template rows from the protected API, and
matched every field to a D1 readback; the GET left D1 unchanged. The canary
deleted its Auth rows and verified all user-owned Auth tables returned to
zero. The capability response keeps signup, email delivery, and social
providers disabled. No email was sent, no real user row was copied, and no
production route or domain/DNS setting changed.

## Active-license disabled credential import coverage (2026-09-26 JST)

Verified the checked-in password settings flow: disabling protection calls
`upsert_fanmark_password_config` with `new_password = '0000'` and
`enable_password = false`; the RPC persists both fields, and the UI requires a
new four-digit value when protection is enabled again. Updated the synthetic
D1 importer to hash the exact credential from disabled rows on active
licenses, preserve `is_enabled = 0`, and atomically record `disabled` coverage
with the artifact and checkpoint. Non-active licenses remain fail-closed and
out of this change.

The synthetic full-import regression confirms bcrypt comparison against the
source fixture, no cleartext in target/artifact/coverage, artifact and coverage
readback, and preserved disabled state. Node 22.6.0 validation passed:
`npm run test:migration-data` (121/121), `npm --prefix workers/api run test:lifecycle-schema`
(15/15), Worker typecheck, syntax checks, and `git diff --check`. No source
credentials, remote D1, Worker deployment, production route, or domain/DNS
setting was changed.

## MFA-protected reference-master pricing readback (2026-09-26 JST)

Extended the staging TOTP smoke with a read-only pricing mode. It provisions a
synthetic Better Auth administrator, verifies TOTP/session rotation, and reads
`/api/admin/reference-masters/pricing` under same-session MFA. The returned
release version, generation, all four tier DTOs, and all 16 extension-price
DTOs matched the active Master D1 rows by digest. Anonymous access returned
401; the public price API returned the same release with no Stripe fields.
Read-before/read-after confirmed the active release pointer was unchanged, and
the synthetic Auth identity was removed with all user-owned Auth tables back
at zero. No price master was edited and no Stripe request was made.

Reproduce from `workers/api` with
`node test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --reference-master-pricing-readback`.

Node 22.6.0 validation passed: public price client 7/7, admin price client
6/6, Worker reference-master D1 6/6, signed reference-master service 5/5,
Worker typecheck, and syntax/diff checks. The server-side Stripe extension
checkout remains disabled pending its selectors and secrets.

## Admin user directory email search on staging (2026-09-26 JST)

Replaced `LIKE`-pattern email and profile matching with literal, lowercased
`instr` substring matching after the deployed D1 search returned
`LIKE or GLOB pattern too complex` for an ordinary synthetic email. Added a
regression test for literal wildcard characters and a 180-character search.
The focused split-D1 suite passes 4/4; Worker typecheck and staging Wrangler
dry-run pass.

Deployed version `a684314f-2b65-4358-87f2-be97a272850e` to the isolated
workers.dev staging app. The live MFA/TOTP canary verified profile and email
search, the cross-D1 user detail DTO, 401 for anonymous list/detail, and
no-store responses. It removed its synthetic administrator, target Auth user,
profile, and audit rows. Independent remote D1 readback found zero rows in
Auth `user`, `account`, `session`, `verification`, `twoFactor`, `adminRole`,
and `mfaAssurance`, and zero business `user_settings`, `fanmark_licenses`,
and `audit_logs`; the monotonic `mfaGeneration` value remains 1. HTTP probes
returned 200 for `/`, 200 for `/api/auth/ok`, and 401 for anonymous
`/api/admin/session` and `/api/admin/users`.

At that checkpoint, no real user data, production route, email, Stripe request,
or domain/DNS state was accessed or changed. Admin mutations were disabled;
the following staging checkpoint records the plan update that was added later.

## MFA-protected admin plan update on staging (2026-09-26 JST)

Added `POST /api/admin/users/:userId/plan` and connected the admin dialog to
the same-origin Worker client when staging selects D1. The operation checks
both the Auth identity and business profile, then batches the profile plan
change, admin audit insert, and Enterprise override upsert/removal in one D1
transaction. The target D1 table's required `id`, `created_at`, and
`created_by` columns are populated from its default and the authenticated
admin. Invalid negative/non-integer overrides are rejected. The API supports
the `max` option already present in the UI. Audit failure rolls back the plan
and Enterprise setting together.

The D1 suite passes 6/6, Worker/frontend typechecks pass, the same-origin API
client suite passes 4/4, the Cloudflare staging build and Wrangler dry-run pass.
Version `9db2a730-a8e2-49ad-b980-4441368c681e` is active at 100% on
workers.dev. A live TOTP canary changed one synthetic user Free→Enterprise,
read back the exact custom limit, JPY price, notes, and admin actor; changed
the same identity to Max (removing the Enterprise row); and restored Free.
Anonymous plan mutation returned 401. Independent remote D1 readback found
zero profiles, Enterprise settings, audits, licenses, Auth users, accounts,
sessions, factors, roles, and assurances. The monotonic `mfaGeneration`
singleton remains 1.

No email, Stripe request, real user data, production route, or domain/DNS
state was accessed or changed. Suspension, reset-link, and immediate-expiry
operations remain disabled pending their D1/Auth implementations.

## Admin user suspension and restoration on staging (2026-09-27 JST)

Added Auth D1 migration `0008_auth_user_suspension.sql` with Better Auth
compatible suspension fields, a status-audit table, and a session-insert guard.
The Worker activates its suspension hook only when
`AUTH_USER_STATUS_BACKEND=d1`; the status API also fails closed unless that
selector is explicit. The MFA-protected admin route can suspend or restore an
account, revoke its active sessions, validate reason/expiry bounds, and record
the actor and target in the same D1 batch. The admin user screen now uses this
route in Worker mode; password reset and immediate license expiry remain
disabled.

Before applying the schema, a remote read-only preflight confirmed all seven
existing user-owned Auth tables were empty. Only migration `0008` was pending.
It applied to `fanmark-auth-staging` (D1
`2116bc43-32ab-4e3e-b762-9378df88b95f`); remote readback confirmed the three
user columns, the status-audit table, the session trigger, and no pending
migrations. The Workers.dev app was deployed at 100% as version
`2758095a-99fd-4aaf-a1bf-afc441276f05`. The live canary completed synthetic
sign-in, TOTP enrollment, same-session MFA authorization, suspension,
session revocation, status readback, restoration, and audit verification.
Cleanup deleted the synthetic identity and audit rows; independent post-run
readback found all eight user-owned Auth tables empty. The monotonic MFA
generation counter was preserved and may have advanced during factor setup.

Worker `npm test` passed in full, including 18 Auth D1 tests and nine admin
user-management D1 tests. Worker and app typechecks, the five frontend API
contract tests, targeted ESLint, CI workflow isolation, staging SPA build,
Wrangler dry-run, and `git diff --check` passed. Workers.dev `/` and
`/api/auth/ok` returned 200. No Supabase rows, production resources, or
domain/DNS settings were changed. This verifies one synthetic staging flow;
password-reset delivery, immediate expiry, populated-user behavior, the 18
schema gates, integrated rehearsal, production acceptance, user-data import,
and final DNS cutover remain open.

## MFA-protected immediate admin license expiry on staging (2026-09-27 JST)

Added `POST /api/admin/users/:userId/licenses/:licenseId/expire` and connected
the Worker-mode admin user screen. The route requires the same-session admin
MFA assurance, checks that the license belongs to the path user, bounds the
reason, and treats an already-expired license as an idempotent success. One
business D1 batch conditionally changes the license to expired, removes its
basic/redirect/messageboard/password configs, inserts target and admin audit
rows, and queues one `license_expired.v1` event. A failed batch rolls back the
entire operation; production/default routing remains on Supabase.

Worker regression tests cover ownership, anonymous denial, the status and
config changes, both audit rows, notification schema/payload, retry behavior,
and rollback on forced config delete failure. The full Worker suite, root and
Worker typechecks, frontend API client tests, CI isolation check, targeted
lint, staging SPA build, Wrangler dry-run, and `git diff --check` passed.

Deployed workers.dev version `b436c2bc-7f90-40cf-9e89-b116920b405a` is at
100%. The live MFA/TOTP canary suspended and restored a synthetic account,
verified active-session revocation, expired one synthetic active license,
verified four config deletions, both audit rows, one notification event, and
safe repeat behavior, then removed its synthetic rows. Independent readback
found zero user-owned Auth rows, profiles, licenses, favorites, notifications,
user events, expiry audits, and the four config types. Forty-three
license-incarnation tombstones remain as anti-reuse state. No real user data,
production route, email, Stripe transaction, or domain/DNS setting changed.
Password-reset delivery, remaining app/API inventory, integrated rehearsal,
the 18 schema gates, production acceptance, real data import, and domain/DNS
cutover remain open.

## MFA-protected admin password-reset route (2026-09-27 JST)

Commit `094dcdf` adds `POST /api/admin/users/:userId/password-reset` to the
Worker-mode user manager. The route requires the existing same-origin admin
role and same-session MFA checks, resolves the email from Auth D1, and delegates
reset-token creation to Better Auth. The token stays inside Better Auth; the
browser receives only the target ID and request timestamp. A business audit
row records the attempt before calling Resend. The route fails closed with 503
when Resend is not configured and returns 502 if the provider callback fails.
The admin UI now describes the Worker action as email delivery and corrects
its earlier stale read-only banner; the Supabase link-generation flow remains
unchanged.

Synthetic Worker tests cover no-provider 503, MFA denial, mismatched target,
the same-origin header, successful response/audit redaction, and retained
attempt audit after provider failure. A separate Better Auth D1 test stubs the
Resend HTTP call and verifies same-origin reset links without returning the
email or token. The full Worker `npm test` command passes; after the final
query-format adjustment the focused admin D1 suite passes 12/12 and Worker
typecheck passes. Frontend admin API tests pass 7/7; root typecheck, targeted
ESLint, Cloudflare staging build, Wrangler dry-run, and `git diff --check` pass.

Deployed to `fanmark-app-staging` as version
`a4b4886f-9289-435d-b345-843a7b2747a7` at 100% on workers.dev. Read-only live
probes returned 200 for `/` and `/api/auth/ok`; an anonymous synthetic reset
request returned 401/no-store before the handler could read a target or send
email. The staging secret-name list contains no `RESEND_API_KEY` or
`RESEND_FROM_EMAIL`, so no email was attempted and authenticated delivery
acceptance remains gated. No source user rows, production route, Stripe request,
or domain/DNS state changed. PR #41 was updated; `Supabase Preview` remains
skipped by the repository's CI isolation setup.

## Inactive-license credential coverage (2026-09-27 JST)

The source-shaped D1 importer now records credentials for inactive or returned
licenses as `deferred_inactive` using a terminal metadata-only artifact and a
coverage row. It does not hash or persist the source credential in D1 and does
not create a destination password row. Coverage and checkpoint advancement
commit together only while the bound license incarnation/generations remain
inactive and no destination row exists. Replay/readback and final
reconciliation require the exact deferred reason and retain
`fullMigrationReconciled=false`.

The local credential schema/import integration suite passes 11/11, including
an ACK-unknown commit followed by restart, typed readback, and explicit
source/target/deferred row counts. No live source rows, remote D1, production
route, or domain/DNS setting was accessed or changed.

## Integrated synthetic registration rehearsal (2026-09-27 JST)

The registration smoke's initial read-only preflight stopped on the existing
16-row `email_templates` master baseline. The guard now excludes that table
only when all 16 allowed auth templates match the pinned source-content SHA-256;
it rejects extra, missing, duplicate, malformed, or changed rows. The smoke
checks the same digest before and after the canary, so it cannot silently
ignore arbitrary rows by table name. The focused baseline tests pass 3/3.

Ran `npm run test:staging-fanmark-registration-smoke` with Node 22.6.0 against
the isolated workers.dev app and its split staging D1/R2 resources. A synthetic
Better Auth identity completed registration, owner-session checks, R2 cover
upload/public read/owner delete, profile save, lottery apply/cancel, anonymous
and owner details, and expected rejection paths for oversized, duplicate, and
unauthenticated requests. Cross-owner and wrong-bucket image paths were also
rejected. The 16-row email-template baseline matched the exact digest both
before and after the run.

Cleanup read back zero rows across ordinary business tables, zero synthetic
Auth users/accounts/sessions, and an absent R2 canary object. The run sent no
email, made no Stripe call, and touched no Supabase source rows, production
route, or domain/DNS setting. Targeted Node tests (3/3), ESLint, and
`git diff --check` passed. This closes one integrated staging path, not all of
#37: billing sandbox, broader source-event coverage, production acceptance,
the 18 schema gates, user-data migration, and domain cutover remain open.

## Plan and general system settings on staging (2026-09-27 JST)

Added a same-origin Worker adapter for plan selection, plan administration, and
invitation-mode settings. The public route returns a fixed 17-key projection;
the admin route returns the two private Enterprise values only after
Better Auth administrator and same-session MFA authorization. Admin edits use
validated values, a stale-value guard, an atomic D1 update/audit batch, and
readback. The audit contains the setting key but no previous or new value.
Worker failures do not fall back to Supabase, and production/default builds
remain on the Supabase selector.

Exported only the exact 18-key non-user plan/pricing/feature allowlist from
Supabase, stored the source artifact outside the repository with mode 600, and
applied it to staging business D1. The exact D1 readback matched the pinned
source digest
`d1f809c44dcc26152acb3432907e1cad81a599d495fd9f3e48b75ea1e3beb16f`. With the
separate `grace_period_days` and `max_emoji_characters` rows, staging has the
expected 20-row settings manifest. No user or Auth data was included. The
staging script was made idempotent for a previously applied, exact digest so a
retry verifies instead of inserting again.

The SPA/Worker deployment is active at 100% on the isolated workers.dev app as
version `3310b139-f639-4cf2-8a15-ad2b63f9fbd6`. Live checks returned 200 for the
SPA and public settings API, 200/no-store with exactly the expected 17 public
keys, and 401/no-store for anonymous admin settings access. Public setting
values were not printed. Migration-data tests passed 124/124, Worker settings
tests 5/5, client contract tests 4/4, both typechecks, staging build, and
Wrangler dry-run passed. A synthetic Better Auth administrator then completed
TOTP/MFA authorization, read the 19-key admin projection, updated
`free_fanmarks_limit`, read the change back, rejected a stale update, restored
the original value, and verified that both audit rows contain only the setting
key. Cleanup removed the synthetic audit and Auth rows. This exercised the API
directly, not the UI in a browser. Stripe sandbox acceptance, broader
integrated #37 coverage, production, user-data import, and domain/DNS remain
open. Post-canary Auth readback found zero user-owned rows; the monotonic
`mfaGeneration` singleton reads 60 and remains retained by design. See
`system-settings-api.md`.

## Authenticated subscription display through D1 on staging (2026-09-27 JST)

Added read-only `GET /api/me/subscription`. It derives the owner ID from the
Better Auth session and reads only that user's latest `user_subscriptions`
projection from business D1. The DTO excludes Stripe customer/subscription
IDs. The Cloudflare staging build selects the Worker path for the subscription
hook; it no longer calls Supabase `check-subscription`, reads the Supabase
table, or opens a Supabase Realtime subscription in that mode. It refreshes on
focus/visibility and explicit refetch. Stripe state is not fetched or mutated
by this endpoint; the Worker billing projection remains gated on sandbox
acceptance. Default and production builds retain the existing Supabase path.

Client and Worker API contract suites pass 4/4 and 3/3, respectively. Root and
Worker TypeScript checks, focused ESLint, CI workflow-isolation check, staging
SPA build, and Wrangler 4.139 dry-run passed. The new staging deployment is
Worker version `7da3ee3b-62af-45ca-8c92-be5a5d14b2b5` at 100%. The SPA returned
200; an anonymous request to the new endpoint returned 401/no-store with the
allowed staging origin. No subscription row, user/Auth data, Stripe object,
production route, or domain/DNS setting was written or changed. This validates
the anonymous boundary and synthetic API contracts, not an authenticated
browser view or a Stripe sandbox flow.

### Authenticated projection recheck (2026-09-28 JST)

The new `scripts/migration/staging-subscription-display-smoke.mjs` exercised
the deployed endpoint with a synthetic Better Auth user, an owner subscription,
and a decoy subscription under another synthetic user ID. The endpoint first
returned an empty result, then returned only the signed-in owner's projection
without Stripe IDs. A second authenticated GET reflected a D1 period/amount
update, and the `no-store` header remained present. Cleanup independently read
back zero synthetic Auth and subscription rows. This is live API evidence, not
a browser proof of the 30-second foreground poll; no Stripe API, real user,
production, or DNS/domain state was involved.

## Profile username availability on D1 staging (2026-09-27 JST)

Added `GET /api/me/username-availability?username=...`. The Worker requires a
Better Auth session, derives the excluded owner ID from that session, and reads
only an availability boolean from business D1. Duplicate or unknown query
parameters, oversized input, unsupported methods, unauthenticated callers, and
untrusted origins fail closed. The client selects this route under the existing
`VITE_PROFILE_BACKEND=worker` selector and does not fall back to Supabase.
Production/default selectors remain Supabase; this endpoint does not reserve a
username or write user data.

The local Worker integration test verified self-exclusion, another synthetic
user's taken name, case-insensitive candidate input, empty-name behavior,
authentication, backend selection, and request validation. Frontend contract
tests verified cookie credentials, same-origin checks, strict response shape,
and no retries after errors. Both dedicated suites pass (Worker profile D1
8/8, frontend 6/6), the full configured Worker test command passes, both
TypeScript checks pass, focused ESLint and CI workflow isolation pass, and the
Cloudflare staging SPA build and Wrangler dry-run pass. All three remote staging
D1 databases report no pending migrations.

Staging version `6572c37d-3d8c-4bf1-89a6-6a131dc4bb09` is active at 100% on
`https://fanmark-app-staging.fanmark-id.workers.dev`. Live checks returned 200
for the SPA and Better Auth health endpoint, 401/no-store for an anonymous
username lookup, and 400 for a caller-supplied `userId`. The profile/R2 smoke
then used one disposable synthetic account: its existing username and a new
candidate both returned available, while the anonymous route returned 401.
The smoke uploaded/read/deleted one synthetic object in each R2 bucket and
verified profile/Auth row counts returned to zero and both object URLs to 404.
Its preflight was updated to validate the exact pinned 16-row auth-email-master
digest before excluding that approved non-user baseline from the empty-business
check. The earlier preflight stopped before writes when it incorrectly counted
those master rows as user data. No real user/Auth rows, production routes,
Stripe objects, or custom-domain/DNS settings changed. See
`own-profile-api.md`.

## MFA-authorized manual notification event on staging (2026-09-27 JST)

Extended the explicit staging TOTP smoke with an opt-in
`--notification-manual-event` action. Before writing, it requires empty
notification event, delivery, and profile tables, plus the pinned staging
Auth/business D1 targets, notification processor selector, and one-minute Cron.
The anonymous manual-event POST returned 401 and created no row. A synthetic
Better Auth administrator then completed TOTP and same-session MFA
authorization; its manual `favorite_fanmark_available` POST returned 201 and
the event log omitted payload contents.

The workers.dev Cron processed the event and created exactly one delivered
Japanese in-app notification for the synthetic recipient. The smoke deleted
the notification before the event, then removed the synthetic profile and
Auth identities; readback confirmed event, notification, profile, and all
user-owned Auth tables were empty. The retained MFA generation counter was
preserved. The run used
`node workers/api/test/staging-admin-totp-smoke.mjs --run-live-staging-write --database=fanmark-auth-staging --notification-manual-event`.
The focused notification-master D1 suite passes 6/6 and the smoke script
passes `node --check`. No real user data, production resource, or domain/DNS
setting was touched.

## Persisted encrypted snapshot restore across processes (2026-09-27 JST)

Added a synthetic migration-data regression that writes a valid encrypted
snapshot bundle to a private on-disk directory, then starts a separate Node
22.6 process with the test-only key supplied through its environment. The fresh
process authenticates the ciphertext, verifies the snapshot manifest and row
hashes, reads back the synthetic row marker, and deletes the plaintext restore
directory before exiting. The parent verifies that the bundle still contains
only `bundle.header.json` and `snapshot.aesgcm` and that the restored directory
is gone. This proves local process-boundary recovery from persisted files; it
does not prove external backup storage, independent key custody, destination
ACLs, retention/deletion, or production restoration.

`node --test scripts/migration/test-snapshot-encryption.mjs` passes 4/4. The
full `npm run test:migration-data` suite passes 125/125 with no skips. No live
Supabase rows, remote D1, R2 objects, production resource, or domain/DNS state
was read or changed.

## Private R2 destination round-trip for synthetic encrypted backup (2026-09-27 JST)

Created the dedicated `fanmark-migration-backups-staging` R2 bucket in APAC
with Standard storage class. Wrangler identity matched the migration account;
the bucket was absent before creation. Readback confirms `r2.dev` public access
is disabled, no custom domain is attached, the bucket is not bound to the app
Worker, and object count/size returned to zero after the canary.

Added the opt-in
`scripts/migration/test-snapshot-r2-staging.mjs` round-trip. It refuses remote
writes without the exact bucket and explicit staging flags, verifies account,
bucket location/emptiness/privacy, builds a one-row synthetic snapshot, and
uploads only the encrypted header and ciphertext. It downloads both objects,
compares SHA-256, authenticates and verifies the restored snapshot, checks the
synthetic row marker, removes the plaintext restore tree, deletes each R2
object, and confirms missing-object reads plus a zero-byte bucket. The successful
run reported two encrypted objects uploaded/read back and deleted, with one
synthetic source row restored. No real source data was read or copied.

This closes a synthetic staging destination round-trip only. Independent key
custody, least-privilege destination credentials, retention/deletion policy,
production backup destination, and real-user/Auth/Storage backup remain open.
The R2 bucket is intentionally left empty and unbound. No Worker deployment,
production resource, or domain/DNS setting changed.

## Authenticated reference-master editor staging canaries (2026-09-27 JST)

Added explicit opt-in actions to the existing staging MFA smoke. Each refuses
to run without the exact staging Auth D1 name and live-write flag, requires all
Auth-owned tables to start empty, verifies zero business fanmarks/licenses,
and checks the active 29-row reference release and Tier C perpetual baseline.
The canary uses the deployed Worker API with a synthetic TOTP administrator;
it does not write directly to Master D1.

The Tier C canary rejected anonymous writes with 401, changed only Tier C from
null to one day, read back all four reference masters (4 tiers, 4 languages,
5 reserved patterns, 16 extension prices), rejected a stale-release write
with 409 without advancing the pointer, then restored Tier C to null through
the MFA-gated editor API. Canonical reference-master values matched after
restoration, apart from the expected release and edited-row updated_at changes.
A separate extension-price canary changed the active tier-1 one-month
price from ¥500 to ¥501, rejected anonymous and stale-version writes, then
restored ¥500. The public extension-price read returned the restored value
under the current release; canonical comparison confirmed all other
master values and both Stripe IDs were unchanged. The editor used
compare-and-set and wrote append-only activation history. The active release
is generation 8 with Tier C null and the extension price restored. The MFA
generation singleton remains monotonic.

The first run found a test-harness cleanup omission for the synthetic target
user/profile. Those exact example.invalid rows were deleted and read back at
zero, the cleanup condition was corrected, and the repeated Tier run plus the
extension-price run completed with zero Auth users, accounts, sessions,
verifications, factors, admin roles, assurances, status-audit rows, business
profiles, fanmarks, and licenses.

The Worker reference-master API suite passed 6/6, reference-master service
suite 5/5, frontend admin client suite 6/6, Node 22.6 syntax validation, and
git diff whitespace validation. The two live action flags were
--reference-master-tier-roundtrip and
--reference-master-extension-price-roundtrip. No Supabase data, production resource, Stripe
resource, real user-owned row, or domain/DNS setting was changed. The browser
click path, Stripe checkout, and production selectors remain unverified.

## Auth email-template edit/restore staging canary (2026-09-27 JST)

Added the standalone `--auth-email-template-edit-roundtrip` action to the live
MFA smoke. Against the deployed staging Worker it read all 16 allowlisted
templates, rejected an anonymous PATCH (401), changed the Japanese signup
subject through the admin API, rejected a stale `updated_at` PATCH (409), then
restored the original subject, body, and button label. Final D1 readback
confirmed all 16 contents and non-editable fields matched baseline; the
Japanese signup row's `updated_at` advanced as expected. Both synthetic audit
rows and the temporary Auth identity/profile were removed and verified absent.
The staging secret-name list has no Resend key or sender identity, and the
admin template API does not call mail delivery; no email was sent.

The first live attempt exposed a test-harness omission in the shared target
cleanup condition. The exact synthetic target rows were manually removed and
read back at zero, then the harness was fixed and the full live canary passed.
The Worker D1 API tests passed 4/4; the frontend API client tests passed 3/3;
Node syntax and `git diff --check` passed. No user data, production route,
Stripe state, or domain/DNS configuration changed.

## Public waitlist signup on staging (2026-09-27 JST)

The staging SPA now explicitly selects the Worker `POST /api/waitlist` route.
New and duplicate addresses return the same 202 acceptance payload; the route
validates/normalizes the address and writes only split business D1. Staging has
a 120-request/60-second Cloudflare Rate Limiting binding. The production/default
selector remains Supabase.

The live synthetic canary used a randomized `example.invalid` address and
marker. It verified the allowed-origin preflight, rejected an untrusted origin,
accepted the first and duplicate submissions with identical payloads, read
back the normalized `waiting` row, deleted that exact row, and confirmed the
staging waitlist returned to zero. The app root returned 200/noindex and the
deployed JavaScript SHA-256 matched local `dist-staging`. Worker and app CI run
`36272821613` passed. Full Worker tests, typechecks, staging and standard app
builds, migration-data tests, and targeted lint passed locally as well. No
email was sent, real waitlist data was imported, or production/DNS setting was
changed. The live proof and selector contract are recorded in
[`waitlist-signup-api.md`](waitlist-signup-api.md).

## Staging expiry/lottery Cron baseline and cleanup correction (2026-09-27 JST)

The one-shot deployed Cron canary now accepts the 16-row localized
`email_templates` master baseline. An earlier preflight stopped before seeding
because the live digest included `updated_at`, which had advanced during a
successful MFA edit/restore. The check now pins template identity/content while
ignoring only that mutable timestamp; the full snapshot and seed digest still
include every field. A regression test verifies timestamp tolerance and rejects
a changed body.

The next scheduled run finalized one synthetic expiry/grace/lottery path and
emitted the two expected in-app notifications. The first cleanup check found
those two derived rows after source events and test users were removed. Exact
synthetic IDs and a zero-row preflight isolated them; only those two rows were
deleted and global notification count returned to zero. The harness now cleans
them before deleting their source events. A full rerun completed with
`winner_finalized`; the grace-period setting was restored, synthetic business
rows, notifications, events, lifecycle journals, and user-owned Auth rows all
read back at zero, and the 45 pre-existing incarnation tombstones were
unchanged. The temporary schedule and expiry selector were restored to the
disabled lifecycle baseline. The restored Worker is
`243e68a0-df6a-4e7c-b290-1ec20bdd2005` at 100%. No email, Stripe action,
production route, real user data, or DNS setting was touched. This proves only
one synthetic staging scheduled execution; recurring lifecycle activation and
production acceptance remain open.

## Plan-route browser review and auth-gate follow-up (2026-09-27 JST)

The deployed workers.dev home and `/auth` pages rendered in a real browser. A
direct `/plans` visit displayed the generic `errorNoProfile` screen, but the
embedded browser's auth state was not independently isolated, so this does not
prove anonymous behavior. Both `/plans` and the `/plan` alias now use
`ProtectedRoute`, and the route contract is recorded in `docs/ARCHITECTURE.md`.
Node 22.6.0 frontend typecheck, staging build, targeted ESLint, and Wrangler
dry-run passed. A local preview in the same browser profile still displayed
the generic page; the route behavior therefore remains unverified. The route
change is local only: Wrangler could not read macOS Keychain (exit 51), and the
OAuth consent page opened in Chrome under a different Cloudflare account than
the intended staging account. No consent was submitted and no deployment
occurred. Re-deploy and repeat the route check with a fresh unauthenticated
browser profile after the intended Cloudflare account is active in Chrome.
Production, user data, Stripe, and domain/DNS were untouched.

## Verified-unused extension coupon master seed (2026-09-27 JST)

A fresh repeatable-read, read-only Supabase projection selected only coupon
definition fields for rows with `used_count = 0` and no matching usage row. It
returned four definitions with zero source usage rows. A separate aggregate
reported eight definitions total, four consumed definitions, 20 usage rows,
and two definition/use-count mismatches. The consumed records and all usage
history remain outside this staging operation for later user-data reconciliation.

The guarded seed imported only the four verified-unused definitions to
`fanmark-business-staging`, omitted `created_by` and stored it as NULL, then
verified exact D1 readback against source digest
`6472e758c2896f8f83bf5a48da5a3c038b24651e5278866b177231412dda3d79` and zero
staging usage rows. The first Wrangler file execution included progress text
before its JSON result; a read-only check proved the four-row seed had
completed, the result parser was corrected, and a second apply invocation
verified the existing baseline without another write. The private export and
SQL stayed mode 0600 outside Git; no coupon code values were logged.

Staging empty-baseline checks now require this exact coupon digest and zero
usage rows before excluding the four master rows. The migration-data suite
passed 153/153 with Node 22.6.0 and serial test execution; the targeted
coupon/baseline tests passed 7/7, syntax checks and `git diff --check` passed.
No coupon history, license, user, production route, or domain/DNS state was
changed. This seeds only unused master definitions; it does not claim coupon
parity or complete the deferred user-data phase.

## Staging baseline and profile canary follow-up (2026-09-27 JST)

The email-template baseline now verifies both the 16 auth templates and 12
broadcast templates from one read-only D1 query, checking each pinned content
digest and total table count. Live staging readback returned `seeded` with
16 + 12 = 28 rows. The related baseline/coupon unit tests passed 8/8, and the
complete migration-data suite passed 154/154 with Node 22.6.0 using serial
execution.

The staging notification processor, registration/lottery, owner-settings and
password, and R2 profile/storage canaries passed. The R2 run verified anonymous
upload rejection, owner upload and deletion, public object reads, avatar and
cover-image paths, then confirmed Auth/business synthetic rows were zero and
both objects returned 404. The analytics canary suppressed four concurrent
duplicate events, rejected anonymous reads, returned owner-only aggregates,
and cleaned all synthetic rows. The license-return canaries verified transfer
blocking, grace transition, owner/favorite notifications, full transfer
approval, partial bulk return (207), and complete bulk return (200). The bulk
canary removed transient rows and restored access/MFA state; two synthetic
license-incarnation tombstones remain intentionally as security history. The
transfer and single-return notification canaries delivered localized Japanese
notifications. No email was sent, and no production routing, real-user data,
or domain/DNS state changed. Remaining schema gates, integrated rehearsal,
mail delivery, production acceptance, user-data migration, and domain cutover
are still open.

## Authenticated admin user-management browser read canary (2026-09-27 JST)

On staging Worker version `8619222a-dba4-44b4-b085-685c69455c4f`, an isolated
synthetic Better Auth administrator completed the same-session TOTP/MFA flow,
opened `/admin` → user management, and read a synthetic target's directory row
and detail drawer. The browser rendered the target's Free plan, active status,
registration time, and zero license counts. No plan, suspension, or password
reset action was invoked; the reset screen explains that a staging Resend
configuration is required. This verifies the authenticated browser read path
end to end, not broad admin acceptance.

After the browser check, exact synthetic rows were removed from the split
staging databases. Before cleanup, Auth D1 held two synthetic users, one
credential account, two sessions, one TOTP factor, one admin role, and two MFA
assurance rows; the verification and suspension-audit tables had no matching
rows. Business D1 held two synthetic profiles and two audit rows, with no
Enterprise override. Final readback showed zero rows across the Auth user,
account, session, verification, two-factor, admin-role, MFA-assurance, and
suspension-audit tables, and zero matching business profile, Enterprise, and
audit rows. The monotonic `mfaGeneration` marker was retained and may have
advanced when the test factor was removed. Temporary synthetic credentials and
scripts were deleted. No real user data, production route, email, Stripe action,
or domain/DNS setting was used or changed.

## Cloudflare staging frontend selector audit (2026-09-27 JST)

Strengthened `scripts/migration/test-staging-selector-coverage.mjs` to verify
all 43 typed frontend backend selectors are explicitly assigned by the
Cloudflare staging build, referenced by frontend implementation code, and do
not select Supabase. The only non-Worker modes are the disabled destructive
data-reset screen, the D1-native reference-master editor, and the R2-native
Storage client. The two selector tests, CI workflow-isolation check, frontend
typecheck, and Cloudflare staging build passed under Node 22.6.0. The build
completed locally; this guard change was not deployed and does not replace
runtime UI acceptance or resolve the remaining migration gates.

## Manual lifecycle batch route (2026-09-27 JST)

The staging admin expiration button now selects a same-origin Cloudflare API
instead of calling Supabase when `VITE_LIFECYCLE_RUN_BACKEND=worker`. The new
`POST /api/admin/license-expiry/run` requires Better Auth administrator access
with the existing same-session MFA assurance, accepts no body or query, uses
the business D1 binding, and returns bounded aggregate counters without run,
license, or user identifiers. It invokes the same D1 lifecycle engine as the
scheduled job under a request-local `LICENSE_EXPIRY_BACKEND=d1` override; the
manual server selector `LIFECYCLE_RUN_BACKEND=d1` is separate from and does not
enable the Cron selector. Staging's frontend selects Worker, but the currently
deployed server selector remains unset, so requests still fail closed with 503
and never fall back to Supabase. The staging config now enables the manual
route with the exact D1 target/schema profile and a four-page cap while leaving
`LICENSE_EXPIRY_BACKEND` unset. The ordinary frontend build still calls the
existing Supabase function.

Client contract tests pass 4/4 and Worker handler tests pass 5/5, including MFA
denial, origin/method/body checks, zero-byte request-stream handling,
unset-selector behavior, split-D1 selection, identifier stripping, sanitized
failures, and continuation status. Frontend and Worker typechecks, focused
ESLint, all 160 migration-data tests, the full Worker test command, CI
workflow-isolation check, and staging build pass. The
staging Worker was deployed as version
`28e7ca3c-f610-47a4-aea9-f876bd8c3f11` while leaving both lifecycle selectors
unset. Wrangler's secret-name readback also showed no manual lifecycle
selector. The served JavaScript asset is byte-for-byte identical to local
`dist-staging` (2,493,527 bytes, SHA-256
`13582571ce98753679585bef629f57ec03d96534d3095f2ec3d60de70ed97778`). Root
returned 200/noindex and a cookie-less POST to the new route returned 401
`unauthenticated`; no authenticated request or lifecycle execution was sent.
The new staging selector guard (3/3), license-expiry integration/source suite
(25/25), scheduled lifecycle suite (8/8), lifecycle schema suite (16/16),
Worker typecheck, and Wrangler staging dry-run pass. The first local
source-suite attempt exposed a test call that accidentally reused the
target-profile import options while asserting the generic credential guard;
the test now explicitly exercises the generic path.

Staging deployment `4988d9d0-b4ec-44d1-9ccc-00ac501aac36` enables only the
MFA-protected manual lifecycle route. The scheduled `LICENSE_EXPIRY_BACKEND`
selector remains absent while both Cron schedules stay configured. The first
live call exposed that the edge runtime can represent an empty POST as a
zero-byte stream; the handler now reads only until EOF or the first byte with
a one-second bound. Its synthetic authenticated canary then returned HTTP 200
with zero candidates in both phases and aggregate-only results. Exact target,
digest, status, and counters were read back from both run journals before
cleanup. Post-cleanup D1 reads found zero profiles, fanmarks, licenses,
lifecycle journals/items/guards, and user-owned Auth rows (`changed_db=false`,
`rows_written=0`). No user data, email, Stripe call, production route, or
domain/DNS setting was changed. The first 400 response performed no lifecycle
writes.

## Fresh schema refresh and descriptor-aware synthetic rehearsal (2026-09-27 JST)

Re-ran `scripts/migration/schema-readiness.sql` through the linked Supabase
CLI at `2026-09-27T09:40:27Z`. The query returned schema metadata only; no
application rows were read. The CLI wraps the catalog under
`rows[0].jsonb_build_object`, so the private result was unwrapped before
running the converter with the value-free credential descriptor. The current
catalog still contains 40 tables, 406 columns, 144 constraints, and 139
indexes. Conversion remains `deployable=false` with 18 blocking groups: 10
row-conversion groups (227 locations) and 8 schema/operation groups (101
locations).

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs`
passed against the refreshed catalog. It imported four generated synthetic
rows, completed checkpoints for all 40 tables, reconciled public rows, and
rejected a conflicting replay. The output correctly keeps `deployable` and
`fullMigrationReconciled` false while schema gates remain. Catalog, descriptor,
generated DDL, and conversion report were stored as mode-0600 `/tmp` artifacts
and are not part of the repository. No Cloudflare D1, source rows, user data,
production route, or domain/DNS state was changed.

## Stripe migration contract validation in CI (2026-09-27 JST)

The isolated `experiments/stripe-receipts` suite passed 90/90 under Node
22.6.0, including PGlite execution of the PostgreSQL receipt, invoice, and
extension transactions; its TypeScript contract check also passed. Two stale
assertions were corrected: a bigint beyond JavaScript's safe integer range is
expected to remain exact decimal text through import, and the transfer-lock
fixture now uses a future timestamp instead of depending on the current date.
These changes do not relax the application-facing bigint gate.

The Cloudflare migration validation workflow now installs this isolated test
package and runs its tests and typecheck. The workflow-isolation check passed
locally. The existing Supabase Webhook still applies subscription and invoice
events outside the full durable reconciliation path; this validation does not
complete issue #32, deploy or apply any Supabase migration, or call Stripe.

The GitHub run `36311114955` completed the Worker job, but its Stripe test step
remained in progress for more than 13 minutes. Running the same 90-test suite
with Node's default file parallelism had completed locally, while an explicit
`--test-concurrency=1` run completed 90/90 in about 16 seconds. The package test
script now serializes test files to reduce resource contention on hosted
runners without skipping coverage. Follow-up GitHub Actions run
`36311897378` passed both `Validate Cloudflare Worker API` and
`Validate Cloudflare staging application` jobs.

## Admin user-management synthetic staging acceptance (2026-09-27 JST)

With Wrangler authenticated to account `bfc2890741f0b3fb236e2d755b6c9adc`,
ran from `workers/api` under Node 22.6.0:

```sh
nodenv exec node test/staging-admin-totp-smoke.mjs \
  --run-live-staging-write \
  --database=fanmark-auth-staging \
  --admin-user-management-readback \
  --admin-user-plan-readback \
  --admin-user-status-readback
```

The script verified the staging target and empty Auth user-owned tables, then
created one synthetic MFA administrator and one synthetic target. The deployed
Worker passed same-session TOTP authorization, cross-D1 list/detail reads,
anonymous denial, Enterprise → Max → Free plan changes with exact override
readback, suspension/restoration with session revocation, and immediate license
expiry with configuration removal, lifecycle/admin audit, notification enqueue,
and repeat safety. Cleanup removed both synthetic identities, sessions,
profiles, license/config rows, notification, and canary audits; final readback
found all user-owned Auth tables empty and the deleted administrator session
unusable. A separate remote read-only aggregate query then returned zero
profiles, Enterprise overrides, fanmarks, licenses, four license config types,
notifications, and admin-expiry notification events (`changed_db=false`,
`rows_written=0`). The monotonic MFA generation marker was preserved and may
have advanced.

This was staging API acceptance only. No real user row, production route,
Resend/email, Stripe request, or domain/DNS state was touched. Admin browser UI
review, password-reset delivery, broader issue #34 acceptance, and integrated
issue #37 recovery drills remain open.

## Admin authorization D1 read consolidation and CPU sample (2026-09-27 JST)

Commit `4a6dd0a` preserves the admin-role check as the first authorization gate,
then reads `twoFactorEnabled`, up to two verified factor IDs, and the
user/session-bound MFA assurance row in one D1 query. It retains the exact
single-verified-factor, same-session, same-factor, and unexpired-assurance
requirements. A regression test confirms that multiple verified factors remain
denied.

Node 22.6.0 verification passed: the focused Auth D1 suite (20/20), complete
Worker test chain, Worker typecheck, `npm run check:ci`, Cloudflare staging
build, and staging-config Wrangler dry-run. The non-staging Worker dry-run also
passed. GitHub Actions run `36316557175` passed its Worker job; the application
job was still running its isolated Stripe contract step when this entry was
written.

Worker version `1ae4ffb0-5af5-4b19-8759-f79cc201b45a` was deployed to
workers.dev staging at 100%. Anonymous `/api/admin/session` returned 401. The
synthetic TOTP admin canary passed same-session authorization and cross-D1 user
list/detail reads; cleanup removed its Auth, profile, and audit rows, and final
readback found the user-owned Auth tables empty. The monotonic MFA generation
counter was preserved and may have advanced. No D1 schema, production route,
real user data, email, Stripe, or domain/DNS state changed.

Wrangler tail recorded CPU/wall samples of 4/83 ms for an authorized admin
session (200), 50/161 ms for its pre-enrollment gate (403), and 2/2 ms for an
anonymous admin-session request (401). TOTP enable and verification sampled
93 ms and 13 ms CPU on the same version. These narrow staging samples do not
prove recurring or production CPU fit; the Free-plan 10 ms CPU gate remains
open.

## Reverified manual lifecycle route on the current staging Worker (2026-09-27 JST)

Reconciled a stale handoff statement against the current code and deployed
configuration. `LIFECYCLE_RUN_BACKEND=d1` enables only the authenticated manual
route; the route supplies `LICENSE_EXPIRY_BACKEND=d1` to a cloned invocation
environment. The deployed `LICENSE_EXPIRY_BACKEND` selector remains absent, so
the configured daily Cron still exits before opening D1.

Ran the guarded `staging-admin-totp-smoke.mjs` with
`--lifecycle-run-readback` against Worker version
`1ae4ffb0-5af5-4b19-8759-f79cc201b45a`. Synthetic Better Auth sign-in, first
TOTP enrollment, session rotation, same-session MFA, and the manual lifecycle
route passed. It returned aggregate-only zero-candidate results. Both empty
lifecycle journals were read back against the configured target/digest and
removed; the synthetic Auth identity was removed, and user-owned Auth tables
read back empty. The monotonic MFA generation counter was preserved and may
have advanced.

This corrects the earlier handoff claim that the manual server selector was
unset. No Supabase schedule, production route, real user data, email, Stripe,
or domain/DNS state changed.

## Fresh Supabase schema-only query and current-catalog rehearsal (2026-09-27T12:13:53Z)

Ran the reviewed `schema-readiness.sql` through `npx supabase@2.118.0
db query --linked` with `CI=1` and `--yes`; the CLI completed without terminal
input. The transaction reads schema catalogs only. It returned 406 columns,
144 constraints, 139 indexes, 15 enum labels, one view, 58 functions, 36
triggers, and 77 RLS policies. The schema converter emitted the current 40-table
profile and retained 18 blocking groups (`deployable: false`): 10 import-stage
groups and 8 schema/operation groups.

Under Node 22.6.0, `scripts/migration/test-d1-import-current-schema.mjs` passed
against that exact private catalog. It reconciled four generated synthetic rows
through all 40 checkpoints and rejected a conflicting replay. It ran only on a
disposable local Miniflare database; no application rows were read from
Supabase and no remote D1, production, or domain/DNS state changed. The
catalog, descriptor, generated SQL, and report remain private mode-0600 files
outside the repository.

## Business staging D1 schema-only parity readback (2026-09-27 12:22 UTC)

Used Wrangler `d1 export --remote --no-data` for `fanmark-business-staging` and
parsed the private schema export in local SQLite. The schema has 73 tables,
98 indexes, and 34 triggers. All 40 source tables and 406 columns match the
fresh catalog's converted SQLite types and nullability; all 66 generated
source-profile indexes are present. The three extra reviewed columns and 32
additional operational indexes are staging extensions. Local `integrity_check`
returned `ok`, and Wrangler's remote migration list showed no pending business
migrations. No table rows were exported, and no remote D1 schema or data was
changed.


## Stripe receipt test runner isolation (2026-09-27 JST)

GitHub Actions run `36318455207` completed its Worker API job, while the app job
stalled after 88 Stripe receipt subtests in the PGlite row-conversion/snapshot
area and was canceled. Reproducing on Node 22.6 showed a hang when TSX was
globally preloaded for JavaScript-only PGlite suites. Splitting TypeScript and
plain-JavaScript suites passed all 90 tests locally and in an Ubuntu Node 22.6
container, but the next GitHub Actions run (`36320827030`) still remained in
the Stripe test step for more than four minutes. Its Worker job passed in 5m2s;
the run was canceled to avoid another prolonged wait, so the two-batch split is
not considered a CI fix.

The runner now starts each of the nine test files in its own Node process,
preloading TSX only for the four files that import TypeScript. Each process has
a 180-second timeout so a stuck suite fails with its file name. Stripe receipt
typecheck, app typecheck, admin auth URL tests (3/3), and Cloudflare staging
build pass locally. The per-file runner still needs a fresh GitHub Actions run.
No production, Supabase, D1, user-data, or domain/DNS state changed.

## Per-file Stripe test runner CI verification (2026-09-27 13:12 UTC)

Commit 14bebed runs each Stripe receipt test file in a separate Node process.
GitHub Actions run 36321290841 completed successfully: the application job
passed migration data boundaries, Stripe receipt/billing/invoice tests, both
typechecks, admin return URL tests, and the Cloudflare staging build; the Worker
job passed its API/D1 tests, typecheck, and no-deployment bundle validation.
This workflow performed no deployment.

## Combined credential-state current-catalog rehearsal (2026-09-27 JST)

The private schema-only catalog was used to run the 40-table synthetic D1
importer rehearsal with one enabled active credential, one disabled active
credential, and one credential attached to an inactive (`grace`) license.
All 40 checkpoints completed and whole-target reconciliation passed for 10
synthetic source rows: two active credentials were bcrypt-transformed and
read back with their enabled states, while the inactive row was recorded as
`deferred_inactive` with no target credential row. Exact source/target/deferred
counts (3/2/1), access generations, foreign keys, and the event sequence were
checked. An injected acknowledgement loss resumed successfully; a conflicting
coverage digest was rejected. The result remains
`public_rows_reconciled`, `deployable: false`, and
`fullMigrationReconciled: false`. This was local Miniflare only: no Supabase
application rows or remote D1 rows were read or written, and no deployment,
user-data import, or domain/DNS change occurred.

The full root `test:migration-data` suite then passed 160/160 under Node
22.6.0. Its bounded fake-`psql` protocol test now allows 15 seconds for process
startup under parallel test load instead of the previous 5-second ceiling;
the command remains time-bounded and the protocol test passes both alone and
inside the full suite.

GitHub Actions run `36323205817`, attempt 2, passed both required jobs,
including Worker API/D1 tests, migration boundaries, all 90 Stripe receipt
tests, both typechecks, admin return-URL tests, the staging build, and the
non-deploying Wrangler validation. The first attempt timed out after 180
seconds in the Stripe PGlite snapshot test. That test passed alone locally and
the full Stripe suite passed locally; retrying the same code passed on GitHub,
so the first failure was not reproduced. The workflow did not deploy.

## Synthetic Stripe receipt continuity during staging freeze (2026-09-28 JST)

Added and ran the guarded
[`staging-stripe-receipt-freeze-smoke.mjs`](../../scripts/migration/staging-stripe-receipt-freeze-smoke.mjs)
with the exact account, Business D1, live-staging-write, and no-Stripe-API
flags. It installed a random temporary webhook signing secret and deployed
`625895a0-931c-4c12-8f18-8ee54d063223` with `CUTOVER_WRITE_FREEZE=true` and only
`STRIPE_WEBHOOK_BACKEND=d1`; it did not configure a Stripe API key, dispatch
selector, Checkout, or Resend.

During freeze, an unauthenticated mutation received 503 `cutover_write_freeze`
and sign-in OPTIONS returned 204. The locally signed synthetic
`customer.updated` event returned `accepted`, and an exact replay returned
`duplicate_nonterminal`. Remote D1 readback found one receipt with
`delivery_count=2`, status `received`, and one `pending` dispatch. No business
handler ran, Stripe API request was made, or email sent. The canary took
29,130 ms from secret setup through cleanup and restore; it is not a measured
production cutover RTO.

Cleanup removed the receipt, dispatch, and one-use secret, then restored the
ordinary staging config as Worker `4c23f796-fa12-419d-85fb-9a905a5f7ceb`.
Independent final readback found zero Stripe receipts/dispatches, zero business
profiles, and zero broadcast delivery rows. `/` and `/api/auth/ok` returned 200,
the unauthenticated admin mutation returned 401, and the disabled Stripe webhook
returned 404. The secret inventory returned to the three pre-existing
Better Auth/reference/verified-access secrets. No Supabase writers, production,
real user data, or domain/DNS settings changed. Stripe sandbox business-effect
acceptance and full pre/post-write recovery drills remain open.

## Staging visibility for a paused broadcast delivery (2026-09-28 JST)

Updated the D1 broadcast list DTO to project only `delivery_status=needs_review`
from the internal error marker, and added a warning in the admin UI stating
that sending is stopped and automatic retries are off. Raw `error_details`,
provider response bodies, and address-like data remain excluded from the DTO.
Focused admin API tests passed 11/11, delivery integration tests 8/8, both
typechecks, targeted ESLint, the Cloudflare staging build, and Wrangler staging
dry-run.

Deployed the ordinary isolated `fanmark-app-staging` configuration as Worker
`30ce0b27-fb72-4400-a8b6-6d86b46b5167`. The business D1 migration list had no
pending work; `BROADCAST_SEND_BACKEND`, test-send selectors, and Resend secrets
were absent. The authenticated synthetic TOTP canary confirmed the test-send
and bulk-send endpoints each returned the expected selector-disabled 503. A
synthetic `needs_review` run and recipient were then inserted temporarily; the
MFA-protected list returned `status=sending` plus `delivery_status=needs_review`
without the synthetic address/provider body. Cleanup removed the run, recipient,
draft, synthetic profiles, audits, Auth identity/session/TOTP rows, and target
identity. Independent APAC-primary D1 reads reported `changed_db=false`, zero
profiles/drafts/runs/recipients/suppressions/webhook events, and zero Auth
users/accounts/sessions/factors/roles/MFA assurances. `/` and `/api/auth/ok`
returned 200, and the deployed asset contains the warning text. No email or
provider request was made. Visual browser review remains open because the host
Mac was locked. Queue retention/reconciliation policy and provider-backed
acceptance remain open.

## スキーマ変換 v5: GIN index のクエリ契約判定 (2026-09-28 JST)

Supabase の `schema-readiness.sql` をリンク先へ read-only で再実行し、
2026-09-27T16:02:02Z 時点のcatalogを取得。40表・406列・144制約・139 index・
15 enum・1 view・58 function・36 trigger・77 RLS policyで、業務データ行は
読んでいない。schema-converter v5は、現在存在する4つのGIN indexを正確な
定義との一致に限り `omitted_after_query_contract_review` として記録する。
配列contains/overlapおよび全文検索の呼び出しはなく、正規化IDはD1のUNIQUE
制約で完全一致検索し、絵文字管理検索は部分一致であることを確認した。
未知または変更されたGIN定義は引き続きblockingにする。

最新変換レポートは17 gate groups (row変換10、schema/operation 7)、
`deployable=false`。今回のreport生成には非公開credential descriptorを
渡していないため、専用password transformは引き続き停止条件となる。
変換器テストはNode 22.6.0で12/12。catalog・DDL・reportはGit外、mode 0600。
既存staging D1へはDDL/dataとも適用していない。

## Schema converter v6 and recent-list limit parity (2026-09-28 JST)

The read-only Supabase catalog refresh at `2026-09-27T16:14:11Z` still has one
`recent_active_fanmarks` view. Converter v6 recognizes it only by exact
single-view scope, kind/name, and definition SHA-256, then records its
replacement by the D1 Worker recent-list query with code/test/document evidence.
Unknown, changed, or additional views remain blocking. The private report has
16 groups (10 row-conversion and 6 schema/operation) and remains
`deployable: false`; the private credential descriptor was not supplied.

The recent Worker API and D1 repository now accept limits through 50 to match
the source RPC, while the landing page continues to request 20. Node 22.6.0
verification passed: schema converter 13/13, migration-data 163/163,
Supabase-backed recent API 15/15, D1 repository 6/6, the complete Worker
`npm test` chain, both typechecks, CI workflow-isolation check, Cloudflare
staging build, Worker deploy dry-run, and `git diff --check`. Catalog, generated
SQL, and report are mode 0600 outside Git. No application rows, remote D1,
production, user data, or domain/DNS settings changed.

## Staging rollout of the current Worker and recent-list contract (2026-09-28 JST)

After Node 22.6.0 local validation and the app CI job passed, deployed the
current branch to the isolated `fanmark-app-staging` workers.dev Worker as
version `708ff90b-abec-405d-9dd0-6a0d14cafe3c`. Wrangler confirmed the split
business/Auth/master D1 bindings and staging R2 buckets; it found no D1
migrations pending. No asset upload was needed because the built staging SPA
assets were unchanged.

Anonymous readback returned 200 for `/` and `/api/auth/ok`; D1-backed
`/api/fanmarks/recent?limit=50` returned 200 with zero items. The
MFA-protected broadcast admin list returned 401 without a session, and the
Stripe webhook returned 404 with selectors absent. A read-only schema/count
check confirmed the four `broadcast_delivery_*` tables exist and contain zero
rows. The staging secret-name list contains only Better Auth, reference-master,
and verified-access secrets; no Resend or Stripe secret was configured. No
production route, business/Auth row, R2 object, D1 row, user data, or
domain/DNS setting changed.

## Integrated synthetic pre-write fallback rehearsal (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-prewrite-resume` path. The
script checks the exact staging account, workers.dev/no-route config, split
business D1, disabled Stripe selectors/secrets, and local Supabase/Docker
prerequisites. It waits on a non-writing invalid-body probe until the deployed
freeze returns `cutover_write_freeze`, then verifies a valid synthetic
`example.invalid` waitlist request is rejected with 503 and absent from D1.
Sign-in preflight remains available.

While staging stayed frozen, a disposable loopback Supabase project passed
synthetic email/password sign-in, UUID preservation, owner-scoped
`user_settings` read/update/readback, and cascade cleanup. The first owner-scoped
`user_settings` update was acknowledged 30,472 ms after the frozen Cloudflare
rejection; this includes local project startup and is not a production
interruption/RTO. The
same freeze preserved one locally signed synthetic Stripe receipt and its
duplicate delivery as one pending dispatch, with no Stripe API or business
effect.

Cleanup restored ordinary staging Worker version
`e54b22c6-b19d-4172-be71-445e2a29b52a`. Independent readback found zero
waitlist/receipt/dispatch/profile rows and zero rows in all seven checked Auth
user-owned tables. Staging SPA/Auth health returned 200, webhook 404, and
unauthenticated admin 401; no local Docker resources remained. The first
attempt exposed that a deploy returning is not by itself a sufficient
workers.dev readiness signal, so the script now waits using the non-writing
probe before attempting the mutation. This closes only the synthetic pre-write
fallback subgate; no linked Supabase writer/Cron was stopped and no live user
rows, production route, or DNS/domain were changed. Issue #37 remains open.

Follow-up rerun on 2026-09-28 passed with temporary Worker
`71094a8b-6cbb-4f42-afcd-47a5957dc69a`, restored Worker
`6da0dd8d-5da3-46f5-9c7e-86258a50b181` at 100%, 31,937 ms to the first
loopback source-shaped write after the freeze response, and 75,970 ms total
harness time. Final receipt/dispatch counts were zero; live deployment and
secret readback confirmed restoration and no temporary Stripe signing secret.

## Rendered subscription foreground-poll canary (2026-09-28 JST)

The opt-in `npm run test:migration:staging-subscription-ui-poll` extends the
staging subscription projection smoke into a disposable headless Chrome
session. It seeds a synthetic Better Auth identity, its minimum D1 profile,
and owner/decoy subscription rows; signs in through the staging API; then loads
`/profile`, opens the Plan section, and confirms the active subscription is
rendered. After changing only the synthetic owner row from `active` to
`canceled`, the visible status changed to inactive on the next 30-second
foreground poll in 29,440 ms.

The API canary and browser run both completed their cleanup readbacks with zero
synthetic subscription/profile/Auth rows. The browser uses a temporary Chrome
profile and is terminated by the script. No Stripe API, email, real user data,
production resource, or domain/DNS setting was used. This verifies one rendered
poll transition; it does not close Stripe sandbox acceptance, recurring CPU
plan fit, or the broader issue #37 integration/recovery gates.

## Anonymous search-record staging canary (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-fanmark-search-record`
acceptance command. It checks the exact Cloudflare account, workers.dev-only
Worker configuration, split business/master D1 IDs, D1 selector, CORS origin,
and rate-limit binding before making one anonymous search request with three
unused synthetic emoji IDs. Staging returned the expected preflight, rejected
an untrusted origin without writing, rejected a malformed ID, then recorded
one valid search. D1 readback confirmed exactly one aggregate and one search
event with `user_id=NULL`; cleanup deleted those exact rows and verified zero
matching rows remained.

The D1 `sqlite_sequence` for `fanmark_events` advanced by one after insert and
delete; it is monotonic bookkeeping and was deliberately not rewound. The
canary does not import historical searches or user attribution. No user data,
production route, Stripe/email effect, or domain/DNS setting was touched.

## Fresh descriptor-aware schema rehearsal (2026-09-28 JST)

Fetched a new linked Supabase schema catalog read-only in a separate private
work directory. Converter v8 retained 14 unresolved gates across nine
row-conversion groups and five schema/operation groups; a value-free credential
descriptor made the active credential transform requirement explicit without
making the catalog deployable. The local synthetic D1 rehearsal passed with 10
synthetic rows, two transformed active credentials, one deferred inactive
credential, all 40 checkpoints, and conflict rejection. The report remains
`public_rows_reconciled`, with deployability and full migration reconciliation
false. No source rows or remote D1/R2 were touched. Full details are in
[`schema-conversion.md`](schema-conversion.md).

## Broadcast send-control browser acceptance (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-broadcast-email-ui` command.
The synthetic MFA admin browser session opened the deployed staging broadcast
tab, read the exact synthetic draft, and confirmed both test-send and send-start
buttons were disabled with the Cloudflare-mode warning visible. The browser
clicked neither button. Existing API canary checks then confirmed both send
routes remain selector-disabled and the paused-run projection redacts private
details. All synthetic Auth, profile, draft, audit, delivery-run, and recipient
rows were cleaned and read back as zero. No provider, real-user, production, or
domain/DNS effect occurred. Provider-backed acceptance and the broader #37
integrated recovery rehearsal remain open.

## Admin user-management mutation browser acceptance (2026-09-28 JST)

Added the guarded `npm run test:migration:staging-admin-user-ui` acceptance
path and deployed the admin-dialog focus fix to the isolated
`fanmark-app-staging` Worker (version
`92b30cf6-1432-4e02-a790-956f193799dc`). A temporary headless Chrome session
authenticated as a synthetic MFA administrator, opened the deployed user
management screen, and changed one synthetic profile Free→Max→Free. It then
suspended and restored that identity through the rendered confirmation
dialogs. The restored row rendered `Free / 有効`; D1 readback confirmed the
Free plan and no Enterprise override, Auth readback confirmed `banned=0` with
null ban metadata, and the two UI status actions were present in the audit log.

The complete TOTP/admin canary passed, including its API plan/status and
immediate-expiry checks. Script cleanup plus its final readback returned the
synthetic Auth-owned tables, target/admin profiles, user-management audits,
license/configuration rows, and expiry notification artifacts to zero. No
email/provider call, real user data, production route, or domain/DNS setting
was used. This closes the rendered admin user-management mutation subgate;
provider-backed acceptance and the complete #37 application recovery
rehearsal remain open.

The same guarded canary was rerun successfully on current staging Worker
`82413f00-f60e-4a01-aeb0-2a071e01178a`. Its timestamp assertions now compare
the requested expiry instant, allowing D1's microsecond timestamp formatting
to differ from the submitted millisecond ISO string. Final readback again
found the synthetic Auth and business-D1 canary rows at zero.

The guarded staging PWA update browser check also passed. A temporary precache
asset was deployed and observed in Workbox; the staging Service Worker updated
and automatically reloaded `/pwa`, preserving synthetic `localStorage` while
discarding an unsaved DOM field. The marker was removed, the ordinary staging
build was redeployed, a second update removed the marker from the precache, and
the asset returned 404. Canary and restored Worker versions were
`f19d38cb-6708-4aa9-87f1-a58a2166337e` and
`c78dbb17-9c9b-42fc-bad5-9dc9ae0cfc65`. The temporary browser profile/storage
were cleaned. At this checkpoint, native install/standalone launch had not yet
been checked; the follow-up acceptance is recorded below. Complete #37 recovery
acceptance remains open. See [`static-assets.md`](static-assets.md).

## Native staging PWA install and standalone launch (2026-09-28 JST)

An isolated temporary Chrome profile on macOS offered the install prompt for
the staging workers.dev `/pwa` route. Installing produced a `fanmark.id` Chrome
app, and launching it rendered the search screen in a standalone window without
browser address controls. The Chrome app's profile path pointed to the isolated
temporary profile. Both the profile and generated app bundle were moved to the
Trash after the check. No application/backend change, production route, or
domain/DNS setting was involved. This closes only native install/standalone
launch at the staging workers.dev origin; authenticated flows, other browsers
and operating systems, custom-domain behavior, and complete #37 recovery remain
open. See [`static-assets.md`](static-assets.md).

## Lifecycle settings AdminSettings browser acceptance (2026-09-28 JST)

The guarded staging canary signed in a synthetic Better Auth administrator,
completed TOTP/MFA, and used an isolated headless Chrome profile to operate the
rendered `AdminSettings` lifecycle form. It read baseline `grace_period_days=1`,
saved synthetic value `2` through the staging Worker, confirmed it through the
public D1-backed endpoint, then restored and reread `1`. The test observed both
successful API responses and the form's saved state. Cleanup removed the
synthetic profile and Auth identity; readback found the user-owned Auth tables
empty. The public setting is at baseline, though `updated_at` advanced and the
MFA generation counter may have advanced during factor enrollment/removal. No
user data, email, Stripe, production route, or domain/DNS was used. The browser
form subgate is closed; complete #37 recovery, broader authenticated UI
acceptance, provider-backed checks, and operational fit remain open. Reproduce
with `npm run test:migration:staging-lifecycle-settings-ui` and see
[`lifecycle-settings-api.md`](lifecycle-settings-api.md).

## Schema converter v9 and current-catalog synthetic replay (2026-09-28 JST)

Converter v9 moves source `date` validation into generated D1 constraints. Its
canonical-calendar `CHECK` rejects malformed and impossible dates on later
writes as well as at import. The fresh schema-only catalog now has 13
unresolved gates across 226 locations (nine row-conversion and four
schema/operation); `deployable` remains false. The generated SQL changed only
for `fanmark_access_daily_stats`.

The migration-data suite passed 167/167 under Node 22.6.0. The fresh-catalog
synthetic local D1 replay passed with 10 synthetic rows, two transformed
credentials, one deferred credential, all 40 table checkpoints, and conflict
rejection. Its status is `public_rows_reconciled`, not full migration
reconciliation. No source application rows were queried; no remote D1/R2,
production route, real user data, or domain/DNS setting was changed.

## Schema converter v10 timestamp write guard (2026-09-28 JST)

Converter v10 adds canonical UTC microsecond timestamp checks to generated D1
DDL. For the fresh schema-only catalog, this affects 103 timestamptz columns
across all 40 tables. The checks require a real date in years 0001–9999,
fixed-width `YYYY-MM-DDTHH:mm:ss.ffffffZ` text, and valid time fields. The
readiness report remains at 13 unresolved groups across 226 locations because
`timestamp_import_precision` still requires operation-level evidence.

Node 22.6.0 verification passes: schema-converter 15/15, row-conversion 7/7,
Miniflare D1 importer 18/18, and the full migration-data suite 168/168. The D1
integration rejects impossible dates and millisecond-only timestamp text on
updates, confirming the existing canonical timestamp remains unchanged. A
separate current-catalog local D1 replay reconciles 10 synthetic rows, two
transformed credentials, one deferred credential, 40/40 checkpoints, and
conflict rejection; its status is
`public_rows_reconciled`, with deployment and full migration reconciliation
false. No application rows, remote D1/R2, production route, real user data, or
domain/DNS setting was read or changed.

Core Worker writes for registration, return, transfer, lottery, settings,
favorites, access analytics, and notification read state now use one shared
UTC microsecond formatter, matching the converter's fixed-width D1 contract.
Their focused D1 suites pass 72/72 locally, and corresponding frontend API
contract tests pass 44/44. The operation-format subgate is partial: the 79
source `now()` default locations and the other D1 writer paths still need
reconciliation before enabling the generated schema.

On 2026-09-28, the same formatter was applied to account deletion,
profile/password setup, admin user management, lifecycle/maintenance/system
settings, waitlist admin/signup, invitation admin/signup, and extension-coupon
admin/application and admin email-template writes. Broadcast email
administration, delivery leases/retries, and Resend webhook event persistence
now use the formatter too. Focused tests assert persisted UTC microsecond text
and pass 107/107 across these added suites. Together with the core API suites,
focused Worker D1 verification is 179/179. Coupon and email-template
administration's monotonic revision timestamps also retain six fractional
digits. This reduces known writer-format drift but does not close the 103-column
timestamp gate or the 79 `now()` default locations; the full writer inventory
remains open. No live user rows, remote D1/R2, or production settings were
accessed.

## Master and scheduled notification D1 timestamps (2026-09-28 JST)

Emoji master create/update/import operations explicitly persist both
`created_at` and `updated_at`; reference-master release creation, verification,
and activation timestamps use fixed-width UTC microsecond text too. Emoji admin
write readback is covered in the Auth D1 suite (21/21); reference-master API
coverage passes 6/6. Scheduled notification processing now formats due times,
cooldown cutoffs, generated trigger times, and operation timestamps the same
way; its D1 suite passes 12/12. No user data or remote D1 was read or changed.

## Stripe D1 timestamp normalization (2026-09-28 JST)

Stripe webhook receipt times, dispatch leases/retries, invoice projection
timestamps, and subscription reconciliation fences and grace dates now use
fixed-width UTC microsecond text when written to D1. The Stripe webhook,
invoice, and subscription synthetic integration suite passes 59/59, including
readback of receipt and dispatch timestamps. Tests use isolated local D1 and
injected providers; no live Stripe provider or user data was accessed. The
timestamp writer/default inventory remains incomplete, so the schema gate and
deployment readiness remain open.

## Master-release audit timestamps and staging writers (2026-09-28 JST)

The emoji and reference-master release tests now read back canonical
six-digit UTC `created_at`, `verified_at`, active-pointer `updated_at`, and
activation-audit `created_at` values. Migration
`0007_release_audit_timestamps.sql` recreates both release audit triggers so
they copy `NEW.updated_at` instead of using SQLite's second-precision default.
Both isolated Miniflare release suites pass (7/7 and 5/5); lifecycle/schema
tests pass 16/16, Worker typecheck and the full `workers/api` test chain pass.
The staging Vite build and Wrangler `--dry-run` pass; the dry-run read the
built assets and exited without deployment. The full migrations 0000–0007
were applied only to disposable local D1 in these tests. Staging configs and
remote migration guards select the exact release-audit filename so they exclude
the Auth-only migration with the same 0007 prefix. A read-only Wrangler remote
list confirmed only `0007_release_audit_timestamps.sql` pending before apply.
After Actions run `36368026109` passed both jobs, Wrangler applied it to
staging Master D1. The follow-up list reported no pending migrations. Readback
confirmed all four emoji/reference audit triggers use `NEW.updated_at`; the
read query reported `changed_db=false` and zero rows written.

Synthetic staging smoke scripts that seed or update business D1 now also write
six-digit UTC values for subscription/profile/notification timestamps, license
period ends, grace expiry, and expected return expiry. This keeps future
canaries compatible with the timestamp checks without touching their staging
data. `git diff --check` passed; CI run `36368026109` passed both required jobs.
The converter still reports 13 open groups / 226 locations and the complete
timestamp writer/default inventory is not reconciled. No source rows or real
user data were accessed. The only remote D1 change was the Master audit-trigger
migration above; no Worker deployment, R2 change, production route, or
domain/DNS setting changed.

## Schema converter v11 `now()` fallback representation (2026-09-28 JST)

The converter emits
`strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')` for `now()` defaults on source
timestamptz columns. SQLite-backed D1 evaluates the parenthesized expression
and the generated timestamp `CHECK` accepts the fixed-width UTC result. The
new Miniflare D1 test confirms an omitted timestamp stores 27 characters in
that shape; the converter unit test confirms the same with SQLite.

The generated value has millisecond resolution padded to six fractional
digits, and does not preserve PostgreSQL transaction-time semantics. The
`timestamp_default_requires_operation` gate remains open; non-timestamptz
defaults remain omitted. Schema conversion version 11 invalidates v10 snapshot
manifests, which must be re-exported before later verification/import.
The 2026-09-28 read-only schema refresh was reprocessed under v11 without the
private credential descriptor. Its report has 13 unresolved groups / 226
locations (8 row-conversion, 5 schema/operation), including
`credential_descriptor_required`, and remains `deployable: false`. All 79
catalog `now()` defaults are timestamptz and produce the new D1 expression;
the generated DDL loaded 40 tables with clean SQLite integrity and foreign-key
checks. No source rows, remote D1, Worker deployment, production route, real
user data, or domain/DNS state was accessed or changed.

The descriptor-aware v11 replay then passed under Node 22.6.0: 10 synthetic
rows completed all 40 checkpoints, two synthetic credentials were
transformed, one inactive credential was durably deferred, typed/hash
readback matched, and conflicting coverage was rejected. The report remains
`deployable: false` with 8 row-conversion groups / 133 locations and 5
schema/operation groups / 93 locations. No source application rows or remote
D1/R2 state was read or changed.

## Current offline source inventory refresh (2026-09-28 JST)

Regenerated `docs/migration/repository-inventory.md` from checkout commit
`1f1d0eeed72fb8d0940409fc8cab33f0d1fb9286` using the offline AST inventory
script. It still reports 40 generated-type tables, one view, 45 typed RPCs,
34 local Edge directories, 18 explicit local `verify_jwt` entries, and 211
frontend Supabase callsites. The current source scan therefore confirms the
previous counts while refreshing line locations changed by the admin
user-management browser acceptance. `node --check scripts/migration/inventory.mjs`,
`node scripts/migration/test-inventory.mjs`, and `git diff --check` passed.
This updates only the checked-out repository report; it does not close #30's
live settings/capacity/maintenance inventory or reconcile production-only
configuration. No network API or database was queried and no rows or secrets
were read.

## Staging Worker, D1 ledger, and secret-name readback (2026-09-28 JST)

Using Wrangler 4.142.0 against the existing Cloudflare account, the app
deployment list confirmed `fanmark-app-staging` version
`6da0dd8d-5da3-46f5-9c7e-86258a50b181` at 100%. Read-only `d1_migrations`
queries returned business migrations `0000`–`0016` (17), Auth migrations
`0003`, `0007`, and `0008` (3), and master migrations `0000`–`0007` (8).
All three query responses reported `changed_db=false` and `rows_written=0`.
The app Worker secret listing returned only the names
`BETTER_AUTH_SECRET`, `REFERENCE_MASTER_SERVICE_SECRET`, and
`VERIFIED_ACCESS_SECRET`; no secret value was read. Thus Stripe, Resend, and
four OAuth provider credentials are not present in staging. This remains an
external acceptance prerequisite for checkout/webhooks, actual email
delivery, and provider callbacks; no provider or billing configuration was
changed.

The account's current Workers Free plan still needs a CPU-fit decision. The
existing staging tail samples for Better Auth/password/TOTP and lifecycle
operations exceed the published Free limit of 10 ms/request. Cloudflare's
current Workers Paid pricing documents a $5 monthly minimum and a 30-second
default per-request CPU limit; no paid-plan change was made. References:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
This was metadata and secret-name readback only; no source rows, credentials,
production route, or domain/DNS were accessed or changed.

## Fresh Supabase catalog and v11 DDL recheck (2026-09-28 05:07 UTC)

Re-ran the reviewed `schema-readiness.sql` using Supabase CLI 2.118.0 in a
private temporary project-link directory; the checkout's existing
`supabase/.temp/cli-latest` state was not used or overwritten. The transaction
read catalogs only and returned 40 tables, 406 columns, 144 constraints, 139
indexes, 15 enum labels, one view, 58 functions, 36 non-internal triggers, and
77 RLS policies. Locale remained `en_US.UTF-8`; each of the five Unicode
regex-range probes found zero extra matches.

Schema-converter v11 ran with the value-free `bcryptjs@3.0.3` / cost-10
descriptor. Its 13 unresolved groups / 226 locations remain: array 9, bigint
range 3, credential transform 1, decimal 1, external foreign key 11, JSON 13,
money cents 2, sequence state 1, timestamp default operation 79, timestamp
import precision 103, and unsupported catalog scope 3. It remains
`deployable: false`. Generated DDL loaded 40 tables into ephemeral SQLite and
passed `integrity_check=ok` with zero foreign-key violations. All query output,
descriptor metadata, DDL, and report were held only in memory or a private
temporary directory that was removed on exit. No source rows, Auth values,
remote D1/R2, production route, or domain/DNS state was read or changed.

## Supabase Auth settings and staging OAuth callback target (2026-09-28 JST)

A fresh read-only request to Supabase Auth's public settings endpoint returned
HTTP 200. The response was reduced to booleans before reporting: signup is
enabled, email confirmation is required (`mailer_autoconfirm=false`), and email,
Apple, Google, GitHub, and Discord are enabled on the source project. This is
provider-toggle metadata only; it does not establish that the OAuth client
credentials exist, that provider consoles contain the required redirect URIs,
or that a browser callback or login works. No Auth users, credentials, or
provider secrets were read.

The installed Better Auth 1.7.5 configuration uses its default `/api/auth`
base path and `/callback/{provider}` callback path. Given the current staging
origin, the expected provider callback URIs are:

- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/apple`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/google`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/github`
- `https://fanmark-app-staging.fanmark-id.workers.dev/api/auth/callback/discord`

These are code-derived staging targets, not confirmed provider-console entries.
The Cloudflare secret-name readback found no credentials for these providers;
staging browser callbacks remain unverified under #31. No provider settings,
credentials, source rows, production routes, or domain/DNS configuration were
changed.

## Complete frontend backend-selector declaration, staging assignment, and deploy (2026-09-28 JST)

Auditing all frontend TypeScript references found 45 distinct
`VITE_*_BACKEND` selectors, five of which were missing from `ImportMetaEnv`.
Added all five declarations and strengthened
`test-staging-selector-coverage.mjs` to require exact set equality between
source references, type declarations, and the staging build assignments. The
build now explicitly sets `VITE_BROADCAST_SEND_BACKEND=disabled` and
`VITE_BROADCAST_TEST_SEND_BACKEND=disabled`; both controls were already
fail-closed by default, and no sender/provider credentials are configured.

Under Node 22.6.0, the focused selector suite passed 3/3, root typecheck passed,
`npm run build:cloudflare-staging` passed, and the full `npm run
test:migration-data` suite passed 172/172. Wrangler app-config dry-run passed.
Commit `f54d930` passed both PR #41 validation jobs in GitHub Actions run
`36381489669` (`Validate Cloudflare staging application` and `Validate
Cloudflare Worker API`; Supabase Preview was skipped by design).

The app was then deployed to workers.dev staging only. Wrangler recorded
deployment `e14b597b-74a6-4e1b-a850-0e8403ee86ed`, version
`f4c99bda-ea79-468e-addd-38b8f1453f47`, and 100% traffic. The deployed static
asset `/assets/index-DZsrzGFr.js` is 2,498,833 bytes and its SHA-256
`519bd4f92b7aebcf7b13f903a6e674e75278171a69bef83f396e072e75f71246` matches
the local staging artifact. Staging `/` returned 200 with `noindex, nofollow`,
`/api/auth/ok` returned 200 `{ok:true}`, and `/api/emoji/catalog` returned 200
JSON. No D1 migrations or data operations, provider calls, production routes,
or domain/DNS changes occurred. The selector audit is complete statically;
runtime acceptance of the full API/UI inventory remains open.

## Repeat isolated synthetic post-write recovery (2026-09-28 JST)

Two preliminary repeats failed during synthetic write acknowledgement after
their temporary Workers and D1s were created; cleanup confirmed deletion of the
temporary resources. The private report lacked a useful safe stage indicator,
so the harness now records phase and sanitized error labels without request or
row contents. `node --check` and `git diff --check` passed. A rerun of
`npm run test:migration:staging-postwrite-recovery` passed: all 17 business
migrations applied, the synthetic waitlist and duplicate Stripe receipt were
acknowledged, a later write was removed by Time Travel while the Worker stayed
frozen, and the exact acknowledged row/receipt digest matched after restore.
Restore and reconciliation took 4.530 seconds. Cleanup confirmed the temporary
Worker, D1, and config were removed. No real user data, Stripe API call,
production route, or domain/DNS change was involved. This remains an isolated
application-schema drill, not full #37 acceptance.

## Supabase Edge Function settings regression check (2026-09-28 JST)

Added `scripts/migration/test-supabase-function-settings.mjs` to compare the
read-only live-function matrix in `live-observations.md` against all local
`supabase/functions/*/index.*` entrypoints and the explicit `verify_jwt`
settings in `supabase/config.toml`. The check requires the 34 local slugs and
the one documented live-only function to match the reviewed inventory, and
fails if any local function omits or duplicates its JWT boolean. It is included
in `npm run test:migration-data` and is available as
`npm run test:supabase-function-settings`.

Under Node 22.6.0, the standalone check passed and the full migration-data
suite passed 173/173. This protects observed gateway-setting parity only; it
does not prove handler-level authorization, function behavior, or the status
of external callers for the live-only function. No remote setting, deployment,
function invocation, or application row changed.

## Rendered protected-access staging canary (2026-09-28 JST)

Added `npm run test:migration:staging-protected-access-ui`, an opt-in guarded
headless-Chrome check that uses a random synthetic Better Auth user and a
temporary password-protected text fanmark. On the 390x844 viewport, the
workers.dev `/a/:shortId` page kept the synthetic text hidden while locked;
one wrong four-digit password returned 401 and cleared the input, and the
correct password returned 204 followed by a 200 protected read with
`Cache-Control: no-store`. Readback verified the proof cookie was HttpOnly,
Secure, and SameSite=Lax. The public locked projection returned no text or
redirect target. Cleanup and independent D1 reads found zero canary Auth,
business, proof, reservation, or access-audit rows.

The API-only `npm run test:migration:staging-owner-settings` also passed its
unauthenticated 401, owner GET/PATCH 200, wrong-password 401, valid verification
204, protected read 200, and cleanup checks. Targeted ESLint, `node --check`,
and `git diff --check` passed. This verifies the rendered text-password path
for one synthetic Chrome viewport; imported Supabase password compatibility,
other browsers, recurring CPU/abuse-control fit, and production behavior remain
open. No application deployment, real user data, provider call, production
route, or domain/DNS setting changed.

## Read-only Supabase capacity refresh (2026-09-28 JST)

Refreshed aggregate capacity through Supabase CLI 2.118.0 using an isolated
temporary project-link directory. PostgreSQL measured 27,708,563 bytes
(about 26.4 MiB / 27.7 MB). Supabase Storage metadata summed to 13,285,729
bytes (about 12.67 MiB) across 109 objects, with no missing size metadata.
The Storage figure comes from object metadata, not a new body download/hash
pass. Only these aggregate capacity values were added to the public record;
per-table, Auth, Stripe, and per-bucket breakdowns remain outside Git.

This read-only inventory provides transfer-size context only; it does not
measure a frozen snapshot, import/reconciliation time, or user-visible
interruption. No application row values were returned or recorded. It changed
no Supabase, D1, R2, production route, or domain/DNS state.

## Rendered profile and R2 avatar UI canary (2026-09-28 JST)

Extended `scripts/migration/staging-r2-profile-smoke.mjs` to open the deployed
workers.dev `/auth` and `/profile` pages in an isolated headless Chrome profile
at 390x844. The canary signs in through the real form with a synthetic
Better Auth user, observes the Worker email-login request, and verifies the
HttpOnly/Secure/SameSite=Lax session cookie. It selects a complete synthetic
1x1 PNG through the page's file input, observes the Worker storage and profile
requests, and requires Chrome to decode the returned image at its expected
dimensions. It then clicks the profile's own remove control, checks that the
Worker profile API returns a null avatar, and confirms the removed public R2
URL returns 404. The existing REST portions continue to verify anonymous
rejection, same-owner URL rules, and both avatar and cover-image buckets.

The first attempt revealed the previous API fixture was a truncated PNG header:
the API signature check accepted it, but Chrome could not decode it. A
CRC-valid 70-byte synthetic PNG replaced it. The live canary then passed the
rendered upload/delete flow, and final D1/R2 readback found zero synthetic
profile/Auth rows and zero objects. The local Worker/R2 suite also now applies
the same Auth suspension migration selected by its test configuration; this
fixed a fixture that otherwise caused synthetic Better Auth sign-in to return
500. Local Worker/R2 tests pass 5/5. These changes touch only the staging
smoke and test fixture; no source rows, existing Supabase objects, production
routes, or domain/DNS settings changed. PR #41 CI passes both the staging-app
and Worker-API jobs. This proves the synthetic email/password staging path
only; provider-backed login and existing user migration remain separate gates.

## Perpetual Tier C plan-capacity correction (2026-09-28 JST)

Updated the Cloudflare D1 lottery-entry endpoint and source-shaped grace
finalizer so plan capacity counts an unreturned `active` license when
`license_end IS NULL` or the end is later than the captured current time. This
closes a mismatch where lifetime Tier C licenses could be ignored and a winner
could exceed the documented plan cap. The correction is explicit in
`docs/PRODUCT.md`; the old Supabase implementation remains unchanged until the
final cutover stage.

Synthetic tests now cover a perpetual license at the cap, a perpetual license
that fills the slot after a winner plan is prepared, and the authenticated
lottery-entry response. `npm --prefix workers/api run test:fanmark-lottery-d1`
passes 12/12, `npm --prefix workers/api run test:license-expiry-source`
passes 25/25, Worker typecheck and targeted ESLint pass. No remote deployment
of the production Worker or user data was changed in this code slice.

The staging lottery smoke now has an opt-in perpetual-cap scenario. A
workers.dev one-minute-Cron canary completed against only synthetic IDs and
verified that three unreturned active perpetual licenses fill the synthetic
enterprise-plan limit of three: the pending entry finished as `lost`, history
has no winner, and `lottery_limit_exceeded` reports `current_count=3` and
`limit=3`. The old synthetic license expired normally, with no winner license.
Cleanup restored `grace_period_days`, removed all synthetic business rows and
lifecycle journals, left Auth rows unchanged, and matched the retained
incarnation/access-version snapshot. The script restored the checked-in
staging Cron/backend baseline. The local `wrangler dev --test-scheduled` path
reset its connection before execution; that attempt also cleaned up fully.

The earlier CI snapshot-export timeout was isolated to PGlite initialization
when run inside Node's `--test` harness: the latest 15-run reproduction hung
five times before its first SQL completed. The same integration now uses
`PGlite.create()` and runs as a standalone Node process under the migration
test runner; this path passed 15/15 repetitions, and the complete Stripe
receipt suite passed locally on Node 22.6.0. Direct `node --test` can still
reproduce the harness stall, so CI must use the checked-in custom runner path.

The earlier PR CI's Worker job passed, while the staging-app job timed out
twice in `snapshot-export.test.mjs`. After isolating and routing around the
PGlite/`node --test` hang, fresh CI run `36394318652` passed both the staging
application and Worker API jobs, including Worker typecheck and bundle dry-run.
The synthetic staging Cron canary was deployed and restored independently.

## Supabase-format password sign-in in staging (2026-09-28 JST)

Extended `scripts/migration/staging-r2-profile-smoke.mjs` to seed one synthetic
Better Auth credential with a `$2a$10$` bcrypt prefix matching the value-free
format observed in the Supabase Auth aggregate. The synthetic password includes
a non-ASCII character. The real `/auth` form logged in through the deployed
Worker, and `GET /api/auth/get-session` returned the exact seeded UUID. The
session cookie was HttpOnly, Secure, and SameSite=Lax. This does not read or
copy any existing Auth credential.

The same 390x844 browser canary rendered `/profile`, uploaded and decoded the
synthetic 1x1 PNG through R2, saved and cleared its owner-scoped profile URL,
and deleted the object through the UI. Final readback found zero synthetic
Auth user/account/session rows, zero profile rows, and 404 for all temporary
avatar/cover objects. `node --check` and a local bcrypt `$2a$10$` Unicode
fixture check passed. This improves the staging password-compatibility proof;
it does not establish real-user hash compatibility, MFA/OAuth migration,
recurring CPU-plan fit, or production readiness.

The same synthetic `/api/auth/sign-in/email` request was measured with a
100%-sampled Wrangler Tail stream on Worker version
`5e75e611-6145-48c3-a35e-daa2a3f9da5d`: status 200, CPU 143 ms, wall time 229
ms. Authenticated avatar uploads used 4–8 ms in this run. Cloudflare's current
Free limit is 10 ms per HTTP invocation and its documentation allows infrequent
overages before consistently over-limit work is terminated; this successful
sample is therefore not evidence of Free-plan fit. Workers Paid currently
starts at $5/month, but no billing-plan change was made. See Cloudflare's
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Synthetic business/Auth D1 post-write recovery (2026-09-28 JST)

Extended `npm run test:migration:staging-postwrite-recovery` to create isolated
business and Auth D1 databases plus a disposable workers.dev API Worker. It
applied and read back all 17 business migrations and the exact three-migration
Auth allowlist (`0003`, `0007`, `0008`). A synthetic-only Better Auth user and
session passed the temporary Worker login flow. The drill acknowledged one
waitlist row and one pending Stripe receipt/dispatch, bookmarked both D1s,
accepted a later waitlist row and Auth session, and redeployed with
`CUTOVER_WRITE_FREEZE=true`. Both D1s were restored while frozen. The original
waitlist/receipt/session state matched its pre-bookmark digest; the later row
and session disappeared, and the original session cookie still resolved to the
same synthetic UUID. Restore plus reconciliation took 13.660 seconds.

The first remote attempt exposed the known D1/Workers SDK issue where trigger
bodies using lowercase `begin` fail remote migrations with
`incomplete input: SQLITE_ERROR`; the local SQLite path succeeds. The six
trigger keywords in `0003_better_auth_core.sql` are now uppercase, and
`.gitattributes` pins both D1 migration directories to LF. A migration test
guards those remote-safe formatting requirements. This is SQL-equivalent and
does not change the schema. See the current [Workers SDK issue #15314](https://github.com/cloudflare/workers-sdk/issues/15314).

The successful rehearsal used only synthetic rows and a low-cost disposable
bcrypt fixture to reduce CPU for this recovery-only sign-in. Its Worker CPU was
not sampled, so this run does not establish Free-plan fit; the separate
`$2a$10$` staging compatibility canary remains the evidence for that observed
credential format. Cleanup read back zero temporary Worker/D1 resources,
leaving only the three pre-existing staging databases.
No existing Auth/business/master D1, R2 object, Supabase writer, Stripe API,
real user data, production route, or domain/DNS setting was changed.

This closes a combined business/Auth post-write restore subgate, not issue #37.
The rehearsal still has no R2 restoration, applied Stripe business effect,
complete encrypted-backup validation, or coordinated Supabase-writer/Cron
freeze. The coarse estimates remain about 53% end-to-end and 73% for the
prioritized app/infrastructure/non-user-master scope.

## Business/Auth synthetic recovery through private R2 (2026-09-28 JST)

The guarded post-write command was extended to include an encrypted R2 replay
slice. A disposable APAC Business D1 and Auth D1 received only synthetic
state. The command exported six tables from those D1s with table-filtered
`wrangler d1 export --no-schema`, packaged the SQL exports as a synthetic row
in the existing AES-256-GCM snapshot format, and uploaded the header and
ciphertext to the private `fanmark-migration-backups-staging` bucket. R2
download hashes, bundle authentication, manifest verification, and exact
decrypted SQL comparisons passed.

The Time Travel bookmarks restored the acknowledged Business/Auth digest
`a1b36eb8d1a4e488d95314d39bb19b7289bb425a751bb5e0a3a33f884ee67ca3` in
11.992 seconds. The command then removed the six synthetic table rows and
replayed them from the decrypted R2 bundle; the same digest and original
Better Auth session cookie were verified in 28.436 seconds. The Worker freeze
rejected five consecutive valid waitlist writes with 503, accepted none, and
still allowed synthetic sign-in. A preliminary rollout attempt observed a 202
after one readiness probe returned 503, so the gate now requires consecutive
actual write rejections. Wrangler's deployment-list response did not reconcile
the temporary freeze version, limiting this evidence to repeated behavior from
the tested workers.dev origin rather than global rollout completion.

Cleanup verified the temporary Worker, both D1s, local bundle, and two R2
objects were removed; readback showed only the three pre-existing staging D1s
and an empty backup bucket. This is a six-table synthetic slice, not a complete
Business/Auth/Storage backup. It does not apply Stripe business effects, test
Storage-object recovery, freeze Supabase writers/Cron, or import real user
data. Issue #37 remains open; the details and exact private artifact digest are
in [cutover-rehearsal.md](cutover-rehearsal.md).

## Shared D1 operation timestamp formatter (2026-09-28 JST)

Replaced the duplicated UTC millisecond-padding expression in availability,
Stripe plan/extension checkout, availability-rule edits, notification-admin
manual-event/master updates, and owner fanmark-profile writes with the common
`workers/api/src/utc-timestamp.ts` formatter. Existing caller-specific invalid
clock checks and monotonic update rules remain in place. The shared formatter
has direct boundary/invalid-clock tests; all affected focused API suites pass
48/48 and Worker typecheck passes. This does not close the full writer/default
inventory behind v11 `timestamp_import_precision` and
`timestamp_default_requires_operation`. No source rows, remote D1, deployment,
user data, or domain/DNS state changed.

The same pass also replaced the remaining three local timestamp-padding
expressions for Stripe plan-checkout, customer-creation, and plan-change
idempotency deadlines with the shared formatter. Their D1 integration suites
were rerun successfully (17/17); Worker typecheck remains clean.

The same formatter now supplies the default clock for public-access logging
and Stripe webhook application. Their public-access tests pass 13/13 and the
Stripe webhook/invoice/reconciliation D1 suite passes 59/59. Worker typecheck
and Wrangler dry-run bundle validation also pass; no deployment was made.
The canonical implementation now lives in `utc-timestamp.mjs`, with a typed
TypeScript re-export. Verified-access timestamp creation and scheduled expiry
run capture use the same implementation; their tests pass 10/10 and 8/8,
respectively. Typecheck and Worker dry-run pass after adding the declaration.

## Lifecycle trigger timestamp repair (2026-09-28 JST)

A fresh schema-only Supabase catalog showed 22 lifecycle-generation triggers
still emitting three-digit SQLite `%f` timestamps. Added the guarded forward
migration `0017_lifecycle_generation_timestamp_precision.sql`, generated from
the private mode-0600 schema catalog, to replace those 22 definitions without
rewriting applied migration `0002`. The staging apply verified the expected
account, database, ledger, and old trigger shape, then read back all 24 exact
canonical trigger definitions with zero pending migrations. A full isolated
Wrangler replay and synthetic D1 integration test passed; a live synthetic
write also returned six-digit UTC text.

A follow-up deployed scheduled-event canary preserved the two configured
baseline Cron triggers and used a one-off lifecycle schedule. Wrangler's D1
API returned 7403 while the harness polled for the scheduled result, so that
run is incomplete. The harness cleaned up its synthetic rows and redeployed
the staging config; deployment `7f7c79e9-9d12-401c-9466-2518d03b195c` is the
latest 100% version. The prior successful lifecycle Cron canary remains the
scheduler evidence; this attempt does not replace it or close final lifecycle
acceptance. No production data, user data, or domain/DNS was touched.

## Business migration-ledger verification (2026-09-28 JST)

The business staging migration history now has one explicit ordered manifest
through `0017_lifecycle_generation_timestamp_precision.sql`. Guarded staging
verifiers validate that the live ledger is an exact prefix of this manifest,
so later approved migrations no longer make an earlier migration's read-only
verification fail. The manifest test compares every entry with the checked-in
SQL migration directory and rejects gaps, reordering, duplicates, and unknown
names. The migration-data suite passes 177/177.

`apply-stripe-invoice-staging.mjs --verify` and its repeatable `--apply` path
successfully read the current 18-entry staging ledger, the four expected
invoice objects, and zero invoice, receipt, dispatch, and billing-application
rows. Because the invoice migration was already present, `--apply` followed its
read-only verification branch. The business-extension verifier also uses the
shared ledger guard; its live read-only run still requires the private
credential descriptor and was not performed in this environment. No user
data, production route, or domain/DNS state changed.

## Lifecycle Cron canary retry diagnostics (2026-09-28 JST)

The latest guarded lottery-Cron retry completed 47 remote Business D1 reads;
read 48 started before the harness exited with
`staging_cron_disable_failed`. The finalizer attempted to redeploy the baseline
Worker and delete the synthetic fixture, but no successful deployment receipt
or post-cleanup D1 readback was recorded. The current Cron configuration and
canary-row cleanup are unverified, and this attempt is not a passing canary.

Fresh Wrangler identity comparison shows that the stored CLI OAuth profile
does not include the staging account. Read-only `d1 info` and `deployments
list` calls against the configured account fail with Cloudflare authentication
error 10000. The open Dashboard D1 Studio route also returns 404 with
`Unauthorized to access requested resource`. No remote configuration or rows
were changed during these checks. Public route probes only establish basic
health and cannot establish Cron/deployment/cleanup state.

The canary now retains sanitized summaries for its original failure, Cron
restore failure, and synthetic cleanup failure; focused tests cover redaction
of credential-like values and emails. Retry the state readback only after the
Wrangler profile has access to the staging account, then verify the current
Worker version/triggers and zero canary rows before another scheduled canary.
No user data, production route, or domain/DNS state was read or changed.

## Current Supabase catalog gate refresh (2026-09-28 12:07 UTC)

The reviewed catalog-only query was rerun non-interactively with
`npx supabase@2.118.0 db query --linked --file scripts/migration/schema-readiness.sql
--workdir <private-temp-project> --output-format json --yes` under `CI=1`.
Its `BEGIN READ ONLY` transaction observed 40 tables, 406 columns, 144
constraints, 139 indexes, 15 enums, one view, 58 functions, 36 triggers, and
77 RLS policies at `2026-09-28T12:07:48Z`; no application rows were queried.

Schema-converter v11 with the value-free credential descriptor still reports
`deployable: false`, 13 unresolved groups / 226 locations (8 row-conversion /
133 locations, 5 schema-operation / 93 locations). Per-gate counts are array
9, bigint 3, credential transform 1, decimal 1, external Auth reference 11,
JSON 13, money cents 2, sequence state 1, timestamp default 79, timestamp
import 103, and unsupported catalog scope 3. This refresh changed no source or
target state; the catalog and report were kept in memory and the temporary
project-link directory was removed.

Unauthenticated public GETs at `2026-09-28T12:13Z` returned 200 for `/`,
`/robots.txt`, Better Auth health, and a null anonymous session; anonymous
admin session returned 401 and the disabled Stripe webhook returned 404. The
root and robots response both include `X-Robots-Tag: noindex, nofollow`. These
are route-health checks only and do not establish the deployed version, Cron
configuration, or post-canary cleanup.

## Four-provider synthetic OAuth callback contracts (2026-09-28 JST)

Extended `workers/api/test/auth-d1.test.ts` to run successful synthetic
authorization-code callbacks through the app Worker and local Auth D1 for
Apple, Google, GitHub, and Discord. Provider fetches are fully stubbed. Tests
assert verified-email linking to the existing synthetic UUID, social-account
identity persistence, session issuance, and no new user row. Apple’s
`form_post` callback redirect to the follow-up GET is included. A separate
Google callback for a verified but unlinked email returns `signup_disabled`
without creating a user, account, or session. Existing start/state-denial
coverage still tests all four providers, including rejection of a tampered
state with `state_mismatch`. A Google identity with the existing email but
without a provider-verified email returns `account_not_linked` and adds no
account or session.

`npm --prefix workers/api run test:auth:d1` passes 27/27;
`npm --prefix workers/api run test:auth-social` passes 3/3; Worker typecheck,
focused ESLint, and `git diff --check` pass. Only synthetic credentials and
provider responses were used; there were no real OAuth requests, remote D1
writes, deployments, user-data operations, or domain/DNS changes. This is
local callback-contract evidence, not provider-backed staging acceptance.

## Exact money and descriptor-bound credential import (2026-09-28 JST)

Removed the blocking `money_cents_import` schema gate for the two explicitly
mapped source columns, `fanmark_tiers.monthly_price_usd` and
`fanmark_availability_rules.price_usd`. The migration codec now requires the
canonical PostgreSQL `numeric(10,2)` text form, converts with integer
arithmetic, and bounds the result to the exact signed cent range. Generated
D1 DDL rejects non-integer and out-of-range cents. Existing Worker integrations
cover the corresponding reversible read/write API projections.

The full migration-data suite passes 181/181; focused availability-rule admin,
availability/reference-master, reference-master release, and reference-master
API suites pass 4/4, 4/4, 5/5, and 6/6. The exact credential target-profile
importer is also covered by the synthetic 40-table replay, including transformed
active credentials, durable inactive-row deferral, ACK-loss resume, and typed
readback; the generic importer still refuses a missing target profile. The full
migration-data suite passes 182/182. Root and Worker typechecks, focused ESLint,
and `git diff --check` pass. Schema-conversion version 13 rejects older snapshot
manifests, which must be re-exported. The same catalog shape now has 11
unresolved gates across 223 locations (6 row-conversion / 130 locations, 5
schema/operation / 93 locations) and remains `deployable: false`. This is
synthetic/local codec and API evidence only; no Supabase rows, remote D1, Worker
deployment, production route, or domain/DNS state was changed.

## Exact lottery-weight decimal import contract and schema converter v14 (2026-09-28 JST)

The verified lottery lifecycle already parses stored weights as exact decimal
text and computes weighted draws with `BigInt`; the migration report had kept a
generic decimal gate because that complete importer/operation contract was not
bound to the catalog. Added the dedicated
`lottery-weight-positive-decimal-text` codec, emitted only for
`fanmark_lottery_entries.lottery_probability` when the catalog confirms the
non-null numeric column and validated `positive_probability` CHECK. A shared
256-character limit now governs both row import validation and the Worker
selector. Zero/negative, noncanonical, and over-limit source text fails before
a D1 binding is produced; other generic decimal columns remain gated.

A linked read-only aggregate over only the current probability column returned
no noncanonical/nonpositive or over-limit values. It contained no row IDs or
values and was not saved. A fresh descriptor-aware catalog conversion reports
10 blocking groups / 222 locations (5 row-conversion / 129, 5
schema/operation / 93) and remains `deployable: false`. Schema converter
version 14 and D1 import codec version 4 make prior manifests/checkpoints fail
closed rather than silently resuming with changed validation.

`npm run test:migration-data` passes 183/183, Worker lottery API passes 12/12,
lifecycle source integration passes 25/25, Worker typecheck passes, and the
focused converter/snapshot suites pass. No user rows were exported/imported,
no remote D1 or production state changed, and domain/DNS was untouched.

## Exact event sequence import profile and schema converter v15 (2026-09-28 JST)

The existing snapshot format 4 and D1 importer already capture the exact
`fanmark_events_id_seq` definition and state, then seed and verify the target
`sqlite_sequence` watermark after importing rows. Called and unused sequences
are both covered by integration tests, including the next generated event ID.
The schema converter's extra `sequence_state_import_required` gate duplicated
that fail-closed contract and is now removed only when the catalog matches the
exact supported event sequence profile. Other nextval profiles remain gated.

The schema converter advances to v15. A fresh linked, read-only schema
catalog conversion at 2026-09-28 14:25 UTC reports 9 groups / 221 locations
(4 row-conversion / 128, 5 schema/operation / 93); it remains
`deployable: false`. The query returned no application rows. The actual
PostgreSQL sequence state was not queried; it remains a final-freeze requirement
because sequence advancement is outside MVCC. Schema conversion, snapshot-format validation, D1-import tests, and
`npm run test:migration-data` cover the contract. No user rows, live sequence
values, remote D1, production route, or domain/DNS state changed.


## Internal bigint event key and schema converter v16 (2026-09-28 JST)

The linked schema catalog has three bigint columns. The Worker projects the two
discovery counters as numbers, so those import/read-precision gates remain. A
source-code audit found that `fanmark_events.id` is not selected or returned by
Worker code; the table is insert-only at that boundary. The exact importer stores
the signed 64-bit ID without Number conversion, and the snapshot contract
restores the sequence watermark. Schema converter v16 removes the bigint gate
for this column only when the exact supported sequence contract is present.

A fresh linked, read-only schema catalog conversion at 2026-09-28 14:30 UTC
reports 9 groups / 220 locations (4 row-conversion / 127, 5 schema/operation /
93) and remains `deployable: false`. It returned no application rows or live
sequence values. Focused schema/snapshot tests pass 37/37, and the complete
migration-data suite passes 184/184 with no skips.


## Snapshot-validated array schema gate and converter v17 (2026-09-28 JST)

The supported array row envelope already carries per-column SQL-NULL state,
dimension count, and lower bound. Conversion accepts only `text[]`, `uuid[]`,
and `smallint[]`, rejects nested/non-1-based arrays and invalid elements, and
preserves order, duplicates, element NULLs, and empty arrays. These checks run
for each snapshot row before target binding, so the schema converter now shares
the supported type list and suppresses the redundant pre-import array gate only
for these types; an unsupported PostgreSQL array remains blocked.

A fresh linked, read-only query completed without terminal input at
2026-09-28 14:43 UTC and returned the same 40 tables / 406 columns; its nine
arrays all use the three supported types. The v17 report removes the array
gate's nine locations and has 8 groups / 211 locations (3 row-conversion / 118,
5 schema/operation / 93), still `deployable: false`. Focused schema/row tests
pass 27/27 and the complete migration-data suite passes 185/185 with no skips.
No application rows or live sequence values were read.


## Timestamp writer coverage inventory across Workers and migration SQL (2026-09-29 JST)

The read-only schema catalog was refreshed at `2026-09-28T15:14:18Z` using the
reviewed catalog-only query. It still contains 40 tables and 79 columns with
`timestamptz DEFAULT now()`; no application rows were queried. The static
writer audit now scans Worker `.ts`/`.mjs`, app and business D1 migration SQL,
and migration seed SQL. It parsed 98 INSERT column lists with zero timestamp
columns omitted and zero target INSERTs it could not parse.

Twelve timestamp defaults in seven tables have no direct INSERT in those
surfaces. Eight columns across `fanmark_tiers`, `languages`,
`reserved_emoji_patterns`, and `fanmark_tier_extension_prices` are loaded
through the versioned reference-master row snapshots; those tables are read
through release views in the Worker. The other four are
`notification_preferences.created_at/updated_at`, `user_roles.created_at`,
and `notifications_history.created_at`. These are user-owned or legacy data
surfaces and remain for the final data/import disposition. The audit reports
them as unmatched rather than treating the absent direct INSERT as coverage.
It is a column-list inventory only and does not prove transaction-time clock
semantics or close the 103-column operation timestamp gate.

The audit found that the active-to-grace prototype in
`workers/api/src/license-expiry.mjs` omitted `audit_logs.created_at`. It now
binds the same captured operation timestamp used for that transition, and its
local D1 fixture requires and reads back that timestamp. `npm run
test:migration-data` passes 188/188 under Node 22.6.0; the license-expiry D1
integration passes, as does the source-profile lifecycle integration (25/25).
This changes only local source and tests: no production Worker, user data, D1,
or DNS/domain state changed.

## Timestamp writer audit detail and reference-master precision (2026-09-29 JST)

A read-only refresh of the schema catalog completed at
`2026-09-28T19:48:21.174176+00:00` and still found 40 tables with 79 timestamp
defaults. The static audit parsed 98 target INSERTs with none unparsed; its
report now records each writer's source file, line, table, and timestamp-default
columns so the next step can trace bound values per operation. The 12 defaults
without a direct INSERT are the eight timestamps on the four versioned master
tables and four final data/import fields: `notification_preferences.created_at`,
`notification_preferences.updated_at`, `notifications_history.archived_at`,
and `user_roles.created_at`. This remains column-list evidence only; it does not
prove runtime clock semantics, and coverage remains incomplete.

The shared exact-UTC-microsecond validator now protects both reference-master
release imports and admin edits that restage the active snapshot. It preserves
valid six-digit timestamp bytes (`Z` or `+00:00`) and rejects rounded,
impossible-calendar, or non-UTC values before a target release write. Focused
release/API/service and validator tests pass; the admin API regression test
also confirms a malformed active timestamp is rejected before any stage or
batch write. Worker TypeScript typecheck passes. No production Worker, real
user data, remote D1, or DNS/domain state changed.

## Stripe invoice webhook dispatch wiring (2026-09-29 JST)

The existing signed Supabase webhook now routes `invoice.payment_failed`,
`invoice.payment_action_required`, and `invoice.payment_succeeded` through
durable receipt acceptance and an exact-ID dispatch lease. The handler retrieves
the current invoice and subscription from Stripe, then applies the fenced
invoice projection, payment fields, and receipt/dispatch terminal state in one
Supabase transaction. A terminal duplicate returns 200 without a Stripe read;
an active lease or retryable failure returns 503. The new RPC is defined in
`supabase/migrations/20260929170000_add_targeted_stripe_dispatch_claim.sql`.

The focused PGlite projection suite passes 28/28; the full
`experiments/stripe-receipts` `npm test` run exits successfully. Package
typecheck, Deno check for the webhook, targeted ESLint, and `git diff --check`
also pass. This remains local code and test coverage: the migration was not
applied, the webhook was not deployed, and no Stripe API call, user-data
migration, D1 change, or DNS/domain change was made. Issue #32 remains open
because subscription, checkout, and deletion paths still need to be brought
under the same dispatch guarantees.

## JSONB snapshot/import gate and schema converter v19 (2026-09-29 JST)

The `jsonb` snapshot projection wraps PostgreSQL text as an outer JSON string;
the row codec validates the text and preserves it byte-for-byte for the D1
binding. Generated D1 DDL checks `json_valid()` without conflating SQL `NULL`
with JSON `null`. Real SQLite tests read back both null forms distinctly and
retain a nested high-precision decimal unchanged; invalid JSON text is rejected.
The schema converter no longer emits `json_import_validation` for this reviewed
codec contract and advances to v19 so older snapshots cannot claim the new
gate disposition.

Against the last recorded schema shape, this removes 13 JSONB locations and
reduces the calculated report from 7 groups / 209 locations to 6 / 196 (1
row-conversion / 103; 5 schema/operation / 93). No fresh schema query was run,
so this is not a refreshed live report and the converter remains
`deployable: false`. `npm run test:migration-data` passes 190/190 under Node
22.6.0. This work changes local conversion code and tests only; no Supabase
application rows, remote D1, production route, user data, or DNS/domain state
changed.

## D1 business timestamp comparison repairs (2026-09-29 JST)

The invitation capacity guard from applied migration `0014` and coupon
application guard from applied migration `0015` compared timestamp text through
SQLite `julianday()`, which collapses distinct UTC microseconds. Forward
migrations `0018_invitation_capacity_timestamp_precision.sql` and
`0019_extension_coupon_timestamp_precision.sql` recreate those guards with
lexical comparisons on the fixed-width UTC timestamps. The canonical business
migration sequence and Miniflare integration fixtures include both forward
migrations. Tests verify that invitation/reservation expiry, coupon expiry,
transfer locks, and active-license cutoffs retain a one-microsecond difference.

The invitation signup suite passes 10/10, the coupon application suite passes
8/8, and the analytics, details, and Stripe extension-checkout suites pass
20/20. The complete migration-data suite passes 190/190 under Node 22.6.0.
These migrations have not been applied to staging; no source rows, remote D1,
production route, or DNS/domain state changed.

## Schema converter v20 timestamptz import gate (2026-09-29 JST)

The converter previously emitted `timestamp_import_precision` for every
`timestamptz` column even though the complete import path preserves that value
exactly: the PostgreSQL snapshot projection formats UTC microseconds with
`to_char(..., '...US...')`, the row codec validates and returns the six-digit
text without passing it through `Date`, the generated D1 CHECK enforces the
canonical shape, and the Miniflare importer test independently reads back the
same `.123456Z` value. Invalid dates, fractions, offsets, and infinity are
rejected. Default and future-operation clock semantics remain covered by the
separate `timestamp_default_requires_operation` gate.

Schema converter v20 removes only the now-redundant import gate and increments
the conversion version so older manifests cannot silently resume under the new
gate disposition. On the last recorded catalog shape, this removes 103
locations and reduces the calculated report from 6 groups / 196 locations to
5 schema/operation groups / 93 locations. The converter remains
`deployable: false`; no fresh Supabase schema fetch or application-row query
was made. `npm run test:migration-data` verifies the codec, generated DDL, and
synthetic importer contract.

## Business-to-Auth identity preflight (2026-09-29 JST)

The local D1 importer now supports only the reviewed cross-database edge
`public.<uuid-column> -> auth.users(id)`. With the local unresolved-gate option
enabled, it scans and verifies each referencing snapshot stream before creating
the business D1 import ledger. Every non-null identity is checked in batches
of at most 100 through an injected read-only `resolveAuthUserIds` callback;
missing callback results or absent Auth IDs abort before any D1/report write.
Optional NULL values do not require an Auth lookup. No placeholder identities
are created, and the schema report remains `deployable: false` because D1
cannot enforce a foreign key across the separate Auth and business databases.

The local Miniflare tests verify success, missing resolver, absent Auth ID,
NULL handling, and zero target writes on preflight failure. The focused D1
import tests pass 20/20 and `npm run test:migration-data` passes 191/191 under
Node 22.6.0. The 40-table current-catalog synthetic rehearsal reconciles all
40 checkpoints and 10 synthetic rows, including the two transformed and one
deferred credentials. No Supabase application rows, real credentials, remote
D1/R2 state, production route, or domain/DNS state were accessed or changed.

## Scheduled Stripe timestamp precision (2026-09-29 JST)

The scheduled Stripe webhook dispatcher used `Date#toISOString()` for its
explicit D1 operation timestamp, yielding three fractional digits while the
migration contract requires six. It now uses the shared UTC microsecond
formatter and rejects invalid Worker schedule times before invoking dispatch.
A focused test verifies exact `.000000Z` and `.123000Z` output and invalid-time
rejection. The Stripe invoice-projection integration suite passes 12/12 and the
Worker typecheck passes under Node 22.6.0. No remote state changed.

## Current PR validation and read-only staging smoke (2026-09-29 05:43 JST)

PR #41 at `787036c` passed both GitHub validation jobs in run `36480072183`:
the Cloudflare staging application and Worker API/D1 contract suites. Its
Supabase Preview job was skipped by workflow design. The PR remains a draft.

A read-only HTTP smoke against the configured workers.dev URL returned 200 for
the app root, `/robots.txt`, Better Auth `/api/auth/ok`, and
`/api/auth/get-session`; anonymous `/api/admin/session` returned 401 and
`/api/stripe/webhook` returned 404. These checks confirm route health and the
intended closed Stripe route, but do not identify the deployed version or
verify D1/R2 state. Wrangler `whoami` still returns the fragrance.radio account
while the staging config targets the fanmark.id account. No remote D1/R2 write,
deployment, production route, user data, or domain/DNS change occurred.

## Scheduled Stripe dispatcher microsecond compatibility (2026-09-29 JST)

The dispatcher converts Workers `scheduledTime` into fixed-width UTC
microseconds. The invoice and subscription projection entrypoints previously
validated only JavaScript's three-digit `Date#toISOString()` form, so both
scheduled paths returned `retryable` before application. They now normalize
millisecond clock strings and exact microsecond strings, and lease-duration
arithmetic preserves the final three fractional digits. Regression tests run
the synthetic D1 dispatcher with a six-digit scheduled timestamp and read back
the exact application timestamp. Shared timestamp tests pass 6/6; the full
Stripe webhook/receipt/dispatch/invoice/subscription suite passes 63/63, and
Worker TypeScript checking passes. No Stripe API call, user data, remote D1,
production deployment, or domain/DNS change occurred.

## Wrangler target-account authentication and business trigger migrations (2026-09-29 JST)

Created the dedicated `fanmark-staging-inapp` Wrangler profile through the
Cloudflare OAuth flow and bound it to this managed worktree. `wrangler whoami`
confirmed `fanmark.id@gmail.com` and the account ID pinned by the staging
configs (`bfc2890741f0b3fb236e2d755b6c9adc`). The profile has the D1 and Worker
scopes used by staging commands; it does not include public route or DNS scopes.
The pre-existing `default` profile remains associated with a different
account and was not used.

Read-only inventory found the three configured staging D1 databases and the
avatar, cover-image, and private migration-backup R2 buckets. Auth and emoji
master D1 had no pending migrations. Business D1 had only
`0018_invitation_capacity_timestamp_precision.sql` and
`0019_extension_coupon_timestamp_precision.sql` pending. Before applying them,
the invitation code/attempt tables, coupon-use table, and coupon-application
command table each had zero rows; the four non-user coupon master rows remained
present. The two local focused suites passed: invitation signup 10/10 and
extension-coupon application 8/8 (Node 25.5.0).

Applied both forward migrations to the account-pinned APAC staging business
D1. Wrangler reported success for each migration, and the remote migration
ledger now reports no pending migrations. Readback confirmed both trigger
definitions use the exact fixed-width timestamp comparisons from the checked-in
SQL. The five preflight counts were unchanged (0, 0, 4, 0, 0), and D1 reported
zero rows written by the readback. This changed staging schema only; no
application rows were imported, no Supabase migration or Worker deployment
was run, and production routing, real user data, Stripe configuration, and
domain/DNS remain untouched. This supersedes the earlier note that the
account mismatch blocked all Wrangler readback and writes.

## PR #41 application staging deployment (2026-09-29 JST)

The current checked-in application Worker was deployed to the APAC
`fanmark-app-staging` workers.dev service after the staging build, Worker
typecheck, and Wrangler dry-run succeeded. Wrangler reports version
`f6c3ee8d-baca-4938-853c-1ba3b1eaaa62` at 100%. The deployed JS asset
`/assets/index-B6IkPHSy.js` is 2,499,186 bytes and its SHA-256 matches the local
staging build (`c3cb8dcd9a722255414e4c48c841a12de36455a9ae2907ed5535b10765001b74`).

Read-only HTTP checks returned 200 for `/`, `/robots.txt`, `/api/auth/ok`, and
`/api/emoji/catalog`; the catalog and health responses are `no-store`. An
anonymous `/api/admin/session` returned 401 and `/api/stripe/webhook` returned
404, as the Stripe webhook selector/secrets are not enabled. Post-deploy
readback found zero notification events/inbox/history rows and zero Stripe
receipt, dispatch, application, subscription-return, extension-application,
plan-checkout, or plan-change rows. Both declared Cron schedules remain
configured; no real email, payment, user data, production route, or domain/DNS
was exercised or changed. This staging deployment improves runtime evidence
but does not materially change the coarse migration progress estimate.

## Persisted-log staging Cron probe and CI (2026-10-02 JST)

Commits `d461c33` and `9561109` add a guarded synthetic Cron observability
probe, focused tests, and explicit failure/cleanup targets. The temporary
Worker `fanmark-cron-observability-a5f6043b` was deployed using the dedicated
`fanmark-staging-inapp` profile with an every-minute Cron, no D1/R2/secret
bindings, and persisted Workers Logs enabled at full sampling with invocation
logs included. A synthetic GET returned 200 and appeared in its Worker-specific
saved logs. More than 15 minutes after deployment, that view still contained
only the GET and no scheduled invocation record. The probe was deleted, and a
post-delete deployment readback returned Cloudflare error 10007 (Worker does
not exist). The three existing staging D1 databases remain the only D1s in the
account inventory. The existing `fanmark-app-staging` request-log settings
were not changed; its saved logs remain disabled.

The probe tests pass 4/4; `npm run test:migration-data` passes 198/198;
`npm run check:ci`, `npm run typecheck`, targeted ESLint, and `git diff --check`
pass. GitHub Actions run `36892893711` passed both staging-application and
Worker-API jobs on head `9561109`. Repository-wide `npm run lint` still fails
on existing unrelated/generated files (105 errors and 27 warnings); targeted
lint for the changed files passes. The empty Cron log confirms that the
configured persisted-log pipeline did not record a scheduled invocation, but
does not by itself distinguish non-delivery from invocation-log visibility.

Cloudflare says Cron trigger changes may take up to 15 minutes to propagate,
new Workers may take up to 30 minutes to show historical Cron Events, and
Workers Logs can persist Cron invocation records. The probe exceeded the
propagation window and verified the logging configuration. See [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Do not repeat the full synthetic recovery drill until this invocation path is
understood. No real user data, production routing, or domain/DNS state was
accessed or changed.

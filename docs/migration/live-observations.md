# 本番読み取りの観測記録

観測日時: 2026-09-20T16:18:46.451758+00:00
親: #28、棚卸し: #30。これは移行・本番設定変更の実施記録ではない。

## 確認できたこと

- Supabase CLIの既存認証でプロジェクト状態・Functions一覧・publicスキーマの型を読み取れた。fanmark.idはACTIVE_HEALTHY、PostgreSQL 17.6.1.005。
- `supabase gen types typescript --project-id <fanmark-project-ref> --schema public` の結果は40テーブル、1ビュー、45関数。checked-in型と名前集合が一致。publicスキーマブロックの一致: true。型全体にはPostgREST版（13.0.5→14.5）と生成ヘルパー構文差がある。型定義ではRLS/trigger/cron/実データの整合は確認できない。
- 本番Functionsは35件、ローカルentrypointは34件。本番のみの `manual-expire-grace-licenses` が存在する。ダウンロードしたコードを読み取ったが呼び出していない。移植/廃止/権限制御の確認対象として残す。
- 既存checkoutのlinked project refが対象と一致することを確認し、`supabase inspect db db-stats` / `table-stats` をread-only実行。DB容量は26 MB。Storageファイルの容量は含めた確認にならない。table-statsの行数は推定値で、移行の件数照合には使わない。CLI v2.67.1では `--output json` を付けてもこの2コマンドは表形式だった。
- 公開Auth settingsのread-only取得でApple/Google/GitHub/Discord/emailがenabled、disable_signup=false、mailer_autoconfirm=falseを確認。各OAuthアプリのcallback設定や実ログイン、アプリ側の招待制御を検証した結果ではない。
- `default_transaction_read_only=on` を指定したカタログ問い合わせで、publicの40テーブル・77 RLS policy・58関数・144制約・36ユーザー定義triggerを確認。全40テーブルでRLS有効。生成型の45 RPCだけをDB関数の全件と扱わない。関数本体の内容は公開記録に保存せずhashで識別する。
- GitHubの既存Environmentは `Supabase`。観測時のprotection_rulesは空。Environment指定だけで承認保護が有効とは扱わない。

## 本番のみの関数について

本番のみの関数は移行対応表の未解決項目とし、用途・権限制御・既存の期限処理との関係を確認する。稼働していることだけを理由に、そのまま移植または削除しない。

## 未確認

本番RLS/制約/関数本体/triggerの意味と移行先への対応、cron実行先と停止/再開、整合したsnapshotでの件数照合・Storage実ファイル容量、AuthのID対応・実ユーザーhash互換・MFA移送、Storageキー/所有者/ハッシュ、Stripe顧客と契約対応、OAuth管理画面、DNS委任/TLSと実フロー、Resend設定、停止時間・復旧時間目標。本番のexport/importやデータ更新は未実行。Cloudflare環境の準備と認証検証も未完了。

## 証拠の扱い

型出力SHA-256: `da9ea976d60f79795bf959a960696fe27951855e5e3a8b4214f535f1b28fc6e2`。Functions一覧は名前・状態・バージョン等のメタデータのみ参照。データ行・認証秘密情報をこの文書へ保存しない。CLIのtemporary出力は成果物の正とせず、再確認時は同じread-onlyコマンドを実行する。

生成型のRPC名に含まれないカタログ上の関数名: `activate_notification_worker_on_pending_event`, `handle_new_user`, `link_fanmark_discovery_trigger`, `log_emoji_master_changes`, `log_lottery_entry_changes`, `log_profile_cache_access`, `log_waitlist_access`, `notify_security_breach`, `prevent_user_settings_insert_escalation`, `prevent_user_settings_privilege_escalation`, `sync_public_profile_cache`, `update_updated_at_column`, `validate_display_name`。名前差分であり、廃止可能という判定ではない。

read-only SQL接続では `audit_logs` のSELECT権限不足だった。別途、既存の管理権限で取得したAPI資格情報をプロセス内だけで使用し、REST HEAD + count=exactで全40テーブルの件数を取得した。レスポンス本文のデータ行は取得せず、資格情報も保存していない。件数は別々のリクエスト時点の観測であり、整合したsnapshotや最終移行照合ではない。個別件数は公開リポジトリに載せない。table-statsの値は引き続き推定値として区別する。

## ブラウザによる環境確認（2026-09-21 JST）

- Supabase Settings > General は `auth.fanmark.id` を active custom domain と表示し、serving traffic と明記していた。以前のAPI取得403を「未設定」と解釈しない。この表示だけでは全OAuth callback/メールリンクの動作までは証明しない。
- Cloudflare の fanmark.id ゾーンは、既存 Wrangler OAuth のアカウントとは別のアカウントに属していた。既存CLIで取得したD1一覧は別アカウントの一覧であり、fanmark用D1の存在確認には使えない。
- ブラウザで確認したfanmark側account IDを明示した `wrangler d1 list --json` は authentication error 10000。対象アカウントのCLI権限が必要で、新しいremote D1/Workerは作成していない。別アカウントへ代替配備しない。
- fanmark.id のDNS画面では apex / www / admin は同じ既存Aレコード、authは現行SupabaseプロジェクトへのCNAMEで、いずれもproxy有効。DNS変更はしていない。DNS画面内のNSレコードだけからレジストラの委任先は判定しない。


## SQL Editorでの追加集計（2026-09-21 JST）

CLIのSQL接続はauth schemaの権限が不足していたが、既存ブラウザセッションのSupabase SQL Editorでは `BEGIN READ ONLY` による集計を実行できた。認証情報・ファイル内容・ユーザー行・cron command本文は返していない。再現用SQLは `scripts/migration/auth-readiness.sql` と `scripts/migration/storage-cron-readiness.sql`。SQL Editorでそれぞれ3行と2行の集計結果を確認した。両クエリ間でsnapshotは共有しない。

- パスワード形式の観測はbcrypt `$2a$10$`。これは形式・costの集計確認であり、実際のパスワードhashのexport/importやログイン検証ではない。
- identity providerの集計にemail / Apple / Google / GitHub / Discordが存在。provider別の件数は複数連携を含み、ユーザー数と同一視しない。
- MFA factorにはverified TOTPが存在。secretの可搬性や復旧手段は未確認。
- Storageには `avatars` と `cover-images` のpublic bucketが存在。このSQL集計ではobject件数・metadata上の容量だけを取得した。その後、認証付きStorage APIでファイル本体を取得し、metadata size・SHA-256・取得前後の一覧一致とローカル再検証を完了した（[storage-baseline.md](storage-baseline.md)）。これは一時baselineで、確定snapshot・R2照合ではない。
- cronは `check-expired-licenses-daily`（`0 0 * * *`、active）と `process-notification-events-every-minute`（`* * * * *`、観測時inactive）。後者はオンデマンドの有効化設計と整合するが、この瞬間のinactiveだけでワーカー不要とは判断しない。実行先・時刻設定・停止/再開は引き続き検証対象。

集計の個別件数はローカルの非公開運用記録に保持し、公開リポジトリには保存しない。

認証URL設定のブラウザ確認ではSite URLは `https://fanmark.id/`、redirect許可リストはfanmark.idと既存Lovableの4パターン（計5件）だった。将来のWorker preview URLを既に許可済みとは扱わない。許可リストは変更していない。

Google Cloud の既存fanmark-id OAuthクライアント画面では、JavaScript originは `https://fanmark.id`、redirect URIは `https://auth.fanmark.id/auth/v1/callback` の各1件。新Better Auth callbackを既に許可済みとは扱わない。クライアントやsecretの作成/変更はしていない。

Apple Developerでは既存Services ID `id.fanmark.login` にSign in with Appleが有効、Primary App IDはFanmark。Web Authenticationの登録ドメインは `auth.fanmark.id` / `fanmark.id`、Return URLは `https://auth.fanmark.id/auth/v1/callback` を確認した。既存のFanmark用Sign In Keyも一覧に存在するが、秘密鍵は取得/再発行していない。Appleも新callbackの登録と実フロー検証が必要で、現在の設定を変更していない。

対象CloudflareアカウントのWorkers & Pages一覧は「No projects found」。Workersのプラン画面ではFreeが「現在のプラン」で、CPU上限は10 ms/requestと表示されていた。認証のlocal wall-clock検証ではこのCPU制限内の動作を証明できない。remote CPUを測定し、必要なプランを決めるまで認証の本番適合とは判定しない。プラン変更・課金は行っていない。

Resendのfanmark.id workspaceで、送信ドメイン `fanmark.id` はVerified。メール送信や鍵の表示/変更は行っていない。Stripeについては本番/テストの配信先・API version・DB内契約との対応確認を継続する。コードの存在だけから現行Webhookが正常配信中とは扱わない。

## Wrangler認証と隔離D1（2026-09-23 JST）

ユーザーがCloudflare OAuth画面でAuthorizeし、`wrangler whoami`で対象アカウントとD1 write権限を確認した。対象アカウントのD1一覧は空だったため、公開絵文字マスター用の`fanmark-emoji-master-staging`をAPACに作成した。`0000` canonical schema、`0001` versioned staging、`0002` inactive activation schemaのみを適用。`0003_better_auth_core.sql`はWrangler remote SQL処理で`incomplete input`となり未適用。Node 22.6.0で検証したreleaseだけをreadyにし、Authテーブルは存在しない。remote catalog readback/hashの詳細は[emoji release記録](emoji-releases.md)。

同日、`fanmark-emoji-master-staging-api`を`workers.dev` (`https://fanmark-emoji-master-staging-api.fanmark-id.workers.dev`) に配備。bindingは上記隔離D1のみ、設定したCORS originは`https://fanmark.id`。version `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`を指定した遠隔API読出しで3,944件全てを成果物と比較し、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`が一致した。version省略は503、許可外originは403、非GETは405、`/api/auth/session`は404。全応答no-storeでCookieなし。Workerは公開master専用でSPA未接続、active pointer・Auth・ユーザーデータは未設定。

`wrangler r2 bucket list` はCloudflare error 10042 `Please enable R2 through the Cloudflare Dashboard` で失敗。アカウントでR2をまだ有効化できておらず、bucket作成・Storage objectの転送は未実施。Supabase Storageにある`avatars` / `cover-images`の実ファイル移行はユーザーデータ段階まで保留。

## R2アプリAPIのローカル検証（2026-09-23 JST）

WorkerにBetter Auth session確認付きのR2 Storage APIを追加し、ローカルMiniflare D1/R2で合成アカウントを使って検証した。5テストが成功し、公開read、所有者のみdelete、認証、CORS/Origin、avatar 1 MiBとcover 2 MiB上限、画像signature、未設定backend時のfail-closedを確認。API typecheckと既存Better Auth route 5テストも成功。R2を有効化していないためCloudflare remoteにはbindingを付けず、実bucket/objectsは未作成。フロントのavatar/cover hookはBetter Auth UI/sessionが未移植のためSupabase Storageを維持。実Storage inventory/object transferはユーザーデータ移行段階まで未実施。

その後、`fanmark-app-staging`をversion `c45c7085-387b-44e6-9038-b1d52382dc7f`へ更新。`wrangler d1 migrations list`は`No migrations to apply`。隔離Workerの`/api/auth/ok`と版固定catalog APIは200、rootは`X-Robots-Tag: noindex, nofollow`。`POST /api/storage/object/avatars`と`GET /api/storage/public/avatars/synthetic/object.png`はどちらも503 `storage_unavailable`。R2 bindingは含めず、bucket/object、実user/Authデータ、custom domain/DNSは変更なし。

## App staging WorkerとBetter Auth API（2026-09-23 JST）

`fanmark-app-staging` Worker version `b69bdc6b-7faa-4dca-b994-53251eca3fbe`を`https://fanmark-app-staging.fanmark-id.workers.dev`へ配備。上記APAC D1をbindingし、`AUTH_BACKEND=better-auth`とHTTPSの`BETTER_AUTH_URL`を設定した。32文字以上のstaging専用ランダム`BETTER_AUTH_SECRET`はCloudflare Secret Storeへ直接登録し、値は出力・保存していない。`STAGING_NO_INDEX`を有効化し、rootに`X-Robots-Tag: noindex, nofollow`、`robots.txt`に全体Disallow、`sitemap.xml`は404を確認した。

`0003_better_auth_core.sql`は通常のremote `migrations apply` query経路だと`incomplete input`だが、Wrangler remote `--file` importなら適用できることをローカルD1で先に再現確認。migration SQLと標準の`d1_migrations`記録を一つのtransactional file importとして適用した。remote readbackはAuth table 8件、MFA generation trigger 6件、generation singleton 1件・generation=0、migration ledger 1件。user/account/session/verification/twoFactor/adminRole/mfaAssuranceは全て0件で、`d1 migrations list`もpendingなし。

Worker APIのread-only確認: `/api/auth/ok` 200、未認証`/api/auth/get-session`は`null`、許可外Originは403、signupは403で閉じている。synthetic `example.invalid` userだけを一時投入し、正passwordでsign-in/session/logout、誤password 401を確認後にuserごと削除。最終readbackで全Auth user-owned rowsが0件。メール配信/OAuth/signupは起動しておらず、Auth UIもSupabase contextのままで切り替えていない。SPA Worker経由で固定versionのカタログ3,944件を再取得し、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`を独立artifactと照合して一致。production DB、production app、OAuth provider、public hostname/DNSは変更していない。R2は引き続き未有効でbucket/objectは未作成。

## 最近取得一覧の定義確認（2026-09-21 JST）

読み取り専用のcatalog queryで `recent_active_fanmarks` の定義・security_invoker設定と `list_recent_fanmarks(integer)` の関数定義を確認した。active licenseとfanmarksのjoin、license側の表示・作成日時、RPCの作成日時降順・件数制限が現行条件。ユーザー行は取得していない。`scripts/migration/recent-contract-readiness.sql` はview定義と関数metadata/fingerprintを返す再現用SQLで、実行済み。詳細とD1移植時の注意は `object-map.md` / `recent-api-contract.md` に記録する。

## 絵文字マスターのremote activation（2026-09-23）

Better Auth schema適用後の再stage guardを実行し、4 migrations、Auth schema 8表、user-owned Auth行0、MFA generation=0を確認。canonical `emoji_master` 3,944件とready release 3,944件が一致し、staging前後のactive pointerとactivation historyは不変。続いて期待active state=`none`のremote activationを行い、release `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`をgeneration 1へ昇格。active pointerとhistoryは各1件。

`https://fanmark-emoji-master-staging-api.fanmark-id.workers.dev/api/emoji/catalog`は未active時503から200になった。版なしAPIをlimit 500で8ページ取得し、3,944行、`recordsSHA256=84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、`identitySHA256=dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`、versionが独立成果物と一致。user/account/session/verification/twoFactor/adminRole/mfaAssuranceは0行。production app/DB、Supabase write、R2、user data、custom domain/DNSは変更なし。

## R2と非ユーザー系マスターの再確認（2026-09-23 JST）

Cloudflare認証後に`wrangler r2 bucket list`をread-only実行したが、error 10042 `Please enable R2 through the Cloudflare Dashboard`で失敗。R2 subscription/bucketは未有効・未作成のまま。Cloudflare公式の開始手順はR2 subscriptionをダッシュボードのcheckoutで追加するよう案内し、Standardには月次無料枠がある。R2の有効化は未実施。

Supabase SQL Editorの新規タブから、`fanmark_tiers`、`languages`、`reserved_emoji_patterns`だけを明示列挙した単一read-only SELECTを実行し、各4、4、5行を確認。各表の列とPostgreSQL `numeric(10,2)`の表示精度を保つCSVを非公開の一時領域へ保存した。型付きJSON snapshot SHA-256は`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`。表ごとの原本hashはtier=`d1e407e86d72ebb4be6ab3b39c50b04da0fae3222e8b6ba3b29d1ffd17682084`、language=`faba8449e8838a8b8982000d0582ba96aab476d296bbbc4b91fa7e704aacc637`、reserved pattern=`36155076b6810d1a4a8813eb97cbc5ee0f11b3977e4ecf78d449d257b57762b2`。実データの行内容はリポジトリへ保存していない。

この3表だけを対象に、`0004_reference_master_releases.sql`、exact cents変換、版付きstage/readback/activationと3つのactive viewを実装。Node 22.6.0のMiniflareで5テストが成功し、実データsnapshotから生成した版もローカルでreadbackした。`monthly_price_usd`の原本文字列は浮動小数点を通さず整数centsへ変換し、D1 viewも既存Worker repositoryが期待するcents表現を返す。

追加の隔離ローカル証明として、Wrangler local D1へ`0000`–`0004`全migrationを適用し、同じsource snapshotから生成した20文のstage/activation SQLを実行。stage表・active view・各source row hash/件数を表ごとに比較し、tiers 4/4、languages 4/4、reserved patterns 5/5が全件一致、active generation 1、migration ledger 0004ありを確認した。これはlocal persistent D1での実データ整合証拠で、remote stagingへの書込み証拠ではない。

リモート状態は未変更。Wranglerでは対象email/accountとD1 database一覧を確認できたが、D1 query endpointがerror 7403 `The given account is not valid or is not authorized to access this service`を返した。Cloudflare Dashboard D1 Studioからのread-only確認ではapplied migrationは`0000`–`0003`のみ。`0004`は未適用で、master release rowsとactive pointerも未作成。Supabaseの既存未保存emoji queryは変更していない。`system_settings`、Auth、ユーザー行、Storageにはアクセスしていない。

## 非ユーザー参照マスターのRemote反映とapp staging更新（2026-09-23 JST）

Wrangler remote D1 read/writeが利用可能になったことをread-only queryで確認し、APAC `fanmark-emoji-master-staging`へmigration `0004_reference_master_releases.sql`と標準`d1_migrations` ledgerを含む非公開SQL artifactを適用した。Cloudflare readbackで`0000`–`0004`を確認。

非公開source snapshot (`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`)から、`fanmark_tiers` 4件、`languages` 4件、`reserved_emoji_patterns` 5件をready releaseとしてstageした。Remote helperが各列、件数、source hashを比較し、8 Auth schema tablesの存在、user-owned Auth rows 0、MFA generation 0、絵文字releaseのpointer/history不変を確認。続けて同releaseをgeneration 1として有効化し、active viewsもsnapshotと全列一致した。active pointer/historyは各1件。

最初のpromotion後readbackは、JSON property insertion orderだけが異なる行を不一致として扱った。値は一致し、件数・release状態・activation auditも正しかった。キー順を正規化して比較する実装へ修正し、5件のMiniflare release testsとtypecheckを通した後、remote scriptをready-release再利用・generation 1維持で再実行し、active view readbackを成功させた。

続けて`fanmark-app-staging`をversion `caebcf9a-236a-4e1d-a89d-8940ad461c44`へworkers.dev限定で配備。read-only HTTP確認ではroot 200 + `X-Robots-Tag: noindex, nofollow`、`robots.txt`で全体Disallow、`sitemap.xml` 404、Better Auth health 200、未認証session `null`を確認した。カタログAPIは8ページ・3,944行を返し、version `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`、records hash `84a67b361adf96534bc6e564ec7510249758c2b20492e4d0b97acc7fd88309c0`、identity hash `dddd7cf13528dd44f2bb1329ed1167f83fb30e63504fdd1c673845467ab402fc`が一致した。Storage public GETはR2 bindingなしで503 `storage_unavailable`となりfail closed。custom domain/DNS、user data、Supabase production writesは変更なし。

## Better Auth staging UI接続（2026-09-23 JST）

staging modeの認証画面を、同一workers.dev origin上のBetter Authへcookie付きHTTP接続した。ログイン後のsession refresh、server logout、stagingでのsignup/social/reset/password-setup抑止を追加。Node 22.6.0のfrontend helper 5 tests、typecheck、buildが成功し、Wrangler dry-run後に`fanmark-app-staging` version `36183ffc-bfa4-4d64-b2ff-42ea9a7392dc`をdeployした。

deploy後のread-only確認でroot 200/noindex、robots全体Disallow、`/api/auth/ok` 200、cookieなしsession 200/null、catalog `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed` 200、R2 public read 503 `storage_unavailable`を確認。remote Auth user/account/session/verification/twoFactor/adminRole/mfaAssuranceは各0行。bundleにはBetter Auth endpointが入り、production Supabase URLはなく、synthetic fixture URLだけを含む。ブラウザでの資格情報を使った成功ログイン、業務API/管理認可、プロフィール・upload hookの切替は未完了。

R2は引き続き未有効。Cloudflare公式開始手順はDashboard上のR2 subscription checkoutを要求する。Standardの月間無料枠はstorage 10 GB-month、Class A 1M、Class B 10Mで、egressは無料。無料枠超過分は従量課金となる（[料金](https://developers.cloudflare.com/r2/pricing/)、[開始手順](https://developers.cloudflare.com/r2/get-started/)）。checkout、支払い方法、bucket作成はこの作業では行っていない。

## Versioned reference-master API deployment (2026-09-23 JST)

Workers API version `3f597b51-f8b5-490c-bd0f-b2a0929de03e` was deployed to the existing `fanmark-app-staging` workers.dev URL. Wrangler dry-run showed the existing APAC D1 binding and `REFERENCE_MASTER_BACKEND=d1`; it showed no R2 binding. The deployment had no new D1 migration.

Read-only HTTP verification returned 4 tiers, 4 languages, and 5 reserved patterns from release `5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`, each with `Cache-Control: no-store`. Root noindex, Better Auth health, a disallowed-origin 403, and unknown-route 404 also passed. The staging frontend was rebuilt with `VITE_LANGUAGE_READ_BACKEND=worker`, the explicit staging Worker base, and `VITE_STORAGE_BACKEND=supabase`; only the language-list read moved to this Worker endpoint. No business schema, user row, Storage object, R2 subscription, production service, or public hostname changed.

The deployed staging root returned 200 and referenced `/assets/index-D9g1SPCB.js`. The asset returned 200 at 2,226,607 bytes with SHA-256 `39527db73319969d89182f905da08f642a99c7a7a5bc85470addeed275dd4914`, matching the local staging build byte-for-byte. Its compiled environment values select `VITE_LANGUAGE_READ_BACKEND=worker` and retain `VITE_STORAGE_BACKEND=supabase`; the language route string is present. This verifies the static selector in the deployed bundle, not a full browser interaction or a broader app/data cutover.

## App Worker admin session gate (2026-09-24 JST)

After the local synthetic D1 tests and Wrangler dry-run, `fanmark-app-staging` was deployed to its existing workers.dev URL as version `73b2724e-4abd-4ab6-a0bd-8e3a66cb7760`. The deploy used the existing APAC D1 binding and made no schema migration. An unauthenticated `GET /api/admin/session` returned `401 {"error":"unauthenticated"}`. An `OPTIONS` request from the configured staging origin returned `204`, `Access-Control-Allow-Credentials: true`, and the exact allowed origin. This live check covers routing, origin/CORS configuration, and the anonymous denial only; a remotely authorized admin session was not created or tested. No Auth/business row, Storage object, R2 bucket, production service, or public domain/DNS was changed.

## Existing staging D1 object-name collision (2026-09-24 JST)

Read-only `sqlite_master` inspection of `fanmark-emoji-master-staging` confirmed that it already contains `emoji_master`, the Better Auth schema, and active reference-master views named `fanmark_tiers`, `languages`, and `reserved_emoji_patterns`. The source-shaped 40-table business schema includes objects with these names, while the importer and credential profile verifier require an exact target object set. Therefore this D1 cannot safely serve as the business schema/import target. No rows or secret values were queried in this inspection, and no remote schema or binding was changed.

The Worker now has explicit local role selection: `FANMARK_DB` for business data, `AUTH_DB` for Better Auth, and `MASTER_DB` for emoji/reference data when `D1_TOPOLOGY=split`; missing bindings fail closed. Isolated availability fixtures use distinct local business/master D1s. At the time of this inspection the app Worker still used its previous single-D1 config; the dedicated targets and split staging deployment are recorded below.

## Split D1 and R2 staging deployment (2026-09-24 JST)

After confirming the account was still on Workers Free and had only the existing APAC master D1, created `fanmark-business-staging` (`d4bb0c48-f24a-491f-8693-fa393ab0b873`) and `fanmark-auth-staging` (`2116bc43-32ab-4e3e-b762-9378df88b95f`) in APAC. The business D1 remains empty. The new Auth D1 received only `0003_better_auth_core.sql` plus one `d1_migrations` ledger row using Wrangler's remote file-import path; the usual remote `migrations apply` path returned `incomplete input` and rolled back, then read-only inspection confirmed the DB still had no application tables before the file import. Final readback found 8 Auth tables, 6 MFA generation triggers, `mfaGeneration=0`, one migration record, and zero user/account/session/verification/factor/adminRole/assurance rows. The pre-existing master D1 was not modified during this split.

After the user enabled R2, created empty APAC Standard buckets `fanmark-avatars-staging` and `fanmark-cover-images-staging`. Updated and deployed `fanmark-app-staging` as Worker version `2dd73277-d1db-4b4a-a7da-0a82815791de` with `D1_TOPOLOGY=split`, the three role-specific D1 bindings, both R2 bindings, and `STORAGE_BACKEND=r2`. Wrangler dry-run confirmed the binding map before deployment. Live read-only checks returned root 200/noindex, robots Disallow, auth health 200, no-cookie session `null`, anonymous admin session 401, emoji catalog 200, reference languages 200, unknown avatar/cover keys 404 (R2 binding reached), and unauthenticated upload 401.

A temporary `example.invalid` Auth account was inserted only into the new Auth D1 to verify the live Storage flow. The Worker issued a session, accepted a 16-byte synthetic PNG, served the exact bytes publicly, enforced owner deletion, and returned 404 after deletion. The object was removed through the Worker API; the temporary user was deleted and final aggregate counts for all user-owned Auth tables were zero. No Supabase Storage object was read or copied. Both staging buckets are empty. Current R2 Standard allowances are 10 GB-month, 1 million Class A, 10 million Class B operations, and free egress; the one tiny synthetic upload/read/delete remained within them. Account invoice/usage dashboard was not inspected, so billing-line status is not independently confirmed. The frontend storage selector remains `supabase`; business D1 schema, real-user/Auth migration, production, and domain/DNS remain unchanged.

## Supabase source-schema refresh initial attempt (superseded, 2026-09-24 JST)

The global Supabase CLI profile can list the configured project, but this
migration worktree has no local Supabase project link. A project link was
created only in a private `/tmp` CLI directory. The subsequent schema-only
`supabase db dump --linked --schema public` initialized the temporary
`cli_login_postgres` role through Supabase, then failed because Docker Desktop
was unavailable. Supabase documents this as a short-lived CLI role that expires
within minutes; the CLI log reached the schema-dump step, but `pg_dump` never
ran. It left only an empty 0-byte local SQL file, which was removed with the
temporary config. No application schema or rows were read or changed. See
[Supabase's CLI login-role note](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae).

At this checkpoint, the generated D1 catalog dated from 2026-09-20, so refreshing
the source schema remained a prerequisite. This initial Docker blocker was later
resolved; the successful refresh and current state are recorded below.

## R2 confirmation and schema-refresh state at that checkpoint (superseded, 2026-09-24 JST)

After the user confirmed that R2 was enabled, `wrangler r2 bucket list`
returned `fanmark-avatars-staging` and `fanmark-cover-images-staging`.
`wrangler deployments list --name fanmark-app-staging` showed the 100% current
deployment at version `2dd73277-d1db-4b4a-a7da-0a82815791de`. The frontend
storage contract suite passed 7/7 tests and the Worker D1/R2 suite passed 5/5.
This reconfirms the staging R2 prerequisites; it does not move the frontend
selector or user objects.

At this checkpoint the first schema-refresh attempt had failed because Docker
was unavailable. That was a point-in-time status, not a process paused for
terminal input; the later successful refresh below supersedes it.

## Successful current source-schema refresh (2026-09-24 JST)

After Docker Desktop was started, `supabase db dump --linked --schema public`
completed from a temporary Supabase CLI directory outside the repository. It
produced a private 180,288-byte schema-only DDL file (mode `0600`, SHA-256
`aac7f38c912b358019a9bb9f282813a10bcd3e20af09e929d1ec41a2705b42cd`). It has
no top-level `COPY` or `INSERT` statements, so this did not export application
rows. The refreshed public catalog reports 40 tables, one view, 58 functions,
36 triggers, 77 RLS policies, 406 columns, 144 constraints, 139 indexes, and
15 enum labels.

The DDL was loaded into a disposable local PostgreSQL 17 container and passed
through the schema-readiness query and D1 converter. The generated SQL parsed
in in-memory SQLite: 40 tables and 63 indexes were present, and
`PRAGMA foreign_key_check` returned no rows. The conversion report still has
20 unresolved gate groups and `deployable: false`; this is a structural
rehearsal, not approval to install the partial DDL. No business DDL was applied
to Cloudflare; `fanmark-business-staging` remains empty. The disposable
PostgreSQL container was stopped and removed, and private DDL/catalog/output
artifacts remain outside the repository.

Fresh CLI type generation produced a `public` TypeScript schema block matching
the checked-in block (SHA-256
`6253c1edcd11f95ab0fc6c66937dfc7fe03c1aaafcfa9d467a65d11e022bfb31`). Supabase
migration-history comparison found no remote-only IDs; these three repository
migrations remain local-only and were not part of the current remote schema:
`20260921090000_add_stripe_receipt_foundation.sql`,
`20260921100000_add_stripe_dispatch_leases.sql`, and
`20260921110000_add_stripe_invoice_projection.sql`.

The schema-only DDL refresh is complete; no terminal input is currently
required. At this 2026-09-24 checkpoint, the later-added database-locale
catalog field still needed a fresh read-only source query before it could
inform the three regex checks. That query was completed in the 2026-09-25
catalog refresh recorded in [schema generator](schema-generator.md); this
historical checkpoint is not a current input blocker. The remaining gates are
resolving semantic/operation parity and validating the synthetic business API
before installing any schema in business staging.

## Current Cloudflare staging readback after Wrangler reauthorization (2026-09-24 JST)

Wrangler initially returned Cloudflare authentication error 10000 during the
current read-only check. The existing `fanmark.id` Cloudflare account then
reauthorized Wrangler through its OAuth consent page, and `wrangler login`
completed successfully. This refreshed the local CLI authorization only.

The subsequent account-wide D1 inventory listed the existing
`fanmark-emoji-master-staging`, `fanmark-auth-staging`, and
`fanmark-business-staging` databases. A remote read-only `sqlite_master` query
against `fanmark-business-staging` returned only Cloudflare's internal
`_cf_KV` table; no application business schema is installed. R2 inventory
listed the two staging buckets `fanmark-avatars-staging` and
`fanmark-cover-images-staging`.

At that checkpoint the 100% app Worker deployment was version
`af25a447-01f2-4fee-a273-21cace0522ca`. The latest staging deployment and
read-only verification are recorded below.

## Latest staging app Worker deployment (2026-09-24 JST)

After the local build, API tests, CI-isolation check, and Wrangler dry-run
passed, `fanmark-app-staging` was deployed to its existing workers.dev URL as
version `6349616f-5634-4d53-9089-e606ca0ac9c9`. The dry-run confirmed the split
business/Auth/master D1 bindings, both R2 buckets, Static Assets, synthetic
Supabase configuration, and `STAGING_NO_INDEX=true`. No D1 migrations ran and
no D1 or R2 writes were made by this deployment.

Read-only HTTP checks returned root 200 with `noindex, nofollow`, robots
`Disallow: /`, sitemap 404, Better Auth health 200, no-cookie session `null`,
anonymous admin session 401, emoji catalog 200, and all three reference-master
APIs 200. Unknown API paths returned 404. A direct remote `sqlite_master`
query against `fanmark-business-staging` returned no application tables. The
deployment does not move the frontend's default auth, public-read, verified
access, business-data, or Storage selectors. Production app, production
Supabase, user data, and public DNS were not changed.

## Versioned tier reader in the staging admin UI (2026-09-24 JST)

The Cloudflare staging build sets `VITE_REFERENCE_MASTER_READ_BACKEND=worker`
for the extension-coupon tier projection. `AdminExtensionCoupons` reads the
four active tier options from `GET /api/reference-masters/fanmark_tiers`. This
call sends no cookies, requires `no-store`, validates the release-bound DTO,
and rejects incomplete or duplicate tiers. If that read fails, the page
disables creation of a new coupon instead of using hard-coded tier values.
Coupon writes and editable tier-day settings remain on Supabase.

After the build and dry-run, the app Worker was deployed as version
`82ce7520-1977-470a-89fd-c875c5ef116c`. Post-deploy read-only verification
returned root 200/noindex, the deployed JS asset 200 containing the tier route,
and the tier API 200 with levels 1–4 and `Cache-Control: no-store`. No D1 or
R2 write was made; no user data, production service, or public DNS changed.

## Cloudflare staging admin authentication connection (2026-09-24 JST)

The `cloudflare-staging` frontend mode now uses Better Auth for the admin sign-in path and `GET /api/admin/session` for the authoritative role/MFA decision. The screen handles Better Auth's TOTP sign-in challenge and first-time enrollment, including its returned recovery codes. The Worker distinguishes missing/unverified TOTP setup (`mfa_enrollment_required`) from a verified factor without valid same-session assurance (`mfa_required`). Supabase-mode admin login and MFA remain unchanged; admin CRUD and business-data authorization are separate work.

Node 22.6.0 verification passed: 9 Better Auth client tests, 9 Worker Auth/D1 tests, frontend and Worker typechecks, targeted ESLint, CI-isolation check, Cloudflare staging build, and Wrangler deploy dry-run. `fanmark-app-staging` was deployed as version `161de18f-44ea-4016-9267-39688619df9b`. Read-only HTTP smoke returned root 200/noindex, the app JS 200 with the new admin-auth flow, anonymous `/api/admin/session` 401, and no-cookie `/api/auth/get-session` 200/null. A Wrangler read-only D1 migration-history query returned Cloudflare API 7403; deployment itself succeeded. The deploy uploaded Worker/assets only and made no D1/R2 writes. The remote synthetic-admin login/TOTP flow has not been exercised. No real Auth/user data, production service, or domain/DNS changed.

## Better Auth TOTP session-response correction and staging redeploy (2026-09-24 JST)

The installed Better Auth `verify-totp` endpoint was observed returning a
session-shaped `{token,user}` response after first-time enrollment, while the client accepted
only `{status:true}`. Updated the client to accept either observed response
shape. Added a local Worker/D1 integration case that enrolls a synthetic user,
verifies a generated TOTP, follows the rotated session cookie, and confirms
the admin gate only opens with same-session MFA assurance.

Node 22.6.0 checks passed: 10 frontend Better Auth tests, 10 Worker Auth/D1
tests, 79 migration-data tests, 41 contracts across public/verified access,
storage, reference-master, language, and Better Auth clients, frontend and
Worker typechecks, targeted ESLint, and the Cloudflare staging build. The first
full-repository ESLint invocation raced the concurrent Vite build's temporary
config file; the changed files passed a clean targeted run. Wrangler dry-run
confirmed split business/Auth/master D1 and both R2 bindings. `fanmark-app-staging`
was redeployed as version `93211a35-e458-433d-aeb6-913bdbc2d507`; the deployed
JS contains the corrected client. Read-only live checks returned root 200,
robots `Disallow: /`, Auth health 200, anonymous session `null`, admin session
401, emoji catalog 200, language and tier masters 200, and missing avatar and
cover objects 404 from their bound R2 buckets. An origin-allowed anonymous
upload returned 401. Business D1 still contains no application table (only
Cloudflare `_cf_KV`); separate Auth reads found zero rows in user, account,
session, verification, twoFactor, adminRole, and mfaAssurance. No D1/R2 write,
real user data, production service, or domain/DNS change occurred. The remote
synthetic-admin TOTP sequence and admin CRUD/business authorization remain
unverified.

## Live synthetic admin TOTP rehearsal (2026-09-24 JST)

Added `workers/api/test/staging-admin-totp-smoke.mjs`, a remote test that
refuses to run without both `--run-live-staging-write` and the exact
`--database=fanmark-auth-staging` confirmation. It reads the checked-in staging
Worker config and asserts the dedicated Auth D1 ID, workers.dev-only Worker,
Better Auth mode, and no-index flag before touching remote state. It also
requires all seven user-owned Auth tables to be empty before it starts.

The test created a random `example.invalid` identity and credential directly in
the dedicated staging Auth D1, then exercised the deployed API end to end:
email/password sign-in, `mfa_enrollment_required`, TOTP enrollment, verification,
rotated cookie, session refresh, and same-session `/api/admin/session`
authorization. It read back the persisted assurance for that exact session.
The test deleted its synthetic assurance, role, factor, session, verification,
account, and user rows, then confirmed every user-owned Auth table was empty
and the deleted session returned `null`. The random password, hash, TOTP secret,
and recovery codes were not logged or retained.

An independent remote read found `mfaGeneration=2`, advanced from 0 by the
synthetic factor insert and delete. The counter is monotonic operational state
and was intentionally not reset. The test does not cover MFA enrollment for a
real admin, account recovery operations, or admin CRUD/business authorization.
No business D1, R2 object, production service, or domain/DNS was changed.

## Emoji master admin draft route and staging deployment (2026-09-24 JST)

Added `0005_emoji_master_admin_guards.sql` to Master D1 and connected the
Cloudflare staging `AdminEmojiMaster` screen to `/api/admin/emoji-master`.
Every request checks Better Auth session, admin role, one current verified
factor, and unexpired assurance bound to that same session and factor. The API
updates only canonical `emoji_master`; ready release records remain immutable.
CSV/JSON import preserves existing UUIDs and runs in batches of at most 100.
Published identity changes and deletions fail closed. The UI labels changes as
unpublished draft work and disables deletion.

The staging Vite build used a fresh empty env directory and explicit synthetic
Supabase/public Worker settings; it did not load `.env.cloudflare-staging`.
Local verification passed 11 Worker Auth/D1 tests, 4 emoji-admin client API
tests, the Worker suite (30 tests), 79 migration-data tests, frontend and
Worker typechecks, targeted ESLint, and Wrangler deploy dry-run. The remote
Master D1 had 3,944 canonical rows and active release
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`; migration
`0005` applied successfully. Readback found 3,944 active staging rows, six
migrations, both identity triggers, and no pending migrations.

`fanmark-app-staging` was deployed as version
`1884dc0f-7419-4462-99f3-11ff77ac41b4` on its workers.dev hostname. Live
read-only checks returned root 200, robots `Disallow: /`, Auth health 200,
anonymous `/api/admin/session` and `/api/admin/emoji-master` 401, emoji catalog
200 at the same active version, and language master 200. A guarded live smoke
then used one temporary synthetic admin identity to enroll TOTP, verify the
session, edit a protected canonical record's metadata, reject its deletion,
restore the original metadata, and compare the active public catalog record
before and after. Final D1 readback found canonical 3,944, active release 3,944,
the same active version, six migrations, both guards, and no stranded smoke
edit. All user-owned Auth tables returned to zero; `mfaGeneration=4` was
preserved. No user-owned data, R2 objects, production app, or domain/DNS was
changed. Other admin CRUD, business DDL/authorization, and CPU plan fit remain
open.

## Independent staging API recheck (2026-09-24 JST)

Re-read the current Wrangler deployment list and confirmed that 100% traffic
still targets app Worker version
`1884dc0f-7419-4462-99f3-11ff77ac41b4`. Read-only HTTP requests to all three
reference-master routes returned 200 with `Cache-Control: no-store` and the
same release version
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e`: 4 tiers,
4 languages, and 5 reserved patterns. An R2 public read for a valid but absent
synthetic key returned 404 `object_not_found`; an origin-allowed upload with no
session returned 401 `unauthorized` before reaching the object-write path. No
D1 or R2 write was performed. This recheck does not verify the frontend's
browser flow or move Storage/profile data.

## Exact positive-decimal constraint in generated D1 schema (2026-09-24 JST)

The schema converter now translates the source
`fanmark_lottery_entries.lottery_probability > 0` CHECK only when the source
column is a non-null unconstrained `numeric`. The D1 CHECK validates the
canonical decimal-text shape and positive value using string operations; it
does not cast to REAL or round. Nullable columns and other numeric expressions
remain gated. The exact-decimal importer gate remains blocking until the
complete importer and weighted-selection operation use the same representation.

The synthetic converter suite passed five tests, including positive values
smaller than JavaScript floating-point range, large exact values, zero and
negative rejection, malformed text, embedded NUL, source default, and refusal
to translate the nullable form. The full current private schema catalog was
regenerated without exposing its contents: 40 tables, 31 translated CHECKs,
19 unresolved gate groups, and `deployable: false`. This was the pre-descriptor
conversion report. Schema-conversion version 2 now adds a credential-transform
gate; regenerate from the refreshed private catalog before treating that gate
count as current. Its generated SQL parsed in
SQLite with 40 tables and 63 explicit indexes; `PRAGMA foreign_key_check`
returned no rows and `PRAGMA integrity_check` returned `ok`. The migration-data
suite passed 80 tests, targeted ESLint and syntax checks passed, and
`git diff --check` passed. At this pre-bootstrap checkpoint, a read-only Wrangler query against the exact
`fanmark-business-staging` database ID returned only Cloudflare's internal
`_cf_KV` table (`changes: 0`, `rows_written: 0`). No generated business DDL had
yet been applied; the later structural bootstrap is documented below.

## R2-backed staging Worker and extension-price schema (2026-09-25 JST)

Cloudflare readback confirmed the existing APAC buckets
`fanmark-avatars-staging` and `fanmark-cover-images-staging`. Local Miniflare
Storage/R2 integration passed 5 tests and the app Worker dry-run showed both
bucket bindings. Applied `0006_reference_master_extension_prices.sql` to the
intended Master D1; its migration ledger now contains `0000`–`0006`, while the
active reference release remains
`5be91463bd0429cc9fc7a280892a80a922deb2dd9224325374171a4ce7bdc88e` at
generation 1. The new extension-price view currently returns zero rows because
its source snapshot has not yet been exported or activated.

Deployed `fanmark-app-staging` as version
`1d1bae79-5793-4341-9b1f-540a55376695` on workers.dev with both R2 bindings and
`STORAGE_BACKEND=r2`. Read-only smoke returned Auth health 200, root 200 with
`X-Robots-Tag: noindex, nofollow`, and a missing synthetic public object as
404 `object_not_found`. An unauthenticated upload returned 401 `unauthorized`
before object write. No object was uploaded, no Supabase data was copied, and
production or domain/DNS settings were unchanged. This verifies the staging
Worker's R2 route and binding, not profile metadata integration or object
migration.

Node 22.6.0 checks passed: reference-release integration (5), reference-master
Worker API (3), availability against reference masters (3), R2 Worker API (5),
Worker typecheck, and migration script syntax checks. Existing users and
Supabase Auth/Storage data were not read or migrated in this step.

Post-deploy API readback returned the existing languages route as 200 with four
rows and the unchanged release version. The new extension-price route returns
503 `reference_master_unavailable` while its active view has zero rows; no
frontend selector calls it yet. This is the expected fail-closed state pending
the source snapshot and a complete release promotion.

## Local scheduled license finalization proof (2026-09-25 JST)

The local source-shaped lifecycle now also finalizes overdue grace licenses
with no pending lottery entry. It atomically removes the four access-config
projections, advances access generation once, and writes the expiry audit,
notification outbox event, and durable finalization journal. A delayed-cron
integration check confirms a just-created but already-overdue grace state is
left for the next scheduled tick. The full synthetic 40-table source-profile
suite passed 20 checks, the lifecycle schema suite passed 9/9, the scheduler
contract passed 8/8, and Worker typecheck, targeted ESLint, and diff checks
passed.

This was local-only work: no Cloudflare D1 schema or Cron configuration was
changed. Pending lottery entries are deferred until lottery decision/history,
new-license issuance, and notifications can be committed under the same
reviewed transition. Business staging remains without application schema and
data; no Auth/Storage user data, production service, or DNS/domain setting was
changed during this step.

## Reference master refresh and schema inventory (2026-09-25 JST)

Supabase CLI `db query --linked` ran two read-only catalog queries. The first
refreshed the private application schema metadata at 40 tables, 406 columns,
144 constraints, 139 indexes, and 15 enum labels. The version-2 converter
generated 40 tables but still reported 20 unresolved gate groups and
`deployable: false`. The behavior query returned aggregate object inventory
for one view, 58 functions, 36 non-internal public triggers, and 77 RLS
policies. The schema-only DDL artifact contained no trigger DDL; the direct
catalog query resolved the earlier 36-trigger inventory discrepancy. These
queries read catalogs, not application rows.

A separate read-only query selected explicit columns from only
`fanmark_tiers`, `languages`, `reserved_emoji_patterns`, and
`fanmark_tier_extension_prices`. Its private mode-0600 snapshot has SHA-256
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`; the
source rows are not in the repository. The snapshot has 4, 4, 5, and 16 rows
respectively. The 16 extension-price rows are active, span tiers 1–4 and
1/2/3/6-month terms, and have no duplicate tier/term pairs. Stripe ID strings
passed format checks; their corresponding Stripe objects were not checked.

The account/database-guarded remote helper staged the complete release in
`fanmark-emoji-master-staging`, verified each staged table and active view
against the private snapshot, and promoted it to generation 2. The active
release is
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`. All
seven user-owned Auth tables remained empty and the previous emoji pointer and
activation history were unchanged. Live HTTP reads for all four
`/api/reference-masters/{name}` routes returned 200 with `Cache-Control:
no-store`; the extension-price response had 16 items and omitted Stripe IDs.
The admin editor and checkout remain on Supabase, so this is master staging and
read-API verification rather than a frontend/payment cutover. No user rows,
Storage objects, production service, or domain/DNS settings changed.

## Business D1 structural readback (2026-09-25 JST)

A fresh linked Supabase catalog query was run using the repository's
`schema-readiness.sql` and stored privately with mode 0600. It again returned
40 tables, 406 columns, 144 constraints, 139 indexes, 15 enum labels, 1 view,
58 functions, 36 non-internal triggers, and 77 RLS policies. The converter
reproduced 20 unresolved gates: nine row-conversion groups (226 column
locations) and eleven schema/operation groups. The strict `deployable` result
remains false.

A read-only query of `fanmark-business-staging.sqlite_schema` returned only
Cloudflare's internal `_cf_KV` table; no application tables or business data
are present. No schema or rows were written. Gate categories and sequencing
limits are in [schema generator](schema-generator.md).

## Current app Worker and Static Assets staging deployment (2026-09-25 JST)

Node 22.6.0 rebuilt the current staging SPA and Wrangler dry-run resolved the
split business/Auth/master D1 bindings and the two R2 staging buckets. The
current `fanmark-app-staging` Worker was deployed to version
`77668344-429b-43f4-81e5-0d2f8b3c74ef`; three changed static assets were
uploaded. The Better Auth secret name is present in the Worker secret list; its
value was not read. No D1 migration or R2 object operation was part of deploy.

Live read-only HTTP checks returned root 200 with `x-robots-tag: noindex,
nofollow`, a robots file disallowing crawlers, `/api/auth/ok` 200,
`/api/auth/get-session` 200 with `null`, and `/api/admin/session` 401. All four
`/api/reference-masters/{name}` endpoints returned 200, `Cache-Control:
no-store`, and respectively 4 tiers, 4 languages, 5 reserved patterns, and
16 extension-price rows at release
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`. The
extension-price DTO remains public-safe and excludes Stripe IDs. An
unapproved-origin master request returned 403.

SPA and PWA readback also passed: `/plans` and a synthetic `/a/:shortId`
navigation returned the SPA with 200; `/manifest.webmanifest`, `/sw.js`,
`/favicon.ico`, and `/favicon.png` returned 200. The generated service worker
denies `/api/*` navigation fallback, missing JS assets return 404 rather than
HTML, unknown API routes return JSON 404, `/sitemap.xml` stays 404, and
`/robots.txt` contains `Disallow: /`.

The deployed profile, owned-fanmark, and notification routes returned their
bounded `503 profile_unavailable`, `503 owned_fanmarks_unavailable`, and
`503 notifications_unavailable` responses with `no-store`; their D1 backend
selectors are intentionally unset because business D1 still contains only
Cloudflare's internal `_cf_KV` object. A fresh read-only Auth D1 aggregate
returned zero rows for user, account, session, verification, two-factor,
admin-role, and MFA-assurance tables. This deployment and smoke made no D1 or
R2 writes, imported no user data, and changed neither production services nor
public DNS/domain settings.

Verification for this deployment passed root/Worker typechecks, CI isolation,
the staging build, Wrangler dry-run, 86 migration-data tests, 37 focused Worker
integration tests, and 69 frontend client tests. The SPA build still reports
the existing large main-chunk warning. These checks do not close the 20 source
schema/operation gates, prove Cloudflare CPU-plan fit, or constitute the full
synthetic end-to-end application rehearsal.

## Signed extension-pricing service route (2026-09-25 JST)

Rebuilt the current app staging bundle and passed Wrangler deploy dry-run with
split business/Auth/master D1 bindings and both enabled R2 buckets. Deployed
`fanmark-app-staging` as code/assets version
`763c798c-8e37-456b-a720-54f75be1270b`; three static assets changed. Then set
the random staging-only `REFERENCE_MASTER_SERVICE_SECRET` as a Worker secret,
active secret-change version `04c062e3-15a2-40d6-aef5-4cce5340879e`. The secret
value is retained only outside the repository in a mode-0600 local file and
Cloudflare secret storage; it was not read back or printed.

The live Edge Function helper signed requests to the private route and read
tier 2 / one month from active D1 release
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`. Checkout
mode returned a format-valid Stripe Price ID to process memory only; the
price-only mode returned `null` for the ID. Neither call contacted Stripe.
Public extension prices returned HTTP 200 with 16 rows and no Stripe IDs; the
same private route rejected an unsigned request with 401. Root remained 200
with `noindex, nofollow`, and Auth health remained 200. The Cloudflare secret
exists, but no Supabase Edge Function secret or price/admin/frontend backend
selector is configured, so app pricing and checkout remain on Supabase.

Local validation passed: service-route unit tests 5/5, HMAC helper-to-Worker
tests 4/4, real Miniflare D1 reference-master suite 6/6, frontend master API
tests 7/7, frontend/Worker typechecks, targeted ESLint (one hook dependency
warning), `check:ci`, staging build, Wrangler dry-run, and Deno checks for both
modified Edge Functions. No D1 write/schema migration, R2 object operation,
user data, Stripe transaction, production service, or domain/DNS state changed.

## Schema converter v4 current-catalog verification (2026-09-25 JST)

The latest private read-only PostgreSQL catalog was reprocessed through schema
converter v4. Catalog counts remained 40 tables, 406 columns, 144 constraints,
139 indexes, 15 enum labels, one view, 58 functions, 36 non-internal triggers,
and 77 RLS policies. The source locale is `en_US.UTF-8`; consequently the three
known regex CHECKs remain gated, since the current SQLite equivalents are
intentionally limited to the proven `C`/`C` case. The report remains at 18
unresolved gate groups and `deployable: false`.

The v4 DDL parsed in isolated SQLite with 40 tables, 66 indexes, zero foreign
key violations, and `integrity_check=ok`. At this pre-bootstrap checkpoint,
the catalog, DDL, and gate report remained in `/private/tmp` with mode 0600 and
nothing had yet been applied to business D1; see the subsequent bootstrap below.
`npm run test:migration-data` passed 90/90 and
`npm --prefix workers/api run test:d1-import` passed 13/13. Snapshot format
remains version 3 and its schema-conversion identity is now version 4.

## Business-staging structural schema bootstrap (2026-09-25 JST)

Wrangler OAuth was refreshed for the already-authorized `fanmark.id` Cloudflare
account after a read-only D1 request returned authentication error 10000. The
business target was selected explicitly as `fanmark-business-staging`
(`d4bb0c48-f24a-491f-8693-fa393ab0b873`), not the emoji-master database open in
the browser. A read-only `sqlite_schema` query returned only `_cf_KV` before
the write.

The v4 structural SQL was placed in the business-only
`workers/api/migrations-business` directory and applied with
`wrangler d1 migrations apply --remote`. Local Wrangler rehearsal and remote
application each reported all 108 statements successful. Remote readback found
40 application tables and 66 indexes (42 total tables including `_cf_KV` and
`d1_migrations`), no pending migration, and zero rows from
`PRAGMA foreign_key_check`. The migration contains no INSERT, UPDATE, DELETE,
REPLACE, or COPY statements. No Worker redeploy or frontend selector change
occurred.

This is empty-schema scaffolding only. The converter report remains
`deployable: false` with 18 unresolved gates; behavior/security parity and all
data-import checks remain open. No Supabase rows, Auth records, R2 objects,
production resources, or domain/DNS settings were changed.


## Latest app Worker and Static Assets staging deployment (2026-09-25 JST)

After applying the empty 40-table/66-index business structural baseline, rebuilt
the staging SPA with Node 22.6.0 and passed Wrangler dry-run. Deployed
`fanmark-app-staging` to workers.dev as version
`6258c5cb-4903-439f-a61f-49e8a6457393`; four changed Static Assets were uploaded.
The dry-run binding map resolved `FANMARK_DB`, `AUTH_DB`, `MASTER_DB`, both R2
buckets, and `ASSETS`.

Read-only live checks returned root 200 with `x-robots-tag: noindex, nofollow`,
`robots.txt` 200 with `Disallow: /`, `sitemap.xml` 404, and `/api/auth/ok` 200.
All four reference-master endpoints returned 200 with `Cache-Control: no-store`
and 4/4/5/16 rows at release
`49d582cfc482da61f5394fc83ea9d1bb67820a8d47d493dfdfb74218dd4b4c12`; no Stripe
ID fields were present. The unauthenticated profile and public fanmark routes
returned 503 `profile_unavailable` and `public_access_unavailable`, both
`no-store`, as their business selectors remain disabled. The deployed JS and
CSS each returned 200 and matched local build bytes: JS SHA-256
`f903e908a280a88f3791e3f38c41a496eafd5f1be8eab46df18b164c80a8ac9e`, CSS
SHA-256 `d30acbd0ef54e1e4e5415f1b22ee91d0868c3b6a4e42e47a250ea5c196103cfb`.

Validation passed on Node 22.6.0: migration-data 90/90; frontend/Worker
typechecks; default Worker suite 26/26 and verified-access 9/9; dedicated
synthetic split-D1 profile 5/5, owned-fanmarks 4/4, availability/reference
master 3/3, scheduled expiry 8/8, and public-access client 7/7; staging build;
Wrangler dry-run; and `git diff --check`. The Worker test configuration now
excludes the profile integration file from the default suite so it runs with
its split-D1 test configuration. The Vite build still reports a 2.17 MB main
JS chunk. No database write/schema migration, R2 object operation, Supabase
write, production change, or domain/DNS change occurred during this deploy and
smoke. This does not establish user-data, Auth, or full application parity; the
schema converter still reports 18 blocking groups and `deployable: false`.


## Recent fanmarks and availability on split staging D1 (2026-09-25 JST)

Added `RECENT_FANMARKS_BACKEND=d1` and `AVAILABILITY_BACKEND=d1` to the
workers.dev-only app config. The staging SPA was built with
`VITE_FANMARK_API_BASE_URL=https://fanmark-app-staging.fanmark-id.workers.dev`;
the compiled JS contains that origin. Recent fanmarks now uses the business D1
query, and availability uses the split business and master D1 bindings.
Deployment version is `c9d51d92-3b7a-49e9-b152-b210d24a36f1`.

For the recent-route canary, three synthetic fanmarks/licenses (two active,
one grace) were inserted into `fanmark-business-staging`. The endpoint returned
only the two active rows in descending license-created order, with expected
license/fanmark IDs, display emoji, and short IDs; limit 1/2, `no-store`, and
invalid limit 400 were verified. The script removed the three licenses and
three fanmarks in `finally`; a remote readback found zero rows for those IDs,
and subsequent total counts for `fanmarks` and `fanmark_licenses` were both
zero. A final recent-list read returned `items: []`.

A live availability POST using a canonical emoji ID from the public active
master release returned HTTP 200, `available: true`, tier 4, numeric price,
`no-store`, and the exact staging `Access-Control-Allow-Origin`. The frontend
uses the Worker for both recent and availability calls; client tests prove no
credential forwarding and no Supabase fallback after explicit selection. The
public access, registration, and owner-write selectors remain off. All seven
Auth user-owned tables read back zero. No persistent synthetic rows, user data,
Supabase writes, R2 operations, production changes, or DNS/domain changes
remain from this staging validation.


## Public access routes on split staging D1 (2026-09-25 JST)

The public-access client was built with
`VITE_PUBLIC_ACCESS_READ_BACKEND=worker`; staging Worker config selects
`PUBLIC_ACCESS_BACKEND=d1`. A local split-D1 test exposed that emoji
normalization still queried `FANMARK_DB`. It now selects the master D1 role,
while public fanmark/license/config/profile projections stay on the business
D1. The 11-case Worker suite, Worker typecheck, and targeted ESLint passed.
Staging build and Wrangler dry-run showed the split business/Auth/master D1
bindings and both R2 buckets; deployment updated `fanmark-app-staging` to
`3733c771-2903-40cd-8bdc-5a0f94412c82`.

The business D1 had zero `emoji_master`, `fanmarks`, `fanmark_licenses`, and
`fanmark_profiles` rows before the canary. Four temporary synthetic rows (one
fanmark, license, basic config, and published profile) referenced a canonical
emoji present only in the separate master D1. The short-ID, emoji-ID, and
public-profile Worker routes each returned HTTP 200 with
`Cache-Control: no-store`; the public DTO contained only the expected
synthetic projection. The four rows were deleted, and exact-ID readback
returned zero for all four tables. The business D1 remains schema-only and
has zero emoji-master rows.

The public read selector is active on the workers.dev staging app only. The
password-verification selector, access analytics, owner/history details,
production app, real data, and domain/DNS remain on their existing paths.
No Supabase writes, R2 operations, or persistent synthetic rows resulted from
this check. This validates the live API projection, not a browser acceptance
pass or full production data parity.

Node 22.6.0 checks passed: recent client 9, recent D1 6, availability client
6, availability D1 8, split reference-master availability 3, frontend/Worker
typechecks, migration-data 90, staging build, Wrangler dry-run, and the broader
Worker/profile/owned-fanmark/scheduler suites listed in `HANDOFF.md`. This
does not establish complete app or user-data parity.

## Authenticated owner APIs on staging (2026-09-25 JST)

The workers.dev app config selects `PROFILE_BACKEND`,
`OWNED_FANMARKS_BACKEND`, `FANMARK_PROFILE_BACKEND`, `FAVORITES_BACKEND`,
and `NOTIFICATIONS_BACKEND` as `d1`. The normal
`build:cloudflare-staging` command now sets each matching Vite selector to
`worker`. Wrangler dry-run resolved the business, Auth, and master D1
databases plus both R2 buckets. Deployment updated `fanmark-app-staging` to
version `70cb8111-2a25-4e43-8662-e59dfd8add8d`.

A temporary verified Better Auth user was inserted directly into the staging
Auth D1 using a generated password hash and signed in through the deployed
Worker. The profile route rejected an unauthenticated request with 401. Using
the authenticated cookie, live GET/PATCH checks passed for
`/api/me/profile` and `/api/me/fanmarks/{id}/profile`;
`/api/me/fanmarks` returned only the synthetic user's owned fanmark. Favorite
add/list/remove passed using three canonical emoji IDs found only in Master
D1. Notification list and unread count returned the temporary delivered row,
and the read-one endpoint changed its state and reduced the unread count to
zero. The first synthetic credential fixture used email as Better Auth
`accountId` and received 401; its cleanup was verified before rerunning with
`accountId` equal to the synthetic user ID.

The successful canary removed the generated Auth user, credential account and
session; business profile, config, license, fanmark and notification rows; and
favorite/event/discovery rows. Remote exact-ID and normalized-emoji composite
readback showed zero leftovers. Seven local client/Worker suites passed 31/31.
The canary used no real user data and did not call Supabase writes, Stripe,
production routes, or custom-domain/DNS. Notification generation/delivery,
broader settings saves, full schema/operation/security parity, and production
cutover remain unverified.

## R2 image upload selector on staging (2026-09-25 JST)

The repeatable `build:cloudflare-staging` command now selects
`VITE_STORAGE_BACKEND=r2` plus the five owner API frontend selectors. The
app Worker keeps `STORAGE_BACKEND=r2` and the two bound APAC buckets. After
build and Wrangler dry-run, deploying the updated SPA produced app Worker
version `3246cbf2-642f-47f2-a107-0a8a116a8f8a`.

A temporary verified Better Auth account uploaded a valid 1×1 PNG through
`POST /api/storage/object/avatars`. Public GET returned the exact uploaded
bytes with `nosniff`; authenticated owner DELETE returned 204, and the
subsequent public GET returned 404. The object was deleted before the Auth
session/user were removed. D1 canary readback returned zero; the object key
also returned 404 after cleanup. No legacy Supabase objects were copied.
Storage Worker tests passed 5/5, client tests 7/7, Worker typecheck, staging
build, and Wrangler dry-run passed. The production frontend remains on the
Supabase default. Full profile metadata/settings cutover and object migration
are not verified.

## Current staging owner-settings and protected-access verification (2026-09-25 JST)

The current `fanmark-app-staging` deployment is version
`07f445cd-cedb-4d30-b40f-b3c9be24f545` at 100% on its workers.dev hostname.
Worker settings `FANMARK_SETTINGS_BACKEND=d1` and
`VERIFIED_ACCESS_BACKEND=d1`, with the matching staging frontend selectors, are
active. Business D1 migration history reads `0000` through `0004`; the source
schema and lifecycle, credential-transform, and verified-access extensions are
present. The staging smoke preflight confirmed all 40 source business tables
had zero rows. A read-only Auth aggregate after cleanup returned zero users,
accounts, sessions, verifications, two-factor records, admin roles, and MFA
assurances.

The guarded `staging-owner-settings-smoke.mjs` created only a synthetic
`example.invalid` account and business records, signed into Better Auth, and
exercised the deployed Worker. Unauthenticated settings returned 401;
authenticated settings GET/PATCH returned 200/200; wrong password returned
401; correct password verification returned 204; protected content returned
200. Runtime evidence matched the password generation and no password or hash
was returned. Cleanup read back zero Auth users/accounts/sessions and zero
canary fanmark, license, incarnation, runtime-evidence, proof, reservation, and
access-audit rows. No real rows, Supabase writes, production routes, R2 objects,
or domain/DNS settings were used or changed in this smoke.

## Remote emoji master promotion/rollback rehearsal (2026-09-25 JST)

The prior active emoji release was the only successfully activated release, so
a rollback target did not yet exist. A verified staging-only 3,944-row release
was built from that artifact with a single temporary keyword marker; every
UUID/emoji/codepoint identity remained unchanged. The release was staged into
`fanmark-emoji-master-staging` as `ready` without changing canonical
`emoji_master` or the active pointer. Its guarded promotion succeeded at
generation 2, then a guarded rollback to the previously active immutable
artifact succeeded at generation 3. Both runners used the exact expected
active version and read back the activation pointer/history; the account and
database ID guards passed and Better Auth user-owned tables were empty.

Readback confirms the original version
`10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed` is active
at generation 3. The staging API returns HTTP 200, no-store, 3,944 rows, and
that same version; the temporary marker is absent from its active page. The
test release remains ready but inactive because activation history is
immutable. Canonical master count remains 3,944. Updating
`wrangler.emoji-staging.jsonc` to include migrations `0000` through `0006`
resolved the activation runner's config mismatch; its remote migration check
reports no pending migrations. The local migration-data suite passes 93/93,
the emoji release Miniflare suite passes 7/7, CI isolation passes, and
`git diff --check` passes. No user data, production service, or domain/DNS state
changed.

## Supabase public schema refresh and D1 return API staging canary (2026-09-25 JST)

The migration worktree's Supabase CLI was authenticated but did not have a
linked project reference. Linking that isolated worktree to `fanmark.id` needed
no terminal response. `supabase db dump --linked --schema public` then completed
to `/tmp/fanmark-cloudflare-latest-public-schema.sql`; the CLI reported
"Dumping schemas" and the resulting file contains no `COPY` or `INSERT`
statements. The dump has 40 public tables, one view, 58 functions, 77 policies,
36 triggers, and 70 indexes. Its SHA-256 is
`aac7f38c912b358019a9bb9f282813a10bcd3e20af09e929d1ec41a2705b42cd`.

The checked-in business D1 base migration has the same 40 table names and
column names as this live public schema. This is name-presence parity only; it
does not establish matching types, defaults, constraints, indexes, policies,
trigger behavior, or function behavior. No row data was dumped or written to
Supabase. Cloudflare business D1 writes for the canary below were synthetic and
removed after readback.

The single-fanmark D1 return API is guarded by `FANMARK_RETURN_BACKEND=d1`; the
Cloudflare staging build selects the frontend API. Worker and client tests
pass 12/12 and 4/4, plus Worker typecheck and staging frontend build. Staging
Worker version `83629969-f48f-4f68-beeb-7b2ef47724c6` is active at 100%. Live
unauthenticated POST returned 401 and GET returned 405. A Better Auth synthetic
owner's active transfer code correctly blocked return with 400; after removing
that synthetic code, return returned 200 and moved the license to grace. Audit,
owner-notification, and favorite-notification event payloads were read back.
Cleanup confirmed zero synthetic fanmark, license, transfer, favorite,
discovery, audit, event, Auth user, account, and session rows. Bulk returns and
notification delivery remain on Supabase.

## Fanmark registration D1 staging canary (2026-09-25 JST)

`fanmark-app-staging` version `29dd848d-604c-4405-9bf5-58aff04a00f2` is the
latest deployment and Wrangler readback shows its version at 100%. The
Cloudflare staging SPA and Worker explicitly select the D1 registration route;
normal frontend builds still default to the Supabase Edge Function.

The live canary used a disposable Better Auth owner and the active emoji
catalog's rose record. Registration returned 201 with tier 4; readback verified
the active initial license, basic config, public profile, and audit row. A
second request returned 409, and an unauthenticated request returned 401.
Cleanup returned zero for the synthetic fanmark, license, basic/profile/URL/text
config, audit, Better Auth user/account/session, and all 40 business tables.
No user rows were copied from Supabase, and no production route or domain/DNS
state changed. Local Worker/client suites pass 8/8 and 6/6. This is a synthetic
staging app proof, not source-row or production parity evidence.

## Lottery finalization journal schema on staging (2026-09-25 JST)

Applied `0005_lottery_plan_journal_staging.sql` to the isolated
`fanmark-business-staging` database through Wrangler's remote file-import
path, recording the migration in the same import. Readback confirms the exact
new journal columns (`lottery_seed`, `lottery_inputs_json`,
`lottery_plan_json`), table and cursor-index DDL, migration-ledger entry, and an
empty `PRAGMA foreign_key_check`. The finalization run and item tables remain
empty; aggregate row count across all 40 source business tables is zero. No
Worker deployment or Cron setting changed.

The local source-profile finalizer now includes pending lottery entries. It
stores and replays a durable seed/input/plan, rechecks winner capacity, and
commits expiry, lottery entry/history, license issuance, audit/outbox, config
cleanup, and journal effects in one guarded D1 batch. The source integration
suite passes 25/25, selection tests 10/10, scheduled-expiry tests 8/8, and the
Worker typecheck passes. This remains local synthetic evidence only: the new
lottery finalizer has not been deployed or exercised as a remote canary, and
the scheduled Cron remains disabled. No user rows or production/domain state
changed.

## One-shot grace-expiry lottery canary (2026-09-25 JST)

Ran the local Worker `scheduled` event once through Wrangler's test-scheduled
route with remote binding to the exact APAC `fanmark-business-staging` D1.
Preflight confirmed all 40 source business tables, user-owned Auth tables, and
lifecycle run/item/effect journals were empty. The test inserted one synthetic
grace license and pending entry; the scheduled finalizer selected that sole
applicant, expired the old license, issued the active winner license, and
wrote history, durable seed/input/plan, audit, and notification events. It
removed the four access configuration projections and retained the separate
profile row, matching the source behavior.

After cleanup, all 40 business tables and all lifecycle run/item/effect
journals returned to zero. The retained incarnation and access-version tables
matched their exact pre-canary snapshot; the staging incarnation registry
contained 16 pre-existing tombstones that were preserved. No Auth identity or
Cron trigger was created. The deployed scheduled-backend flag remains unset,
and production, real user data, and domain/DNS were untouched.

## Bulk fanmark-return canary (2026-09-25 JST)

Deployed `fanmark-app-staging` version
`186255d9-c8ec-47bf-a8e0-32b3296a6ab3` at 100% after the Wrangler dry-run
confirmed the existing split D1 and R2 bindings. `VITE_FANMARK_RETURN_BACKEND`
selects both single and bulk return on the staging SPA; production selectors
remain on Supabase.

The synthetic Better Auth owner sent two license IDs. The first response was
HTTP 207 with one successful grace transition and one failure due to its active
transfer code. After deleting that synthetic transfer code, the second request
returned HTTP 200 and transitioned that license. Exact reads confirmed one
audit row and one owner event per returned license. A setup attempt before this
run hit the D1 unique normalized-emoji-key constraint on duplicate synthetic
input; cleanup removed its fanmark, license, and Auth rows. As designed, each
license that had been created retains its lifecycle anti-reuse tombstone.

The successful canary's cleanup returned the 40 source business tables and all
user-owned Auth tables to zero, restored the access-version table to its
pre-canary snapshot, and confirmed the global `mfaGeneration` row was unchanged.
It retained exactly two new synthetic license-incarnation tombstones; the
staging registry now has 21 rows (16 pre-existing plus five canary tombstones).
No user rows, production routes, Cron settings, or domain/DNS state changed.

## Earlier app-staging deployment and read-only smoke (2026-09-25 JST)

Rebuilt the Cloudflare staging SPA and deployed `fanmark-app-staging` through
its explicit staging config. Wrangler reports version
`3c00ac93-98bc-4888-9a8f-4dd6d6271e04` at 100%. Before deployment, remote
migration checks with `wrangler.app-staging.jsonc` reported no pending
migrations for business, Auth, or master D1. The deployment uploaded three
changed static assets and did not apply D1 schema or row changes.

Post-deploy GET-only checks returned `/` 200, `/api/auth/ok` 200 with
`no-store`, `/api/emoji/catalog?limit=2` 200 with two records, and the four
reference-master routes 200/`no-store` with 4 tiers, 4 languages, 5 reserved
patterns, and 16 extension prices. The payloads contained no Stripe IDs. An
unauthenticated GET to `/api/admin/session` returned 401/`no-store`. All
three D1 roles and both R2 bindings were present in Wrangler's deployment
readback. No authenticated identity, row mutation, R2 write, production
resource, or custom domain/DNS setting was touched by this check.

Local verification after correcting the Vitest grouping passed the root
staging build, root typecheck, Worker typecheck, CI isolation check, Worker
default suites (36), D1 importer (13), Worker static-assets suite (14),
Worker/D1/application synthetic suites (250 total), migration-data suite
(93), Stripe receipt suite (90), and `git diff --check`. D1 suites that need
their own Miniflare bindings are excluded from the generic Worker config and
remain covered by their dedicated configs. The staging app remains a
workers.dev preview; this is not production acceptance. Notification event
generation/delivery, Stripe cutover, OAuth/email, scheduled Cron, broader
admin parity, real user-data import, and domain/DNS remain open.

The phrase “latest Supabase schema retrieval waiting for terminal input” is
not a current blocker. It referred to an older 2026-09-24 checkpoint; the
read-only schema/catalog refresh was completed on 2026-09-25, and the current
run does not require terminal input.

## Search details API deployment (2026-09-25 JST)

Deployed `fanmark-app-staging` version
`e3d47df4-eb20-4ade-8857-398cde3aab0d` at 100% after the staging config dry-run
showed the split business/Auth/master D1 bindings, both R2 buckets, and
`FANMARK_SEARCH_BACKEND=d1`. The business database reported no pending
migrations; this API adds no schema or row writes.

Post-deploy read-only checks: `/` 200, `/api/auth/ok` 200/`no-store`, anonymous
`POST /api/fanmarks/search/details` 200/`no-store` with
`{schemaVersion:1,result:null}`, unauthenticated owner-settings GET 401/`no-store`,
and unauthenticated `/api/admin/session` 401/`no-store`. The null is expected because business D1 has no imported
fanmark rows. Synthetic Worker tests covered a signed-in user projection and
confirmed that `target_url` and `text_content` do not appear in the response.
No authenticated live row, imported user data, search-history write, R2 object,
production route, or domain/DNS state was changed or verified by this check.

The frontend selector is explicit and staging-only. `record_fanmark_search`
still writes through Supabase until the user-data stage; this read migration
does not claim to move that activity data. Local frontend tests passed 5/5,
Worker default suites 30/30, and verified-access tests 10/10. Root/Worker type
checks, Cloudflare staging build, Wrangler dry-runs, and `git diff --check`
passed.

The staging SPA now routes `FanmarkMessageboardPreview` through the existing
owner-only settings GET when `VITE_FANMARK_SETTINGS_BACKEND=worker`; the page no
longer directly invokes `get_fanmark_complete_data` in the Cloudflare build.
Settings-client tests passed 5/5, app typecheck/build passed, and the staging
deployment is version `e3d47df4-eb20-4ade-8857-398cde3aab0d`. The owner GET was
verified as 401 without a Better Auth session. An authenticated live page read
against a populated row is not yet proven because business D1 is empty.

## Local R2 avatar and profile integration regression (2026-09-25 JST)

Extended the profile D1 Miniflare fixture with isolated local avatar and cover
R2 bindings. A synthetic Better Auth owner uploads an avatar, reads the same
bytes publicly, stores and reads back the URL through the owner-profile API,
gets a 400 when submitting that object under another user's path, then deletes
the image and clears the profile URL. The final D1 profile value is null, the
local R2 key is absent, and the public URL returns 404. The profile suite
passes 6/6, the independent R2 API suite 5/5, and Worker typecheck passes.
The deployed staging Worker, remote D1, and remote R2 were not modified by this
local regression; the existing live profile and R2 canaries remain separate.

## R2 avatar and profile end-to-end canary on workers.dev (2026-09-25 JST)

Ran `scripts/migration/staging-r2-profile-smoke.mjs` on Node 22.6.0 against the
explicit `fanmark-app-staging` Worker, split staging D1s, and both
`fanmark-avatars-staging` and `fanmark-cover-images-staging` buckets. The script
verified the Cloudflare account, Worker/config bindings, and zero rows in all
40 source-shaped business tables before creating one synthetic `example.invalid`
identity and profile.

Unauthenticated profile read/upload returned 401. The synthetic identity read
its profile, uploaded a valid 1×1 PNG, read back identical public bytes, saved and read
back the same-owner R2 URL, and received 400 when trying to save that key under
another user's path. Owner deletion returned 204; the profile URL was cleared.
The same identity uploaded a cover image to the separate bucket, read back the
same bytes, and deleted it as owner. Both buckets returned 404 after cleanup.
Final remote D1 readback found zero profile/user/account/session rows. Avatar
and cover content hashes matched (`d3c936ebdd73f46e6422d5946044c99d524554082272019ab738800318b04892`).
The canary did not copy source objects, change production, invoke Stripe, or
alter DNS/domain routing.

## R2 cover image and owner-profile integration on staging (2026-09-25 JST)

Deployed the Worker profile-image ownership guard to `fanmark-app-staging`
version `a6b0a110-9169-4921-9cdc-60e51a521714` at 100%. Wrangler confirmed the
business, Auth, master, avatar R2, and cover R2 bindings; no D1 migration or
static asset update was pending. The integrated registration/lottery smoke
created one synthetic owner and fanmark, uploaded a 1x1 PNG to the cover R2
bucket, read identical public bytes, saved the same-owner URL through the D1
fanmark-profile API, rejected a different owner's path and an avatar-bucket
URL as a cover, then owner-deleted the object. The URL returned 404 after
cleanup. All 40 source business tables and the synthetic Auth/profile rows
returned to zero. The canary did not access real user data, invoke Stripe, or
change production routing or domain/DNS.
# 2026-09-25: active emoji release availability readback

After deploying app Worker version `b381e0b3-7e03-41c2-a217-aeb1d5c5cf68`
to workers.dev staging, read-only GETs returned root 200 with `noindex` and
Better Auth health 200. The active emoji catalog endpoint returned 3,944 rows
at version `10ec42c1a562197c1e66c5fd10316c904188cdfb274ca5b8852c99ba240d3bed`.
A public availability POST using one ID from that exact response returned
200, tier 4, seven initial license days, and `available: true`. No business or
master D1 writes were performed. Local stale-mirror/retired-ID behavior is
covered by the dedicated synthetic D1 suites; this live check used the empty
synthetic business database and does not prove populated-row parity.

## Maintenance settings API deployment (2026-09-25 JST)

Deployed `fanmark-app-staging` version
`b7b208c7-68f8-4918-bfd9-b785ef66003d` at 100%. The public
`GET /api/system/maintenance` returned 200/no-store and exactly the three
allowlisted settings with defaults (`maintenance_mode: false`, empty message,
null end time). An unauthenticated `PATCH /api/admin/system-settings/maintenance`
returned 401 `unauthenticated`; a follow-up GET returned the same values. This
proves anonymous denial and read behavior only; no setting rows were created,
no authorized PATCH was sent, and no maintenance state was changed. Root and
Better Auth health GETs returned 200. Staging only; no Supabase, production,
user-data, R2 object, or DNS/domain state changed.

## Lifecycle settings API deployment (2026-09-25 JST)

Direct read-only Supabase REST retrieval, after confirming the URL matched the
linked project ref, returned exactly one public `grace_period_days` row with
value `1`. A read-only staging D1 preflight found no such row, no licenses, and
no expiry/finalization runs. Inserted only one public D1 `system_settings`
row with that exact value and read it back. No user data or other setting was
copied.

Deployed `fanmark-app-staging` version
`bf951bd0-4aee-42f2-a9a7-997beffe06de` at 100%. Live anonymous
`GET /api/system/lifecycle` returned 200/no-store and exactly
`{grace_period_days:1}`. Anonymous `PATCH /api/admin/system-settings/lifecycle`
returned 401 `unauthenticated`. Root returned 200 with `noindex, nofollow`,
and Better Auth health returned 200. The public setting read needs no user
identity; writing still requires administrator role plus session-bound MFA.

A later rerun of the synthetic scheduled-event smoke updated the setting to
14 temporarily, but the local Wrangler `--test-scheduled` connection reset
with `ECONNRESET`. The script's `finally` cleanup restored the setting row;
remote readback confirmed `grace_period_days=1`, zero license rows, zero
lifecycle run/item/effect rows, and 22 retained incarnation rows. This rerun
did not verify the scheduled event. `LICENSE_EXPIRY_BACKEND` and the Cron
trigger remain unset. Production, real user data, R2 objects, and domain/DNS
were unchanged.

## Deployed grace-expiry lottery Cron canary (2026-09-26 JST)

Ran `scripts/migration/staging-license-expiry-lottery-smoke.mjs` against the
APAC `fanmark-business-staging` D1 using only generated owner, winner, fanmark,
license, and lottery-entry IDs. The script temporarily changed the existing
public `grace_period_days` value from `1` to `14`, deployed the workers.dev
Worker with a one-minute Cron and a unique target-incarnation token, then
waited for the scheduled event to complete. Durable readback confirmed the old
license expired, the sole pending entry won, one active winner license was
issued, the lottery seed/input/plan and history were saved, access config was
removed while its profile was retained, and audit plus both notification
events were written with no conflicts.

An initial three-minute wait produced no run and was inconclusive: Cloudflare
documents that Cron changes can take up to 15 minutes to propagate. The rerun
allowed 17 minutes and completed. It immediately redeployed the staging
configuration with `triggers.crons: []` and without
`LICENSE_EXPIRY_BACKEND`, then restored the setting and removed the synthetic
rows/journals. The script compared retained lifecycle tables to their exact
pre-canary snapshots and verified all other business tables and Auth user
tables empty. An independent D1 read returned one settings row at
`grace_period_days=1`, zero fanmarks, users, licenses, notifications, audits,
and lifecycle runs/items/effect guards. The current Worker root returned 200;
Cloudflare Settings reports “cron トリガーが設定されていません”. Current
version: `507c5143-0bd5-476a-b29f-22c646db1652`.

This is one synthetic staging execution, not recurring activation or proof of
populated-user behavior/production CPU fit. No Supabase user data, production
resource, or domain/DNS state changed.

## Stripe billing schema added to staging D1 (2026-09-26 JST)

After the local Worker aggregate, Stripe ingress/application suites, client
contracts, and migration-data tests passed, read-only Wrangler checks found
`0006_stripe_webhook_ingress_staging.sql` and
`0007_stripe_extension_application_staging.sql` pending on the exact
`fanmark-business-staging` database. The referenced
`fanmark_lottery_entries` table existed. Applied only those two additive
migrations; Wrangler reported success for both.

Remote readback found all six new receipt, dispatch, checkout-intent,
application, effect, and lottery-entry tables. Counts were zero for every new
table and for `fanmarks`, `fanmark_licenses`, and `user_settings`; query
metadata reported `changed_db=false` and `rows_written=0`. Wrangler's next
migration-list check returned no pending migrations. The app Worker was not
redeployed, and its Stripe selectors, secrets, and Cron remain unset. This
prepared empty staging schema only: no Stripe request, real user data,
production resource, or DNS/domain setting was touched.

## Public schema re-download confirmation (2026-09-26 JST)

Repeated `supabase db dump --linked --schema public` against the already-linked
production project. The first attempt stopped because Docker Desktop was not
running; after starting it, the read-only schema dump completed without a
password or confirmation prompt. Its SHA-256 is still
`aac7f38c912b358019a9bb9f282813a10bcd3e20af09e929d1ec41a2705b42cd`, matching
the 2026-09-25 public-schema artifact recorded above. The dump contains schema
DDL only; no row export or database write occurred. The old “terminal input
waiting” checkpoint is therefore stale, not a current blocker.

## Deployed notification processor Cron canary (2026-09-26 JST)

Deployed `fanmark-app-staging` version
`000d54b4-8a34-4241-a2ce-45f72683581b` with
`NOTIFICATION_PROCESSOR_BACKEND=d1` and the shared one-minute Cron. Ran
`scripts/migration/staging-notification-processor-smoke.mjs --deployed-cron`
against the APAC business D1 with only one synthetic event and one synthetic
`user_settings` row. The actual workers.dev Cron processed the event, rendered
and delivered one Japanese in-app notification, and the canary deleted the
notification/event/settings rows. Its independent readback confirmed exact
master and public `grace_period_days=1` baselines, unchanged protected-access
state, and zero notification/event/settings rows. A Cloudflare tail observed a
successful invocation of that deployed version; lifecycle and Stripe scheduled
handlers reported disabled because their selectors remain unset.

The later staging deployment `839710a3-3290-46f8-b43c-c3a1e21d89c2` preserves
that Cron configuration. This proves one synthetic scheduled processing path,
not migration of all notification event producers/channels or production
recurring fit. No real user, production, or domain/DNS rows were changed.

## Invitation admin API staging canary (2026-09-26 JST)

Rebuilt the workers.dev SPA with `VITE_INVITATION_ADMIN_BACKEND=worker` and
deployed Worker version `839710a3-3290-46f8-b43c-c3a1e21d89c2`. The Worker uses
`INVITATION_ADMIN_BACKEND=d1`; the existing split business/Auth/master D1 and
R2 bindings and the every-minute notification Cron remain configured. Wrangler
dry-run confirmed the invitation selector and all staging bindings before the
deploy. A read-only bucket listing returned the expected
`fanmark-avatars-staging` and `fanmark-cover-images-staging` bucket names.

Ran `workers/api/test/staging-admin-totp-smoke.mjs` with an ephemeral verified
`example.invalid` admin identity and same-session TOTP assurance. The canary
confirmed anonymous invitation GET returns 401, then created a unique synthetic
code, read it from the list API, compare-and-set edited it, rejected a stale
revision with 409, disabled it, and deleted it. An independent readback found
zero invitation rows. The same run exercised existing emoji and notification
master reads/round-trip and removed the synthetic Better Auth identity; all
user-owned Auth tables read back empty. Root, auth health, and the new SPA asset
returned 200; after cleanup the invitation admin endpoint again returned 401.

Local Worker tests passed 5/5, frontend client tests 4/4, Worker and frontend
typechecks, Cloudflare-staging build, and Wrangler dry-run. No schema migration
was needed. Signup, invitation consumption, email, Stripe, production routing,
real user/invitation data, and domain/DNS were not changed.

## Return API to deployed notification Cron integration canary (2026-09-26 JST)

Extended `scripts/migration/staging-fanmark-return-smoke.mjs` to wait for the
currently deployed every-minute workers.dev notification Cron after the
synthetic return API operation. The return API emitted one owner-return event
and one favorite-availability event. Readback confirmed both reached
`processed`, each produced exactly one `in_app` notification in `delivered`
state with a Japanese body, and the owner/favorite payloads retained the
synthetic fanmark details and short-id link.

The smoke also retained the transfer-in-progress rejection, verified the
active-to-grace return and audit/event effects, and then removed both
notifications before their events, followed by the synthetic business/Auth
rows. Exact cleanup readback was zero for the synthetic fanmark, license,
transfer, favorites, discovery, audits, notification events, notifications,
Auth user/account/session. No notification masters or public settings were
changed. The smoke uses Cloudflare staging only; all generated identities and
fanmark values are synthetic, and production/DNS and real user data were not
accessed or changed.

## All migrated in-app notification rules through deployed Cron (2026-09-26 JST)

Extended `scripts/migration/staging-notification-processor-smoke.mjs` to submit
one synthetic event for each of the 10 active in-app master rules. Read-only
preflight confirmed each rule's active Japanese template. The currently
deployed one-minute workers.dev Cron processed all 10 events; each produced
exactly one `delivered` notification for the synthetic recipient, with the
expected Japanese title/body, fanmark metadata, and zero retries.

The smoke then deleted all notifications before their events and removed the
temporary settings row. Independent post-run checks found zero synthetic
events, notifications, preferences, or user settings; the 10/40 master data,
public lifecycle setting, and protected-access state matched their prior
baselines. The Cron remained enabled. This exercises the migrated in-app rules
and processor, not email/Web Push or production recurring capacity.

## Transfer API to deployed notification Cron integration canary (2026-09-26 JST)

Extended `scripts/migration/staging-fanmark-transfer-smoke.mjs` to wait for the
currently deployed workers.dev notification Cron after the synthetic
issue/apply/reject/reapply/approve lifecycle. The API emitted one
`transfer_requested` event for the owner and one `transfer_approved` event for
the recipient. The canary rejects a first request, verifies the transfer code reactivates, then
reapplies and approves it; `transfer_rejected` is delivered to the requester.
All three events reached `processed`, and each produced exactly one `in_app`
notification in `delivered` state with Japanese-rendered text and the intended
synthetic user and fanmark metadata.

The smoke waited up to 90 seconds, then deleted the notification rows before
their events. It removed the synthetic fanmark, old/new licenses, transfer
code/request, lottery/config rows, audits, user settings, Better Auth users,
accounts, and sessions. Independent cleanup readback returned zero synthetic
business and Auth rows and confirmed the MFA generation baseline was unchanged.
No real user data, production resource, or domain/DNS state changed.

## Staging whois details and R2 canaries (2026-09-26 JST)

Wrangler dry-run resolved `FANMARK_DETAILS_BACKEND=d1`, split Business/Auth/
Master D1 bindings, and both R2 bucket bindings. Read-only remote migration
lists reported no migrations to apply for any of the three D1 databases. The
staging app deployed at 100% as version
`44d56b91-dbcf-46ce-ac9a-900431b143f9`; live readback returned SPA 200,
`/api/auth/ok` 200/no-store, and an anonymous missing-whois response
200/no-store with a null result.

An integrated registration smoke created one synthetic owner/fanmark/license
and lottery entry. The anonymous whois response had `history_available=false`,
empty history, null owner name, and zero user-specific lottery state. The
Better Auth session response contained exactly one history row and the correct
owner/pending-lottery booleans, with no user ID or email. Cleanup reported
zero fanmarks, licenses, lottery rows, profile/config/audit rows, user settings,
Auth users/accounts/sessions, and all business rows after cleanup.

The R2 profile canary wrote an image to both staging buckets, read back matching
bytes, and deleted each object. The public paths returned 404 after cleanup;
synthetic Auth and business row counts were zero. No production traffic, real
user rows, or DNS/domain state was changed.

## Availability-rule administration and registration setting on staging (2026-09-26 JST)

A read-only linked-Supabase query returned the four global availability rules,
all disabled. The staging Business D1 had none before import. The explicit
seed copied only these four rows, preserved their rule configuration and
timestamps, converted top-level USD amounts to integer cents, and omitted the
source `created_by` administrator UUID. Remote readback confirmed four rows,
all `is_available=0` and `created_by=NULL`.

The public `system_settings.max_emoji_characters=5` row was also read-only
verified in Supabase. A pre-write check confirmed it was absent in staging;
the allowlisted insert then read back `max_emoji_characters=5` and
`grace_period_days=1`. No other system setting was copied. The staging
baseline checks now account for the four availability rows and these two
public settings rather than treating them as user data.

The app was deployed at 100% as version
`00ebddee-9f63-4840-abc8-f00dfe847ff5` on the existing workers.dev origin.
The frontend selects the MFA-protected Worker API for `AdminPatternRules`,
and registration reads the allowlisted maximum from business D1. The live
same-session TOTP canary read the rules, CAS-edited and restored one, rejected
a stale revision, and confirmed all four remain disabled. The registration
smoke rejected six distinct emoji IDs with `invalid_emoji_count`, then
completed a synthetic registration/lottery/details flow, tested owner-bound
R2 cover upload/read/delete, and read back zero user-owned business and Auth
rows and no remaining object.

Frontend and Worker typechecks pass; the full Worker package suite passes
88/88, registration D1 tests 10/10, migration-data tests 93/93, rule admin
client tests 5/5, and baseline tests 2/2. CI workflow isolation, targeted
ESLint, staging build, and Wrangler dry-run pass. These are staging and
synthetic-user checks only. No production routing, real user/Auth data, Stripe
operation, or domain/DNS state changed.

## OGP crawler HTML and image routes on staging (2026-09-26 JST)

Deployed `fanmark-app-staging` version
`767ff630-81c2-4b01-bf89-012fc43e8a29` with OGP handling for crawler requests
at `/a/:shortId` and bounded SVG generation at `/api/ogp-image`. A read-only
Googlebot request for a short ID absent from staging returned generic HTML
200, `Cache-Control: no-store`, `Vary: user-agent`, and staging no-index; its
fallback image URL remained on the workers.dev host. The same path with a
normal browser User-Agent returned the Static Assets SPA (200). The SVG route
returned 200; six-character input returned 400/no-store. Root and Better Auth
health stayed 200. No database or R2 writes were performed.

The D1 suite separately verified a synthetic public profile name is escaped,
a password-protected profile name and bio do not appear, and the ordinary
browser route reaches the SPA. Since the live staging D1 has no public profile
rows, no live user/profile OGP rendering was claimed. Production OGP, user
data, and custom-domain/DNS configuration were untouched.

## Emoji-path OGP staging readback (2026-09-26 JST)

Deployed `fanmark-app-staging` version
`4988be1e-5f1b-4839-8f3f-511d0a4238f6` with crawler handling for the legacy
emoji path. A Googlebot request to the absent `🌸` path returned generic HTML
200 with `Cache-Control: no-store`, `Vary: user-agent`, and staging no-index.
The canonical URL for resolved entries is `/a/:shortId`; the live D1 is empty,
so this request verified only the generic miss. A normal browser-style
navigation request (HTML Accept and `Sec-Fetch-Mode: navigate`) for the same
path returned the Static Assets SPA with 200. A non-navigation request with
`Accept: */*` remains a 404 as intended for a missing asset. No D1 row or R2
object was written.

The synthetic D1 test resolves one exact active emoji spelling, rejects
ambiguous duplicates to generic metadata, keeps protected profile details out,
and verifies browser navigation falls back to `index.html`. The focused public
access suite passed 13/13; full Worker suite 88/88, both typechecks, staging
build, targeted ESLint, CI isolation check, Wrangler dry-run, and `git diff
--check` passed. No production OGP, user data, or domain/DNS setting changed.

## Paired access-analytics staging canary (2026-09-26 JST)

Deployed `fanmark-app-staging` version
`2d23439f-359a-4e0b-8ed2-c91c523dd44f` at 100% with the paired public access
analytics writer and owner-read APIs selected in both the staging Worker and
SPA. The canary created a synthetic Better Auth user and business records,
recorded one access event, sent four duplicate requests, and read the owner
fanmark list, analytics metrics, and 30-day summary through authenticated
endpoints. The duplicate calls did not increment the count; the daily total and
unique visitor count were each one. Anonymous owner analytics returned 401.

Cleanup removed the synthetic business and Auth rows. The smoke check confirmed
zero business rows after cleanup and preserved the existing master/settings
baseline. Worker integration tests passed 8/8, each frontend analytics client
suite passed 3/3, frontend and Worker typechecks passed, and the Cloudflare
staging build and CI checks passed. Historical Supabase analytics were not
read or copied. This proves a synthetic workers.dev path only; populated-user
authorization, ingress abuse controls, retention, and production CPU/plan fit
remain open. Production and domain/DNS were unchanged.

## Reference-master editor paired-cutover gate (2026-09-26 JST)

The versioned D1 admin editor and its same-session MFA guard pass local client
and Worker tests, but checkout still consumes extension prices and Stripe IDs
from Supabase. The documented paired-cutover rule therefore keeps
`REFERENCE_MASTER_ADMIN_BACKEND` and `VITE_REFERENCE_MASTER_ADMIN_BACKEND`
unset on the final staging Worker/SPA. One interim deployment briefly carried
these selectors; no authenticated request or edit was made. It was immediately
replaced by `fanmark-app-staging` version
`7a2a780d-3fed-476b-a84e-905fc6d29aad`, with both selectors unset. The active
reference-master release and all source values remain unchanged.

After the corrective deployment, `/` returned 200 with `X-Robots-Tag:
noindex, nofollow`. Public master endpoints returned 200/no-store with 4 tiers,
4 languages, 5 reserved patterns, and 16 extension prices; the gated admin
pricing endpoint returned 503. Local admin client tests passed 6/6, reference
master Worker/D1 tests 6/6, and same-session admin authorization tests 13/13.
The authenticated admin editor and paired Supabase Edge checkout cutover remain
open. No user rows, Stripe resources, production routes, or domain/DNS settings
changed.

## Conditional Better Auth email/OAuth deployment (2026-09-26 JST)

After confirming there were no pending migrations on business, Auth, or master
D1, commit `76293cc` was deployed to `fanmark-app-staging`. Wrangler reported
Worker version `bc5ad53e-5f08-492b-81fb-8046c9be9600`; the deployment list
shows it at 100%. The deployment retains the existing split D1/R2 bindings and
Cron schedules. No email/OAuth selector or provider secret was added.

Read-only requests returned `/api/auth/capabilities` with
`emailVerification:false`, `passwordReset:false`, `signUp:false`, and
`socialProviders:[]`; `/api/auth/ok` returned 200 and anonymous
`/api/admin/session` returned 401. Synthetic email/password signup, password
reset request, social sign-in, and Google callback requests returned 403.
Browser-navigation requests to `/auth`, `/forgot-password`, and
`/reset-password?token=synthetic` served the SPA with 200. No email, OAuth
provider callback, Auth/Business D1 write, production route, or domain/DNS
change occurred. This verifies that the new integration is present but remains
closed by default; provider delivery and successful login are untested.

## Stripe invoice projection staging schema and disabled Worker deployment (2026-09-26 JST)

Applied business migration `0008` to the APAC `fanmark-business-staging`
database (`d4bb0c48-f24a-491f-8693-fa393ab0b873`) in account
`fanmark.id@gmail.com`. The verified migration ledger contains nine ordered
migrations. Exact readback confirmed the two invoice projection tables and two
indexes; invoice fence/application rows and all Stripe receipt/dispatch rows
remain zero. The existing fanmark, license, user-settings, and subscription
tables also contain zero rows.

Deployed Worker version `68a2e0bf-3236-444c-9c7a-a46294037855` to
`fanmark-app-staging` at 100% on workers.dev. Read-only probes returned 200 for
the SPA root and Better Auth health; auth capabilities remain false/empty.
`POST /api/stripe/webhook` with a synthetic empty request returned 404 because
the Stripe backend selector is unset. Read-only D1 metadata reported
`changed_db=false` and `rows_written=0`. Secret inventory contains no Stripe
API or signing secret. This confirms staging schema and code deployment only;
no Stripe API call, user data, production route, or custom domain/DNS setting
was touched.

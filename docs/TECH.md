# fanmark.id TECH.md

全一式復旧の専用Workerは`isolated-recovery-combined-worker.mjs`、native入口試験は
`npm --prefix workers/api run test:isolated-combined-recovery`。実Auth/Business/R2の
接続と全経路のprivate gateを確認し、通常Worker CIに含める。全Masterを含む保存file
復旧とremote受け入れは[別の測定工程](migration/full-combined-recovery.md)で確認する。

## スタックとランタイム
- フロント: Vite + React 18 + TypeScript, React Router, React Query, Tailwind CSS, shadcn/ui (Radix UI), Zod + React Hook Form, Sonner (toast), Lucide。
- バックエンド: Supabase (PostgreSQL, Auth, Storage, Edge Functions, pg_cron, Realtime)。
- 決済: Stripe (Checkout, Subscription, Customer Portal, Webhook)。
- 通知: Supabase テーブル駆動のイベント→ルール→キュー方式、Resend 等の外部チャネルを追加可能。
- その他: Vite PWA、Supabase OGP Edge Functions（production継続）とCloudflare Worker OGP preview（workers.dev staging配備済み）、MCP サーバ統合（計画/実装中）。

## セットアップと開発
1. 依存インストール: `npm install`（または `bun install`）。  
2. 開発サーバー: `npm run dev`（ポートは Vite デフォルト）。  
3. 型/静的チェック: `npm run lint`。  
4. ビルド: `npm run build` / プレビュー `npm run preview`。  
5. Supabase ローカル: `npm run db:start` / `db:reset` / `db:stop`（`supabase` CLI 依存）。`supabase link --project-ref <ref>` で本番/ステージングへ接続。  
6. 翻訳追加時は `src/translations/*.json` を編集し、UI で言語切替を確認。

## GitHub Actions: PR 検証と Supabase 本番デプロイ

`.github/workflows/supabase-deploy.yml` は、有効化された場合にPR の検証と本番デプロイを別ジョブで実行する。2026-09-21の確認ではGitHub上のworkflow stateは `disabled_manually`。この変更では有効化せず、以下は有効化後の動作を説明する。

- `pull_request`（対象ブランチ `main`）と `push`（`main`）では `validate` ジョブを実行する。`.node-version` の Node.js を使い、`npm ci --legacy-peer-deps`、`npm run check:ci`、`npm run typecheck`、`npm run build` を実行する。このジョブは Supabase の秘密情報、Supabase CLI、リモートプロジェクト、DB push にアクセスしない。
- `validate` は生成したPWAのキャッシュ境界を検査し、その直後のViteビルドを使って `workers/api` のStatic Assetsルーティング（local HTTPを含む）と配備用dry-runも検証する。再現手順は `docs/migration/static-assets.md`。
- `migration-validation` は `workers/api`、`experiments/cloudflare-auth`、`experiments/cloudflare-d1-concurrency`、`experiments/stripe-receipts` を別々に `npm ci` / `npm test` で検証する。APIの型検査・D1 recent/Auth契約試験・配備用dry-run、Stripe受信adapterと実SDKの型互換性検査も含む。Node 22.6.0のclean installを通すため、Vitestを使う3 packageはVite 6.4.3へoverrideしている。合成データとlocal Workers/D1・in-memory PostgreSQLのみを使い、秘密情報やremote配備権限を渡さない。
- `deploy` ジョブは `validate` と `migration-validation` の成功後の `push`（`refs/heads/main`）に限って実行する。GitHub Environment の `Supabase` を明示的に使用し、そのジョブだけが `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_ID` を参照する。プロジェクトを link して `supabase db push` を実行し、生成型を更新する。本番デプロイは `supabase-production` concurrency group で直列化し、実行中のデプロイをキャンセルしない。
- 生成型の差分がある場合、`deploy` ジョブは `src/integrations/supabase/types.ts` をコミットして main へ push する。デプロイジョブには `contents: write` が必要である。

有効化する前に、リポジトリの Settings > Environments で `Supabase` Environment を作成または確認し、次の Environment secrets を登録する。

- `SUPABASE_ACCESS_TOKEN`: Supabase CLI の認証トークン
- `SUPABASE_DB_PASSWORD`: 対象プロジェクトのデータベースパスワード
- `SUPABASE_PROJECT_ID`: 対象 Supabase プロジェクトの ref

Environment の名前だけでは承認やブランチ制限は有効にならない。Required reviewers、Deployment branches、待機時間などを運用上必要とする場合は、Settings > Environments で個別に設定し、設定済みであることを確認する。GitHub Actions の `GITHUB_TOKEN` が main への push を許可されていることも確認する。PR 検証にはこれらの秘密情報や設定は不要である。

`validate` の `--legacy-peer-deps` は、現在の lockfile が date-fns 4 と react-day-picker 8 の組み合わせを保持しており、npm の通常の peer dependency 解決では `npm ci` が停止するために指定している。依存関係を更新して peer range を解消できた場合は、このフラグを外せるか再確認する。

## メンテナンスモード（system_settings）
- `maintenance_mode`: `true` でアプリ全体をメンテナンスページへ切替。
- `maintenance_message`: メンテナンス画面に表示する本文。空の場合は翻訳キーのデフォルト文言を使う。
- `maintenance_end_time`: ISO 8601 文字列（未設定は空文字）。表示はフロントでローカル日時に整形。
- 制御: `MaintenanceGate` が設定値を監視し、`/admin` は常にバイパス、管理者は通常表示を継続できる。

## Supabase: スキーマ/関数運用
- 移行用の認可catalogは`scripts/migration/source-authorization-bindings.sql`のread-only transactionで取得する。生のpolicy式/function本文はprivateに保持し、`source-authorization-review.mjs`でhashと権限metadataだけのreportを生成する。triggerへのEXECUTEと通常functionの権限を区別し、grantだけでRLS/API移行完了とは扱わない。手順・検証範囲は`docs/migration/source-authorization-review.md`。全77policyのidentity/式hashと40表の現行API/内部処理・契約差は`docs/migration/source-policy-counterparts.md`に対応付ける。対応表は全権限・外部consumer・最終統合の承認を意味しない。
- Migration-first: `supabase migration new <name>` で作成し、既存関数の返り値変更時は **必ず `DROP FUNCTION IF EXISTS ...`** を先頭に置く（`SUPABASE_MIGRATION_GUIDE.md` 方針）。
- 主な Edge Functions:  
  - ライセンス/取得: `register-fanmark`, `return-fanmark`, `bulk-return-fanmarks`, `extend-fanmark-license`, `check-expired-licenses`  
  - 抽選: `apply-fanmark-lottery`, `cancel-lottery-entry`  
  - 譲渡: `generate-transfer-code`, `apply-transfer-code`, `approve-transfer-request`, `reject-transfer-request`, `cancel-transfer-code`  
  - 決済: `create-checkout`, `create-extension-checkout`, `change-subscription`, `customer-portal`, `handle-stripe-webhook`, `check-subscription`  
  - 通知: `process-notification-events`  
  - 管理/ユーティリティ: `_shared/return-helpers`, `reset-fanmark-data`, `admin-*`, `fanmark-ogp`, `generate-ogp-image`, `record-fanmark-access`
- RPC/ビュー: `check_fanmark_availability`, `get_fanmark_by_emoji/short_id/complete_data`, `validate_invitation_code`, `use_invitation_code`, `add/remove_fanmark_favorite`, `get_favorite_fanmarks`, `record_fanmark_search`, `get_user_lottery_entries`, `notification` 系など。追加時は `src/integrations/supabase/types.ts` を同期。
- Cron: Supabase Dashboard > Database > Cron Jobs で HTTP POST 実行。  
  - `check-expired-licenses-daily` (`0 0 * * *`) → `functions/v1/check-expired-licenses`  
  - `process-notification-events-every-minute` (`* * * * *`) → `functions/v1/process-notification-events`。通常は無効で、`notification_events` に pending が追加された時だけDBトリガーが有効化する。Edge Function はキューが空になった時だけ無効化し、呼び出し失敗時は有効状態を維持して翌分に再実行する。将来時刻の pending がある場合も有効状態を維持する。

## Cloudflare stagingの本人profile検証

取得APIの検証は`npm run --prefix workers/api test:fanmark-registration-d1`。
通常Worker CIに含め、既存21回帰と現行25 Business/4 Auth/8 Master・実sessionの5件を
実行する。MasterのTierは実release view、停止は実管理者MFA/停止transactionを通す。
契約・範囲は[取得API](migration/fanmark-registration-api.md)、現行writerと最後の
データ工程へ残すindex条件は[sequence review](migration/source-sequence-key-review.md)。

実Workerを使うeditor browser試験は、`Fetch.continueRequest`の無効ID拒否を
同じ`networkId`のChrome `Network.loadingFailed(canceled=true)` receiptと照合する。
receipt不明・別ID・別code等の失敗は隠さない。実Chromeでpause/abortを再現し、
API応答の置換は行わずeditorの保存/下書き/所有権の確認を保つ。
helperの6回帰は`node --test scripts/migration/test-browser-request-interception.mjs`で、
通常`test:migration-data`/CIにも含める。全browser試験は
`npm run test:staging-profile-editor-local`。390pxは実スマホ検証の代わりにはしない。

このeditor試験の保存失敗1回は、Chromeの
[`Network.setBypassServiceWorker`](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-setBypassServiceWorker)
をその期間だけ有効にし、ページの`Fetch.failRequest`で実PATCHを遮断する。
同じ`networkId`の`Network.loadingFailed`と`net::ERR_CONNECTION_FAILED`も要求し、
遮断を仕掛けただけで失敗再現済みとは扱わない。API応答は置換しない。
遮断後に通常のService Worker経路へ戻してから、下書きreload・実Workerへの再試行、
DB保存を検証する。これはPWA経由の通信障害試験の受け入れではない。

Cloudflareの本人profile native検証は`npm run --prefix workers/api test:profile-d1`。
全25 Business/4 Auth migration・実session/R2・invitation FKと各caseのFK checkを
使用し、通常Worker CIの`test:api-contracts-d1`にも含まれる。sourceのsettings権限と
登録triggerの対応は[trigger照合](migration/source-trigger-counterparts.md)を参照する。
絵文字ID正規化・Tier・旧文字列counterの対応は[source emoji helpers](migration/source-emoji-helpers-review.md)。availabilityとregistrationは`workers/api/src/fanmark-tier.ts`を共有し、公開APIの1〜5個の入力制約とMaster参照は各経路に保持する。
現行25 Business/4 Authスキーマでの合成移送・再開・新DB復旧は`workers/api`の`npm run test:business-runtime-import`。`business-runtime-import-schema.mjs`が独立したD1でチェックイン済みmigrationの期待DDLを作り、移送先の全objectと照合する。scopeと生成スキーマとの差は[d1 import](migration/d1-import.md)を参照する。

認証情報の合成復旧は`npm --prefix workers/api run test:auth-recovery:d1`。
全4 Auth migrationの9表を、SDKで作成したTOTP/暗号化backup code・bcrypt password・
session/同一factor assurance・停止状態を含めて別local D1へ復旧する。AES-GCMのJSON
往復、schema/SDK鍵の照合、既存target拒否と実Worker経由の再ログインを確認する。
通常`test:auth:d1`/Worker CIへ含める。実credential exportやdurable鍵保管の証拠ではない。
鍵依存とsession復旧方針の範囲は[合成Auth復旧](migration/synthetic-auth-recovery.md)。
保存ファイルからの合成Auth復旧では全9非空表/14行/30 schema objectをAES-GCMで保存し、
元ランタイム終了後に別native D1へ復元して実SDK login/TOTP/backup code/停止拒否を確認した。
隔離Auth用entrypointは`isolated-recovery-auth-worker.mjs`、通常CIの
`test:isolated-auth-recovery`はtoken/incarnationと小さなallowlist、実signin/logoutを確認する。
main Workerへbinding/routeを追加せず、実remote資源は候補CI/所有receiptを照合して作成する。
159f5c1のCI両job成功後、保存済み全合成Auth9表/14行/30定義を実D1と専用Workerへ復旧し、
元password/TOTP・backup codeの再利用拒否・停止拒否を確認。一時資源削除と独立main全表hash保持も
[受け入れ済み](migration/evidence/synthetic-auth-file-remote-recovery-2026-10-06.json)。運用鍵/失効方針と最終一式復旧は残る。
Masterのrelease・avatar/coverの分離R2を同じbundleへ含めた復旧は`npm run test:combined-recovery`。importer codec v5はprofile等の世代writerを認証情報より先に取り込み、v4の途中runを継続しない。合成データ限定で、画像URLのブラウザ配信・remote復旧時間は別に確認する。
隔離D1向けのREST prepared/batch transportは`isolated-remote-d1.mjs`、専用native試験は
`test:isolated-remote-d1`。作成receiptのUUID/名前/時刻/incarnationと実metadataを照合し、
明示remote mode・全runtime profile・Auth resolverを必須にする。完全remote復旧は未受け入れ。
Masterの全スキーマ復旧で、実D1 REST `/query` が小文字`begin`のtriggerを拒否する
問題を確認した。`scripts/migration/d1-rest-trigger-sql.mjs`は、SQLiteで検証済みの
単一CREATE TRIGGER定義に明示適用し、引用符・comment・literalを保持してbodyの
`BEGIN`だけを大文字へ補正する。一般のtransportやsource schemaは変更しない。
`test:isolated-remote-d1`にliteral保持とnative trigger作用の回帰試験を含める。
source/target schema照合は、この明示したキーワード補正だけを許す。
分離R2は`split-r2-import-transport.mjs`でlogical bucket/keyとphysical keyを対応付け、
combined復旧で実Storage GET/HEADとbytes/MIME/sizeを検証する。

## 絵文字マスタ更新（Unicode emoji-test.txt）
- Cloudflareの公開カタログAPIは、検証済み不変releaseの`ordinal`範囲を既存indexで読む。外部offset形式を保ち、SQL OFFSETによる前方走査を避ける。ページの連番/件数とクライアントの全カタログ検証は維持する。読み取りbudgetとnative検証は`docs/migration/emoji-releases.md`。
1. Unicode 公式から `emoji-test.txt` を取得して `data/emoji/` に保存する。  
   - 例:  
     - `curl -o data/emoji/emoji-test.txt https://unicode.org/Public/emoji/15.1/emoji-test.txt`
2. `emoji-variation-sequences.txt` が公開されていれば取得する（Unicode 配布に無い場合は ISO/IEC 10646 側を確認）。ない場合はスキップする。  
   - 例（ISO/IEC 10646）: `curl -o data/emoji/emoji-variation-sequences.txt https://standards.iso.org/iso-iec/10646/ed-6/en/emoji-variation-sequences.txt`  
   - `scripts/convert-emoji-test.mjs` はファイル未取得でも警告のみで継続する。
2. 変換スクリプトでマスタCSV/JSONを生成する。  
   - `node scripts/convert-emoji-test.mjs --format both`  
   - 出力: `data/emoji/emoji-master.csv` / `data/emoji/emoji-master.json`
3. 管理画面 > 絵文字マスタ管理 で CSV/JSON をインポートする。  
   - CSV ヘッダー: `emoji,short_name,codepoints,keywords,category,subcategory,sort_order`  
   - codepoints はスペース区切り
4. 従来のフロント用カタログを再生成する（Supabase から `emoji_master` を取得）。
   - `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/generate-emoji-catalog.ts`  
   - 出力: `src/data/emojiCatalog.ts`
   - D1移行準備では、DB UUIDを保持したレコード配列を明示入力できる: `node --experimental-strip-types scripts/generate-emoji-catalog.ts --input /private/path/emoji-records.json --output /private/path/emojiCatalog.ts`。`--input` 指定時はSupabase環境変数を使わず、ネットワーク接続しない。
   - 入力は `id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order` を持つJSON配列。D1のJSON格納列は配列へdecodeして渡す。UUIDを持たないUnicode変換直後のJSONや生のWrangler応答は直接入力しない。
   - 重複UUID・lookupが曖昧になる絵文字・不正な配列を拒否し、検証成功後だけ出力を置換する。Unicode更新・D1書込み・本番カタログ公開は別工程。検証: `npm run test:emoji-catalog`。

Cloudflare版では、`workers/api/src/index.ts`の`GET /api/emoji/catalog`がD1のreleaseを読み取り、`VITE_EMOJI_CATALOG_BACKEND=worker`を設定したフロントが起動時に500件ずつ版固定で取得する。Worker APIは`EMOJI_CATALOG_BACKEND=d1`と`FANMARK_DB`を明示して設定する。取得に失敗した場合はSupabase/静的版へフォールバックしない。Workerを使わないビルドでは既存の生成カタログを遅延読込する。版付き成果物は`scripts/build-emoji-release.ts`で生成する。旧版とのUUID/sequence照合、内容hash、検証後の版別保存は[移行用カタログ成果物](migration/emoji-releases.md)を参照する。`scripts/migration/emoji-master-release-stage.mjs`はローカルD1、`emoji-master-release-remote-stage.mjs`は明示指定したWrangler remote D1で検証済みreleaseをprivate stagingへ読み込み、readback一致後に`ready`とする。`emoji-master-release-remote-activate.mjs`は期待する現在版を必須指定してremote pointerを切り替える。2026-09-23時点で公開カタログ3,944件を隔離remote D1へ格納し、generation 1として有効化した。専用API Workerの版なしAPIを全8ページ取得し、成果物hashと一致することを確認済み。SPA/API staging Workerもimmutable versionを固定参照し、robots/sitemapと`X-Robots-Tag`でnoindexにしている。Better Authの8表と6 triggerを適用し、合成アカウントのログイン・session/logoutを確認後、全ユーザー行を削除した。signup、メール配信、OAuth、業務schema/API/認可の移植は未完了。2026-09-24時点で分離D1とR2 staging bucketをapp Workerへ接続し、合成upload/read/delete smokeを確認済み。実ユーザーデータと独自ドメイン/DNSは未移行。

画像Storage APIは`workers/api/src/storage-r2.ts`にある。R2 bindingと`STORAGE_BACKEND=r2`が揃った場合、`GET/HEAD /api/storage/public/{avatars|cover-images}/{path}`は公開画像を読み取り、`POST /api/storage/object/{bucket}`はBetter Auth sessionから所有者を特定して画像を登録する。object keyはサーバーが`{userId}/{randomUUID}.{extension}`で発行し、`DELETE /api/storage/object/{bucket}/{path}`は先頭の所有者IDがsessionと一致する場合だけ削除する。avatarは1 MB、cover imageは2 MBまで。Content-TypeだけでなくJPEG/PNG/GIF/WebP/AVIFのsignatureも照合し、許可Origin、credentials付きCORS、`nosniff`、1時間のpublic cacheを適用する。フロントの`src/lib/storage-api.ts`と画像hooksは`VITE_STORAGE_BACKEND=r2`を明示した場合だけWorkerへ送り、Better Auth mode以外では拒否し、通信・APIエラー時もSupabaseへフォールバックしない。production buildの既定はSupabase。staging buildではR2 uploadsと本人プロフィールのWorker API selectorが有効で、合成R2 upload/read/deleteと合成profile read/updateを確認済み。profile upload/update/delete/readbackの連結はlocal D1/R2 integration suiteとworkers.dev staging canaryで検証済み。既存object/user rowは未移行で、production Storageは未変更。Worker試験は`npm run --prefix workers/api test:storage-r2-api`と`npm run --prefix workers/api test:profile-d1`、client契約は`npm run test:storage-api`と`npm run test:profile-api`。詳細は[Storage API移行準備](migration/storage-r2-app-api.md)。
取り込み済みSupabase public画像URLは`workers/api/src/storage-image-url.mjs`で読み取りDTOをR2へ対応させる。`STORAGE_LEGACY_ORIGIN`/`STORAGE_PUBLIC_BASE_URL`を明示し、snapshot/D1の元参照を保持する。同じ画像の変更なし保存は元URLを保ち、timestamp/nested keyのowner削除をclientが許可する。stagingは合成source originだけを選択し、6a1870a/CI37118191381・Worker51db2c90で実API/Chromeの編集・公開画像表示と元参照保持・削除を受け入れた。[画像URLの対応と検証](migration/storage-image-url-mapping.md)。


ダッシュボード所有一覧、ホーム画面の保有数、プラン変更時の返却選択は`workers/api/src/owned-fanmarks-d1-repository.ts`の`GET /api/me/fanmarks`からD1を読む。WorkerはBetter Auth sessionから得たuser IDだけを所有者条件に使用し、クエリ入力のuser IDを受け取らない。応答には画面表示に必要なファンマーク・ライセンス・基本設定のみ含め、emailやuser IDは返さない。保有数とプラン上限の判定では期限なしのactiveライセンスも1件として数える。クライアントは認証APIとWorkerのoriginが一致することを確認し、最大応答サイズも制限する。`VITE_OWNED_FANMARKS_BACKEND=worker`と`OWNED_FANMARKS_BACKEND=d1`を明示した場合だけ利用し、エラー時は別DBへフォールバックしない。Cloudflare staging buildとWorkerはこのselectorを選び、合成Better Authユーザーと合成business D1を使うAPI・UI検証は`npm run --prefix workers/api test:owned-fanmarks-api`。

プロフィールは`workers/api/src/profile-d1-repository.ts`の`GET/PATCH /api/me/profile`から本人の`user_settings`を読む。Better Auth session由来のuser ID以外を更新対象にせず、表示名・同一ユーザー所有のR2 avatar URL・優先言語に限定する。plan typeとpassword setup状態はread-onlyで返し、Stripe customer IDとinvitation codeは返さない。username availabilityは`GET /api/me/username-availability?username=...`からbusiness D1を読み、除外する本人IDをBetter Auth sessionからだけ取得する。候補名や本人以外のIDを変更する書込みは行わず、曖昧なquery・認証なし・Worker障害は拒否する。Cloudflare staging buildで`VITE_PROFILE_BACKEND=worker`を選択し、この変更の合成D1/API契約テストは通過済み。Worker/API障害時にSupabaseへ戻らない。実profile rowは未移行、production selectorもSupabaseのまま。synthetic Better Auth/D1/R2 integration testは`npm run --prefix workers/api test:profile-d1`、client契約試験は`npm run test:profile-api`。

ファンマーク設定は`workers/api/src/fanmark-settings-d1-api.ts`の`GET/PATCH /api/me/fanmarks/:fanmarkId/settings`で移行した。Better Auth本人sessionから最新所有ライセンスを解決し、activeかつ期限内の場合だけD1の複数設定行を`batch()`で保存する。4桁パスワードはbcryptjs 3でWorker内hash化し、値/hashをAPIレスポンスやruntime evidence表へ出さない。保護付き公開アクセスの証跡は、現在のlicense incarnation・password generation・enabled状態・codecに結び付くhash-free `fanmark_password_runtime_evidence`で管理する。変化が起きると既存証跡は世代照合に失敗する。stagingでは`VITE_FANMARK_SETTINGS_BACKEND=worker`と`FANMARK_SETTINGS_BACKEND=d1`を選択し、合成read/writeと保護アクセスを確認済み。local synthetic D1試験は`npm run --prefix workers/api test:fanmark-settings-d1`、client契約試験は`npm run test:fanmark-settings-api`。実ユーザー行とproduction経路は未移行。

通知受信箱は`workers/api/src/notifications-d1-api.ts`の`GET /api/me/notifications?limit=1..50`、`GET /unread-count`、`PATCH /{id}/read`、`POST /read-all`からbusiness D1を操作する。所有者はBetter Auth sessionからのみ決定し、未読数と全件既読は配信済み・未期限切れを条件とする。個別既読は本人の未読行ならstatus/expiryに関係なく更新し、既存RPCの範囲を保つ。ページ応答を256 KiB、各payloadを16 KiBに制限する。workers.dev stagingでは`VITE_NOTIFICATIONS_BACKEND=worker`と`NOTIFICATIONS_BACKEND=d1`を選び、synthetic inbox read/mark-readを確認済み。Worker/API障害時にSupabaseへフォールバックしない。Worker側は30秒poll、productionのSupabase側は既存Realtimeを維持する。実ユーザーの通知行は未移行。合成Better Auth/D1統合試験は`npm run --prefix workers/api test:notifications-d1`、client契約試験は`npm run test:notifications-api`。管理画面のルール/テンプレート編集も`NOTIFICATION_MASTER_BACKEND=d1`と`VITE_NOTIFICATION_MASTER_BACKEND=worker`でstaging選択済み。通知イベント処理は`workers/api/src/notifications-scheduled.ts`にD1版を実装し、deployed Worker selectorとD1 wake marker/SQLite Durable Object alarmをworkers.dev stagingで有効にし、空queue時は停止する。毎分Cronは除いた。processor単体の合成canaryに加えて、Worker返却APIが作る所有者/お気に入りイベント2件の日本語in-app配信と完全cleanupをstagingで実証済み。`archive_old_notifications`相当のD1 archiverは90日より古い`delivered`/`failed`を最大2,500行ずつ履歴へ移し、衝突行は保持して`partial`を返す。明示selector `NOTIFICATION_ARCHIVE_BACKEND=d1`が必要で、2026-10-04にstagingで有効化した。全25 Business migrationを適用したnative D1試験で境界1us、19フィールド、disabled、衝突、削除失敗時のatomic rollback、同内容履歴の再開、2,500行上限/残行の再開を確認した。staging D1の合成archive smokeは2026-10-02に成功し、2026-10-06 09:00:57 JSTのmain実Worker/Cronはexpiry/grace/archiveの自然実行・完了・例外0を確認した。対象0件のmain観測であり、有データarchiveは別の隔離Cron検証の証拠とする。[自然日次の限定証拠](migration/evidence/staging-natural-daily-2026-10-06.json)。source側の実呼出し/custom cutoff、履歴の長期保存方針、本番定常運用・CPU適合性は未確認。残るイベント発生元とメール/Web Push配信も未完了。詳細は[通知API移行準備](migration/notifications-api.md)。

期限切れのactive→grace処理は`workers/api/src/license-expiry-scheduled.mjs`からWorkerの`scheduled` eventへ接続できる。`LICENSE_EXPIRY_BACKEND=d1`、split D1、明示したtarget incarnation/schema extension digestが必要で、1回4ページ（各64件）を既定上限にする。未完了runは元の時刻・grace期間で再開する。app stagingのCronはexpiry用の日次だけを保持し、通知処理はD1 wake marker/SQLite Durable Object alarmを使う。通知processorはD1で有効だが、`LICENSE_EXPIRY_BACKEND`は未設定なのでexpiry Cronはdisabledを返す。Stripe dispatchもselector/secretsが未設定でdisabledのまま。expiryを有効化する前に業務D1 schema・CPU/プラン・synthetic remote canaryを確認する。合成D1での再開・効果検査は[期限切れ処理のローカル検証](migration/license-expiry-proof.md)。

ユーザーを含まない`fanmark_tiers` / `languages` / `reserved_emoji_patterns` / `fanmark_tier_extension_prices`は、`workers/api/src/reference-master-d1-repository.ts`の公開GETルートからactive ready D1 releaseを版固定で読む。API allowlist、release全体のtable manifest/row count、DTO、exact integer cents、一意性を検証してから、Tier・予約パターン・延長価格は有効行だけを`no-store`で返す。言語はsourceの全行SELECTに合わせて無効行もactivation状態を保持する。公開Tier/価格clientは有効な部分集合と空一覧を受け入れるが、inactive行や重複・不正値を拒否する。`useLanguages`は`VITE_LANGUAGE_READ_BACKEND=worker`、`AdminExtensionCoupons`のティア表示は`VITE_REFERENCE_MASTER_READ_BACKEND=worker`、延長料金表示は`VITE_EXTENSION_PRICING_BACKEND=worker`で選べる。Worker取得に失敗した場合はSupabaseへ戻らない。延長料金のMFA保護された版付き管理API、Edge Functionの署名付きD1価格参照も用意し、private routeはstaging Workerへ配備済み。公開料金APIにはStripe IDを返さず、`/api/internal/reference-masters/extension-price`は60秒以内のHMAC署名、origin拒否、`no-store`を検証する。Cloudflare staging buildでは`VITE_EXTENSION_PRICING_BACKEND=worker`が公開価格をD1から読み、`VITE_REFERENCE_MASTER_ADMIN_BACKEND=d1`がMFA保護された版付き価格編集を同じreleaseへ書き、`VITE_STRIPE_EXTENSION_CHECKOUT_BACKEND=worker`が購入要求をWorkerへ送る。Worker configは`REFERENCE_MASTER_ADMIN_BACKEND=d1`を選択する。2026-10-04にStripe checkout/webhook/dispatch selectorsとtest-onlyのStripe secretsをstagingへ設定し、Worker決済routeを有効化した。Sティアの実延長Checkout、拒否時未延長、3DS成功、実署名自然処理・重複単一適用と専用fixture cleanupを確認した。UIはSupabase Edge Functionへフォールバックしない。通常build/productionはSupabaseのまま。署名付きreference-price serviceは配備済み。クーポン適用は`/api/me/licenses/extend-with-coupon`、管理用CRUD/履歴はMFA保護された`/api/admin/extension-coupons`を使い、Cloudflare staging build/WorkerでD1を選ぶ。適用はD1の一つのcommand INSERTとtriggerで利用上限、重複、ライセンス条件を再検証して全ての効果を原子的に確定し、同じowner/request IDの再送は保存済み結果を返す。管理APIはクーポン作成、利用上限/期限の設定、active切替、未使用クーポンの削除、使用履歴の最小表示を提供する。使用済みcouponの削除は拒否する。Supabaseで未使用かつusage履歴なしと確認した定義4件だけをbusiness staging D1へseedし、created_byをNULLにしてdigest付き完全一致readback済み。利用済み定義・usage履歴・license・ユーザー行は未コピーで、移行データを使った成功受入は未実施。production/default buildはSupabaseのまま。予約パターンAPIはまだ画面から消費していない。参照マスター取込とread APIの条件は[参照マスター移行](migration/reference-master-data.md)を参照。

参照マスターの管理snapshot readerは、保持済みrelease内のPostgreSQL UTC表記（小数0〜6桁・`+00`/`+00:00`）と旧ISOミリ秒表記も受け入れ、新snapshotだけを小数6桁のUTCへ正規化する。文字列のfractionを保持し、旧releaseを更新せず、不正日付・非UTC・過剰な精度を拒否する。汎用importerとstandalone releaseの入力契約は変更しない。

Cloudflare staging modeの管理画面はBetter Authでログインし、`GET /api/admin/session`を通じてWorkerが管理者roleとsession/factorに結び付いた期限内MFA assuranceを再確認する。未設定ならWorkerが`mfa_enrollment_required`を返し、画面からTOTPを登録する。登録済みのMFAが未確認なら`mfa_required`となり、TOTP challengeを要求する。Supabase modeの管理認証は変わらず、stagingのWorker経路にSupabase fallbackはない。絵文字マスター管理は`/api/admin/emoji-master`経由でMaster D1のcanonical draftを更新する。公開済みUUID・絵文字・コードポイントはDB triggerで保護し、画面から削除できない。draft更新は公開版を変えず、release成果物の検証と別操作のactivationが必要。stagingのユーザー管理一覧/詳細・プラン変更・停止/復旧・ライセンス即時失効は、同一sessionのMFAを要求し、Auth D1/business D1へ分離して書き込む。即時失効はライセンス、4種の設定行、業務監査、管理監査、通知イベントを一括で確定する。パスワード再設定は`POST /api/admin/users/:userId/password-reset`からBetter Authのtoken生成とResend配信を行い、未設定時は503で閉じる。ブラウザーへメールアドレスやリンクは返さず、送信試行をbusiness D1へ監査記録する。broadcast email管理はstagingの`/api/admin/broadcast-emails`で下書き一覧・テンプレート参照・対象数集計・下書き作成までD1へ移す。固定のserver-side宛先だけへ送るMFA保護のテスト送信APIも実装済みで、Resend adapterはmockで検証した。bulk send-start、Auth ID snapshot、leased Resend dispatch、署名Webhookと冪等な監査投影がローカル実装され、合成D1/APIテストで検証済み。UIは`VITE_BROADCAST_SEND_BACKEND=worker`がない限り送信操作を無効にする。コードはCloudflare stagingへ配備済み。認証用の共通Resend key/fromは設定済み。2026-10-06に本人許可の固定宛先1通をtest-send APIで送信し、Resend DeliveredとD1監査の一致を確認した。通常設定へ復元後、broadcast固定宛先・署名secret・bulk/test-send selectorsは再び未設定。送信UI・bulk・署名配送/retry/retentionは未受け入れ。今回の管理者MFAは実Safariの既存factor challenge・同一session/factorのassurance・UI logoutまでを受け入れ、登録UIへ拡張しない。詳細は`docs/migration/evidence/staging-admin-mfa-broadcast-delivery-2026-10-06.json`。読み取り専用の`scripts/migration/staging-broadcast-preflight.mjs`は明示したWorker version、28 template content baseline、告知queue aggregateと設定の有無だけを照合し、送信・設定変更を行わない。12件のbroadcastテンプレートは2026-09-27時点のSupabase source digestでbusiness staging D1へseed/readback済み。実provider acceptance、queue retentionと不確定送信の運用方針は残る。詳細は`docs/migration/broadcast-email-admin-api.md`。ユーザー停止・即時失効・パスワード再設定の契約は`docs/migration/admin-user-status-api.md`、`docs/migration/admin-license-expiry-api.md`、`docs/migration/admin-password-reset-api.md`。

`AdminDataReset`は全fanmark・license・関連設定を削除する旧Supabaseユーティリティである。Cloudflare staging buildでは`VITE_ADMIN_DATA_RESET_BACKEND=worker`を明示し、server `ADMIN_DATA_RESET_BACKEND=d1`を選ぶ。Worker 13dca8cfで合成MFA/API/desktop dialog/cleanupを確認済み。通常buildでは従来のSupabase動作を維持する。Worker/D1 counterpartは追加Business 0023と `POST /api/admin/data-reset` で実装し、同session MFA、明示Origin、DELETE確認、durable request IDを要求する。local全Business schemaで検証済みだが、staging selector有効化を空userdata/固定account/version/native canary guard/復旧journalを確認した合成canaryと併せて行い、保持Master/Authとcleanupを検証した。実ユーザー移行の実施は条件にしない。詳細は `docs/migration/admin-data-reset-api.md`。

合成データの一式remote復旧は、[隔離復旧conductor](migration/isolated-combined-recovery.md)
でBusiness/Auth/Master D1と分離R2・一時Workerを明示して所有し、同じbundleを
別incarnationへ復旧する。画像のHTTP転送は`isolated-remote-r2.mjs`と一時Workerで
条件付き作成、本文/hash/metadataの照合、実Storage GET/HEADを保つ。新経路の
native7件と共通化後local combined試験、2cbf4e0/CI37115000097両jobが通過した。
専用認証・設定照合・有限GET readiness後の一式remote fixture復旧は、2 targetの
40表/15行・Master/2画像・中断再開・FK/wake・cleanup/独立inventory一致まで
受け入れ済み。[値を含まない証拠](migration/evidence/isolated-combined-recovery-2026-10-03.json)。
Authは合成依存userのseed。source URL変換/ブラウザ・全source gate/運用RTOは
別条件で、CIはremote commandを実行せず、実ユーザー/DNSも変更しない。

## セキュリティ / RLS の公開方針（誤検知対策）


このプロダクトは「ドメインレジストリ（WHOIS）モデル」で、**一部のデータは意図的に公開**します。セキュリティスキャナが「公開＝危険」と判定しやすいため、以下の公開方針は **誤検知として無視（ignore）** します。

- `fanmarks`: 所有/登録状態は公開情報（検索・トレンド機能の前提）。
- `fanmark_licenses`: `user_id` はUUIDのみで、PIIは `user_settings` に隔離。所有関係は公開情報。
- `fanmark_discoveries`: `search_count` / `favorite_count` 等の匿名集計のみ（PIIなし）。
- `system_settings`: `is_public=true` の設定のみ公開。プランの表示価格・上限は `system_settings` を参照する。
- `recent_active_fanmarks`（VIEW）: 「最近のファンマーク」表示用の最小限データのみ。
- `user_roles`: 役割判定はRLS + SECURITY DEFINER の `has_role()` 等で制御（他ユーザーの役割列挙は不可）。

**スキャンで頻出する誤検知（ID / internal_id）**

| ID | internal_id | 対象テーブル | 判定理由 |
|----|-------------|--------------|----------|
| `PUBLIC_USER_DATA` | `fanmark_licenses_user_exposure` | fanmark_licenses | レジストリモデルのため仕様上公開（UUIDのみ、PIIは `user_settings`） |
| `PUBLIC_USER_DATA` | `licenses_uuid_only` | fanmark_licenses | 同上 |
| `PUBLIC_USER_DATA` | `discoveries_aggregate` | fanmark_discoveries | 匿名集計データ（search_count, favorite_count）のみでPII無し |
| `EXPOSED_SENSITIVE_DATA` | `system_settings_public` | system_settings | `is_public=true` の設定のみ公開（RLSで制御済み） |
| `EXPOSED_SENSITIVE_DATA` | `user_subscriptions_payment_exposure` | user_subscriptions | RLSで `auth.uid() = user_id` のみ許可。他ユーザーのデータは見えない |
| `MISSING_RLS_PROTECTION` | - | recent_active_fanmarks | VIEWのRLS指摘だが、公開用の最小データのみで仕様上公開 |
| `MISSING_RLS_PROTECTION` | `fanmark_events_no_user_protection` | fanmark_events | service_role/adminのみアクセス可。audit_logsで監査済み |
| `MISSING_RLS_PROTECTION` | - | user_roles | 「本人のrole参照のみ」を許可。タイミング攻撃は許容範囲 |
| `PUBLIC_DATA_EXPOSURE` | `fanmarks_broad_access` | fanmarks | レジストリモデルで意図的に公開 |
| `STORAGE_EXPOSURE` | `storage_bucket_policies` | storage.objects | avatars/cover-imagesは適切なRLS設定済み |
| `SUPA_function_search_path_mutable` | - | - | 主要SECURITY DEFINER関数は設定済みで低リスク |
| `SUPA_extension_in_public` | - | - | publicスキーマの拡張警告。実害なし |

> 重要: `user_settings` は **常に auth.uid() = user_id** で保護し、公開しない（PII保護の境界）。



## Stripe デプロイメント（要約）

- プランの公開設定APIは料金・上限等11キー、MFA付き管理者設定APIはStripe Price ID/Enterpriseを含む19キーに分ける。旧sourceの価格ID公開flagとstagingのprivate test IDの両方を管理者読取で扱い、公開応答はどちらも除外する。設定読取失敗をデフォルト料金で隠さない。詳細は[migration/system-settings-api.md](migration/system-settings-api.md)。
- テスト/本番で別々の Product/Price・Webhook エンドポイントを作成。Webhook URL: `https://<project>.supabase.co/functions/v1/handle-stripe-webhook`、イベントは checkout.session.completed / customer.subscription.* / invoice.payment_* を登録。
- Workerのscheduled Stripe dispatcherは`scheduledTime`を6桁UTCへ変換して渡す。invoice/subscription reconciliationもこの6桁形式を受け入れ、D1 lease期限の計算でサブミリ秒部分を保持する。未設定環境ではWebhook/dispatchを閉じる。現在のstagingは専用test-only選択とsecretsを設定し、毎分dispatchを有効化した。
- Cloudflare Workerには署名Webhook ingress、D1 receipt/dispatch、拡張Checkout、plan Checkout/change、Customer Portal、subscription/invoice照合を実装した。Business migrations `0006`〜`0013`にreceipt、dispatch、extension application、invoice ledger、customer fence、subscription application/guard、Free return batch/item、owner-bound customer/Checkout/change commandを保持する。2026-10-04の`87b61ef`/CI37200812928両job成功後、Worker `ca971193`に6 billing selector、test-only credentialsと毎分dispatch Cronを配備した。日次expiry/archive Cronと通知DO alarmは維持する。実test Checkout/Portal/Creator→Business→Freeの署名反映、重複・処理済みevent逆順再送・自然retryと専用合成fixture cleanupを確認した。実取得からの延長Checkoutで拒否時未延長、3DS成功、実署名自然処理・重複単一適用と独立cleanupを確認した。定期請求の実拒否/失敗投影、古い成功eventの初回逆順配信でも現在失敗を維持、成功復旧と独立cleanupを確認した。定期請求の実payment_action_required投影、保存済みカードのhosted3DS完了、同じInvoice/PaymentIntentの成功復旧と独立cleanupも確認した。同一利用者の画面全体は未受け入れ。Subscription/invoiceの照合はモード別keyとprivate Price mappingを要求し、test-only stagingではlive keyを許さない。現在のStripe状態とcustomer fenceを再確認し、プラン反映、最後の契約削除時のFree化・上限超過ライセンス返却・監査/通知を同じD1 batchで検証する。曖昧な所有権や効果の欠落ではrollbackする。既定/productionのSupabase routing、実ユーザー移送と公開domain/DNSは変更していない。詳細な受け入れ証拠は`migration/HANDOFF.md`を参照。
- Supabase Secrets（Lovable/Supabase CLI 経由）を更新: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_CREATOR`, `STRIPE_PRICE_ID_BUSINESS`, `FRONTEND_URL`。
- Customer Portal はモードごとに設定し、プラン切替を許可。延長 Price ID は `fanmark_tier_extension_prices` を Admin UI から管理（環境変数不要）。
- Checkout 後は `subscription-sync-flow` のポーリングでプラン同期。問題があれば `stripe_payment_intents` / `stripe_webhook_events` / `user_settings.plan_type` を照合。
- Stripe Customer は初回決済時に作成・取得し、`user_settings.stripe_customer_id` に保存。Webhook は `stripe_customer_id` でユーザー特定する。
- `customer.subscription.deleted` は同一customerにactiveサブスクが存在しない場合のみ `plan_type='free'` に更新。
- プラン変更（有料→有料）は `subscriptions.update` で price を更新し、アップグレードは `proration_behavior='create_prorations'`、ダウングレードは `proration_behavior='none'` とする。
- 有料→有料の更新で支払い方法が不足している場合は Customer Portal に誘導して支払い方法を追加する。
- `check-subscription` は Stripe の price_id を参照して `user_settings.plan_type` を同期する。
- `customer.subscription.created/updated` は `status='active'` の場合のみ `plan_type` を更新する（トライアル無し）。
- `checkout.session.completed` で `metadata.type=license_extension` の場合、延長後は必ず status=active, grace_expires_at=null, is_returned=false、除外解除、UTC 0:00 に丸めた `license_end` へ更新し、フロントの延長パス（extend-fanmark-license）と同じ状態遷移に揃える。

## 通知・お気に入り・抽選の実装ガイド

- 検索の本人別抽選状態と期限判定は、`npm run --prefix workers/api test:fanmark-search-d1`で全canonical Business migration（現在25件）とnative local D1、実Better Auth sessionを通して検証する。通常Worker CIのD1契約群に含め、mock SQL応答だけで認可・microsecond境界の同等性を確認したとは扱わない。
- 通知: まず `notification_events` にイベントを登録（`create_notification_event` RPC）。Supabaseではpending追加トリガーが通知Cronを起動し、`process-notification-events` がルール・設定・テンプレートを適用する。Cloudflare版のD1 scheduled processorは `workers/api/src/notifications-scheduled.ts` にあり、`NOTIFICATION_PROCESSOR_BACKEND=d1` とD1 wake marker/SQLite Durable Object alarmをworkers.dev stagingで有効にしている。Worker返却APIがD1へ追加した2種類の合成イベントを実Cronが処理し、日本語in-app通知として配信した。ローカルD1でも即時in-app、遅延、テンプレート、再ポーリングを検証済み。source version209のdownloadはchecked-in processorと同じbytesで、即時in-appのみdeliveredになることを確認した。segment_filterはsource同様に厳密比較し、D1のrequires_password_setupだけを0/1からbooleanへdecodeする。数値条件への暗黙変換は行わない。空payload言語はsettings/defaultへ戻し、空fanmark IDのcooldown/maxは利用者・rule全体を数える。本文はsourceのchannel非限定template lookup、UTF-8順のJSONB key、nested JSON/decimal表記とliteral置換を保つ。ドル記号を置換tokenとして解釈しない。sourceのread-only合成literal oracle7ケースを含む通知53/53で確認した。これらの修正のremote acceptanceは未完了。管理画面向け通知ルール/テンプレートの限定編集APIは`NOTIFICATION_MASTER_BACKEND=d1`と`VITE_NOTIFICATION_MASTER_BACKEND=worker`を選ぶstagingでsame-session MFA canaryまで確認済み。手動イベント作成とイベント/通知ログはstagingでMFA保護されたWorker APIへ接続済みで、手動作成201・配信・alarm停止/復旧を合成検証した。productionの既定はSupabase。未移行のイベント発生元、メール/Web Push配信と本番相当の運用は未確認。本人通知受信箱はWorker APIで処理できる。
- お気に入り: `fanmark_discoveries` で未取得も含めたカタログを保持し、`fanmark_favorites` と `fanmark_events` で使用履歴を管理。`VITE_FAVORITES_BACKEND=worker`を明示した場合は`/api/me/favorites`で一覧・追加・削除をD1へ送り、active emoji releaseに基づきskin toneを除いたID列を正規化する。UIトグル後はReact Query cacheを無効化する。workers.dev stagingではfrontend/Worker selectorを有効にして合成canaryを確認済み。productionの既定はSupabaseで、実ユーザーのfavorite/event rowsは未移行。API/client検証は`npm run --prefix workers/api test:favorites-d1`と`npm run test:favorites-api`。
- 抽選: Grace 中のみ申込可。延長は申込中でも可能で、延長実行時は pending エントリーを `cancelled_by_extension` に更新し通知。バッチで抽選→ライセンス発行→通知→履歴保存までをトランザクションで処理。
- 移管ロック: 移管完了時に `fanmark_licenses.transfer_locked_until` を30日後で更新し、`generate-transfer-code` で発行をブロック。

## MCP / 外部連携
- MCP サーバー方針: Edge Function `mcp-server`（計画）で `get_fanmark_profile`, `get_fanmark_redirect`, `get_fanmark_message`, `search_fanmark` ツールを公開。公開プロフィールのみ返却し、パスワード・非公開は抑止。`emojiConversion.ts` と既存 RPC を再利用。
- 画像メール/メール送信は Resend 等に差し替え可能。production OGP は `generate-ogp-image` でサーバーサイド生成する。Cloudflare preview は `/a/:shortId` とlegacy `/:emojiPath` のcrawler HTML、`/api/ogp-image` SVG routeを`workers/api/src/ogp.ts`で生成し、public D1 projectionsだけを読む。絵文字パスはactiveな完全一致が1件の場合のみcanonical short IDへ解決する。crawler HTMLはUser-Agentで応答が異なるため`no-store`、SVG入力は上限を設けHTML/XMLをescapeする。empty-D1 crawler fallback/browser SPA/imageをstagingで確認済み。実プロフィール表示とproduction切替は未完了。
- Cloudflare 等の CDN/キャッシュをかける場合はパスワード保護・非公開プロフィールの扱いに注意。

## 開発ワークフロー
- 原則 GitHub を単一ソース。Supabase 変更は Migration 経由でコミットし、`supabase db pull` で同期確認。Lovable での UI 調整後も Git に反映。
- 変更手順例: `git pull` → 開発 → `supabase migration new ...`（必要時）→ `npm run lint` → `git add` → `git commit` → `git push`。Supabase 連携で自動デプロイされる。
- トラブル時: 関数返り値変更エラーは `DROP FUNCTION` を確認、cron 未実行は `cron.job` / Edge Function Logs を確認、Stripe 反映不全は Price ID と Secrets を照合。

## QA/テスト観点
- Tier 判定: 1〜5個の絵文字（連続/非連続）で S/A/B/C を網羅。無期限ライセンスは延長不可で表示を「無期限」扱い。
- 返却/猶予: `grace_expires_at` に基づく再取得不可/カウントダウン表示を確認。`available_at` を UI に出す。
- 移管: コード発行条件（残48h+、申請中ブロック、AuthCode有効期限48h固定/`license_end`までの短い方）、承認後の新ライセンス発行・設定コピー、Transfer Lock 30日を検証。
- 抽選: 延長との排他、0/1/複数件パス、当落通知、履歴保存。
- 抽選エラー: `apply-fanmark-lottery` の `fanmark_limit_reached` を UI で翻訳して表示する。
- Stripe: Checkout → Webhook → `user_settings.plan_type` 反映、Customer Portal でプラン変更、延長決済の Price ID 設定。
- お気に入り/通知: 返却時の `favorite_fanmark_available` 通知、未読バッジ、キャッシュ同期。
- UI改修の原則: 本来不要なロジック（バリデーション・データ処理）を変更しない。仕様変更が必要な場合は必ず仕様を確認し、ユーザーの合意を取ってから行う。Auth では特に、ログインパスワードは8文字以上でチェック表示、目アイコンは入力が1文字以上のときだけ表示し、メール欄とアイコン位置を揃える。

## PWA と移行時のキャッシュ

旧source→現行sourceの同一localhostでのSW更新は、CUAで実ブラウザーのcache退役/設定保持と現行PWA画面まで確認した。[限定PWA証拠](migration/evidence/pwa-legacy-update-local-2026-10-06.json)。旧API cacheは合成値で、実サービスAPI/実端末/standaloneの受け入れへ拡張しない。

`src/main.tsx`はroot要素を確認後、絵文字カタログを待つ前にService Workerを登録する。カタログ取得の遅延・失敗時も更新を確認できるようにし、React本体は選択したカタログ取得後にのみ描画する。失敗時のエラーと再試行、別backendへ戻らない契約を保持する。`npm run test:app-startup`は実entrypointの遅延・失敗・成功・Service Worker非対応・root不在を確認し、通常CIで実行する。これは実端末の旧PWA更新・cache退役の受け入れとは分ける。

Service Workerはビルド済み静的ファイルだけをprecacheする。SupabaseおよびWorker APIの応答はruntime cacheへ保存せず、`/api` 配下のnavigationへSPA HTMLを返さない。新しいService Workerのactivateで旧`supabase-cache`を削除し、過去のAPI応答が残らないようにする。静的precacheや他の名前のcacheは削除しない。既存端末への反映は配備後にService Workerが更新・activateした時点であり、ローカルビルドだけでは既存cacheの削除を確認したことにならない。

取得可能判定のWorker接続は `VITE_FANMARK_API_BASE_URL`、Worker側のD1選択は独立した `AVAILABILITY_BACKEND=d1` と `FANMARK_DB` を使う。未設定は既存Supabase RPC。フロント検証は `npm run test:availability`、Worker検証は `workers/api` の `npm test` と `npm run test:availability:d1`。

匿名の公開ファンマreadは `VITE_PUBLIC_ACCESS_READ_BACKEND=worker` を明示したビルドで、同じAPI base URLの短縮ID・絵文字・公開プロフィールWorker APIを使う。未設定時はSupabase RPC、Worker選択後のエラーではSupabaseへフォールバックしない。Worker側は `PUBLIC_ACCESS_BACKEND=d1` とbusiness `FANMARK_DB`、絵文字正規化用のmaster `MASTER_DB` が必要。2026-09-25時点でCloudflare staging build/Workerにこのselectorを設定し、分離D1の合成レコードで3経路を確認済み。合成レコードは削除し、業務D1の対象表は0件に戻した。password-protected recordに当たるとWorkerは内容をredactし、検証・表示はfail closedする。Supabaseのpassword検証は既定Supabase pathだけで使う。`/f/:shortId` whois詳細もstagingでは`VITE_FANMARK_DETAILS_BACKEND=worker`を明示し、匿名には公開概要のみ、認証済みにはBetter Auth本人sessionに対応した履歴・お気に入り・抽選状態を返す。通常buildはSupabase RPCを維持し、Worker応答失敗時のfallbackはしない。契約と限界は `docs/migration/public-access-contract.md` と `docs/migration/fanmark-details-api.md`。

Better Authは `workers/api/src/better-auth.mjs` に共通化し、通常Workerの `/api/auth/*` から利用する。`AUTH_BACKEND=better-auth`、Auth D1、32文字以上の `BETTER_AUTH_SECRET`、HTTPSの `BETTER_AUTH_URL` がそろわないと503で停止し、Supabase Authへはフォールバックしない。CORSは明示したHTTPS originだけをCookie付きで許可する。招待signup Coordinatorは実装済みで、両D1 migrationとWorkerはstagingへ配備済み。招待mode、Resend設定、`INVITATION_SIGNUP_BACKEND=d1` がそろうまで無効。合成D1検証は `npm --prefix workers/api run test:auth:d1` と `test:invitation-signup-d1`、既存TOTP/admin-assurance検証は `npm --prefix experiments/cloudflare-auth test`。

2026-09-25の`fanmark-app-staging`ではBetter Authのlogin/sessionを合成アカウントで確認し、Auth D1を分離した。Cloudflare Secret Storeにはstaging専用secretを登録し、リポジトリやビルド成果物には含めない。2026-09-26にsignup Coordinatorを実装・合成検証し、両migrationとWorkerをstagingへ配備した。Resend/selectorは未設定のため、実際のsignup・メール送信は閉じたまま。OAuthも資格情報がないため無効。実ユーザーのAuth/業務データ移行やproduction認証切替を意味しない。

管理画面の招待コードCRUDには、`INVITATION_ADMIN_BACKEND=d1`と`VITE_INVITATION_ADMIN_BACKEND=worker`で選ぶMFA保護API/clientを追加した。招待コードは未移行のため両selectorはstagingで無効。コード検証・消費とsignupのローカルCoordinatorは `docs/migration/invitation-signup-api.md` を参照し、実データとResend設定が整うまで引き続き閉じている。管理APIの契約は `docs/migration/invitation-admin-api.md`。

待機リスト管理は`workers/api/src/waitlist-admin-d1-api.ts`のD1 APIを使う。`WAITLIST_ADMIN_BACKEND=d1`と`VITE_WAITLIST_ADMIN_BACKEND=worker`を選んだstaging経路では、Better Authの同一セッションMFAとD1 `user_settings.plan_type='admin'`の両方を要求する。`GET /api/admin/waitlist`は最大100行のハッシュ済みメールとpayloadを含めない監査概要を返し、`GET /api/admin/waitlist/:id/email`は監査insert成功後に限り個別アドレスを返す。公開登録は`workers/api/src/waitlist-signup-d1-api.ts`の`POST /api/waitlist`を使い、`WAITLIST_SIGNUP_BACKEND=d1`と`VITE_WAITLIST_SIGNUP_BACKEND=worker`を明示したstagingだけでbusiness D1へ保存する。重複と新規の応答は同じで、Cloudflare Rate Limitingの粗いstaging制限を使う。通常buildのselectorはSupabaseで、Worker障害時に別DBへフォールバックしない。実行経路と制約は `docs/migration/waitlist-admin-api.md` と `docs/migration/waitlist-signup-api.md`。

Cloudflare buildのOAuth初回パスワードゲートはBetter Auth sessionと`GET /api/me/profile`を照合し、profile取得失敗時は保護画面を閉じたままにする。`POST /api/me/password-setup`は本人session、business D1の`requires_password_setup`、server-only Better Auth `setPassword`を組み合わせ、Auth D1書込み後の再試行もcredential検証で復旧する。通常のCloudflareパスワード変更は現在パスワードを必須としてBetter Auth `/change-password`へ送り、Supabase buildは従来経路を維持する。契約と限界は[初回パスワード設定API](migration/password-setup-api.md)。

Better Authの`advanced.database.generateId="uuid"`で新規AuthレコードIDをUUIDにする。既存IDを更新する処理はない。SDK既定の32文字IDは課金APIのUUID actor境界と不一致だったため、実signup由来IDの形式とcustomer portalの認証境界をnativeで検証する。後者は合成user resolverとprovider未設定状態であり、実課金や確認メール/sessionの通し受け入れではない。

OAuth policyは`auth-social.mjs`がBusiness D1の`social_login_enabled`/`invitation_mode`を1照会で読み、許可時だけgatewayがprovider一覧と認証開始/callbackを開く。欠落・不正値・読取り失敗では閉じる。設定をAuth instanceと共にcacheしないため、開始後の招待mode変更にもcallbackで対応する。Auth native suiteは全25 Business migrationsを使い、停止時の外部fetch0とAuth状態不変を確認する。

新OAuthユーザーのprofile provisioningは`oauth-signup-provisioning.mjs`を
`AUTH_SOCIAL_PROVISIONING_BACKEND=d1`で選ぶ。Auth core/0007/0008/0009とBusiness
schema、4つのidentity unique indexが必要で、gatewayはschema不足でもOAuthを閉じる。
markerとprovider account subjectを検証し、profileの同じUUID/所有者をreadbackしてから
sessionを発行する。停止確認はpluginがBusiness書込みより先に行い、共通のcore guardも
維持する。`test:oauth-signup-d1`のnative54件は4provider・各段階のcommit前/ACK不明・
復旧/競合/設定変更を検証し、Worker CIに含める。47b69c5の両CI成功後、stagingの
Auth0009/selectorを適用し、合成marker付きユーザーの実session guard5ケースと
既存editor/favoritesの実ブラウザ検証が成功した。marker付きAuthユーザーはseedで、
remote新規SDKユーザー/新OAuth credential生成や実provider接続の証拠ではない。
詳細は[OAuth登録の復旧契約](migration/oauth-signup-provisioning.md)。

招待signupのnative検証は全25 Business migrationとAuth core/0007/0008、
`AUTH_USER_STATUS_BACKEND=d1`を使用する。`test:invitation-signup-d1`の15件は
4言語・source初期値・metadata権限入力・cross-D1復旧を検証し、各case後に両DBの
FK違反がないことを確認する。literal PostgreSQL oracleとOAuth新規登録の残作業は
`docs/migration/source-signup-provisioning.md`を参照。実Resend配送は別の受け入れ。

## 通知workerの起動・停止（Cloudflare staging検証中）

D1のpending event INSERT/UPDATEと同じtransactionでBusiness 0024の起動世代を進める。
`notification-wake.ts`のSQLite-backed Durable Objectは短いwake/sleep判定を直列化し、
alarmの永続化後にその世代をackする。HTTP mutationのwaitUntilとscheduled jobのfinallyで
未ack世代をflushする。起動失敗ではD1 markerを残し、次のmutationかMFA保護の管理APIで
再起動する。空queueはalarmを消し、future event/processing lease/障害/freeze中は保持する。
D1とDOのcommitは別で、強制終了後の再起動経路も運用検証が必要。staging namespace/schema/selectorは有効化済み。remote D1はpending INSERTとwake trigger更新を合算した`meta.changes=2`を返すため、手動通知作成は`INSERT ... RETURNING id`のexact receiptで判定する。合計更新件数を1件と比較しない。native IGNOREやwake marker欠落は503で拒否し、全Business schemaのlocal test 20/20で確認した。修正版`ea309178`を100% workers.dev配備し、実signin/TOTP/MFAの合成通知で201・日本語配信・NULL alarmへの停止、native future eventのunacked世代とMFA repair、due-time変更後の配信/停止を確認した。保持baseline一致とAuth/業務fixtureの削除も確認済み。`docs/migration/notification-worker-wake.md`参照。

staging configはSQLite coordinator bindingと`notification-wake-v1`のclass migration、
`NOTIFICATION_WAKE_BACKEND=durable-object`、日次Cronだけで配備済み。
実remote切替ではCI/空source・Auth/0024 exact readbackを確認した。notification/expiry/archiveの
local scheduled rehearsalは`NOTIFICATION_WAKE_BACKEND:disabled`を明示し、local DOが
remote起動世代をackしない。disposable recovery Workerは独立config/vars allowlistで
DO namespaceを継承しない。partial activation、minute Cronとの併用はguardで拒否する。

Stripe dispatcherと一斉メールのdurable queueは通知DOとは別に毎分Cronを使う。
現在のprovider未設定baselineは日次Cronだけで維持する。将来
`STRIPE_DISPATCH_BACKEND=d1`または`BROADCAST_SEND_BACKEND=d1`を有効にするconfigには
`* * * * *`も必要で、DOを選択した通知processorはそのCronから選ばれない。
`npm run check:cloudflare-schedules`はbase Wrangler configの有効jobと実Worker routerを
照合し、Cron未登録、bulk sendのD1 draft backend欠落、重複/不正なtriggerを拒否する。
Cloudflare検証CIでも実行する。これは静的設定の確認であり、provider credentials、
Cronのremote配信、決済/メールの受理や復旧を証明しない。provider有効化時には既存の
通知baseline guardと秘密名allowlistも別途更新・検証する。

## Source runtime catalogの接続先レビュー

`seq_key(uuid[])`のsource expressionはNULL要素を省き、空配列もhash化する。
converterのcanonical JSON indexは非空・NULLなしの配列に限る候補であり、3indexに
`seq_key_input_contract_requires_review`を残す。literal PostgreSQL oracleとSQLite
同値差の回帰検証は`migration/source-sequence-key-review.md`を参照。

公開プロフィール/所有者helperの照合は`public-profile-runtime-readiness.sql`で
6関数の定義・profile列・policy式を再取得し、本文を非公開で保持する。
Workerのowner profile APIは無期限Tier Cもread/saveできるようreadとUPSERTで
`license_end IS NULL OR license_end > captured_now`を使う。元editor/INSERT policyの
finite-only条件からの明示的な修正で、Supabaseの本番policyと公開絵文字/short-IDの
selection差は変更しない。8件のowner D1試験と14件の公開read試験が成功。
sourceの旧RPC/helperの構造差と未確認の外部consumerは
[プロフィールruntimeレビュー](migration/public-profile-runtime-review.md)に記録する。

編集画面はAuthProviderのloading解除を待つ。Workerのメールログインは内部のreturn URLを
使い、取得拒否/通信失敗時はフォームを閉じて再試行を表示する。hookのread generationで
古い応答を無効化する。`npm run test:staging-profile-editor-ui`はstaging build後のChrome
描画試験で、全通信をローカルfixtureへ置き換え、8ケースと390pxの横幅を検証する。
保存失敗はformへ伝播して下書きを保持し、再読み込み・再保存成功まで確認する。
application CIでもbuild後に実行する。remoteの保存/再表示と実機mobileは別の検証。

読み取り専用の`source-runtime-bindings.sql`はpublic関数に接続される全schemaのtriggerと
public event-triggerのmetadataを取得する。source function本文を含むraw出力はprivateに
保存し、`source-runtime-review.mjs --catalog ... --output ...`で本文のないreportへ変換する。
exact SHA/type/security metadataと登録接続先を検証し、publicだけのscope・Auth依存欠落・
source driftを成功扱いしない。CLIは入力/出力のaliasを拒否し、mode 0600でatomic renameする。
任意の`--counterparts docs/migration/evidence/source-function-counterparts-2026-10-03.json`で
完全な手動traceを照合できる。fingerprintとsignature/hash/type/security/volatility/binding数を
一致させ、本文はhashだけにする。mappedFunctionCountはpending semantic reviewと区別し、
converter gateを外さない。trace/output aliasも拒否する。
`test-source-runtime-review.mjs`はmigration-data CIにも含む。最新の接続先と4つのunbound
trigger関数の扱いは[接続先レビュー](migration/source-runtime-review.md)を参照する。

所有ファンマのプロフィールAPIのnative試験は全25 Business migrationとAuth
core/0007/0008を使い、stagingの停止ユーザーselectorも適用する。9ケースで無期限所有、
生成/更新のアクセス世代、write直前のgrace移行、停止後の既存session拒否と他所有者の
継続利用を確認する。簡略化したprofile SQL fixtureは削除した。コマンドとremote/editor
の証拠境界は[owner profile API](migration/fanmark-profile-api.md)を参照する。

通知起動のnative20ケースは、起動bridge失敗後に失効処理を無効のまま既存日次Cronから
再試行し、配信後の空queueではalarmを再開しない経路も検証する。日次invocationとD1/DO
利用可能性が前提で、失敗時の1分以内復旧を保証しない。
[通知起動・停止](migration/notification-worker-wake.md)を参照する。

外部providerの未設定項目、実装由来のOAuth callback、Stripe test-only credential条件、
接続リハーサルの合格条件は[staging provider準備](migration/staging-provider-readiness.md)
にまとめる。secret名/config確認は接続成功の証拠ではなく、実受信/認証/決済試験は未完了。

`npm run test:staging-profile-editor-local`は、空envDir/45 staging selectorsで一時HTTPS
loopback用の実frontendをbuildし、local Worker/Business・Auth・Master D1につなぐ。
全25 Business/3 Auth/8 Master migrationを適用し、認証・保存失敗/下書きreload/再保存・
公開設定・他所有者・停止済sessionをAPI応答の模擬なしで確認する。D1/R2は全bindingを
remote:falseとし、account/routes/servicesは使わず、終了時にlocal DB stateを削除する。
既存offline描画8ケースと併せてapplication CIで実行する。provider/staging/実端末の証拠とは
区別する。詳細は[owner profile API](migration/fanmark-profile-api.md)を参照する。

抽選申込/再申込/取消のD1 APIはserver-generated audit UUIDで今回の監査を特定し、同じbatch内のSQL assertionで保存された申込状態とexact audit fieldsを検査する。不一致はSQLite errorでbatch全体をrollbackするため、commit後の件数チェックに依存しない。`test:fanmark-lottery-d1`は全25 Business/4 Auth migrationと実Better Auth session/routerを使い、Worker CIの`test:api-contracts-d1`にも含む。詳細は[migration/fanmark-lottery-api.md](migration/fanmark-lottery-api.md)。

譲渡承認も`lottery-cancellation-audit.ts`と同一batchの完了assertionを使う。応募snapshotがbatch取得前に変わった場合、取消監査または移管監査が欠落・改変された場合、ライセンス・設定削除・申請更新・outboxが抑止された場合は全変更をrollbackする。`test:fanmark-transfer-d1`は全25 Business/4 Auth migration、実Better Auth signin/sessionとWorker routerを使う37件のnative proof。Masterはティア参照用fixtureなので全Master schema受け入れはこのsuiteでは主張しない。remote acceptanceは[migration/fanmark-transfer-api.md](migration/fanmark-transfer-api.md)とHANDOFFで区別する。

譲渡承認の`c6a4f9d`はCIとstagingの5故障/rollback/retryケースまで受け入れ済み。remoteでは実Masterティアを参照し、テストデータ・triggers・cookieのcleanup、保持Master/MFA/secretとmonotonic wakeのreadbackも通過した。この譲渡受入時点のstagingは`71d1612f-5220-4bf1-bc7f-99cc43adbbd7`。後続の退会受入は以下に記録する。全source/RLS/callers/provider/運用の検証は未完了。


## 退会処理のtransaction境界（Cloudflare staging受入）

`account-deletion-d1-api.ts`は共通の抽選取消snapshot/audit guardを使い、DELETE_ACCOUNT監査とcleanup効果・保持履歴をBusiness D1の同じbatchで検査する。既存退会監査はID・時刻・内容を保持してAuth削除の再試行に使い、重複・不正内容は拒否する。`account-deletion-auth.ts`は現在パスワードと本人sessionを再確認し、ユーザーDELETEのFK cascadeと終了状態をAuth D1の一つのbatchで確定する。失敗時にcredential/sessionだけ先に消えるSDKの逐次deleteUserは使わず、SDK endpoint自体も無効化した。削除後のSDK sign-outで複数cookieをそのまま返す。Business/Auth/Stripe間の原子性はなく、先に確定した返却・billing・Business cleanupは残る。全25 Business/4 Auth migrationのnative66/66、両CI37092452003とstagingの合成故障/再試行6ケースを受入済み。現在のWorkerは`4a8d85dd-dfc4-424b-94ff-14354ae1fc4f`。remoteでは返却済みgrace fixtureでBusiness rollbackとAuth failure/retryを分けて検証し、cleanup・独立baseline readbackも通過した。実provider、populated billing、remote active返却、実端末、全source/運用の完了を意味しない。詳細は[退会API](migration/account-deletion-api.md)。


検索記録とお気に入りの更新は`workers/api/src/discovery-mutations.ts`を共有する。
全25 Business migrationのnative試験で再現したevent/count抑止時の部分commitを修正し、
期待するdiscovery/favorite全列と新規eventのreceiptをcommit前に検証する。
件数はSQLite INTEGERで計算し、bindされた増分も明示castして浮動小数への変換を防ぐ。
同一identityの競合による確定済みSQL rollbackのみ最大2回再試行する。
通信断などcommit成否が不明な結果は内部再実行しない。native17/17とclient12/12が通過。
CI/配備の受け入れは別途必要で、source seq_keyの3 index gateは閉じない。

### 2026-10-04 Stripe staging test接続

`ebfbcf6`/CI37199647817の両job成功後、`fanmark-app-staging`へ6 billing selectorと
毎分dispatch Cronを配備した。test-only policy、既存日次Cron、MFA/通知alarmは維持する。
19 test Price、専用10 eventの署名Webhook、test default Portalと14 secret名称を設定した。
本番Stripe/default buildは切り替えていない。現時点の正確な配備・受入状態は
[migration/HANDOFF.md](migration/HANDOFF.md)と配備証拠を参照する。

Subscriptionのprivate test Price照合は`system_settings.is_public=0`も要求する。
sourceから継承した公開flagを、test Price3件だけのCASでprivateへ修正した。
Customer PortalのPOSTは入力を受け取らない。Cloudflareの空streamはEOFまで確認して
許可し、非空本文は最初のbyteでキャンセル・拒否して、認証/Stripe呼出しに進まない。
Origin、owner/customer対応、test-only credential選択は従来のguardを維持する。

## 現行frontend呼び出しと移行対応表の照合

`node --test scripts/migration/test-frontend-callsite-mapping.mjs`は、
`inventory.mjs`で現行`src`をAST抽出し、対応表の行番号・操作・対象・動的式を照合する。
一致後に全呼び出しが意味対応へ各1件だけ接続していることを検証する。静的資料同士の
一致だけでは合格にしない。抽出自体のfixtureは`test-inventory.mjs`で確認する。
このscannerの標準receiver/importの範囲を、全プログラムのdataflowや外部callerの
不在へ拡張しない。対応表は`docs/migration/frontend-callsite-map.md`。

## 最後のデータ工程のID事前チェック

`identity-readiness.sql`は4表の配列形状と3表の一意性・fanmarksの表示identity制約を
件数だけで確認する。実テーブルを読む版は最後のユーザーデータ工程用で、未実行。
`identity-readiness-oracle.mjs --scenario valid|blocked`は同じSQLの入力CTEだけを
合成値へ置き換え、実データを読まずPostgreSQLで検証できる。通常migration CIには
`test-identity-readiness.mjs`のSQL証拠hash/集計結果と、実importerの拒否・保持チェックを
含める。範囲と再現手順は[migration/source-sequence-key-review.md](migration/source-sequence-key-review.md)。

告知メールのイベント順序修正はBusiness追加`0025_broadcast_delivery_terminal_outcomes.sql`と`broadcast_delivery_effective_events` viewに置く。webhook挿入・provider ID照合は同じ有効イベントを選び、苦情/恒久bounceを後着成功で消さず、suppressionがある場合だけ他の未送信行を停止する。`broadcast-email-delivery-d1.ts`は完了済みrunも配信結果に合わせて再集計する。詳細・検証境界は`docs/migration/broadcast-email-delivery-design.md`。

Business追加`0026_broadcast_delivery_provider_time.sql`は告知Webhookにnullable `provider_created_at`を追加し、effective viewを発生日時順へ更新する。`broadcast-email-webhook-d1.ts`は署名body root日時を必須検証し、UTC offsetと全小数桁を保持する。署名時刻/受信日時/メール作成日時を混同しない。既存NULL時刻を推定補完せず、苦情/恒久bounceの優先は維持する。詳細は告知配送設計書。

## Auth D1復旧の共通処理

`workers/api/src/auth-d1-recovery.ts`は、9表のcapture・AES-256-GCM seal/openと
空targetへの単一batch復旧を提供する。schema hash/SDK鍵identityと明示session policyを
照合し、失効方式を選ぶ場合はsession/MFA assurance/verificationを取り込まない。
失効後も元のcredential/factor/role/停止監査/generationを保持する。
保存と読込はGCM tag 16 bytesを含む暗号文32 MiB上限を共用し、保存時は暗号化と
JSON byte array展開の前にUTF-8サイズを確認する。超過時は平文bufferを消去して拒否する。
`npm --prefix workers/api run test:auth-recovery:d1`はこの共通実装で実SDKの認証、
rollback、commit後ACK喪失/再実行拒否を検証する。運用policyの採用や定期/off-host
collector有効化は含まない。詳細は[Auth復旧](migration/synthetic-auth-recovery.md)。

## 通常ログインのTOTP確認

Better Authを選ぶ`useAuthForm`はsign-inのsession応答とtwo-factor redirectを区別する。
redirectの場合は`TotpLoginChallenge`を表示し、同じbrowser cookieでSDKのverify-totpを
呼ぶ。有効sessionを確認した`refreshSession`の成功を待ち、Authページの既存user/session
監視で遷移する。missing/failureはfalseで、challengeを完了扱いにしない。
回帰検証は`npm run test:auth-login-mfa`。実際のTSX hook/ProviderとSDKを実行し、外部
HTTP/UI/context adapterだけを合成に置換する。native D1/ブラウザー受け入れは別に記録する。

## Master D1復旧の共通処理

内部処理は`d1-store-recovery.ts`へ共通化した。既存format/APIとlegacy Auth空の契約は
保持し、native回帰7件を確認している。

`workers/api/src/master-d1-recovery.ts`の限定契約・サイズ/query制限は
[master-recovery.md](migration/master-recovery.md)。native local D1試験は
`npm --prefix workers/api run test:master-recovery:d1`で通常Worker CIにも含める。
既知25表・独立schema pin・legacy Auth空・空targetを要求し、履歴を先に投入して
triggerを後から設置する。保存済み全Masterの限定照合は定期collector採用ではない。

## 招待必須登録の実local browser試験

`npm run test:staging-invitation-signup-local`は実build/Worker/分離D1とloopback HTTPSを
使い、登録・確認・login/dashboard・logout・再利用拒否を一巡する。通常application CIに
含める。上流Resend以外のAPI応答はmockせず、全外向き通信を拒否する。Worker bundleの
esbuild条件はworkerd、native AsyncLocalStorageを要求し、browser用polyfillを拒否する。
fixtureの全設定・ready参照releaseをそろえ、画面APIの5xxを合格扱いにしない。
[契約と範囲](migration/invitation-signup-api.md#actual-local-browser-flow-2026-10-07)。

## Business D1復旧の共通処理

`business-d1-recovery.ts`は同じengineの別profileで、27 migrationの79表と採番状態を
AES-256-GCMで保存/読込し、新しい空targetへ単一batch復旧する。過去の招待消費/通知
wakeを再発生させず、削除済みevent/ledgerの最大IDも保持する。native local D1の5件は
`npm --prefix workers/api run test:business-recovery:d1`で通常Worker CIへ含める。
[契約と限定検証](migration/business-recovery.md)。全ストアcollectorや定期保存の採用は別工程。

## R2復旧の共通処理

`r2-recovery.ts`はkind別の全bucket capture/暗号化と、条件付きPUTによる不足object復旧。
`new-empty`または`resume-exact`を明示し、既存全objectのbytes/hash/全metadataを照合する。
ACK喪失でも保存済みobjectを消去せず、再開時にexact subsetだけを許す。
`npm --prefix workers/api run test:r2-recovery`を通常Worker CIへ含める。local storageClassの
fixture補完はremote受け入れではない。[契約と限定検証](migration/r2-recovery.md)。


### 隔離した共通R2 remote試験

実WorkerのHTTP metadataには既知optional fieldの`undefined`もあるため、captureではその
未設定fieldのみ除外する。`test:r2-recovery`はbundle内の欠落class拒否/claim/cleanup guardと、
classのみtest補完した全proofを加えた8件。remote CLIはexact HEADの両CI成功を要求し、
専用7 bucketとWorkerをjournalで追跡する。実stagingの既存bucketには書き込まない。
API/Worker応答不明時は同じreceiptを照会し、proofを盲目的に再実行しない。
詳細は[R2復旧](migration/r2-recovery.md)。


fcd4812/CI37643375901両job成功後、同じ共通moduleを実Cloudflare専用7 bucket/Workerで
補完なしに検証し、Standard classと8項目、全資源cleanup/inventory一致を受け入れた。
[remote限定証拠](migration/evidence/r2-recovery-shared-remote-2026-10-08.json)。
app Worker17fdbf39と既存bucketは保持。運用collector/全ストア整合点の採用とは分ける。


## 全ストアの共通収集と復旧

`recovery-set.ts`は独立schema/SDK key/source/runtime identity、全partのencrypted manifest、
source/targetのlive guardを要求する。既知source profile→Auth user関係を確認し、全partを
復号して全targetを確認した後にのみwriteする。D1 commit後の不明な応答はexact全hash照合で
skip、R2は不足分だけ再開。全ストアにまたがるrollbackは行わない。
`recovery-set-files.mjs`はrepo外の0700 directory/0600 file、fsync/exclusive linkによる非上書き
保存と全内容検証。通常Worker CIの`test:recovery-set`（native6件）に追加。
運用lease/drainとkey/off-host/retentionは未採用。[契約](migration/recovery-set.md)。

一式collectorの専用Worker形式は通常`test:recovery-set`に含む。private file→native全store、
独立schema pin/claim/version/bindingの契約と新規ownedだけのremote CLIを追加した。
通常アプリの停止方式と定期運用は未採用。[契約](migration/recovery-set.md)。

共通一式collectorは99762af/CI37649724810両job成功後の新規6 D1/5 R2/Workerで、
Macの同じprivate fileから全5 storeのnative復旧と明示失効、全資源cleanupを受け入れた。
通常アプリの停止方式・定期運用採用は残る。[限定証拠](migration/evidence/recovery-set-isolated-remote-2026-10-08.json)。

告知配送通知の受信は `BROADCAST_WEBHOOK_BACKEND=d1` で独立して有効化できる。送信を停止したまま、署名・時刻を検証した既送信メールの通知をD1へ反映する。未指定時は従来の `BROADCAST_SEND_BACKEND` に従い、明示的な無効値は受信・新規配信開始・dispatchを止める。署名secretだけでは受信を有効にしない。snapshotと送信のselectorは別に必要で、受信だけを有効にしても宛先の抽出やメール送信は始まらない。現在はローカル検証段階で、Resendへの登録とstaging配備は未実施。

バックアップ用の新規書き込み停止は `recovery-write-freeze.ts` の `RECOVERY_WRITE_FREEZE` を使う。HTTP全入口・fetch後wake・Cron診断を含むjob・通知DOのD1処理を止め、alarmは再開用時刻だけ保持する。既存cutover停止とは独立し、default-off、不明値は停止側。既に動いている処理のdrainと外部writer停止は別条件で、このflagだけをrecovery collectorのguardにしない。詳細は `docs/migration/backup-operations.md`。

writerの終了確認は `recovery-writer-drain.ts` と `RecoveryWriterCoordinator` の内部DO bindingを使う。明示したselector/scopeだけでHTTP・Cron・通知DOをticket管理し、claim後の新規処理とactive>0のassertを拒否する。ticketにTTLを設けず、HTTPのwake・Cronの全job終了まで記録を保持する。default-offで通常stagingのbindingは未追加。最初から計測したwriterに限るため、旧versionの初回drain・外部writer停止・collector接続・実remote採用は別条件。内部bindingの`inspectRecoveryWriters`は件数/初期化/停止状態だけを読み、ticketや停止状態を変更しない。件数0だけでは停止完了にしない。 `4445297`/CI37687088667両job成功後、通常stagingへコードを反映した。計測/停止selectorは未有効化。契約は `docs/migration/backup-operations.md`。

通常アプリとのlocal接続は `scripts/migration/test-application-writer-recovery.mjs` が実entrypoint、別SQLite DO、合成Auth/Business、共通collectorとprivate fileを使って検証する。保存済み非ユーザーMasterの全量caseは `node --experimental-strip-types scripts/migration/application-writer-full-master-local.mjs <private-master-directory> <new-private-report>`。既存public証拠のarchive/schema/rows pinを使い、0600のarchive/keyを検査して共通decryptへ渡す。通常CIは小fixture、全Master12,254行はprivate archiveを持つlocal検証に限定する。statement計測はnative D1実行とbatch memberを数え、将来のremote wrapperや外部leaseのoverheadを含まない。最大容量・remote採用・運用RTOとは別の証拠。

新しい隔離Worker transportは `application-recovery-set-worker.mjs`。source/targetの別SQLite writer DO、実アプリSDK、native Master initialize/一式collect/restoreを使う。通常CIの`test:recovery-set`に小fixtureのnative transport試験を含め、private全Masterは `application-recovery-set-full-master-local.mjs <private-master-directory> <new-private-report>` で検証する。D1 ProxyはSDKが判定するnative `prepare/batch/exec`形状とprototypeを保持し、実SQLの実行数を数える。未計測exec/withSessionは使わず拒否。8MiBの入力をclaim前に検査する。旧cookieは一式鍵と異なるAADで暗号化する。実アプリへ渡すR2名は`AVATARS_BUCKET`/`COVER_IMAGES_BUCKET`で、`STORAGE_BACKEND=r2`を明示し、空bucketの未存在objectを実Storage APIから404と照合する。未認証/別nonceは小さい不正JSONでpayload解析前の拒否を確認し、8MiB+1の超過試験を別に維持する。remote driverはexact成功CI・独立version/binding/namespace・terminal status・所有cleanupを要求する。通常mainのoperator API、provider credentialや運用leaseには使わない。 Cloudflare資源APIのGET401だけは、古いbearer環境を外して同じstaging OAuth profileのemail/account/typeを再検証し、読み取りを1回だけやり直す。POST/DELETE・通信断・unknown ACKは再実行せず、pending資源の実identityを照合してから所有cleanupする。

### localブラウザ検証のHTTP(S)通信

招待登録と実local Workerのプロフィール編集は`local-browser-egress-proxy.mjs`を使う。
設定済みloopback HTTPS serverだけにCONNECTを許可し、外部hostを解決しない。Chromeの
固定proxy・`<-loopback>`・QUIC無効を指定する。許可通信はFetch interceptionで止めず、
Network IDのないカタログ通信をcancel照合できると仮定しない。プロフィールの意図的な
失敗PATCH/cancel fixtureだけに狭いCDP patternを使い、実API応答を置き換えない。

## 実アプリ・全Masterのnative remote受け入れ（2026-10-08 JST）

`ad8f754`/CI37678533990の両job成功後、新規owned Cloudflare資源で通常SDK・別DO fence・
全Master12,254行・5ストアcollector・同じMac保存fileの復旧を受け入れた。旧session拒否、
新login、catalog3,944件/参照4・4・5・16件、hash/FK0と全資源cleanup/inventory一致を確認。
[限定証拠](migration/evidence/application-recovery-transport-full-master-remote-2026-10-08.json)。
R2 data storeは空。通常mainへコードも反映したが停止/計測binding/selectorは未有効化。
[配備証拠](migration/evidence/staging-native-recovery-runtime-rollout-2026-10-08.json)。
隔離runtime接続の残件は解消。main初回の旧writer終了、外部writer lease、容量と運用条件の
採用は残る。過去節の未接続/未配備は当時の記録として読み、この最新観測を優先する。
Cloudflare stagingの新scopeは全5 storeを別resourceとし、通知/終了追跡DOもV2の
別namespaceを使う。DOは現在のbindingから生成した固定object IDとの一致を必須にする。
データ領域を再初期化する際も、旧censusだけのreset/TTL削除は禁止する。
非ユーザーマスターのseed完了・一時writer終了・全bindingの独立照合を行い、
最初の新アプリ処理から計測する。受け入れは[backup operations](migration/backup-operations.md)。

# fanmark.id TECH.md

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

## 絵文字マスタ更新（Unicode emoji-test.txt）
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

ダッシュボード所有一覧は`workers/api/src/owned-fanmarks-d1-repository.ts`の`GET /api/me/fanmarks`からD1を読む選択肢を持つ。WorkerはBetter Auth sessionから得たuser IDだけを所有者条件に使用し、クエリ入力のuser IDを受け取らない。応答にはダッシュボード表示に必要なファンマーク・ライセンス・基本設定のみ含め、emailやuser IDは返さない。クライアントは認証APIとWorkerのoriginが一致することを確認し、最大応答サイズも制限する。`VITE_OWNED_FANMARKS_BACKEND=worker`と`OWNED_FANMARKS_BACKEND=d1`を明示した場合だけ利用し、エラー時は別DBへフォールバックしない。staging-mode buildはselectorを`supabase`に固定して検証したが、deploymentしていない。合成Better Authユーザーと合成business D1を使う検証は`npm run --prefix workers/api test:owned-fanmarks-api`。

プロフィールは`workers/api/src/profile-d1-repository.ts`の`GET/PATCH /api/me/profile`から本人の`user_settings`を読む。Better Auth session由来のuser ID以外を更新対象にせず、表示名・同一ユーザー所有のR2 avatar URL・優先言語に限定する。plan、Stripe customer、invitation、password setup属性はレスポンスにも含めず、書込みも拒否する。Cloudflare staging buildで`VITE_PROFILE_BACKEND=worker`を選択し、合成ユーザーのread/updateを確認済み。Worker/API障害時にSupabaseへ戻らない。username availabilityなど残るprofile操作はSupabaseのまま。実profile rowは未移行、production selectorもSupabaseのまま。synthetic Better Auth/D1/R2 integration testは`npm run --prefix workers/api test:profile-d1`、client契約試験は`npm run test:profile-api`。

ファンマーク設定は`workers/api/src/fanmark-settings-d1-api.ts`の`GET/PATCH /api/me/fanmarks/:fanmarkId/settings`で移行した。Better Auth本人sessionから最新所有ライセンスを解決し、activeかつ期限内の場合だけD1の複数設定行を`batch()`で保存する。4桁パスワードはbcryptjs 3でWorker内hash化し、値/hashをAPIレスポンスやruntime evidence表へ出さない。保護付き公開アクセスの証跡は、現在のlicense incarnation・password generation・enabled状態・codecに結び付くhash-free `fanmark_password_runtime_evidence`で管理する。変化が起きると既存証跡は世代照合に失敗する。stagingでは`VITE_FANMARK_SETTINGS_BACKEND=worker`と`FANMARK_SETTINGS_BACKEND=d1`を選択し、合成read/writeと保護アクセスを確認済み。local synthetic D1試験は`npm run --prefix workers/api test:fanmark-settings-d1`、client契約試験は`npm run test:fanmark-settings-api`。実ユーザー行とproduction経路は未移行。

通知受信箱は`workers/api/src/notifications-d1-api.ts`の`GET /api/me/notifications?limit=1..50`、`GET /unread-count`、`PATCH /{id}/read`、`POST /read-all`からbusiness D1を操作する。所有者はBetter Auth sessionからのみ決定し、未読数と全件既読は配信済み・未期限切れを条件とする。個別既読は本人の未読行ならstatus/expiryに関係なく更新し、既存RPCの範囲を保つ。ページ応答を256 KiB、各payloadを16 KiBに制限する。workers.dev stagingでは`VITE_NOTIFICATIONS_BACKEND=worker`と`NOTIFICATIONS_BACKEND=d1`を選び、synthetic inbox read/mark-readを確認済み。Worker/API障害時にSupabaseへフォールバックしない。Worker側は30秒poll、productionのSupabase側は既存Realtimeを維持する。実ユーザーの通知行は未移行。合成Better Auth/D1統合試験は`npm run --prefix workers/api test:notifications-d1`、client契約試験は`npm run test:notifications-api`。管理画面のルール/テンプレート編集も`NOTIFICATION_MASTER_BACKEND=d1`と`VITE_NOTIFICATION_MASTER_BACKEND=worker`でstaging選択済み。通知イベント処理は`workers/api/src/notifications-scheduled.ts`にD1版を実装し、deployed Worker selectorと毎分Cronをworkers.dev stagingで有効にした。processor単体の合成canaryに加えて、Worker返却APIが作る所有者/お気に入りイベント2件の日本語in-app配信と完全cleanupをstagingで実証済み。残るイベント発生元、メール/Web Push配信、archiveと本番定常運用・CPU適合性は未確認。詳細は[通知API移行準備](migration/notifications-api.md)。

期限切れのactive→grace処理は`workers/api/src/license-expiry-scheduled.mjs`からWorkerの`scheduled` eventへ接続できる。`LICENSE_EXPIRY_BACKEND=d1`、split D1、明示したtarget incarnation/schema extension digestが必要で、1回4ページ（各64件）を既定上限にする。未完了runは元の時刻・grace期間で再開する。app stagingには通知処理用の毎分Cronとexpiry用の日次Cronが設定されている。通知processorはD1で有効だが、`LICENSE_EXPIRY_BACKEND`は未設定なのでexpiry Cronはdisabledを返す。Stripe dispatchもselector/secretsが未設定でdisabledのまま。expiryを有効化する前に業務D1 schema・CPU/プラン・synthetic remote canaryを確認する。合成D1での再開・効果検査は[期限切れ処理のローカル検証](migration/license-expiry-proof.md)。

ユーザーを含まない`fanmark_tiers` / `languages` / `reserved_emoji_patterns` / `fanmark_tier_extension_prices`は、`workers/api/src/reference-master-d1-repository.ts`の公開GETルートからactive ready D1 releaseを版固定で読む。API allowlist、release table manifest、row count、DTO、exact integer centsを検証し`no-store`で返す。`useLanguages`は`VITE_LANGUAGE_READ_BACKEND=worker`、`AdminExtensionCoupons`のティア表示は`VITE_REFERENCE_MASTER_READ_BACKEND=worker`、延長料金表示は`VITE_EXTENSION_PRICING_BACKEND=worker`で選べる。Worker取得に失敗した場合はSupabaseへ戻らない。延長料金のMFA保護された版付き管理API、Edge Functionの署名付きD1価格参照も用意し、private routeはstaging Workerへ配備済み。公開料金APIにはStripe IDを返さず、`/api/internal/reference-masters/extension-price`は60秒以内のHMAC署名、origin拒否、`no-store`を検証する。Cloudflare staging buildでは`VITE_EXTENSION_PRICING_BACKEND=worker`が公開価格をD1から読み、`VITE_REFERENCE_MASTER_ADMIN_BACKEND=d1`がMFA保護された版付き価格編集を同じreleaseへ書き、`VITE_STRIPE_EXTENSION_CHECKOUT_BACKEND=worker`が購入要求をWorkerへ送る。Worker configは`REFERENCE_MASTER_ADMIN_BACKEND=d1`を選択する。Stripe checkout server selector、webhook/dispatch selectors、Stripe secretsは未設定のためWorker決済routeは404で閉じ、UIはSupabase Edge Functionへフォールバックしない。通常build/productionはSupabaseのまま。署名付きreference-price serviceは配備済み。クーポン適用は`/api/me/licenses/extend-with-coupon`、管理用CRUD/履歴はMFA保護された`/api/admin/extension-coupons`を使い、Cloudflare staging build/WorkerでD1を選ぶ。適用はD1の一つのcommand INSERTとtriggerで利用上限、重複、ライセンス条件を再検証して全ての効果を原子的に確定し、同じowner/request IDの再送は保存済み結果を返す。管理APIはクーポン作成、利用上限/期限の設定、active切替、未使用クーポンの削除、使用履歴の最小表示を提供する。使用済みcouponの削除は拒否する。既存coupon・usage・license行はstagingへコピーしていないので、移行データでの成功受入は未実施。production/default buildはSupabaseのまま。予約パターンAPIはまだ画面から消費していない。参照マスター取込とread APIの条件は[参照マスター移行](migration/reference-master-data.md)を参照。

Cloudflare staging modeの管理画面はBetter Authでログインし、`GET /api/admin/session`を通じてWorkerが管理者roleとsession/factorに結び付いた期限内MFA assuranceを再確認する。未設定ならWorkerが`mfa_enrollment_required`を返し、画面からTOTPを登録する。登録済みのMFAが未確認なら`mfa_required`となり、TOTP challengeを要求する。Supabase modeの管理認証は変わらず、stagingのWorker経路にSupabase fallbackはない。絵文字マスター管理は`/api/admin/emoji-master`経由でMaster D1のcanonical draftを更新する。公開済みUUID・絵文字・コードポイントはDB triggerで保護し、画面から削除できない。draft更新は公開版を変えず、release成果物の検証と別操作のactivationが必要。残る他のadmin CRUDと業務データ認可は未接続。

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
- テスト/本番で別々の Product/Price・Webhook エンドポイントを作成。Webhook URL: `https://<project>.supabase.co/functions/v1/handle-stripe-webhook`、イベントは checkout.session.completed / customer.subscription.* / invoice.payment_* を登録。
- Cloudflare Worker側には`/api/stripe/webhook`の署名検証・D1 receipt/dispatch保存経路、拡張Checkout作成API、Free-to-paid plan Checkout API、D1 scheduled dispatcherと拡張決済効果を追加した。staging business D1にはmigrations `0006`〜`0012`を適用済み。`0009`でStripe subscription IDの全ユーザー横断unique index、`0010`で作成/更新照合台帳、`0011`で削除時のFree-plan return batch/item台帳、`0012`でCustomer/plan Checkout command台帳を追加した。`STRIPE_WEBHOOK_BACKEND=d1`、`STRIPE_DISPATCH_BACKEND=d1`、`STRIPE_EXTENSION_CHECKOUT_BACKEND=d1`、`STRIPE_PLAN_CHECKOUT_BACKEND=d1`、Stripe署名secretとStripe selectorsは未設定。Cloudflare stagingのextension-checkout UI selectorはWorkerを選ぶが、server側extension Checkout・webhook・dispatchは未設定のままで、決済routeは404。通知/expiry Cron triggerはstagingに設定され、通知処理は選択済み、expiry backend selectorは未設定なので停止中。scheduled invoice照合は`STRIPE_SECRET_KEY_TEST`と`STRIPE_SECRET_KEY_LIVE`をモード別に要求する（拡張Checkout作成APIが使う`STRIPE_SECRET_KEY`とは別）。Workerのローカル実装はcreated/updated/deleted subscriptionを現在のStripe状態・customer fence・private test/live Price IDで照合し、activeのみプランを反映する。最後の契約削除では同じD1 batchでFree化、最新の上限超過ライセンス返却、監査、所有者/お気に入り通知を処理し、transfer中またはeffect欠落時は全体をrollbackする。Stripe D1 reconciliationはWorker version `a67b6abe-0080-4784-bcf2-87efed59f83a`で初回配備し、現在はversion `691ce686-17fc-4ff3-a96b-371e3f2f5ee5`がworkers.dev stagingで100% active。Free-to-paid plan Checkoutは同一ownerのcustomer/session idempotency ledgerを備えるが、Stripe selector/secrets未設定のためrouteは404で閉じている。Customer Portalも同様に無効。Stripe Dashboardのendpoint切替・plan change command・sandbox acceptanceは未実施。
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
- 通知: まず `notification_events` にイベントを登録（`create_notification_event` RPC）。Supabaseではpending追加トリガーが通知Cronを起動し、`process-notification-events` がルール・設定・テンプレートを適用する。Cloudflare版のD1 scheduled processorは `workers/api/src/notifications-scheduled.ts` にあり、`NOTIFICATION_PROCESSOR_BACKEND=d1` と毎分Cronをworkers.dev stagingで有効にしている。Worker返却APIがD1へ追加した2種類の合成イベントを実Cronが処理し、日本語in-app通知として配信した。ローカルD1でも即時in-app、遅延、テンプレート、再ポーリングを検証済み。管理画面向け通知ルール/テンプレートの限定編集APIは`NOTIFICATION_MASTER_BACKEND=d1`と`VITE_NOTIFICATION_MASTER_BACKEND=worker`を選ぶstagingでsame-session MFA canaryまで確認済み。手動イベント作成とイベント/通知ログはSupabaseに残す。未移行のイベント発生元、メール/Web Push配信と本番相当の運用は未確認。本人通知受信箱はWorker APIで処理できる。
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

Service Workerはビルド済み静的ファイルだけをprecacheする。SupabaseおよびWorker APIの応答はruntime cacheへ保存せず、`/api` 配下のnavigationへSPA HTMLを返さない。新しいService Workerのactivateで旧`supabase-cache`を削除し、過去のAPI応答が残らないようにする。静的precacheや他の名前のcacheは削除しない。既存端末への反映は配備後にService Workerが更新・activateした時点であり、ローカルビルドだけでは既存cacheの削除を確認したことにならない。

取得可能判定のWorker接続は `VITE_FANMARK_API_BASE_URL`、Worker側のD1選択は独立した `AVAILABILITY_BACKEND=d1` と `FANMARK_DB` を使う。未設定は既存Supabase RPC。フロント検証は `npm run test:availability`、Worker検証は `workers/api` の `npm test` と `npm run test:availability:d1`。

匿名の公開ファンマreadは `VITE_PUBLIC_ACCESS_READ_BACKEND=worker` を明示したビルドで、同じAPI base URLの短縮ID・絵文字・公開プロフィールWorker APIを使う。未設定時はSupabase RPC、Worker選択後のエラーではSupabaseへフォールバックしない。Worker側は `PUBLIC_ACCESS_BACKEND=d1` とbusiness `FANMARK_DB`、絵文字正規化用のmaster `MASTER_DB` が必要。2026-09-25時点でCloudflare staging build/Workerにこのselectorを設定し、分離D1の合成レコードで3経路を確認済み。合成レコードは削除し、業務D1の対象表は0件に戻した。password-protected recordに当たるとWorkerは内容をredactし、検証・表示はfail closedする。Supabaseのpassword検証は既定Supabase pathだけで使う。`/f/:shortId` whois詳細もstagingでは`VITE_FANMARK_DETAILS_BACKEND=worker`を明示し、匿名には公開概要のみ、認証済みにはBetter Auth本人sessionに対応した履歴・お気に入り・抽選状態を返す。通常buildはSupabase RPCを維持し、Worker応答失敗時のfallbackはしない。契約と限界は `docs/migration/public-access-contract.md` と `docs/migration/fanmark-details-api.md`。

Better Authは `workers/api/src/better-auth.mjs` に共通化し、通常Workerの `/api/auth/*` から利用する。`AUTH_BACKEND=better-auth`、Auth D1、32文字以上の `BETTER_AUTH_SECRET`、HTTPSの `BETTER_AUTH_URL` がそろわないと503で停止し、Supabase Authへはフォールバックしない。CORSは明示したHTTPS originだけをCookie付きで許可する。招待signup Coordinatorは実装済みで、両D1 migrationとWorkerはstagingへ配備済み。招待mode、Resend設定、`INVITATION_SIGNUP_BACKEND=d1` がそろうまで無効。合成D1検証は `npm --prefix workers/api run test:auth:d1` と `test:invitation-signup-d1`、既存TOTP/admin-assurance検証は `npm --prefix experiments/cloudflare-auth test`。

2026-09-25の`fanmark-app-staging`ではBetter Authのlogin/sessionを合成アカウントで確認し、Auth D1を分離した。Cloudflare Secret Storeにはstaging専用secretを登録し、リポジトリやビルド成果物には含めない。2026-09-26にsignup Coordinatorを実装・合成検証し、両migrationとWorkerをstagingへ配備した。Resend/selectorは未設定のため、実際のsignup・メール送信は閉じたまま。OAuthも資格情報がないため無効。実ユーザーのAuth/業務データ移行やproduction認証切替を意味しない。

管理画面の招待コードCRUDには、`INVITATION_ADMIN_BACKEND=d1`と`VITE_INVITATION_ADMIN_BACKEND=worker`で選ぶMFA保護API/clientを追加した。招待コードは未移行のため両selectorはstagingで無効。コード検証・消費とsignupのローカルCoordinatorは `docs/migration/invitation-signup-api.md` を参照し、実データとResend設定が整うまで引き続き閉じている。管理APIの契約は `docs/migration/invitation-admin-api.md`。

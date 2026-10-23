# 開発手順と技術構成

現行本番はCloudflare Workers / Better Auth / split D1 / R2。
構造は[ARCHITECTURE](ARCHITECTURE.md)、通常の本番操作は[運用入口](operations/README.md)を参照する。

## ランタイムと依存関係

- Node **22.6.0**。本番builderは別versionを拒否する。CIも同じversionを使う。
- React 18 / TypeScript / Vite / Tailwind / shadcn/ui / React Query / React Router。
- Workerは`workers/api/`。認証はBetter Auth、Auth・Business・Masterは別D1、画像とbackupはR2。
- 決済はStripe、メールはResend。`package-lock.json`を使い、rootとWorker両方で`npm ci`する。
- WranglerはWorker側lockfileの4.135.0を使う。global CLIや依存の自動更新で置き換えない。
- `.env`は追跡しない。任意設定の例は`.env.example`。local開発と本番builderは独立したenvを生成する。

```sh
npm ci --legacy-peer-deps
npm ci --prefix workers/api
npm run verify:app
npm --prefix workers/api run typecheck
npm run check:ci
npm run check:cloudflare-schedules
npm run check:production-live-config
```

## 画面とAPIを変更する

1. PRODUCTで仕様、ARCHITECTUREで画面とAPIの実装位置を確認する。
2. frontendはWorker APIとBetter Authに統一している。[フロントの入口](development/FRONTEND.md)を参照する。
   API originと送信/リセットの停止設定を確認し、Workerの業務selectorとは区別する。
3. 対象のclient testと、実D1/R2・Authを使う該当契約testで正常処理と権限拒否を確認する。
4. 変更した契約・画面構造に応じて文書を更新し、PRでCIを確認する。

例（秘密・本番データを使わないローカル検証）:

```sh
npm run test:notifications-api
npm --prefix workers/api run test:notifications-d1
npm --prefix workers/api run test:storage-r2-api
npm run test:staging-profile-editor-local
```

最後のeditor testは名前にstagingを含むが、loopback HTTPS・合成Auth・local分割D1/R2を生成する
`scripts/migration/test-owner-profile-editor-local.mjs`。実Workerを使った画面・認証・保存検証の出発点にする。
他の`staging-*`や`migration:*`は遠隔書込みを含むものがあるため、名前だけで安全と判断しない。
全体のWorker testは`npm --prefix workers/api test`。Node・Chrome・OpenSSLとlocal D1/R2を使うCI環境は
[workflow](../.github/workflows/cloudflare-migration-validation.yml)を参照する。

## 開発サーバー・build・preview

Cloudflare向けの通常開発には `npm run dev:local` を使う。
合成一般ユーザー・管理者、公開カタログ、local分割D1/R2を毎回生成する。
セットアップ、MFA、終了時のデータ破棄、検証コマンドは[ローカル開発](development/LOCAL.md)を参照する。

| コマンド | 用途・接続先 |
| --- | --- |
| `npm run dev:local` | loopback HTTPS + Vite + 実Worker + 合成D1/R2。遠隔binding・外部送信なし。 |
| `npm run dev` | `dev:local`と同じ合成local環境。 |
| `npm run build` | Node 22.6.0で`dist-cloudflare-production`を生成。本番originと3つの安全制御を固定し、継承VITE値・local envを隔離する。遠隔配備はしない。 |
| `npm run preview -- --outDir dist-cloudflare-production` | 本番buildの静的preview。API接続先は本番のままで、local DBにはならない。認証操作・保存試験は合成local環境で行う。 |
| `npm run build:cloudflare-staging` | staging originを固定し、継承VITE・envを隔離する。通常本番への配備には使わない。 |

通常開発は上記の隔離testを使い、ブラウザ結合検証は既存editor harnessのlocal構成を出発点にする。
対話用の環境を組む場合も、account/routes/services/Cron・外部providerを外し、全D1/R2をlocalへ置換して
frontendとAPIのorigin・CORS・Auth URLを揃える。production/staging設定は`remote:true`を含むため、
そのまま`wrangler dev`へ渡さない。`--local`だけで遠隔bindingを無害化したと扱わない。

## CI・PWA・本番更新

GitHubの`Cloudflare application validation`はmain向けPR・main push・手動実行で、アプリとWorkerを検証する。
job名にstagingがあっても本番通常設定の検査も含む。CIは秘密・本番配備権限を持たず、自動配備しない。
旧`supabase-deploy.yml`は削除した。旧移送・source操作のnpm入口は通常scriptsから外し、
[過去コマンド参照](history/package-scripts-2026-10-22.json)へ保存した。helperと元証拠は保持する。

`verify:app`は型・Lint・全client・現行運用契約・Cron・本番構成をまとめて検証する。
CIはさらに実localブラウザ、Worker全契約、Business/Auth/Master/R2統合復旧、本番build/dry-runを実行する。
移送時点のソースfingerprintやsource freeze試行は通常CIに含めず、過去証拠を再生成しない。

### Workerテストの実行群

`npm --prefix workers/api test`は検査範囲を照合した後、次の4群を順番に実行する。
CIでは同じ4群を別々のrunnerへ分け、各群内は従来の順次実行・Vitest設定・合成local D1/R2を維持する。

| Worker側コマンド | 検査範囲 |
| --- | --- |
| `npm run test:ci:core` | 基本契約・公開アクセス認証・Webhook受信/適用・Auth/MFA・退会 |
| `npm run test:ci:business` | カタログ・公開参照・本人設定/通知/お気に入り・検索/取得/抽選/移管などのAPI契約 |
| `npm run test:ci:billing-admin` | 課金checkout/変更・coupon・管理者・招待/登録待ち・告知メール |
| `npm run test:ci:recovery` | 絵文字公開・通知wake・writer drain・各storeのbackup/復旧・隔離復旧 |

変更前main `dc850e681f2396bf3c9c19d70c192aa8e0fb3f8f` の `npm test`を展開した
63種類のコマンドを `scripts/worker-test-baseline.json` に保存し、`test:plan`と`check:ci`で
全対象が1回ずつ実行されることを照合する。重複していたwriter drainとimport coordinatorの2実行だけを除く。
テスト追加時は対象群とbaselineを同じPRで更新し、検査の省略を許すための書き換えはしない。

CIは`fail-fast: false`で他群の検証を継続する。既存の必須チェック名
`Validate Cloudflare Worker API`を集約先として保持し、全群成功後に型・実行時import・bundleを検証する。
失敗・キャンセル・skip・結果欠落はいずれも成功にしない。ブラウザ・画像・下書き・統合復旧と
本番build/dry-runを含むアプリ側jobも全変更で実行する。パスによる検査省略は行わない。

比較基準のmain CI [39782249447](https://github.com/kanouk/fanmark-id/actions/runs/39782249447)は
Worker jobが15分1秒（全契約/復旧13分51秒）、アプリjobが5分12秒。
短縮効果は同じNode/lockfileで、queue待ちとjob実行時間を分けてPR/main CIで確認する。
本変更は検査の実行構成のみで、本番Workerの再配備は不要。

PWAはAPIを静的cacheへ入れない。更新時は旧hash資産を保持し、新しいHTML/SW/manifestを使う。
起動表示の小さいCSSは`index.html`へ置き、JS前の公開shellとReactの`AppStartupSkeleton`で共有する。フォント指定はHTMLに1件、既存300〜800の太さを保持し、外部CSSはprint mediaで取得してload後にallへ切り替える。失敗しても代替フォントで描画する。`test:local`はmain moduleを保留した実HTML表示・保護route拒否と、capabilitiesの遅延/失敗/無効/1・4 providerの入力・フォーカス保持を検証する。
公開catalogだけは`fanmark-public-emoji-catalog-v1` IndexedDBの`catalogs`へAPI origin当たり1 snapshotを保存する。毎起動の版確認を省かず、通信できないときの古い版の利用には使わない。保存は単一transactionで置換し、読取り/書込みは750msで打切り、失敗時も通常取得と入力を維持する。cookie・本人情報・個人APIは保存しない。`test:local`は実Master D1のready版変更と実IndexedDBの破損・利用拒否・block・quota・transaction abortも検証する。
画面コード・CSS・基本HTML・アイコンは先読みを維持する。画面内で使わない共有用`og-image.png`だけは先読みから除外し、公開配信とOGメタ情報は保持する。
正規builderは生成SWを検査する。CIはさらに`node scripts/test/pwa-precache-browser.mjs`で新規導入・旧方針からの更新・オフライン静的資産・API非cacheを検証する。
`test:app-startup`、`test:staging-asset-retention`と[更新手順](operations/deployment.md)を参照する。
D1 schema変更はstoreとmigration sequenceを分けてレビューし、適用先・backup・検証・失敗時の前進復旧を
用意してから別の本番操作にする。`supabase db push`を通常更新に使わない。

旧RLS・移行準備・一回限りhelperの説明は[旧TECH](history/TECH-2026-10-21.md)に保存した。
機能ごとのWorker API契約は`docs/migration/`に残るが、当時の「stagingのみ」「未配備」は履歴として読む。


## Jev絵文字パレット（#26）

共有 `EmojiInput` の選択UIだけを必要時importへ置換する。直接入力・clipboard・カタログgate・空き状況・取得・課金は既存の経路。
`getInstalledEmojiCatalog()` は検証/install済みのrelease/versionだけを返す。受信ordinalではなく、マスターの `sortOrder` 順を検索分類と一覧に使う。IDの採番・同一性は変えない。

`POST /api/emoji/palette/search`: 同origin＋専用header、JSON 2048 bytes、検索語2〜160文字、カテゴリ・variants・catalogVersion・dictionaryVersion・schemaVersion=1・normalizationVersion=1を検証する。各検索で現在ready版を照合し、版違いは409で候補を返さない。
モデルは評価した `jev-1.13.0` に固定。6観点それぞれの分類→項目選択、最大255択（通常251）、最大8外部HTTP・12秒・自動再送なし。クライアントは350ms debounce・15秒取消で、IME中/空欄は送信しない。

Workerの `TYPESAFE_API_KEY` は新しいsecret。通常local/CIには実鍵を渡さず外部送信を止める。未設定・停止・429・不正応答・catalog版違いでも名称検索と一覧を維持する。鍵をVite変数へ入れない。
既存 `FANMARK_SEARCH_LIMITER` の別prefixを使い、既存Business `system_settings` の非公開key `internal.emoji_palette.budget.<UTC日付>` の日付別counterを原子的に増やす。全体でUTC日次100検索まで、失敗/取消も消費する。成功分のinput/output tokens/callsを集計するが、失敗時のprovider消費を完全に集計したとはしない。
API単価$0.042/100万入力tokens・出力無料（2026-10-23 [公式モデル表](https://docs.typesafe.ai/models)）。現在の上限8×65,536 context×100検索から計算した保守的なAPI費用上限目安は約$2.21/UTC日。Cloudflare費用と価格改定は含めない。実測と運用を確認して上限を変更する。

候補cacheはisolate内最大128件・利用期限10分。検索語を含むkeyはSHA-256にし、DBや共有CDNには保存しない。同一検索を同時処理する時は1推論へまとめる。provider側の保存条件はTypeSafeの規約に従う。
4言語CLDRは固定commitのUnicode文字列へ紐付け、IDを持たない。新Masterに名称がなければそのreleaseの英語名/keywordを使う。辞書JSONのSHA-256とdictionaryVersionを検証し、開く前には取得もPWA先読みもしない。PWAの既存画面code/cache/API非cache方針を保持する。旧hash辞書も `retain-staging-hashed-assets.mjs` で保持する。

検証: `npm test` に名称検索・順序・ID・辞書hashの契約、既存 `test:emoji-catalog:d1` に実D1のAPI/日次競合/版変更/失敗テスト、`test:local` に共有パレットと通常Worker/Auth/D1/R2の回帰を含める。実モデルの検索品質は合成providerテストとは別に、固定例と保留例で評価する。


## 起動時の設定確認とwriter追跡

`GET /api/system/maintenance` と `GET /api/auth/capabilities` はSELECT/PRAGMAだけの固定経路として、静的資産・公開Masterと同じ`withRecoveryRead`を使う。scope・保存状態の不整合やfence時の拒否は保持し、cacheや設定の推測で確認を省かない。session・OAuth callbackを含む他のAuth GETと非GETは`withRecoveryWriter`を使う。

SQLiteのwriter coordinatorは既存KVの同じkey/valueを同期KVと`transactionSync`で読み書きする。1要求ごとの`blockConcurrencyWhile`と非同期transactionの重複を除き、永続化待ちの間も後続要求の状態判定を実行できる。通常のoutput gateは有効なままで、永続化前にenterの成功を返さない。ticketの自動期限切れ・他処理の票削除・保存先の変更は行わない。native Worker testで旧非同期KVとの互換、同時32 writer/32 inspect、fence、ACK喪失と隔離復旧を検証する。

[Cloudflareの同期KV/transaction仕様](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)を参照。起動障害の観測・公開検証は[運用状態](operations/current-state.md)へ記録する。

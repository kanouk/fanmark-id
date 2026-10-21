# 開発手順と技術構成

現行本番はCloudflare Workers / Better Auth / split D1 / R2。
構造は[ARCHITECTURE](ARCHITECTURE.md)、通常の本番操作は[運用入口](operations/README.md)を参照する。

## ランタイムと依存関係

- Node **22.6.0**。本番builderは別versionを拒否する。CIも同じversionを使う。
- React 18 / TypeScript / Vite / Tailwind / shadcn/ui / React Query / React Router。
- Workerは`workers/api/`。認証はBetter Auth、Auth・Business・Masterは別D1、画像とbackupはR2。
- 決済はStripe、メールはResend。`package-lock.json`を使い、rootとWorker両方で`npm ci`する。
- WranglerはWorker側lockfileの4.135.0を使う。global CLIや依存の自動更新で置き換えない。
- 既存の追跡済み`.env`は旧frontend公開設定。秘密値を追記しない。`.gitignore`のenv除外は追跡済みfileには効かない。

```sh
npm ci
npm ci --prefix workers/api
npm run typecheck
npm --prefix workers/api run typecheck
npm run check:ci
npm run check:cloudflare-schedules
npm run check:production-live-config
```

## 画面とAPIを変更する

1. PRODUCTで仕様、ARCHITECTUREで画面とAPIの実装位置を確認する。
2. Cloudflareの選択はfrontendの`VITE_*_BACKEND`とWorkerのselectorの両方を見る。
   本番は`build-cloudflare-production.mjs`が全selectorを固定する。旧Supabaseへfallbackしない。
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
全体のWorker testは`npm --prefix workers/api test`。必要なDocker/PostgreSQL/SQLiteを含むCI環境は
[workflow](../.github/workflows/cloudflare-migration-validation.yml)を参照する。

## 開発サーバー・build・preview

| コマンド | 用途・接続先 |
| --- | --- |
| `npm run dev` | Viteの8080番。これだけでは全機能をCloudflareへ切り替える設定にならず、旧既定値を使う箇所がある。通常本番の再現には使わない。 |
| `npm run build` | Node 22.6.0で`dist-cloudflare-production`を生成。本番originとCloudflare selectorを固定し、継承VITE値・local env・旧Supabase通信を無効にする。遠隔配備はしない。 |
| `npm run preview -- --outDir dist-cloudflare-production` | 本番buildの静的preview。API接続先は本番のままで、local DBにはならない。認証操作・保存試験は合成local環境で行う。 |
| `npm run build:cloudflare-staging` | staging selectorのbuild。接続先envと権限を確認した検証用。通常本番への配備には使わない。 |
| `npm run build:legacy` | `dist`を作る旧Supabase実装の検証専用。 |

通常開発は上記の隔離testを使い、ブラウザ結合検証は既存editor harnessのlocal構成を出発点にする。
対話用の環境を組む場合も、account/routes/services/Cron・外部providerを外し、全D1/R2をlocalへ置換して
frontendとAPIのorigin・CORS・Auth URLを揃える。production/staging設定は`remote:true`を含むため、
そのまま`wrangler dev`へ渡さない。`--local`だけで遠隔bindingを無害化したと扱わない。

## CI・PWA・本番更新

GitHubの`Cloudflare migration validation`はmain向けPR・main push・手動実行で、アプリとWorkerを検証する。
job名にstagingがあっても本番通常設定の検査も含む。CIは秘密・本番配備権限を持たず、自動配備しない。
旧`supabase-deploy.yml`は無効化し、remote link/DB push/deploy jobを取り除いた履歴として保持する。

PWAはAPIを静的cacheへ入れない。更新時は旧hash資産を保持し、新しいHTML/SW/manifestを使う。
`test:app-startup`、`test:staging-asset-retention`と[更新手順](operations/deployment.md)を参照する。
D1 schema変更はstoreとmigration sequenceを分けてレビューし、適用先・backup・検証・失敗時の前進復旧を
用意してから別の本番操作にする。`supabase db push`を通常更新に使わない。

旧RLS・移行準備・一回限りhelperの説明は[旧TECH](history/TECH-2026-10-21.md)に保存した。
機能ごとのWorker API契約は`docs/migration/`に残るが、当時の「stagingのみ」「未配備」は履歴として読む。

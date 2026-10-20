# Cloudflare本番の通常運用

2026-10-20にV3の実データを移送し、Worker Route方式で公開した。
公開後の最終検証状態は[再開票](RESUME-2026-10-20-V3.md)を優先する。
旧Supabaseは停止した原本であり、二重書込み・旧側の自動再開はしない。
旧Supabaseのプロジェクト単位GitHub接続は解除済み。本番・preview自動配備を停止し、
元projectとmain branchは保持した。アカウント全体のOAuth grantは変更していない。

## 通常設定と開始前設定

| Worker | 通常設定 | 実行周期・公開経路 |
| --- | --- | --- |
| app | `workers/api/wrangler.app-production.jsonc` | apex Route、毎分とUTC 00:00 |
| backup | `workers/api/wrangler.backup-production.jsonc` | UTC 00:05 / JST 09:05 |
| monitor | `workers/api/wrangler.backup-monitor-production.jsonc` | 毎時35分 |
| alias | `workers/api/wrangler.alias-production.jsonc` | www/adminの限定転送 |

`*-production-closed.jsonc` と `production-backup-pins.json` は開始前の閉鎖状態を保存する。
通常配備へ流用すると、公開、通知、Cron、移送後のbackup schema pinを戻してしまう。
通常設定は実稼働100% versionのbindings、schedules、routesを読み戻して作成した。
Cloudflareの一般 `/settings` は未配備候補を示す場合があるため、配備版の確認に使わない。

Businessの移送後schema pinは `d5139f4ec4ffea556af9c20544178898114e4bdb7a582175021c05c69ba58d16`。
移送journalの3表を含む全118表がbackup/復旧対象となる。旧baselineへ合わせるために台帳を削除しない。
鍵・17秘密設定・V3のD1/R2/DO namespaceは既存のものを維持する。
通知先は本人が実受信を確認した `fanmark.id@gmail.com`。

## 更新時の検証

固定Node 22.6.0を使う。`npm run build` / `build:cloudflare-production` は同じ本番modeで
`dist-cloudflare-production` を生成する。継承したVITE値やlocal envを読み込まず、旧Supabase通信を無効化する。
旧実装の検証だけが必要な場合は `npm run build:legacy` を明示する。

配備中のbuildをprivateな別directoryへ保存してから新buildを作り、
`node scripts/migration/retain-staging-hashed-assets.mjs <previous-build> dist-cloudflare-production`
で旧clientが参照するhash付きassetsを保持する。このhelperは本番directoryにも使える。
HTML/SW/manifestは新buildを使う。同名異内容のassetを上書きしない。

`npm run check:ci`、`npm run check:production-live-config`、
`npm run build:cloudflare-production-live:dry-run` は遠隔配備を行わない。
live configの検査はV3保存先・調停class・4 Cron・3 Route・通知先・通常selectorと移送後schema pinの差戻しを拒否する。
CIは検証だけで、本番の自動配備やSupabaseのDB pushを実行しない。

本番更新は成功CIと資産manifestを固定し、候補uploadと実稼働versionを区別して照合する。
候補の全bindings/秘密設定名・保存先・code/assetsを確認してから100%へ有効化し、別GETで確認する。
応答不明時はupload・deployment・秘密値PUTを再送せず、実稼働versionと操作journalを先に調べる。
DB変更・画像移送・鍵やWebhookの作成は通常更新に含めない。

## DNS・保護境界

apex/www/adminは既存Aの接続先を `192.0.2.1` へ変更し、proxyとrecord ID等を保持している。
旧Lovable SaaS originの `185.158.133.1` へ戻すとWorker Routeに届かない場合がある。
ほか14レコードとNS/MX/TXT/旧Authを維持する。Lovable project・旧DB・過去の契約履歴を削除しない。
www/adminはAPI・callback・認証情報付きqueryを転送しない。

公開後はroot/Auth/maintenance、未認証での個人・管理API拒否、全109画像のbytes、
既存ログイン/MFA/所有権、実在する保護ページの伏せ字・proof拒否、4言語/PWA更新を照合する。
今回のモバイル390×844確認では18pxの横はみ出しと右端の無効ボタンの一部欠けを記録した。
画面の表示確認をレイアウトの完全な修正済みとは扱わない。

## Backupと通知

手動の実データbackup、118表・109画像の隔離復旧、UTC20の日次slot保存は独立照合済み。
日次slotの明示保存は自然Cronの発火確認と区別する。次の自然dailyは2026-10-21 09:05 JST。
すでに使用したslot・manual UUID・復旧POST・通知試験を再実行しない。
自然Cronや通知が失敗した場合はreceipt/claim/archive/署名ledgerを先に読み、結果不明の要求を再送しない。

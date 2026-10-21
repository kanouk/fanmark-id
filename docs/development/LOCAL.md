# ローカル開発

本番と同じWorker・Better Auth・分割D1/R2を、loopback内の合成環境で動かす。
Cloudflareアカウントへのログイン、本番のenv、実ユーザーのデータは不要。
Node 22.6.0、npm、OpenSSLを使う。ブラウザ回帰テストにはChrome/Chromiumも必要。

## 起動

```sh
npm ci --legacy-peer-deps
npm ci --prefix workers/api
npm run dev:local
# ポートを変える場合:
npm run dev:local -- --port 8081
```

表示された `https://127.0.0.1:8080` を開き、このlocal専用の自己署名証明書をブラウザで許可する。
Viteが画面の更新を反映し、Workerはソースの変更で再buildする。
1つのHTTPS originでAPIと画面を動かすため、通常のcookie認証とCORSを確認できる。
公開カタログ3,944件とTier/言語マスターを、Git内の公開情報から作成する。

| 合成ユーザー | 用途 |
| --- | --- |
| owner@example.invalid | 一般ユーザー、所有済みファンマとプロフィール |
| other@example.invalid | 別所有者による拒否の確認 |
| admin@example.invalid | 管理者。最初の管理画面ログインでlocal用MFAを登録する |

パスワードは全員 `Local-development-only!2026`。本番の認証情報ではない。
各ユーザーに無期限の合成ファンマが1件ある。一般ユーザーは残り2件を取得できる。
検索・取得・設定・プロフィール・公開ページ・通知・お気に入りを確認する。
メール送信、OAuth、Stripe、遠隔backupは無効。外部通信はWorkerの出口で拒否する。
課金やメールの成功を偽装しない。成功/失敗のprovider契約は対応するWorkerテストで検証する。

Ctrl-Cで終了する。終了時はserver・watcher・local runtime・一時TLS/DBを削除する。
起動ごとに新しいDBと合成ユーザーを生成する。Workerの再build中は同じlocalデータを使う。
本番/stagingのwrangler設定を、そのままlocalへ渡してはいけない。

## 検証

```sh
npm test
npm run test:local-config
npm run test:local
npm run typecheck
npm --prefix workers/api run typecheck
npm --prefix workers/api test
npm run build
npm run check:production-live-config
```

`test:local`は実Worker/合成D1に対して、ログイン・保存結果・他人への拒否・管理者MFAを検証し、
実ブラウザで検索→取得→設定、プロフィール保存→公開参照と390pxの編集画面を確認する。
未ログインのトップは4言語・320/375/390/430px、5絵文字・直接入力dialog・pickerの横幅も確認する。
Chromeを自動検出できない場合は `FANMARK_STAGING_CHROME=/absolute/path/to/chrome` を設定する。
画像とreportの保存先は出力へ表示する。`FANMARK_TEST_ARTIFACT_DIR`で指定もできる。
合成環境のテスト成功は、本番配備と本人による実アカウント確認の代わりにはならない。

## 実装の入口

- `scripts/dev/local-config.mjs`: local専用の許可済みbindings。配備設定・秘密設定を継承しない。
- `scripts/dev/local-seed.mjs`: 現行schemaの適用と公開マスター/合成データ作成。
- `scripts/dev/local-stack.mjs`: HTTPS、Vite、Worker再buildと終了処理。
- `scripts/test/local-development.mjs`: API・MFA・保存・拒否とブラウザ結合テスト。
- `scripts/test/local-browser.mjs`: desktop/mobileの実画面検証。外部接続をproxyで拒否する。

スキーマ変更時は対象storeの適用順とseedを更新し、`test:local`を新規起動から通す。
移送済みの実データや一回限りの移送helperでlocalデータを作らない。

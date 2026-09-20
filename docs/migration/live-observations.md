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

本番RLS/制約/関数本体/triggerの意味と移行先への対応、cron、整合したsnapshotでの件数照合・Storage容量、AuthのID対応・ハッシュ互換・MFA、Storageキー/所有者/ハッシュ、Stripe顧客と契約対応、OAuth管理画面、DNS/TLS、Resend設定、停止時間・復旧時間目標。本番のexport/importやデータ更新は未実行。Cloudflare環境の準備と認証検証も未完了。

## 証拠の扱い

型出力SHA-256: `da9ea976d60f79795bf959a960696fe27951855e5e3a8b4214f535f1b28fc6e2`。Functions一覧は名前・状態・バージョン等のメタデータのみ参照。データ行・認証秘密情報をこの文書へ保存しない。CLIのtemporary出力は成果物の正とせず、再確認時は同じread-onlyコマンドを実行する。

生成型のRPC名に含まれないカタログ上の関数名: `activate_notification_worker_on_pending_event`, `handle_new_user`, `link_fanmark_discovery_trigger`, `log_emoji_master_changes`, `log_lottery_entry_changes`, `log_profile_cache_access`, `log_waitlist_access`, `notify_security_breach`, `prevent_user_settings_insert_escalation`, `prevent_user_settings_privilege_escalation`, `sync_public_profile_cache`, `update_updated_at_column`, `validate_display_name`。名前差分であり、廃止可能という判定ではない。

read-only SQL接続では `audit_logs` のSELECT権限不足だった。別途、既存の管理権限で取得したAPI資格情報をプロセス内だけで使用し、REST HEAD + count=exactで全40テーブルの件数を取得した。レスポンス本文のデータ行は取得せず、資格情報も保存していない。件数は別々のリクエスト時点の観測であり、整合したsnapshotや最終移行照合ではない。個別件数は公開リポジトリに載せない。table-statsの値は引き続き推定値として区別する。

Cloudflare CLIの既存OAuthログインを確認し、D1一覧をread-only取得した。観測時にfanmark専用D1は見つからない。新しいremote D1/Workerは作成していない。

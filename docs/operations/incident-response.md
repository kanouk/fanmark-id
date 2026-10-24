# 障害対応

最初に[状態](current-state.md)と[通常設定](../migration/production-operations.md)を読み、
新しいoperationに観測時刻・影響・対象commit/versionを記録する。認証の取得先は[アクセス](private-access.md)。
旧Supabaseへ切り戻さず、現在のCloudflareで前進修復する。

## まず行う読取り

- root/Auth capabilities/maintenanceのHTTPS応答と、未認証の個人APIが拒否されるかを確認する。
- Cloudflare WorkersのDeploymentsからactive versionと割合を確認し、そのversionのbindings/runtimeを取得する。
  READMEの日付や最新uploadをactiveと推測しない。該当時間のObservability/Errors/Triggersも確認する。
- GitHubのmain、関連PR/CIと配備記録を照合する。CI成功・merge・本番反映は別の証拠。
- 必要なD1照会は対象storeを確認し、SELECTで状態を読む。公開ログやチャットへ個人情報・SQL結果・秘密値を貼らない。
- 直前のPOST/PUT/deploy等が結果不明なら、intent・receipt・保存物・versionを読むまで再送しない。

## 症状別の調査先

| 症状 | 調べる箇所・確認する結果 |
| --- | --- |
| 画面が起動しない/PWAが古い | catalog取得、HTML/SW、`src/main.tsx`、資産manifestとhash、旧assetの欠落。APIをcacheへ入れていないか。 |
| ログイン/MFA失敗 | Auth capabilities、Better Auth URL/origin、対象Auth D1と停止状態、session cookie、OAuth state。本人のpassword/TOTP/QRは共有させない。旧MFAやcallbackを再登録しない。 |
| 保存/削除/通知操作が失敗 | client requestとAPIのstatus/body制限、session/所有者/MFA、transaction/receipt。0 bytesの本文は空streamにもなる。該当API契約と隔離testで修正する。 |
| 決済反映が遅い | Stripe署名receipt、event ID、dispatch/業務projection、ownerとcustomer対応。未確定を未送信とみなしてCheckout/返金/Webhookを再送しない。 |
| メールが届かない | Resend送信ID、署名付き配送通知、suppression、実受信を分けて確認。試験メールは既存許可を再利用せず、新しい1通の送信許可を得る。 |
| 画像が出ない | R2 bucket/key・所有者prefix・bytes/hash・旧保存URLのR2変換。旧Supabase Storageへfallbackしない。 |
| 認証API/CLIが401 | 同一accountの認証期限・既存lease/refresh journalを確認。mutationをretryしない。期限不足なら新intentをdispatchする前に同一grantを安全に更新する。 |

## バックアップ・監視

日次は09:05 JST、monitorは毎時35分。CloudflareのTriggers/実行ログに加えて、
該当UTC日付slotのclaim/receipt、暗号化archive、容量・hash、30日保持、owner/writer解除を照合する。
Cron設定や発火だけを保存成功としない。R2の現在のkeyは保存済みmanifest/receiptから探し、slot名を推測して書き込まない。
backup/monitor Workerの通常configはGitにある。statusは公開HTTP APIではなく内部service RPCなので、
必要なら既存の認可済みoperatorを調べ、なければ現在のactive bindingに限定した短命・認証付きread-only operatorをレビューする。
旧`production-backup-inspection.mjs`等は閉鎖時のruntime/store/admissionへ固定されており、そのまま本番通常状態に再利用しない。

失敗やtimeoutでは同slot・manual UUID・復旧POSTを再送しない。終了不明のclaim/fenceを強制解除せず、
実処理と保存物を照合する。通知試験を保存成功の代わりに実行しない。

## 修復と復旧

コード修正は最小限にして隔離test→CI→[本番更新](deployment.md)→独立readbackへ進む。
旧Supabase・Lovable origin・閉鎖config・古いbundleを無条件に戻すrollbackは行わない。

データ復旧が必要なら、保存済み鍵/escrow/manifestと対象schema・保存先・writer状態を先に確認する。
原本を保持し、新しい隔離D1/R2で復号・全表/画像/hash・Authを検証してから、停止と復旧先の切替を個別に判断する。
通常更新にDB復旧を混ぜない。現在の書込みを失う操作・本番データの上書き・資源削除は依頼範囲と具体的影響を確認する。
過去のrestoreを再実行するために旧admission/HEAD/phaseの固定値を変更しない。

診断結果・原因・修正・CI・実配備・未確認事項を非秘密の状態記録へ残し、詳細はGit外journalへ保存する。

## #71の保存ログ

本番appはcustom/例外ログの保存を有効化済み。ObservabilityのEventsで時刻・`event`・`job`・`operation`・失敗分類と`elapsedMs`/`handlerMs`を確認し、Live接続なしでも読めることを確認する。自動invocationログとtraceは保存しない。秘密・任意URL/query・Cookie・検索語を診断へ追加しない。GETのscript-settingsでlogsのpersist/サンプリングとquery除去を確認し、active versionの読取りと混同しない。保存開始前の障害は集計と手元の原本だけで判断し、正常観測だけを原因修復と扱わない。

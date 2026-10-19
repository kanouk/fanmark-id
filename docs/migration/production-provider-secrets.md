# 本番アプリの資格情報と残っている接続確認

2026-10-19時点。閉鎖中の `fanmark-app-production` に設定した内容と、公開前に必要な確認を分ける。値・暗号文・鍵の保管先はGitへ入れない。[読戻し証拠](evidence/production-application-secrets-readiness-2026-10-19.json)。

## 設定済み

| 用途 | secret binding | 確認できた範囲 |
| --- | --- | --- |
| ログインとバックアップ | `BETTER_AUTH_SECRET`、`STAGING_BACKUP_KEY` | 既存の運用保管・実backup/復旧検査を保持 |
| Google / GitHub / Discord / Apple | 各 `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET`、合計8件 | 旧client identity・秘密値の暗号化保管、Appleの既存鍵と署名、API登録応答・binding読戻し |
| 決済 | `STRIPE_SECRET_KEY`、`STRIPE_SECRET_KEY_LIVE`、`STRIPE_SECRET_KEY_TEST` | 通常キーは元のlive値と同じ。live/testの各GET accountで期待アカウントとの一致を確認。課金は実行していない |
| メール | `RESEND_API_KEY` | 元の値を暗号化で取得。GET domainsでfanmark.idがverified。設定の送信元は既存のno-reply@fanmark.id。送信・配送試験は未実施 |
| パスワード付き公開ページ | `VERIFIED_ACCESS_SECRET` | 本番専用256-bit乱数を生成。Mac Keychainと暗号化Vaultへ保存し、別processの復号・一致・HMAC検査後に登録 |

合計15件。各登録はprivate intentを保存した後に一度だけ送信し、API応答と別のGETで確認した。最初の8件登録では、厳密比較がCloudflareの操作注記 `workers/triggered_by` の変更で停止した。再送せず別processで全設定を比較し、secret追加とこの注記以外の変更がないことを確認した。

現app版は `b03de981-0764-445f-bade-cdc024d7e8c0`。runtime codeはCI成功済み794564c。公開route・Custom Domain・Cronは0、workers.dev/previewsは無効、receipt_only・backup admission pendingを維持。backup/monitorと既存Workerの設定も保持した。

## 旧環境からの保管方法

Google等は既存管理画面の正規表示から取得した。Stripe live・旧Webhook署名鍵・Resendは、対象3変数だけを読む期限10分の一時診断関数を旧projectへ追加した。service-role認証と追加nonceを要求し、返却前にRSA-OAEP/AES-GCMで暗号化。ローカルで復号した値を既存の運用保管鍵で再暗号化し、平文応答・平文file・ログを残さない。生成したhandlerの認証拒否・期限・暗号化・改変拒否7ケースを配備前に検査した。

一時関数を所有ID/versionで確認して削除し、前後の既存関数inventoryが一致した。既存の通常関数、sourceの資格情報、ユーザーデータは変更していない。テスト用Stripeキーはログイン済みの既存サンドボックス画面で表示されていた値を暗号化保存し、別processのGET accountで照合した。キーの作成・ローテーション・決済は行っていない。

## 公開前に残ること

- **Stripeの本番通知先:** liveアカウントではv1 webhook endpointsとv2 event destinationsの両一覧が空。旧Supabaseへの送信先は既存sandboxに1件だけあり、snapshot形式・4種類のeventを受信している。旧署名鍵を新本番の署名鍵として設定していない。本番用の受信先、必要event一覧、API version、受信停止と再送・旧効果照合を実行票へ固定する。既存test endpointと解約済み自己テスト契約は保持する。
- **Resend配送通知:** `BROADCAST_WEBHOOK_SIGNING_SECRET` と移行先の配送通知endpointは未準備。APIキーの成功やdomain verifiedだけでは、実受信・bounce/complaint処理・監視通知の配送完了にならない。
- **OAuth:** Google/Discord/Appleのcallback追加案は保存直前の確認待ち。GitHubは旧App所有者fanmark-idでのログイン待ち。providerの本番ログイン、既存ユーザーへの紐付けは未確認。
- **公開ページ用鍵の遠隔保管:** JSONがSync対象外と判明したため、同じ暗号化envelopeを既存の同期対象であるMarkdownにも保存した。Sync設定は不変。対象fileの同期hash一致、遠隔versionのdownload・全byte一致、別processでの復号・Keychain一致・HMACを確認済み。別端末での復旧と、実データでのパスワード確認は未実施。
- **サーバ間マスター参照:** `REFERENCE_MASTER_SERVICE_SECRET` は未設定のまま。旧Supabase側の参照移行用callerと一般の公開Master APIを区別する。今回の本番切替で稼働させるcallerがある場合に限り別途接続を確定する。旧Supabase資格情報を新appへ追加して暗黙のfallbackを作らない。

secret一覧は値の独立読戻しを提供しない。したがって、登録成功とbindingの一致を実providerへのログイン・課金・配送成功へ広げて解釈しない。管理者MFAは独立した準備がそろった後に行う。

2026-10-19の追加読取りで、Resendはstaging向けenabled endpoint 1件だけと確認した。本番用の登録順序・event一覧・停止条件は[Webhook実行候補](production-webhook-activation.md)へ固定した。Stripe/Resendの作成時disabledを仮定せず、到達先を検証する前には登録しない。[鍵の遠隔保管と通知先の証拠](evidence/webhook-inventory-and-key-custody-2026-10-19.json)。

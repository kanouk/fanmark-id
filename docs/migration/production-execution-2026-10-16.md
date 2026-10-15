# 2026-10-16 本番移行の開始前作業

所有者からデータ移行・ドメイン切り替えの実施指示を受けた。以前の「本番変更なし」は今回の指示で更新された。PR #41・既存ブランチを継続し、本番確認までmainを維持する。**実施の許可はあるが、停止・確定移送・公開の技術条件は未達**。現在の本番サービスは停止していない。

## 今回実行したこと

- in-appブラウザでCloudflareの対象account/zone、Supabaseの本番project、Stripeのアカウントを確認。Stripeは開かれていたtest画面からlive画面へ移動し、read-only WebMCPでもlivemode=trueを確認した。
- `493976d`のCI38753106454はApplication/Workerとも成功。今回の追加コードのCIとは区別する。
- Supabaseのread-only transactionでAuthの形式・identity対応・管理者整合性・決済設定・定期処理を再確認した。個人行・秘密値をログに出さず、集計はGit外の0700ディレクトリ、0600ファイルに保存した。
- 認証データだけをrepeatable-readの予備snapshotとして取得。CLI応答はメモリ内で処理し、AES-256-GCMで暗号化して保存後に復号一致を確認した。DB/Auth/画像全体の確定backupではなく、sourceは稼働中。鍵は専用ローカルファイルにあり、別保管・遠隔復旧は未検証。
- 本番専用のD1 3個とR2 3個をAPACのlocation hintで作成した。[資源表](production-resources.json)のID・作成時刻を別のreadで確認。D1はtable数0、R2の情報はobject数0/size0、r2.dev公開は3個とも無効。backup bucketのcustom domainもなし。schema適用、アプリbinding、実データ投入、Worker配備はまだ行っていない。
- Cloudflare管理画面からDNSのBIND zoneをexportし、Git外に保管した。DNS、証明書、Webhookの設定変更は0。

秘密を含む原本と集計の保存先は `/Users/kanouk/.codex/private/fanmark-cutover-2026-10-16/`。このディレクトリをGitへ追加しない。`auth-precopy.aesgcm.json`と`auth-precopy.key`は予備調査用であり、本番復旧可能性を証明するものではない。

## Authで見つかった停止条件

SupabaseはTOTPのランダムな秘密バイト列をBase32文字列で保存する。一方、固定版Better Auth 1.7.5のtwo-factor pluginは復号した文字列をUTF-8にしてHMACへ渡す。Base32文字列をそのまま暗号化・コピーすると、同じ認証アプリのコードが401 `INVALID_CODE`になることを合成データと実D1互換runtimeで再現した。

[Auth投影](../../scripts/migration/supabase-auth-projection.mjs)はBase32を復号し、UTF-8との往復で元バイト列が完全一致する場合だけ変換する。それ以外は `source_auth_totp_binary_key_requires_adapter` で拒否する。**今回の実Auth予備コピーはこの条件に該当し、移送可能とは判定していない。** 二段階認証を削除したり、emailVerifiedを真にしたり、管理権限をメール一致で作ったりして通過させない。

所有者には次の選択肢を提示済み。回答待ちであり、再登録・互換adapterとも未実施。

1. 推奨：管理者の認証アプリを移行先で再登録する。独自の暗号・認証分岐を増やさない。旧環境で本人と現在のMFAを確認し、非公開の移行先で新MFA・現在sessionの管理権限を確認してから公開する。本人用の閉鎖中再登録経路、再登録結果を最終snapshotへ結び付ける照合、途中失敗時の旧環境維持が必要で、これらはまだ実装していない。
2. 現在の登録を維持する：任意のバイト列を扱うTOTP互換adapterを追加する。SDKのlockout、試行回数、署名cookie、session、MFA assuranceと整合する独立試験が必要。node_modulesの書き換えやMFAの無効化で代用しない。

投影処理はUUID・provider subject・bcrypt・email確認状態・停止状態・管理者対応を検査する。メールは大小文字衝突を拒否した上で、Better Authの検索に合わせて小文字へ正規化する。日時はSDKのミリ秒精度へ正規化する。旧session、refresh token、verification link、MFA assuranceは移さない。Supabaseにないbackup codeは勝手に発行せず、空の配列をSDK形式で暗号化する。処理の戻り値は常にproductionReady=falseであり、本番runnerではない。

## 決済とドメインの確認結果

- 旧DBの `stripe_mode` はlive。Supabaseの現在の購読行は終了済みで、稼働中契約なしというDB集計を得たが、Stripeの現在値・未完了Checkout・遅延通知との照合は未完了。
- 確認したStripe liveアカウント `acct_1SFjhvJk0VCfiKUp` のWebhookページは送信先未登録の画面だった。test側には通常stagingの送信先がある。旧本番secretがこのliveアカウントに属することはまだ確認していない。旧本番の受信経路が正常と推測したり、test webhookをlive用として変更したりしない。
- Cloudflare zone `6a2c39c92ba1c4106b7c19f87ada0a7e`、account `bfc2890741f0b3fb236e2d755b6c9adc`。apex/www/adminはA `185.158.133.1`、authはCNAME `ppqgtbjykitqtiaisyji.supabase.co`。4件ともproxied/TTL Auto。全17件のzone exportを保存した。BIND exportはAPI record IDを含む復元票ではない。
- Workers Routes一覧は空。Universal証明書は `fanmark.id` / `*.fanmark.id` に対しActive、表示期限2026-12-29。これは将来のCustom Domain切替を検証した結果ではない。
- SupabaseのSite URLは `https://fanmark.id/`、redirect allowlistは既存5件を維持。OAuth provider側のcallback変更は未実施。
- 旧notification cronはinactive、license expiry cronはUTC 00:00にactive。source全writerの停止を開始していない。

## 残る実装・当日条件

P1は空の保存先作成まで。Worker/DO/ratelimit/production config、schema適用、secret custody、バックアップ・監視は未完了。P2の本番移送runner/独立checker、P3の全source writer停止/drain、P4の旧receipt receiverと引継ぎ、P5の今回のMFA対応、P6のprovider/Stripe照合と変更・復元票、P7の実資源復旧、P8の全データ予備移送実測も残る。MFAの回答だけで切替可能になるわけではない。

ソース更新、業務データの移送、DNS切替、新旧dispatcher変更、送信・実課金、mainへのmergeは行っていない。次はMFA方針に沿った移行入口を作り、上記条件を完成させる。条件がそろうまで停止時間を開始しない。

## 検証

Node 22.6.0でAuth投影4件、既存Auth preflight4件、production preparation9件の合計17件が成功。native D1と固定SDKで移送した合成bcryptによるログイン→TOTP要求→元の認証コード→同じuser/factorのMFA assurance、停止中/未確認メールの拒否を確認した。実利用者のログイン・OAuth callback・本番import成功は検証していない。

参考：固定版SDKの `plugins/two-factor/index.mjs`、`totp/index.mjs`、`@better-auth/utils/dist/hmac.mjs` を直接確認した。[Better Authの暗号化仕様](https://better-auth.com/docs/reference/security)も参照したが、移送可否は上記の実装と再現試験に基づく。

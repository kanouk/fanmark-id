# 告知メールの停止・調査・記録保管

2026-10-09。クリティカルな操作以外を継続する既存許可の範囲で、Cloudflare移行後の初期運用にも
以下の保持・調査方針を採用する。方針の決定は記録保持と所有者の調査を選ぶもので、
本番宛先への送信、既存利用者の記録削除、停止済みrecipientの強制再開を許可・実行しない。
ステージングの実配送証拠を、本番への実配備・切り替えの証拠にはしない。

## 保持と担当

担当者はサービス所有者。合成fixtureのexact-owned cleanupは検証ごとの許可・journalによる
例外とし、以下の通常運用の保存期間と混同しない。バックアップの30日retentionとは別の方針である。

| 記録 | 初期運用の保持方針 |
| --- | --- |
| 完了したrun/recipientと保存済みtemplate snapshot | 最終活動から最低30日。30日到達で削除しない。ownerのレビュー待ちとして保持する。 |
| snapshotting/sending/pending/needs_review、lease・結果不明・未解決の競合 | 解決まで保持。年齢、lease期限、providerキーの期限だけで削除・状態変更しない。 |
| request ID/broadcast IDの重複防止記録、署名event ID/provider ID、初回完了監査 | 保持を継続する。recipientの保存期間と連動した削除はしない。 |
| complaint/permanent bounceによるsuppression | 保持を継続する。後着deliveredや時間経過で解除しない。 |

最終活動はrunの完了日時だけでなく、recipient更新と関連署名通知の**受信日時**のうち最新を
使う。providerの発生日時は結果の順序判定に使う別の値で、古い発生日時で保管を短縮しない。
これは最低保管期間とレビュー時期であり、自動purgeの実装ではない。
現行コードに通常queueのTTL/purge処理は追加しない。この記録により、初期運用の保持期間・
調査担当・窓外の不確定結果を停止維持する扱いを確定する。手動resume APIや自動削除機能の
新規実装を、この移行の追加必須項目にはしない。将来の削除を行う際は重複防止/抑止を
失わない別変更とし、この保持方針を削除許可へ読み替えない。

## 結果不明の送信を調べる

1. 所有者は通常stagingの正確なWorker version/bindingと対象run IDを確認する。調査対象の
   run、recipient、request ID、provider ID、attempt/first_attempt/期限、lease、保存済み
   fingerprint、署名eventをprivate journalへ保存する。メール本文・宛先・認証秘密値を
   公開issue/PR/アプリ応答へ複製しない。
2. 同じrunの集計と`last_error_code`を読み取る。`needs_review`は送信失敗確定ではない。
   `idempotency_window_expired`、`attempt_limit_uncertain`、`provider_id_conflict`、
   `auth_identity_changed`、`payload_changed_after_attempt`は、それぞれ元の記録を保持する。
3. 不確定送信を再度要求しない。既存の署名受信は有効に保つ。必要な場合は送信selectorだけを
   停止し、Auth/署名受信/通知・Stripeの他設定を保持する。配備が必要なら、元binding/asset/
   Cronのreadbackを伴う通常の変更手順で行い、旧versionへのrollbackだけで設定解除を推定しない。
4. 既知のprovider IDは[Resendの取得API](https://resend.com/docs/api-reference/emails/retrieve-email)
   または所有者の管理画面で調査する。APIの受理、signed sent、signed delivered、本人受信を
   区別する。署名receiptはprovider IDでのみ結ばれるため、本文/宛先を保存していないreceipt
   だけから未知のprovider IDとrecipientの対応を推測しない。メール一覧で見つからないことは
   未送信の証明ではない。
5. 調査結果が不明なら停止と記録保持を継続する。first_attempt/attempt数/期限/fingerprintの
   書換え、別request ID・新しいcampaignによる代替再送、suppression解除を行わない。
   所有者だけが後続の解決を判断する。現行管理UI/APIに手動resume/未知provider IDのリンク機能は
   ないため、調査完了を送信再開の許可や実行証拠にはしない。必要な修正は対象と根拠を固定した
   別のレビュー可能な変更として用意する。
6. 既存のリンク済みprovider IDへ実署名通知が届いた場合は、通常Webhookの処理・run集計・
   初回監査の不変を確認する。実配送/終端状態を確認した後も、元のrequest/初回日時と調査記録を
   残す。再送ボタンや手動Cronで受信確認を代行しない。

[Resendの公式契約](https://resend.com/docs/dashboard/emails/idempotency-keys)はキーを24時間保持する
（2026-10-09に確認）。現行adapterは同じpayload/keyで窓内だけ再試行し、窓の期限後や不確定な
上限到達では`needs_review`へ停止する。ローカル状態を書き換えて新しい24時間窓を作らない。

## 現行コードと確認済みの範囲

- `workers/api/src/broadcast-email-delivery-d1.ts`: snapshot/lease、同じ本文fingerprintとprovider
  keyによる再試行、期限/不確定上限/identity・payload変更の停止、集計・初回監査。
- `workers/api/src/broadcast-email-webhook-d1.ts`とBusiness0025/0026: 署名受信、event重複防止、
  provider発生順、complaint/恒久bounceの優先、リンク済みrunの再集計。
- `workers/api/src/broadcast-email-admin-d1-api.ts`: 同じrequest/broadcastの再要求を既存runへ
  結び付ける。`needs_review`を新規送信として解除するAPIはない。
- [合成受理後状態からの実Resend再試行](evidence/staging-broadcast-controlled-provider-retry-2026-10-09.json)
  は窓内・同じprovider IDの限定証拠。実network故障や窓外の解決実行には広げない。
- [51件の実配送](evidence/staging-broadcast-multi-recipient-native-2026-10-09.json)と
  [実送信UI](evidence/staging-broadcast-send-ui-native-2026-10-09.json)は、それぞれの範囲で受け入れ済み。

この文書の追加によるメール送信、配備、D1/R2変更、削除・再開は0。初期運用の保持・調査方針の採用と、
本番への実切り替え/不確定送信の解決実行/自動purgeの受け入れを区別する。

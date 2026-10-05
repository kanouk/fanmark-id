# 宛先限定のステージング告知メール検証

2026-10-06 JST。認証メールとは別の送信許可を得るための具体的な検証内容。
本書の準備は送信許可ではなく、まだproviderへ送信していない。

## 送信内容

- 宛先: ユーザーが指定した既存のメール検証用アドレス1件。実アドレスはprivate journalとserver設定にのみ保管する。
- 実際の件名: `[テスト] fanmark.id ステージング告知メールの動作確認`
- 言語: 日本語。種別: `broadcast_announcement`。
- 本文:

```text
Cloudflareステージング環境の告知メール送信テストです。
このメールは指定された検証用アドレスにのみ送信しています。
このメールに対する操作や返信は不要です。
```

## 実行と終了条件

1. 09:00 JSTの自然日次observerが終了してから候補を変更する。現在の監視中versionは維持する。
2. 正確な合成管理者・MFA・Business admin plan、draft/request UUID、保持するデータのbaselineをprivate journalに記録する。既存ユーザーを管理者に変更しない。
3. 送信許可後、serverの固定宛先とtest-send selectorだけを選ぶ。bulk selectorは無効のまま。
4. 同じcandidateで管理者MFAによるdraft作成・日本語test-sendを1回実行する。APIは呼出側の宛先指定を受け付けず、provider idempotency keyを固定する。
5. Resendの受理/message IDと配信結果、D1の対応auditを照合する。不確定な応答では新しいrequest IDで再送せず、同じidempotency keyの状態を確認する。
6. journalで所有を確認したdraft/audit/合成Auth・Business行だけを削除し、別read-only processで元のアカウント・Master・MFA・匿名履歴を保持したことを確認する。private journalは一時ディレクトリに置かない。
7. bounded proofを記録する。全audience配信、署名Webhook、bounce/suppression、retry/retention、全体移行を、この1通の成功から受け入れない。

現行コードのテスト経路は、exact-session MFA、D1 admin plan、draft状態、固定宛先、HTML escapeとprovider idempotencyを要求する。
[API契約](broadcast-email-admin-api.md)と[配送設計](broadcast-email-delivery-design.md)を参照。

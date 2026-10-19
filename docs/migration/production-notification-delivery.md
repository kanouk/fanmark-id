# 本番監視通知の到達検証票（未送信）

本人の承認した宛先へ`delivery-test`を1通だけ送る候補。通常のバックアップ失敗通知と同じ
`ProductionBackupService.alert`・既存Resend送信処理・R2の一度だけのclaimを使う。
バックアップのcaptureや日次slotの再利用、利用者向けメール、課金操作は行わない。
宛先・本文を記したprivate `production-monitor-delivery-proposal.json`を本人へ提示してから実行する。

## 先に確認する状態

- 成功CIのruntimeと閉鎖設定、固定5 store/scope/schema/key ID。実writer0・ownerなし。
- appの一般HTTP/Auth/dispatcherと全Cron、backup/monitorのCronは閉鎖を保持する。
- 同じUTC日付・scope・`delivery-test`のR2記録を確認する。過去の試験を削除して再送しない。
- 既存送信元/domainと秘密値を保持し、試験中の宛先とalert selectorだけを固定したprivate設定票にする。
- 所有operatorの作成・設定・実行・除去、appを閉鎖設定へ戻す操作を同じprivate journalへ固定する。

## 固定した操作口

`production-backup-alert-test.mjs`の`productionBackupAlertTestSource`は期限付きbearerで
POST `/delivery-test`だけを受ける。呼出し本文、query、任意宛先/本文/日付を拒否する。
実内部statusでruntime/5 store/schema/key ID・capture admission=false・writer0/ownerなしを
照合し、同じ日の固定scopeとcodeだけをalertへ渡す。run/prune/停止解除は公開しない。

alert処理はR2へconditional claimを保存してからproviderへ一度送信する。応答不明や失敗は
claimを保持し、日付やcodeを変えて再送しない。既存のprovider-accepted記録があれば新規送信を
しない。operatorが200を返しても`delivered=false`のまま、宛先への実配送は別に確認する。

## 合格条件と後片付け

1. provider message IDとR2のprovider-accepted記録が一致する。
2. 同じmessage IDをResendの実配送状態/利用可能な署名通知へ照合する。
3. 本人の受信箱または迷惑メールを含め到達を確認する。provider acceptedだけで成功にしない。
4. alert selector/宛先を閉鎖準備の設定へ戻し、公開route/Cron0、全bindingと他Worker/元DNS不変を確認する。
5. 所有した一時operatorだけを除去して独立GETで不在を確認する。R2の試験記録は保持する。

native operator試験は、誤認証/期限/runtime/schema/日付の拒否、本文/任意routeの拒否と
固定`delivery-test`だけのRPCを検査した。実Resend配送ではない。
移送後のschema再固定・本番backup保存、定期Cron/監視の有効化と自然実行は当日の別工程。

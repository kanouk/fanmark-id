# 本番Webhookの登録・受入れ順序

2026-10-19の読取り結果に基づく実行候補。現時点ではproviderの登録・変更・通知送信を実行していない。管理者MFA前に実行票を準備し、実登録は最終移送と受信先の確認後に行う。署名鍵が未設定のまま一般公開・課金開始はしない。

## 現在の通知先

| Provider | 確認結果 | 今回の扱い |
| --- | --- | --- |
| Stripe live | v1/v2とも通知先0件 | 新しい本番用endpointを登録する |
| Stripe sandbox | 旧Supabase向け1件、snapshot/4 event | 既存登録と解約済み自己テスト契約を保持する |
| Resend | staging向け1件、enabled/6 event | stagingを置換せず本番を別登録する |

ResendはGET一覧のHTTP 200・`has_more=false`を確認した。秘密値・宛先メールアドレスは公開証拠へ保存していない。[今回の限定証拠](evidence/webhook-inventory-and-key-custody-2026-10-19.json)。

## 通知を始めずに事前登録できるか

Stripeの[作成API](https://docs.stripe.com/api/webhook_endpoints/create)には作成時のdisabled指定がなく、作成応答例はenabled。Resendの[作成API](https://resend.com/docs/api-reference/webhooks/create-webhook)は.NET例だけにDisabledの記述があるが、[公式OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml)のCreateWebhookRequestと[公式Node SDK型](https://github.com/resend/resend-node/blob/main/src/webhooks/interfaces/create-webhook-options.interface.ts)にはstatusがない。未文書化の指定が効くと仮定して作成しない。

登録直後に無効化する方法にも、その間の配信がある。まだ旧サイトへ向くfanmark.idに先行登録すると、旧サイトの200応答を通知受理と誤認する可能性があるため採用しない。Stripeでは無効化・削除時に次のretryが停止する場合もある。[公式の再送動作](https://docs.stripe.com/webhooks#automatic-retries)。単なる無効化を通知の安全な一時保管とは呼ばない。

## Stripeの固定設定候補

- 対象は既存liveアカウント。作成直前にGET accountでidentityを照合する。Connectはfalse。
- URLは `https://fanmark.id/api/stripe/webhook`。転送を挟まないsnapshot endpoint。
- `api_version` は現runtimeの固定版 `2025-08-27.basil`。旧sandboxの `2025-10-29.clover` を黙って継承しない。既存account全体のAPI versionは変更しない。
- eventは現dispatcherが処理する以下10件。`*` は使わない。

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
invoice.payment_action_required
invoice.payment_succeeded
```

1. sourceの新規決済入口・定期処理・既存処理の停止と外部結果照合、確定移送、受信台帳の引継ぎを完了する。各実行票の証拠が欠けていれば登録しない。
2. G4でapexを新Workerへ接続し、`receipt_only`のままTLS・配備identity・一般画面503・Webhookの未設定503を外部から確認する。旧siteの200やredirectが返る場合は止める。
3. private実行票に固定operation ID・作成bodyのhash・元inventory・時刻を保存してから一度作成する。返されたendpoint IDと署名鍵を直ちに暗号化保管する。応答不明では別IDで作成し直さず、一覧・metadata・固定idempotency keyと元要求の対応を調べる。署名鍵を確保できなければ閉鎖を維持する。
4. 同じ鍵を閉鎖appの `STRIPE_WEBHOOK_SECRET` へ設定し、endpointのID/URL/livemode/API version/eventsとWorkerの閉鎖状態を別GETで照合する。秘密値のbinding一覧だけで署名受理成功とはしない。
5. 作成から鍵反映までに失敗した配信をIDで列挙し、保存済みreceipt・delivery count・dispatch pendingへ照合する。必要な再送は当該IDだけ、業務適用停止を維持して行う。以前のpaid Checkoutや解約済みテスト契約を一括再送しない。
6. 自然受信が0件なら成功を捏造せず、既存の非課金検証手順で署名・重複排除・保存を確認する。実providerからの配送確認と合成署名の検査を区別する。課金操作は検査のために追加しない。

現在の受信routeは署名鍵1件を検証する。liveとsandboxの新endpointを同じ本番routeへ追加して両方の鍵を受理できるとは扱わない。既存testデータの保持・test APIによる照合と、sandboxの新規通知を本番へ配信することは別。追加のsandbox配信が必要になれば別途設計・検証する。

## Resendの固定設定候補

- URLは `https://fanmark.id/api/webhooks/resend/broadcast-delivery`。
- eventは `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`。現handlerおよび既存staging登録と一致する。
- 本番専用署名鍵を `BROADCAST_WEBHOOK_SIGNING_SECRET` に設定する。staging鍵は流用しない。

本番routeは`receipt_only`中に503を返す。まず一般公開前の新Worker到達を確認し、所有する新endpointを登録・暗号化保管・GET照合する。既存staging通知先を変更しない。新endpointはproviderの文書化された更新APIでdisabledにできるが、無効期間のeventを後から全件受け取れるとは仮定しない。作成直後からの配信履歴と、切替期間に既存送信処理が発生させたメールIDを記録する。

G5前に署名検証と受信DBの照合を完了し、業務メール送信の開始前に本番endpointをenabledへ戻す。実配送の検査に使う宛先と送信内容は既存の本人承認範囲に従う。APIキーのdomain verifiedだけで配送・bounce/complaint対応済みとはしない。既存sourceの未完了メールと外部効果の照合は[旧環境の停止票](source-stop-and-resume.md)を使う。

## 中止・応答不明

作成・設定の不確定時は一般公開と新規課金・メール送信を開始しない。自分の操作で作ったendpointだけをID/URL/account/metadataで特定し、履歴を暗号化保管する。削除・無効化で配信記録を失っていないか確認し、Stripeの新受信は[旧側への回収手順](stripe-receipt-transfer.md)に従う。旧live通知先は元から0件なので、「元URLへ戻す」操作で復旧完了とはしない。

実行には、登録応答の秘密値を暗号化保存するdriver、応答不明時の同一要求照合、登録後の独立読戻し、G4/G5の接続検証が必要。これらの本番実行は未実施。本書だけで移行準備完了とは判定しない。

## 登録前後の保管処理

`scripts/migration/production-webhook-custody.mjs` と `production-webhook-readback.mjs` を追加した。providerへのPOSTやG4/G5の開始許可は提供しない。保管と読戻しの成功をsource停止や受信先への到達証拠の代わりにしない。

1. `beginProductionWebhookRegistration` に固定provider・operation UUID・本番archive鍵ID/鍵とGit外0700 directoryを渡す。固定名のintentを0600・排他的作成/fsyncしてから要求bodyを返す。同じproviderは別UUIDでも同directoryで再開始できない。運用では新しいdirectoryへ逃げて再試行しない。
2. 別の実行処理がG4の前提を確認して一度POSTする。固定body、Stripeのidempotency key、同じprivate intentを使う。現在このPOST接続と最新到達確認は未実装。
3. HTTP応答が得られたら `captureProductionWebhookResponse` へstatusとJSONを渡す。成功判定より先に全応答をAES-GCMで保管する。エラーや予想外の応答に署名鍵が含まれても平文fileへ出さない。通信切断で応答自体がない場合はintentだけを保持する。captureの再送・上書きは拒否する。
4. `readProductionWebhookRegistration` で別GETを行う。Stripeはlive accountを照合後にendpoint、Resendはdomain全ページとfanmark.id verifiedを確認後にendpointを読む。結果に署名鍵を含む場合があるため、ログ/平文fileへ出さず直接 `verifyProductionWebhookRegistration` へ渡す。
5. verifierは元応答とGETのID、固定URL・event・statusを照合する。Stripeはlivemode・API version・operation metadata・Connect applicationなしも確認。暗号化応答・intent・検証reportのhashを指定したprivate processでだけ `openProductionWebhookSecret` を使い、別のruntime設定処理へ値を渡す。取出し値を出力しない。

21件の関連検査（鍵保管の既存3件を含む）が成功。既存Resend staging endpointでは新GET adapterの実domain/endpoint取得も確認したが、これは本番登録・配送の証明ではない。HTTP失敗時はprovider本文/キーを例外へ含めない。遠隔custodyへの追加保管・runtime設定・署名付き実受信・応答不明時の所有endpoint特定と復旧は引き続き必要。

## G4確認後に一度だけ登録する接続（2026-10-19追加）

`production-webhook-execution.mjs` の `executeProductionWebhookRegistration` は
上記の保管処理と固定hostのPOSTを接続する。CLIから自動起動せず、当日のprivate processで
呼ぶ。今回の実装検査は合成HTTPのみで、本番登録は実行していない。

入力の`gate`は`fanmark-production-webhook-g4-evidence-v1`。
run UUID、runtime version、全settings hash、source停止境界/G3照合/受信引継ぎの各hash、
source project、停止/外部効果照合/業務未開始/実施者承認を固定し、観測から2分以内を要求する。
**gateは確認済み証拠を入力する契約であり、旧環境の停止を実施・実証する機能ではない。**
各hashの原本をprivate実行票へ保存し、当日の独立確認から作成する。過去の準備証拠や
手入力のtrueだけで開始条件を満たしたと扱わない。

実行は固定Cloudflare accountのGETでsettings完全一致、receipt_only・dispatcherなし・Cron0、
配備100%と固定version、apexの所有service/zone、workers.dev/previews無効を照合する。
HTTPSの一般画面/Auth/未設定Webhookの503/no-storeとエラー本文を転送なしで確認し、
provider資格情報をこれらの公開URLへ送らない。署名のない空JSONによる到達確認は
受信記録を作成しない。provider一覧を全ページ取得し、同じURL/operationの存在を拒否する。

同じdirectoryの排他intent、gate、秘密を含まない元inventoryをfsyncし、もう一度配備と
到達を確認してから排他dispatchをfsyncする。Stripeは固定idempotency keyとform body、
Resendは固定JSONを**一度だけ**POSTする。成功・HTTPエラー・非JSON応答ともboundedな
原文を先にAES-GCM保管し、その後に独立GETと既存custody verifierを実行する。
応答消失・途中保存失敗・GET失敗でもintent/dispatchを残し、自動再送しない。

`inspectProductionWebhookRegistrationExecution` は元intent/dispatch hashを要求して
GET一覧の候補だけを返す。URL一致を所有証明にせず、候補0件も作成失敗の証明にしない。
Stripe metadataが一致しても一度だけ返される鍵はGETで回収できない。Resendの同URL追加も
第三者操作との区別がつくまで自動採用しない。再作成・削除・鍵rotation・runtime設定を
自動実行せず、旧側へ戻す場合は候補と配送履歴を保持して上記の回収票へ進む。

この追加でruntime秘密値設定・遠隔保管・実provider配送・G5開始は完了しない。
Cloudflare制御面の読戻しと外部HTTPは同時transactionではないため、当日は外部の
設定変更担当を止め、固定した実行票を単独実行する。

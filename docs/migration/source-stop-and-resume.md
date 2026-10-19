# 旧環境の停止順序と公開前の中止手順

対象は `ppqgtbjykitqtiaisyji` から専用Cloudflare資源への移行。これは実行票の候補であり、
停止・配備・移送・DNS変更を実行した記録ではない。管理者MFAは、以下の未完了準備を
閉じてから最後に取得する。既存の解約済み自己テスト契約は原本のまま移す。

## 開始前にそろえるもの

| 項目 | 現状と開始条件 |
| --- | --- |
| source原本 | 35 Edge Functionの原本、各ID/version/JWT設定、個別依存file hashを保存済み。開始直前に全件再照合する |
| 停止・逆操作SQL | Cron、71保護relation、保存専用Stripe receiverの候補あり。同じrunの14 fileへ再生成し、独立にhash/権限を確認した。当日のinventory再取得・再生成は未実施 |
| 旧handlerの終了確認 | 実行ID/配備版/開始終了ログの全ページcollectorを実装し、実24時間40件・10実行の終了を照合済み。Function差替えやログだけでは全処理・外部副作用の完了を証明できない。当日の停止境界、DB/Storage・送信・決済との対応は別途必要 |
| Stripe棚卸し | 下記GET専用collectorを実装。元の秘密鍵を移出しない一時診断adapterでlive取得とsource照合を実施済み。当日の停止境界での再照合は未完了 |
| 中止時の受信記録 | source streamの暗号化保存・D1への移送、逆方向のatomic SQL・固定読取adapter・暗号化保管・一度の実行journal/別要求読戻しを実装、native往復検証済み。実資源の閉鎖・旧処理終了・実回収は未実施 |
| 移行先の閉鎖 | 一般HTTP/Auth/Cronと業務dispatcherを止める。受信専用経路も開ける前に当該Worker version・binding・署名鍵・台帳を照合する |

未完了のまま停止を始めない。特に、障害時に旧サービスを戻すための手順が書かれている
ことと、受信した通知を落とさずに戻せることの実証を分ける。

## 当日の実行順序

| 順序 | 操作と確認 | 保存する証拠 |
| --- | --- | --- |
| 1 | 旧環境の変更作業・外部writerを止める。原本35関数、Cron、DB/Storage inventory、Stripeアカウントと送信先を再取得 | run、時刻、全定義hash、停止担当・対象 |
| 2 | 固定runの保存専用receiverを準備し、同じ旧Webhook slugへ配備する。署名検証と永続保存の受付を維持する | 配備ID/version/JWT・保存先。旧版handlerの終了は別確認 |
| 3 | Checkout/Portalを含む34関数の入口をmaintenanceへ変更し、Cronを元の定義に結び付けて停止する。直接API/Auth/Storage・管理者操作を含む新規writerも停止する | 各入口の拒否と定義、停止前に始まった処理の一覧 |
| 4 | 開始済みのDB/Storage/Edge・外部決済/メール処理を突き合わせる。Stripeのopen Session、complete/unpaid、処理中PaymentIntent、継続請求、Payment Linkを確認 | 未確定処理の終端・副作用との対応。経過時間だけで終了扱いしない |
| 5 | DB freezeを適用して独立検査し、Auth/業務/Storageの最終snapshotを取る。既存uploadや署名URL経由のbytes変更も止まったことを確認する | 同じ境界の全件数/hash、freeze定義、Storage実bytesの再照合 |
| 6 | 旧receiverをsealし、開始済み保存commitの完了を確認。専用streamを暗号化取得し、固定5 storeへの移送・独立読戻しと併せて照合する | seal時の全内容、archive hash、全journal、独立比較report |
| 7 | 必要な受信経路だけを新側へ開ける。境界後に届く通知を別streamとして保持し、旧側での適用済み効果と照合する | 新旧mode/event ID・Checkout/業務効果の対応と未解決0 |
| 8 | provider設定・認証・バックアップ/復旧・公開経路の受入れを確認して公開判断へ進む | 本票だけでは公開しない。新側の一般書込み開始は別の境界 |

open Checkoutの強制失効、請求取消、返金、通知の再送はこの準備処理に含めない。
残っていた場合は対象と処遇を確定する。画面の「complete」だけでは入金済みと扱わない。
StripeのSession仕様ではcompleteでも支払い処理が進行中のことがある。
[公式Session仕様](https://docs.stripe.com/api/checkout/sessions/object)

## 公開前に中止した場合

「公開前」は、新側の一般書込み・業務dispatcher・外部副作用を一度も開始していないことを
実記録で確認できる状態。未確定のimportがあっても新資源を閉じたまま保存できるが、
それだけで旧環境の再開が安全とはならない。

1. 新側の一般HTTP/Auth/Cron/dispatcherを閉鎖したまま、移送の新規操作を止める。
   executor、未確定operation、private journal、部分投入データを消さない。
   部分stageや応答不明があるrunは[quarantine](production-import-recovery.md)で元の全状態を
   保持したまま新規移送を恒久拒否し、proof hashを独立inspectへ照合する。先行D1管理要求の
   完了を取り消す操作ではない。閉鎖履歴・新業務writeなし・受信回収の証拠も別に必要。
2. 新側受信を一度も開けていなければ、source receiverの実seal状態と保存済みstreamを
   照合する。開けた後なら、新側の受付中保存を完了させ、境界後streamを回収して旧側に
   永続保存・全内容照合する。[回収adapterとjournal](stripe-receipt-transfer.md)を使うが、実閉鎖と旧処理終了の証拠・本番回収の読戻しがそろうまで再開不可。
3. sourceがseal済みなら、同じrunの `verify.sql` で確認して `reopen.sql` を実行する。
   既にopenなら再実行しない。応答不明は状態を読み直す。受信記録を削除しない。
4. 通知ごとにsource業務の適用結果を確認する。保存済み通知に200を返した後では、
   Stripeの再送に頼って取り戻せない。元handlerへの全件再送やpendingの一括完了はしない。
5. 復旧中も入口とCronを止めたまま、DB freezeの逆操作を適用し、元の権限・trigger・
   Storage状態を確認する。35関数は保存原本とJWT設定へ個別に戻し、全inventoryを照合する。
   Stripeの旧handlerを戻すのは受信・効果の照合を終えた後。保存用schema/記録は保持する。
6. 元の公開経路でAuth・所有者操作・画像を確認してから、元々activeだったCronだけを
   復元する。旧環境を再び唯一のwriterとし、新側は閉鎖を保持する。

新側で業務書込みや外部副作用が始まった、または開始の有無が不明なら、この中止手順の
対象外。DNSだけ旧側へ戻して二つのwriterを作らない。データ・決済・通知を含めた復旧を行う。

## Stripe棚卸しcollector

`scripts/migration/source-stripe-inventory.mjs` の `collectSourceStripeInventory` は、メモリ上の
既存資格情報とlive/testを受け取り、固定アカウントを確認後、Session・全状態のSubscription・
Invoice・PaymentIntent・Payment Link・取得可能なEventをGETだけで取得する。
ページ欠落、重複、上限到達、mode混在、未知の状態、API失敗では結果を成功として返さない。
sourceデータを変更せず、イベントを再送・適用しない。

返り値はIDと照合に必要なmetadataを含むためGit外のprivate保存に限定する。秘密・
メール・client secret・イベント全文は返さない。CIでは偽の資格情報/応答だけを使う。
本番adapterは元のsecretを同じ実行環境内で渡し、チャット・引数・ログへ出さない。

取得は複数HTTP要求なのでatomic snapshotではない。イベント一覧も永続的な全履歴ではなく、
v1/v2の送信先全件一覧や旧業務効果の証明を含まない。過去のpaidを未適用と決めず、
すべて照合対象として保持する。件数0だけで移行可能としない。

Stripeはlive通知を最大3日間自動再試行し、手動再送にはDashboardで15日、CLIで30日の
期間制限がある。停止中の記録保存や復旧手順をその再試行期間で代用しない。特に
Sessionの作成日とEventの作成日は同じとは限らない。
[公式再送仕様](https://docs.stripe.com/webhooks#automatic-retries)

## 2026-10-19の実取得

同じcollectorのsource hashを固定し、10分で失効するnonceとservice roleを要求する
一時診断関数から実行した。旧環境の秘密鍵はその環境内だけで使用した。全6 collectionの
ページ終端まで読み取り、未完了Checkout/処理中支払い/継続契約・請求/有効Payment Link/
配信待ち通知は0件。Sessionはexpired 2・paid/complete 1、PaymentIntentはsucceeded 1。

過去のpaidは対応する旧ライセンス1件（expired）と所有者/fanmarkが一致したが、
同じSessionの監査と延長監査は0件。適用結果は未確定として保持し、返金・再送・
ライセンス補正は行わない。新しい受信を処理する際には、この履歴を再適用しないための
照合が別に必要。ユーザーが保持を求めたcanceled契約1件もそのまま存在した。

診断関数を削除し、元の35関数のID/version/JWT/provider hashが開始前と同じことを
独立した一覧取得で確認した。原本関数と業務データへの書込みはない。
[取得結果と制限](evidence/source-stripe-inventory-readback-2026-10-19.json)。
本番の停止・drain・最終snapshotはまだ行っていない。

## Edge実行ログによる終了確認

`collectSourceExecutionLogs({ token, from, to })`は固定projectのManagement APIへGETだけを行う。
UTCの分境界・24時間以内の明示範囲を要求し、同じ範囲をSQLにも指定する。本文・URL・HTTP
ヘッダーは取得せず、実行ID・関数ID・配備版・時刻・event種別・終了理由・HTTP statusだけを
privateに保存する。2 sourceの件数を取得前後に比較し、全ページの行数と一致しなければ拒否する。
同時刻のcursorは`timestamp, toString(id)`で順序を固定する。UUID型の既定順序に依存しない。

実行IDごとに関数/配備版が一致し、終了イベントが1件で、その後の活動が記録されていない
場合だけ「終了を観測」とする。HTTP 200だけでは未終了、identity欠落は未照合、timeout等は
異常終了として残す。`EarlyDrop`/`EventLoopCompleted`でもDB・決済・送信の成功は認定しない。

当日は入口を閉じる前から取得窓を開始し、保存した35関数原本と停止後の配備版を区別して
照合する。ログの保持期限・取得遅延・記録制限があるため、空の取得結果や全行照合の成功を
全処理の終了に読み替えない。DB transaction、Cron/queue、Storageの実bytes、Stripe/メールの
外部結果を別に確認する。未照合・異常終了は対象の処理結果が解決するまで公開を止める。

2026-10-18 04:47〜10-19 04:47 UTCの実取得は40行・6ページ、実行10件すべて終了を観測、
identity欠落/未終了/異常終了0。保存済み旧inventoryとの照合では`admin-list-users`4件と
`check-expired-licenses`1件を含む。他5件は旧35関数以外の診断関数の記録として保持する。
sourceは稼働中のままで、これは停止の実証ではない。[取得証拠](evidence/source-execution-logs-readback-2026-10-19.json)。

`source-inflight-observation.sql`も当日の確認に使う。10/19 04:53:50 UTCの実READ ONLY観測で、
他clientのtransaction・write xidのあるtransaction・prepared transaction・未終了Cron・
pg_net待機要求は各0だった。観測要求自身は集計から除外する。query本文やHTTPのURL/headers/bodyは
取得しない。[実観測](evidence/source-inflight-readback-2026-10-19.json)。
pg_stat_activityは実時間の統計であり、repeatable-readでも全サービスのatomic snapshotにはならない。
pg_netの[queue消費と応答保存は別処理](https://github.com/supabase/pg_net/blob/master/src/core.c)なので、
待機0を送信完了と扱わず、`pg_net_inflight_known=false`を維持する。

参照: [公式ログAPI](https://supabase.com/docs/reference/api/v1-get-project-logs)、
[ログの照会](https://supabase.com/docs/guides/observability/advanced-log-filtering)、
[終了理由](https://supabase.com/docs/guides/troubleshooting/edge-function-shutdown-reasons-explained)。

## 停止時間の見積もり

現状は本番の停止時間を確定できない。準備済みデータ量のlocal restore測定を本番RTOに
読み替えない。最終snapshot/暗号化・5 store import/独立比較・Stripe効果照合・認証確認・
公開経路確認を通したリハーサル時間と、上記中止手順の実測を実行票へ追加する。
本番開始前に中止判断の時刻と担当を決め、未解決の処理が残る場合は公開へ進めない。
